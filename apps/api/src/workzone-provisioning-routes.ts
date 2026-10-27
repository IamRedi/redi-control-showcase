import type { Permission } from "@redi-control/core";
import {
  workzoneResponsibilities,
  type WorkzoneProvisioningService,
} from "@redi-control/installation";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = { session: { tenantId: string; userId: string } };
type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  checks?: { csrf?: boolean; mfa?: boolean },
) => Promise<Context | null>;
const uuid = { type: "string", format: "uuid" } as const;
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "Workzone provisioning is unavailable" });

export function registerWorkzoneProvisioningRoutes(
  app: FastifyInstance,
  service: WorkzoneProvisioningService | null,
  authorize: Authorize,
): void {
  app.get("/api/workzone-provisioning", async (request, reply) => {
    if (!service) return unavailable(reply);
    const context = await authorize(request, reply, "tenant:admin", {
      mfa: true,
    });
    if (!context) return;
    return reply.header("cache-control", "private, no-store").send(
      await service.snapshot({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
      }),
    );
  });

  app.get<{ Params: { workspaceId: string } }>(
    "/api/workzone-provisioning/:workspaceId/lifecycle-impact",
    {
      schema: {
        params: {
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
      return reply.header("cache-control", "private, no-store").send(
        await service.lifecycleImpact({
          actorUserId: context.session.userId,
          tenantId: context.session.tenantId,
          workspaceId: request.params.workspaceId,
        }),
      );
    },
  );

  app.post<{
    Params: { workspaceId: string };
    Body: {
      action: "archive" | "restore";
      reason: string;
      idempotencyKey: string;
    };
  }>(
    "/api/workzone-provisioning/:workspaceId/lifecycle",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action", "reason", "idempotencyKey"],
          properties: {
            action: { enum: ["archive", "restore"] },
            reason: {
              type: "string",
              minLength: 10,
              maxLength: 1000,
              pattern: "\\S",
            },
            idempotencyKey: uuid,
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
      const result = await service.transitionLifecycle({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        workspaceId: request.params.workspaceId,
        ...request.body,
        correlationId: request.id,
      });
      return reply.code(result.outcome === "executed" ? 200 : 409).send(result);
    },
  );

  app.post<{
    Body: { slug: string; name: string; description: string };
  }>(
    "/api/workzone-provisioning",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "name", "description"],
          properties: {
            slug: { type: "string", pattern: "^[a-z][a-z0-9-]{1,62}$" },
            name: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              pattern: "\\S",
            },
            description: { type: "string", maxLength: 500 },
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
        await service.create({
          actorUserId: context.session.userId,
          tenantId: context.session.tenantId,
          ...request.body,
          correlationId: request.id,
        }),
      );
    },
  );

  app.patch<{
    Params: { workspaceId: string };
    Body: { name: string; description: string };
  }>(
    "/api/workzone-provisioning/:workspaceId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId"],
          properties: { workspaceId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description"],
          properties: {
            name: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              pattern: "\\S",
            },
            description: { type: "string", maxLength: 500 },
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
      await service.update({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        workspaceId: request.params.workspaceId,
        ...request.body,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.put<{
    Params: { workspaceId: string; userId: string };
    Body: { responsibility: (typeof workzoneResponsibilities)[number] };
  }>(
    "/api/workzone-provisioning/:workspaceId/members/:userId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "userId"],
          properties: { workspaceId: uuid, userId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["responsibility"],
          properties: {
            responsibility: { enum: [...workzoneResponsibilities] },
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
      return reply.send(
        await service.assign({
          actorUserId: context.session.userId,
          tenantId: context.session.tenantId,
          workspaceId: request.params.workspaceId,
          userId: request.params.userId,
          responsibility: request.body.responsibility,
          correlationId: request.id,
        }),
      );
    },
  );

  app.delete<{ Params: { workspaceId: string; userId: string } }>(
    "/api/workzone-provisioning/:workspaceId/members/:userId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceId", "userId"],
          properties: { workspaceId: uuid, userId: uuid },
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
      await service.remove({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        workspaceId: request.params.workspaceId,
        userId: request.params.userId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );
}
