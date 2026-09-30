/**
 * Запуск Python-процесса check_account.py: один процесс на запрос,
 * жёсткие лимиты (время, вывод, число процессов) и гарантированная уборка
 * временного каталога с расшифрованной сессией.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WORK_DIR_PREFIX = "uniseller-acc-";
export const DEFAULT_KILL_GRACE_MS = 5_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
export const STALE_WORK_DIR_MS = 10 * 60_000;

const CANCELLED = Object.freeze({
  ok: false,
  status: "disconnected",
  error: "Запрос отменён до запуска",
});

function failure(error) {
  return { ok: false, status: "disconnected", error };
}

function parseLastJsonLine(out) {
  const line = out.trim().split("\n").filter(Boolean).pop() || "";
  return JSON.parse(line);
}

function hintFrom(err, out) {
  return (err || out || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/**
 * Стартует Python. `result` резолвится ответом (или ошибкой таймаута сразу),
 * `exited` — когда процесс реально завершился и каталог убран.
 */
export function startPython({
  python,
  script,
  cwd,
  payload,
  timeoutMs,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  maxStdoutBytes = DEFAULT_MAX_OUTPUT_BYTES,
  maxStderrBytes = DEFAULT_MAX_OUTPUT_BYTES,
  tempRoot = tmpdir(),
}) {
  let resolveResult;
  let resolveExited;
  const result = new Promise((r) => (resolveResult = r));
  const exited = new Promise((r) => (resolveExited = r));
  let settled = false;
  const settle = (value) => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };

  const workDir = mkdtempSync(join(tempRoot, WORK_DIR_PREFIX));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(workDir, { recursive: true, force: true });
    resolveExited();
  };

  let child;
  try {
    child = spawn(python, [script, "--payload", "-"], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1", UNISELLER_WORK_DIR: workDir },
    });
  } catch (e) {
    settle(failure(`Не удалось запустить Python: ${e.message || e}`));
    cleanup();
    return { result, exited };
  }

  let out = "";
  let outBytes = 0;
  let err = "";
  let overflow = false;
  let timedOut = false;
  let killTimer = null;

  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
  };

  const timer = setTimeout(() => {
    timedOut = true;
    settle(failure("Таймаут воркера"));
    terminate();
  }, timeoutMs);

  child.stdout.on("data", (d) => {
    if (overflow) return;
    outBytes += d.length;
    if (outBytes > maxStdoutBytes) {
      overflow = true;
      out = "";
      settle(failure(`Ответ воркера больше ${maxStdoutBytes} байт`));
      terminate();
      return;
    }
    out += d.toString();
  });
  child.stderr.on("data", (d) => {
    err += d.toString();
    if (err.length > maxStderrBytes) err = err.slice(-maxStderrBytes);
  });
  // EPIPE: процесс умер до чтения stdin — ответ сформирует 'close'
  child.stdin.on("error", () => {});
  child.on("error", (e) => {
    clearTimeout(timer);
    settle(failure(`Не удалось запустить Python: ${e.message || e}`));
    if (child.pid === undefined) cleanup();
  });
  child.on("close", () => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (!timedOut && !overflow) {
      try {
        settle(parseLastJsonLine(out));
      } catch {
        settle(failure(hintFrom(err, out) || "Ошибка воркера (нет JSON)"));
      }
    }
    cleanup();
  });

  child.stdin.end(JSON.stringify(payload));
  return { result, exited };
}

/**
 * Глобальный семафор на число Python-процессов + последовательная очередь
 * на ключ (аккаунт): два запроса одного аккаунта не идут параллельно.
 * Слот держится до фактического выхода процесса, а не до ответа.
 */
export function createProcessLimiter(maxConcurrent) {
  const max = Math.max(1, Math.floor(maxConcurrent) || 1);
  let active = 0;
  const waiters = [];
  const tails = new Map();

  const acquire = () => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((r) => waiters.push(r));
  };
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };

  function run(key, start, signal) {
    let resolveResult;
    const result = new Promise((r) => (resolveResult = r));
    const prev = (key && tails.get(key)) || Promise.resolve();
    const done = prev.then(async () => {
      await acquire();
      try {
        if (signal?.aborted) {
          resolveResult(CANCELLED);
          return;
        }
        const handle = start();
        handle.result.then(resolveResult);
        await handle.exited;
      } catch (e) {
        resolveResult(failure(String(e?.message || e)));
      } finally {
        release();
      }
    });
    if (key) {
      tails.set(key, done);
      void done.then(() => {
        if (tails.get(key) === done) tails.delete(key);
      });
    }
    return result;
  }

  return { run, stats: () => ({ active, queued: waiters.length, max }) };
}

/** Ключ сериализации: id аккаунта, иначе хэш архива сессии. */
export function accountKey(payload) {
  const id = payload?.accountId;
  if (typeof id === "string" && id) return `id:${id}`;
  const zip = payload?.zipBase64;
  if (typeof zip === "string" && zip) {
    return `zip:${createHash("sha256").update(zip).digest("hex").slice(0, 32)}`;
  }
  return null;
}

/** Удаляет `uniseller-acc-*` старше maxAgeMs (утечки после SIGKILL/краша). */
export function sweepStaleWorkDirs({
  root = tmpdir(),
  maxAgeMs = STALE_WORK_DIR_MS,
  now = Date.now(),
} = {}) {
  let removed = 0;
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith(WORK_DIR_PREFIX)) continue;
    const path = join(root, name);
    try {
      if (now - statSync(path).mtimeMs < maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      /* уже удалён параллельно */
    }
  }
  return removed;
}
