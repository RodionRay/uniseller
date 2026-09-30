/**
 * Когда повторить автообход раньше обычного интервала.
 * Догоняем быстро, только если тик реально что-то сделал или в очереди есть работа;
 * иначе — экспоненциальная пауза до обычного интервала (null = ждать обычный тик).
 */
export const CATCH_UP_BASE_MS = 12_000;

function queuedCount(data) {
  const top = Number(data?.queued);
  if (Number.isFinite(top) && top > 0) return top;
  const ticks = Array.isArray(data?.ticks) ? data.ticks : [];
  return ticks.reduce((n, t) => n + (Number(t?.queued) || 0), 0);
}

export function hasCatchUpWork(data) {
  const done = (Number(data?.scanned) || 0) + (Number(data?.joined) || 0);
  return done > 0 || queuedCount(data) > 0;
}

/**
 * @param {{ ok: boolean, data?: object, aborted?: boolean, prevDelayMs: number|null, intervalMs: number, baseMs?: number }} tick
 * @returns {number|null} задержка следующего внеочередного тика или null
 */
export function nextCatchUpDelayMs({
  ok,
  data,
  aborted = false,
  prevDelayMs,
  intervalMs,
  baseMs = CATCH_UP_BASE_MS,
}) {
  const wantsMore = aborted || (ok && !!data?.more);
  if (!wantsMore) return null;
  if (!aborted && hasCatchUpWork(data)) return baseMs;
  const next = prevDelayMs ? prevDelayMs * 2 : baseMs * 2;
  return next >= intervalMs ? null : next;
}
