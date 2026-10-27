import { describe, expect, it } from "vitest";

import { parseWebsitePreflight } from "../app/content-website-preflight-contract";

const itemId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";

describe("Website destination preflight contract", () => {
  it("accepts and reconstructs a read-only safe response", () => {
    expect(
      parseWebsitePreflight({
        preflight: {
          itemId,
          workspaceId,
          status: "ready",
          checks: [{ code: "WEBSITE_CONNECTION_ELIGIBLE", severity: "pass" }],
          connections: [
            {
              connectionId,
              displayName: "Newsroom",
              domain: "news.example.test",
              status: "active",
              healthStatus: "unknown",
              eligible: true,
              secretReference: "must-not-cross-the-bff",
            },
          ],
          createsVariant: false,
          callsConnector: false,
          publicationAuthorized: false,
          internal: "discarded",
        },
      }),
    ).toEqual({
      itemId,
      workspaceId,
      status: "ready",
      checks: [{ code: "WEBSITE_CONNECTION_ELIGIBLE", severity: "pass" }],
      connections: [
        {
          connectionId,
          displayName: "Newsroom",
          domain: "news.example.test",
          status: "active",
          healthStatus: "unknown",
          eligible: true,
        },
      ],
      createsVariant: false,
      callsConnector: false,
      publicationAuthorized: false,
    });
  });

  it("rejects mutation claims, malformed identifiers and unknown severity", () => {
    const base = {
      itemId,
      workspaceId,
      status: "blocked",
      checks: [{ code: "WEBSITE_CONNECTION_REQUIRED", severity: "blocker" }],
      connections: [],
      createsVariant: false,
      callsConnector: false,
      publicationAuthorized: false,
    };
    expect(
      parseWebsitePreflight({ preflight: { ...base, callsConnector: true } }),
    ).toBeNull();
    expect(
      parseWebsitePreflight({ preflight: { ...base, itemId: "foreign" } }),
    ).toBeNull();
    expect(
      parseWebsitePreflight({
        preflight: { ...base, checks: [{ code: "SAFE", severity: "maybe" }] },
      }),
    ).toBeNull();
    expect(
      parseWebsitePreflight({
        preflight: {
          ...base,
          status: "ready",
          checks: [
            { code: "WEBSITE_CONNECTION_REQUIRED", severity: "blocker" },
          ],
        },
      }),
    ).toBeNull();
  });
});
