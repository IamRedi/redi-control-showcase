import { NextResponse } from "next/server";

import {
  bounded,
  boundedJson,
  exactKeys,
  forwardVideoMutation,
  record,
  unavailable,
  UUID,
} from "../../../video-intelligence-bff";

const evidenceKinds = [
  "aggregate_audience_signal",
  "verified_product_fact",
  "approved_editorial_story",
];

export async function POST(request: Request) {
  try {
    const body = record(await boundedJson(request));
    const evidence = Array.isArray(body?.evidence)
      ? body.evidence.map(record)
      : [];
    if (
      !body ||
      !exactKeys(body, [
        "workspaceId",
        "idempotencyKey",
        "programId",
        "topic",
        "objective",
        "audience",
        "script",
        "evidence",
      ]) ||
      typeof body.workspaceId !== "string" ||
      !UUID.test(body.workspaceId) ||
      typeof body.idempotencyKey !== "string" ||
      !UUID.test(body.idempotencyKey) ||
      !["product_faq_ads", "daily_news_flash"].includes(
        String(body.programId),
      ) ||
      !bounded(body.topic, 3, 240) ||
      !bounded(body.objective, 10, 2000) ||
      !bounded(body.audience, 3, 500) ||
      !bounded(body.script, 20, 20_000) ||
      evidence.length < 1 ||
      evidence.length > 12 ||
      evidence.some(
        (item) =>
          !item ||
          !exactKeys(item, [
            "kind",
            "title",
            "sourceReference",
            "summary",
            "aggregateCount",
          ]) ||
          !evidenceKinds.includes(String(item.kind)) ||
          !bounded(item.title, 3, 240) ||
          !bounded(item.sourceReference, 3, 500) ||
          !bounded(item.summary, 10, 2000) ||
          (item.kind === "aggregate_audience_signal"
            ? !Number.isInteger(item.aggregateCount) ||
              Number(item.aggregateCount) < 2 ||
              Number(item.aggregateCount) > 1_000_000
            : item.aggregateCount !== undefined),
      )
    )
      return NextResponse.json(
        { error: "Invalid video brief" },
        { status: 400 },
      );
    return await forwardVideoMutation(
      request,
      "/api/video-intelligence/briefs",
      body,
    );
  } catch {
    return unavailable();
  }
}
