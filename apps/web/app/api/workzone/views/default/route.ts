import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../../workzone-provisioning-bff";
import { parseWorkboardDefaultViewInput } from "../../../../workboard-view-contract";

export async function PUT(request: Request) {
  let input: ReturnType<typeof parseWorkboardDefaultViewInput>;
  try {
    input = parseWorkboardDefaultViewInput(
      JSON.parse(await boundedBody(request)) as unknown,
    );
  } catch {
    input = null;
  }
  if (!input)
    return NextResponse.json(
      { error: "Invalid default Workboard view" },
      { status: 400 },
    );
  try {
    return forward(
      await fetch(new URL("/api/workzone/views/default", workzoneApiOrigin()), {
        method: "PUT",
        headers: workzoneHeaders(request, true),
        body: JSON.stringify(input),
        cache: "no-store",
        redirect: "error",
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Workboard views are unavailable" },
      { status: 503 },
    );
  }
}
