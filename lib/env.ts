/**
 * Server environment: one reader for process env + Cloudflare bindings, and the
 * validation of the variables production cannot run without (REQ-C2).
 * Validation reports variable NAMES only — never values.
 */

export type EnvReader = (name: string) => string | undefined;

export function readEnv(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require("cloudflare:workers") as {
      env: Record<string, string | undefined>;
    };
    return env[name]?.trim();
  } catch {
    return undefined;
  }
}

type Rule = (value: string) => boolean;

const HEX_64 = /^[0-9a-fA-F]{64}$/;
const MIN_SESSION_SECRET_LENGTH = 32;
/** The worker refuses a shorter TG_WORKER_TOKEN and the cron route a shorter CRON_SECRET. */
const MIN_SHARED_SECRET_LENGTH = 32;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Variables the web app refuses to call healthy without, with their format rule. */
export const REQUIRED_ENV: Readonly<Record<string, Rule>> = {
  ENCRYPTION_KEY: (v) => HEX_64.test(v),
  SESSION_SECRET: (v) => v.length >= MIN_SESSION_SECRET_LENGTH,
  TG_WORKER_TOKEN: (v) => v.length >= MIN_SHARED_SECRET_LENGTH,
  CRON_SECRET: (v) => v.length >= MIN_SHARED_SECRET_LENGTH,
  APP_URL: isHttpUrl,
};

export type EnvReport = {
  ok: boolean;
  missing: string[];
  invalid: string[];
};

export function validateEnv(read: EnvReader = readEnv): EnvReport {
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const [name, isValid] of Object.entries(REQUIRED_ENV)) {
    const value = read(name);
    if (!value) missing.push(name);
    else if (!isValid(value)) invalid.push(name);
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/** Self-registration is closed unless the owner opts in with REGISTRATION_OPEN=true. */
export function registrationOpen(read: EnvReader = readEnv): boolean {
  return read("REGISTRATION_OPEN")?.toLowerCase() === "true";
}

/**
 * Public origin of the app from APP_URL. Behind a reverse proxy `req.url` carries
 * the internal host, so origin checks and OAuth callbacks must use this instead.
 */
export function appOrigin(read: EnvReader = readEnv): string | null {
  const raw = read("APP_URL");
  if (!raw || !isHttpUrl(raw)) return null;
  return new URL(raw).origin;
}

/** Origin to trust for same-origin checks and absolute redirects. */
export function requestOrigin(req: Request, read: EnvReader = readEnv): string {
  return appOrigin(read) ?? new URL(req.url).origin;
}

/** Rejects cross-site requests: a present Origin header must equal the app origin. */
export function isSameOriginRequest(req: Request, read: EnvReader = readEnv): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === requestOrigin(req, read) || origin === new URL(req.url).origin;
}
