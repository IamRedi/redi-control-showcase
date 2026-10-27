import type { Permission } from "@redi-control/core";
import type {
  EditorialConfig,
  MediaIntelligenceService,
} from "@redi-control/media-intelligence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type Context = { session: { tenantId: string; userId: string } };
type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  checks?: { csrf?: boolean; mfa?: boolean },
) => Promise<Context | null>;
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "Database is not configured" });
function validateBody(
  body: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
): void {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Object.assign(new Error("INVALID_RESEARCH_REQUEST"), {
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
    throw Object.assign(new Error("INVALID_RESEARCH_REQUEST"), {
      statusCode: 400,
    });
}

export function registerResearchRoutes(
  app: FastifyInstance,
  service: MediaIntelligenceService | null,
  authorize: Authorize,
): void {
  app.get("/api/research/workspaces", async (request, reply) => {
    if (!service) return unavailable(reply);
    const context = await authorize(request, reply, "content:edit");
    if (!context) return;
    return {
      items: await service.listWorkspaces({
        tenantId: context.session.tenantId,
      }),
    };
  });
  app.get<{ Querystring: { workspaceId?: string } }>(
    "/api/research/profiles",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return {
        items: await service.listProfiles({
          tenantId: c.session.tenantId,
          ...(r.query.workspaceId ? { workspaceId: r.query.workspaceId } : {}),
        }),
      };
    },
  );
  app.post<{
    Body: {
      workspaceId: string;
      name: string;
      publicationIdentity: string;
      tagline?: string;
      locale: string;
      region?: string;
      country?: string;
      audience?: string;
      categories?: string[];
      toneRules?: string;
      excludedTopics?: string[];
      restrictedTopics?: string[];
      verificationRequirements?: Record<string, unknown>;
      destinationPreferences?: string[];
      cadence?: Record<string, unknown>;
      editorialConfig?: EditorialConfig;
    };
  }>("/api/research/profiles", async (r, p) => {
    validateBody(
      r.body,
      [
        "workspaceId",
        "name",
        "publicationIdentity",
        "tagline",
        "locale",
        "region",
        "country",
        "audience",
        "categories",
        "toneRules",
        "excludedTopics",
        "restrictedTopics",
        "verificationRequirements",
        "destinationPreferences",
        "cadence",
        "editorialConfig",
      ],
      ["workspaceId", "name", "publicationIdentity", "locale"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.createProfile({
        ...r.body,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { profileId: string };
    Body: {
      expectedVersion: number;
      name: string;
      publicationIdentity: string;
      tagline?: string;
      locale: string;
      region?: string;
      country?: string;
      audience?: string;
      categories?: string[];
      toneRules?: string;
      excludedTopics?: string[];
      restrictedTopics?: string[];
      editorialConfig: EditorialConfig;
    };
  }>("/api/research/profiles/:profileId/update", async (r, p) => {
    validateBody(
      r.body,
      [
        "expectedVersion",
        "name",
        "publicationIdentity",
        "tagline",
        "locale",
        "region",
        "country",
        "audience",
        "categories",
        "toneRules",
        "excludedTopics",
        "restrictedTopics",
        "editorialConfig",
      ],
      [
        "expectedVersion",
        "name",
        "publicationIdentity",
        "locale",
        "editorialConfig",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "tenant:admin", { csrf: true, mfa: true });
    if (!c) return;
    return service.updateProfile({
      ...r.body,
      profileId: r.params.profileId,
      tenantId: c.session.tenantId,
      actorUserId: c.session.userId,
      correlationId: r.id,
    });
  });
  app.get<{ Querystring: { workspaceId?: string; profileId?: string } }>(
    "/api/research/sources",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return {
        items: await service.listSources({
          tenantId: c.session.tenantId,
          ...r.query,
        }),
      };
    },
  );
  app.post<{
    Body: {
      workspaceId: string;
      profileId?: string;
      name: string;
      sourceType:
        | "website"
        | "feed"
        | "document"
        | "database"
        | "social"
        | "manual"
        | "other";
      canonicalRef: string;
      canonicalDomain?: string;
      tier: "primary" | "strong_reporting" | "discovery";
      topics?: string[];
      country?: string;
      verificationEligible?: boolean;
      provenance: Record<string, unknown>;
    };
  }>("/api/research/sources", async (r, p) => {
    validateBody(
      r.body,
      [
        "workspaceId",
        "profileId",
        "name",
        "sourceType",
        "canonicalRef",
        "canonicalDomain",
        "tier",
        "topics",
        "country",
        "verificationEligible",
        "provenance",
      ],
      [
        "workspaceId",
        "name",
        "sourceType",
        "canonicalRef",
        "tier",
        "provenance",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.createSource({
        ...r.body,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { sourceId: string };
    Body: {
      workspaceId: string;
      metric:
        | "reliability"
        | "speed"
        | "freshness"
        | "trend_relevance"
        | "audience_relevance";
      value: number;
      observation: string;
      observedAt: string;
    };
  }>("/api/research/sources/:sourceId/observations", async (r, p) => {
    validateBody(
      r.body,
      ["workspaceId", "metric", "value", "observation", "observedAt"],
      ["workspaceId", "metric", "value", "observation", "observedAt"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.observeSource({
        ...r.body,
        sourceId: r.params.sourceId,
        observedAt: new Date(r.body.observedAt),
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.get<{ Querystring: { workspaceId?: string; limit?: number } }>(
    "/api/research/cases",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return {
        items: await service.listCases({
          tenantId: c.session.tenantId,
          ...r.query,
        }),
      };
    },
  );
  app.post<{
    Body: {
      workspaceId: string;
      profileId: string;
      title: string;
      topic: string;
      notes?: string;
      freshnessAt?: string;
    };
  }>("/api/research/cases", async (r, p) => {
    validateBody(
      r.body,
      ["workspaceId", "profileId", "title", "topic", "notes", "freshnessAt"],
      ["workspaceId", "profileId", "title", "topic"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    const { freshnessAt, ...body } = r.body;
    return p.code(201).send(
      await service.createCase({
        ...body,
        ...(freshnessAt ? { freshnessAt: new Date(freshnessAt) } : {}),
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.get<{ Params: { caseId: string } }>(
    "/api/research/cases/:caseId",
    async (r, p) => {
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:edit");
      if (!c) return;
      return service.getCase({
        tenantId: c.session.tenantId,
        caseId: r.params.caseId,
      });
    },
  );
  app.post<{
    Params: { caseId: string };
    Body: {
      workspaceId: string;
      registrySourceId?: string;
      sourceRef: string;
      title: string;
      publisher?: string;
      publicationAt?: string;
      retrievedAt: string;
      sourceType:
        | "website"
        | "feed"
        | "document"
        | "database"
        | "social"
        | "manual"
        | "other";
      tier: "primary" | "strong_reporting" | "discovery";
      classification?: string;
      notes?: string;
      provenance: Record<string, unknown>;
    };
  }>("/api/research/cases/:caseId/sources", async (r, p) => {
    validateBody(
      r.body,
      [
        "workspaceId",
        "registrySourceId",
        "sourceRef",
        "title",
        "publisher",
        "publicationAt",
        "retrievedAt",
        "sourceType",
        "tier",
        "classification",
        "notes",
        "provenance",
      ],
      [
        "workspaceId",
        "sourceRef",
        "title",
        "retrievedAt",
        "sourceType",
        "tier",
        "provenance",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    const { publicationAt, retrievedAt, ...body } = r.body;
    return p.code(201).send(
      await service.attachSource({
        ...body,
        caseId: r.params.caseId,
        ...(publicationAt ? { publicationAt: new Date(publicationAt) } : {}),
        retrievedAt: new Date(retrievedAt),
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { caseId: string };
    Body: {
      workspaceId: string;
      statement: string;
      importance: "low" | "medium" | "high" | "critical";
      verificationState:
        | "verified"
        | "partially_verified"
        | "developing"
        | "unverified"
        | "conflicting"
        | "stale";
      verificationExplanation: string;
      conflictNotes?: string;
    };
  }>("/api/research/cases/:caseId/claims", async (r, p) => {
    validateBody(
      r.body,
      [
        "workspaceId",
        "statement",
        "importance",
        "verificationState",
        "verificationExplanation",
        "conflictNotes",
      ],
      [
        "workspaceId",
        "statement",
        "importance",
        "verificationState",
        "verificationExplanation",
      ],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.addClaim({
        ...r.body,
        caseId: r.params.caseId,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { caseId: string };
    Body: {
      workspaceId: string;
      claimId: string;
      caseSourceId: string;
      relationship:
        | "supports"
        | "contradicts"
        | "mentions"
        | "primary_evidence";
      notes?: string;
    };
  }>("/api/research/cases/:caseId/evidence", async (r, p) => {
    validateBody(
      r.body,
      ["workspaceId", "claimId", "caseSourceId", "relationship", "notes"],
      ["workspaceId", "claimId", "caseSourceId", "relationship"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    return p.code(201).send(
      await service.linkEvidence({
        ...r.body,
        caseId: r.params.caseId,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { caseId: string };
    Body: {
      workspaceId: string;
      title: string;
      summary?: string;
      ranking: unknown;
      rankingExplanation: string;
      section?: string;
      eventDate?: string;
      recommendationReason?: string;
      verificationState?:
        | "verified"
        | "partially_verified"
        | "developing"
        | "unverified"
        | "conflicting"
        | "stale";
      primarySourceId?: string;
      crossCheckSourceIds?: string[];
    };
  }>("/api/research/cases/:caseId/candidates", async (r, p) => {
    validateBody(
      r.body,
      [
        "workspaceId",
        "title",
        "summary",
        "ranking",
        "rankingExplanation",
        "section",
        "eventDate",
        "recommendationReason",
        "verificationState",
        "primarySourceId",
        "crossCheckSourceIds",
      ],
      ["workspaceId", "title", "ranking", "rankingExplanation"],
    );
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:edit", { csrf: true });
    if (!c) return;
    const { eventDate, ...candidate } = r.body;
    return p.code(201).send(
      await service.createCandidate({
        ...candidate,
        ...(eventDate ? { eventDate: new Date(eventDate) } : {}),
        caseId: r.params.caseId,
        tenantId: c.session.tenantId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      }),
    );
  });
  app.post<{
    Params: { candidateId: string };
    Body: { decision: "approved" | "rejected" };
  }>("/api/research/candidates/:candidateId/decision", async (r, p) => {
    validateBody(r.body, ["decision"], ["decision"]);
    if (!service) return unavailable(p);
    const c = await authorize(r, p, "content:approve", {
      csrf: true,
      mfa: true,
    });
    if (!c) return;
    return service.decideCandidate({
      tenantId: c.session.tenantId,
      candidateId: r.params.candidateId,
      actorUserId: c.session.userId,
      decision: r.body.decision,
      correlationId: r.id,
    });
  });
  app.post<{ Params: { candidateId: string }; Body: Record<string, never> }>(
    "/api/research/candidates/:candidateId/promote",
    async (r, p) => {
      validateBody(r.body, []);
      if (!service) return unavailable(p);
      const c = await authorize(r, p, "content:approve", {
        csrf: true,
        mfa: true,
      });
      if (!c) return;
      return service.promoteCandidate({
        tenantId: c.session.tenantId,
        candidateId: r.params.candidateId,
        actorUserId: c.session.userId,
        correlationId: r.id,
      });
    },
  );
}
