import { describe, expect, it } from "vitest";
import { safeRelativeReturnPath } from "@/lib/auth";

describe("safeRelativeReturnPath open redirect (finding 2)", () => {
  const offOrigin = [
    "/.//evil.com",
    "/..//evil.com",
    "/./..//evil.com/x",
    "/%2e//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
  ];
  for (const vector of offOrigin) {
    it(`rejects ${JSON.stringify(vector)}`, () => {
      const out = safeRelativeReturnPath(vector);
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(out).not.toContain("\\");
      expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    });
  }

  it("keeps a normal in-app path with query and hash", () => {
    expect(safeRelativeReturnPath("/app/leads?x=1#top")).toBe("/app/leads?x=1#top");
  });

  it("sends auth pages to /app", () => {
    expect(safeRelativeReturnPath("/login")).toBe("/app");
  });
});
