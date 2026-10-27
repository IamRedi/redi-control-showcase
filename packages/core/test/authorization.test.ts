import { describe, expect, it } from "vitest";

import {
  assertIndependentApprover,
  assertSameTenant,
  hasPermission,
  type RequestActor,
  type TenantId,
  type UserId,
} from "../src/index.js";

const actor: RequestActor = {
  userId: "user-1" as UserId,
  tenantId: "tenant-a" as TenantId,
  roles: ["analyst"],
};

describe("authorization foundation", () => {
  it("uses least privilege for analysts", () => {
    expect(hasPermission(actor, "analytics:read")).toBe(true);
    expect(hasPermission(actor, "content:approve")).toBe(false);
  });

  it("rejects cross-tenant resources", () => {
    expect(() => assertSameTenant(actor, "tenant-b" as TenantId)).toThrow(
      "Cross-tenant access denied",
    );
  });

  it("rejects self-approval for sensitive operations", () => {
    expect(() => assertIndependentApprover(actor.userId, actor.userId)).toThrow(
      "Sensitive operations cannot be self-approved",
    );
  });
});
