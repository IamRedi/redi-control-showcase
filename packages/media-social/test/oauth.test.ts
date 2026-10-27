import { afterEach, describe, expect, it, vi } from "vitest";

import { MetaReadOnlyOAuthAdapter } from "../src/oauth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Meta Business Login read-only adapter", () => {
  it("sends the configuration ID and retains only the Page token for the Page and linked Instagram", async () => {
    const adapter = new MetaReadOnlyOAuthAdapter(
      "test-app-id",
      "test-app-secret-value",
      "v26.0",
      "123456789",
    );
    const authorizationUrl = new URL(
      await adapter.authorizationUrl({
        state: "test-state",
        redirectUri: "https://control.example/api/social/oauth/meta/callback",
        scopes: ["business_management", "instagram_basic"],
      }),
    );
    expect(authorizationUrl.searchParams.get("config_id")).toBe("123456789");

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: "page-1",
            name: "Aurora Media",
            access_token: "page-token",
            instagram_business_account: {
              id: "instagram-1",
              username: "aurora-media",
            },
          },
        ],
      }),
    }) as typeof fetch;

    const token = {
      accessToken: "user-token",
      expiresAt: "2026-10-01T00:00:00.000Z",
      grantedScopes: ["business_management", "instagram_basic"],
    };
    await expect(adapter.discoverAccounts(token)).resolves.toEqual([
      {
        providerAccountId: "page-1",
        accountType: "facebook_page",
        displayName: "Aurora Media",
        token: { ...token, accessToken: "page-token" },
      },
      {
        providerAccountId: "instagram-1",
        accountType: "instagram_account",
        displayName: "aurora-media",
        token: { ...token, accessToken: "page-token" },
      },
    ]);
  });

  it.each([
    [{ data: [] }, "META_NO_AUTHORIZED_PAGES"],
    [{ unexpected: [] }, "META_ACCOUNT_RESPONSE_INVALID"],
    [{ data: [{ id: "page-1", name: "Page" }] }, "META_PAGE_TOKEN_UNAVAILABLE"],
  ])("fails closed on incomplete discovery %j", async (body, error) => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(body) });
    const adapter = new MetaReadOnlyOAuthAdapter("app", "secret");
    await expect(
      adapter.discoverAccounts({
        accessToken: "user-token",
        expiresAt: "2026-10-01T00:00:00.000Z",
        grantedScopes: [],
      }),
    ).rejects.toThrow(error);
  });
});
