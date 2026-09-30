#!/usr/bin/env node
// Serves the built app with wrangler (workerd) against the local D1 persist dir.
// HOST defaults to loopback; the Docker image sets HOST=0.0.0.0 and publishes the
// port on the host's 127.0.0.1 only, behind Caddy.
import { existsSync } from "node:fs";
import path from "node:path";
import { assertBuilt, persistDir, projectRoot, runWrangler, wranglerConfig } from "./wrangler-local.mjs";

assertBuilt();
const host = process.env.HOST?.trim() || "127.0.0.1";
const port = process.env.PORT?.trim() || "5173";
const envFile = path.join(projectRoot, ".env");
runWrangler(
  [
    "dev", "--config", wranglerConfig, "--local", "--persist-to", persistDir(),
    "--ip", host, "--port", port, "--inspector-port", "0",
    ...(existsSync(envFile) ? ["--env-file", envFile] : []),
    ...process.argv.slice(2),
  ],
  // Docker passes secrets as process env (compose env_file), not as a file.
  { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" },
);
