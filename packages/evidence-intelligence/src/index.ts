import { createHash, randomUUID } from "node:crypto";
import {
  accountingFromAiError,
  type AiGateway,
  type AiOperation,
  type AiRoute,
} from "@redi-control/ai-gateway";
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";
import { UnifiedContentService } from "@redi-control/unified-content";
import { z } from "zod";

const importance = z.enum(["low", "medium", "high", "critical"]);
const verification = z.enum([
  "verified",
  "partially_verified",
  "developing",
  "unverified",
  "conflicting",
  "stale",
]);
const relationship = z.enum([
  "supports",
  "contradicts",
  "mentions",
  "primary_evidence",
]);
export const extractionSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            statement: z.string().min(1).max(4000),
            importance,
            explanation: z.string().min(1).max(4000),
            uncertainty: z.string().max(4000).default(""),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const comparisonSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            claimProposalId: z.string().uuid(),
            verificationState: verification,
            explanation: z.string().min(1).max(4000),
            uncertainty: z.string().max(4000).default(""),
            evidence: z
              .array(
                z
                  .object({
                    sourceId: z.string().uuid(),
                    relationship,
                    notes: z.string().max(2000).default(""),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const synthesisSchema = z
  .object({
    headline: z.string().min(1).max(240),
    summary: z.string().min(1).max(2000),
    body: z.string().min(1).max(50000),
    keyPoints: z.array(z.string().min(1).max(1000)).max(30),
    category: z.string().max(120),
    tags: z.array(z.string().min(1).max(80)).max(30),
    provenanceReferences: z
      .array(
        z
          .object({
            claimId: z.string().uuid(),
            sourceIds: z.array(z.string().uuid()).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    uncertainty: z
      .array(
        z
          .object({
            claimId: z.string().uuid(),
            state: verification,
            note: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const validationSchema = z
  .object({
    statements: z
      .array(
        z
          .object({
            text: z.string().min(1).max(4000),
            assessment: z.enum([
              "supported",
              "partially_supported",
              "unsupported",
              "conflicting",
            ]),
            material: z.boolean(),
            claimIds: z.array(z.string().uuid()).max(50),
            evidenceSourceIds: z.array(z.string().uuid()).max(50),
            explanation: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();

const identifierSchema = (values: readonly string[]) => {
  if (!values.length) throw fail("AI_REFERENCE_SET_EMPTY", 409);
  return z.enum(values as [string, ...string[]]);
};
const boundedReferences = (
  claimIds: readonly string[],
  sourceIds: readonly string[],
) =>
  z
    .array(
      z
        .object({
          claimId: identifierSchema(claimIds),
          sourceIds: z.array(identifierSchema(sourceIds)).min(1).max(30),
        })
        .strict(),
    )
    .min(1)
    .max(200);
const boundedSynthesisSchema = (
  claimIds: readonly string[],
  sourceIds: readonly string[],
) =>
  synthesisSchema.extend({
    provenanceReferences: boundedReferences(claimIds, sourceIds),
    uncertainty: z
      .array(
        z
          .object({
            claimId: identifierSchema(claimIds),
            state: verification,
            note: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(100),
  });
const boundedValidationSchema = (
  claimIds: readonly string[],
  sourceIds: readonly string[],
) =>
  validationSchema.extend({
    statements: z
      .array(
        z
          .object({
            text: z.string().min(1).max(4000),
            assessment: z.enum([
              "supported",
              "partially_supported",
              "unsupported",
              "conflicting",
            ]),
            material: z.boolean(),
            claimIds: z.array(identifierSchema(claimIds)).max(50),
            evidenceSourceIds: z.array(identifierSchema(sourceIds)).max(50),
            explanation: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  });

export const editorialDraftSchema = z
  .object({
    headline: z.string().min(1).max(240),
    essence: z.string().min(1).max(2000),
    articleBody: z.string().min(1).max(50000),
    keyPoints: z.array(z.string().min(1).max(1000)).max(30),
    category: z.string().min(1).max(160),
    tags: z.array(z.string().min(1).max(80)).max(30),
    facebookCaption: z.string().max(5000),
    instagramCaption: z.string().max(5000),
    hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]{1,80}$/u)).max(30),
    visualCard: z
      .object({
        headline: z.string().min(1).max(160),
        supportingFacts: z.array(z.string().min(1).max(240)).max(6),
        sourceAttribution: z.string().min(1).max(500),
        generatedImage: z.boolean(),
        documentaryImage: z.boolean(),
      })
      .strict(),
    verificationLabel: z.enum([
      "verified",
      "developing",
      "partially_verified",
      "unverified",
      "conflicting",
      "stale",
    ]),
    uncertaintyNotice: z.string().max(2000),
    provenanceReferences: z
      .array(
        z
          .object({
            claimId: z.string().uuid(),
            sourceIds: z.array(z.string().uuid()).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

const boundedEditorialDraftSchema = (
  claimIds: readonly string[],
  sourceIds: readonly string[],
  categories: readonly string[],
) =>
  editorialDraftSchema.extend({
    provenanceReferences: boundedReferences(claimIds, sourceIds),
    category: identifierSchema(categories),
  });

type EditorialPolicyConfig = {
  sections: { name: string; enabled: boolean; satire: boolean }[];
  style: {
    headlineMaxCharacters: number;
    languageQuality?: {
      targetLocale: string;
      forbidInternalIdentifiers: true;
      namedEntityPolicy: "preserve_source_spelling";
      forbiddenTerms: string[];
      glossary: {
        sourceTerm: string;
        preferredTerm: string;
        forbiddenAlternatives: string[];
      }[];
      editorialExamples: string[];
    };
  };
  freshness: {
    freshHours: number;
    staleHours: number;
    discloseStale: boolean;
  };
  visual: {
    cardHeadlineMaxCharacters: number;
    supportingFactsMax: number;
    requireSourceAttribution: boolean;
  };
};

const readerFacingText = (draft: z.infer<typeof editorialDraftSchema>) =>
  [
    draft.headline,
    draft.essence,
    draft.articleBody,
    ...draft.keyPoints,
    ...draft.tags,
    draft.facebookCaption,
    draft.instagramCaption,
    ...draft.hashtags,
    draft.visualCard.headline,
    ...draft.visualCard.supportingFacts,
    draft.visualCard.sourceAttribution,
    draft.uncertaintyNotice,
  ].join("\n");

function evaluateEditorialPolicy(
  draft: z.infer<typeof editorialDraftSchema>,
  evidencePack: Record<string, unknown>,
  config: EditorialPolicyConfig,
) {
  const claims = (evidencePack.claims ?? []) as Record<string, unknown>[],
    sources = (evidencePack.sources ?? []) as Record<string, unknown>[];
  const states = claims.map((value) => String(value.verification_state));
  const verificationState = states.includes("conflicting")
    ? "conflicting"
    : states.includes("unverified")
      ? "unverified"
      : states.includes("stale")
        ? "stale"
        : states.includes("developing")
          ? "developing"
          : states.includes("partially_verified")
            ? "partially_verified"
            : "verified";
  const newest = Math.max(
    ...sources
      .map((value) => {
        const raw = value.publication_at ?? value.retrieved_at;
        return raw instanceof Date || typeof raw === "string"
          ? new Date(raw).getTime()
          : 0;
      })
      .filter(Number.isFinite),
    0,
  );
  const ageHours = newest
    ? (Date.now() - newest) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const freshnessState = !newest
    ? "unknown"
    : ageHours >= config.freshness.staleHours
      ? "stale"
      : ageHours >= config.freshness.freshHours
        ? "aging"
        : "fresh";
  const policyViolations: string[] = [];
  if (draft.headline.length > config.style.headlineMaxCharacters)
    policyViolations.push("HEADLINE_TOO_LONG");
  const section = config.sections.find(
    (value) => value.name === draft.category && value.enabled,
  );
  if (!section || section.satire) policyViolations.push("SECTION_NOT_ALLOWED");
  if (
    verificationState !== "verified" &&
    draft.verificationLabel === "verified"
  )
    policyViolations.push("VERIFICATION_OVERCLAIM");
  if (
    (verificationState !== "verified" || freshnessState === "stale") &&
    !draft.uncertaintyNotice.trim()
  )
    policyViolations.push("UNCERTAINTY_DISCLOSURE_REQUIRED");
  if (
    draft.visualCard.headline.length >
      config.visual.cardHeadlineMaxCharacters ||
    draft.visualCard.supportingFacts.length > config.visual.supportingFactsMax
  )
    policyViolations.push("VISUAL_POLICY_VIOLATION");
  if (
    config.visual.requireSourceAttribution &&
    !draft.visualCard.sourceAttribution.trim()
  )
    policyViolations.push("SOURCE_ATTRIBUTION_REQUIRED");
  if (draft.visualCard.generatedImage && draft.visualCard.documentaryImage)
    policyViolations.push("GENERATED_DOCUMENTARY_IMAGE_FORBIDDEN");
  const claimIds = new Set(claims.map((value) => String(value.id))),
    sourceIds = new Set(sources.map((value) => String(value.id)));
  for (const reference of draft.provenanceReferences)
    if (
      !claimIds.has(reference.claimId) ||
      reference.sourceIds.some((id) => !sourceIds.has(id))
    )
      policyViolations.push("PROVENANCE_OUTSIDE_EVIDENCE_PACK");

  const quality = config.style.languageQuality;
  if (quality) {
    const text = readerFacingText(draft);
    if (
      quality.forbidInternalIdentifiers &&
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(
        text,
      )
    )
      policyViolations.push("LANGUAGE_INTERNAL_IDENTIFIER");
    const normalized = text.toLocaleLowerCase(quality.targetLocale);
    const forbidden = [
      ...quality.forbiddenTerms,
      ...quality.glossary.flatMap((entry) => entry.forbiddenAlternatives),
    ];
    if (
      forbidden.some((term) =>
        normalized.includes(term.toLocaleLowerCase(quality.targetLocale)),
      )
    )
      policyViolations.push("LANGUAGE_FORBIDDEN_TERMINOLOGY");
  }
  return {
    policyViolations: [...new Set(policyViolations)],
    verificationState,
    freshnessState,
    claimIds,
    sourceIds,
  };
}

const fail = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mapped = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

async function audit(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events(id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.correlationId,
      input.metadata ?? {},
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id) VALUES($1,$2,$3,1,$4,$5)`,
    [
      randomUUID(),
      input.tenantId,
      input.action,
      { auditEventId: id, targetId: input.targetId },
      input.correlationId,
    ],
  );
}

interface CaseContext {
  case: Record<string, unknown>;
  sources: Record<string, unknown>[];
  claims?: Record<string, unknown>[];
}
interface RunContext {
  id: string;
  route: AiRoute;
  requestHash: string;
  context: unknown;
  cached: boolean;
  cachedResult?: unknown;
}

export class EvidenceIntelligenceService {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly gateway: AiGateway,
    private readonly unified = new UnifiedContentService(pool),
  ) {}

  private async assertAvailable(
    client: DatabaseClient,
    tenantId: string,
    workspaceId: string,
  ) {
    const result = await client.query(
      `SELECT 1 FROM control.business_workspaces w JOIN control.installation_entitlements e ON e.tenant_id=w.tenant_id AND e.installation_id=w.installation_id JOIN control.feature_flags f ON f.tenant_id=w.tenant_id AND f.name='module.ai' AND f.enabled WHERE w.tenant_id=$1 AND w.id=$2 AND 'ai'=ANY(e.enabled_modules) AND e.effective_from<=now() AND (e.effective_until IS NULL OR e.effective_until>now())`,
      [tenantId, workspaceId],
    );
    if (result.rowCount !== 1) throw fail("AI_NOT_ENTITLED", 403);
  }

  public async configure(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    routes: {
      operation: AiOperation;
      providerId: string;
      model: string;
      promptVersion: string;
      maxOutputTokens: number;
    }[];
    dailyCostLimit: number;
    monthlyCostLimit: number;
    maximumConcurrency: number;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      for (const route of input.routes)
        await c.query(
          `INSERT INTO control.ai_model_routes(id,tenant_id,workspace_id,operation,provider_id,model,prompt_version,max_output_tokens,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,workspace_id,operation) DO UPDATE SET provider_id=EXCLUDED.provider_id,model=EXCLUDED.model,prompt_version=EXCLUDED.prompt_version,max_output_tokens=EXCLUDED.max_output_tokens,enabled=true,updated_at=now()`,
          [
            randomUUID(),
            input.tenantId,
            input.workspaceId,
            route.operation,
            route.providerId,
            route.model,
            route.promptVersion,
            route.maxOutputTokens,
            input.actorUserId,
          ],
        );
      await c.query(
        `INSERT INTO control.ai_budget_policies(id,tenant_id,workspace_id,daily_cost_limit,monthly_cost_limit,maximum_concurrency,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,workspace_id) DO UPDATE SET daily_cost_limit=EXCLUDED.daily_cost_limit,monthly_cost_limit=EXCLUDED.monthly_cost_limit,maximum_concurrency=EXCLUDED.maximum_concurrency,enabled=true,updated_at=now()`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          input.dailyCostLimit,
          input.monthlyCostLimit,
          input.maximumConcurrency,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "ai.configuration_updated",
        targetType: "workspace",
        targetId: input.workspaceId,
        metadata: { operations: input.routes.map((r) => r.operation) },
      });
      return { configured: true };
    });
  }

  public async getModelStudio(input: {
    tenantId: string;
    workspaceId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const workspace = await c.query<{ id: string; name: string }>(
        `SELECT id,name FROM control.business_workspaces WHERE id=$1`,
        [input.workspaceId],
      );
      const routes = await c.query<{
        operation: string;
        provider_id: string;
        model: string;
        prompt_version: string;
        max_output_tokens: number;
        enabled: boolean;
      }>(
        `SELECT operation,provider_id,model,prompt_version,max_output_tokens,enabled
           FROM control.ai_model_routes
           WHERE workspace_id=$1 ORDER BY operation`,
        [input.workspaceId],
      );
      const budget = await c.query<{
        daily_cost_limit: string;
        monthly_cost_limit: string;
        maximum_concurrency: number;
        enabled: boolean;
      }>(
        `SELECT daily_cost_limit::text,monthly_cost_limit::text,
             maximum_concurrency,enabled
           FROM control.ai_budget_policies WHERE workspace_id=$1`,
        [input.workspaceId],
      );
      const usage = await c.query<{
        daily_used: string;
        monthly_used: string;
        running: number;
      }>(
        `SELECT
             coalesce(sum(coalesce(actual_cost,estimated_cost)) FILTER (
               WHERE created_at>=date_trunc('day',now())
             ),0)::text AS daily_used,
             coalesce(sum(coalesce(actual_cost,estimated_cost)) FILTER (
               WHERE created_at>=date_trunc('month',now())
             ),0)::text AS monthly_used,
             (SELECT count(*)::int FROM control.ai_runs
              WHERE workspace_id=$1 AND status='running') AS running
           FROM control.ai_usage_events WHERE workspace_id=$1`,
        [input.workspaceId],
      );
      const proposals = await c.query<{
        id: string;
        operation: string;
        provider_id: string;
        model: string;
        prompt_version: string;
        max_output_tokens: number;
        data_policy_status: string;
        rationale: string;
        created_at: Date;
        evaluation_id: string | null;
        dataset_version: string | null;
        sample_size: number | null;
        schema_pass_rate: string | null;
        grounding_pass_rate: string | null;
        safety_pass_rate: string | null;
        language_pass_rate: string | null;
        evaluation_decision: string | null;
        evaluation_notes: string | null;
        evaluated_at: Date | null;
      }>(
        `SELECT proposal.id,proposal.operation,proposal.provider_id,
             proposal.model,proposal.prompt_version,proposal.max_output_tokens,
             proposal.data_policy_status,proposal.rationale,proposal.created_at,
             evaluation.id AS evaluation_id,evaluation.dataset_version,
             evaluation.sample_size,evaluation.schema_pass_rate::text,
             evaluation.grounding_pass_rate::text,
             evaluation.safety_pass_rate::text,
             evaluation.language_pass_rate::text,
             evaluation.decision AS evaluation_decision,
             evaluation.notes AS evaluation_notes,evaluation.evaluated_at
           FROM control.ai_route_proposals proposal
           LEFT JOIN LATERAL (
             SELECT candidate.* FROM control.ai_route_evaluations candidate
             WHERE candidate.proposal_id=proposal.id
             ORDER BY candidate.evaluated_at DESC,candidate.id DESC LIMIT 1
           ) evaluation ON true
           WHERE proposal.workspace_id=$1
           ORDER BY proposal.created_at DESC,proposal.id DESC LIMIT 50`,
        [input.workspaceId],
      );
      const current = workspace.rows[0];
      if (!current) throw fail("WORKSPACE_NOT_FOUND", 404);
      const policy = budget.rows[0];
      const consumed = usage.rows[0];
      return {
        workspace: { id: current.id, displayName: current.name },
        activationControlsAvailable: false as const,
        runtimeRoutes: routes.rows.map((route) => ({
          operation: route.operation,
          providerId: route.provider_id,
          model: route.model,
          promptVersion: route.prompt_version,
          maxOutputTokens: route.max_output_tokens,
          enabled: route.enabled,
        })),
        budget: policy
          ? {
              dailyCostLimit: Number(policy.daily_cost_limit),
              monthlyCostLimit: Number(policy.monthly_cost_limit),
              maximumConcurrency: policy.maximum_concurrency,
              enabled: policy.enabled,
              dailyUsed: Number(consumed?.daily_used ?? 0),
              monthlyUsed: Number(consumed?.monthly_used ?? 0),
              running: consumed?.running ?? 0,
            }
          : null,
        proposals: proposals.rows.map((proposal) => ({
          id: proposal.id,
          operation: proposal.operation,
          providerId: proposal.provider_id,
          model: proposal.model,
          promptVersion: proposal.prompt_version,
          maxOutputTokens: proposal.max_output_tokens,
          dataPolicyStatus: proposal.data_policy_status,
          rationale: proposal.rationale,
          createdAt: proposal.created_at.toISOString(),
          latestEvaluation: proposal.evaluation_id
            ? {
                id: proposal.evaluation_id,
                datasetVersion: proposal.dataset_version!,
                sampleSize: proposal.sample_size!,
                schemaPassRate: Number(proposal.schema_pass_rate),
                groundingPassRate: Number(proposal.grounding_pass_rate),
                safetyPassRate: Number(proposal.safety_pass_rate),
                languagePassRate: Number(proposal.language_pass_rate),
                decision: proposal.evaluation_decision!,
                notes: proposal.evaluation_notes ?? "",
                evaluatedAt: proposal.evaluated_at!.toISOString(),
              }
            : null,
        })),
      };
    });
  }

  public async updateModelBudget(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    dailyCostLimit: number;
    monthlyCostLimit: number;
    maximumConcurrency: number;
    correlationId: string;
  }) {
    if (input.monthlyCostLimit < input.dailyCostLimit)
      throw fail("MONTHLY_BUDGET_BELOW_DAILY_BUDGET", 400);
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const result = await c.query(
        `INSERT INTO control.ai_budget_policies
         (id,tenant_id,workspace_id,daily_cost_limit,monthly_cost_limit,
          maximum_concurrency,enabled,created_by)
         VALUES($1,$2,$3,$4,$5,$6,true,$7)
         ON CONFLICT(tenant_id,workspace_id) DO UPDATE SET
           daily_cost_limit=EXCLUDED.daily_cost_limit,
           monthly_cost_limit=EXCLUDED.monthly_cost_limit,
           maximum_concurrency=EXCLUDED.maximum_concurrency,
           updated_at=now()
         RETURNING daily_cost_limit::text,monthly_cost_limit::text,
           maximum_concurrency,enabled`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          input.dailyCostLimit,
          input.monthlyCostLimit,
          input.maximumConcurrency,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "ai.budget_updated",
        targetType: "workspace",
        targetId: input.workspaceId,
        metadata: {
          dailyCostLimit: input.dailyCostLimit,
          monthlyCostLimit: input.monthlyCostLimit,
          maximumConcurrency: input.maximumConcurrency,
        },
      });
      return mapped(result.rows[0] as Record<string, unknown>);
    });
  }

  public async proposeModelRoute(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    operation:
      | AiOperation
      | "editorial_image_generation"
      | "channel_adaptation";
    providerId: string;
    model: string;
    promptVersion: string;
    maxOutputTokens: number;
    dataPolicyStatus: "unreviewed" | "approved" | "rejected";
    rationale: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const id = randomUUID();
      const result = await c.query(
        `INSERT INTO control.ai_route_proposals
         (id,tenant_id,workspace_id,operation,provider_id,model,prompt_version,
          max_output_tokens,data_policy_status,rationale,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.operation,
          input.providerId.trim(),
          input.model.trim(),
          input.promptVersion.trim(),
          input.maxOutputTokens,
          input.dataPolicyStatus,
          input.rationale.trim(),
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "ai.route_proposed",
        targetType: "ai_route_proposal",
        targetId: id,
        metadata: {
          workspaceId: input.workspaceId,
          operation: input.operation,
          dataPolicyStatus: input.dataPolicyStatus,
        },
      });
      return mapped(result.rows[0] as Record<string, unknown>);
    });
  }

  public async recordModelEvaluation(input: {
    tenantId: string;
    workspaceId: string;
    proposalId: string;
    actorUserId: string;
    datasetVersion: string;
    sampleSize: number;
    schemaPassRate: number;
    groundingPassRate: number;
    safetyPassRate: number;
    languagePassRate: number;
    decision: "passed" | "failed";
    notes?: string;
    evaluatedAt: Date;
    correlationId: string;
  }) {
    if (input.evaluatedAt.getTime() > Date.now() + 5 * 60_000)
      throw fail("EVALUATION_DATE_IN_FUTURE", 400);
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const proposal = await c.query(
        `SELECT 1 FROM control.ai_route_proposals
         WHERE id=$1 AND workspace_id=$2`,
        [input.proposalId, input.workspaceId],
      );
      if (!proposal.rows[0]) throw fail("MODEL_ROUTE_PROPOSAL_NOT_FOUND", 404);
      const id = randomUUID();
      const result = await c.query(
        `INSERT INTO control.ai_route_evaluations
         (id,tenant_id,workspace_id,proposal_id,dataset_version,sample_size,
          schema_pass_rate,grounding_pass_rate,safety_pass_rate,
          language_pass_rate,decision,notes,evaluated_by,evaluated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.proposalId,
          input.datasetVersion.trim(),
          input.sampleSize,
          input.schemaPassRate,
          input.groundingPassRate,
          input.safetyPassRate,
          input.languagePassRate,
          input.decision,
          input.notes?.trim() ?? "",
          input.actorUserId,
          input.evaluatedAt,
        ],
      );
      await audit(c, {
        ...input,
        action: "ai.route_evaluation_recorded",
        targetType: "ai_route_evaluation",
        targetId: id,
        metadata: {
          workspaceId: input.workspaceId,
          proposalId: input.proposalId,
          datasetVersion: input.datasetVersion,
          sampleSize: input.sampleSize,
          decision: input.decision,
        },
      });
      return mapped(result.rows[0] as Record<string, unknown>);
    });
  }

  private async startRun(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    operation: AiOperation;
    idempotencyKey: string;
    correlationId: string;
    contextFactory: (c: DatabaseClient) => Promise<unknown>;
  }): Promise<RunContext> {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const caseRow = (
        await c.query(
          `SELECT * FROM control.research_cases WHERE id=$1 AND workspace_id=$2`,
          [input.caseId, input.workspaceId],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!caseRow) throw fail("RESEARCH_CASE_NOT_FOUND", 404);
      const route = (
        await c.query(
          `SELECT provider_id,model,prompt_version,max_output_tokens FROM control.ai_model_routes WHERE workspace_id=$1 AND operation=$2 AND enabled`,
          [input.workspaceId, input.operation],
        )
      ).rows[0] as
        | {
            provider_id: string;
            model: string;
            prompt_version: string;
            max_output_tokens: number;
          }
        | undefined;
      if (!route) throw fail("AI_ROUTE_NOT_CONFIGURED", 503);
      const budget = (
        await c.query(
          `SELECT daily_cost_limit,monthly_cost_limit,maximum_concurrency FROM control.ai_budget_policies WHERE workspace_id=$1 AND enabled FOR UPDATE`,
          [input.workspaceId],
        )
      ).rows[0] as
        | {
            daily_cost_limit: string;
            monthly_cost_limit: string;
            maximum_concurrency: number;
          }
        | undefined;
      if (!budget) throw fail("AI_BUDGET_NOT_CONFIGURED", 503);
      const usage = (
        await c.query(
          `SELECT COALESCE(sum(COALESCE(actual_cost,estimated_cost)),0)::text total FROM control.ai_usage_events WHERE workspace_id=$1 AND created_at>=date_trunc('day',now()) UNION ALL SELECT COALESCE(sum(COALESCE(actual_cost,estimated_cost)),0)::text FROM control.ai_usage_events WHERE workspace_id=$1 AND created_at>=date_trunc('month',now())`,
          [input.workspaceId],
        )
      ).rows as { total: string }[];
      if (
        Number(usage[0]?.total ?? 0) >= Number(budget.daily_cost_limit) ||
        Number(usage[1]?.total ?? 0) >= Number(budget.monthly_cost_limit)
      )
        throw fail("AI_BUDGET_EXCEEDED", 429);
      const running = await c.query(
        `SELECT 1 FROM control.ai_runs WHERE workspace_id=$1 AND status='running' LIMIT $2`,
        [input.workspaceId, budget.maximum_concurrency],
      );
      if ((running.rowCount ?? 0) >= budget.maximum_concurrency)
        throw fail("AI_CONCURRENCY_LIMIT", 429);
      const context = await input.contextFactory(c),
        requestHash = hash({ operation: input.operation, route, context });
      const reservation = this.gateway.estimateReservation({
        operation: input.operation,
        route: {
          providerId: route.provider_id,
          model: route.model,
          promptVersion: route.prompt_version,
          maxOutputTokens: route.max_output_tokens,
        },
        context,
        idempotencyKey: input.idempotencyKey,
      });
      const reserveUsage = (runId: string) =>
        c.query(
          `INSERT INTO control.ai_usage_events(id,tenant_id,workspace_id,research_case_id,ai_run_id,operation,provider_id,model,input_tokens,output_tokens,estimated_cost,actual_cost,accounting_status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,'reserved')
           ON CONFLICT(tenant_id,ai_run_id) DO UPDATE SET input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,estimated_cost=excluded.estimated_cost,actual_cost=NULL,accounting_status='reserved',provider_request_id=NULL,failure_code=NULL,created_at=now()`,
          [
            randomUUID(),
            input.tenantId,
            input.workspaceId,
            input.caseId,
            runId,
            input.operation,
            route.provider_id,
            route.model,
            reservation.inputTokens,
            reservation.outputTokens,
            reservation.estimatedCost ?? reservation.actualCost ?? 0,
          ],
        );
      const existing = (
        await c.query(
          `SELECT id,status,request_hash,structured_result FROM control.ai_runs WHERE workspace_id=$1 AND operation=$2 AND idempotency_key=$3`,
          [input.workspaceId, input.operation, input.idempotencyKey],
        )
      ).rows[0] as
        | {
            id: string;
            status: string;
            request_hash: string;
            structured_result: unknown;
          }
        | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw fail("AI_IDEMPOTENCY_CONFLICT", 409);
        if (existing.status === "succeeded")
          return {
            id: existing.id,
            route: {
              providerId: route.provider_id,
              model: route.model,
              promptVersion: route.prompt_version,
              maxOutputTokens: route.max_output_tokens,
            },
            requestHash,
            context,
            cached: true,
            cachedResult: existing.structured_result,
          };
        if (existing.status === "running")
          throw fail("AI_RUN_ALREADY_EXISTS", 409);
        await c.query(
          `UPDATE control.ai_runs SET status='running',safe_error=NULL,started_at=now(),completed_at=NULL,actor_user_id=$2,correlation_id=$3 WHERE id=$1`,
          [existing.id, input.actorUserId, input.correlationId],
        );
        await reserveUsage(existing.id);
        return {
          id: existing.id,
          route: {
            providerId: route.provider_id,
            model: route.model,
            promptVersion: route.prompt_version,
            maxOutputTokens: route.max_output_tokens,
          },
          requestHash,
          context,
          cached: false,
        };
      }
      const id = randomUUID();
      await c.query(
        `INSERT INTO control.ai_runs(id,tenant_id,workspace_id,research_case_id,operation,provider_id,model,prompt_version,idempotency_key,request_hash,status,actor_user_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'running',$11,$12)`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          input.operation,
          route.provider_id,
          route.model,
          route.prompt_version,
          input.idempotencyKey,
          requestHash,
          input.actorUserId,
          input.correlationId,
        ],
      );
      await reserveUsage(id);
      return {
        id,
        route: {
          providerId: route.provider_id,
          model: route.model,
          promptVersion: route.prompt_version,
          maxOutputTokens: route.max_output_tokens,
        },
        requestHash,
        context,
        cached: false,
      };
    });
  }

  private async completeRun(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    run: RunContext;
    operation: AiOperation;
    actorUserId: string;
    correlationId: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      estimatedCost?: number;
      actualCost?: number;
    };
    providerRequestId?: string;
    structuredResult?: unknown;
    persist: (c: DatabaseClient) => Promise<void>;
  }) {
    await withTenant(this.pool, input.tenantId, async (c) => {
      await input.persist(c);
      await c.query(
        `INSERT INTO control.ai_usage_events(id,tenant_id,workspace_id,research_case_id,ai_run_id,operation,provider_id,model,input_tokens,output_tokens,estimated_cost,actual_cost,accounting_status,provider_request_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reconciled',$13)
         ON CONFLICT(tenant_id,ai_run_id) DO UPDATE SET input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,estimated_cost=excluded.estimated_cost,actual_cost=excluded.actual_cost,accounting_status='reconciled',provider_request_id=excluded.provider_request_id,failure_code=NULL`,
        [
          randomUUID(),
          input.tenantId,
          input.workspaceId,
          input.caseId,
          input.run.id,
          input.operation,
          input.run.route.providerId,
          input.run.route.model,
          input.usage.inputTokens,
          input.usage.outputTokens,
          input.usage.estimatedCost ?? 0,
          input.usage.actualCost ?? null,
          input.providerRequestId ?? null,
        ],
      );
      await c.query(
        `UPDATE control.ai_runs SET status='succeeded',completed_at=now(),provider_request_id=$2,structured_result=$3 WHERE id=$1`,
        [
          input.run.id,
          input.providerRequestId ?? null,
          input.structuredResult ?? null,
        ],
      );
      await audit(c, {
        ...input,
        action: `ai.${input.operation}_completed`,
        targetType: "research_case",
        targetId: input.caseId,
        metadata: {
          runId: input.run.id,
          model: input.run.route.model,
          provider: input.run.route.providerId,
        },
      });
    });
  }
  private async failRun(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    run: RunContext;
    operation: AiOperation;
    actorUserId: string;
    correlationId: string;
    error: unknown;
  }) {
    const accounting = accountingFromAiError(input.error);
    await withTenant(this.pool, input.tenantId, async (c) => {
      await c.query(
        `UPDATE control.ai_runs SET status='failed',safe_error=$2,completed_at=now(),provider_request_id=COALESCE($3,provider_request_id) WHERE id=$1`,
        [
          input.run.id,
          accounting.failureCode,
          accounting.providerRequestId ?? null,
        ],
      );
      if (accounting.usage)
        await c.query(
          `UPDATE control.ai_usage_events SET input_tokens=$2,output_tokens=$3,estimated_cost=$4,actual_cost=$5,accounting_status='failed',provider_request_id=$6,failure_code=$7 WHERE ai_run_id=$1`,
          [
            input.run.id,
            accounting.usage.inputTokens,
            accounting.usage.outputTokens,
            accounting.usage.estimatedCost ?? 0,
            accounting.usage.actualCost ?? null,
            accounting.providerRequestId ?? null,
            accounting.failureCode,
          ],
        );
      else
        await c.query(
          `UPDATE control.ai_usage_events SET accounting_status='failed',failure_code=$2 WHERE ai_run_id=$1`,
          [input.run.id, accounting.failureCode],
        );
      await audit(c, {
        ...input,
        action: `ai.${input.operation}_failed`,
        targetType: "research_case",
        targetId: input.caseId,
        metadata: {
          runId: input.run.id,
          provider: input.run.route.providerId,
          model: input.run.route.model,
          accounting: accounting.usage ? "measured" : "reserved",
          failureCode: accounting.failureCode,
        },
      });
    }).catch(() => undefined);
  }

  private async sourceContext(
    c: DatabaseClient,
    caseId: string,
  ): Promise<CaseContext> {
    const caseRow = (
      await c.query(
        `SELECT id,title,topic,freshness_at,status FROM control.research_cases WHERE id=$1`,
        [caseId],
      )
    ).rows[0] as Record<string, unknown>;
    const sources = (
      await c.query(
        `SELECT id,title,publisher,publication_at,retrieved_at,tier,summary,extracted_material,provenance FROM control.research_case_sources WHERE research_case_id=$1 AND retrieval_status='succeeded' ORDER BY retrieved_at DESC LIMIT 100`,
        [caseId],
      )
    ).rows as Record<string, unknown>[];
    if (!sources.length) throw fail("RESEARCH_SOURCES_REQUIRED", 409);
    return { case: caseRow, sources };
  }

  public async extractClaims(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    const run = await this.startRun({
      ...input,
      operation: "claim_extraction",
      contextFactory: (c) => this.sourceContext(c, input.caseId),
    });
    if (run.cached)
      return this.getState({ tenantId: input.tenantId, caseId: input.caseId });
    try {
      const result = await this.gateway.invoke({
        operation: "claim_extraction",
        route: run.route,
        context: run.context,
        idempotencyKey: input.idempotencyKey,
        outputSchema: extractionSchema,
      });
      await this.completeRun({
        ...input,
        run,
        operation: "claim_extraction",
        usage: result.usage,
        ...(result.providerRequestId
          ? { providerRequestId: result.providerRequestId }
          : {}),
        persist: async (c) => {
          for (const claim of result.value.claims)
            await c.query(
              `INSERT INTO control.research_claim_proposals(id,tenant_id,workspace_id,research_case_id,ai_run_id,statement,importance,proposed_verification_state,explanation,uncertainty) VALUES($1,$2,$3,$4,$5,$6,$7,'unverified',$8,$9)`,
              [
                randomUUID(),
                input.tenantId,
                input.workspaceId,
                input.caseId,
                run.id,
                claim.statement,
                claim.importance,
                claim.explanation,
                claim.uncertainty,
              ],
            );
        },
      });
      return this.getState({ tenantId: input.tenantId, caseId: input.caseId });
    } catch (error) {
      await this.failRun({
        ...input,
        run,
        operation: "claim_extraction",
        error,
      });
      throw error;
    }
  }

  public async compareEvidence(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    idempotencyKey: string;
    correlationId: string;
  }) {
    const run = await this.startRun({
      ...input,
      operation: "evidence_comparison",
      contextFactory: async (c) => {
        const context = await this.sourceContext(c, input.caseId);
        context.claims = (
          await c.query(
            `SELECT id,statement,importance,explanation,uncertainty FROM control.research_claim_proposals WHERE research_case_id=$1 AND decision='proposed'`,
            [input.caseId],
          )
        ).rows as Record<string, unknown>[];
        if (!context.claims.length) throw fail("CLAIM_PROPOSALS_REQUIRED", 409);
        return context;
      },
    });
    if (run.cached)
      return this.getState({ tenantId: input.tenantId, caseId: input.caseId });
    try {
      const result = await this.gateway.invoke({
        operation: "evidence_comparison",
        route: run.route,
        context: run.context,
        idempotencyKey: input.idempotencyKey,
        outputSchema: comparisonSchema,
      });
      await this.completeRun({
        ...input,
        run,
        operation: "evidence_comparison",
        usage: result.usage,
        ...(result.providerRequestId
          ? { providerRequestId: result.providerRequestId }
          : {}),
        persist: async (c) => {
          const validClaims = new Set(
              ((run.context as CaseContext).claims ?? []).map((v) =>
                String(v.id),
              ),
            ),
            validSources = new Set(
              (run.context as CaseContext).sources.map((v) => String(v.id)),
            );
          for (const claim of result.value.claims) {
            if (!validClaims.has(claim.claimProposalId))
              throw fail("AI_UNKNOWN_CLAIM_REFERENCE", 502);
            await c.query(
              `UPDATE control.research_claim_proposals SET proposed_verification_state=$2,explanation=$3,uncertainty=$4,updated_at=now() WHERE id=$1`,
              [
                claim.claimProposalId,
                claim.verificationState,
                claim.explanation,
                claim.uncertainty,
              ],
            );
            for (const evidence of claim.evidence) {
              if (!validSources.has(evidence.sourceId))
                throw fail("AI_UNKNOWN_SOURCE_REFERENCE", 502);
              await c.query(
                `INSERT INTO control.research_evidence_proposals(id,tenant_id,workspace_id,research_case_id,claim_proposal_id,case_source_id,relationship,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
                [
                  randomUUID(),
                  input.tenantId,
                  input.workspaceId,
                  input.caseId,
                  claim.claimProposalId,
                  evidence.sourceId,
                  evidence.relationship,
                  evidence.notes,
                ],
              );
            }
          }
        },
      });
      return this.getState({ tenantId: input.tenantId, caseId: input.caseId });
    } catch (error) {
      await this.failRun({
        ...input,
        run,
        operation: "evidence_comparison",
        error,
      });
      throw error;
    }
  }

  public async decideClaim(input: {
    tenantId: string;
    proposalId: string;
    actorUserId: string;
    decision: "accepted" | "rejected";
    editedStatement?: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const p = (
        await c.query(
          `SELECT * FROM control.research_claim_proposals WHERE id=$1 FOR UPDATE`,
          [input.proposalId],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!p) throw fail("CLAIM_PROPOSAL_NOT_FOUND", 404);
      if (p.decision !== "proposed")
        throw fail("CLAIM_PROPOSAL_ALREADY_DECIDED", 409);
      let claimId: null | string = null;
      if (input.decision === "accepted") {
        claimId = randomUUID();
        const statement = input.editedStatement?.trim() || String(p.statement);
        await c.query(
          `INSERT INTO control.research_claims(id,tenant_id,workspace_id,research_case_id,statement,importance,verification_state,verification_explanation,conflict_notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [
            claimId,
            input.tenantId,
            p.workspace_id,
            p.research_case_id,
            statement,
            p.importance,
            p.proposed_verification_state,
            p.explanation,
            p.uncertainty,
            input.actorUserId,
          ],
        );
      }
      await c.query(
        `UPDATE control.research_claim_proposals SET statement=COALESCE($2,statement),decision=$3,decided_by=$4,decided_at=now(),accepted_claim_id=$5,updated_at=now() WHERE id=$1`,
        [
          input.proposalId,
          input.editedStatement?.trim() || null,
          input.decision,
          input.actorUserId,
          claimId,
        ],
      );
      await audit(c, {
        ...input,
        action: `research.claim_proposal_${input.decision}`,
        targetType: "claim_proposal",
        targetId: input.proposalId,
        metadata: {
          acceptedClaimId: claimId,
          edited: Boolean(input.editedStatement),
        },
      });
      return { decision: input.decision, claimId };
    });
  }
  public async decideEvidence(input: {
    tenantId: string;
    proposalId: string;
    actorUserId: string;
    decision: "accepted" | "rejected";
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const p = (
        await c.query(
          `SELECT ep.*,cp.accepted_claim_id FROM control.research_evidence_proposals ep JOIN control.research_claim_proposals cp ON cp.id=ep.claim_proposal_id WHERE ep.id=$1 FOR UPDATE`,
          [input.proposalId],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!p) throw fail("EVIDENCE_PROPOSAL_NOT_FOUND", 404);
      if (p.decision !== "proposed")
        throw fail("EVIDENCE_PROPOSAL_ALREADY_DECIDED", 409);
      let evidenceId: null | string = null;
      if (input.decision === "accepted") {
        if (!p.accepted_claim_id)
          throw fail("CLAIM_MUST_BE_ACCEPTED_FIRST", 409);
        evidenceId = randomUUID();
        await c.query(
          `INSERT INTO control.research_evidence(id,tenant_id,workspace_id,research_case_id,claim_id,case_source_id,relationship,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,claim_id,case_source_id,relationship) DO NOTHING`,
          [
            evidenceId,
            input.tenantId,
            p.workspace_id,
            p.research_case_id,
            p.accepted_claim_id,
            p.case_source_id,
            p.relationship,
            p.notes,
            input.actorUserId,
          ],
        );
        const found = await c.query<{ id: string }>(
          `SELECT id FROM control.research_evidence WHERE claim_id=$1 AND case_source_id=$2 AND relationship=$3`,
          [p.accepted_claim_id, p.case_source_id, p.relationship],
        );
        evidenceId = String(found.rows[0]?.id);
      }
      await c.query(
        `UPDATE control.research_evidence_proposals SET decision=$2,decided_by=$3,decided_at=now(),accepted_evidence_id=$4,updated_at=now() WHERE id=$1`,
        [input.proposalId, input.decision, input.actorUserId, evidenceId],
      );
      await audit(c, {
        ...input,
        action: `research.evidence_proposal_${input.decision}`,
        targetType: "evidence_proposal",
        targetId: input.proposalId,
        metadata: { acceptedEvidenceId: evidenceId },
      });
      return { decision: input.decision, evidenceId };
    });
  }

  public async buildEvidencePack(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const context = await this.sourceContext(c, input.caseId);
      const claims = (
        await c.query(
          `SELECT cl.* FROM control.research_claims cl WHERE cl.research_case_id=$1 AND EXISTS(SELECT 1 FROM control.research_evidence e WHERE e.claim_id=cl.id) ORDER BY cl.created_at,cl.id`,
          [input.caseId],
        )
      ).rows as Record<string, unknown>[];
      if (!claims.length)
        throw fail("APPROVED_CLAIMS_WITH_EVIDENCE_REQUIRED", 409);
      const evidence = (
        await c.query(
          `SELECT e.* FROM control.research_evidence e WHERE e.research_case_id=$1 AND e.claim_id=ANY($2::uuid[]) ORDER BY e.created_at,e.id`,
          [input.caseId, claims.map((v) => v.id)],
        )
      ).rows as Record<string, unknown>[];
      const sourceIds = new Set(evidence.map((e) => String(e.case_source_id)));
      const sources = context.sources.filter((s) =>
        sourceIds.has(String(s.id)),
      );
      const unresolved =
        claims.filter((c) => c.verification_state === "conflicting").length +
        evidence.filter((e) => e.relationship === "contradicts").length;
      const snapshot = {
        schemaVersion: 1,
        researchCase: context.case,
        sources,
        claims,
        evidence,
        unresolvedConflicts: unresolved,
        createdAt: new Date().toISOString(),
      };
      const version = Number(
        (
          await c.query<{ version: number }>(
            `SELECT COALESCE(max(version),0)+1 version FROM control.evidence_packs WHERE research_case_id=$1`,
            [input.caseId],
          )
        ).rows[0]?.version,
      );
      const id = randomUUID();
      await c.query(
        `INSERT INTO control.evidence_packs(id,tenant_id,workspace_id,research_case_id,version,snapshot,snapshot_hash,unresolved_conflicts,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          version,
          snapshot,
          hash(snapshot),
          unresolved,
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.evidence_pack_built",
        targetType: "evidence_pack",
        targetId: id,
        metadata: { version, unresolvedConflicts: unresolved },
      });
      return {
        id,
        version,
        snapshotHash: hash(snapshot),
        unresolvedConflicts: unresolved,
      };
    });
  }

  public async synthesize(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    evidencePackId: string;
    actorUserId: string;
    idempotencyKey: string;
    validationIdempotencyKey: string;
    correlationId: string;
  }) {
    const generation = await this.startRun({
      ...input,
      operation: "factual_synthesis",
      contextFactory: async (c) => {
        const p = (
          await c.query<{
            id: string;
            version: number;
            snapshot: Record<string, unknown>;
            snapshot_hash: string;
          }>(
            `SELECT id,version,snapshot,snapshot_hash FROM control.evidence_packs WHERE id=$1 AND research_case_id=$2`,
            [input.evidencePackId, input.caseId],
          )
        ).rows[0];
        if (!p) throw fail("EVIDENCE_PACK_NOT_FOUND", 404);
        return p;
      },
    });
    let activeRun = generation;
    try {
      let generatedValue: z.infer<typeof synthesisSchema>;
      if (generation.cached) {
        const parsed = synthesisSchema.safeParse(generation.cachedResult);
        if (!parsed.success) throw fail("AI_CACHED_RESULT_INVALID", 500);
        generatedValue = parsed.data;
      } else {
        const snapshot = (
          generation.context as { snapshot: Record<string, unknown> }
        ).snapshot;
        const allowedClaimIds = (
          snapshot.claims as Record<string, unknown>[]
        ).map((value) => String(value.id));
        const allowedSourceIds = (
          snapshot.sources as Record<string, unknown>[]
        ).map((value) => String(value.id));
        const generated = await this.gateway.invoke({
          operation: "factual_synthesis",
          route: generation.route,
          context: generation.context,
          idempotencyKey: input.idempotencyKey,
          outputSchema: boundedSynthesisSchema(
            allowedClaimIds,
            allowedSourceIds,
          ),
        });
        generatedValue = generated.value;
        await this.completeRun({
          ...input,
          run: generation,
          operation: "factual_synthesis",
          usage: generated.usage,
          structuredResult: generated.value,
          ...(generated.providerRequestId
            ? { providerRequestId: generated.providerRequestId }
            : {}),
          persist: async () => {},
        });
      }
      const validation = await this.startRun({
        ...input,
        operation: "grounding_validation",
        idempotencyKey: input.validationIdempotencyKey,
        contextFactory: async (c) => {
          const p = (
            await c.query<{
              id: string;
              version: number;
              snapshot: Record<string, unknown>;
              snapshot_hash: string;
            }>(
              `SELECT id,version,snapshot,snapshot_hash FROM control.evidence_packs WHERE id=$1`,
              [input.evidencePackId],
            )
          ).rows[0];
          return { evidencePack: p, synthesis: generatedValue };
        },
      });
      activeRun = validation;
      if (validation.cached)
        return this.getState({
          tenantId: input.tenantId,
          caseId: input.caseId,
        });
      const pack = (generation.context as { snapshot: Record<string, unknown> })
          .snapshot,
        claimIds = new Set(
          (pack.claims as Record<string, unknown>[]).map((v) => String(v.id)),
        ),
        sourceIds = new Set(
          (pack.sources as Record<string, unknown>[]).map((v) => String(v.id)),
        );
      const checked = await this.gateway.invoke({
        operation: "grounding_validation",
        route: validation.route,
        context: validation.context,
        idempotencyKey: input.validationIdempotencyKey,
        outputSchema: boundedValidationSchema([...claimIds], [...sourceIds]),
      });
      for (const ref of generatedValue.provenanceReferences) {
        if (
          !claimIds.has(ref.claimId) ||
          ref.sourceIds.some((id) => !sourceIds.has(id))
        )
          throw fail("SYNTHESIS_PROVENANCE_OUTSIDE_PACK", 502);
      }
      for (const statement of checked.value.statements) {
        if (
          statement.claimIds.some((id) => !claimIds.has(id)) ||
          statement.evidenceSourceIds.some((id) => !sourceIds.has(id))
        )
          throw fail("VALIDATOR_REFERENCE_OUTSIDE_PACK", 502);
      }
      const approvalReady = !checked.value.statements.some(
        (v) =>
          v.material &&
          (v.assessment === "unsupported" || v.assessment === "conflicting"),
      );
      await this.completeRun({
        ...input,
        run: validation,
        operation: "grounding_validation",
        usage: checked.usage,
        ...(checked.providerRequestId
          ? { providerRequestId: checked.providerRequestId }
          : {}),
        persist: async (c) => {
          const version = Number(
            (
              await c.query<{ version: number }>(
                `SELECT COALESCE(max(version),0)+1 version FROM control.factual_syntheses WHERE research_case_id=$1`,
                [input.caseId],
              )
            ).rows[0]?.version,
          );
          await c.query(
            `INSERT INTO control.factual_syntheses(id,tenant_id,workspace_id,research_case_id,evidence_pack_id,version,synthesis,validation,approval_ready,generation_run_id,validation_run_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              randomUUID(),
              input.tenantId,
              input.workspaceId,
              input.caseId,
              input.evidencePackId,
              version,
              generatedValue,
              checked.value,
              approvalReady,
              generation.id,
              validation.id,
              input.actorUserId,
            ],
          );
        },
      });
      return this.getState({ tenantId: input.tenantId, caseId: input.caseId });
    } catch (error) {
      await this.failRun({
        ...input,
        run: activeRun,
        operation:
          activeRun === generation
            ? "factual_synthesis"
            : "grounding_validation",
        error,
      });
      throw error;
    }
  }

  public async buildEditorialContextPack(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const row = (
        await c.query<Record<string, unknown>>(
          `SELECT p.*,r.id profile_revision_id,r.version profile_revision_version
             FROM control.research_cases rc JOIN control.media_profiles p ON p.id=rc.media_profile_id
             JOIN LATERAL (SELECT id,version FROM control.media_profile_revisions WHERE media_profile_id=p.id ORDER BY version DESC LIMIT 1) r ON true
            WHERE rc.id=$1 AND rc.workspace_id=$2`,
          [input.caseId, input.workspaceId],
        )
      ).rows[0];
      if (!row) throw fail("MEDIA_PROFILE_REVISION_NOT_FOUND", 404);
      const snapshot = {
        schemaVersion: 1,
        profileRevisionVersion: row.profile_revision_version,
        identity: {
          name: row.name,
          publicationName: row.publication_identity,
          tagline: row.tagline,
          locale: row.locale,
          region: row.region,
          country: row.country,
          audience: row.audience,
        },
        excludedTopics: row.excluded_topics,
        restrictedTopics: row.restricted_topics,
        editorialConfig: row.editorial_config,
      };
      const version = Number(
        (
          await c.query<{ version: number }>(
            `SELECT COALESCE(max(version),0)+1 version FROM control.editorial_context_packs WHERE research_case_id=$1`,
            [input.caseId],
          )
        ).rows[0]?.version,
      );
      const id = randomUUID();
      await c.query(
        `INSERT INTO control.editorial_context_packs(id,tenant_id,workspace_id,research_case_id,media_profile_id,profile_revision_id,version,snapshot,snapshot_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          input.tenantId,
          input.workspaceId,
          input.caseId,
          row.id,
          row.profile_revision_id,
          version,
          snapshot,
          hash(snapshot),
          input.actorUserId,
        ],
      );
      await audit(c, {
        ...input,
        action: "research.editorial_context_pack_built",
        targetType: "editorial_context_pack",
        targetId: id,
        metadata: {
          version,
          profileRevisionVersion: row.profile_revision_version,
        },
      });
      return {
        id,
        version,
        snapshotHash: hash(snapshot),
        profileRevisionVersion: row.profile_revision_version,
      };
    });
  }

  public async transformEditorially(input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    synthesisId: string;
    editorialContextPackId: string;
    actorUserId: string;
    idempotencyKey: string;
    validationIdempotencyKey: string;
    correlationId: string;
  }) {
    const generation = await this.startRun({
      ...input,
      operation: "editorial_transformation",
      contextFactory: async (c) => {
        const source = (
          await c.query<Record<string, unknown>>(
            `SELECT s.*,e.snapshot evidence_snapshot,e.snapshot_hash evidence_hash,cp.snapshot editorial_context,cp.snapshot_hash context_hash
               FROM control.factual_syntheses s JOIN control.evidence_packs e ON e.id=s.evidence_pack_id
               JOIN control.editorial_context_packs cp ON cp.id=$2 AND cp.research_case_id=s.research_case_id
              WHERE s.id=$1 AND s.research_case_id=$3 AND s.approval_ready`,
            [input.synthesisId, input.editorialContextPackId, input.caseId],
          )
        ).rows[0];
        if (!source) throw fail("APPROVED_SYNTHESIS_AND_CONTEXT_REQUIRED", 409);
        return {
          factualSynthesis: source.synthesis,
          evidencePack: source.evidence_snapshot,
          evidencePackHash: source.evidence_hash,
          editorialContextPack: source.editorial_context,
          editorialContextPackHash: source.context_hash,
        };
      },
    });
    let activeRun = generation;
    try {
      let draft: z.infer<typeof editorialDraftSchema>;
      if (generation.cached) {
        const parsed = editorialDraftSchema.safeParse(generation.cachedResult);
        if (!parsed.success) throw fail("AI_CACHED_RESULT_INVALID", 500);
        draft = parsed.data;
      } else {
        const evidenceSnapshot = (
          generation.context as {
            evidencePack: Record<string, unknown>;
          }
        ).evidencePack;
        const editorialContext = (
          generation.context as {
            editorialContextPack: {
              editorialConfig: {
                sections: {
                  name: string;
                  enabled: boolean;
                  satire: boolean;
                }[];
              };
            };
          }
        ).editorialContextPack;
        const allowedClaimIds = (
          evidenceSnapshot.claims as Record<string, unknown>[]
        ).map((value) => String(value.id));
        const allowedSourceIds = (
          evidenceSnapshot.sources as Record<string, unknown>[]
        ).map((value) => String(value.id));
        const output = await this.gateway.invoke({
          operation: "editorial_transformation",
          route: generation.route,
          context: generation.context,
          idempotencyKey: input.idempotencyKey,
          outputSchema: boundedEditorialDraftSchema(
            allowedClaimIds,
            allowedSourceIds,
            editorialContext.editorialConfig.sections
              .filter((section) => section.enabled && !section.satire)
              .map((section) => section.name),
          ),
        });
        draft = output.value;
        await this.completeRun({
          ...input,
          run: generation,
          operation: "editorial_transformation",
          usage: output.usage,
          structuredResult: draft,
          ...(output.providerRequestId
            ? { providerRequestId: output.providerRequestId }
            : {}),
          persist: async () => {},
        });
      }
      const context = generation.context as {
        evidencePack: Record<string, unknown>;
        editorialContextPack: { editorialConfig: Record<string, unknown> };
      };
      const config = context.editorialContextPack
          .editorialConfig as EditorialPolicyConfig,
        {
          policyViolations,
          verificationState,
          freshnessState,
          claimIds,
          sourceIds,
        } = evaluateEditorialPolicy(draft, context.evidencePack, config);
      const validation = await this.startRun({
        ...input,
        operation: "editorial_grounding_validation",
        idempotencyKey: input.validationIdempotencyKey,
        contextFactory: async () =>
          await Promise.resolve({
            evidencePack: context.evidencePack,
            editorialContextPack: context.editorialContextPack,
            editorialDraft: draft,
          }),
      });
      activeRun = validation;
      if (validation.cached)
        return this.getState({
          tenantId: input.tenantId,
          caseId: input.caseId,
        });
      const checked = await this.gateway.invoke({
        operation: "editorial_grounding_validation",
        route: validation.route,
        context: validation.context,
        idempotencyKey: input.validationIdempotencyKey,
        outputSchema: boundedValidationSchema([...claimIds], [...sourceIds]),
      });
      for (const statement of checked.value.statements)
        if (
          statement.claimIds.some((id) => !claimIds.has(id)) ||
          statement.evidenceSourceIds.some((id) => !sourceIds.has(id))
        )
          policyViolations.push("VALIDATOR_REFERENCE_OUTSIDE_PACK");
      const unsupported = checked.value.statements.some(
        (v) =>
          v.material && ["unsupported", "conflicting"].includes(v.assessment),
      );
      const approvalReady = !unsupported && policyViolations.length === 0;
      await this.completeRun({
        ...input,
        run: validation,
        operation: "editorial_grounding_validation",
        usage: checked.usage,
        ...(checked.providerRequestId
          ? { providerRequestId: checked.providerRequestId }
          : {}),
        persist: async (c) => {
          const version = Number(
              (
                await c.query<{ version: number }>(
                  `SELECT COALESCE(max(version),0)+1 version FROM control.editorial_drafts WHERE research_case_id=$1`,
                  [input.caseId],
                )
              ).rows[0]?.version,
            ),
            id = randomUUID();
          await c.query(
            `INSERT INTO control.editorial_drafts(id,tenant_id,workspace_id,research_case_id,factual_synthesis_id,evidence_pack_id,editorial_context_pack_id,version,draft,validation,verification_state,freshness_state,approval_ready,status,generation_run_id,validation_run_id,created_by) VALUES($1,$2,$3,$4,$5,(SELECT evidence_pack_id FROM control.factual_syntheses WHERE id=$5),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              id,
              input.tenantId,
              input.workspaceId,
              input.caseId,
              input.synthesisId,
              input.editorialContextPackId,
              version,
              draft,
              { ...checked.value, policyViolations },
              verificationState,
              freshnessState,
              approvalReady,
              approvalReady ? "review_required" : "blocked",
              generation.id,
              validation.id,
              input.actorUserId,
            ],
          );
        },
      });
      return this.getState({ tenantId: input.tenantId, caseId: input.caseId });
    } catch (error) {
      await this.failRun({
        ...input,
        run: activeRun,
        operation:
          activeRun === generation
            ? "editorial_transformation"
            : "editorial_grounding_validation",
        error,
      });
      throw error;
    }
  }

  public async decideEditorialDraft(input: {
    tenantId: string;
    draftId: string;
    actorUserId: string;
    decision: "approved" | "rejected";
    correlationId: string;
  }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE control.editorial_drafts SET status=$2,approved_by=CASE WHEN $2='approved' THEN $3::uuid ELSE NULL END,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END WHERE id=$1 AND status='review_required' AND ($2='rejected' OR approval_ready) RETURNING id,status`,
        [input.draftId, input.decision, input.actorUserId],
      );
      if (!r.rows[0]) throw fail("EDITORIAL_DRAFT_NOT_REVIEWABLE", 409);
      await audit(c, {
        ...input,
        action: `research.editorial_draft_${input.decision}`,
        targetType: "editorial_draft",
        targetId: input.draftId,
      });
      return mapped(r.rows[0] as Record<string, unknown>);
    });
  }

  public async reviseEditorialDraft(input: {
    tenantId: string;
    workspaceId: string;
    draftId: string;
    actorUserId: string;
    draft: unknown;
    reason: string;
    validationIdempotencyKey: string;
    correlationId: string;
  }) {
    const editedDraft = editorialDraftSchema.parse(input.draft);
    const reason = z.string().trim().min(1).max(2000).parse(input.reason);
    const source = await withTenant(this.pool, input.tenantId, async (c) => {
      await this.assertAvailable(c, input.tenantId, input.workspaceId);
      const row = (
        await c.query<Record<string, unknown>>(
          `SELECT d.*,e.snapshot evidence_snapshot,cp.snapshot editorial_context
             FROM control.editorial_drafts d
             JOIN control.evidence_packs e ON e.id=d.evidence_pack_id
             JOIN control.editorial_context_packs cp ON cp.id=d.editorial_context_pack_id
            WHERE d.id=$1 AND d.workspace_id=$2`,
          [input.draftId, input.workspaceId],
        )
      ).rows[0];
      if (!row) throw fail("EDITORIAL_DRAFT_NOT_FOUND", 404);
      if (!["review_required", "blocked"].includes(String(row.status)))
        throw fail("EDITORIAL_DRAFT_NOT_EDITABLE", 409);
      return row;
    });
    const evidencePack = source.evidence_snapshot as Record<string, unknown>,
      editorialContext = source.editorial_context as {
        editorialConfig: EditorialPolicyConfig;
      },
      policy = evaluateEditorialPolicy(
        editedDraft,
        evidencePack,
        editorialContext.editorialConfig,
      );
    const validation = await this.startRun({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      caseId: String(source.research_case_id),
      actorUserId: input.actorUserId,
      operation: "editorial_grounding_validation",
      idempotencyKey: input.validationIdempotencyKey,
      correlationId: input.correlationId,
      contextFactory: () =>
        Promise.resolve({
          evidencePack,
          editorialContextPack: editorialContext,
          editorialDraft: editedDraft,
          revision: {
            sourceDraftId: input.draftId,
            reason,
            humanEdited: true,
          },
        }),
    });
    if (validation.cached)
      return this.getState({
        tenantId: input.tenantId,
        caseId: String(source.research_case_id),
      });
    try {
      const checked = await this.gateway.invoke({
        operation: "editorial_grounding_validation",
        route: validation.route,
        context: validation.context,
        idempotencyKey: input.validationIdempotencyKey,
        outputSchema: boundedValidationSchema(
          [...policy.claimIds],
          [...policy.sourceIds],
        ),
      });
      for (const statement of checked.value.statements)
        if (
          statement.claimIds.some((id) => !policy.claimIds.has(id)) ||
          statement.evidenceSourceIds.some((id) => !policy.sourceIds.has(id))
        )
          policy.policyViolations.push("VALIDATOR_REFERENCE_OUTSIDE_PACK");
      const unsupported = checked.value.statements.some(
        (value) =>
          value.material &&
          ["unsupported", "conflicting"].includes(value.assessment),
      );
      const approvalReady =
        !unsupported && policy.policyViolations.length === 0;
      await this.completeRun({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        caseId: String(source.research_case_id),
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        run: validation,
        operation: "editorial_grounding_validation",
        usage: checked.usage,
        ...(checked.providerRequestId
          ? { providerRequestId: checked.providerRequestId }
          : {}),
        persist: async (c) => {
          const locked = (
            await c.query<{ status: string }>(
              `SELECT status FROM control.editorial_drafts WHERE id=$1 FOR UPDATE`,
              [input.draftId],
            )
          ).rows[0];
          if (
            !locked ||
            !["review_required", "blocked"].includes(locked.status)
          )
            throw fail("EDITORIAL_DRAFT_NOT_EDITABLE", 409);
          const version = Number(
              (
                await c.query<{ version: number }>(
                  `SELECT COALESCE(max(version),0)+1 version FROM control.editorial_drafts WHERE research_case_id=$1`,
                  [source.research_case_id],
                )
              ).rows[0]?.version,
            ),
            id = randomUUID();
          await c.query(
            `INSERT INTO control.editorial_drafts(id,tenant_id,workspace_id,research_case_id,factual_synthesis_id,evidence_pack_id,editorial_context_pack_id,version,draft,validation,verification_state,freshness_state,approval_ready,status,generation_run_id,validation_run_id,created_by,source_draft_id,revision_kind,revision_reason)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'human_edit',$19)`,
            [
              id,
              input.tenantId,
              input.workspaceId,
              source.research_case_id,
              source.factual_synthesis_id,
              source.evidence_pack_id,
              source.editorial_context_pack_id,
              version,
              editedDraft,
              { ...checked.value, policyViolations: policy.policyViolations },
              policy.verificationState,
              policy.freshnessState,
              approvalReady,
              approvalReady ? "review_required" : "blocked",
              source.generation_run_id,
              validation.id,
              input.actorUserId,
              input.draftId,
              reason,
            ],
          );
          await c.query(
            `UPDATE control.editorial_drafts SET status='superseded' WHERE id=$1`,
            [input.draftId],
          );
          await audit(c, {
            ...input,
            action: "research.editorial_draft_revised",
            targetType: "editorial_draft",
            targetId: id,
            metadata: {
              sourceDraftId: input.draftId,
              version,
              approvalReady,
              policyViolations: policy.policyViolations,
            },
          });
        },
      });
      return this.getState({
        tenantId: input.tenantId,
        caseId: String(source.research_case_id),
      });
    } catch (error) {
      await this.failRun({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        caseId: String(source.research_case_id),
        run: validation,
        operation: "editorial_grounding_validation",
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        error,
      });
      throw error;
    }
  }

  public async promoteEditorialDraft(input: {
    tenantId: string;
    draftId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    const source = await withTenant(this.pool, input.tenantId, async (c) => {
      const row = (
        await c.query(
          `SELECT d.*,p.content_item_id FROM control.editorial_drafts d LEFT JOIN control.editorial_draft_promotions p ON p.editorial_draft_id=d.id WHERE d.id=$1`,
          [input.draftId],
        )
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row) throw fail("EDITORIAL_DRAFT_NOT_FOUND", 404);
      if (row.content_item_id) return row;
      if (row.status !== "approved")
        throw fail("EDITORIAL_DRAFT_APPROVAL_REQUIRED", 409);
      return row;
    });
    if (source.content_item_id) {
      if (typeof source.content_item_id !== "string")
        throw fail("INVALID_CONTENT_ITEM_REFERENCE", 500);
      return this.unified.get(input.tenantId, source.content_item_id);
    }
    const draft = source.draft as z.infer<typeof editorialDraftSchema>;
    const item = await this.unified.create({
      tenantId: input.tenantId,
      workspaceId: String(source.workspace_id),
      actorUserId: input.actorUserId,
      title: draft.headline,
      summary: draft.essence,
      correlationId: input.correlationId,
    });
    await withTenant(this.pool, input.tenantId, async (c) => {
      await c.query(
        `INSERT INTO control.editorial_draft_promotions(id,tenant_id,workspace_id,editorial_draft_id,content_item_id,promoted_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          input.tenantId,
          source.workspace_id,
          input.draftId,
          item.id,
          input.actorUserId,
        ],
      );
      await c.query(
        `UPDATE control.editorial_drafts SET status='promoted' WHERE id=$1`,
        [input.draftId],
      );
      await audit(c, {
        ...input,
        action: "research.editorial_draft_promoted",
        targetType: "editorial_draft",
        targetId: input.draftId,
        metadata: { contentItemId: item.id },
      });
    });
    return item;
  }

  public async promote(input: {
    tenantId: string;
    synthesisId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    const source = await withTenant(this.pool, input.tenantId, async (c) => {
      const row = (
        await c.query(`SELECT * FROM control.factual_syntheses WHERE id=$1`, [
          input.synthesisId,
        ])
      ).rows[0] as Record<string, unknown> | undefined;
      if (!row) throw fail("SYNTHESIS_NOT_FOUND", 404);
      if (!row.approval_ready) throw fail("SYNTHESIS_NOT_APPROVAL_READY", 409);
      if (
        (
          await c.query(
            `SELECT 1 FROM control.synthesis_promotions WHERE synthesis_id=$1`,
            [input.synthesisId],
          )
        ).rowCount
      )
        throw fail("SYNTHESIS_ALREADY_PROMOTED", 409);
      return row;
    });
    const content = source.synthesis as z.infer<typeof synthesisSchema>;
    const item = await this.unified.create({
      tenantId: input.tenantId,
      workspaceId: String(source.workspace_id),
      actorUserId: input.actorUserId,
      title: content.headline,
      summary: content.summary,
      correlationId: input.correlationId,
    });
    await withTenant(this.pool, input.tenantId, async (c) => {
      await c.query(
        `INSERT INTO control.synthesis_promotions(id,tenant_id,workspace_id,research_case_id,synthesis_id,content_item_id,promoted_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          input.tenantId,
          source.workspace_id,
          source.research_case_id,
          input.synthesisId,
          item.id,
          input.actorUserId,
        ],
      );
      await c.query(
        `UPDATE control.research_cases SET status='promoted',updated_by=$2,updated_at=now() WHERE id=$1`,
        [source.research_case_id, input.actorUserId],
      );
      await audit(c, {
        ...input,
        action: "research.synthesis_promoted",
        targetType: "factual_synthesis",
        targetId: input.synthesisId,
        metadata: {
          contentItemId: item.id,
          evidencePackId: source.evidence_pack_id,
        },
      });
    });
    return item;
  }

  public async getState(input: { tenantId: string; caseId: string }) {
    return withTenant(this.pool, input.tenantId, async (c) => {
      const proposals = await c.query(
        `SELECT * FROM control.research_claim_proposals WHERE research_case_id=$1 ORDER BY created_at`,
        [input.caseId],
      );
      const evidence = await c.query(
        `SELECT * FROM control.research_evidence_proposals WHERE research_case_id=$1 ORDER BY created_at`,
        [input.caseId],
      );
      const packs = await c.query(
        `SELECT id,version,snapshot_hash,unresolved_conflicts,created_by,created_at FROM control.evidence_packs WHERE research_case_id=$1 ORDER BY version DESC`,
        [input.caseId],
      );
      const syntheses = await c.query(
        `SELECT s.*,p.content_item_id FROM control.factual_syntheses s LEFT JOIN control.synthesis_promotions p ON p.synthesis_id=s.id WHERE s.research_case_id=$1 ORDER BY s.version DESC`,
        [input.caseId],
      );
      const contextPacks = await c.query(
        `SELECT id,media_profile_id,profile_revision_id,version,snapshot_hash,created_at FROM control.editorial_context_packs WHERE research_case_id=$1 ORDER BY version DESC`,
        [input.caseId],
      );
      const editorialDrafts = await c.query(
        `SELECT d.*,p.content_item_id FROM control.editorial_drafts d LEFT JOIN control.editorial_draft_promotions p ON p.editorial_draft_id=d.id WHERE d.research_case_id=$1 ORDER BY d.version DESC`,
        [input.caseId],
      );
      const runs = await c.query(
        `SELECT id,operation,provider_id,model,prompt_version,status,safe_error,started_at,completed_at FROM control.ai_runs WHERE research_case_id=$1 ORDER BY started_at DESC LIMIT 30`,
        [input.caseId],
      );
      const usage = await c.query(
        `SELECT COALESCE(sum(input_tokens),0)::int input_tokens,COALESCE(sum(output_tokens),0)::int output_tokens,COALESCE(sum(COALESCE(actual_cost,estimated_cost)),0)::text cost FROM control.ai_usage_events WHERE research_case_id=$1`,
        [input.caseId],
      );
      return {
        claimProposals: proposals.rows.map((r) =>
          mapped(r as Record<string, unknown>),
        ),
        evidenceProposals: evidence.rows.map((r) =>
          mapped(r as Record<string, unknown>),
        ),
        evidencePacks: packs.rows.map((r) =>
          mapped(r as Record<string, unknown>),
        ),
        syntheses: syntheses.rows.map((r) =>
          mapped(r as Record<string, unknown>),
        ),
        editorialContextPacks: contextPacks.rows.map((r) =>
          mapped(r as Record<string, unknown>),
        ),
        editorialDrafts: editorialDrafts.rows.map((r) =>
          mapped(r as Record<string, unknown>),
        ),
        runs: runs.rows.map((r) => mapped(r as Record<string, unknown>)),
        usage: mapped(usage.rows[0] as Record<string, unknown>),
      };
    });
  }
}
