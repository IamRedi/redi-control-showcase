import type { PlatformOwnerService } from "@redi-control/installation";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = {
  session: { tenantId: string; userId: string; sessionId: string };
};
type AuthorizePlatform = (
  request: FastifyRequest,
  reply: FastifyReply,
  mutation: boolean,
) => Promise<Context | null>;
const uuid = { type: "string", format: "uuid" } as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessGrant = (request: FastifyRequest) => {
  const value = request.headers["x-platform-access-grant"];
  return typeof value === "string" ? value : "";
};

export function registerPlatformOwnerRoutes(
  app: FastifyInstance,
  service: PlatformOwnerService | null,
  authorizePlatform: AuthorizePlatform,
): void {
  app.post<{ Body: { reason: string; lifetimeMinutes: number } }>(
    "/api/platform-owner/access",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason", "lifetimeMinutes"],
          properties: {
            reason: {
              type: "string",
              minLength: 10,
              maxLength: 500,
              pattern: "\\S",
            },
            lifetimeMinutes: { type: "integer", minimum: 1, maximum: 60 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      return reply.code(201).send(
        await service.beginAccess({
          actorUserId: context.session.userId,
          authorityTenantId: context.session.tenantId,
          reason: request.body.reason,
          lifetimeMinutes: request.body.lifetimeMinutes,
          correlationId: request.id,
        }),
      );
    },
  );

  app.get("/api/platform-owner/tenants", async (request, reply) => {
    if (!service)
      return reply
        .code(503)
        .send({ error: "Platform Owner Console is unavailable" });
    const context = await authorizePlatform(request, reply, false);
    if (!context) return;
    if (!UUID.test(accessGrant(request)))
      return reply
        .code(403)
        .send({ error: "Active platform access is required" });
    const inventory = await service.inventory({
      actorUserId: context.session.userId,
      authorityTenantId: context.session.tenantId,
      accessGrantId: accessGrant(request),
    });
    return {
      ...inventory,
      lifecycleRequests: inventory.lifecycleRequests.map(
        ({ requestedBy, ...item }) => ({
          ...item,
          requestedByCurrentUser: requestedBy === context.session.userId,
        }),
      ),
    };
  });

  app.post<{
    Body: {
      tenantSlug: string;
      tenantName: string;
      installationSlug: string;
      installationName: string;
      workspaceName: string;
      dataRegion: "EU" | "DE";
    };
  }>(
    "/api/platform-owner/tenants",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "tenantSlug",
            "tenantName",
            "installationSlug",
            "installationName",
            "workspaceName",
            "dataRegion",
          ],
          properties: {
            tenantSlug: { type: "string", pattern: "^[a-z][a-z0-9-]{1,62}$" },
            tenantName: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              pattern: "\\S",
            },
            installationSlug: {
              type: "string",
              pattern: "^[a-z][a-z0-9-]{1,62}$",
            },
            installationName: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              pattern: "\\S",
            },
            workspaceName: {
              type: "string",
              minLength: 2,
              maxLength: 160,
              pattern: "\\S",
            },
            dataRegion: { enum: ["EU", "DE"] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      return reply.code(201).send(
        await service.provision({
          ...request.body,
          actorUserId: context.session.userId,
          authorityTenantId: context.session.tenantId,
          accessGrantId: accessGrant(request),
          correlationId: request.id,
        }),
      );
    },
  );

  app.put<{
    Params: { tenantId: string };
    Body: {
      templateId: "media_starter" | "media_team" | "media_network";
      defaultLocale: "en" | "de" | "sq";
      enabledLocales: ("en" | "de" | "sq")[];
      brandAccent: string;
    };
  }>(
    "/api/platform-owner/tenants/:tenantId/setup",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId"],
          properties: { tenantId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "templateId",
            "defaultLocale",
            "enabledLocales",
            "brandAccent",
          ],
          properties: {
            templateId: {
              enum: ["media_starter", "media_team", "media_network"],
            },
            defaultLocale: { enum: ["en", "de", "sq"] },
            enabledLocales: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              uniqueItems: true,
              items: { enum: ["en", "de", "sq"] },
            },
            brandAccent: {
              type: "string",
              pattern: "^#[0-9A-Fa-f]{6}$",
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      return service.configureTenant({
        actorUserId: context.session.userId,
        authorityTenantId: context.session.tenantId,
        accessGrantId: accessGrant(request),
        targetTenantId: request.params.tenantId,
        ...request.body,
        correlationId: request.id,
      });
    },
  );

  app.post<{
    Params: { tenantId: string };
    Body: { displayName: string; lifetimeDays: number };
  }>(
    "/api/platform-owner/tenants/:tenantId/api-clients",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId"],
          properties: { tenantId: uuid },
        },
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
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      return reply
        .header("cache-control", "no-store")
        .code(201)
        .send(
          await service.issueApiClient({
            actorUserId: context.session.userId,
            authorityTenantId: context.session.tenantId,
            accessGrantId: accessGrant(request),
            targetTenantId: request.params.tenantId,
            ...request.body,
            correlationId: request.id,
          }),
        );
    },
  );

  app.post<{
    Params: { tenantId: string };
    Body: { email: string; lifetimeHours: number };
  }>(
    "/api/platform-owner/tenants/:tenantId/owner-invitations",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId"],
          properties: { tenantId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "lifetimeHours"],
          properties: {
            email: { type: "string", format: "email", maxLength: 320 },
            lifetimeHours: { type: "integer", minimum: 1, maximum: 168 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      return reply
        .header("cache-control", "no-store")
        .code(201)
        .send(
          await service.issueFirstOwnerInvitation({
            actorUserId: context.session.userId,
            authorityTenantId: context.session.tenantId,
            accessGrantId: accessGrant(request),
            targetTenantId: request.params.tenantId,
            ...request.body,
            correlationId: request.id,
          }),
        );
    },
  );

  app.delete<{ Params: { invitationId: string } }>(
    "/api/platform-owner/owner-invitations/:invitationId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["invitationId"],
          properties: { invitationId: uuid },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      await service.revokeFirstOwnerInvitation({
        actorUserId: context.session.userId,
        authorityTenantId: context.session.tenantId,
        accessGrantId: accessGrant(request),
        invitationId: request.params.invitationId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { clientId: string } }>(
    "/api/platform-owner/api-clients/:clientId",
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
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      await service.revokeApiClient({
        actorUserId: context.session.userId,
        authorityTenantId: context.session.tenantId,
        accessGrantId: accessGrant(request),
        clientId: request.params.clientId,
        correlationId: request.id,
      });
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { tenantId: string };
    Body: {
      action: "suspend" | "reactivate" | "request_deletion";
      reason: string;
    };
  }>(
    "/api/platform-owner/tenants/:tenantId/lifecycle",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["tenantId"],
          properties: { tenantId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action", "reason"],
          properties: {
            action: { enum: ["suspend", "reactivate", "request_deletion"] },
            reason: {
              type: "string",
              minLength: 10,
              maxLength: 1000,
              pattern: "\\S",
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      return reply.code(202).send(
        await service.requestLifecycle({
          actorUserId: context.session.userId,
          authorityTenantId: context.session.tenantId,
          accessGrantId: accessGrant(request),
          targetTenantId: request.params.tenantId,
          ...request.body,
          correlationId: request.id,
        }),
      );
    },
  );

  app.post<{ Params: { requestId: string } }>(
    "/api/platform-owner/lifecycle/:requestId/execute",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["requestId"],
          properties: { requestId: uuid },
        },
      },
    },
    async (request, reply) => {
      if (!service)
        return reply
          .code(503)
          .send({ error: "Platform Owner Console is unavailable" });
      const context = await authorizePlatform(request, reply, true);
      if (!context) return;
      if (!UUID.test(accessGrant(request)))
        return reply
          .code(403)
          .send({ error: "Active platform access is required" });
      return service.executeLifecycle({
        actorUserId: context.session.userId,
        authorityTenantId: context.session.tenantId,
        accessGrantId: accessGrant(request),
        requestId: request.params.requestId,
        correlationId: request.id,
      });
    },
  );
}
