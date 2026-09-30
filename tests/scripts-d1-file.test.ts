import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { d1SqliteDir, locateD1File } from "../scripts/wrangler-local.mjs";

function persistWith(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "d1-persist-"));
  const dir = d1SqliteDir(root);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "");
  return root;
}

describe("locateD1File", () => {
  it("returns the single D1 sqlite file, ignoring metadata and WAL siblings", () => {
    const root = persistWith(["abc.sqlite", "abc.sqlite-wal", "metadata.sqlite", "metadata.sqlite-shm"]);
    expect(locateD1File(root)).toBe(join(d1SqliteDir(root), "abc.sqlite"));
  });

  it("throws when the persist dir has no D1 database yet", () => {
    const root = mkdtempSync(join(tmpdir(), "d1-empty-"));
    expect(() => locateD1File(root)).toThrow(/found: none/);
  });

  it("throws when several databases make the choice ambiguous", () => {
    expect(() => locateD1File(persistWith(["a.sqlite", "b.sqlite"]))).toThrow(/a\.sqlite, b\.sqlite/);
  });
});
