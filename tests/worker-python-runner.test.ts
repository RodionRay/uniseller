import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_MAX_OUTPUT_BYTES,
  COLLECT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  NO_JSON_ERROR,
  accountKey,
  childEnv,
  createProcessLimiter,
  startPython,
  stdoutCapFor,
  sweepStaleWorkDirs,
} from "../telegram-worker/src/python-runner.mjs";
import { writeFakePython } from "./worker-fake-python";

let fake: { dir: string; script: string };
let tempRoot: string;

beforeEach(() => {
  fake = writeFakePython();
  tempRoot = mkdtempSync(join(tmpdir(), "worker-tmp-"));
  delete process.env.FAKE_PY_CRASH;
});

afterEach(() => {
  delete process.env.FAKE_PY_CRASH;
});

function run(payload: Record<string, unknown>, opts: Record<string, unknown> = {}) {
  return startPython({
    python: process.execPath,
    script: fake.script,
    cwd: fake.dir,
    payload,
    timeoutMs: 5_000,
    tempRoot,
    ...opts,
  });
}

describe("startPython", () => {
  it("returns the last JSON line and removes its work dir after exit", async () => {
    const h = run({ mode: "echo", action: "check" });
    const result = await h.result;
    await h.exited;
    expect(result).toMatchObject({ ok: true, action: "check" });
    expect(String(result.work)).toContain("uniseller-acc-");
    expect(existsSync(String(result.work))).toBe(false);
  });

  it("answers ok:false when the interpreter cannot be spawned", async () => {
    const h = run({ mode: "echo" }, { python: join(fake.dir, "no-such-python") });
    const result = await h.result;
    await h.exited;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Не удалось запустить Python/);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("survives a child that exits before reading a large stdin (EPIPE)", async () => {
    process.env.FAKE_PY_CRASH = "1";
    const h = run(
      { mode: "echo", blob: "a".repeat(4 * 1024 * 1024) },
      { envPassthrough: ["FAKE_PY_CRASH"] },
    );
    const result = await h.result;
    await h.exited;
    expect(result.ok).toBe(false);
    expect(result.error).toBe(NO_JSON_ERROR);
  });

  // stderr may carry paths or secrets: it goes to the log as an exception class only.
  it("answers a generic error without stderr when the child prints no JSON", async () => {
    const h = run({ mode: "no-json" });
    const error = String((await h.result).error);
    expect(error).toBe(NO_JSON_ERROR);
    expect(error).not.toMatch(/kaboom|Traceback/);
  });

  it("on timeout answers at once, SIGTERMs, and cleans the work dir", async () => {
    const h = run({ mode: "hang" }, { timeoutMs: 200, killGraceMs: 5_000 });
    const t0 = Date.now();
    expect(await h.result).toMatchObject({ ok: false, error: "Таймаут воркера" });
    await h.exited;
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("escalates to SIGKILL after the grace period when SIGTERM is ignored", async () => {
    const h = run({ mode: "hang-ignore-term" }, { timeoutMs: 300, killGraceMs: 300 });
    await h.result;
    const t0 = Date.now();
    await h.exited;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("caps stdout and kills a child that floods it", async () => {
    const h = run({ mode: "big" }, { maxStdoutBytes: 1024 * 1024 });
    const result = await h.result;
    await h.exited;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/больше 1048576 байт/);
  });
});

describe("startPython cancel", () => {
  it("answers at once, stops the child and removes the work dir", async () => {
    const h = run({ mode: "hang" }, { killGraceMs: 300 });
    await new Promise((r) => setTimeout(r, 100));
    h.cancel();
    expect(await h.result).toMatchObject({ ok: false, error: "Запрос отменён клиентом" });
    await h.exited;
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});

describe("childEnv", () => {
  const source = {
    PATH: "/bin",
    HOME: "/home/w",
    LC_ALL: "C.UTF-8",
    PYTHONPATH: "/opt/lib",
    SESSION_SECRET: "s",
    ENCRYPTION_KEY: "e",
    TG_WORKER_TOKEN: "t",
    CRON_SECRET: "c",
    GITHUB_CLIENT_SECRET: "g",
    ADMIN_PASSWORD_HASH: "h",
    CUSTOM: "x",
  };

  it("keeps only the interpreter allowlist plus the work dir", () => {
    expect(childEnv(source, "/tmp/w")).toEqual({
      PATH: "/bin",
      HOME: "/home/w",
      LC_ALL: "C.UTF-8",
      PYTHONPATH: "/opt/lib",
      PYTHONUNBUFFERED: "1",
      UNISELLER_WORK_DIR: "/tmp/w",
    });
  });

  it("adds explicitly passed-through names only", () => {
    expect(childEnv(source, "/tmp/w", ["CUSTOM"])).toHaveProperty("CUSTOM", "x");
  });
});

describe("stdoutCapFor", () => {
  it("keeps the configured cap for check_proxy", () => {
    expect(stdoutCapFor("check_proxy", {}, DEFAULT_MAX_OUTPUT_BYTES)).toBe(DEFAULT_MAX_OUTPUT_BYTES);
  });

  it("allows a re-packed session archive on account actions", () => {
    expect(stdoutCapFor("send", {}, DEFAULT_MAX_OUTPUT_BYTES)).toBe(ACCOUNT_MAX_OUTPUT_BYTES);
    const zipBase64 = "A".repeat(6 * 1024 * 1024);
    expect(stdoutCapFor("check", { zipBase64 })).toBeGreaterThan(2 * zipBase64.length);
  });

  it("gives collect the audience cap", () => {
    expect(stdoutCapFor("collect", {})).toBe(COLLECT_MAX_OUTPUT_BYTES);
  });
});

describe("createProcessLimiter", () => {
  function sleeper(trackDir: string, accountId: string, ms = 250) {
    return () => run({ mode: "sleep", trackDir, accountId, ms });
  }

  it("never runs more processes than the cap", async () => {
    const limiter = createProcessLimiter(2);
    const track = join(tempRoot, "track");
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((id) => limiter.run(`id:${id}`, sleeper(track, id))),
    );
    const peaks = results.map((r) => Number(r.running));
    expect(Math.max(...peaks)).toBeLessThanOrEqual(2);
    expect(limiter.stats()).toMatchObject({ active: 0, queued: 0 });
  });

  it("serialises requests of the same account", async () => {
    const limiter = createProcessLimiter(4);
    const track = join(tempRoot, "same");
    const results = await Promise.all(
      [1, 2, 3].map(() => limiter.run("id:same", sleeper(track, "same", 150))),
    );
    expect(results.map((r) => r.running)).toEqual([1, 1, 1]);
  });

  it("skips a queued request whose caller already went away", async () => {
    const limiter = createProcessLimiter(1);
    const abort = new AbortController();
    const first = limiter.run("id:x", sleeper(join(tempRoot, "c"), "x", 200));
    const second = limiter.run("id:y", sleeper(join(tempRoot, "c"), "y"), abort.signal);
    abort.abort();
    expect((await first).ok).toBe(true);
    expect(await second).toMatchObject({ ok: false, error: "Запрос отменён до запуска" });
  });
});

describe("createProcessLimiter abort of a started process", () => {
  it("kills it with killOnAbort and runs the next request of the account", async () => {
    const limiter = createProcessLimiter(1);
    const abort = new AbortController();
    const first = limiter.run("id:a", () => run({ mode: "hang" }, { killGraceMs: 300 }), abort.signal, {
      killOnAbort: true,
    });
    const second = limiter.run("id:a", () => run({ mode: "echo", action: "scan" }));
    await new Promise((r) => setTimeout(r, 100));
    abort.abort();
    expect(await first).toMatchObject({ ok: false, error: "Запрос отменён клиентом" });
    expect(await second).toMatchObject({ ok: true, action: "scan" });
  });

  it("leaves a started process running without killOnAbort", async () => {
    const limiter = createProcessLimiter(1);
    const abort = new AbortController();
    const first = limiter.run("id:a", sleeperEcho(), abort.signal);
    await new Promise((r) => setTimeout(r, 50));
    abort.abort();
    expect(await first).toMatchObject({ ok: true });
  });

  function sleeperEcho() {
    return () => run({ mode: "sleep", trackDir: join(tempRoot, "s"), accountId: "a", ms: 200 });
  }
});

describe("accountKey", () => {
  it("prefers accountId and falls back to a hash of the session archive", () => {
    expect(accountKey({ accountId: "acc1", zipBase64: "zz" })).toBe("id:acc1");
    expect(accountKey({ zipBase64: "zz" })).toMatch(/^zip:[0-9a-f]{32}$/);
    expect(accountKey({})).toBeNull();
  });
});

describe("sweepStaleWorkDirs", () => {
  it("removes only uniseller-acc-* dirs older than the threshold", () => {
    const now = Date.now();
    const old = join(tempRoot, "uniseller-acc-old");
    const fresh = join(tempRoot, "uniseller-acc-fresh");
    const other = join(tempRoot, "other-old");
    for (const d of [old, fresh, other]) mkdirSync(d);
    const past = new Date(now - 11 * 60_000);
    utimesSync(old, past, past);
    utimesSync(other, past, past);

    expect(sweepStaleWorkDirs({ root: tempRoot, now })).toBe(1);
    expect(readdirSync(tempRoot).sort()).toEqual(["other-old", "uniseller-acc-fresh"]);
  });
});
