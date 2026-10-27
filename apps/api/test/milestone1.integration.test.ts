import {
  parseSocialDrafts,
  parseSocialWorkflowDetail,
} from "../../web/app/social-contract.js";
import { randomUUID } from "node:crypto";

import {
  claimNextJob,
  createPool,
  finishJob,
  localDemoIds,
  migrateDatabase,
  prepareLocalDemoData,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import {
  FirstOwnerInvitationStore,
  PostgresOidcTransactionStore,
  SessionStore,
  type CompleteIdentityRequest,
  type IdentityAdapter,
  type IdentityPrincipal,
} from "@redi-control/identity";
import { InstallationResolver } from "@redi-control/installation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

class TestIdentityAdapter implements IdentityAdapter {
  public readonly id = "local";
  public constructor(private readonly principal: IdentityPrincipal) {}
  public begin() {
    return Promise.resolve({
      authorizationUrl: "https://identity.test/authorize?state=test-state",
      transaction: "test-transaction",
    });
  }
  public complete(request: CompleteIdentityRequest) {
    if (
      request.state !== "test-state" ||
      request.transaction !== "test-transaction" ||
      request.code !== "valid-code"
    ) {
      return Promise.reject(new Error("Invalid test identity transaction"));
    }
    return Promise.resolve(this.principal);
  }
}

function cookieFrom(
  response: {
    headers: Record<string, string | string[] | number | undefined>;
  },
  name: string,
): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header)
    ? header
    : typeof header === "string"
      ? [header]
      : [];
  const cookie = values.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Cookie ${name} was not set`);
  return cookie.split(";", 1)[0] ?? "";
}

const adminUrl = required("DATABASE_ADMIN_URL");
const runtimeUrl = required("DATABASE_URL");
const authUrl = required("DATABASE_AUTH_URL");
const runtimePassword = required("DATABASE_RUNTIME_PASSWORD");
const authPassword = required("DATABASE_AUTH_PASSWORD");
const adminPool = createPool(adminUrl, "redi-control-integration-admin");
const runtimePool = createPool(runtimeUrl, "redi-control-integration-runtime");
const authPool = createPool(authUrl, "redi-control-integration-auth");
let seed: SeedResult;

beforeAll(async () => {
  await adminPool.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
});

afterAll(async () => {
  await Promise.all([adminPool.end(), runtimePool.end(), authPool.end()]);
});

describe("Milestone 1 database gates", () => {
  it("applies all migrations from an empty database and uses restricted runtime roles", async () => {
    const migrations = await adminPool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM control.schema_migrations",
    );
    expect(migrations.rows[0]?.count).toBe(44);
    const role = await runtimePool.query<{
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("allows own-tenant reads and hides other-tenant rows", async () => {
    const own = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM control.memberships",
      ),
    );
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]?.tenant_id).toBe(seed.tenantA);

    const foreign = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query(
        "SELECT tenant_id FROM control.memberships WHERE tenant_id = $1",
        [seed.tenantB],
      ),
    );
    expect(foreign.rows).toHaveLength(0);
  });

  it("opens a synthetic demo only with one short-lived local token", async () => {
    const disabled = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      cookieSecure: false,
    });
    await disabled.ready();
    try {
      expect(
        (await disabled.inject({ method: "GET", url: "/auth/local-demo" }))
          .statusCode,
      ).toBe(404);
    } finally {
      await disabled.close();
    }

    const prepared = await prepareLocalDemoData(adminPool);
    const stored = await adminPool.query<{ serialized: string }>(
      `SELECT row_to_json(token)::text AS serialized
       FROM control.local_demo_bootstrap_tokens token
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [localDemoIds.tenantId],
    );
    expect(stored.rows[0]?.serialized).not.toContain(prepared.token);
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      cookieSecure: false,
      localDemoEnabled: true,
      publicWebUrl: "http://127.0.0.1:3000",
      installationResolver: new InstallationResolver(
        runtimePool,
        "local",
        new Set(["127.0.0.1"]),
        {
          tenantId: localDemoIds.tenantId,
          installationId: localDemoIds.installationId,
        },
      ),
    });
    await app.ready();
    try {
      const page = await app.inject({
        method: "GET",
        url: "/auth/local-demo",
        headers: { host: "127.0.0.1:3001" },
      });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain("synthetic editorial data");
      const invalid = await app.inject({
        method: "POST",
        url: "/auth/local-demo",
        headers: { host: "127.0.0.1:3001" },
        payload: { token: "x".repeat(43) },
      });
      expect(invalid.statusCode).toBe(403);
      const login = await app.inject({
        method: "POST",
        url: "/auth/local-demo",
        headers: { host: "127.0.0.1:3001" },
        payload: { token: prepared.token },
      });
      expect(login.statusCode).toBe(303);
      expect(login.headers.location).toBe("http://127.0.0.1:3000/sq/showcase");
      expect(cookieFrom(login, "redi_csrf")).not.toBe("");
      const duplicateSubmit = await app.inject({
        method: "POST",
        url: "/auth/local-demo",
        headers: {
          host: "127.0.0.1:3001",
          cookie: cookieFrom(login, "redi_session"),
        },
        payload: { token: prepared.token },
      });
      expect(duplicateSubmit.statusCode).toBe(303);
      expect(duplicateSubmit.headers.location).toBe(
        "http://127.0.0.1:3000/sq/showcase",
      );
      const me = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: {
          host: "127.0.0.1:3001",
          cookie: cookieFrom(login, "redi_session"),
        },
      });
      expect(me.json()).toMatchObject({
        tenantId: localDemoIds.tenantId,
        roles: ["root_owner", "white_label_owner"],
      });
      const drafts = await app.inject({
        method: "GET",
        url: `/api/social/drafts?workspaceId=${localDemoIds.workspaceId}`,
        headers: {
          host: "127.0.0.1:3001",
          cookie: cookieFrom(login, "redi_session"),
        },
      });
      expect(drafts.statusCode).toBe(200);
      const parsedDrafts = parseSocialDrafts(drafts.json());
      expect(parsedDrafts).not.toBeNull();
      expect(parsedDrafts).toHaveLength(2);
      const workflow = await app.inject({
        method: "GET",
        url: `/api/social/drafts/${localDemoIds.reviewDraftId}/revisions?workspaceId=${localDemoIds.workspaceId}`,
        headers: {
          host: "127.0.0.1:3001",
          cookie: cookieFrom(login, "redi_session"),
        },
      });
      expect(workflow.statusCode).toBe(200);
      const detail = parseSocialWorkflowDetail(workflow.json());
      expect(detail).not.toBeNull();
      expect(detail?.revisions[0]?.approval?.decidedByCurrentUser).toBe(false);

      const replay = await app.inject({
        method: "POST",
        url: "/auth/local-demo",
        headers: { host: "127.0.0.1:3001" },
        payload: { token: prepared.token },
      });
      expect(replay.statusCode).toBe(403);
      const evidence = await adminPool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM control.audit_events
         WHERE tenant_id=$1 AND action='session.local_demo_created'`,
        [localDemoIds.tenantId],
      );
      expect(evidence.rows[0]?.count).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("blocks cross-tenant inserts and mutations", async () => {
    await expect(
      withTenant(runtimePool, seed.tenantA, (client) =>
        client.query(
          "INSERT INTO control.memberships (tenant_id, user_id, role) VALUES ($1, $2, 'editor')",
          [seed.tenantB, seed.adminUser],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const update = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query(
        "UPDATE control.feature_flags SET enabled = true WHERE tenant_id = $1",
        [seed.tenantB],
      ),
    );
    expect(update.rowCount).toBe(0);
  });

  it("commits audit and outbox together and keeps audit append-only", async () => {
    const auditId = randomUUID();
    await withTenant(runtimePool, seed.tenantA, async (client) => {
      await client.query(
        `INSERT INTO control.audit_events
         (id, tenant_id, actor_user_id, action, target_type, correlation_id)
         VALUES ($1, $2, $3, 'test.changed', 'test', $4)`,
        [auditId, seed.tenantA, seed.adminUser, randomUUID()],
      );
      await client.query(
        `INSERT INTO control.outbox_events
         (id, tenant_id, event_type, event_version, payload, correlation_id)
         VALUES ($1, $2, 'test.changed', 1, $3, $4)`,
        [randomUUID(), seed.tenantA, { auditId }, randomUUID()],
      );
    });
    const evidence = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query<{ audits: number; events: number }>(
        `SELECT
           (SELECT count(*)::int FROM control.audit_events WHERE id = $1) AS audits,
           (SELECT count(*)::int FROM control.outbox_events WHERE payload->>'auditId' = $1::text) AS events`,
        [auditId],
      ),
    );
    expect(evidence.rows[0]).toEqual({ audits: 1, events: 1 });
    await expect(
      adminPool.query(
        "UPDATE control.audit_events SET action = 'tampered' WHERE id = $1",
        [auditId],
      ),
    ).rejects.toThrow("audit_events are append-only");
  });

  it("rolls back audit when its matching outbox write fails", async () => {
    const auditId = randomUUID();
    await expect(
      withTenant(runtimePool, seed.tenantA, async (client) => {
        await client.query(
          `INSERT INTO control.audit_events
           (id, tenant_id, actor_user_id, action, target_type, correlation_id)
           VALUES ($1, $2, $3, 'test.rollback', 'test', $4)`,
          [auditId, seed.tenantA, seed.adminUser, randomUUID()],
        );
        throw new Error("simulate outbox failure");
      }),
    ).rejects.toThrow("simulate outbox failure");
    const result = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query("SELECT id FROM control.audit_events WHERE id = $1", [
        auditId,
      ]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("claims PostgreSQL jobs only inside the active tenant", async () => {
    for (const tenantId of [seed.tenantA, seed.tenantB]) {
      await withTenant(runtimePool, tenantId, (client) =>
        client.query(
          `INSERT INTO control.jobs
           (id, tenant_id, job_type, payload, idempotency_key, correlation_id)
           VALUES ($1, $2, 'test.job', $3, $4, $5)`,
          [randomUUID(), tenantId, { tenantId }, randomUUID(), randomUUID()],
        ),
      );
    }
    const claimed = await claimNextJob(
      runtimePool,
      seed.tenantA,
      "integration-worker",
    );
    expect(claimed?.tenantId).toBe(seed.tenantA);
    if (!claimed) throw new Error("Expected a tenant-scoped job");
    await finishJob(runtimePool, claimed, { status: "succeeded" });
    const foreign = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query("SELECT id FROM control.jobs WHERE tenant_id = $1", [
        seed.tenantB,
      ]),
    );
    expect(foreign.rowCount).toBe(0);
  });
});

describe("Milestone 1 identity, session, RBAC, and API gates", () => {
  it("stores encrypted OIDC transactions and consumes them exactly once", async () => {
    const store = new PostgresOidcTransactionStore(
      authPool,
      Buffer.alloc(32, 7),
    );
    const transaction = await store.create({
      state: "state-value",
      nonce: "nonce-value",
      codeVerifier: "pkce-verifier-value",
      redirectUri: "https://api.example.test/auth/callback",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      await store.consume({
        transaction,
        state: "wrong-state",
        redirectUri: "https://api.example.test/auth/callback",
      }),
    ).toBeNull();
    expect(
      await store.consume({
        transaction,
        state: "state-value",
        redirectUri: "https://api.example.test/auth/callback",
      }),
    ).toMatchObject({ codeVerifier: "pkce-verifier-value" });
    expect(
      await store.consume({
        transaction,
        state: "state-value",
        redirectUri: "https://api.example.test/auth/callback",
      }),
    ).toBeNull();
    const persisted = await adminPool.query<{
      transaction_hash: string;
      state_hash: string;
      nonce_hash: string;
      pkce_verifier_ciphertext: string;
      used_at: Date | null;
    }>(
      `SELECT transaction_hash, state_hash, nonce_hash,
              pkce_verifier_ciphertext, used_at
       FROM control.identity_transactions
       ORDER BY created_at DESC LIMIT 1`,
    );
    const row = persisted.rows[0];
    expect(row?.transaction_hash).not.toContain(transaction);
    expect(row?.state_hash).not.toContain("state-value");
    expect(row?.nonce_hash).not.toContain("nonce-value");
    expect(row?.pkce_verifier_ciphertext).not.toContain("pkce-verifier-value");
    expect(row?.used_at).toBeInstanceOf(Date);
  });

  it("bootstraps exactly one MFA-verified first owner with an installation-bound invitation", async () => {
    const email = `first-owner-${randomUUID()}@example.invalid`;
    const invitationStore = new FirstOwnerInvitationStore(adminPool);
    const expiredInvitation = await invitationStore.issue({
      tenantId: seed.tenantA,
      installationId: seed.installationA,
      email,
      expiresAt: new Date(Date.now() + 60_000),
      correlationId: randomUUID(),
    });
    await adminPool.query(
      `UPDATE control.first_owner_invitations
       SET created_at = now() - interval '2 minutes',
           expires_at = now() - interval '1 minute'
       WHERE id = (
         SELECT id FROM control.first_owner_invitations
         WHERE installation_id = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       )`,
      [seed.installationA],
    );
    expect(
      await new FirstOwnerInvitationStore(authPool).isUsable(
        expiredInvitation,
        seed.installationA,
      ),
    ).toBe(false);
    const invitation = await invitationStore.issue({
      tenantId: seed.tenantA,
      installationId: seed.installationA,
      email,
      expiresAt: new Date(Date.now() + 60_000),
      correlationId: randomUUID(),
    });
    await expect(
      invitationStore.issue({
        tenantId: seed.tenantA,
        installationId: seed.installationA,
        email,
        expiresAt: new Date(Date.now() + 60_000),
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("invalid or unavailable");
    const stored = await adminPool.query<{ serialized: string }>(
      `SELECT row_to_json(invitation)::text AS serialized
       FROM control.first_owner_invitations invitation
       WHERE installation_id = $1`,
      [seed.installationA],
    );
    expect(stored.rows[0]?.serialized).not.toContain(invitation);
    expect(stored.rows[0]?.serialized).not.toContain(email);
    expect(
      await new FirstOwnerInvitationStore(authPool).isUsable(
        invitation,
        seed.installationB,
      ),
    ).toBe(false);
    await expect(
      new SessionStore(authPool).createFirstOwner(
        {
          provider: "oidc-test",
          subject: "wrong-email-subject",
          email: `wrong-${email}`,
          emailVerified: true,
          mfaVerified: true,
        },
        invitation,
        seed.installationA,
        randomUUID(),
      ),
    ).rejects.toThrow("invalid or unavailable");

    const resolver = new InstallationResolver(
      runtimePool,
      "test",
      new Set([seed.canonicalDomainA, seed.canonicalDomainB]),
    );
    const wrongMfaApp = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      identity: new TestIdentityAdapter({
        provider: "oidc-test",
        subject: "first-owner-subject",
        email,
        emailVerified: true,
        mfaVerified: false,
      }),
      installationResolver: resolver,
      cookieSecure: false,
    });
    await wrongMfaApp.ready();
    try {
      const begin = await wrongMfaApp.inject({
        method: "POST",
        url: "/auth/bootstrap",
        headers: { host: seed.canonicalDomainA },
        payload: { token: invitation },
      });
      const callback = await wrongMfaApp.inject({
        method: "GET",
        url: "/auth/callback?code=valid-code&state=test-state",
        headers: {
          host: seed.canonicalDomainA,
          cookie: `${cookieFrom(begin, "redi_identity_tx")}; ${cookieFrom(begin, "redi_first_owner_invitation")}`,
        },
      });
      expect(callback.statusCode).toBe(403);
    } finally {
      await wrongMfaApp.close();
    }

    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      identity: new TestIdentityAdapter({
        provider: "oidc-test",
        subject: "first-owner-subject",
        email,
        emailVerified: true,
        mfaVerified: true,
      }),
      installationResolver: resolver,
      cookieSecure: false,
    });
    await app.ready();
    try {
      const crossInstallation = await app.inject({
        method: "POST",
        url: "/auth/bootstrap",
        headers: { host: seed.canonicalDomainB },
        payload: { token: invitation },
      });
      expect(crossInstallation.statusCode).toBe(403);
      const begin = await app.inject({
        method: "POST",
        url: "/auth/bootstrap",
        headers: { host: seed.canonicalDomainA },
        payload: { token: invitation },
      });
      expect(begin.statusCode).toBe(302);
      const callback = await app.inject({
        method: "GET",
        url: "/auth/callback?code=valid-code&state=test-state",
        headers: {
          host: seed.canonicalDomainA,
          cookie: `${cookieFrom(begin, "redi_identity_tx")}; ${cookieFrom(begin, "redi_first_owner_invitation")}`,
        },
      });
      expect(callback.statusCode).toBe(303);
      expect(callback.headers.location).toBe("/");
      const me = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: {
          host: seed.canonicalDomainA,
          cookie: cookieFrom(callback, "redi_session"),
        },
      });
      expect(me.json()).toMatchObject({
        tenantId: seed.tenantA,
        roles: ["root_owner"],
      });
      const replay = await app.inject({
        method: "POST",
        url: "/auth/bootstrap",
        headers: { host: seed.canonicalDomainA },
        payload: { token: invitation },
      });
      expect(replay.statusCode).toBe(403);
      const evidence = await adminPool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM control.audit_events
         WHERE action = 'identity.first_owner_bootstrapped'
           AND tenant_id = $1`,
        [seed.tenantA],
      );
      expect(evidence.rows[0]?.count).toBe(1);
    } finally {
      await app.close();
      await adminPool.query(
        `UPDATE control.memberships membership
         SET role = 'editor'
         FROM control.users identity_user
         WHERE membership.user_id = identity_user.id
           AND membership.tenant_id = $1
           AND membership.role = 'root_owner'
           AND identity_user.identity_subject = 'oidc-test|first-owner-subject'`,
        [seed.tenantA],
      );
    }
  });

  it("stores opaque sessions as hashes, validates CSRF, rotates, and revokes", async () => {
    const store = new SessionStore(authPool);
    const created = await store.create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const persisted = await adminPool.query<{ token_hash: string }>(
      "SELECT token_hash FROM control.sessions WHERE id = $1",
      [created.sessionId],
    );
    expect(persisted.rows[0]?.token_hash).not.toBe(created.token);
    expect(await store.verifyCsrf(created.sessionId, created.csrfToken)).toBe(
      true,
    );
    expect(await store.verifyCsrf(created.sessionId, "wrong-token")).toBe(
      false,
    );
    const replacement = await store.rotate(created.token);
    expect(replacement?.token).not.toBe(created.token);
    expect(await store.resolve(created.token)).toBeNull();
    expect(await store.revoke(replacement?.token ?? "")).not.toBeNull();
    expect(await store.resolve(replacement?.token ?? "")).toBeNull();
  });

  it("reports real readiness and enforces RBAC, MFA, CSRF, flags, audit, and outbox", async () => {
    const identity = new TestIdentityAdapter({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      identity,
      installationResolver: new InstallationResolver(
        runtimePool,
        "test",
        new Set([seed.canonicalDomainA, seed.canonicalDomainB]),
      ),
      cookieSecure: false,
    });
    await app.ready();
    try {
      expect(
        (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "GET", url: "/health/ingress" }))
          .statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
      ).toBe(200);

      const login = await app.inject({
        method: "GET",
        url: "/auth/login?returnTo=%2Fsq%2Fworkzone%2Fboard",
        headers: { host: seed.canonicalDomainA },
      });
      expect(login.statusCode).toBe(302);
      const transactionCookie = cookieFrom(login, "redi_identity_tx");
      const postLoginCookie = cookieFrom(login, "redi_post_login");
      const callback = await app.inject({
        method: "GET",
        url: "/auth/callback?code=valid-code&state=test-state",
        headers: {
          host: seed.canonicalDomainA,
          cookie: `${transactionCookie}; ${postLoginCookie}`,
        },
      });
      expect(callback.statusCode).toBe(303);
      expect(callback.headers.location).toBe("/sq/workzone/board");
      const sessionCookie = cookieFrom(callback, "redi_session");
      const csrfCookie = cookieFrom(callback, "redi_csrf");
      const csrf = csrfCookie.slice("redi_csrf=".length);
      const cookies = `${sessionCookie}; ${csrfCookie}`;

      const me = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { host: seed.canonicalDomainA, cookie: cookies },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        tenantId: seed.tenantA,
        roles: ["white_label_owner"],
      });
      const members = await app.inject({
        method: "GET",
        url: "/api/memberships",
        headers: { host: seed.canonicalDomainA, cookie: cookies },
      });
      expect(members.statusCode).toBe(200);
      const membershipPayload = members.json<{
        members: Array<{ userId: string; roles: string[] }>;
      }>();
      expect(membershipPayload.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: seed.adminUser,
            roles: ["white_label_owner"],
          }),
        ]),
      );
      expect(
        membershipPayload.members.some(
          (member) => member.userId === seed.analystUser,
        ),
      ).toBe(false);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/modules/social",
            headers: { host: seed.canonicalDomainA, cookie: cookies },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/modules/overview",
            headers: { host: seed.canonicalDomainA, cookie: cookies },
          })
        ).statusCode,
      ).toBe(200);

      const missingCsrf = await app.inject({
        method: "POST",
        url: "/api/memberships",
        headers: { host: seed.canonicalDomainA, cookie: cookies },
        payload: { userId: seed.analystUser, role: "editor" },
      });
      expect(missingCsrf.statusCode).toBe(403);
      const grant = await app.inject({
        method: "POST",
        url: "/api/memberships",
        headers: {
          host: seed.canonicalDomainA,
          cookie: cookies,
          "x-csrf-token": csrf,
        },
        payload: { userId: seed.analystUser, role: "editor" },
      });
      expect(grant.statusCode).toBe(204);
      const audit = await app.inject({
        method: "GET",
        url: "/api/audit",
        headers: { host: seed.canonicalDomainA, cookie: cookies },
      });
      expect(audit.statusCode).toBe(200);
      expect(
        audit
          .json<{ events: Array<{ action: string }> }>()
          .events.some((event) => event.action === "membership.granted"),
      ).toBe(true);
      const outbox = await withTenant(runtimePool, seed.tenantA, (client) =>
        client.query(
          "SELECT id FROM control.outbox_events WHERE event_type = 'membership.granted'",
        ),
      );
      expect(outbox.rowCount).toBe(1);

      const lastOwner = await app.inject({
        method: "DELETE",
        url: `/api/memberships/${seed.adminUser}/white_label_owner`,
        headers: {
          host: seed.canonicalDomainA,
          cookie: cookies,
          "x-csrf-token": csrf,
        },
      });
      expect(lastOwner.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("requires MFA for sensitive owner operations", async () => {
    const store = new SessionStore(authPool);
    const session = await store.create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: false,
    });
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      cookieSecure: false,
    });
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/memberships",
        headers: {
          cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
          "x-csrf-token": session.csrfToken,
        },
        payload: { userId: seed.analystUser, role: "editor" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: "MFA is required" });
    } finally {
      await app.close();
    }
  });

  it("denies analyst access to audit and denies tenant switching without membership", async () => {
    const inaccessibleTenant = randomUUID();
    await adminPool.query(
      "INSERT INTO control.tenants (id, slug, display_name) VALUES ($1, $2, 'Inaccessible Tenant')",
      [inaccessibleTenant, `inaccessible-${inaccessibleTenant.slice(0, 8)}`],
    );
    const identity = new TestIdentityAdapter({
      provider: "local",
      subject: seed.analystSubject,
      email: `analyst-${seed.analystUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: false,
    });
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      identity,
      installationResolver: new InstallationResolver(
        runtimePool,
        "test",
        new Set([seed.canonicalDomainA, seed.canonicalDomainB]),
      ),
      cookieSecure: false,
    });
    await app.ready();
    try {
      const login = await app.inject({
        method: "GET",
        url: "/auth/login",
        headers: { host: seed.canonicalDomainB },
      });
      const callback = await app.inject({
        method: "GET",
        url: "/auth/callback?code=valid-code&state=test-state",
        headers: {
          host: seed.canonicalDomainB,
          cookie: cookieFrom(login, "redi_identity_tx"),
        },
      });
      const sessionCookie = cookieFrom(callback, "redi_session");
      const csrfCookie = cookieFrom(callback, "redi_csrf");
      const cookies = `${sessionCookie}; ${csrfCookie}`;
      const initialTenant = (
        await app.inject({
          method: "GET",
          url: "/api/me",
          headers: { host: seed.canonicalDomainB, cookie: cookies },
        })
      ).json<{ tenantId: string }>().tenantId;
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/audit",
            headers: { host: seed.canonicalDomainB, cookie: cookies },
          })
        ).statusCode,
      ).toBe(403);
      const switched = await app.inject({
        method: "POST",
        url: "/api/session/tenant",
        headers: {
          host: seed.canonicalDomainB,
          cookie: cookies,
          "x-csrf-token": csrfCookie.slice("redi_csrf=".length),
        },
        payload: { tenantId: inaccessibleTenant },
      });
      expect(switched.statusCode).toBe(403);
      const stillOwn = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { host: seed.canonicalDomainB, cookie: cookies },
      });
      expect(stillOwn.json()).toMatchObject({ tenantId: initialTenant });
    } finally {
      await app.close();
    }
  });

  it("returns a dashboard overview only for the session tenant workspace", async () => {
    const store = new SessionStore(authPool);
    const session = await store.create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      cookieSecure: false,
    });
    await app.ready();
    try {
      const headers = {
        cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
      };
      const own = await app.inject({
        method: "GET",
        url: `/api/dashboard/overview?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(own.statusCode).toBe(200);
      const overview = own.json<{
        workspace: { id: string };
        counts: {
          readyMedia: number;
          socialAccounts: number;
          pendingApprovals: number;
        };
        channels: Array<{ name: string; status: string }>;
      }>();
      expect(overview.workspace.id).toBe(seed.workspaceA);
      expect(overview.counts.readyMedia).toBeTypeOf("number");
      expect(overview.counts.socialAccounts).toBeTypeOf("number");
      expect(overview.counts.pendingApprovals).toBeTypeOf("number");
      expect(overview.channels).toEqual([
        { name: "website", status: "not_connected" },
        { name: "facebook", status: "not_connected" },
        { name: "instagram", status: "not_connected" },
        { name: "tiktok", status: "planned" },
        { name: "email", status: "not_connected" },
        { name: "whatsapp", status: "planned" },
      ]);
      const foreign = await app.inject({
        method: "GET",
        url: `/api/dashboard/overview?workspaceId=${seed.workspaceB}`,
        headers,
      });
      expect(foreign.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns a bounded Media Workzone only for the session tenant workspace", async () => {
    const store = new SessionStore(authPool);
    const session = await store.create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      cookieSecure: false,
    });
    await app.ready();
    try {
      const headers = {
        cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
      };
      const own = await app.inject({
        method: "GET",
        url: `/api/workzone/overview?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(own.statusCode).toBe(200);
      const workzone = own.json<{
        workspace: { id: string };
        pipeline: Record<string, number>;
        resources: { readyMedia: number; teamMembers: number };
        channels: Array<{ name: string; status: string }>;
        models: {
          externalExecutionAvailable: boolean;
          routes: Array<Record<string, unknown>>;
        };
      }>();
      expect(workzone.workspace.id).toBe(seed.workspaceA);
      expect(
        Object.values(workzone.pipeline).every(
          (value) => Number.isInteger(value) && value >= 0,
        ),
      ).toBe(true);
      expect(workzone.resources.teamMembers).toBeGreaterThan(0);
      expect(workzone.channels.map((channel) => channel.name)).toEqual([
        "website",
        "facebook",
        "instagram",
        "youtube",
        "tiktok",
      ]);
      expect(workzone.models.externalExecutionAvailable).toBe(false);
      expect(
        workzone.models.routes.every(
          (route) =>
            !("provider_id" in route) &&
            !("providerId" in route) &&
            !("secret" in route),
        ),
      ).toBe(true);

      const foreign = await app.inject({
        method: "GET",
        url: `/api/workzone/overview?workspaceId=${seed.workspaceB}`,
        headers,
      });
      expect(foreign.statusCode).toBe(404);
      const override = await app.inject({
        method: "GET",
        url: `/api/workzone/overview?workspaceId=${seed.workspaceA}&tenantId=${seed.tenantB}`,
        headers,
      });
      expect(override.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("joins promoted research and direct content in a tenant-safe editorial workboard", async () => {
    const profileId = randomUUID();
    const linkedResearchId = randomUUID();
    const unlinkedResearchId = randomUUID();
    const contentItemId = randomUUID();
    const nonMemberUserId = randomUUID();
    await adminPool.query(
      `INSERT INTO control.users(id,identity_subject,email)
       VALUES($1,$2,$3)`,
      [
        nonMemberUserId,
        `local|non-member-${nonMemberUserId}`,
        `non-member-${nonMemberUserId}@example.invalid`,
      ],
    );
    await withTenant(runtimePool, seed.tenantA, async (client) => {
      await client.query(
        `INSERT INTO control.media_profiles
         (id,tenant_id,workspace_id,name,publication_identity,locale,created_by,updated_by)
         VALUES ($1,$2,$3,$4,'Workboard test publication','sq',$5,$5)`,
        [
          profileId,
          seed.tenantA,
          seed.workspaceA,
          `Workboard ${profileId}`,
          seed.adminUser,
        ],
      );
      await client.query(
        `INSERT INTO control.research_cases
         (id,tenant_id,workspace_id,media_profile_id,title,topic,status,created_by,updated_by)
         VALUES
         ($1,$2,$3,$4,'Linked research','Linked topic','promoted',$5,$5),
         ($6,$2,$3,$4,'Unlinked research','Unlinked topic','researching',$5,$5)`,
        [
          linkedResearchId,
          seed.tenantA,
          seed.workspaceA,
          profileId,
          seed.adminUser,
          unlinkedResearchId,
        ],
      );
      await client.query(
        `INSERT INTO control.research_case_sources
         (id,tenant_id,workspace_id,research_case_id,source_ref,title,retrieved_at,source_type,tier,provenance,created_by)
         VALUES ($1,$2,$3,$4,'https://source.example/story','Primary source',now(),'website','primary','{}'::jsonb,$5)`,
        [
          randomUUID(),
          seed.tenantA,
          seed.workspaceA,
          linkedResearchId,
          seed.adminUser,
        ],
      );
      await client.query(
        `INSERT INTO control.research_claims
         (id,tenant_id,workspace_id,research_case_id,statement,importance,verification_state,verification_explanation,created_by,updated_by)
         VALUES ($1,$2,$3,$4,'Verified workboard claim','high','verified','Confirmed by the recorded source',$5,$5)`,
        [
          randomUUID(),
          seed.tenantA,
          seed.workspaceA,
          linkedResearchId,
          seed.adminUser,
        ],
      );
      await client.query(
        `INSERT INTO control.content_items
         (id,tenant_id,workspace_id,title,summary,created_by,updated_by)
         VALUES ($1,$2,$3,'Promoted content','Current content summary',$4,$4)`,
        [contentItemId, seed.tenantA, seed.workspaceA, seed.adminUser],
      );
      await client.query(
        `INSERT INTO control.editorial_candidates
         (id,tenant_id,workspace_id,research_case_id,title,summary,status,ranking_explanation,created_by,content_item_id)
         VALUES ($1,$2,$3,$4,'Promoted content','Current content summary','promoted','Human-approved test bridge',$5,$6)`,
        [
          randomUUID(),
          seed.tenantA,
          seed.workspaceA,
          linkedResearchId,
          seed.adminUser,
          contentItemId,
        ],
      );
    });

    await expect(
      withTenant(runtimePool, seed.tenantA, (client) =>
        client.query(
          `INSERT INTO control.editorial_story_assignments
           (id,tenant_id,workspace_id,research_case_id,assignee_user_id,assigned_by_user_id)
           VALUES($1,$2,$3,$4,$5,$5)`,
          [
            randomUUID(),
            seed.tenantB,
            seed.workspaceA,
            linkedResearchId,
            seed.adminUser,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const store = new SessionStore(authPool);
    const session = await store.create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    const app = buildApp({
      database: { runtime: runtimePool, auth: authPool },
      cookieSecure: false,
    });
    await app.ready();
    try {
      const overdueAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const headers = {
        cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
      };
      const assignmentResponse = await app.inject({
        method: "PUT",
        url: `/api/workzone/stories/content/${contentItemId}/assignment`,
        headers: { ...headers, "x-csrf-token": session.csrfToken },
        payload: {
          workspaceId: seed.workspaceA,
          assigneeUserId: seed.adminUser,
          priority: "high",
          dueAt: overdueAt,
          note: "Prepare the morning review",
        },
      });
      expect(assignmentResponse.statusCode).toBe(200);

      const foreignAssignee = await app.inject({
        method: "PUT",
        url: `/api/workzone/stories/content/${contentItemId}/assignment`,
        headers: { ...headers, "x-csrf-token": session.csrfToken },
        payload: {
          workspaceId: seed.workspaceA,
          assigneeUserId: nonMemberUserId,
          priority: "normal",
        },
      });
      expect(foreignAssignee.statusCode).toBe(409);

      const tenantOverride = await app.inject({
        method: "PUT",
        url: `/api/workzone/stories/content/${contentItemId}/assignment`,
        headers: { ...headers, "x-csrf-token": session.csrfToken },
        payload: {
          workspaceId: seed.workspaceA,
          tenantId: seed.tenantB,
          assigneeUserId: seed.adminUser,
          priority: "normal",
        },
      });
      expect(tenantOverride.statusCode).toBe(400);

      const response = await app.inject({
        method: "GET",
        url: `/api/workzone/stories?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      const workboard = response.json<{
        evaluatedAt: string;
        counts: Record<string, number>;
        queue: {
          mine: number;
          unassigned: number;
          overdue: number;
          dueSoon: number;
          attention: number;
        };
        workload: {
          visibility: string;
          coverage: {
            loadedStories: number;
            limit: number;
            complete: boolean;
          };
          unassigned: number;
          members: Array<{
            userId: string;
            total: number;
            overdue: number;
            attention: number;
            nextDueAt: string | null;
          }>;
        };
        permissions: { canManageAssignments: boolean; mfaVerified: boolean };
        team: Array<{ userId: string; email: string; roles: string[] }>;
        stories: Array<{
          id: string;
          origin: string;
          stage: string;
          needsAttention: boolean;
          research: {
            id: string;
            sourceCount: number;
            claimCount: number;
            verifiedClaimCount: number;
          } | null;
          content: { id: string } | null;
          destinations: Array<Record<string, unknown>>;
          assignment: {
            assignee: { userId: string; email: string };
            mine: boolean;
            priority: string;
            dueAt: string | null;
            dueState: string;
            note: string;
          } | null;
          handoff: {
            state: string;
            completed: number;
            applicable: number;
            checks: Record<string, string>;
          };
        }>;
      }>();
      const promoted = workboard.stories.find(
        (story) => story.id === contentItemId,
      );
      expect(promoted).toMatchObject({
        origin: "content",
        stage: "drafting",
        needsAttention: true,
        research: {
          id: linkedResearchId,
          sourceCount: 1,
          claimCount: 1,
          verifiedClaimCount: 1,
        },
        content: { id: contentItemId },
        destinations: [],
        assignment: {
          assignee: { userId: seed.adminUser },
          mine: true,
          priority: "high",
          dueAt: overdueAt,
          dueState: "overdue",
          note: "Prepare the morning review",
        },
        handoff: {
          state: "review",
          completed: 3,
          applicable: 5,
          checks: {
            ownership: "complete",
            evidence: "complete",
            content: "complete",
            review: "pending",
            delivery: "pending",
          },
        },
      });
      expect(workboard.permissions).toEqual({
        canManageAssignments: true,
        mfaVerified: true,
      });
      expect(workboard.team).toContainEqual(
        expect.objectContaining({ userId: seed.adminUser }),
      );
      expect(
        workboard.stories.filter(
          (story) => story.research?.id === linkedResearchId,
        ),
      ).toHaveLength(1);
      expect(workboard.stories).toContainEqual(
        expect.objectContaining({
          id: unlinkedResearchId,
          origin: "research",
          stage: "research",
          content: null,
          handoff: {
            state: "needs_owner",
            completed: 0,
            applicable: 5,
            checks: {
              ownership: "pending",
              evidence: "pending",
              content: "pending",
              review: "pending",
              delivery: "pending",
            },
          },
        }),
      );
      expect(workboard.counts.drafting).toBeGreaterThanOrEqual(1);
      expect(workboard.counts.research).toBeGreaterThanOrEqual(1);
      expect(Date.parse(workboard.evaluatedAt)).not.toBeNaN();
      expect(workboard.queue).toMatchObject({
        mine: 1,
        overdue: 1,
        attention: 1,
      });
      expect(workboard.workload).toMatchObject({
        visibility: "full_team",
        coverage: {
          loadedStories: workboard.stories.length,
          limit: 80,
          complete: true,
        },
        unassigned: 1,
      });
      expect(
        workboard.workload.members.find(
          (member) => member.userId === seed.adminUser,
        ),
      ).toMatchObject({
        total: 1,
        overdue: 1,
        attention: 1,
        nextDueAt: overdueAt,
      });

      const boundedWorkboard = await app.inject({
        method: "GET",
        url: `/api/workzone/stories?workspaceId=${seed.workspaceA}&limit=1`,
        headers,
      });
      expect(boundedWorkboard.statusCode).toBe(200);
      expect(
        boundedWorkboard.json<{
          stories: unknown[];
          workload: {
            coverage: {
              loadedStories: number;
              limit: number;
              complete: boolean;
            };
          };
        }>(),
      ).toMatchObject({
        stories: [expect.any(Object)],
        workload: {
          coverage: { loadedStories: 1, limit: 1, complete: false },
        },
      });

      const foreign = await app.inject({
        method: "GET",
        url: `/api/workzone/stories?workspaceId=${seed.workspaceB}`,
        headers,
      });
      expect(foreign.statusCode).toBe(404);
      const override = await app.inject({
        method: "GET",
        url: `/api/workzone/stories?workspaceId=${seed.workspaceA}&tenantId=${seed.tenantB}`,
        headers,
      });
      expect(override.statusCode).toBe(400);

      const persistence = await withTenant(
        runtimePool,
        seed.tenantA,
        (client) =>
          client.query<{
            research_case_id: string | null;
            content_item_id: string | null;
            audits: number;
            outbox: number;
          }>(
            `SELECT assignment.research_case_id,assignment.content_item_id,
               (SELECT count(*)::int FROM control.audit_events
                WHERE action='workzone.story_assigned' AND target_id=assignment.id::text) AS audits,
               (SELECT count(*)::int FROM control.outbox_events
                WHERE event_type='workzone.story_assigned'
                  AND payload->>'targetId'=assignment.id::text) AS outbox
             FROM control.editorial_story_assignments assignment
             WHERE assignment.research_case_id=$1`,
            [linkedResearchId],
          ),
      );
      expect(persistence.rows[0]).toEqual({
        research_case_id: linkedResearchId,
        content_item_id: null,
        audits: 1,
        outbox: 1,
      });

      const noMfaSession = await store.create({
        provider: "local",
        subject: seed.adminSubject,
        email: `admin-${seed.adminUser}@example.invalid`,
        emailVerified: true,
        mfaVerified: false,
      });
      const assignedOnly = await app.inject({
        method: "GET",
        url: `/api/workzone/stories?workspaceId=${seed.workspaceA}`,
        headers: { cookie: `redi_session=${noMfaSession.token}` },
      });
      expect(assignedOnly.statusCode).toBe(200);
      expect(
        assignedOnly.json<{
          team: unknown[];
          workload: { visibility: string; members: Array<{ userId: string }> };
        }>(),
      ).toMatchObject({
        team: [],
        workload: {
          visibility: "assigned_members_only",
          members: [{ userId: seed.adminUser }],
        },
      });
      const noMfa = await app.inject({
        method: "DELETE",
        url: `/api/workzone/stories/content/${contentItemId}/assignment?workspaceId=${seed.workspaceA}`,
        headers: {
          cookie: `redi_session=${noMfaSession.token}; redi_csrf=${noMfaSession.csrfToken}`,
          "x-csrf-token": noMfaSession.csrfToken,
        },
      });
      expect(noMfa.statusCode).toBe(403);

      const removed = await app.inject({
        method: "DELETE",
        url: `/api/workzone/stories/content/${contentItemId}/assignment?workspaceId=${seed.workspaceA}`,
        headers: { ...headers, "x-csrf-token": session.csrfToken },
      });
      expect(removed.statusCode).toBe(204);
      const afterRemoval = await app.inject({
        method: "GET",
        url: `/api/workzone/stories?workspaceId=${seed.workspaceA}`,
        headers,
      });
      expect(
        afterRemoval
          .json<{ stories: Array<{ id: string; assignment: unknown }> }>()
          .stories.find((story) => story.id === contentItemId)?.assignment,
      ).toBeNull();
    } finally {
      await app.close();
    }
  });
});
