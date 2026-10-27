export type WorkzoneResponsibility =
  | "lead"
  | "editorial"
  | "approval"
  | "research"
  | "social"
  | "operations";

export type WorkzoneLifecycleDependencyKey =
  | "publishing_delivery"
  | "editorial_content"
  | "research_evidence"
  | "ai_governance"
  | "tenant_setup"
  | "team_assignments"
  | "personal_saved_views";

export type WorkzoneLifecycleBlockerKey =
  | "active_uploads"
  | "active_oauth"
  | "active_delivery"
  | "last_active_workzone";

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

export interface WorkzoneProvisioningSnapshot {
  readonly installationId: string;
  readonly maximumWorkzones: number;
  readonly workzoneCount: number;
  readonly activeWorkzoneCount: number;
  readonly archivedWorkzoneCount: number;
  readonly remainingCapacity: number;
  readonly securityBoundary: "tenant_membership";
  readonly members: readonly {
    readonly userId: string;
    readonly email: string;
    readonly roles: readonly string[];
  }[];
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
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const responsibilities = [
  "lead",
  "editorial",
  "approval",
  "research",
  "social",
  "operations",
] as const;
const dependencyPolicy = new Map<
  WorkzoneLifecycleDependencyKey,
  "blocking" | "informational"
>([
  ["publishing_delivery", "blocking"],
  ["editorial_content", "blocking"],
  ["research_evidence", "blocking"],
  ["ai_governance", "blocking"],
  ["tenant_setup", "blocking"],
  ["team_assignments", "informational"],
  ["personal_saved_views", "informational"],
]);
const blockerKeys: readonly WorkzoneLifecycleBlockerKey[] = [
  "active_uploads",
  "active_oauth",
  "active_delivery",
  "last_active_workzone",
];
const operationReasons = [
  "ready_to_archive",
  "ready_to_restore",
  "last_active_workzone",
  "active_operations",
] as const;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const bounded = (
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  (allowEmpty || value.length > 0);
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  Number.isFinite(Date.parse(value));

export function parseWorkzoneProvisioningSnapshot(
  value: unknown,
): WorkzoneProvisioningSnapshot | null {
  const envelope = record(value);
  if (
    !envelope ||
    typeof envelope.installationId !== "string" ||
    !UUID.test(envelope.installationId) ||
    !integer(envelope.maximumWorkzones) ||
    !integer(envelope.workzoneCount) ||
    !integer(envelope.activeWorkzoneCount) ||
    !integer(envelope.archivedWorkzoneCount) ||
    envelope.activeWorkzoneCount + envelope.archivedWorkzoneCount !==
      envelope.workzoneCount ||
    !integer(envelope.remainingCapacity) ||
    envelope.workzoneCount > envelope.maximumWorkzones ||
    envelope.remainingCapacity !==
      envelope.maximumWorkzones - envelope.workzoneCount ||
    envelope.securityBoundary !== "tenant_membership" ||
    !Array.isArray(envelope.members) ||
    !Array.isArray(envelope.workzones) ||
    envelope.workzones.length !== envelope.workzoneCount
  )
    return null;

  const members: WorkzoneProvisioningSnapshot["members"][number][] = [];
  const memberIds = new Set<string>();
  for (const candidate of envelope.members) {
    const member = record(candidate);
    if (
      !member ||
      typeof member.userId !== "string" ||
      !UUID.test(member.userId) ||
      memberIds.has(member.userId) ||
      !bounded(member.email, 320) ||
      !Array.isArray(member.roles) ||
      member.roles.length === 0 ||
      !member.roles.every((role) => bounded(role, 80))
    )
      return null;
    memberIds.add(member.userId);
    members.push({
      userId: member.userId,
      email: member.email,
      roles: member.roles,
    });
  }

  const workzones: WorkzoneProvisioningSnapshot["workzones"][number][] = [];
  const workzoneIds = new Set<string>();
  for (const candidate of envelope.workzones) {
    const workzone = record(candidate);
    if (
      !workzone ||
      typeof workzone.id !== "string" ||
      !UUID.test(workzone.id) ||
      workzoneIds.has(workzone.id) ||
      !bounded(workzone.slug, 63) ||
      !bounded(workzone.name, 160) ||
      !bounded(workzone.description, 500, true) ||
      !["active", "archived"].includes(String(workzone.status)) ||
      !integer(workzone.lifecycleVersion) ||
      workzone.lifecycleVersion < 1 ||
      !(
        (workzone.status === "active" && workzone.archivedAt === null) ||
        (workzone.status === "archived" && date(workzone.archivedAt))
      ) ||
      !date(workzone.createdAt) ||
      !date(workzone.updatedAt) ||
      !Array.isArray(workzone.assignments)
    )
      return null;

    const assignments: WorkzoneProvisioningSnapshot["workzones"][number]["assignments"][number][] =
      [];
    const assignedUsers = new Set<string>();
    for (const assignmentCandidate of workzone.assignments) {
      const assignment = record(assignmentCandidate);
      if (
        !assignment ||
        typeof assignment.id !== "string" ||
        !UUID.test(assignment.id) ||
        typeof assignment.userId !== "string" ||
        !UUID.test(assignment.userId) ||
        assignedUsers.has(assignment.userId) ||
        !memberIds.has(assignment.userId) ||
        !bounded(assignment.email, 320) ||
        !responsibilities.includes(
          assignment.responsibility as WorkzoneResponsibility,
        ) ||
        !date(assignment.assignedAt)
      )
        return null;
      assignedUsers.add(assignment.userId);
      assignments.push({
        id: assignment.id,
        userId: assignment.userId,
        email: assignment.email,
        responsibility: assignment.responsibility as WorkzoneResponsibility,
        assignedAt: assignment.assignedAt,
      });
    }

    workzoneIds.add(workzone.id);
    workzones.push({
      id: workzone.id,
      slug: workzone.slug,
      name: workzone.name,
      description: workzone.description,
      status: workzone.status,
      lifecycleVersion: workzone.lifecycleVersion,
      archivedAt: workzone.archivedAt,
      createdAt: workzone.createdAt,
      updatedAt: workzone.updatedAt,
      assignments,
    });
  }

  return {
    installationId: envelope.installationId,
    maximumWorkzones: envelope.maximumWorkzones,
    workzoneCount: envelope.workzoneCount,
    activeWorkzoneCount: envelope.activeWorkzoneCount,
    archivedWorkzoneCount: envelope.archivedWorkzoneCount,
    remainingCapacity: envelope.remainingCapacity,
    securityBoundary: "tenant_membership",
    members,
    workzones,
  };
}

export function parseWorkzoneLifecycleImpact(
  value: unknown,
  expectedWorkspaceId: string,
): WorkzoneLifecycleImpact | null {
  const impact = record(value);
  const operations = record(impact?.operations);
  if (
    !UUID.test(expectedWorkspaceId) ||
    !impact ||
    impact.schemaVersion !== 2 ||
    impact.workspaceId !== expectedWorkspaceId ||
    !date(impact.evaluatedAt) ||
    impact.mode !== "preview_only" ||
    !["active", "archived"].includes(String(impact.status)) ||
    !operations ||
    typeof operations.archiveAvailable !== "boolean" ||
    typeof operations.restoreAvailable !== "boolean" ||
    operations.deleteAvailable !== false ||
    !operationReasons.includes(
      operations.reason as (typeof operationReasons)[number],
    ) ||
    !integer(impact.blockingReferenceRows) ||
    !integer(impact.informationalReferenceRows) ||
    typeof impact.hasBlockingReferences !== "boolean" ||
    impact.hasBlockingReferences !== impact.blockingReferenceRows > 0 ||
    !Array.isArray(impact.dependencies) ||
    impact.dependencies.length !== dependencyPolicy.size ||
    !Array.isArray(impact.transitionBlockers) ||
    impact.transitionBlockers.length !== blockerKeys.length
  )
    return null;

  const dependencies: WorkzoneLifecycleImpact["dependencies"][number][] = [];
  const dependencyKeys = new Set<string>();
  let blockingRows = 0;
  let informationalRows = 0;
  for (const candidate of impact.dependencies) {
    const dependency = record(candidate);
    const expectedKind = dependencyPolicy.get(
      dependency?.key as WorkzoneLifecycleDependencyKey,
    );
    if (
      !dependency ||
      !expectedKind ||
      dependency.kind !== expectedKind ||
      dependencyKeys.has(String(dependency.key)) ||
      !integer(dependency.referenceRows)
    )
      return null;
    dependencyKeys.add(String(dependency.key));
    if (expectedKind === "blocking") blockingRows += dependency.referenceRows;
    else informationalRows += dependency.referenceRows;
    dependencies.push({
      key: dependency.key as WorkzoneLifecycleDependencyKey,
      kind: expectedKind,
      referenceRows: dependency.referenceRows,
    });
  }
  if (
    blockingRows !== impact.blockingReferenceRows ||
    informationalRows !== impact.informationalReferenceRows
  )
    return null;

  const transitionBlockers: WorkzoneLifecycleImpact["transitionBlockers"][number][] =
    [];
  const seenBlockers = new Set<string>();
  for (const candidate of impact.transitionBlockers) {
    const blocker = record(candidate);
    if (
      !blocker ||
      !blockerKeys.includes(blocker.key as WorkzoneLifecycleBlockerKey) ||
      seenBlockers.has(String(blocker.key)) ||
      !integer(blocker.count)
    )
      return null;
    seenBlockers.add(String(blocker.key));
    transitionBlockers.push({
      key: blocker.key as WorkzoneLifecycleBlockerKey,
      count: blocker.count,
    });
  }
  const blockerCount = transitionBlockers.reduce(
    (total, blocker) => total + blocker.count,
    0,
  );
  const status = impact.status as "active" | "archived";
  const reason =
    operations.reason as WorkzoneLifecycleImpact["operations"]["reason"];
  const validOperationState =
    (status === "archived" &&
      operations.archiveAvailable === false &&
      operations.restoreAvailable === true &&
      reason === "ready_to_restore") ||
    (status === "active" &&
      operations.restoreAvailable === false &&
      ((operations.archiveAvailable === true &&
        reason === "ready_to_archive" &&
        blockerCount === 0) ||
        (operations.archiveAvailable === false &&
          ["last_active_workzone", "active_operations"].includes(reason) &&
          blockerCount > 0)));
  if (!validOperationState) return null;

  return {
    schemaVersion: 2,
    workspaceId: expectedWorkspaceId,
    evaluatedAt: impact.evaluatedAt,
    mode: "preview_only",
    status,
    operations: {
      archiveAvailable: operations.archiveAvailable,
      restoreAvailable: operations.restoreAvailable,
      deleteAvailable: false,
      reason,
    },
    blockingReferenceRows: impact.blockingReferenceRows,
    informationalReferenceRows: impact.informationalReferenceRows,
    hasBlockingReferences: impact.hasBlockingReferences,
    dependencies,
    transitionBlockers,
  };
}
