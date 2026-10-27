import { NextResponse } from "next/server";

import {
  boundedBody,
  forward,
  workzoneApiOrigin,
  workzoneHeaders,
} from "../../../workzone-provisioning-bff";
import {
  parseWorkboardViewInput,
  parseWorkboardViewSnapshot,
} from "../../../workboard-view-contract";

export async function GET(request: Request) {
  try {
    const upstream = await fetch(
      new URL("/api/workzone/views", workzoneApiOrigin()),
      {
        headers: workzoneHeaders(request),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok) return forward(upstream);
    const snapshot = parseWorkboardViewSnapshot(await upstream.json());
    if (!snapshot) throw new Error("Invalid Workboard view response");
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Workboard views are unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let input: ReturnType<typeof parseWorkboardViewInput>;
  try {
    input = parseWorkboardViewInput(
      JSON.parse(await boundedBody(request)) as unknown,
    );
  } catch {
    input = null;
  }
  if (!input)
    return NextResponse.json(
      { error: "Invalid Workboard view" },
      { status: 400 },
    );
  try {
    const upstream = await fetch(
      new URL("/api/workzone/views", workzoneApiOrigin()),
      {
        method: "POST",
        headers: workzoneHeaders(request, true),
        body: JSON.stringify(input),
        cache: "no-store",
        redirect: "error",
      },
    );
    return forward(upstream);
  } catch {
    return NextResponse.json(
      { error: "Workboard views are unavailable" },
      { status: 503 },
    );
  }
}
