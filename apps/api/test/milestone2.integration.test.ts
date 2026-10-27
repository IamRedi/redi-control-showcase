import { randomUUID } from "node:crypto";

import {
  ConnectorRuntime,
  InMemorySecretProvider,
  ReferenceConnector,
} from "@redi-control/connector-sdk";
import {
  PostgresConnectorRuntimeStore,
  createPool,
  createReferenceConnection,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { SessionStore } from "@redi-control/identity";
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
const adminPool = createPool(adminUrl, "redi-control-m2-admin");
const runtimePool = createPool(runtimeUrl, "redi-control-m2-runtime");
const authPool = createPool(authUrl, "redi-control-m2-auth");
let seed: SeedResult;
let connectionA: string;
let connectionB: string;

beforeAll(async () => {
  await adminPool.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  connectionA = await createReferenceConnection(runtimePool, {
    tenantId: seed.tenantA,
    installationId: seed.installationA,
    workspaceId: seed.workspaceA,
    actorUserId: seed.adminUser,
    correlationId: randomUUID(),
  });
  connectionB = await createReferenceConnection(runtimePool, {
    tenantId: seed.tenantB,
    installationId: seed.installationB,
    workspaceId: seed.workspaceB,
    actorUserId: seed.analystUser,
    correlationId: randomUUID(),
  });
});

afterAll(async () => {
  await Promise.all([adminPool.end(), runtimePool.end(), authPool.end()]);
});

function trusted(connectionId = connectionA) {
  return {
    tenantId: seed.tenantA,
    connectionId,
    actorUserId: seed.adminUser,
    permissions: ["platform:read", "platform:connect"],
    correlationId: randomUUID(),
  } as const;
}

async function runtime(adapter = new ReferenceConnector()) {
  const result = new ConnectorRuntime(
    new PostgresConnectorRuntimeStore(runtimePool),
    new InMemorySecretProvider(),
    "0.2.0",
  );
  await result.register(adapter);
  return result;
}

describe("Milestone 2 real PostgreSQL registry gates", () => {
  it("applies M2 from empty and preserves restricted runtime role", async () => {
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

  it("isolates connection reads and writes across real tenant RLS", async () => {
    const visible = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query<{ id: string }>(
        "SELECT id FROM control.platform_connections ORDER BY id",
      ),
    );
    expect(visible.rows.map((row) => row.id)).toEqual([connectionA]);
    const hidden = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query(
        "SELECT id FROM control.platform_connections WHERE id = $1",
        [connectionB],
      ),
    );
    expect(hidden.rowCount).toBe(0);
    const changed = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query(
        "UPDATE control.platform_connections SET status = 'disabled' WHERE id = $1",
        [connectionB],
      ),
    );
    expect(changed.rowCount).toBe(0);
    await expect(
      withTenant(runtimePool, seed.tenantA, (client) =>
        client.query(
          `INSERT INTO control.platform_connections
           (id, tenant_id, installation_id, workspace_id, connector_id, connector_version, environment, status)
           VALUES ($1, $2, $3, $4, 'reference-saas-local', '1.0.0', 'local', 'active')`,
          [randomUUID(), seed.tenantA, seed.installationB, seed.workspaceB],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("persists only opaque secret references and never secret material", async () => {
    await expect(
      adminPool.query(
        "UPDATE control.platform_connections SET secret_reference = $2 WHERE id = $1",
        [connectionA, "plain-production-token"],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await adminPool.query(
      "UPDATE control.platform_connections SET secret_reference = 'secret://local/reference-a' WHERE id = $1",
      [connectionA],
    );
    const audit = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query(
        "SELECT metadata::text FROM control.audit_events WHERE target_id = $1::text",
        [connectionA],
      ),
    );
    expect(JSON.stringify(audit.rows)).not.toContain("plain-production-token");
    await adminPool.query(
      "UPDATE control.platform_connections SET secret_reference = NULL WHERE id = $1",
      [connectionA],
    );
  });

  it("executes declared reads once and writes audit, outbox and idempotency atomically", async () => {
    const adapter = new ReferenceConnector();
    const connectorRuntime = await runtime(adapter);
    const key = `idem-${randomUUID()}`;
    const first = await connectorRuntime.executeRead(
      trusted(),
      "profile.read",
      { workspaceKey: "alpha" },
      key,
    );
    const retry = await connectorRuntime.executeRead(
      trusted(),
      "profile.read",
      { workspaceKey: "alpha" },
      key,
    );
    expect(retry).toEqual(first);
    expect(adapter.executions).toBe(1);
    const evidence = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query<{ idempotency: number; audits: number; outbox: number }>(
        `SELECT
          (SELECT count(*)::int FROM control.connector_idempotency WHERE connection_id = $1 AND idempotency_key = $2) AS idempotency,
          (SELECT count(*)::int FROM control.audit_events WHERE target_id = $1::text AND action = 'connector.command_executed') AS audits,
          (SELECT count(*)::int FROM control.outbox_events WHERE payload->>'connectionId' = $1::text AND event_type = 'connector.command_executed') AS outbox`,
        [connectionA, key],
      ),
    );
    expect(evidence.rows[0]).toEqual({ idempotency: 1, audits: 1, outbox: 1 });
  });

  it("fails closed for cross-tenant, undeclared, missing scope/capability, disabled and kill-switched calls", async () => {
    const connectorRuntime = await runtime();
    await expect(
      connectorRuntime.executeRead(
        trusted(connectionB),
        "profile.read",
        { workspaceKey: "x" },
        `idem-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });
    await expect(
      connectorRuntime.executeRead(
        trusted(),
        "content.write",
        {},
        `idem-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "COMMAND_NOT_DECLARED" });

    await adminPool.query(
      "UPDATE control.platform_connections SET granted_scopes = '{}' WHERE id = $1",
      [connectionA],
    );
    await expect(
      connectorRuntime.executeRead(
        trusted(),
        "profile.read",
        { workspaceKey: "x" },
        `idem-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    await adminPool.query(
      "UPDATE control.platform_connections SET granted_scopes = ARRAY['profile.read'], discovered_capabilities = '{}' WHERE id = $1",
      [connectionA],
    );
    await expect(
      connectorRuntime.executeRead(
        trusted(),
        "profile.read",
        { workspaceKey: "x" },
        `idem-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await adminPool.query(
      "UPDATE control.platform_connections SET discovered_capabilities = ARRAY['profile.read'], kill_switched = true WHERE id = $1",
      [connectionA],
    );
    await expect(connectorRuntime.health(trusted())).rejects.toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
    });
    await adminPool.query(
      "UPDATE control.platform_connections SET kill_switched = false, status = 'disabled' WHERE id = $1",
      [connectionA],
    );
    await expect(connectorRuntime.health(trusted())).rejects.toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
    });
    await adminPool.query(
      "UPDATE control.platform_connections SET status = 'active' WHERE id = $1",
      [connectionA],
    );
  });

  it("bounds health without accepting an outbound URL and records degraded state", async () => {
    const connectorRuntime = await runtime(new ReferenceConnector("degraded"));
    const health = await connectorRuntime.health(trusted());
    expect(health).toMatchObject({
      status: "degraded",
      reason: "simulated_degraded",
    });
    const persisted = await withTenant(runtimePool, seed.tenantA, (client) =>
      client.query<{ health_status: string }>(
        "SELECT health_status FROM control.platform_connections WHERE id = $1",
        [connectionA],
      ),
    );
    expect(persisted.rows[0]?.health_status).toBe("degraded");
    await adminPool.query(
      "UPDATE control.platform_connections SET status = 'active' WHERE id = $1",
      [connectionA],
    );
  });
});

describe("Milestone 2 authenticated API gates", () => {
  it("lists safe registry data, rejects tenant override, checks health and disables a test connection", async () => {
    const session = await new SessionStore(authPool).create({
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
    const headers = {
      cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken,
    };
    try {
      const platforms = await app.inject({
        method: "GET",
        url: "/api/platforms",
        headers,
      });
      expect(platforms.statusCode).toBe(200);
      expect(platforms.body).toContain("reference-saas-local");
      expect(platforms.body).not.toContain("secret_reference");

      const connections = await app.inject({
        method: "GET",
        url: "/api/connections",
        headers,
      });
      expect(connections.statusCode).toBe(200);
      expect(connections.body).toContain(connectionA);
      expect(connections.body).not.toContain(connectionB);
      expect(connections.body).not.toContain("secret_reference");

      const injected = await app.inject({
        method: "POST",
        url: "/api/connections/test",
        headers,
        payload: {
          installationId: seed.installationA,
          workspaceId: seed.workspaceA,
          tenantId: seed.tenantB,
        },
      });
      expect(injected.statusCode).toBe(400);

      const created = await app.inject({
        method: "POST",
        url: "/api/connections/test",
        headers,
        payload: {
          installationId: seed.installationA,
          workspaceId: seed.workspaceA,
        },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<{ connectionId: string }>().connectionId;

      const health = await app.inject({
        method: "POST",
        url: `/api/connections/${id}/health`,
        headers,
        payload: { url: "http://169.254.169.254/latest/meta-data" },
      });
      expect(health.statusCode).toBe(400);
      const boundedHealth = await app.inject({
        method: "POST",
        url: `/api/connections/${id}/health`,
        headers,
        payload: {},
      });
      expect(boundedHealth.statusCode).toBe(200);
      expect(boundedHealth.json()).toMatchObject({
        health: { status: "healthy" },
      });

      const read = await app.inject({
        method: "POST",
        url: `/api/connections/${id}/commands/profile.read`,
        headers,
        payload: {
          input: { workspaceKey: "api" },
          idempotencyKey: `api-${randomUUID()}`,
        },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toMatchObject({
        result: { source: "local-reference" },
      });

      const disabled = await app.inject({
        method: "POST",
        url: `/api/connections/${id}/disable`,
        headers,
      });
      expect(disabled.statusCode).toBe(204);
      const denied = await app.inject({
        method: "POST",
        url: `/api/connections/${id}/commands/profile.read`,
        headers,
        payload: {
          input: { workspaceKey: "api" },
          idempotencyKey: `api-${randomUUID()}`,
        },
      });
      expect(denied.statusCode).toBe(409);
      expect(denied.body).not.toContain("secret");
    } finally {
      await app.close();
    }
  });

  it("enforces database-backed per-tenant/per-connection rate limits", async () => {
    const id = await createReferenceConnection(runtimePool, {
      tenantId: seed.tenantA,
      installationId: seed.installationA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    const connectorRuntime = await runtime();
    for (let index = 0; index < 5; index += 1) {
      await connectorRuntime.executeRead(
        trusted(id),
        "profile.read",
        { workspaceKey: `rate-${index}` },
        `rate-${randomUUID()}`,
      );
    }
    await expect(
      connectorRuntime.executeRead(
        trusted(id),
        "profile.read",
        { workspaceKey: "rate-over" },
        `rate-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
