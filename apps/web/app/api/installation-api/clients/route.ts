import { NextResponse } from "next/server";

import {
  boundedJson,
  forwardJson,
  installationApiHeaders,
  installationApiOrigin,
} from "../../../installation-api-bff";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return forwardJson(
      await fetch(
        new URL("/api/installation-api/clients", installationApiOrigin()),
        {
          headers: installationApiHeaders(request),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Installation API administration unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    return forwardJson(
      await fetch(
        new URL("/api/installation-api/clients", installationApiOrigin()),
        {
          method: "POST",
          headers: installationApiHeaders(request, true),
          body: await boundedJson(request),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Installation API administration unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
