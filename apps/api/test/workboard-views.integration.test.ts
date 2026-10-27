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
const admin = createPool(adminUrl, "workboard-views-admin");
const runtime = createPool(runtimeUrl, "workboard-views-runtime");
const auth = createPool(authUrl, "workboard-views-auth");

let seed: SeedResult;
let app: ReturnType<typeof buildApp>;
let editor: Awaited<ReturnType<SessionStore["create"]>>;
let owner: Awaited<ReturnType<SessionStore["create"]>>;
let editorUser = "";
let secondWorkspace = "";
let savedView = "";

const headers = (session: Awaited<ReturnType<SessionStore["create"]>>) => ({
  cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
  "x-csrf-token": session.csrfToken,
});

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  editorUser = randomUUID();
  secondWorkspace = randomUUID();
  const subject = `workboard-view-editor-${randomUUID()}`;
  await admin.query(
    `INSERT INTO control.users(id,identity_subject,email) VALUES($1,$2,$3)`,
    [editorUser, `local|${subject}`, `views-${editorUser}@example.invalid`],
  );
  await admin.query(
    `INSERT INTO control.memberships(tenant_id,user_id,role)
     VALUES($1,$2,'editor')`,
    [seed.tenantA, editorUser],
  );
  await admin.query(
    `INSERT INTO control.business_workspaces
     (id,tenant_id,installation_id,slug,name)
     VALUES($1,$2,$3,'investigations','Investigations')`,
    [secondWorkspace, seed.tenantA, seed.installationA],
  );
  const sessions = new SessionStore(auth);
  editor = await sessions.create({
    provider: "local",
    subject,
    email: `views-${editorUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: false,
  });
  owner = await sessions.create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
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

describe("Workboard saved views", () => {
  it("returns only the session tenant's workzones to an ordinary editor", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
    });
    expect(anonymous.statusCode).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maximumSavedViews: 20,
      defaultViewId: null,
      savedViews: [],
      workspaces: [
        { id: seed.workspaceA, displayName: "Local Workspace A" },
        { id: secondWorkspace, displayName: "Investigations" },
      ],
    });
    expect(JSON.stringify(response.json())).not.toContain(seed.workspaceB);
  });

  it("requires CSRF and upserts a case-insensitive personal view", async () => {
    const payload = {
      workspaceId: secondWorkspace,
      name: "Morning review",
      stage: "review",
      query: "evidence",
      assignmentScope: "mine",
      focus: "due_soon",
      sortOrder: "smart",
    };
    const denied = await app.inject({
      method: "POST",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const created = await app.inject({
      method: "POST",
      url: "/api/workzone/views",
      headers: headers(editor),
      payload,
    });
    expect(created.statusCode).toBe(201);
    savedView = created.json<{ id: string }>().id;
    const updated = await app.inject({
      method: "POST",
      url: "/api/workzone/views",
      headers: headers(editor),
      payload: {
        ...payload,
        name: "MORNING REVIEW",
        stage: "attention",
        query: "deadline",
        focus: "overdue",
        handoffFilter: "blocked",
        sortOrder: "deadline",
      },
    });
    expect(updated.statusCode).toBe(201);
    expect(updated.json()).toEqual({ id: savedView });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(snapshot.json<{ savedViews: unknown[] }>().savedViews).toMatchObject(
      [
        {
          id: savedView,
          name: "MORNING REVIEW",
          workspaceId: secondWorkspace,
          stage: "attention",
          query: "deadline",
          assignmentScope: "mine",
          focus: "overdue",
          handoffFilter: "blocked",
          sortOrder: "deadline",
        },
      ],
    );
  });

  it("enforces one private default view and requires CSRF", async () => {
    const denied = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: { cookie: `redi_session=${editor.token}` },
      payload: { viewId: savedView },
    });
    expect(denied.statusCode).toBe(403);

    const foreignOwner = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: headers(owner),
      payload: { viewId: savedView },
    });
    expect(foreignOwner.statusCode).toBe(400);

    const selected = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: headers(editor),
      payload: { viewId: savedView },
    });
    expect(selected.statusCode).toBe(204);
    const selectedSnapshot = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(selectedSnapshot.json()).toMatchObject({ defaultViewId: savedView });

    const secondView = randomUUID();
    await admin.query(
      `INSERT INTO control.workboard_saved_views
       (id,tenant_id,user_id,workspace_id,name,stage)
       VALUES($1,$2,$3,$4,'Evening review','review')`,
      [secondView, seed.tenantA, editorUser, seed.workspaceA],
    );
    const switched = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: headers(editor),
      payload: { viewId: secondView },
    });
    expect(switched.statusCode).toBe(204);
    const switchedRows = await admin.query<{
      id: string;
      default_count: number;
    }>(
      `SELECT max(id::text) FILTER (WHERE is_default)::uuid AS id,
              count(*) FILTER (WHERE is_default)::int AS default_count
       FROM control.workboard_saved_views
       WHERE tenant_id=$1 AND user_id=$2`,
      [seed.tenantA, editorUser],
    );
    expect(switchedRows.rows[0]).toEqual({
      id: secondView,
      default_count: 1,
    });
    const switchedBack = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: headers(editor),
      payload: { viewId: savedView },
    });
    expect(switchedBack.statusCode).toBe(204);
    await admin.query(`DELETE FROM control.workboard_saved_views WHERE id=$1`, [
      secondView,
    ]);

    await expect(
      admin.query(
        `INSERT INTO control.workboard_saved_views
         (id,tenant_id,user_id,workspace_id,name,stage,is_default)
         VALUES($1,$2,$3,$4,'Second default','all',true)`,
        [randomUUID(), seed.tenantA, editorUser, seed.workspaceA],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const cleared = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: headers(editor),
      payload: { viewId: null },
    });
    expect(cleared.statusCode).toBe(204);
    const clearedSnapshot = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(clearedSnapshot.json()).toMatchObject({ defaultViewId: null });

    const restored = await app.inject({
      method: "PUT",
      url: "/api/workzone/views/default",
      headers: headers(editor),
      payload: { viewId: savedView },
    });
    expect(restored.statusCode).toBe(204);
  });

  it("renames the default in place and duplicates it as non-default", async () => {
    const denied = await app.inject({
      method: "PATCH",
      url: `/api/workzone/views/${savedView}`,
      headers: { cookie: `redi_session=${editor.token}` },
      payload: { name: "Primary desk" },
    });
    expect(denied.statusCode).toBe(403);
    const foreignRename = await app.inject({
      method: "PATCH",
      url: `/api/workzone/views/${savedView}`,
      headers: headers(owner),
      payload: { name: "Owner cannot rename" },
    });
    expect(foreignRename.statusCode).toBe(400);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/workzone/views/${savedView}`,
      headers: headers(editor),
      payload: { name: "  Primary desk  " },
    });
    expect(renamed.statusCode).toBe(204);
    const renamedSnapshot = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(renamedSnapshot.json()).toMatchObject({
      defaultViewId: savedView,
      savedViews: [{ id: savedView, name: "Primary desk" }],
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/workzone/views/${savedView}/duplicate`,
      headers: headers(editor),
      payload: { name: "Primary desk copy" },
    });
    expect(duplicate.statusCode).toBe(201);
    const duplicateId = duplicate.json<{ id: string }>().id;
    const duplicateSnapshot = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(duplicateSnapshot.json()).toMatchObject({
      defaultViewId: savedView,
      savedViews: [
        {
          id: savedView,
          name: "Primary desk",
          stage: "attention",
          query: "deadline",
          handoffFilter: "blocked",
        },
        {
          id: duplicateId,
          name: "Primary desk copy",
          stage: "attention",
          query: "deadline",
          handoffFilter: "blocked",
        },
      ],
    });

    const renameConflict = await app.inject({
      method: "PATCH",
      url: `/api/workzone/views/${duplicateId}`,
      headers: headers(editor),
      payload: { name: "PRIMARY DESK" },
    });
    expect(renameConflict.statusCode).toBe(409);
    const duplicateConflict = await app.inject({
      method: "POST",
      url: `/api/workzone/views/${savedView}/duplicate`,
      headers: headers(editor),
      payload: { name: "primary desk COPY" },
    });
    expect(duplicateConflict.statusCode).toBe(409);
    const foreignDuplicate = await app.inject({
      method: "POST",
      url: `/api/workzone/views/${savedView}/duplicate`,
      headers: headers(owner),
      payload: { name: "Foreign copy" },
    });
    expect(foreignDuplicate.statusCode).toBe(400);

    await admin.query(
      `INSERT INTO control.workboard_saved_views
       (id,tenant_id,user_id,workspace_id,name,stage)
       SELECT gen_random_uuid(),$1,$2,$3,'Limit ' || value,'all'
       FROM generate_series(1,18) value`,
      [seed.tenantA, editorUser, seed.workspaceA],
    );
    const atLimit = await app.inject({
      method: "POST",
      url: `/api/workzone/views/${savedView}/duplicate`,
      headers: headers(editor),
      payload: { name: "Over limit" },
    });
    expect(atLimit.statusCode).toBe(409);
    await admin.query(
      `DELETE FROM control.workboard_saved_views
       WHERE tenant_id=$1 AND user_id=$2 AND name LIKE 'Limit %'`,
      [seed.tenantA, editorUser],
    );
    await admin.query(`DELETE FROM control.workboard_saved_views WHERE id=$1`, [
      duplicateId,
    ]);
  });

  it("denies foreign workzones and direct runtime table writes", async () => {
    const foreign = await app.inject({
      method: "POST",
      url: "/api/workzone/views",
      headers: headers(editor),
      payload: {
        workspaceId: seed.workspaceB,
        name: "Foreign",
        stage: "all",
        query: "",
        assignmentScope: "all",
        focus: "all",
        handoffFilter: "all",
        sortOrder: "smart",
      },
    });
    expect(foreign.statusCode).toBe(400);
    const invalidHandoff = await app.inject({
      method: "POST",
      url: "/api/workzone/views",
      headers: headers(editor),
      payload: {
        workspaceId: seed.workspaceA,
        name: "Invalid handoff",
        stage: "all",
        query: "",
        assignmentScope: "all",
        focus: "all",
        handoffFilter: "approved",
        sortOrder: "smart",
      },
    });
    expect(invalidHandoff.statusCode).toBe(400);
    await expect(
      runtime.query(
        `SELECT control.save_workboard_view(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
         )`,
        [
          editorUser,
          seed.tenantA,
          seed.workspaceA,
          "Database invalid handoff",
          "all",
          "",
          "all",
          "all",
          "approved",
          "smart",
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      runtime.query(`SELECT control.rename_workboard_view($1,$2,$3,$4,$5)`, [
        editorUser,
        seed.tenantA,
        savedView,
        null,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "22023" });

    const defaultedView = randomUUID();
    await admin.query(
      `INSERT INTO control.workboard_saved_views
       (id,tenant_id,user_id,workspace_id,name,stage)
       VALUES($1,$2,$3,$4,'Default handoff','all')`,
      [defaultedView, seed.tenantA, editorUser, seed.workspaceA],
    );
    const defaulted = await admin.query<{ handoff_filter: string }>(
      `SELECT handoff_filter FROM control.workboard_saved_views WHERE id=$1`,
      [defaultedView],
    );
    expect(defaulted.rows[0]?.handoff_filter).toBe("all");
    await admin.query(`DELETE FROM control.workboard_saved_views WHERE id=$1`, [
      defaultedView,
    ]);
    await expect(
      withTenant(runtime, seed.tenantA, (client) =>
        client.query(
          `INSERT INTO control.workboard_saved_views
           (id,tenant_id,user_id,workspace_id,name,stage)
           VALUES($1,$2,$3,$4,'Bypass','all')`,
          [randomUUID(), seed.tenantA, editorUser, seed.workspaceA],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps views personal and emits evidence for save and delete", async () => {
    const ownerSnapshot = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${owner.token}` },
    });
    expect(ownerSnapshot.statusCode).toBe(200);
    expect(ownerSnapshot.json<{ savedViews: unknown[] }>().savedViews).toEqual(
      [],
    );
    const ownerDelete = await app.inject({
      method: "DELETE",
      url: `/api/workzone/views/${savedView}`,
      headers: headers(owner),
    });
    expect(ownerDelete.statusCode).toBe(400);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/workzone/views/${savedView}`,
      headers: headers(editor),
    });
    expect(removed.statusCode).toBe(204);
    const fallback = await app.inject({
      method: "GET",
      url: "/api/workzone/views",
      headers: { cookie: `redi_session=${editor.token}` },
    });
    expect(fallback.json()).toMatchObject({
      defaultViewId: null,
      savedViews: [],
    });
    const evidence = await admin.query<{
      action: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action,metadata FROM control.audit_events
       WHERE tenant_id=$1 AND actor_user_id=$2
         AND action LIKE 'workboard.saved_view_%'
       ORDER BY occurred_at,id`,
      [seed.tenantA, editorUser],
    );
    expect(evidence.rows.map((row) => row.action)).toEqual([
      "workboard.saved_view_saved",
      "workboard.saved_view_saved",
      "workboard.saved_view_default_set",
      "workboard.saved_view_default_set",
      "workboard.saved_view_default_set",
      "workboard.saved_view_default_cleared",
      "workboard.saved_view_default_set",
      "workboard.saved_view_renamed",
      "workboard.saved_view_duplicated",
      "workboard.saved_view_deleted",
    ]);
    expect(evidence.rows[0]?.metadata).toMatchObject({
      handoffFilter: "all",
    });
    expect(evidence.rows[1]?.metadata).toMatchObject({
      handoffFilter: "blocked",
    });
    expect(evidence.rows[2]?.metadata).toMatchObject({ viewId: savedView });
    expect(typeof evidence.rows[3]?.metadata.viewId).toBe("string");
    expect(evidence.rows[5]?.metadata).toMatchObject({ viewId: null });
    expect(evidence.rows[7]?.metadata).toMatchObject({
      oldName: "MORNING REVIEW",
      newName: "Primary desk",
      isDefault: true,
    });
    expect(evidence.rows[8]?.metadata).toMatchObject({
      sourceViewId: savedView,
      isDefault: false,
    });
  });
});
