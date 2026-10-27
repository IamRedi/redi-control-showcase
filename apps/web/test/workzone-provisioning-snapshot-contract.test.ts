import { describe, expect, it } from "vitest";

import {
  parseWorkzoneLifecycleImpact,
  parseWorkzoneProvisioningSnapshot,
} from "../app/workzone-provisioning-contract.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const valid = {
  installationId: "22222222-2222-4222-8222-222222222222",
  maximumWorkzones: 2,
  workzoneCount: 1,
  activeWorkzoneCount: 1,
  archivedWorkzoneCount: 0,
  remainingCapacity: 1,
  securityBoundary: "tenant_membership",
  members: [
    {
      userId: "33333333-3333-4333-8333-333333333333",
      email: "owner@example.invalid",
      roles: ["root_owner"],
    },
  ],
  workzones: [
    {
      id: workspaceId,
      slug: "news-desk",
      name: "News desk",
      description: "Verified news workflow.",
      status: "active",
      lifecycleVersion: 1,
      archivedAt: null,
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
      providerSecret: "must-not-be-projected",
      assignments: [],
    },
  ],
};
const impact = {
  schemaVersion: 2,
  workspaceId,
  evaluatedAt: "2026-08-29T10:00:00.000Z",
  mode: "preview_only",
  status: "active",
  operations: {
    archiveAvailable: true,
    restoreAvailable: false,
    deleteAvailable: false,
    reason: "ready_to_archive",
  },
  blockingReferenceRows: 6,
  informationalReferenceRows: 2,
  hasBlockingReferences: true,
  dependencies: [
    { key: "publishing_delivery", kind: "blocking", referenceRows: 1 },
    { key: "editorial_content", kind: "blocking", referenceRows: 2 },
    { key: "research_evidence", kind: "blocking", referenceRows: 3 },
    { key: "ai_governance", kind: "blocking", referenceRows: 0 },
    { key: "tenant_setup", kind: "blocking", referenceRows: 0 },
    { key: "team_assignments", kind: "informational", referenceRows: 1 },
    { key: "personal_saved_views", kind: "informational", referenceRows: 1 },
  ],
  transitionBlockers: [
    { key: "active_uploads", count: 0 },
    { key: "active_oauth", count: 0 },
    { key: "active_delivery", count: 0 },
    { key: "last_active_workzone", count: 0 },
  ],
};

describe("Workzone provisioning snapshot contract", () => {
  it("projects only governed provisioning fields", () => {
    const parsed = parseWorkzoneProvisioningSnapshot(valid);
    expect(parsed).not.toBeNull();
    expect(parsed?.workzones[0]).not.toHaveProperty("providerSecret");
  });

  it("accepts a complete lifecycle inventory and fails closed for drift", () => {
    expect(parseWorkzoneLifecycleImpact(impact, workspaceId)).toMatchObject({
      mode: "preview_only",
      blockingReferenceRows: 6,
      informationalReferenceRows: 2,
    });
    expect(
      parseWorkzoneLifecycleImpact(
        { ...impact, blockingReferenceRows: 99 },
        workspaceId,
      ),
    ).toBeNull();
    expect(
      parseWorkzoneLifecycleImpact(
        {
          ...impact,
          operations: { ...impact.operations, deleteAvailable: true },
        },
        workspaceId,
      ),
    ).toBeNull();
    expect(
      parseWorkzoneLifecycleImpact(
        impact,
        "99999999-9999-4999-8999-999999999999",
      ),
    ).toBeNull();
  });

  it("fails closed for an assignment outside the disclosed member list", () => {
    expect(
      parseWorkzoneProvisioningSnapshot({
        ...valid,
        workzones: [
          {
            ...valid.workzones[0]!,
            assignments: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                userId: "55555555-5555-4555-8555-555555555555",
                email: "foreign@example.invalid",
                responsibility: "lead",
                assignedAt: "2026-08-29T10:00:00.000Z",
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });
});
