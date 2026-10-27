import { NextResponse } from "next/server";
import {
  boundedJson,
  modelStudioApiOrigin,
  modelStudioHeaders,
  UUID,
} from "../../../../model-studio-bff";
import { modelStudioOperations } from "../../../../model-studio-contract";

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
const bounded = (v: unknown, n: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= n;
export async function POST(request: Request) {
  try {
    const body = record(await boundedJson(request));
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          ![
            "workspaceId",
            "operation",
            "providerId",
            "model",
            "promptVersion",
            "maxOutputTokens",
            "dataPolicyStatus",
            "rationale",
          ].includes(key),
      ) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      !modelStudioOperations.includes(body.operation as never) ||
      !bounded(body.providerId, 120) ||
      !bounded(body.model, 160) ||
      !bounded(body.promptVersion, 80) ||
      typeof body.maxOutputTokens !== "number" ||
      !Number.isInteger(body.maxOutputTokens) ||
      !["unreviewed", "approved", "rejected"].includes(
        String(body.dataPolicyStatus),
      ) ||
      !bounded(body.rationale, 2000)
    )
      return NextResponse.json(
        { error: "Invalid route proposal" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL("/api/workzone/model-studio/proposals", modelStudioApiOrigin()),
      {
        method: "POST",
        headers: modelStudioHeaders(request, true),
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!upstream.ok)
      return NextResponse.json(
        { error: "Route proposal was refused" },
        { status: upstream.status },
      );
    return NextResponse.json(
      { accepted: true },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Model Studio API is unavailable" },
      { status: 503 },
    );
  }
}
