import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
function target(request: Request, path: string[]) {
  if (!path.length || path.some((segment) => !/^[-a-zA-Z0-9]+$/.test(segment)))
    throw new Error("invalid path");
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
    throw new Error("untrusted origin");
  const url = new URL(`/api/research/${path.join("/")}`, origin);
  url.search = new URL(request.url).search;
  return url;
}
async function forward(request: Request, path: string[]) {
  try {
    const method = request.method;
    const response = await fetch(target(request, path), {
      method,
      headers: {
        accept: "application/json",
        cookie: request.headers.get("cookie") ?? "",
        ...(method !== "GET"
          ? {
              "content-type": "application/json",
              "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
            }
          : {}),
      },
      ...(method !== "GET" ? { body: await request.text() } : {}),
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
      { error: "Research API is unavailable" },
      { status: 503 },
    );
  }
}
type Params = { params: Promise<{ path: string[] }> };
export async function GET(r: Request, p: Params) {
  return forward(r, (await p.params).path);
}
export async function POST(r: Request, p: Params) {
  return forward(r, (await p.params).path);
}
