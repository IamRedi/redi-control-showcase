import { NextResponse } from "next/server";

import {
  parseSocialWorkflowAction,
  parseSocialWorkflowDetail,
} from "../../../../social-contract";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiOrigin(): URL {
  const origin = new URL(
    process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3001",
  );
  const local = ["127.0.0.1", "localhost"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        local &&
        origin.protocol === "http:"
      ))
  )
    throw new Error("PUBLIC_API_ORIGIN is not a trusted API origin");
  return origin;
}

const upstreamHeaders = (request: Request) => ({
  accept: "application/json",
  cookie: request.headers.get("cookie") ?? "",
  "x-correlation-id": request.headers.get("x-correlation-id") ?? "",
});

type Params = { params: Promise<{ draftId: string }> };

export async function GET(request: Request, context: Params) {
  const { draftId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!UUID.test(draftId) || !workspaceId || !UUID.test(workspaceId))
    return NextResponse.json(
      { error: "A valid draft and workspace are required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const target = new URL(
      `/api/social/drafts/${draftId}/revisions`,
      apiOrigin(),
    );
    target.searchParams.set("workspaceId", workspaceId);
    target.searchParams.set("limit", "25");
    const response = await fetch(target, {
      headers: upstreamHeaders(request),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      return NextResponse.json(
        { error: "Social workflow detail is unavailable" },
        { status: response.status, headers: { "cache-control": "no-store" } },
      );
    const detail = parseSocialWorkflowDetail(await response.json());
    if (!detail) throw new Error("Invalid Social workflow response");
    return NextResponse.json(detail, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Social workflow API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request, context: Params) {
  const { draftId } = await context.params;
  if (!UUID.test(draftId))
    return NextResponse.json(
      { error: "A valid draft is required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const action = parseSocialWorkflowAction(await request.json());
    if (!action)
      return NextResponse.json(
        { error: "Invalid workflow action" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    const path =
      action.action === "submit"
        ? "review"
        : action.action === "decide"
          ? "decision"
          : "schedule";
    const body =
      action.action === "submit"
        ? {}
        : action.action === "decide"
          ? {
              decision: action.decision,
              ...(action.reason ? { reason: action.reason } : {}),
            }
          : {
              scheduledFor: action.scheduledFor,
              timezone: action.timezone,
            };
    const response = await fetch(
      new URL(`/api/social/drafts/${draftId}/${path}`, apiOrigin()),
      {
        method: "POST",
        headers: {
          ...upstreamHeaders(request),
          "content-type": "application/json",
          "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok)
      return NextResponse.json(
        { error: "Social workflow action was refused" },
        { status: response.status, headers: { "cache-control": "no-store" } },
      );
    if (response.status !== 204)
      throw new Error("Invalid Social workflow mutation response");
    return NextResponse.json(
      { action: action.action, accepted: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Social workflow API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
