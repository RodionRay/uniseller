/**
 * Field-level writes into records.data (json_set / json_remove) so a long operation
 * only overwrites the fields it owns instead of the whole blob it read minutes ago.
 */

import type { LockDb } from "@/lib/locks";

export type RecordRef = { owner: string; kind: string; id: string };

const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function fieldPath(name: string): string {
  if (!SAFE_FIELD.test(name)) throw new Error(`unsafe record field name: ${name}`);
  return `'$.${name}'`;
}

/**
 * Sets (or removes, for `undefined`) top-level fields of one record.
 * Returns false when the row does not exist for this owner/kind.
 */
export async function patchRecordData(
  db: LockDb,
  ref: RecordRef,
  patch: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const sets: string[] = [];
  const removes: string[] = [];
  const values: unknown[] = [];
  for (const [name, value] of Object.entries(patch)) {
    const path = fieldPath(name);
    if (value === undefined) {
      removes.push(path);
      continue;
    }
    sets.push(`${path},json(?)`);
    values.push(JSON.stringify(value));
  }
  if (!sets.length && !removes.length) return true;
  let expr = "data";
  if (sets.length) expr = `json_set(${expr},${sets.join(",")})`;
  if (removes.length) expr = `json_remove(${expr},${removes.join(",")})`;
  const res = await db
    .prepare(`UPDATE records SET data=${expr} WHERE owner=? AND id=? AND kind=?`)
    .bind(...values, ref.owner, ref.id, ref.kind)
    .run();
  return res.meta.changes > 0;
}

/** Top-level keys whose JSON value differs; removed keys map to undefined. */
export function changedFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) out[key] = value;
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) out[key] = undefined;
  }
  return out;
}

/** Writes only what changed between the copy we read and the copy we computed. */
export async function writeRecordDiff(
  db: LockDb,
  ref: RecordRef,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const diff = changedFields(before, after);
  if (!Object.keys(diff).length) return true;
  return patchRecordData(db, ref, diff);
}
