import { randomUUID } from "node:crypto";

import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

import type { VideoAspectRatio } from "./index.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VideoRenderCompletionFailureCode =
  | "VIDEO_RENDER_COMPLETION_NOT_ACCEPTED"
  | "VIDEO_RENDER_COMPLETION_INPUT_INVALID"
  | "VIDEO_RENDER_COMPLETION_NOT_ATTACHABLE"
  | "VIDEO_RENDER_COMPLETION_CONFLICT"
  | "VIDEO_RENDER_COMPLETION_CREDIT_OVERAGE"
  | "VIDEO_RENDER_COMPLETION_ASSET_NOT_VERIFIED";

export class VideoRenderCompletionError extends Error {
  public constructor(
    public readonly code: VideoRenderCompletionFailureCode,
    public readonly statusCode: 400 | 409 | 503,
  ) {
    super(code);
    this.name = "VideoRenderCompletionError";
  }
}

const transitionEvidence = async (
  client: DatabaseClient,
  input: {
    tenantId: string;
    correlationId: string;
    jobId: string;
    assetId: string;
    actualCredits: number;
  },
) => {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
     VALUES($1,$2,NULL,'video.render_asset_verified','video_render_job',$3,$4,$5)`,
    [
      auditId,
      input.tenantId,
      input.jobId,
      input.correlationId,
      {
        mediaAssetId: input.assetId,
        actualCredits: input.actualCredits,
        providerOutputUrlPersisted: false,
      },
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events
     (id,tenant_id,event_type,event_version,payload,correlation_id)
     VALUES($1,$2,'video.render_asset_verified',1,$3,$4)`,
    [
      randomUUID(),
      input.tenantId,
      {
        auditEventId: auditId,
        jobId: input.jobId,
        mediaAssetId: input.assetId,
      },
      input.correlationId,
    ],
  );
};

const aspectMatches = (
  width: number,
  height: number,
  aspectRatio: VideoAspectRatio,
): boolean => {
  const expected = aspectRatio === "9:16" ? 9 / 16 : 16 / 9;
  return Math.abs(width / height - expected) <= 0.01;
};

export class VideoRenderCompletionService {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly completionAccepted = false,
  ) {}

  public async attachVerifiedAsset(input: {
    tenantId: string;
    jobId: string;
    mediaAssetId: string;
    actualCredits: number;
  }): Promise<{
    readonly jobId: string;
    readonly mediaAssetId: string;
    readonly status: "succeeded";
    readonly replayed: boolean;
  }> {
    if (!this.completionAccepted)
      throw new VideoRenderCompletionError(
        "VIDEO_RENDER_COMPLETION_NOT_ACCEPTED",
        503,
      );
    if (
      !UUID.test(input.tenantId) ||
      !UUID.test(input.jobId) ||
      !UUID.test(input.mediaAssetId) ||
      !Number.isInteger(input.actualCredits) ||
      input.actualCredits < 0 ||
      input.actualCredits > 1_000_000
    )
      throw new VideoRenderCompletionError(
        "VIDEO_RENDER_COMPLETION_INPUT_INVALID",
        400,
      );

    return withTenant(this.pool, input.tenantId, async (client) => {
      const jobs = await client.query<{
        id: string;
        workspace_id: string;
        status: string;
        reserved_credits: number;
        actual_credits: number | null;
        media_asset_id: string | null;
        requested_by: string;
        correlation_id: string;
        aspect_ratio: VideoAspectRatio;
        max_duration_seconds: number;
        revision_id: string;
        content_hash: string;
      }>(
        `SELECT job.id,job.workspace_id,job.status,job.reserved_credits,
           job.actual_credits,job.media_asset_id,job.requested_by,
           job.correlation_id,output.aspect_ratio,
           preparation.max_duration_seconds,preparation.revision_id,
           revision.content_hash
         FROM control.video_render_jobs job
         JOIN control.video_render_outputs output ON output.id=job.output_id
         JOIN control.video_render_preparations preparation
           ON preparation.id=job.preparation_id
         JOIN control.video_script_revisions revision
           ON revision.id=preparation.revision_id
         WHERE job.id=$1 FOR UPDATE OF job`,
        [input.jobId],
      );
      const job = jobs.rows[0];
      if (!job)
        throw new VideoRenderCompletionError(
          "VIDEO_RENDER_COMPLETION_NOT_ATTACHABLE",
          409,
        );
      if (job.status === "succeeded") {
        if (
          job.media_asset_id !== input.mediaAssetId ||
          job.actual_credits !== input.actualCredits
        )
          throw new VideoRenderCompletionError(
            "VIDEO_RENDER_COMPLETION_CONFLICT",
            409,
          );
        return {
          jobId: job.id,
          mediaAssetId: input.mediaAssetId,
          status: "succeeded" as const,
          replayed: true,
        };
      }
      if (job.status !== "submitted")
        throw new VideoRenderCompletionError(
          "VIDEO_RENDER_COMPLETION_NOT_ATTACHABLE",
          409,
        );
      if (input.actualCredits > job.reserved_credits)
        throw new VideoRenderCompletionError(
          "VIDEO_RENDER_COMPLETION_CREDIT_OVERAGE",
          409,
        );

      const assets = await client.query<{
        id: string;
        width: number | null;
        height: number | null;
        duration_ms: string | null;
      }>(
        `SELECT asset.id,object.width,object.height,object.duration_ms
         FROM control.media_assets asset
         JOIN control.media_objects object
           ON object.asset_id=asset.id AND object.object_kind='original'
         WHERE asset.id=$1 AND asset.workspace_id=$2
           AND asset.created_by=$3 AND asset.source='generated_provider'
           AND asset.status='ready' AND asset.processing_status='ready'
           AND asset.soft_deleted_at IS NULL
           AND object.mime_type='video/mp4'
           AND object.size_bytes>0
           AND object.checksum_sha256~'^[0-9a-f]{64}$'`,
        [input.mediaAssetId, job.workspace_id, job.requested_by],
      );
      const asset = assets.rows[0];
      const durationMs = Number(asset?.duration_ms);
      if (
        !asset ||
        !asset.width ||
        !asset.height ||
        !Number.isSafeInteger(durationMs) ||
        durationMs <= 0 ||
        durationMs > job.max_duration_seconds * 1000 ||
        !aspectMatches(asset.width, asset.height, job.aspect_ratio)
      )
        throw new VideoRenderCompletionError(
          "VIDEO_RENDER_COMPLETION_ASSET_NOT_VERIFIED",
          409,
        );

      const completed = await client.query(
        `UPDATE control.video_render_jobs
         SET status='succeeded',media_asset_id=$2,actual_credits=$3,
           completed_at=now(),updated_at=now()
         WHERE id=$1 AND status='submitted'
         RETURNING id`,
        [job.id, input.mediaAssetId, input.actualCredits],
      );
      if (completed.rowCount !== 1)
        throw new VideoRenderCompletionError(
          "VIDEO_RENDER_COMPLETION_CONFLICT",
          409,
        );
      await client.query(
        `INSERT INTO control.video_generation_usage_events
         (id,tenant_id,workspace_id,render_job_id,provider_id,event_type,credits)
         VALUES($1,$2,$3,$4,'heygen','reconciled',$5)`,
        [
          randomUUID(),
          input.tenantId,
          job.workspace_id,
          job.id,
          input.actualCredits,
        ],
      );
      await client.query(
        `INSERT INTO control.media_usage_references
         (id,tenant_id,asset_id,usage_type,usage_reference)
         VALUES($1,$2,$3,'video_render',$4)`,
        [randomUUID(), input.tenantId, input.mediaAssetId, job.id],
      );
      await client.query(
        `INSERT INTO control.video_render_asset_reviews
         (id,tenant_id,workspace_id,render_job_id,media_asset_id,revision_id,
          script_content_hash,requested_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.tenantId,
          job.workspace_id,
          job.id,
          input.mediaAssetId,
          job.revision_id,
          job.content_hash,
          job.requested_by,
        ],
      );
      await transitionEvidence(client, {
        tenantId: input.tenantId,
        correlationId: job.correlation_id,
        jobId: job.id,
        assetId: input.mediaAssetId,
        actualCredits: input.actualCredits,
      });
      return {
        jobId: job.id,
        mediaAssetId: input.mediaAssetId,
        status: "succeeded" as const,
        replayed: false,
      };
    });
  }
}
