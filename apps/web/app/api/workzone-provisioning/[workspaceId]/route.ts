import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  UUID,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../workzone-provisioning-bff";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await context.params;
    if (!UUID.test(workspaceId))
      return NextResponse.json({ error: "Invalid workzone" }, { status: 400 });
    return forward(
      await fetch(
        new URL(
          `/api/workzone-provisioning/${workspaceId}`,
          workzoneApiOrigin(),
        ),
        {
          method: "PATCH",
          headers: workzoneHeaders(request, true),
          body: await boundedBody(request),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone provisioning is unavailable" },
      { status: 503 },
    );
  }
}
