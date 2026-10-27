import { NextResponse } from "next/server";
import {
  platformApiOrigin,
  platformHeaders,
  UUID,
} from "../../../../../platform-owner-bff";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await context.params;
    if (
      !UUID.test(requestId) ||
      !UUID.test(request.headers.get("x-platform-access-grant") ?? "")
    )
      return NextResponse.json(
        { error: "Invalid platform request" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/platform-owner/lifecycle/${requestId}/execute`,
        platformApiOrigin(),
      ),
      {
        method: "POST",
        headers: platformHeaders(request, true),
        body: "{}",
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Independent approval refused" },
        { status: upstream.status },
      );
    return NextResponse.json(await upstream.json(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Platform API is unavailable" },
      { status: 503 },
    );
  }
}
