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
        { error: "Invalid API client" },
        { status: 400 },
      );
    const body = object(await platformJson(request));
    if (
      !body ||
      Object.keys(body).some(
        (key) => !["displayName", "lifetimeDays"].includes(key),
      ) ||
      !bounded(body.displayName, 2, 120) ||
      !Number.isInteger(body.lifetimeDays) ||
      Number(body.lifetimeDays) < 1 ||
      Number(body.lifetimeDays) > 365
    )
      return NextResponse.json(
        { error: "Invalid API client" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/tenants/${tenantId}/api-clients`,
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
        { error: "API client issuance refused" },
        { status: upstream.status },
      );
    return NextResponse.json(await upstream.json(), {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Platform API is unavailable" },
      { status: 503 },
    );
  }
}
