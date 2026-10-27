import { NextResponse } from "next/server";
import {
  boundedJson,
  modelStudioApiOrigin,
  modelStudioHeaders,
  UUID,
} from "../../../../../../model-studio-bff";

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
type Context = { params: Promise<{ proposalId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const { proposalId } = await context.params,
      body = record(await boundedJson(request));
    const rates = [
      body?.schemaPassRate,
      body?.groundingPassRate,
      body?.safetyPassRate,
      body?.languagePassRate,
    ];
    if (
      !UUID.test(proposalId) ||
      !body ||
      Object.keys(body).some(
        (key) =>
          ![
            "workspaceId",
            "datasetVersion",
            "sampleSize",
            "schemaPassRate",
            "groundingPassRate",
            "safetyPassRate",
            "languagePassRate",
            "decision",
            "notes",
            "evaluatedAt",
          ].includes(key),
      ) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      typeof body.datasetVersion !== "string" ||
      !body.datasetVersion.trim() ||
      body.datasetVersion.length > 120 ||
      typeof body.sampleSize !== "number" ||
      !Number.isInteger(body.sampleSize) ||
      body.sampleSize < 1 ||
      rates.some(
        (rate) => typeof rate !== "number" || rate < 0 || rate > 100,
      ) ||
      !["passed", "failed"].includes(String(body.decision)) ||
      typeof body.evaluatedAt !== "string" ||
      Number.isNaN(Date.parse(body.evaluatedAt)) ||
      (body.notes !== undefined &&
        (typeof body.notes !== "string" || body.notes.length > 2000))
    )
      return NextResponse.json(
        { error: "Invalid evaluation evidence" },
        { status: 400 },
      );
    const upstream = await fetch(
      new URL(
        `/api/workzone/model-studio/proposals/${proposalId}/evaluations`,
        modelStudioApiOrigin(),
      ),
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
        { error: "Evaluation evidence was refused" },
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
