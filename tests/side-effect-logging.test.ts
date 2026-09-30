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
const PROXY_ID = "77777777-7777-4777-8777-777777777777";
const BOT_TOKEN = "123456:SECRET-BOT-TOKEN";

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetHarness();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function logged(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

function seedInvite(): void {
  insertRecord(harness.sqlite!, {
    id: AUDIENCE_ID,
    owner: OWNER,
    kind: "audience_task",
    data: { url: "", accountIds: [ACCOUNT_ID], status: "completed" },
  });
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
    },
  });
}

describe("side-effect failures are logged with context", () => {
  it("corrupt rows skipped by a tick are reported with action and id, not their content", async () => {
    mockWorker(() => ({ ok: true, join: "joined", results: [] }));
    await seedAccount(harness.sqlite!);
    seedInvite();
    insertRecord(harness.sqlite!, {
      id: "bad-user",
      owner: OWNER,
      kind: "audience_user",
      data: "{broken PRIVATE-NOTE",
    });

    await POST(post({ action: "tick_invite", id: TASK_ID }));

    expect(logged(warnSpy)).toContain("bad-user");
    expect(logged(warnSpy)).toContain("tick_invite");
    expect(logged(warnSpy)).not.toContain("PRIVATE-NOTE");
  });

  it("an unreadable proxy password is logged, not silently sent empty", async () => {
    mockWorker(() => ({ ok: true, status: "active" }));
    insertRecord(harness.sqlite!, {
      id: PROXY_ID,
      owner: OWNER,
      kind: "proxy",
      data: { host: "1.2.3.4", port: 1080, protocol: "socks5", status: "active" },
      secret: "sealed:someone-else:pw",
    });
    await seedAccount(harness.sqlite!, ACCOUNT_ID, { proxyId: PROXY_ID });

    await POST(post({ action: "check_account", id: ACCOUNT_ID, rotateProxy: false }));

    expect(logged(errSpy)).toContain("proxy_password_unseal");
    expect(logged(errSpy)).toContain(PROXY_ID);
  });

  it("a failed Telegram notification is logged without the bot token", async () => {
    mockWorker((path) =>
      path.includes("/sendMessage") ? { ok: false, description: "Unauthorized" } : { ok: true },
    );
    insertRecord(harness.sqlite!, {
      id: "settings-1",
      owner: OWNER,
      kind: "settings",
      data: { notifyEnabled: true, notifyBotToken: BOT_TOKEN, notifyChatId: "42" },
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
        accountIds: [],
        status: "paused",
      },
    });

    await POST(post({ action: "start_mailing", id: TASK_ID }));
    await vi.waitFor(() => expect(logged(errSpy)).toContain("notify_mailing"));

    expect(logged(errSpy)).toContain("Unauthorized");
    expect(logged(errSpy)).not.toContain("SECRET-BOT-TOKEN");
  });
});
