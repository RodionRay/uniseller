import {
  ADMIN_USER_ID,
  createSessionToken,
  getAdminEmail,
  readEnv,
  sessionCookieName,
} from "@/lib/auth";
import { internalAppOrigin } from "@/lib/env";
import { listUserIdsForCron } from "@/lib/users";
import { constantTimeEqual } from "@/lib/security/secret-compare";
import { database } from "@/lib/server-store";
import { acquireLock, releaseLock } from "@/lib/locks";
import { advanceCursor, rotateFrom } from "@/lib/processes/round-robin";
import {
  SYSTEM_OWNER,
  readCronCursor,
  writeCronCursor,
} from "@/lib/processes/cron-state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Стена тика меньше AbortSignal воркера (300с), чтобы не ловить abort. */
const TICK_BUDGET_MS = 210_000;
const JOIN_TIMEOUT_MS = 90_000;
const SCAN_TIMEOUT_MS = 150_000;
const BOOT_TIMEOUT_MS = 20_000;
const MAX_JOINS = 3;
const MAX_SCANS_AUTO = 6;
const MAX_SCANS_FORCE = 10;
/** Owners per tick; the persisted cursor makes every owner's turn come round. */
const MAX_OWNERS_PER_TICK = 3;
/** Next owner starts only with this much budget left (boot + rescan + one scan). */
const OWNER_MIN_LEFT_MS = 80_000;
/** poll_dm_replies gets what is left, capped; the server bounds itself by budgetMs. */
const POLL_DM_MAX_BUDGET_MS = 60_000;
const POLL_DM_MIN_BUDGET_MS = 10_000;
const POLL_DM_RESERVE_MS = 25_000;
const POLL_DM_FETCH_MARGIN_MS = 8_000;
const MARK_TIMEOUT_MS = 12_000;
/** Server-side tick lock outlives the worker's fetch abort (270 s). */
const CRON_LOCK_TTL_MS = 300_000;
const CRON_LOCK_KEY = "cron:auto-rescan";
const CRON_CURSOR_JOB = "auto-rescan-owners";

function reply(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const MIN_CRON_SECRET_LENGTH = 32;

/** Dedicated secret only: never reuse SESSION_SECRET / TG_WORKER_TOKEN. */
function cronSecret(): string | null {
  const secret = readEnv("CRON_SECRET");
  return secret && secret.length >= MIN_CRON_SECRET_LENGTH ? secret : null;
}

async function bearerMatches(req: Request, secret: string): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  return constantTimeEqual(auth, `Bearer ${secret}`);
}

function errorStack(e: unknown): string {
  return e instanceof Error ? e.stack || e.message : String(e);
}

type CronOwner = { userId: string; email: string; name: string };

/** Stable order (admin first, then by id) so the cursor means the same owner across ticks. */
async function listCronOwners(): Promise<CronOwner[]> {
  const owners: CronOwner[] = [];
  const adminEmail = getAdminEmail();
  if (adminEmail) {
    owners.push({ userId: ADMIN_USER_ID, email: adminEmail, name: "Администратор" });
  }
  try {
    const users = await listUserIdsForCron();
    users.sort((a, b) => a.userId.localeCompare(b.userId));
    owners.push(...users);
  } catch (e) {
    console.error("[cron:auto-rescan] owners lookup failed", { err: errorStack(e) });
  }
  const seen = new Set<string>();
  return owners.filter((o) => !seen.has(o.userId) && !!seen.add(o.userId));
}

function isAbort(e: unknown) {
  const msg = String((e as Error)?.message || e);
  const name = String((e as Error)?.name || "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /aborted|timeout/i.test(msg)
  );
}

async function workspace(
  origin: string,
  cookie: string,
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const res = await fetch(`${origin}/api/workspace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: `${sessionCookieName()}=${cookie}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `workspace ${res.status}`) as Error & {
      status?: number;
      data?: any;
    };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function tryJoin(
  origin: string,
  cookie: string,
  id: string,
  timeoutMs: number,
) {
  try {
    const j = await workspace(
      origin,
      cookie,
      { action: "join_group", id },
      timeoutMs,
    );
    if (j?.ok || j?.pending) return { joined: 1, rejoinId: "", error: "" };
    const error = String(j?.error || j?.result?.error || "не вступил").slice(0, 160);
    if (j?.rejoinItem?.id) return { joined: 0, rejoinId: String(j.rejoinItem.id), error };
    return { joined: 0, rejoinId: "", error };
  } catch (e) {
    const data = (e as any)?.data;
    const error = String(data?.error || (e as Error)?.message || e).slice(0, 160);
    if (data?.rejoinItem?.id) return { joined: 0, rejoinId: String(data.rejoinItem.id), error };
    if (isAbort(e)) throw e;
    return { joined: 0, rejoinId: "", error };
  }
}

/**
 * Круглосуточный автообход лидов — вызывается tg-worker'ом, без открытого кабинета.
 * Порциями: 1 join + 1–2 скана за тик, с бюджетом времени. Остаток — следующим тиком.
 */
export async function POST(req: Request) {
  const secret = cronSecret();
  if (!secret) {
    return reply({ error: "CRON_SECRET не настроен (минимум 32 символа)" }, 503);
  }
  if (!(await bearerMatches(req, secret))) {
    return reply({ error: "Unauthorized" }, 401);
  }

  // Minted session cookies go only to the configured app origin, never to the request's host.
  const origin = internalAppOrigin();
  if (!origin) {
    return reply({ error: "INTERNAL_APP_ORIGIN / APP_URL не настроен или недопустим" }, 503);
  }
  const force =
    new URL(req.url).searchParams.get("force") === "1" ||
    (await req
      .clone()
      .json()
      .then((b: any) => b?.force === true)
      .catch(() => false));

  const started = Date.now();
  const left = () => TICK_BUDGET_MS - (Date.now() - started);

  const owners = await listCronOwners();
  if (!owners.length) {
    return reply({ error: "Нет пользователей для обхода" }, 503);
  }

  // Worker retries / overlapping schedules: one tick at a time across processes.
  const db = database();
  const lock = await acquireLock(db, {
    owner: SYSTEM_OWNER,
    key: CRON_LOCK_KEY,
    ttlMs: CRON_LOCK_TTL_MS,
  });
  if (!lock) return reply({ ok: true, skipped: true, reason: "busy" });

  const ticks: Record<string, unknown>[] = [];
  try {
    const cursor = await readCronCursor(db, CRON_CURSOR_JOB);
    let processed = 0;
    for (const owner of rotateFrom(owners, cursor).slice(0, MAX_OWNERS_PER_TICK)) {
      if (left() < OWNER_MIN_LEFT_MS) break;
      const cookie = await createSessionToken({
        userId: owner.userId,
        email: owner.email,
        displayName: owner.name,
      });
      const one = await tickOwner(origin, cookie, force, left);
      ticks.push({ owner: owner.userId, ...one });
      processed++;
    }
    await writeCronCursor(db, CRON_CURSOR_JOB, advanceCursor(cursor, processed, owners.length));
  } finally {
    await releaseLock(db, lock).catch((e) =>
      console.error("[cron:auto-rescan] lock release failed", { err: errorStack(e) }),
    );
  }

  const sum = (key: string) =>
    ticks.reduce((n, t) => n + (Number((t as any)[key]) || 0), 0);

  return reply({
    ok: ticks.every((t) => t.ok !== false),
    ticks,
    scanned: sum("scanned"),
    added: sum("added"),
    joined: sum("joined"),
    due: sum("due"),
    more: ticks.some((t) => !!(t as any).more),
    ms: Date.now() - started,
    at: new Date().toISOString(),
  });
}

async function tickOwner(
  origin: string,
  cookie: string,
  force: boolean,
  left: () => number,
) {
  const started = Date.now();
  const opTimeout = (cap: number) => Math.min(cap, Math.max(8_000, left() - 8_000));
  try {
    const boot = await fetch(`${origin}/api/workspace`, {
      headers: {
        Cookie: `${sessionCookieName()}=${cookie}`,
        Origin: origin,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
    });
    const bootData: any = await boot.json().catch(() => ({}));
    if (!boot.ok) {
      return {
        ok: false,
        error: bootData.error || "Не удалось загрузить кабинет",
      };
    }
    const settingsRow = (bootData.records || []).find(
      (r: any) => r.kind === "settings",
    );
    const settings = settingsRow?.data || {};
    if (!force && settings.autoRescanEnabled === false) {
      return {
        ok: true,
        skipped: true,
        reason: "autoRescanDisabled",
      };
    }

    const scanLimit = force ? MAX_SCANS_FORCE : MAX_SCANS_AUTO;
    const pack = await workspace(
      origin,
      cookie,
      {
        action: "rescan_groups",
        force,
        limit: scanLimit,
      },
      25_000,
    );

    const pendingJoins = new Set<string>();
    const rejoin: { id: string; name?: string }[] = Array.isArray(
      pack.rejoinItems,
    )
      ? pack.rejoinItems
      : [];
    for (const item of rejoin) {
      if (item?.id) pendingJoins.add(item.id);
    }

    let joined = 0;
    let extraReassigned = 0;
    let stoppedEarly = false;
    const errors: string[] = [];

    for (const item of rejoin.slice(0, MAX_JOINS)) {
      if (left() < 50_000) {
        stoppedEarly = true;
        break;
      }
      try {
        const r = await tryJoin(origin, cookie, item.id, opTimeout(JOIN_TIMEOUT_MS));
        joined += r.joined;
        if (r.error) errors.push(`join ${item.name || item.id.slice(0, 8)}: ${r.error}`);
        if (r.rejoinId && r.rejoinId !== item.id) {
          extraReassigned++;
          pendingJoins.add(r.rejoinId);
        }
        pendingJoins.delete(item.id);
      } catch (e) {
        if (isAbort(e)) {
          stoppedEarly = true;
          errors.push(`join timeout:${item.id.slice(0, 8)}`);
          break;
        }
        errors.push(String((e as Error).message || e).slice(0, 120));
      }
    }

    const ids: string[] = Array.isArray(pack.groupIds) ? pack.groupIds : [];
    let scanned = 0;
    let added = 0;
    let skipped = 0;

    for (const id of ids) {
      if (left() < 90_000) {
        stoppedEarly = true;
        break;
      }
      try {
        const r = await workspace(
          origin,
          cookie,
          { action: "scan_group", id, force },
          opTimeout(SCAN_TIMEOUT_MS),
        );
        if (r?.skipped) {
          skipped++;
          continue;
        }
        if (r?.rejoinItem?.id) {
          if (r?.soft || r?.preserved) continue;
          extraReassigned++;
          const jid = String(r.rejoinItem.id);
          if (left() >= 25_000) {
            try {
              const jr = await tryJoin(origin, cookie, jid, opTimeout(JOIN_TIMEOUT_MS));
              joined += jr.joined;
              if (jr.rejoinId && jr.rejoinId !== jid) pendingJoins.add(jr.rejoinId);
            } catch (e) {
              if (isAbort(e)) {
                stoppedEarly = true;
                pendingJoins.add(jid);
                break;
              }
              pendingJoins.add(jid);
            }
          } else {
            pendingJoins.add(jid);
            stoppedEarly = true;
          }
          continue;
        }
        scanned++;
        added += Number(r?.added) || 0;
      } catch (e) {
        const data = (e as any)?.data;
        if (data?.rejoinItem?.id) {
          if (data?.soft || data?.preserved) continue;
          extraReassigned++;
          const jid = String(data.rejoinItem.id);
          if (left() >= 25_000 && !isAbort(e)) {
            try {
              const jr = await tryJoin(origin, cookie, jid, opTimeout(JOIN_TIMEOUT_MS));
              joined += jr.joined;
            } catch {
              pendingJoins.add(jid);
            }
          } else {
            pendingJoins.add(jid);
            if (isAbort(e)) {
              stoppedEarly = true;
              break;
            }
          }
          continue;
        }
        errors.push(String((e as Error).message || e).slice(0, 120));
        if (isAbort(e)) {
          stoppedEarly = true;
          break;
        }
        if (errors.length >= 4) {
          stoppedEarly = true;
          break;
        }
      }
    }

    const pollBudget = Math.min(POLL_DM_MAX_BUDGET_MS, left() - POLL_DM_RESERVE_MS);
    if (pollBudget >= POLL_DM_MIN_BUDGET_MS) {
      try {
        await workspace(
          origin,
          cookie,
          { action: "poll_dm_replies", budgetMs: pollBudget },
          pollBudget + POLL_DM_FETCH_MARGIN_MS,
        );
      } catch (e) {
        // Ответы в ЛС — следующим тиком; сбой виден в логах.
        console.error("[cron:auto-rescan] poll_dm_replies failed", { err: errorStack(e) });
      }
    }

    const summary =
      `Автообход: вступил ${joined}/${Math.min(rejoin.length, MAX_JOINS)}, ` +
      `в очереди ${rejoin.length}, возвращено ${Number(pack.restored) || 0}, ` +
      `просканировано ${scanned}, лидов +${added}` +
      (errors.length ? ` · ошибки: ${errors.slice(0, 3).join(" | ")}` : "");
    try {
      await workspace(
        origin,
        cookie,
        { action: "mark_auto_rescan", summary, hasErrors: errors.length > 0 },
        Math.min(MARK_TIMEOUT_MS, Math.max(3_000, left())),
      );
    } catch (e) {
      console.error("[cron:auto-rescan] mark_auto_rescan failed", { err: errorStack(e) });
    }

    const due = Number(pack.total) || ids.length;
    const more =
      stoppedEarly ||
      due > ids.length ||
      extraReassigned > 0 ||
      pendingJoins.size > 0;
    return {
      ok: true,
      scanned,
      added,
      joined,
      skipped,
      due,
      queued: ids.length,
      remaining: Math.max(0, due - scanned - skipped),
      reassigned: (Number(pack.reassigned) || 0) + extraReassigned,
      more,
      ms: Date.now() - started,
      errors: errors.slice(0, 5),
    };
  } catch (e) {
    console.error("[cron:auto-rescan] owner tick failed", { err: errorStack(e) });
    return {
      ok: false,
      error: String((e as Error).message || e).slice(0, 400),
      timeout: isAbort(e),
      ms: Date.now() - started,
    };
  }
}

export async function GET(req: Request) {
  return POST(req);
}
