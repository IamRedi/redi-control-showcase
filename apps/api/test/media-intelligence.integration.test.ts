import { randomUUID } from "node:crypto";
import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { MediaIntelligenceService } from "@redi-control/media-intelligence";
import { SessionStore } from "@redi-control/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const adminUrl = required("DATABASE_ADMIN_URL"),
  runtimeUrl = required("DATABASE_URL"),
  authUrl = required("DATABASE_AUTH_URL"),
  runtimePassword = required("DATABASE_RUNTIME_PASSWORD"),
  authPassword = required("DATABASE_AUTH_PASSWORD");
const admin = createPool(adminUrl, "research-admin"),
  runtime = createPool(runtimeUrl, "research-runtime"),
  auth = createPool(authUrl, "research-auth");
let seed: SeedResult,
  service: MediaIntelligenceService,
  profileId: string,
  sourceId: string,
  caseId: string,
  caseSourceId: string,
  claimId: string,
  candidateId: string;
let app: ReturnType<typeof buildApp>;
let analystSession: Awaited<ReturnType<SessionStore["create"]>>,
  adminSession: Awaited<ReturnType<SessionStore["create"]>>;

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  service = new MediaIntelligenceService(runtime);
  const sessions = new SessionStore(auth);
  adminSession = await sessions.create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  analystSession = await sessions.create({
    provider: "local",
    subject: seed.analystSubject,
    email: `analyst-${seed.analystUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  app = buildApp({ database: { runtime, auth }, cookieSecure: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await Promise.all([admin.end(), runtime.end(), auth.end()]);
});

describe("Universal Media Intelligence Milestone 3", () => {
  it("installs only universal forced-RLS research primitives", async () => {
    const rows = await admin.query<{
      tablename: string;
      forcerowsecurity: boolean;
    }>(
      `SELECT c.relname tablename,c.relforcerowsecurity forcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='control' AND c.relname IN ('media_profiles','source_registry','research_cases','research_claims','research_evidence','editorial_candidates') ORDER BY c.relname`,
    );
    expect(rows.rows).toHaveLength(6);
    expect(rows.rows.every((r) => r.forcerowsecurity)).toBe(true);
  });
  it("enforces authenticated RBAC and strict request bodies", async () => {
    const denied = await app.inject({
      method: "GET",
      url: "/api/research/profiles",
      headers: { cookie: `redi_session=${analystSession.token}` },
    });
    expect(denied.statusCode).toBe(403);
    const unknown = await app.inject({
      method: "POST",
      url: "/api/research/profiles",
      headers: {
        cookie: `redi_session=${analystSession.token}; redi_csrf=${analystSession.csrfToken}`,
        "x-csrf-token": analystSession.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        name: "Invalid",
        publicationIdentity: "Invalid",
        locale: "de-DE",
        tenantId: seed.tenantB,
      },
    });
    expect(unknown.statusCode).toBe(400);
  });
  it("lists only active media-enabled workzones through content RBAC", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/research/workspaces",
      headers: { cookie: `redi_session=${adminSession.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: seed.workspaceA,
          name: "Local Workspace A",
        }),
      ],
    });
    const workspaces = await service.listWorkspaces({ tenantId: seed.tenantA });
    expect(workspaces).toEqual([
      expect.objectContaining({
        id: seed.workspaceA,
        name: "Local Workspace A",
      }),
    ]);
    await expect(
      service.listWorkspaces({ tenantId: seed.tenantB }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: seed.workspaceB,
        name: "Local Workspace B",
      }),
    ]);
  });
  it("creates profiles, sources and explainable observations", async () => {
    const profile = await service.createProfile({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      name: "Regional Desk",
      publicationIdentity: "Independent regional publication",
      locale: "de-DE",
      categories: ["local", "economy"],
      verificationRequirements: { minimumEligibleSources: 2 },
      correlationId: randomUUID(),
    });
    profileId = String(profile.id);
    const source = await service.createSource({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      profileId,
      actorUserId: seed.adminUser,
      name: "Municipal register",
      sourceType: "website",
      canonicalRef: "https://city.example.test/press",
      canonicalDomain: "city.example.test",
      tier: "primary",
      verificationEligible: true,
      provenance: { enteredBy: "editor", retrievedFrom: "official directory" },
      correlationId: randomUUID(),
    });
    sourceId = String(source.id);
    await service.observeSource({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      sourceId,
      actorUserId: seed.adminUser,
      metric: "reliability",
      value: 90,
      observation: "Three cited notices matched the signed primary documents.",
      observedAt: new Date(),
      correlationId: randomUUID(),
    });
    const sources = await service.listSources({
      tenantId: seed.tenantA,
      profileId,
    });
    expect(sources).toHaveLength(1);
    expect(
      (sources[0] as { observations: unknown[] }).observations,
    ).toHaveLength(1);
  });
  it("preserves source provenance, explainable claims and conflicting evidence", async () => {
    const created = await service.createCase({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      profileId,
      actorUserId: seed.adminUser,
      title: "Transit decision",
      topic: "Regional transit change",
      freshnessAt: new Date(),
      correlationId: randomUUID(),
    });
    caseId = String(created.id);
    const attached = await service.attachSource({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      registrySourceId: sourceId,
      actorUserId: seed.adminUser,
      sourceRef: "https://city.example.test/press/42",
      title: "Council notice",
      publisher: "City",
      retrievedAt: new Date(),
      sourceType: "website",
      tier: "primary",
      provenance: { method: "manual reference", fullTextStored: false },
      correlationId: randomUUID(),
    });
    caseSourceId = String(attached.id);
    const claim = await service.addClaim({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      actorUserId: seed.adminUser,
      statement: "The route changes on 1 September.",
      importance: "high",
      verificationState: "partially_verified",
      verificationExplanation:
        "One eligible primary source supports the date; a second independent source is still required.",
      correlationId: randomUUID(),
    });
    claimId = String(claim.id);
    await service.linkEvidence({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      claimId,
      caseSourceId,
      actorUserId: seed.adminUser,
      relationship: "primary_evidence",
      notes: "Exact date appears in the notice.",
      correlationId: randomUUID(),
    });
    const detail = await service.getCase({ tenantId: seed.tenantA, caseId });
    expect(detail.claims[0]).toMatchObject({
      verificationState: "partially_verified",
    });
    expect((detail.claims[0] as { evidence: unknown[] }).evidence).toHaveLength(
      1,
    );
  });
  it("requires manual approval, promotes idempotently, and keeps research provenance separate", async () => {
    const candidate = await service.createCandidate({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      actorUserId: seed.adminUser,
      title: "Regional route changes confirmed",
      summary: "A concise editorial brief.",
      ranking: {
        freshness: 90,
        trend: 45,
        publicInterest: 80,
        audienceRelevance: 95,
        reliability: 75,
        evidenceStrength: 65,
      },
      rankingExplanation:
        "High local relevance; verification remains explicitly visible in the research case.",
      verificationState: "developing",
      correlationId: randomUUID(),
    });
    candidateId = String(candidate.id);
    await expect(
      service.promoteCandidate({
        tenantId: seed.tenantA,
        candidateId,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("CANDIDATE_APPROVAL_REQUIRED");
    await service.decideCandidate({
      tenantId: seed.tenantA,
      candidateId,
      actorUserId: seed.adminUser,
      decision: "approved",
      correlationId: randomUUID(),
    });
    const first = await service.promoteCandidate({
      tenantId: seed.tenantA,
      candidateId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    const retry = await service.promoteCandidate({
      tenantId: seed.tenantA,
      candidateId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    expect(retry).toEqual({
      contentItemId: first.contentItemId,
      idempotent: true,
    });
    const content = await withTenant(runtime, seed.tenantA, (c) =>
      c.query<{ summary: string }>(
        "SELECT summary FROM control.content_items WHERE id=$1",
        [first.contentItemId],
      ),
    );
    expect(content.rows[0]?.summary).toBe("A concise editorial brief.");
  });
  it("fails closed across tenants and when entitlement is disabled", async () => {
    await expect(
      service.getCase({ tenantId: seed.tenantB, caseId }),
    ).rejects.toThrow("RESEARCH_CASE_NOT_FOUND");
    await withTenant(runtime, seed.tenantA, (c) =>
      c.query(
        "UPDATE control.feature_flags SET enabled=false WHERE name='module.media-intelligence'",
      ),
    );
    await expect(
      service.createCase({
        tenantId: seed.tenantA,
        workspaceId: seed.workspaceA,
        profileId,
        actorUserId: seed.adminUser,
        title: "Denied",
        topic: "Denied",
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("MEDIA_INTELLIGENCE_NOT_ENTITLED");
    await expect(
      service.getCase({ tenantId: seed.tenantA, caseId }),
    ).rejects.toThrow("MEDIA_INTELLIGENCE_NOT_ENTITLED");
    await expect(
      service.listCases({ tenantId: seed.tenantA }),
    ).resolves.toEqual([]);
  });
});
