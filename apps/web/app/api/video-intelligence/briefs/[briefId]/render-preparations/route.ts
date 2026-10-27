import { NextResponse } from "next/server";

import {
  bounded,
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
    const outputs = Array.isArray(body?.outputs) ? body.outputs : [];
    if (
      !UUID.test(briefId) ||
      !body ||
      !exactKeys(body, [
        "workspaceId",
        "idempotencyKey",
        "expectedRevision",
        "targetLanguage",
        "maxDurationSeconds",
        "rightsReference",
        "outputs",
      ]) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      typeof body.idempotencyKey !== "string" ||
      !UUID.test(body.idempotencyKey) ||
      !Number.isInteger(body.expectedRevision) ||
      Number(body.expectedRevision) < 1 ||
      !["en", "de", "sq"].includes(String(body.targetLanguage)) ||
      !Number.isInteger(body.maxDurationSeconds) ||
      Number(body.maxDurationSeconds) < 15 ||
      Number(body.maxDurationSeconds) > 180 ||
      !bounded(body.rightsReference, 3, 500) ||
      outputs.length < 1 ||
      outputs.length > 2 ||
      new Set(outputs).size !== outputs.length ||
      outputs.some((output) => !["9:16", "16:9"].includes(String(output)))
    )
      return NextResponse.json(
        { error: "Invalid render preparation" },
        { status: 400 },
      );
    return await forwardVideoMutation(
      request,
      `/api/video-intelligence/briefs/${briefId}/render-preparations`,
      body,
    );
  } catch {
    return unavailable();
  }
}
