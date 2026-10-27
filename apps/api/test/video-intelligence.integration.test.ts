import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { SessionStore } from "@redi-control/identity";
import {
  LocalTokenSecretProvider,
  SocialPublishingService,
} from "@redi-control/media-social";
import {
  VideoRenderCompletionService,
  VideoRenderJobStateMachine,
  VideoRenderReservationService,
} from "@redi-control/video-intelligence";
import type {
  VideoRenderCompletionError,
  VideoRenderJobStateError,
  VideoRenderReservationError,
} from "@redi-control/video-intelligence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const adminUrl = required("DATABASE_ADMIN_URL");
const runtimeUrl = required("DATABASE_URL");
const authUrl = required("DATABASE_AUTH_URL");
const runtimePassword = required("DATABASE_RUNTIME_PASSWORD");
const authPassword = required("DATABASE_AUTH_PASSWORD");
const admin = createPool(adminUrl, "video-intelligence-admin");
const runtime = createPool(runtimeUrl, "video-intelligence-runtime");
const auth = createPool(authUrl, "video-intelligence-auth");

let seed: SeedResult;
let app: ReturnType<typeof buildApp>;
let session: Awaited<ReturnType<SessionStore["create"]>>;
let nonMfaSession: Awaited<ReturnType<SessionStore["create"]>>;
let approverSession: Awaited<ReturnType<SessionStore["create"]>>;
let approverUser: string;

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  session = await new SessionStore(auth).create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  nonMfaSession = await new SessionStore(auth).create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: false,
  });
  approverUser = randomUUID();
  const approverSubject = `video-approver-${randomUUID()}`;
  await admin.query(
    `INSERT INTO control.users(id,identity_subject,email)
     VALUES($1,$2,$3)`,
    [
      approverUser,
      `local|${approverSubject}`,
      `video-approver-${approverUser}@example.invalid`,
    ],
  );
  await admin.query(
    `INSERT INTO control.memberships(tenant_id,user_id,role)
     VALUES($1,$2,'approver')`,
    [seed.tenantA, approverUser],
  );
  approverSession = await new SessionStore(auth).create({
    provider: "local",
    subject: approverSubject,
    email: `video-approver-${approverUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  app = buildApp({
    database: { runtime, auth },
    cookieSecure: false,
    socialPublishing: new SocialPublishingService(
      runtime,
      new LocalTokenSecretProvider(),
    ),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await Promise.all([admin.end(), runtime.end(), auth.end()]);
});

describe("Video Intelligence foundation", () => {
  it("returns one tenant-derived, fail-closed program snapshot", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/overview?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspace: { id: seed.workspaceA, displayName: "Local Workspace A" },
      package: {
        id: "local_shared",
        displayName: "Custom installation",
        planningIncluded: true,
        generationAddOn: "not_configured",
      },
      safety: {
        externalProviderExecutionAvailable: false,
        automaticPublishingAvailable: false,
        privateMessageContentSentToModels: false,
        humanApprovalRequired: true,
      },
      programs: [
        { id: "product_faq_ads", status: "foundation_only" },
        { id: "daily_news_flash", status: "foundation_only" },
      ],
      integrations: [
        { id: "audience_listening", status: "not_connected" },
        { id: "heygen", status: "not_connected" },
        { id: "distribution", status: "not_connected" },
      ],
      briefs: [],
    });
    expect(response.body).not.toContain(seed.tenantB);
    expect(response.body).not.toContain("secret://");
  });

  it("denies anonymous and cross-tenant workspace reads", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/video-intelligence/overview",
    });
    expect(anonymous.statusCode).toBe(401);

    const hidden = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/overview?workspaceId=${seed.workspaceB}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(hidden.statusCode).toBe(404);

    const override = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/overview?workspaceId=${seed.workspaceA}&tenantId=${seed.tenantB}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(override.statusCode).toBe(400);
  });

  it("persists evidence, immutable revisions and independent exact-content approval", async () => {
    const idempotencyKey = randomUUID();
    const body = {
      workspaceId: seed.workspaceA,
      idempotencyKey,
      programId: "product_faq_ads",
      topic: "How resistant is the product?",
      objective: "Explain the verified resistance limits without exaggeration.",
      audience: "Customers comparing durable products",
      script:
        "Customers ask how resistant this product is. Here is the verified answer based on the approved specification.",
      evidence: [
        {
          kind: "aggregate_audience_signal",
          title: "Repeated resistance question",
          sourceReference: "meta-week-2026-35-aggregate",
          summary:
            "The same resistance question appeared across twelve interactions.",
          aggregateCount: 12,
        },
        {
          kind: "verified_product_fact",
          title: "Approved resistance specification",
          sourceReference: "product-specification-v4",
          summary:
            "The approved specification defines the tested resistance limit.",
        },
      ],
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/video-intelligence/briefs",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      revision: 1,
      status: "draft",
      replayed: false,
    });
    const briefId = created.json<{ briefId: string }>().briefId;

    const replay = await app.inject({
      method: "POST",
      url: "/api/video-intelligence/briefs",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: body,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ briefId, replayed: true });

    const unchanged = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/revisions`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 1,
        script: body.script,
      },
    });
    expect(unchanged.statusCode).toBe(409);
    expect(unchanged.json()).toMatchObject({ error: "VIDEO_SCRIPT_UNCHANGED" });

    const revisedScript =
      "Customers often ask how resistant this product is. This revised script answers only with the approved tested specification.";
    const revised = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/revisions`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 1,
        script: revisedScript,
      },
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.json()).toMatchObject({ revision: 2, status: "draft" });

    const review = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/review`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 2,
      },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json()).toMatchObject({ status: "review_required" });

    const selfApproval = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/decision`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 2,
        decision: "approved",
      },
    });
    expect(selfApproval.statusCode).toBe(409);
    expect(selfApproval.json()).toMatchObject({
      error: "VIDEO_SELF_APPROVAL_DENIED",
    });

    const approval = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/decision`,
      headers: {
        cookie: `redi_session=${approverSession.token}`,
        "x-csrf-token": approverSession.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 2,
        decision: "approved",
      },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json()).toMatchObject({ status: "approved" });

    const renderIdempotencyKey = randomUUID();
    const renderPayload = {
      workspaceId: seed.workspaceA,
      idempotencyKey: renderIdempotencyKey,
      expectedRevision: 2,
      targetLanguage: "sq",
      maxDurationSeconds: 60,
      rightsReference: "rights/product-presenter/default-v1",
      outputs: ["9:16", "16:9"],
    };
    const prepared = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/render-preparations`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: renderPayload,
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json()).toMatchObject({
      revision: 2,
      status: "blocked",
      blockCode: "provider_not_accepted",
      providerExecutionCreated: false,
      replayed: false,
    });
    const renderReplay = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/render-preparations`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: renderPayload,
    });
    expect(renderReplay.statusCode).toBe(201);
    expect(renderReplay.json()).toMatchObject({
      preparationId: prepared.json<{ preparationId: string }>().preparationId,
      replayed: true,
    });

    const snapshot = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/overview?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json<{ briefs: unknown[] }>().briefs[0]).toMatchObject({
      id: briefId,
      status: "approved",
      currentRevision: 2,
      script: revisedScript,
      approval: { decision: "approved" },
      renderPreparation: {
        presentationMode: "presenter_explainer",
        targetLanguage: "sq",
        maxDurationSeconds: 60,
        rightsReference: "rights/product-presenter/default-v1",
        outputs: ["9:16", "16:9"],
        status: "blocked",
        blockCode: "provider_not_accepted",
      },
      evidence: [
        { kind: "aggregate_audience_signal", aggregateCount: 12 },
        { kind: "verified_product_fact", aggregateCount: null },
      ],
    });
    expect(snapshot.body).not.toContain(seed.tenantA);

    const executableJobs = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.jobs
       WHERE tenant_id=$1 AND job_type LIKE 'video.%'`,
      [seed.tenantA],
    );
    expect(executableJobs.rows[0]?.count).toBe(0);

    const preparationId = prepared.json<{ preparationId: string }>()
      .preparationId;
    const reservationInput = {
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      preparationId,
      reservationKey: randomUUID(),
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
      estimatedCreditsPerOutput: 1,
    };
    await expect(
      new VideoRenderReservationService(runtime).reserve(reservationInput),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_RESERVATION_NOT_ACCEPTED",
    });
    const noPolicy = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/generation-policy?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(noPolicy.statusCode).toBe(200);
    expect(noPolicy.json()).toEqual({ policy: null });
    const policyWithoutMfa = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/generation-policy?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${nonMfaSession.token}` },
    });
    expect(policyWithoutMfa.statusCode).toBe(403);
    const policyWithoutCsrf = await app.inject({
      method: "PUT",
      url: "/api/video-intelligence/generation-policy",
      headers: { cookie: `redi_session=${session.token}` },
      payload: {
        workspaceId: seed.workspaceA,
        dailyCreditLimit: 1,
        monthlyCreditLimit: 1,
        maximumConcurrency: 4,
        enabled: true,
      },
    });
    expect(policyWithoutCsrf.statusCode).toBe(403);
    const invalidPolicy = await app.inject({
      method: "PUT",
      url: "/api/video-intelligence/generation-policy",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        dailyCreditLimit: 2,
        monthlyCreditLimit: 1,
        maximumConcurrency: 4,
        enabled: true,
      },
    });
    expect(invalidPolicy.statusCode).toBe(400);
    const configuredPolicy = await app.inject({
      method: "PUT",
      url: "/api/video-intelligence/generation-policy",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        dailyCreditLimit: 1,
        monthlyCreditLimit: 1,
        maximumConcurrency: 4,
        enabled: true,
      },
    });
    expect(configuredPolicy.statusCode).toBe(200);
    expect(configuredPolicy.json()).toMatchObject({
      policy: {
        providerId: "heygen",
        dailyCreditLimit: 1,
        monthlyCreditLimit: 1,
        maximumConcurrency: 4,
        billingTimezone: "UTC",
        enabled: true,
        dailyReserved: 0,
        monthlyReserved: 0,
        activeJobs: 0,
      },
    });
    const reservations = new VideoRenderReservationService(runtime, true);
    await expect(
      reservations.reserve({
        ...reservationInput,
        reservationKey: randomUUID(),
        actorUserId: seed.analystUser,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_RESERVATION_ACTOR_NOT_ELIGIBLE",
    });
    await expect(reservations.reserve(reservationInput)).rejects.toMatchObject({
      code: "VIDEO_GENERATION_DAILY_BUDGET_EXCEEDED",
    });
    const expandedPolicy = await app.inject({
      method: "PUT",
      url: "/api/video-intelligence/generation-policy",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        dailyCreditLimit: 2,
        monthlyCreditLimit: 2,
        maximumConcurrency: 4,
        enabled: true,
      },
    });
    expect(expandedPolicy.statusCode).toBe(200);
    const reservation = await reservations.reserve(reservationInput);
    expect(reservation).toMatchObject({
      preparationId,
      reservedCredits: 2,
      providerExecutionCreated: false,
      replayed: false,
    });
    expect(reservation.jobs).toHaveLength(2);
    expect(new Set(reservation.jobs.map((job) => job.aspectRatio))).toEqual(
      new Set(["9:16", "16:9"]),
    );
    const replayedReservation = await reservations.reserve(reservationInput);
    expect(replayedReservation).toMatchObject({
      reservedCredits: 2,
      replayed: true,
      jobs: reservation.jobs,
    });
    await expect(
      reservations.reserve({
        ...reservationInput,
        actorUserId: approverUser,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_RESERVATION_CONFLICT",
    } satisfies Partial<VideoRenderReservationError>);
    await expect(
      reservations.reserve({
        ...reservationInput,
        reservationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_RESERVATION_CONFLICT",
    });
    const reservationRows = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.video_render_jobs
       WHERE tenant_id=$1 AND preparation_id=$2`,
      [seed.tenantA, preparationId],
    );
    expect(reservationRows.rows[0]?.count).toBe(2);
    const usageRows = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.video_generation_usage_events
       WHERE tenant_id=$1`,
      [seed.tenantA],
    );
    expect(usageRows.rows[0]?.count).toBe(2);
    await expect(
      admin.query(
        `UPDATE control.video_generation_usage_events SET credits=0
         WHERE tenant_id=$1`,
        [seed.tenantA],
      ),
    ).rejects.toThrow(/IMMUTABLE/);
    const stillNoGenericJobs = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.jobs
       WHERE tenant_id=$1 AND job_type LIKE 'video.%'`,
      [seed.tenantA],
    );
    expect(stillNoGenericJobs.rows[0]?.count).toBe(0);
    const crossTenantRows = await withTenant(
      runtime,
      seed.tenantB,
      async (client) =>
        client.query("SELECT id FROM control.video_render_jobs WHERE id=$1", [
          reservation.jobs[0]?.jobId,
        ]),
    );
    expect(crossTenantRows.rowCount).toBe(0);

    await expect(
      new VideoRenderJobStateMachine(runtime).claim({
        tenantId: seed.tenantA,
        workerId: "video-test-worker",
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_SUBMISSION_NOT_ACCEPTED",
    } satisfies Partial<VideoRenderJobStateError>);
    const stateMachine = new VideoRenderJobStateMachine(runtime, true);
    const claimed = await stateMachine.claim({
      tenantId: seed.tenantA,
      workerId: "video-test-worker",
      leaseSeconds: 60,
    });
    expect(claimed).toMatchObject({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      preparationId,
      providerId: "heygen",
      topic: body.topic,
      script: revisedScript,
      targetLanguage: "sq",
      attemptCount: 1,
      maxAttempts: 5,
    });
    expect(
      reservation.jobs.some(
        (job) =>
          job.jobId === claimed?.id &&
          job.providerIdempotencyKey === claimed.providerIdempotencyKey &&
          job.aspectRatio === claimed.aspectRatio,
      ),
    ).toBe(true);
    await expect(
      stateMachine.markSubmitted({
        tenantId: seed.tenantA,
        jobId: claimed?.id ?? randomUUID(),
        workerId: "wrong-video-worker",
        providerRequestId: "sandbox-video-test-1",
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_JOB_NOT_SUBMITTABLE",
    } satisfies Partial<VideoRenderJobStateError>);
    await expect(
      stateMachine.markSubmitted({
        tenantId: seed.tenantA,
        jobId: claimed?.id ?? randomUUID(),
        workerId: "video-test-worker",
        providerRequestId: "sandbox-video-test-1",
      }),
    ).resolves.toMatchObject({ status: "submitted" });
    if (!claimed) throw new Error("Expected one claimed video job");

    const completionInput = {
      tenantId: seed.tenantA,
      jobId: claimed.id,
      mediaAssetId: randomUUID(),
      actualCredits: 1,
    };
    await expect(
      new VideoRenderCompletionService(runtime).attachVerifiedAsset(
        completionInput,
      ),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_COMPLETION_NOT_ACCEPTED",
    } satisfies Partial<VideoRenderCompletionError>);
    await expect(
      admin.query(
        `UPDATE control.video_render_jobs
         SET status='succeeded',actual_credits=1,completed_at=now()
         WHERE id=$1`,
        [claimed.id],
      ),
    ).rejects.toThrow(/video_render_jobs_completion_asset_check/);
    await expect(
      new VideoRenderCompletionService(runtime, true).attachVerifiedAsset({
        ...completionInput,
        mediaAssetId: randomUUID(),
        actualCredits: 2,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_COMPLETION_CREDIT_OVERAGE",
    } satisfies Partial<VideoRenderCompletionError>);

    const unverifiedAssetId = randomUUID();
    await admin.query(
      `INSERT INTO control.media_assets
       (id,tenant_id,workspace_id,created_by,source,original_filename,
        status,processing_status)
       VALUES($1,$2,$3,$4,'user_upload','unverified-output.mp4',
        'ready','ready')`,
      [unverifiedAssetId, seed.tenantA, seed.workspaceA, seed.adminUser],
    );
    await admin.query(
      `INSERT INTO control.media_objects
       (id,tenant_id,asset_id,object_kind,object_key,mime_type,size_bytes,
        checksum_sha256,width,height,duration_ms)
       VALUES($1,$2,$3,'original',$4,'video/mp4',1024,$5,1080,1920,30000)`,
      [
        randomUUID(),
        seed.tenantA,
        unverifiedAssetId,
        `tenant/${seed.tenantA}/media/${unverifiedAssetId}/original.mp4`,
        "a".repeat(64),
      ],
    );
    const completion = new VideoRenderCompletionService(runtime, true);
    await expect(
      completion.attachVerifiedAsset({
        ...completionInput,
        tenantId: seed.tenantB,
        mediaAssetId: unverifiedAssetId,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_COMPLETION_NOT_ATTACHABLE",
    } satisfies Partial<VideoRenderCompletionError>);
    await expect(
      completion.attachVerifiedAsset({
        ...completionInput,
        mediaAssetId: unverifiedAssetId,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_COMPLETION_ASSET_NOT_VERIFIED",
    } satisfies Partial<VideoRenderCompletionError>);

    const verifiedAssetId = randomUUID();
    const dimensions =
      claimed.aspectRatio === "9:16"
        ? { width: 1080, height: 1920 }
        : { width: 1920, height: 1080 };
    await admin.query(
      `INSERT INTO control.media_assets
       (id,tenant_id,workspace_id,created_by,source,original_filename,
        status,processing_status)
       VALUES($1,$2,$3,$4,'generated_provider',$5,'ready','ready')`,
      [
        verifiedAssetId,
        seed.tenantA,
        seed.workspaceA,
        seed.adminUser,
        `heygen-${claimed.id}.mp4`,
      ],
    );
    await admin.query(
      `INSERT INTO control.media_objects
       (id,tenant_id,asset_id,object_kind,object_key,mime_type,size_bytes,
        checksum_sha256,width,height,duration_ms)
       VALUES($1,$2,$3,'original',$4,'video/mp4',2048,$5,$6,$7,30000)`,
      [
        randomUUID(),
        seed.tenantA,
        verifiedAssetId,
        `tenant/${seed.tenantA}/media/${verifiedAssetId}/original.mp4`,
        "b".repeat(64),
        dimensions.width,
        dimensions.height,
      ],
    );
    await expect(
      completion.attachVerifiedAsset({
        ...completionInput,
        mediaAssetId: verifiedAssetId,
      }),
    ).resolves.toEqual({
      jobId: claimed.id,
      mediaAssetId: verifiedAssetId,
      status: "succeeded",
      replayed: false,
    });
    await expect(
      completion.attachVerifiedAsset({
        ...completionInput,
        mediaAssetId: verifiedAssetId,
      }),
    ).resolves.toMatchObject({ status: "succeeded", replayed: true });
    await expect(
      completion.attachVerifiedAsset({
        ...completionInput,
        mediaAssetId: verifiedAssetId,
        actualCredits: 0,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_RENDER_COMPLETION_CONFLICT",
    } satisfies Partial<VideoRenderCompletionError>);
    const renderedSnapshot = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/overview?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(renderedSnapshot.statusCode).toBe(200);
    const renderedAssets = renderedSnapshot
      .json<{ briefs: { renderedAssets: unknown[] }[] }>()
      .briefs.find((item) => item.renderedAssets.length)?.renderedAssets;
    expect(renderedAssets).toHaveLength(1);
    expect(renderedAssets?.[0]).toMatchObject({
      jobId: claimed.id,
      mediaAssetId: verifiedAssetId,
      aspectRatio: claimed.aspectRatio,
      filename: `heygen-${claimed.id}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 2048,
      checksumSha256: "b".repeat(64),
      width: dimensions.width,
      height: dimensions.height,
      durationMs: 30000,
      review: {
        decision: "pending",
        requestedByCurrentUser: true,
      },
      distributionDraft: null,
      websiteContent: null,
    });
    const distributionAccountId = randomUUID();
    await admin.query(
      `INSERT INTO control.social_accounts
       (id,tenant_id,workspace_id,provider,account_type,provider_account_id,
        display_name,authorized_scopes,token_reference,status)
       VALUES($1,$2,$3,'meta','instagram_account',$4,$5,
        ARRAY['instagram.content-publish'],$6,'active')`,
      [
        distributionAccountId,
        seed.tenantA,
        seed.workspaceA,
        `video-distribution-${distributionAccountId}`,
        "AuroraMedia Instagram",
        `secret://social/${distributionAccountId}`,
      ],
    );
    const distributionPayload = {
      workspaceId: seed.workspaceA,
      mediaAssetId: verifiedAssetId,
      accountIds: [distributionAccountId],
      idempotencyKey: randomUUID(),
      title: "Verified resistance explainer",
      caption: "A verified answer prepared for independent social review.",
      description: "Exact approved video distribution handoff.",
    };
    const distributionBeforeApproval = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/distribution-draft`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: distributionPayload,
    });
    expect(distributionBeforeApproval.statusCode).toBe(409);
    expect(distributionBeforeApproval.json()).toMatchObject({
      error: "VIDEO_ASSET_NOT_APPROVED_FOR_DISTRIBUTION",
    });
    const websitePayload = {
      workspaceId: seed.workspaceA,
      mediaAssetId: verifiedAssetId,
      idempotencyKey: randomUUID(),
      title: "Verified resistance explainer",
      summary: "Exact approved video prepared for the website editorial queue.",
    };
    const websiteBeforeApproval = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/website-content`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: websitePayload,
    });
    expect(websiteBeforeApproval.statusCode).toBe(409);
    expect(websiteBeforeApproval.json()).toMatchObject({
      error: "VIDEO_ASSET_NOT_APPROVED_FOR_WEBSITE_CONTENT",
    });
    const renderDecisionPayload = {
      workspaceId: seed.workspaceA,
      mediaAssetId: verifiedAssetId,
      idempotencyKey: randomUUID(),
      decision: "approved",
    };
    const renderDecisionWithoutMfa = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/review-decision`,
      headers: {
        cookie: `redi_session=${nonMfaSession.token}`,
        "x-csrf-token": nonMfaSession.csrfToken,
      },
      payload: renderDecisionPayload,
    });
    expect(renderDecisionWithoutMfa.statusCode).toBe(403);
    const renderDecisionTenantOverride = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/review-decision`,
      headers: {
        cookie: `redi_session=${approverSession.token}`,
        "x-csrf-token": approverSession.csrfToken,
      },
      payload: { ...renderDecisionPayload, tenantId: seed.tenantB },
    });
    expect(renderDecisionTenantOverride.statusCode).toBe(400);
    const renderSelfApproval = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/review-decision`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: renderDecisionPayload,
    });
    expect(renderSelfApproval.statusCode).toBe(409);
    expect(renderSelfApproval.json()).toMatchObject({
      error: "VIDEO_RENDER_SELF_APPROVAL_DENIED",
    });
    const renderApproval = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/review-decision`,
      headers: {
        cookie: `redi_session=${approverSession.token}`,
        "x-csrf-token": approverSession.csrfToken,
      },
      payload: renderDecisionPayload,
    });
    expect(renderApproval.statusCode).toBe(200);
    expect(renderApproval.json()).toEqual({
      jobId: claimed.id,
      mediaAssetId: verifiedAssetId,
      decision: "approved",
      publicationAuthorized: false,
      replayed: false,
    });
    const renderApprovalReplay = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/review-decision`,
      headers: {
        cookie: `redi_session=${approverSession.token}`,
        "x-csrf-token": approverSession.csrfToken,
      },
      payload: renderDecisionPayload,
    });
    expect(renderApprovalReplay.statusCode).toBe(200);
    expect(renderApprovalReplay.json()).toMatchObject({ replayed: true });
    const websiteTenantOverride = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/website-content`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: { ...websitePayload, tenantId: seed.tenantB },
    });
    expect(websiteTenantOverride.statusCode).toBe(400);
    const websiteContent = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/website-content`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: websitePayload,
    });
    expect(websiteContent.statusCode).toBe(201);
    expect(websiteContent.json()).toMatchObject({
      status: "draft",
      replayed: false,
      websiteVariantCreated: false,
      publicationAuthorized: false,
    });
    const contentItemId = websiteContent.json<{ contentItemId: string }>()
      .contentItemId;
    const websiteReplay = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/website-content`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: websitePayload,
    });
    expect(websiteReplay.statusCode).toBe(201);
    expect(websiteReplay.json()).toEqual({
      contentItemId,
      status: "draft",
      replayed: true,
      websiteVariantCreated: false,
      publicationAuthorized: false,
    });
    const secondWebsiteContent = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/website-content`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: { ...websitePayload, idempotencyKey: randomUUID() },
    });
    expect(secondWebsiteContent.statusCode).toBe(409);
    expect(secondWebsiteContent.json()).toMatchObject({
      error: "VIDEO_WEBSITE_CONTENT_ALREADY_PREPARED",
    });
    const websitePreflight = await app.inject({
      method: "GET",
      url: `/api/content-items/${contentItemId}/website-preflight`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(websitePreflight.statusCode).toBe(200);
    const websitePreflightBody = websitePreflight.json<{
      preflight: {
        checks: Array<{ code: string; severity: string }>;
      };
    }>();
    expect(websitePreflightBody).toMatchObject({
      preflight: {
        itemId: contentItemId,
        workspaceId: seed.workspaceA,
        status: "blocked",
        createsVariant: false,
        callsConnector: false,
        publicationAuthorized: false,
      },
    });
    expect(websitePreflightBody.preflight.checks).toEqual(
      expect.arrayContaining([
        {
          code: "WEBSITE_VIDEO_DELIVERY_UNAVAILABLE",
          severity: "blocker",
        },
      ]),
    );
    const websiteEvidence = await admin.query<{
      items: number;
      media: number;
      variants: number;
      handoffs: number;
      references: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM control.content_items
          WHERE tenant_id=$1 AND id=$2 AND status='draft') items,
         (SELECT count(*)::int FROM control.content_item_media
          WHERE tenant_id=$1 AND content_item_id=$2 AND asset_id=$3) media,
         (SELECT count(*)::int FROM control.content_item_variants
          WHERE tenant_id=$1 AND content_item_id=$2) variants,
         (SELECT count(*)::int FROM control.video_website_content_handoffs
          WHERE tenant_id=$1 AND content_item_id=$2 AND render_job_id=$4
            AND media_asset_id=$3) handoffs,
         (SELECT count(*)::int FROM control.media_usage_references
          WHERE tenant_id=$1 AND asset_id=$3 AND usage_type='content_item'
            AND usage_reference=$2::text) references`,
      [seed.tenantA, contentItemId, verifiedAssetId, claimed.id],
    );
    expect(websiteEvidence.rows[0]).toEqual({
      items: 1,
      media: 1,
      variants: 0,
      handoffs: 1,
      references: 1,
    });
    await expect(
      admin.query(
        `UPDATE control.video_website_content_handoffs
            SET media_asset_id=$2 WHERE tenant_id=$1 AND content_item_id=$3`,
        [seed.tenantA, unverifiedAssetId, contentItemId],
      ),
    ).rejects.toThrow(/IMMUTABLE_VIDEO_WEBSITE_CONTENT_HANDOFF/);
    const distributionTenantOverride = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/distribution-draft`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: { ...distributionPayload, tenantId: seed.tenantB },
    });
    expect(distributionTenantOverride.statusCode).toBe(400);
    const wrongAssetDistribution = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/distribution-draft`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        ...distributionPayload,
        mediaAssetId: unverifiedAssetId,
        idempotencyKey: randomUUID(),
      },
    });
    expect(wrongAssetDistribution.statusCode).toBe(409);
    const distribution = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/distribution-draft`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: distributionPayload,
    });
    expect(distribution.statusCode).toBe(201);
    expect(distribution.json()).toMatchObject({
      status: "draft",
      replayed: false,
    });
    const socialDraftId = distribution.json<{ draftId: string }>().draftId;
    const distributionReplay = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/distribution-draft`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: distributionPayload,
    });
    expect(distributionReplay.statusCode).toBe(201);
    expect(distributionReplay.json()).toEqual({
      draftId: socialDraftId,
      status: "draft",
      replayed: true,
    });
    const secondDistribution = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/render-jobs/${claimed.id}/distribution-draft`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: { ...distributionPayload, idempotencyKey: randomUUID() },
    });
    expect(secondDistribution.statusCode).toBe(409);
    expect(secondDistribution.json()).toMatchObject({
      error: "VIDEO_DISTRIBUTION_ALREADY_PREPARED",
    });
    const distributionEvidence = await admin.query<{
      drafts: number;
      approvals: number;
      jobs: number;
      handoffs: number;
      references: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM control.social_drafts
          WHERE tenant_id=$1 AND id=$2 AND status='draft') drafts,
         (SELECT count(*)::int FROM control.social_approvals
          WHERE tenant_id=$1 AND draft_id=$2) approvals,
         (SELECT count(*)::int FROM control.jobs
          WHERE tenant_id=$1 AND payload->>'draftId'=$2::text) jobs,
         (SELECT count(*)::int FROM control.video_social_distribution_handoffs
          WHERE tenant_id=$1 AND social_draft_id=$2 AND render_job_id=$3
            AND media_asset_id=$4) handoffs,
         (SELECT count(*)::int FROM control.media_usage_references
          WHERE tenant_id=$1 AND asset_id=$4 AND usage_type='social_draft'
            AND usage_reference=$2::text) references`,
      [seed.tenantA, socialDraftId, claimed.id, verifiedAssetId],
    );
    expect(distributionEvidence.rows[0]).toEqual({
      drafts: 1,
      approvals: 0,
      jobs: 0,
      handoffs: 1,
      references: 1,
    });
    await expect(
      admin.query(
        `UPDATE control.video_social_distribution_handoffs
         SET media_asset_id=$2 WHERE tenant_id=$1 AND social_draft_id=$3`,
        [seed.tenantA, unverifiedAssetId, socialDraftId],
      ),
    ).rejects.toThrow(/IMMUTABLE_VIDEO_SOCIAL_DISTRIBUTION_HANDOFF/);
    const distributionSnapshot = await app.inject({
      method: "GET",
      url: `/api/video-intelligence/overview?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${session.token}` },
    });
    expect(distributionSnapshot.statusCode).toBe(200);
    expect(distributionSnapshot.json()).toMatchObject({
      distributionTargets: [
        {
          accountId: distributionAccountId,
          channel: "instagram",
          displayName: "AuroraMedia Instagram",
          status: "active",
          draftEligible: true,
        },
      ],
    });
    expect(
      distributionSnapshot
        .json<{
          briefs: {
            renderedAssets: {
              jobId: string;
              distributionDraft: unknown;
              websiteContent: unknown;
            }[];
          }[];
        }>()
        .briefs.flatMap((brief) => brief.renderedAssets)
        .find((asset) => asset.jobId === claimed.id)?.distributionDraft,
    ).toMatchObject({ id: socialDraftId, status: "draft" });
    expect(
      distributionSnapshot
        .json<{
          briefs: {
            renderedAssets: {
              jobId: string;
              websiteContent: unknown;
            }[];
          }[];
        }>()
        .briefs.flatMap((brief) => brief.renderedAssets)
        .find((asset) => asset.jobId === claimed.id)?.websiteContent,
    ).toMatchObject({ id: contentItemId, status: "draft" });
    await expect(
      admin.query(
        `UPDATE control.video_render_asset_reviews SET media_asset_id=$2
         WHERE tenant_id=$1 AND render_job_id=$3`,
        [seed.tenantA, unverifiedAssetId, claimed.id],
      ),
    ).rejects.toThrow(/IMMUTABLE_VIDEO_RENDER_ASSET_REVIEW/);
    const completionEvidence = await admin.query<{
      reconciled: number;
      references: number;
      reviews: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM control.video_generation_usage_events
          WHERE tenant_id=$1 AND render_job_id=$2
            AND event_type='reconciled') reconciled,
         (SELECT count(*)::int FROM control.media_usage_references
          WHERE tenant_id=$1 AND asset_id=$3 AND usage_type='video_render'
            AND usage_reference=$2::text) references,
         (SELECT count(*)::int FROM control.video_render_asset_reviews
          WHERE tenant_id=$1 AND render_job_id=$2
            AND media_asset_id=$3 AND decision='approved') reviews`,
      [seed.tenantA, claimed.id, verifiedAssetId],
    );
    expect(completionEvidence.rows[0]).toEqual({
      reconciled: 1,
      references: 1,
      reviews: 1,
    });
    await expect(
      admin.query(
        `UPDATE control.video_generation_usage_events SET credits=0
         WHERE tenant_id=$1 AND render_job_id=$2 AND event_type='reconciled'`,
        [seed.tenantA, claimed.id],
      ),
    ).rejects.toThrow(/IMMUTABLE/);

    const secondClaim = await stateMachine.claim({
      tenantId: seed.tenantA,
      workerId: "video-test-worker",
      leaseSeconds: 60,
    });
    expect(secondClaim?.attemptCount).toBe(1);
    await admin.query(
      `UPDATE control.video_render_jobs
       SET max_attempts=1,lease_expires_at=now()-interval '1 second'
       WHERE id=$1`,
      [secondClaim?.id],
    );
    await expect(
      stateMachine.claim({
        tenantId: seed.tenantA,
        workerId: "video-test-worker",
      }),
    ).resolves.toBeNull();
    const terminalRows = await admin.query<{
      status: string;
      safe_failure_code: string;
      locked_by: string | null;
    }>(
      `SELECT status,safe_failure_code,locked_by
       FROM control.video_render_jobs WHERE id=$1`,
      [secondClaim?.id],
    );
    expect(terminalRows.rows[0]).toEqual({
      status: "failed",
      safe_failure_code: "VIDEO_SUBMISSION_LEASE_EXHAUSTED",
      locked_by: null,
    });
    const transitionEvidence = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.audit_events
       WHERE tenant_id=$1 AND target_type='video_render_job'
         AND action IN ('video.render_claimed','video.render_submitted',
           'video.render_lease_exhausted')`,
      [seed.tenantA],
    );
    expect(transitionEvidence.rows[0]?.count).toBe(4);

    const revisionAfterReservation = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${briefId}/revisions`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 2,
        script:
          "A reserved exact render must block this otherwise valid replacement script.",
      },
    });
    expect(revisionAfterReservation.statusCode).toBe(409);
    expect(revisionAfterReservation.json()).toMatchObject({
      error: "VIDEO_BRIEF_NOT_EDITABLE",
    });

    await expect(
      admin.query(
        "UPDATE control.video_script_revisions SET script='tampered' WHERE brief_id=$1",
        [briefId],
      ),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      admin.query(
        "UPDATE control.video_render_preparations SET status='blocked' WHERE brief_id=$1",
        [briefId],
      ),
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it("fails closed on missing CSRF and invalid evidence boundaries", async () => {
    const newsBody = {
      workspaceId: seed.workspaceA,
      idempotencyKey: randomUUID(),
      programId: "daily_news_flash",
      topic: "Daily report",
      objective: "Prepare one approved daily newsroom report.",
      audience: "News audience",
      script: "This is an editorial script with enough content for validation.",
      evidence: [
        {
          kind: "approved_editorial_story",
          title: "Approved newsroom story",
          sourceReference: "editorial-story-1",
          summary: "This story has already completed editorial approval.",
        },
      ],
    };
    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/video-intelligence/briefs",
      headers: { cookie: `redi_session=${session.token}` },
      payload: newsBody,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const draft = await app.inject({
      method: "POST",
      url: "/api/video-intelligence/briefs",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: newsBody,
    });
    expect(draft.statusCode).toBe(201);
    const unapprovedRender = await app.inject({
      method: "POST",
      url: `/api/video-intelligence/briefs/${draft.json<{ briefId: string }>().briefId}/render-preparations`,
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        expectedRevision: 1,
        targetLanguage: "sq",
        maxDurationSeconds: 90,
        rightsReference: "rights/news-anchor/default-v1",
        outputs: ["9:16"],
      },
    });
    expect(unapprovedRender.statusCode).toBe(409);
    expect(unapprovedRender.json()).toMatchObject({
      error: "VIDEO_RENDER_REQUIRES_APPROVED_SCRIPT",
    });

    const invalidEvidence = await app.inject({
      method: "POST",
      url: "/api/video-intelligence/briefs",
      headers: {
        cookie: `redi_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        idempotencyKey: randomUUID(),
        programId: "daily_news_flash",
        topic: "Daily report",
        objective: "Prepare an approved daily newsroom report.",
        audience: "News audience",
        script:
          "This is an editorial script with enough content for validation.",
        evidence: [
          {
            kind: "aggregate_audience_signal",
            title: "Private messages",
            sourceReference: "raw-message-export",
            summary:
              "Raw private messages must never be accepted for news scripts.",
          },
        ],
      },
    });
    expect(invalidEvidence.statusCode).toBe(400);
    expect(invalidEvidence.json()).toMatchObject({
      error: "VIDEO_EVIDENCE_POLICY_VIOLATION",
    });
  });
});
