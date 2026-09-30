import { describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-sqlite";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db }));

import { consumeRateLimit } from "@/lib/security/rate-limit";
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

  it("stores hashed subjects, not raw emails", async () => {
    await consumeRateLimit(RULE, "person@example.com", T0);
    const rows = await db.prepare("SELECT key FROM rate_limits").bind().all();
    expect(JSON.stringify(rows.results)).not.toContain("person@example.com");
  });
});

describe("trustedClientIp", () => {
  it("uses cf-connecting-ip only", () => {
    const req = (h: Record<string, string>) => new Request("https://app.test/", { headers: h });
    expect(trustedClientIp(req({ "cf-connecting-ip": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.5" }))).toBeNull();
    expect(trustedClientIp(req({ "cf-connecting-ip": "evil<script>" }))).toBeNull();
  });
});
