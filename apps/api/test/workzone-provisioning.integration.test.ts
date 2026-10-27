import { randomUUID } from "node:crypto";

import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { SessionStore } from "@redi-control/identity";
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
const admin = createPool(adminUrl, "workzone-provisioning-admin");
const runtime = createPool(runtimeUrl, "workzone-provisioning-runtime");
const auth = createPool(authUrl, "workzone-provisioning-auth");

let seed: SeedResult;
let app: ReturnType<typeof buildApp>;
let owner: Awaited<ReturnType<SessionStore["create"]>>;
let editor: Awaited<ReturnType<SessionStore["create"]>>;
let editorUser = "";
let createdWorkspace = "";

const lifecycleInventoryTables = [
  "ai_budget_policies",
  "ai_model_routes",
  "ai_route_evaluations",
  "ai_route_proposals",
  "ai_runs",
  "ai_usage_events",
  "content_item_media",
  "content_item_variants",
  "content_items",
  "content_website_draft_media",
  "content_website_draft_reviews",
  "content_website_draft_revisions",
  "content_website_drafts",
  "discovery_results",
  "discovery_runs",
  "editorial_candidates",
  "editorial_context_packs",
  "editorial_draft_promotions",
  "editorial_drafts",
  "editorial_story_assignments",
  "evidence_packs",
  "factual_syntheses",
  "media_assets",
  "media_profile_revisions",
  "media_profiles",
  "media_upload_sessions",
  "oauth_transactions",
  "platform_connections",
  "platform_tenant_setups",
  "provider_usage_events",
  "research_case_sources",
  "research_cases",
  "research_claim_proposals",
  "research_claims",
  "research_evidence",
  "research_evidence_proposals",
  "social_accounts",
  "social_drafts",
  "social_metric_observations",
  "source_feeds",
  "source_performance_observations",
  "source_provider_configurations",
  "source_registry",
  "synthesis_promotions",
  "video_brief_evidence",
  "video_briefs",
  "video_command_receipts",
  "video_generation_policies",
  "video_generation_usage_events",
  "video_render_asset_reviews",
  "video_render_jobs",
  "video_render_outputs",
  "video_render_preparations",
  "video_script_approvals",
  "video_script_revisions",
  "video_social_distribution_handoffs",
  "video_website_content_handoffs",
  "workboard_saved_views",
  "workzone_team_assignments",
] as const;

const mutationHeaders = (
  session: Awaited<ReturnType<SessionStore["create"]>>,
) => ({
  cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
  "x-csrf-token": session.csrfToken,
});

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  editorUser = randomUUID();
  const editorSubject = `workzone-editor-${randomUUID()}`;
  await admin.query(
    `INSERT INTO control.users(id,identity_subject,email) VALUES($1,$2,$3)`,
    [
      editorUser,
      `local|${editorSubject}`,
      `editor-${editorUser}@example.invalid`,
    ],
  );
  await admin.query(
    `INSERT INTO control.memberships(tenant_id,user_id,role)
     VALUES($1,$2,'editor')`,
    [seed.tenantA, editorUser],
  );
  const sessions = new SessionStore(auth);
  owner = await sessions.create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  editor = await sessions.create({
    provider: "local",
    subject: editorSubject,
    email: `editor-${editorUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  app = buildApp({ database: { runtime, auth }, cookieSecure: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await Promise.all([admin.end(), runtime.end(), auth.end()]);
});

describe("Workzone & Team Provisioning", () => {
  it("requires an MFA-verified tenant owner and returns one bounded tenant snapshot", async () => {
    const denied = await app.inject({
      method: "GET",
      url: "/api/workzone-provisioning",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(denied.statusCode).toBe(403);

    const response = await app.inject({
      method: "GET",
      url: "/api/workzone-provisioning",
      headers: { cookie: `redi_session=${owner.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      installationId: seed.installationA,
      maximumWorkzones: 2,
      workzoneCount: 1,
      remainingCapacity: 1,
      securityBoundary: "tenant_membership",
      workzones: [{ id: seed.workspaceA, name: "Local Workspace A" }],
    });
    const body = response.json<{ members: Array<{ userId: string }> }>();
    expect(body.members.map((member) => member.userId).sort()).toEqual(
      [seed.adminUser, editorUser].sort(),
    );
    expect(JSON.stringify(response.json())).not.toContain(seed.analystUser);
  });

  it("creates only within the package quota and removes direct runtime INSERT authority", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/workzone-provisioning",
      headers: mutationHeaders(owner),
      payload: {
        slug: "investigations",
        name: "Investigations",
        description: "Long-form and evidence-led reporting.",
      },
    });
    expect(created.statusCode).toBe(201);
    createdWorkspace = created.json<{ id: string }>().id;

    const limited = await app.inject({
      method: "POST",
      url: "/api/workzone-provisioning",
      headers: mutationHeaders(owner),
      payload: { slug: "culture", name: "Culture", description: "" },
    });
    expect(limited.statusCode).toBe(409);
    await expect(
      withTenant(runtime, seed.tenantA, (client) =>
        client.query(
          `INSERT INTO control.business_workspaces
           (id,tenant_id,installation_id,slug,name) VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), seed.tenantA, seed.installationA, "bypass", "Bypass"],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("assigns existing members operationally without granting security roles", async () => {
    const assigned = await app.inject({
      method: "PUT",
      url: `/api/workzone-provisioning/${createdWorkspace}/members/${editorUser}`,
      headers: mutationHeaders(owner),
      payload: { responsibility: "lead" },
    });
    expect(assigned.statusCode).toBe(200);
    const updated = await app.inject({
      method: "PUT",
      url: `/api/workzone-provisioning/${createdWorkspace}/members/${editorUser}`,
      headers: mutationHeaders(owner),
      payload: { responsibility: "editorial" },
    });
    expect(updated.statusCode).toBe(200);
    const foreignMember = await app.inject({
      method: "PUT",
      url: `/api/workzone-provisioning/${createdWorkspace}/members/${seed.analystUser}`,
      headers: mutationHeaders(owner),
      payload: { responsibility: "research" },
    });
    expect(foreignMember.statusCode).toBe(400);

    const snapshot = await app.inject({
      method: "GET",
      url: "/api/workzone-provisioning",
      headers: { cookie: `redi_session=${owner.token}` },
    });
    const workzone = snapshot
      .json<{
        workzones: Array<{
          id: string;
          assignments: Array<{
            userId: string;
            responsibility: string;
          }>;
        }>;
      }>()
      .workzones.find((candidate) => candidate.id === createdWorkspace);
    expect(workzone?.assignments).toMatchObject([
      { userId: editorUser, responsibility: "editorial" },
    ]);
    const roles = await admin.query<{ role: string }>(
      `SELECT role::text role FROM control.memberships
       WHERE tenant_id=$1 AND user_id=$2 ORDER BY role`,
      [seed.tenantA, editorUser],
    );
    expect(roles.rows.map((row) => row.role)).toEqual(["editor"]);
  });

  it("updates the workzone profile, removes assignments, and emits bounded evidence", async () => {
    const profile = await app.inject({
      method: "PATCH",
      url: `/api/workzone-provisioning/${createdWorkspace}`,
      headers: mutationHeaders(owner),
      payload: {
        name: "Investigations Desk",
        description: "Reviewed long-form investigations.",
      },
    });
    expect(profile.statusCode).toBe(204);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/workzone-provisioning/${createdWorkspace}/members/${editorUser}`,
      headers: mutationHeaders(owner),
    });
    expect(removed.statusCode).toBe(204);
    const evidence = await admin.query<{ action: string }>(
      `SELECT action FROM control.audit_events WHERE tenant_id=$1
       AND action LIKE 'workzone.%' ORDER BY occurred_at,id`,
      [seed.tenantA],
    );
    expect(evidence.rows.map((row) => row.action)).toEqual([
      "workzone.created",
      "workzone.member_assigned",
      "workzone.member_assigned",
      "workzone.updated",
      "workzone.member_removed",
    ]);
    const persisted = await admin.query<{
      slug: string;
      name: string;
      description: string;
      assignments: number;
    }>(
      `SELECT workspace.slug,workspace.name,workspace.description,
        (SELECT count(*)::int FROM control.workzone_team_assignments assignment
         WHERE assignment.workspace_id=workspace.id) assignments
       FROM control.business_workspaces workspace WHERE workspace.id=$1`,
      [createdWorkspace],
    );
    expect(persisted.rows[0]).toEqual({
      slug: "investigations",
      name: "Investigations Desk",
      description: "Reviewed long-form investigations.",
      assignments: 0,
    });
  });

  it("previews complete same-tenant lifecycle references without mutating state", async () => {
    const inventory = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema='control' AND column_name='workspace_id'
         AND table_name <> 'workzone_lifecycle_events'
       ORDER BY table_name`,
    );
    expect(inventory.rows.map((row) => row.table_name)).toEqual(
      lifecycleInventoryTables,
    );
    const guarded = await admin.query<{ table_name: string }>(
      `SELECT relation.relname table_name
       FROM pg_catalog.pg_trigger trigger_record
       JOIN pg_catalog.pg_class relation ON relation.oid=trigger_record.tgrelid
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
       WHERE namespace.nspname='control' AND NOT trigger_record.tgisinternal
         AND trigger_record.tgname='guard_active_workzone_'||relation.relname
       ORDER BY relation.relname`,
    );
    expect(guarded.rows.map((row) => row.table_name)).toEqual(
      lifecycleInventoryTables,
    );
    const contentItem = randomUUID();
    await admin.query(
      `INSERT INTO control.content_items
       (id,tenant_id,workspace_id,title,summary,created_by,updated_by)
       VALUES($1,$2,$3,'Lifecycle preview','Counted reference row',$4,$4)`,
      [contentItem, seed.tenantA, createdWorkspace, seed.adminUser],
    );
    await admin.query(
      `INSERT INTO control.workboard_saved_views
       (id,tenant_id,user_id,workspace_id,name,stage,search_query)
       VALUES($1,$2,$3,$4,'Lifecycle view','all','')`,
      [randomUUID(), seed.tenantA, seed.adminUser, createdWorkspace],
    );
    const before = await admin.query<{ audits: number; outbox: number }>(
      `SELECT
        (SELECT count(*)::int FROM control.audit_events WHERE tenant_id=$1) audits,
        (SELECT count(*)::int FROM control.outbox_events WHERE tenant_id=$1) outbox`,
      [seed.tenantA],
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/workzone-provisioning/${createdWorkspace}/lifecycle-impact`,
      headers: { cookie: `redi_session=${owner.token}` },
    });
    expect(response.statusCode).toBe(200);
    const impact = response.json<{
      mode: string;
      blockingReferenceRows: number;
      informationalReferenceRows: number;
      hasBlockingReferences: boolean;
      operations: {
        archiveAvailable: boolean;
        restoreAvailable: boolean;
        deleteAvailable: boolean;
        reason: string;
      };
      dependencies: Array<{
        key: string;
        kind: string;
        referenceRows: number;
      }>;
    }>();
    expect(impact).toMatchObject({
      mode: "preview_only",
      blockingReferenceRows: 1,
      informationalReferenceRows: 1,
      hasBlockingReferences: true,
      operations: {
        archiveAvailable: true,
        restoreAvailable: false,
        deleteAvailable: false,
        reason: "ready_to_archive",
      },
    });
    expect(impact.dependencies).toEqual([
      { key: "publishing_delivery", kind: "blocking", referenceRows: 0 },
      { key: "editorial_content", kind: "blocking", referenceRows: 1 },
      { key: "research_evidence", kind: "blocking", referenceRows: 0 },
      { key: "ai_governance", kind: "blocking", referenceRows: 0 },
      { key: "tenant_setup", kind: "blocking", referenceRows: 0 },
      { key: "team_assignments", kind: "informational", referenceRows: 0 },
      {
        key: "personal_saved_views",
        kind: "informational",
        referenceRows: 1,
      },
    ]);

    const foreign = await app.inject({
      method: "GET",
      url: `/api/workzone-provisioning/${seed.workspaceB}/lifecycle-impact`,
      headers: { cookie: `redi_session=${owner.token}` },
    });
    expect(foreign.statusCode).toBe(400);

    const after = await admin.query<{ audits: number; outbox: number }>(
      `SELECT
        (SELECT count(*)::int FROM control.audit_events WHERE tenant_id=$1) audits,
        (SELECT count(*)::int FROM control.outbox_events WHERE tenant_id=$1) outbox`,
      [seed.tenantA],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    await expect(
      runtime.query(`SELECT control.workzone_lifecycle_impact($1,$2,$3)`, [
        seed.adminUser,
        seed.tenantA,
        seed.workspaceB,
      ]),
    ).rejects.toMatchObject({ code: "22023", message: "WORKZONE_NOT_FOUND" });
  });

  it("archives and restores reversibly with fallback, replay and write guards", async () => {
    const metricAccount = randomUUID();
    const metricId = randomUUID();
    await admin.query(
      `INSERT INTO control.social_accounts
       (id,tenant_id,workspace_id,provider,account_type,provider_account_id,display_name,token_reference)
       VALUES($1::uuid,$2,$3,'meta','facebook_page',$1::uuid::text,'Synthetic metric account','secret://test/metric-account')`,
      [metricAccount, seed.tenantA, createdWorkspace],
    );
    const insertMetric = (id: string) =>
      withTenant(runtime, seed.tenantA, (client) =>
        client.query(
          `INSERT INTO control.social_metric_observations
         (id,tenant_id,workspace_id,account_id,metric_key,period_start,period_end,value)
         VALUES($1,$2,$3,$4,'followers_count',now()-interval '1 day',now(),42)`,
          [id, seed.tenantA, createdWorkspace, metricAccount],
        ),
      );
    await insertMetric(metricId);
    await admin.query(
      `INSERT INTO control.oauth_transactions(
        id,tenant_id,installation_id,workspace_id,actor_user_id,provider,
        state_hash,redirect_uri,expected_origin,requested_scopes,expires_at
      ) VALUES($1,$2,$3,$4,$5,'meta',$6,
        'http://localhost/api/social/oauth/meta/callback','http://localhost',
        ARRAY['pages_show_list'],now()+interval '10 minutes')`,
      [
        randomUUID(),
        seed.tenantA,
        seed.installationA,
        createdWorkspace,
        seed.adminUser,
        randomUUID().replaceAll("-", "").padEnd(64, "0"),
      ],
    );
    const blockedByOauth = await app.inject({
      method: "POST",
      url: `/api/workzone-provisioning/${createdWorkspace}/lifecycle`,
      headers: mutationHeaders(owner),
      payload: {
        action: "archive",
        reason: "Archive must wait until the active OAuth handoff completes.",
        idempotencyKey: randomUUID(),
      },
    });
    expect(blockedByOauth.statusCode).toBe(409);
    expect(blockedByOauth.json()).toMatchObject({
      outcome: "refused",
      code: "WORKZONE_ACTIVE_OPERATIONS",
    });
    await admin.query(
      `UPDATE control.oauth_transactions SET used_at=now()
       WHERE tenant_id=$1 AND workspace_id=$2 AND used_at IS NULL`,
      [seed.tenantA, createdWorkspace],
    );
    await admin.query(
      `UPDATE control.workboard_saved_views SET is_default=true
       WHERE tenant_id=$1 AND user_id=$2 AND workspace_id=$3`,
      [seed.tenantA, seed.adminUser, createdWorkspace],
    );
    const idempotencyKey = randomUUID();
    const archived = await app.inject({
      method: "POST",
      url: `/api/workzone-provisioning/${createdWorkspace}/lifecycle`,
      headers: mutationHeaders(owner),
      payload: {
        action: "archive",
        reason: "Archive this desk after the editorial handoff is complete.",
        idempotencyKey,
      },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      outcome: "executed",
      code: "WORKZONE_ARCHIVED",
      status: "archived",
      lifecycleVersion: 2,
      replayed: false,
    });

    const replay = await app.inject({
      method: "POST",
      url: `/api/workzone-provisioning/${createdWorkspace}/lifecycle`,
      headers: mutationHeaders(owner),
      payload: {
        action: "archive",
        reason: "Archive this desk after the editorial handoff is complete.",
        idempotencyKey,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true });
    expect(replay.json<{ eventId: string }>().eventId).toBe(
      archived.json<{ eventId: string }>().eventId,
    );

    const fallback = await admin.query<{ is_default: boolean }>(
      `SELECT is_default FROM control.workboard_saved_views
       WHERE tenant_id=$1 AND user_id=$2 AND workspace_id=$3`,
      [seed.tenantA, seed.adminUser, createdWorkspace],
    );
    expect(fallback.rows).toEqual([{ is_default: false }]);
    const blockedWrite = await app.inject({
      method: "PATCH",
      url: `/api/workzone-provisioning/${createdWorkspace}`,
      headers: mutationHeaders(owner),
      payload: { name: "Must not change", description: "Archived desk" },
    });
    expect(blockedWrite.statusCode).toBe(409);
    await expect(insertMetric(randomUUID())).rejects.toMatchObject({
      code: "55000",
      message: "WORKZONE_ARCHIVED",
    });
    await expect(
      withTenant(runtime, seed.tenantA, (client) =>
        client.query(
          "UPDATE control.social_metric_observations SET value=43 WHERE id=$1",
          [metricId],
        ),
      ),
    ).rejects.toMatchObject({ code: "55000", message: "WORKZONE_ARCHIVED" });
    // Runtime DELETE remains prohibited even before the archive trigger runs.
    await expect(
      withTenant(runtime, seed.tenantA, (client) =>
        client.query(
          "DELETE FROM control.social_metric_observations WHERE id=$1",
          [metricId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      admin.query(
        "DELETE FROM control.social_metric_observations WHERE id=$1",
        [metricId],
      ),
    ).rejects.toMatchObject({ code: "55000", message: "WORKZONE_ARCHIVED" });

    const archivedImpact = await app.inject({
      method: "GET",
      url: `/api/workzone-provisioning/${createdWorkspace}/lifecycle-impact`,
      headers: { cookie: `redi_session=${owner.token}` },
    });
    expect(archivedImpact.statusCode).toBe(200);
    const archivedPreview = archivedImpact.json<{
      operations: {
        archiveAvailable: boolean;
        restoreAvailable: boolean;
        deleteAvailable: boolean;
        reason: string;
      };
      transitionBlockers: Array<{ key: string; count: number }>;
    }>();
    expect(archivedPreview.operations).toEqual({
      archiveAvailable: false,
      restoreAvailable: true,
      deleteAvailable: false,
      reason: "ready_to_restore",
    });
    expect(
      archivedPreview.transitionBlockers.find(
        (blocker) => blocker.key === "last_active_workzone",
      ),
    ).toEqual({ key: "last_active_workzone", count: 0 });

    const lastActive = await app.inject({
      method: "POST",
      url: `/api/workzone-provisioning/${seed.workspaceA}/lifecycle`,
      headers: mutationHeaders(owner),
      payload: {
        action: "archive",
        reason: "Attempt to archive the final active workzone safely.",
        idempotencyKey: randomUUID(),
      },
    });
    expect(lastActive.statusCode).toBe(409);
    expect(lastActive.json()).toMatchObject({
      outcome: "refused",
      code: "WORKZONE_LAST_ACTIVE",
      status: "active",
    });

    const restored = await app.inject({
      method: "POST",
      url: `/api/workzone-provisioning/${createdWorkspace}/lifecycle`,
      headers: mutationHeaders(owner),
      payload: {
        action: "restore",
        reason: "Restore this desk for a newly approved editorial cycle.",
        idempotencyKey: randomUUID(),
      },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      outcome: "executed",
      code: "WORKZONE_RESTORED",
      status: "active",
      lifecycleVersion: 3,
    });
    const preservedMetric = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ value: string }>(
        "SELECT value FROM control.social_metric_observations WHERE id=$1",
        [metricId],
      ),
    );
    expect(preservedMetric.rows).toEqual([{ value: "42.0000" }]);
    await insertMetric(randomUUID());
    const resumedWrite = await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        "UPDATE control.social_metric_observations SET value=43 WHERE id=$1",
        [metricId],
      ),
    );
    expect(resumedWrite.rowCount).toBe(1);
    const preserved = await admin.query<{
      is_default: boolean;
      lifecycle_status: string;
    }>(
      `SELECT saved.is_default,workspace.lifecycle_status
       FROM control.workboard_saved_views saved
       JOIN control.business_workspaces workspace ON workspace.id=saved.workspace_id
       WHERE saved.tenant_id=$1 AND saved.user_id=$2 AND saved.workspace_id=$3`,
      [seed.tenantA, seed.adminUser, createdWorkspace],
    );
    expect(preserved.rows).toEqual([
      { is_default: false, lifecycle_status: "active" },
    ]);
    const events = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.workzone_lifecycle_events
       WHERE tenant_id=$1 AND workspace_id=$2`,
      [seed.tenantA, createdWorkspace],
    );
    expect(events.rows[0]?.count).toBe(3);
  });
});
