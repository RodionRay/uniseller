import { database } from "@/lib/server-store";

export type RateLimitRule = {
  readonly name: string;
  readonly limit: number;
  readonly windowSec: number;
};

export type RateLimitResult = {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Fixed-window limits, stored in D1 so they hold across Worker isolates.
 * Every attempt counts (successful ones too); humans stay far below these.
 * Exception: `loginPerEmail` counts failed logins only (see login route), so
 * an attacker cannot lock a victim out by spending their quota with noise
 * while the victim keeps logging in successfully.
 */
export const RATE_LIMITS = {
  loginPerIp: { name: "login-ip", limit: 20, windowSec: 15 * MINUTE },
  loginPerEmail: { name: "login-email", limit: 10, windowSec: 15 * MINUTE },
  registerPerIp: { name: "register-ip", limit: 5, windowSec: HOUR },
  contactPerIp: { name: "contact-ip", limit: 5, windowSec: HOUR },
  assistantAnonPerIp: { name: "assistant-anon-ip", limit: 30, windowSec: DAY },
  assistantAnonGlobal: { name: "assistant-anon-global", limit: 500, windowSec: DAY },
} as const satisfies Record<string, RateLimitRule>;

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key text PRIMARY KEY NOT NULL,
        window_start integer NOT NULL,
        count integer NOT NULL,
        expires integer NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires)")
    .bind()
    .run();
  tableReady = true;
}

async function bucketKey(rule: RateLimitRule, subject: string): Promise<string> {
  // Subjects are emails/IPs: store a digest, not the PII itself.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(subject.toLowerCase()),
  );
  return `${rule.name}:${Buffer.from(digest).toString("base64url")}`;
}

/** Counts one attempt against `rule` for `subject`; atomic per bucket. */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  await ensureTable();
  const nowSec = Math.floor(nowMs / 1000);
  const windowStart = nowSec - (nowSec % rule.windowSec);
  const expires = windowStart + rule.windowSec;
  const db = database();
  await db.prepare("DELETE FROM rate_limits WHERE expires <= ?").bind(nowSec).run();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires) VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start,
         expires = excluded.expires
       RETURNING count`,
    )
    .bind(await bucketKey(rule, subject), windowStart, expires)
    .first<{ count: number }>();
  const count = Number(row?.count ?? 1);
  return { allowed: count <= rule.limit, retryAfterSec: Math.max(1, expires - nowSec) };
}

/** Whether `subject` still has quota under `rule`, without counting an attempt. */
export async function peekRateLimit(
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  await ensureTable();
  const nowSec = Math.floor(nowMs / 1000);
  const windowStart = nowSec - (nowSec % rule.windowSec);
  const expires = windowStart + rule.windowSec;
  const row = await database()
    .prepare("SELECT count FROM rate_limits WHERE key = ? AND window_start = ?")
    .bind(await bucketKey(rule, subject), windowStart)
    .first<{ count: number }>();
  const count = Number(row?.count ?? 0);
  return { allowed: count < rule.limit, retryAfterSec: Math.max(1, expires - nowSec) };
}

/** Forgets all counted attempts of `subject` under `rule`. */
export async function resetRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  await ensureTable();
  await database()
    .prepare("DELETE FROM rate_limits WHERE key = ?")
    .bind(await bucketKey(rule, subject))
    .run();
}

/**
 * First rule that is exceeded wins; all rules are counted. A null subject
 * (e.g. no trusted client IP) skips that rule: one shared bucket for every
 * unidentified client would let a single abuser lock everyone out.
 */
export async function consumeRateLimits(
  checks: ReadonlyArray<readonly [RateLimitRule, string | null]>,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  let blocked: RateLimitResult | null = null;
  for (const [rule, subject] of checks) {
    if (subject === null) continue;
    const result = await consumeRateLimit(rule, subject, nowMs);
    if (!result.allowed && !blocked) blocked = result;
  }
  return blocked ?? { allowed: true, retryAfterSec: 0 };
}

export function tooManyRequests(retryAfterSec: number): Response {
  return Response.json(
    { error: "Слишком много попыток. Попробуйте позже." },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSec) },
    },
  );
}
