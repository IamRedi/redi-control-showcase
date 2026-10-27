import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function apiOrigin(): URL {
  const value = process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3001";
  const origin = new URL(value);
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
    const response = await fetch(new URL("/api/websites", apiOrigin()), {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
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
      { error: "Website API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
