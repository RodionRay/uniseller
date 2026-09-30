import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { floodWaitSeconds } from "@/lib/telegram-accounts";
import { insertRecord, readData } from "./helpers/d1-fake";
import {
  ACCOUNT_ID,
  OWNER,
  harness,
  mockWorker,
  post,
  resetHarness,
  seedAccount,
} from "./helpers/workspace-harness";

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

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const AUDIENCE_ID = "44444444-4444-4444-8444-444444444444";

function seedInvite(): void {
  const sqlite = harness.sqlite!;
  insertRecord(sqlite, {
    id: AUDIENCE_ID,
    owner: OWNER,
    kind: "audience_task",
    data: { url: "", accountIds: [ACCOUNT_ID], status: "completed" },
  });
  insertRecord(sqlite, {
    id: "55555555-5555-4555-8555-555555555555",
    owner: OWNER,
    kind: "audience_user",
    data: { taskId: AUDIENCE_ID, userId: "100", username: "client100" },
  });
  insertRecord(sqlite, {
    id: TASK_ID,
    owner: OWNER,
    kind: "invite_task",
    data: {
      audienceTaskId: AUDIENCE_ID,
      targetUrl: "https://t.me/target",
      accountIds: [ACCOUNT_ID],
      status: "running",
      batchSize: 1,
      pauseFromSec: 1,
      pauseToSec: 1,
    },
  });
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  resetHarness();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await seedAccount(harness.sqlite!);
});
afterEach(() => {
  vi.unstubAllGlobals();
  errSpy.mockRestore();
});

describe("floodWaitSeconds", () => {
  it("reads every worker FloodWait shape", () => {
    expect(floodWaitSeconds({ status: "flood", waitSec: 120 })).toBe(120);
    expect(floodWaitSeconds({ status: "floodwait", floodWait: 300 })).toBe(300);
    expect(floodWaitSeconds({ ok: false, flood: true, waitSec: 45 })).toBe(45);
    expect(floodWaitSeconds({ ok: true, status: "active" })).toBe(0);
    expect(floodWaitSeconds({ ok: true, waitSec: 30 })).toBe(0);
  });
});

describe("FloodWait puts the account on cooldown", () => {
  it.each([
    ["legacy floodwait/floodWait", { ok: false, status: "floodwait", floodWait: 300 }],
    ["new flood/waitSec", { ok: false, status: "floodwait", floodWait: 300, flood: true, waitSec: 300 }],
  ])("tick_invite with %s", async (_label, answer) => {
    mockWorker((path) => (path === "/invite-users" ? answer : { ok: true, join: "joined" }));
    seedInvite();

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    const acc = readData(harness.sqlite!, ACCOUNT_ID)!;
    expect(acc.status).toBe("active");
    expect(acc.cooldownReason).toBe("flood");
    expect(Date.parse(String(acc.cooldownUntil))).toBeGreaterThan(Date.now() + 200_000);
  });

  it("tick_mailing send with flood:true/waitSec", async () => {
    mockWorker(() => ({ ok: false, status: "floodwait", flood: true, waitSec: 300, error: "FloodWait" }));
    insertRecord(harness.sqlite!, {
      id: AUDIENCE_ID,
      owner: OWNER,
      kind: "audience_task",
      data: { url: "https://t.me/src", accountIds: [ACCOUNT_ID], status: "completed" },
    });
    insertRecord(harness.sqlite!, {
      id: "55555555-5555-4555-8555-555555555555",
      owner: OWNER,
      kind: "audience_user",
      data: { taskId: AUDIENCE_ID, userId: "100", username: "client100" },
    });
    insertRecord(harness.sqlite!, {
      id: TASK_ID,
      owner: OWNER,
      kind: "mailing_task",
      data: {
        name: "M",
        sourceKind: "audience",
        audienceTaskId: AUDIENCE_ID,
        contentMode: "template",
        templateText: "Hi",
        deliveryMode: "dm",
        accountIds: [ACCOUNT_ID],
        status: "running",
        batchPerTick: 1,
        dailyLimitEnabled: false,
        pauseFromSec: 1,
        pauseToSec: 1,
      },
    });

    await POST(post({ action: "tick_mailing", id: TASK_ID }));

    const acc = readData(harness.sqlite!, ACCOUNT_ID)!;
    expect(acc.cooldownReason).toBe("flood");
    expect(Date.parse(String(acc.cooldownUntil))).toBeGreaterThan(Date.now() + 200_000);
  });
});
