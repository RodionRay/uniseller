import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-raw";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db }));

import { consumeRateLimit, consumeRateLimits } from "@/lib/security/rate-limit";
import { createRateLimiter } from "@/lib/rate-limit";
import type { D1LikeDatabase } from "@/lib/db";
import { trustedClientIp } from "@/lib/security/client-ip";

const RULE = { name: "t", limit: 2, windowSec: 60 };
const T0 = Date.UTC(2026, 8, 30, 12, 0, 0);

describe("consumeRateLimit", () => {
  it("blocks after the limit and resets in the next window", async () => {
    expect((await consumeRateLimit(RULE, "a", T0)).allowed).toBe(true);
    expect((await consumeRateLimit(RULE, "a", T0 + 1000)).allowed).toBe(true);
    const blocked = await consumeRateLimit(RULE, "a", T0 + 2000);
    expect(blocked).toEqual({ allowed: false, retryAfterSec: 58 });
    expect((await consumeRateLimit(RULE, "b", T0 + 2000)).allowed).toBe(true);
    expect((await consumeRateLimit(RULE, "a", T0 + 60_000)).allowed).toBe(true);
  });

  it("skips a check whose subject is unknown instead of sharing a bucket", async () => {
    const one = { name: "skip", limit: 1, windowSec: 60 };
    for (let i = 0; i < 3; i++) {
      expect((await consumeRateLimits([[one, null]], T0)).allowed).toBe(true);
    }
    const rows = await db
      .prepare("SELECT count(*) AS n FROM rate_limits WHERE key LIKE 'skip:%'")
      .bind()
      .first<{ n: number }>();
    expect(Number(rows?.n)).toBe(0);
  });

  it("stops at the first exceeded rule without counting the later ones", async () => {
    const narrow = { name: "narrow", limit: 1, windowSec: 60 };
    const wide = { name: "wide", limit: 100, windowSec: 60 };
    await consumeRateLimits([[narrow, "ip"], [wide, "all"]], T0);
    for (let i = 0; i < 5; i++) {
      expect((await consumeRateLimits([[narrow, "ip"], [wide, "all"]], T0)).allowed).toBe(false);
    }
    const row = await db
      .prepare("SELECT count FROM rate_limits WHERE key LIKE 'wide:%'")
      .bind()
      .first<{ count: number }>();
    expect(Number(row?.count)).toBe(1);
  });

  it("stores hashed subjects, not raw emails", async () => {
    await consumeRateLimit(RULE, "person@example.com", T0);
    const rows = await db.prepare("SELECT key FROM rate_limits").bind().all();
    expect(JSON.stringify(rows.results)).not.toContain("person@example.com");
  });
});

describe("createRateLimiter.hit", () => {
  afterEach(() => vi.restoreAllMocks());

  // The attempt is already counted; a failed housekeeping DELETE must not turn it into
  // "store unavailable" (0), which callers answer with 503.
  it("returns the counted attempt when the stale-row cleanup fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingCleanup: D1LikeDatabase = {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => ({ results: [] }),
          first: async <T,>() => ({ count: 1 }) as T,
          run: async () => {
            if (sql.startsWith("DELETE")) throw new Error("database is locked");
            return { meta: { changes: 0 } };
          },
        }),
      }),
    };

    const count = await createRateLimiter(failingCleanup, () => T0).hit("k", { max: 5, windowMs: 60_000 });

    expect(count).toBe(1);
    expect(errors).toHaveBeenCalledOnce();
  });
});

describe("trustedClientIp", () => {
  const req = (h: Record<string, string>) => new Request("https://app.test/", { headers: h });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the header named by TRUSTED_IP_HEADER", () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "X-Real-IP");
    expect(trustedClientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(trustedClientIp(req({ "cf-connecting-ip": "198.51.100.4" }))).toBeNull();
  });

  // Unset = no overwriting proxy is known, so every header is client-controlled.
  it.each([undefined, "", "none", "NONE"])("trusts no header when TRUSTED_IP_HEADER=%j", (value) => {
    vi.stubEnv("TRUSTED_IP_HEADER", value);
    expect(trustedClientIp(req({ "cf-connecting-ip": "203.0.113.5" }))).toBeNull();
    expect(trustedClientIp(req({ "x-real-ip": "203.0.113.5" }))).toBeNull();
  });

  it("with cf-connecting-ip configured ignores x-forwarded-for and malformed values", () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "cf-connecting-ip");
    expect(trustedClientIp(req({ "cf-connecting-ip": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.5" }))).toBeNull();
    expect(trustedClientIp(req({ "cf-connecting-ip": "evil<script>" }))).toBeNull();
  });
});
