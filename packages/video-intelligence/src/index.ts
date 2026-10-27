import { createHash, randomUUID } from "node:crypto";

import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

export * from "./heygen-v3.js";
export * from "./render-completion.js";
export * from "./render-job-state.js";
export * from "./render-reservations.js";

export type VideoProgramId = "product_faq_ads" | "daily_news_flash";
export type VideoWorkflowStage =
  | "signals"
  | "brief"
  | "script"
  | "render"
  | "review"
  | "distribution";
export type VideoBriefStatus =
  | "draft"
  | "review_required"
  | "approved"
  | "rejected";
export type VideoEvidenceKind =
  | "aggregate_audience_signal"
  | "verified_product_fact"
  | "approved_editorial_story";
export type VideoAspectRatio = "9:16" | "16:9";
export type VideoTargetLanguage = "en" | "de" | "sq";

export interface VideoEvidenceInput {
  readonly kind: VideoEvidenceKind;
  readonly title: string;
  readonly sourceReference: string;
  readonly summary: string;
  readonly aggregateCount?: number;
}

export interface VideoBriefView {
  readonly id: string;
  readonly programId: VideoProgramId;
  readonly topic: string;
  readonly objective: string;
  readonly audience: string;
  readonly status: VideoBriefStatus;
  readonly currentRevision: number;
  readonly script: string;
  readonly scriptHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly evidence: readonly {
    readonly id: string;
    readonly kind: VideoEvidenceKind;
    readonly title: string;
    readonly sourceReference: string;
    readonly summary: string;
    readonly aggregateCount: number | null;
  }[];
  readonly approval: {
    readonly decision: "pending" | "approved" | "rejected";
    readonly requestedAt: string;
    readonly decidedAt: string | null;
    readonly reason: string | null;
    readonly requestedByCurrentUser: boolean;
  } | null;
  readonly renderPreparation: {
    readonly id: string;
    readonly presentationMode: "presenter_explainer" | "news_anchor";
    readonly targetLanguage: VideoTargetLanguage;
    readonly maxDurationSeconds: number;
    readonly rightsReference: string;
    readonly outputs: readonly VideoAspectRatio[];
    readonly status: "blocked";
    readonly blockCode: "provider_not_accepted";
    readonly requestedAt: string;
    readonly requestedByCurrentUser: boolean;
  } | null;
  readonly renderedAssets: readonly {
    readonly jobId: string;
    readonly mediaAssetId: string;
    readonly aspectRatio: VideoAspectRatio;
    readonly filename: string;
    readonly mimeType: "video/mp4";
    readonly sizeBytes: number;
    readonly checksumSha256: string;
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
    readonly completedAt: string;
    readonly review: {
      readonly decision: "pending" | "approved" | "rejected";
      readonly requestedAt: string;
      readonly decidedAt: string | null;
      readonly reason: string | null;
      readonly requestedByCurrentUser: boolean;
    };
    readonly distributionDraft: {
      readonly id: string;
      readonly status: string;
      readonly createdAt: string;
    } | null;
    readonly websiteContent: {
      readonly id: string;
      readonly status: "draft" | "active" | "archived";
      readonly createdAt: string;
    } | null;
  }[];
}

export interface VideoIntelligenceSnapshot {
  readonly workspace: { readonly id: string; readonly displayName: string };
  readonly package: {
    readonly id: string;
    readonly displayName: string;
    readonly planningIncluded: true;
    readonly generationAddOn: "not_configured";
  };
  readonly safety: {
    readonly externalProviderExecutionAvailable: false;
    readonly automaticPublishingAvailable: false;
    readonly privateMessageContentSentToModels: false;
    readonly humanApprovalRequired: true;
  };
  readonly programs: readonly {
    readonly id: VideoProgramId;
    readonly sourceMode: "audience_signals" | "approved_editorial_content";
    readonly cadence: "weekly" | "daily_evening";
    readonly outputs: readonly ("portrait" | "landscape")[];
    readonly status: "foundation_only";
  }[];
  readonly workflow: readonly {
    readonly stage: VideoWorkflowStage;
    readonly status: "available" | "blocked";
  }[];
  readonly integrations: readonly {
    readonly id: "audience_listening" | "heygen" | "distribution";
    readonly status: "not_connected";
  }[];
  readonly distributionTargets: readonly {
    readonly accountId: string;
    readonly channel: "facebook" | "instagram" | "youtube" | "tiktok";
    readonly displayName: string;
    readonly status:
      | "pending"
      | "active"
      | "degraded"
      | "reauthorization_required"
      | "disabled"
      | "revoked";
    readonly draftEligible: boolean;
  }[];
  readonly briefs: readonly VideoBriefView[];
}

export interface VideoGenerationPolicyView {
  readonly providerId: "heygen";
  readonly dailyCreditLimit: number;
  readonly monthlyCreditLimit: number;
  readonly maximumConcurrency: number;
  readonly billingTimezone: "UTC";
  readonly enabled: boolean;
  readonly dailyReserved: number;
  readonly monthlyReserved: number;
  readonly activeJobs: number;
}

export const videoPrograms = [
  {
    id: "product_faq_ads",
    sourceMode: "audience_signals",
    cadence: "weekly",
    outputs: ["portrait", "landscape"],
    status: "foundation_only",
  },
  {
    id: "daily_news_flash",
    sourceMode: "approved_editorial_content",
    cadence: "daily_evening",
    outputs: ["portrait", "landscape"],
    status: "foundation_only",
  },
] as const satisfies VideoIntelligenceSnapshot["programs"];

export const videoWorkflow = [
  { stage: "signals", status: "available" },
  { stage: "brief", status: "available" },
  { stage: "script", status: "available" },
  { stage: "render", status: "blocked" },
  { stage: "review", status: "available" },
  { stage: "distribution", status: "blocked" },
] as const satisfies VideoIntelligenceSnapshot["workflow"];

const packageName = (planId: string): string => {
  if (planId === "media_starter") return "Media Starter";
  if (planId === "media_team") return "Media Team";
  if (planId === "media_network") return "Media Network";
  return "Custom installation";
};

export class VideoIntelligenceError extends Error {
  public constructor(
    code: string,
    public readonly statusCode: 400 | 403 | 404 | 409,
  ) {
    super(code);
  }
}

export class VideoIntelligenceService {
  public constructor(private readonly pool: DatabasePool) {}

  private async assertAvailable(
    client: DatabaseClient,
    tenantId: string,
    workspaceId?: string,
  ) {
    const result = await client.query<{
      id: string;
      name: string;
      plan_id: string;
    }>(
      `SELECT workspace.id,workspace.name,entitlement.plan_id
       FROM control.business_workspaces workspace
       JOIN control.installation_entitlements entitlement
         ON entitlement.tenant_id=workspace.tenant_id
        AND entitlement.installation_id=workspace.installation_id
       WHERE workspace.tenant_id=$1
         AND workspace.lifecycle_status='active'
         AND workspace.id=coalesce(
           $2::uuid,
           (SELECT candidate.id FROM control.business_workspaces candidate
            WHERE candidate.tenant_id=$1 AND candidate.lifecycle_status='active'
            ORDER BY candidate.created_at,candidate.id LIMIT 1)
         )
         AND entitlement.effective_from<=now()
         AND (entitlement.effective_until IS NULL OR entitlement.effective_until>now())
         AND 'media_intelligence'=ANY(entitlement.enabled_modules)
         AND EXISTS(
           SELECT 1 FROM control.feature_flags feature
           WHERE feature.tenant_id=workspace.tenant_id
             AND feature.name='module.media-intelligence'
             AND feature.enabled
         )`,
      [tenantId, workspaceId ?? null],
    );
    const row = result.rows[0];
    if (!row)
      throw new VideoIntelligenceError("VIDEO_WORKSPACE_NOT_FOUND", 404);
    return row;
  }

  private async command<T extends Record<string, unknown>>(
    client: DatabaseClient,
    input: {
      tenantId: string;
      workspaceId: string;
      actorUserId: string;
      idempotencyKey: string;
      name:
        | "brief.create"
        | "script.revise"
        | "approval.request"
        | "approval.decide"
        | "render.prepare"
        | "render.review.decide";
      request: unknown;
    },
    execute: () => Promise<T>,
  ): Promise<T & { replayed: boolean }> {
    const requestHash = createHash("sha256")
      .update(JSON.stringify(input.request))
      .digest("hex");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,32))",
      [`${input.tenantId}:${input.idempotencyKey}`],
    );
    const existing = await client.query<{
      command_name: string;
      request_hash: string;
      actor_user_id: string;
      response: T;
    }>(
      `SELECT command_name,request_hash,actor_user_id,response
       FROM control.video_command_receipts
       WHERE idempotency_key=$1`,
      [input.idempotencyKey],
    );
    const receipt = existing.rows[0];
    if (receipt) {
      if (
        receipt.command_name !== input.name ||
        receipt.request_hash !== requestHash ||
        receipt.actor_user_id !== input.actorUserId
      )
        throw new VideoIntelligenceError("VIDEO_IDEMPOTENCY_CONFLICT", 409);
      return { ...receipt.response, replayed: true };
    }
    const response = await execute();
    await client.query(
      `INSERT INTO control.video_command_receipts
       (id,tenant_id,workspace_id,idempotency_key,command_name,request_hash,response,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        input.tenantId,
        input.workspaceId,
        input.idempotencyKey,
        input.name,
        requestHash,
        response,
        input.actorUserId,
      ],
    );
    return { ...response, replayed: false };
  }

  private async audit(
    client: DatabaseClient,
    input: {
      tenantId: string;
      actorUserId: string;
      action: string;
      targetType?: "video_brief" | "business_workspace" | "video_render_job";
      targetId: string;
      correlationId: string;
      metadata: Record<string, unknown>;
    },
  ) {
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO control.audit_events
       (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        auditId,
        input.tenantId,
        input.actorUserId,
        input.action,
        input.targetType ?? "video_brief",
        input.targetId,
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
        input.action,
        { auditEventId: auditId, targetId: input.targetId },
        input.correlationId,
      ],
    );
  }

  private async readGenerationPolicy(
    client: DatabaseClient,
    workspaceId: string,
  ): Promise<VideoGenerationPolicyView | null> {
    const result = await client.query<{
      daily_credit_limit: number;
      monthly_credit_limit: number;
      maximum_concurrency: number;
      enabled: boolean;
      daily_reserved: number;
      monthly_reserved: number;
      active_jobs: number;
    }>(
      `SELECT policy.daily_credit_limit,policy.monthly_credit_limit,
         policy.maximum_concurrency,policy.enabled,
         coalesce(sum(job.reserved_credits) FILTER (
           WHERE job.status<>'cancelled'
             AND job.reserved_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         ),0)::int daily_reserved,
         coalesce(sum(job.reserved_credits) FILTER (
           WHERE job.status<>'cancelled'
             AND job.reserved_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         ),0)::int monthly_reserved,
         count(job.id) FILTER (
           WHERE job.status IN ('reserved','submitting','submitted')
         )::int active_jobs
       FROM control.video_generation_policies policy
       LEFT JOIN control.video_render_jobs job
         ON job.workspace_id=policy.workspace_id
        AND job.provider_id=policy.provider_id
       WHERE policy.workspace_id=$1 AND policy.provider_id='heygen'
       GROUP BY policy.id`,
      [workspaceId],
    );
    const row = result.rows[0];
    return row
      ? {
          providerId: "heygen",
          dailyCreditLimit: row.daily_credit_limit,
          monthlyCreditLimit: row.monthly_credit_limit,
          maximumConcurrency: row.maximum_concurrency,
          billingTimezone: "UTC",
          enabled: row.enabled,
          dailyReserved: row.daily_reserved,
          monthlyReserved: row.monthly_reserved,
          activeJobs: row.active_jobs,
        }
      : null;
  }

  public async getGenerationPolicy(input: {
    tenantId: string;
    workspaceId: string;
  }): Promise<VideoGenerationPolicyView | null> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.readGenerationPolicy(client, input.workspaceId);
    });
  }

  public async updateGenerationPolicy(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    dailyCreditLimit: number;
    monthlyCreditLimit: number;
    maximumConcurrency: number;
    enabled: boolean;
    correlationId: string;
  }): Promise<VideoGenerationPolicyView> {
    if (
      !Number.isInteger(input.dailyCreditLimit) ||
      input.dailyCreditLimit < 0 ||
      input.dailyCreditLimit > 1_000_000 ||
      !Number.isInteger(input.monthlyCreditLimit) ||
      input.monthlyCreditLimit < input.dailyCreditLimit ||
      input.monthlyCreditLimit > 10_000_000 ||
      !Number.isInteger(input.maximumConcurrency) ||
      input.maximumConcurrency < 1 ||
      input.maximumConcurrency > 20
    )
      throw new VideoIntelligenceError("VIDEO_GENERATION_POLICY_INVALID", 400);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      await client.query(
        `INSERT INTO control.video_generation_policies
         (id,tenant_id,workspace_id,provider_id,daily_credit_limit,
          monthly_credit_limit,maximum_concurrency,enabled,configured_by)
         VALUES($1,$2,$3,'heygen',$4,$5,$6,$7,$8)
         ON CONFLICT(tenant_id,workspace_id,provider_id) DO UPDATE SET
           daily_credit_limit=EXCLUDED.daily_credit_limit,
           monthly_credit_limit=EXCLUDED.monthly_credit_limit,
           maximum_concurrency=EXCLUDED.maximum_concurrency,
           enabled=EXCLUDED.enabled,configured_by=EXCLUDED.configured_by,
           updated_at=now()`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          input.dailyCreditLimit,
          input.monthlyCreditLimit,
          input.maximumConcurrency,
          input.enabled,
          input.actorUserId,
        ],
      );
      await this.audit(client, {
        ...input,
        action: "video.generation_policy_updated",
        targetType: "business_workspace",
        targetId: input.workspaceId,
        metadata: {
          workspaceId: input.workspaceId,
          providerId: "heygen",
          dailyCreditLimit: input.dailyCreditLimit,
          monthlyCreditLimit: input.monthlyCreditLimit,
          maximumConcurrency: input.maximumConcurrency,
          enabled: input.enabled,
          providerConnected: false,
        },
      });
      return (await this.readGenerationPolicy(client, input.workspaceId))!;
    });
  }

  public async snapshot(input: {
    tenantId: string;
    actorUserId: string;
    workspaceId?: string;
  }): Promise<VideoIntelligenceSnapshot> {
    return withTenant(this.pool, input.tenantId, async (client) => {
      const row = await this.assertAvailable(
        client,
        input.tenantId,
        input.workspaceId,
      );
      const briefs = await client.query<{
        id: string;
        program_id: VideoProgramId;
        topic: string;
        objective: string;
        audience: string;
        status: VideoBriefStatus;
        current_script_revision: number;
        script: string;
        content_hash: string;
        created_at: Date;
        updated_at: Date;
        approval: VideoBriefView["approval"];
        render_preparation: VideoBriefView["renderPreparation"];
        rendered_assets: VideoBriefView["renderedAssets"];
      }>(
        `SELECT brief.id,brief.program_id,brief.topic,brief.objective,brief.audience,
           brief.status,brief.current_script_revision,brief.created_at,brief.updated_at,
           revision.script,revision.content_hash,
           (SELECT jsonb_build_object(
             'decision',approval.decision,
             'requestedAt',approval.requested_at,
             'decidedAt',approval.decided_at,
             'reason',approval.reason,
             'requestedByCurrentUser',approval.requested_by=$2
           ) FROM control.video_script_approvals approval
             WHERE approval.brief_id=brief.id AND approval.revision_id=revision.id
           ) approval
           ,(SELECT jsonb_build_object(
             'id',preparation.id,
             'presentationMode',preparation.presentation_mode,
             'targetLanguage',preparation.target_language,
             'maxDurationSeconds',preparation.max_duration_seconds,
             'rightsReference',preparation.rights_reference,
             'outputs',(
               SELECT coalesce(jsonb_agg(output.aspect_ratio ORDER BY output.position),'[]'::jsonb)
               FROM control.video_render_outputs output
               WHERE output.preparation_id=preparation.id
             ),
             'status',preparation.status,
             'blockCode',preparation.block_code,
             'requestedAt',preparation.created_at,
             'requestedByCurrentUser',preparation.requested_by=$2
           ) FROM control.video_render_preparations preparation
             WHERE preparation.brief_id=brief.id
               AND preparation.revision_id=revision.id
           ) render_preparation
           ,coalesce((SELECT jsonb_agg(jsonb_build_object(
             'jobId',job.id,
             'mediaAssetId',asset.id,
             'aspectRatio',output.aspect_ratio,
             'filename',asset.original_filename,
             'mimeType',object.mime_type,
             'sizeBytes',object.size_bytes,
             'checksumSha256',object.checksum_sha256,
             'width',object.width,
             'height',object.height,
             'durationMs',object.duration_ms,
             'completedAt',job.completed_at,
             'review',jsonb_build_object(
               'decision',review.decision,
               'requestedAt',review.requested_at,
               'decidedAt',review.decided_at,
               'reason',review.reason,
               'requestedByCurrentUser',review.requested_by=$2
             ),
             'distributionDraft',(
               SELECT jsonb_build_object(
                 'id',handoff.social_draft_id,
                 'status',draft.status,
                 'createdAt',handoff.created_at
               )
               FROM control.video_social_distribution_handoffs handoff
               JOIN control.social_drafts draft ON draft.id=handoff.social_draft_id
               WHERE handoff.asset_review_id=review.id
             ),
             'websiteContent',(
               SELECT jsonb_build_object(
                 'id',handoff.content_item_id,
                 'status',item.status,
                 'createdAt',handoff.created_at
               )
               FROM control.video_website_content_handoffs handoff
               JOIN control.content_items item ON item.id=handoff.content_item_id
               WHERE handoff.asset_review_id=review.id
             )
           ) ORDER BY job.completed_at,job.id)
             FROM control.video_render_jobs job
             JOIN control.video_render_preparations render_preparation
               ON render_preparation.id=job.preparation_id
             JOIN control.video_render_outputs output ON output.id=job.output_id
             JOIN control.media_assets asset ON asset.id=job.media_asset_id
             JOIN control.media_objects object
               ON object.asset_id=asset.id AND object.object_kind='original'
             JOIN control.video_render_asset_reviews review
               ON review.render_job_id=job.id AND review.media_asset_id=asset.id
             WHERE render_preparation.brief_id=brief.id
               AND render_preparation.revision_id=revision.id
               AND job.status='succeeded'
           ),'[]'::jsonb) rendered_assets
         FROM control.video_briefs brief
         JOIN control.video_script_revisions revision
           ON revision.brief_id=brief.id
          AND revision.revision_number=brief.current_script_revision
         WHERE brief.workspace_id=$1
         ORDER BY
           CASE brief.status WHEN 'review_required' THEN 0 WHEN 'rejected' THEN 1
             WHEN 'draft' THEN 2 ELSE 3 END,
           brief.updated_at DESC,brief.id DESC
         LIMIT 100`,
        [row.id, input.actorUserId],
      );
      const ids = briefs.rows.map((brief) => brief.id);
      const distributionTargets = await client.query<{
        account_id: string;
        channel: "facebook" | "instagram" | "youtube" | "tiktok";
        display_name: string;
        status: VideoIntelligenceSnapshot["distributionTargets"][number]["status"];
      }>(
        `SELECT account.id AS account_id,
           CASE account.account_type
             WHEN 'facebook_page' THEN 'facebook'
             WHEN 'instagram_account' THEN 'instagram'
             WHEN 'youtube_channel' THEN 'youtube'
             ELSE 'tiktok'
           END AS channel,
           account.display_name,account.status
         FROM control.social_accounts account
         WHERE account.workspace_id=$1
         ORDER BY channel,account.display_name,account.id`,
        [row.id],
      );
      const evidence = ids.length
        ? await client.query<{
            id: string;
            brief_id: string;
            evidence_kind: VideoEvidenceKind;
            title: string;
            source_reference: string;
            summary: string;
            aggregate_count: number | null;
          }>(
            `SELECT id,brief_id,evidence_kind,title,source_reference,summary,aggregate_count
             FROM control.video_brief_evidence
             WHERE brief_id=ANY($1::uuid[])
             ORDER BY brief_id,position`,
            [ids],
          )
        : { rows: [] };
      return {
        workspace: { id: row.id, displayName: row.name },
        package: {
          id: row.plan_id,
          displayName: packageName(row.plan_id),
          planningIncluded: true,
          generationAddOn: "not_configured",
        },
        safety: {
          externalProviderExecutionAvailable: false,
          automaticPublishingAvailable: false,
          privateMessageContentSentToModels: false,
          humanApprovalRequired: true,
        },
        programs: videoPrograms,
        workflow: videoWorkflow,
        integrations: [
          { id: "audience_listening", status: "not_connected" },
          { id: "heygen", status: "not_connected" },
          { id: "distribution", status: "not_connected" },
        ],
        distributionTargets: distributionTargets.rows.map((target) => ({
          accountId: target.account_id,
          channel: target.channel,
          displayName: target.display_name,
          status: target.status,
          draftEligible: [
            "active",
            "degraded",
            "reauthorization_required",
          ].includes(target.status),
        })),
        briefs: briefs.rows.map((brief) => ({
          id: brief.id,
          programId: brief.program_id,
          topic: brief.topic,
          objective: brief.objective,
          audience: brief.audience,
          status: brief.status,
          currentRevision: brief.current_script_revision,
          script: brief.script,
          scriptHash: brief.content_hash,
          createdAt: brief.created_at.toISOString(),
          updatedAt: brief.updated_at.toISOString(),
          evidence: evidence.rows
            .filter((item) => item.brief_id === brief.id)
            .map((item) => ({
              id: item.id,
              kind: item.evidence_kind,
              title: item.title,
              sourceReference: item.source_reference,
              summary: item.summary,
              aggregateCount: item.aggregate_count,
            })),
          approval: brief.approval,
          renderPreparation: brief.render_preparation,
          renderedAssets: brief.rendered_assets,
        })),
      };
    });
  }

  public async createBrief(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    programId: VideoProgramId;
    topic: string;
    objective: string;
    audience: string;
    script: string;
    evidence: readonly VideoEvidenceInput[];
    correlationId: string;
  }) {
    const normalized = {
      programId: input.programId,
      topic: input.topic.trim(),
      objective: input.objective.trim(),
      audience: input.audience.trim(),
      script: input.script.trim(),
      evidence: input.evidence.map((item) => ({
        kind: item.kind,
        title: item.title.trim(),
        sourceReference: item.sourceReference.trim(),
        summary: item.summary.trim(),
        ...(item.aggregateCount === undefined
          ? {}
          : { aggregateCount: item.aggregateCount }),
      })),
    };
    const kinds = new Set(normalized.evidence.map((item) => item.kind));
    if (
      normalized.evidence.some((item) =>
        item.kind === "aggregate_audience_signal"
          ? item.aggregateCount === undefined
          : item.aggregateCount !== undefined,
      ) ||
      (input.programId === "product_faq_ads" &&
        (!kinds.has("aggregate_audience_signal") ||
          !kinds.has("verified_product_fact") ||
          kinds.has("approved_editorial_story"))) ||
      (input.programId === "daily_news_flash" &&
        (kinds.size !== 1 || !kinds.has("approved_editorial_story")))
    )
      throw new VideoIntelligenceError("VIDEO_EVIDENCE_POLICY_VIOLATION", 400);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.command(
        client,
        {
          ...input,
          name: "brief.create",
          request: normalized,
        },
        async () => {
          const briefId = randomUUID();
          const revisionId = randomUUID();
          const contentHash = createHash("sha256")
            .update(normalized.script)
            .digest("hex");
          await client.query(
            `INSERT INTO control.video_briefs
             (id,tenant_id,workspace_id,program_id,topic,objective,audience,
              created_by,updated_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
            [
              briefId,
              input.tenantId,
              input.workspaceId,
              normalized.programId,
              normalized.topic,
              normalized.objective,
              normalized.audience,
              input.actorUserId,
            ],
          );
          for (const [index, item] of normalized.evidence.entries()) {
            const privacyClass =
              item.kind === "aggregate_audience_signal"
                ? "aggregated_internal"
                : item.kind === "verified_product_fact"
                  ? "verified_business_fact"
                  : "approved_editorial";
            await client.query(
              `INSERT INTO control.video_brief_evidence
               (id,tenant_id,workspace_id,brief_id,position,evidence_kind,title,
                source_reference,summary,aggregate_count,privacy_class,created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                randomUUID(),
                input.tenantId,
                input.workspaceId,
                briefId,
                index + 1,
                item.kind,
                item.title,
                item.sourceReference,
                item.summary,
                item.aggregateCount ?? null,
                privacyClass,
                input.actorUserId,
              ],
            );
          }
          await client.query(
            `INSERT INTO control.video_script_revisions
             (id,tenant_id,workspace_id,brief_id,revision_number,script,
              content_hash,created_by)
             VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
            [
              revisionId,
              input.tenantId,
              input.workspaceId,
              briefId,
              normalized.script,
              contentHash,
              input.actorUserId,
            ],
          );
          await this.audit(client, {
            ...input,
            action: "video.brief_created",
            targetId: briefId,
            metadata: {
              workspaceId: input.workspaceId,
              programId: normalized.programId,
              revision: 1,
              evidenceCount: normalized.evidence.length,
              contentHash,
            },
          });
          return { briefId, revision: 1, status: "draft" as const };
        },
      );
    });
  }

  public async reviseScript(input: {
    tenantId: string;
    workspaceId: string;
    briefId: string;
    actorUserId: string;
    idempotencyKey: string;
    expectedRevision: number;
    script: string;
    correlationId: string;
  }) {
    const script = input.script.trim();
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.command(
        client,
        {
          ...input,
          name: "script.revise",
          request: {
            workspaceId: input.workspaceId,
            briefId: input.briefId,
            expectedRevision: input.expectedRevision,
            script,
          },
        },
        async () => {
          const brief = await client.query<{
            current_script_revision: number;
            content_hash: string;
          }>(
            `SELECT brief.current_script_revision,revision.content_hash
             FROM control.video_briefs brief
             JOIN control.video_script_revisions revision
               ON revision.brief_id=brief.id
              AND revision.revision_number=brief.current_script_revision
             WHERE brief.id=$1 AND brief.workspace_id=$2
               AND brief.status<>'review_required'
               AND NOT EXISTS(
                 SELECT 1 FROM control.video_render_preparations preparation
                 JOIN control.video_render_jobs job
                   ON job.preparation_id=preparation.id
                  AND job.status IN ('reserved','submitting','submitted','succeeded')
                 WHERE preparation.brief_id=brief.id
                   AND preparation.revision_id=revision.id
               )
             FOR UPDATE OF brief`,
            [input.briefId, input.workspaceId],
          );
          const currentRow = brief.rows[0];
          if (!currentRow)
            throw new VideoIntelligenceError("VIDEO_BRIEF_NOT_EDITABLE", 409);
          const current = currentRow.current_script_revision;
          if (current !== input.expectedRevision)
            throw new VideoIntelligenceError("VIDEO_REVISION_CONFLICT", 409);
          const revision = current + 1;
          const contentHash = createHash("sha256").update(script).digest("hex");
          if (contentHash === currentRow.content_hash)
            throw new VideoIntelligenceError("VIDEO_SCRIPT_UNCHANGED", 409);
          await client.query(
            `INSERT INTO control.video_script_revisions
             (id,tenant_id,workspace_id,brief_id,revision_number,script,
              content_hash,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              randomUUID(),
              input.tenantId,
              input.workspaceId,
              input.briefId,
              revision,
              script,
              contentHash,
              input.actorUserId,
            ],
          );
          await client.query(
            `UPDATE control.video_briefs SET current_script_revision=$2,
               status='draft',updated_by=$3,updated_at=now()
             WHERE id=$1`,
            [input.briefId, revision, input.actorUserId],
          );
          await this.audit(client, {
            ...input,
            action: "video.script_revised",
            targetId: input.briefId,
            metadata: { workspaceId: input.workspaceId, revision, contentHash },
          });
          return { briefId: input.briefId, revision, status: "draft" as const };
        },
      );
    });
  }

  public async requestApproval(input: {
    tenantId: string;
    workspaceId: string;
    briefId: string;
    actorUserId: string;
    idempotencyKey: string;
    expectedRevision: number;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.command(
        client,
        {
          ...input,
          name: "approval.request",
          request: {
            workspaceId: input.workspaceId,
            briefId: input.briefId,
            expectedRevision: input.expectedRevision,
          },
        },
        async () => {
          const revision = await client.query<{
            id: string;
            content_hash: string;
          }>(
            `SELECT revision.id,revision.content_hash
             FROM control.video_briefs brief
             JOIN control.video_script_revisions revision
               ON revision.brief_id=brief.id
              AND revision.revision_number=brief.current_script_revision
             WHERE brief.id=$1 AND brief.workspace_id=$2
               AND brief.current_script_revision=$3
               AND brief.status='draft'
             FOR UPDATE OF brief`,
            [input.briefId, input.workspaceId, input.expectedRevision],
          );
          const row = revision.rows[0];
          if (!row)
            throw new VideoIntelligenceError(
              "VIDEO_REVIEW_NOT_REQUESTABLE",
              409,
            );
          const approvalId = randomUUID();
          await client.query(
            `INSERT INTO control.video_script_approvals
             (id,tenant_id,workspace_id,brief_id,revision_id,requested_by)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [
              approvalId,
              input.tenantId,
              input.workspaceId,
              input.briefId,
              row.id,
              input.actorUserId,
            ],
          );
          await client.query(
            `UPDATE control.video_briefs SET status='review_required',
               updated_by=$2,updated_at=now() WHERE id=$1`,
            [input.briefId, input.actorUserId],
          );
          await this.audit(client, {
            ...input,
            action: "video.approval_requested",
            targetId: input.briefId,
            metadata: {
              workspaceId: input.workspaceId,
              revision: input.expectedRevision,
              contentHash: row.content_hash,
              approvalId,
            },
          });
          return {
            briefId: input.briefId,
            revision: input.expectedRevision,
            status: "review_required" as const,
          };
        },
      );
    });
  }

  public async decideApproval(input: {
    tenantId: string;
    workspaceId: string;
    briefId: string;
    actorUserId: string;
    idempotencyKey: string;
    expectedRevision: number;
    decision: "approved" | "rejected";
    reason?: string;
    correlationId: string;
  }) {
    const reason = input.reason?.trim() || null;
    if (input.decision === "rejected" && (!reason || reason.length < 10))
      throw new VideoIntelligenceError("VIDEO_REJECTION_REASON_REQUIRED", 400);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.command(
        client,
        {
          ...input,
          name: "approval.decide",
          request: {
            workspaceId: input.workspaceId,
            briefId: input.briefId,
            expectedRevision: input.expectedRevision,
            decision: input.decision,
            reason,
          },
        },
        async () => {
          const approval = await client.query<{
            id: string;
            requested_by: string;
            content_hash: string;
          }>(
            `SELECT approval.id,approval.requested_by,revision.content_hash
             FROM control.video_briefs brief
             JOIN control.video_script_revisions revision
               ON revision.brief_id=brief.id
              AND revision.revision_number=brief.current_script_revision
             JOIN control.video_script_approvals approval
               ON approval.brief_id=brief.id AND approval.revision_id=revision.id
             WHERE brief.id=$1 AND brief.workspace_id=$2
               AND brief.current_script_revision=$3
               AND brief.status='review_required' AND approval.decision='pending'
             FOR UPDATE OF brief,approval`,
            [input.briefId, input.workspaceId, input.expectedRevision],
          );
          const row = approval.rows[0];
          if (!row)
            throw new VideoIntelligenceError("VIDEO_APPROVAL_NOT_PENDING", 409);
          if (row.requested_by === input.actorUserId)
            throw new VideoIntelligenceError("VIDEO_SELF_APPROVAL_DENIED", 409);
          await client.query(
            `UPDATE control.video_script_approvals SET decision=$2,decided_by=$3,
               reason=$4,decided_at=now(),approved_content_hash=CASE
                 WHEN $2='approved' THEN $5 ELSE NULL END
             WHERE id=$1`,
            [
              row.id,
              input.decision,
              input.actorUserId,
              reason,
              row.content_hash,
            ],
          );
          await client.query(
            `UPDATE control.video_briefs SET status=$2,updated_by=$3,
               updated_at=now() WHERE id=$1`,
            [input.briefId, input.decision, input.actorUserId],
          );
          await this.audit(client, {
            ...input,
            action: `video.script_${input.decision}`,
            targetId: input.briefId,
            metadata: {
              workspaceId: input.workspaceId,
              revision: input.expectedRevision,
              contentHash: row.content_hash,
              reason,
            },
          });
          return {
            briefId: input.briefId,
            revision: input.expectedRevision,
            status: input.decision,
          };
        },
      );
    });
  }

  public async decideRenderedAsset(input: {
    tenantId: string;
    workspaceId: string;
    jobId: string;
    mediaAssetId: string;
    actorUserId: string;
    idempotencyKey: string;
    decision: "approved" | "rejected";
    reason?: string;
    correlationId: string;
  }) {
    const reason = input.reason?.trim() || null;
    if (input.decision === "rejected" && (!reason || reason.length < 10))
      throw new VideoIntelligenceError(
        "VIDEO_RENDER_REJECTION_REASON_REQUIRED",
        400,
      );
    if (input.decision === "approved" && reason)
      throw new VideoIntelligenceError("VIDEO_RENDER_REVIEW_INVALID", 400);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.command(
        client,
        {
          ...input,
          name: "render.review.decide",
          request: {
            workspaceId: input.workspaceId,
            jobId: input.jobId,
            mediaAssetId: input.mediaAssetId,
            decision: input.decision,
            reason,
          },
        },
        async () => {
          const review = await client.query<{
            id: string;
            requested_by: string;
            script_content_hash: string;
          }>(
            `SELECT review.id,review.requested_by,review.script_content_hash
             FROM control.video_render_asset_reviews review
             JOIN control.video_render_jobs job
               ON job.id=review.render_job_id
             JOIN control.media_assets asset
               ON asset.id=review.media_asset_id
             WHERE review.workspace_id=$1 AND review.render_job_id=$2
               AND review.media_asset_id=$3 AND review.decision='pending'
               AND job.status='succeeded' AND job.media_asset_id=asset.id
               AND asset.status='ready' AND asset.processing_status='ready'
               AND asset.soft_deleted_at IS NULL
             FOR UPDATE OF review`,
            [input.workspaceId, input.jobId, input.mediaAssetId],
          );
          const row = review.rows[0];
          if (!row)
            throw new VideoIntelligenceError(
              "VIDEO_RENDER_REVIEW_NOT_PENDING",
              409,
            );
          if (row.requested_by === input.actorUserId)
            throw new VideoIntelligenceError(
              "VIDEO_RENDER_SELF_APPROVAL_DENIED",
              409,
            );
          await client.query(
            `UPDATE control.video_render_asset_reviews
             SET decision=$2,decided_by=$3,reason=$4,decided_at=now()
             WHERE id=$1`,
            [row.id, input.decision, input.actorUserId, reason],
          );
          await this.audit(client, {
            ...input,
            action: `video.render_asset_${input.decision}`,
            targetType: "video_render_job",
            targetId: input.jobId,
            metadata: {
              workspaceId: input.workspaceId,
              mediaAssetId: input.mediaAssetId,
              scriptContentHash: row.script_content_hash,
              decision: input.decision,
              reason,
              publicationAuthorized: false,
            },
          });
          return {
            jobId: input.jobId,
            mediaAssetId: input.mediaAssetId,
            decision: input.decision,
            publicationAuthorized: false as const,
          };
        },
      );
    });
  }

  public async prepareRender(input: {
    tenantId: string;
    workspaceId: string;
    briefId: string;
    actorUserId: string;
    idempotencyKey: string;
    expectedRevision: number;
    targetLanguage: VideoTargetLanguage;
    maxDurationSeconds: number;
    rightsReference: string;
    outputs: readonly VideoAspectRatio[];
    correlationId: string;
  }) {
    const rightsReference = input.rightsReference.trim();
    const outputSet = new Set(input.outputs);
    if (
      !["en", "de", "sq"].includes(input.targetLanguage) ||
      rightsReference.length < 3 ||
      rightsReference.length > 500 ||
      !Number.isInteger(input.maxDurationSeconds) ||
      input.outputs.some((output) => !["9:16", "16:9"].includes(output)) ||
      outputSet.size !== input.outputs.length ||
      input.outputs.length < 1 ||
      input.outputs.length > 2
    )
      throw new VideoIntelligenceError("VIDEO_RENDER_OUTPUTS_INVALID", 400);
    return withTenant(this.pool, input.tenantId, async (client) => {
      await this.assertAvailable(client, input.tenantId, input.workspaceId);
      return this.command(
        client,
        {
          ...input,
          name: "render.prepare",
          request: {
            workspaceId: input.workspaceId,
            briefId: input.briefId,
            expectedRevision: input.expectedRevision,
            targetLanguage: input.targetLanguage,
            maxDurationSeconds: input.maxDurationSeconds,
            rightsReference,
            outputs: input.outputs,
          },
        },
        async () => {
          const approved = await client.query<{
            program_id: VideoProgramId;
            revision_id: string;
            approval_id: string;
          }>(
            `SELECT brief.program_id,revision.id revision_id,approval.id approval_id
             FROM control.video_briefs brief
             JOIN control.video_script_revisions revision
               ON revision.brief_id=brief.id
              AND revision.revision_number=brief.current_script_revision
             JOIN control.video_script_approvals approval
               ON approval.brief_id=brief.id AND approval.revision_id=revision.id
             WHERE brief.id=$1 AND brief.workspace_id=$2
               AND brief.current_script_revision=$3 AND brief.status='approved'
               AND approval.decision='approved'
               AND approval.approved_content_hash=revision.content_hash
             FOR UPDATE OF brief`,
            [input.briefId, input.workspaceId, input.expectedRevision],
          );
          const row = approved.rows[0];
          if (!row)
            throw new VideoIntelligenceError(
              "VIDEO_RENDER_REQUIRES_APPROVED_SCRIPT",
              409,
            );
          const validDuration =
            row.program_id === "product_faq_ads"
              ? input.maxDurationSeconds >= 15 && input.maxDurationSeconds <= 90
              : input.maxDurationSeconds >= 30 &&
                input.maxDurationSeconds <= 180;
          if (!validDuration)
            throw new VideoIntelligenceError(
              "VIDEO_RENDER_DURATION_OUT_OF_POLICY",
              400,
            );
          const existing = await client.query(
            `SELECT 1 FROM control.video_render_preparations
             WHERE brief_id=$1 AND revision_id=$2`,
            [input.briefId, row.revision_id],
          );
          if (existing.rowCount)
            throw new VideoIntelligenceError(
              "VIDEO_RENDER_PREPARATION_EXISTS",
              409,
            );
          const preparationId = randomUUID();
          const presentationMode =
            row.program_id === "product_faq_ads"
              ? "presenter_explainer"
              : "news_anchor";
          await client.query(
            `INSERT INTO control.video_render_preparations
             (id,tenant_id,workspace_id,brief_id,revision_id,approval_id,
              presentation_mode,target_language,max_duration_seconds,
              rights_reference,requested_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              preparationId,
              input.tenantId,
              input.workspaceId,
              input.briefId,
              row.revision_id,
              row.approval_id,
              presentationMode,
              input.targetLanguage,
              input.maxDurationSeconds,
              rightsReference,
              input.actorUserId,
            ],
          );
          for (const [index, aspectRatio] of input.outputs.entries())
            await client.query(
              `INSERT INTO control.video_render_outputs
               (id,tenant_id,workspace_id,preparation_id,position,aspect_ratio)
               VALUES($1,$2,$3,$4,$5,$6)`,
              [
                randomUUID(),
                input.tenantId,
                input.workspaceId,
                preparationId,
                index + 1,
                aspectRatio,
              ],
            );
          await this.audit(client, {
            ...input,
            action: "video.render_prepared",
            targetId: input.briefId,
            metadata: {
              workspaceId: input.workspaceId,
              preparationId,
              revision: input.expectedRevision,
              presentationMode,
              targetLanguage: input.targetLanguage,
              maxDurationSeconds: input.maxDurationSeconds,
              outputs: input.outputs,
              blockCode: "provider_not_accepted",
              providerExecutionCreated: false,
            },
          });
          return {
            briefId: input.briefId,
            preparationId,
            revision: input.expectedRevision,
            status: "blocked" as const,
            blockCode: "provider_not_accepted" as const,
            providerExecutionCreated: false as const,
          };
        },
      );
    });
  }
}
