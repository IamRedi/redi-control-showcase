import { NextResponse } from "next/server";

import {
  platformApiOrigin,
  platformHeaders,
  UUID,
} from "../../../../platform-owner-bff";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    if (
      !UUID.test(clientId) ||
      !UUID.test(request.headers.get("x-platform-access-grant") ?? "")
    )
      return NextResponse.json(
        { error: "Invalid API client" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/api-clients/${clientId}`,
        platformApiOrigin(),
      ),
      {
        method: "DELETE",
        headers: platformHeaders(request, true),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "API client revocation refused" },
        { status: upstream.status },
      );
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "Platform API is unavailable" },
      { status: 503 },
    );
  }
}
