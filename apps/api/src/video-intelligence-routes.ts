import type { Permission } from "@redi-control/core";
import type { SocialPublishingService } from "@redi-control/media-social";
import type { UnifiedContentService } from "@redi-control/unified-content";
import {
  VideoIntelligenceError,
  type VideoAspectRatio,
  type VideoEvidenceKind,
  type VideoIntelligenceService,
  type VideoProgramId,
  type VideoTargetLanguage,
} from "@redi-control/video-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = { session: { tenantId: string; userId: string } };
type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  checks?: { csrf?: boolean; mfa?: boolean },
) => Promise<Context | null>;
const uuid = { type: "string", format: "uuid" } as const;
const bounded = (minimum: number, maximum: number) =>
  ({
    type: "string",
    minLength: minimum,
    maxLength: maximum,
    pattern: "\\S",
  }) as const;
const commandBody = {
  workspaceId: uuid,
  idempotencyKey: uuid,
  expectedRevision: { type: "integer", minimum: 1, maximum: 1_000_000 },
} as const;
const sendError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof VideoIntelligenceError)
    return reply.code(error.statusCode).send({ error: error.message });
  throw error;
};

export function registerVideoIntelligenceRoutes(
  app: FastifyInstance,
  service: VideoIntelligenceService | null,
  socialPublishing: SocialPublishingService | null,
  unifiedContent: UnifiedContentService | null,
  authorize: Authorize,
): void {
  app.get<{ Querystring: { workspaceId: string } }>(
    "/api/video-intelligence/generation-policy",
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
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "tenant:admin", {
        mfa: true,
      });
      if (!context) return;
      try {
        return {
          policy: await service.getGenerationPolicy({
            tenantId: context.session.tenantId,
            workspaceId: request.query.workspaceId,
          }),
        };
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.put<{
    Body: {
      workspaceId: string;
      dailyCreditLimit: number;
      monthlyCreditLimit: number;
      maximumConcurrency: number;
      enabled: boolean;
    };
  }>(
    "/api/video-intelligence/generation-policy",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "dailyCreditLimit",
            "monthlyCreditLimit",
            "maximumConcurrency",
            "enabled",
          ],
          properties: {
            workspaceId: uuid,
            dailyCreditLimit: {
              type: "integer",
              minimum: 0,
              maximum: 1_000_000,
            },
            monthlyCreditLimit: {
              type: "integer",
              minimum: 0,
              maximum: 10_000_000,
            },
            maximumConcurrency: {
              type: "integer",
              minimum: 1,
              maximum: 20,
            },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      try {
        return {
          policy: await service.updateGenerationPolicy({
            ...request.body,
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            correlationId: request.id,
          }),
        };
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/video-intelligence/overview",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            workspaceId: uuid,
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "platform:read");
      if (!context) return;
      try {
        return await service.snapshot({
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          ...(request.query.workspaceId
            ? { workspaceId: request.query.workspaceId }
            : {}),
        });
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post<{
    Body: {
      workspaceId: string;
      idempotencyKey: string;
      programId: VideoProgramId;
      topic: string;
      objective: string;
      audience: string;
      script: string;
      evidence: {
        kind: VideoEvidenceKind;
        title: string;
        sourceReference: string;
        summary: string;
        aggregateCount?: number;
      }[];
    };
  }>(
    "/api/video-intelligence/briefs",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "idempotencyKey",
            "programId",
            "topic",
            "objective",
            "audience",
            "script",
            "evidence",
          ],
          properties: {
            workspaceId: uuid,
            idempotencyKey: uuid,
            programId: { enum: ["product_faq_ads", "daily_news_flash"] },
            topic: bounded(3, 240),
            objective: bounded(10, 2000),
            audience: bounded(3, 500),
            script: bounded(20, 20_000),
            evidence: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "title", "sourceReference", "summary"],
                properties: {
                  kind: {
                    enum: [
                      "aggregate_audience_signal",
                      "verified_product_fact",
                      "approved_editorial_story",
                    ],
                  },
                  title: bounded(3, 240),
                  sourceReference: bounded(3, 500),
                  summary: bounded(10, 2000),
                  aggregateCount: {
                    type: "integer",
                    minimum: 2,
                    maximum: 1_000_000,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      try {
        return reply.code(201).send(
          await service.createBrief({
            ...request.body,
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post<{
    Params: { jobId: string };
    Body: {
      workspaceId: string;
      mediaAssetId: string;
      idempotencyKey: string;
      title: string;
      summary?: string;
    };
  }>(
    "/api/video-intelligence/render-jobs/:jobId/website-content",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["jobId"],
          properties: { jobId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "mediaAssetId", "idempotencyKey", "title"],
          properties: {
            workspaceId: uuid,
            mediaAssetId: uuid,
            idempotencyKey: uuid,
            title: bounded(1, 240),
            summary: bounded(1, 2_000),
          },
        },
      },
    },
    async (request, reply) => {
      if (!service || !unifiedContent)
        return reply
          .code(503)
          .send({ error: "Website content preparation is unavailable" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      const { workspaceId, mediaAssetId, ...copy } = request.body;
      return reply.code(201).send(
        await unifiedContent.createItemFromApprovedVideo({
          ...copy,
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          workspaceId,
          renderJobId: request.params.jobId,
          mediaAssetId,
          correlationId: request.id,
        }),
      );
    },
  );

  app.post<{
    Params: { jobId: string };
    Body: {
      workspaceId: string;
      mediaAssetId: string;
      idempotencyKey: string;
      decision: "approved" | "rejected";
      reason?: string;
    };
  }>(
    "/api/video-intelligence/render-jobs/:jobId/review-decision",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["jobId"],
          properties: { jobId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "mediaAssetId",
            "idempotencyKey",
            "decision",
          ],
          properties: {
            workspaceId: uuid,
            mediaAssetId: uuid,
            idempotencyKey: uuid,
            decision: { enum: ["approved", "rejected"] },
            reason: { type: "string", minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      try {
        return await service.decideRenderedAsset({
          ...request.body,
          jobId: request.params.jobId,
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          correlationId: request.id,
        });
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post<{
    Params: { jobId: string };
    Body: {
      workspaceId: string;
      mediaAssetId: string;
      accountIds: string[];
      idempotencyKey: string;
      title?: string;
      caption?: string;
      description?: string;
    };
  }>(
    "/api/video-intelligence/render-jobs/:jobId/distribution-draft",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["jobId"],
          properties: { jobId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "mediaAssetId",
            "accountIds",
            "idempotencyKey",
          ],
          properties: {
            workspaceId: uuid,
            mediaAssetId: uuid,
            accountIds: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              uniqueItems: true,
              items: uuid,
            },
            idempotencyKey: uuid,
            title: bounded(1, 100),
            caption: bounded(1, 5_000),
            description: bounded(1, 5_000),
          },
        },
      },
    },
    async (request, reply) => {
      if (!service || !socialPublishing)
        return reply
          .code(503)
          .send({ error: "Video distribution preparation is unavailable" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      const { workspaceId, mediaAssetId, accountIds, ...copy } = request.body;
      return reply.code(201).send(
        await socialPublishing.createDraftFromApprovedVideo({
          ...copy,
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          workspaceId,
          renderJobId: request.params.jobId,
          mediaAssetId,
          accountIds,
          correlationId: request.id,
        }),
      );
    },
  );

  app.post<{
    Params: { briefId: string };
    Body: {
      workspaceId: string;
      idempotencyKey: string;
      expectedRevision: number;
      script: string;
    };
  }>(
    "/api/video-intelligence/briefs/:briefId/revisions",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["briefId"],
          properties: { briefId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "idempotencyKey",
            "expectedRevision",
            "script",
          ],
          properties: { ...commandBody, script: bounded(20, 20_000) },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      try {
        return reply.code(201).send(
          await service.reviseScript({
            ...request.body,
            briefId: request.params.briefId,
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post<{
    Params: { briefId: string };
    Body: {
      workspaceId: string;
      idempotencyKey: string;
      expectedRevision: number;
    };
  }>(
    "/api/video-intelligence/briefs/:briefId/review",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["briefId"],
          properties: { briefId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "idempotencyKey", "expectedRevision"],
          properties: commandBody,
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
      });
      if (!context) return;
      try {
        return reply.code(201).send(
          await service.requestApproval({
            ...request.body,
            briefId: request.params.briefId,
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post<{
    Params: { briefId: string };
    Body: {
      workspaceId: string;
      idempotencyKey: string;
      expectedRevision: number;
      decision: "approved" | "rejected";
      reason?: string;
    };
  }>(
    "/api/video-intelligence/briefs/:briefId/decision",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["briefId"],
          properties: { briefId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "idempotencyKey",
            "expectedRevision",
            "decision",
          ],
          properties: {
            ...commandBody,
            decision: { enum: ["approved", "rejected"] },
            reason: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      try {
        return await service.decideApproval({
          ...request.body,
          briefId: request.params.briefId,
          tenantId: context.session.tenantId,
          actorUserId: context.session.userId,
          correlationId: request.id,
        });
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post<{
    Params: { briefId: string };
    Body: {
      workspaceId: string;
      idempotencyKey: string;
      expectedRevision: number;
      targetLanguage: VideoTargetLanguage;
      maxDurationSeconds: number;
      rightsReference: string;
      outputs: VideoAspectRatio[];
    };
  }>(
    "/api/video-intelligence/briefs/:briefId/render-preparations",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["briefId"],
          properties: { briefId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "idempotencyKey",
            "expectedRevision",
            "targetLanguage",
            "maxDurationSeconds",
            "rightsReference",
            "outputs",
          ],
          properties: {
            ...commandBody,
            targetLanguage: { enum: ["en", "de", "sq"] },
            maxDurationSeconds: {
              type: "integer",
              minimum: 15,
              maximum: 180,
            },
            rightsReference: bounded(3, 500),
            outputs: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              uniqueItems: true,
              items: { enum: ["9:16", "16:9"] },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Video Intelligence is unavailable" });
      const context = await authorize(request, reply, "content:edit", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      try {
        return reply.code(201).send(
          await service.prepareRender({
            ...request.body,
            briefId: request.params.briefId,
            tenantId: context.session.tenantId,
            actorUserId: context.session.userId,
            correlationId: request.id,
          }),
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );
}
