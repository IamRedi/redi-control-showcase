import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type DatabasePool,
  type SeedResult,
} from "@redi-control/database";
import {
  InstallationPolicyService,
  InstallationResolutionError,
  InstallationResolver,
  normalizePublicHostname,
} from "@redi-control/installation";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const runtimeUrl = process.env.DATABASE_URL;
const authUrl = process.env.DATABASE_AUTH_URL;
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD;
const authPassword = process.env.DATABASE_AUTH_PASSWORD;
if (!adminUrl || !runtimeUrl || !authUrl || !runtimePassword || !authPassword)
  throw new Error("M3B-0 integration database variables are required");

let runtime: DatabasePool;
let admin: DatabasePool;
let seed: SeedResult;

beforeAll(async () => {
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  runtime = createPool(runtimeUrl, "m3b0-runtime-tests");
  admin = createPool(adminUrl, "m3b0-admin-tests");
  seed = await seedLocalTestData(adminUrl);
});

afterAll(async () => Promise.all([runtime.end(), admin.end()]));

describe("Milestone 3B-0 installation and staging gates", () => {
  it("exposes only provider-specific OAuth handoff schemas", async () => {
    const app = buildApp();
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/social/oauth/meta/start",
            payload: {
              workspaceId: seed.workspaceA,
              postConnectPath: "/sq/social/accounts",
              redirectUri: "https://evil.invalid/callback",
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/social/oauth/youtube/callback?state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code=x&tenantId=attacker",
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/social/oauth/callback",
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("resolves only trusted active domains and rejects spoofed hosts", async () => {
    const resolver = new InstallationResolver(
      runtime,
      "staging",
      new Set([seed.canonicalDomainA, seed.canonicalDomainB]),
    );
    const resolved = await resolver.resolve(seed.canonicalDomainA);
    expect(resolved.installationId).toBe(seed.installationA);
    await expect(resolver.resolve("unknown.example.test")).rejects.toThrow(
      "UNTRUSTED_PUBLIC_HOST",
    );
    expect(() =>
      normalizePublicHostname("trusted.example.test@evil.test"),
    ).toThrow(InstallationResolutionError);
    expect(() =>
      resolver.assertSameInstallation(resolved, seed.installationB),
    ).toThrow("CROSS_INSTALLATION_DOMAIN_DENIED");

    const auth = createPool(authUrl, "m3b0-host-auth-tests");
    const app = buildApp({
      database: { runtime, auth },
      installationResolver: resolver,
    });
    try {
      const spoofed = await app.inject({
        method: "GET",
        url: "/api/platforms",
        headers: {
          host: seed.canonicalDomainA,
          "x-forwarded-host": seed.canonicalDomainB,
        },
      });
      expect(spoofed.statusCode).toBe(421);
    } finally {
      await app.close();
      await auth.end();
    }
  });

  it("denies pending/unverified mappings and cross-tenant reads under runtime RLS", async () => {
    const pending = `pending-${seed.installationA.slice(0, 8)}.example.test`;
    await admin.query(
      "INSERT INTO control.installation_domains (id,tenant_id,installation_id,hostname,domain_kind,status) VALUES (gen_random_uuid(),$1,$2,$3,'custom','pending')",
      [seed.tenantA, seed.installationA, pending],
    );
    const resolver = new InstallationResolver(
      runtime,
      "staging",
      new Set([pending]),
    );
    await expect(resolver.resolve(pending)).rejects.toThrow(
      "INSTALLATION_DOMAIN_NOT_ACTIVE",
    );
    const visible = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ hostname: string }>(
        "SELECT hostname FROM control.installation_domains ORDER BY hostname",
      ),
    );
    expect(
      visible.rows.some((row) => row.hostname === seed.canonicalDomainB),
    ).toBe(false);
  });

  it("selects shared/dedicated OAuth apps per installation without mixing secret references", async () => {
    const policies = new InstallationPolicyService(runtime);
    const shared = await policies.oauthApplication(
      seed.tenantA,
      seed.installationA,
      "meta",
    );
    const dedicated = await policies.oauthApplication(
      seed.tenantB,
      seed.installationB,
      "meta",
    );
    expect(shared.mode).toBe("shared");
    expect(dedicated.mode).toBe("dedicated");
    expect(shared.clientSecretReference).not.toBe(
      dedicated.clientSecretReference,
    );
    expect(shared.clientSecretReference).toMatch(/^secret:\/\//);
    await expect(
      policies.oauthApplication(seed.tenantA, seed.installationB, "meta"),
    ).rejects.toThrow("OAUTH_APPLICATION_NOT_ENTITLED");
  });

  it("enforces entitlement limits server-side and fails closed", async () => {
    const policies = new InstallationPolicyService(runtime);
    await admin.query(
      "UPDATE control.installation_entitlements SET maximum_workspaces=1 WHERE installation_id=$1",
      [seed.installationA],
    );
    await expect(
      policies.assertCapacity({
        tenantId: seed.tenantA,
        installationId: seed.installationA,
        resource: "workspace",
      }),
    ).rejects.toThrow("ENTITLEMENT_LIMIT_EXCEEDED");
    await expect(
      policies.assertModule(seed.tenantA, seed.installationA, "ai"),
    ).rejects.toThrow("MODULE_NOT_ENTITLED");
  });

  it("fails readiness when storage or critical configuration is absent", async () => {
    const auth = createPool(authUrl, "m3b0-auth-tests");
    const app = buildApp({
      database: { runtime, auth },
      criticalConfigurationReady: false,
      storageReadiness: () => Promise.resolve(false),
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });
      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        checks: Record<string, string>;
      };
      expect(body.checks).toMatchObject({
        storage: "unavailable",
        configuration: "invalid",
      });
    } finally {
      await app.close();
      await auth.end();
    }
  });
});
