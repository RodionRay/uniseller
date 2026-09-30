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
/**
 * Действия с аккаунтом могут вернуть перепакованный архив сессии (refreshedSession):
 * импорт допускает архив до 1 МиБ, в base64 он больше — 1 МиБ на весь ответ мало.
 */
export const ACCOUNT_MAX_OUTPUT_BYTES = 8 * 1_048_576;
/** Сбор аудитории отдаёт список участников — у больших групп это мегабайты. */
export const COLLECT_MAX_OUTPUT_BYTES = 32 * 1_048_576;
export const STALE_WORK_DIR_MS = 10 * 60_000;

/**
 * Python разбирает чужие tdata — секреты приложения (SESSION_SECRET, ENCRYPTION_KEY,
 * OAuth, токены) ему не нужны. Передаём только окружение интерпретатора.
 */
const CHILD_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "VIRTUAL_ENV",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const CHILD_ENV_PREFIXES = ["LC_", "PYTHON"];

/** Минимальное окружение Python-процесса; `passthrough` — явные доп. имена (TG_WORKER_PYTHON_ENV). */
export function childEnv(source, workDir, passthrough = []) {
  const extra = new Set(passthrough);
  const env = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const allowed =
      CHILD_ENV_NAMES.has(name) ||
      extra.has(name) ||
      CHILD_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
    if (allowed) env[name] = value;
  }
  return { ...env, PYTHONUNBUFFERED: "1", UNISELLER_WORK_DIR: workDir };
}

/** Лимит stdout по действию; для аккаунтов растёт с размером присланного архива. */
export function stdoutCapFor(action, payload, configured = DEFAULT_MAX_OUTPUT_BYTES) {
  if (action === "check_proxy") return configured;
  if (action === "collect") return Math.max(configured, COLLECT_MAX_OUTPUT_BYTES);
  const archive = typeof payload?.zipBase64 === "string" ? payload.zipBase64.length : 0;
  return Math.max(configured, ACCOUNT_MAX_OUTPUT_BYTES, 2 * archive + 1_048_576);
}

const CANCELLED = Object.freeze({
  ok: false,
  status: "disconnected",
  error: "Запрос отменён до запуска",
});
const ABORTED = Object.freeze({
  ok: false,
  status: "disconnected",
  error: "Запрос отменён клиентом",
});

function failure(error) {
  return { ok: false, status: "disconnected", error };
}

function parseLastJsonLine(out) {
  const line = out.trim().split("\n").filter(Boolean).pop() || "";
  return JSON.parse(line);
}

/** Answer when Python printed no JSON; its stderr may hold paths or secrets, so it stays out. */
export const NO_JSON_ERROR = "Ошибка воркера (нет ответа)";

/** Exception class from a Python traceback, for logs only (never the message). */
function exceptionType(stderr) {
  const lines = stderr.trim().split("\n");
  const last = lines[lines.length - 1] || "";
  const m = last.match(/^([A-Za-z_][\w.]*)(?::|$)/);
  return m ? m[1] : "unknown";
}

/**
 * Стартует Python. `result` резолвится ответом (или ошибкой таймаута сразу),
 * `exited` — когда процесс реально завершился и каталог убран,
 * `cancel()` — ответить «отменён» и остановить процесс (SIGTERM → SIGKILL).
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
  envPassthrough = [],
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
  const noop = () => {};

  let child;
  try {
    // The work dir goes both as an argument and in the env; check_account.py reads either.
    child = spawn(python, [script, "--payload", "-", "--work-dir", workDir], {
      cwd,
      env: childEnv(process.env, workDir, envPassthrough),
    });
  } catch (e) {
    settle(failure(`Не удалось запустить Python: ${e.message || e}`));
    cleanup();
    return { result, exited, cancel: noop };
  }

  let out = "";
  let outBytes = 0;
  let err = "";
  let overflow = false;
  let stopped = false;
  let killTimer = null;

  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
  };

  const stop = (answer) => {
    stopped = true;
    settle(answer);
    terminate();
  };
  const timer = setTimeout(() => stop(failure("Таймаут воркера")), timeoutMs);

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
    if (!stopped && !overflow) {
      try {
        settle(parseLastJsonLine(out));
      } catch {
        console.warn(`[tg-worker] python produced no JSON (${exceptionType(err)})`);
        settle(failure(NO_JSON_ERROR));
      }
    }
    cleanup();
  });

  child.stdin.end(JSON.stringify(payload));
  const cancel = () => {
    if (!settled) stop(ABORTED);
  };
  return { result, exited, cancel };
}

/**
 * Глобальный семафор на число Python-процессов + последовательная очередь
 * на ключ (аккаунт): два запроса одного аккаунта не идут параллельно.
 * Слот держится до фактического выхода процесса, а не до ответа.
 * `signal` снимает ещё не начатый запрос; с `killOnAbort` — и уже запущенный.
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

  function run(key, start, signal, { killOnAbort = false } = {}) {
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
        const onAbort = () => handle.cancel();
        if (killOnAbort) signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await handle.exited;
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
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
