import { NextResponse } from "next/server";

import { parseSocialPreflight } from "../../../../social-contract";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiOrigin(): URL {
  const origin = new URL(
    process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3001",
  );
  const local = ["127.0.0.1", "localhost"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        local &&
        origin.protocol === "http:"
      ))
  )
    throw new Error("PUBLIC_API_ORIGIN is not a trusted API origin");
  return origin;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!UUID.test(draftId) || !workspaceId || !UUID.test(workspaceId))
    return NextResponse.json(
      { error: "A valid draft and workspace are required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const target = new URL(
      `/api/social/drafts/${draftId}/preflight`,
      apiOrigin(),
    );
    target.searchParams.set("workspaceId", workspaceId);
    const response = await fetch(target, {
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
        "x-correlation-id": request.headers.get("x-correlation-id") ?? "",
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "Social preflight is unavailable" },
        { status: response.status, headers: { "cache-control": "no-store" } },
      );
    const snapshot = parseSocialPreflight(await response.json());
    if (!snapshot) throw new Error("Invalid preflight response");
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Social preflight API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
