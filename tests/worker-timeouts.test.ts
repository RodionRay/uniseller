import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { WORKER_REPLY_MARGIN_MS, appTimeoutForWorker, workerTimeoutMs } from "@/lib/processes/worker-timeouts";
import { acquireLock } from "@/lib/locks";
import { timeoutForAction } from "../telegram-worker/src/worker-app.mjs";
import { ACCOUNT_ID, OWNER, harness, mockWorker, post, resetHarness, seedAccount } from "./helpers/workspace-harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", async () => {
  const h = await import("./helpers/workspace-harness");
  return {
    readEnv: (name: string) => process.env[name],
    getSessionUser: async () =>
      h.harness.userId ? { userId: h.harness.userId, email: "o@example.test", displayName: "O" } : null,
  };
});
vi.mock("@/lib/server-store", async () => {
  const h = await import("./helpers/workspace-harness");
  return { database: () => h.harness.db, seal: h.fakeSeal, unseal: h.fakeUnseal };
});
vi.mock("@/lib/staff", async () => {
  const h = await import("./helpers/workspace-harness");
  const types = await import("@/lib/staff-types");
  return { ...types, resolveWorkspaceContext: async () => h.harness.ctx };
});

const { POST } = await import("@/app/api/workspace/route");

/** The worker's own timeout table, so a worker change breaks this test, not prod. */
function workerSourceTimeout(action: string): number {
  return timeoutForAction(action);
}

describe("worker timeout contract", () => {
  it.each([
    ["/check-account", "check"],
    ["/check-proxy", "check_proxy"],
    ["/upload-photo", "upload_photo"],
    ["/collect-audience", "collect"],
    ["/invite-users", "invite"],
    ["/send-message", "send"],
  ])("%s mirrors the worker and adds the reply margin", (path, action) => {
    expect(workerTimeoutMs(path)).toBe(workerSourceTimeout(action));
    expect(appTimeoutForWorker(path)).toBeGreaterThanOrEqual(workerSourceTimeout(action) + 5_000);
  });

  it("margin covers the worker kill grace", () => {
    expect(WORKER_REPLY_MARGIN_MS).toBeGreaterThanOrEqual(5_000);
  });
});

describe("route passes the contract timeout to fetch", () => {
  let timeoutSpy: MockInstance<(ms: number) => AbortSignal>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    resetHarness();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    await seedAccount(harness.sqlite!);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    timeoutSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("check_account waits longer than the worker check timeout", async () => {
    mockWorker(() => ({ ok: true, status: "active" }));
    await POST(post({ action: "check_account", id: ACCOUNT_ID, rotateProxy: false }));
    const used = timeoutSpy.mock.calls.map((c) => Number(c[0]));
    expect(Math.min(...used.filter((ms) => ms > 2_000))).toBeGreaterThanOrEqual(33_000);
  });

  it("keeps the account lease when the app gives up before the worker", async () => {
    mockWorker(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await POST(post({ action: "poll_dm_replies" }));
    const again = await acquireLock(harness.db!, { owner: OWNER, key: `account:${ACCOUNT_ID}`, ttlMs: 1_000 });
    expect(again).toBeNull();
  });
});
