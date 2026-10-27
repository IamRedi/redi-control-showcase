import { NextResponse } from "next/server";
import {
  bounded,
  object,
  platformApiOrigin,
  platformHeaders,
  platformJson,
  UUID,
} from "../../../../../platform-owner-bff";

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await context.params;
    if (
      !UUID.test(tenantId) ||
      !UUID.test(request.headers.get("x-platform-access-grant") ?? "")
    )
      return NextResponse.json(
        { error: "Invalid platform request" },
        { status: 400 },
      );
    const body = object(await platformJson(request));
    if (
      !body ||
      Object.keys(body).some((key) => !["action", "reason"].includes(key)) ||
      !["suspend", "reactivate", "request_deletion"].includes(
        String(body.action),
      ) ||
      !bounded(body.reason, 10, 1000)
    )
      return NextResponse.json(
        { error: "Invalid lifecycle request" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/tenants/${tenantId}/lifecycle`,
        platformApiOrigin(),
      ),
      {
        method: "POST",
        headers: platformHeaders(request, true),
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Lifecycle request refused" },
        { status: upstream.status },
      );
    return NextResponse.json(await upstream.json(), {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Platform API is unavailable" },
      { status: 503 },
    );
  }
}
