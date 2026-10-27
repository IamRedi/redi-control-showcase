export type PlatformTenant = {
  tenantId: string;
  tenantSlug: string;
  displayName: string;
  tenantStatus: string;
  installationStatus: string;
  workspaceCount: number;
  memberCount: number;
  pendingLifecycleCount: number;
};

export type PlatformLifecycle = {
  id: string;
  targetTenantId: string;
  targetName: string;
  action: "suspend" | "reactivate" | "request_deletion";
  reason: string;
  status: "pending" | "executed" | "cancelled";
  requestedAt: string;
  requestedByCurrentUser: boolean;
};

export type PlatformInventory = {
  tenants: PlatformTenant[];
  lifecycleRequests: PlatformLifecycle[];
  tenantSetups: Array<{
    targetTenantId: string;
    templateId: "media_starter" | "media_team" | "media_network";
    status: "configured" | "awaiting_owner";
    defaultLocale: "en" | "de" | "sq";
    enabledLocales: Array<"en" | "de" | "sq">;
    configuredAt: string;
  }>;
  onboarding: Array<{
    targetTenantId: string;
    installationId: string | null;
    setupStatus: "not_configured" | "configured" | "awaiting_owner";
    tenantStatus: string;
    installationStatus: string;
    domainStatus: string;
    ownerCount: number;
    workspaceCount: number;
    pendingInvitationId: string | null;
    invitationExpiresAt: string | null;
    invitationStatus:
      | "not_issued"
      | "active"
      | "consumed"
      | "revoked"
      | "expired";
    invitationEligible: boolean;
    blockers: string[];
  }>;
  apiClients: Array<{
    id: string;
    targetTenantId: string;
    targetName: string;
    installationId: string;
    displayName: string;
    clientIdentifier: string;
    scopes: ["control:read"];
    status: "active" | "revoked";
    createdAt: string;
    expiresAt: string;
    lastExchangedAt: string | null;
  }>;
  templates: Array<{
    id: "media_starter" | "media_team" | "media_network";
    name: string;
    maximumUsers: number;
    maximumWorkspaces: number;
    maximumSocialAccounts: number;
    monthlyPublicationQuota: number;
    storageQuotaBytes: number;
    modules: string[];
  }>;
  impersonationAvailable: false;
};
