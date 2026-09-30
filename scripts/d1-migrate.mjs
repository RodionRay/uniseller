#!/usr/bin/env node
// Applies drizzle/*.sql to the local D1 via wrangler's d1_migrations bookkeeping.
// Usage: npm run build && npm run db:migrate   (Docker: D1_PERSIST_DIR=/data/wrangler)
import { assertBuilt, persistDir, runWrangler, wranglerConfig } from "./wrangler-local.mjs";

assertBuilt();
runWrangler(
  ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistDir(), "--config", wranglerConfig],
  { CI: "1" },
);
