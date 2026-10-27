import { describe, expect, it } from "vitest";

import {
  parseCreateSocialDraftInput,
  parseSocialAccounts,
  parseSocialDrafts,
  parseSocialMedia,
  parseSocialProviders,
  parseSocialPreflight,
  parseSocialPublications,
  parseSocialWorkflowAction,
  parseSocialWorkflowDetail,
} from "../app/social-contract.js";

describe("Social Control response contracts", () => {
  it("accepts only bounded provider capability data", () => {
    expect(
      parseSocialProviders({
        providers: [
          {
            id: "meta",
            displayName: "Meta",
            configured: false,
            capabilities: [
              { id: "facebook.page.discover", mode: "read", risk: "low" },
            ],
          },
        ],
      }),
    ).toHaveLength(1);
    expect(
      parseSocialProviders({
        providers: [
          {
            id: "unknown",
            displayName: "Unknown",
            configured: true,
            capabilities: [],
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects malformed account data and never requires provider IDs", () => {
    const account = {
      id: "account-id",
      provider: "meta",
      account_type: "facebook_page",
      display_name: "News Page",
      authorized_scopes: ["pages.show-list"],
      token_expires_at: null,
      refresh_status: "current",
      status: "active",
      health_status: "healthy",
      last_synced_at: null,
      last_successful_publish_at: null,
    };
    expect(parseSocialAccounts({ accounts: [account] })).toEqual([account]);
    expect(
      parseSocialAccounts({
        accounts: [{ ...account, authorized_scopes: ["valid", 123] }],
      }),
    ).toBeNull();
  });

  it("validates media and current draft projections", () => {
    expect(
      parseSocialMedia({
        assets: [
          {
            id: "asset-id",
            original_filename: "photo.jpg",
            status: "ready",
            mime_type: "image/jpeg",
            width: 1200,
            height: 630,
            duration_ms: null,
          },
        ],
      }),
    ).toEqual([
      {
        id: "asset-id",
        filename: "photo.jpg",
        status: "ready",
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        durationMs: null,
      },
    ]);
    expect(
      parseSocialDrafts({
        drafts: [
          {
            id: "draft-id",
            currentRevision: 2,
            status: "ready_for_review",
            scheduledFor: null,
            scheduleTimezone: null,
            createdAt: "2026-08-24T10:00:00.000Z",
            updatedAt: "2026-08-24T11:00:00.000Z",
            content: {
              title: "Launch",
              caption: "Caption",
              description: null,
              mediaAttachments: [{ assetId: "asset-id", order: 0 }],
            },
            targets: [
              {
                id: "target-id",
                accountId: "account-id",
                accountName: "News Page",
                channel: "facebook",
                status: "queued",
              },
            ],
            approval: {
              decision: "pending",
              requestedAt: "2026-08-24T11:00:00.000Z",
              requestedByCurrentUser: true,
              decidedAt: null,
              reason: null,
            },
          },
        ],
      })?.[0],
    ).toMatchObject({
      currentRevision: 2,
      content: { mediaAssetIds: ["asset-id"] },
      targets: [{ channel: "facebook" }],
      approval: { decision: "pending" },
    });
  });

  it("accepts only bounded draft creation input", () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const accountId = "22222222-2222-4222-8222-222222222222";
    const mediaAssetId = "33333333-3333-4333-8333-333333333333";
    expect(
      parseCreateSocialDraftInput({
        workspaceId,
        accountIds: [accountId],
        mediaAssetIds: [mediaAssetId],
        caption: "  governed draft  ",
        tenantId: "attacker",
      }),
    ).toEqual({
      workspaceId,
      accountIds: [accountId],
      mediaAssetIds: [mediaAssetId],
      caption: "governed draft",
    });
    expect(
      parseCreateSocialDraftInput({
        workspaceId,
        accountIds: [],
        mediaAssetIds: [mediaAssetId],
        caption: "invalid",
      }),
    ).toBeNull();
  });

  it("validates immutable revision comparison and workflow permissions", () => {
    const detail = parseSocialWorkflowDetail({
      draft: {
        id: "draft-id",
        currentRevision: 2,
        status: "ready_for_review",
        scheduledFor: null,
        scheduleTimezone: null,
      },
      permissions: { canEdit: true, canApprove: true, mfaVerified: true },
      revisions: [
        {
          revisionNumber: 2,
          createdAt: "2026-08-24T12:00:00.000Z",
          isCurrent: true,
          content: { title: "Launch", caption: "Current", description: null },
          media: [{ id: "asset-id", filename: "launch.jpg" }],
          targets: [
            {
              id: "target-id",
              accountId: "account-id",
              accountName: "News Page",
              channel: "facebook",
              status: "queued",
            },
          ],
          approval: {
            decision: "pending",
            requestedAt: "2026-08-24T12:00:00.000Z",
            requestedByCurrentUser: false,
            decidedAt: null,
            decidedByCurrentUser: false,
            reason: null,
          },
        },
      ],
    });
    expect(detail).toMatchObject({
      draft: { currentRevision: 2 },
      permissions: { canApprove: true },
      revisions: [{ isCurrent: true, media: [{ filename: "launch.jpg" }] }],
    });
    expect(
      parseSocialWorkflowDetail({
        ...detail,
        revisions: detail?.revisions.map((revision) => ({
          ...revision,
          isCurrent: false,
        })),
      }),
    ).toBeNull();
  });

  it("reduces review decisions and timezone-safe scheduling actions", () => {
    expect(
      parseSocialWorkflowAction({
        action: "decide",
        decision: "rejected",
        reason: "  Caption needs a source.  ",
        tenantId: "attacker",
      }),
    ).toEqual({
      action: "decide",
      decision: "rejected",
      reason: "Caption needs a source.",
    });
    expect(
      parseSocialWorkflowAction({ action: "decide", decision: "rejected" }),
    ).toBeNull();
    expect(
      parseSocialWorkflowAction({
        action: "schedule",
        scheduledFor: "2026-08-25T10:00:00.000Z",
        timezone: "Europe/Berlin",
      }),
    ).toEqual({
      action: "schedule",
      scheduledFor: "2026-08-25T10:00:00.000Z",
      timezone: "Europe/Berlin",
    });
    expect(
      parseSocialWorkflowAction({
        action: "schedule",
        scheduledFor: "2026-08-25T10:00:00.000Z",
        timezone: "Not/AZone",
      }),
    ).toBeNull();
  });

  it("accepts only fail-closed publication operations projections", () => {
    const snapshot = {
      automaticExecution: false,
      reconciliationAvailable: false,
      publications: [
        {
          id: "draft-id",
          currentRevision: 2,
          status: "scheduled",
          scheduledFor: "2026-08-25T10:00:00.000Z",
          scheduleTimezone: "Europe/Berlin",
          updatedAt: "2026-08-24T12:00:00.000Z",
          content: { title: "Launch", caption: "Caption" },
          targets: [
            {
              id: "target-id",
              accountName: "News Page",
              provider: "meta",
              channel: "facebook",
              status: "failed",
              attempt: {
                id: "attempt-id",
                status: "failed",
                retryCount: 1,
                failureCategory: "provider",
                safeError: "Provider rejected the request",
                startedAt: "2026-08-25T10:00:00.000Z",
                completedAt: null,
                updatedAt: "2026-08-25T10:01:00.000Z",
                hasProviderReference: false,
              },
              job: {
                status: "pending",
                availableAt: "2026-08-25T10:00:00.000Z",
                attemptCount: 0,
                maxAttempts: 4,
              },
              reconciliation: "not_available",
            },
          ],
        },
      ],
    };
    expect(parseSocialPublications(snapshot)).toEqual(snapshot);
    expect(
      parseSocialPublications({ ...snapshot, automaticExecution: true }),
    ).toBeNull();
    expect(
      parseSocialPublications({
        ...snapshot,
        publications: snapshot.publications.map((publication) => ({
          ...publication,
          targets: publication.targets.map((target) => ({
            ...target,
            reconciliation: "reconciled",
          })),
        })),
      }),
    ).toBeNull();
  });

  it("accepts only bounded read-only provider preflight results", () => {
    const snapshot = {
      providerExecutionAvailable: false,
      checkedAt: "2026-08-24T12:00:00.000Z",
      targets: [
        {
          targetId: "target-id",
          accountName: "News Page",
          channel: "instagram",
          checks: [{ code: "instagram_jpeg_required", severity: "blocker" }],
        },
      ],
    };
    expect(parseSocialPreflight(snapshot)).toEqual(snapshot);
    expect(
      parseSocialPreflight({ ...snapshot, providerExecutionAvailable: true }),
    ).toBeNull();
    expect(
      parseSocialPreflight({
        ...snapshot,
        targets: [
          {
            ...snapshot.targets[0],
            checks: [{ code: "x", severity: "fatal" }],
          },
        ],
      }),
    ).toBeNull();
  });
});
