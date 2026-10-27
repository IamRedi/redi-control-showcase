import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { whiteLabelConfigSchema } from "../src/index.js";

describe("white-label configuration", () => {
  it("validates the default EN/DE/SQ configuration", async () => {
    const raw = await readFile(
      new URL("../../../config/white-label/default.json", import.meta.url),
      "utf8",
    );
    const parsed = whiteLabelConfigSchema.parse(JSON.parse(raw));
    expect(parsed.locales).toEqual(["en", "de", "sq"]);
    expect(parsed.availableLocales).toEqual(["en", "de", "sq", "it"]);
  });

  it("rejects a disabled default locale", () => {
    expect(() =>
      whiteLabelConfigSchema.parse({
        brand: {
          name: "Test",
          logoPath: null,
          faviconPath: null,
          colors: {
            primary: "#000000",
            background: "#000000",
            surface: "#000000",
          },
          fontFamily: "sans-serif",
        },
        locales: ["de"],
        availableLocales: ["en", "de"],
        defaultLocale: "en",
        modules: {},
        legal: { privacyUrl: null, termsUrl: null },
        support: { email: null },
      }),
    ).toThrow("defaultLocale must be enabled");
  });
});
