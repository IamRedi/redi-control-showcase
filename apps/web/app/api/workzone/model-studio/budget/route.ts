import { NextResponse } from "next/server";
import {
  boundedJson,
  modelStudioApiOrigin,
  modelStudioHeaders,
  UUID,
} from "../../../../model-studio-bff";

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
export async function PUT(request: Request) {
  try {
    const body = record(await boundedJson(request));
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          ![
            "workspaceId",
            "dailyCostLimit",
            "monthlyCostLimit",
            "maximumConcurrency",
          ].includes(key),
      ) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      typeof body.dailyCostLimit !== "number" ||
      typeof body.monthlyCostLimit !== "number" ||
      typeof body.maximumConcurrency !== "number" ||
      !Number.isInteger(body.maximumConcurrency)
    )
      return NextResponse.json({ error: "Invalid budget" }, { status: 400 });
    const upstream = await fetch(
      new URL("/api/workzone/model-studio/budget", modelStudioApiOrigin()),
      {
        method: "PUT",
        headers: modelStudioHeaders(request, true),
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Budget update was refused" },
        { status: upstream.status },
      );
    return NextResponse.json(
      { accepted: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Model Studio API is unavailable" },
      { status: 503 },
    );
  }
}
