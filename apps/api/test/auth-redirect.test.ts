import { describe, expect, it } from "vitest";

import { normalizePostLoginPath } from "../src/auth-redirect.js";

describe("post-login redirect contract", () => {
  it("accepts only enabled locale paths and preserves a local query", () => {
    expect(normalizePostLoginPath("/sq/workzone/board")).toBe(
      "/sq/workzone/board",
    );
    expect(normalizePostLoginPath("/de/content?view=review")).toBe(
      "/de/content?view=review",
    );
    expect(normalizePostLoginPath("/en")).toBe("/en");
  });

  it.each([
    undefined,
    "",
    "/",
    "/it/workzone",
    "https://evil.invalid/sq",
    "//evil.invalid/sq",
    "/sq\\workzone",
    "/sq/%5c%5cevil.invalid",
    "/sq/workzone#fragment",
  ])("falls back safely for an invalid destination: %s", (value) => {
    expect(normalizePostLoginPath(value)).toBe("/");
  });
});
