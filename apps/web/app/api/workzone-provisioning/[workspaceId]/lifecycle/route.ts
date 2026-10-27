import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  UUID,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../../workzone-provisioning-bff";

export async function POST(
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
          `/api/workzone-provisioning/${workspaceId}/lifecycle`,
          workzoneApiOrigin(),
        ),
        {
          method: "POST",
          headers: workzoneHeaders(request, true),
          body: await boundedBody(request),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone lifecycle transition is unavailable" },
      { status: 503 },
    );
  }
}
