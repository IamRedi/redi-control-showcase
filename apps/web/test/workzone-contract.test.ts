import { describe, expect, it } from "vitest";

import { parseWorkzoneSnapshot } from "../app/workzone-contract.js";

const valid = {
  workspace: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Aurora Media",
  },
  pipeline: {
    research: 3,
    drafting: 2,
    review: 1,
    scheduled: 0,
    deliveryExceptions: 0,
  },
  resources: { readyMedia: 4, teamMembers: 5 },
  channels: [
    { name: "website", status: "not_connected" },
    { name: "facebook", status: "not_connected" },
    { name: "instagram", status: "not_connected" },
    { name: "youtube", status: "planned" },
    { name: "tiktok", status: "planned" },
  ],
  models: {
    externalExecutionAvailable: false,
    routes: [
      {
        operation: "editorial_transformation",
        model: "editorial-model",
        promptVersion: "v1",
        maxOutputTokens: 1200,
        enabled: true,
        providerId: "must-not-be-projected",
      },
    ],
  },
};

describe("Media Workzone response contract", () => {
  it("accepts a bounded snapshot and projects no provider identifier", () => {
    const snapshot = parseWorkzoneSnapshot(valid);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.models.routes[0]).toEqual({
      operation: "editorial_transformation",
      model: "editorial-model",
      promptVersion: "v1",
      maxOutputTokens: 1200,
      enabled: true,
    });
    expect(snapshot?.models.routes[0]).not.toHaveProperty("providerId");
  });

  it("fails closed for duplicate channels and claimed external execution", () => {
    expect(
      parseWorkzoneSnapshot({
        ...valid,
        channels: [valid.channels[0], ...valid.channels.slice(0, 4)],
      }),
    ).toBeNull();
    expect(
      parseWorkzoneSnapshot({
        ...valid,
        models: { ...valid.models, externalExecutionAvailable: true },
      }),
    ).toBeNull();
  });
});
