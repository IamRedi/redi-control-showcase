import { NextResponse } from "next/server";

import { parseVideoIntelligenceSnapshot } from "../../../video-intelligence-contract";

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

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (workspaceId && !UUID.test(workspaceId))
    return NextResponse.json({ error: "Invalid workspace" }, { status: 400 });
  try {
    const target = new URL("/api/video-intelligence/overview", apiOrigin());
    if (workspaceId) target.searchParams.set("workspaceId", workspaceId);
    const upstream = await fetch(target, {
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
        "x-correlation-id": request.headers.get("x-correlation-id") ?? "",
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Video Intelligence is unavailable" },
        { status: upstream.status, headers: { "cache-control": "no-store" } },
      );
    const snapshot = parseVideoIntelligenceSnapshot(await upstream.json());
    if (!snapshot) throw new Error("Invalid Video Intelligence response");
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Video Intelligence API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
