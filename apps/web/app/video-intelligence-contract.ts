export type VideoProgramId = "product_faq_ads" | "daily_news_flash";
export type VideoWorkflowStage =
  | "signals"
  | "brief"
  | "script"
  | "render"
  | "review"
  | "distribution";
export type VideoBriefStatus =
  | "draft"
  | "review_required"
  | "approved"
  | "rejected";
export type VideoEvidenceKind =
  | "aggregate_audience_signal"
  | "verified_product_fact"
  | "approved_editorial_story";
export type VideoAspectRatio = "9:16" | "16:9";
export type VideoTargetLanguage = "en" | "de" | "sq";

export interface VideoBriefView {
  readonly id: string;
  readonly programId: VideoProgramId;
  readonly topic: string;
  readonly objective: string;
  readonly audience: string;
  readonly status: VideoBriefStatus;
  readonly currentRevision: number;
  readonly script: string;
  readonly scriptHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly evidence: readonly {
    readonly id: string;
    readonly kind: VideoEvidenceKind;
    readonly title: string;
    readonly sourceReference: string;
    readonly summary: string;
    readonly aggregateCount: number | null;
  }[];
  readonly approval: {
    readonly decision: "pending" | "approved" | "rejected";
    readonly requestedAt: string;
    readonly decidedAt: string | null;
    readonly reason: string | null;
    readonly requestedByCurrentUser: boolean;
  } | null;
  readonly renderPreparation: {
    readonly id: string;
    readonly presentationMode: "presenter_explainer" | "news_anchor";
    readonly targetLanguage: VideoTargetLanguage;
    readonly maxDurationSeconds: number;
    readonly rightsReference: string;
    readonly outputs: readonly VideoAspectRatio[];
    readonly status: "blocked";
    readonly blockCode: "provider_not_accepted";
    readonly requestedAt: string;
    readonly requestedByCurrentUser: boolean;
  } | null;
  readonly renderedAssets: readonly {
    readonly jobId: string;
    readonly mediaAssetId: string;
    readonly aspectRatio: VideoAspectRatio;
    readonly filename: string;
    readonly mimeType: "video/mp4";
    readonly sizeBytes: number;
    readonly checksumSha256: string;
    readonly width: number;
    readonly height: number;
    readonly durationMs: number;
    readonly completedAt: string;
    readonly review: {
      readonly decision: "pending" | "approved" | "rejected";
      readonly requestedAt: string;
      readonly decidedAt: string | null;
      readonly reason: string | null;
      readonly requestedByCurrentUser: boolean;
    };
    readonly distributionDraft: {
      readonly id: string;
      readonly status: string;
      readonly createdAt: string;
    } | null;
    readonly websiteContent: {
      readonly id: string;
      readonly status: "draft" | "active" | "archived";
      readonly createdAt: string;
    } | null;
  }[];
}

export interface VideoIntelligenceSnapshot {
  readonly workspace: { readonly id: string; readonly displayName: string };
  readonly package: {
    readonly id: string;
    readonly displayName: string;
    readonly planningIncluded: true;
    readonly generationAddOn: "not_configured";
  };
  readonly safety: {
    readonly externalProviderExecutionAvailable: false;
    readonly automaticPublishingAvailable: false;
    readonly privateMessageContentSentToModels: false;
    readonly humanApprovalRequired: true;
  };
  readonly programs: readonly {
    readonly id: VideoProgramId;
    readonly sourceMode: "audience_signals" | "approved_editorial_content";
    readonly cadence: "weekly" | "daily_evening";
    readonly outputs: readonly ("portrait" | "landscape")[];
    readonly status: "foundation_only";
  }[];
  readonly workflow: readonly {
    readonly stage: VideoWorkflowStage;
    readonly status: "available" | "blocked";
  }[];
  readonly integrations: readonly {
    readonly id: "audience_listening" | "heygen" | "distribution";
    readonly status: "not_connected";
  }[];
  readonly distributionTargets: readonly {
    readonly accountId: string;
    readonly channel: "facebook" | "instagram" | "youtube" | "tiktok";
    readonly displayName: string;
    readonly status:
      | "pending"
      | "active"
      | "degraded"
      | "reauthorization_required"
      | "disabled"
      | "revoked";
    readonly draftEligible: boolean;
  }[];
  readonly briefs: readonly VideoBriefView[];
}

export interface VideoGenerationPolicyView {
  readonly providerId: "heygen";
  readonly dailyCreditLimit: number;
  readonly monthlyCreditLimit: number;
  readonly maximumConcurrency: number;
  readonly billingTimezone: "UTC";
  readonly enabled: boolean;
  readonly dailyReserved: number;
  readonly monthlyReserved: number;
  readonly activeJobs: number;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
const bounded = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;
const date = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
const HASH = /^[0-9a-f]{64}$/;
const programIds = ["product_faq_ads", "daily_news_flash"];
const briefStatuses = ["draft", "review_required", "approved", "rejected"];
const evidenceKinds = [
  "aggregate_audience_signal",
  "verified_product_fact",
  "approved_editorial_story",
];

const validBrief = (value: unknown): boolean => {
  const brief = record(value);
  if (
    !brief ||
    !bounded(brief.id, 36) ||
    !UUID.test(brief.id) ||
    !programIds.includes(String(brief.programId)) ||
    !bounded(brief.topic, 240) ||
    !bounded(brief.objective, 2000) ||
    !bounded(brief.audience, 500) ||
    !briefStatuses.includes(String(brief.status)) ||
    !Number.isInteger(brief.currentRevision) ||
    Number(brief.currentRevision) < 1 ||
    !bounded(brief.script, 20_000) ||
    typeof brief.scriptHash !== "string" ||
    !HASH.test(brief.scriptHash) ||
    !date(brief.createdAt) ||
    !date(brief.updatedAt) ||
    !Array.isArray(brief.evidence) ||
    brief.evidence.length < 1 ||
    brief.evidence.length > 12
  )
    return false;
  if (
    brief.evidence.some((entry) => {
      const evidence = record(entry);
      return (
        !evidence ||
        !bounded(evidence.id, 36) ||
        !UUID.test(evidence.id) ||
        !evidenceKinds.includes(String(evidence.kind)) ||
        !bounded(evidence.title, 240) ||
        !bounded(evidence.sourceReference, 500) ||
        !bounded(evidence.summary, 2000) ||
        (evidence.kind === "aggregate_audience_signal"
          ? !Number.isInteger(evidence.aggregateCount) ||
            Number(evidence.aggregateCount) < 2 ||
            Number(evidence.aggregateCount) > 1_000_000
          : evidence.aggregateCount !== null)
      );
    })
  )
    return false;
  const evidenceKindsInBrief = new Set(
    brief.evidence.map((entry) => record(entry)?.kind),
  );
  if (
    (brief.programId === "product_faq_ads" &&
      (!evidenceKindsInBrief.has("aggregate_audience_signal") ||
        !evidenceKindsInBrief.has("verified_product_fact") ||
        evidenceKindsInBrief.has("approved_editorial_story"))) ||
    (brief.programId === "daily_news_flash" &&
      (evidenceKindsInBrief.size !== 1 ||
        !evidenceKindsInBrief.has("approved_editorial_story")))
  )
    return false;
  const approval = record(brief.approval);
  if (brief.approval === null) {
    if (brief.status !== "draft") return false;
  } else {
    if (
      !approval ||
      !["pending", "approved", "rejected"].includes(
        String(approval.decision),
      ) ||
      !date(approval.requestedAt) ||
      (approval.decidedAt !== null && !date(approval.decidedAt)) ||
      (approval.reason !== null &&
        (typeof approval.reason !== "string" ||
          approval.reason.trim().length < 10 ||
          approval.reason.length > 500)) ||
      typeof approval.requestedByCurrentUser !== "boolean"
    )
      return false;
    const pending = approval.decision === "pending";
    const rejected = approval.decision === "rejected";
    if (
      !(pending ? approval.decidedAt === null : approval.decidedAt !== null) ||
      !(rejected ? approval.reason !== null : approval.reason === null) ||
      !(
        (brief.status === "review_required" &&
          approval.decision === "pending") ||
        brief.status === approval.decision
      )
    )
      return false;
  }
  if (!Array.isArray(brief.renderedAssets) || brief.renderedAssets.length > 2)
    return false;
  if (brief.renderPreparation === null)
    return brief.renderedAssets.length === 0;
  const preparation = record(brief.renderPreparation);
  if (
    !preparation ||
    brief.status !== "approved" ||
    approval?.decision !== "approved" ||
    !bounded(preparation.id, 36) ||
    !UUID.test(preparation.id) ||
    preparation.presentationMode !==
      (brief.programId === "product_faq_ads"
        ? "presenter_explainer"
        : "news_anchor") ||
    !["en", "de", "sq"].includes(String(preparation.targetLanguage)) ||
    !Number.isInteger(preparation.maxDurationSeconds) ||
    Number(preparation.maxDurationSeconds) <
      (brief.programId === "product_faq_ads" ? 15 : 30) ||
    Number(preparation.maxDurationSeconds) >
      (brief.programId === "product_faq_ads" ? 90 : 180) ||
    !bounded(preparation.rightsReference, 500) ||
    String(preparation.rightsReference).trim().length < 3 ||
    preparation.status !== "blocked" ||
    preparation.blockCode !== "provider_not_accepted" ||
    !date(preparation.requestedAt) ||
    typeof preparation.requestedByCurrentUser !== "boolean" ||
    !Array.isArray(preparation.outputs) ||
    preparation.outputs.length < 1 ||
    preparation.outputs.length > 2 ||
    new Set(preparation.outputs).size !== preparation.outputs.length ||
    preparation.outputs.some(
      (output) => !["9:16", "16:9"].includes(String(output)),
    )
  )
    return false;
  return !brief.renderedAssets.some((entry) => {
    const asset = record(entry);
    const review = record(asset?.review);
    const distributionDraft = record(asset?.distributionDraft);
    const websiteContent = record(asset?.websiteContent);
    if (
      !asset ||
      !UUID.test(String(asset.jobId)) ||
      !UUID.test(String(asset.mediaAssetId)) ||
      !["9:16", "16:9"].includes(String(asset.aspectRatio)) ||
      !bounded(asset.filename, 500) ||
      asset.mimeType !== "video/mp4" ||
      !Number.isInteger(asset.sizeBytes) ||
      Number(asset.sizeBytes) <= 0 ||
      typeof asset.checksumSha256 !== "string" ||
      !HASH.test(asset.checksumSha256) ||
      !Number.isInteger(asset.width) ||
      Number(asset.width) <= 0 ||
      !Number.isInteger(asset.height) ||
      Number(asset.height) <= 0 ||
      !Number.isInteger(asset.durationMs) ||
      Number(asset.durationMs) <= 0 ||
      !date(asset.completedAt) ||
      !review ||
      !["pending", "approved", "rejected"].includes(String(review.decision)) ||
      !date(review.requestedAt) ||
      (review.decidedAt !== null && !date(review.decidedAt)) ||
      typeof review.requestedByCurrentUser !== "boolean"
    )
      return true;
    if (
      asset.distributionDraft !== null &&
      (!distributionDraft ||
        !UUID.test(String(distributionDraft.id)) ||
        !bounded(distributionDraft.status, 40) ||
        !date(distributionDraft.createdAt) ||
        review.decision !== "approved")
    )
      return true;
    if (
      asset.websiteContent !== null &&
      (!websiteContent ||
        !UUID.test(String(websiteContent.id)) ||
        !["draft", "active", "archived"].includes(
          String(websiteContent.status),
        ) ||
        !date(websiteContent.createdAt) ||
        review.decision !== "approved")
    )
      return true;
    const pending = review.decision === "pending";
    const rejected = review.decision === "rejected";
    return (
      (pending ? review.decidedAt !== null : review.decidedAt === null) ||
      (rejected
        ? typeof review.reason !== "string" ||
          review.reason.trim().length < 10 ||
          review.reason.length > 500
        : review.reason !== null)
    );
  });
};

export function parseVideoIntelligenceSnapshot(
  value: unknown,
): VideoIntelligenceSnapshot | null {
  const envelope = record(value);
  const workspace = record(envelope?.workspace);
  const packagePolicy = record(envelope?.package);
  const safety = record(envelope?.safety);
  if (
    !envelope ||
    !workspace ||
    !bounded(workspace.id, 36) ||
    !UUID.test(workspace.id) ||
    !bounded(workspace.displayName, 160) ||
    !packagePolicy ||
    !bounded(packagePolicy.id, 80) ||
    !bounded(packagePolicy.displayName, 120) ||
    packagePolicy.planningIncluded !== true ||
    packagePolicy.generationAddOn !== "not_configured" ||
    !safety ||
    safety.externalProviderExecutionAvailable !== false ||
    safety.automaticPublishingAvailable !== false ||
    safety.privateMessageContentSentToModels !== false ||
    safety.humanApprovalRequired !== true ||
    !Array.isArray(envelope.programs) ||
    envelope.programs.length !== 2 ||
    !Array.isArray(envelope.workflow) ||
    envelope.workflow.length !== 6 ||
    !Array.isArray(envelope.integrations) ||
    envelope.integrations.length !== 3 ||
    !Array.isArray(envelope.distributionTargets) ||
    envelope.distributionTargets.length > 100 ||
    !Array.isArray(envelope.briefs) ||
    envelope.briefs.length > 100 ||
    envelope.briefs.some((brief) => !validBrief(brief))
  )
    return null;

  const programs = envelope.programs.map(record);
  const expectedPrograms = new Map([
    ["product_faq_ads", ["audience_signals", "weekly"]],
    ["daily_news_flash", ["approved_editorial_content", "daily_evening"]],
  ]);
  if (
    programs.some((program) => {
      if (!program || !expectedPrograms.has(String(program.id))) return true;
      const expected = expectedPrograms.get(String(program.id));
      return (
        program.sourceMode !== expected?.[0] ||
        program.cadence !== expected?.[1] ||
        program.status !== "foundation_only" ||
        !Array.isArray(program.outputs) ||
        program.outputs.length !== 2 ||
        program.outputs[0] !== "portrait" ||
        program.outputs[1] !== "landscape"
      );
    }) ||
    new Set(programs.map((program) => program?.id)).size !== 2
  )
    return null;

  const workflow = envelope.workflow.map(record);
  const stages: VideoWorkflowStage[] = [
    "signals",
    "brief",
    "script",
    "render",
    "review",
    "distribution",
  ];
  if (
    workflow.some(
      (item, index) =>
        !item ||
        item.stage !== stages[index] ||
        item.status !==
          (item.stage === "render" || item.stage === "distribution"
            ? "blocked"
            : "available"),
    )
  )
    return null;

  const integrations = envelope.integrations.map(record);
  const integrationIds = ["audience_listening", "heygen", "distribution"];
  if (
    integrations.some(
      (item, index) =>
        !item ||
        item.id !== integrationIds[index] ||
        item.status !== "not_connected",
    )
  )
    return null;

  const targetStatuses = [
    "pending",
    "active",
    "degraded",
    "reauthorization_required",
    "disabled",
    "revoked",
  ];
  if (
    envelope.distributionTargets.some((entry) => {
      const target = record(entry);
      return (
        !target ||
        !UUID.test(String(target.accountId)) ||
        !["facebook", "instagram", "youtube", "tiktok"].includes(
          String(target.channel),
        ) ||
        !bounded(target.displayName, 160) ||
        !targetStatuses.includes(String(target.status)) ||
        typeof target.draftEligible !== "boolean" ||
        target.draftEligible !==
          ["active", "degraded", "reauthorization_required"].includes(
            String(target.status),
          )
      );
    }) ||
    new Set(
      envelope.distributionTargets.map((entry) => record(entry)?.accountId),
    ).size !== envelope.distributionTargets.length
  )
    return null;

  return value as VideoIntelligenceSnapshot;
}

export function parseVideoGenerationPolicyEnvelope(
  value: unknown,
): { readonly policy: VideoGenerationPolicyView | null } | null {
  const envelope = record(value);
  if (
    !envelope ||
    Object.keys(envelope).length !== 1 ||
    !("policy" in envelope)
  )
    return null;
  if (envelope.policy === null) return { policy: null };
  const policy = record(envelope.policy);
  const policyKeys = [
    "providerId",
    "dailyCreditLimit",
    "monthlyCreditLimit",
    "maximumConcurrency",
    "billingTimezone",
    "enabled",
    "dailyReserved",
    "monthlyReserved",
    "activeJobs",
  ];
  if (
    !policy ||
    Object.keys(policy).length !== policyKeys.length ||
    Object.keys(policy).some((key) => !policyKeys.includes(key)) ||
    policy.providerId !== "heygen" ||
    !Number.isInteger(policy.dailyCreditLimit) ||
    Number(policy.dailyCreditLimit) < 0 ||
    Number(policy.dailyCreditLimit) > 1_000_000 ||
    !Number.isInteger(policy.monthlyCreditLimit) ||
    Number(policy.monthlyCreditLimit) < Number(policy.dailyCreditLimit) ||
    Number(policy.monthlyCreditLimit) > 10_000_000 ||
    !Number.isInteger(policy.maximumConcurrency) ||
    Number(policy.maximumConcurrency) < 1 ||
    Number(policy.maximumConcurrency) > 20 ||
    policy.billingTimezone !== "UTC" ||
    typeof policy.enabled !== "boolean" ||
    !Number.isInteger(policy.dailyReserved) ||
    Number(policy.dailyReserved) < 0 ||
    !Number.isInteger(policy.monthlyReserved) ||
    Number(policy.monthlyReserved) < 0 ||
    Number(policy.monthlyReserved) < Number(policy.dailyReserved) ||
    !Number.isInteger(policy.activeJobs) ||
    Number(policy.activeJobs) < 0
  )
    return null;
  return value as { readonly policy: VideoGenerationPolicyView };
}
