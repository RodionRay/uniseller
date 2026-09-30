import Database from "better-sqlite3";

/**
 * In-memory D1 stand-in on real SQLite (json_extract/json_set behave as in D1).
 * Only the surface the app uses: prepare().bind().all/first/run and batch().
 */
export type FakeStatement = {
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type FakeD1 = {
  prepare(sql: string): { bind(...values: unknown[]): FakeStatement };
  batch(statements: FakeStatement[]): Promise<unknown[]>;
};

const RECORDS_DDL = `
CREATE TABLE IF NOT EXISTS records (
  id text PRIMARY KEY NOT NULL,
  owner text NOT NULL,
  kind text NOT NULL,
  data text NOT NULL,
  secret text,
  created text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_owner_kind ON records (owner, kind);
`;

function toSqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export function createD1Fake(): { db: FakeD1; sqlite: Database.Database } {
  const sqlite = new Database(":memory:");
  sqlite.exec(RECORDS_DDL);

  const statement = (sql: string, raw: unknown[]): FakeStatement => {
    const values = raw.map(toSqlValue);
    return {
      async all() {
        const s = sqlite.prepare(sql);
        if (!s.reader) {
          s.run(...values);
          return { results: [] };
        }
        return { results: s.all(...values) as Record<string, unknown>[] };
      },
      async first<T>() {
        const s = sqlite.prepare(sql);
        if (!s.reader) {
          s.run(...values);
          return null;
        }
        return (s.get(...values) as T | undefined) ?? null;
      },
      async run() {
        const s = sqlite.prepare(sql);
        if (s.reader) {
          s.all(...values);
          return { meta: { changes: 0 } };
        }
        return { meta: { changes: s.run(...values).changes } };
      },
    };
  };

  const db: FakeD1 = {
    prepare: (sql) => ({ bind: (...values) => statement(sql, values) }),
    async batch(statements) {
      const out: unknown[] = [];
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) out.push(await s.run());
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
      return out;
    },
  };
  return { db, sqlite };
}

export function insertRecord(
  sqlite: Database.Database,
  row: { id: string; owner: string; kind: string; data: unknown; secret?: string | null },
): void {
  sqlite
    .prepare("INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)")
    .run(
      row.id,
      row.owner,
      row.kind,
      typeof row.data === "string" ? row.data : JSON.stringify(row.data),
      row.secret ?? null,
      new Date().toISOString(),
    );
}

export function readData(
  sqlite: Database.Database,
  id: string,
): Record<string, unknown> | null {
  const row = sqlite.prepare("SELECT data FROM records WHERE id=?").get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
}
