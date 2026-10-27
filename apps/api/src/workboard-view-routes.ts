import type { Permission } from "@redi-control/core";
import {
  workboardAssignmentScopes,
  workboardFocuses,
  workboardHandoffFilters,
  workboardSortOrders,
  workboardViewStages,
  type WorkboardViewService,
} from "@redi-control/media-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = { session: { tenantId: string; userId: string } };
type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  checks?: { csrf?: boolean; mfa?: boolean },
) => Promise<Context | null>;
const uuid = { type: "string", format: "uuid" } as const;
const viewName = {
  type: "string",
  minLength: 2,
  maxLength: 80,
  pattern: "\\S",
} as const;
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "Workboard views are unavailable" });

export function registerWorkboardViewRoutes(
  app: FastifyInstance,
  service: WorkboardViewService | null,
  authorize: Authorize,
): void {
  app.get("/api/workzone/views", async (request, reply) => {
    if (!service) return unavailable(reply);
    const context = await authorize(request, reply, "platform:read");
    if (!context) return;
    return reply.send(
      await service.snapshot({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
      }),
    );
  });

  app.post<{
    Body: {
      workspaceId: string;
      name: string;
      stage: (typeof workboardViewStages)[number];
      query: string;
      assignmentScope: (typeof workboardAssignmentScopes)[number];
      focus: (typeof workboardFocuses)[number];
      handoffFilter?: (typeof workboardHandoffFilters)[number];
      sortOrder: (typeof workboardSortOrders)[number];
    };
  }>(
    "/api/workzone/views",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "workspaceId",
            "name",
            "stage",
            "query",
            "assignmentScope",
            "focus",
            "sortOrder",
          ],
          properties: {
            workspaceId: uuid,
            name: viewName,
            stage: { enum: [...workboardViewStages] },
            query: { type: "string", maxLength: 160 },
            assignmentScope: { enum: [...workboardAssignmentScopes] },
            focus: { enum: [...workboardFocuses] },
            handoffFilter: { enum: [...workboardHandoffFilters] },
            sortOrder: { enum: [...workboardSortOrders] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send(
        await service.save({
          actorUserId: context.session.userId,
          tenantId: context.session.tenantId,
          ...request.body,
          handoffFilter: request.body.handoffFilter ?? "all",
          correlationId: request.id,
        }),
      );
    },
  );

  app.delete<{ Params: { viewId: string } }>(
    "/api/workzone/views/:viewId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["viewId"],
          properties: { viewId: uuid },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      await service.delete({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        viewId: request.params.viewId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.put<{ Body: { viewId: string | null } }>(
    "/api/workzone/views/default",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["viewId"],
          properties: { viewId: { anyOf: [uuid, { type: "null" }] } },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      await service.setDefault({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        viewId: request.body.viewId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { viewId: string }; Body: { name: string } }>(
    "/api/workzone/views/:viewId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["viewId"],
          properties: { viewId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name: viewName },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      await service.rename({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        viewId: request.params.viewId,
        name: request.body.name,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { viewId: string }; Body: { name: string } }>(
    "/api/workzone/views/:viewId/duplicate",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["viewId"],
          properties: { viewId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name: viewName },
        },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "platform:read", {
        csrf: true,
      });
      if (!context) return;
      return reply.code(201).send(
        await service.duplicate({
          actorUserId: context.session.userId,
          tenantId: context.session.tenantId,
          viewId: request.params.viewId,
          name: request.body.name,
          correlationId: request.id,
        }),
      );
    },
  );
}
