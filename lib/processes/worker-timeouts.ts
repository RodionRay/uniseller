/**
 * App-side timeouts for Telegram worker calls. The worker kills a job after its own timeout
 * (telegram-worker/src/worker-app.mjs::timeoutForAction) plus a kill grace, so the app must wait
 * longer, otherwise it aborts, releases the account lease and reports failure while the job still
 * runs. Not imported from the worker directly: that module pulls node:child_process into the app
 * bundle; tests/worker-timeouts.test.ts and tests/worker-proxy-timeout.test.ts pin both sides.
 */

/** Mirrors telegram-worker/src/worker-app.mjs::timeoutForAction, keyed by worker route. */
const WORKER_TIMEOUT_BY_PATH: Readonly<Record<string, number>> = {
  "/check-account": 28_000,
  "/check-proxy": 18_000,
  "/upload-photo": 180_000,
  "/collect-audience": 180_000,
  "/invite-users": 180_000,
};
const WORKER_DEFAULT_TIMEOUT_MS = 120_000;

/** Worker kill grace (5 s, TG_WORKER_KILL_GRACE_MS) plus transport. */
export const WORKER_REPLY_MARGIN_MS = 10_000;

export function workerTimeoutMs(path: string): number {
  return WORKER_TIMEOUT_BY_PATH[path] ?? WORKER_DEFAULT_TIMEOUT_MS;
}

export function appTimeoutForWorker(path: string): number {
  return workerTimeoutMs(path) + WORKER_REPLY_MARGIN_MS;
}

export const WORKER_CHECK_PROXY_TIMEOUT_MS = workerTimeoutMs("/check-proxy");
/** Default Python slots of the worker (TG_WORKER_MAX_CONCURRENCY). */
export const WORKER_DEFAULT_SLOTS = 4;
export const PROXY_CHECK_MARGIN_MS = WORKER_REPLY_MARGIN_MS;

/**
 * How long the app waits for one /check-proxy call when `batchSize` checks
 * are sent at once to a worker with `slots` Python slots: checks beyond the
 * slots queue in the worker, so the last one waits for every earlier round.
 */
export function proxyCheckTimeoutMs(batchSize: number, slots: number): number {
  const rounds = Math.ceil(Math.max(1, batchSize) / Math.max(1, slots));
  return rounds * WORKER_CHECK_PROXY_TIMEOUT_MS + PROXY_CHECK_MARGIN_MS;
}

/** Python slots of the worker, from the same env the worker reads. */
export function workerSlots(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : WORKER_DEFAULT_SLOTS;
}
