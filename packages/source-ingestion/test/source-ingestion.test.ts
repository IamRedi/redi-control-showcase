import {
  HardenedOutboundFetcher,
  isPublicAddress,
  normalizeUrl,
  parseFeed,
  type OutboundTransport,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const response = (input: {
  status?: number;
  location?: string;
  type?: string;
  body?: string;
}): OutboundTransport => ({
  send: () =>
    Promise.resolve({
      status: input.status ?? 200,
      headers: {
        "content-type": input.type ?? "text/html",
        location: input.location,
      },
      body: Buffer.from(input.body ?? "<title>Safe source</title>"),
    }),
});
describe("hardened source retrieval", () => {
  it("denies private, loopback, link-local and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.1.1",
      "192.168.1.1",
      "100.64.0.1",
      "192.0.2.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ])
      expect(isPublicAddress(address)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });
  it("denies DNS resolution to private IP before transport", async () => {
    const fetcher = new HardenedOutboundFetcher({
      resolver: () => Promise.resolve([{ address: "10.0.0.2", family: 4 }]),
      transport: response({}),
    });
    await expect(fetcher.fetch("https://safe.example/article")).rejects.toThrow(
      "SOURCE_FETCH_ADDRESS_DENIED",
    );
  });
  it("revalidates redirected hosts and denies redirect to private IP", async () => {
    let calls = 0;
    const fetcher = new HardenedOutboundFetcher({
      resolver: (host) =>
        Promise.resolve([
          {
            address: host === "private.example" ? "127.0.0.1" : "8.8.8.8",
            family: 4,
          },
        ]),
      transport: {
        send: () => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? {
                  status: 302,
                  headers: {
                    location: "https://private.example/secret",
                    "content-type": "text/html",
                  },
                  body: Buffer.alloc(0),
                }
              : {
                  status: 200,
                  headers: { "content-type": "text/html" },
                  body: Buffer.from("x"),
                },
          );
        },
      },
    });
    await expect(fetcher.fetch("https://public.example/start")).rejects.toThrow(
      "SOURCE_FETCH_ADDRESS_DENIED",
    );
    expect(calls).toBe(1);
  });
  it("denies oversized and disallowed response types", async () => {
    const base = {
      resolver: () =>
        Promise.resolve([{ address: "8.8.8.8", family: 4 as const }]),
    };
    await expect(
      new HardenedOutboundFetcher({
        ...base,
        maxBytes: 4,
        transport: response({ body: "12345" }),
      }).fetch("https://public.example/a"),
    ).rejects.toThrow("SOURCE_RESPONSE_TOO_LARGE");
    await expect(
      new HardenedOutboundFetcher({
        ...base,
        transport: response({ type: "application/octet-stream" }),
      }).fetch("https://public.example/a"),
    ).rejects.toThrow("SOURCE_CONTENT_TYPE_DENIED");
  });
  it("fails closed on timeout and never retries inside the fetch boundary", async () => {
    let calls = 0;
    const fetcher = new HardenedOutboundFetcher({
      resolver: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]),
      transport: {
        send: () => {
          calls += 1;
          return Promise.reject(new Error("SOURCE_FETCH_TIMEOUT"));
        },
      },
    });
    await expect(fetcher.fetch("https://public.example/a")).rejects.toThrow(
      "SOURCE_FETCH_TIMEOUT",
    );
    expect(calls).toBe(1);
  });
});
describe("feed parsing and conservative deduplication", () => {
  it("parses RSS and removes exact identity/url duplicates without headline merging", () => {
    const items = parseFeed(
      `<rss><channel><item><title>Same headline</title><link>https://news.example/a?utm_source=x</link><guid>a</guid><pubDate>Wed, 20 Aug 2026 10:00:00 GMT</pubDate><description>First</description></item><item><title>Same headline</title><link>https://news.example/b</link><guid>b</guid><description>Second</description></item><item><title>Duplicate</title><link>https://news.example/a</link><guid>a</guid></item></channel></rss>`,
      "https://news.example/feed.xml",
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.url)).toEqual([
      "https://news.example/a",
      "https://news.example/b",
    ]);
  });
  it("parses Atom author and rejects malformed XML", () => {
    const [item] = parseFeed(
      `<feed><entry><title>Atom item</title><link href="https://publisher.example/item"/><id>x-1</id><author>Editor</author><summary>Summary</summary></entry></feed>`,
      "https://publisher.example/atom.xml",
    );
    expect(item).toMatchObject({ title: "Atom item", providerResultId: "x-1" });
    expect(() => parseFeed("not a feed", "https://example.com/feed")).toThrow(
      "SOURCE_FEED_MALFORMED",
    );
  });
  it("normalizes tracking parameters but preserves meaningful URL distinctions", () => {
    expect(
      normalizeUrl("https://EXAMPLE.com/story/?utm_source=x&id=2#top"),
    ).toBe("https://example.com/story?id=2");
  });
});
