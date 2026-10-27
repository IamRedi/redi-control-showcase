import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiOrigin(): URL {
  const value = new URL(
    process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3001",
  );
  const local = ["127.0.0.1", "localhost"].includes(value.hostname);
  if (
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash ||
    (value.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        local &&
        value.protocol === "http:"
      ))
  )
    throw new Error("PUBLIC_API_ORIGIN is not a trusted API origin");
  return value;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { workspaceId?: unknown };
    if (typeof body.workspaceId !== "string" || !UUID.test(body.workspaceId))
      return NextResponse.json(
        { error: "A valid workspace is required" },
        { status: 400 },
      );
    const response = await fetch(
      new URL("/api/social/meta/read-sync", apiOrigin()),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
          "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ??
          "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Meta read synchronization is unavailable" },
      { status: 503 },
    );
  }
}
