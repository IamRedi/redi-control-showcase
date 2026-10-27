import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../workzone-provisioning-bff";

export async function GET(request: Request) {
  try {
    return forward(
      await fetch(new URL("/api/workzone-provisioning", workzoneApiOrigin()), {
        headers: workzoneHeaders(request),
        cache: "no-store",
        redirect: "error",
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone provisioning is unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return forward(
      await fetch(new URL("/api/workzone-provisioning", workzoneApiOrigin()), {
        method: "POST",
        headers: workzoneHeaders(request, true),
        body: await boundedBody(request),
        cache: "no-store",
        redirect: "error",
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Workzone provisioning is unavailable" },
      { status: 503 },
    );
  }
}
