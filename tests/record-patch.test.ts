import { describe, expect, it } from "vitest";
import {
  changedFields,
  patchRecordData,
  writeRecordDiff,
} from "@/lib/processes/record-patch";
import { createD1Fake, insertRecord, readData } from "./helpers/d1-fake";

const ref = { owner: "o1", kind: "settings", id: "s1" };

describe("record patch (json_set on owned fields)", () => {
  it("writes only the given fields and keeps concurrent edits", async () => {
    const { db, sqlite } = createD1Fake();
    insertRecord(sqlite, { ...ref, data: { name: "old", inboxPollCursor: 0 } });
    // A user edit lands while a long poll holds a stale copy.
    sqlite.prepare("UPDATE records SET data=json_set(data,'$.name','edited') WHERE id=?").run("s1");
    await patchRecordData(db, ref, { inboxPollCursor: 3 });
    expect(readData(sqlite, "s1")).toEqual({ name: "edited", inboxPollCursor: 3 });
  });

  it("stores arrays, objects, booleans and removes undefined keys", async () => {
    const { db, sqlite } = createD1Fake();
    insertRecord(sqlite, { ...ref, data: { a: 1, gone: "x" } });
    await patchRecordData(db, ref, {
      log: [{ at: "t", text: "hi" }],
      nested: { k: "v" },
      flag: false,
      gone: undefined,
    });
    expect(readData(sqlite, "s1")).toEqual({
      a: 1,
      log: [{ at: "t", text: "hi" }],
      nested: { k: "v" },
      flag: false,
    });
  });

  it("rejects unsafe field names", async () => {
    const { db, sqlite } = createD1Fake();
    insertRecord(sqlite, { ...ref, data: {} });
    await expect(patchRecordData(db, ref, { "a'),x": 1 })).rejects.toThrow(/field/);
  });

  it("does not touch another owner's row", async () => {
    const { db, sqlite } = createD1Fake();
    insertRecord(sqlite, { ...ref, data: { v: 1 } });
    const ok = await patchRecordData(db, { ...ref, owner: "o2" }, { v: 2 });
    expect(ok).toBe(false);
    expect(readData(sqlite, "s1")).toEqual({ v: 1 });
  });

  it("changedFields lists only changed and removed keys", () => {
    expect(
      changedFields({ a: 1, b: [1], c: "x", d: 1 }, { a: 1, b: [1, 2], c: "y" }),
    ).toEqual({ b: [1, 2], c: "y", d: undefined });
  });

  it("writeRecordDiff skips the query when nothing changed", async () => {
    const { db, sqlite } = createD1Fake();
    insertRecord(sqlite, { ...ref, data: { v: 1 } });
    expect(await writeRecordDiff(db, ref, { v: 1 }, { v: 1 })).toBe(true);
    await writeRecordDiff(db, ref, { v: 1 }, { v: 1, w: 2 });
    expect(readData(sqlite, "s1")).toEqual({ v: 1, w: 2 });
  });
});
