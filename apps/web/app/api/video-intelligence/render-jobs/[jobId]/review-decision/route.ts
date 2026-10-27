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
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  if (!UUID.test(jobId)) return new Response(null, { status: 400 });
  try {
    const body = record(await boundedJson(request));
    if (
      !body ||
      !exactKeys(body, [
        "workspaceId",
        "mediaAssetId",
        "idempotencyKey",
        "decision",
        "reason",
      ]) ||
      !UUID.test(String(body.workspaceId)) ||
      !UUID.test(String(body.mediaAssetId)) ||
      !UUID.test(String(body.idempotencyKey)) ||
      !["approved", "rejected"].includes(String(body.decision)) ||
      (body.decision === "rejected"
        ? !bounded(body.reason, 10, 500)
        : body.reason !== undefined)
    )
      return new Response(null, { status: 400 });
    return forwardVideoMutation(
      request,
      `/api/video-intelligence/render-jobs/${jobId}/review-decision`,
      body,
    );
  } catch {
    return unavailable();
  }
}
