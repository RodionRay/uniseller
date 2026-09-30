import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync,
}));

import { queryLocalD1, runWrangler } from "../scripts/wrangler-local.mjs";

const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

type SpawnOptions = { env: Record<string, string | undefined> };
const spawnedEnv = () => (spawnSync.mock.calls.at(-1)?.[2] as SpawnOptions).env;

// Wrangler 4.92 serves miniflare's Local Explorer (/cdn-cgi/explorer, raw SQL on D1) unless
// X_LOCAL_EXPLORER=false; anyone reaching web:5173 with `Host: localhost` could use it.
describe("miniflare Local Explorer stays off", () => {
  beforeEach(() => {
    vi.stubEnv("X_LOCAL_EXPLORER", "true");
    spawnSync.mockReturnValue({ status: 0, stdout: "[]", stderr: "" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("disables it for wrangler dev/migrate even when the process env enables it", () => {
    runWrangler(["dev"], { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" });
    expect(spawnedEnv().X_LOCAL_EXPLORER).toBe("false");
  });

  it("disables it for local D1 queries", () => {
    queryLocalD1("select 1");
    expect(spawnedEnv().X_LOCAL_EXPLORER).toBe("false");
  });

  it("disables it in the web image and the local dev runner", () => {
    const webStage = read("Dockerfile").split("# ---------- worker ----------")[0];
    expect(webStage).toMatch(/^ENV X_LOCAL_EXPLORER=false$/m);
    expect(read("scripts/dev-local.mjs")).toMatch(/X_LOCAL_EXPLORER: "false"/);
  });

  it("hides every /cdn-cgi path at the public proxy", () => {
    expect(read("deploy/Caddyfile")).toMatch(/^\s*respond \/cdn-cgi\/\* 404$/m);
  });
});
