import { headers } from "next/headers";

export const dynamic = "force-dynamic";

function controlApiOrigin(): string | null {
  const configured = process.env.CONTROL_API_URL ?? process.env.PUBLIC_API_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const origin = controlApiOrigin();
  if (!origin)
    return Response.json(
      { error: "Dashboard API is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  const requestHeaders = await headers();
  const target = new URL("/api/dashboard/overview", origin);
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (workspaceId) target.searchParams.set("workspaceId", workspaceId);
  const upstream = await fetch(target, {
    cache: "no-store",
    headers: {
      cookie: requestHeaders.get("cookie") ?? "",
      "x-correlation-id": requestHeaders.get("x-correlation-id") ?? "",
    },
  });
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "cache-control": "no-store",
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
