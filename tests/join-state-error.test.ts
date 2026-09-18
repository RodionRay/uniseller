import { describe, expect, it } from "vitest";
import { z } from "zod";

/** Зеркало схемы joinStateError из app/api/workspace/route.ts */
const joinStateErrorSchema = z
  .preprocess((v) => {
    if (v == null) return "";
    if (typeof v === "object") return "";
    return String(v).slice(0, 500);
  }, z.string().max(500))
  .default("");

describe("joinStateError schema", () => {
  it("принимает строку и режет длиннее 500", () => {
    expect(joinStateErrorSchema.parse("ok")).toBe("ok");
    expect(joinStateErrorSchema.parse("x".repeat(600)).length).toBe(500);
  });

  it("чистит null/object (битый JSON от старого set_group_join_state)", () => {
    expect(joinStateErrorSchema.parse(null)).toBe("");
    expect(joinStateErrorSchema.parse({ _def: "zod" })).toBe("");
    expect(joinStateErrorSchema.parse(undefined)).toBe("");
  });

  it("parse set_group_join_state: строка из body", () => {
    const parsed = z.string().max(500).parse(String("PEER_FLOOD".slice(0, 500)));
    expect(parsed).toBe("PEER_FLOOD");
  });
});
