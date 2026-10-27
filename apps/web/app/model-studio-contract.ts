export const modelStudioOperations = [
  "claim_extraction",
  "evidence_comparison",
  "factual_synthesis",
  "grounding_validation",
  "editorial_transformation",
  "editorial_grounding_validation",
  "editorial_image_generation",
  "channel_adaptation",
] as const;

export type ModelStudioOperation = (typeof modelStudioOperations)[number];

export interface ModelStudioSnapshot {
  readonly workspace: { readonly id: string; readonly displayName: string };
  readonly activationControlsAvailable: false;
  readonly runtimeRoutes: readonly {
    readonly operation: string;
    readonly providerId: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly maxOutputTokens: number;
    readonly enabled: boolean;
  }[];
  readonly budget: null | {
    readonly dailyCostLimit: number;
    readonly monthlyCostLimit: number;
    readonly maximumConcurrency: number;
    readonly enabled: boolean;
    readonly dailyUsed: number;
    readonly monthlyUsed: number;
    readonly running: number;
  };
  readonly proposals: readonly {
    readonly id: string;
    readonly operation: ModelStudioOperation;
    readonly providerId: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly maxOutputTokens: number;
    readonly dataPolicyStatus: "unreviewed" | "approved" | "rejected";
    readonly rationale: string;
    readonly createdAt: string;
    readonly latestEvaluation: null | {
      readonly id: string;
      readonly datasetVersion: string;
      readonly sampleSize: number;
      readonly schemaPassRate: number;
      readonly groundingPassRate: number;
      readonly safetyPassRate: number;
      readonly languagePassRate: number;
      readonly decision: "passed" | "failed";
      readonly notes: string;
      readonly evaluatedAt: string;
    };
  }[];
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;
const finite = (
  value: unknown,
  minimum = 0,
  maximum = 10_000_000,
): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum;
const integer = (
  value: unknown,
  minimum = 0,
  maximum = 100_000,
): value is number =>
  finite(value, minimum, maximum) && Number.isInteger(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  !Number.isNaN(Date.parse(value));

export function parseModelStudioSnapshot(
  value: unknown,
): ModelStudioSnapshot | null {
  const envelope = record(value),
    workspace = record(envelope?.workspace);
  if (
    !envelope ||
    !workspace ||
    typeof workspace.id !== "string" ||
    !UUID.test(workspace.id) ||
    !text(workspace.displayName, 160) ||
    envelope.activationControlsAvailable !== false ||
    !Array.isArray(envelope.runtimeRoutes) ||
    envelope.runtimeRoutes.length > 8 ||
    !Array.isArray(envelope.proposals) ||
    envelope.proposals.length > 50
  )
    return null;

  const runtimeRoutes: ModelStudioSnapshot["runtimeRoutes"][number][] = [];
  for (const candidate of envelope.runtimeRoutes) {
    const route = record(candidate);
    if (
      !route ||
      !text(route.operation, 80) ||
      !text(route.providerId, 120) ||
      !text(route.model, 160) ||
      !text(route.promptVersion, 80) ||
      !integer(route.maxOutputTokens, 64, 32_000) ||
      typeof route.enabled !== "boolean"
    )
      return null;
    runtimeRoutes.push({
      operation: route.operation,
      providerId: route.providerId,
      model: route.model,
      promptVersion: route.promptVersion,
      maxOutputTokens: route.maxOutputTokens,
      enabled: route.enabled,
    });
  }

  const rawBudget = envelope.budget;
  let budget: ModelStudioSnapshot["budget"] = null;
  if (rawBudget !== null) {
    const item = record(rawBudget);
    if (
      !item ||
      !finite(item.dailyCostLimit) ||
      !finite(item.monthlyCostLimit) ||
      !integer(item.maximumConcurrency, 1, 50) ||
      typeof item.enabled !== "boolean" ||
      !finite(item.dailyUsed) ||
      !finite(item.monthlyUsed) ||
      !integer(item.running, 0, 50)
    )
      return null;
    budget = {
      dailyCostLimit: item.dailyCostLimit,
      monthlyCostLimit: item.monthlyCostLimit,
      maximumConcurrency: item.maximumConcurrency,
      enabled: item.enabled,
      dailyUsed: item.dailyUsed,
      monthlyUsed: item.monthlyUsed,
      running: item.running,
    };
  }

  const proposals: ModelStudioSnapshot["proposals"][number][] = [];
  for (const candidate of envelope.proposals) {
    const item = record(candidate),
      evaluation = record(item?.latestEvaluation);
    if (
      !item ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      !modelStudioOperations.includes(item.operation as ModelStudioOperation) ||
      !text(item.providerId, 120) ||
      !text(item.model, 160) ||
      !text(item.promptVersion, 80) ||
      !integer(item.maxOutputTokens, 64, 32_000) ||
      !["unreviewed", "approved", "rejected"].includes(
        String(item.dataPolicyStatus),
      ) ||
      !text(item.rationale, 2000) ||
      !instant(item.createdAt)
    )
      return null;
    let latestEvaluation: ModelStudioSnapshot["proposals"][number]["latestEvaluation"] =
      null;
    if (item.latestEvaluation !== null) {
      if (
        !evaluation ||
        typeof evaluation.id !== "string" ||
        !UUID.test(evaluation.id) ||
        !text(evaluation.datasetVersion, 120) ||
        !integer(evaluation.sampleSize, 1) ||
        !finite(evaluation.schemaPassRate, 0, 100) ||
        !finite(evaluation.groundingPassRate, 0, 100) ||
        !finite(evaluation.safetyPassRate, 0, 100) ||
        !finite(evaluation.languagePassRate, 0, 100) ||
        !["passed", "failed"].includes(String(evaluation.decision)) ||
        typeof evaluation.notes !== "string" ||
        evaluation.notes.length > 2000 ||
        !instant(evaluation.evaluatedAt)
      )
        return null;
      latestEvaluation = {
        id: evaluation.id,
        datasetVersion: evaluation.datasetVersion,
        sampleSize: evaluation.sampleSize,
        schemaPassRate: evaluation.schemaPassRate,
        groundingPassRate: evaluation.groundingPassRate,
        safetyPassRate: evaluation.safetyPassRate,
        languagePassRate: evaluation.languagePassRate,
        decision: evaluation.decision as "passed" | "failed",
        notes: evaluation.notes,
        evaluatedAt: evaluation.evaluatedAt,
      };
    }
    proposals.push({
      id: item.id,
      operation: item.operation as ModelStudioOperation,
      providerId: item.providerId,
      model: item.model,
      promptVersion: item.promptVersion,
      maxOutputTokens: item.maxOutputTokens,
      dataPolicyStatus: item.dataPolicyStatus as
        | "unreviewed"
        | "approved"
        | "rejected",
      rationale: item.rationale,
      createdAt: item.createdAt,
      latestEvaluation,
    });
  }
  return {
    workspace: { id: workspace.id, displayName: workspace.displayName },
    activationControlsAvailable: false,
    runtimeRoutes,
    budget,
    proposals,
  };
}
