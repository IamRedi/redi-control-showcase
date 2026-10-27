import type { Permission } from "@redi-control/core";
import type { InstallationApiService } from "@redi-control/installation";
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
  reply
    .code(503)
    .send({ error: "Installation API administration unavailable" });

export function registerInstallationApiAdminRoutes(
  app: FastifyInstance,
  service: InstallationApiService | null,
  authorize: Authorize,
): void {
  app.get("/api/installation-api/clients", async (request, reply) => {
    if (!service) return unavailable(reply);
    const context = await authorize(request, reply, "tenant:admin", {
      mfa: true,
    });
    if (!context) return;
    const clients = await service.listForTenant({
      actorUserId: context.session.userId,
      tenantId: context.session.tenantId,
    });
    return reply.header("cache-control", "private, no-store").send({
      clients,
      policy: {
        scope: "control:read",
        accessTokenLifetimeSeconds: 900,
        requestLimitPerMinute: 60,
        exchangeLimitPerMinute: 10,
        writeApiAvailable: false,
      },
    });
  });

  app.post<{ Body: { displayName: string; lifetimeDays: number } }>(
    "/api/installation-api/clients",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName", "lifetimeDays"],
          properties: {
            displayName: {
              type: "string",
              minLength: 2,
              maxLength: 120,
              pattern: "\\S",
            },
            lifetimeDays: { type: "integer", minimum: 1, maximum: 365 },
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
      return reply
        .header("cache-control", "no-store")
        .code(201)
        .send(
          await service.issueForTenant({
            actorUserId: context.session.userId,
            tenantId: context.session.tenantId,
            ...request.body,
            correlationId: request.id,
          }),
        );
    },
  );

  app.post<{ Params: { clientId: string }; Body: Record<string, never> }>(
    "/api/installation-api/clients/:clientId/rotate",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["clientId"],
          properties: { clientId: uuid },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!service) return unavailable(reply);
      const context = await authorize(request, reply, "tenant:admin", {
        csrf: true,
        mfa: true,
      });
      if (!context) return;
      return reply.header("cache-control", "no-store").send(
        await service.rotateForTenant({
          actorUserId: context.session.userId,
          tenantId: context.session.tenantId,
          clientId: request.params.clientId,
          correlationId: request.id,
        }),
      );
    },
  );

  app.delete<{ Params: { clientId: string } }>(
    "/api/installation-api/clients/:clientId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["clientId"],
          properties: { clientId: uuid },
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
      await service.revokeForTenant({
        actorUserId: context.session.userId,
        tenantId: context.session.tenantId,
        clientId: request.params.clientId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );
}
