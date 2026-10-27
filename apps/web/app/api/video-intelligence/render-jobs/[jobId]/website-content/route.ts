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
        "title",
        "summary",
      ]) ||
      !UUID.test(String(body.workspaceId)) ||
      !UUID.test(String(body.mediaAssetId)) ||
      !UUID.test(String(body.idempotencyKey)) ||
      !bounded(body.title, 1, 240) ||
      (body.summary !== undefined && !bounded(body.summary, 1, 2_000))
    )
      return new Response(null, { status: 400 });
    return forwardVideoMutation(
      request,
      `/api/video-intelligence/render-jobs/${jobId}/website-content`,
      body,
    );
  } catch {
    return unavailable();
  }
}
