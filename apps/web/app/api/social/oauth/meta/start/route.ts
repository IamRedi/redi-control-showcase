import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function origin() {
  const value = new URL(
    process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3001",
  );
  if (
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash
  )
    throw new Error("Untrusted API origin");
  return value;
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as {
      workspaceId?: unknown;
      postConnectPath?: unknown;
    };
    if (
      typeof input.workspaceId !== "string" ||
      !UUID.test(input.workspaceId) ||
      ![
        "/en/social/accounts",
        "/de/social/accounts",
        "/sq/social/accounts",
      ].includes(String(input.postConnectPath))
    )
      return NextResponse.json(
        { error: "Invalid Meta connection request" },
        { status: 400 },
      );
    const response = await fetch(
      new URL("/api/social/oauth/meta/start", origin()),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
          "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        },
        body: JSON.stringify(input),
        cache: "no-store",
        redirect: "error",
      },
    );
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Meta connection is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
