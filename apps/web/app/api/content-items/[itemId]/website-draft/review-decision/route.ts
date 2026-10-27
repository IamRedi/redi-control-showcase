import { NextResponse } from "next/server";

import { parseWebsiteDraft } from "../../../../../content-website-draft-contract";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await context.params;
  if (!UUID.test(itemId))
    return NextResponse.json(
      { error: "A valid content item is required" },
      { status: 400 },
    );
  try {
    const response = await fetch(
      new URL(
        `/api/content-items/${itemId}/website-draft/review-decision`,
        apiOrigin(),
      ),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
          "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        },
        body: await request.text(),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok)
      return NextResponse.json(
        { error: "Website review decision was refused" },
        { status: response.status, headers: { "cache-control": "no-store" } },
      );
    const draft = parseWebsiteDraft(await response.json());
    if (!draft || draft.itemId !== itemId)
      throw new Error("Invalid Website draft response");
    return NextResponse.json(
      { draft, permissions: draft.permissions },
      { status: response.status, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Website review API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
