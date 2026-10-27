import { describe, expect, it } from "vitest";

import { parsePilotOverview } from "../app/pilot-showcase-contract";

const valid = {
  workspace: { displayName: "Aurora Media" },
  counts: {
    readyMedia: 4,
    socialAccounts: 2,
    healthySocialAccounts: 1,
    draftPosts: 3,
    scheduledPosts: 1,
    pendingApprovals: 2,
  },
  channels: [
    { name: "website", status: "not_connected" },
    { name: "facebook", status: "connected" },
    { name: "instagram", status: "needs_attention" },
  ],
  activity: [
    { action: "content.created", occurredAt: "2026-09-01T12:00:00.000Z" },
  ],
};

describe("pilot showcase contract", () => {
  it("accepts the bounded verified dashboard projection", () => {
    expect(parsePilotOverview(valid)).toEqual(valid);
  });

  it("rejects unknown provider and status values", () => {
    expect(
      parsePilotOverview({
        ...valid,
        channels: [{ name: "telegram", status: "connected" }],
      }),
    ).toBeNull();
    expect(
      parsePilotOverview({
        ...valid,
        channels: [{ name: "instagram", status: "live" }],
      }),
    ).toBeNull();
  });

  it("rejects unsafe counts, invalid dates and unbounded collections", () => {
    expect(
      parsePilotOverview({
        ...valid,
        counts: { ...valid.counts, readyMedia: -1 },
      }),
    ).toBeNull();
    expect(
      parsePilotOverview({
        ...valid,
        activity: [{ action: "created", occurredAt: "not-a-date" }],
      }),
    ).toBeNull();
    expect(
      parsePilotOverview({
        ...valid,
        channels: Array(13).fill(valid.channels[0]),
      }),
    ).toBeNull();
  });
});
