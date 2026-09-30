#!/usr/bin/env node
/**
 * Локальный one-shot: кабинет (vinext) + Telegram-воркер.
 * Оба процесса поднимаются заново при падении (backoff, сброс после 60 с аптайма,
 * стоп после серии быстрых падений). Живой воркер на порту переиспользуется,
 * только если его /health совпадает по версии кода и APP_URL.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { computeWorkerVersion } from "../telegram-worker/src/version.mjs";
import { workerReuseVerdict } from "./dev-worker-reuse.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_SERVICE = "uniseller-tg-worker";

/** Values from .env (not exported to process.env — the apps read .env themselves). */
function readDotEnv() {
  const path = join(root, ".env");
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * The worker refuses to start without TG_WORKER_TOKEN and cron needs CRON_SECRET.
 * Missing ones get a random per-run value shared by web and worker (never written to .env).
 */
function resolveSharedSecrets() {
  const fileEnv = readDotEnv();
  const secrets = {};
  const generated = [];
  for (const key of ["TG_WORKER_TOKEN", "CRON_SECRET"]) {
    const value = process.env[key] || fileEnv[key];
    if (!process.env[key] && fileEnv[key]) {
      secrets[key] = value;
      continue;
    }
    if (value) {
      secrets[key] = value;
    } else {
      secrets[key] = randomBytes(32).toString("hex");
      generated.push(key);
    }
  }
  return { secrets, generated };
}

/** SQLite files hold sealed secrets and PII; keep them owner-only (best-effort). */
function tightenDataFilePerms() {
  const dir = join(root, process.env.DATA_DIR || readDotEnv().DATA_DIR || ".data");
  try {
    for (const name of readdirSync(dir)) {
      if (/\.sqlite/.test(name)) chmodSync(join(dir, name), 0o600);
    }
  } catch {
    /* no data dir yet */
  }
}

export const STABLE_UPTIME_MS = 60_000;
export const MAX_FAST_FAILURES = 10;

/**
 * Политика перезапуска: пауза растёт с каждым быстрым падением подряд,
 * процесс, проживший ≥ stableMs, обнуляет счётчик; после maxFastFailures — стоп.
 */
export function createRestartPolicy({
  baseMs = 800,
  maxMs = 15_000,
  stableMs = STABLE_UPTIME_MS,
  maxFastFailures = MAX_FAST_FAILURES,
} = {}) {
  let fastFailures = 0;
  return {
    onExit(uptimeMs) {
      if (uptimeMs >= stableMs) {
        fastFailures = 0;
        return { action: "restart", delayMs: baseMs, attempt: 1 };
      }
      fastFailures += 1;
      if (fastFailures >= maxFastFailures) return { action: "give-up", failures: fastFailures };
      const delayMs = Math.min(maxMs, Math.round(baseMs * 1.6 ** (fastFailures - 1)));
      return { action: "restart", delayMs, attempt: fastFailures };
    },
  };
}

/** Можно ли переиспользовать уже запущенный воркер. */
export function workerHealthMatches(health, expected) {
  if (health?.service !== WORKER_SERVICE) return { ours: false, matches: false };
  const appUrl = String(health.appUrl ?? health.autoRescan?.appUrl ?? "");
  const matches = health.version === expected.version && appUrl === expected.appUrl;
  return { ours: true, matches, version: health.version, appUrl };
}

function log(msg) {
  process.stdout.write(`[dev] ${msg}\n`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

async function waitPortFree(port, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await portFree(port)) return true;
    if (i === 0) log(`${label}: порт ${port} занят — жду освобождения…`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function fetchHealth(port, token) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1200),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function listeningPids(port) {
  try {
    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * Env for the web process. Its cron self-calls (auto-rescan) go to INTERNAL_APP_ORIGIN, else to .env APP_URL —
 * which on a second stand (PORT=5180) points at another app on :5173, so the cron was a silent 200 no-op.
 * Pin the origin to this web's own port; Miniflare sees it only with CLOUDFLARE_INCLUDE_PROCESS_ENV
 * (process env overrides empty .env values; .env has no INTERNAL_APP_ORIGIN).
 * @param {{ secrets: Record<string, string>, webPort: number, workerPort: number, internalOrigin?: string, workerUrl?: string }} opts
 */
export function webEnvFor({ secrets, webPort, workerPort, internalOrigin, workerUrl }) {
  return {
    ...secrets,
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    // miniflare Local Explorer = raw SQL on D1 for anyone reaching the port.
    X_LOCAL_EXPLORER: "false",
    PORT: String(webPort),
    INTERNAL_APP_ORIGIN: internalOrigin || `http://127.0.0.1:${webPort}`,
    TELEGRAM_WORKER_URL: workerUrl || `http://127.0.0.1:${workerPort}`,
  };
}

async function main() {
  const webPort = Number(process.env.PORT || 5173);
  const workerPort = Number(process.env.TG_WORKER_PORT || 8790);
  const extraArgs = process.argv.slice(2);
  const workerAppUrl = (process.env.APP_URL || `http://127.0.0.1:${webPort}`).replace(/\/$/, "");
  const children = new Set();
  let shuttingDown = false;
  const { secrets: sharedSecrets, generated: generatedSecrets } = resolveSharedSecrets();

  function spawnLogged(name, command, args, opts = {}) {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...opts.env },
    });
    children.add(child);
    const tag = `[${name}] `;
    const pipe = (stream, out) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += String(chunk);
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) out.write(tag + line + "\n");
        }
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on("exit", () => children.delete(child));
    return child;
  }

  /** Запуск с автоперезапуском по createRestartPolicy. */
  function supervise(label, start, onGiveUp) {
    const policy = createRestartPolicy();
    const launch = () => {
      if (shuttingDown) return;
      const startedAt = Date.now();
      const child = start();
      if (!child) return;
      child.on("exit", async (code, signal) => {
        if (shuttingDown) return;
        const decision = policy.onExit(Date.now() - startedAt);
        if (decision.action === "give-up") {
          log(
            `${label}: ${decision.failures} быстрых падений подряд (<${STABLE_UPTIME_MS / 1000}с) — прекращаю перезапуски, смотрите лог выше`,
          );
          onGiveUp();
          return;
        }
        if (label === "воркер" && code === 0 && (await fetchHealth(workerPort, sharedSecrets.TG_WORKER_TOKEN))?.service === WORKER_SERVICE) {
          log(`воркер: порт ${workerPort} уже занят другим нашим воркером — переиспользую его`);
          return;
        }
        log(
          `${label} упал (code=${code ?? "-"} signal=${signal ?? "-"}) — перезапуск через ${decision.delayMs}мс (#${decision.attempt})`,
        );
        setTimeout(launch, decision.delayMs);
      });
    };
    launch();
  }

  function startWorker() {
    const script = join(root, "telegram-worker/src/server.mjs");
    if (!existsSync(script)) {
      log("telegram-worker/src/server.mjs не найден — кабинет без Telegram");
      return null;
    }
    if (!existsSync(join(root, "telegram-worker/.venv/bin/python"))) {
      log(
        "нет telegram-worker/.venv — воркер ответит ошибкой на действия Telegram. Один раз: cd telegram-worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt (Python 3.10–3.11)",
      );
    }
    log(`Telegram-воркер → http://127.0.0.1:${workerPort}`);
    return spawnLogged("tg", process.execPath, [script], {
      env: { ...sharedSecrets, TG_WORKER_PORT: String(workerPort), APP_URL: workerAppUrl },
    });
  }

  function startWeb() {
    log(`кабинет → http://127.0.0.1:${webPort}`);
    const runner = join(root, "scripts/run-framework.mjs");
    return spawnLogged(
      "web",
      process.execPath,
      [runner, "dev", "--hostname", "127.0.0.1", "--port", String(webPort), ...extraArgs],
      {
        env: webEnvFor({
          secrets: sharedSecrets,
          webPort,
          workerPort,
          internalOrigin: process.env.INTERNAL_APP_ORIGIN,
          workerUrl: process.env.TELEGRAM_WORKER_URL,
        }),
      },
    );
  }

  function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("остановка…");
    for (const child of [...children]) child.kill("SIGTERM");
    setTimeout(() => {
      for (const child of [...children]) child.kill("SIGKILL");
      process.exit(code);
    }, 1500).unref();
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => shutdown(0));
  }

  /** true — переиспользуем живой воркер; false — надо запустить свой. */
  async function prepareWorkerPort() {
    if (await portFree(workerPort)) return false;
    const expected = {
      version: computeWorkerVersion(join(root, "telegram-worker/src")),
      appUrl: workerAppUrl,
    };
    const health = await fetchHealth(workerPort, sharedSecrets.TG_WORKER_TOKEN);
    const check = workerHealthMatches(health, expected);
    // Only an authorised /health carries autoRescan: without it the worker holds another token.
    const probe = !check.ours ? "foreign" : health?.autoRescan ? "ours" : "stale";
    if (check.matches && workerReuseVerdict(probe, generatedSecrets) === "reuse") {
      log(`Telegram-воркер уже на :${workerPort} (версия ${check.version}) — переиспользую`);
      return true;
    }
    if (check.ours) {
      log(
        `воркер на :${workerPort} устарел (версия ${check.version || "?"} ≠ ${expected.version} или appUrl ${check.appUrl || "?"} ≠ ${expected.appUrl}, или с другими TG_WORKER_TOKEN/CRON_SECRET) — перезапускаю`,
      );
      for (const pid of listeningPids(workerPort)) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (e) {
          log(`не удалось остановить pid ${pid}: ${e.message}`);
        }
      }
    }
    if (!(await waitPortFree(workerPort, "tg-worker"))) {
      log(`порт ${workerPort} занят чужим процессом — убейте его или смените TG_WORKER_PORT`);
      process.exit(1);
    }
    return false;
  }

  const reuseWorker = await prepareWorkerPort();
  if (!(await waitPortFree(webPort, "web"))) {
    log(`порт ${webPort} всё ещё занят — убейте старый npm run dev или смените PORT`);
    process.exit(1);
  }

  if (generatedSecrets.length) {
    log(`${generatedSecrets.join(", ")} нет в .env — сгенерированы на этот запуск`);
  }
  tightenDataFilePerms();
  if (!reuseWorker) supervise("воркер", startWorker, () => {});
  supervise("кабинет", startWeb, () => shutdown(1));
  log(
    "готово: один npm run dev, Ctrl+C гасит кабинет" +
      (reuseWorker ? " (воркер оставлен жить)" : " и воркер"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
