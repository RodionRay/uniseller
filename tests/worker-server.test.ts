import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeWorkerVersion } from "../telegram-worker/src/version.mjs";
import { writeFakePython } from "./worker-fake-python";

const SERVER = join(__dirname, "../telegram-worker/src/server.mjs");
const running: ChildProcess[] = [];
const foreign: Server[] = [];

afterEach(() => {
  for (const c of running.splice(0)) c.kill("SIGKILL");
  for (const s of foreign.splice(0)) s.close();
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

type Worker = { port: number; tmp: string; child: ChildProcess; exit: Promise<number | null> };

async function startWorker(env: Record<string, string> = {}, port?: number): Promise<Worker> {
  const fake = writeFakePython();
  const tmp = mkdtempSync(join(tmpdir(), "worker-srv-"));
  const p = port ?? (await freePort());
  const childEnv = {
    PATH: process.env.PATH ?? "",
    TMPDIR: tmp,
    TG_WORKER_PORT: String(p),
    TG_WORKER_SKIP_DOTENV: "1",
    TG_WORKER_AUTO_RESCAN: "0",
    TG_WORKER_PYTHON: process.execPath,
    TG_WORKER_SCRIPT: fake.script,
    ...env,
  } as unknown as NodeJS.ProcessEnv;
  const child = spawn(process.execPath, [SERVER], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  running.push(child);
  const exit = new Promise<number | null>((r) => child.on("exit", (code: number | null) => r(code)));
  return { port: p, tmp, child, exit };
}

async function waitHealthy(port: number): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch {
      /* ещё не слушает */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("worker did not become healthy");
}

async function post(port: number, path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("tg-worker server", () => {
  it("answers ok:false and stays up when python cannot be spawned", async () => {
    const w = await startWorker({ TG_WORKER_PYTHON: "/nonexistent/python" });
    await waitHealthy(w.port);
    const r = await post(w.port, "/check-account", { zipBase64: "a" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(await waitHealthy(w.port)).toMatchObject({ ok: true });
  });

  it("stays up when python dies before reading stdin", async () => {
    const w = await startWorker({ FAKE_PY_CRASH: "1" });
    await waitHealthy(w.port);
    const r = await post(w.port, "/join-group", { blob: "b".repeat(3_000_000) });
    expect(r.body.ok).toBe(false);
    expect(await waitHealthy(w.port)).toMatchObject({ ok: true });
  });

  it("runs the action and leaves no uniseller-acc-* dirs behind", async () => {
    const w = await startWorker();
    await waitHealthy(w.port);
    const r = await post(w.port, "/scan-group", { mode: "echo" });
    expect(r.body).toMatchObject({ ok: true, action: "scan" });
    expect(readdirSync(w.tmp).filter((n) => n.startsWith("uniseller-acc-"))).toEqual([]);
  });

  it("times out, answers, and cleans the work dir", async () => {
    const w = await startWorker({ TG_WORKER_TIMEOUT_MS: "300", TG_WORKER_KILL_GRACE_MS: "300" });
    await waitHealthy(w.port);
    const r = await post(w.port, "/send-message", { mode: "hang-ignore-term" });
    expect(r.body).toMatchObject({ ok: false, error: "Таймаут воркера" });
    await new Promise((res) => setTimeout(res, 800));
    expect(readdirSync(w.tmp).filter((n) => n.startsWith("uniseller-acc-"))).toEqual([]);
  });

  it("caps concurrent python processes at TG_WORKER_CONCURRENCY", async () => {
    const w = await startWorker({ TG_WORKER_CONCURRENCY: "2" });
    await waitHealthy(w.port);
    const trackDir = join(w.tmp, "track");
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((accountId) =>
        post(w.port, "/inbox-dms", { mode: "sleep", ms: 300, trackDir, accountId }),
      ),
    );
    expect(Math.max(...results.map((r) => Number(r.body.running)))).toBeLessThanOrEqual(2);
  });

  it("caps stdout at 1 MB", async () => {
    const w = await startWorker();
    await waitHealthy(w.port);
    const r = await post(w.port, "/scan-group", { mode: "big" });
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toMatch(/байт/);
  });

  it("exposes the version dev-local computes and appUrl in /health", async () => {
    const w = await startWorker({ APP_URL: "http://app.test/" });
    const h = await waitHealthy(w.port);
    expect(h).toMatchObject({ service: "uniseller-tg-worker", appUrl: "http://app.test" });
    expect(h.version).toBe(computeWorkerVersion(join(__dirname, "../telegram-worker/src")));
  });
});

describe("tg-worker port conflicts", () => {
  it("exits 0 when its own worker already owns the port", async () => {
    const first = await startWorker();
    await waitHealthy(first.port);
    const second = await startWorker({}, first.port);
    expect(await second.exit).toBe(0);
  });

  it("exits 1 when a foreign process owns the port", async () => {
    const port = await freePort();
    const s = createServer((_req, res) => res.end("nope"));
    foreign.push(s);
    await new Promise<void>((r) => s.listen(port, "127.0.0.1", () => r()));
    const w = await startWorker({}, port);
    expect(await w.exit).toBe(1);
  });
});

describe("tg-worker auth", () => {
  it("refuses to start in production without a token", async () => {
    const w = await startWorker({ NODE_ENV: "production" });
    expect(await w.exit).toBe(1);
  });

  it("starts in production without a token only with TG_WORKER_ALLOW_NO_TOKEN=1", async () => {
    const w = await startWorker({ NODE_ENV: "production", TG_WORKER_ALLOW_NO_TOKEN: "1" });
    await waitHealthy(w.port);
    expect((await post(w.port, "/scan-group", { mode: "echo" })).status).toBe(200);
  });

  it("requires the bearer token when one is set", async () => {
    const w = await startWorker({ TG_WORKER_TOKEN: "s3cret" });
    await waitHealthy(w.port);
    expect((await post(w.port, "/scan-group", { mode: "echo" })).status).toBe(401);
    expect((await post(w.port, "/scan-group", { mode: "echo" }, "wrong")).status).toBe(401);
    expect((await post(w.port, "/scan-group", { mode: "echo" }, "s3cret")).status).toBe(200);
  });

  it("allows unauthenticated calls outside production when no token is set", async () => {
    const w = await startWorker();
    await waitHealthy(w.port);
    expect((await post(w.port, "/scan-group", { mode: "echo" })).status).toBe(200);
  });
});
