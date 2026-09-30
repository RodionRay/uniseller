// In-memory D1 stand-in (better-sqlite3) with the real drizzle migrations applied.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { D1LikeDatabase } from "@/lib/db";

const require = createRequire(import.meta.url);
type Statement = {
  reader: boolean;
  all(...v: unknown[]): Record<string, unknown>[];
  get(...v: unknown[]): Record<string, unknown> | undefined;
  run(...v: unknown[]): { changes: number };
};
type SqliteDb = { prepare(sql: string): Statement; exec(sql: string): void };
const Database = require("better-sqlite3") as new (file: string) => SqliteDb;

export function createTestD1(): { d1: D1LikeDatabase; sqlite: SqliteDb } {
  const sqlite = new Database(":memory:");
  const dir = path.resolve(__dirname, "../drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  const d1: D1LikeDatabase = {
    prepare(sql) {
      const st = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            all: async () => ({ results: st.reader ? st.all(...values) : [] }),
            first: async <T,>() => {
              if (!st.reader) {
                st.run(...values);
                return null;
              }
              return (st.get(...values) ?? null) as T | null;
            },
            run: async () => ({ meta: { changes: st.reader ? 0 : st.run(...values).changes } }),
          };
        },
      };
    },
  };
  return { d1, sqlite };
}
