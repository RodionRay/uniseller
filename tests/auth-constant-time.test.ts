import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarness } from "./helpers/workspace-harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const compareSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    timingSafeEqualBytes: (a: Buffer, b: Buffer) => {
      compareSpy.calls++;
      return real.timingSafeEqualBytes(a, b);
    },
  };
});
vi.mock("@/lib/users", () => ({
  listUserIdsForCron: async () => [],
  findOAuthUser: async () => null,
  findUserByEmail: async () => null,
  linkOAuth: async () => undefined,
  upsertOAuthUser: async () => null,
}));
vi.mock("@/lib/server-store", async () => {
  const h = await import("./helpers/workspace-harness");
  return { database: () => h.harness.db };
});

const { verifyTelegramAuth } = await import("@/lib/oauth");
const { POST: cronPost } = await import("@/app/api/cron/auto-rescan/route");

const BOT_TOKEN = "123456:test-bot-token";

function signTelegram(data: Record<string, string>): string {
  const check = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const key = createHash("sha256").update(BOT_TOKEN).digest();
  return createHmac("sha256", key).update(check).digest("hex");
}

function telegramPayload(): Record<string, string> {
  const data = {
    id: "42",
    first_name: "Ann",
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  return { ...data, hash: signTelegram(data) };
}

beforeEach(() => {
  resetHarness();
  compareSpy.calls = 0;
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Telegram login hash compare", () => {
  it("accepts a correct hash through the constant-time compare", async () => {
    await expect(verifyTelegramAuth(telegramPayload())).resolves.toEqual({ id: "42", name: "Ann" });
    expect(compareSpy.calls).toBe(1);
  });

  it("rejects a wrong hash of equal length", async () => {
    const data = telegramPayload();
    const flipped = (data.hash!.startsWith("0") ? "1" : "0") + data.hash!.slice(1);
    await expect(verifyTelegramAuth({ ...data, hash: flipped })).rejects.toThrow(/подпись/);
    expect(compareSpy.calls).toBe(1);
  });

  it("rejects a hash of different length", async () => {
    const data = telegramPayload();
    await expect(verifyTelegramAuth({ ...data, hash: data.hash!.slice(0, 10) })).rejects.toThrow(
      /подпись/,
    );
    await expect(verifyTelegramAuth({ ...data, hash: `${data.hash}00` })).rejects.toThrow(/подпись/);
  });
});

function cronRequest(authorization: string | null) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return new Request("http://localhost/api/cron/auto-rescan", { method: "POST", headers, body: "{}" });
}

describe("cron bearer compare", () => {
  it.each([
    ["missing header", null],
    ["wrong secret of equal length", "Bearer cron-secret-valuX"],
    ["shorter secret", "Bearer cron"],
    ["longer secret", "Bearer cron-secret-value-and-more"],
    ["wrong scheme", "Basic cron-secret-value"],
  ])("rejects %s with 401", async (_label, header) => {
    const res = await cronPost(cronRequest(header));
    expect(res.status).toBe(401);
  });

  it("rejects everything when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await cronPost(cronRequest("Bearer "));
    expect(res.status).toBe(401);
  });

  it("lets the right secret past the auth gate", async () => {
    const res = await cronPost(cronRequest("Bearer cron-secret-value"));
    expect(res.status).not.toBe(401);
  });
});
