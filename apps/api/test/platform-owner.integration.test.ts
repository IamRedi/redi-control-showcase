import { createHash, randomUUID } from "node:crypto";

import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import {
  FirstOwnerInvitationStore,
  SessionStore,
} from "@redi-control/identity";
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
const admin = createPool(adminUrl, "platform-owner-admin");
const runtime = createPool(runtimeUrl, "platform-owner-runtime");
const auth = createPool(authUrl, "platform-owner-auth");

let seed: SeedResult;
let app: ReturnType<typeof buildApp>;
let ownerA: Awaited<ReturnType<SessionStore["create"]>>;
let ownerB: Awaited<ReturnType<SessionStore["create"]>>;
let ordinary: Awaited<ReturnType<SessionStore["create"]>>;
let grantA = "";
let grantB = "";
let provisionedTenant = "";

const mutationHeaders = (
  session: Awaited<ReturnType<SessionStore["create"]>>,
  grant?: string,
) => ({
  cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
  "x-csrf-token": session.csrfToken,
  ...(grant ? { "x-platform-access-grant": grant } : {}),
});

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  const sessions = new SessionStore(auth);
  const ordinaryUser = randomUUID();
  const ordinarySubject = `ordinary-${randomUUID()}`;
  await admin.query(
    `INSERT INTO control.users(id,identity_subject,email) VALUES($1,$2,$3)`,
    [
      ordinaryUser,
      `local|${ordinarySubject}`,
      `ordinary-${ordinaryUser}@example.invalid`,
    ],
  );
  await admin.query(
    `INSERT INTO control.memberships(tenant_id,user_id,role)
     VALUES($1,$2,'white_label_owner')`,
    [seed.tenantA, ordinaryUser],
  );
  ordinary = await sessions.create({
    provider: "local",
    subject: ordinarySubject,
    email: `ordinary-${ordinaryUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  await admin.query(
    `INSERT INTO control.memberships(tenant_id,user_id,role)
     VALUES($1,$2,'root_owner'),($3,$4,'root_owner')`,
    [seed.tenantA, seed.adminUser, seed.tenantB, seed.analystUser],
  );
  ownerA = await sessions.create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  ownerB = await sessions.create({
    provider: "local",
    subject: seed.analystSubject,
    email: `analyst-${seed.analystUser}@example.invalid`,
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

describe("Platform Owner Console", () => {
  it("requires the exact Root Owner role, CSRF, and recent MFA", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/platform-owner/access",
      headers: mutationHeaders(ordinary),
      payload: { reason: "Review the platform inventory", lifetimeMinutes: 15 },
    });
    expect(denied.statusCode).toBe(403);

    await admin.query(
      "UPDATE control.sessions SET mfa_verified_at=now()-interval '10 minutes' WHERE id=$1",
      [ownerA.sessionId],
    );
    const stale = await app.inject({
      method: "POST",
      url: "/api/platform-owner/access",
      headers: mutationHeaders(ownerA),
      payload: { reason: "Review the platform inventory", lifetimeMinutes: 15 },
    });
    expect(stale.statusCode).toBe(403);
    await admin.query(
      "UPDATE control.sessions SET mfa_verified_at=now() WHERE id=$1",
      [ownerA.sessionId],
    );
  });

  it("opens short reason-coded access without granting direct global table access", async () => {
    const access = await app.inject({
      method: "POST",
      url: "/api/platform-owner/access",
      headers: mutationHeaders(ownerA),
      payload: {
        reason: "Provision and review customer tenant shells",
        lifetimeMinutes: 20,
      },
    });
    expect(access.statusCode).toBe(201);
    grantA = access.json<{ id: string }>().id;
    expect(grantA).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      withTenant(runtime, seed.tenantA, (client) =>
        client.query("SELECT * FROM control.platform_access_grants"),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const inventory = await app.inject({
      method: "GET",
      url: "/api/platform-owner/tenants",
      headers: {
        cookie: `redi_session=${ownerA.token}`,
        "x-platform-access-grant": grantA,
      },
    });
    expect(inventory.statusCode).toBe(200);
    const body = inventory.json<{
      tenants: unknown[];
      impersonationAvailable: boolean;
    }>();
    expect(body.tenants).toHaveLength(2);
    expect(body.impersonationAvailable).toBe(false);
  });

  it("provisions only an inactive installation shell with no account or provider links", async () => {
    const slug = `press-${randomUUID().slice(0, 8)}`;
    const created = await app.inject({
      method: "POST",
      url: "/api/platform-owner/tenants",
      headers: mutationHeaders(ownerA, grantA),
      payload: {
        tenantSlug: slug,
        tenantName: "Regional Press",
        installationSlug: `${slug}-install`,
        installationName: "Regional Press Control",
        workspaceName: "Regional Newsroom",
        dataRegion: "DE",
      },
    });
    expect(created.statusCode).toBe(201);
    const tenantId = created.json<{ tenantId: string }>().tenantId;
    provisionedTenant = tenantId;
    const evidence = await admin.query<{
      installation_status: string;
      memberships: number;
      domains: number;
      social_accounts: number;
    }>(
      `SELECT installation.status::text installation_status,
        (SELECT count(*)::int FROM control.memberships WHERE tenant_id=$1) memberships,
        (SELECT count(*)::int FROM control.installation_domains WHERE tenant_id=$1) domains,
        (SELECT count(*)::int FROM control.social_accounts WHERE tenant_id=$1) social_accounts
       FROM control.white_label_installations installation WHERE installation.tenant_id=$1`,
      [tenantId],
    );
    expect(evidence.rows[0]).toEqual({
      installation_status: "pending",
      memberships: 0,
      domains: 0,
      social_accounts: 0,
    });
  });

  it("applies server-defined SaaS packages without activating owner, domain, or provider access", async () => {
    const configured = await app.inject({
      method: "PUT",
      url: `/api/platform-owner/tenants/${provisionedTenant}/setup`,
      headers: mutationHeaders(ownerA, grantA),
      payload: {
        templateId: "media_team",
        defaultLocale: "sq",
        enabledLocales: ["sq", "en"],
        brandAccent: "#36B7E5",
      },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({ setupStatus: "awaiting_owner" });
    const evidence = await admin.query<{
      status: string;
      plan_id: string;
      maximum_users: number;
      maximum_workspaces: number;
      maximum_social_accounts: number;
      provider_count: number;
      modules: string[];
      default_locale: string;
      enabled_locales: string[];
      members: number;
      domains: number;
      providers: number;
    }>(
      `SELECT installation.status::text status,entitlement.plan_id,
        entitlement.maximum_users,entitlement.maximum_workspaces,
        entitlement.maximum_social_accounts,
        cardinality(entitlement.provider_availability)::int provider_count,
        entitlement.enabled_modules modules,profile.default_locale,
        profile.enabled_locales,
        (SELECT count(*)::int FROM control.memberships WHERE tenant_id=$1) members,
        (SELECT count(*)::int FROM control.installation_domains WHERE tenant_id=$1) domains,
        (SELECT count(*)::int FROM control.social_accounts WHERE tenant_id=$1) providers
       FROM control.white_label_installations installation
       JOIN control.installation_entitlements entitlement ON entitlement.installation_id=installation.id
       JOIN control.installation_profiles profile ON profile.installation_id=installation.id
       WHERE installation.tenant_id=$1`,
      [provisionedTenant],
    );
    expect(evidence.rows[0]).toMatchObject({
      status: "pending",
      plan_id: "media_team",
      maximum_users: 15,
      maximum_workspaces: 2,
      maximum_social_accounts: 15,
      provider_count: 0,
      default_locale: "sq",
      members: 0,
      domains: 0,
      providers: 0,
    });
    expect(evidence.rows[0]?.modules).toContain("media_intelligence");
    expect(evidence.rows[0]?.modules).toContain("ai");
    expect(evidence.rows[0]?.enabled_locales.sort()).toEqual(["en", "sq"]);

    const inventory = await app.inject({
      method: "GET",
      url: "/api/platform-owner/tenants",
      headers: {
        cookie: `redi_session=${ownerA.token}`,
        "x-platform-access-grant": grantA,
      },
    });
    const inventoryBody = inventory.json<{
      tenantSetups: Array<{ targetTenantId: string; status: string }>;
      templates: Array<{ id: string }>;
    }>();
    expect(inventoryBody.tenantSetups).toMatchObject([
      { targetTenantId: provisionedTenant, status: "awaiting_owner" },
    ]);
    expect(inventoryBody.templates.map((template) => template.id)).toEqual([
      "media_starter",
      "media_team",
      "media_network",
    ]);
  });

  it("keeps customer onboarding blocked until external gates pass and binds the first owner per tenant", async () => {
    const slug = `onboarding-${randomUUID().slice(0, 8)}`;
    const shell = await app.inject({
      method: "POST",
      url: "/api/platform-owner/tenants",
      headers: mutationHeaders(ownerA, grantA),
      payload: {
        tenantSlug: slug,
        tenantName: "Onboarding Daily",
        installationSlug: `${slug}-install`,
        installationName: "Onboarding Daily Control",
        workspaceName: "Onboarding Newsroom",
        dataRegion: "DE",
      },
    });
    expect(shell.statusCode).toBe(201);
    const onboardingTenant = shell.json<{ tenantId: string }>().tenantId;
    const configured = await app.inject({
      method: "PUT",
      url: `/api/platform-owner/tenants/${onboardingTenant}/setup`,
      headers: mutationHeaders(ownerA, grantA),
      payload: {
        templateId: "media_starter",
        defaultLocale: "sq",
        enabledLocales: ["sq", "en"],
        brandAccent: "#36B7E5",
      },
    });
    expect(configured.statusCode).toBe(200);
    const inventory = async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/platform-owner/tenants",
        headers: {
          cookie: `redi_session=${ownerA.token}`,
          "x-platform-access-grant": grantA,
        },
      });
      expect(response.statusCode).toBe(200);
      return response
        .json<{
          onboarding: Array<{
            targetTenantId: string;
            installationId: string;
            installationStatus: string;
            domainStatus: string;
            ownerCount: number;
            invitationStatus: string;
            invitationEligible: boolean;
            pendingInvitationId: string | null;
            blockers: string[];
          }>;
        }>()
        .onboarding.find((item) => item.targetTenantId === onboardingTenant)!;
    };
    const blocked = await inventory();
    expect(blocked).toMatchObject({
      installationStatus: "pending",
      domainStatus: "not_configured",
      ownerCount: 0,
      invitationEligible: false,
    });
    expect(blocked.blockers).toEqual(
      expect.arrayContaining([
        "installation_not_active",
        "canonical_domain_not_active",
      ]),
    );
    const denied = await app.inject({
      method: "POST",
      url: `/api/platform-owner/tenants/${onboardingTenant}/owner-invitations`,
      headers: mutationHeaders(ownerA, grantA),
      payload: { email: "owner@regional.invalid", lifetimeHours: 24 },
    });
    expect(denied.statusCode).toBe(400);

    await admin.query(
      `UPDATE control.white_label_installations SET status='active'
       WHERE id=$1 AND tenant_id=$2`,
      [blocked.installationId, onboardingTenant],
    );
    await admin.query(
      `INSERT INTO control.installation_domains
       (id,tenant_id,installation_id,hostname,domain_kind,status,verified_at,activated_at)
       VALUES($1,$2,$3,$4,'canonical','active',now(),now())`,
      [
        randomUUID(),
        onboardingTenant,
        blocked.installationId,
        `press-${randomUUID().slice(0, 8)}.example.test`,
      ],
    );
    expect(await inventory()).toMatchObject({
      installationStatus: "active",
      domainStatus: "active",
      invitationEligible: true,
      invitationStatus: "not_issued",
    });

    const issue = async () => {
      const response = await app.inject({
        method: "POST",
        url: `/api/platform-owner/tenants/${onboardingTenant}/owner-invitations`,
        headers: mutationHeaders(ownerA, grantA),
        payload: { email: "OWNER@regional.invalid", lifetimeHours: 24 },
      });
      expect(response.statusCode).toBe(201);
      return response.json<{
        id: string;
        invitationToken: string;
        installationId: string;
        expiresAt: string;
      }>();
    };
    const first = await issue();
    expect(first.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const invitationStore = new FirstOwnerInvitationStore(auth);
    expect(
      await invitationStore.isUsable(
        first.invitationToken,
        first.installationId,
      ),
    ).toBe(true);
    expect((await inventory()).invitationStatus).toBe("active");
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/platform-owner/tenants/${onboardingTenant}/owner-invitations`,
      headers: mutationHeaders(ownerA, grantA),
      payload: { email: "owner@regional.invalid", lifetimeHours: 24 },
    });
    expect(duplicate.statusCode).toBe(400);
    const stored = await admin.query<{ serialized: string }>(
      `SELECT row_to_json(invitation)::text serialized
       FROM control.first_owner_invitations invitation WHERE id=$1`,
      [first.id],
    );
    expect(stored.rows[0]?.serialized).not.toContain(first.invitationToken);
    expect(stored.rows[0]?.serialized).not.toContain("owner@regional.invalid");

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/platform-owner/owner-invitations/${first.id}`,
      headers: mutationHeaders(ownerA, grantA),
    });
    expect(revoked.statusCode).toBe(204);
    expect(
      await invitationStore.isUsable(
        first.invitationToken,
        first.installationId,
      ),
    ).toBe(false);
    await expect(
      auth.query(
        `SELECT * FROM control.consume_first_owner_invitation($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          createHash("sha256").update(first.invitationToken).digest("hex"),
          createHash("sha256").update("owner@regional.invalid").digest("hex"),
          `revoked-${randomUUID()}`,
          "owner@regional.invalid",
          "local",
          first.installationId,
          true,
          randomUUID(),
        ],
      ),
    ).rejects.toThrow(/FIRST_OWNER_INVITATION_INVALID/);

    const accepted = await issue();
    await auth.query(
      `SELECT * FROM control.consume_first_owner_invitation($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        createHash("sha256").update(accepted.invitationToken).digest("hex"),
        createHash("sha256").update("owner@regional.invalid").digest("hex"),
        `regional-owner-${randomUUID()}`,
        "owner@regional.invalid",
        "local",
        accepted.installationId,
        true,
        randomUUID(),
      ],
    );
    expect(await inventory()).toMatchObject({
      ownerCount: 1,
      invitationStatus: "consumed",
      invitationEligible: false,
    });
    const actions = await admin.query<{ action: string }>(
      `SELECT action FROM control.audit_events
       WHERE tenant_id=$1 AND action LIKE 'platform.owner_invitation_%'
       ORDER BY occurred_at,id`,
      [seed.tenantA],
    );
    expect(actions.rows.map((row) => row.action)).toEqual([
      "platform.owner_invitation_issued",
      "platform.owner_invitation_revoked",
      "platform.owner_invitation_issued",
    ]);
  });

  it("lets a tenant owner inspect usage, rotate safely, and revoke only their installation client", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/installation-api/clients",
      headers: { cookie: `redi_session=${ownerB.token}` },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      clients: [],
      policy: {
        scope: "control:read",
        accessTokenLifetimeSeconds: 900,
        writeApiAvailable: false,
      },
    });

    const issued = await app.inject({
      method: "POST",
      url: "/api/installation-api/clients",
      headers: mutationHeaders(ownerB),
      payload: { displayName: "Newsroom analytics", lifetimeDays: 45 },
    });
    expect(issued.statusCode).toBe(201);
    const credential = issued.json<{
      id: string;
      clientIdentifier: string;
      clientSecret: string;
    }>();
    const exchange = async (secret: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/oauth/token",
        headers: {
          authorization: `Basic ${Buffer.from(`${credential.clientIdentifier}:${secret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: "grant_type=client_credentials&scope=control%3Aread",
      });
    const firstExchange = await exchange(credential.clientSecret);
    expect(firstExchange.statusCode).toBe(200);
    const firstToken = firstExchange.json<{ access_token: string }>()
      .access_token;
    const used = await app.inject({
      method: "GET",
      url: "/api/v1/control/summary",
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(used.statusCode).toBe(200);

    const inventory = await app.inject({
      method: "GET",
      url: "/api/installation-api/clients",
      headers: { cookie: `redi_session=${ownerB.token}` },
    });
    const ownInventory = inventory.json<{
      clients: Array<{
        id: string;
        displayName: string;
        activeTokenCount: number;
        requestCount24h: number | string;
        requestCount30d: number | string;
        exchangeCount30d: number | string;
      }>;
    }>();
    expect(ownInventory).toMatchObject({
      clients: [
        {
          id: credential.id,
          displayName: "Newsroom analytics",
          activeTokenCount: 1,
        },
      ],
    });
    expect(Number(ownInventory.clients[0]?.requestCount24h)).toBe(1);
    expect(Number(ownInventory.clients[0]?.requestCount30d)).toBe(1);
    expect(Number(ownInventory.clients[0]?.exchangeCount30d)).toBe(1);
    expect(JSON.stringify(inventory.json())).not.toContain(
      credential.clientSecret,
    );

    const crossTenant = await app.inject({
      method: "POST",
      url: `/api/installation-api/clients/${credential.id}/rotate`,
      headers: mutationHeaders(ownerA),
      payload: {},
    });
    expect(crossTenant.statusCode).toBe(400);

    const rotated = await app.inject({
      method: "POST",
      url: `/api/installation-api/clients/${credential.id}/rotate`,
      headers: mutationHeaders(ownerB),
      payload: {},
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedCredential = rotated.json<{
      clientIdentifier: string;
      clientSecret: string;
    }>();
    expect(rotatedCredential.clientIdentifier).toBe(
      credential.clientIdentifier,
    );
    expect(rotatedCredential.clientSecret).not.toBe(credential.clientSecret);
    expect((await exchange(credential.clientSecret)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/control/summary",
          headers: { authorization: `Bearer ${firstToken}` },
        })
      ).statusCode,
    ).toBe(401);
    const secondExchange = await exchange(rotatedCredential.clientSecret);
    expect(secondExchange.statusCode).toBe(200);
    const secondToken = secondExchange.json<{ access_token: string }>()
      .access_token;

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/installation-api/clients/${credential.id}`,
      headers: mutationHeaders(ownerB),
    });
    expect(revoked.statusCode).toBe(204);
    expect((await exchange(rotatedCredential.clientSecret)).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/control/summary",
          headers: { authorization: `Bearer ${secondToken}` },
        })
      ).statusCode,
    ).toBe(401);
    const evidence = await admin.query<{ actions: string[] }>(
      `SELECT array_agg(action ORDER BY occurred_at)::text[] actions
       FROM control.audit_events WHERE tenant_id=$1 AND action LIKE 'installation.api_client_%'`,
      [seed.tenantB],
    );
    expect(evidence.rows[0]?.actions).toEqual([
      "installation.api_client_issued",
      "installation.api_client_rotated",
      "installation.api_client_revoked",
    ]);
  });

  it("issues installation-bound read-only API credentials once and revokes every token", async () => {
    const refusedShell = await app.inject({
      method: "POST",
      url: `/api/platform-owner/tenants/${provisionedTenant}/api-clients`,
      headers: mutationHeaders(ownerA, grantA),
      payload: { displayName: "Pending integration", lifetimeDays: 30 },
    });
    expect(refusedShell.statusCode).toBe(400);

    const issued = await app.inject({
      method: "POST",
      url: `/api/platform-owner/tenants/${seed.tenantB}/api-clients`,
      headers: mutationHeaders(ownerA, grantA),
      payload: { displayName: "Customer dashboard", lifetimeDays: 30 },
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.headers["cache-control"]).toBe("no-store");
    const credentials = issued.json<{
      id: string;
      clientIdentifier: string;
      clientSecret: string;
      scope: string;
    }>();
    expect(credentials.clientIdentifier).toMatch(/^rc_[A-Za-z0-9_-]{32,96}$/);
    expect(credentials.clientSecret).toMatch(/^[A-Za-z0-9_-]{32,100}$/);
    expect(credentials.scope).toBe("control:read");

    const stored = await admin.query<{ secret_hash: string }>(
      "SELECT secret_hash FROM control.installation_api_clients WHERE id=$1",
      [credentials.id],
    );
    expect(stored.rows[0]?.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.secret_hash).not.toContain(credentials.clientSecret);
    await expect(
      withTenant(runtime, seed.tenantB, (client) =>
        client.query(
          "SELECT secret_hash FROM control.installation_api_clients",
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const inventory = await app.inject({
      method: "GET",
      url: "/api/platform-owner/tenants",
      headers: {
        cookie: `redi_session=${ownerA.token}`,
        "x-platform-access-grant": grantA,
      },
    });
    const inventoryBody = inventory.json<{
      apiClients: Array<Record<string, unknown>>;
    }>();
    expect(inventoryBody.apiClients[0]).toMatchObject({
      id: credentials.id,
      targetTenantId: seed.tenantB,
      displayName: "Customer dashboard",
      scopes: ["control:read"],
      status: "active",
    });
    expect(JSON.stringify(inventoryBody)).not.toContain(
      credentials.clientSecret,
    );
    expect(inventoryBody.apiClients[0]).not.toHaveProperty("secretHash");

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/oauth/token",
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.clientIdentifier}:wrong-secret-value-that-is-long-enough`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "grant_type=client_credentials&scope=control%3Aread",
    });
    expect(wrong.statusCode).toBe(401);

    const exchanged = await app.inject({
      method: "POST",
      url: "/api/v1/oauth/token",
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.clientIdentifier}:${credentials.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "grant_type=client_credentials&scope=control%3Aread",
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.headers["cache-control"]).toBe("no-store");
    const token = exchanged.json<{
      access_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>();
    expect(token).toMatchObject({
      token_type: "Bearer",
      scope: "control:read",
    });
    expect(token.expires_in).toBeGreaterThanOrEqual(890);
    expect(token.expires_in).toBeLessThanOrEqual(900);

    const summary = await app.inject({
      method: "GET",
      url: "/api/v1/control/summary",
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      installation: { status: "active" },
      capabilities: {
        readOnly: true,
        publishing: false,
        providerConnections: false,
      },
      workzones: [{ name: "Local Workspace B" }],
    });
    expect(JSON.stringify(summary.json())).not.toContain(seed.tenantB);

    await admin.query(
      `UPDATE control.installation_api_rate_limits SET request_count=60
       WHERE api_client_id=$1 AND operation='request'`,
      [credentials.id],
    );
    const rateLimited = await app.inject({
      method: "GET",
      url: "/api/v1/control/summary",
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect(rateLimited.statusCode).toBe(429);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/platform-owner/api-clients/${credentials.id}`,
      headers: mutationHeaders(ownerA, grantA),
    });
    expect(revoked.statusCode).toBe(204);
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/control/summary",
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect(denied.statusCode).toBe(401);
    const secretLeaks = await admin.query<{ serialized: string }>(
      `SELECT coalesce(string_agg(metadata::text,' '),'') serialized
       FROM control.audit_events WHERE action LIKE 'platform.api_client_%'`,
    );
    expect(secretLeaks.rows[0]?.serialized).not.toContain(
      credentials.clientSecret,
    );
  });

  it("requires a different Root Owner to execute a tenant lifecycle request", async () => {
    const requested = await app.inject({
      method: "POST",
      url: `/api/platform-owner/tenants/${seed.tenantB}/lifecycle`,
      headers: mutationHeaders(ownerA, grantA),
      payload: {
        action: "suspend",
        reason: "Owner-approved isolation acceptance test",
      },
    });
    expect(requested.statusCode).toBe(202);
    const requestId = requested.json<{ id: string }>().id;
    const refused = await app.inject({
      method: "POST",
      url: `/api/platform-owner/lifecycle/${requestId}/execute`,
      headers: mutationHeaders(ownerA, grantA),
    });
    expect(refused.statusCode).toBe(403);

    const access = await app.inject({
      method: "POST",
      url: "/api/platform-owner/access",
      headers: mutationHeaders(ownerB),
      payload: {
        reason: "Independently approve tenant lifecycle request",
        lifetimeMinutes: 10,
      },
    });
    expect(access.statusCode).toBe(201);
    grantB = access.json<{ id: string }>().id;
    const inventory = await app.inject({
      method: "GET",
      url: "/api/platform-owner/tenants",
      headers: {
        cookie: `redi_session=${ownerB.token}`,
        "x-platform-access-grant": grantB,
      },
    });
    const body = inventory.json<{
      lifecycleRequests: Array<Record<string, unknown>>;
    }>();
    expect(body.lifecycleRequests[0]).toMatchObject({
      id: requestId,
      requestedByCurrentUser: false,
    });
    expect(body.lifecycleRequests[0]).not.toHaveProperty("requestedBy");
    const executed = await app.inject({
      method: "POST",
      url: `/api/platform-owner/lifecycle/${requestId}/execute`,
      headers: mutationHeaders(ownerB, grantB),
    });
    expect(executed.statusCode).toBe(200);
    const tenant = await admin.query<{ status: string }>(
      "SELECT status FROM control.tenants WHERE id=$1",
      [seed.tenantB],
    );
    expect(tenant.rows[0]?.status).toBe("suspended");
    const events = await admin.query<{ count: number }>(
      `SELECT count(*)::int count FROM control.audit_events
       WHERE action IN ('platform.tenant_lifecycle_requested','platform.tenant_lifecycle_executed')
         AND target_id=$1`,
      [seed.tenantB],
    );
    expect(events.rows[0]?.count).toBe(2);
  });

  it("preserves an old MFA timestamp through session rotation", async () => {
    const sessions = new SessionStore(auth);
    const session = await sessions.create({
      provider: "local",
      subject: seed.adminSubject,
      email: `admin-${seed.adminUser}@example.invalid`,
      emailVerified: true,
      mfaVerified: true,
    });
    await admin.query(
      "UPDATE control.sessions SET mfa_verified_at=now()-interval '10 minutes' WHERE id=$1",
      [session.sessionId],
    );
    const rotated = await sessions.rotate(session.token);
    expect(rotated).not.toBeNull();
    expect(await sessions.hasRecentMfa(rotated!.sessionId, 5)).toBe(false);
  });
});
