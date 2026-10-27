import { describe, expect, it } from "vitest";
import {
  parseSocialStudio,
  type SocialStudioSnapshot,
} from "../app/social-contract";
const snapshot: SocialStudioSnapshot = {
  accounts: [],
  media: [
    {
      id: "asset-id",
      filename: "demo.png",
      status: "ready",
      mimeType: "image/png",
      width: 1200,
      height: 630,
      durationMs: null,
    },
  ],
  drafts: [
    {
      id: "draft-id",
      currentRevision: 1,
      status: "draft",
      scheduledFor: null,
      scheduleTimezone: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      content: {
        title: "Synthetic",
        caption: null,
        description: null,
        mediaAssetIds: ["asset-id"],
      },
      targets: [],
      approval: null,
    },
  ],
  permissions: { canEdit: true, canApprove: false, mfaVerified: false },
};
describe("Social Studio serialized BFF contract", () => {
  it("decodes non-empty normalized media and drafts from the BFF", () => {
    expect(parseSocialStudio(JSON.parse(JSON.stringify(snapshot)))).toEqual(
      snapshot,
    );
  });
  it("preserves strict rejection of malformed normalized fields", () => {
    expect(
      parseSocialStudio({
        ...snapshot,
        media: [{ ...snapshot.media[0], filename: 42 }],
      }),
    ).toBeNull();
    expect(
      parseSocialStudio({
        ...snapshot,
        drafts: [
          {
            ...snapshot.drafts[0],
            content: { ...snapshot.drafts[0]!.content, mediaAssetIds: [42] },
          },
        ],
      }),
    ).toBeNull();
  });
});
