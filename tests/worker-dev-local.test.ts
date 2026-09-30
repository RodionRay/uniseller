import { describe, expect, it } from "vitest";
import {
  createRestartPolicy,
  MAX_FAST_FAILURES,
  STABLE_UPTIME_MS,
  webEnvFor,
  workerHealthMatches,
} from "../scripts/dev-local.mjs";

describe("dev-local restart policy", () => {
  it("grows the delay on consecutive fast failures, capped", () => {
    const policy = createRestartPolicy({ baseMs: 1_000, maxMs: 3_000 });
    const delays = [1, 2, 3, 4].map(() => policy.onExit(500));
    expect(delays.map((d) => ("delayMs" in d ? d.delayMs : null))).toEqual([1_000, 1_600, 2_560, 3_000]);
  });

  it("resets the backoff only after a run of at least 60 s", () => {
    const policy = createRestartPolicy({ baseMs: 1_000 });
    policy.onExit(500);
    policy.onExit(500);
    expect(policy.onExit(STABLE_UPTIME_MS - 1)).toMatchObject({ attempt: 3 });
    expect(policy.onExit(STABLE_UPTIME_MS)).toEqual({ action: "restart", delayMs: 1_000, attempt: 1 });
    expect(policy.onExit(500)).toMatchObject({ attempt: 1 });
  });

  it("gives up after MAX_FAST_FAILURES consecutive fast failures", () => {
    const policy = createRestartPolicy();
    const decisions = Array.from({ length: MAX_FAST_FAILURES }, () => policy.onExit(100));
    expect(decisions.slice(0, -1).every((d) => d.action === "restart")).toBe(true);
    expect(decisions.at(-1)).toEqual({ action: "give-up", failures: MAX_FAST_FAILURES });
  });
});

describe("dev-local worker reuse", () => {
  const expected = { version: "abc123def456", appUrl: "http://127.0.0.1:5173" };

  it("reuses a worker with the same version and appUrl", () => {
    const health = { service: "uniseller-tg-worker", ...expected };
    expect(workerHealthMatches(health, expected)).toMatchObject({ ours: true, matches: true });
  });

  it("flags a stale worker (old code without version) for restart", () => {
    const health = { service: "uniseller-tg-worker", autoRescan: { appUrl: expected.appUrl } };
    expect(workerHealthMatches(health, expected)).toMatchObject({ ours: true, matches: false });
  });

  it("flags a worker pointed at another app URL", () => {
    const health = { service: "uniseller-tg-worker", version: expected.version, appUrl: "http://localhost:3000" };
    expect(workerHealthMatches(health, expected).matches).toBe(false);
  });

  it("does not treat a foreign service as ours", () => {
    expect(workerHealthMatches({ ok: true }, expected)).toEqual({ ours: false, matches: false });
  });
});

describe("dev-local web env", () => {
  it("points cron self-calls at this web's own port, not at .env APP_URL of another stand", () => {
    const env = webEnvFor({ secrets: { CRON_SECRET: "c" }, webPort: 5180, workerPort: 8791 });
    expect(env).toMatchObject({
      CRON_SECRET: "c",
      PORT: "5180",
      INTERNAL_APP_ORIGIN: "http://127.0.0.1:5180",
      TELEGRAM_WORKER_URL: "http://127.0.0.1:8791",
      // Miniflare reads process env only with this flag; without it .env APP_URL wins.
      CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
      X_LOCAL_EXPLORER: "false",
    });
  });

  it("keeps explicit overrides from the shell", () => {
    const env = webEnvFor({ secrets: {}, webPort: 5180, workerPort: 8791, internalOrigin: "http://web:5173", workerUrl: "http://tg:8790" });
    expect(env).toMatchObject({ INTERNAL_APP_ORIGIN: "http://web:5173", TELEGRAM_WORKER_URL: "http://tg:8790" });
  });
});
