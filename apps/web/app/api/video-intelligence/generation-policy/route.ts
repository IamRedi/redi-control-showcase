import { NextResponse } from "next/server";

import { parseVideoGenerationPolicyEnvelope } from "../../../video-intelligence-contract";
import {
  boundedJson,
  exactKeys,
  record,
  unavailable,
  UUID,
  videoApiOrigin,
  videoHeaders,
} from "../../../video-intelligence-bff";

export const dynamic = "force-dynamic";

const respond = async (upstream: Response) => {
  if (!upstream.ok)
    return NextResponse.json(
      { error: "Video generation policy was refused" },
      { status: upstream.status, headers: { "cache-control": "no-store" } },
    );
  const parsed = parseVideoGenerationPolicyEnvelope(await upstream.json());
  if (!parsed) return unavailable();
  return NextResponse.json(parsed, {
    status: upstream.status,
    headers: { "cache-control": "no-store" },
  });
};

export async function GET(request: Request) {
  try {
    const requested = new URL(request.url);
    const workspaceId = requested.searchParams.get("workspaceId");
    if (
      !workspaceId ||
      !UUID.test(workspaceId) ||
      requested.searchParams.getAll("workspaceId").length !== 1 ||
      [...requested.searchParams.keys()].some((key) => key !== "workspaceId")
    )
      return NextResponse.json({ error: "Invalid workspace" }, { status: 400 });
    const url = new URL(
      "/api/video-intelligence/generation-policy",
      videoApiOrigin(),
    );
    url.searchParams.set("workspaceId", workspaceId);
    return await respond(
      await fetch(url, {
        headers: videoHeaders(request),
        cache: "no-store",
        redirect: "error",
      }),
    );
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request) {
  try {
    const body = record(await boundedJson(request));
    if (
      !body ||
      !exactKeys(body, [
        "workspaceId",
        "dailyCreditLimit",
        "monthlyCreditLimit",
        "maximumConcurrency",
        "enabled",
      ]) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      !Number.isInteger(body.dailyCreditLimit) ||
      Number(body.dailyCreditLimit) < 0 ||
      Number(body.dailyCreditLimit) > 1_000_000 ||
      !Number.isInteger(body.monthlyCreditLimit) ||
      Number(body.monthlyCreditLimit) < Number(body.dailyCreditLimit) ||
      Number(body.monthlyCreditLimit) > 10_000_000 ||
      !Number.isInteger(body.maximumConcurrency) ||
      Number(body.maximumConcurrency) < 1 ||
      Number(body.maximumConcurrency) > 20 ||
      typeof body.enabled !== "boolean"
    )
      return NextResponse.json(
        { error: "Invalid video generation policy" },
        { status: 400 },
      );
    return await respond(
      await fetch(
        new URL("/api/video-intelligence/generation-policy", videoApiOrigin()),
        {
          method: "PUT",
          headers: videoHeaders(request),
          body: JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return unavailable();
  }
}
