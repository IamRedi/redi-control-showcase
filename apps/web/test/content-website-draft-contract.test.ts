import { describe, expect, it } from "vitest";

import {
  parseWebsiteDraft,
  parseWebsiteReviewQueue,
} from "../app/content-website-draft-contract";

const id = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const revisionId = "44444444-4444-4444-8444-444444444444";
const assetId = "55555555-5555-4555-8555-555555555555";
const reviewId = "66666666-6666-4666-8666-666666666666";

const value = {
  draft: {
    id,
    itemId,
    workspaceId,
    currentRevision: 2,
    revision: {
      id: revisionId,
      revision: 2,
      slug: "local-website-draft",
      title: "Local Website draft",
      excerpt: "Prepared locally.",
      bodyText: "Exact local body.",
      mediaAssetIds: [assetId],
      contentHash: "a".repeat(64),
      createdAt: "2026-09-01T12:00:00.000Z",
    },
    createsVariant: false,
    callsConnector: false,
    publicationAuthorized: false,
    review: {
      id: reviewId,
      decision: "pending",
      revision: 2,
      contentHash: "a".repeat(64),
      requestedAt: "2026-09-01T12:05:00.000Z",
      requestedByCurrentUser: true,
      publicationAuthorized: false,
    },
    secretReference: "discarded",
  },
  permissions: { canEdit: true, canApprove: true, mfaVerified: true },
};

describe("local Website draft browser contract", () => {
  it("reconstructs only the bounded non-executing draft", () => {
    expect(parseWebsiteDraft(value)).toEqual({
      id,
      itemId,
      workspaceId,
      currentRevision: 2,
      revision: value.draft.revision,
      review: value.draft.review,
      permissions: value.permissions,
      createsVariant: false,
      callsConnector: false,
      publicationAuthorized: false,
    });
  });

  it("rejects revision mismatch, mutation claims and duplicate media", () => {
    expect(
      parseWebsiteDraft({
        draft: { ...value.draft, currentRevision: 3 },
        permissions: value.permissions,
      }),
    ).toBeNull();
    expect(
      parseWebsiteDraft({
        draft: { ...value.draft, callsConnector: true },
        permissions: value.permissions,
      }),
    ).toBeNull();
    expect(
      parseWebsiteDraft({
        draft: {
          ...value.draft,
          revision: {
            ...value.draft.revision,
            mediaAssetIds: [assetId, assetId],
          },
        },
        permissions: value.permissions,
      }),
    ).toBeNull();
  });

  it("accepts only a bounded exact-revision review queue", () => {
    expect(
      parseWebsiteReviewQueue({
        items: [
          {
            itemId,
            draftId: id,
            workspaceId,
            itemTitle: "Local Website draft",
            revision: 2,
            contentHash: "a".repeat(64),
            requestedAt: "2026-09-01T12:05:00.000Z",
            requestedByCurrentUser: true,
          },
        ],
        permissions: value.permissions,
        secretReference: "discarded",
      }),
    ).toEqual({
      items: [
        {
          itemId,
          draftId: id,
          workspaceId,
          itemTitle: "Local Website draft",
          revision: 2,
          contentHash: "a".repeat(64),
          requestedAt: "2026-09-01T12:05:00.000Z",
          requestedByCurrentUser: true,
        },
      ],
      permissions: value.permissions,
    });
    expect(
      parseWebsiteReviewQueue({
        items: [{ itemId: "attacker" }],
        permissions: value.permissions,
      }),
    ).toBeNull();
  });
});
