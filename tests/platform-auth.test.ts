import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./platform-d1";
import { LOGIN_FAILURE_RULE, createRateLimiter } from "@/lib/rate-limit";

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
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "s".repeat(40));
  vi.stubEnv("APP_URL", "http://127.0.0.1:5173");
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
});

describe("rate limiter window", () => {
  it("opens again once the window has passed", async () => {
    let now = 1_000_000;
    const limiter = createRateLimiter(createTestD1().d1, () => now);
    for (let i = 0; i < LOGIN_FAILURE_RULE.max; i++) await limiter.hit("k", LOGIN_FAILURE_RULE);
    expect(await limiter.isLimited("k", LOGIN_FAILURE_RULE)).toBe(true);
    now += LOGIN_FAILURE_RULE.windowMs + 1;
    expect(await limiter.isLimited("k", LOGIN_FAILURE_RULE)).toBe(false);
    expect(await limiter.hit("k", LOGIN_FAILURE_RULE)).toBe(1);
  });

  it("fails open when the table is missing", async () => {
    const { d1, sqlite } = createTestD1();
    sqlite.exec("DROP TABLE rate_limits");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = createRateLimiter(d1);
    expect(await limiter.hit("k", LOGIN_FAILURE_RULE)).toBe(0);
    expect(await limiter.isLimited("k", LOGIN_FAILURE_RULE)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
