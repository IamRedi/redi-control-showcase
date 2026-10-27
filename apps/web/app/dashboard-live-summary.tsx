"use client";

import { useEffect, useState } from "react";

interface DashboardOverview {
  readonly workspace: { readonly id: string; readonly displayName: string };
  readonly counts: {
    readonly readyMedia: number;
    readonly socialAccounts: number;
    readonly healthySocialAccounts: number;
    readonly draftPosts: number;
    readonly scheduledPosts: number;
    readonly pendingApprovals: number;
  };
}

export function DashboardLiveSummary({
  labels,
}: {
  labels: {
    readonly loading: string;
    readonly signedOut: string;
    readonly unavailable: string;
    readonly readyMedia: string;
    readonly accounts: string;
    readonly drafts: string;
    readonly approvals: string;
  };
}) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "unavailable">(
    "loading",
  );

  useEffect(() => {
    void fetch("/api/dashboard/overview", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setState("signed-out");
          return;
        }
        if (!response.ok) {
          setState("unavailable");
          return;
        }
        setOverview((await response.json()) as DashboardOverview);
      })
      .catch(() => setState("unavailable"));
  }, []);

  if (!overview)
    return (
      <p className="live-summary-state" role="status">
        {state === "loading"
          ? labels.loading
          : state === "signed-out"
            ? labels.signedOut
            : labels.unavailable}
      </p>
    );

  return (
    <section
      className="live-summary"
      aria-label={overview.workspace.displayName}
    >
      <header>
        <strong>{overview.workspace.displayName}</strong>
        <span>
          {labels.accounts}: {overview.counts.socialAccounts}
        </span>
      </header>
      <div>
        <span>
          <strong>{overview.counts.readyMedia}</strong>
          {labels.readyMedia}
        </span>
        <span>
          <strong>{overview.counts.draftPosts}</strong>
          {labels.drafts}
        </span>
        <span>
          <strong>{overview.counts.pendingApprovals}</strong>
          {labels.approvals}
        </span>
      </div>
    </section>
  );
}
