import { NextResponse } from "next/server";

import { installationApiOrigin } from "../../../installation-api-bff";

export async function GET() {
  try {
    const response = await fetch(
      new URL("/api/v1/openapi.json", installationApiOrigin()),
      { cache: "no-store", redirect: "error" },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "API contract unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
