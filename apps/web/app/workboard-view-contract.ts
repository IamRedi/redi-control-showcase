import {
  workboardAssignmentScopes,
  workboardFocuses,
  type WorkboardHandoffFilter,
  workboardHandoffStates,
  workboardSortOrders,
  workboardStages,
  type WorkboardAssignmentScope,
  type WorkboardFocus,
  type WorkboardSortOrder,
  type WorkboardStage,
} from "./workboard-contract";

export type WorkboardViewStage = WorkboardStage | "all";

export interface WorkboardViewSnapshot {
  readonly maximumSavedViews: number;
  readonly defaultViewId: string | null;
  readonly workspaces: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly status: "active" | "archived";
  }[];
  readonly savedViews: readonly {
    readonly id: string;
    readonly name: string;
    readonly workspaceId: string;
    readonly availability: "active" | "workspace_archived";
    readonly stage: WorkboardViewStage;
    readonly query: string;
    readonly assignmentScope: WorkboardAssignmentScope;
    readonly focus: WorkboardFocus;
    readonly handoffFilter: WorkboardHandoffFilter;
    readonly sortOrder: WorkboardSortOrder;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
}

export interface WorkboardViewInput {
  readonly workspaceId: string;
  readonly name: string;
  readonly stage: WorkboardViewStage;
  readonly query: string;
  readonly assignmentScope: WorkboardAssignmentScope;
  readonly focus: WorkboardFocus;
  readonly handoffFilter: WorkboardHandoffFilter;
  readonly sortOrder: WorkboardSortOrder;
}

export interface WorkboardDefaultViewInput {
  readonly viewId: string | null;
}

export interface WorkboardViewNameInput {
  readonly name: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages: readonly WorkboardViewStage[] = ["all", ...workboardStages];
const handoffFilters: readonly WorkboardHandoffFilter[] = [
  "all",
  ...workboardHandoffStates,
];
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  !Number.isNaN(Date.parse(value));

export function parseWorkboardViewInput(
  value: unknown,
): WorkboardViewInput | null {
  const input = record(value);
  const handoffFilter = input?.handoffFilter ?? "all";
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        ![
          "workspaceId",
          "name",
          "stage",
          "query",
          "assignmentScope",
          "focus",
          "handoffFilter",
          "sortOrder",
        ].includes(key),
    ) ||
    typeof input.workspaceId !== "string" ||
    !UUID.test(input.workspaceId) ||
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.trim().length > 80 ||
    !stages.includes(input.stage as WorkboardViewStage) ||
    typeof input.query !== "string" ||
    input.query.length > 160 ||
    !workboardAssignmentScopes.includes(
      input.assignmentScope as WorkboardAssignmentScope,
    ) ||
    !workboardFocuses.includes(input.focus as WorkboardFocus) ||
    !handoffFilters.includes(handoffFilter as WorkboardHandoffFilter) ||
    !workboardSortOrders.includes(input.sortOrder as WorkboardSortOrder)
  )
    return null;
  return {
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    stage: input.stage as WorkboardViewStage,
    query: input.query,
    assignmentScope: input.assignmentScope as WorkboardAssignmentScope,
    focus: input.focus as WorkboardFocus,
    handoffFilter: handoffFilter as WorkboardHandoffFilter,
    sortOrder: input.sortOrder as WorkboardSortOrder,
  };
}

export function parseWorkboardDefaultViewInput(
  value: unknown,
): WorkboardDefaultViewInput | null {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "viewId") ||
    !(
      input.viewId === null ||
      (typeof input.viewId === "string" && UUID.test(input.viewId))
    )
  )
    return null;
  return { viewId: input.viewId };
}

export function parseWorkboardViewNameInput(
  value: unknown,
): WorkboardViewNameInput | null {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "name") ||
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.trim().length > 80
  )
    return null;
  return { name: input.name.trim() };
}

export function parseWorkboardViewSnapshot(
  value: unknown,
): WorkboardViewSnapshot | null {
  const envelope = record(value);
  if (
    !envelope ||
    typeof envelope.maximumSavedViews !== "number" ||
    !Number.isInteger(envelope.maximumSavedViews) ||
    envelope.maximumSavedViews < 1 ||
    envelope.maximumSavedViews > 100 ||
    !Array.isArray(envelope.workspaces) ||
    envelope.workspaces.length < 1 ||
    envelope.workspaces.length > 100 ||
    !Array.isArray(envelope.savedViews) ||
    envelope.savedViews.length > envelope.maximumSavedViews
  )
    return null;

  const workspaces: WorkboardViewSnapshot["workspaces"][number][] = [];
  const workspaceIds = new Set<string>();
  for (const candidate of envelope.workspaces) {
    const workspace = record(candidate);
    if (
      !workspace ||
      typeof workspace.id !== "string" ||
      !UUID.test(workspace.id) ||
      workspaceIds.has(workspace.id) ||
      typeof workspace.displayName !== "string" ||
      workspace.displayName.length < 2 ||
      workspace.displayName.length > 160 ||
      !["active", "archived"].includes(String(workspace.status))
    )
      return null;
    workspaceIds.add(workspace.id);
    workspaces.push({
      id: workspace.id,
      displayName: workspace.displayName,
      status: workspace.status as "active" | "archived",
    });
  }

  const savedViews: WorkboardViewSnapshot["savedViews"][number][] = [];
  const viewIds = new Set<string>();
  const viewNames = new Set<string>();
  for (const candidate of envelope.savedViews) {
    const view = record(candidate);
    const normalizedName =
      typeof view?.name === "string" ? view.name.trim().toLowerCase() : "";
    const workspace = workspaces.find((item) => item.id === view?.workspaceId);
    if (
      !view ||
      typeof view.id !== "string" ||
      !UUID.test(view.id) ||
      viewIds.has(view.id) ||
      typeof view.name !== "string" ||
      view.name.trim().length < 2 ||
      view.name.trim().length > 80 ||
      viewNames.has(normalizedName) ||
      typeof view.workspaceId !== "string" ||
      !workspace ||
      !["active", "workspace_archived"].includes(String(view.availability)) ||
      view.availability !==
        (workspace.status === "active" ? "active" : "workspace_archived") ||
      !stages.includes(view.stage as WorkboardViewStage) ||
      typeof view.query !== "string" ||
      view.query.length > 160 ||
      !workboardAssignmentScopes.includes(
        view.assignmentScope as WorkboardAssignmentScope,
      ) ||
      !workboardFocuses.includes(view.focus as WorkboardFocus) ||
      !handoffFilters.includes(view.handoffFilter as WorkboardHandoffFilter) ||
      !workboardSortOrders.includes(view.sortOrder as WorkboardSortOrder) ||
      !timestamp(view.createdAt) ||
      !timestamp(view.updatedAt)
    )
      return null;
    viewIds.add(view.id);
    viewNames.add(normalizedName);
    savedViews.push({
      id: view.id,
      name: view.name,
      workspaceId: view.workspaceId,
      availability: view.availability as "active" | "workspace_archived",
      stage: view.stage as WorkboardViewStage,
      query: view.query,
      assignmentScope: view.assignmentScope as WorkboardAssignmentScope,
      focus: view.focus as WorkboardFocus,
      handoffFilter: view.handoffFilter as WorkboardHandoffFilter,
      sortOrder: view.sortOrder as WorkboardSortOrder,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    });
  }
  const requestedDefaultViewId = envelope.defaultViewId ?? null;
  const defaultViewId =
    typeof requestedDefaultViewId === "string" &&
    savedViews.some(
      (view) =>
        view.id === requestedDefaultViewId && view.availability === "active",
    )
      ? requestedDefaultViewId
      : null;
  return {
    maximumSavedViews: envelope.maximumSavedViews,
    defaultViewId,
    workspaces,
    savedViews,
  };
}

export function resolveWorkboardStartupView(snapshot: WorkboardViewSnapshot) {
  if (!snapshot.defaultViewId) return null;
  return (
    snapshot.savedViews.find(
      (view) =>
        view.id === snapshot.defaultViewId && view.availability === "active",
    ) ?? null
  );
}
