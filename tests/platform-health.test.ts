import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ up: true }));
vi.mock("@/lib/db", () => ({ pingDatabase: async () => db.up }));

const { GET } = await import("@/app/api/health/route");

const VALID_ENV: Record<string, string> = {
  ENCRYPTION_KEY: "b".repeat(64),
  SESSION_SECRET: "s".repeat(32),
  TG_WORKER_TOKEN: "worker-token",
  CRON_SECRET: "cron-secret",
  APP_URL: "https://leads.example.com",
  TELEGRAM_WORKER_URL: "http://worker:8790",
};

type HealthBody = {
  ok: boolean;
  db: string;
  config: { ok: boolean; missing: string[]; invalid: string[] };
  worker?: string;
};
const readBody = async (res: Response) => (await res.json()) as HealthBody;

const request = (query = "") => new Request(`http://127.0.0.1:5173/api/health${query}`);

beforeEach(() => {
  db.up = true;
  for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("is 200 with db, config and worker up", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      db: "up",
      config: { ok: true, missing: [], invalid: [] },
      worker: "up",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://worker:8790/health", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("is 503 and names missing env without values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(request());
    expect(res.status).toBe(503);
    const body = await readBody(res);
    expect(body.config.missing).toEqual(["CRON_SECRET"]);
    expect(JSON.stringify(body)).not.toContain("worker-token");
  });

  it("is 503 when the worker is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect((await readBody(res)).worker).toBe("down");
  });

  it("scope=self skips the worker probe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(request("?scope=self"));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("worker");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is 503 when D1 is down", async () => {
    db.up = false;
    const res = await GET(request("?scope=self"));
    expect(res.status).toBe(503);
    expect((await readBody(res)).db).toBe("down");
  });
});
