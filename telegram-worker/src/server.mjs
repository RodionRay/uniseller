#!/usr/bin/env node
/**
 * HTTP-воркер Telegram (check / join / scan …): один Python-процесс на запрос.
 * Слушает TG_WORKER_HOST (по умолчанию 127.0.0.1; в Docker — 0.0.0.0); требует TG_WORKER_TOKEN (≥32 символов).
 * Плюс круглосуточный автообход лидов → POST APP_URL/api/cron/auto-rescan (Bearer CRON_SECRET).
 * Guard/очередь: worker-app.mjs; Python-процесс: python-runner.mjs.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import {
  createPythonRunner,
  createWorkerServer,
  cronSecretProblem,
  cronTargetAllowed,
  purgeStaleWorkDirs,
  resolveConfig,
} from "./worker-app.mjs";
import { nextCatchUpDelayMs } from "./auto-rescan-policy.mjs";
import { computeWorkerVersion } from "./version.mjs";

const SERVICE = "uniseller-tg-worker";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO = join(ROOT, "..");

function loadDotEnv() {
  const path = join(REPO, ".env");
  if (process.env.TG_WORKER_SKIP_DOTENV === "1" || !existsSync(path)) return;
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch (e) {
    console.warn("[tg-worker] .env не прочитан:", e.message || e);
  }
}

/** SQLite files hold sealed secrets and PII; keep them owner-only (best-effort). */
function tightenDataFilePerms() {
  const dir = join(REPO, process.env.DATA_DIR || ".data");
  try {
    for (const name of readdirSync(dir)) {
      if (/\.sqlite/.test(name)) chmodSync(join(dir, name), 0o600);
    }
  } catch {
    /* no data dir yet */
  }
}

loadDotEnv();

let config;
try {
  config = resolveConfig(process.env);
} catch (e) {
  console.error(`[tg-worker] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const PY = process.env.TG_WORKER_PYTHON || join(ROOT, ".venv/bin/python");
const SCRIPT = process.env.TG_WORKER_SCRIPT || join(__dirname, "check_account.py");
const VERSION = computeWorkerVersion(__dirname);
const SWEEP_EVERY_MS = 5 * 60_000;

const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";
const CRON_SECRET_PROBLEM = cronSecretProblem(CRON_SECRET);
/** Как часто дергать cron (сам API режет по autoRescanMinutes на группу). */
const AUTO_RESCAN_EVERY_MS = Math.max(
  60_000,
  Number(process.env.AUTO_RESCAN_EVERY_MS || 5 * 60_000),
);
/** Согласовано с cron TICK_BUDGET 210с + запас. */
const AUTO_RESCAN_FETCH_MS = 270_000;
const BUSY_STALE_MS = 6 * 60_000;

process.on("unhandledRejection", (reason) => {
  console.error("[tg-worker] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[tg-worker] uncaughtException:", err);
});

let autoRescanBusy = false;
let autoRescanBusyAt = 0;
let lastAutoRescanAt = "";
let lastAutoRescanResult = null;
let catchUpTimer = null;
let catchUpDelayMs = null;

function scheduleCatchUp(delayMs) {
  if (delayMs === null || catchUpTimer) return;
  catchUpTimer = setTimeout(() => {
    catchUpTimer = null;
    void tickAutoRescan(false);
  }, delayMs);
}

function planCatchUp(tick) {
  catchUpDelayMs = nextCatchUpDelayMs({
    ...tick,
    prevDelayMs: catchUpDelayMs,
    intervalMs: AUTO_RESCAN_EVERY_MS,
  });
  scheduleCatchUp(catchUpDelayMs);
}

async function tickAutoRescan(force = false) {
  if (autoRescanBusy) {
    // Не снимаем busy вручную — иначе параллельный fetch. Только catch-up.
    if (Date.now() - autoRescanBusyAt >= BUSY_STALE_MS) {
      console.warn("[auto-rescan] busy долго — ставлю catch-up, не форсю второй тик");
      scheduleCatchUp(12_000);
    }
    return { skipped: true, reason: "busy" };
  }
  // Logged once at startup; repeating it every tick would only bury it.
  if (CRON_SECRET_PROBLEM) return { skipped: true, reason: "no_secret" };
  if (!cronTargetAllowed(APP_URL, config.cronHttpHosts)) {
    console.warn(
      "[auto-rescan] APP_URL не https, не loopback и не в TG_WORKER_CRON_HTTP_HOSTS — секрет не отправляю",
    );
    return { skipped: true, reason: "insecure_app_url" };
  }
  autoRescanBusy = true;
  autoRescanBusyAt = Date.now();
  const url = `${APP_URL}/api/cron/auto-rescan${force ? "?force=1" : ""}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(AUTO_RESCAN_FETCH_MS),
    });
    const data = await res.json().catch(() => ({}));
    lastAutoRescanAt = new Date().toISOString();
    lastAutoRescanResult = { status: res.status, ...data };
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.warn("[auto-rescan] fail", res.status, data?.error || data, `${ms}ms`);
    } else if (!data.skipped) {
      console.log(
        `[auto-rescan] scanned=${data.scanned || 0} added=${data.added || 0} joined=${data.joined || 0} due=${data.due || 0} more=${!!data.more} ${ms}ms`,
      );
    }
    planCatchUp({ ok: res.ok, data });
    return data;
  } catch (e) {
    const ms = Date.now() - t0;
    lastAutoRescanAt = new Date().toISOString();
    lastAutoRescanResult = { ok: false, error: String(e.message || e), ms };
    const aborted = /aborted|timeout/i.test(String(e.message || e));
    console.warn(
      aborted
        ? `[auto-rescan] timeout ${ms}ms — следующий тик продолжит`
        : `[auto-rescan] error ${e.message || e} ${ms}ms`,
    );
    planCatchUp({ ok: false, aborted });
    return lastAutoRescanResult;
  } finally {
    autoRescanBusy = false;
  }
}

const runPython = createPythonRunner({
  python: PY,
  script: SCRIPT,
  cwd: ROOT,
  killGraceMs: config.killGraceMs,
  maxStdoutBytes: config.maxStdoutBytes,
  envPassthrough: config.pythonEnv,
});

const server = createWorkerServer(config, {
  runPython,
  tickAutoRescan,
  info: () => ({ version: VERSION, appUrl: APP_URL }),
  autoRescanStatus: () => ({
    everyMs: AUTO_RESCAN_EVERY_MS,
    fetchMs: AUTO_RESCAN_FETCH_MS,
    appUrl: APP_URL,
    busy: autoRescanBusy,
    lastAt: lastAutoRescanAt,
    last: lastAutoRescanResult,
  }),
});

async function isOurWorkerOn(port) {
  try {
    const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const j = await res.json();
    return j?.service === SERVICE;
  } catch {
    return false;
  }
}

server.on("error", async (err) => {
  if (err.code === "EADDRINUSE") {
    if (await isOurWorkerOn(config.port)) {
      console.log(`[tg-worker] на ${config.host}:${config.port} уже работает воркер — выхожу`);
      process.exit(0);
    }
    console.error(
      `[tg-worker] порт ${config.port} занят чужим процессом — освободите его или смените TG_WORKER_PORT`,
    );
    process.exit(1);
  }
  console.error("[tg-worker] ошибка сервера:", err);
  process.exit(1);
});

async function sweep() {
  const removed = await purgeStaleWorkDirs();
  if (removed) console.log(`[tg-worker] удалено ${removed} старых каталогов uniseller-acc-*`);
}

if (CRON_SECRET_PROBLEM) {
  console.error(
    `[tg-worker] WARNING: ${CRON_SECRET_PROBLEM} (need >= 32 chars, same value as the web app) — auto-rescan is DISABLED until it is set and the worker restarts.`,
  );
}

tightenDataFilePerms();

server.listen(config.port, config.host, () => {
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : config.port;
  console.log(
    `tg-worker http://${config.host}:${port} version=${VERSION} python×${config.maxConcurrency} queue=${config.maxQueue}`,
  );
  console.log(
    `auto-rescan → ${APP_URL}/api/cron/auto-rescan every ${Math.round(AUTO_RESCAN_EVERY_MS / 60000)}m`,
  );
  void sweep();
  setInterval(() => void sweep(), SWEEP_EVERY_MS).unref();
  if (process.env.TG_WORKER_AUTO_RESCAN === "0") return;
  // Первый тик через 45с (дать приложению подняться), далее по интервалу
  setTimeout(() => {
    void tickAutoRescan(false);
  }, 45_000);
  setInterval(() => {
    void tickAutoRescan(false);
  }, AUTO_RESCAN_EVERY_MS);
});
