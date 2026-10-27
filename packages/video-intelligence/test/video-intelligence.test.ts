import { describe, expect, it } from "vitest";

import { videoPrograms, videoWorkflow } from "../src/index.js";

describe("Video Intelligence foundation policy", () => {
  it("keeps the two programs separate and bounded", () => {
    expect(videoPrograms.map((program) => program.id)).toEqual([
      "product_faq_ads",
      "daily_news_flash",
    ]);
    expect(videoPrograms.every((program) => program.outputs.length === 2)).toBe(
      true,
    );
  });

  it("blocks render and distribution while preserving human review", () => {
    expect(videoWorkflow).toEqual([
      { stage: "signals", status: "available" },
      { stage: "brief", status: "available" },
      { stage: "script", status: "available" },
      { stage: "render", status: "blocked" },
      { stage: "review", status: "available" },
      { stage: "distribution", status: "blocked" },
    ]);
  });
});
