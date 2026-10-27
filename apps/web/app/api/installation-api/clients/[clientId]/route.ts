import { NextResponse } from "next/server";

import {
  forwardJson,
  installationApiHeaders,
  installationApiOrigin,
  UUID,
} from "../../../../installation-api-bff";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const { clientId } = await context.params;
    if (!UUID.test(clientId))
      return NextResponse.json(
        { error: "Invalid API client" },
        { status: 400 },
      );
    const response = await fetch(
      new URL(
        `/api/installation-api/clients/${clientId}`,
        installationApiOrigin(),
      ),
      {
        method: "DELETE",
        headers: installationApiHeaders(request, true),
        cache: "no-store",
        redirect: "error",
      },
    );
    return response.status === 204
      ? new NextResponse(null, { status: 204 })
      : forwardJson(response);
  } catch {
    return NextResponse.json(
      { error: "Installation API administration unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
