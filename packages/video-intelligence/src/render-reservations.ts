import { createHash, randomUUID } from "node:crypto";

import { withTenant, type DatabasePool } from "@redi-control/database";

import type { VideoAspectRatio } from "./index.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VideoRenderReservationFailureCode =
  | "VIDEO_RENDER_RESERVATION_NOT_ACCEPTED"
  | "VIDEO_RENDER_RESERVATION_INVALID"
  | "VIDEO_RENDER_RESERVATION_ACTOR_NOT_ELIGIBLE"
  | "VIDEO_RENDER_PREPARATION_NOT_ELIGIBLE"
  | "VIDEO_GENERATION_POLICY_NOT_ENABLED"
  | "VIDEO_GENERATION_CONCURRENCY_EXCEEDED"
  | "VIDEO_GENERATION_DAILY_BUDGET_EXCEEDED"
  | "VIDEO_GENERATION_MONTHLY_BUDGET_EXCEEDED"
  | "VIDEO_RENDER_RESERVATION_CONFLICT";

export class VideoRenderReservationError extends Error {
  public constructor(
    public readonly code: VideoRenderReservationFailureCode,
    public readonly statusCode: 400 | 403 | 409 | 503,
  ) {
    super(code);
    this.name = "VideoRenderReservationError";
  }
}

export interface VideoRenderReservation {
  readonly preparationId: string;
  readonly reservationKey: string;
  readonly reservedCredits: number;
  readonly jobs: readonly {
    readonly jobId: string;
    readonly outputId: string;
    readonly aspectRatio: VideoAspectRatio;
    readonly providerId: "heygen";
    readonly providerIdempotencyKey: string;
    readonly status: VideoRenderJobStatus;
  }[];
  readonly providerExecutionCreated: false;
  readonly replayed: boolean;
}

export type VideoRenderJobStatus =
  | "reserved"
  | "submitting"
  | "submitted"
  | "succeeded"
  | "failed"
  | "cancelled";

export class VideoRenderReservationService {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly reservationAccepted = false,
  ) {}

  public async reserve(input: {
    tenantId: string;
    workspaceId: string;
    preparationId: string;
    reservationKey: string;
    actorUserId: string;
    correlationId: string;
    estimatedCreditsPerOutput: number;
  }): Promise<VideoRenderReservation> {
    if (!this.reservationAccepted)
      throw new VideoRenderReservationError(
        "VIDEO_RENDER_RESERVATION_NOT_ACCEPTED",
        503,
      );
    if (
      !UUID.test(input.tenantId) ||
      !UUID.test(input.workspaceId) ||
      !UUID.test(input.preparationId) ||
      !UUID.test(input.reservationKey) ||
      !UUID.test(input.actorUserId) ||
      !UUID.test(input.correlationId) ||
      !Number.isInteger(input.estimatedCreditsPerOutput) ||
      input.estimatedCreditsPerOutput < 1 ||
      input.estimatedCreditsPerOutput > 1_000_000
    )
      throw new VideoRenderReservationError(
        "VIDEO_RENDER_RESERVATION_INVALID",
        400,
      );

    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          workspaceId: input.workspaceId,
          preparationId: input.preparationId,
          estimatedCreditsPerOutput: input.estimatedCreditsPerOutput,
        }),
      )
      .digest("hex");

    return withTenant(this.pool, input.tenantId, async (client) => {
      const actor = await client.query(
        `SELECT 1 FROM control.memberships
         WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`,
        [input.tenantId, input.actorUserId],
      );
      if (!actor.rowCount)
        throw new VideoRenderReservationError(
          "VIDEO_RENDER_RESERVATION_ACTOR_NOT_ELIGIBLE",
          403,
        );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,32))",
        [`video-reservation:${input.tenantId}:${input.reservationKey}`],
      );
      const replay = await client.query<{
        id: string;
        output_id: string;
        aspect_ratio: VideoAspectRatio;
        idempotency_key: string;
        reserved_credits: number;
        request_hash: string;
        requested_by: string;
        status: VideoRenderJobStatus;
      }>(
        `SELECT job.id,job.output_id,output.aspect_ratio,job.idempotency_key,
           job.reserved_credits,job.request_hash,job.requested_by,job.status
         FROM control.video_render_jobs job
         JOIN control.video_render_outputs output ON output.id=job.output_id
         WHERE job.workspace_id=$1 AND job.preparation_id=$2
           AND job.reservation_key=$3
         ORDER BY output.position`,
        [input.workspaceId, input.preparationId, input.reservationKey],
      );
      if (replay.rowCount) {
        if (
          replay.rows.some(
            (row) =>
              row.request_hash !== requestHash ||
              row.requested_by !== input.actorUserId,
          )
        )
          throw new VideoRenderReservationError(
            "VIDEO_RENDER_RESERVATION_CONFLICT",
            409,
          );
        return {
          preparationId: input.preparationId,
          reservationKey: input.reservationKey,
          reservedCredits: replay.rows.reduce(
            (total, row) => total + row.reserved_credits,
            0,
          ),
          jobs: replay.rows.map((row) => ({
            jobId: row.id,
            outputId: row.output_id,
            aspectRatio: row.aspect_ratio,
            providerId: "heygen" as const,
            providerIdempotencyKey: row.idempotency_key,
            status: row.status,
          })),
          providerExecutionCreated: false,
          replayed: true,
        };
      }

      const policy = await client.query<{
        daily_credit_limit: number;
        monthly_credit_limit: number;
        maximum_concurrency: number;
      }>(
        `SELECT daily_credit_limit,monthly_credit_limit,maximum_concurrency
         FROM control.video_generation_policies
         WHERE workspace_id=$1 AND provider_id='heygen' AND enabled
         FOR UPDATE`,
        [input.workspaceId],
      );
      const limits = policy.rows[0];
      if (!limits)
        throw new VideoRenderReservationError(
          "VIDEO_GENERATION_POLICY_NOT_ENABLED",
          503,
        );

      const outputs = await client.query<{
        id: string;
        aspect_ratio: VideoAspectRatio;
      }>(
        `SELECT output.id,output.aspect_ratio
         FROM control.video_render_preparations preparation
         JOIN control.video_briefs brief ON brief.id=preparation.brief_id
         JOIN control.video_script_revisions revision
           ON revision.id=preparation.revision_id
          AND revision.revision_number=brief.current_script_revision
         JOIN control.video_script_approvals approval
           ON approval.id=preparation.approval_id
          AND approval.revision_id=revision.id
          AND approval.decision='approved'
          AND approval.approved_content_hash=revision.content_hash
         JOIN control.video_render_outputs output
           ON output.preparation_id=preparation.id
         WHERE preparation.id=$1 AND preparation.workspace_id=$2
           AND brief.status='approved'
         ORDER BY output.position
         FOR UPDATE OF brief`,
        [input.preparationId, input.workspaceId],
      );
      if (!outputs.rowCount)
        throw new VideoRenderReservationError(
          "VIDEO_RENDER_PREPARATION_NOT_ELIGIBLE",
          409,
        );
      const alreadyReserved = await client.query(
        `SELECT 1 FROM control.video_render_jobs
         WHERE output_id=ANY($1::uuid[]) LIMIT 1`,
        [outputs.rows.map((output) => output.id)],
      );
      if (alreadyReserved.rowCount)
        throw new VideoRenderReservationError(
          "VIDEO_RENDER_RESERVATION_CONFLICT",
          409,
        );

      const requestedCredits =
        outputs.rows.length * input.estimatedCreditsPerOutput;
      const usage = await client.query<{
        active_jobs: number;
        daily_credits: number;
        monthly_credits: number;
      }>(
        `SELECT
           count(*) FILTER (WHERE status IN ('reserved','submitting','submitted'))::int active_jobs,
           coalesce(sum(reserved_credits) FILTER (
             WHERE status<>'cancelled'
               AND reserved_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ),0)::int daily_credits,
           coalesce(sum(reserved_credits) FILTER (
             WHERE status<>'cancelled'
               AND reserved_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ),0)::int monthly_credits
         FROM control.video_render_jobs
         WHERE workspace_id=$1 AND provider_id='heygen'`,
        [input.workspaceId],
      );
      const current = usage.rows[0] ?? {
        active_jobs: 0,
        daily_credits: 0,
        monthly_credits: 0,
      };
      if (
        current.active_jobs + outputs.rows.length >
        limits.maximum_concurrency
      )
        throw new VideoRenderReservationError(
          "VIDEO_GENERATION_CONCURRENCY_EXCEEDED",
          409,
        );
      if (current.daily_credits + requestedCredits > limits.daily_credit_limit)
        throw new VideoRenderReservationError(
          "VIDEO_GENERATION_DAILY_BUDGET_EXCEEDED",
          409,
        );
      if (
        current.monthly_credits + requestedCredits >
        limits.monthly_credit_limit
      )
        throw new VideoRenderReservationError(
          "VIDEO_GENERATION_MONTHLY_BUDGET_EXCEEDED",
          409,
        );

      const jobs = [] as {
        jobId: string;
        outputId: string;
        aspectRatio: VideoAspectRatio;
        providerId: "heygen";
        providerIdempotencyKey: string;
        status: "reserved";
      }[];
      for (const output of outputs.rows) {
        const jobId = randomUUID();
        const providerIdempotencyKey = randomUUID();
        await client.query(
          `INSERT INTO control.video_render_jobs
           (id,tenant_id,workspace_id,preparation_id,output_id,provider_id,
            reservation_key,request_hash,idempotency_key,reserved_credits,
            requested_by,correlation_id)
           VALUES($1,$2,$3,$4,$5,'heygen',$6,$7,$8,$9,$10,$11)`,
          [
            jobId,
            input.tenantId,
            input.workspaceId,
            input.preparationId,
            output.id,
            input.reservationKey,
            requestHash,
            providerIdempotencyKey,
            input.estimatedCreditsPerOutput,
            input.actorUserId,
            input.correlationId,
          ],
        );
        await client.query(
          `INSERT INTO control.video_generation_usage_events
           (id,tenant_id,workspace_id,render_job_id,provider_id,event_type,credits)
           VALUES($1,$2,$3,$4,'heygen','reserved',$5)`,
          [
            randomUUID(),
            input.tenantId,
            input.workspaceId,
            jobId,
            input.estimatedCreditsPerOutput,
          ],
        );
        jobs.push({
          jobId,
          outputId: output.id,
          aspectRatio: output.aspect_ratio,
          providerId: "heygen",
          providerIdempotencyKey,
          status: "reserved",
        });
      }
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO control.audit_events
         (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
         VALUES($1,$2,$3,'video.render_reserved','video_render_preparation',$4,$5,$6)`,
        [
          auditId,
          input.tenantId,
          input.actorUserId,
          input.preparationId,
          input.correlationId,
          {
            workspaceId: input.workspaceId,
            reservationKey: input.reservationKey,
            providerId: "heygen",
            outputCount: jobs.length,
            reservedCredits: requestedCredits,
            providerExecutionCreated: false,
          },
        ],
      );
      await client.query(
        `INSERT INTO control.outbox_events
         (id,tenant_id,event_type,event_version,payload,correlation_id,causation_id)
         VALUES($1,$2,'video.render_reserved',1,$3,$4,$5)`,
        [
          randomUUID(),
          input.tenantId,
          { auditEventId: auditId, preparationId: input.preparationId },
          input.correlationId,
          auditId,
        ],
      );
      return {
        preparationId: input.preparationId,
        reservationKey: input.reservationKey,
        reservedCredits: requestedCredits,
        jobs,
        providerExecutionCreated: false,
        replayed: false,
      };
    });
  }
}
