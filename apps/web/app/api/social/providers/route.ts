import { NextResponse } from "next/server";

import { parseSocialProviders } from "../../../social-contract";

export const dynamic = "force-dynamic";

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
    const response = await fetch(
      new URL("/api/social/providers", apiOrigin()),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
        cache: "no-store",
        redirect: "error",
      },
    );
    const body = await response.text();
    if (!response.ok)
      return new NextResponse(body, {
        status: response.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    const providers = parseSocialProviders(JSON.parse(body) as unknown);
    if (!providers) throw new Error("Invalid Social Provider response");
    return NextResponse.json(
      { providers },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Social provider API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
