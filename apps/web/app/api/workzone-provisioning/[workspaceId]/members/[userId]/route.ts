import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  UUID,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../../../workzone-provisioning-bff";

const target = (workspaceId: string, userId: string) =>
  `/api/workzone-provisioning/${workspaceId}/members/${userId}`;

export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  try {
    const { workspaceId, userId } = await context.params;
    if (!UUID.test(workspaceId) || !UUID.test(userId))
      return NextResponse.json(
        { error: "Invalid workzone assignment" },
        { status: 400 },
      );
    return forward(
      await fetch(new URL(target(workspaceId, userId), workzoneApiOrigin()), {
        method: "PUT",
        headers: workzoneHeaders(request, true),
        body: await boundedBody(request),
        cache: "no-store",
        redirect: "error",
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone provisioning is unavailable" },
      { status: 503 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  try {
    const { workspaceId, userId } = await context.params;
    if (!UUID.test(workspaceId) || !UUID.test(userId))
      return NextResponse.json(
        { error: "Invalid workzone assignment" },
        { status: 400 },
      );
    return forward(
      await fetch(new URL(target(workspaceId, userId), workzoneApiOrigin()), {
        method: "DELETE",
        headers: workzoneHeaders(request, true),
        cache: "no-store",
        redirect: "error",
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone provisioning is unavailable" },
      { status: 503 },
    );
  }
}
