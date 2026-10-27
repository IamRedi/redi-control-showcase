import { createHash, randomUUID } from "node:crypto";

import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

export const contentDestinations = [
  "website",
  "facebook",
  "instagram",
] as const;
export type ContentDestination = (typeof contentDestinations)[number];

export interface ContentVariant {
  readonly id: string;
  readonly destination: ContentDestination;
  readonly status: string;
  readonly currentRevision: number;
  readonly externalId?: string;
  readonly safeError?: string;
  readonly websiteConnectionId?: string;
  readonly socialDraftId?: string;
  readonly socialAccountId?: string;
}

export interface ContentItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly summary: string;
  readonly status: "draft" | "active" | "archived";
  readonly version: number;
  readonly mediaAssetIds: readonly string[];
  readonly variants: readonly ContentVariant[];
  readonly deliveryStatus: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebsiteDestinationPreflight {
  readonly itemId: string;
  readonly workspaceId: string;
  readonly status: "ready" | "blocked";
  readonly checks: readonly {
    readonly code: string;
    readonly severity: "pass" | "warning" | "blocker";
  }[];
  readonly connections: readonly {
    readonly connectionId: string;
    readonly displayName: string;
    readonly domain: string;
    readonly status: string;
    readonly healthStatus: string;
    readonly eligible: boolean;
  }[];
  readonly createsVariant: false;
  readonly callsConnector: false;
  readonly publicationAuthorized: false;
}

export interface WebsiteDraft {
  readonly id: string;
  readonly itemId: string;
  readonly workspaceId: string;
  readonly currentRevision: number;
  readonly revision: {
    readonly id: string;
    readonly revision: number;
    readonly slug: string;
    readonly title: string;
    readonly excerpt: string;
    readonly bodyText: string;
    readonly mediaAssetIds: readonly string[];
    readonly contentHash: string;
    readonly createdAt: string;
  };
  readonly review?: {
    readonly id: string;
    readonly decision: "pending" | "approved" | "rejected";
    readonly revision: number;
    readonly contentHash: string;
    readonly requestedAt: string;
    readonly requestedByCurrentUser: boolean;
    readonly decidedAt?: string;
    readonly reason?: string;
    readonly publicationAuthorized: false;
  };
  readonly createsVariant: false;
  readonly callsConnector: false;
  readonly publicationAuthorized: false;
}

export interface WebsiteReviewQueueItem {
  readonly itemId: string;
  readonly draftId: string;
  readonly workspaceId: string;
  readonly itemTitle: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly requestedAt: string;
  readonly requestedByCurrentUser: boolean;
}

interface ItemRow {
  id: string;
  workspace_id: string;
  title: string;
  summary: string;
  status: "draft" | "active" | "archived";
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface VariantRow {
  id: string;
  destination: ContentDestination;
  status: string;
  current_revision: number;
  website_connection_id: string | null;
  social_draft_id: string | null;
  social_account_id: string | null;
  external_id: string | null;
  safe_error: string | null;
}

interface WebsiteDraftRow {
  draft_id: string;
  content_item_id: string;
  workspace_id: string;
  current_revision: number;
  revision_id: string;
  revision: number;
  slug: string;
  title: string;
  excerpt: string;
  body: unknown;
  content_hash: string;
  revision_created_at: Date;
  media_asset_ids: string[];
  review_id: string | null;
  review_decision: "pending" | "approved" | "rejected" | null;
  review_revision: number | null;
  review_content_hash: string | null;
  review_requested_by: string | null;
  review_requested_at: Date | null;
  review_decided_at: Date | null;
  review_reason: string | null;
}

function domainError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function evidence(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    targetId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
     VALUES ($1,$2,$3,$4,'content_item',$5,$6,$7)`,
    [
      auditId,
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetId,
      input.correlationId,
      input.metadata ?? {},
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events
     (id,tenant_id,event_type,event_version,payload,correlation_id)
     VALUES ($1,$2,$3,1,$4,$5)`,
    [
      randomUUID(),
      input.tenantId,
      input.action,
      { auditEventId: auditId, contentItemId: input.targetId },
      input.correlationId,
    ],
  );
}

async function assertAvailable(
  client: DatabaseClient,
  tenantId: string,
  workspaceId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM control.business_workspaces workspace
       JOIN control.installation_entitlements entitlement
         ON entitlement.tenant_id=workspace.tenant_id
        AND entitlement.installation_id=workspace.installation_id
       JOIN control.feature_flags flag
         ON flag.tenant_id=workspace.tenant_id
        AND flag.name='module.unified-content' AND flag.enabled
      WHERE workspace.tenant_id=$1 AND workspace.id=$2
        AND 'unified_content'=ANY(entitlement.enabled_modules)`,
    [tenantId, workspaceId],
  );
  if (result.rowCount !== 1)
    throw domainError("UNIFIED_CONTENT_NOT_ENTITLED", 403);
}

async function assertDestinationAvailable(
  client: DatabaseClient,
  tenantId: string,
  workspaceId: string,
  moduleName: "social" | "websites",
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM control.business_workspaces workspace
      JOIN control.installation_entitlements entitlement
        ON entitlement.tenant_id=workspace.tenant_id
       AND entitlement.installation_id=workspace.installation_id
      JOIN control.feature_flags flag ON flag.tenant_id=workspace.tenant_id
       AND flag.name=$3 AND flag.enabled
     WHERE workspace.tenant_id=$1 AND workspace.id=$2
       AND $4=ANY(entitlement.enabled_modules)
       AND entitlement.effective_from <= now()
       AND (entitlement.effective_until IS NULL OR entitlement.effective_until > now())`,
    [tenantId, workspaceId, `module.${moduleName}`, moduleName],
  );
  if (result.rowCount !== 1)
    throw domainError("CONTENT_DESTINATION_NOT_ENTITLED", 403);
}

async function validateMedia(
  client: DatabaseClient,
  workspaceId: string,
  assetIds: readonly string[],
): Promise<void> {
  if (assetIds.length > 20 || new Set(assetIds).size !== assetIds.length)
    throw domainError("CONTENT_MEDIA_INVALID", 400);
  if (assetIds.length === 0) return;
  const result = await client.query(
    `SELECT id FROM control.media_assets
      WHERE workspace_id=$1 AND id=ANY($2::uuid[])
        AND status='ready' AND soft_deleted_at IS NULL`,
    [workspaceId, [...assetIds]],
  );
  if (result.rowCount !== assetIds.length)
    throw domainError("CONTENT_MEDIA_NOT_READY_OR_NOT_FOUND", 400);
}

async function replaceMedia(
  client: DatabaseClient,
  input: {
    tenantId: string;
    workspaceId: string;
    itemId: string;
    assetIds: readonly string[];
  },
): Promise<void> {
  await validateMedia(client, input.workspaceId, input.assetIds);
  await client.query(
    "DELETE FROM control.media_usage_references WHERE usage_type='content_item' AND usage_reference=$1",
    [input.itemId],
  );
  await client.query(
    "DELETE FROM control.content_item_media WHERE content_item_id=$1",
    [input.itemId],
  );
  for (const [position, assetId] of input.assetIds.entries()) {
    await client.query(
      `INSERT INTO control.content_item_media
       (id,tenant_id,workspace_id,content_item_id,asset_id,position)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        input.tenantId,
        input.workspaceId,
        input.itemId,
        assetId,
        position,
      ],
    );
    await client.query(
      `INSERT INTO control.media_usage_references
       (id,tenant_id,asset_id,usage_type,usage_reference) VALUES ($1,$2,$3,'content_item',$4)`,
      [randomUUID(), input.tenantId, assetId, input.itemId],
    );
  }
}

function deliveryStatus(variants: readonly ContentVariant[]): string {
  if (variants.length === 0) return "draft";
  const published = variants.filter(
    (variant) => variant.status === "published",
  ).length;
  const failed = variants.some((variant) =>
    ["failed", "needs_reauthorization", "cancelled"].includes(variant.status),
  );
  if (published === variants.length) return "published";
  if (published > 0 && (failed || published < variants.length))
    return "partial";
  if (failed) return "failed";
  if (variants.some((variant) => variant.status === "publishing"))
    return "publishing";
  if (variants.every((variant) => variant.status === "approved"))
    return "approved";
  if (variants.some((variant) => variant.status === "ready_for_review"))
    return "ready_for_review";
  return "draft";
}

function mapVariant(row: VariantRow): ContentVariant {
  return {
    id: row.id,
    destination: row.destination,
    status: row.status,
    currentRevision: row.current_revision,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.safe_error ? { safeError: row.safe_error } : {}),
    ...(row.website_connection_id
      ? { websiteConnectionId: row.website_connection_id }
      : {}),
    ...(row.social_draft_id ? { socialDraftId: row.social_draft_id } : {}),
    ...(row.social_account_id
      ? { socialAccountId: row.social_account_id }
      : {}),
  };
}

async function hydrateItem(
  client: DatabaseClient,
  row: ItemRow,
): Promise<ContentItem> {
  const media = await client.query<{ asset_id: string }>(
    "SELECT asset_id FROM control.content_item_media WHERE content_item_id=$1 ORDER BY position",
    [row.id],
  );
  const variants = await client.query<VariantRow>(
    `SELECT variant.id,variant.destination,
              COALESCE(draft.status::text,variant.status) AS status,
              COALESCE(draft.current_revision,variant.current_revision) AS current_revision,
              variant.website_connection_id,variant.social_draft_id,variant.social_account_id,
              COALESCE(attempt.provider_reference,variant.external_id) AS external_id,
              COALESCE(attempt.safe_error,variant.safe_error) AS safe_error
         FROM control.content_item_variants variant
         LEFT JOIN control.social_drafts draft ON draft.id=variant.social_draft_id
         LEFT JOIN LATERAL (
           SELECT publication.provider_reference,publication.safe_error
             FROM control.publication_attempts publication
             JOIN control.social_draft_targets target ON target.id=publication.target_id
            WHERE target.draft_id=variant.social_draft_id
            ORDER BY publication.created_at DESC LIMIT 1
         ) attempt ON true
        WHERE variant.content_item_id=$1 ORDER BY variant.created_at`,
    [row.id],
  );
  const mapped = variants.rows.map(mapVariant);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    version: row.version,
    mediaAssetIds: media.rows.map((entry) => entry.asset_id),
    variants: mapped,
    deliveryStatus: deliveryStatus(mapped),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function bodyText(body: unknown): string {
  if (!body || typeof body !== "object")
    throw domainError("WEBSITE_DRAFT_BODY_INVALID", 500);
  const blocks = (body as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks))
    throw domainError("WEBSITE_DRAFT_BODY_INVALID", 500);
  const paragraphs = blocks.map((block) => {
    if (
      !block ||
      typeof block !== "object" ||
      (block as { type?: unknown }).type !== "paragraph" ||
      typeof (block as { text?: unknown }).text !== "string"
    )
      throw domainError("WEBSITE_DRAFT_BODY_INVALID", 500);
    return (block as { text: string }).text;
  });
  return paragraphs.join("\n\n");
}

function mapWebsiteDraft(
  row: WebsiteDraftRow,
  actorUserId?: string,
): WebsiteDraft {
  const review =
    row.review_id &&
    row.review_decision &&
    row.review_revision &&
    row.review_content_hash &&
    row.review_requested_by &&
    row.review_requested_at
      ? {
          id: row.review_id,
          decision: row.review_decision,
          revision: row.review_revision,
          contentHash: row.review_content_hash,
          requestedAt: row.review_requested_at.toISOString(),
          requestedByCurrentUser: row.review_requested_by === actorUserId,
          ...(row.review_decided_at
            ? { decidedAt: row.review_decided_at.toISOString() }
            : {}),
          ...(row.review_reason ? { reason: row.review_reason } : {}),
          publicationAuthorized: false as const,
        }
      : undefined;
  return {
    id: row.draft_id,
    itemId: row.content_item_id,
    workspaceId: row.workspace_id,
    currentRevision: row.current_revision,
    revision: {
      id: row.revision_id,
      revision: row.revision,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      bodyText: bodyText(row.body),
      mediaAssetIds: row.media_asset_ids,
      contentHash: row.content_hash,
      createdAt: row.revision_created_at.toISOString(),
    },
    ...(review ? { review } : {}),
    createsVariant: false,
    callsConnector: false,
    publicationAuthorized: false,
  };
}

async function readWebsiteDraft(
  client: DatabaseClient,
  itemId: string,
): Promise<WebsiteDraftRow | undefined> {
  const result = await client.query<WebsiteDraftRow>(
    `SELECT draft.id AS draft_id,draft.content_item_id,draft.workspace_id,
            draft.current_revision,revision.id AS revision_id,revision.revision,
            revision.slug,revision.title,revision.excerpt,revision.body,
            revision.content_hash,revision.created_at AS revision_created_at,
            COALESCE(array_agg(media.asset_id ORDER BY media.position)
              FILTER (WHERE media.id IS NOT NULL),'{}'::uuid[]) AS media_asset_ids,
            review.id AS review_id,review.decision AS review_decision,
            review.revision AS review_revision,
            review.content_hash AS review_content_hash,
            review.requested_by AS review_requested_by,
            review.requested_at AS review_requested_at,
            review.decided_at AS review_decided_at,review.reason AS review_reason
       FROM control.content_website_drafts draft
       JOIN control.content_website_draft_revisions revision
         ON revision.draft_id=draft.id AND revision.revision=draft.current_revision
       LEFT JOIN control.content_website_draft_media media
         ON media.draft_id=draft.id AND media.revision_id=revision.id
       LEFT JOIN control.content_website_draft_reviews review
         ON review.draft_id=draft.id AND review.revision_id=revision.id
      WHERE draft.content_item_id=$1
      GROUP BY draft.id,revision.id,review.id`,
    [itemId],
  );
  return result.rows[0];
}

function normalizeWebsiteDraft(input: {
  slug: string;
  title: string;
  excerpt?: string;
  bodyText: string;
  mediaAssetIds?: readonly string[];
}) {
  const slug = input.slug.trim();
  const title = input.title.trim();
  const excerpt = input.excerpt?.trim() ?? "";
  const text = input.bodyText.trim();
  const mediaAssetIds = [...(input.mediaAssetIds ?? [])];
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    slug.length > 180 ||
    !title ||
    title.length > 240 ||
    excerpt.length > 1_000 ||
    !text ||
    text.length > 50_000 ||
    mediaAssetIds.length > 20 ||
    new Set(mediaAssetIds).size !== mediaAssetIds.length
  )
    throw domainError("WEBSITE_DRAFT_INPUT_INVALID", 400);
  const body = {
    version: 1,
    blocks: text
      .split(/\n{2,}/)
      .map((paragraph) => ({ type: "paragraph", text: paragraph.trim() }))
      .filter((paragraph) => paragraph.text),
  };
  return { slug, title, excerpt, bodyText: text, body, mediaAssetIds };
}

async function insertWebsiteDraftRevision(
  client: DatabaseClient,
  input: {
    tenantId: string;
    workspaceId: string;
    itemId: string;
    draftId: string;
    revision: number;
    actorUserId: string;
    slug: string;
    title: string;
    excerpt?: string;
    bodyText: string;
    mediaAssetIds?: readonly string[];
  },
): Promise<{ revisionId: string; contentHash: string }> {
  const normalized = normalizeWebsiteDraft(input);
  if (normalized.mediaAssetIds.length) {
    const media = await client.query(
      `SELECT asset.id FROM control.content_item_media link
         JOIN control.media_assets asset ON asset.id=link.asset_id
        WHERE link.content_item_id=$1 AND asset.id=ANY($2::uuid[])
          AND asset.status='ready' AND asset.soft_deleted_at IS NULL`,
      [input.itemId, normalized.mediaAssetIds],
    );
    if (media.rowCount !== normalized.mediaAssetIds.length)
      throw domainError("WEBSITE_DRAFT_MEDIA_NOT_ATTACHED", 400);
  }
  const revisionId = randomUUID();
  const contentHash = hash({
    slug: normalized.slug,
    title: normalized.title,
    excerpt: normalized.excerpt,
    body: normalized.body,
    mediaAssetIds: normalized.mediaAssetIds,
  });
  await client.query(
    `INSERT INTO control.content_website_draft_revisions
     (id,tenant_id,workspace_id,draft_id,revision,slug,title,excerpt,body,
      content_hash,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      revisionId,
      input.tenantId,
      input.workspaceId,
      input.draftId,
      input.revision,
      normalized.slug,
      normalized.title,
      normalized.excerpt,
      normalized.body,
      contentHash,
      input.actorUserId,
    ],
  );
  for (const [position, assetId] of normalized.mediaAssetIds.entries()) {
    await client.query(
      `INSERT INTO control.content_website_draft_media
       (id,tenant_id,workspace_id,draft_id,revision_id,asset_id,position)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        input.tenantId,
        input.workspaceId,
        input.draftId,
        revisionId,
        assetId,
        position,
      ],
    );
    await client.query(
      `INSERT INTO control.media_usage_references
       (id,tenant_id,asset_id,usage_type,usage_reference)
       VALUES($1,$2,$3,'website_draft',$4)`,
      [randomUUID(), input.tenantId, assetId, revisionId],
    );
  }
  return { revisionId, contentHash };
}

export class UnifiedContentService {
  public constructor(private readonly pool: DatabasePool) {}

  public async create(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    title: string;
    summary?: string;
    mediaAssetIds?: readonly string[];
    correlationId: string;
  }): Promise<ContentItem> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      await assertAvailable(client, input.tenantId, input.workspaceId);
      const id = randomUUID();
      const result = await client.query<ItemRow>(
        `INSERT INTO control.content_items
         (id,tenant_id,workspace_id,title,summary,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.title.trim(),
          input.summary?.trim() ?? "",
          input.actorUserId,
        ],
      );
      await replaceMedia(client, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        itemId: id,
        assetIds: input.mediaAssetIds ?? [],
      });
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.item_created",
        targetId: id,
        correlationId: input.correlationId,
      });
      return hydrateItem(client, result.rows[0]!);
    });
  }

  public async createItemFromApprovedVideo(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    renderJobId: string;
    mediaAssetId: string;
    title: string;
    summary?: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{
    contentItemId: string;
    status: "draft";
    replayed: boolean;
    websiteVariantCreated: false;
    publicationAuthorized: false;
  }> {
    const title = input.title.trim();
    const summary = input.summary?.trim() ?? "";
    if (!title || title.length > 240 || summary.length > 2_000)
      throw domainError("VIDEO_WEBSITE_CONTENT_COPY_INVALID", 400);
    const requestHash = hash({
      workspaceId: input.workspaceId,
      renderJobId: input.renderJobId,
      mediaAssetId: input.mediaAssetId,
      title,
      summary,
    });
    return withTenant(this.pool, input.tenantId, async (client) => {
      await assertAvailable(client, input.tenantId, input.workspaceId);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,32))",
        [`${input.tenantId}:video-website-content:${input.idempotencyKey}`],
      );
      const existing = await client.query<{
        content_item_id: string;
        request_hash: string;
        created_by: string;
      }>(
        `SELECT content_item_id,request_hash,created_by
           FROM control.video_website_content_handoffs
          WHERE idempotency_key=$1`,
        [input.idempotencyKey],
      );
      const receipt = existing.rows[0];
      if (receipt) {
        if (
          receipt.request_hash !== requestHash ||
          receipt.created_by !== input.actorUserId
        )
          throw domainError("VIDEO_WEBSITE_CONTENT_IDEMPOTENCY_CONFLICT", 409);
        return {
          contentItemId: receipt.content_item_id,
          status: "draft",
          replayed: true,
          websiteVariantCreated: false,
          publicationAuthorized: false,
        };
      }
      const approved = await client.query<{
        review_id: string;
        script_content_hash: string;
      }>(
        `SELECT review.id AS review_id,review.script_content_hash
           FROM control.video_render_asset_reviews review
           JOIN control.video_render_jobs job
             ON job.id=review.render_job_id AND job.media_asset_id=review.media_asset_id
           JOIN control.media_assets asset ON asset.id=review.media_asset_id
           JOIN control.media_objects object
             ON object.asset_id=asset.id AND object.object_kind='original'
          WHERE review.workspace_id=$1 AND review.render_job_id=$2
            AND review.media_asset_id=$3 AND review.decision='approved'
            AND job.status='succeeded' AND asset.status='ready'
            AND asset.soft_deleted_at IS NULL AND object.mime_type='video/mp4'`,
        [input.workspaceId, input.renderJobId, input.mediaAssetId],
      );
      const exact = approved.rows[0];
      if (!exact)
        throw domainError("VIDEO_ASSET_NOT_APPROVED_FOR_WEBSITE_CONTENT", 409);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,32))",
        [`${input.tenantId}:video-website-review:${exact.review_id}`],
      );
      const alreadyPrepared = await client.query(
        `SELECT 1 FROM control.video_website_content_handoffs
          WHERE asset_review_id=$1`,
        [exact.review_id],
      );
      if (alreadyPrepared.rowCount)
        throw domainError("VIDEO_WEBSITE_CONTENT_ALREADY_PREPARED", 409);

      const contentItemId = randomUUID();
      await client.query(
        `INSERT INTO control.content_items
         (id,tenant_id,workspace_id,title,summary,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [
          contentItemId,
          input.tenantId,
          input.workspaceId,
          title,
          summary,
          input.actorUserId,
        ],
      );
      await replaceMedia(client, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        itemId: contentItemId,
        assetIds: [input.mediaAssetId],
      });
      await client.query(
        `INSERT INTO control.video_website_content_handoffs
         (id,tenant_id,workspace_id,asset_review_id,render_job_id,media_asset_id,
          content_item_id,script_content_hash,idempotency_key,request_hash,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          exact.review_id,
          input.renderJobId,
          input.mediaAssetId,
          contentItemId,
          exact.script_content_hash,
          input.idempotencyKey,
          requestHash,
          input.actorUserId,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.item_created",
        targetId: contentItemId,
        correlationId: input.correlationId,
        metadata: { source: "approved_video_asset" },
      });
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "video.website_content_prepared",
        targetId: contentItemId,
        correlationId: input.correlationId,
        metadata: {
          renderJobId: input.renderJobId,
          mediaAssetId: input.mediaAssetId,
          scriptContentHash: exact.script_content_hash,
          websiteVariantCreated: false,
          publicationAuthorized: false,
        },
      });
      return {
        contentItemId,
        status: "draft",
        replayed: false,
        websiteVariantCreated: false,
        publicationAuthorized: false,
      };
    });
  }

  public async list(input: {
    tenantId: string;
    workspaceId?: string;
    limit?: number;
  }): Promise<readonly ContentItem[]> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<ItemRow>(
        `SELECT * FROM control.content_items
          WHERE ($1::uuid IS NULL OR workspace_id=$1)
          ORDER BY updated_at DESC,id DESC LIMIT $2`,
        [
          input.workspaceId ?? null,
          Math.min(Math.max(input.limit ?? 25, 1), 50),
        ],
      );
      return Promise.all(result.rows.map((row) => hydrateItem(client, row)));
    });
  }

  public async get(tenantId: string, itemId: string): Promise<ContentItem> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1",
        [itemId],
      );
      if (!result.rows[0]) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      return hydrateItem(client, result.rows[0]);
    });
  }

  public async websiteDestinationPreflight(input: {
    tenantId: string;
    itemId: string;
  }): Promise<WebsiteDestinationPreflight> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const itemResult = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1",
        [input.itemId],
      );
      const item = itemResult.rows[0];
      if (!item) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      await assertAvailable(client, input.tenantId, item.workspace_id);

      const destination = await client.query(
        `SELECT 1 FROM control.business_workspaces workspace
            JOIN control.installation_entitlements entitlement
              ON entitlement.tenant_id=workspace.tenant_id
             AND entitlement.installation_id=workspace.installation_id
            JOIN control.feature_flags flag
              ON flag.tenant_id=workspace.tenant_id
             AND flag.name='module.websites' AND flag.enabled
           WHERE workspace.tenant_id=$1 AND workspace.id=$2
             AND 'websites'=ANY(entitlement.enabled_modules)
             AND entitlement.effective_from<=now()
             AND (entitlement.effective_until IS NULL OR entitlement.effective_until>now())`,
        [input.tenantId, item.workspace_id],
      );
      const destinationState = await client.query<{
        variant_exists: boolean;
        draft_exists: boolean;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM control.content_item_variants
                   WHERE content_item_id=$1 AND destination='website') AS variant_exists,
           EXISTS(SELECT 1 FROM control.content_website_drafts
                   WHERE content_item_id=$1) AS draft_exists`,
        [input.itemId],
      );
      const media = await client.query<{ mime_type: string | null }>(
        `SELECT object.mime_type
             FROM control.content_item_media link
             JOIN control.media_assets asset ON asset.id=link.asset_id
             LEFT JOIN control.media_objects object
               ON object.asset_id=asset.id AND object.object_kind='original'
            WHERE link.content_item_id=$1 ORDER BY link.position`,
        [input.itemId],
      );
      const connections = await client.query<{
        connection_id: string;
        display_name: string;
        domain: string;
        status: string;
        health_status: string;
        kill_switched: boolean;
        granted_scopes: string[];
        discovered_capabilities: string[];
      }>(
        `SELECT connection.id AS connection_id,profile.display_name,profile.domain,
                  connection.status::text,connection.health_status::text,
                  connection.kill_switched,connection.granted_scopes,
                  connection.discovered_capabilities
             FROM control.platform_connections connection
             JOIN control.website_connection_profiles profile
               ON profile.connection_id=connection.id
            WHERE connection.workspace_id=$1
              AND connection.connector_id='businesssite-information'
            ORDER BY profile.display_name,connection.id`,
        [item.workspace_id],
      );
      const entitled = Boolean(destination.rowCount);
      const mappedConnections = connections.rows.map((connection) => ({
        connectionId: connection.connection_id,
        displayName: connection.display_name,
        domain: connection.domain,
        status: connection.status,
        healthStatus: connection.health_status,
        eligible:
          entitled &&
          ["active", "degraded"].includes(connection.status) &&
          connection.health_status !== "unavailable" &&
          !connection.kill_switched &&
          connection.granted_scopes.includes("articles.create") &&
          connection.discovered_capabilities.includes("articles.create"),
      }));
      const checks: Array<{
        code: string;
        severity: "pass" | "warning" | "blocker";
      }> = [
        {
          code:
            item.status === "archived"
              ? "CONTENT_ITEM_ARCHIVED"
              : "CONTENT_ITEM_EDITABLE",
          severity: item.status === "archived" ? "blocker" : "pass",
        },
        {
          code: entitled
            ? "WEBSITE_DESTINATION_ENTITLED"
            : "WEBSITE_DESTINATION_NOT_ENTITLED",
          severity: entitled ? "pass" : "blocker",
        },
        {
          code: destinationState.rows[0]?.variant_exists
            ? "WEBSITE_VARIANT_ALREADY_EXISTS"
            : "WEBSITE_VARIANT_ABSENT",
          severity: destinationState.rows[0]?.variant_exists
            ? "blocker"
            : "pass",
        },
        {
          code: destinationState.rows[0]?.draft_exists
            ? "WEBSITE_DRAFT_AVAILABLE"
            : "WEBSITE_DRAFT_ABSENT",
          severity: "pass",
        },
        {
          code: mappedConnections.some((connection) => connection.eligible)
            ? "WEBSITE_CONNECTION_ELIGIBLE"
            : "WEBSITE_CONNECTION_REQUIRED",
          severity: mappedConnections.some((connection) => connection.eligible)
            ? "pass"
            : "blocker",
        },
        {
          code: item.summary.trim()
            ? "WEBSITE_COPY_AVAILABLE"
            : "WEBSITE_SUMMARY_RECOMMENDED",
          severity: item.summary.trim() ? "pass" : "warning",
        },
      ];
      if (
        mappedConnections.some(
          (connection) =>
            connection.eligible && connection.healthStatus !== "healthy",
        )
      )
        checks.push({
          code: "WEBSITE_CONNECTION_HEALTH_UNCONFIRMED",
          severity: "warning",
        });
      if (media.rows.some((entry) => entry.mime_type === "video/mp4"))
        checks.push({
          code: "WEBSITE_VIDEO_DELIVERY_UNAVAILABLE",
          severity: "blocker",
        });
      else if (media.rowCount)
        checks.push({
          code: "WEBSITE_MEDIA_MAPPING_REQUIRES_CONFIRMATION",
          severity: "warning",
        });
      else
        checks.push({
          code: "WEBSITE_TEXT_ONLY_CONTENT",
          severity: "pass",
        });
      return {
        itemId: input.itemId,
        workspaceId: item.workspace_id,
        status: checks.some((check) => check.severity === "blocker")
          ? "blocked"
          : "ready",
        checks,
        connections: mappedConnections,
        createsVariant: false,
        callsConnector: false,
        publicationAuthorized: false,
      };
    });
  }

  public async getWebsiteDraft(input: {
    tenantId: string;
    itemId: string;
    actorUserId?: string;
  }): Promise<WebsiteDraft> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const item = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1",
        [input.itemId],
      );
      if (!item.rows[0]) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      await assertAvailable(client, input.tenantId, item.rows[0].workspace_id);
      const draft = await readWebsiteDraft(client, input.itemId);
      if (!draft) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 404);
      return mapWebsiteDraft(draft, input.actorUserId);
    });
  }

  public async listWebsiteReviewQueue(input: {
    tenantId: string;
    actorUserId: string;
    workspaceId?: string;
  }): Promise<WebsiteReviewQueueItem[]> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<{
        item_id: string;
        draft_id: string;
        workspace_id: string;
        item_title: string;
        revision: number;
        content_hash: string;
        requested_by: string;
        requested_at: Date;
      }>(
        `SELECT item.id AS item_id,draft.id AS draft_id,draft.workspace_id,
                item.title AS item_title,review.revision,review.content_hash,
                review.requested_by,review.requested_at
           FROM control.content_website_draft_reviews review
           JOIN control.content_website_drafts draft ON draft.id=review.draft_id
           JOIN control.content_items item ON item.id=draft.content_item_id
          WHERE review.decision='pending'
            AND review.revision_id=(
              SELECT revision.id
                FROM control.content_website_draft_revisions revision
               WHERE revision.draft_id=draft.id
                 AND revision.revision=draft.current_revision
            )
            AND ($1::uuid IS NULL OR draft.workspace_id=$1)
          ORDER BY review.requested_at,review.id LIMIT 50`,
        [input.workspaceId ?? null],
      );
      return result.rows.map((row) => ({
        itemId: row.item_id,
        draftId: row.draft_id,
        workspaceId: row.workspace_id,
        itemTitle: row.item_title,
        revision: row.revision,
        contentHash: row.content_hash,
        requestedAt: row.requested_at.toISOString(),
        requestedByCurrentUser: row.requested_by === input.actorUserId,
      }));
    });
  }

  public async createWebsiteDraft(input: {
    tenantId: string;
    itemId: string;
    actorUserId: string;
    slug: string;
    title: string;
    excerpt?: string;
    bodyText: string;
    mediaAssetIds?: readonly string[];
    correlationId: string;
  }): Promise<WebsiteDraft> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const item = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1 FOR UPDATE",
        [input.itemId],
      );
      const row = item.rows[0];
      if (!row) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      if (row.status === "archived")
        throw domainError("CONTENT_ITEM_ARCHIVED", 409);
      await assertAvailable(client, input.tenantId, row.workspace_id);
      await assertDestinationAvailable(
        client,
        input.tenantId,
        row.workspace_id,
        "websites",
      );
      const existing = await client.query<{
        draft_exists: boolean;
        variant_exists: boolean;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM control.content_website_drafts
                   WHERE content_item_id=$1) AS draft_exists,
           EXISTS(SELECT 1 FROM control.content_item_variants
                   WHERE content_item_id=$1 AND destination='website') AS variant_exists`,
        [input.itemId],
      );
      if (existing.rows[0]?.variant_exists)
        throw domainError("WEBSITE_VARIANT_ALREADY_EXISTS", 409);
      if (existing.rows[0]?.draft_exists)
        throw domainError("WEBSITE_DRAFT_ALREADY_EXISTS", 409);
      const draftId = randomUUID();
      await client.query(
        `INSERT INTO control.content_website_drafts
         (id,tenant_id,workspace_id,content_item_id,current_revision,created_by)
         VALUES($1,$2,$3,$4,1,$5)`,
        [
          draftId,
          input.tenantId,
          row.workspace_id,
          input.itemId,
          input.actorUserId,
        ],
      );
      const revision = await insertWebsiteDraftRevision(client, {
        ...input,
        workspaceId: row.workspace_id,
        draftId,
        revision: 1,
      });
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.website_draft_created",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: {
          draftId,
          revision: 1,
          contentHash: revision.contentHash,
          createsVariant: false,
          callsConnector: false,
          publicationAuthorized: false,
        },
      });
      const created = await readWebsiteDraft(client, input.itemId);
      if (!created) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 500);
      return mapWebsiteDraft(created, input.actorUserId);
    });
  }

  public async reviseWebsiteDraft(input: {
    tenantId: string;
    itemId: string;
    actorUserId: string;
    expectedRevision: number;
    slug: string;
    title: string;
    excerpt?: string;
    bodyText: string;
    mediaAssetIds?: readonly string[];
    correlationId: string;
  }): Promise<WebsiteDraft> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const item = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1 FOR UPDATE",
        [input.itemId],
      );
      const row = item.rows[0];
      if (!row) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      if (row.status === "archived")
        throw domainError("CONTENT_ITEM_ARCHIVED", 409);
      await assertAvailable(client, input.tenantId, row.workspace_id);
      await assertDestinationAvailable(
        client,
        input.tenantId,
        row.workspace_id,
        "websites",
      );
      const draft = await client.query<{
        id: string;
        current_revision: number;
      }>(
        `SELECT id,current_revision FROM control.content_website_drafts
          WHERE content_item_id=$1 FOR UPDATE`,
        [input.itemId],
      );
      const current = draft.rows[0];
      if (!current) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 404);
      if (current.current_revision !== input.expectedRevision)
        throw domainError("WEBSITE_DRAFT_REVISION_CONFLICT", 409);
      const variant = await client.query(
        `SELECT 1 FROM control.content_item_variants
          WHERE content_item_id=$1 AND destination='website'`,
        [input.itemId],
      );
      if (variant.rowCount)
        throw domainError("WEBSITE_VARIANT_ALREADY_EXISTS", 409);
      const nextRevision = current.current_revision + 1;
      const revision = await insertWebsiteDraftRevision(client, {
        ...input,
        workspaceId: row.workspace_id,
        draftId: current.id,
        revision: nextRevision,
      });
      await client.query(
        `UPDATE control.content_website_drafts
            SET current_revision=$2,updated_at=now() WHERE id=$1`,
        [current.id, nextRevision],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.website_draft_revised",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: {
          draftId: current.id,
          revision: nextRevision,
          contentHash: revision.contentHash,
          createsVariant: false,
          callsConnector: false,
          publicationAuthorized: false,
        },
      });
      const revised = await readWebsiteDraft(client, input.itemId);
      if (!revised) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 500);
      return mapWebsiteDraft(revised, input.actorUserId);
    });
  }

  public async requestWebsiteDraftReview(input: {
    tenantId: string;
    itemId: string;
    actorUserId: string;
    expectedRevision: number;
    correlationId: string;
  }): Promise<WebsiteDraft> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const current = await client.query<{
        draft_id: string;
        workspace_id: string;
        revision_id: string;
        revision: number;
        content_hash: string;
      }>(
        `SELECT draft.id AS draft_id,draft.workspace_id,revision.id AS revision_id,
                revision.revision,revision.content_hash
           FROM control.content_website_drafts draft
           JOIN control.content_items item ON item.id=draft.content_item_id
           JOIN control.content_website_draft_revisions revision
             ON revision.draft_id=draft.id AND revision.revision=draft.current_revision
          WHERE draft.content_item_id=$1 AND item.status<>'archived'
          FOR UPDATE OF draft`,
        [input.itemId],
      );
      const row = current.rows[0];
      if (!row) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 404);
      await assertAvailable(client, input.tenantId, row.workspace_id);
      await assertDestinationAvailable(
        client,
        input.tenantId,
        row.workspace_id,
        "websites",
      );
      if (row.revision !== input.expectedRevision)
        throw domainError("WEBSITE_DRAFT_REVISION_CONFLICT", 409);
      const existing = await client.query<{ decision: string }>(
        `SELECT decision FROM control.content_website_draft_reviews
          WHERE revision_id=$1`,
        [row.revision_id],
      );
      if (existing.rowCount)
        throw domainError("WEBSITE_DRAFT_REVIEW_ALREADY_EXISTS", 409);
      const reviewId = randomUUID();
      await client.query(
        `INSERT INTO control.content_website_draft_reviews
         (id,tenant_id,workspace_id,draft_id,revision_id,revision,content_hash,
          requested_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          reviewId,
          input.tenantId,
          row.workspace_id,
          row.draft_id,
          row.revision_id,
          row.revision,
          row.content_hash,
          input.actorUserId,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.website_draft_review_requested",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: {
          draftId: row.draft_id,
          reviewId,
          revision: row.revision,
          contentHash: row.content_hash,
          publicationAuthorized: false,
        },
      });
      const draft = await readWebsiteDraft(client, input.itemId);
      if (!draft) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 500);
      return mapWebsiteDraft(draft, input.actorUserId);
    });
  }

  public async decideWebsiteDraftReview(input: {
    tenantId: string;
    itemId: string;
    actorUserId: string;
    expectedRevision: number;
    decision: "approved" | "rejected";
    reason?: string;
    correlationId: string;
  }): Promise<WebsiteDraft> {
    const reason = input.reason?.trim() || null;
    if (input.decision === "approved" && reason)
      throw domainError("WEBSITE_DRAFT_REVIEW_INPUT_INVALID", 400);
    if (
      input.decision === "rejected" &&
      (!reason || reason.length < 10 || reason.length > 500)
    )
      throw domainError("WEBSITE_DRAFT_REJECTION_REASON_REQUIRED", 400);
    return withTenant(this.pool, input.tenantId, async (client) => {
      const review = await client.query<{
        id: string;
        draft_id: string;
        workspace_id: string;
        revision: number;
        content_hash: string;
        requested_by: string;
      }>(
        `SELECT review.id,review.draft_id,review.workspace_id,review.revision,
                review.content_hash,review.requested_by
           FROM control.content_website_draft_reviews review
           JOIN control.content_website_drafts draft ON draft.id=review.draft_id
           JOIN control.content_items item ON item.id=draft.content_item_id
          WHERE draft.content_item_id=$1 AND item.status<>'archived'
            AND review.revision=$2 AND review.decision='pending'
            AND draft.current_revision=review.revision
          FOR UPDATE OF review,draft`,
        [input.itemId, input.expectedRevision],
      );
      const row = review.rows[0];
      if (!row) throw domainError("WEBSITE_DRAFT_REVIEW_NOT_PENDING", 409);
      await assertAvailable(client, input.tenantId, row.workspace_id);
      await assertDestinationAvailable(
        client,
        input.tenantId,
        row.workspace_id,
        "websites",
      );
      if (row.requested_by === input.actorUserId)
        throw domainError("WEBSITE_DRAFT_SELF_APPROVAL_DENIED", 409);
      await client.query(
        `UPDATE control.content_website_draft_reviews
            SET decision=$2,decided_by=$3,decided_at=now(),reason=$4
          WHERE id=$1`,
        [row.id, input.decision, input.actorUserId, reason],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: `content.website_draft_${input.decision}`,
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: {
          draftId: row.draft_id,
          reviewId: row.id,
          revision: row.revision,
          contentHash: row.content_hash,
          reason,
          publicationAuthorized: false,
        },
      });
      const draft = await readWebsiteDraft(client, input.itemId);
      if (!draft) throw domainError("WEBSITE_DRAFT_NOT_FOUND", 500);
      return mapWebsiteDraft(draft, input.actorUserId);
    });
  }

  public async update(input: {
    tenantId: string;
    itemId: string;
    actorUserId: string;
    expectedVersion: number;
    title?: string;
    summary?: string;
    status?: "draft" | "active" | "archived";
    mediaAssetIds?: readonly string[];
    correlationId: string;
  }): Promise<ContentItem> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const current = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1 FOR UPDATE",
        [input.itemId],
      );
      const row = current.rows[0];
      if (!row) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      await assertAvailable(client, input.tenantId, row.workspace_id);
      const updated = await client.query<ItemRow>(
        `UPDATE control.content_items SET title=COALESCE($3,title),summary=COALESCE($4,summary),
          status=COALESCE($5,status),version=version+1,updated_by=$6,updated_at=now()
          WHERE id=$1 AND version=$2 RETURNING *`,
        [
          input.itemId,
          input.expectedVersion,
          input.title?.trim() ?? null,
          input.summary?.trim() ?? null,
          input.status ?? null,
          input.actorUserId,
        ],
      );
      if (!updated.rows[0])
        throw domainError("CONTENT_ITEM_VERSION_CONFLICT", 409);
      if (input.mediaAssetIds)
        await replaceMedia(client, {
          tenantId: input.tenantId,
          workspaceId: row.workspace_id,
          itemId: input.itemId,
          assetIds: input.mediaAssetIds,
        });
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.item_updated",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: { version: updated.rows[0].version },
      });
      return hydrateItem(client, updated.rows[0]);
    });
  }

  public async beginVariant(input: {
    tenantId: string;
    itemId: string;
    actorUserId: string;
    destination: ContentDestination;
    websiteConnectionId?: string;
    socialAccountId?: string;
    correlationId: string;
  }): Promise<{ variantId: string; item: ContentItem }> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const itemResult = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1 FOR UPDATE",
        [input.itemId],
      );
      const row = itemResult.rows[0];
      if (!row) throw domainError("CONTENT_ITEM_NOT_FOUND", 404);
      await assertAvailable(client, input.tenantId, row.workspace_id);
      if (input.destination === "website") {
        await assertDestinationAvailable(
          client,
          input.tenantId,
          row.workspace_id,
          "websites",
        );
        const connection = await client.query(
          `SELECT 1 FROM control.platform_connections
            WHERE id=$1 AND workspace_id=$2 AND connector_id='businesssite-information'
              AND status='active'`,
          [input.websiteConnectionId ?? null, row.workspace_id],
        );
        if (connection.rowCount !== 1)
          throw domainError("WEBSITE_CONNECTION_NOT_FOUND", 400);
      } else {
        await assertDestinationAvailable(
          client,
          input.tenantId,
          row.workspace_id,
          "social",
        );
        const expected =
          input.destination === "facebook"
            ? "facebook_page"
            : "instagram_account";
        const account = await client.query(
          `SELECT 1 FROM control.social_accounts
            WHERE id=$1 AND workspace_id=$2 AND account_type=$3 AND status='active'`,
          [input.socialAccountId ?? null, row.workspace_id, expected],
        );
        if (account.rowCount !== 1)
          throw domainError("SOCIAL_ACCOUNT_NOT_FOUND", 400);
        const media = await client.query(
          "SELECT 1 FROM control.content_item_media WHERE content_item_id=$1 LIMIT 1",
          [input.itemId],
        );
        if (media.rowCount !== 1)
          throw domainError("SOCIAL_VARIANT_REQUIRES_MEDIA", 400);
      }
      const existing = await client.query<{
        id: string;
        status: string;
        social_draft_id: string | null;
        external_id: string | null;
      }>(
        `SELECT id,status,social_draft_id,external_id
           FROM control.content_item_variants
          WHERE content_item_id=$1 AND destination=$2 FOR UPDATE`,
        [input.itemId, input.destination],
      );
      const retryable = existing.rows[0];
      if (
        retryable &&
        retryable.status === "failed" &&
        !retryable.social_draft_id &&
        !retryable.external_id
      ) {
        await client.query(
          `UPDATE control.content_item_variants
              SET status='provisioning',safe_error=NULL,updated_at=now() WHERE id=$1`,
          [retryable.id],
        );
        await evidence(client, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: "content.variant_retried",
          targetId: input.itemId,
          correlationId: input.correlationId,
          metadata: { variantId: retryable.id, destination: input.destination },
        });
        return {
          variantId: retryable.id,
          item: await hydrateItem(client, row),
        };
      }
      if (retryable) throw domainError("CONTENT_VARIANT_ALREADY_EXISTS", 409);
      const variantId = randomUUID();
      try {
        await client.query(
          `INSERT INTO control.content_item_variants
           (id,tenant_id,workspace_id,content_item_id,destination,website_connection_id,
            social_account_id,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            variantId,
            input.tenantId,
            row.workspace_id,
            input.itemId,
            input.destination,
            input.websiteConnectionId ?? null,
            input.socialAccountId ?? null,
            input.actorUserId,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw domainError("CONTENT_VARIANT_ALREADY_EXISTS", 409);
        throw error;
      }
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.variant_started",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: { variantId, destination: input.destination },
      });
      return { variantId, item: await hydrateItem(client, row) };
    });
  }

  public async completeVariant(input: {
    tenantId: string;
    itemId: string;
    variantId: string;
    actorUserId: string;
    status: string;
    currentRevision: number;
    nativeId?: string;
    externalId?: string;
    correlationId: string;
  }): Promise<ContentItem> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<{ destination: ContentDestination }>(
        "SELECT destination FROM control.content_item_variants WHERE id=$1 AND content_item_id=$2 FOR UPDATE",
        [input.variantId, input.itemId],
      );
      const destination = result.rows[0]?.destination;
      if (!destination) throw domainError("CONTENT_VARIANT_NOT_FOUND", 404);
      await client.query(
        `UPDATE control.content_item_variants SET status=$3,current_revision=$4,
          social_draft_id=CASE WHEN destination IN ('facebook','instagram') THEN $5 ELSE social_draft_id END,
          external_id=$6,safe_error=NULL,updated_at=now()
          WHERE id=$1 AND content_item_id=$2`,
        [
          input.variantId,
          input.itemId,
          input.status,
          input.currentRevision,
          input.nativeId ?? null,
          input.externalId ?? null,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.variant_created",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: { variantId: input.variantId, destination },
      });
      const item = await client.query<ItemRow>(
        "SELECT * FROM control.content_items WHERE id=$1",
        [input.itemId],
      );
      return hydrateItem(client, item.rows[0]!);
    });
  }

  public async failVariant(input: {
    tenantId: string;
    itemId: string;
    variantId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE control.content_item_variants SET status='failed',safe_error='VARIANT_PROVISION_FAILED',updated_at=now()
          WHERE id=$1 AND content_item_id=$2`,
        [input.variantId, input.itemId],
      );
      if (result.rowCount !== 1) return;
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "content.variant_failed",
        targetId: input.itemId,
        correlationId: input.correlationId,
        metadata: { variantId: input.variantId },
      });
    });
  }
}
