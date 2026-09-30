import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripSessionMaterial } from "@/lib/processes/session-refresh";
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

const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "66666666-6666-4666-8666-666666666666";
const SECRET_MARKERS = ["zipBase64", "refreshedSession", "apiHash", "LEAKED-TDATA"];

/** Every worker answer carries a rebuilt session, as CreateNewSession does. */
function leakyWorker() {
  return mockWorker(() => ({
    ok: true,
    status: "active",
    join: "joined",
    messages: [],
    messageId: "1",
    chatId: "100",
    sessionRefreshed: true,
    refreshedSession: { zipBase64: "LEAKED-TDATA", apiId: 2040, apiHash: "tdesk-hash" },
    sessionRefreshError: "",
    apiId: 2040,
    apiHash: "tdesk-hash",
  }));
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  resetHarness();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await seedAccount(harness.sqlite!);
  insertRecord(harness.sqlite!, {
    id: GROUP_ID,
    owner: OWNER,
    kind: "group",
    data: { name: "G", url: "https://t.me/grp_one", accountId: ACCOUNT_ID, membership: "none", joinWanted: true },
  });
  insertRecord(harness.sqlite!, {
    id: LEAD_ID,
    owner: OWNER,
    kind: "lead",
    data: { name: "L", message: "hello there", senderId: "100", accountId: ACCOUNT_ID },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  errSpy.mockRestore();
});

describe("worker session material never reaches the client (finding 1)", () => {
  const actions: Record<string, unknown>[] = [
    { action: "join_group", id: GROUP_ID },
    { action: "scan_group", id: GROUP_ID, force: true },
    { action: "check_account", id: ACCOUNT_ID, rotateProxy: false },
    { action: "apply_account_profiles", ids: [ACCOUNT_ID], about: "x" },
    { action: "send_lead_message", id: LEAD_ID, mode: "dm", text: "hi" },
  ];
  for (const body of actions) {
    it(`${String(body.action)} response has no session material`, async () => {
      const calls = leakyWorker();
      const res = await POST(post(body));
      const text = await res.text();
      expect(calls.length).toBeGreaterThan(0);
      for (const marker of SECRET_MARKERS) expect(text).not.toContain(marker);
    });
  }
});

describe("stripSessionMaterial", () => {
  it("removes rebuilt session and api credentials, keeps the rest", () => {
    const out = stripSessionMaterial({
      ok: true,
      join: "joined",
      sessionRefreshed: true,
      refreshedSession: { zipBase64: "Z" },
      sessionRefreshError: "e",
      sessionString: "s",
      apiId: 1,
      apiHash: "h",
      zipBase64: "Z",
      twoFA: "pw",
    });
    expect(out).toEqual({ ok: true, join: "joined", sessionRefreshed: true });
  });

  it("passes non-objects through", () => {
    expect(stripSessionMaterial(null)).toBeNull();
  });
});
