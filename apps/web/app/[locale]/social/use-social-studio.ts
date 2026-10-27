"use client";

import { useCallback, useEffect, useState } from "react";

import {
  parseSocialStudio,
  type SocialStudioSnapshot,
} from "../../social-contract";
import { classifyWorkspaceResponse } from "../../workspace-onboarding-contract";

type StudioState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "workspace-required" }
  | { readonly status: "error" }
  | {
      readonly status: "ready";
      readonly workspaceId: string;
      readonly snapshot: SocialStudioSnapshot;
    };

interface OverviewEnvelope {
  readonly workspace?: { readonly id?: unknown };
}

export function useSocialStudio() {
  const [state, setState] = useState<StudioState>({ status: "loading" });
  const load = useCallback(async (signal?: AbortSignal) => {
    const overviewResponse = await fetch("/api/dashboard/overview", {
      credentials: "include",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!overviewResponse.ok) {
      const status = classifyWorkspaceResponse(overviewResponse.status);
      if (status !== "unavailable") setState({ status });
      else throw new Error("overview_unavailable");
      return;
    }
    const overview = (await overviewResponse.json()) as OverviewEnvelope;
    const workspaceId = overview.workspace?.id;
    if (typeof workspaceId !== "string") throw new Error("invalid_workspace");
    const response = await fetch(
      `/api/social/studio?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        credentials: "include",
        cache: "no-store",
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok) throw new Error("studio_unavailable");
    const snapshot = parseSocialStudio(await response.json());
    if (!snapshot) throw new Error("invalid_studio_response");
    setState({ status: "ready", workspaceId, snapshot });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setState({ status: "error" });
    });
    return () => controller.abort();
  }, [load]);

  return {
    state,
    reload: async () => {
      try {
        await load();
      } catch {
        setState({ status: "error" });
      }
    },
  };
}
