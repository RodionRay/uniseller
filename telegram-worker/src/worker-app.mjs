/**
 * HTTP guard, config and job admission for the Telegram worker.
 * Entry point: server.mjs; the Python process itself: python-runner.mjs.
 * Split out so the security invariants are unit-testable.
 */
import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import {
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  STALE_WORK_DIR_MS,
  WORK_DIR_PREFIX,
  accountKey,
  createProcessLimiter,
  startPython,
  stdoutCapFor,
  sweepStaleWorkDirs,
} from "./python-runner.mjs";

export { WORK_DIR_PREFIX };
export const MIN_TOKEN_LENGTH = 32;
const DEFAULT_MAX_BODY_BYTES = 6_000_000;
const DEFAULT_MAX_CONCURRENCY = 4;
// Requests beyond the running slots wait here; the UI fires ~8 proxy checks at once.
const DEFAULT_MAX_QUEUE = 64;
// After SIGKILL the kernel reaps the child almost at once; this only bounds a missing 'close'.
const STOP_FALLBACK_MARGIN_MS = 1_000;
const GENERIC_WORKER_ERROR = "Ошибка воркера (нет ответа)";
const ABORTED_ERROR = "Запрос отменён клиентом";

export const ROUTES = Object.freeze({
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
});

const LONG_ACTIONS = new Set(["upload_photo", "collect", "invite"]);

/**
 * Read-only actions: when the app went away the process may be killed. A send, invite or join
 * is left running — Telegram may already have done it; its own timeout frees the slot.
 */
const KILL_ON_ABORT = new Set(["check", "check_proxy", "scan", "collect", "inbox"]);

/** @param {string} action */
export function timeoutForAction(action) {
  if (action === "check") return 28_000;
  if (action === "check_proxy") return 18_000;
  return LONG_ACTIONS.has(action) ? 180_000 : 120_000;
}

/** @param {string | undefined} raw */
function csvList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function resolveConfig(env) {
  const token = env.TG_WORKER_TOKEN || "";
  if (!token) {
    throw new Error("TG_WORKER_TOKEN is required (refusing to start an unauthenticated worker)");
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`TG_WORKER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return {
    token,
    host: env.TG_WORKER_HOST || "127.0.0.1",
    port: Number(env.TG_WORKER_PORT || 8790),
    extraHosts: csvList(env.TG_WORKER_ALLOWED_HOSTS).map((h) => h.toLowerCase()),
    // TG_WORKER_CONCURRENCY is the older name, still set by existing deployments.
    maxConcurrency: positiveInt(
      env.TG_WORKER_MAX_CONCURRENCY || env.TG_WORKER_CONCURRENCY,
      DEFAULT_MAX_CONCURRENCY,
    ),
    maxQueue: nonNegativeInt(env.TG_WORKER_MAX_QUEUE, DEFAULT_MAX_QUEUE),
    maxBodyBytes: positiveInt(env.TG_WORKER_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    /** One timeout for every action (tests, slow networks); null = per-action defaults. */
    timeoutMs: env.TG_WORKER_TIMEOUT_MS ? positiveInt(env.TG_WORKER_TIMEOUT_MS, null) : null,
    killGraceMs: positiveInt(env.TG_WORKER_KILL_GRACE_MS, DEFAULT_KILL_GRACE_MS),
    maxStdoutBytes: positiveInt(env.TG_WORKER_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES),
    /** Extra env names passed to the Python child (it gets no app secrets by default). */
    pythonEnv: csvList(env.TG_WORKER_PYTHON_ENV),
    /** Plain-http APP_URL hosts cron may use (a private compose network, e.g. "web"). */
    cronHttpHosts: csvList(env.TG_WORKER_CRON_HTTP_HOSTS).map((h) => h.toLowerCase()),
  };
}

/**
 * @template T
 * @param {string | undefined} raw
 * @param {T} fallback
 * @returns {number | T}
 */
function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** @param {string | undefined} raw @param {number} fallback */
function nonNegativeInt(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Constant-time Bearer check. Hashing both sides equalises lengths for timingSafeEqual.
 * @param {string | undefined} header
 * @param {string} token
 */
export function tokenMatches(header, token) {
  if (!header || !token) return false;
  const digest = (/** @type {string} */ s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}

/**
 * Why auto-rescan cannot run with this CRON_SECRET, or null when it can.
 * The app rejects secrets shorter than MIN_TOKEN_LENGTH, so those are unusable too.
 * @param {string | undefined} secret
 */
export function cronSecretProblem(secret) {
  if (!secret) return "CRON_SECRET is not set";
  if (secret.length < MIN_TOKEN_LENGTH) {
    return `CRON_SECRET is shorter than ${MIN_TOKEN_LENGTH} characters`;
  }
  return null;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The cron call carries CRON_SECRET, so it must never travel over plain HTTP off-host.
 * `httpHosts` names private hosts (compose service names) that may be reached over http.
 * @param {string} appUrl
 * @param {readonly string[]} [httpHosts]
 */
export function cronTargetAllowed(appUrl, httpHosts = []) {
  let url;
  try {
    url = new URL(appUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return (
    LOOPBACK_HOSTNAMES.has(host) || /^127\.\d+\.\d+\.\d+$/.test(host) || httpHosts.includes(host)
  );
}

/**
 * Remove work dirs left behind by a crashed worker (they may hold plaintext sessions).
 * @param {{ dir?: string, maxAgeMs?: number, now?: number }} [opts]
 */
export async function purgeStaleWorkDirs(opts = {}) {
  return sweepStaleWorkDirs({
    root: opts.dir || tmpdir(),
    maxAgeMs: opts.maxAgeMs ?? STALE_WORK_DIR_MS,
    now: opts.now ?? Date.now(),
  });
}

/**
 * Runs one Python job per call (python-runner.mjs::startPython) and answers only once the
 * child is gone, so the caller's slot is not freed while Python still runs. The fallback
 * covers a killed child whose pipes stay open (e.g. an orphaned grandchild holding stdout).
 * @param {{ python: string, script: string, cwd?: string, tmpRoot?: string,
 *   killGraceMs?: number, maxStdoutBytes?: number, envPassthrough?: string[] }} opts
 */
export function createPythonRunner(opts) {
  const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  /** @type {Set<Promise<void>>} */
  const pending = new Set();

  /**
   * @param {Record<string, unknown>} payload
   * @param {number} timeoutMs
   * @param {AbortSignal} [signal] aborted when the job must stop (client gone)
   * @returns {Promise<Record<string, unknown>>}
   */
  async function run(payload, timeoutMs, signal) {
    if (signal?.aborted) return { ok: false, status: "disconnected", error: ABORTED_ERROR };
    const handle = startPython({
      python: opts.python,
      script: opts.script,
      cwd: opts.cwd,
      payload,
      timeoutMs,
      killGraceMs,
      maxStdoutBytes: stdoutCapFor(
        String(payload.action || ""),
        payload,
        opts.maxStdoutBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      ),
      tempRoot: opts.tmpRoot || tmpdir(),
      envPassthrough: opts.envPassthrough || [],
    });
    const tracked = handle.exited.then(() => {
      pending.delete(tracked);
    });
    pending.add(tracked);
    const onAbort = () => handle.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await handle.result;
      /** @type {NodeJS.Timeout | undefined} */
      let fallback;
      await Promise.race([
        handle.exited,
        new Promise((resolve) => {
          fallback = setTimeout(resolve, killGraceMs + STOP_FALLBACK_MARGIN_MS);
        }),
      ]);
      clearTimeout(fallback);
      return result;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Resolves when every spawned child has exited and its work dir is gone. */
  run.idle = async () => {
    while (pending.size) await Promise.all([...pending]);
  };
  return run;
}

/** @param {string | undefined} contentType */
function isJson(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {{ runPython: (payload: any, timeoutMs: number, signal?: AbortSignal) => Promise<unknown>,
 *   tickAutoRescan: (force: boolean) => Promise<unknown>,
 *   autoRescanStatus: () => Record<string, unknown>,
 *   info?: () => Record<string, unknown> }} deps
 */
export function createWorkerServer(config, deps) {
  // Requests holding a place: reading their body, waiting for a slot or running.
  // Reserved before the body is read, so slow senders cannot all pass the check.
  let admitted = 0;
  // Python slots (FIFO) plus one-at-a-time per account: two jobs of one session never overlap.
  const limiter = createProcessLimiter(config.maxConcurrency);

  /** @param {import("node:http").IncomingMessage} req */
  const hostAllowed = (req) => {
    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : config.port;
    const host = String(req.headers.host || "").toLowerCase();
    return (
      host === `127.0.0.1:${port}` ||
      host === `localhost:${port}` ||
      config.extraHosts.includes(host)
    );
  };

  const healthDetails = () => ({
    ...(deps.info ? deps.info() : {}),
    python: { ...limiter.stats(), admitted, maxQueue: config.maxQueue },
    autoRescan: deps.autoRescanStatus(),
  });

  const server = createServer(async (req, res) => {
    const send = (/** @type {number} */ code, /** @type {unknown} */ data, extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...extra });
      res.end(JSON.stringify(data));
    };
    if (!hostAllowed(req)) return send(403, { error: "Forbidden" });
    const authed = tokenMatches(req.headers.authorization, config.token);

    if (req.method === "GET" && req.url === "/health") {
      const base = { ok: true, service: "uniseller-tg-worker" };
      return send(200, authed ? { ...base, ...healthDetails() } : base);
    }
    const action = req.method === "POST" ? ROUTES[/** @type {keyof typeof ROUTES} */ (req.url)] : undefined;
    const isRescan = req.method === "POST" && req.url === "/auto-rescan-now";
    if (!action && !isRescan) return send(404, { error: "not found" });
    if (!authed) return send(401, { error: "Unauthorized" });
    if (!isJson(req.headers["content-type"])) return send(415, { error: "Content-Type must be application/json" });
    if (isRescan) return send(200, await deps.tickAutoRescan(true));

    const declared = Number(req.headers["content-length"] || 0);
    if (declared > config.maxBodyBytes) {
      req.resume();
      return send(413, { ok: false, error: "Payload too large" }, { Connection: "close" });
    }
    if (admitted >= config.maxConcurrency + config.maxQueue) {
      req.resume();
      return send(429, { ok: false, error: "Воркер занят, повторите позже" }, { "Retry-After": "5" });
    }
    admitted += 1;
    let placeHeld = true;
    const leave = () => {
      if (!placeHeld) return;
      placeHeld = false;
      admitted -= 1;
    };
    // Client gone before we answered (e.g. app-side timeout): stop waiting / kill a read-only job.
    const clientGone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) clientGone.abort();
      leave();
    });
    try {
      await handleJob(req, send, action, clientGone.signal);
    } finally {
      leave();
    }
  });

  /**
   * Reads the body (before queueing, so a waiting request can't hit requestTimeout),
   * then runs the job in a Python slot, after any earlier job of the same account.
   * @param {import("node:http").IncomingMessage} req
   * @param {(code: number, data: unknown, extra?: Record<string, string>) => void} send
   * @param {string} action
   * @param {AbortSignal} signal
   */
  async function handleJob(req, send, action, signal) {
    let payload;
    try {
      const raw = await readBody(req, config.maxBodyBytes);
      if (raw === null) return send(413, { ok: false, error: "Payload too large" }, { Connection: "close" });
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(400, { ok: false, error: "Invalid JSON" });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return send(400, { ok: false, error: "Invalid JSON" });
    }
    payload.action = action;
    const timeoutMs = config.timeoutMs ?? timeoutForAction(action);
    const outcome = await limiter.run(
      action === "check_proxy" ? null : accountKey(payload),
      () => {
        const stop = new AbortController();
        const done = Promise.resolve()
          .then(() => deps.runPython(payload, timeoutMs, stop.signal))
          .then(
            (value) => ({ value }),
            () => ({ failed: true }),
          );
        return { result: done, exited: done.then(() => undefined), cancel: () => stop.abort() };
      },
      signal,
      { killOnAbort: KILL_ON_ABORT.has(action) },
    );
    if (signal.aborted) return;
    if (!outcome || typeof outcome !== "object" || "failed" in outcome || !("value" in outcome)) {
      return send(500, { ok: false, error: GENERIC_WORKER_ERROR });
    }
    return send(200, outcome.value);
  }
  // Slow senders must not pin a concurrency slot while the body trickles in.
  server.requestTimeout = 60_000;
  return server;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer | null>} null when the body exceeds the limit
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on("data", (/** @type {Buffer} */ c) => {
      if (overflow) return;
      size += c.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    let ended = false;
    req.on("end", () => {
      ended = true;
      if (!overflow) resolve(Buffer.concat(chunks));
    });
    req.on("close", () => {
      if (!ended && !overflow) reject(new Error("client aborted"));
    });
    req.on("error", reject);
  });
}
