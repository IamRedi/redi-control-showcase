import { NextResponse } from "next/server";

import {
  forward,
  UUID,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../../workzone-provisioning-bff";

export async function GET(
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
          `/api/workzone-provisioning/${workspaceId}/lifecycle-impact`,
          workzoneApiOrigin(),
        ),
        {
          headers: workzoneHeaders(request),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone lifecycle preview is unavailable" },
      { status: 503 },
    );
  }
}
