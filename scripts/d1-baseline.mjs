#!/usr/bin/env node
// One-off for a local D1 created before `wrangler d1 migrations apply` was used
// (0000 applied by hand with `d1 execute --file`, other tables created at runtime).
// Marks a migration as applied in wrangler's `d1_migrations` table when every table
// it creates already exists, so `npm run db:migrate` only runs what is missing.
// Safe to re-run (INSERT OR IGNORE). All migrations are CREATE ... IF NOT EXISTS,
// so even without a baseline `db:migrate` would not fail; the baseline keeps the
// bookkeeping honest. Usage: npm run build && npm run db:baseline [-- --dry-run]
import { readdirSync } from "node:fs";
import path from "node:path";
import { assertBuilt, persistDir, projectRoot, queryLocalD1 } from "./wrangler-local.mjs";

// Must match wrangler's own DDL (wrangler/src/d1/migrations/helpers.ts::initMigrationsTable).
const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

/** Tables each migration creates; a migration counts as applied only if all exist. */
const MIGRATION_TABLES = {
  "0000_even_hydra.sql": ["records"],
  "0001_users_oauth.sql": ["users", "oauth_accounts"],
  "0002_workspace_contact.sql": ["contact_messages", "workspace_invites", "workspace_members"],
  "0003_rate_limits.sql": ["rate_limits"],
};

const dryRun = process.argv.includes("--dry-run");

function migrationFiles() {
  return readdirSync(path.join(projectRoot, "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

assertBuilt();
console.log(`Local D1 persist dir: ${persistDir()}`);
const tables = new Set(
  queryLocalD1("SELECT name FROM sqlite_master WHERE type='table'").map((row) => row.name),
);

const toMark = [];
for (const file of migrationFiles()) {
  const expected = MIGRATION_TABLES[file];
  if (!expected) {
    console.log(`skip ${file}: no baseline mapping (newer migration, db:migrate will apply it)`);
    continue;
  }
  const missing = expected.filter((table) => !tables.has(table));
  if (missing.length) {
    console.log(`skip ${file}: missing tables ${missing.join(", ")} (db:migrate will create them)`);
    continue;
  }
  toMark.push(file);
}

if (!toMark.length) {
  console.log("Nothing to baseline.");
  process.exit(0);
}
console.log(`${dryRun ? "Would mark" : "Marking"} as applied: ${toMark.join(", ")}`);
if (!dryRun) {
  const values = toMark.map((file) => `('${file.replaceAll("'", "''")}')`).join(", ");
  queryLocalD1(MIGRATIONS_TABLE_DDL);
  queryLocalD1(`INSERT OR IGNORE INTO d1_migrations (name) VALUES ${values};`);
  const rows = queryLocalD1("SELECT name FROM d1_migrations ORDER BY id");
  console.log(`d1_migrations now: ${rows.map((row) => row.name).join(", ")}`);
}
