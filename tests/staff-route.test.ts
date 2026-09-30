import { afterEach, describe, expect, it, vi } from "vitest";

const ctx = { userId: "o1", ownerId: "o1", isOwner: true, role: "owner", access: {} };
const failures = { resolve: null as Error | null };

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", () => ({
  getSessionUser: async () => ({ userId: "o1", email: "o@example.test", displayName: "O" }),
}));
vi.mock("@/lib/users", () => ({ findUserById: async () => null }));
vi.mock("@/lib/staff", async () => {
  const types = await import("@/lib/staff-types");
  return {
    ...types,
    resolveWorkspaceContext: async () => {
      if (failures.resolve) throw failures.resolve;
      return ctx;
    },
    listMembers: async () => [],
    listPendingInvites: async () => [],
  };
});

const { GET, POST } = await import("@/app/api/staff/route");

afterEach(() => {
  failures.resolve = null;
  vi.restoreAllMocks();
});

function post(body: unknown) {
  return new Request("http://localhost/api/staff", { method: "POST", body: JSON.stringify(body) });
}

describe("staff API errors stay JSON (REQ-B6)", () => {
  it("invalid input answers 400 JSON instead of a framework 500", async () => {
    const res = await POST(post({ action: "revoke_invite", id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("an unexpected failure answers 503 JSON and is logged with action and user", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failures.resolve = new Error("db down");
    const res = await POST(post({ action: "clear_all" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(spy).toHaveBeenCalledWith(
      "[staff]",
      expect.objectContaining({ action: "clear_all", userId: "o1" }),
    );
  });

  it("GET failure answers 503 JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    failures.resolve = new Error("db down");
    const res = await GET(new Request("http://localhost/api/staff"));
    expect(res.status).toBe(503);
  });
});
