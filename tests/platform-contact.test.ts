import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./platform-d1";
import { CONTACT_SUBMIT_RULE } from "@/lib/rate-limit";

const state = vi.hoisted(() => ({ d1: null as unknown }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/db", () => ({
  getDatabase: () => state.d1,
  pingDatabase: async () => true,
}));

const { POST: submit } = await import("@/app/api/contact/route");

const validForm = {
  name: "Иван",
  email: "ivan@example.com",
  message: "Нужен сбор аудитории из тематических чатов",
  task: "other",
};

function contactRequest(body: unknown, ip = "203.0.113.7") {
  return new Request("http://127.0.0.1:5173/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("APP_URL", "http://127.0.0.1:5173");
  vi.stubEnv("CONTACT_BOT_TOKEN", "");
  vi.stubEnv("CONTACT_CHAT_ID", "");
  state.d1 = createTestD1().d1;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/contact rate limit", () => {
  it("answers 429 after the per-IP limit and keeps other IPs working", async () => {
    for (let i = 0; i < CONTACT_SUBMIT_RULE.max; i++) {
      expect((await submit(contactRequest(validForm))).status).toBe(200);
    }
    expect((await submit(contactRequest(validForm))).status).toBe(429);
    expect((await submit(contactRequest(validForm, "198.51.100.9"))).status).toBe(200);
  });
});

describe("POST /api/contact Telegram notify", () => {
  it("bounds the Telegram call with a timeout and still stores the request", async () => {
    vi.stubEnv("CONTACT_BOT_TOKEN", "bot-token");
    vi.stubEnv("CONTACT_CHAT_ID", "42");
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      // Simulates the timeout having fired while Telegram hangs.
      return AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );

    const res = await submit(contactRequest(validForm));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThan(0);
    expect(timeouts[0]).toBeLessThanOrEqual(10_000);
    const stored = await (state.d1 as ReturnType<typeof createTestD1>["d1"])
      .prepare("SELECT count(*) AS n FROM contact_messages")
      .bind()
      .first<{ n: number }>();
    expect(stored?.n).toBe(1);
  });
});
