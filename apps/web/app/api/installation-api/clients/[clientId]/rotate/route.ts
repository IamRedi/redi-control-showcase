import { NextResponse } from "next/server";

import {
  forwardJson,
  installationApiHeaders,
  installationApiOrigin,
  UUID,
} from "../../../../../installation-api-bff";

export async function POST(
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
    return forwardJson(
      await fetch(
        new URL(
          `/api/installation-api/clients/${clientId}/rotate`,
          installationApiOrigin(),
        ),
        {
          method: "POST",
          headers: installationApiHeaders(request, true),
          body: "{}",
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Installation API administration unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
