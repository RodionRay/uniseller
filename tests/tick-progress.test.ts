import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moscowDayKey } from "@/lib/telegram-accounts";
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
const RECIPIENTS = ["client100", "client101"];

function seedAudience(): void {
  insertRecord(harness.sqlite!, {
    id: AUDIENCE_ID,
    owner: OWNER,
    kind: "audience_task",
    data: { url: "", accountIds: [ACCOUNT_ID], status: "completed" },
  });
  RECIPIENTS.forEach((username, i) =>
    insertRecord(harness.sqlite!, {
      id: `5555555${i}-5555-4555-8555-555555555555`,
      owner: OWNER,
      kind: "audience_user",
      data: { taskId: AUDIENCE_ID, userId: String(100 + i), username },
    }),
  );
}

function seedMailing(): void {
  seedAudience();
  insertRecord(harness.sqlite!, {
    id: TASK_ID,
    owner: OWNER,
    kind: "mailing_task",
    data: {
      name: "M",
      sourceKind: "audience",
      audienceTaskId: AUDIENCE_ID,
      contentMode: "template",
      templateText: "Hello",
      deliveryMode: "dm",
      accountIds: [ACCOUNT_ID],
      status: "running",
      batchPerTick: 2,
      dailyLimitEnabled: false,
      pauseFromSec: 1,
      pauseToSec: 1,
    },
  });
}

function makeRunnable(): void {
  harness
    .sqlite!.prepare(
      "UPDATE records SET data=json_set(data,'$.status','running','$.nextAt','','$.error','') WHERE id=?",
    )
    .run(TASK_ID);
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

describe("tick_mailing persists progress per send", () => {
  it("pause mid-tick then resume never DMs the same recipient twice", async () => {
    const sentTo: string[] = [];
    mockWorker(async (path, body) => {
      if (path !== "/send-message") return { ok: true };
      sentTo.push(String(body.senderUsername));
      if (sentTo.length === 1) await POST(post({ action: "pause_mailing", id: TASK_ID }));
      return { ok: true, messageId: "1", chatId: String(body.senderId) };
    });
    seedMailing();

    await POST(post({ action: "tick_mailing", id: TASK_ID }));
    expect(readData(harness.sqlite!, TASK_ID)).toMatchObject({ status: "paused", sentTotal: 1 });

    makeRunnable();
    await POST(post({ action: "tick_mailing", id: TASK_ID }));

    expect(sentTo.sort()).toEqual(RECIPIENTS);
  });

  it("an error mid-tick keeps the keys already delivered", async () => {
    const sentTo: string[] = [];
    let failNext = false;
    mockWorker((path, body) => {
      if (path !== "/send-message") return { ok: true };
      if (failNext) throw new Error("worker exploded");
      sentTo.push(String(body.senderUsername));
      failNext = true;
      return { ok: true, messageId: "1", chatId: String(body.senderId) };
    });
    seedMailing();

    await POST(post({ action: "tick_mailing", id: TASK_ID }));
    const afterError = readData(harness.sqlite!, TASK_ID)!;
    expect(afterError.status).toBe("error");
    expect(afterError.deliveredKeys).toHaveLength(1);
    expect(afterError.sentTotal).toBe(1);

    failNext = false;
    makeRunnable();
    await POST(post({ action: "tick_mailing", id: TASK_ID }));

    expect(sentTo.sort()).toEqual(RECIPIENTS);
  });
});

describe("tick_invite keeps progress when paused mid-tick", () => {
  it("counts invites done before the pause", async () => {
    mockWorker(async (path) => {
      if (path !== "/invite-users") return { ok: true, join: "joined" };
      await POST(post({ action: "pause_invite", id: TASK_ID }));
      return { ok: true, results: [{ userId: "100", username: "client100", ok: true }] };
    });
    seedAudience();
    insertRecord(harness.sqlite!, {
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

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    expect(readData(harness.sqlite!, TASK_ID)).toMatchObject({ status: "paused", done: 1, invitedToday: 1 });
  });
});

describe("tick_invite with resolve-blind accounts", () => {
  const OTHER_ID = "66666666-6666-4666-8666-666666666666";
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  function seedInvite(accountIds: string[]): void {
    seedAudience();
    insertRecord(harness.sqlite!, {
      id: TASK_ID,
      owner: OWNER,
      kind: "invite_task",
      data: {
        audienceTaskId: AUDIENCE_ID,
        targetUrl: "https://t.me/target",
        accountIds,
        status: "running",
        batchSize: 1,
        pauseFromSec: 1,
        pauseToSec: 1,
      },
    });
  }

  function blindAccount(until = inHours(6)): void {
    harness
      .sqlite!.prepare("UPDATE records SET data=json_set(data,'$.resolveBlindUntil',?) WHERE id=?")
      .run(until, ACCOUNT_ID);
  }

  it("schedules an all-blind farm until the earliest blindness ends without calling the worker", async () => {
    const calls = mockWorker(() => ({ ok: true }));
    const until = inHours(6);
    blindAccount(until);
    seedInvite([ACCOUNT_ID]);

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    expect(readData(harness.sqlite!, TASK_ID)).toMatchObject({ status: "scheduled", nextAt: until });
    expect(calls).toEqual([]);
  });

  it("wakes at a flood cooldown that ends before the blindness", async () => {
    mockWorker(() => ({ ok: true }));
    blindAccount();
    const floodEnd = inHours(0.2);
    await seedAccount(harness.sqlite!, OTHER_ID, { cooldownUntil: floodEnd, cooldownReason: "flood" });
    seedInvite([ACCOUNT_ID, OTHER_ID]);

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    expect(readData(harness.sqlite!, TASK_ID)).toMatchObject({ status: "scheduled", nextAt: floodEnd });
  });

  it("wakes at the quota reset when it comes before the blindness", async () => {
    mockWorker(() => ({ ok: true }));
    blindAccount(inHours(30));
    await seedAccount(harness.sqlite!, OTHER_ID, { memberInvitesToday: 40, memberInviteDay: moscowDayKey() });
    seedInvite([ACCOUNT_ID, OTHER_ID]);

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    const task = readData(harness.sqlite!, TASK_ID)!;
    expect(task.status).toBe("scheduled");
    expect(Date.parse(String(task.nextAt))).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);
  });

  it("marks the account blind when the worker reports it cannot resolve the target", async () => {
    mockWorker((path) =>
      path === "/join-group" ? { ok: false, accountBlind: true, error: "ResolveUsername" } : { ok: true },
    );
    seedInvite([ACCOUNT_ID]);

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    const until = Date.parse(String(readData(harness.sqlite!, ACCOUNT_ID)!.resolveBlindUntil));
    expect(until).toBeGreaterThan(Date.now());
  });
});
