/**
 * Short-lived mutual exclusion on D1 without interactive transactions.
 *
 * A lock is a `records` row (kind='lock', id=`lock:<owner>:<key>`). Acquire is one
 * INSERT … ON CONFLICT DO UPDATE … WHERE <expired> statement, so exactly one caller
 * sees `changes === 1`. The row lives outside the business records on purpose: many
 * code paths rewrite whole `data` blobs, which would silently drop an in-blob flag.
 */

export type LockStatement = {
  run(): Promise<{ meta: { changes: number } }>;
};

export type LockDb = {
  prepare(sql: string): { bind(...values: unknown[]): LockStatement };
};

export type LockRequest = {
  owner: string;
  key: string;
  ttlMs: number;
  /** Injected clock for tests; defaults to Date.now(). */
  now?: number;
};

export type LockHandle = {
  readonly id: string;
  readonly token: string;
  readonly until: number;
};

export const LOCK_KIND = "lock";

const ACQUIRE_SQL = `INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,NULL,?)
 ON CONFLICT(id) DO UPDATE SET data=excluded.data, created=excluded.created
 WHERE records.kind='lock' AND (
  json_extract(records.data,'$.until') IS NULL OR json_extract(records.data,'$.until') < ?
 )`;

const RELEASE_SQL =
  "DELETE FROM records WHERE id=? AND kind='lock' AND json_extract(data,'$.token')=?";

export function lockId(owner: string, key: string): string {
  return `lock:${owner}:${key}`;
}

/** Returns a handle when this caller owns the lock, null when someone else holds it. */
export async function acquireLock(
  db: LockDb,
  req: LockRequest,
): Promise<LockHandle | null> {
  if (!req.owner || !req.key) throw new Error("lock owner and key are required");
  if (!(req.ttlMs > 0)) throw new Error("lock ttlMs must be positive");
  const now = req.now ?? Date.now();
  const id = lockId(req.owner, req.key);
  const token = crypto.randomUUID();
  const until = now + req.ttlMs;
  const data = JSON.stringify({ key: req.key, token, until });
  const res = await db
    .prepare(ACQUIRE_SQL)
    .bind(id, req.owner, LOCK_KIND, data, new Date(now).toISOString(), now)
    .run();
  return res.meta.changes === 1 ? { id, token, until } : null;
}

/** Deletes the lock only if we still own it (a taken-over lock is left alone). */
export async function releaseLock(db: LockDb, handle: LockHandle): Promise<void> {
  await db.prepare(RELEASE_SQL).bind(handle.id, handle.token).run();
}

export type LockOutcome<T> = { acquired: true; value: T } | { acquired: false };

export async function withLock<T>(
  db: LockDb,
  req: LockRequest,
  fn: (handle: LockHandle) => Promise<T>,
): Promise<LockOutcome<T>> {
  const handle = await acquireLock(db, req);
  if (!handle) return { acquired: false };
  try {
    return { acquired: true, value: await fn(handle) };
  } finally {
    await releaseLock(db, handle);
  }
}
