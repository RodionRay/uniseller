// Shared runner for the local-D1 wrangler commands (start, migrate, baseline, backup).
// D1 lives in a persist dir: `.wrangler/state` for local dev, `/data/wrangler` in Docker.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const wranglerConfig = path.join(projectRoot, "dist/server/wrangler.json");
const wranglerBin = path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js");

export function persistDir() {
  return path.resolve(projectRoot, process.env.D1_PERSIST_DIR?.trim() || ".wrangler/state");
}

/** Directory where miniflare keeps the D1 sqlite (file name = hash of database_id). */
export function d1SqliteDir(root = persistDir()) {
  return path.join(root, "v3/d1/miniflare-D1DatabaseObject");
}

/** The one D1 sqlite file under the persist dir; throws when missing or ambiguous. */
export function locateD1File(root = persistDir()) {
  const dir = d1SqliteDir(root);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  } catch {
    files = [];
  }
  if (files.length !== 1) {
    throw new Error(`Expected exactly one D1 sqlite file in ${dir}, found: ${files.sort().join(", ") || "none"}`);
  }
  return path.join(dir, files[0]);
}

export function assertBuilt() {
  if (!existsSync(wranglerConfig)) {
    console.error(`Missing ${wranglerConfig}. Run \`npm run build\` first.`);
    process.exit(1);
  }
}

function wranglerEnv() {
  return {
    ...process.env,
    CLOUDFLARE_CF_FETCH_ENABLED: process.env.CLOUDFLARE_CF_FETCH_ENABLED || "false",
    WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS || "false",
    WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS || "false",
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || path.join(projectRoot, ".wrangler/logs"),
    WRANGLER_REGISTRY_PATH:
      process.env.WRANGLER_REGISTRY_PATH || path.join(projectRoot, ".wrangler/dev-registry"),
    MINIFLARE_REGISTRY_PATH:
      process.env.MINIFLARE_REGISTRY_PATH || path.join(projectRoot, ".wrangler/registry"),
  };
}

/** Runs wrangler with inherited stdio; exits the process on failure. */
export function runWrangler(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...wranglerEnv(), ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Executes SQL against the local D1 and returns the result rows. */
export function queryLocalD1(sql) {
  const result = spawnSync(
    process.execPath,
    [
      wranglerBin, "d1", "execute", "DB", "--local",
      "--persist-to", persistDir(), "--config", wranglerConfig, "--json", "--command", sql,
    ],
    { cwd: projectRoot, encoding: "utf8", env: { ...wranglerEnv(), CI: "1" } },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results ?? [];
}
