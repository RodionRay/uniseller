import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Фейковый «python» для тестов воркера: node-скрипт с тем же контрактом
 * (payload JSON в stdin, последняя строка stdout — JSON-ответ).
 * Режим — payload.mode; FAKE_PY_CRASH=1 — выход до чтения stdin.
 */
const FAKE_SOURCE = String.raw`
import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

if (process.env.FAKE_PY_CRASH === "1") {
  process.stderr.write("boom before stdin\n");
  process.exit(3);
}
const work = process.env.UNISELLER_WORK_DIR;
if (work) writeFileSync(join(work, "decrypted.session"), "secret");

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  const p = JSON.parse(raw || "{}");
  const mode = p.mode || "echo";
  if (mode === "echo") {
    console.log(JSON.stringify({ ok: true, action: p.action, work }));
  } else if (mode === "big") {
    process.stdout.write("x".repeat(2 * 1024 * 1024) + "\n");
  } else if (mode === "hang") {
    setInterval(() => {}, 1000);
  } else if (mode === "hang-ignore-term") {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  } else if (mode === "no-json") {
    process.stderr.write("Traceback: kaboom\n");
    process.exit(1);
  } else if (mode === "sleep") {
    const dir = p.trackDir;
    mkdirSync(dir, { recursive: true });
    const me = join(dir, String(process.pid));
    writeFileSync(me, "");
    const running = readdirSync(dir).length;
    await new Promise((r) => setTimeout(r, p.ms || 300));
    rmSync(me);
    console.log(JSON.stringify({ ok: true, running, account: p.accountId }));
  }
});
`;

export function writeFakePython(): { dir: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), "worker-test-"));
  const script = join(dir, "fake-python.mjs");
  writeFileSync(script, FAKE_SOURCE);
  return { dir, script };
}
