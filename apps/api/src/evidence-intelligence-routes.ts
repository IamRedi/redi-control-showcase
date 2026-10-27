import type { Permission } from "@redi-control/core";
import type { EvidenceIntelligenceService } from "@redi-control/evidence-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = { session: { tenantId: string; userId: string } };
type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  checks?: { csrf?: boolean; mfa?: boolean },
) => Promise<Context | null>;
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "Evidence intelligence is not configured" });
function validate(
  body: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Object.assign(new Error("INVALID_EVIDENCE_INTELLIGENCE_REQUEST"), {
      statusCode: 400,
    });
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some(
      (key) =>
        value[key] === undefined || value[key] === null || value[key] === "",
    )
  )
    throw Object.assign(new Error("INVALID_EVIDENCE_INTELLIGENCE_REQUEST"), {
      statusCode: 400,
    });
}

export function registerEvidenceIntelligenceRoutes(
  app: FastifyInstance,
  service: EvidenceIntelligenceService | null,
  authorize: Authorize,
) {
  app.get<{ Params: { caseId: string } }>(
    "/api/research/cases/:caseId/intelligence",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return service.getState({
        tenantId: c.session.tenantId,
        caseId: r.params.caseId,
      });
    },
  );
  app.post<{
    Body: {
      workspaceId: string;
      routes: {
        operation:
          | "claim_extraction"
          | "evidence_comparison"
          | "factual_synthesis"
          | "grounding_validation"
          | "editorial_transformation"
          | "editorial_grounding_validation";
        providerId: string;
        model: string;
        promptVersion: string;
        maxOutputTokens: number;
      }[];
      dailyCostLimit: number;
      monthlyCostLimit: number;
      maximumConcurrency: number;
    };
  }>("/api/research/ai/configuration", async (r, p) => {
    validate(
      r.body,
      [
        "workspaceId",
        "routes",
        "dailyCostLimit",
        "monthlyCostLimit",
        "maximumConcurrency",
      ],
      [
        "workspaceId",
        "routes",
        "dailyCostLimit",
        "monthlyCostLimit",
        "maximumConcurrency",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "tenant:admin", { csrf: true, mfa: true });
    if (!c) return;
    return service.configure({
      ...r.body,
      tenantId: c.session.tenantId,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.post<{
    Params: { caseId: string };
    Body: { workspaceId: string; idempotencyKey: string };
  }>("/api/research/cases/:caseId/intelligence/extract", async (r, p) => {
    validate(
      r.body,
      ["workspaceId", "idempotencyKey"],
      ["workspaceId", "idempotencyKey"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return service.extractClaims({
      ...r.body,
      caseId: r.params.caseId,
      tenantId: c.session.tenantId,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.post<{
    Params: { caseId: string };
    Body: { workspaceId: string; idempotencyKey: string };
  }>("/api/research/cases/:caseId/intelligence/compare", async (r, p) => {
    validate(
      r.body,
      ["workspaceId", "idempotencyKey"],
      ["workspaceId", "idempotencyKey"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return service.compareEvidence({
      ...r.body,
      caseId: r.params.caseId,
      tenantId: c.session.tenantId,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.post<{
    Params: { proposalId: string };
    Body: { decision: "accepted" | "rejected"; editedStatement?: string };
  }>("/api/research/claim-proposals/:proposalId/decision", async (r, p) => {
    validate(r.body, ["decision", "editedStatement"], ["decision"]);
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return service.decideClaim({
      ...r.body,
      proposalId: r.params.proposalId,
      tenantId: c.session.tenantId,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.post<{
    Params: { proposalId: string };
    Body: { decision: "accepted" | "rejected" };
  }>("/api/research/evidence-proposals/:proposalId/decision", async (r, p) => {
    validate(r.body, ["decision"], ["decision"]);
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return service.decideEvidence({
      ...r.body,
      proposalId: r.params.proposalId,
      tenantId: c.session.tenantId,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.post<{ Params: { caseId: string }; Body: { workspaceId: string } }>(
    "/api/research/cases/:caseId/evidence-packs",
    async (r, p) => {
      validate(r.body, ["workspaceId"], ["workspaceId"]);
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!c) return;
      return p.code(201).send(
        await service.buildEvidencePack({
          ...r.body,
          caseId: r.params.caseId,
          tenantId: c.session.tenantId,
          actorUserId: c.session.userId,
          correlationId: r.id,
        }),
      );
    },
  );
  app.post<{
    Params: { caseId: string };
    Body: {
      workspaceId: string;
      evidencePackId: string;
      idempotencyKey: string;
      validationIdempotencyKey: string;
    };
  }>("/api/research/cases/:caseId/syntheses", async (r, p) => {
    validate(
      r.body,
      [
        "workspaceId",
        "evidencePackId",
        "idempotencyKey",
        "validationIdempotencyKey",
      ],
      [
        "workspaceId",
        "evidencePackId",
        "idempotencyKey",
        "validationIdempotencyKey",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:approve", {
      csrf: true,
      mfa: true,
    });
    if (!c) return;
    return p.code(201).send(
      await service.synthesize({
        ...r.body,
        caseId: r.params.caseId,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{ Params: { synthesisId: string }; Body: Record<string, never> }>(
    "/api/research/syntheses/:synthesisId/promote",
    async (r, p) => {
      validate(r.body, []);
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!c) return;
      return service.promote({
        tenantId: c.session.tenantId,
        synthesisId: r.params.synthesisId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      });
    },
  );
  app.post<{ Params: { caseId: string }; Body: { workspaceId: string } }>(
    "/api/research/cases/:caseId/editorial-context-packs",
    async (r, p) => {
      validate(r.body, ["workspaceId"], ["workspaceId"]);
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!c) return;
      return p.code(201).send(
        await service.buildEditorialContextPack({
          ...r.body,
          caseId: r.params.caseId,
          tenantId: c.session.tenantId,
          actorUserId: c.session.userId,
          correlationId: r.id,
        }),
      );
    },
  );
  app.post<{
    Params: { caseId: string };
    Body: {
      workspaceId: string;
      synthesisId: string;
      editorialContextPackId: string;
      idempotencyKey: string;
      validationIdempotencyKey: string;
    };
  }>("/api/research/cases/:caseId/editorial-drafts", async (r, p) => {
    validate(
      r.body,
      [
        "workspaceId",
        "synthesisId",
        "editorialContextPackId",
        "idempotencyKey",
        "validationIdempotencyKey",
      ],
      [
        "workspaceId",
        "synthesisId",
        "editorialContextPackId",
        "idempotencyKey",
        "validationIdempotencyKey",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:approve", {
      csrf: true,
      mfa: true,
    });
    if (!c) return;
    return p.code(201).send(
      await service.transformEditorially({
        ...r.body,
        caseId: r.params.caseId,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { draftId: string };
    Body: {
      workspaceId: string;
      draft: unknown;
      reason: string;
      validationIdempotencyKey: string;
    };
  }>("/api/research/editorial-drafts/:draftId/revisions", async (r, p) => {
    validate(
      r.body,
      ["workspaceId", "draft", "reason", "validationIdempotencyKey"],
      ["workspaceId", "draft", "reason", "validationIdempotencyKey"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:approve", {
      csrf: true,
      mfa: true,
    });
    if (!c) return;
    return p.code(201).send(
      await service.reviseEditorialDraft({
        ...r.body,
        draftId: r.params.draftId,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { draftId: string };
    Body: { decision: "approved" | "rejected" };
  }>("/api/research/editorial-drafts/:draftId/decision", async (r, p) => {
    validate(r.body, ["decision"], ["decision"]);
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:approve", {
      csrf: true,
      mfa: true,
    });
    if (!c) return;
    return service.decideEditorialDraft({
      tenantId: c.session.tenantId,
      draftId: r.params.draftId,
      actorUserId: c.session.userId,
      decision: r.body.decision,
      correlationId: r.id,
    });
  });
  app.post<{ Params: { draftId: string }; Body: Record<string, never> }>(
    "/api/research/editorial-drafts/:draftId/promote",
    async (r, p) => {
      validate(r.body, []);
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!c) return;
      return service.promoteEditorialDraft({
        tenantId: c.session.tenantId,
        draftId: r.params.draftId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      });
    },
  );
}
