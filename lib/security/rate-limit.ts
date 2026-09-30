import { createRateLimiter, type RateRule } from "@/lib/rate-limit";
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
 * Every attempt is counted before the work it guards (atomic per bucket, so
 * parallel requests cannot slip past); humans stay far below these.
 * Login: `loginPerEmailIp` (email + trusted IP, or email alone when no IP is
 * trusted) is the tight guess limit and is cleared by a successful login, so
 * guesses from one network do not lock the owner out elsewhere;
 * `loginPerEmail` is a high ceiling against guessing spread over many IPs.
 */
export const RATE_LIMITS = {
  loginPerIp: { name: "login-ip", limit: 20, windowSec: 15 * MINUTE },
  loginPerEmailIp: { name: "login-email-ip", limit: 10, windowSec: 15 * MINUTE },
  loginPerEmail: { name: "login-email", limit: 100, windowSec: 15 * MINUTE },
  registerPerIp: { name: "register-ip", limit: 5, windowSec: HOUR },
  contactPerIp: { name: "contact-ip", limit: 5, windowSec: HOUR },
  assistantAnonPerIp: { name: "assistant-anon-ip", limit: 30, windowSec: DAY },
  assistantAnonGlobal: { name: "assistant-anon-global", limit: 500, windowSec: DAY },
} as const satisfies Record<string, RateLimitRule>;

const DEFAULT_ASSISTANT_USER_DAILY_LIMIT = 200;

/**
 * Daily cap per signed-in user on the paid assistant key.
 * `ASSISTANT_USER_DAILY_LIMIT` overrides the default; invalid values fall back to it.
 */
export function assistantUserDailyRule(): RateLimitRule {
  const configured = Number(process.env.ASSISTANT_USER_DAILY_LIMIT);
  const limit =
    Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_ASSISTANT_USER_DAILY_LIMIT;
  return { name: "assistant-user", limit, windowSec: DAY };
}

const MS_PER_SEC = 1000;

let tableReady = false;

/** Same shape as drizzle/0003_rate_limits.sql, for databases the migrations have not reached. */
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key text PRIMARY KEY NOT NULL,
        count integer NOT NULL,
        window_start integer NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start)")
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

function storeRule(rule: RateLimitRule): RateRule {
  return { max: rule.limit, windowMs: rule.windowSec * MS_PER_SEC };
}

/**
 * Counts one attempt against `rule` for `subject`; atomic per bucket.
 * Fails closed: the store is fail-open (`hit` answers 0 on a D1 error), so 0
 * means "not counted" and the guarded action must not run unthrottled.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  await ensureTable();
  const store = createRateLimiter(database(), () => nowMs);
  const key = await bucketKey(rule, subject);
  const count = await store.hit(key, storeRule(rule));
  if (count === 0) throw new Error("Счётчик лимитов недоступен");
  if (count <= rule.limit) return { allowed: true, retryAfterSec: 0 };
  const retryAfterSec = await store.retryAfterSec(key, storeRule(rule));
  return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
}

/** Forgets all counted attempts of `subject` under `rule`. */
export async function resetRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  await ensureTable();
  await createRateLimiter(database()).reset(await bucketKey(rule, subject));
}

/**
 * Counts `checks` in order and stops at the first exceeded rule: later
 * (usually wider) buckets are not spent by a client that is already blocked.
 * A null subject (e.g. no trusted client IP) skips that rule: one shared
 * bucket for every unidentified client would let one abuser lock out everyone.
 */
export async function consumeRateLimits(
  checks: ReadonlyArray<readonly [RateLimitRule, string | null]>,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  for (const [rule, subject] of checks) {
    if (subject === null) continue;
    const result = await consumeRateLimit(rule, subject, nowMs);
    if (!result.allowed) return result;
  }
  return { allowed: true, retryAfterSec: 0 };
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
