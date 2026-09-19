#!/usr/bin/env node
/**
 * Локальный one-shot: кабинет (vinext) + Telegram-воркер.
 * Воркер сам поднимается заново при падении — не нужно отдельно npm run tg:worker.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webPort = Number(process.env.PORT || 5173);
const workerPort = Number(process.env.TG_WORKER_PORT || 8790);
const extraArgs = process.argv.slice(2);

const children = new Set();
let shuttingDown = false;
let workerRestarts = 0;
let workerBackoffMs = 800;

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

function spawnLogged(name, command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
    ...opts,
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

async function isOurWorkerAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    return String(j?.service || "").includes("tg-worker") || j?.ok === true;
  } catch {
    return false;
  }
}

function startWorker() {
  if (shuttingDown) return;
  const script = join(root, "telegram-worker/src/server.mjs");
  if (!existsSync(script)) {
    log("telegram-worker/src/server.mjs не найден — кабинет без Telegram");
    return;
  }
  const py = join(root, "telegram-worker/.venv/bin/python");
  if (!existsSync(py)) {
    log(
      "нет telegram-worker/.venv — воркер может не стартовать. Один раз: cd telegram-worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
    );
  }
  log(`Telegram-воркер → http://127.0.0.1:${workerPort}`);
  const child = spawnLogged("tg", process.execPath, [script], {
    env: {
      TG_WORKER_PORT: String(workerPort),
      APP_URL: process.env.APP_URL || `http://127.0.0.1:${webPort}`,
    },
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    workerRestarts += 1;
    const wait = Math.min(15_000, workerBackoffMs * Math.min(workerRestarts, 8));
    log(
      `воркер упал (code=${code ?? "-"} signal=${signal ?? "-"}) — перезапуск через ${wait}мс (#${workerRestarts})`,
    );
    setTimeout(() => {
      workerBackoffMs = Math.min(8_000, Math.floor(workerBackoffMs * 1.4));
      startWorker();
    }, wait);
  });
  child.on("spawn", () => {
    workerBackoffMs = 800;
  });
}

function startWeb() {
  log(`кабинет → http://127.0.0.1:${webPort}`);
  const runner = join(root, "scripts/run-framework.mjs");
  const child = spawnLogged(
    "web",
    process.execPath,
    [runner, "dev", "--host", "127.0.0.1", "--port", String(webPort), ...extraArgs],
    {
      env: {
        PORT: String(webPort),
        TELEGRAM_WORKER_URL:
          process.env.TELEGRAM_WORKER_URL || `http://127.0.0.1:${workerPort}`,
      },
    },
  );
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(`кабинет остановился (code=${code ?? "-"} signal=${signal ?? "-"})`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("остановка…");
  for (const child of [...children]) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* */
    }
  }
  setTimeout(() => {
    for (const child of [...children]) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
    }
    process.exit(code);
  }, 1500).unref();
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => shutdown(0));
}

const workerFree = await portFree(workerPort);
let reuseWorker = false;
if (!workerFree) {
  if (await isOurWorkerAlive(workerPort)) {
    reuseWorker = true;
    log(`Telegram-воркер уже на :${workerPort} — переиспользую (не перезапускаю)`);
  } else {
    const okWorker = await waitPortFree(workerPort, "tg-worker");
    if (!okWorker) {
      log(
        `порт ${workerPort} занят чужим процессом — убейте его или смените TG_WORKER_PORT`,
      );
      process.exit(1);
    }
  }
}
const okWeb = await waitPortFree(webPort, "web");
if (!okWeb) {
  log(`порт ${webPort} всё ещё занят — убейте старый npm run dev или смените PORT`);
  process.exit(1);
}

if (!reuseWorker) startWorker();
startWeb();
log("готово: один npm run dev, Ctrl+C гасит кабинет" + (reuseWorker ? " (воркер оставлен жить)" : " и воркер"));
