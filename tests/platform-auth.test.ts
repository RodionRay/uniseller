import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./platform-d1";
import { createRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

vi.mock("cloudflare:workers", () => ({ env: {} }));
/** Tight guess limit per email + client IP, and the per-email ceiling against IP rotation. */
const LOGIN_FAILURE_RULE = { max: RATE_LIMITS.loginPerEmailIp.limit };
const LOGIN_EMAIL_RULE = { max: RATE_LIMITS.loginPerEmail.limit };

const state = vi.hoisted(() => ({
  d1: null as unknown,
  users: new Map<string, { id: string; email: string; name: string; passwordHash: string }>(),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: () => state.d1,
  pingDatabase: async () => true,
}));
vi.mock("@/lib/users", () => ({
  findUserByEmail: async (email: string) => state.users.get(email) ?? null,
  createUser: vi.fn(async (input: { email: string; name: string }) => ({ id: "new", ...input })),
}));

const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: register } = await import("@/app/api/auth/register/route");
const { hashPassword } = await import("@/lib/auth");

function jsonRequest(path: string, body: unknown, ip = "203.0.113.7") {
  return new Request(`http://127.0.0.1:5173${path}`, {
    method: "POST",
    // The proxy in front overwrites X-Real-IP; X-Forwarded-For is client-controlled and ignored.
    headers: { "content-type": "application/json", "x-real-ip": ip, "x-forwarded-for": `198.18.0.1, 10.0.0.1` },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "s".repeat(40));
  vi.stubEnv("APP_URL", "http://127.0.0.1:5173");
  vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
  state.d1 = createTestD1().d1;
  state.users.clear();
  state.users.set("owner@example.com", {
    id: "u1",
    email: "owner@example.com",
    name: "Owner",
    passwordHash: await hashPassword("correct-password"),
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/register", () => {
  it("returns 403 while REGISTRATION_OPEN is unset", async () => {
    const res = await register(jsonRequest("/api/auth/register", { email: "a@b.co", password: "12345678" }));
    expect(res.status).toBe(403);
  });

  it("registers when REGISTRATION_OPEN=true", async () => {
    vi.stubEnv("REGISTRATION_OPEN", "true");
    const res = await register(jsonRequest("/api/auth/register", { email: "a@b.co", password: "12345678" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("uniseller_session=");
  });

  // Without a trusted IP the per-IP rule is skipped; the global ceiling must still hold.
  it.each([undefined, "none"])("throttles sign-ups globally when TRUSTED_IP_HEADER=%j", async (value) => {
    vi.stubEnv("REGISTRATION_OPEN", "true");
    vi.stubEnv("TRUSTED_IP_HEADER", value);
    const signUp = (i: number) =>
      register(jsonRequest("/api/auth/register", { email: `u${i}@b.co`, password: "12345678" }, `203.0.113.${i % 250}`));
    for (let i = 0; i < RATE_LIMITS.registerGlobal.limit; i++) {
      expect((await signUp(i)).status).toBe(200);
    }
    const blocked = await signUp(RATE_LIMITS.registerGlobal.limit);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 60_000);
});

describe("POST /api/auth/login throttle", () => {
  const wrong = { email: "owner@example.com", password: "wrong-password" };

  it("answers 429 with Retry-After after 10 failures from one IP+email", async () => {
    for (let i = 0; i < LOGIN_FAILURE_RULE.max; i++) {
      expect((await login(jsonRequest("/api/auth/login", wrong))).status).toBe(401);
    }
    const blocked = await login(
      jsonRequest("/api/auth/login", { email: "owner@example.com", password: "correct-password" }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps other IPs and other emails unaffected", async () => {
    for (let i = 0; i < LOGIN_FAILURE_RULE.max; i++) await login(jsonRequest("/api/auth/login", wrong));
    const otherIp = await login(jsonRequest("/api/auth/login", wrong, "198.51.100.9"));
    expect(otherIp.status).toBe(401);
    const otherEmail = await login(jsonRequest("/api/auth/login", { ...wrong, email: "x@example.com" }));
    expect(otherEmail.status).toBe(401);
  });

  it("resets the counter after a successful login", async () => {
    for (let i = 0; i < LOGIN_FAILURE_RULE.max - 1; i++) await login(jsonRequest("/api/auth/login", wrong));
    const ok = await login(
      jsonRequest("/api/auth/login", { email: "owner@example.com", password: "correct-password" }),
    );
    expect(ok.status).toBe(200);
    expect((await login(jsonRequest("/api/auth/login", wrong))).status).toBe(401);
  });

  it("parallel attempts from one IP+email: at most max reach password verification", async () => {
    const n = LOGIN_FAILURE_RULE.max + 8;
    const statuses = (
      await Promise.all(Array.from({ length: n }, () => login(jsonRequest("/api/auth/login", wrong))))
    ).map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(LOGIN_FAILURE_RULE.max);
    expect(statuses.filter((s) => s === 429)).toHaveLength(n - LOGIN_FAILURE_RULE.max);
  });

  it("per-email limit holds against IP rotation", async () => {
    let ip = 0;
    const next = () => jsonRequest("/api/auth/login", wrong, `198.51.100.${++ip}`);
    for (let i = 0; i < LOGIN_EMAIL_RULE.max; i++) expect((await login(next())).status).toBe(401);
    const blocked = await login(
      jsonRequest("/api/auth/login", { email: "owner@example.com", password: "correct-password" }, "192.0.2.1"),
    );
    expect(blocked.status).toBe(429);
    const otherEmail = await login(jsonRequest("/api/auth/login", { ...wrong, email: "x@example.com" }, "192.0.2.1"));
    expect(otherEmail.status).toBe(401);
  }, 60_000);
});

describe("rate limiter window", () => {
  const RULE = { max: 10, windowMs: 15 * 60_000 };
  it("opens again once the window has passed", async () => {
    let now = 1_000_000;
    const limiter = createRateLimiter(createTestD1().d1, () => now);
    for (let i = 0; i < RULE.max; i++) await limiter.hit("k", RULE);
    expect(await limiter.isLimited("k", RULE)).toBe(true);
    now += RULE.windowMs + 1;
    expect(await limiter.isLimited("k", RULE)).toBe(false);
    expect(await limiter.hit("k", RULE)).toBe(1);
  });

  it("fails open when the table is missing", async () => {
    const { d1, sqlite } = createTestD1();
    sqlite.exec("DROP TABLE rate_limits");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = createRateLimiter(d1);
    expect(await limiter.hit("k", RULE)).toBe(0);
    expect(await limiter.isLimited("k", RULE)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
