import { readFileSync } from "node:fs";
import { editorialConfigSchema } from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("universal editorial profile contract", () => {
  it("accepts the AuroraMedia pilot as ordinary configuration", () => {
    const preset = JSON.parse(
      readFileSync(
        new URL(
          "../../../config/media-profiles/aurora-media.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { editorialConfig: unknown };
    const parsed = editorialConfigSchema.parse(preset.editorialConfig);
    expect(parsed.sections).toHaveLength(10);
    expect(parsed.sections.find((section) => section.satire)?.enabled).toBe(
      false,
    );
    expect(parsed.verification.allowUnverifiedAsConfirmed).toBe(false);
    expect(parsed.style.readability).toBe("general");
    expect(parsed.style.terminologyRules.join(" ")).toContain("terminologjinë");
    expect(parsed.style.languageQuality.targetLocale).toBe("sq-AL");
    expect(parsed.style.languageQuality.forbidInternalIdentifiers).toBe(true);
    expect(parsed.style.languageQuality.glossary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ preferredTerm: "poli jugor i Hënës" }),
      ]),
    );
    expect(parsed.verification.scientific.requireLimitations).toBe(true);
    expect(parsed.verification.scientific.distinguishPeerReview).toBe(true);
  });

  it("fails closed when critical safety policies are weakened", () => {
    const preset = JSON.parse(
      readFileSync(
        new URL(
          "../../../config/media-profiles/aurora-media.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { editorialConfig: Record<string, unknown> };
    expect(
      editorialConfigSchema.safeParse({
        ...preset.editorialConfig,
        verification: {
          ...(preset.editorialConfig.verification as object),
          allowUnverifiedAsConfirmed: true,
        },
      }).success,
    ).toBe(false);
  });
  it("keeps pilot identity out of universal engine branches", () => {
    const core = [
      "../src/index.ts",
      "../../evidence-intelligence/src/index.ts",
      "../../ai-gateway/src/index.ts",
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n");
    expect(core).not.toContain("PrivateCustomer");
  });
});
