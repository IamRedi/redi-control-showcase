import { NextResponse } from "next/server";

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

async function forward(
  request: Request,
  context: { params: Promise<{ origin: string; storyId: string }> },
) {
  const { origin, storyId } = await context.params;
  if (!["research", "content"].includes(origin) || !UUID.test(storyId))
    return NextResponse.json({ error: "Invalid story" }, { status: 400 });
  try {
    const target = new URL(
      `/api/workzone/stories/${origin}/${storyId}/assignment`,
      apiOrigin(),
    );
    let body: string | undefined;
    if (request.method === "DELETE") {
      const workspaceId = new URL(request.url).searchParams.get("workspaceId");
      if (!workspaceId || !UUID.test(workspaceId))
        return NextResponse.json(
          { error: "Invalid workspace" },
          { status: 400 },
        );
      target.searchParams.set("workspaceId", workspaceId);
    } else {
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (!Number.isFinite(contentLength) || contentLength > 4096)
        return NextResponse.json(
          { error: "Assignment request is too large" },
          { status: 413 },
        );
      body = await request.text();
      if (body.length > 4096)
        return NextResponse.json(
          { error: "Assignment request is too large" },
          { status: 413 },
        );
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        cookie: request.headers.get("cookie") ?? "",
        "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        "x-correlation-id": request.headers.get("x-correlation-id") ?? "",
      },
      ...(body ? { body } : {}),
      cache: "no-store",
      redirect: "error",
    });
    if (upstream.status === 204)
      return new NextResponse(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    const payload = (await upstream.json()) as unknown;
    return NextResponse.json(payload, {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Assignment API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const PUT = forward;
export const DELETE = forward;
