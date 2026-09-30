#!/usr/bin/env node
/**
 * Разовая починка битых joinStateError (объект / >500 символов) в локальной D1.
 * Usage: npm run heal:joinstate   (D1_PERSIST_DIR, по умолчанию .wrangler/state;
 * Docker: docker compose exec web npm run heal:joinstate)
 */
import { createRequire } from "node:module";
import { locateD1File } from "./wrangler-local.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

let candidates;
try {
  candidates = [locateD1File()];
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function sanitize(v) {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v).slice(0, 500);
}

let total = 0;
for (const path of candidates) {
  const db = new Database(path);
  const has = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'")
    .get();
  if (!has) {
    db.close();
    continue;
  }
  const rows = db.prepare("SELECT id, data FROM records WHERE kind='group'").all();
  let fixed = 0;
  const upd = db.prepare("UPDATE records SET data=? WHERE id=?");
  for (const row of rows) {
    let g;
    try {
      g = JSON.parse(row.data);
    } catch {
      continue;
    }
    const raw = g.joinStateError;
    const next = sanitize(raw);
    const bad =
      raw != null &&
      (typeof raw === "object" ||
        (typeof raw === "string" && raw.length > 500));
    if (!bad) continue;
    g.joinStateError = next;
    if (typeof g.joinState === "object") {
      g.joinState = "";
      g.joinStateAt = "";
    }
    upd.run(JSON.stringify(g), row.id);
    fixed++;
  }
  db.close();
  console.log(`${path}: fixed ${fixed}/${rows.length} groups`);
  total += fixed;
}
console.log(`Done. Total fixed: ${total}`);
