import { createHash, randomUUID } from "node:crypto";

import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

import type { TokenSecretProvider } from "./oauth.js";
import {
  SocialProviderError,
  socialPublishPayloadSchema,
  type SocialProviderAdapter,
} from "./providers.js";

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

class SocialWorkflowError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

async function evidence(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      auditId,
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetType,
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
      {
        auditEventId: auditId,
        targetType: input.targetType,
        targetId: input.targetId,
      },
      input.correlationId,
    ],
  );
}

export interface DraftContent {
  readonly title?: string;
  readonly caption?: string;
  readonly description?: string;
  readonly mediaAssetIds: readonly string[];
  readonly channelOverrides?: Readonly<Record<string, unknown>>;
}

export interface SocialPreflightCheck {
  readonly code: string;
  readonly severity: "pass" | "warning" | "blocker";
}

export interface SocialPreflightTarget {
  readonly targetId: string;
  readonly accountName: string;
  readonly channel: "facebook" | "instagram" | "youtube" | "tiktok";
  readonly checks: readonly SocialPreflightCheck[];
}

export class SocialPublishingService {
  readonly #providers = new Map<string, SocialProviderAdapter>();
  public constructor(
    private readonly pool: DatabasePool,
    private readonly secrets: TokenSecretProvider,
  ) {}
  public registerProvider(provider: SocialProviderAdapter): void {
    this.#providers.set(provider.provider, provider);
  }

  public async preflightDraft(input: {
    tenantId: string;
    workspaceId: string;
    draftId: string;
  }): Promise<readonly SocialPreflightTarget[]> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const rows = await client.query<{
        target_id: string;
        account_name: string;
        channel: "facebook" | "instagram" | "youtube" | "tiktok";
        account_status: string;
        caption: string | null;
        media: Array<{
          mimeType: string;
          width: number | null;
          height: number | null;
          durationMs: string | null;
        }>;
      }>(
        `SELECT target.id AS target_id,account.display_name AS account_name,
           target.channel,account.status AS account_status,revision.caption,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
               'mimeType',media.mime_type,'width',media.width,
               'height',media.height,'durationMs',media.duration_ms
             ) ORDER BY (attachment.value->>'order')::int)
             FROM jsonb_array_elements(revision.media_attachments) attachment(value)
             JOIN control.media_objects media
               ON media.asset_id=(attachment.value->>'assetId')::uuid
              AND media.object_kind='original'
           ),'[]'::jsonb) AS media
         FROM control.social_drafts draft
         JOIN control.social_draft_revisions revision
           ON revision.draft_id=draft.id
          AND revision.revision_number=draft.current_revision
         JOIN control.social_draft_targets target ON target.revision_id=revision.id
         JOIN control.social_accounts account ON account.id=target.account_id
         WHERE draft.id=$1 AND draft.workspace_id=$2
         ORDER BY target.channel,account.display_name`,
        [input.draftId, input.workspaceId],
      );
      if (rows.rowCount === 0)
        throw new SocialWorkflowError("DRAFT_NOT_FOUND", 404);
      return rows.rows.map((row) => {
        const checks: SocialPreflightCheck[] = [];
        if (row.account_status === "active")
          checks.push({ code: "account_active", severity: "pass" });
        else checks.push({ code: "account_not_active", severity: "blocker" });
        if (row.caption && row.caption.length <= 5000)
          checks.push({
            code: "caption_within_control_limit",
            severity: "pass",
          });
        else
          checks.push({
            code: "caption_missing_or_outside_control_limit",
            severity: "warning",
          });
        if (row.media.length >= 1 && row.media.length <= 10)
          checks.push({ code: "media_count_supported", severity: "pass" });
        else checks.push({ code: "media_count_invalid", severity: "blocker" });
        if (row.channel === "instagram") {
          const unsupportedImage = row.media.some(
            (media) =>
              media.mimeType.startsWith("image/") &&
              media.mimeType !== "image/jpeg",
          );
          const unsupportedVideo = row.media.some(
            (media) =>
              media.mimeType.startsWith("video/") &&
              media.mimeType !== "video/mp4",
          );
          if (unsupportedImage)
            checks.push({
              code: "instagram_jpeg_required",
              severity: "blocker",
            });
          else
            checks.push({
              code: "instagram_image_format_supported",
              severity: "pass",
            });
          if (unsupportedVideo)
            checks.push({
              code: "instagram_mp4_required",
              severity: "blocker",
            });
          else
            checks.push({
              code: "instagram_video_format_supported",
              severity: "pass",
            });
          if (row.media.length > 1)
            checks.push({
              code: "instagram_carousel_within_limit",
              severity: "pass",
            });
          checks.push({
            code: "instagram_public_https_delivery_not_configured",
            severity: "blocker",
          });
          checks.push({
            code: "instagram_publishing_limit_unavailable_without_live_connection",
            severity: "warning",
          });
        } else if (row.channel === "facebook") {
          checks.push({
            code: "facebook_live_adapter_not_accepted",
            severity: "warning",
          });
        } else {
          checks.push({
            code: "channel_preflight_not_implemented",
            severity: "warning",
          });
        }
        if (
          row.media.some(
            (media) => media.width === null || media.height === null,
          )
        )
          checks.push({
            code: "media_dimensions_unavailable",
            severity: "warning",
          });
        return {
          targetId: row.target_id,
          accountName: row.account_name,
          channel: row.channel,
          checks,
        };
      });
    });
  }

  async #insertRevision(
    client: DatabaseClient,
    input: {
      tenantId: string;
      workspaceId: string;
      draftId: string;
      revisionNumber: number;
      actorUserId: string;
      content: DraftContent;
    },
  ): Promise<string> {
    if (
      input.content.mediaAssetIds.length === 0 ||
      input.content.mediaAssetIds.length > 10
    )
      throw new Error("MEDIA_ATTACHMENTS_INVALID");
    const media = await client.query<{ id: string }>(
      `SELECT id FROM control.media_assets
       WHERE id = ANY($1::uuid[]) AND workspace_id=$2
         AND status = 'ready' AND soft_deleted_at IS NULL`,
      [[...input.content.mediaAssetIds], input.workspaceId],
    );
    if (media.rowCount !== input.content.mediaAssetIds.length)
      throw new Error("MEDIA_NOT_READY_OR_NOT_FOUND");
    const revisionId = randomUUID();
    const material = {
      title: input.content.title ?? null,
      caption: input.content.caption ?? null,
      description: input.content.description ?? null,
      mediaAssetIds: [...input.content.mediaAssetIds],
      channelOverrides: input.content.channelOverrides ?? {},
    };
    await client.query(
      `INSERT INTO control.social_draft_revisions
       (id,tenant_id,draft_id,revision_number,title,caption,description,
        media_attachments,channel_overrides,content_hash,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        revisionId,
        input.tenantId,
        input.draftId,
        input.revisionNumber,
        input.content.title ?? null,
        input.content.caption ?? null,
        input.content.description ?? null,
        JSON.stringify(
          input.content.mediaAssetIds.map((assetId, order) => ({
            assetId,
            order,
          })),
        ),
        JSON.stringify(input.content.channelOverrides ?? {}),
        hash(material),
        input.actorUserId,
      ],
    );
    return revisionId;
  }

  public async createDraft(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    accountIds: readonly string[];
    content: DraftContent;
    correlationId: string;
  }): Promise<string> {
    const draftId = randomUUID();
    await withTenant(this.pool, input.tenantId, async (client) => {
      await this.#createDraft(client, { ...input, draftId });
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.draft_created",
        targetType: "social_draft",
        targetId: draftId,
        correlationId: input.correlationId,
      });
    });
    return draftId;
  }

  async #createDraft(
    client: DatabaseClient,
    input: {
      tenantId: string;
      workspaceId: string;
      actorUserId: string;
      accountIds: readonly string[];
      content: DraftContent;
      draftId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO control.social_drafts
       (id,tenant_id,workspace_id,author_user_id) VALUES ($1,$2,$3,$4)`,
      [input.draftId, input.tenantId, input.workspaceId, input.actorUserId],
    );
    const revisionId = await this.#insertRevision(client, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      draftId: input.draftId,
      revisionNumber: 1,
      actorUserId: input.actorUserId,
      content: input.content,
    });
    const accounts = await client.query<{ id: string; account_type: string }>(
      `SELECT id,account_type FROM control.social_accounts
       WHERE id = ANY($1::uuid[]) AND workspace_id = $2
         AND status IN ('active','degraded','reauthorization_required')`,
      [[...input.accountIds], input.workspaceId],
    );
    if (accounts.rowCount !== input.accountIds.length)
      throw new SocialWorkflowError("SOCIAL_ACCOUNT_NOT_FOUND", 404);
    for (const account of accounts.rows) {
      const channel =
        account.account_type === "facebook_page"
          ? "facebook"
          : account.account_type === "instagram_account"
            ? "instagram"
            : account.account_type === "youtube_channel"
              ? "youtube"
              : "tiktok";
      await client.query(
        `INSERT INTO control.social_draft_targets
         (id,tenant_id,draft_id,revision_id,account_id,channel)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          input.tenantId,
          input.draftId,
          revisionId,
          account.id,
          channel,
        ],
      );
    }
  }

  public async createDraftFromApprovedVideo(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    renderJobId: string;
    mediaAssetId: string;
    accountIds: readonly string[];
    title?: string;
    caption?: string;
    description?: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ draftId: string; status: "draft"; replayed: boolean }> {
    if (
      input.accountIds.length === 0 ||
      new Set(input.accountIds).size !== input.accountIds.length
    )
      throw new SocialWorkflowError("VIDEO_DISTRIBUTION_TARGETS_INVALID", 400);
    const request = {
      workspaceId: input.workspaceId,
      renderJobId: input.renderJobId,
      mediaAssetId: input.mediaAssetId,
      accountIds: [...input.accountIds].sort(),
      title: input.title ?? null,
      caption: input.caption ?? null,
      description: input.description ?? null,
    };
    const requestHash = hash(request);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,32))",
        [`${input.tenantId}:video-distribution:${input.idempotencyKey}`],
      );
      const existing = await client.query<{
        social_draft_id: string;
        request_hash: string;
        created_by: string;
      }>(
        `SELECT social_draft_id,request_hash,created_by
         FROM control.video_social_distribution_handoffs
         WHERE idempotency_key=$1`,
        [input.idempotencyKey],
      );
      const receipt = existing.rows[0];
      if (receipt) {
        if (
          receipt.request_hash !== requestHash ||
          receipt.created_by !== input.actorUserId
        )
          throw new SocialWorkflowError(
            "VIDEO_DISTRIBUTION_IDEMPOTENCY_CONFLICT",
            409,
          );
        return {
          draftId: receipt.social_draft_id,
          status: "draft",
          replayed: true,
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
        throw new SocialWorkflowError(
          "VIDEO_ASSET_NOT_APPROVED_FOR_DISTRIBUTION",
          409,
        );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,32))",
        [`${input.tenantId}:video-distribution-review:${exact.review_id}`],
      );
      const alreadyPrepared = await client.query<{ social_draft_id: string }>(
        `SELECT social_draft_id FROM control.video_social_distribution_handoffs
         WHERE asset_review_id=$1`,
        [exact.review_id],
      );
      if (alreadyPrepared.rows[0])
        throw new SocialWorkflowError(
          "VIDEO_DISTRIBUTION_ALREADY_PREPARED",
          409,
        );
      const draftId = randomUUID();
      await this.#createDraft(client, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        accountIds: input.accountIds,
        content: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.caption ? { caption: input.caption } : {}),
          ...(input.description ? { description: input.description } : {}),
          mediaAssetIds: [input.mediaAssetId],
        },
        draftId,
      });
      await client.query(
        `INSERT INTO control.media_usage_references
         (id,tenant_id,asset_id,usage_type,usage_reference)
         VALUES($1,$2,$3,'social_draft',$4)`,
        [randomUUID(), input.tenantId, input.mediaAssetId, draftId],
      );
      await client.query(
        `INSERT INTO control.video_social_distribution_handoffs
         (id,tenant_id,workspace_id,asset_review_id,render_job_id,media_asset_id,
          social_draft_id,script_content_hash,idempotency_key,request_hash,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          exact.review_id,
          input.renderJobId,
          input.mediaAssetId,
          draftId,
          exact.script_content_hash,
          input.idempotencyKey,
          requestHash,
          input.actorUserId,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.draft_created",
        targetType: "social_draft",
        targetId: draftId,
        correlationId: input.correlationId,
        metadata: { source: "approved_video_asset" },
      });
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "video.distribution_draft_prepared",
        targetType: "social_draft",
        targetId: draftId,
        correlationId: input.correlationId,
        metadata: {
          renderJobId: input.renderJobId,
          mediaAssetId: input.mediaAssetId,
          scriptContentHash: exact.script_content_hash,
          targetCount: input.accountIds.length,
          reviewAuthorized: false,
          schedulingAuthorized: false,
          publicationAuthorized: false,
        },
      });
      return { draftId, status: "draft", replayed: false };
    });
  }

  public async reviseDraft(input: {
    tenantId: string;
    draftId: string;
    actorUserId: string;
    accountIds: readonly string[];
    content: DraftContent;
    correlationId: string;
  }): Promise<number> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const draft = await client.query<{
        current_revision: number;
        workspace_id: string;
        status: string;
      }>(
        "SELECT current_revision,workspace_id,status FROM control.social_drafts WHERE id = $1 FOR UPDATE",
        [input.draftId],
      );
      const row = draft.rows[0];
      if (!row || ["publishing", "published", "cancelled"].includes(row.status))
        throw new Error("DRAFT_NOT_EDITABLE");
      const revisionNumber = row.current_revision + 1;
      const revisionId = await this.#insertRevision(client, {
        tenantId: input.tenantId,
        workspaceId: row.workspace_id,
        draftId: input.draftId,
        revisionNumber,
        actorUserId: input.actorUserId,
        content: input.content,
      });
      const accounts = await client.query<{ id: string; account_type: string }>(
        `SELECT id,account_type FROM control.social_accounts
         WHERE id = ANY($1::uuid[]) AND workspace_id = $2
           AND status IN ('active','degraded','reauthorization_required')`,
        [[...input.accountIds], row.workspace_id],
      );
      if (accounts.rowCount !== input.accountIds.length)
        throw new Error("SOCIAL_ACCOUNT_NOT_FOUND");
      for (const account of accounts.rows) {
        const channel =
          account.account_type === "facebook_page"
            ? "facebook"
            : account.account_type === "instagram_account"
              ? "instagram"
              : account.account_type === "youtube_channel"
                ? "youtube"
                : "tiktok";
        await client.query(
          "INSERT INTO control.social_draft_targets (id,tenant_id,draft_id,revision_id,account_id,channel) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            input.tenantId,
            input.draftId,
            revisionId,
            account.id,
            channel,
          ],
        );
      }
      await client.query(
        "UPDATE control.social_drafts SET current_revision = $2, status = 'draft', scheduled_for = NULL, schedule_timezone = NULL, updated_at = now() WHERE id = $1",
        [input.draftId, revisionNumber],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.draft_revised",
        targetType: "social_draft",
        targetId: input.draftId,
        correlationId: input.correlationId,
        metadata: { revisionNumber, approvalReset: true },
      });
      return revisionNumber;
    });
  }

  public async submitForReview(input: {
    tenantId: string;
    draftId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<{ revision_id: string }>(
        `UPDATE control.social_drafts draft SET status = 'ready_for_review', updated_at = now()
         FROM control.social_draft_revisions revision
         WHERE draft.id = $1 AND draft.status = 'draft' AND revision.draft_id = draft.id
           AND revision.revision_number = draft.current_revision
         RETURNING revision.id AS revision_id`,
        [input.draftId],
      );
      const revisionId = result.rows[0]?.revision_id;
      if (!revisionId)
        throw new SocialWorkflowError("DRAFT_NOT_SUBMITTABLE", 409);
      await client.query(
        `INSERT INTO control.social_approvals
         (id,tenant_id,draft_id,revision_id,requested_by,decision)
         VALUES ($1,$2,$3,$4,$5,'pending')`,
        [
          randomUUID(),
          input.tenantId,
          input.draftId,
          revisionId,
          input.actorUserId,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.approval_requested",
        targetType: "social_draft",
        targetId: input.draftId,
        correlationId: input.correlationId,
      });
    });
  }

  public async decide(input: {
    tenantId: string;
    draftId: string;
    reviewerUserId: string;
    decision: "approved" | "rejected";
    reason?: string;
    correlationId: string;
  }): Promise<void> {
    const reason = input.reason?.trim();
    if (input.decision === "rejected" && !reason)
      throw new SocialWorkflowError("REJECTION_REASON_REQUIRED", 400);
    if (reason && reason.length > 500)
      throw new SocialWorkflowError("DECISION_REASON_TOO_LONG", 400);
    await withTenant(this.pool, input.tenantId, async (client) => {
      const approval = await client.query<{
        id: string;
        requested_by: string;
        revision_id: string;
        content_hash: string;
      }>(
        `SELECT approval.id,approval.requested_by,approval.revision_id,revision.content_hash
         FROM control.social_approvals approval
         JOIN control.social_draft_revisions revision ON revision.id = approval.revision_id
         JOIN control.social_drafts draft ON draft.id = approval.draft_id
         WHERE approval.draft_id = $1 AND approval.decision = 'pending'
           AND revision.revision_number = draft.current_revision FOR UPDATE OF approval`,
        [input.draftId],
      );
      const row = approval.rows[0];
      if (!row) throw new SocialWorkflowError("APPROVAL_NOT_PENDING", 409);
      if (row.requested_by === input.reviewerUserId)
        throw new SocialWorkflowError("SELF_APPROVAL_DENIED", 403);
      await client.query(
        `UPDATE control.social_approvals SET decision = $2, decided_by = $3,
         approved_content_hash = CASE WHEN $2 = 'approved' THEN $4 ELSE NULL END,
         reason = $5, decided_at = now() WHERE id = $1`,
        [
          row.id,
          input.decision,
          input.reviewerUserId,
          row.content_hash,
          reason ?? null,
        ],
      );
      await client.query(
        "UPDATE control.social_drafts SET status = $2, updated_at = now() WHERE id = $1",
        [input.draftId, input.decision],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.reviewerUserId,
        action: `social.${input.decision}`,
        targetType: "social_draft",
        targetId: input.draftId,
        correlationId: input.correlationId,
        metadata: {
          revisionId: row.revision_id,
          contentHash: row.content_hash,
        },
      });
    });
  }

  public async schedule(input: {
    tenantId: string;
    draftId: string;
    actorUserId: string;
    scheduledFor: Date;
    timezone: string;
    correlationId: string;
  }): Promise<void> {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
    } catch {
      throw new SocialWorkflowError("INVALID_TIMEZONE", 400);
    }
    if (
      !Number.isFinite(input.scheduledFor.getTime()) ||
      input.scheduledFor.getTime() < Date.now() - 1000
    )
      throw new SocialWorkflowError("SCHEDULE_MUST_BE_FUTURE", 400);
    await withTenant(this.pool, input.tenantId, async (client) => {
      const targets = await client.query<{
        id: string;
        revision_id: string;
        content_hash: string;
      }>(
        `SELECT target.id,target.revision_id,revision.content_hash
         FROM control.social_drafts draft
         JOIN control.social_draft_revisions revision ON revision.draft_id = draft.id AND revision.revision_number = draft.current_revision
         JOIN control.social_approvals approval ON approval.revision_id = revision.id AND approval.decision = 'approved' AND approval.approved_content_hash = revision.content_hash
         JOIN control.social_draft_targets target ON target.revision_id = revision.id
         WHERE draft.id = $1 AND draft.status = 'approved'`,
        [input.draftId],
      );
      if (!targets.rowCount)
        throw new SocialWorkflowError("DRAFT_NOT_APPROVED", 409);
      await client.query(
        "UPDATE control.social_drafts SET status = 'scheduled', scheduled_for = $2, schedule_timezone = $3, updated_at = now() WHERE id = $1",
        [input.draftId, input.scheduledFor, input.timezone],
      );
      for (const target of targets.rows) {
        await client.query(
          `INSERT INTO control.jobs
           (id,tenant_id,job_type,payload,idempotency_key,correlation_id,available_at,max_attempts)
           VALUES ($1,$2,'social.publish',$3,$4,$5,$6,4)`,
          [
            randomUUID(),
            input.tenantId,
            { draftId: input.draftId, targetId: target.id },
            `social.publish:${target.id}:${target.content_hash}`,
            input.correlationId,
            input.scheduledFor,
          ],
        );
      }
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.scheduled",
        targetType: "social_draft",
        targetId: input.draftId,
        correlationId: input.correlationId,
        metadata: {
          scheduledFor: input.scheduledFor.toISOString(),
          timezone: input.timezone,
          targetCount: targets.rowCount,
        },
      });
    });
  }

  async #refreshAggregate(
    client: DatabaseClient,
    draftId: string,
  ): Promise<void> {
    const result = await client.query<{
      published: number;
      failed: number;
      reauth: number;
      pending: number;
    }>(
      `SELECT
       count(*) FILTER (WHERE status = 'published')::int AS published,
       count(*) FILTER (WHERE status = 'failed')::int AS failed,
       count(*) FILTER (WHERE status = 'needs_reauthorization')::int AS reauth,
       count(*) FILTER (WHERE status IN ('queued','publishing','retry_scheduled'))::int AS pending
       FROM control.social_draft_targets WHERE draft_id = $1
         AND revision_id = (SELECT id FROM control.social_draft_revisions WHERE draft_id = $1 ORDER BY revision_number DESC LIMIT 1)`,
      [draftId],
    );
    const row = result.rows[0];
    const status =
      (row?.pending ?? 0) > 0
        ? "publishing"
        : (row?.reauth ?? 0) > 0
          ? "needs_reauthorization"
          : (row?.published ?? 0) > 0 && (row?.failed ?? 0) > 0
            ? "partial"
            : (row?.published ?? 0) > 0
              ? "published"
              : "failed";
    await client.query(
      "UPDATE control.social_drafts SET status = $2, updated_at = now() WHERE id = $1",
      [draftId, status],
    );
  }

  public async publishTarget(input: {
    tenantId: string;
    targetId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<{ status: string; providerReference?: string }> {
    const completed = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{
          provider_reference: string | null;
        }>(
          `SELECT attempt.provider_reference FROM control.publication_attempts attempt
         JOIN control.social_drafts draft ON draft.id=attempt.draft_id
         JOIN control.social_draft_revisions revision ON revision.id=attempt.revision_id
         WHERE attempt.target_id=$1 AND attempt.status='published'
           AND revision.revision_number=draft.current_revision`,
          [input.targetId],
        );
        return result.rows[0] ?? null;
      },
    );
    if (completed)
      return {
        status: "published",
        ...(completed.provider_reference
          ? { providerReference: completed.provider_reference }
          : {}),
      };
    const prepared = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{
          draft_id: string;
          revision_id: string;
          target_id: string;
          account_id: string;
          account_type: string;
          provider: "meta" | "youtube" | "tiktok";
          account_status: string;
          token_reference: string;
          token_expires_at: Date | null;
          authorized_scopes: string[];
          title: string | null;
          caption: string | null;
          description: string | null;
          media_attachments: Array<{ assetId: string; order: number }>;
          content_hash: string;
          approved_content_hash: string;
        }>(
          `SELECT draft.id AS draft_id,revision.id AS revision_id,target.id AS target_id,
          account.id AS account_id,account.account_type,account.provider,
          account.status AS account_status,account.token_reference,account.token_expires_at,
          account.authorized_scopes,revision.title,revision.caption,revision.description,
          revision.media_attachments,revision.content_hash,approval.approved_content_hash
         FROM control.social_draft_targets target
         JOIN control.social_drafts draft ON draft.id = target.draft_id
         JOIN control.social_draft_revisions revision ON revision.id = target.revision_id
         JOIN control.social_approvals approval ON approval.revision_id = revision.id AND approval.decision = 'approved'
         JOIN control.social_accounts account ON account.id = target.account_id
         WHERE target.id = $1 AND target.status IN ('queued','retry_scheduled','published')
           AND revision.revision_number = draft.current_revision`,
          [input.targetId],
        );
        const row = result.rows[0];
        if (!row || row.content_hash !== row.approved_content_hash)
          throw new Error("PUBLISHING_NOT_AUTHORIZED");
        const requiredScope =
          row.account_type === "facebook_page"
            ? "pages.manage-posts"
            : row.account_type === "instagram_account"
              ? "instagram.content-publish"
              : row.account_type === "youtube_channel"
                ? "youtube.upload"
                : "video.publish";
        if (
          row.account_status !== "active" ||
          !row.authorized_scopes.includes(requiredScope) ||
          (row.token_expires_at && row.token_expires_at.getTime() <= Date.now())
        ) {
          await client.query(
            "UPDATE control.social_accounts SET status = 'reauthorization_required', refresh_status = 'refresh_due' WHERE id = $1",
            [row.account_id],
          );
          await client.query(
            "UPDATE control.social_draft_targets SET status = 'needs_reauthorization' WHERE id = $1",
            [row.target_id],
          );
          await this.#refreshAggregate(client, row.draft_id);
          await evidence(client, {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            action: "social.reauthorization_required",
            targetType: "social_account",
            targetId: row.account_id,
            correlationId: input.correlationId,
          });
          return { authorizationRequired: true as const, row };
        }
        const mediaIds = row.media_attachments
          .sort((a, b) => a.order - b.order)
          .map((item) => item.assetId);
        const media = await client.query<{
          asset_id: string;
          object_key: string;
          mime_type: string;
          size_bytes: string;
        }>(
          `SELECT asset_id,object_key,mime_type,size_bytes FROM control.media_objects
         WHERE asset_id = ANY($1::uuid[]) AND object_kind = 'original'
         ORDER BY array_position($1::uuid[], asset_id)`,
          [mediaIds],
        );
        if (media.rowCount !== mediaIds.length)
          throw new Error("PUBLISH_MEDIA_NOT_READY");
        const payload = socialPublishPayloadSchema.parse({
          ...(row.title ? { title: row.title } : {}),
          ...(row.caption ? { caption: row.caption } : {}),
          ...(row.description ? { description: row.description } : {}),
          ...(row.provider === "youtube" ? { privacyStatus: "private" } : {}),
          media: media.rows.map((item) => ({
            assetId: item.asset_id,
            objectKey: item.object_key,
            mimeType: item.mime_type,
            sizeBytes: Number(item.size_bytes),
          })),
        });
        const idempotencyKey = `publish:${row.target_id}:${row.content_hash}`;
        const attempt = await client.query<{
          id: string;
          status: string;
          provider_reference: string | null;
          retry_count: number;
        }>(
          `INSERT INTO control.publication_attempts
         (id,tenant_id,draft_id,revision_id,target_id,account_id,idempotency_key,payload_hash,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'publishing')
         ON CONFLICT (tenant_id,idempotency_key) DO UPDATE SET
           status = CASE WHEN control.publication_attempts.status = 'published' THEN 'published'::control.publication_attempt_status ELSE 'publishing'::control.publication_attempt_status END,
           retry_count = CASE WHEN control.publication_attempts.status = 'published' THEN control.publication_attempts.retry_count ELSE control.publication_attempts.retry_count + 1 END,
           started_at = CASE WHEN control.publication_attempts.status = 'published' THEN control.publication_attempts.started_at ELSE now() END,
           updated_at = now()
         RETURNING id,status,provider_reference,retry_count`,
          [
            randomUUID(),
            input.tenantId,
            row.draft_id,
            row.revision_id,
            row.target_id,
            row.account_id,
            idempotencyKey,
            hash(payload),
          ],
        );
        const attemptRow = attempt.rows[0];
        if (!attemptRow) throw new Error("ATTEMPT_NOT_CREATED");
        if (attemptRow.status === "published")
          return {
            authorizationRequired: false as const,
            alreadyPublished: true as const,
            row,
            payload,
            idempotencyKey,
            attemptId: attemptRow.id,
            providerReference: attemptRow.provider_reference ?? undefined,
          };
        await client.query(
          "UPDATE control.social_draft_targets SET status = 'publishing' WHERE id = $1",
          [row.target_id],
        );
        await client.query(
          "UPDATE control.social_drafts SET status = 'publishing', updated_at = now() WHERE id = $1",
          [row.draft_id],
        );
        return {
          authorizationRequired: false as const,
          alreadyPublished: false as const,
          row,
          payload,
          idempotencyKey,
          attemptId: attemptRow.id,
        };
      },
    );
    if (prepared.authorizationRequired)
      return { status: "needs_reauthorization" };
    if (prepared.alreadyPublished)
      return {
        status: "published",
        ...(prepared.providerReference
          ? { providerReference: prepared.providerReference }
          : {}),
      };
    const adapter = this.#providers.get(prepared.row.provider);
    if (!adapter?.configured || prepared.row.provider === "tiktok")
      return this.#recordFailure(
        input,
        prepared,
        new SocialProviderError("disabled", false),
      );
    const token = await this.secrets.resolve(prepared.row.token_reference, {
      tenantId: input.tenantId,
      connectionId: prepared.row.account_id,
    });
    let result;
    try {
      result = await adapter.publish(prepared.payload, {
        accountType: prepared.row.account_type,
        idempotencyKey: prepared.idempotencyKey,
        token,
      });
    } catch (error) {
      return this.#recordFailure(
        input,
        prepared,
        error instanceof SocialProviderError
          ? error
          : new SocialProviderError("provider", false),
      );
    }
    await withTenant(this.pool, input.tenantId, async (client) => {
      const status = result.status === "published" ? "published" : "publishing";
      await client.query(
        "UPDATE control.publication_attempts SET status = $2::control.publication_attempt_status, provider_reference = $3, completed_at = CASE WHEN $2::text = 'published' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1",
        [prepared.attemptId, status, result.providerReference],
      );
      await client.query(
        "UPDATE control.social_draft_targets SET status = $2 WHERE id = $1",
        [prepared.row.target_id, status],
      );
      if (status === "published")
        await client.query(
          "UPDATE control.social_accounts SET last_successful_publish_at = now() WHERE id = $1",
          [prepared.row.account_id],
        );
      await this.#refreshAggregate(client, prepared.row.draft_id);
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.publication_attempted",
        targetType: "publication_attempt",
        targetId: prepared.attemptId,
        correlationId: input.correlationId,
        metadata: { status, provider: prepared.row.provider },
      });
    });
    return {
      status: result.status,
      providerReference: result.providerReference,
    };
  }

  async #recordFailure(
    input: { tenantId: string; actorUserId: string; correlationId: string },
    prepared: {
      attemptId: string;
      row: {
        target_id: string;
        draft_id: string;
        account_id: string;
        provider: string;
      };
    },
    error: SocialProviderError,
  ): Promise<{ status: string }> {
    const status =
      error.category === "authorization"
        ? "needs_reauthorization"
        : error.retryable
          ? "retry_scheduled"
          : "failed";
    await withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        "UPDATE control.publication_attempts SET status = $2, failure_category = $3, safe_error = $4, updated_at = now() WHERE id = $1",
        [prepared.attemptId, status, error.category, error.message],
      );
      await client.query(
        "UPDATE control.social_draft_targets SET status = $2 WHERE id = $1",
        [prepared.row.target_id, status],
      );
      if (status === "needs_reauthorization")
        await client.query(
          "UPDATE control.social_accounts SET status = 'reauthorization_required', refresh_status = 'refresh_due' WHERE id = $1",
          [prepared.row.account_id],
        );
      await this.#refreshAggregate(client, prepared.row.draft_id);
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.publication_failed",
        targetType: "publication_attempt",
        targetId: prepared.attemptId,
        correlationId: input.correlationId,
        metadata: {
          category: error.category,
          retryable: error.retryable,
          provider: prepared.row.provider,
        },
      });
    });
    return { status };
  }

  public async cancel(input: {
    tenantId: string;
    draftId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      const draft = await client.query<{ status: string }>(
        "SELECT status FROM control.social_drafts WHERE id = $1 FOR UPDATE",
        [input.draftId],
      );
      const status = draft.rows[0]?.status;
      if (!status) throw new Error("DRAFT_NOT_FOUND");
      if (status === "published")
        throw new Error("PUBLISHED_CONTENT_CANNOT_BE_CANCELLED");
      if (status === "publishing") {
        await client.query(
          "UPDATE control.social_drafts SET cancellation_requested_at = now(), updated_at = now() WHERE id = $1",
          [input.draftId],
        );
      } else {
        await client.query(
          "UPDATE control.social_drafts SET status = 'cancelled', cancellation_requested_at = now(), updated_at = now() WHERE id = $1",
          [input.draftId],
        );
        await client.query(
          "UPDATE control.social_draft_targets SET status = 'cancelled' WHERE draft_id = $1 AND status IN ('queued','retry_scheduled')",
          [input.draftId],
        );
      }
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "social.cancellation_requested",
        targetType: "social_draft",
        targetId: input.draftId,
        correlationId: input.correlationId,
        metadata: { publishingAlreadyStarted: status === "publishing" },
      });
    });
  }
}
