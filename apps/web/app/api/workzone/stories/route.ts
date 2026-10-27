import { NextResponse } from "next/server";

import { parseWorkboardSnapshot } from "../../../workboard-contract";

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
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId");
  if (workspaceId && !UUID.test(workspaceId))
    return NextResponse.json(
      { error: "Invalid workspace" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const target = new URL("/api/workzone/stories", apiOrigin());
    if (workspaceId) target.searchParams.set("workspaceId", workspaceId);
    target.searchParams.set("limit", "80");
    const upstream = await fetch(target, {
      method: "GET",
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
        { error: "Editorial Workboard is unavailable" },
        {
          status: upstream.status,
          headers: { "cache-control": "no-store" },
        },
      );
    const snapshot = parseWorkboardSnapshot((await upstream.json()) as unknown);
    if (!snapshot) throw new Error("Invalid Editorial Workboard response");
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Editorial Workboard API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
