/**
 * Fixed-window counter store backed by the D1 `rate_limits` table (drizzle/0003).
 * The store itself is fail-open: a missing table or D1 error is logged and `hit`
 * answers 0. Policy (rules, subjects, fail-closed handling) lives in
 * lib/security/rate-limit.ts, the only production caller.
 */
import type { D1LikeDatabase } from "@/lib/db";

export type RateRule = { max: number; windowMs: number };

/** Rows older than the longest rule window (1 day) are abandoned and safe to drop. */
const STALE_ROW_MS = 24 * 60 * 60_000;

export type RateLimiter = {
  /** Counts one event; returns the count inside the current window. */
  hit(key: string, rule: RateRule): Promise<number>;
  /** True when the current window already holds `rule.max` events. */
  isLimited(key: string, rule: RateRule): Promise<boolean>;
  /** Seconds until the current window for `key` ends (0 when not limited). */
  retryAfterSec(key: string, rule: RateRule): Promise<number>;
  reset(key: string): Promise<void>;
};

function logFailure(action: string, error: unknown) {
  console.warn(`[rate-limit] ${action} skipped (fail-open):`, (error as Error)?.message ?? error);
}

export function createRateLimiter(
  db: D1LikeDatabase,
  now: () => number = Date.now,
): RateLimiter {
  async function readWindow(key: string, rule: RateRule) {
    const row = await db
      .prepare("SELECT count, window_start FROM rate_limits WHERE key = ?")
      .bind(key)
      .first<{ count: number; window_start: number }>();
    if (!row || row.window_start <= now() - rule.windowMs) return null;
    return row;
  }

  return {
    async hit(key, rule) {
      const at = now();
      const expired = at - rule.windowMs;
      try {
        const row = await db
          .prepare(
            `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET
               count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
               window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start
                                   ELSE rate_limits.window_start END
             RETURNING count`,
          )
          .bind(key, at, expired, expired)
          .first<{ count: number }>();
        const count = row?.count ?? 1;
        if (count === 1) {
          // A new window is rare enough to carry the cleanup of abandoned keys.
          await db
            .prepare("DELETE FROM rate_limits WHERE window_start < ?")
            .bind(at - STALE_ROW_MS)
            .run();
        }
        return count;
      } catch (error) {
        logFailure("hit", error);
        return 0;
      }
    },
    async isLimited(key, rule) {
      try {
        const row = await readWindow(key, rule);
        return Boolean(row && row.count >= rule.max);
      } catch (error) {
        logFailure("isLimited", error);
        return false;
      }
    },
    async retryAfterSec(key, rule) {
      try {
        const row = await readWindow(key, rule);
        if (!row) return 0;
        return Math.max(1, Math.ceil((row.window_start + rule.windowMs - now()) / 1000));
      } catch (error) {
        logFailure("retryAfterSec", error);
        return 0;
      }
    },
    async reset(key) {
      try {
        await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
      } catch (error) {
        logFailure("reset", error);
      }
    },
  };
}
