import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "@/lib/locks";
import { insertRecord, readData } from "./helpers/d1-fake";
import {
  ACCOUNT_ID,
  OWNER,
  deferred,
  fakeUnseal,
  harness,
  mockWorker,
  post,
  resetHarness,
  seedAccount,
  staffContext,
} from "./helpers/workspace-harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", async () => {
  const h = await import("./helpers/workspace-harness");
  return {
    readEnv: (name: string) => process.env[name],
    getSessionUser: async () =>
      h.harness.userId
        ? { userId: h.harness.userId, email: "o@example.test", displayName: "Owner" }
        : null,
  };
});
vi.mock("@/lib/server-store", async () => {
  const h = await import("./helpers/workspace-harness");
  return { database: () => h.harness.db, seal: h.fakeSeal, unseal: h.fakeUnseal };
});
vi.mock("@/lib/staff", async () => {
  const h = await import("./helpers/workspace-harness");
  const types = await import("@/lib/staff-types");
  return {
    ...types,
    resolveWorkspaceContext: async () => {
      if (h.harness.ctx instanceof Error) throw h.harness.ctx;
      return h.harness.ctx;
    },
  };
});

const { GET, POST } = await import("@/app/api/workspace/route");

const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const AUDIENCE_ID = "44444444-4444-4444-8444-444444444444";

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetHarness();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  errSpy.mockRestore();
});

function sqlite() {
  return harness.sqlite!;
}

function seedMailing(extra: Record<string, unknown> = {}) {
  insertRecord(sqlite(), {
    id: AUDIENCE_ID,
    owner: OWNER,
    kind: "audience_task",
    data: { url: "https://t.me/src", accountIds: [ACCOUNT_ID], status: "completed" },
  });
  insertRecord(sqlite(), {
    id: "55555555-5555-4555-8555-555555555555",
    owner: OWNER,
    kind: "audience_user",
    data: { taskId: AUDIENCE_ID, userId: "100", username: "client100" },
  });
  insertRecord(sqlite(), {
    id: TASK_ID,
    owner: OWNER,
    kind: "mailing_task",
    data: {
      name: "M",
      sourceKind: "audience",
      audienceTaskId: AUDIENCE_ID,
      contentMode: "template",
      templateText: "Hello from the test",
      deliveryMode: "dm",
      accountIds: [ACCOUNT_ID],
      status: "running",
      batchPerTick: 1,
      dailyLimitEnabled: false,
      pauseFromSec: 1,
      pauseToSec: 1,
      ...extra,
    },
  });
}

describe("POST staff access (REQ-B4)", () => {
  it("returns 403 JSON when staff lacks the section flag", async () => {
    harness.ctx = staffContext({ mailing: false });
    const res = await POST(post({ action: "tick_mailing", id: TASK_ID }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("checks save/delete by record kind", async () => {
    harness.ctx = staffContext({ proxies: false });
    const res = await POST(post({ action: "save", kind: "proxy", data: {} }));
    expect(res.status).toBe(403);
  });

  it("lets staff with the flag through", async () => {
    harness.ctx = staffContext({ leads: true });
    const res = await POST(post({ action: "mark_lead_viewed", id: GROUP_ID }));
    expect(res.status).toBe(404);
  });
});

describe("staff lookup failure (REQ-B5)", () => {
  it("POST answers 503 instead of acting on the caller's own id", async () => {
    harness.ctx = new Error("db down");
    const res = await POST(post({ action: "rescan_groups" }));
    expect(res.status).toBe(503);
    expect(errSpy).toHaveBeenCalled();
  });

  it("GET answers 503 too", async () => {
    harness.ctx = new Error("db down");
    mockWorker(() => ({}));
    const res = await GET();
    expect(res.status).toBe(503);
  });
});

describe("GET heal passes (item 20)", () => {
  it("still heals a stuck check found by the SQL prefilter", async () => {
    mockWorker(() => ({}));
    await seedAccount(sqlite(), ACCOUNT_ID, {
      status: "checking",
      checkingAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(readData(sqlite(), ACCOUNT_ID)).toMatchObject({ status: "setup", checkingAt: "" });
  });
});

describe("GET resilience (REQ-B5)", () => {
  it("skips a corrupt row, logs it, returns the rest and hides lock rows", async () => {
    mockWorker(() => ({}));
    await seedAccount(sqlite());
    insertRecord(sqlite(), { id: "bad-row", owner: OWNER, kind: "lead", data: "{not json" });
    await acquireLock(harness.db!, { owner: OWNER, key: "x", ttlMs: 60_000 });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { records: { id: string; kind: string }[] };
    expect(body.records.map((r) => r.id)).toEqual([ACCOUNT_ID]);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("per-account lease (REQ-B1)", () => {
  it("scan_group skips a busy account without calling the worker", async () => {
    const calls = mockWorker(() => ({ ok: true, messages: [] }));
    await seedAccount(sqlite());
    insertRecord(sqlite(), {
      id: GROUP_ID,
      owner: OWNER,
      kind: "group",
      data: { name: "G", url: "https://t.me/grp_one", accountId: ACCOUNT_ID, membership: "joined" },
    });
    await acquireLock(harness.db!, { owner: OWNER, key: `account:${ACCOUNT_ID}`, ttlMs: 60_000 });
    const res = await POST(post({ action: "scan_group", id: GROUP_ID, force: true }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ skipped: true, busy: true });
    expect(calls).toEqual([]);
    expect(readData(sqlite(), GROUP_ID)).toMatchObject({ membership: "joined" });
  });

  it("check_account on a busy account keeps its status", async () => {
    const calls = mockWorker(() => ({ ok: true, status: "active" }));
    await seedAccount(sqlite(), ACCOUNT_ID, { status: "active" });
    await acquireLock(harness.db!, { owner: OWNER, key: `account:${ACCOUNT_ID}`, ttlMs: 60_000 });
    const res = await POST(post({ action: "check_account", id: ACCOUNT_ID }));
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(body.result).toMatchObject({ ok: false, busy: true, status: "active" });
    expect(calls).toEqual([]);
    expect(readData(sqlite(), ACCOUNT_ID)).toMatchObject({ status: "active" });
  });
});

describe("worker check contract (refreshedSession / flood)", () => {
  it("re-seals refreshed session material for the owner and sends accountId", async () => {
    const bodies: Record<string, unknown>[] = [];
    mockWorker((_path, body) => {
      bodies.push(body);
      return {
        ok: true,
        status: "active",
        sessionRefreshed: true,
        refreshedSession: { zipBase64: "NEWZIP", apiId: 2040, apiHash: "tdesk" },
      };
    });
    await seedAccount(sqlite());
    const res = await POST(post({ action: "check_account", id: ACCOUNT_ID, rotateProxy: false }));
    expect(await res.json()).toMatchObject({ result: { ok: true, sessionRefreshed: true } });
    expect(bodies[0]).toMatchObject({ accountId: ACCOUNT_ID });
    const row = sqlite().prepare("SELECT secret FROM records WHERE id=?").get(ACCOUNT_ID) as {
      secret: string;
    };
    expect(JSON.parse(await fakeUnseal(row.secret, OWNER))).toMatchObject({
      zipBase64: "NEWZIP",
      kind: "tdata",
    });
  });

  it("flood sets cooldownUntil and does not mark the account dead", async () => {
    mockWorker(() => ({ ok: false, status: "flood", waitSec: 120, error: "FloodWait 120" }));
    await seedAccount(sqlite());
    await POST(post({ action: "check_account", id: ACCOUNT_ID }));
    const data = readData(sqlite(), ACCOUNT_ID)!;
    expect(data.status).toBe("active");
    expect(Date.parse(String(data.cooldownUntil))).toBeGreaterThan(Date.now() + 60_000);
  });
});

describe("tick locks (REQ-B2)", () => {
  it("two concurrent tick_mailing calls send exactly one DM", async () => {
    resetHarness(2);
    const gate = deferred();
    const calls = mockWorker(async (path) => {
      if (path === "/send-message") {
        await gate.promise;
        return { ok: true, messageId: "1", chatId: "100" };
      }
      return { ok: true };
    });
    await seedAccount(sqlite());
    seedMailing();
    // Warm module caches so both racing requests take the same number of hops.
    await POST(post({ action: "tick_mailing", id: GROUP_ID }));
    // Both requests start in the same tick: each reads the task before either writes.
    const both = Promise.all([
      POST(post({ action: "tick_mailing", id: TASK_ID })),
      POST(post({ action: "tick_mailing", id: TASK_ID })),
    ]);
    await vi.waitFor(() => expect(calls).toContain("/send-message"));
    await new Promise((r) => setTimeout(r, 50));
    gate.resolve();
    const bodies = (await Promise.all((await both).map((r) => r.json()))) as Record<
      string,
      unknown
    >[];
    expect(bodies.filter((b) => b.busy)).toHaveLength(1);
    expect(bodies.filter((b) => b.sent === 1)).toHaveLength(1);
    expect(calls.filter((p) => p === "/send-message")).toHaveLength(1);
  });

  it("a tick after the first finished sees the delivered key and does not resend", async () => {
    const calls = mockWorker(() => ({ ok: true, messageId: "1", chatId: "100" }));
    await seedAccount(sqlite());
    seedMailing();
    await POST(post({ action: "tick_mailing", id: TASK_ID }));
    sqlite()
      .prepare("UPDATE records SET data=json_set(data,'$.nextAt','') WHERE id=?")
      .run(TASK_ID);
    await POST(post({ action: "tick_mailing", id: TASK_ID }));
    expect(calls.filter((p) => p === "/send-message")).toHaveLength(1);
  });
});

describe("poll_dm_replies (REQ-B3 / REQ-B8)", () => {
  it("polls at most two accounts and writes only the cursor into settings", async () => {
    const ids = [
      "a1111111-1111-4111-8111-111111111111",
      "a2222222-2222-4222-8222-222222222222",
      "a3333333-3333-4333-8333-333333333333",
      "a4444444-4444-4444-8444-444444444444",
    ];
    for (const id of ids) await seedAccount(sqlite(), id);
    insertRecord(sqlite(), {
      id: "settings-1",
      owner: OWNER,
      kind: "settings",
      data: { name: "Before", inboxPollCursor: 0 },
    });
    const calls = mockWorker((path) => {
      if (path === "/inbox-dms") {
        // A user edit lands while the long worker call is in flight.
        sqlite()
          .prepare("UPDATE records SET data=json_set(data,'$.name','Edited') WHERE id=?")
          .run("settings-1");
      }
      return { ok: true, messages: [] };
    });
    const res = await POST(post({ action: "poll_dm_replies" }));
    expect(res.status).toBe(200);
    expect(calls.filter((p) => p === "/inbox-dms").length).toBeLessThanOrEqual(2);
    expect(readData(sqlite(), "settings-1")).toEqual({ name: "Edited", inboxPollCursor: 2 });
  });
});
