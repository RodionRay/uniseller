/** Fair rotation over a list with a persisted integer cursor. */

export function normalizeCursor(cursor: unknown, length: number): number {
  const n = Math.floor(Number(cursor));
  if (!Number.isFinite(n) || n < 0 || length <= 0) return 0;
  return n % length;
}

/** Items starting at the cursor, wrapping around (every item exactly once). */
export function rotateFrom<T>(items: readonly T[], cursor: unknown): T[] {
  if (!items.length) return [];
  const start = normalizeCursor(cursor, items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

/** Cursor for the next run after `processed` items were handled this run. */
export function advanceCursor(cursor: unknown, processed: number, length: number): number {
  if (length <= 0) return 0;
  return (normalizeCursor(cursor, length) + Math.max(0, Math.floor(processed))) % length;
}
