import { NextResponse } from "next/server";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
export const bounded = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "string" &&
  value.trim().length >= minimum &&
  value.length <= maximum;
export const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => Object.keys(value).every((key) => allowed.includes(key));

export function videoApiOrigin(): URL {
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

export const videoHeaders = (request: Request) => ({
  accept: "application/json",
  "content-type": "application/json",
  cookie: request.headers.get("cookie") ?? "",
  "x-correlation-id": request.headers.get("x-correlation-id") ?? "",
  "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
});

export async function boundedJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 32_000) throw new Error("Request too large");
  const text = await request.text();
  if (text.length > 32_000) throw new Error("Request too large");
  return JSON.parse(text) as unknown;
}

export async function forwardVideoMutation(
  request: Request,
  path: string,
  body: Record<string, unknown>,
) {
  const upstream = await fetch(new URL(path, videoApiOrigin()), {
    method: "POST",
    headers: videoHeaders(request),
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
  });
  if (!upstream.ok)
    return NextResponse.json(
      { error: "Video workflow command was refused" },
      { status: upstream.status, headers: { "cache-control": "no-store" } },
    );
  return NextResponse.json(await upstream.json(), {
    status: upstream.status,
    headers: { "cache-control": "no-store" },
  });
}

export const unavailable = () =>
  NextResponse.json(
    { error: "Video Intelligence API is unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
