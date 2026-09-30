import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "@/lib/locks";
import { harness, resetHarness } from "./helpers/workspace-harness";

const OWNERS = ["u1", "u2", "u3", "u4", "u5"];

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", () => ({
  ADMIN_USER_ID: "admin",
  getAdminEmail: () => "",
  readEnv: (name: string) => process.env[name],
  sessionCookieName: () => "sid",
  createSessionToken: async (s: { userId: string }) => `token-${s.userId}`,
}));
vi.mock("@/lib/users", () => ({
  listUserIdsForCron: async () =>
    ["u1", "u2", "u3", "u4", "u5"].map((userId) => ({ userId, email: "", name: userId })),
}));
vi.mock("@/lib/server-store", async () => {
  const h = await import("./helpers/workspace-harness");
  return { database: () => h.harness.db };
});

const { POST } = await import("@/app/api/cron/auto-rescan/route");

/** Fake /api/workspace: records which owner (cookie) each call was made for. */
function mockWorkspace(): { owner: string; action: string; body: Record<string, unknown> }[] {
  const calls: { owner: string; action: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const cookie = new Headers(init?.headers).get("cookie") || "";
      const owner = cookie.replace("sid=token-", "");
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const action = String(body.action || "boot");
      calls.push({ owner, action, body });
      if (action === "boot") return Response.json({ records: [] });
      if (action === "rescan_groups") return Response.json({ ok: true, groupIds: [], total: 0 });
      return Response.json({ ok: true });
    }),
  );
  return calls;
}

/** The route accepts only a dedicated CRON_SECRET of at least 32 characters. */
const CRON_SECRET = "cron-secret".padEnd(40, "c");
const SESSION_SECRET = "session-secret".padEnd(40, "s");

function cronRequest(token = CRON_SECRET) {
  return new Request("http://localhost/api/cron/auto-rescan", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
  });
}

const booted = (calls: { owner: string; action: string }[]) =>
  calls.filter((c) => c.action === "boot").map((c) => c.owner);

beforeEach(() => {
  resetHarness();
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("APP_URL", "https://crm.example.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cron auto-rescan (REQ-B7)", () => {
  it("walks all owners round-robin with a persisted cursor", async () => {
    const calls = mockWorkspace();
    await POST(cronRequest());
    const first = booted(calls);
    calls.length = 0;
    await POST(cronRequest());
    const second = booted(calls);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(OWNERS.length);
    expect(new Set([...first, ...second])).toEqual(new Set(OWNERS));
    expect(second[0]).not.toBe(first[0]);
  });

  it("skips while another tick holds the server-side lock", async () => {
    const calls = mockWorkspace();
    await acquireLock(harness.db!, { owner: "__system__", key: "cron:auto-rescan", ttlMs: 60_000 });
    const res = await POST(cronRequest());
    expect(await res.json()).toMatchObject({ skipped: true, reason: "busy" });
    expect(calls).toEqual([]);
  });

  it("bounds poll_dm_replies with a budget", async () => {
    const calls = mockWorkspace();
    await POST(cronRequest());
    const poll = calls.find((c) => c.action === "poll_dm_replies");
    expect(Number(poll?.body.budgetMs)).toBeGreaterThan(0);
    expect(Number(poll?.body.budgetMs)).toBeLessThanOrEqual(60_000);
  });

  it("requires CRON_SECRET in production", async () => {
    mockWorkspace();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(cronRequest(SESSION_SECRET))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    expect((await POST(cronRequest(SESSION_SECRET))).status).toBe(401);
  });

  // No fallback to SESSION_SECRET/TG_WORKER_TOKEN anywhere: npm run dev generates a CRON_SECRET.
  it("never accepts SESSION_SECRET as the cron bearer, outside production either", async () => {
    mockWorkspace();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(cronRequest(SESSION_SECRET))).status).toBe(503);
  });
});

describe("auto-rescan self-call origin", () => {
  function spoofedHost() {
    return new Request("http://evil.example/api/cron/auto-rescan", {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}`, host: "evil.example" },
      body: "{}",
    });
  }

  // Minted session cookies must go only to the app itself, never to a host taken from the request.
  it("sends minted sessions to APP_URL whatever the request host", async () => {
    mockWorkspace();
    await POST(spoofedHost());
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://crm.example.com");
      expect(new Headers(init?.headers).get("origin")).toBe("https://crm.example.com");
    }
  });

  it("refuses to run without APP_URL instead of trusting the request host", async () => {
    mockWorkspace();
    vi.stubEnv("APP_URL", "");
    const res = await POST(spoofedHost());
    expect(res.status).toBe(503);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
