#!/usr/bin/env node
/**
 * HTTP-воркер Telegram (check / join / scan …): один Python-процесс на запрос.
 * Слушает TG_WORKER_HOST (по умолчанию 127.0.0.1; в Docker — 0.0.0.0).
 * Плюс круглосуточный автообход лидов → POST APP_URL/api/cron/auto-rescan
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import {
  accountKey,
  createProcessLimiter,
  DEFAULT_MAX_OUTPUT_BYTES,
  startPython,
  stdoutCapFor,
  sweepStaleWorkDirs,
} from "./python-runner.mjs";
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
loadDotEnv();

const PRODUCTION = process.env.NODE_ENV === "production";
const PY = process.env.TG_WORKER_PYTHON || join(ROOT, ".venv/bin/python");
const SCRIPT = process.env.TG_WORKER_SCRIPT || join(__dirname, "check_account.py");
const HOST = process.env.TG_WORKER_HOST || "127.0.0.1";
const PORT = Number(process.env.TG_WORKER_PORT || 8790);
const TOKEN = process.env.TG_WORKER_TOKEN || "";
const ALLOW_NO_TOKEN = !PRODUCTION || process.env.TG_WORKER_ALLOW_NO_TOKEN === "1";
const VERSION = computeWorkerVersion(__dirname);
const CONCURRENCY = Number(process.env.TG_WORKER_CONCURRENCY || 4);
const MAX_STDOUT_BYTES = Number(
  process.env.TG_WORKER_MAX_OUTPUT_BYTES || DEFAULT_MAX_OUTPUT_BYTES,
);
/** Доп. имена переменных для Python-процесса (кроме базового allowlist в python-runner). */
const PYTHON_ENV_PASSTHROUGH = (process.env.TG_WORKER_PYTHON_ENV || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const KILL_GRACE_MS = Number(process.env.TG_WORKER_KILL_GRACE_MS || 5_000);
const SWEEP_EVERY_MS = 5 * 60_000;

if (!TOKEN && !ALLOW_NO_TOKEN) {
  console.error(
    "[tg-worker] NODE_ENV=production без TG_WORKER_TOKEN — отказ запуска (или TG_WORKER_ALLOW_NO_TOKEN=1)",
  );
  process.exit(1);
}

const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(
  /\/$/,
  "",
);
const CRON_SECRET =
  process.env.CRON_SECRET ||
  (PRODUCTION ? "" : process.env.TG_WORKER_TOKEN || process.env.SESSION_SECRET || "");
/** Как часто дергать cron (сам API режет по autoRescanMinutes на группу). */
const AUTO_RESCAN_EVERY_MS = Math.max(
  60_000,
  Number(process.env.AUTO_RESCAN_EVERY_MS || 5 * 60_000),
);

process.on("unhandledRejection", (reason) => {
  console.error("[tg-worker] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[tg-worker] uncaughtException:", err);
});

const limiter = createProcessLimiter(CONCURRENCY);

function readBody(req, limit = 6_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function authOk(req) {
  if (!TOKEN) return ALLOW_NO_TOKEN;
  const got = Buffer.from(req.headers.authorization || "");
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

let autoRescanBusy = false;
let autoRescanBusyAt = 0;
let lastAutoRescanAt = "";
let lastAutoRescanResult = null;
let catchUpTimer = null;
let catchUpDelayMs = null;
/** Согласовано с cron TICK_BUDGET 210с + запас. */
const AUTO_RESCAN_FETCH_MS = 270_000;
const BUSY_STALE_MS = 6 * 60_000;

function planCatchUp(tick) {
  catchUpDelayMs = nextCatchUpDelayMs({
    ...tick,
    prevDelayMs: catchUpDelayMs,
    intervalMs: AUTO_RESCAN_EVERY_MS,
  });
  if (catchUpDelayMs === null || catchUpTimer) return;
  catchUpTimer = setTimeout(() => {
    catchUpTimer = null;
    void tickAutoRescan(false);
  }, catchUpDelayMs);
}

async function tickAutoRescan(force = false) {
  if (autoRescanBusy) {
    if (Date.now() - autoRescanBusyAt < BUSY_STALE_MS) {
      return { skipped: true, reason: "busy" };
    }
    console.warn("[auto-rescan] снимаю залипший busy-lock");
    autoRescanBusy = false;
  }
  if (!CRON_SECRET) {
    console.warn("[auto-rescan] нет CRON_SECRET — пропуск");
    return { skipped: true, reason: "no_secret" };
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

const ROUTES = {
  "/check-account": "check",
  "/check-proxy": "check_proxy",
  "/join-group": "join",
  "/scan-group": "scan",
  "/collect-audience": "collect",
  "/invite-users": "invite",
  "/send-message": "send",
  "/inbox-dms": "inbox",
  "/update-profile": "update_profile",
  "/upload-photo": "upload_photo",
};

/**
 * Только чтение: если приложение ушло, процесс можно убить. Отправку/инвайт/вступление
 * не прерываем — Telegram мог уже выполнить действие; слот освободит их таймаут.
 */
const KILL_ON_ABORT = new Set(["check", "check_proxy", "scan", "collect", "inbox"]);

function timeoutFor(action) {
  if (process.env.TG_WORKER_TIMEOUT_MS) return Number(process.env.TG_WORKER_TIMEOUT_MS);
  if (action === "check") return 28_000;
  if (action === "check_proxy") return 18_000;
  if (action === "upload_photo" || action === "collect" || action === "invite") return 180_000;
  return 120_000;
}

function runAction(payload, signal) {
  const action = payload.action;
  return limiter.run(
    action === "check_proxy" ? null : accountKey(payload),
    () =>
      startPython({
        python: PY,
        script: SCRIPT,
        cwd: ROOT,
        payload,
        timeoutMs: timeoutFor(action),
        killGraceMs: KILL_GRACE_MS,
        maxStdoutBytes: stdoutCapFor(action, payload, MAX_STDOUT_BYTES),
        envPassthrough: PYTHON_ENV_PASSTHROUGH,
      }),
    signal,
    { killOnAbort: KILL_ON_ABORT.has(action) },
  );
}

function healthBody() {
  return {
    ok: true,
    service: SERVICE,
    version: VERSION,
    appUrl: APP_URL,
    python: limiter.stats(),
    autoRescan: {
      everyMs: AUTO_RESCAN_EVERY_MS,
      fetchMs: AUTO_RESCAN_FETCH_MS,
      appUrl: APP_URL,
      busy: autoRescanBusy,
      lastAt: lastAutoRescanAt,
      last: lastAutoRescanResult,
    },
  };
}

const server = createServer(async (req, res) => {
  const send = (code, data) => {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, healthBody());
  if (req.method === "POST" && req.url === "/auto-rescan-now") {
    if (!authOk(req)) return send(401, { error: "Unauthorized" });
    return send(200, await tickAutoRescan(true));
  }
  const action = ROUTES[req.url];
  if (req.method !== "POST" || !action) return send(404, { error: "not found" });
  if (!authOk(req)) return send(401, { error: "Unauthorized" });
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString("utf8"));
    if (!payload || typeof payload !== "object") throw new Error("payload must be an object");
  } catch (e) {
    return send(400, { ok: false, error: String(e.message || e) });
  }
  payload.action = action;
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    send(200, await runAction(payload, abort.signal));
  } catch (e) {
    console.error(`[tg-worker] ${action} failed:`, e);
    send(500, { ok: false, status: "disconnected", error: String(e.message || e) });
  }
});

async function isOurWorkerOn(port) {
  try {
    const host = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
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
    if (await isOurWorkerOn(PORT)) {
      console.log(`[tg-worker] на ${HOST}:${PORT} уже работает воркер — выхожу`);
      process.exit(0);
    }
    console.error(
      `[tg-worker] порт ${PORT} занят чужим процессом — освободите его или смените TG_WORKER_PORT`,
    );
    process.exit(1);
  }
  console.error("[tg-worker] ошибка сервера:", err);
  process.exit(1);
});

function sweep() {
  const removed = sweepStaleWorkDirs();
  if (removed) console.log(`[tg-worker] удалено ${removed} старых каталогов uniseller-acc-*`);
}

server.listen(PORT, HOST, () => {
  console.log(`tg-worker http://${HOST}:${PORT} version=${VERSION} python×${CONCURRENCY}`);
  if (!TOKEN) console.warn("[tg-worker] TG_WORKER_TOKEN пуст — запросы без авторизации (только dev)");
  console.log(
    `auto-rescan → ${APP_URL}/api/cron/auto-rescan every ${Math.round(AUTO_RESCAN_EVERY_MS / 60000)}m`,
  );
  sweep();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
  if (process.env.TG_WORKER_AUTO_RESCAN === "0") return;
  // Первый тик через 45с (дать приложению подняться), далее по интервалу
  setTimeout(() => {
    void tickAutoRescan(false);
  }, 45_000);
  setInterval(() => {
    void tickAutoRescan(false);
  }, AUTO_RESCAN_EVERY_MS);
});
