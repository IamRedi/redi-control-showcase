import { describe, expect, it } from "vitest";

import {
  parseWorkboardDefaultViewInput,
  parseWorkboardViewNameInput,
  parseWorkboardViewInput,
  parseWorkboardViewSnapshot,
  resolveWorkboardStartupView,
} from "../app/workboard-view-contract.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const viewId = "22222222-2222-4222-8222-222222222222";
const valid = {
  maximumSavedViews: 20,
  defaultViewId: viewId,
  workspaces: [
    { id: workspaceId, displayName: "Investigations", status: "active" },
  ],
  savedViews: [
    {
      id: viewId,
      name: "Needs attention",
      workspaceId,
      availability: "active",
      stage: "attention",
      query: "local",
      assignmentScope: "mine",
      focus: "overdue",
      handoffFilter: "blocked",
      sortOrder: "deadline",
      createdAt: "2026-08-29T08:00:00.000Z",
      updatedAt: "2026-08-29T08:10:00.000Z",
      secret: "must-not-be-projected",
    },
  ],
};

describe("Workboard saved-view contracts", () => {
  it("accepts a bounded personal snapshot and removes unknown fields", () => {
    const snapshot = parseWorkboardViewSnapshot(valid);
    expect(snapshot?.savedViews[0]).toEqual({
      id: viewId,
      name: "Needs attention",
      workspaceId,
      availability: "active",
      stage: "attention",
      query: "local",
      assignmentScope: "mine",
      focus: "overdue",
      handoffFilter: "blocked",
      sortOrder: "deadline",
      createdAt: "2026-08-29T08:00:00.000Z",
      updatedAt: "2026-08-29T08:10:00.000Z",
    });
    expect(snapshot?.savedViews[0]).not.toHaveProperty("secret");
    expect(resolveWorkboardStartupView(snapshot!)).toEqual(
      snapshot?.savedViews[0],
    );
  });

  it("falls back safely when no valid default view survives the snapshot", () => {
    const stale = parseWorkboardViewSnapshot({
      ...valid,
      defaultViewId: crypto.randomUUID(),
    });
    expect(stale?.defaultViewId).toBeNull();
    expect(resolveWorkboardStartupView(stale!)).toBeNull();

    const legacy = parseWorkboardViewSnapshot({
      maximumSavedViews: valid.maximumSavedViews,
      workspaces: valid.workspaces,
      savedViews: valid.savedViews,
    });
    expect(legacy?.defaultViewId).toBeNull();
    expect(resolveWorkboardStartupView(legacy!)).toBeNull();
  });

  it("preserves an archived view but never applies it as startup default", () => {
    const archived = parseWorkboardViewSnapshot({
      ...valid,
      workspaces: [{ ...valid.workspaces[0], status: "archived" }],
      savedViews: [
        { ...valid.savedViews[0], availability: "workspace_archived" },
      ],
    });
    expect(archived?.savedViews[0]?.availability).toBe("workspace_archived");
    expect(archived?.defaultViewId).toBeNull();
    expect(resolveWorkboardStartupView(archived!)).toBeNull();
  });

  it("fails closed for foreign workspaces, duplicate names and malformed time", () => {
    expect(
      parseWorkboardViewSnapshot({
        ...valid,
        savedViews: [
          { ...valid.savedViews[0], workspaceId: crypto.randomUUID() },
        ],
      }),
    ).toBeNull();
    expect(
      parseWorkboardViewSnapshot({
        ...valid,
        savedViews: [
          valid.savedViews[0],
          {
            ...valid.savedViews[0],
            id: crypto.randomUUID(),
            name: "NEEDS ATTENTION",
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseWorkboardViewSnapshot({
        ...valid,
        savedViews: [{ ...valid.savedViews[0], updatedAt: "later" }],
      }),
    ).toBeNull();
  });

  it("accepts only the exact save shape", () => {
    expect(
      parseWorkboardViewInput({
        workspaceId,
        name: "  Morning review  ",
        stage: "review",
        query: "evidence",
        assignmentScope: "mine",
        focus: "due_soon",
        handoffFilter: "review",
        sortOrder: "smart",
      }),
    ).toEqual({
      workspaceId,
      name: "Morning review",
      stage: "review",
      query: "evidence",
      assignmentScope: "mine",
      focus: "due_soon",
      handoffFilter: "review",
      sortOrder: "smart",
    });
    expect(
      parseWorkboardViewInput({
        workspaceId,
        name: "Morning review",
        stage: "review",
        query: "",
        assignmentScope: "all",
        focus: "all",
        handoffFilter: "all",
        sortOrder: "updated",
        tenantId: crypto.randomUUID(),
      }),
    ).toBeNull();
    expect(
      parseWorkboardViewInput({
        workspaceId,
        name: "Legacy client",
        stage: "all",
        query: "",
        assignmentScope: "all",
        focus: "all",
        sortOrder: "smart",
      }),
    ).toMatchObject({ handoffFilter: "all" });
    expect(
      parseWorkboardViewInput({
        workspaceId,
        name: "Invalid handoff",
        stage: "all",
        query: "",
        assignmentScope: "all",
        focus: "all",
        handoffFilter: "approved",
        sortOrder: "smart",
      }),
    ).toBeNull();
  });

  it("accepts only an exact nullable default-view preference", () => {
    expect(parseWorkboardDefaultViewInput({ viewId })).toEqual({ viewId });
    expect(parseWorkboardDefaultViewInput({ viewId: null })).toEqual({
      viewId: null,
    });
    expect(
      parseWorkboardDefaultViewInput({ viewId, tenantId: crypto.randomUUID() }),
    ).toBeNull();
    expect(parseWorkboardDefaultViewInput({ viewId: "default" })).toBeNull();
  });

  it("accepts only an exact bounded rename or duplicate name", () => {
    expect(parseWorkboardViewNameInput({ name: "  Evening review  " })).toEqual(
      { name: "Evening review" },
    );
    expect(
      parseWorkboardViewNameInput({
        name: "Evening review",
        tenantId: crypto.randomUUID(),
      }),
    ).toBeNull();
    expect(parseWorkboardViewNameInput({ name: " " })).toBeNull();
    expect(parseWorkboardViewNameInput({ name: "x".repeat(81) })).toBeNull();
  });
});
