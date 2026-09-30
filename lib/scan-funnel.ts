/**
 * Worker-side funnel of one group scan for the group scan log: how many messages the worker read and
 * why it dropped them before the lead core (older than the scan depth, stop-list, no keyword/intent,
 * sender not a person).
 * Without these numbers "worker 0 → ядро 0" cannot tell an empty chat from an over-eager stop-list.
 */

export type WorkerScanCounters = {
  fetched?: unknown;
  skippedOld?: unknown;
  skippedMinus?: unknown;
  skippedKw?: unknown;
  skippedNotUser?: unknown;
};

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * "прочитано N · старые O · стоп M · нет ключей K · не люди U"; empty when the worker did not report `fetched`.
 * "старые" appears only when the worker counts the depth cutoff (older workers drop old messages silently).
 */
export function workerFunnelText(result: WorkerScanCounters): string {
  if (result.fetched === undefined || result.fetched === null) return "";
  return [
    `прочитано ${count(result.fetched)}`,
    ...(result.skippedOld === undefined || result.skippedOld === null ? [] : [`старые ${count(result.skippedOld)}`]),
    `стоп ${count(result.skippedMinus)}`,
    `нет ключей ${count(result.skippedKw)}`,
    `не люди ${count(result.skippedNotUser)}`,
  ].join(" · ");
}
