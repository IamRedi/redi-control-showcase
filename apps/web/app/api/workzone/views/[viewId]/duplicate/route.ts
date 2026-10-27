import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  UUID,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../../../workzone-provisioning-bff";
import { parseWorkboardViewNameInput } from "../../../../../workboard-view-contract";

export async function POST(
  request: Request,
  context: { params: Promise<{ viewId: string }> },
) {
  const { viewId } = await context.params;
  if (!UUID.test(viewId))
    return NextResponse.json(
      { error: "Invalid Workboard view" },
      { status: 400 },
    );
  let input: ReturnType<typeof parseWorkboardViewNameInput>;
  try {
    input = parseWorkboardViewNameInput(
      JSON.parse(await boundedBody(request)) as unknown,
    );
  } catch {
    input = null;
  }
  if (!input)
    return NextResponse.json(
      { error: "Invalid Workboard view name" },
      { status: 400 },
    );
  try {
    return forward(
      await fetch(
        new URL(`/api/workzone/views/${viewId}/duplicate`, workzoneApiOrigin()),
        {
          method: "POST",
          headers: workzoneHeaders(request, true),
          body: JSON.stringify(input),
          cache: "no-store",
          redirect: "error",
        },
      ),
    );
  } catch {
    return NextResponse.json(
      { error: "Workboard views are unavailable" },
      { status: 503 },
    );
  }
}
