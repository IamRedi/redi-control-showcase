import { NextResponse } from "next/server";

import {
  platformApiOrigin,
  platformHeaders,
  UUID,
} from "../../../../platform-owner-bff";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  try {
    const { invitationId } = await context.params;
    if (
      !UUID.test(invitationId) ||
      !UUID.test(request.headers.get("x-platform-access-grant") ?? "")
    )
      return NextResponse.json(
        { error: "Invalid owner invitation" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/owner-invitations/${invitationId}`,
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
        { error: "Owner invitation revocation refused" },
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
