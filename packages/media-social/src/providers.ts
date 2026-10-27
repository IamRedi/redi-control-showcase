import { createHash } from "node:crypto";

import {
  connectorManifestSchema,
  type ConnectorManifest,
} from "@redi-control/connector-sdk";
import { z } from "zod";

export const socialPublishPayloadSchema = z.object({
  title: z.string().max(100).optional(),
  caption: z.string().max(5000).optional(),
  description: z.string().max(5000).optional(),
  privacyStatus: z.enum(["private", "unlisted", "public"]).optional(),
  media: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        objectKey: z
          .string()
          .regex(/^tenant\/[0-9a-f-]{36}\/media\/[0-9a-f-]{36}\/[a-z0-9._-]+$/),
        mimeType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "video/mp4",
        ]),
        sizeBytes: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(10),
});
export type SocialPublishPayload = z.infer<typeof socialPublishPayloadSchema>;

const noWebhooks = { events: [], signature: { required: false } } as const;
const commonLimits = {
  timeoutMs: 30_000,
  rateLimit: { requests: 10, windowSeconds: 60 },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    retryableCodes: ["rate-limited", "transient"],
  },
} as const;
const writeInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["accountId", "revisionId", "media"],
  properties: {
    accountId: { type: "string", format: "uuid" },
    revisionId: { type: "string", format: "uuid" },
    title: { type: "string" },
    caption: { type: "string" },
    description: { type: "string" },
    privacyStatus: { enum: ["private", "unlisted", "public"] },
    media: { type: "array", minItems: 1, items: { type: "object" } },
  },
} as const;
const publishOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerReference", "status"],
  properties: {
    providerReference: { type: "string" },
    status: { enum: ["published", "processing"] },
  },
} as const;

export const metaConnectorManifest: ConnectorManifest =
  connectorManifestSchema.parse({
    schemaVersion: "1.0",
    connectorId: "meta-social",
    platformId: "meta",
    displayName: "Meta (Facebook Pages & Instagram)",
    connectorVersion: "1.0.0",
    category: "social",
    platformApi: { minimumVersion: "configured-at-deployment" },
    authentication: { methods: ["oauth2"], secretRequired: true },
    scopes: [
      {
        id: "pages.show-list",
        required: true,
        description: "Discover authorized Facebook Pages",
      },
      {
        id: "pages.manage-posts",
        required: true,
        description: "Publish to an authorized Facebook Page",
      },
      {
        id: "instagram.basic",
        required: true,
        description: "Discover the linked professional Instagram account",
      },
      {
        id: "instagram.content-publish",
        required: true,
        description: "Publish supported Instagram media",
      },
    ],
    capabilities: [
      { id: "facebook.page.discover", mode: "read", risk: "low" },
      { id: "instagram.account.discover", mode: "read", risk: "low" },
      { id: "facebook.image.publish", mode: "write", risk: "high" },
      { id: "facebook.video.publish", mode: "write", risk: "high" },
      { id: "instagram.image.publish", mode: "write", risk: "high" },
      { id: "instagram.video.publish", mode: "write", risk: "high" },
      { id: "instagram.carousel.publish", mode: "write", risk: "high" },
    ],
    commands: [
      {
        id: "facebook.image.publish",
        capability: "facebook.image.publish",
        mode: "write",
        risk: "high",
        requiredScopes: ["pages.manage-posts"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
      {
        id: "facebook.video.publish",
        capability: "facebook.video.publish",
        mode: "write",
        risk: "high",
        requiredScopes: ["pages.manage-posts"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
      {
        id: "instagram.image.publish",
        capability: "instagram.image.publish",
        mode: "write",
        risk: "high",
        requiredScopes: ["instagram.content-publish"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
      {
        id: "instagram.video.publish",
        capability: "instagram.video.publish",
        mode: "write",
        risk: "high",
        requiredScopes: ["instagram.content-publish"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
      {
        id: "instagram.carousel.publish",
        capability: "instagram.carousel.publish",
        mode: "write",
        risk: "high",
        requiredScopes: ["instagram.content-publish"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
    ],
    health: { timeoutMs: 5000, supportsDegraded: true },
    webhooks: noWebhooks,
    limits: commonLimits,
    compatibility: {
      minimumControlVersion: "0.3.0",
      maximumControlVersion: "0.3.99",
    },
    deprecation: {},
  });

export const youtubeConnectorManifest: ConnectorManifest =
  connectorManifestSchema.parse({
    schemaVersion: "1.0",
    connectorId: "youtube-social",
    platformId: "youtube",
    displayName: "YouTube",
    connectorVersion: "1.0.0",
    category: "social",
    platformApi: { minimumVersion: "YouTube Data API v3" },
    authentication: { methods: ["oauth2"], secretRequired: true },
    scopes: [
      {
        id: "youtube.readonly",
        required: true,
        description: "Discover the authorized YouTube channel",
      },
      {
        id: "youtube.upload",
        required: true,
        description: "Upload videos to the authorized user channel",
      },
    ],
    capabilities: [
      { id: "youtube.channel.discover", mode: "read", risk: "low" },
      { id: "youtube.video.publish", mode: "write", risk: "high" },
    ],
    commands: [
      {
        id: "youtube.video.publish",
        capability: "youtube.video.publish",
        mode: "write",
        risk: "high",
        requiredScopes: ["youtube.upload"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
    ],
    health: { timeoutMs: 5000, supportsDegraded: true },
    webhooks: noWebhooks,
    limits: { ...commonLimits, timeoutMs: 30_000 },
    compatibility: {
      minimumControlVersion: "0.3.0",
      maximumControlVersion: "0.3.99",
    },
    deprecation: {},
  });

export const tiktokConnectorManifest: ConnectorManifest =
  connectorManifestSchema.parse({
    schemaVersion: "1.0",
    connectorId: "tiktok-social-disabled",
    platformId: "tiktok",
    displayName: "TikTok (requires approval)",
    connectorVersion: "1.0.0",
    category: "social",
    platformApi: { minimumVersion: "Content Posting API v2" },
    authentication: { methods: ["oauth2"], secretRequired: true },
    scopes: [
      {
        id: "video.upload",
        required: true,
        description: "Upload photo/video content for user completion",
      },
      {
        id: "video.publish",
        required: true,
        description: "Direct Post after app audit and user authorization",
      },
    ],
    capabilities: [
      { id: "tiktok.photo.upload", mode: "write", risk: "high" },
      { id: "tiktok.video.upload", mode: "write", risk: "high" },
      { id: "tiktok.direct-post", mode: "write", risk: "high" },
    ],
    commands: [
      {
        id: "tiktok.photo.upload",
        capability: "tiktok.photo.upload",
        mode: "write",
        risk: "high",
        requiredScopes: ["video.upload"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
      {
        id: "tiktok.video.upload",
        capability: "tiktok.video.upload",
        mode: "write",
        risk: "high",
        requiredScopes: ["video.upload"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
      {
        id: "tiktok.direct-post",
        capability: "tiktok.direct-post",
        mode: "write",
        risk: "high",
        requiredScopes: ["video.publish"],
        inputSchema: writeInputSchema,
        outputSchema: publishOutputSchema,
        idempotency: "required",
        timeoutMs: 30_000,
      },
    ],
    health: { timeoutMs: 5000, supportsDegraded: false },
    webhooks: noWebhooks,
    limits: commonLimits,
    compatibility: {
      minimumControlVersion: "0.3.0",
      maximumControlVersion: "0.3.99",
    },
    deprecation: {},
  });

export type PublicationFailureCategory =
  | "authorization"
  | "validation"
  | "rate_limited"
  | "transient"
  | "provider"
  | "disabled";
export interface SocialPublishResult {
  readonly status: "published" | "processing";
  readonly providerReference: string;
}
export interface SocialProviderAdapter {
  readonly provider: "meta" | "youtube" | "tiktok";
  readonly configured: boolean;
  readonly manifest: ConnectorManifest;
  publish(
    input: SocialPublishPayload,
    context: { accountType: string; idempotencyKey: string; token: string },
  ): Promise<SocialPublishResult>;
  poll(providerReference: string, token: string): Promise<SocialPublishResult>;
}

export class SocialProviderError extends Error {
  public constructor(
    public readonly category: PublicationFailureCategory,
    public readonly retryable: boolean,
  ) {
    super(`SOCIAL_PROVIDER_${category.toUpperCase()}`);
  }
}

export class DisabledSocialProvider implements SocialProviderAdapter {
  public readonly configured = false;
  public constructor(
    public readonly provider: "meta" | "youtube" | "tiktok",
    public readonly manifest: ConnectorManifest,
  ) {}
  public publish(): Promise<SocialPublishResult> {
    return Promise.reject(new SocialProviderError("disabled", false));
  }
  public poll(): Promise<SocialPublishResult> {
    return Promise.reject(new SocialProviderError("disabled", false));
  }
}

export type DeterministicPublishMode =
  | "success"
  | "processing"
  | "transient"
  | "reauthorization"
  | "failure";
export class DeterministicSocialProvider implements SocialProviderAdapter {
  public readonly configured = true;
  readonly #results = new Map<string, SocialPublishResult>();
  public calls = 0;
  public constructor(
    public readonly provider: "meta" | "youtube",
    public readonly manifest: ConnectorManifest,
    public mode: DeterministicPublishMode = "success",
  ) {}
  public publish(
    input: SocialPublishPayload,
    context: { accountType: string; idempotencyKey: string; token: string },
  ): Promise<SocialPublishResult> {
    const existing = this.#results.get(context.idempotencyKey);
    if (existing) return Promise.resolve(existing);
    this.calls += 1;
    if (!context.token)
      return Promise.reject(new SocialProviderError("authorization", false));
    if (this.mode === "reauthorization")
      return Promise.reject(new SocialProviderError("authorization", false));
    if (this.mode === "transient")
      return Promise.reject(new SocialProviderError("transient", true));
    if (this.mode === "failure")
      return Promise.reject(new SocialProviderError("provider", false));
    if (
      this.provider === "youtube" &&
      (input.media.length !== 1 || input.media[0]?.mimeType !== "video/mp4")
    )
      return Promise.reject(new SocialProviderError("validation", false));
    if (
      this.provider === "meta" &&
      !["facebook_page", "instagram_account"].includes(context.accountType)
    )
      return Promise.reject(new SocialProviderError("validation", false));
    const result: SocialPublishResult = {
      status: this.mode === "processing" ? "processing" : "published",
      providerReference: `local-${this.provider}-${createHash("sha256").update(context.idempotencyKey).digest("hex").slice(0, 24)}`,
    };
    this.#results.set(context.idempotencyKey, result);
    return Promise.resolve(result);
  }
  public poll(providerReference: string): Promise<SocialPublishResult> {
    return Promise.resolve({ status: "published", providerReference });
  }
}
