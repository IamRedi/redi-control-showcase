import { NextResponse } from "next/server";

import { parseWebsiteReviewQueue } from "../../../content-website-draft-contract";

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
  try {
    const target = new URL(
      "/api/content-items/website-review-queue",
      apiOrigin(),
    );
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (workspaceId) {
      if (!UUID.test(workspaceId))
        return NextResponse.json(
          { error: "A valid workzone is required" },
          { status: 400 },
        );
      target.searchParams.set("workspaceId", workspaceId);
    }
    const response = await fetch(target, {
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "Website review queue was refused" },
        { status: response.status, headers: { "cache-control": "no-store" } },
      );
    const queue = parseWebsiteReviewQueue(await response.json());
    if (!queue) throw new Error("Invalid Website review queue response");
    return NextResponse.json(queue, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Website review queue API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
