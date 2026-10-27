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
      !exactKeys(body, [
        "workspaceId",
        "idempotencyKey",
        "expectedRevision",
        "decision",
        "reason",
      ]) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      typeof body.idempotencyKey !== "string" ||
      !UUID.test(body.idempotencyKey) ||
      !Number.isInteger(body.expectedRevision) ||
      Number(body.expectedRevision) < 1 ||
      !["approved", "rejected"].includes(String(body.decision)) ||
      (body.reason !== undefined &&
        (typeof body.reason !== "string" || body.reason.length > 500))
    )
      return NextResponse.json(
        { error: "Invalid approval decision" },
        { status: 400 },
      );
    return await forwardVideoMutation(
      request,
      `/api/video-intelligence/briefs/${briefId}/decision`,
      body,
    );
  } catch {
    return unavailable();
  }
}
