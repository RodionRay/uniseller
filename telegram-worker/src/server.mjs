#!/usr/bin/env node
/**
 * Локальный HTTP-воркер Telegram (check / join / scan).
 * Слушает 127.0.0.1 — только localhost.
 * Плюс круглосуточный автообход лидов → POST APP_URL/api/cron/auto-rescan
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO = join(ROOT, "..");
const PY = join(ROOT, ".venv/bin/python");
const SCRIPT = join(__dirname, "check_account.py");
const HOST = "127.0.0.1";
const PORT = Number(process.env.TG_WORKER_PORT || 8790);
const TOKEN = process.env.TG_WORKER_TOKEN || "";

function loadDotEnv() {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return;
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
  } catch {
    /* */
  }
}
loadDotEnv();

const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(
  /\/$/,
  "",
);
const CRON_SECRET =
  process.env.CRON_SECRET ||
  process.env.TG_WORKER_TOKEN ||
  process.env.SESSION_SECRET ||
  "";
/** Как часто дергать cron (сам API режет по autoRescanMinutes на группу). */
const AUTO_RESCAN_EVERY_MS = Math.max(
  60_000,
  Number(process.env.AUTO_RESCAN_EVERY_MS || 5 * 60_000),
);

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

function runPython(payload, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(PY, [SCRIPT, "--payload", "-"], {
      cwd: ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, status: "disconnected", error: "Таймаут воркера" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const line = out.trim().split("\n").filter(Boolean).pop() || "";
        resolve(JSON.parse(line));
      } catch {
        const hint = (err || out || "Ошибка воркера")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 400);
        resolve({
          ok: false,
          status: "disconnected",
          error: hint || "Ошибка воркера (нет JSON)",
        });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function authOk(req) {
  if (!TOKEN) return true;
  return (req.headers.authorization || "") === `Bearer ${TOKEN}`;
}

let autoRescanBusy = false;
let autoRescanBusyAt = 0;
let lastAutoRescanAt = "";
let lastAutoRescanResult = null;
let catchUpTimer = null;
/** Согласовано с cron TICK_BUDGET 210с + запас. */
const AUTO_RESCAN_FETCH_MS = 270_000;
const BUSY_STALE_MS = 6 * 60_000;

function scheduleCatchUp() {
  if (catchUpTimer) return;
  catchUpTimer = setTimeout(() => {
    catchUpTimer = null;
    void tickAutoRescan(false);
  }, 12_000);
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
    console.warn(
      "[auto-rescan] нет CRON_SECRET / TG_WORKER_TOKEN / SESSION_SECRET — пропуск",
    );
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
    } else if (data.skipped) {
      /* тихо */
    } else {
      console.log(
        `[auto-rescan] scanned=${data.scanned || 0} added=${data.added || 0} joined=${data.joined || 0} due=${data.due || 0} more=${!!data.more} ${ms}ms`,
      );
    }
    if (data?.more && res.ok) scheduleCatchUp();
    return data;
  } catch (e) {
    const ms = Date.now() - t0;
    lastAutoRescanAt = new Date().toISOString();
    lastAutoRescanResult = { ok: false, error: String(e.message || e), ms };
    const abort = /aborted|timeout/i.test(String(e.message || e));
    console.warn(
      abort
        ? `[auto-rescan] timeout ${ms}ms — следующий тик продолжит`
        : `[auto-rescan] error ${e.message || e} ${ms}ms`,
    );
    if (abort) scheduleCatchUp();
    return lastAutoRescanResult;
  } finally {
    autoRescanBusy = false;
  }
}

const server = createServer(async (req, res) => {
  const send = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  if (req.method === "GET" && req.url === "/health") {
    return send(200, {
      ok: true,
      service: "uniseller-tg-worker",
      autoRescan: {
        everyMs: AUTO_RESCAN_EVERY_MS,
        fetchMs: AUTO_RESCAN_FETCH_MS,
        appUrl: APP_URL,
        busy: autoRescanBusy,
        lastAt: lastAutoRescanAt,
        last: lastAutoRescanResult,
      },
    });
  }
  if (req.method === "POST" && req.url === "/auto-rescan-now") {
    if (!authOk(req)) return send(401, { error: "Unauthorized" });
    const data = await tickAutoRescan(true);
    return send(200, data);
  }
  const routes = {
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
  if (req.method === "POST" && routes[req.url]) {
    if (!authOk(req)) return send(401, { error: "Unauthorized" });
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw.toString("utf8"));
      payload.action = routes[req.url];
      const long =
        routes[req.url] === "upload_photo" ||
        routes[req.url] === "collect" ||
        routes[req.url] === "invite";
      const timeoutMs =
        routes[req.url] === "check"
          ? 28_000
          : routes[req.url] === "check_proxy"
            ? 18_000
          : long
            ? 180_000
            : 120_000;
      const result = await runPython(payload, timeoutMs);
      return send(200, result);
    } catch (e) {
      return send(400, { ok: false, error: String(e.message || e) });
    }
  }
  send(404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`tg-worker http://${HOST}:${PORT}`);
  console.log(
    `auto-rescan → ${APP_URL}/api/cron/auto-rescan every ${Math.round(AUTO_RESCAN_EVERY_MS / 60000)}m`,
  );
  // Первый тик через 45с (дать приложению подняться), далее по интервалу
  setTimeout(() => {
    void tickAutoRescan(false);
  }, 45_000);
  setInterval(() => {
    void tickAutoRescan(false);
  }, AUTO_RESCAN_EVERY_MS);
});
