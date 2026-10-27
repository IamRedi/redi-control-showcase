import { describe, expect, it } from "vitest";

import {
  matchesWorkboardHandoffFilter,
  parseWorkboardSnapshot,
  summarizeWorkboardHandoffs,
} from "../app/workboard-contract.js";

const story = {
  id: "11111111-1111-4111-8111-111111111111",
  origin: "content",
  stage: "review",
  needsAttention: true,
  title: "Verified local story",
  summary: "A bounded editorial summary.",
  updatedAt: "2026-08-27T12:00:00.000Z",
  research: {
    id: "22222222-2222-4222-8222-222222222222",
    status: "promoted",
    freshnessAt: "2026-08-27T10:00:00.000Z",
    sourceCount: 2,
    claimCount: 3,
    verifiedClaimCount: 2,
  },
  content: {
    id: "11111111-1111-4111-8111-111111111111",
    status: "draft",
  },
  destinations: [
    {
      name: "facebook",
      status: "ready_for_review",
      currentRevision: 2,
      pendingReview: true,
      providerAccountId: "must-not-be-projected",
    },
  ],
  assignment: {
    id: "44444444-4444-4444-8444-444444444444",
    assignee: {
      userId: "55555555-5555-4555-8555-555555555555",
      email: "editor@example.invalid",
    },
    mine: true,
    priority: "high",
    dueAt: "2026-08-28T08:00:00.000Z",
    dueState: "overdue",
    note: "Morning review",
  },
  handoff: {
    state: "review",
    completed: 3,
    applicable: 5,
    checks: {
      ownership: "complete",
      evidence: "complete",
      content: "complete",
      review: "pending",
      delivery: "pending",
    },
  },
};

const valid = {
  workspace: {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Aurora Media",
  },
  limit: 80,
  evaluatedAt: "2026-08-29T08:00:00.000Z",
  permissions: { canManageAssignments: true, mfaVerified: true },
  team: [
    {
      userId: "55555555-5555-4555-8555-555555555555",
      email: "editor@example.invalid",
      roles: ["editor"],
    },
  ],
  counts: {
    research: 0,
    ready: 0,
    drafting: 0,
    review: 1,
    scheduled: 0,
    done: 0,
    attention: 0,
  },
  queue: {
    mine: 1,
    unassigned: 0,
    overdue: 1,
    dueSoon: 0,
    attention: 1,
  },
  workload: {
    visibility: "full_team",
    coverage: { loadedStories: 1, limit: 80, complete: true },
    unassigned: 0,
    members: [
      {
        userId: "55555555-5555-4555-8555-555555555555",
        email: "editor@example.invalid",
        total: 1,
        overdue: 1,
        dueSoon: 0,
        attention: 1,
        urgent: 0,
        nextDueAt: "2026-08-28T08:00:00.000Z",
      },
    ],
  },
  stories: [story],
};

describe("Editorial Workboard response contract", () => {
  it("accepts a bounded board and removes provider-specific fields", () => {
    const snapshot = parseWorkboardSnapshot(valid);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.stories[0]?.destinations[0]).toEqual({
      name: "facebook",
      status: "ready_for_review",
      currentRevision: 2,
      pendingReview: true,
    });
    expect(snapshot?.stories[0]?.destinations[0]).not.toHaveProperty(
      "providerAccountId",
    );
    expect(snapshot?.stories[0]?.assignment?.priority).toBe("high");
    expect(snapshot?.stories[0]?.assignment?.mine).toBe(true);
    expect(snapshot?.workload.members[0]?.overdue).toBe(1);
    expect(snapshot?.stories[0]?.handoff).toMatchObject({
      state: "review",
      completed: 3,
      applicable: 5,
    });
    expect(summarizeWorkboardHandoffs(snapshot?.stories ?? [])).toEqual({
      total: 1,
      counts: {
        blocked: 0,
        needs_owner: 0,
        evidence: 0,
        content: 0,
        review: 1,
        delivery: 0,
        complete: 0,
      },
    });
    expect(matchesWorkboardHandoffFilter(snapshot!.stories[0]!, "all")).toBe(
      true,
    );
    expect(matchesWorkboardHandoffFilter(snapshot!.stories[0]!, "review")).toBe(
      true,
    );
    expect(
      matchesWorkboardHandoffFilter(snapshot!.stories[0]!, "blocked"),
    ).toBe(false);
  });

  it("marks evidence as not applicable for direct content", () => {
    const direct = {
      ...story,
      research: null,
      handoff: {
        state: "review",
        completed: 2,
        applicable: 4,
        checks: {
          ownership: "complete",
          evidence: "not_applicable",
          content: "complete",
          review: "pending",
          delivery: "pending",
        },
      },
    };
    const snapshot = parseWorkboardSnapshot({
      ...valid,
      stories: [direct],
    });
    expect(snapshot?.stories[0]?.handoff).toMatchObject({
      applicable: 4,
      checks: { evidence: "not_applicable" },
    });
  });

  it("fails closed for inconsistent counts, duplicate destinations and invalid evidence", () => {
    expect(
      parseWorkboardSnapshot({
        ...valid,
        counts: { ...valid.counts, review: 0 },
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        stories: [
          {
            ...story,
            handoff: { ...story.handoff, completed: 4 },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        queue: { ...valid.queue, overdue: 0 },
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        workload: {
          ...valid.workload,
          members: [{ ...valid.workload.members[0], total: 2 }],
        },
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        stories: [
          {
            ...story,
            destinations: [story.destinations[0], story.destinations[0]],
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        stories: [
          {
            ...story,
            research: { ...story.research, verifiedClaimCount: 4 },
          },
        ],
      }),
    ).toBeNull();
  });

  it("fails closed for malformed assignments and a team disclosed without permission", () => {
    expect(
      parseWorkboardSnapshot({
        ...valid,
        stories: [
          { ...story, assignment: { ...story.assignment, dueAt: "later" } },
        ],
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        stories: [
          {
            ...story,
            assignment: { ...story.assignment, dueState: "due_soon" },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseWorkboardSnapshot({
        ...valid,
        permissions: { canManageAssignments: false, mfaVerified: true },
      }),
    ).toBeNull();
  });
});
