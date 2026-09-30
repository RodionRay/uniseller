#!/usr/bin/env node
// Online backup of the local D1 sqlite file (SQLite backup API via better-sqlite3:
// consistent while the app keeps writing). Keeps the newest BACKUP_KEEP copies.
// Usage: node scripts/d1-backup.mjs            (Docker: run inside the web container)
// Env: D1_PERSIST_DIR (default .wrangler/state), BACKUP_DIR (default <persist>/../backups),
//      BACKUP_KEEP (default 14).
// The backup holds encrypted secrets; ENCRYPTION_KEY is NOT in it — store the key separately.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { locateD1File, persistDir } from "./wrangler-local.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const BACKUP_PREFIX = "uniseller-d1-";
const backupDir = path.resolve(process.env.BACKUP_DIR?.trim() || path.join(persistDir(), "../backups"));
const keep = Number(process.env.BACKUP_KEEP || 14);
if (!Number.isInteger(keep) || keep < 1) {
  console.error(`BACKUP_KEEP must be a positive integer, got "${process.env.BACKUP_KEEP}"`);
  process.exit(1);
}

let source;
try {
  source = locateD1File();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
const target = path.join(backupDir, `${BACKUP_PREFIX}${stamp}.sqlite`);

const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
} finally {
  db.close();
}
// The copy inherits WAL mode; switch to a rollback journal so the backup is one
// self-contained file (no -wal/-shm siblings to copy or forget).
const check = new Database(target);
check.pragma("journal_mode = DELETE");
const integrity = check.pragma("integrity_check", { simple: true });
check.close();
if (integrity !== "ok") {
  console.error(`Backup ${target} failed integrity_check: ${integrity}`);
  process.exit(1);
}
console.log(`Backup written: ${target}`);

const old = readdirSync(backupDir)
  .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(".sqlite"))
  .sort()
  .slice(0, -keep);
for (const file of old) {
  rmSync(path.join(backupDir, file));
  console.log(`Pruned: ${file}`);
}
