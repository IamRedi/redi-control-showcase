import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  BusinessSiteInformationClient,
  businessSiteInformationManifest,
  businessSiteCanonicalRequest,
  probeBusinessSiteInformationAuthentication,
  probeBusinessSiteInformationReadOnly,
  signBusinessSiteRequest,
} from "../src/index.js";

const secret = "test-only-test-only-test-only-000";
const configuration = {
  apiBaseUrl: "https://platform.example/api/integrations/redi-control/v1",
  integrationId: "installation-123",
  displayName: "Editorial Example",
  domain: "news.example",
};

function fetchUrl(target: string | URL | Request): URL {
  if (target instanceof URL) return target;
  if (target instanceof Request) return new URL(target.url);
  return new URL(target);
}

describe("BusinessSite Phase 7 signing contract", () => {
  it("signs the exact raw body and canonical pathname/query", () => {
    const input = {
      integrationId: "installation-123",
      timestamp: "1787131200",
      nonce: "nonce-1234567890",
      method: "POST",
      pathnameAndQuery: "/api/integrations/redi-control/v1/articles?limit=10",
      rawBody: '{"title":"News"}',
    };
    const bodyHash = createHash("sha256")
      .update(input.rawBody, "utf8")
      .digest("hex");
    const canonical = [
      input.integrationId,
      input.timestamp,
      input.nonce,
      input.method,
      input.pathnameAndQuery,
      bodyHash,
    ].join("\n");
    expect(businessSiteCanonicalRequest(input)).toBe(canonical);
    expect(signBusinessSiteRequest(secret, input)).toBe(
      `v1=${createHmac("sha256", secret).update(canonical, "utf8").digest("hex")}`,
    );
  });

  it("uses a new nonce while retaining byte-identical body and idempotency key", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetcher = vi.fn(
      (target: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: fetchUrl(target), init: init ?? {} });
        return Promise.resolve(
          Response.json({
            article: {
              id: "11111111-1111-4111-8111-111111111111",
              externalReference: "external-1",
              slug: "local-news",
              title: "Local news",
              excerpt: "",
              body: { version: 1, blocks: [] },
              articleMedia: [],
              tags: [],
              status: "draft",
              featured: false,
              version: 1,
              createdAt: "2026-08-19T12:00:00.000Z",
              updatedAt: "2026-08-19T12:00:00.000Z",
              sources: [],
            },
            externalReferenceReplay: false,
          }),
        );
      },
    );
    const nonces = ["nonce-000000000001", "nonce-000000000002"];
    const client = new BusinessSiteInformationClient(
      configuration,
      secret,
      fetcher,
      () => 1_787_131_200_000,
      () => {
        const nonce = nonces.shift();
        if (!nonce) throw new Error("Test nonce fixture exhausted");
        return nonce;
      },
    );
    const input = {
      externalReference: "external-1",
      slug: "local-news",
      title: "Local news",
      body: { version: 1 as const, blocks: [] },
    };
    await client.executeWrite(
      "articles.create",
      input,
      "stable-key-0001",
      AbortSignal.timeout(1_000),
    );
    await client.executeWrite(
      "articles.create",
      input,
      "stable-key-0001",
      AbortSignal.timeout(1_000),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init.body).toBe(calls[1]?.init.body);
    expect(
      (calls[0]?.init.headers as Record<string, string>)["x-idempotency-key"],
    ).toBe("stable-key-0001");
    expect(
      (calls[1]?.init.headers as Record<string, string>)["x-idempotency-key"],
    ).toBe("stable-key-0001");
    expect(
      (calls[0]?.init.headers as Record<string, string>)["x-signature-nonce"],
    ).not.toBe(
      (calls[1]?.init.headers as Record<string, string>)["x-signature-nonce"],
    );
  });

  it("fails closed on untrusted base URLs and malformed provider responses", async () => {
    expect(
      () =>
        new BusinessSiteInformationClient(
          {
            ...configuration,
            apiBaseUrl:
              "http://public.example/api/integrations/redi-control/v1",
          },
          secret,
        ),
    ).toThrow();
    expect(
      () =>
        new BusinessSiteInformationClient(
          {
            ...configuration,
            apiBaseUrl:
              "http://localhost:3000/api/integrations/redi-control/v1",
            previewUrl: "http://attacker.example/preview",
            allowLocalHttp: true,
          },
          secret,
        ),
    ).toThrow();
    const client = new BusinessSiteInformationClient(
      configuration,
      secret,
      () =>
        Promise.resolve(Response.json({ article: { status: "published" } })),
    );
    await expect(
      client.executeRead(
        "articles.read",
        { articleId: "11111111-1111-4111-8111-111111111111" },
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND_OUTPUT" });
  });

  it("probes only bounded read operations and returns no provider records", async () => {
    const calls: Array<{ method: string; pathname: string }> = [];
    const result = await probeBusinessSiteInformationReadOnly(
      configuration,
      secret,
      {
        fetcher: (target, init) => {
          const url = fetchUrl(target);
          calls.push({
            method: init?.method ?? "GET",
            pathname: `${url.pathname}${url.search}`,
          });
          if (url.pathname.endsWith("/articles"))
            return Promise.resolve(
              Response.json({
                items: [],
                nextCursor: {
                  createdAt: "2026-08-19T12:00:00.000Z",
                  id: "11111111-1111-4111-8111-111111111111",
                },
              }),
            );
          return Promise.resolve(
            Response.json({ items: [], nextCursor: null }),
          );
        },
      },
    );
    expect(calls).toEqual([
      {
        method: "GET",
        pathname: "/api/integrations/redi-control/v1/articles?limit=1",
      },
      {
        method: "GET",
        pathname: "/api/integrations/redi-control/v1/media?limit=1",
      },
    ]);
    expect(result).toEqual({
      articleSampleCount: 0,
      mediaSampleCount: 0,
      articlePaginationAvailable: true,
      mediaPaginationAvailable: false,
    });
    expect(result).not.toHaveProperty("items");
  });

  it("probes live authentication denials without issuing a write", async () => {
    const calls: Array<{ method: string; headers: Record<string, string> }> =
      [];
    const responses = [200, 401, 401, 401, 401];
    const nonces = [
      "nonce-000000000001",
      "nonce-000000000002",
      "nonce-000000000003",
      "nonce-000000000004",
    ];
    const result = await probeBusinessSiteInformationAuthentication(
      configuration,
      secret,
      {
        now: () => 1_787_131_200_000,
        nonce: () => {
          const nonce = nonces.shift();
          if (!nonce) throw new Error("Test nonce fixture exhausted");
          return nonce;
        },
        fetcher: (_target, init) => {
          const status = responses.shift();
          if (!status) throw new Error("Test response fixture exhausted");
          calls.push({
            method: init?.method ?? "GET",
            headers: init?.headers as Record<string, string>,
          });
          return Promise.resolve(
            status === 200
              ? Response.json({ items: [], nextCursor: null })
              : Response.json(
                  { error: { code: "authentication_failed" } },
                  { status },
                ),
          );
        },
      },
    );
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls[1]?.headers).toEqual(calls[0]?.headers);
    expect(calls[2]?.headers["x-signature-timestamp"]).toBe("1787130600");
    expect(calls[3]?.headers["x-signature"]).toBe(`v1=${"0".repeat(64)}`);
    expect(calls[4]?.headers["x-integration-id"]).toMatch(/^unknown-/);
    expect(result).toEqual({
      validRequestAccepted: true,
      nonceReplayDenied: true,
      staleTimestampDenied: true,
      invalidSignatureDenied: true,
      unknownIntegrationDenied: true,
    });
  });

  it("declares only the bounded Milestone 1 operation set and rejects extra input", () => {
    expect(businessSiteInformationManifest.category).toBe("website");
    expect(
      businessSiteInformationManifest.commands.map((command) => command.id),
    ).toEqual([
      "articles.list",
      "articles.read",
      "articles.create",
      "articles.update",
      "articles.submit",
      "articles.publish",
      "articles.archive",
      "media.list",
      "media.upload",
    ]);
    const fetcher = vi.fn();
    const client = new BusinessSiteInformationClient(
      configuration,
      secret,
      fetcher,
    );
    expect(() =>
      client.executeRead(
        "articles.read",
        {
          articleId: "11111111-1111-4111-8111-111111111111",
          tenantId: "injected",
        },
        AbortSignal.timeout(1_000),
      ),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("routes the bounded editorial media and archive operations", async () => {
    const calls: Array<{
      url: string;
      method: string;
      idempotencyKey?: string;
    }> = [];
    const article = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "archived-news",
      title: "Archived news",
      excerpt: "",
      body: { version: 1, blocks: [] },
      articleMedia: [],
      tags: [],
      status: "archived",
      featured: false,
      version: 2,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:01:00.000Z",
      sources: [],
    };
    const media = {
      id: "22222222-2222-4222-8222-222222222222",
      url: "/api/media/22222222-2222-4222-8222-222222222222",
      mimeType: "image/webp",
      altText: "Editorial image",
      width: 1200,
      height: 800,
      byteSize: 4,
    };
    const client = new BusinessSiteInformationClient(
      configuration,
      secret,
      (target, init) => {
        const url = fetchUrl(target);
        const headers = init?.headers as Record<string, string>;
        calls.push({
          url: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          ...(headers["x-idempotency-key"]
            ? { idempotencyKey: headers["x-idempotency-key"] }
            : {}),
        });
        if (url.pathname.endsWith("/media") && init?.method === "GET")
          return Promise.resolve(
            Response.json({ items: [media], nextCursor: null }),
          );
        if (url.pathname.endsWith("/media"))
          return Promise.resolve(Response.json({ media }));
        return Promise.resolve(Response.json({ article }));
      },
    );
    await client.executeRead(
      "media.list",
      { limit: 10 },
      AbortSignal.timeout(1_000),
    );
    await client.executeWrite(
      "media.upload",
      {
        filename: "editorial.webp",
        mimeType: "image/webp",
        dataBase64: "AAAA",
        altText: "Editorial image",
      },
      "upload-media-0001",
      AbortSignal.timeout(1_000),
    );
    await client.executeWrite(
      "articles.archive",
      { articleId: article.id, expectedVersion: 1 },
      "archive-article-0001",
      AbortSignal.timeout(1_000),
    );
    expect(calls).toEqual([
      {
        url: "/api/integrations/redi-control/v1/media?limit=10",
        method: "GET",
      },
      {
        url: "/api/integrations/redi-control/v1/media",
        method: "POST",
        idempotencyKey: "upload-media-0001",
      },
      {
        url: `/api/integrations/redi-control/v1/articles/${article.id}/archive`,
        method: "POST",
        idempotencyKey: "archive-article-0001",
      },
    ]);
  });
});
