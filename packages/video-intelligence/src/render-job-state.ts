import { randomUUID } from "node:crypto";

import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

import type { VideoAspectRatio, VideoTargetLanguage } from "./index.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const PROVIDER_REQUEST_ID = /^[A-Za-z0-9_-]{1,200}$/;

export type VideoRenderJobStateFailureCode =
  | "VIDEO_RENDER_SUBMISSION_NOT_ACCEPTED"
  | "VIDEO_RENDER_JOB_STATE_INPUT_INVALID"
  | "VIDEO_RENDER_JOB_NOT_CLAIMABLE"
  | "VIDEO_RENDER_JOB_NOT_SUBMITTABLE";

export class VideoRenderJobStateError extends Error {
  public constructor(
    public readonly code: VideoRenderJobStateFailureCode,
    public readonly statusCode: 400 | 409 | 503,
  ) {
    super(code);
    this.name = "VideoRenderJobStateError";
  }
}

export interface ClaimedVideoRenderJob {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly preparationId: string;
  readonly outputId: string;
  readonly providerId: "heygen";
  readonly providerIdempotencyKey: string;
  readonly topic: string;
  readonly script: string;
  readonly targetLanguage: VideoTargetLanguage;
  readonly aspectRatio: VideoAspectRatio;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: string;
}

const writeTransitionEvidence = async (
  client: DatabaseClient,
  input: {
    tenantId: string;
    correlationId: string;
    eventType: string;
    jobId: string;
    metadata: Record<string, unknown>;
  },
) => {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
     VALUES($1,$2,NULL,$3,'video_render_job',$4,$5,$6)`,
    [
      auditId,
      input.tenantId,
      input.eventType,
      input.jobId,
      input.correlationId,
      input.metadata,
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events
     (id,tenant_id,event_type,event_version,payload,correlation_id)
     VALUES($1,$2,$3,1,$4,$5)`,
    [
      randomUUID(),
      input.tenantId,
      input.eventType,
      { auditEventId: auditId, jobId: input.jobId },
      input.correlationId,
    ],
  );
};

export class VideoRenderJobStateMachine {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly submissionAccepted = false,
  ) {}

  private assertAccepted(): void {
    if (!this.submissionAccepted)
      throw new VideoRenderJobStateError(
        "VIDEO_RENDER_SUBMISSION_NOT_ACCEPTED",
        503,
      );
  }

  public async claim(input: {
    tenantId: string;
    workerId: string;
    leaseSeconds?: number;
  }): Promise<ClaimedVideoRenderJob | null> {
    this.assertAccepted();
    const leaseSeconds = input.leaseSeconds ?? 120;
    if (
      !UUID.test(input.tenantId) ||
      !WORKER_ID.test(input.workerId) ||
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 30 ||
      leaseSeconds > 900
    )
      throw new VideoRenderJobStateError(
        "VIDEO_RENDER_JOB_STATE_INPUT_INVALID",
        400,
      );
    return withTenant(this.pool, input.tenantId, async (client) => {
      const recovered = await client.query<{
        id: string;
        correlation_id: string;
        status: "reserved" | "failed";
      }>(
        `UPDATE control.video_render_jobs
         SET status=CASE WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'reserved' END,
           safe_failure_code=CASE WHEN attempt_count>=max_attempts
             THEN 'VIDEO_SUBMISSION_LEASE_EXHAUSTED' ELSE NULL END,
           completed_at=CASE WHEN attempt_count>=max_attempts THEN now() ELSE NULL END,
           available_at=CASE WHEN attempt_count>=max_attempts THEN available_at
             ELSE now()+make_interval(secs=>LEAST(300,power(2,attempt_count)::int)) END,
           locked_at=NULL,locked_by=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE provider_id='heygen' AND status='submitting'
           AND lease_expires_at<=now()
           AND EXISTS(
             SELECT 1 FROM control.business_workspaces workspace
             WHERE workspace.id=video_render_jobs.workspace_id
               AND workspace.lifecycle_status='active'
           )
         RETURNING id,correlation_id,status`,
      );
      for (const job of recovered.rows)
        await writeTransitionEvidence(client, {
          tenantId: input.tenantId,
          correlationId: job.correlation_id,
          eventType:
            job.status === "failed"
              ? "video.render_lease_exhausted"
              : "video.render_lease_recovered",
          jobId: job.id,
          metadata: { status: job.status },
        });

      const claimed = await client.query<{
        id: string;
        workspace_id: string;
        preparation_id: string;
        output_id: string;
        idempotency_key: string;
        correlation_id: string;
        attempt_count: number;
        max_attempts: number;
        lease_expires_at: Date;
      }>(
        `WITH candidate AS (
           SELECT job.id
           FROM control.video_render_jobs job
           JOIN control.video_generation_policies policy
             ON policy.workspace_id=job.workspace_id
            AND policy.provider_id=job.provider_id AND policy.enabled
           JOIN control.business_workspaces workspace
             ON workspace.id=job.workspace_id AND workspace.lifecycle_status='active'
           WHERE job.provider_id='heygen' AND job.status='reserved'
             AND job.available_at<=now() AND job.attempt_count<job.max_attempts
           ORDER BY job.available_at,job.reserved_at,job.id
           FOR UPDATE OF job SKIP LOCKED LIMIT 1
         )
         UPDATE control.video_render_jobs job
         SET status='submitting',locked_at=now(),locked_by=$1,
           lease_expires_at=now()+make_interval(secs=>$2),
           attempt_count=attempt_count+1,updated_at=now()
         FROM candidate WHERE job.id=candidate.id
         RETURNING job.id,job.workspace_id,job.preparation_id,job.output_id,
           job.idempotency_key,job.correlation_id,job.attempt_count,
           job.max_attempts,job.lease_expires_at`,
        [input.workerId, leaseSeconds],
      );
      const job = claimed.rows[0];
      if (!job) return null;
      const exact = await client.query<{
        topic: string;
        script: string;
        target_language: VideoTargetLanguage;
        aspect_ratio: VideoAspectRatio;
      }>(
        `SELECT brief.topic,revision.script,preparation.target_language,
           output.aspect_ratio
         FROM control.video_render_jobs job
         JOIN control.video_render_preparations preparation
           ON preparation.id=job.preparation_id
         JOIN control.video_render_outputs output ON output.id=job.output_id
         JOIN control.video_briefs brief ON brief.id=preparation.brief_id
         JOIN control.video_script_revisions revision
           ON revision.id=preparation.revision_id
         WHERE job.id=$1`,
        [job.id],
      );
      const payload = exact.rows[0];
      if (!payload)
        throw new VideoRenderJobStateError(
          "VIDEO_RENDER_JOB_NOT_CLAIMABLE",
          409,
        );
      await writeTransitionEvidence(client, {
        tenantId: input.tenantId,
        correlationId: job.correlation_id,
        eventType: "video.render_claimed",
        jobId: job.id,
        metadata: {
          workspaceId: job.workspace_id,
          preparationId: job.preparation_id,
          outputId: job.output_id,
          providerId: "heygen",
          attemptCount: job.attempt_count,
          maxAttempts: job.max_attempts,
          providerRequestCreated: false,
        },
      });
      return {
        id: job.id,
        tenantId: input.tenantId,
        workspaceId: job.workspace_id,
        preparationId: job.preparation_id,
        outputId: job.output_id,
        providerId: "heygen",
        providerIdempotencyKey: job.idempotency_key,
        topic: payload.topic,
        script: payload.script,
        targetLanguage: payload.target_language,
        aspectRatio: payload.aspect_ratio,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        leaseExpiresAt: job.lease_expires_at.toISOString(),
      };
    });
  }

  public async markSubmitted(input: {
    tenantId: string;
    jobId: string;
    workerId: string;
    providerRequestId: string;
  }): Promise<{ readonly jobId: string; readonly status: "submitted" }> {
    this.assertAccepted();
    if (
      !UUID.test(input.tenantId) ||
      !UUID.test(input.jobId) ||
      !WORKER_ID.test(input.workerId) ||
      !PROVIDER_REQUEST_ID.test(input.providerRequestId)
    )
      throw new VideoRenderJobStateError(
        "VIDEO_RENDER_JOB_STATE_INPUT_INVALID",
        400,
      );
    return withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        correlation_id: string;
      }>(
        `UPDATE control.video_render_jobs
         SET status='submitted',provider_request_id=$3,submitted_at=now(),
           locked_at=NULL,locked_by=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE id=$1 AND status='submitting' AND locked_by=$2
           AND lease_expires_at>now()
         RETURNING id,correlation_id`,
        [input.jobId, input.workerId, input.providerRequestId],
      );
      const job = result.rows[0];
      if (!job)
        throw new VideoRenderJobStateError(
          "VIDEO_RENDER_JOB_NOT_SUBMITTABLE",
          409,
        );
      await writeTransitionEvidence(client, {
        tenantId: input.tenantId,
        correlationId: job.correlation_id,
        eventType: "video.render_submitted",
        jobId: job.id,
        metadata: { providerId: "heygen" },
      });
      return { jobId: job.id, status: "submitted" };
    });
  }
}
