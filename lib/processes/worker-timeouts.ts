/**
 * App-side timeouts for Telegram worker calls. The worker kills a job after its own timeout
 * (telegram-worker/src/server.mjs::timeoutFor) plus a kill grace, so the app must wait longer,
 * otherwise it aborts, releases the account lease and reports failure while the job still runs.
 */

/** Mirrors telegram-worker/src/server.mjs::timeoutFor, keyed by worker route. */
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
