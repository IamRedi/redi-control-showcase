import { describe, expect, it } from "vitest";

import { localizedLoginHref } from "../app/auth-navigation-contract.js";

describe("localized authentication navigation", () => {
  it("builds an encoded same-origin return destination", () => {
    expect(localizedLoginHref("sq", "/workzone/board")).toBe(
      "/auth/login?returnTo=%2Fsq%2Fworkzone%2Fboard",
    );
    expect(localizedLoginHref("de")).toBe("/auth/login?returnTo=%2Fde");
  });

  it("rejects a non-local suffix", () => {
    expect(() => localizedLoginHref("en", "https://evil.invalid")).toThrow();
    expect(() => localizedLoginHref("en", "//evil.invalid")).toThrow();
  });
});
