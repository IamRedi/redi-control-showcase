import { NextResponse } from "next/server";
import {
  modelStudioApiOrigin,
  modelStudioHeaders,
  UUID,
} from "../../../model-studio-bff";
import { parseModelStudioSnapshot } from "../../../model-studio-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId || !UUID.test(workspaceId))
    return NextResponse.json(
      { error: "A valid workspace is required" },
      { status: 400 },
    );
  try {
    const target = new URL(
      "/api/workzone/model-studio",
      modelStudioApiOrigin(),
    );
    target.searchParams.set("workspaceId", workspaceId);
    const upstream = await fetch(target, {
      headers: modelStudioHeaders(request),
      cache: "no-store",
      redirect: "error",
    });
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Model Studio is unavailable" },
        { status: upstream.status, headers: { "cache-control": "no-store" } },
      );
    const snapshot = parseModelStudioSnapshot(await upstream.json());
    if (!snapshot) throw new Error("Invalid Model Studio response");
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Model Studio API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
