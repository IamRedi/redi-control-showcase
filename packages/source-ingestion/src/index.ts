import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { SecretProvider } from "@redi-control/connector-sdk";
import {
  withTenant,
  type ClaimedJob,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";
import { z } from "zod";

const resultSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url().max(2000),
  publisher: z.string().max(240).default(""),
  snippet: z.string().max(12000).default(""),
  publicationAt: z.string().datetime().optional(),
  providerResultId: z.string().max(240).optional(),
  providerMetadata: z.record(z.string(), z.unknown()).default({}),
});
export type DiscoveryResult = z.infer<typeof resultSchema>;
export interface SearchDiscoveryProvider {
  readonly id: string;
  search(input: {
    query: string;
    limit: number;
    credential?: string;
    signal: AbortSignal;
  }): Promise<{
    results: DiscoveryResult[];
    estimatedCost?: number;
    actualCost?: number;
  }>;
}
export interface ApiFeedProvider {
  readonly id: string;
  discover(input: {
    configuration: Readonly<Record<string, unknown>>;
    credential?: string;
    signal: AbortSignal;
  }): Promise<{
    results: DiscoveryResult[];
    estimatedCost?: number;
    actualCost?: number;
  }>;
}

export class DeterministicSearchProvider implements SearchDiscoveryProvider {
  readonly id = "deterministic-local";
  search(input: { query: string; limit: number; signal: AbortSignal }) {
    if (input.signal.aborted)
      return Promise.reject(new Error("SOURCE_OPERATION_CANCELLED"));
    return Promise.resolve({
      results: Array.from({ length: Math.min(input.limit, 3) }, (_, index) => ({
        title: `${input.query} source ${index + 1}`,
        url: `https://example.com/research/${encodeURIComponent(input.query.toLowerCase())}/${index + 1}`,
        publisher: "Example Publisher",
        snippet: `Deterministic discovery fixture for ${input.query}.`,
        providerResultId: `local-${index + 1}`,
        providerMetadata: { deterministic: true },
      })),
    });
  }
}

export interface OutboundFetchResponse {
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly retrievedAt: string;
}
export interface OutboundTransport {
  send(input: {
    url: URL;
    address: string;
    family: 4 | 6;
    timeoutMs: number;
    maxBytes: number;
    userAgent: string;
    signal?: AbortSignal;
  }): Promise<{
    status: number;
    headers: Record<string, string | undefined>;
    body: Buffer;
  }>;
}

const deniedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  deniedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  deniedAddresses.addSubnet(network, prefix, "ipv6");
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !deniedAddresses.check(address, "ipv4");
  if (family !== 6) return false;
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) return isPublicAddress(value.slice(7));
  return !deniedAddresses.check(value, "ipv6");
}

class NodeHttpsTransport implements OutboundTransport {
  send(input: Parameters<OutboundTransport["send"]>[0]) {
    return new Promise<{
      status: number;
      headers: Record<string, string | undefined>;
      body: Buffer;
    }>((resolve, reject) => {
      const request = httpsRequest(input.url, {
        method: "GET",
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/xml,application/json",
          "accept-encoding": "identity",
          "user-agent": input.userAgent,
        },
        timeout: input.timeoutMs,
        lookup: (_hostname, options, callback) => {
          // Node may request all addresses when its family auto-selection is
          // enabled. Returning the legacy scalar shape in that mode produces
          // `Invalid IP address: undefined` before the TLS request is sent.
          if (typeof options === "object" && options.all) {
            (
              callback as unknown as (
                error: null,
                addresses: { address: string; family: 4 | 6 }[],
              ) => void
            )(null, [{ address: input.address, family: input.family }]);
            return;
          }
          callback(null, input.address, input.family);
        },
      });
      const onAbort = () => request.destroy(new Error("SOURCE_FETCH_ABORTED"));
      input.signal?.addEventListener("abort", onAbort, { once: true });
      request.on("timeout", () =>
        request.destroy(new Error("SOURCE_FETCH_TIMEOUT")),
      );
      request.on("error", reject);
      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > input.maxBytes)
            request.destroy(new Error("SOURCE_RESPONSE_TOO_LARGE"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          input.signal?.removeEventListener("abort", onAbort);
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(",") : value,
              ]),
            ),
            body: Buffer.concat(chunks),
          });
        });
      });
      request.end();
    });
  }
}

export class HardenedOutboundFetcher {
  constructor(
    private readonly options: {
      timeoutMs?: number;
      maxBytes?: number;
      maxRedirects?: number;
      userAgent?: string;
      resolver?: (
        hostname: string,
      ) => Promise<Array<{ address: string; family: 4 | 6 }>>;
      transport?: OutboundTransport;
    } = {},
  ) {}
  async fetch(
    rawUrl: string,
    signal?: AbortSignal,
  ): Promise<OutboundFetchResponse> {
    let current = this.#parse(rawUrl);
    const transport = this.options.transport ?? new NodeHttpsTransport();
    for (
      let redirects = 0;
      redirects <= (this.options.maxRedirects ?? 3);
      redirects += 1
    ) {
      const addresses = await (this.options.resolver ?? this.#resolve)(
        current.hostname,
      );
      if (
        !addresses.length ||
        addresses.some((entry) => !isPublicAddress(entry.address))
      )
        throw new Error("SOURCE_FETCH_ADDRESS_DENIED");
      const response = await transport.send({
        url: current,
        address: addresses[0]!.address,
        family: addresses[0]!.family,
        timeoutMs: this.options.timeoutMs ?? 10_000,
        maxBytes: this.options.maxBytes ?? 2_000_000,
        userAgent:
          this.options.userAgent ??
          "REDI-CONTROL-Source-Ingestion/1.0 (+https://redi-control.example/source-policy)",
        ...(signal ? { signal } : {}),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (!location || redirects === (this.options.maxRedirects ?? 3))
          throw new Error("SOURCE_REDIRECT_DENIED");
        current = this.#parse(new URL(location, current).toString());
        continue;
      }
      if (response.body.length > (this.options.maxBytes ?? 2_000_000))
        throw new Error("SOURCE_RESPONSE_TOO_LARGE");
      if (response.status < 200 || response.status >= 300)
        throw new Error(`SOURCE_HTTP_${response.status}`);
      const type = (response.headers["content-type"] ?? "")
        .split(";", 1)[0]!
        .trim()
        .toLowerCase();
      const allowed = [
        "text/html",
        "application/xhtml+xml",
        "application/rss+xml",
        "application/atom+xml",
        "application/xml",
        "text/xml",
        "application/json",
      ];
      if (!allowed.includes(type))
        throw new Error("SOURCE_CONTENT_TYPE_DENIED");
      return {
        finalUrl: current.toString(),
        status: response.status,
        contentType: type,
        body: response.body.toString("utf8"),
        retrievedAt: new Date().toISOString(),
      };
    }
    throw new Error("SOURCE_REDIRECT_DENIED");
  }
  #parse(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("SOURCE_URL_INVALID");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error("SOURCE_URL_DENIED");
    if (
      !url.hostname ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost")
    )
      throw new Error("SOURCE_URL_DENIED");
    return url;
  }
  async #resolve(hostname: string) {
    if (isIP(hostname))
      return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    return records.map((record) => ({
      address: record.address,
      family: record.family as 4 | 6,
    }));
  }
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
function safeSourceUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw fail("SOURCE_URL_INVALID", 400);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  )
    throw fail("SOURCE_URL_DENIED", 400);
  return normalizeUrl(url.toString());
}
const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
const cleanText = (value: string) =>
  decode(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
const tag = (xml: string, names: string[]) => {
  for (const name of names) {
    const match = new RegExp(
      `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
      "i",
    ).exec(xml);
    if (match?.[1]) return decode(match[1]);
  }
  return "";
};
export function parseFeed(xml: string, feedUrl: string): DiscoveryResult[] {
  const rss = /<rss\b/i.test(xml),
    atom = /<feed\b/i.test(xml);
  if (
    (!rss && !atom) ||
    (rss && !/<\/rss>/i.test(xml)) ||
    (atom && !/<\/feed>/i.test(xml))
  )
    throw new Error("SOURCE_FEED_MALFORMED");
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const seen = new Set<string>();
  const output: DiscoveryResult[] = [];
  for (const entry of entries) {
    const body = entry[2] ?? "";
    const linkTag = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i.exec(
      body,
    )?.[1];
    const rawUrl = linkTag ?? tag(body, ["link"]);
    const title = cleanText(tag(body, ["title"]));
    if (!rawUrl || !title) continue;
    let normalized: string;
    try {
      normalized = normalizeUrl(new URL(decode(rawUrl), feedUrl).toString());
    } catch {
      continue;
    }
    const identity = tag(body, ["guid", "id"]) || normalized;
    if (seen.has(identity) || seen.has(normalized)) continue;
    seen.add(identity);
    seen.add(normalized);
    const date = tag(body, ["pubDate", "published", "updated"]);
    const parsedDate =
      date && !Number.isNaN(Date.parse(date))
        ? new Date(date).toISOString()
        : undefined;
    output.push(
      resultSchema.parse({
        title,
        url: normalized,
        publisher: new URL(feedUrl).hostname,
        snippet: cleanText(
          tag(body, ["description", "summary", "content:encoded", "content"]),
        ).slice(0, 12000),
        ...(parsedDate ? { publicationAt: parsedDate } : {}),
        providerResultId: identity.slice(0, 240),
        providerMetadata: {
          author: cleanText(tag(body, ["author", "dc:creator"])),
        },
      }),
    );
  }
  return output;
}
export function extractHtml(
  response: OutboundFetchResponse,
): DiscoveryResult & {
  author: string;
  extractedMaterial: string;
  canonicalUrl: string;
} {
  const meta = (property: string) =>
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i",
    ).exec(response.body)?.[1] ?? "";
  const canonical =
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i.exec(
      response.body,
    )?.[1];
  const title =
    cleanText(meta("og:title") || tag(response.body, ["title"])) ||
    new URL(response.finalUrl).hostname;
  const material = cleanText(response.body).slice(0, 100000);
  const published = meta("article:published_time");
  return {
    title: title.slice(0, 500),
    url: response.finalUrl,
    canonicalUrl: normalizeUrl(
      canonical
        ? new URL(decode(canonical), response.finalUrl).toString()
        : response.finalUrl,
    ),
    publisher: new URL(response.finalUrl).hostname,
    author: cleanText(meta("author")).slice(0, 240),
    snippet: cleanText(
      meta("description") || meta("og:description") || material,
    ).slice(0, 12000),
    extractedMaterial: material,
    ...(published && !Number.isNaN(Date.parse(published))
      ? { publicationAt: new Date(published).toISOString() }
      : {}),
    providerMetadata: {},
  };
}

const map = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_m, char: string) => char.toUpperCase()),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

export class SourceIngestionService {
  readonly #search = new Map<string, SearchDiscoveryProvider>();
  readonly #apiFeeds = new Map<string, ApiFeedProvider>();
  constructor(
    private readonly pool: DatabasePool,
    private readonly dependencies: {
      fetcher?: HardenedOutboundFetcher;
      secretProvider?: SecretProvider;
      searchProviders?: SearchDiscoveryProvider[];
      apiFeedProviders?: ApiFeedProvider[];
    } = {},
  ) {
    for (const provider of dependencies.searchProviders ?? [])
      this.#search.set(provider.id, provider);
    for (const provider of dependencies.apiFeedProviders ?? [])
      this.#apiFeeds.set(provider.id, provider);
  }
  async start(input: {
    tenantId: string;
    workspaceId: string;
    caseId?: string;
    actorUserId: string;
    method: "manual" | "search" | "rss" | "api_feed";
    query?: string;
    url?: string;
    providerId?: string;
    feedId?: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    const requestedUrl =
      input.method === "manual" && input.url
        ? safeSourceUrl(input.url)
        : input.url;
    const validated = z
      .object({
        workspaceId: z.string().uuid(),
        caseId: z.string().uuid().optional(),
        method: z.enum(["manual", "search", "rss", "api_feed"]),
        query: z.string().max(1000).optional(),
        requestedUrl: z.string().max(2000).optional(),
        providerId: z
          .string()
          .regex(/^[a-z][a-z0-9._-]{1,80}$/)
          .optional(),
        feedId: z.string().uuid().optional(),
        idempotencyKey: z.string().min(8).max(200),
      })
      .parse({ ...input, requestedUrl });
    if (
      (validated.method === "manual" && !validated.requestedUrl) ||
      (validated.method === "search" && !validated.query?.trim()) ||
      (validated.method === "rss" && !validated.feedId)
    )
      throw fail("INVALID_SOURCE_INGESTION_REQUEST", 400);
    const requestHash = fingerprint(
      JSON.stringify({
        workspaceId: validated.workspaceId,
        caseId: validated.caseId ?? null,
        method: validated.method,
        query: validated.query?.trim() ?? "",
        requestedUrl: validated.requestedUrl ?? "",
        providerId: validated.providerId ?? "",
        feedId: validated.feedId ?? null,
      }),
    );
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.#available(client, input.tenantId, input.workspaceId);
      const recent = await client.query<{ count: number }>(
        "SELECT count(*)::int count FROM control.discovery_runs WHERE workspace_id=$1 AND created_at>now()-interval '1 minute'",
        [input.workspaceId],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= 30)
        throw fail("SOURCE_DISCOVERY_RATE_LIMITED", 429);
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO control.discovery_runs(id,tenant_id,workspace_id,research_case_id,method,provider_id,query,requested_url,idempotency_key,request_hash,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,workspace_id,idempotency_key) DO NOTHING RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId ?? null,
          input.method,
          input.providerId ?? input.method,
          input.query ?? "",
          requestedUrl ?? "",
          input.idempotencyKey,
          requestHash,
          input.actorUserId,
        ],
      );
      if (!inserted.rowCount) {
        const existing = await client.query<
          { request_hash: string } & Record<string, unknown>
        >(
          "SELECT * FROM control.discovery_runs WHERE workspace_id=$1 AND idempotency_key=$2",
          [input.workspaceId, input.idempotencyKey],
        );
        if (existing.rows[0]?.request_hash !== requestHash)
          throw fail("SOURCE_IDEMPOTENCY_CONFLICT", 409);
        return map(existing.rows[0]);
      }
      await client.query(
        `INSERT INTO control.jobs(id,tenant_id,job_type,payload,idempotency_key,correlation_id,max_attempts) VALUES($1,$2,'source.ingestion',$3,$4,$5,4) ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          input.tenantId,
          {
            runId: id,
            workspaceId: input.workspaceId,
            actorUserId: input.actorUserId,
            feedId: input.feedId ?? null,
          },
          `source-ingestion:${id}`,
          input.correlationId,
        ],
      );
      await this.#audit(
        client,
        input,
        "research.discovery_requested",
        "discovery_run",
        id,
        { method: input.method, providerId: input.providerId ?? null },
      );
      return map(inserted.rows[0] as Record<string, unknown>);
    });
  }
  async listRuns(input: {
    tenantId: string;
    workspaceId?: string;
    caseId?: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (client) =>
      (
        await client.query(
          `SELECT r.*,COALESCE(json_agg(d ORDER BY d.created_at) FILTER(WHERE d.id IS NOT NULL),'[]') results FROM control.discovery_runs r LEFT JOIN control.discovery_results d ON d.discovery_run_id=r.id WHERE ($1::uuid IS NULL OR r.workspace_id=$1) AND ($2::uuid IS NULL OR r.research_case_id=$2) GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100`,
          [input.workspaceId ?? null, input.caseId ?? null],
        )
      ).rows.map((row) => map(row as Record<string, unknown>)),
    );
  }
  async cancel(input: {
    tenantId: string;
    runId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        "UPDATE control.discovery_runs SET cancellation_requested=true,status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,updated_at=now() WHERE id=$1 AND status IN ('pending','running') RETURNING *",
        [input.runId],
      );
      if (!result.rowCount) throw fail("DISCOVERY_RUN_NOT_CANCELLABLE", 409);
      await this.#audit(
        client,
        input,
        "research.discovery_cancelled",
        "discovery_run",
        input.runId,
        {},
      );
      return map(result.rows[0] as Record<string, unknown>);
    });
  }
  async createFeed(input: {
    tenantId: string;
    workspaceId: string;
    sourceId: string;
    feedUrl: string;
    actorUserId: string;
    correlationId: string;
  }) {
    const normalized = safeSourceUrl(input.feedUrl);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.#available(client, input.tenantId, input.workspaceId);
      const id = randomUUID();
      const result = await client.query<Record<string, unknown>>(
        `INSERT INTO control.source_feeds(id,tenant_id,workspace_id,registry_source_id,feed_url,normalized_url,created_by) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM control.source_registry WHERE id=$4 AND workspace_id=$3 AND source_type='feed') RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.sourceId,
          input.feedUrl,
          normalized,
          input.actorUserId,
        ],
      );
      if (!result.rowCount) throw fail("SOURCE_FEED_SOURCE_INVALID", 404);
      await this.#audit(
        client,
        input,
        "research.feed_configured",
        "source_feed",
        id,
        {},
      );
      return map(result.rows[0] as Record<string, unknown>);
    });
  }
  async configureProvider(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    providerId: string;
    providerKind: "search" | "api_feed";
    displayName: string;
    secretReference?: string;
    configuration?: Record<string, unknown>;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.#available(client, input.tenantId, input.workspaceId);
      const id = randomUUID();
      const result = await client.query<Record<string, unknown>>(
        `INSERT INTO control.source_provider_configurations(id,tenant_id,workspace_id,provider_id,provider_kind,display_name,secret_reference,configuration,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,workspace_id,provider_id) DO UPDATE SET display_name=EXCLUDED.display_name,secret_reference=EXCLUDED.secret_reference,configuration=EXCLUDED.configuration,updated_at=now() RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.providerId,
          input.providerKind,
          input.displayName,
          input.secretReference ?? null,
          input.configuration ?? {},
          input.actorUserId,
        ],
      );
      await this.#audit(
        client,
        input,
        "research.provider_configured",
        "source_provider_configuration",
        String(result.rows[0]?.id),
        {
          providerId: input.providerId,
          providerKind: input.providerKind,
          hasSecretReference: Boolean(input.secretReference),
        },
      );
      return map(result.rows[0] as Record<string, unknown>);
    });
  }
  async listProviders(input: { tenantId: string; workspaceId?: string }) {
    return withTenant(this.pool, input.tenantId, async (client) =>
      (
        await client.query(
          "SELECT id,workspace_id,provider_id,provider_kind,display_name,enabled,(secret_reference IS NOT NULL) has_secret_reference,configuration,created_at,updated_at FROM control.source_provider_configurations WHERE ($1::uuid IS NULL OR workspace_id=$1) ORDER BY display_name LIMIT 100",
          [input.workspaceId ?? null],
        )
      ).rows.map((row) => map(row as Record<string, unknown>)),
    );
  }
  async listFeeds(input: { tenantId: string; workspaceId?: string }) {
    return withTenant(this.pool, input.tenantId, async (c) =>
      (
        await c.query(
          "SELECT * FROM control.source_feeds WHERE ($1::uuid IS NULL OR workspace_id=$1) ORDER BY created_at DESC LIMIT 100",
          [input.workspaceId ?? null],
        )
      ).rows.map((r) => map(r as Record<string, unknown>)),
    );
  }
  async attach(input: {
    tenantId: string;
    runId: string;
    resultIds: string[];
    caseId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const run = await client.query<Record<string, unknown>>(
        "SELECT * FROM control.discovery_runs WHERE id=$1 AND status='succeeded'",
        [input.runId],
      );
      if (!run.rowCount) throw fail("DISCOVERY_RUN_NOT_READY", 409);
      const workspaceId = String(run.rows[0]?.workspace_id);
      const attached = [];
      for (const resultId of [...new Set(input.resultIds)].slice(0, 50)) {
        const row = (
          await client.query(
            "SELECT * FROM control.discovery_results WHERE id=$1 AND discovery_run_id=$2 AND attached_case_source_id IS NULL",
            [resultId, input.runId],
          )
        ).rows[0] as Record<string, unknown> | undefined;
        if (!row) continue;
        const id = randomUUID();
        const inserted = await client.query(
          `INSERT INTO control.research_case_sources(id,tenant_id,workspace_id,research_case_id,source_ref,title,publisher,author,publication_at,retrieved_at,source_type,tier,provenance,summary,extracted_material,discovery_method,normalized_url,content_fingerprint,retrieval_status,created_by)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,now()),CASE WHEN $11='rss' THEN 'feed' ELSE 'website' END,'discovery',$12,$13,$14,$11,$15,$16,$17,$18 WHERE EXISTS(SELECT 1 FROM control.research_cases WHERE id=$4 AND workspace_id=$3)
          AND NOT EXISTS(SELECT 1 FROM control.research_case_sources WHERE research_case_id=$4 AND normalized_url=$15) RETURNING id`,
          [
            id,
            input.tenantId,
            workspaceId,
            input.caseId,
            row.source_url,
            row.title,
            row.publisher,
            row.author,
            row.publication_at,
            row.retrieved_at,
            run.rows[0]?.method,
            row.provenance,
            row.snippet,
            row.extracted_material,
            row.normalized_url,
            row.content_fingerprint,
            row.retrieval_status,
            input.actorUserId,
          ],
        );
        if (inserted.rowCount) {
          await client.query(
            "UPDATE control.discovery_results SET attached_case_source_id=$1 WHERE id=$2",
            [id, resultId],
          );
          attached.push(id);
        }
      }
      await this.#audit(
        client,
        input,
        "research.discovery_attached",
        "research_case",
        input.caseId,
        { runId: input.runId, count: attached.length },
      );
      return { attachedIds: attached };
    });
  }
  async process(job: ClaimedJob): Promise<void> {
    const payload = z
      .object({
        runId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        actorUserId: z.string().uuid(),
        feedId: z.string().uuid().nullable().optional(),
      })
      .parse(job.payload);
    let processingError: Error | undefined;
    await withTenant(this.pool, job.tenantId, async (client) => {
      const runResult = await client.query(
        "UPDATE control.discovery_runs SET status='running',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status IN ('pending','failed') AND NOT cancellation_requested RETURNING *",
        [payload.runId],
      );
      if (!runResult.rowCount) return;
      const run = runResult.rows[0] as Record<string, unknown>;
      try {
        let results: Array<
          DiscoveryResult & {
            author?: string;
            extractedMaterial?: string;
            canonicalUrl?: string;
            retrievedAt?: string;
          }
        > = [];
        let estimatedCost: number | undefined, actualCost: number | undefined;
        const method = String(run.method);
        const controller = new AbortController();
        if (method === "manual") {
          const fetched = await (
            this.dependencies.fetcher ?? new HardenedOutboundFetcher()
          ).fetch(String(run.requested_url), controller.signal);
          results = [
            { ...extractHtml(fetched), retrievedAt: fetched.retrievedAt },
          ];
        } else if (method === "rss") {
          const feed = await client.query<Record<string, unknown>>(
            "SELECT * FROM control.source_feeds WHERE id=$1 AND workspace_id=$2 AND enabled",
            [payload.feedId, payload.workspaceId],
          );
          if (!feed.rowCount) throw new Error("SOURCE_FEED_NOT_FOUND");
          const fetched = await (
            this.dependencies.fetcher ?? new HardenedOutboundFetcher()
          ).fetch(String(feed.rows[0]?.feed_url), controller.signal);
          results = parseFeed(fetched.body, fetched.finalUrl).map((result) => ({
            ...result,
            retrievedAt: fetched.retrievedAt,
          }));
          await client.query(
            "UPDATE control.source_feeds SET last_retrieved_at=now(),last_status='succeeded',last_error='',updated_at=now() WHERE id=$1",
            [payload.feedId],
          );
        } else {
          const providerId = String(run.provider_id);
          const configuration = await client.query(
            "SELECT * FROM control.source_provider_configurations WHERE workspace_id=$1 AND provider_id=$2 AND enabled",
            [payload.workspaceId, providerId],
          );
          const config = configuration.rows[0] as
            | Record<string, unknown>
            | undefined;
          let credential: string | undefined;
          if (typeof config?.secret_reference === "string") {
            if (!this.dependencies.secretProvider)
              throw new Error("SOURCE_PROVIDER_SECRET_UNAVAILABLE");
            credential = await this.dependencies.secretProvider.resolve(
              config.secret_reference,
              { tenantId: job.tenantId, connectionId: String(config.id) },
            );
          }
          if (method === "search") {
            const provider = this.#search.get(providerId);
            if (!provider)
              throw new Error("SOURCE_SEARCH_PROVIDER_UNAVAILABLE");
            const output = await provider.search({
              query: String(run.query),
              limit: 25,
              ...(credential ? { credential } : {}),
              signal: controller.signal,
            });
            results = output.results.map((result) =>
              resultSchema.parse(result),
            );
            estimatedCost = output.estimatedCost;
            actualCost = output.actualCost;
          } else {
            const provider = this.#apiFeeds.get(providerId);
            if (!provider || !config)
              throw new Error("SOURCE_API_PROVIDER_UNAVAILABLE");
            const output = await provider.discover({
              configuration: (config.configuration ?? {}) as Record<
                string,
                unknown
              >,
              ...(credential ? { credential } : {}),
              signal: controller.signal,
            });
            results = output.results.map((result) =>
              resultSchema.parse(result),
            );
            estimatedCost = output.estimatedCost;
            actualCost = output.actualCost;
          }
        }
        const deduped = new Map<string, (typeof results)[number]>();
        const cancellation = await client.query<{
          cancellation_requested: boolean;
        }>(
          "SELECT cancellation_requested FROM control.discovery_runs WHERE id=$1",
          [payload.runId],
        );
        if (cancellation.rows[0]?.cancellation_requested) {
          await client.query(
            "UPDATE control.discovery_runs SET status='cancelled',completed_at=now(),updated_at=now() WHERE id=$1",
            [payload.runId],
          );
          return;
        }
        for (const result of results) {
          const normalized = safeSourceUrl(result.canonicalUrl ?? result.url);
          if (!deduped.has(normalized)) deduped.set(normalized, result);
        }
        for (const [normalized, result] of deduped) {
          const content = result.extractedMaterial ?? result.snippet;
          await client.query(
            `INSERT INTO control.discovery_results(id,tenant_id,workspace_id,discovery_run_id,provider_result_id,title,source_url,canonical_url,normalized_url,publisher,author,snippet,extracted_material,publication_at,retrieved_at,content_fingerprint,provider_metadata,provenance,retrieval_status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'succeeded') ON CONFLICT(tenant_id,discovery_run_id,normalized_url) DO NOTHING`,
            [
              randomUUID(),
              job.tenantId,
              payload.workspaceId,
              payload.runId,
              result.providerResultId ?? "",
              result.title,
              result.url,
              normalized,
              result.publisher,
              result.author ??
                (typeof result.providerMetadata.author === "string"
                  ? result.providerMetadata.author
                  : ""),
              result.snippet,
              result.extractedMaterial ?? "",
              result.publicationAt ?? null,
              result.retrievedAt ?? null,
              fingerprint(content),
              result.providerMetadata,
              {
                method,
                providerId: run.provider_id,
                originalUrl: result.url,
                retrievedAt: result.retrievedAt ?? null,
                untrusted: true,
              },
            ],
          );
        }
        await client.query(
          "INSERT INTO control.provider_usage_events(id,tenant_id,workspace_id,discovery_run_id,provider_id,operation,result_count,estimated_cost,actual_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            job.tenantId,
            payload.workspaceId,
            payload.runId,
            run.provider_id,
            method === "manual"
              ? "retrieve_url"
              : method === "rss"
                ? "retrieve_feed"
                : method,
            deduped.size,
            estimatedCost ?? null,
            actualCost ?? null,
          ],
        );
        await client.query(
          "UPDATE control.discovery_runs SET status='succeeded',result_count=$2,completed_at=now(),updated_at=now() WHERE id=$1",
          [payload.runId, deduped.size],
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "SOURCE_INGESTION_FAILED";
        await client.query(
          "UPDATE control.discovery_runs SET status='failed',error_code=$2,error_detail=$3,completed_at=now(),updated_at=now() WHERE id=$1",
          [payload.runId, message.slice(0, 120), message.slice(0, 2000)],
        );
        if (payload.feedId)
          await client.query(
            "UPDATE control.source_feeds SET last_status='failed',last_error=$2,last_retrieved_at=now(),updated_at=now() WHERE id=$1",
            [payload.feedId, message.slice(0, 2000)],
          );
        processingError =
          error instanceof Error ? error : new Error("SOURCE_INGESTION_FAILED");
      }
    });
    if (processingError) throw processingError;
  }
  async #available(
    client: DatabaseClient,
    tenantId: string,
    workspaceId: string,
  ) {
    const result = await client.query(
      `SELECT 1 FROM control.business_workspaces w JOIN control.installation_entitlements e ON e.tenant_id=w.tenant_id AND e.installation_id=w.installation_id JOIN control.feature_flags f ON f.tenant_id=w.tenant_id AND f.name='module.media-intelligence' AND f.enabled WHERE w.tenant_id=$1 AND w.id=$2 AND 'media_intelligence'=ANY(e.enabled_modules) AND e.effective_from<=now() AND (e.effective_until IS NULL OR e.effective_until>now())`,
      [tenantId, workspaceId],
    );
    if (result.rowCount !== 1)
      throw fail("MEDIA_INTELLIGENCE_NOT_ENTITLED", 403);
  }
  async #audit(
    client: DatabaseClient,
    input: { tenantId: string; actorUserId: string; correlationId: string },
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    const id = randomUUID();
    await client.query(
      "INSERT INTO control.audit_events(id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.tenantId,
        input.actorUserId,
        action,
        targetType,
        targetId,
        input.correlationId,
        metadata,
      ],
    );
    await client.query(
      "INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id) VALUES($1,$2,$3,1,$4,$5)",
      [
        randomUUID(),
        input.tenantId,
        action,
        { auditEventId: id, targetId },
        input.correlationId,
      ],
    );
  }
}
