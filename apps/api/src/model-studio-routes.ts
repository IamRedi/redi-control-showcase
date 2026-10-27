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

const uuid = { type: "string", format: "uuid" } as const;
const operations = [
  "claim_extraction",
  "evidence_comparison",
  "factual_synthesis",
  "grounding_validation",
  "editorial_transformation",
  "editorial_grounding_validation",
  "editorial_image_generation",
  "channel_adaptation",
] as const;
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "Model Studio is not configured" });

export function registerModelStudioRoutes(
  app: FastifyInstance,
  service: EvidenceIntelligenceService | null,
  authorize: Authorize,
): void {
  app.get<{ Querystring: { workspaceId: string } }>(
    "/api/workzone/model-studio",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: uuid },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "tenant:admin", {
        mfa: true,
      });
      if (!context) return;
      return service.getModelStudio({
        tenantId: context.session.tenantId,
        workspaceId: request.query.workspaceId,
      });
    },
  );

  app.put<{
    Body: {
      workspaceId: string;
      dailyCostLimit: number;
      monthlyCostLimit: number;
      maximumConcurrency: number;
    };
  }>(
    "/api/workzone/model-studio/budget",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "dailyCostLimit",
            "monthlyCostLimit",
            "maximumConcurrency",
          ],
          properties: {
            workspaceId: uuid,
            dailyCostLimit: { type: "number", minimum: 0, maximum: 1_000_000 },
            monthlyCostLimit: {
              type: "number",
              minimum: 0,
              maximum: 10_000_000,
            },
            maximumConcurrency: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return service.updateModelBudget({
        ...request.body,
        tenantId: context.session.tenantId,
        actorUserId: context.session.userId,
        correlationId: request.id,
      });
    },
  );

  app.post<{
    Body: {
      workspaceId: string;
      operation: (typeof operations)[number];
      providerId: string;
      model: string;
      promptVersion: string;
      maxOutputTokens: number;
      dataPolicyStatus: "unreviewed" | "approved" | "rejected";
      rationale: string;
    };
  }>(
    "/api/workzone/model-studio/proposals",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "operation",
            "providerId",
            "model",
            "promptVersion",
            "maxOutputTokens",
            "dataPolicyStatus",
            "rationale",
          ],
          properties: {
            workspaceId: uuid,
            operation: { enum: [...operations] },
            providerId: {
              type: "string",
              minLength: 1,
              maxLength: 120,
              pattern: "\\S",
            },
            model: {
              type: "string",
              minLength: 1,
              maxLength: 160,
              pattern: "\\S",
            },
            promptVersion: {
              type: "string",
              minLength: 1,
              maxLength: 80,
              pattern: "\\S",
            },
            maxOutputTokens: { type: "integer", minimum: 64, maximum: 32_000 },
            dataPolicyStatus: { enum: ["unreviewed", "approved", "rejected"] },
            rationale: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              pattern: "\\S",
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return reply.code(201).send(
        await service.proposeModelRoute({
          ...request.body,
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          correlationId: request.id,
        }),
      );
    },
  );

  app.post<{
    Params: { proposalId: string };
    Body: {
      workspaceId: string;
      datasetVersion: string;
      sampleSize: number;
      schemaPassRate: number;
      groundingPassRate: number;
      safetyPassRate: number;
      languagePassRate: number;
      decision: "passed" | "failed";
      notes?: string;
      evaluatedAt: string;
    };
  }>(
    "/api/workzone/model-studio/proposals/:proposalId/evaluations",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["proposalId"],
          properties: { proposalId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "datasetVersion",
            "sampleSize",
            "schemaPassRate",
            "groundingPassRate",
            "safetyPassRate",
            "languagePassRate",
            "decision",
            "evaluatedAt",
          ],
          properties: {
            workspaceId: uuid,
            datasetVersion: {
              type: "string",
              minLength: 1,
              maxLength: 120,
              pattern: "\\S",
            },
            sampleSize: { type: "integer", minimum: 1, maximum: 100_000 },
            schemaPassRate: { type: "number", minimum: 0, maximum: 100 },
            groundingPassRate: { type: "number", minimum: 0, maximum: 100 },
            safetyPassRate: { type: "number", minimum: 0, maximum: 100 },
            languagePassRate: { type: "number", minimum: 0, maximum: 100 },
            decision: { enum: ["passed", "failed"] },
            notes: { type: "string", maxLength: 2000 },
            evaluatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return reply.code(201).send(
        await service.recordModelEvaluation({
          ...request.body,
          proposalId: request.params.proposalId,
          evaluatedAt: new Date(request.body.evaluatedAt),
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          correlationId: request.id,
        }),
      );
    },
  );
}
