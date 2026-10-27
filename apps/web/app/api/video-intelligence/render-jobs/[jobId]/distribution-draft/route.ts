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
        "accountIds",
        "idempotencyKey",
        "title",
        "caption",
        "description",
      ]) ||
      !UUID.test(String(body.workspaceId)) ||
      !UUID.test(String(body.mediaAssetId)) ||
      !UUID.test(String(body.idempotencyKey)) ||
      !Array.isArray(body.accountIds) ||
      body.accountIds.length < 1 ||
      body.accountIds.length > 10 ||
      new Set(body.accountIds).size !== body.accountIds.length ||
      body.accountIds.some(
        (accountId) => typeof accountId !== "string" || !UUID.test(accountId),
      ) ||
      (body.title !== undefined && !bounded(body.title, 1, 100)) ||
      (body.caption !== undefined && !bounded(body.caption, 1, 5_000)) ||
      (body.description !== undefined && !bounded(body.description, 1, 5_000))
    )
      return new Response(null, { status: 400 });
    return forwardVideoMutation(
      request,
      `/api/video-intelligence/render-jobs/${jobId}/distribution-draft`,
      body,
    );
  } catch {
    return unavailable();
  }
}
