import { NextResponse } from "next/server";

import {
  boundedJson,
  exactKeys,
  forwardVideoMutation,
  record,
  unavailable,
  UUID,
} from "../../../../../video-intelligence-bff";

export async function POST(
  request: Request,
  context: { params: Promise<{ briefId: string }> },
) {
  try {
    const { briefId } = await context.params;
    const body = record(await boundedJson(request));
    if (
      !UUID.test(briefId) ||
      !body ||
      !exactKeys(body, ["workspaceId", "idempotencyKey", "expectedRevision"]) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      typeof body.idempotencyKey !== "string" ||
      !UUID.test(body.idempotencyKey) ||
      !Number.isInteger(body.expectedRevision) ||
      Number(body.expectedRevision) < 1
    )
      return NextResponse.json(
        { error: "Invalid review request" },
        { status: 400 },
      );
    return await forwardVideoMutation(
      request,
      `/api/video-intelligence/briefs/${briefId}/review`,
      body,
    );
  } catch {
    return unavailable();
  }
}
