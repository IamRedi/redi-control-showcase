import type { Permission } from "@redi-control/core";
import type { SourceIngestionService } from "@redi-control/source-ingestion";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = { session: { tenantId: string; userId: string } };
type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  checks?: { csrf?: boolean; mfa?: boolean },
) => Promise<Context | null>;
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "Source ingestion is unavailable" });
function object(
  body: unknown,
  allowed: string[],
  required: string[] = [],
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Object.assign(new Error("INVALID_SOURCE_INGESTION_REQUEST"), {
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
    throw Object.assign(new Error("INVALID_SOURCE_INGESTION_REQUEST"), {
      statusCode: 400,
    });
  return value;
}
export function registerSourceIngestionRoutes(
  app: FastifyInstance,
  service: SourceIngestionService | null,
  authorize: Authorize,
): void {
  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/research/providers",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return {
        items: await service.listProviders({
          tenantId: c.session.tenantId,
          ...r.query,
        }),
      };
    },
  );
  app.post<{
    Body: {
      workspaceId: string;
      providerId: string;
      providerKind: "search" | "api_feed";
      displayName: string;
      secretReference?: string;
      configuration?: Record<string, unknown>;
    };
  }>("/api/research/providers", async (r, p) => {
    object(
      r.body,
      [
        "workspaceId",
        "providerId",
        "providerKind",
        "displayName",
        "secretReference",
        "configuration",
      ],
      ["workspaceId", "providerId", "providerKind", "displayName"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.configureProvider({
        ...r.body,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.get<{ Querystring: { workspaceId?: string; caseId?: string } }>(
    "/api/research/discovery",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return {
        items: await service.listRuns({
          tenantId: c.session.tenantId,
          ...r.query,
        }),
      };
    },
  );
  app.post<{
    Body: {
      workspaceId: string;
      caseId?: string;
      method: "manual" | "search" | "rss" | "api_feed";
      query?: string;
      url?: string;
      providerId?: string;
      feedId?: string;
      idempotencyKey: string;
    };
  }>("/api/research/discovery", async (r, p) => {
    object(
      r.body,
      [
        "workspaceId",
        "caseId",
        "method",
        "query",
        "url",
        "providerId",
        "feedId",
        "idempotencyKey",
      ],
      ["workspaceId", "method", "idempotencyKey"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    if (
      (r.body.method === "manual" && !r.body.url) ||
      (r.body.method === "search" && !r.body.query) ||
      (r.body.method === "rss" && !r.body.feedId)
    )
      throw Object.assign(new Error("INVALID_SOURCE_INGESTION_REQUEST"), {
        statusCode: 400,
      });
    return p.code(202).send(
      await service.start({
        ...r.body,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{ Params: { runId: string } }>(
    "/api/research/discovery/:runId/cancel",
    async (r, p) => {
      object(r.body ?? {}, []);
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit", { csrf: true });
      if (!c) return;
      return service.cancel({
        tenantId: c.session.tenantId,
        runId: r.params.runId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      });
    },
  );
  app.post<{
    Params: { runId: string };
    Body: { caseId: string; resultIds: string[] };
  }>("/api/research/discovery/:runId/attach", async (r, p) => {
    object(r.body, ["caseId", "resultIds"], ["caseId", "resultIds"]);
    if (!Array.isArray(r.body.resultIds) || r.body.resultIds.length > 50)
      throw Object.assign(new Error("INVALID_SOURCE_INGESTION_REQUEST"), {
        statusCode: 400,
      });
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return service.attach({
      tenantId: c.session.tenantId,
      runId: r.params.runId,
      caseId: r.body.caseId,
      resultIds: r.body.resultIds,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/research/feeds",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return {
        items: await service.listFeeds({
          tenantId: c.session.tenantId,
          ...r.query,
        }),
      };
    },
  );
  app.post<{
    Body: { workspaceId: string; sourceId: string; feedUrl: string };
  }>("/api/research/feeds", async (r, p) => {
    object(
      r.body,
      ["workspaceId", "sourceId", "feedUrl"],
      ["workspaceId", "sourceId", "feedUrl"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.createFeed({
        ...r.body,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
}
