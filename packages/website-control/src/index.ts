import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  ConnectorRuntimeError,
  connectorManifestSchema,
  type AdapterExecutionContext,
  type ConnectorAdapter,
  type ConnectorHealth,
} from "@redi-control/connector-sdk";
import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });
const nullableIsoDateSchema = isoDateSchema.nullable().optional();
const statusSchema = z.enum(["draft", "pending", "published", "archived"]);
const sourceSchema = z
  .object({ label: z.string().max(300).optional(), url: z.url() })
  .strict();
const contentBlockSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("paragraph"), text: z.string().max(10_000) })
    .strict(),
  z
    .object({
      type: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3)]),
      text: z.string().max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      style: z.enum(["ordered", "unordered"]),
      items: z.array(z.string().max(2_000)).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("quote"),
      text: z.string().max(5_000),
      attribution: z.string().max(500).optional(),
    })
    .strict(),
]);
export const articleContentSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(contentBlockSchema).max(200),
  })
  .strict();
const articleMediaSchema = z
  .object({
    id: uuidSchema,
    url: z.string().startsWith("/api/media/"),
    altText: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();
const articleSummarySchema = z
  .object({
    id: uuidSchema,
    externalReference: z.string().optional(),
    slug: z.string(),
    title: z.string(),
    excerpt: z.string(),
    categoryId: uuidSchema.optional(),
    status: statusSchema,
    featured: z.boolean(),
    tags: z.array(z.string()),
    displayAuthor: z.string().optional(),
    version: z.number().int().positive(),
    publishAt: nullableIsoDateSchema,
    publishedAt: nullableIsoDateSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
export const articleSchema = articleSummarySchema
  .extend({
    body: articleContentSchema,
    featuredMediaId: uuidSchema.optional(),
    articleMedia: z.array(articleMediaSchema),
    featuredImageAlt: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    canonicalUrl: z.url().optional(),
    sources: z.array(sourceSchema),
  })
  .strict();
const cursorSchema = z
  .object({ createdAt: isoDateSchema, id: uuidSchema })
  .strict()
  .nullable();
const articlePageSchema = z
  .object({ items: z.array(articleSummarySchema), nextCursor: cursorSchema })
  .strict();
const articleEnvelopeSchema = z.object({ article: articleSchema }).strict();
const mediaSchema = z
  .object({
    id: uuidSchema,
    siteId: uuidSchema.optional(),
    url: z.string().startsWith("/api/media/"),
    mimeType: z.literal("image/webp"),
    altText: z.string().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    byteSize: z.number().int().positive(),
    createdAt: isoDateSchema.optional(),
  })
  .strict();
const mediaPageSchema = z
  .object({ items: z.array(mediaSchema), nextCursor: cursorSchema })
  .strict();
const mediaEnvelopeSchema = z.object({ media: mediaSchema }).strict();

const createArticleSchema = z
  .object({
    externalReference: z.string().min(1).max(300),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    title: z.string().min(1).max(240),
    excerpt: z.string().max(1_000).optional(),
    body: articleContentSchema,
    categoryId: uuidSchema.nullable().optional(),
    featuredMediaId: uuidSchema.nullable().optional(),
    articleMediaIds: z.array(uuidSchema).max(20).optional(),
    featuredImageAlt: z.string().max(500).optional(),
    tags: z.array(z.string().max(80)).max(30).optional(),
    displayAuthor: z.string().max(200).optional(),
    featured: z.boolean().optional(),
    publishAt: isoDateSchema.nullable().optional(),
    seoTitle: z.string().max(240).optional(),
    seoDescription: z.string().max(500).optional(),
    canonicalUrl: z.url().optional(),
    sources: z.array(sourceSchema).max(50).optional(),
  })
  .strict();
const articlePatchSchema = createArticleSchema
  .omit({ externalReference: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const articleListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    status: statusSchema.optional(),
    before: isoDateSchema.optional(),
    cursorId: uuidSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.before) === Boolean(value.cursorId));
const mediaListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
    before: isoDateSchema.optional(),
    cursorId: uuidSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.before) === Boolean(value.cursorId));
const readArticleInputSchema = z.object({ articleId: uuidSchema }).strict();
const updateArticleInputSchema = z
  .object({
    articleId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    patch: articlePatchSchema,
  })
  .strict();
const transitionInputSchema = z
  .object({
    articleId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
const publishInputSchema = transitionInputSchema
  .extend({
    approval: z
      .object({
        approvedBy: z.string().min(1).max(200),
        approvedAt: isoDateSchema,
      })
      .strict(),
  })
  .strict();
const uploadMediaInputSchema = z
  .object({
    filename: z.string().min(1).max(120),
    mimeType: z.literal("image/webp"),
    dataBase64: z.string().min(4).max(5_700_000),
    altText: z.string().max(500).optional(),
  })
  .strict();

export const businessSiteConnectionConfigurationSchema = z
  .object({
    apiBaseUrl: z.url(),
    integrationId: z.string().regex(/^[A-Za-z0-9._:-]{1,300}$/),
    displayName: z.string().min(1).max(160),
    domain: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/),
    previewUrl: z.url().optional(),
    allowLocalHttp: z.boolean().optional(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const url = new URL(configuration.apiBaseUrl);
    const local = ["127.0.0.1", "localhost"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, "") !== "/api/integrations/redi-control/v1" ||
      (url.protocol !== "https:" &&
        !(configuration.allowLocalHttp && local && url.protocol === "http:"))
    )
      context.addIssue({
        code: "custom",
        message: "Invalid BusinessSite API base URL",
      });
    if (configuration.previewUrl) {
      const preview = new URL(configuration.previewUrl);
      const previewLocal = ["127.0.0.1", "localhost"].includes(
        preview.hostname,
      );
      if (
        preview.username ||
        preview.password ||
        (preview.protocol !== "https:" &&
          !(
            configuration.allowLocalHttp &&
            previewLocal &&
            preview.protocol === "http:"
          ))
      )
        context.addIssue({ code: "custom", message: "Invalid preview URL" });
    }
  });
export type BusinessSiteConnectionConfiguration = z.infer<
  typeof businessSiteConnectionConfigurationSchema
>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function businessSiteCanonicalRequest(input: {
  integrationId: string;
  timestamp: string;
  nonce: string;
  method: string;
  pathnameAndQuery: string;
  rawBody: string;
}): string {
  const bodyHash = createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");
  return [
    input.integrationId,
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathnameAndQuery,
    bodyHash,
  ].join("\n");
}

export function signBusinessSiteRequest(
  secret: string,
  input: Parameters<typeof businessSiteCanonicalRequest>[0],
): string {
  if (secret.length < 32)
    throw new ConnectorRuntimeError("SECRET_UNAVAILABLE", 503);
  return `v1=${createHmac("sha256", secret)
    .update(businessSiteCanonicalRequest(input), "utf8")
    .digest("hex")}`;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class BusinessSiteInformationClient {
  public constructor(
    private readonly configuration: BusinessSiteConnectionConfiguration,
    private readonly secret: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly nonce: () => string = randomUUID,
  ) {
    businessSiteConnectionConfigurationSchema.parse(configuration);
    if (secret.length < 32)
      throw new ConnectorRuntimeError("SECRET_UNAVAILABLE", 503);
  }

  async #request(
    method: "GET" | "POST" | "PATCH",
    path: string,
    responseSchema: z.ZodType,
    body?: unknown,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const base = this.configuration.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}${path}`);
    const rawBody = body === undefined ? "" : stableJson(body);
    const timestamp = String(Math.floor(this.now() / 1_000));
    const nonce = this.nonce();
    const pathnameAndQuery = `${url.pathname}${url.search}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-integration-id": this.configuration.integrationId,
      "x-signature-timestamp": timestamp,
      "x-signature-nonce": nonce,
      "x-signature": signBusinessSiteRequest(this.secret, {
        integrationId: this.configuration.integrationId,
        timestamp,
        nonce,
        method,
        pathnameAndQuery,
        rawBody,
      }),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    const response = await this.fetcher(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: rawBody }),
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ConnectorRuntimeError("INVALID_COMMAND_OUTPUT", 502);
    }
    if (!response.ok) {
      if (response.status === 401)
        throw new ConnectorRuntimeError("REMOTE_AUTHENTICATION_FAILED", 502);
      if (response.status === 403)
        throw new ConnectorRuntimeError("REMOTE_PERMISSION_DENIED", 403);
      if (response.status === 409)
        throw new ConnectorRuntimeError("REMOTE_CONFLICT", 409);
      if (response.status === 429)
        throw new ConnectorRuntimeError("RATE_LIMITED", 429);
      throw new ConnectorRuntimeError(
        "REMOTE_REJECTED",
        response.status >= 500 ? 502 : 400,
      );
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success)
      throw new ConnectorRuntimeError("INVALID_COMMAND_OUTPUT", 502);
    return parsed.data;
  }

  public executeRead(commandId: string, input: unknown, signal: AbortSignal) {
    if (commandId === "articles.list") {
      const query = articleListInputSchema.parse(input);
      const parameters = new URLSearchParams();
      if (query.limit) parameters.set("limit", String(query.limit));
      if (query.status) parameters.set("status", query.status);
      if (query.before) parameters.set("before", query.before);
      if (query.cursorId) parameters.set("cursorId", query.cursorId);
      const suffix = parameters.size ? `?${parameters.toString()}` : "";
      return this.#request(
        "GET",
        `/articles${suffix}`,
        articlePageSchema,
        undefined,
        undefined,
        signal,
      );
    }
    if (commandId === "articles.read") {
      const value = readArticleInputSchema.parse(input);
      return this.#request(
        "GET",
        `/articles/${value.articleId}`,
        articleEnvelopeSchema,
        undefined,
        undefined,
        signal,
      );
    }
    if (commandId === "media.list") {
      const query = mediaListInputSchema.parse(input);
      const parameters = new URLSearchParams();
      if (query.limit) parameters.set("limit", String(query.limit));
      if (query.before) parameters.set("before", query.before);
      if (query.cursorId) parameters.set("cursorId", query.cursorId);
      const suffix = parameters.size ? `?${parameters.toString()}` : "";
      return this.#request(
        "GET",
        `/media${suffix}`,
        mediaPageSchema,
        undefined,
        undefined,
        signal,
      );
    }
    return Promise.reject(
      new ConnectorRuntimeError("COMMAND_NOT_DECLARED", 404),
    );
  }

  public executeWrite(
    commandId: string,
    input: unknown,
    idempotencyKey: string,
    signal: AbortSignal,
  ) {
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey))
      return Promise.reject(
        new ConnectorRuntimeError("INVALID_COMMAND_INPUT", 400),
      );
    if (commandId === "articles.create")
      return this.#request(
        "POST",
        "/articles",
        articleEnvelopeSchema
          .extend({ externalReferenceReplay: z.boolean() })
          .strict(),
        createArticleSchema.parse(input),
        idempotencyKey,
        signal,
      );
    if (commandId === "articles.update") {
      const value = updateArticleInputSchema.parse(input);
      return this.#request(
        "PATCH",
        `/articles/${value.articleId}`,
        articleEnvelopeSchema,
        { expectedVersion: value.expectedVersion, patch: value.patch },
        idempotencyKey,
        signal,
      );
    }
    if (["articles.submit", "articles.archive"].includes(commandId)) {
      const value = transitionInputSchema.parse(input);
      const action = commandId === "articles.submit" ? "submit" : "archive";
      return this.#request(
        "POST",
        `/articles/${value.articleId}/${action}`,
        articleEnvelopeSchema,
        { expectedVersion: value.expectedVersion },
        idempotencyKey,
        signal,
      );
    }
    if (commandId === "articles.publish") {
      const value = publishInputSchema.parse(input);
      return this.#request(
        "POST",
        `/articles/${value.articleId}/publish`,
        articleEnvelopeSchema,
        { expectedVersion: value.expectedVersion, approval: value.approval },
        idempotencyKey,
        signal,
      );
    }
    if (commandId === "media.upload")
      return this.#request(
        "POST",
        "/media",
        mediaEnvelopeSchema,
        uploadMediaInputSchema.parse(input),
        idempotencyKey,
        signal,
      );
    return Promise.reject(
      new ConnectorRuntimeError("COMMAND_NOT_DECLARED", 404),
    );
  }
}

export interface BusinessSiteReadOnlyProbeResult {
  readonly articleSampleCount: number;
  readonly mediaSampleCount: number;
  readonly articlePaginationAvailable: boolean;
  readonly mediaPaginationAvailable: boolean;
}

export interface BusinessSiteAuthenticationProbeResult {
  readonly validRequestAccepted: true;
  readonly nonceReplayDenied: true;
  readonly staleTimestampDenied: true;
  readonly invalidSignatureDenied: true;
  readonly unknownIntegrationDenied: true;
}

export async function probeBusinessSiteInformationReadOnly(
  configuration: BusinessSiteConnectionConfiguration,
  secret: string,
  options: { readonly timeoutMs?: number; readonly fetcher?: Fetcher } = {},
): Promise<BusinessSiteReadOnlyProbeResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000)
    throw new ConnectorRuntimeError("INVALID_CONFIGURATION", 503);
  const client = new BusinessSiteInformationClient(
    configuration,
    secret,
    options.fetcher,
  );
  const articles = (await client.executeRead(
    "articles.list",
    { limit: 1 },
    AbortSignal.timeout(timeoutMs),
  )) as {
    items: unknown[];
    nextCursor: { createdAt: string; id: string } | null;
  };
  const media = (await client.executeRead(
    "media.list",
    { limit: 1 },
    AbortSignal.timeout(timeoutMs),
  )) as {
    items: unknown[];
    nextCursor: { createdAt: string; id: string } | null;
  };
  return {
    articleSampleCount: articles.items.length,
    mediaSampleCount: media.items.length,
    articlePaginationAvailable: articles.nextCursor !== null,
    mediaPaginationAvailable: media.nextCursor !== null,
  };
}

export async function probeBusinessSiteInformationAuthentication(
  configuration: BusinessSiteConnectionConfiguration,
  secret: string,
  options: {
    readonly timeoutMs?: number;
    readonly fetcher?: Fetcher;
    readonly now?: () => number;
    readonly nonce?: () => string;
  } = {},
): Promise<BusinessSiteAuthenticationProbeResult> {
  const parsedConfiguration =
    businessSiteConnectionConfigurationSchema.parse(configuration);
  if (secret.length < 32)
    throw new ConnectorRuntimeError("SECRET_UNAVAILABLE", 503);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000)
    throw new ConnectorRuntimeError("INVALID_CONFIGURATION", 503);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const nextNonce = options.nonce ?? randomUUID;
  const url = new URL(
    `${parsedConfiguration.apiBaseUrl.replace(/\/$/, "")}/articles?limit=1`,
  );
  const pathnameAndQuery = `${url.pathname}${url.search}`;
  const currentTimestamp = String(Math.floor(now() / 1_000));

  const signedHeaders = (input: {
    integrationId: string;
    timestamp: string;
    nonce: string;
  }): Record<string, string> => ({
    accept: "application/json",
    "x-integration-id": input.integrationId,
    "x-signature-timestamp": input.timestamp,
    "x-signature-nonce": input.nonce,
    "x-signature": signBusinessSiteRequest(secret, {
      integrationId: input.integrationId,
      timestamp: input.timestamp,
      nonce: input.nonce,
      method: "GET",
      pathnameAndQuery,
      rawBody: "",
    }),
  });
  const request = (headers: Record<string, string>) =>
    fetcher(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  const expectAuthenticationDenied = async (
    response: Response,
  ): Promise<void> => {
    if (response.status !== 401)
      throw new ConnectorRuntimeError("REMOTE_REJECTED", 502);
    await response.body?.cancel();
  };

  const validHeaders = signedHeaders({
    integrationId: parsedConfiguration.integrationId,
    timestamp: currentTimestamp,
    nonce: nextNonce(),
  });
  const validResponse = await request(validHeaders);
  if (!validResponse.ok) {
    await validResponse.body?.cancel();
    throw new ConnectorRuntimeError(
      validResponse.status === 401
        ? "REMOTE_AUTHENTICATION_FAILED"
        : validResponse.status === 403
          ? "REMOTE_PERMISSION_DENIED"
          : "REMOTE_REJECTED",
      validResponse.status === 403 ? 403 : 502,
    );
  }
  const validPayload: unknown = await validResponse
    .json()
    .catch((): undefined => undefined);
  if (!articlePageSchema.safeParse(validPayload).success)
    throw new ConnectorRuntimeError("INVALID_COMMAND_OUTPUT", 502);

  await expectAuthenticationDenied(await request(validHeaders));
  await expectAuthenticationDenied(
    await request(
      signedHeaders({
        integrationId: parsedConfiguration.integrationId,
        timestamp: String(Number(currentTimestamp) - 600),
        nonce: nextNonce(),
      }),
    ),
  );
  const invalidSignatureHeaders = signedHeaders({
    integrationId: parsedConfiguration.integrationId,
    timestamp: currentTimestamp,
    nonce: nextNonce(),
  });
  invalidSignatureHeaders["x-signature"] = `v1=${"0".repeat(64)}`;
  await expectAuthenticationDenied(await request(invalidSignatureHeaders));
  const unknownIntegrationId = `unknown-${createHash("sha256")
    .update(parsedConfiguration.integrationId)
    .digest("hex")
    .slice(0, 16)}`;
  await expectAuthenticationDenied(
    await request(
      signedHeaders({
        integrationId: unknownIntegrationId,
        timestamp: currentTimestamp,
        nonce: nextNonce(),
      }),
    ),
  );

  return {
    validRequestAccepted: true,
    nonceReplayDenied: true,
    staleTimestampDenied: true,
    invalidSignatureDenied: true,
    unknownIntegrationDenied: true,
  };
}

const objectInput = (required: string[] = []) => ({
  type: "object",
  additionalProperties: true,
  required,
  properties: Object.fromEntries(required.map((key) => [key, {}])),
});
const strictEnvelope = (required: string[]) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties: Object.fromEntries(required.map((key) => [key, {}])),
});

const commandDefinitions = [
  [
    "articles.list",
    "read",
    "low",
    "articles.read",
    "optional",
    objectInput(),
    strictEnvelope(["items", "nextCursor"]),
  ],
  [
    "articles.read",
    "read",
    "low",
    "articles.read",
    "optional",
    objectInput(["articleId"]),
    strictEnvelope(["article"]),
  ],
  [
    "articles.create",
    "write",
    "medium",
    "articles.create",
    "required",
    objectInput(["externalReference", "slug", "title", "body"]),
    strictEnvelope(["article", "externalReferenceReplay"]),
  ],
  [
    "articles.update",
    "write",
    "medium",
    "articles.update",
    "required",
    objectInput(["articleId", "expectedVersion", "patch"]),
    strictEnvelope(["article"]),
  ],
  [
    "articles.submit",
    "write",
    "high",
    "articles.submit",
    "required",
    objectInput(["articleId", "expectedVersion"]),
    strictEnvelope(["article"]),
  ],
  [
    "articles.publish",
    "write",
    "critical",
    "articles.publish",
    "required",
    objectInput(["articleId", "expectedVersion", "approval"]),
    strictEnvelope(["article"]),
  ],
  [
    "articles.archive",
    "write",
    "high",
    "articles.archive",
    "required",
    objectInput(["articleId", "expectedVersion"]),
    strictEnvelope(["article"]),
  ],
  [
    "media.list",
    "read",
    "low",
    "media.read",
    "optional",
    objectInput(),
    strictEnvelope(["items", "nextCursor"]),
  ],
  [
    "media.upload",
    "write",
    "high",
    "media.write",
    "required",
    objectInput(["filename", "mimeType", "dataBase64"]),
    strictEnvelope(["media"]),
  ],
] as const;

export const businessSiteInformationManifest = connectorManifestSchema.parse({
  schemaVersion: "1.0",
  connectorId: "businesssite-information",
  platformId: "businesssite",
  displayName: "BusinessSite Information",
  connectorVersion: "1.0.0",
  category: "website",
  platformApi: {
    minimumVersion: "redi-information-v1",
    maximumVersion: "redi-information-v1",
  },
  authentication: { methods: ["service_token"], secretRequired: true },
  scopes: [
    ...new Map(
      commandDefinitions.map(([, , , scope]) => [
        scope,
        {
          id: scope,
          required: true,
          description: `BusinessSite Phase 7 permission ${scope}`,
        },
      ]),
    ).values(),
  ],
  capabilities: commandDefinitions.map(([id, mode, risk]) => ({
    id,
    mode,
    risk,
  })),
  commands: commandDefinitions.map(
    ([id, mode, risk, scope, idempotency, inputSchema, outputSchema]) => ({
      id,
      capability: id,
      mode,
      risk,
      requiredScopes: [scope],
      inputSchema,
      outputSchema,
      idempotency,
      timeoutMs: id === "media.upload" ? 30_000 : 10_000,
    }),
  ),
  health: { timeoutMs: 5_000, supportsDegraded: true },
  webhooks: { events: [], signature: { required: false } },
  limits: {
    timeoutMs: 30_000,
    rateLimit: { requests: 120, windowSeconds: 60 },
    retry: {
      maxAttempts: 3,
      baseDelayMs: 500,
      retryableCodes: ["rate-limited", "unavailable", "timeout"],
    },
  },
  compatibility: {
    minimumControlVersion: "0.2.0",
    maximumControlVersion: "0.2.99",
  },
  deprecation: {},
});

function clientFromContext(
  context: AdapterExecutionContext,
  fetcher?: Fetcher,
) {
  const configuration = businessSiteConnectionConfigurationSchema.safeParse(
    context.configuration,
  );
  if (!configuration.success)
    throw new ConnectorRuntimeError("INVALID_CONFIGURATION", 503);
  if (!context.secret)
    throw new ConnectorRuntimeError("SECRET_UNAVAILABLE", 503);
  return new BusinessSiteInformationClient(
    configuration.data,
    context.secret,
    fetcher,
  );
}

export class BusinessSiteInformationConnector implements ConnectorAdapter {
  public readonly manifest = businessSiteInformationManifest;
  public constructor(private readonly fetcher?: Fetcher) {}
  public initialize(): Promise<void> {
    return Promise.resolve();
  }
  public disconnect(): Promise<void> {
    return Promise.resolve();
  }
  public async health(
    context: AdapterExecutionContext,
    signal: AbortSignal,
  ): Promise<ConnectorHealth> {
    await clientFromContext(context, this.fetcher).executeRead(
      "articles.list",
      { limit: 1 },
      signal,
    );
    return { status: "healthy", checkedAt: new Date().toISOString() };
  }
  public executeRead(
    commandId: string,
    input: unknown,
    context: AdapterExecutionContext,
    signal: AbortSignal,
  ) {
    return clientFromContext(context, this.fetcher).executeRead(
      commandId,
      input,
      signal,
    );
  }
  public executeWrite(
    commandId: string,
    input: unknown,
    idempotencyKey: string,
    context: AdapterExecutionContext,
    signal: AbortSignal,
  ) {
    return clientFromContext(context, this.fetcher).executeWrite(
      commandId,
      input,
      idempotencyKey,
      signal,
    );
  }
}
