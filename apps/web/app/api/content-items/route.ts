import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function apiUrl(request: Request): URL {
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
  const target = new URL("/api/content-items", origin);
  target.search = new URL(request.url).search;
  return target;
}

async function forward(request: Request, method: "GET" | "POST") {
  try {
    const response = await fetch(apiUrl(request), {
      method,
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
        ...(method === "POST"
          ? {
              "content-type": "application/json",
              "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
            }
          : {}),
      },
      ...(method === "POST" ? { body: await request.text() } : {}),
      cache: "no-store",
      redirect: "error",
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Content API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request) {
  return forward(request, "GET");
}

export function POST(request: Request) {
  return forward(request, "POST");
}
