import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appOrigin,
  internalAppOrigin,
  isSameOriginRequest,
  registrationOpen,
  validateEnv,
  type EnvReader,
} from "@/lib/env";
import { cookieSecure } from "@/lib/auth";

const VALID: Record<string, string> = {
  ENCRYPTION_KEY: "a".repeat(64),
  SESSION_SECRET: "s".repeat(32),
  TG_WORKER_TOKEN: "worker-token-".padEnd(40, "w"),
  CRON_SECRET: "cron-secret-".padEnd(40, "c"),
  APP_URL: "https://leads.example.com",
};

const reader =
  (vars: Record<string, string | undefined>): EnvReader =>
  (name) =>
    vars[name];

describe("validateEnv", () => {
  it("accepts a complete production env", () => {
    expect(validateEnv(reader(VALID))).toEqual({ ok: true, missing: [], invalid: [] });
  });

  it("lists missing variables by name", () => {
    const report = validateEnv(reader({ ...VALID, CRON_SECRET: undefined, TG_WORKER_TOKEN: "" }));
    expect(report.ok).toBe(false);
    expect(report.missing.sort()).toEqual(["CRON_SECRET", "TG_WORKER_TOKEN"]);
  });

  it("flags malformed ENCRYPTION_KEY, short SESSION_SECRET and non-http APP_URL", () => {
    const report = validateEnv(
      reader({
        ...VALID,
        ENCRYPTION_KEY: "z".repeat(64),
        SESSION_SECRET: "short",
        APP_URL: "ftp://x",
      }),
    );
    expect(report.invalid.sort()).toEqual(["APP_URL", "ENCRYPTION_KEY", "SESSION_SECRET"]);
  });

  it("flags TG_WORKER_TOKEN and CRON_SECRET shorter than 32 characters", () => {
    const report = validateEnv(reader({ ...VALID, TG_WORKER_TOKEN: "t".repeat(31), CRON_SECRET: "short" }));
    expect(report.invalid.sort()).toEqual(["CRON_SECRET", "TG_WORKER_TOKEN"]);
  });

  it("never echoes values", () => {
    const report = validateEnv(reader({ ...VALID, SESSION_SECRET: "leaky-secret" }));
    expect(JSON.stringify(report)).not.toContain("leaky-secret");
  });
});

describe("registrationOpen", () => {
  it("is closed by default and opens only on explicit true", () => {
    expect(registrationOpen(reader({}))).toBe(false);
    expect(registrationOpen(reader({ REGISTRATION_OPEN: "1" }))).toBe(false);
    expect(registrationOpen(reader({ REGISTRATION_OPEN: "TRUE" }))).toBe(true);
  });
});

describe("origin helpers", () => {
  it("uses the APP_URL origin behind a proxy", () => {
    const read = reader({ APP_URL: "https://leads.example.com/app" });
    expect(appOrigin(read)).toBe("https://leads.example.com");
    const req = new Request("http://127.0.0.1:5173/api/auth/login", {
      method: "POST",
      headers: { origin: "https://leads.example.com" },
    });
    expect(isSameOriginRequest(req, read)).toBe(true);
  });

  it("rejects a foreign origin", () => {
    const req = new Request("http://127.0.0.1:5173/api/auth/login", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(isSameOriginRequest(req, reader({ APP_URL: "https://leads.example.com" }))).toBe(false);
  });
});

describe("internalAppOrigin", () => {
  const PUBLIC = { APP_URL: "https://leads.example.com" };

  it("uses INTERNAL_APP_ORIGIN over APP_URL", () => {
    const read = reader({ ...PUBLIC, INTERNAL_APP_ORIGIN: "http://web:5173/", TG_WORKER_CRON_HTTP_HOSTS: "worker, WEB" });
    expect(internalAppOrigin(read)).toBe("http://web:5173");
  });

  it("allows plain http only for loopback or TG_WORKER_CRON_HTTP_HOSTS", () => {
    expect(internalAppOrigin(reader({ INTERNAL_APP_ORIGIN: "http://127.0.0.1:5173" }))).toBe("http://127.0.0.1:5173");
    expect(internalAppOrigin(reader({ INTERNAL_APP_ORIGIN: "http://localhost:5173" }))).toBe("http://localhost:5173");
    expect(internalAppOrigin(reader({ INTERNAL_APP_ORIGIN: "https://app.internal" }))).toBe("https://app.internal");
    expect(internalAppOrigin(reader({ ...PUBLIC, INTERNAL_APP_ORIGIN: "http://web:5173" }))).toBeNull();
  });

  it("fails closed on a malformed value instead of falling back", () => {
    expect(internalAppOrigin(reader({ ...PUBLIC, INTERNAL_APP_ORIGIN: "ftp://web" }))).toBeNull();
    expect(internalAppOrigin(reader({ ...PUBLIC, INTERNAL_APP_ORIGIN: "not a url" }))).toBeNull();
  });

  it("falls back to APP_URL when unset, null when neither is set", () => {
    expect(internalAppOrigin(reader(PUBLIC))).toBe("https://leads.example.com");
    expect(internalAppOrigin(reader({}))).toBeNull();
  });
});

describe("cookieSecure", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is secure for https APP_URL even outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(cookieSecure(reader({ APP_URL: "https://leads.example.com" }))).toBe(true);
  });

  it("is not secure for plain-http local dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(cookieSecure(reader({ APP_URL: "http://127.0.0.1:5173" }))).toBe(false);
  });

  it("is secure in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cookieSecure(reader({}))).toBe(true);
  });
});
