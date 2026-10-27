import { NextResponse } from "next/server";

import {
  parseCreateSocialDraftInput,
  parseSocialAccounts,
  parseSocialDrafts,
  parseSocialMedia,
  parseSocialWorkflowPermissions,
} from "../../../social-contract";

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

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId || !UUID.test(workspaceId))
    return NextResponse.json(
      { error: "A valid workspace is required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const accountsUrl = new URL("/api/social/accounts", apiOrigin());
    const mediaUrl = new URL("/api/media", apiOrigin());
    const draftsUrl = new URL("/api/social/drafts", apiOrigin());
    for (const target of [accountsUrl, mediaUrl, draftsUrl])
      target.searchParams.set("workspaceId", workspaceId);
    draftsUrl.searchParams.set("limit", "100");
    const responses = await Promise.all(
      [accountsUrl, mediaUrl, draftsUrl].map((target) =>
        fetch(target, {
          method: "GET",
          headers: upstreamHeaders(request),
          cache: "no-store",
          redirect: "error",
        }),
      ),
    );
    const failed = responses.find((response) => !response.ok);
    if (failed)
      return NextResponse.json(
        { error: "Social Studio data is unavailable" },
        {
          status: failed.status,
          headers: { "cache-control": "no-store" },
        },
      );
    const [accountBody, mediaBody, draftBody] = await Promise.all(
      responses.map((response) => response.json() as Promise<unknown>),
    );
    const accounts = parseSocialAccounts(accountBody);
    const media = parseSocialMedia(mediaBody);
    const drafts = parseSocialDrafts(draftBody);
    const draftEnvelope =
      draftBody !== null && typeof draftBody === "object"
        ? (draftBody as Record<string, unknown>)
        : null;
    const permissions = parseSocialWorkflowPermissions(
      draftEnvelope?.permissions,
    );
    if (!accounts || !media || !drafts || !permissions)
      throw new Error("Invalid Social Studio response");
    return NextResponse.json(
      { accounts, media, drafts, permissions },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Social Studio API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = parseCreateSocialDraftInput(
      (await request.json()) as unknown,
    );
    if (!input)
      return NextResponse.json(
        { error: "Invalid social draft" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    const response = await fetch(new URL("/api/social/drafts", apiOrigin()), {
      method: "POST",
      headers: {
        ...upstreamHeaders(request),
        "content-type": "application/json",
        "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      redirect: "error",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok)
      return NextResponse.json(
        { error: "Social draft could not be created" },
        {
          status: response.status,
          headers: { "cache-control": "no-store" },
        },
      );
    const result =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>)
        : null;
    if (
      !result ||
      typeof result.draftId !== "string" ||
      !UUID.test(result.draftId) ||
      result.status !== "draft"
    )
      throw new Error("Invalid Social Draft response");
    return NextResponse.json(
      { draftId: result.draftId, status: "draft" },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Social Studio API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
