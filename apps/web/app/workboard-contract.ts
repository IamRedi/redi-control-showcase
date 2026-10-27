export const workboardStages = [
  "research",
  "ready",
  "drafting",
  "review",
  "scheduled",
  "done",
  "attention",
] as const;

export type WorkboardStage = (typeof workboardStages)[number];
export const workboardAssignmentScopes = ["all", "mine", "unassigned"] as const;
export type WorkboardAssignmentScope =
  (typeof workboardAssignmentScopes)[number];
export const workboardFocuses = [
  "all",
  "attention",
  "overdue",
  "due_soon",
] as const;
export type WorkboardFocus = (typeof workboardFocuses)[number];
export const workboardSortOrders = ["smart", "deadline", "updated"] as const;
export type WorkboardSortOrder = (typeof workboardSortOrders)[number];
export type WorkboardDueState =
  | "none"
  | "overdue"
  | "due_soon"
  | "scheduled"
  | "complete";
export type WorkboardHandoffCheck =
  | "complete"
  | "pending"
  | "blocked"
  | "not_applicable";
export const workboardHandoffStates = [
  "blocked",
  "needs_owner",
  "evidence",
  "content",
  "review",
  "delivery",
  "complete",
] as const;
export type WorkboardHandoffState = (typeof workboardHandoffStates)[number];
export type WorkboardHandoffFilter = "all" | WorkboardHandoffState;

export interface WorkboardHandoff {
  readonly state: WorkboardHandoffState;
  readonly completed: number;
  readonly applicable: number;
  readonly checks: Readonly<
    Record<
      "ownership" | "evidence" | "content" | "review" | "delivery",
      WorkboardHandoffCheck
    >
  >;
}

export interface WorkboardStory {
  readonly id: string;
  readonly origin: "research" | "content";
  readonly stage: WorkboardStage;
  readonly needsAttention: boolean;
  readonly title: string;
  readonly summary: string;
  readonly updatedAt: string;
  readonly research: {
    readonly id: string;
    readonly status: string;
    readonly freshnessAt: string | null;
    readonly sourceCount: number;
    readonly claimCount: number;
    readonly verifiedClaimCount: number;
  } | null;
  readonly content: {
    readonly id: string;
    readonly status: string;
  } | null;
  readonly destinations: readonly {
    readonly name: "website" | "facebook" | "instagram";
    readonly status: string;
    readonly currentRevision: number;
    readonly pendingReview: boolean;
  }[];
  readonly assignment: {
    readonly id: string;
    readonly assignee: { readonly userId: string; readonly email: string };
    readonly mine: boolean;
    readonly priority: "normal" | "high" | "urgent";
    readonly dueAt: string | null;
    readonly dueState: WorkboardDueState;
    readonly note: string;
  } | null;
  readonly handoff: WorkboardHandoff;
}

export function summarizeWorkboardHandoffs(
  stories: readonly WorkboardStory[],
): {
  readonly total: number;
  readonly counts: Readonly<Record<WorkboardHandoffState, number>>;
} {
  const counts = Object.fromEntries(
    workboardHandoffStates.map((state) => [state, 0]),
  ) as Record<WorkboardHandoffState, number>;
  for (const story of stories) counts[story.handoff.state] += 1;
  return { total: stories.length, counts };
}

export function matchesWorkboardHandoffFilter(
  story: WorkboardStory,
  filter: WorkboardHandoffFilter,
): boolean {
  return filter === "all" || story.handoff.state === filter;
}

export interface WorkboardSnapshot {
  readonly workspace: { readonly id: string; readonly displayName: string };
  readonly limit: number;
  readonly evaluatedAt: string;
  readonly counts: Readonly<Record<WorkboardStage, number>>;
  readonly queue: {
    readonly mine: number;
    readonly unassigned: number;
    readonly overdue: number;
    readonly dueSoon: number;
    readonly attention: number;
  };
  readonly workload: {
    readonly visibility: "full_team" | "assigned_members_only";
    readonly coverage: {
      readonly loadedStories: number;
      readonly limit: number;
      readonly complete: boolean;
    };
    readonly unassigned: number;
    readonly members: readonly {
      readonly userId: string;
      readonly email: string;
      readonly total: number;
      readonly overdue: number;
      readonly dueSoon: number;
      readonly attention: number;
      readonly urgent: number;
      readonly nextDueAt: string | null;
    }[];
  };
  readonly permissions: {
    readonly canManageAssignments: boolean;
    readonly mfaVerified: boolean;
  };
  readonly team: readonly {
    readonly userId: string;
    readonly email: string;
    readonly roles: readonly string[];
  }[];
  readonly stories: readonly WorkboardStory[];
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const researchStatuses = [
  "open",
  "researching",
  "ready_for_review",
  "approved",
  "rejected",
  "promoted",
] as const;
const contentStatuses = ["draft", "active"] as const;
const destinationNames = ["website", "facebook", "instagram"] as const;
const destinationStatuses = [
  "provisioning",
  "draft",
  "ready_for_review",
  "approved",
  "rejected",
  "scheduled",
  "queued",
  "publishing",
  "published",
  "partial",
  "failed",
  "retry_scheduled",
  "needs_reauthorization",
  "cancelled",
  "archived",
] as const;
const deliveryHandoffBlockers = new Set([
  "partial",
  "failed",
  "retry_scheduled",
  "needs_reauthorization",
  "rejected",
]);

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const bounded = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

const date = (value: unknown): value is string =>
  bounded(value, 40) && !Number.isNaN(Date.parse(value));

function deriveStoryHandoff(input: {
  readonly stage: WorkboardStage;
  readonly researchStatus: string | null;
  readonly hasResearch: boolean;
  readonly hasContent: boolean;
  readonly hasAssignment: boolean;
  readonly destinationStatuses: readonly string[];
}): WorkboardHandoff {
  const checks: WorkboardHandoff["checks"] = {
    ownership:
      input.hasAssignment || input.stage === "done" ? "complete" : "pending",
    evidence: !input.hasResearch
      ? "not_applicable"
      : input.researchStatus === "rejected"
        ? "blocked"
        : ["approved", "promoted"].includes(input.researchStatus ?? "")
          ? "complete"
          : "pending",
    content:
      input.hasContent || input.stage === "done" ? "complete" : "pending",
    review: ["scheduled", "done"].includes(input.stage)
      ? "complete"
      : input.destinationStatuses.includes("rejected")
        ? "blocked"
        : "pending",
    delivery:
      input.stage === "done"
        ? "complete"
        : input.destinationStatuses.some((status) =>
              deliveryHandoffBlockers.has(status),
            )
          ? "blocked"
          : "pending",
  };
  const applicable = Object.values(checks).filter(
    (check) => check !== "not_applicable",
  ).length;
  const completed = Object.values(checks).filter(
    (check) => check === "complete",
  ).length;
  const state: WorkboardHandoffState = Object.values(checks).includes("blocked")
    ? "blocked"
    : checks.ownership === "pending"
      ? "needs_owner"
      : checks.evidence === "pending"
        ? "evidence"
        : checks.content === "pending"
          ? "content"
          : checks.review === "pending"
            ? "review"
            : checks.delivery === "pending"
              ? "delivery"
              : "complete";
  return { state, completed, applicable, checks };
}

export function parseWorkboardSnapshot(
  value: unknown,
): WorkboardSnapshot | null {
  const envelope = record(value);
  const workspace = record(envelope?.workspace);
  const counts = record(envelope?.counts);
  const queue = record(envelope?.queue);
  const workload = record(envelope?.workload);
  const workloadCoverage = record(workload?.coverage);
  const permissions = record(envelope?.permissions);
  if (
    !envelope ||
    !workspace ||
    typeof workspace.id !== "string" ||
    !UUID.test(workspace.id) ||
    !bounded(workspace.displayName, 160) ||
    !integer(envelope.limit) ||
    envelope.limit < 1 ||
    envelope.limit > 100 ||
    !date(envelope.evaluatedAt) ||
    !counts ||
    !queue ||
    !integer(queue.mine) ||
    !integer(queue.unassigned) ||
    !integer(queue.overdue) ||
    !integer(queue.dueSoon) ||
    !integer(queue.attention) ||
    !workload ||
    !["full_team", "assigned_members_only"].includes(
      String(workload.visibility),
    ) ||
    !workloadCoverage ||
    !integer(workloadCoverage.loadedStories) ||
    !integer(workloadCoverage.limit) ||
    typeof workloadCoverage.complete !== "boolean" ||
    !integer(workload.unassigned) ||
    !Array.isArray(workload.members) ||
    workload.members.length > 500 ||
    !permissions ||
    typeof permissions.canManageAssignments !== "boolean" ||
    typeof permissions.mfaVerified !== "boolean" ||
    (!permissions.mfaVerified && permissions.canManageAssignments) ||
    !Array.isArray(envelope.team) ||
    envelope.team.length > 500 ||
    !workboardStages.every((stage) => integer(counts[stage])) ||
    !Array.isArray(envelope.stories) ||
    envelope.stories.length > envelope.limit
  )
    return null;

  const team: WorkboardSnapshot["team"][number][] = [];
  const teamIds = new Set<string>();
  for (const candidate of envelope.team) {
    const member = record(candidate);
    if (
      !member ||
      typeof member.userId !== "string" ||
      !UUID.test(member.userId) ||
      teamIds.has(member.userId) ||
      !bounded(member.email, 320) ||
      !Array.isArray(member.roles) ||
      member.roles.length < 1 ||
      member.roles.length > 6 ||
      member.roles.some((role) => !bounded(role, 40))
    )
      return null;
    teamIds.add(member.userId);
    team.push({
      userId: member.userId,
      email: member.email,
      roles: member.roles as string[],
    });
  }
  if (!permissions.canManageAssignments && team.length > 0) return null;

  const stories: WorkboardStory[] = [];
  const storyIds = new Set<string>();
  for (const candidate of envelope.stories) {
    const story = record(candidate);
    const research = story?.research === null ? null : record(story?.research);
    const content = story?.content === null ? null : record(story?.content);
    const assignment =
      story?.assignment === null ? null : record(story?.assignment);
    const handoff = record(story?.handoff);
    const handoffChecks = record(handoff?.checks);
    if (
      !story ||
      typeof story.id !== "string" ||
      !UUID.test(story.id) ||
      storyIds.has(story.id) ||
      !["research", "content"].includes(String(story.origin)) ||
      !workboardStages.includes(story.stage as WorkboardStage) ||
      typeof story.needsAttention !== "boolean" ||
      !bounded(story.title, 240) ||
      typeof story.summary !== "string" ||
      story.summary.length > 2000 ||
      !date(story.updatedAt) ||
      !Array.isArray(story.destinations) ||
      story.destinations.length > destinationNames.length ||
      !handoff ||
      !handoffChecks ||
      (story.origin === "research" && (!research || content !== null)) ||
      (story.origin === "content" && !content)
    )
      return null;

    let parsedResearch: WorkboardStory["research"] = null;
    if (research) {
      if (
        typeof research.id !== "string" ||
        !UUID.test(research.id) ||
        !researchStatuses.includes(
          research.status as (typeof researchStatuses)[number],
        ) ||
        !(research.freshnessAt === null || date(research.freshnessAt)) ||
        !integer(research.sourceCount) ||
        !integer(research.claimCount) ||
        !integer(research.verifiedClaimCount) ||
        research.verifiedClaimCount > research.claimCount
      )
        return null;
      parsedResearch = {
        id: research.id,
        status: String(research.status),
        freshnessAt: research.freshnessAt,
        sourceCount: research.sourceCount,
        claimCount: research.claimCount,
        verifiedClaimCount: research.verifiedClaimCount,
      };
    }

    let parsedContent: WorkboardStory["content"] = null;
    if (content) {
      if (
        typeof content.id !== "string" ||
        !UUID.test(content.id) ||
        !contentStatuses.includes(
          content.status as (typeof contentStatuses)[number],
        )
      )
        return null;
      parsedContent = { id: content.id, status: String(content.status) };
    }

    const destinations: WorkboardStory["destinations"][number][] = [];
    const seenDestinations = new Set<string>();
    for (const item of story.destinations) {
      const destination = record(item);
      if (
        !destination ||
        !destinationNames.includes(
          destination.name as (typeof destinationNames)[number],
        ) ||
        seenDestinations.has(String(destination.name)) ||
        !destinationStatuses.includes(
          destination.status as (typeof destinationStatuses)[number],
        ) ||
        !integer(destination.currentRevision) ||
        destination.currentRevision < 1 ||
        typeof destination.pendingReview !== "boolean"
      )
        return null;
      seenDestinations.add(String(destination.name));
      destinations.push({
        name: destination.name as WorkboardStory["destinations"][number]["name"],
        status: String(destination.status),
        currentRevision: destination.currentRevision,
        pendingReview: destination.pendingReview,
      });
    }

    let parsedAssignment: WorkboardStory["assignment"] = null;
    if (assignment) {
      const assignee = record(assignment.assignee);
      if (
        typeof assignment.id !== "string" ||
        !UUID.test(assignment.id) ||
        !assignee ||
        typeof assignee.userId !== "string" ||
        !UUID.test(assignee.userId) ||
        !bounded(assignee.email, 320) ||
        typeof assignment.mine !== "boolean" ||
        !["normal", "high", "urgent"].includes(String(assignment.priority)) ||
        !(assignment.dueAt === null || date(assignment.dueAt)) ||
        !["none", "overdue", "due_soon", "scheduled", "complete"].includes(
          String(assignment.dueState),
        ) ||
        (assignment.dueState === "none" && assignment.dueAt !== null) ||
        (["overdue", "due_soon", "scheduled"].includes(
          String(assignment.dueState),
        ) &&
          assignment.dueAt === null) ||
        (assignment.dueState === "overdue" && !story.needsAttention) ||
        typeof assignment.note !== "string" ||
        assignment.note.length > 1000
      )
        return null;
      parsedAssignment = {
        id: assignment.id,
        assignee: { userId: assignee.userId, email: assignee.email },
        mine: assignment.mine,
        priority: assignment.priority as "normal" | "high" | "urgent",
        dueAt: assignment.dueAt,
        dueState: assignment.dueState as WorkboardDueState,
        note: assignment.note,
      };
      const dueTime = parsedAssignment.dueAt
        ? Date.parse(parsedAssignment.dueAt)
        : null;
      const expectedDueState: WorkboardDueState =
        story.stage === "done"
          ? "complete"
          : dueTime === null
            ? "none"
            : dueTime < Date.parse(envelope.evaluatedAt)
              ? "overdue"
              : dueTime <=
                  Date.parse(envelope.evaluatedAt) + 24 * 60 * 60 * 1000
                ? "due_soon"
                : "scheduled";
      if (parsedAssignment.dueState !== expectedDueState) return null;
    }
    if (
      story.needsAttention !==
      (story.stage === "attention" || parsedAssignment?.dueState === "overdue")
    )
      return null;

    const expectedHandoff = deriveStoryHandoff({
      stage: story.stage as WorkboardStage,
      researchStatus: parsedResearch?.status ?? null,
      hasResearch: parsedResearch !== null,
      hasContent: parsedContent !== null,
      hasAssignment: parsedAssignment !== null,
      destinationStatuses: destinations.map(
        (destination) => destination.status,
      ),
    });
    if (
      handoff.state !== expectedHandoff.state ||
      handoff.completed !== expectedHandoff.completed ||
      handoff.applicable !== expectedHandoff.applicable ||
      Object.entries(expectedHandoff.checks).some(
        ([key, status]) => handoffChecks[key] !== status,
      )
    )
      return null;

    storyIds.add(story.id);
    stories.push({
      id: story.id,
      origin: story.origin as WorkboardStory["origin"],
      stage: story.stage as WorkboardStage,
      needsAttention: story.needsAttention,
      title: story.title,
      summary: story.summary,
      updatedAt: story.updatedAt,
      research: parsedResearch,
      content: parsedContent,
      destinations,
      assignment: parsedAssignment,
      handoff: expectedHandoff,
    });
  }

  const parsedCounts = Object.fromEntries(
    workboardStages.map((stage) => [stage, counts[stage] as number]),
  ) as Record<WorkboardStage, number>;
  if (
    workboardStages.some(
      (stage) =>
        parsedCounts[stage] !==
        stories.filter((story) => story.stage === stage).length,
    )
  )
    return null;
  const expectedQueue = {
    mine: stories.filter((story) => story.assignment?.mine).length,
    unassigned: stories.filter((story) => !story.assignment).length,
    overdue: stories.filter((story) => story.assignment?.dueState === "overdue")
      .length,
    dueSoon: stories.filter(
      (story) => story.assignment?.dueState === "due_soon",
    ).length,
    attention: stories.filter((story) => story.needsAttention).length,
  };
  if (
    Object.entries(expectedQueue).some(([key, count]) => queue[key] !== count)
  )
    return null;

  type MutableWorkloadMember = WorkboardSnapshot["workload"]["members"][number];
  const expectedWorkload = new Map<string, MutableWorkloadMember>();
  let expectedUnassigned = 0;
  for (const story of stories) {
    if (story.stage === "done") continue;
    if (!story.assignment) {
      expectedUnassigned += 1;
      continue;
    }
    const current = expectedWorkload.get(story.assignment.assignee.userId) ?? {
      userId: story.assignment.assignee.userId,
      email: story.assignment.assignee.email,
      total: 0,
      overdue: 0,
      dueSoon: 0,
      attention: 0,
      urgent: 0,
      nextDueAt: null,
    };
    const nextDueAt =
      story.assignment.dueAt &&
      (!current.nextDueAt ||
        story.assignment.dueAt.localeCompare(current.nextDueAt) < 0)
        ? story.assignment.dueAt
        : current.nextDueAt;
    expectedWorkload.set(story.assignment.assignee.userId, {
      ...current,
      total: current.total + 1,
      overdue:
        current.overdue + Number(story.assignment.dueState === "overdue"),
      dueSoon:
        current.dueSoon + Number(story.assignment.dueState === "due_soon"),
      attention: current.attention + Number(story.needsAttention),
      urgent: current.urgent + Number(story.assignment.priority === "urgent"),
      nextDueAt,
    });
  }
  const expectedVisibility = permissions.canManageAssignments
    ? "full_team"
    : "assigned_members_only";
  if (expectedVisibility === "full_team") {
    for (const member of team) {
      if (!expectedWorkload.has(member.userId))
        expectedWorkload.set(member.userId, {
          userId: member.userId,
          email: member.email,
          total: 0,
          overdue: 0,
          dueSoon: 0,
          attention: 0,
          urgent: 0,
          nextDueAt: null,
        });
    }
  }
  if (
    workload.visibility !== expectedVisibility ||
    workloadCoverage.loadedStories !== stories.length ||
    workloadCoverage.limit !== envelope.limit ||
    (stories.length < envelope.limit && !workloadCoverage.complete) ||
    workload.unassigned !== expectedUnassigned ||
    workload.members.length !== expectedWorkload.size
  )
    return null;
  const workloadMembers: WorkboardSnapshot["workload"]["members"][number][] =
    [];
  const workloadIds = new Set<string>();
  for (const candidate of workload.members) {
    const member = record(candidate);
    const expected =
      typeof member?.userId === "string"
        ? expectedWorkload.get(member.userId)
        : undefined;
    if (
      !member ||
      !expected ||
      typeof member.userId !== "string" ||
      !UUID.test(member.userId) ||
      workloadIds.has(member.userId) ||
      !bounded(member.email, 320) ||
      !integer(member.total) ||
      !integer(member.overdue) ||
      !integer(member.dueSoon) ||
      !integer(member.attention) ||
      !integer(member.urgent) ||
      !(member.nextDueAt === null || date(member.nextDueAt)) ||
      member.email !== expected.email ||
      member.total !== expected.total ||
      member.overdue !== expected.overdue ||
      member.dueSoon !== expected.dueSoon ||
      member.attention !== expected.attention ||
      member.urgent !== expected.urgent ||
      member.nextDueAt !== expected.nextDueAt
    )
      return null;
    workloadIds.add(member.userId);
    workloadMembers.push({
      userId: member.userId,
      email: member.email,
      total: member.total,
      overdue: member.overdue,
      dueSoon: member.dueSoon,
      attention: member.attention,
      urgent: member.urgent,
      nextDueAt: member.nextDueAt,
    });
  }

  return {
    workspace: { id: workspace.id, displayName: workspace.displayName },
    limit: envelope.limit,
    evaluatedAt: envelope.evaluatedAt,
    permissions: {
      canManageAssignments: permissions.canManageAssignments,
      mfaVerified: permissions.mfaVerified,
    },
    team,
    counts: parsedCounts,
    queue: expectedQueue,
    workload: {
      visibility: expectedVisibility,
      coverage: {
        loadedStories: workloadCoverage.loadedStories,
        limit: workloadCoverage.limit,
        complete: workloadCoverage.complete,
      },
      unassigned: expectedUnassigned,
      members: workloadMembers,
    },
    stories,
  };
}
