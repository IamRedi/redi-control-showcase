"use client";

import { useEffect, useState } from "react";

import {
  parseSocialPublications,
  type SocialPublicationsSnapshot,
} from "../../../social-contract";
import { classifyWorkspaceResponse } from "../../../workspace-onboarding-contract";

type PublicationsState =
  | {
      readonly status:
        | "loading"
        | "signed-out"
        | "workspace-required"
        | "error";
    }
  | { readonly status: "ready"; readonly snapshot: SocialPublicationsSnapshot };

interface OverviewEnvelope {
  readonly workspace?: { readonly id?: unknown };
}

export function useSocialPublications(): PublicationsState {
  const [state, setState] = useState<PublicationsState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const overviewResponse = await fetch("/api/dashboard/overview", {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!overviewResponse.ok) {
        const status = classifyWorkspaceResponse(overviewResponse.status);
        if (status !== "unavailable") setState({ status });
        else throw new Error("overview_unavailable");
        return;
      }
      const overview = (await overviewResponse.json()) as OverviewEnvelope;
      if (typeof overview.workspace?.id !== "string")
        throw new Error("invalid_workspace");
      const response = await fetch(
        `/api/social/publications?workspaceId=${encodeURIComponent(overview.workspace.id)}`,
        {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("publications_unavailable");
      const snapshot = parseSocialPublications(await response.json());
      if (!snapshot) throw new Error("invalid_publications");
      setState({ status: "ready", snapshot });
    })().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setState({ status: "error" });
    });
    return () => controller.abort();
  }, []);
  return state;
}
