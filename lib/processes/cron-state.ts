/**
 * Small persisted state for system cron jobs (round-robin cursors), stored as a
 * `records` row outside any user workspace so it survives restarts.
 */

export const SYSTEM_OWNER = "__system__";
const CRON_STATE_KIND = "cron_state";

type CronStateDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
};

function stateId(job: string): string {
  return `${CRON_STATE_KIND}:${job}`;
}

export async function readCronCursor(db: CronStateDb, job: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT CASE WHEN json_valid(data) THEN json_extract(data,'$.cursor') END AS cursor FROM records WHERE id=? AND owner=? AND kind=?",
    )
    .bind(stateId(job), SYSTEM_OWNER, CRON_STATE_KIND)
    .first<{ cursor: unknown }>();
  const n = Math.floor(Number(row?.cursor));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function writeCronCursor(db: CronStateDb, job: string, cursor: number): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,NULL,?)
       ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE records.kind='${CRON_STATE_KIND}'`,
    )
    .bind(stateId(job), SYSTEM_OWNER, CRON_STATE_KIND, JSON.stringify({ cursor, at: now }), now)
    .run();
}
