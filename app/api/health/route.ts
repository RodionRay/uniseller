import { pingDatabase } from "@/lib/db";
import { readEnv, validateEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const WORKER_TIMEOUT_MS = 3_000;

type WorkerStatus = "up" | "down" | "unconfigured";

async function probeWorker(): Promise<WorkerStatus> {
  const base = readEnv("TELEGRAM_WORKER_URL");
  if (!base) return "unconfigured";
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    return res.ok ? "up" : "down";
  } catch {
    return "down";
  }
}

/**
 * Readiness report: D1, required env (names only, never values) and the Telegram
 * worker. `?scope=self` skips the worker probe — the web container's own Docker
 * HEALTHCHECK uses it so a worker outage does not mark the web container unhealthy.
 */
export async function GET(req: Request) {
  const selfOnly = new URL(req.url).searchParams.get("scope") === "self";
  const [db, worker] = await Promise.all([
    pingDatabase(),
    selfOnly ? Promise.resolve(null) : probeWorker(),
  ]);
  const config = validateEnv();
  const ok = db && config.ok && (worker === null || worker === "up");
  return Response.json(
    {
      ok,
      db: db ? "up" : "down",
      config,
      ...(worker === null ? {} : { worker }),
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
