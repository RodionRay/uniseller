import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-sqlite";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db }));

import { hashPassword } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";

const ADMIN = "boss@example.com";
const ENV_KEYS = ["SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD_HASH"];
const saved: Record<string, string | undefined> = {};
let ipSeq = 0;

function post(
  handler: (req: Request) => Promise<Response>,
  path: string,
  body: Record<string, string>,
  ip = `198.51.100.${++ipSeq % 250}`,
) {
  return handler(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

function sessionSubject(res: Response): string | null {
  const m = /uniseller_session=([^.;]+)\./.exec(res.headers.get("set-cookie") || "");
  if (!m) return null;
  return (JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as { sub: string }).sub;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.SESSION_SECRET = "s".repeat(48);
  process.env.ADMIN_EMAIL = ADMIN;
  process.env.ADMIN_PASSWORD_HASH = await hashPassword("admin-password-1");
  await createUser({
    email: ADMIN,
    passwordHash: await hashPassword("db-password-1"),
    name: "Shadow",
  });
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("admin cannot be shadowed by a DB user", () => {
  it("rejects the DB password for the admin email", async () => {
    const res = await post(login, "/api/auth/login", { email: ADMIN, password: "db-password-1" });
    expect(res.status).toBe(401);
  });

  it("accepts the env admin credentials", async () => {
    const res = await post(login, "/api/auth/login", { email: ADMIN, password: "admin-password-1" });
    expect(res.status).toBe(200);
    expect(sessionSubject(res)).toBe("admin");
  });

  it("refuses to register the admin email", async () => {
    await db.prepare("DELETE FROM users WHERE email=?").bind(ADMIN).run();
    const res = await post(register, "/api/auth/register", {
      email: "Boss@Example.com",
      password: "long-enough-1",
    });
    expect(res.status).toBe(409);
    expect(sessionSubject(res)).toBeNull();
  });
});

describe("login and register rate limits", () => {
  it("limits attempts per email across IPs", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await post(login, "/api/auth/login", {
        email: "target@example.com",
        password: `guess-${i}`,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("limits attempts per IP across emails", async () => {
    const ip = "203.0.113.7";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await post(
        login,
        "/api/auth/login",
        { email: `spray-${i}@example.com`, password: "x" },
        ip,
      );
      statuses.push(res.status);
    }
    expect(statuses[19]).toBe(401);
    expect(statuses[20]).toBe(429);
    expect(
      (await post(login, "/api/auth/login", { email: "a@b.co", password: "x" }, ip)).headers.get(
        "retry-after",
      ),
    ).toMatch(/^\d+$/);
  });

  it("ignores X-Forwarded-For when keying by IP", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 20; i++) {
      await post(login, "/api/auth/login", { email: `xff-${i}@example.com`, password: "x" }, ip);
    }
    const res = await login(
      new Request("https://app.test/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": ip,
          "x-forwarded-for": "192.0.2.123",
        },
        body: JSON.stringify({ email: "xff-last@example.com", password: "x" }),
      }),
    );
    expect(res.status).toBe(429);
  });

  it("limits registrations per IP", async () => {
    const ip = "203.0.113.50";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(
        register,
        "/api/auth/register",
        { email: `bad-${i}`, password: "x" },
        ip,
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
