import { describe, expect, it } from "vitest";
import { parseModelStudioSnapshot } from "../app/model-studio-contract.js";

const valid = {
  workspace: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Aurora Media",
  },
  activationControlsAvailable: false,
  runtimeRoutes: [
    {
      operation: "claim_extraction",
      providerId: "fixture",
      model: "model-a",
      promptVersion: "v1",
      maxOutputTokens: 1000,
      enabled: true,
    },
  ],
  budget: {
    dailyCostLimit: 10,
    monthlyCostLimit: 100,
    maximumConcurrency: 2,
    enabled: true,
    dailyUsed: 1,
    monthlyUsed: 5,
    running: 0,
  },
  proposals: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      operation: "editorial_image_generation",
      providerId: "candidate",
      model: "image-a",
      promptVersion: "image-v1",
      maxOutputTokens: 1200,
      dataPolicyStatus: "unreviewed",
      rationale: "Evaluate safely",
      createdAt: "2026-08-28T10:00:00.000Z",
      latestEvaluation: null,
    },
  ],
};

describe("Model Studio response contract", () => {
  it("accepts a bounded fail-closed snapshot", () =>
    expect(parseModelStudioSnapshot(valid)).not.toBeNull());
  it("rejects activation controls and malformed evaluation evidence", () => {
    expect(
      parseModelStudioSnapshot({ ...valid, activationControlsAvailable: true }),
    ).toBeNull();
    expect(
      parseModelStudioSnapshot({
        ...valid,
        proposals: [
          {
            ...valid.proposals[0],
            latestEvaluation: {
              id: "33333333-3333-4333-8333-333333333333",
              datasetVersion: "set-v1",
              sampleSize: 20,
              schemaPassRate: 101,
              groundingPassRate: 90,
              safetyPassRate: 90,
              languagePassRate: 90,
              decision: "passed",
              notes: "",
              evaluatedAt: "2026-08-28T10:00:00.000Z",
            },
          },
        ],
      }),
    ).toBeNull();
  });
});
