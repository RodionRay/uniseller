import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Текст сервиса `worker:` из docker-compose.yml (до следующего сервиса/секции верхнего уровня). */
function workerService(compose: string): string {
  const start = compose.indexOf("\n  worker:\n");
  expect(start).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const end = rest.search(/\n(?: {2}[a-z][\w-]*:\n|[a-z][\w-]*:)/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("docker-compose worker env", () => {
  const worker = workerService(read("docker-compose.yml"));

  it("does not load the whole .env into the worker", () => {
    expect(worker).not.toMatch(/^\s*env_file:/m);
  });

  it("passes only the worker's own variables, never app secrets", () => {
    for (const secret of [
      "SESSION_SECRET",
      "ENCRYPTION_KEY",
      "ADMIN_PASSWORD_HASH",
      "CLIENT_SECRET",
      "TELEGRAM_BOT_TOKEN",
      "CONTACT_BOT_TOKEN",
      "AI_API_KEY",
    ]) {
      expect(worker).not.toContain(secret);
    }
    expect(worker).toMatch(/TG_WORKER_TOKEN: \$\{TG_WORKER_TOKEN:\?/);
    expect(worker).toMatch(/CRON_SECRET: \$\{CRON_SECRET:\?/);
    expect(worker).toMatch(/APP_URL: http:\/\/web:5173/);
  });
});

describe("Caddyfile", () => {
  const caddy = read("deploy/Caddyfile");

  it("blocks /api/cron from outside before proxying", () => {
    const block = caddy.indexOf("respond @cron 404");
    expect(caddy).toMatch(/@cron path \/api\/cron \/api\/cron\/\*/);
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(caddy.indexOf("reverse_proxy"));
  });

  it("does not block the health endpoint", () => {
    expect(caddy).not.toMatch(/@\w+ path[^\n]*\/api\/health/);
  });
});
