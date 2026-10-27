import { createHash, randomBytes } from "node:crypto";

import { withTenant, type DatabasePool } from "@redi-control/database";

export type DeploymentEnvironment = "local" | "test" | "staging" | "production";
export type OAuthApplicationMode = "shared" | "dedicated";
export type InstallationProvider = "meta" | "youtube" | "tiktok";

export interface ResolvedInstallation {
  readonly tenantId: string;
  readonly installationId: string;
  readonly hostname: string;
  readonly canonicalHostname: string;
  readonly origin: string;
}

export class InstallationResolutionError extends Error {
  public readonly statusCode = 421;
  public constructor(code: string) {
    super(code);
  }
}

export function normalizePublicHostname(hostHeader: string): string {
  if (!hostHeader || hostHeader.length > 253 || /[,/@\\\s]/.test(hostHeader))
    throw new InstallationResolutionError("INVALID_PUBLIC_HOST");
  let parsed: URL;
  try {
    parsed = new URL(`https://${hostHeader}`);
  } catch {
    throw new InstallationResolutionError("INVALID_PUBLIC_HOST");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      hostname,
    ) &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1")
  )
    throw new InstallationResolutionError("INVALID_PUBLIC_HOST");
  return hostname;
}

export class InstallationResolver {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly environment: DeploymentEnvironment,
    private readonly trustedHosts: ReadonlySet<string>,
    private readonly localInstallation?: {
      tenantId: string;
      installationId: string;
    },
  ) {}

  public async resolve(hostHeader: string): Promise<ResolvedInstallation> {
    const hostname = normalizePublicHostname(hostHeader);
    if (!this.trustedHosts.has(hostname))
      throw new InstallationResolutionError("UNTRUSTED_PUBLIC_HOST");
    if (
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      !["local", "test"].includes(this.environment)
    )
      throw new InstallationResolutionError("LOCAL_DOMAIN_FORBIDDEN");
    if (
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      this.localInstallation
    ) {
      return {
        ...this.localInstallation,
        hostname,
        canonicalHostname: hostname,
        origin: `http://${hostHeader}`,
      };
    }
    const result = await this.pool.query<{
      tenant_id: string;
      installation_id: string;
      canonical_hostname: string;
    }>(
      "SELECT tenant_id,installation_id,canonical_hostname FROM control.resolve_active_installation_domain($1)",
      [hostname],
    );
    const row = result.rows[0];
    if (!row)
      throw new InstallationResolutionError("INSTALLATION_DOMAIN_NOT_ACTIVE");
    return {
      tenantId: row.tenant_id,
      installationId: row.installation_id,
      hostname,
      canonicalHostname: row.canonical_hostname,
      origin: `https://${hostname}`,
    };
  }

  public assertSameInstallation(
    resolved: ResolvedInstallation,
    installationId: string,
  ): void {
    if (resolved.installationId !== installationId)
      throw new InstallationResolutionError("CROSS_INSTALLATION_DOMAIN_DENIED");
  }
}

export interface OAuthApplicationConfiguration {
  readonly installationId: string;
  readonly provider: InstallationProvider;
  readonly mode: OAuthApplicationMode;
  readonly clientIdReference: string;
  readonly clientSecretReference: string;
}

export class InstallationPolicyService {
  public constructor(private readonly pool: DatabasePool) {}

  public async oauthApplication(
    tenantId: string,
    installationId: string,
    provider: InstallationProvider,
  ): Promise<OAuthApplicationConfiguration> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{
        application_mode: OAuthApplicationMode;
        client_id_reference: string;
        client_secret_reference: string;
        shared_oauth_allowed: boolean;
        dedicated_oauth_allowed: boolean;
        provider_allowed: boolean;
      }>(
        `SELECT app.application_mode,app.client_id_reference,app.client_secret_reference,
          entitlement.shared_oauth_allowed,entitlement.dedicated_oauth_allowed,
          $3::control.social_provider = ANY(entitlement.provider_availability) AS provider_allowed
         FROM control.installation_oauth_applications app
         JOIN control.installation_entitlements entitlement
           ON entitlement.installation_id=app.installation_id AND entitlement.tenant_id=app.tenant_id
         WHERE app.installation_id=$1 AND app.tenant_id=$2 AND app.provider=$3 AND app.status='active'
           AND 'social'=ANY(entitlement.enabled_modules)
           AND entitlement.effective_from <= now()
           AND (entitlement.effective_until IS NULL OR entitlement.effective_until > now())`,
        [installationId, tenantId, provider],
      );
      const row = result.rows[0];
      if (!row || !row.provider_allowed)
        throw new Error("OAUTH_APPLICATION_NOT_ENTITLED");
      if (row.application_mode === "shared" && !row.shared_oauth_allowed)
        throw new Error("SHARED_OAUTH_NOT_ENTITLED");
      if (row.application_mode === "dedicated" && !row.dedicated_oauth_allowed)
        throw new Error("DEDICATED_OAUTH_NOT_ENTITLED");
      return {
        installationId,
        provider,
        mode: row.application_mode,
        clientIdReference: row.client_id_reference,
        clientSecretReference: row.client_secret_reference,
      };
    });
  }

  public async assertModule(
    tenantId: string,
    installationId: string,
    moduleId: string,
  ): Promise<void> {
    const allowed = await withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        `SELECT $3=ANY(enabled_modules) AS allowed FROM control.installation_entitlements
         WHERE installation_id=$1 AND tenant_id=$2 AND effective_from<=now()
           AND (effective_until IS NULL OR effective_until>now())`,
        [installationId, tenantId, moduleId],
      );
      return result.rows[0]?.allowed === true;
    });
    if (!allowed) throw new Error("MODULE_NOT_ENTITLED");
  }

  public async assertCapacity(input: {
    tenantId: string;
    installationId: string;
    resource:
      | "workspace"
      | "social_account"
      | "publication"
      | "storage"
      | "user";
    increment?: number;
  }): Promise<void> {
    await withTenant(this.pool, input.tenantId, async (client) => {
      const result = await client.query<{
        current_value: string;
        maximum_value: string;
      }>(
        `SELECT CASE $3::text
          WHEN 'workspace' THEN (SELECT count(*) FROM control.business_workspaces WHERE installation_id=$1)
          WHEN 'social_account' THEN (SELECT count(*) FROM control.social_accounts account JOIN control.business_workspaces workspace ON workspace.id=account.workspace_id WHERE workspace.installation_id=$1 AND account.status<>'revoked')
          WHEN 'publication' THEN (SELECT count(*) FROM control.publication_attempts attempt JOIN control.social_drafts draft ON draft.id=attempt.draft_id JOIN control.business_workspaces workspace ON workspace.id=draft.workspace_id WHERE workspace.installation_id=$1 AND attempt.created_at>=date_trunc('month',now()))
          WHEN 'storage' THEN (SELECT coalesce(sum(object.size_bytes),0) FROM control.media_objects object JOIN control.media_assets asset ON asset.id=object.asset_id JOIN control.business_workspaces workspace ON workspace.id=asset.workspace_id WHERE workspace.installation_id=$1)
          WHEN 'user' THEN (SELECT count(*) FROM control.memberships WHERE tenant_id=$2)
         END::bigint AS current_value,
         CASE $3::text WHEN 'workspace' THEN maximum_workspaces WHEN 'social_account' THEN maximum_social_accounts WHEN 'publication' THEN monthly_publication_quota WHEN 'storage' THEN storage_quota_bytes WHEN 'user' THEN maximum_users END::bigint AS maximum_value
         FROM control.installation_entitlements WHERE installation_id=$1 AND tenant_id=$2
           AND effective_from<=now() AND (effective_until IS NULL OR effective_until>now())`,
        [input.installationId, input.tenantId, input.resource],
      );
      const row = result.rows[0];
      if (
        !row ||
        BigInt(row.current_value) + BigInt(input.increment ?? 1) >
          BigInt(row.maximum_value)
      )
        throw new Error("ENTITLEMENT_LIMIT_EXCEEDED");
    });
  }
}

export interface PlatformTenantSummary {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly displayName: string;
  readonly tenantStatus: string;
  readonly installationId: string | null;
  readonly installationStatus: string;
  readonly workspaceCount: number;
  readonly memberCount: number;
  readonly pendingLifecycleCount: number;
}

export interface PlatformLifecycleRequest {
  readonly id: string;
  readonly targetTenantId: string;
  readonly targetName: string;
  readonly action: "suspend" | "reactivate" | "request_deletion";
  readonly reason: string;
  readonly status: "pending" | "executed" | "cancelled";
  readonly requestedBy: string;
  readonly requestedAt: string;
}

export interface PlatformTenantSetup {
  readonly targetTenantId: string;
  readonly templateId: PlatformTenantTemplateId;
  readonly status: "configured" | "awaiting_owner";
  readonly defaultLocale: "en" | "de" | "sq";
  readonly enabledLocales: readonly ("en" | "de" | "sq")[];
  readonly configuredAt: string;
}

export interface PlatformTenantOnboarding {
  readonly targetTenantId: string;
  readonly installationId: string | null;
  readonly setupStatus: "not_configured" | "configured" | "awaiting_owner";
  readonly tenantStatus: string;
  readonly installationStatus: string;
  readonly domainStatus: string;
  readonly ownerCount: number;
  readonly workspaceCount: number;
  readonly pendingInvitationId: string | null;
  readonly invitationExpiresAt: string | null;
  readonly invitationStatus:
    | "not_issued"
    | "active"
    | "consumed"
    | "revoked"
    | "expired";
  readonly invitationEligible: boolean;
  readonly blockers: readonly string[];
}

export interface PlatformApiClient {
  readonly id: string;
  readonly targetTenantId: string;
  readonly targetName: string;
  readonly installationId: string;
  readonly displayName: string;
  readonly clientIdentifier: string;
  readonly scopes: readonly ["control:read"];
  readonly status: "active" | "revoked";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastExchangedAt: string | null;
}

export interface TenantApiClient {
  readonly id: string;
  readonly installationId: string;
  readonly displayName: string;
  readonly clientIdentifier: string;
  readonly scopes: readonly ["control:read"];
  readonly status: "active" | "revoked";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastExchangedAt: string | null;
  readonly activeTokenCount: number;
  readonly requestCount24h: string;
  readonly requestCount30d: string;
  readonly exchangeCount30d: string;
}

export type PlatformTenantTemplateId =
  | "media_starter"
  | "media_team"
  | "media_network";

export const platformTenantTemplates = [
  {
    id: "media_starter",
    name: "Media Starter",
    maximumUsers: 5,
    maximumWorkspaces: 1,
    maximumSocialAccounts: 5,
    monthlyPublicationQuota: 250,
    storageQuotaBytes: 26_843_545_600,
    modules: [
      "platforms",
      "media",
      "social",
      "websites",
      "unified_content",
      "media_intelligence",
    ],
  },
  {
    id: "media_team",
    name: "Media Team",
    maximumUsers: 15,
    maximumWorkspaces: 2,
    maximumSocialAccounts: 15,
    monthlyPublicationQuota: 2_000,
    storageQuotaBytes: 107_374_182_400,
    modules: [
      "platforms",
      "media",
      "social",
      "websites",
      "unified_content",
      "media_intelligence",
      "context_studio",
      "ai",
    ],
  },
  {
    id: "media_network",
    name: "Media Network",
    maximumUsers: 50,
    maximumWorkspaces: 5,
    maximumSocialAccounts: 50,
    monthlyPublicationQuota: 10_000,
    storageQuotaBytes: 536_870_912_000,
    modules: [
      "platforms",
      "media",
      "social",
      "websites",
      "unified_content",
      "media_intelligence",
      "context_studio",
      "ai",
    ],
  },
] as const;

const camel = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

function platformFailure(error: unknown): never {
  const failure = error as { code?: string; message?: string };
  const statusCode =
    failure.code === "42501"
      ? 403
      : failure.code === "23505"
        ? 409
        : failure.code === "22023"
          ? 400
          : 500;
  const known = new Set([
    "PLATFORM_ACCESS_DENIED",
    "INVALID_PLATFORM_PROVISIONING",
    "INVALID_PLATFORM_LIFECYCLE_REQUEST",
    "INVALID_PLATFORM_LIFECYCLE_TRANSITION",
    "PLATFORM_LIFECYCLE_ALREADY_PENDING",
    "PLATFORM_LIFECYCLE_REQUEST_NOT_FOUND",
    "INDEPENDENT_PLATFORM_APPROVAL_REQUIRED",
    "INVALID_PLATFORM_TENANT_SETUP",
    "PLATFORM_TENANT_SETUP_NOT_ELIGIBLE",
    "PLATFORM_API_CLIENT_NOT_ELIGIBLE",
    "PLATFORM_API_CLIENT_NOT_FOUND",
    "PLATFORM_OWNER_INVITATION_NOT_ELIGIBLE",
    "PLATFORM_OWNER_INVITATION_NOT_FOUND",
  ]);
  const candidate = failure.message?.split("\n")[0] ?? "";
  const message = known.has(candidate)
    ? candidate
    : statusCode === 409
      ? "PLATFORM_OWNER_CONFLICT"
      : statusCode === 400
        ? "INVALID_PLATFORM_OWNER_REQUEST"
        : statusCode === 403
          ? "PLATFORM_ACCESS_DENIED"
          : "PLATFORM_OWNER_OPERATION_FAILED";
  throw Object.assign(new Error(message), { statusCode });
}

export class PlatformOwnerService {
  public constructor(private readonly pool: DatabasePool) {}

  public async beginAccess(input: {
    actorUserId: string;
    authorityTenantId: string;
    reason: string;
    lifetimeMinutes: number;
    correlationId: string;
  }) {
    const result = await this.pool
      .query(`SELECT * FROM control.begin_platform_access($1,$2,$3,$4,$5)`, [
        input.actorUserId,
        input.authorityTenantId,
        input.reason,
        input.lifetimeMinutes,
        input.correlationId,
      ])
      .catch(platformFailure);
    return camel(result.rows[0] as Record<string, unknown>);
  }

  public async inventory(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
  }): Promise<{
    tenants: PlatformTenantSummary[];
    lifecycleRequests: PlatformLifecycleRequest[];
    tenantSetups: PlatformTenantSetup[];
    onboarding: PlatformTenantOnboarding[];
    apiClients: PlatformApiClient[];
    templates: typeof platformTenantTemplates;
    impersonationAvailable: false;
  }> {
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.platform_owner_inventory($1,$2,$3)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId])
      .catch(platformFailure);
    const lifecycle = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.platform_owner_lifecycle_requests($1,$2,$3)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId])
      .catch(platformFailure);
    const setups = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.platform_owner_tenant_setups($1,$2,$3)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId])
      .catch(platformFailure);
    const apiClients = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.platform_owner_api_clients($1,$2,$3)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId])
      .catch(platformFailure);
    const onboarding = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.platform_owner_onboarding($1,$2,$3)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId])
      .catch(platformFailure);
    return {
      tenants: result.rows.map(
        (row) => camel(row) as unknown as PlatformTenantSummary,
      ),
      lifecycleRequests: lifecycle.rows.map(
        (row) => camel(row) as unknown as PlatformLifecycleRequest,
      ),
      tenantSetups: setups.rows.map(
        (row) => camel(row) as unknown as PlatformTenantSetup,
      ),
      onboarding: onboarding.rows.map(
        (row) => camel(row) as unknown as PlatformTenantOnboarding,
      ),
      apiClients: apiClients.rows.map(
        (row) => camel(row) as unknown as PlatformApiClient,
      ),
      templates: platformTenantTemplates,
      impersonationAvailable: false,
    };
  }

  public async provision(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    tenantSlug: string;
    tenantName: string;
    installationSlug: string;
    installationName: string;
    workspaceName: string;
    dataRegion: "EU" | "DE";
    correlationId: string;
  }) {
    const result = await this.pool
      .query(
        `SELECT * FROM control.provision_platform_tenant($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.actorUserId,
          input.authorityTenantId,
          input.accessGrantId,
          input.tenantSlug,
          input.tenantName,
          input.installationSlug,
          input.installationName,
          input.workspaceName,
          input.dataRegion,
          input.correlationId,
        ],
      )
      .catch(platformFailure);
    return camel(result.rows[0] as Record<string, unknown>);
  }

  public async configureTenant(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    targetTenantId: string;
    templateId: PlatformTenantTemplateId;
    defaultLocale: "en" | "de" | "sq";
    enabledLocales: readonly ("en" | "de" | "sq")[];
    brandAccent: string;
    correlationId: string;
  }) {
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.configure_platform_tenant($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId, input.targetTenantId, input.templateId, input.defaultLocale, input.enabledLocales, input.brandAccent, input.correlationId])
      .catch(platformFailure);
    return camel(result.rows[0] as Record<string, unknown>);
  }

  public async requestLifecycle(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    targetTenantId: string;
    action: "suspend" | "reactivate" | "request_deletion";
    reason: string;
    correlationId: string;
  }) {
    const result = await this.pool
      .query<{
        id: string;
      }>(
        `SELECT control.request_platform_tenant_lifecycle($1,$2,$3,$4,$5,$6,$7) AS id`,
        [
          input.actorUserId,
          input.authorityTenantId,
          input.accessGrantId,
          input.targetTenantId,
          input.action,
          input.reason,
          input.correlationId,
        ],
      )
      .catch(platformFailure);
    return { id: result.rows[0]!.id, status: "pending" as const };
  }

  public async issueFirstOwnerInvitation(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    targetTenantId: string;
    email: string;
    lifetimeHours: number;
    correlationId: string;
  }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      normalizedEmail.length > 320
    )
      throw Object.assign(new Error("INVALID_PLATFORM_OWNER_REQUEST"), {
        statusCode: 400,
      });
    const invitationToken = randomBytes(32).toString("base64url");
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.issue_platform_first_owner_invitation($1,$2,$3,$4,$5,$6,$7,$8)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId, input.targetTenantId, digest(invitationToken), digest(normalizedEmail), input.lifetimeHours, input.correlationId])
      .catch(platformFailure);
    return { ...camel(result.rows[0]!), invitationToken };
  }

  public async revokeFirstOwnerInvitation(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    invitationId: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(
        `SELECT control.revoke_platform_first_owner_invitation($1,$2,$3,$4,$5)`,
        [
          input.actorUserId,
          input.authorityTenantId,
          input.accessGrantId,
          input.invitationId,
          input.correlationId,
        ],
      )
      .catch(platformFailure);
  }

  public async issueApiClient(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    targetTenantId: string;
    displayName: string;
    lifetimeDays: number;
    correlationId: string;
  }) {
    const clientIdentifier = `rc_${randomBytes(32).toString("base64url")}`;
    const clientSecret = randomBytes(32).toString("base64url");
    const secretHash = digest(clientSecret);
    const expiresAt = new Date(
      Date.now() + input.lifetimeDays * 86_400_000,
    ).toISOString();
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.issue_platform_api_client($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [input.actorUserId, input.authorityTenantId, input.accessGrantId, input.targetTenantId, clientIdentifier, secretHash, input.displayName, expiresAt, input.correlationId])
      .catch(platformFailure);
    return {
      ...camel(result.rows[0]!),
      clientIdentifier,
      clientSecret,
      scope: "control:read" as const,
    };
  }

  public async revokeApiClient(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    clientId: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.revoke_platform_api_client($1,$2,$3,$4,$5)`, [
        input.actorUserId,
        input.authorityTenantId,
        input.accessGrantId,
        input.clientId,
        input.correlationId,
      ])
      .catch(platformFailure);
  }

  public async executeLifecycle(input: {
    actorUserId: string;
    authorityTenantId: string;
    accessGrantId: string;
    requestId: string;
    correlationId: string;
  }) {
    await this.pool
      .query(
        `SELECT control.execute_platform_tenant_lifecycle($1,$2,$3,$4,$5)`,
        [
          input.actorUserId,
          input.authorityTenantId,
          input.accessGrantId,
          input.requestId,
          input.correlationId,
        ],
      )
      .catch(platformFailure);
    return { executed: true as const };
  }
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function apiFailure(error: unknown): never {
  const failure = error as { code?: string; message?: string };
  const candidate = failure.message?.split("\n")[0] ?? "";
  const statusCode =
    candidate === "API_RATE_LIMIT_EXCEEDED"
      ? 429
      : failure.code === "28000"
        ? 401
        : 500;
  const message =
    statusCode === 429
      ? "API_RATE_LIMIT_EXCEEDED"
      : statusCode === 401
        ? "INVALID_API_CREDENTIALS"
        : "INSTALLATION_API_UNAVAILABLE";
  throw Object.assign(new Error(message), { statusCode });
}

function tenantApiAdminFailure(error: unknown): never {
  const failure = error as { code?: string; message?: string };
  const candidate = failure.message?.split("\n")[0] ?? "";
  const known = new Set([
    "TENANT_API_ADMIN_DENIED",
    "TENANT_API_CLIENT_NOT_ELIGIBLE",
    "TENANT_API_CLIENT_NOT_FOUND",
  ]);
  const statusCode =
    failure.code === "42501"
      ? 403
      : failure.code === "22023"
        ? 400
        : failure.code === "23505"
          ? 409
          : 500;
  const message = known.has(candidate)
    ? candidate
    : statusCode >= 500
      ? "INSTALLATION_API_ADMIN_UNAVAILABLE"
      : "INVALID_INSTALLATION_API_ADMIN_REQUEST";
  throw Object.assign(new Error(message), { statusCode });
}

export class InstallationApiService {
  public constructor(private readonly pool: DatabasePool) {}

  public async exchange(input: {
    clientIdentifier: string;
    clientSecret: string;
    scope: string;
  }) {
    const accessToken = randomBytes(32).toString("base64url");
    const result = await this.pool
      .query<{
        expires_at: Date;
        scope: string;
      }>(
        `SELECT * FROM control.exchange_installation_api_client($1,$2,$3,$4)`,
        [
          input.clientIdentifier,
          digest(input.clientSecret),
          digest(accessToken),
          input.scope,
        ],
      )
      .catch(apiFailure);
    const expiresAt = result.rows[0]!.expires_at;
    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: Math.max(
        1,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      ),
      scope: result.rows[0]!.scope,
    };
  }

  public async controlSummary(accessToken: string): Promise<unknown> {
    const result = await this.pool
      .query<{
        summary: unknown;
      }>(`SELECT control.installation_api_control_summary($1) AS summary`, [
        digest(accessToken),
      ])
      .catch(apiFailure);
    return result.rows[0]!.summary;
  }

  public async listForTenant(input: {
    actorUserId: string;
    tenantId: string;
  }): Promise<TenantApiClient[]> {
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.tenant_api_clients($1,$2)`, [input.actorUserId, input.tenantId])
      .catch(tenantApiAdminFailure);
    return result.rows.map((row) => camel(row) as unknown as TenantApiClient);
  }

  public async issueForTenant(input: {
    actorUserId: string;
    tenantId: string;
    displayName: string;
    lifetimeDays: number;
    correlationId: string;
  }) {
    const clientIdentifier = `rc_${randomBytes(32).toString("base64url")}`;
    const clientSecret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + input.lifetimeDays * 86_400_000,
    ).toISOString();
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.issue_tenant_api_client($1,$2,$3,$4,$5,$6,$7)`, [input.actorUserId, input.tenantId, clientIdentifier, digest(clientSecret), input.displayName, expiresAt, input.correlationId])
      .catch(tenantApiAdminFailure);
    return {
      ...camel(result.rows[0]!),
      clientIdentifier,
      clientSecret,
      scope: "control:read" as const,
    };
  }

  public async rotateForTenant(input: {
    actorUserId: string;
    tenantId: string;
    clientId: string;
    correlationId: string;
  }) {
    const clientSecret = randomBytes(32).toString("base64url");
    const result = await this.pool
      .query<
        Record<string, unknown>
      >(`SELECT * FROM control.rotate_tenant_api_client($1,$2,$3,$4,$5)`, [input.actorUserId, input.tenantId, input.clientId, digest(clientSecret), input.correlationId])
      .catch(tenantApiAdminFailure);
    return {
      ...camel(result.rows[0]!),
      clientSecret,
      scope: "control:read" as const,
    };
  }

  public async revokeForTenant(input: {
    actorUserId: string;
    tenantId: string;
    clientId: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.revoke_tenant_api_client($1,$2,$3,$4)`, [
        input.actorUserId,
        input.tenantId,
        input.clientId,
        input.correlationId,
      ])
      .catch(tenantApiAdminFailure);
  }
}

export const workzoneResponsibilities = [
  "lead",
  "editorial",
  "approval",
  "research",
  "social",
  "operations",
] as const;
export type WorkzoneResponsibility = (typeof workzoneResponsibilities)[number];

export const workzoneLifecycleDependencyKeys = [
  "publishing_delivery",
  "editorial_content",
  "research_evidence",
  "ai_governance",
  "tenant_setup",
  "team_assignments",
  "personal_saved_views",
] as const;
export type WorkzoneLifecycleDependencyKey =
  (typeof workzoneLifecycleDependencyKeys)[number];

export const workzoneLifecycleBlockerKeys = [
  "active_uploads",
  "active_oauth",
  "active_delivery",
  "last_active_workzone",
] as const;
export type WorkzoneLifecycleBlockerKey =
  (typeof workzoneLifecycleBlockerKeys)[number];

export interface WorkzoneLifecycleImpact {
  readonly schemaVersion: 2;
  readonly workspaceId: string;
  readonly evaluatedAt: string;
  readonly mode: "preview_only";
  readonly status: "active" | "archived";
  readonly operations: {
    readonly archiveAvailable: boolean;
    readonly restoreAvailable: boolean;
    readonly deleteAvailable: false;
    readonly reason:
      | "ready_to_archive"
      | "ready_to_restore"
      | "last_active_workzone"
      | "active_operations";
  };
  readonly blockingReferenceRows: number;
  readonly informationalReferenceRows: number;
  readonly hasBlockingReferences: boolean;
  readonly dependencies: readonly {
    readonly key: WorkzoneLifecycleDependencyKey;
    readonly kind: "blocking" | "informational";
    readonly referenceRows: number;
  }[];
  readonly transitionBlockers: readonly {
    readonly key: WorkzoneLifecycleBlockerKey;
    readonly count: number;
  }[];
}

export interface WorkzoneLifecycleResult {
  readonly eventId: string;
  readonly outcome: "executed" | "refused";
  readonly code:
    | "WORKZONE_ARCHIVED"
    | "WORKZONE_RESTORED"
    | "WORKZONE_LAST_ACTIVE"
    | "WORKZONE_ACTIVE_OPERATIONS"
    | "WORKZONE_ALREADY_ARCHIVED"
    | "WORKZONE_ALREADY_ACTIVE";
  readonly status: "active" | "archived";
  readonly lifecycleVersion: number;
  readonly replayed: boolean;
}

export interface WorkzoneProvisioningSnapshot {
  readonly installationId: string;
  readonly maximumWorkzones: number;
  readonly workzoneCount: number;
  readonly activeWorkzoneCount: number;
  readonly archivedWorkzoneCount: number;
  readonly remainingCapacity: number;
  readonly securityBoundary: "tenant_membership";
  readonly workzones: readonly {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly status: "active" | "archived";
    readonly lifecycleVersion: number;
    readonly archivedAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly assignments: readonly {
      readonly id: string;
      readonly userId: string;
      readonly email: string;
      readonly responsibility: WorkzoneResponsibility;
      readonly assignedAt: string;
    }[];
  }[];
  readonly members: readonly {
    readonly userId: string;
    readonly email: string;
    readonly roles: readonly string[];
  }[];
}

function workzoneProvisioningFailure(error: unknown): never {
  const failure = error as { code?: string; message?: string };
  const candidate = failure.message?.split("\n")[0] ?? "";
  const known = new Set([
    "WORKZONE_PROVISIONING_DENIED",
    "WORKZONE_PROVISIONING_UNAVAILABLE",
    "INVALID_WORKZONE_PROVISIONING",
    "WORKZONE_LIMIT_REACHED",
    "WORKZONE_NOT_FOUND",
    "WORKZONE_ASSIGNMENT_NOT_ELIGIBLE",
    "WORKZONE_ASSIGNMENT_NOT_FOUND",
    "WORKZONE_NOT_ACTIVE",
    "WORKZONE_ARCHIVED",
    "INVALID_WORKZONE_LIFECYCLE",
    "WORKZONE_LIFECYCLE_IDEMPOTENCY_CONFLICT",
  ]);
  const statusCode =
    failure.code === "42501"
      ? 403
      : failure.code === "23505" ||
          failure.code === "23514" ||
          failure.code === "55000"
        ? 409
        : failure.code === "22023"
          ? 400
          : 500;
  const message = known.has(candidate)
    ? candidate
    : statusCode >= 500
      ? "WORKZONE_PROVISIONING_UNAVAILABLE"
      : "INVALID_WORKZONE_PROVISIONING";
  throw Object.assign(new Error(message), { statusCode });
}

export class WorkzoneProvisioningService {
  public constructor(private readonly pool: DatabasePool) {}

  public async snapshot(input: {
    actorUserId: string;
    tenantId: string;
  }): Promise<WorkzoneProvisioningSnapshot> {
    const result = await this.pool
      .query<{
        snapshot: WorkzoneProvisioningSnapshot;
      }>(`SELECT control.workzone_provisioning_snapshot($1,$2) snapshot`, [
        input.actorUserId,
        input.tenantId,
      ])
      .catch(workzoneProvisioningFailure);
    return result.rows[0]!.snapshot;
  }

  public async lifecycleImpact(input: {
    actorUserId: string;
    tenantId: string;
    workspaceId: string;
  }): Promise<WorkzoneLifecycleImpact> {
    const result = await this.pool
      .query<{
        impact: WorkzoneLifecycleImpact;
      }>(`SELECT control.workzone_lifecycle_impact($1,$2,$3) impact`, [
        input.actorUserId,
        input.tenantId,
        input.workspaceId,
      ])
      .catch(workzoneProvisioningFailure);
    return result.rows[0]!.impact;
  }

  public async transitionLifecycle(input: {
    actorUserId: string;
    tenantId: string;
    workspaceId: string;
    action: "archive" | "restore";
    reason: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<WorkzoneLifecycleResult> {
    const result = await this.pool
      .query<{
        result: WorkzoneLifecycleResult;
      }>(
        `SELECT control.transition_tenant_workzone($1,$2,$3,$4,$5,$6,$7) result`,
        [
          input.actorUserId,
          input.tenantId,
          input.workspaceId,
          input.action,
          input.reason,
          input.idempotencyKey,
          input.correlationId,
        ],
      )
      .catch(workzoneProvisioningFailure);
    return result.rows[0]!.result;
  }

  public async create(input: {
    actorUserId: string;
    tenantId: string;
    slug: string;
    name: string;
    description: string;
    correlationId: string;
  }): Promise<{ id: string }> {
    const result = await this.pool
      .query<{
        id: string;
      }>(`SELECT control.create_tenant_workzone($1,$2,$3,$4,$5,$6) id`, [
        input.actorUserId,
        input.tenantId,
        input.slug,
        input.name,
        input.description,
        input.correlationId,
      ])
      .catch(workzoneProvisioningFailure);
    return { id: result.rows[0]!.id };
  }

  public async update(input: {
    actorUserId: string;
    tenantId: string;
    workspaceId: string;
    name: string;
    description: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.update_tenant_workzone($1,$2,$3,$4,$5,$6)`, [
        input.actorUserId,
        input.tenantId,
        input.workspaceId,
        input.name,
        input.description,
        input.correlationId,
      ])
      .catch(workzoneProvisioningFailure);
  }

  public async assign(input: {
    actorUserId: string;
    tenantId: string;
    workspaceId: string;
    userId: string;
    responsibility: WorkzoneResponsibility;
    correlationId: string;
  }): Promise<{ id: string }> {
    const result = await this.pool
      .query<{
        id: string;
      }>(`SELECT control.assign_tenant_workzone_member($1,$2,$3,$4,$5,$6) id`, [
        input.actorUserId,
        input.tenantId,
        input.workspaceId,
        input.userId,
        input.responsibility,
        input.correlationId,
      ])
      .catch(workzoneProvisioningFailure);
    return { id: result.rows[0]!.id };
  }

  public async remove(input: {
    actorUserId: string;
    tenantId: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
  }): Promise<void> {
    await this.pool
      .query(`SELECT control.remove_tenant_workzone_member($1,$2,$3,$4,$5)`, [
        input.actorUserId,
        input.tenantId,
        input.workspaceId,
        input.userId,
        input.correlationId,
      ])
      .catch(workzoneProvisioningFailure);
  }
}
