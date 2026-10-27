import { randomUUID } from "node:crypto";

import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  type SeedResult,
} from "@redi-control/database";
import { SessionStore } from "@redi-control/identity";
import {
  LocalTokenSecretProvider,
  SocialPublishingService,
} from "@redi-control/media-social";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

const adminUrl = required("DATABASE_ADMIN_URL");
const runtimeUrl = required("DATABASE_URL");
const authUrl = required("DATABASE_AUTH_URL");
const runtimePassword = required("DATABASE_RUNTIME_PASSWORD");
const authPassword = required("DATABASE_AUTH_PASSWORD");
const admin = createPool(adminUrl, "redi-control-social-studio-admin");
const runtime = createPool(runtimeUrl, "redi-control-social-studio-runtime");
const auth = createPool(authUrl, "redi-control-social-studio-auth");
let seed: SeedResult;
let draftId: string;
let currentTargetId: string;

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  const accountId = randomUUID();
  draftId = randomUUID();
  const firstRevisionId = randomUUID();
  const currentRevisionId = randomUUID();
  currentTargetId = randomUUID();
  await admin.query(
    "INSERT INTO control.memberships (tenant_id,user_id,role) VALUES ($1,$2,'approver')",
    [seed.tenantA, seed.analystUser],
  );
  await admin.query(
    `INSERT INTO control.social_accounts
     (id,tenant_id,workspace_id,provider,account_type,provider_account_id,
      display_name,authorized_scopes,token_reference,status,health_status)
     VALUES ($1,$2,$3,'meta','facebook_page','provider-page-sensitive',
      'Editorial Page',ARRAY['pages.show-list'],'secret://social/meta/test',
      'active','healthy')`,
    [accountId, seed.tenantA, seed.workspaceA],
  );
  await admin.query(
    `INSERT INTO control.social_drafts
     (id,tenant_id,workspace_id,author_user_id,status)
     VALUES ($1,$2,$3,$4,'ready_for_review')`,
    [draftId, seed.tenantA, seed.workspaceA, seed.adminUser],
  );
  await admin.query(
    `INSERT INTO control.social_draft_revisions
     (id,tenant_id,draft_id,revision_number,title,caption,media_attachments,
      channel_overrides,content_hash,created_by)
     VALUES ($1,$2,$3,1,'Launch','Original caption','[]','{}',$4,$5)`,
    [firstRevisionId, seed.tenantA, draftId, "a".repeat(64), seed.adminUser],
  );
  await admin.query(
    `INSERT INTO control.social_draft_revisions
     (id,tenant_id,draft_id,revision_number,title,caption,media_attachments,
      channel_overrides,content_hash,created_by)
     VALUES ($1,$2,$3,2,'Launch','Governed caption','[]','{}',$4,$5)`,
    [currentRevisionId, seed.tenantA, draftId, "b".repeat(64), seed.adminUser],
  );
  await admin.query(
    "UPDATE control.social_drafts SET current_revision=2 WHERE id=$1",
    [draftId],
  );
  await admin.query(
    `INSERT INTO control.social_draft_targets
     (id,tenant_id,draft_id,revision_id,account_id,channel)
     VALUES ($1,$2,$3,$4,$5,'facebook')`,
    [randomUUID(), seed.tenantA, draftId, firstRevisionId, accountId],
  );
  await admin.query(
    `INSERT INTO control.social_draft_targets
     (id,tenant_id,draft_id,revision_id,account_id,channel)
     VALUES ($1,$2,$3,$4,$5,'facebook')`,
    [currentTargetId, seed.tenantA, draftId, currentRevisionId, accountId],
  );
  await admin.query(
    `INSERT INTO control.social_approvals
     (id,tenant_id,draft_id,revision_id,requested_by,decision)
     VALUES ($1,$2,$3,$4,$5,'pending')`,
    [randomUUID(), seed.tenantA, draftId, currentRevisionId, seed.adminUser],
  );
});

afterAll(async () => Promise.all([admin.end(), runtime.end(), auth.end()]));

describe("Social Studio read model", () => {
  it("serves identical tenant-isolated metrics through direct and proxy paths", async () => {
    for (const [tenant, workspace, value] of [
      [seed.tenantA, seed.workspaceA, 42],
      [seed.tenantB, seed.workspaceB, 99],
    ] as const) {
      const account = randomUUID();
      await admin.query(
        `INSERT INTO control.social_accounts
         (id,tenant_id,workspace_id,provider,account_type,provider_account_id,display_name,token_reference)
         VALUES($1::uuid,$2,$3,'meta','facebook_page',$1::uuid::text,'Synthetic metrics','secret://test/metrics')`,
        [account, tenant, workspace],
      );
      await admin.query(
        `INSERT INTO control.social_metric_observations
         (id,tenant_id,workspace_id,account_id,metric_key,period_start,period_end,value)
         VALUES($1,$2,$3,$4,'followers_count','2026-09-01','2026-09-02',$5)`,
        [randomUUID(), tenant, workspace, account, value],
      );
    }
    const session = await new SessionStore(auth).create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const app = buildApp({ database: { runtime, auth }, cookieSecure: false });
    const headers = { cookie: `redi_session=${session.token}` };
    let expectedBody: string | undefined;
    try {
      for (const path of ["/api/social/meta/metrics", "/api/social/metrics"]) {
        expect(
          (
            await app.inject({
              method: "GET",
              url: `${path}?workspaceId=${seed.workspaceA}`,
            })
          ).statusCode,
        ).toBe(401);
        const response = await app.inject({
          method: "GET",
          url: `${path}?workspaceId=${seed.workspaceA}`,
          headers,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json<{
          metrics: Array<{ metric_key: string; value: string }>;
        }>();
        expect(body.metrics).toHaveLength(1);
        expect(body.metrics[0]).toMatchObject({
          metric_key: "followers_count",
          value: "42.0000",
        });
        if (expectedBody) expect(response.body).toBe(expectedBody);
        expectedBody = response.body;
        const foreign = await app.inject({
          method: "GET",
          url: `${path}?workspaceId=${seed.workspaceB}`,
          headers,
        });
        expect(foreign.statusCode).toBe(200);
        expect(foreign.json()).toEqual({ metrics: [] });
        expect(
          (
            await app.inject({
              method: "GET",
              url: `${path}?workspaceId=${seed.workspaceA}&tenantId=${seed.tenantB}`,
              headers,
            })
          ).statusCode,
        ).toBe(400);
      }
    } finally {
      await app.close();
    }
  });

  it("returns only the session tenant's current governed draft projection", async () => {
    const session = await new SessionStore(auth).create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const publishing = new SocialPublishingService(
      runtime,
      new LocalTokenSecretProvider(),
    );
    const app = buildApp({
      database: { runtime, auth },
      socialPublishing: publishing,
      cookieSecure: false,
    });
    const headers = { cookie: `redi_session=${session.token}` };
    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/social/drafts?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        drafts: [
          {
            id: draftId,
            currentRevision: 2,
            status: "ready_for_review",
            content: { title: "Launch", caption: "Governed caption" },
            targets: [{ accountName: "Editorial Page", channel: "facebook" }],
            approval: {
              decision: "pending",
              requestedByCurrentUser: true,
            },
          },
        ],
      });
      expect(response.body).not.toContain("provider-page-sensitive");
      expect(response.body).not.toContain("secret://");

      const hidden = await app.inject({
        method: "GET",
        url: `/api/social/drafts?workspaceId=${seed.workspaceB}`,
        headers,
      });
      expect(hidden.statusCode).toBe(200);
      expect(hidden.json()).toMatchObject({ drafts: [] });

      const override = await app.inject({
        method: "GET",
        url: `/api/social/drafts?workspaceId=${seed.workspaceA}&tenantId=${seed.tenantB}`,
        headers,
      });
      expect(override.statusCode).toBe(400);

      const preflight = await app.inject({
        method: "GET",
        url: `/api/social/drafts/${draftId}/preflight?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(preflight.statusCode).toBe(200);
      expect(preflight.json()).toMatchObject({
        providerExecutionAvailable: false,
        targets: [
          {
            targetId: currentTargetId,
            accountName: "Editorial Page",
            channel: "facebook",
            checks: [
              { code: "account_active", severity: "pass" },
              { code: "caption_within_control_limit", severity: "pass" },
              { code: "media_count_invalid", severity: "blocker" },
              {
                code: "facebook_live_adapter_not_accepted",
                severity: "warning",
              },
            ],
          },
        ],
      });
      expect(preflight.body).not.toContain("provider-page-sensitive");
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/social/drafts/${draftId}/preflight?workspaceId=${seed.workspaceB}`,
            headers,
          })
        ).statusCode,
      ).toBe(404);

      const revisions = await app.inject({
        method: "GET",
        url: `/api/social/drafts/${draftId}/revisions?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(revisions.statusCode).toBe(200);
      expect(revisions.json()).toMatchObject({
        draft: { id: draftId, currentRevision: 2 },
        permissions: { canEdit: true, canApprove: true, mfaVerified: true },
        revisions: [
          {
            revisionNumber: 2,
            isCurrent: true,
            content: { caption: "Governed caption" },
            approval: { requestedByCurrentUser: true },
          },
          {
            revisionNumber: 1,
            isCurrent: false,
            content: { caption: "Original caption" },
          },
        ],
      });
      expect(revisions.body).not.toContain("content_hash");
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/social/drafts/${draftId}/revisions?workspaceId=${seed.workspaceB}`,
            headers,
          })
        ).statusCode,
      ).toBe(404);

      const selfDecision = await app.inject({
        method: "POST",
        url: `/api/social/drafts/${draftId}/decision`,
        headers: {
          ...headers,
          "x-csrf-token": session.csrfToken,
        },
        payload: { decision: "approved" },
      });
      expect(selfDecision.statusCode).toBe(403);

      const approver = await new SessionStore(auth).create(
        {
          provider: "local",
          subject: seed.analystSubject,
          email: `approver-${seed.analystUser}@example.invalid`,
          emailVerified: true,
          mfaVerified: true,
        },
        seed.tenantA,
      );
      const approverWithoutMfa = await new SessionStore(auth).create(
        {
          provider: "local",
          subject: seed.analystSubject,
          email: `approver-${seed.analystUser}@example.invalid`,
          emailVerified: true,
          mfaVerified: false,
        },
        seed.tenantA,
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/social/drafts/${draftId}/decision`,
            headers: {
              cookie: `redi_session=${approverWithoutMfa.token}`,
              "x-csrf-token": approverWithoutMfa.csrfToken,
            },
            payload: { decision: "approved" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/social/drafts/${draftId}/decision`,
            headers: {
              cookie: `redi_session=${approver.token}`,
              "x-csrf-token": approver.csrfToken,
            },
            payload: { decision: "rejected" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/social/drafts/${draftId}/decision`,
            headers: {
              cookie: `redi_session=${approver.token}`,
              "x-csrf-token": approver.csrfToken,
            },
            payload: { decision: "approved" },
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/social/drafts/${draftId}/schedule`,
            headers: {
              ...headers,
              "x-csrf-token": session.csrfToken,
            },
            payload: {
              scheduledFor: new Date(Date.now() + 60_000).toISOString(),
              timezone: "Not/AZone",
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/social/drafts/${draftId}/schedule`,
            headers: {
              ...headers,
              "x-csrf-token": session.csrfToken,
            },
            payload: {
              scheduledFor: new Date(Date.now() + 60_000).toISOString(),
              timezone: "Europe/Berlin",
            },
          })
        ).statusCode,
      ).toBe(204);
      const scheduled = await admin.query<{ jobs: number; attempts: number }>(
        `SELECT
          (SELECT count(*)::int FROM control.jobs WHERE payload->>'draftId'=$1::text) jobs,
          (SELECT count(*)::int FROM control.publication_attempts WHERE draft_id=$1::uuid) attempts`,
        [draftId],
      );
      expect(scheduled.rows[0]).toEqual({ jobs: 1, attempts: 0 });

      await admin.query(
        `INSERT INTO control.publication_attempts
         (id,tenant_id,draft_id,revision_id,target_id,account_id,
          idempotency_key,payload_hash,status,provider_reference,retry_count,
          failure_category,safe_error,started_at)
         SELECT $1,draft.tenant_id,draft.id,revision.id,target.id,target.account_id,
           'publication-secret-key',$2,'failed','provider-reference-sensitive',1,
           'provider','Provider rejected the request',now()
         FROM control.social_drafts draft
         JOIN control.social_draft_revisions revision
           ON revision.draft_id=draft.id
          AND revision.revision_number=draft.current_revision
         JOIN control.social_draft_targets target ON target.id=$3
         WHERE draft.id=$4`,
        [randomUUID(), "c".repeat(64), currentTargetId, draftId],
      );
      await admin.query(
        "UPDATE control.social_draft_targets SET status='failed' WHERE id=$1",
        [currentTargetId],
      );
      await admin.query(
        `UPDATE control.jobs SET last_error='internal-worker-secret'
         WHERE payload->>'targetId'=$1::text`,
        [currentTargetId],
      );
      const operations = await app.inject({
        method: "GET",
        url: `/api/social/publications?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(operations.statusCode).toBe(200);
      expect(operations.json()).toMatchObject({
        automaticExecution: false,
        reconciliationAvailable: false,
        publications: [
          {
            id: draftId,
            currentRevision: 2,
            status: "scheduled",
            content: { caption: "Governed caption" },
            targets: [
              {
                id: currentTargetId,
                accountName: "Editorial Page",
                provider: "meta",
                channel: "facebook",
                status: "failed",
                attempt: {
                  status: "failed",
                  retryCount: 1,
                  failureCategory: "provider",
                  safeError: "Provider rejected the request",
                  hasProviderReference: true,
                },
                job: { status: "pending", attemptCount: 0, maxAttempts: 4 },
                reconciliation: "not_available",
              },
            ],
          },
        ],
      });
      for (const sensitive of [
        "provider-page-sensitive",
        "secret://",
        "publication-secret-key",
        "provider-reference-sensitive",
        "internal-worker-secret",
        "payload_hash",
      ])
        expect(operations.body).not.toContain(sensitive);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/social/publications?workspaceId=${seed.workspaceB}`,
            headers,
          })
        ).json(),
      ).toMatchObject({ publications: [] });
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/social/publications?workspaceId=${seed.workspaceA}&tenantId=${seed.tenantB}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
