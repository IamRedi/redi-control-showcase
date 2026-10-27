import { randomUUID } from "node:crypto";
import { InMemorySecretProvider } from "@redi-control/connector-sdk";
import {
  claimNextSourceIngestionJob,
  createPool,
  finishJob,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { MediaIntelligenceService } from "@redi-control/media-intelligence";
import { SessionStore } from "@redi-control/identity";
import {
  SourceIngestionService,
  type OutboundTransport,
  type SearchDiscoveryProvider,
} from "@redi-control/source-ingestion";
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
const admin = createPool(adminUrl, "source-m4-admin"),
  runtime = createPool(runtimeUrl, "source-m4-runtime"),
  auth = createPool(authUrl, "source-m4-auth");
let seed: SeedResult,
  profileId: string,
  caseId: string,
  service: SourceIngestionService;
let app: ReturnType<typeof buildApp>;
let adminSession: Awaited<ReturnType<SessionStore["create"]>>,
  analystSession: Awaited<ReturnType<SessionStore["create"]>>;
const secretProvider = new InMemorySecretProvider();
const credentialCalls: string[] = [];
const provider: SearchDiscoveryProvider = {
  id: "fixture-search",
  search: (input) => {
    credentialCalls.push(input.credential ?? "");
    return Promise.resolve({
      results: [
        {
          title: "Regional report",
          url: "https://publisher.example/report?utm_source=test",
          publisher: "Publisher",
          snippet: "A discovered report, not verified.",
          providerResultId: "report-1",
          providerMetadata: { fixture: true },
        },
      ],
      actualCost: 0.01,
    });
  },
};
beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  const media = new MediaIntelligenceService(runtime);
  const profile = await media.createProfile({
    tenantId: seed.tenantA,
    workspaceId: seed.workspaceA,
    actorUserId: seed.adminUser,
    name: "Discovery desk",
    publicationIdentity: "Test publication",
    locale: "de-DE",
    correlationId: randomUUID(),
  });
  profileId = String(profile.id);
  const research = await media.createCase({
    tenantId: seed.tenantA,
    workspaceId: seed.workspaceA,
    profileId,
    actorUserId: seed.adminUser,
    title: "Source discovery",
    topic: "Regional topic",
    correlationId: randomUUID(),
  });
  caseId = String(research.id);
  secretProvider.set("secret://providers/fixture-search", "tenant-a-secret");
  service = new SourceIngestionService(runtime, {
    secretProvider,
    searchProviders: [provider],
  });
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
  await app?.close();
  await Promise.all([admin.end(), runtime.end(), auth.end()]);
});

async function processNext(expectedRunId: string, processor = service) {
  const job = await claimNextSourceIngestionJob(runtime, "integration-worker");
  expect(job?.payload.runId).toBe(expectedRunId);
  try {
    await processor.process(job!);
    await finishJob(runtime, job!, { status: "succeeded" });
  } catch (error) {
    await finishJob(runtime, job!, {
      status: "failed",
      error: error instanceof Error ? error.message : "failed",
    });
    throw error;
  }
}

describe("Source Discovery & Ingestion Milestone 4 PostgreSQL", () => {
  it("requires authenticated editor RBAC and rejects tenant/body overrides", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/research/discovery",
    });
    expect(anonymous.statusCode).toBe(401);
    const denied = await app.inject({
      method: "GET",
      url: "/api/research/discovery",
      headers: { cookie: `redi_session=${analystSession.token}` },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({
      method: "GET",
      url: `/api/research/discovery?workspaceId=${seed.workspaceA}`,
      headers: { cookie: `redi_session=${adminSession.token}` },
    });
    expect(allowed.statusCode).toBe(200);
    const override = await app.inject({
      method: "POST",
      url: "/api/research/discovery",
      headers: {
        cookie: `redi_session=${adminSession.token}; redi_csrf=${adminSession.csrfToken}`,
        "x-csrf-token": adminSession.csrfToken,
      },
      payload: {
        workspaceId: seed.workspaceA,
        method: "search",
        query: "topic",
        idempotencyKey: "api-override-test-0001",
        tenantId: seed.tenantB,
      },
    });
    expect(override.statusCode).toBe(400);
  });
  it("installs forced-RLS ingestion tables and no plaintext provider secret", async () => {
    const rows = await admin.query<{
      relname: string;
      relforcerowsecurity: boolean;
    }>(
      "SELECT relname,relforcerowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=pg_class.relnamespace WHERE nspname='control' AND relname IN ('source_provider_configurations','source_feeds','discovery_runs','discovery_results','provider_usage_events') ORDER BY relname",
    );
    expect(rows.rows).toHaveLength(5);
    expect(rows.rows.every((row) => row.relforcerowsecurity)).toBe(true);
    await service.configureProvider({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      providerId: "fixture-search",
      providerKind: "search",
      displayName: "Fixture search",
      secretReference: "secret://providers/fixture-search",
      configuration: { region: "de" },
      correlationId: randomUUID(),
    });
    const stored = await admin.query(
      "SELECT secret_reference::text,configuration::text FROM control.source_provider_configurations",
    );
    expect(JSON.stringify(stored.rows)).not.toContain("tenant-a-secret");
  });
  it("discovers idempotently, resolves only the tenant secret, accounts usage and attaches to M3", async () => {
    const key = "fixture-search-idempotent-0001";
    const first = await service.start({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      actorUserId: seed.adminUser,
      method: "search",
      query: "regional topic",
      providerId: "fixture-search",
      idempotencyKey: key,
      correlationId: randomUUID(),
    });
    const duplicate = await service.start({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      actorUserId: seed.adminUser,
      method: "search",
      query: "regional topic",
      providerId: "fixture-search",
      idempotencyKey: key,
      correlationId: randomUUID(),
    });
    expect(duplicate.id).toBe(first.id);
    await expect(
      service.start({
        tenantId: seed.tenantA,
        workspaceId: seed.workspaceA,
        caseId,
        actorUserId: seed.adminUser,
        method: "search",
        query: "different topic",
        providerId: "fixture-search",
        idempotencyKey: key,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("SOURCE_IDEMPOTENCY_CONFLICT");
    await processNext(String(first.id));
    expect(credentialCalls).toEqual(["tenant-a-secret"]);
    const [run] = await service.listRuns({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
    });
    expect(run).toMatchObject({ status: "succeeded", resultCount: 1 });
    const result = (
      run as {
        results: Array<{
          id: string;
          normalized_url?: string;
          normalizedUrl?: string;
        }>;
      }
    ).results[0]!;
    await service.attach({
      tenantId: seed.tenantA,
      runId: String(first.id),
      resultIds: [result.id],
      caseId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    const attached = await withTenant(runtime, seed.tenantA, async (client) =>
      client.query(
        "SELECT discovery_method,normalized_url,retrieval_status,provenance FROM control.research_case_sources WHERE research_case_id=$1",
        [caseId],
      ),
    );
    expect(attached.rows).toHaveLength(1);
    expect(attached.rows[0]).toMatchObject({
      discovery_method: "search",
      normalized_url: "https://publisher.example/report",
      retrieval_status: "succeeded",
    });
    const usage = await withTenant(runtime, seed.tenantA, async (client) =>
      client.query(
        "SELECT provider_id,operation,result_count,actual_cost::text FROM control.provider_usage_events",
      ),
    );
    expect(usage.rows[0]).toMatchObject({
      provider_id: "fixture-search",
      operation: "search",
      result_count: 1,
      actual_cost: "0.010000",
    });
  });
  it("preserves cross-tenant isolation for runs, providers and case attachment", async () => {
    expect(
      await service.listRuns({
        tenantId: seed.tenantB,
        workspaceId: seed.workspaceA,
      }),
    ).toEqual([]);
    expect(
      await service.listProviders({
        tenantId: seed.tenantB,
        workspaceId: seed.workspaceA,
      }),
    ).toEqual([]);
    await expect(
      service.attach({
        tenantId: seed.tenantB,
        runId: randomUUID(),
        resultIds: [randomUUID()],
        caseId,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("DISCOVERY_RUN_NOT_READY");
  });
  it("records safe failure and schedules bounded retry with backoff", async () => {
    const failingTransport: OutboundTransport = {
      send: () => Promise.reject(new Error("SOURCE_FETCH_TIMEOUT")),
    };
    const { HardenedOutboundFetcher } =
      await import("@redi-control/source-ingestion");
    const failing = new SourceIngestionService(runtime, {
      fetcher: new HardenedOutboundFetcher({
        resolver: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]),
        transport: failingTransport,
      }),
    });
    const run = await failing.start({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      actorUserId: seed.adminUser,
      method: "manual",
      url: "https://publisher.example/timeout",
      idempotencyKey: "manual-timeout-retry-0001",
      correlationId: randomUUID(),
    });
    const job = await claimNextSourceIngestionJob(runtime, "retry-worker");
    expect(job?.payload.runId).toBe(run.id);
    await expect(failing.process(job!)).rejects.toThrow("SOURCE_FETCH_TIMEOUT");
    await finishJob(runtime, job!, {
      status: "failed",
      error: "SOURCE_FETCH_TIMEOUT",
    });
    const state = await admin.query(
      "SELECT status,last_error,available_at>now() has_backoff,attempt_count,max_attempts FROM control.jobs WHERE id=$1",
      [job!.id],
    );
    expect(state.rows[0]).toMatchObject({
      status: "failed",
      last_error: "SOURCE_FETCH_TIMEOUT",
      has_backoff: true,
      attempt_count: 1,
      max_attempts: 4,
    });
    const failed = (
      await service.listRuns({ tenantId: seed.tenantA, caseId })
    ).find((item) => item.id === run.id);
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "SOURCE_FETCH_TIMEOUT",
    });
  });
  it("fails closed when search has no explicitly registered runtime adapter", async () => {
    const unconfigured = new SourceIngestionService(runtime);
    const run = await unconfigured.start({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
      actorUserId: seed.adminUser,
      method: "search",
      query: "must not become synthetic news",
      providerId: "deterministic-local",
      idempotencyKey: "unconfigured-search-provider-0001",
      correlationId: randomUUID(),
    });
    const job = await claimNextSourceIngestionJob(runtime, "closed-worker");
    expect(job?.payload.runId).toBe(run.id);
    await expect(unconfigured.process(job!)).rejects.toThrow(
      "SOURCE_SEARCH_PROVIDER_UNAVAILABLE",
    );
    await finishJob(runtime, job!, {
      status: "failed",
      error: "SOURCE_SEARCH_PROVIDER_UNAVAILABLE",
    });
    const [failed] = await unconfigured.listRuns({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      caseId,
    });
    expect(failed).toMatchObject({
      id: run.id,
      status: "failed",
      errorCode: "SOURCE_SEARCH_PROVIDER_UNAVAILABLE",
    });
  });
});
