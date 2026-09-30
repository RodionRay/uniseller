import { describe, expect, it } from "vitest";
import { advanceCursor, rotateFrom } from "@/lib/processes/round-robin";
import { mergeRefreshedSession } from "@/lib/processes/session-refresh";

describe("round-robin cursor", () => {
  it("rotates from the cursor and wraps", () => {
    expect(rotateFrom(["a", "b", "c", "d"], 2)).toEqual(["c", "d", "a", "b"]);
    expect(rotateFrom(["a", "b"], 5)).toEqual(["b", "a"]);
    expect(rotateFrom(["a", "b"], "junk")).toEqual(["a", "b"]);
    expect(rotateFrom([], 3)).toEqual([]);
  });

  it("advances by processed count so every item gets a turn", () => {
    const owners = ["o1", "o2", "o3", "o4", "o5"];
    const seen: string[] = [];
    let cursor = 0;
    for (let run = 0; run < 3; run++) {
      const batch = rotateFrom(owners, cursor).slice(0, 2);
      seen.push(...batch);
      cursor = advanceCursor(cursor, batch.length, owners.length);
    }
    expect(new Set(seen)).toEqual(new Set(owners));
    expect(advanceCursor(4, 0, 5)).toBe(4);
    expect(advanceCursor(1, 3, 0)).toBe(0);
  });
});

describe("refreshed session merge", () => {
  const stored = { kind: "tdata", zipBase64: "OLD", twoFA: "pw", apiId: 1, apiHash: "h" };

  it("accepts a bare string as new zip material", () => {
    expect(mergeRefreshedSession(stored, "NEW")).toEqual({ ...stored, zipBase64: "NEW" });
  });

  it("merges known fields from an object and maps format to kind", () => {
    expect(
      mergeRefreshedSession(stored, { zipBase64: "NEW", format: "session", evil: "x" }),
    ).toEqual({ ...stored, zipBase64: "NEW", kind: "session" });
  });

  it("ignores absent or unusable payloads", () => {
    expect(mergeRefreshedSession(stored, undefined)).toBeNull();
    expect(mergeRefreshedSession(stored, "")).toBeNull();
    expect(mergeRefreshedSession(stored, { kind: "session" })).toBeNull();
    expect(mergeRefreshedSession(stored, 42)).toBeNull();
  });
});
