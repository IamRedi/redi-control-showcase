export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function modelStudioApiOrigin(): URL {
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

export const modelStudioHeaders = (request: Request, mutation = false) => ({
  accept: "application/json",
  cookie: request.headers.get("cookie") ?? "",
  "x-correlation-id": request.headers.get("x-correlation-id") ?? "",
  ...(mutation
    ? {
        "content-type": "application/json",
        "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
      }
    : {}),
});

export async function boundedJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 12_000) throw new Error("Request too large");
  const text = await request.text();
  if (text.length > 12_000) throw new Error("Request too large");
  return JSON.parse(text) as unknown;
}
