/**
 * Версия воркера = хэш исходников. dev-local сравнивает её с /health,
 * чтобы не переиспользовать процесс со старым кодом.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILE = /\.(mjs|py)$/;

export function computeWorkerVersion(srcDir) {
  const hash = createHash("sha256");
  for (const name of readdirSync(srcDir).filter((n) => SOURCE_FILE.test(n)).sort()) {
    hash.update(name);
    hash.update(readFileSync(join(srcDir, name)));
  }
  return hash.digest("hex").slice(0, 12);
}
