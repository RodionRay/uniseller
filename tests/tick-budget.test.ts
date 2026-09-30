import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertRecord } from "./helpers/d1-fake";
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

let offsetMs = 0;
beforeEach(async () => {
  resetHarness();
  offsetMs = 0;
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + offsetMs);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await seedAccount(harness.sqlite!);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every worker call "takes" longer than the tick budget. */
const SLOW_CALL_MS = 101_000;

describe("tick budget", () => {
  it("tick_mailing stops the batch after the budget and asks for more at once", async () => {
    const sentTo: string[] = [];
    mockWorker((path, body) => {
      if (path !== "/send-message") return { ok: true };
      offsetMs += SLOW_CALL_MS;
      sentTo.push(String(body.senderUsername));
      return { ok: true, messageId: "1", chatId: String(body.senderId) };
    });
    seedMailing();

    const res = await POST(post({ action: "tick_mailing", id: TASK_ID }));
    const body = (await res.json()) as { more?: boolean; task: { nextAt: string } };

    expect(sentTo).toHaveLength(1);
    expect(body.more).toBe(true);
    expect(body.task.nextAt).toBe("");
    await POST(post({ action: "tick_mailing", id: TASK_ID }));
    expect(sentTo.sort()).toEqual(RECIPIENTS);
  });

  it("tick_invite hands the invite call to the next tick when joins used the budget", async () => {
    const calls = mockWorker((path) => {
      if (path === "/join-group") {
        offsetMs += SLOW_CALL_MS;
        return { ok: true, join: "joined" };
      }
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

    const res = await POST(post({ action: "tick_invite", id: TASK_ID }));
    const body = (await res.json()) as { more?: boolean; task: { nextAt: string; status: string } };

    expect(body.more).toBe(true);
    expect(body.task).toMatchObject({ nextAt: "", status: "running" });
    expect(calls).not.toContain("/invite-users");
  });

  it("check_accounts checks a slice per call and returns a cursor", async () => {
    const ids = [
      "a1111111-1111-4111-8111-111111111111",
      "a2222222-2222-4222-8222-222222222222",
    ];
    for (const aid of ids) await seedAccount(harness.sqlite!, aid);
    mockWorker(() => {
      offsetMs += SLOW_CALL_MS;
      return { ok: true, status: "active" };
    });

    const first = (await (await POST(post({ action: "check_accounts", concurrency: 1 }))).json()) as {
      checked: number;
      more: boolean;
      cursor: number;
    };
    expect(first).toMatchObject({ checked: 1, more: true, cursor: 1 });

    const rest = (await (
      await POST(post({ action: "check_accounts", concurrency: 1, cursor: first.cursor }))
    ).json()) as { checked: number; more: boolean };
    expect(rest.checked).toBe(1);
    expect(rest.more).toBe(true);
  });
});
