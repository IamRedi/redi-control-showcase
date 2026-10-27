import { describe, expect, it } from "vitest";

import {
  parseVideoGenerationPolicyEnvelope,
  parseVideoIntelligenceSnapshot,
} from "../app/video-intelligence-contract.js";

const valid = {
  workspace: {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Aurora Media",
  },
  package: {
    id: "media_team",
    displayName: "Media Team",
    planningIncluded: true,
    generationAddOn: "not_configured",
  },
  safety: {
    externalProviderExecutionAvailable: false,
    automaticPublishingAvailable: false,
    privateMessageContentSentToModels: false,
    humanApprovalRequired: true,
  },
  programs: [
    {
      id: "product_faq_ads",
      sourceMode: "audience_signals",
      cadence: "weekly",
      outputs: ["portrait", "landscape"],
      status: "foundation_only",
    },
    {
      id: "daily_news_flash",
      sourceMode: "approved_editorial_content",
      cadence: "daily_evening",
      outputs: ["portrait", "landscape"],
      status: "foundation_only",
    },
  ],
  workflow: [
    { stage: "signals", status: "available" },
    { stage: "brief", status: "available" },
    { stage: "script", status: "available" },
    { stage: "render", status: "blocked" },
    { stage: "review", status: "available" },
    { stage: "distribution", status: "blocked" },
  ],
  integrations: [
    { id: "audience_listening", status: "not_connected" },
    { id: "heygen", status: "not_connected" },
    { id: "distribution", status: "not_connected" },
  ],
  distributionTargets: [],
  briefs: [],
};

describe("Video Intelligence response contract", () => {
  it("accepts the exact fail-closed foundation", () => {
    expect(parseVideoIntelligenceSnapshot(valid)).not.toBeNull();
  });

  it("rejects fake provider readiness and approval bypass", () => {
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        safety: {
          ...valid.safety,
          externalProviderExecutionAvailable: true,
        },
      }),
    ).toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        safety: { ...valid.safety, humanApprovalRequired: false },
      }),
    ).toBeNull();
  });

  it("rejects mixed program purposes and unblocked distribution", () => {
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        programs: [valid.programs[0], valid.programs[0]],
      }),
    ).toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        workflow: valid.workflow.map((step) =>
          step.stage === "distribution"
            ? { ...step, status: "available" }
            : step,
        ),
      }),
    ).toBeNull();
  });

  it("accepts exact governed briefs and rejects approval-state mismatch", () => {
    const brief = {
      id: "22222222-2222-4222-8222-222222222222",
      programId: "daily_news_flash",
      topic: "Daily headlines",
      objective: "Summarize the approved stories for the evening bulletin.",
      audience: "General news audience",
      status: "review_required",
      currentRevision: 2,
      script:
        "A sufficiently long approved-newsroom script for the daily video.",
      scriptHash: "a".repeat(64),
      createdAt: "2026-08-31T17:00:00.000Z",
      updatedAt: "2026-08-31T18:00:00.000Z",
      evidence: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "approved_editorial_story",
          title: "Approved lead story",
          sourceReference: "editorial-story-42",
          summary:
            "The newsroom approved this story for publication and reuse.",
          aggregateCount: null,
        },
      ],
      approval: {
        decision: "pending",
        requestedAt: "2026-08-31T18:00:00.000Z",
        decidedAt: null,
        reason: null,
        requestedByCurrentUser: false,
      },
      renderPreparation: null,
      renderedAssets: [],
    };
    expect(
      parseVideoIntelligenceSnapshot({ ...valid, briefs: [brief] }),
    ).not.toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        briefs: [{ ...brief, status: "approved" }],
      }),
    ).toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        briefs: [
          {
            ...brief,
            status: "approved",
            approval: {
              ...brief.approval,
              decision: "approved",
              decidedAt: "2026-08-31T18:10:00.000Z",
            },
            renderPreparation: {
              id: "44444444-4444-4444-8444-444444444444",
              presentationMode: "news_anchor",
              targetLanguage: "sq",
              maxDurationSeconds: 90,
              rightsReference: "rights/news-anchor/default-v1",
              outputs: ["9:16", "16:9"],
              status: "blocked",
              blockCode: "provider_not_accepted",
              requestedAt: "2026-08-31T18:20:00.000Z",
              requestedByCurrentUser: true,
            },
            renderedAssets: [
              {
                jobId: "55555555-5555-4555-8555-555555555555",
                mediaAssetId: "66666666-6666-4666-8666-666666666666",
                aspectRatio: "9:16",
                filename: "verified-output.mp4",
                mimeType: "video/mp4",
                sizeBytes: 2048,
                checksumSha256: "b".repeat(64),
                width: 1080,
                height: 1920,
                durationMs: 30000,
                completedAt: "2026-08-31T18:30:00.000Z",
                review: {
                  decision: "pending",
                  requestedAt: "2026-08-31T18:30:00.000Z",
                  decidedAt: null,
                  reason: null,
                  requestedByCurrentUser: true,
                },
                distributionDraft: null,
                websiteContent: null,
              },
            ],
          },
        ],
      }),
    ).not.toBeNull();
    const approvedAsset = {
      jobId: "55555555-5555-4555-8555-555555555555",
      mediaAssetId: "66666666-6666-4666-8666-666666666666",
      aspectRatio: "9:16",
      filename: "verified-output.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      checksumSha256: "b".repeat(64),
      width: 1080,
      height: 1920,
      durationMs: 30000,
      completedAt: "2026-08-31T18:30:00.000Z",
      review: {
        decision: "approved",
        requestedAt: "2026-08-31T18:30:00.000Z",
        decidedAt: "2026-08-31T18:40:00.000Z",
        reason: null,
        requestedByCurrentUser: true,
      },
      distributionDraft: {
        id: "77777777-7777-4777-8777-777777777777",
        status: "draft",
        createdAt: "2026-08-31T18:45:00.000Z",
      },
      websiteContent: null,
    };
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        distributionTargets: [
          {
            accountId: "88888888-8888-4888-8888-888888888888",
            channel: "instagram",
            displayName: "AuroraMedia Instagram",
            status: "active",
            draftEligible: true,
          },
        ],
        briefs: [
          {
            ...brief,
            status: "approved",
            approval: {
              ...brief.approval,
              decision: "approved",
              decidedAt: "2026-08-31T18:10:00.000Z",
            },
            renderPreparation: {
              id: "44444444-4444-4444-8444-444444444444",
              presentationMode: "news_anchor",
              targetLanguage: "sq",
              maxDurationSeconds: 90,
              rightsReference: "rights/news-anchor/default-v1",
              outputs: ["9:16"],
              status: "blocked",
              blockCode: "provider_not_accepted",
              requestedAt: "2026-08-31T18:20:00.000Z",
              requestedByCurrentUser: true,
            },
            renderedAssets: [approvedAsset],
          },
        ],
      }),
    ).not.toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        distributionTargets: [
          {
            accountId: "88888888-8888-4888-8888-888888888888",
            channel: "instagram",
            displayName: "AuroraMedia Instagram",
            status: "revoked",
            draftEligible: true,
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        briefs: [
          {
            ...brief,
            status: "rejected",
            approval: {
              ...brief.approval,
              decision: "rejected",
              decidedAt: "2026-08-31T18:10:00.000Z",
            },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseVideoIntelligenceSnapshot({
        ...valid,
        briefs: [
          {
            ...brief,
            evidence: [
              {
                ...brief.evidence[0],
                kind: "verified_product_fact",
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("Video generation policy response contract", () => {
  const policy = {
    providerId: "heygen",
    dailyCreditLimit: 20,
    monthlyCreditLimit: 200,
    maximumConcurrency: 2,
    billingTimezone: "UTC",
    enabled: false,
    dailyReserved: 3,
    monthlyReserved: 12,
    activeJobs: 1,
  };

  it("accepts absent and exact internal guardrails", () => {
    expect(parseVideoGenerationPolicyEnvelope({ policy: null })).toEqual({
      policy: null,
    });
    expect(parseVideoGenerationPolicyEnvelope({ policy })).toEqual({ policy });
  });

  it("rejects malformed, contradictory and expanded policy claims", () => {
    expect(
      parseVideoGenerationPolicyEnvelope({
        policy: { ...policy, monthlyCreditLimit: 10 },
      }),
    ).toBeNull();
    expect(
      parseVideoGenerationPolicyEnvelope({
        policy: { ...policy, providerConnected: true },
      }),
    ).toBeNull();
    expect(
      parseVideoGenerationPolicyEnvelope({
        policy: { ...policy, billingTimezone: "Europe/Berlin" },
      }),
    ).toBeNull();
  });
});
