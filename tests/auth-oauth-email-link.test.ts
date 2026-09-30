import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const EXISTING = { id: "user-1", email: "owner@example.com", name: "Owner" };

const users = vi.hoisted(() => ({
  findOAuthUser: vi.fn(),
  findUserByEmail: vi.fn(),
  linkOAuth: vi.fn(),
  upsertOAuthUser: vi.fn(),
}));
vi.mock("@/lib/users", () => users);

const { exchangeOAuthCode, signInOAuthUser, RegistrationClosedError } = await import("@/lib/oauth");

beforeEach(() => {
  users.findOAuthUser.mockResolvedValue(null);
  users.findUserByEmail.mockImplementation(async (email: string) =>
    email === EXISTING.email ? EXISTING : null,
  );
  users.linkOAuth.mockResolvedValue(undefined);
  users.upsertOAuthUser.mockImplementation(async (input: { email: string | null }) => ({
    id: "new-user",
    email: input.email,
    name: "New",
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const identity = (emailVerified: boolean) => ({
  provider: "google",
  providerUserId: "g-1",
  email: EXISTING.email,
  emailVerified,
  name: "Attacker",
});

describe("signInOAuthUser with registration closed", () => {
  it("links an existing user by a verified email", async () => {
    await expect(signInOAuthUser(identity(true))).resolves.toBe(EXISTING);
    expect(users.linkOAuth).toHaveBeenCalledWith(EXISTING.id, "google", "g-1");
  });

  it("refuses an unverified email instead of linking it", async () => {
    await expect(signInOAuthUser(identity(false))).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(users.findUserByEmail).not.toHaveBeenCalled();
    expect(users.linkOAuth).not.toHaveBeenCalled();
  });

  it("still signs in an already linked identity without email checks", async () => {
    users.findOAuthUser.mockResolvedValue(EXISTING);
    await expect(signInOAuthUser({ ...identity(false), provider: "vk" })).resolves.toBe(EXISTING);
    expect(users.linkOAuth).not.toHaveBeenCalled();
  });

  it("refuses an unknown identity with a verified but unknown email", async () => {
    await expect(
      signInOAuthUser({ ...identity(true), email: "stranger@example.com" }),
    ).rejects.toBeInstanceOf(RegistrationClosedError);
    expect(users.linkOAuth).not.toHaveBeenCalled();
  });
});

describe("signInOAuthUser with registration open", () => {
  beforeEach(() => vi.stubEnv("REGISTRATION_OPEN", "true"));

  it("passes a verified email on for linking", async () => {
    await signInOAuthUser(identity(true));
    expect(users.upsertOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: EXISTING.email }),
    );
  });

  it("drops an unverified email so upsert cannot link by it", async () => {
    await signInOAuthUser(identity(false));
    expect(users.upsertOAuthUser).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });
});

function stubProvider(token: Record<string, unknown>, profile: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (/token/.test(url)) return Response.json(token);
      return Response.json(profile);
    }),
  );
}

describe("exchangeOAuthCode email trust", () => {
  it.each([
    [true, true],
    [false, false],
    ["true", false],
    [undefined, false],
  ])("Google email_verified=%s -> emailVerified=%s", async (flag, expected) => {
    stubProvider(
      { access_token: "t" },
      { sub: "g-1", email: EXISTING.email, email_verified: flag, name: "A" },
    );
    const profile = await exchangeOAuthCode("https://app.test", "google", "code");
    expect(profile.emailVerified).toBe(expected);
  });

  it.each([
    ["someone@yandex.ru", true],
    ["someone@ya.ru", true],
    ["Someone@Yandex.COM", true],
    ["owner@example.com", false],
    ["owner@yandex.ru.evil.com", false],
  ])("Yandex default_email %s -> emailVerified=%s", async (email, expected) => {
    stubProvider({ access_token: "t" }, { id: "y-1", default_email: email });
    const profile = await exchangeOAuthCode("https://app.test", "yandex", "code");
    expect(profile.emailVerified).toBe(expected);
  });

  it("VK email is never trusted for linking", async () => {
    stubProvider(
      { access_token: "t", user_id: 7, email: EXISTING.email },
      { response: [{ id: 7, first_name: "V" }] },
    );
    const profile = await exchangeOAuthCode("https://app.test", "vk", "code");
    expect(profile.email).toBe(EXISTING.email);
    expect(profile.emailVerified).toBe(false);
  });
});
