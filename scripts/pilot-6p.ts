import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AiGateway,
  OpenAiResponsesProvider,
  aiOperations,
} from "@redi-control/ai-gateway";
import { InMemorySecretProvider } from "@redi-control/connector-sdk";
import {
  createPool,
  finishJob,
  seedLocalTestData,
  withTenant,
  type ClaimedJob,
  type DatabasePool,
} from "@redi-control/database";
import { EvidenceIntelligenceService } from "@redi-control/evidence-intelligence";
import { MediaIntelligenceService } from "@redi-control/media-intelligence";
import { SourceIngestionService } from "@redi-control/source-ingestion";
import { z } from "zod";

const storySchema = z.object({
  key: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string().datetime(),
  publisher: z.string().min(1),
  sourceTier: z.enum(["primary", "strong_reporting"]),
});
const datasetSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  freshnessWindowHours: z.number().int().min(24).max(48),
  stories: z.array(storySchema).min(10).max(20),
});
const profileSchema = z.object({
  identity: z.object({
    name: z.string(),
    publicationIdentity: z.string(),
    tagline: z.string(),
    locale: z.string(),
    country: z.string(),
    region: z.string(),
    audience: z.string(),
  }),
  editorialConfig: z.record(z.string(), z.unknown()),
  excludedTopics: z.array(z.string()),
  restrictedTopics: z.array(z.string()),
});

type StoryResult = {
  key: string;
  caseId?: string;
  title: string;
  category: string;
  source: string;
  sourceTier: string;
  publishedAt: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  stage: string;
  status: "completed" | "rejected" | "failed";
  failure?: string;
  claimProposalCount: number;
  acceptedClaimCount: number;
  evidenceProposalCount: number;
  acceptedEvidenceCount: number;
  verificationStates: string[];
  synthesisApprovalReady?: boolean;
  editorialApprovalReady?: boolean;
  editorialDraftId?: string;
  editorialDraft?: unknown;
  validation?: unknown;
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
};

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};
const safeError = (error: unknown) => {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  const details = (error as Error & { safeDetails?: unknown }).safeDetails;
  const serializedDetails =
    typeof details === "string" || typeof details === "number"
      ? String(details)
      : details
        ? JSON.stringify(details)
        : "";
  return `${error.message}${serializedDetails ? `:${serializedDetails}` : ""}`.slice(
    0,
    500,
  );
};
const asString = (value: unknown) => (typeof value === "string" ? value : "");
const boundedNumber = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`${name}_INVALID`);
  return value;
};
const getId = (value: unknown) => {
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string" || !id) throw new Error("ENTITY_ID_MISSING");
  return id;
};

async function claimPilotSourceJob(
  pool: DatabasePool,
  tenantId: string,
  runId: string,
): Promise<ClaimedJob | null> {
  return withTenant(pool, tenantId, async (client) => {
    const row = (
      await client.query<{
        id: string;
        tenant_id: string;
        job_type: string;
        payload: Record<string, unknown>;
        attempt_count: number;
        max_attempts: number;
      }>(
        `UPDATE control.jobs job
            SET status='running',locked_at=now(),locked_by='pilot-6p-worker',
                attempt_count=attempt_count+1,updated_at=now()
          WHERE id=(
            SELECT id FROM control.jobs
             WHERE tenant_id=$1 AND job_type='source.ingestion'
               AND payload->>'runId'=$2 AND status IN ('pending','failed')
               AND available_at<=now() AND attempt_count<max_attempts
             ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
          )
          RETURNING id,tenant_id,job_type,payload,attempt_count,max_attempts`,
        [tenantId, runId],
      )
    ).rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          jobType: row.job_type,
          payload: row.payload,
          attemptCount: row.attempt_count,
          maxAttempts: row.max_attempts,
        }
      : null;
  });
}

async function main() {
  if (process.env.PILOT_6P_ACKNOWLEDGE_COSTS !== "1")
    throw new Error("PILOT_6P_ACKNOWLEDGE_COSTS_REQUIRED");
  const adminUrl = required("DATABASE_ADMIN_URL");
  const databaseUrl = required("DATABASE_URL");
  const apiKey = required("OPENAI_API_KEY");
  const model = process.env.PILOT_6P_MODEL?.trim() || "gpt-5-mini";
  if (!/^[a-zA-Z0-9._-]{3,100}$/.test(model))
    throw new Error("PILOT_6P_MODEL_INVALID");
  const inputCostPerMillion = boundedNumber(
      "PILOT_6P_INPUT_COST_PER_MILLION",
      0.25,
      0,
      1_000,
    ),
    outputCostPerMillion = boundedNumber(
      "PILOT_6P_OUTPUT_COST_PER_MILLION",
      2,
      0,
      1_000,
    ),
    dailyCostLimit = boundedNumber("PILOT_6P_DAILY_COST_LIMIT", 1.25, 0.01, 25),
    monthlyCostLimit = boundedNumber(
      "PILOT_6P_MONTHLY_COST_LIMIT",
      2,
      dailyCostLimit,
      100,
    );
  if (
    !/127\.0\.0\.1|localhost/.test(adminUrl) ||
    !/127\.0\.0\.1|localhost/.test(databaseUrl)
  )
    throw new Error("PILOT_6P_LOCAL_DATABASE_REQUIRED");

  const root = resolve(import.meta.dirname, "..");
  const dataset = datasetSchema.parse(
    JSON.parse(
      await readFile(
        resolve(root, "config/pilots/aurora-media-6p-stories.json"),
        "utf8",
      ),
    ),
  );
  const requestedKeys = new Set(
    (process.env.PILOT_6P_STORY_KEYS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const stories = requestedKeys.size
    ? dataset.stories.filter((story) => requestedKeys.has(story.key))
    : dataset.stories;
  if (!stories.length) throw new Error("PILOT_6P_STORY_SELECTION_EMPTY");
  const profileConfig = profileSchema.parse(
    JSON.parse(
      await readFile(
        resolve(root, "config/media-profiles/aurora-media.json"),
        "utf8",
      ),
    ),
  );
  const now = Date.now();
  for (const story of stories) {
    const age = (now - Date.parse(story.publishedAt)) / 3_600_000;
    if (age < -1 || age > dataset.freshnessWindowHours)
      throw new Error(
        `PILOT_STORY_OUTSIDE_FRESHNESS_WINDOW:${story.key}:${age.toFixed(1)}h`,
      );
  }

  const ids = await seedLocalTestData(adminUrl);
  const admin = createPool(adminUrl, "redi-control-pilot-6p-setup");
  await admin.query(
    `INSERT INTO control.feature_flags(tenant_id,name,enabled) VALUES($1,'module.ai',true)
     ON CONFLICT(tenant_id,name) DO UPDATE SET enabled=true,updated_at=now()`,
    [ids.tenantA],
  );
  await admin.query(
    `UPDATE control.installation_entitlements SET enabled_modules=array_append(enabled_modules,'ai')
      WHERE installation_id=$1 AND NOT ('ai'=ANY(enabled_modules))`,
    [ids.installationA],
  );
  await admin.query(
    `UPDATE control.installation_profiles SET enabled_modules=array_append(enabled_modules,'ai')
      WHERE installation_id=$1 AND NOT ('ai'=ANY(enabled_modules))`,
    [ids.installationA],
  );
  await admin.end();

  const pool = createPool(databaseUrl, "redi-control-pilot-6p");
  const secrets = new InMemorySecretProvider();
  const secretReference = "secret://pilot-6p/openai";
  secrets.set(secretReference, apiKey);
  const gateway = new AiGateway([
    new OpenAiResponsesProvider("openai", secrets, {
      secretReference,
      tenantId: ids.tenantA,
      connectionId: ids.installationA,
      inputCostPerMillion,
      outputCostPerMillion,
      timeoutMs: 90_000,
    }),
  ]);
  const media = new MediaIntelligenceService(pool);
  const source = new SourceIngestionService(pool);
  const evidence = new EvidenceIntelligenceService(pool, gateway);
  const correlationId = randomUUID();
  const sections = (
    profileConfig.editorialConfig.sections as {
      name: string;
      enabled: boolean;
    }[]
  )
    .filter((section) => section.enabled)
    .map((section) => section.name);
  const profile = await media.createProfile({
    tenantId: ids.tenantA,
    workspaceId: ids.workspaceA,
    actorUserId: ids.adminUser,
    ...profileConfig.identity,
    categories: sections,
    toneRules: JSON.stringify(profileConfig.editorialConfig.style ?? {}),
    excludedTopics: profileConfig.excludedTopics,
    restrictedTopics: profileConfig.restrictedTopics,
    verificationRequirements: (profileConfig.editorialConfig.verification ??
      {}) as Record<string, unknown>,
    destinationPreferences: ["website", "facebook", "instagram"],
    cadence: (profileConfig.editorialConfig.publishing ?? {}) as Record<
      string,
      unknown
    >,
    editorialConfig: profileConfig.editorialConfig as never,
    correlationId,
  });
  const profileId = getId(profile);
  const tokenLimits: Record<(typeof aiOperations)[number], number> = {
    claim_extraction: 3500,
    evidence_comparison: 4000,
    factual_synthesis: 5000,
    grounding_validation: 3500,
    editorial_transformation: 6000,
    editorial_grounding_validation: 3500,
  };
  await evidence.configure({
    tenantId: ids.tenantA,
    workspaceId: ids.workspaceA,
    actorUserId: ids.adminUser,
    routes: aiOperations.map((operation) => ({
      operation,
      providerId: "openai",
      model,
      promptVersion:
        process.env.PILOT_6P_PROMPT_VERSION?.trim() ||
        "aurora-media-pilot-6p-v2",
      maxOutputTokens: tokenLimits[operation],
    })),
    dailyCostLimit,
    monthlyCostLimit,
    maximumConcurrency: 1,
    correlationId,
  });

  const results: StoryResult[] = [];
  for (const story of stories) {
    const started = Date.now();
    const result: StoryResult = {
      key: story.key,
      title: story.title,
      category: story.category,
      source: story.url,
      sourceTier: story.sourceTier,
      publishedAt: story.publishedAt,
      startedAt: new Date(started).toISOString(),
      completedAt: "",
      elapsedMs: 0,
      stage: "case",
      status: "failed",
      claimProposalCount: 0,
      acceptedClaimCount: 0,
      evidenceProposalCount: 0,
      acceptedEvidenceCount: 0,
      verificationStates: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    };
    try {
      const researchCase = await media.createCase({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        profileId,
        actorUserId: ids.adminUser,
        title: story.title,
        topic: story.category,
        notes: `Pilot 6P real-source acceptance case. Declared source tier: ${story.sourceTier}.`,
        freshnessAt: new Date(story.publishedAt),
        correlationId,
      });
      const caseId = getId(researchCase);
      result.caseId = caseId;
      result.stage = "discovery";
      const run = await source.start({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        actorUserId: ids.adminUser,
        method: "manual",
        url: story.url,
        idempotencyKey: `pilot-6p-source-${story.key}`,
        correlationId,
      });
      const job = await claimPilotSourceJob(pool, ids.tenantA, getId(run));
      if (!job) throw new Error("PILOT_SOURCE_JOB_NOT_CLAIMED");
      try {
        await source.process(job);
        await finishJob(pool, job, { status: "succeeded" });
      } catch (error) {
        await finishJob(pool, job, {
          status: "failed",
          error: safeError(error),
        }).catch(() => undefined);
        throw error;
      }
      const resultIds = await withTenant(pool, ids.tenantA, async (client) =>
        (
          await client.query<{ id: string }>(
            "SELECT id FROM control.discovery_results WHERE discovery_run_id=$1 AND retrieval_status='succeeded' ORDER BY created_at LIMIT 5",
            [getId(run)],
          )
        ).rows.map((row) => row.id),
      );
      if (!resultIds.length) throw new Error("PILOT_SOURCE_RETRIEVAL_EMPTY");
      await source.attach({
        tenantId: ids.tenantA,
        runId: getId(run),
        resultIds,
        caseId,
        actorUserId: ids.adminUser,
        correlationId,
      });

      result.stage = "claims";
      await evidence.extractClaims({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        actorUserId: ids.adminUser,
        idempotencyKey: `pilot-6p-claims-${story.key}`,
        correlationId,
      });
      let state = await evidence.compareEvidence({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        actorUserId: ids.adminUser,
        idempotencyKey: `pilot-6p-evidence-${story.key}`,
        correlationId,
      });
      result.claimProposalCount = state.claimProposals.length;
      result.evidenceProposalCount = state.evidenceProposals.length;
      result.verificationStates = [
        ...new Set(
          state.claimProposals.map((proposal) =>
            asString(proposal.proposedVerificationState),
          ),
        ),
      ];

      result.stage = "human-claims-review";
      const supportedClaimIds = new Set(
        state.evidenceProposals
          .filter((proposal) =>
            ["supports", "primary_evidence"].includes(
              asString(proposal.relationship),
            ),
          )
          .map((proposal) => asString(proposal.claimProposalId)),
      );
      const acceptedProposals = new Set<string>();
      for (const proposal of state.claimProposals) {
        const id = asString(proposal.id);
        const stateName = asString(proposal.proposedVerificationState);
        const accept =
          supportedClaimIds.has(id) &&
          !["unverified", "conflicting"].includes(stateName);
        const decision = await evidence.decideClaim({
          tenantId: ids.tenantA,
          proposalId: id,
          actorUserId: ids.adminUser,
          decision: accept ? "accepted" : "rejected",
          correlationId,
        });
        if (accept && decision.claimId) acceptedProposals.add(id);
      }
      for (const proposal of state.evidenceProposals) {
        const accept =
          acceptedProposals.has(asString(proposal.claimProposalId)) &&
          ["supports", "primary_evidence"].includes(
            asString(proposal.relationship),
          );
        await evidence.decideEvidence({
          tenantId: ids.tenantA,
          proposalId: asString(proposal.id),
          actorUserId: ids.adminUser,
          decision: accept ? "accepted" : "rejected",
          correlationId,
        });
        if (accept) result.acceptedEvidenceCount += 1;
      }
      result.acceptedClaimCount = acceptedProposals.size;
      if (!result.acceptedClaimCount || !result.acceptedEvidenceCount) {
        result.status = "rejected";
        result.failure =
          "No claim/evidence pair passed the conservative human-review gate.";
        continue;
      }

      result.stage = "evidence-pack";
      const pack = await evidence.buildEvidencePack({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        actorUserId: ids.adminUser,
        correlationId,
      });
      result.stage = "factual-synthesis";
      state = await evidence.synthesize({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        evidencePackId: pack.id,
        actorUserId: ids.adminUser,
        idempotencyKey: `pilot-6p-synthesis-${story.key}`,
        validationIdempotencyKey: `pilot-6p-synthesis-validation-${story.key}`,
        correlationId,
      });
      const synthesis = state.syntheses[0];
      result.synthesisApprovalReady = Boolean(synthesis?.approvalReady);
      if (!synthesis || !result.synthesisApprovalReady) {
        result.status = "rejected";
        result.failure =
          "Grounding validation did not mark factual synthesis approval-ready.";
        continue;
      }
      const contextPack = await evidence.buildEditorialContextPack({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        actorUserId: ids.adminUser,
        correlationId,
      });
      result.stage = "editorial-transformation";
      state = await evidence.transformEditorially({
        tenantId: ids.tenantA,
        workspaceId: ids.workspaceA,
        caseId,
        synthesisId: getId(synthesis),
        editorialContextPackId: contextPack.id,
        actorUserId: ids.adminUser,
        idempotencyKey: `pilot-6p-editorial-${story.key}`,
        validationIdempotencyKey: `pilot-6p-editorial-validation-${story.key}`,
        correlationId,
      });
      const draft = state.editorialDrafts[0];
      result.editorialApprovalReady = Boolean(draft?.approvalReady);
      if (draft) result.editorialDraftId = getId(draft);
      result.editorialDraft = draft?.draft;
      result.validation = draft?.validation;
      result.usage = {
        inputTokens: Number(state.usage.inputTokens ?? 0),
        outputTokens: Number(state.usage.outputTokens ?? 0),
        estimatedCost: Number(state.usage.cost ?? 0),
      };
      result.status = result.editorialApprovalReady ? "completed" : "rejected";
      result.stage = "human-editorial-review";
      if (!result.editorialApprovalReady)
        result.failure =
          "Editorial grounding/policy validation requires rejection or editing.";
    } catch (error) {
      result.status = "failed";
      result.failure = safeError(error);
    } finally {
      const completed = Date.now();
      result.completedAt = new Date(completed).toISOString();
      result.elapsedMs = completed - started;
      if (result.caseId && result.usage.inputTokens === 0) {
        const state = await evidence
          .getState({ tenantId: ids.tenantA, caseId: result.caseId })
          .catch(() => undefined);
        if (state)
          result.usage = {
            inputTokens: Number(state.usage.inputTokens ?? 0),
            outputTokens: Number(state.usage.outputTokens ?? 0),
            estimatedCost: Number(state.usage.cost ?? 0),
          };
      }
      results.push(result);
      console.log(
        JSON.stringify({
          story: story.key,
          status: result.status,
          stage: result.stage,
          cost: result.usage.estimatedCost,
          elapsedMs: result.elapsedMs,
        }),
      );
    }
  }

  const output = {
    schemaVersion: 1,
    pilot: "6P",
    generatedAt: new Date().toISOString(),
    provider: {
      id: "openai",
      model,
      store: false,
      inputCostPerMillion,
      outputCostPerMillion,
    },
    budget: {
      dailyCostLimit,
      monthlyCostLimit,
      maximumConcurrency: 1,
    },
    tenantId: ids.tenantA,
    workspaceId: ids.workspaceA,
    profileId,
    results,
  };
  const outputPath = resolve(
    root,
    process.env.PILOT_6P_RESULT_FILE?.trim() || ".pilot-6p-results.json",
  );
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await pool.end();
  console.log(
    JSON.stringify({ complete: true, outputPath, stories: results.length }),
  );
}

main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
