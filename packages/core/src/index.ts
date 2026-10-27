export const roles = [
  "root_owner",
  "white_label_owner",
  "admin",
  "approver",
  "editor",
  "analyst",
] as const;

export type Role = (typeof roles)[number];
export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };

export interface RequestActor {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly roles: readonly Role[];
}

export type Permission =
  | "tenant:admin"
  | "platform:read"
  | "platform:connect"
  | "content:edit"
  | "content:approve"
  | "analytics:read"
  | "audit:read";

const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  root_owner: new Set<Permission>([
    "tenant:admin",
    "platform:read",
    "platform:connect",
    "content:edit",
    "content:approve",
    "analytics:read",
    "audit:read",
  ]),
  white_label_owner: new Set<Permission>([
    "tenant:admin",
    "platform:read",
    "platform:connect",
    "content:edit",
    "content:approve",
    "analytics:read",
    "audit:read",
  ]),
  admin: new Set<Permission>([
    "platform:read",
    "platform:connect",
    "content:edit",
    "content:approve",
    "analytics:read",
    "audit:read",
  ]),
  approver: new Set<Permission>([
    "platform:read",
    "content:edit",
    "content:approve",
    "analytics:read",
  ]),
  editor: new Set<Permission>([
    "platform:read",
    "content:edit",
    "analytics:read",
  ]),
  analyst: new Set<Permission>(["platform:read", "analytics:read"]),
};

export function hasPermission(
  actor: RequestActor,
  permission: Permission,
): boolean {
  return actor.roles.some((role) => rolePermissions[role].has(permission));
}

export function assertSameTenant(
  actor: RequestActor,
  resourceTenantId: TenantId,
): void {
  if (actor.tenantId !== resourceTenantId) {
    throw new Error("Cross-tenant access denied");
  }
}

export function assertIndependentApprover(
  requestedBy: UserId,
  approvedBy: UserId,
): void {
  if (requestedBy === approvedBy) {
    throw new Error("Sensitive operations cannot be self-approved");
  }
}
