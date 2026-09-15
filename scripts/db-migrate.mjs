#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const dir = process.env.DATA_DIR?.trim() || join(process.cwd(), ".data");
const path = join(dir, "uniseller.sqlite");
mkdirSync(dirname(path), { recursive: true });

const db = new Database(path);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const row = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'")
  .get();

if (!row) {
  const migrationPath = join(process.cwd(), "drizzle", "0000_even_hydra.sql");
  if (!existsSync(migrationPath)) {
    console.error(`Migration not found: ${migrationPath}`);
    process.exit(1);
  }
  const statements = readFileSync(migrationPath, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const statement of statements) db.exec(statement);
}

db.close();
console.log(`SQLite ready: ${path}`);
