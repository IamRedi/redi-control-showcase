import { NextResponse } from "next/server";

import { parseWebsitePreflight } from "../../../../content-website-preflight-contract";

export const dynamic = "force-dynamic";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiUrl(itemId: string): URL {
  if (!uuid.test(itemId)) throw new Error("Invalid content item identifier");
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
  return new URL(
    `/api/content-items/${encodeURIComponent(itemId)}/website-preflight`,
    origin,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await context.params;
  if (!uuid.test(itemId))
    return NextResponse.json(
      { error: "A valid content item is required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const response = await fetch(apiUrl(itemId), {
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "Website preflight is unavailable" },
        { status: response.status, headers: { "cache-control": "no-store" } },
      );
    const preflight = parseWebsitePreflight(await response.json());
    if (!preflight || preflight.itemId !== itemId)
      throw new Error("Invalid Website preflight response");
    return NextResponse.json(
      { preflight },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Website preflight API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
