import { NextResponse } from "next/server";

import {
  bounded,
  object,
  platformApiOrigin,
  platformHeaders,
  platformJson,
  UUID,
} from "../../../../../platform-owner-bff";

const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        { error: "Invalid owner invitation" },
        { status: 400 },
      );
    const body = object(await platformJson(request));
    if (
      !body ||
      Object.keys(body).some(
        (key) => !["email", "lifetimeHours"].includes(key),
      ) ||
      typeof body.email !== "string" ||
      !bounded(body.email, 3, 320) ||
      !email.test(body.email.trim()) ||
      !Number.isInteger(body.lifetimeHours) ||
      Number(body.lifetimeHours) < 1 ||
      Number(body.lifetimeHours) > 168
    )
      return NextResponse.json(
        { error: "Invalid owner invitation" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/tenants/${tenantId}/owner-invitations`,
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
        { error: "Owner invitation refused" },
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
