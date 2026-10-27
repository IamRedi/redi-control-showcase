import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";

import {
  ConnectorRuntime,
  InMemorySecretProvider,
} from "@redi-control/connector-sdk";
import {
  createBusinessSiteWebsiteConnection,
  createPool,
  listWebsiteConnections,
  migrateDatabase,
  PostgresConnectorRuntimeStore,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { SessionStore } from "@redi-control/identity";
import {
  BusinessSiteInformationConnector,
  signBusinessSiteRequest,
} from "@redi-control/website-control";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

const adminUrl = required("DATABASE_ADMIN_URL");
const runtimeUrl = required("DATABASE_URL");
const authUrl = required("DATABASE_AUTH_URL");
const runtimePassword = required("DATABASE_RUNTIME_PASSWORD");
const authPassword = required("DATABASE_AUTH_PASSWORD");
const admin = createPool(adminUrl, "website-control-admin");
const runtime = createPool(runtimeUrl, "website-control-runtime");
const auth = createPool(authUrl, "website-control-auth");
const integrationId = "businesssite-test-installation";
const integrationSecret = "website-control-test-secret-0123456789abcdef";
const secretReference = "secret://test/businesssite-information";
const articleId = "11111111-1111-4111-8111-111111111111";
const createdAt = "2026-08-20T00:00:00.000Z";

type ArticleStatus = "draft" | "pending" | "published" | "archived";
interface FixtureArticle {
  id: string;
  externalReference: string;
  slug: string;
  title: string;
  excerpt: string;
  body: { version: 1; blocks: unknown[] };
  articleMedia: unknown[];
  tags: string[];
  status: ArticleStatus;
  featured: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  sources: unknown[];
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

class BusinessSiteFixture {
  readonly nonces = new Set<string>();
  readonly mutationKeys = new Map<
    string,
    { fingerprint: string; body: unknown }
  >();
  requests = 0;
  article: FixtureArticle | null = null;
  readonly server = createServer((request, response) => {
    void this.handle(request, response).catch(() =>
      send(response, 500, { error: { code: "fixture_error" } }),
    );
  });

  async start(): Promise<string> {
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture address unavailable");
    return `http://127.0.0.1:${address.port}/api/integrations/redi-control/v1`;
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse) {
    this.requests += 1;
    const rawBody = await readBody(request);
    const path = request.url ?? "";
    const method = request.method ?? "GET";
    const timestamp = String(request.headers["x-signature-timestamp"] ?? "");
    const nonce = String(request.headers["x-signature-nonce"] ?? "");
    const signature = String(request.headers["x-signature"] ?? "");
    if (
      request.headers["x-integration-id"] !== integrationId ||
      !/^\d{10}$/.test(timestamp) ||
      !/^[A-Za-z0-9._:-]{16,200}$/.test(nonce) ||
      this.nonces.has(nonce) ||
      signature !==
        signBusinessSiteRequest(integrationSecret, {
          integrationId,
          timestamp,
          nonce,
          method,
          pathnameAndQuery: path,
          rawBody,
        })
    ) {
      send(response, 401, { error: { code: "authentication_failed" } });
      return;
    }
    this.nonces.add(nonce);
    const mutation = method !== "GET";
    const idempotencyKey = String(request.headers["x-idempotency-key"] ?? "");
    const fingerprint = `${method}\n${path}\n${rawBody}`;
    if (mutation) {
      if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
        send(response, 400, { error: { code: "idempotency_key_required" } });
        return;
      }
      const existing = this.mutationKeys.get(idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          send(response, 409, { error: { code: "idempotency_conflict" } });
          return;
        }
        send(response, 200, existing.body);
        return;
      }
    }
    const relative = path.replace("/api/integrations/redi-control/v1", "");
    const url = new URL(relative, "http://fixture.test");
    const parsed = rawBody
      ? (JSON.parse(rawBody) as Record<string, unknown>)
      : {};
    let result: unknown;
    let status = 200;
    if (method === "POST" && url.pathname === "/articles") {
      const input = parsed as {
        externalReference: string;
        slug: string;
        title: string;
        body: FixtureArticle["body"];
      };
      this.article = {
        id: articleId,
        externalReference: input.externalReference,
        slug: input.slug,
        title: input.title,
        excerpt: "",
        body: input.body,
        articleMedia: [],
        tags: [],
        status: "draft",
        featured: false,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        sources: [],
      };
      status = 201;
      result = { article: this.article, externalReferenceReplay: false };
    } else if (method === "GET" && url.pathname === "/articles") {
      const items = this.article
        ? [
            {
              id: this.article.id,
              externalReference: this.article.externalReference,
              slug: this.article.slug,
              title: this.article.title,
              excerpt: this.article.excerpt,
              status: this.article.status,
              featured: this.article.featured,
              tags: this.article.tags,
              version: this.article.version,
              ...(this.article.publishedAt
                ? { publishedAt: this.article.publishedAt }
                : {}),
              createdAt: this.article.createdAt,
              updatedAt: this.article.updatedAt,
            },
          ]
        : [];
      result = { items, nextCursor: null };
    } else if (
      method === "GET" &&
      url.pathname === `/articles/${articleId}` &&
      this.article
    ) {
      result = { article: this.article };
    } else if (
      method === "PATCH" &&
      url.pathname === `/articles/${articleId}` &&
      this.article
    ) {
      const input = parsed as {
        expectedVersion: number;
        patch: Partial<FixtureArticle>;
      };
      if (
        this.article.status !== "draft" ||
        input.expectedVersion !== this.article.version
      ) {
        send(response, 409, { error: { code: "version_conflict" } });
        return;
      }
      this.article = {
        ...this.article,
        ...input.patch,
        version: this.article.version + 1,
        updatedAt: "2026-08-20T00:01:00.000Z",
      };
      result = { article: this.article };
    } else if (
      method === "POST" &&
      url.pathname === `/articles/${articleId}/submit` &&
      this.article
    ) {
      if (
        this.article.status !== "draft" ||
        parsed.expectedVersion !== this.article.version
      ) {
        send(response, 409, { error: { code: "invalid_article_transition" } });
        return;
      }
      this.article = {
        ...this.article,
        status: "pending",
        version: this.article.version + 1,
      };
      result = { article: this.article };
    } else if (
      method === "POST" &&
      url.pathname === `/articles/${articleId}/publish` &&
      this.article
    ) {
      const approval = parsed.approval as
        | { approvedBy?: string; approvedAt?: string }
        | undefined;
      const approvalAge = approval?.approvedAt
        ? Date.now() - Date.parse(approval.approvedAt)
        : Infinity;
      if (
        this.article.status !== "pending" ||
        parsed.expectedVersion !== this.article.version ||
        !approval?.approvedBy ||
        approvalAge < -300_000 ||
        approvalAge > 86_400_000
      ) {
        send(response, 409, { error: { code: "approval_required" } });
        return;
      }
      const publishedAt = new Date().toISOString();
      this.article = {
        ...this.article,
        status: "published",
        version: this.article.version + 1,
        publishedAt,
        updatedAt: publishedAt,
      };
      result = { article: this.article };
    } else {
      send(response, 404, { error: { code: "article_not_found" } });
      return;
    }
    if (mutation)
      this.mutationKeys.set(idempotencyKey, { fingerprint, body: result });
    send(response, status, result);
  }
}

let seed: SeedResult;
let fixture: BusinessSiteFixture;
let apiBaseUrl: string;
let connectionId: string;
let session: Awaited<ReturnType<SessionStore["create"]>>;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  fixture = new BusinessSiteFixture();
  apiBaseUrl = await fixture.start();
  connectionId = await createBusinessSiteWebsiteConnection(runtime, {
    tenantId: seed.tenantA,
    installationId: seed.installationA,
    workspaceId: seed.workspaceA,
    actorUserId: seed.adminUser,
    correlationId: randomUUID(),
    environment: "test",
    secretReference,
    apiBaseUrl,
    integrationId,
    displayName: "BusinessSite News Test",
    domain: "news.example.test",
    previewUrl: "http://127.0.0.1:3000/site/news-test",
    grantedScopes: [
      "articles.read",
      "articles.create",
      "articles.update",
      "articles.submit",
      "articles.publish",
      "articles.archive",
      "media.read",
      "media.write",
    ],
  });
  const secrets = new InMemorySecretProvider();
  secrets.set(secretReference, integrationSecret);
  session = await new SessionStore(auth).create({
    provider: "local",
    subject: seed.adminSubject,
    email: `admin-${seed.adminUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  app = buildApp({
    database: { runtime, auth },
    cookieSecure: false,
    connectorSecretProvider: secrets,
    businessSiteConnector: new BusinessSiteInformationConnector(),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await fixture?.stop();
  await Promise.all([admin.end(), runtime.end(), auth.end()]);
});

function headers() {
  return {
    cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken,
  };
}

async function command(
  commandId: string,
  input: unknown,
  idempotencyKey?: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/connections/${connectionId}/commands/${commandId}`,
    headers: headers(),
    payload: { input, ...(idempotencyKey ? { idempotencyKey } : {}) },
  });
}

describe("Website Control Milestone 1 real BusinessSite path", () => {
  it("fails closed when the REDI CONTROL actor lacks editorial write permission", async () => {
    const secrets = new InMemorySecretProvider();
    secrets.set(secretReference, integrationSecret);
    const connector = new BusinessSiteInformationConnector();
    const connectorRuntime = new ConnectorRuntime(
      new PostgresConnectorRuntimeStore(runtime),
      secrets,
      "0.2.0",
    );
    await connectorRuntime.register(connector);
    await expect(
      connectorRuntime.executeWrite(
        {
          tenantId: seed.tenantA,
          connectionId,
          actorUserId: seed.adminUser,
          permissions: ["platform:read"],
          correlationId: randomUUID(),
        },
        "articles.create",
        {
          externalReference: "forbidden-write",
          slug: "forbidden-write",
          title: "Forbidden write",
          body: { version: 1, blocks: [] },
        },
        "forbidden-write-0001",
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      connectorRuntime.executeWrite(
        {
          tenantId: seed.tenantA,
          connectionId,
          actorUserId: seed.adminUser,
          permissions: ["platform:read", "content:edit"],
          correlationId: randomUUID(),
        },
        "articles.publish",
        {
          articleId,
          expectedVersion: 1,
          approval: {
            approvedBy: seed.adminUser,
            approvedAt: new Date().toISOString(),
          },
        },
        "forbidden-publish-0001",
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        `UPDATE control.installation_entitlements
         SET enabled_modules=array_remove(enabled_modules,'websites')
         WHERE installation_id=$1`,
        [seed.installationA],
      ),
    );
    await expect(
      connectorRuntime.executeRead(
        {
          tenantId: seed.tenantA,
          connectionId,
          actorUserId: seed.adminUser,
          permissions: ["platform:read"],
          correlationId: randomUUID(),
        },
        "articles.list",
        { limit: 1 },
      ),
    ).rejects.toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        `UPDATE control.installation_entitlements
         SET enabled_modules=array_append(enabled_modules,'websites')
         WHERE installation_id=$1`,
        [seed.installationA],
      ),
    );
    expect(fixture.requests).toBe(0);
    await connector.disconnect();
  });

  it("creates, reads, updates, submits and publishes through signed Phase 7 requests", async () => {
    const created = await command(
      "articles.create",
      {
        externalReference: "redi-e2e-1",
        slug: "local-market-update",
        title: "Local market update",
        body: {
          version: 1,
          blocks: [{ type: "paragraph", text: "Structured editorial copy." }],
        },
      },
      "create-article-e2e-0001",
    );
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      result: { article: { status: "draft", version: 1 } },
    });
    const providerRequestsAfterCreate = fixture.requests;
    const replay = await command(
      "articles.create",
      {
        externalReference: "redi-e2e-1",
        slug: "local-market-update",
        title: "Local market update",
        body: {
          version: 1,
          blocks: [{ type: "paragraph", text: "Structured editorial copy." }],
        },
      },
      "create-article-e2e-0001",
    );
    expect(replay.statusCode).toBe(200);
    expect(fixture.requests).toBe(providerRequestsAfterCreate);

    const readDraft = await command("articles.read", { articleId });
    expect(readDraft.json()).toMatchObject({
      result: { article: { status: "draft" } },
    });
    const updated = await command(
      "articles.update",
      {
        articleId,
        expectedVersion: 1,
        patch: { title: "Verified local market update" },
      },
      "update-article-e2e-0001",
    );
    expect(updated.json()).toMatchObject({
      result: {
        article: { title: "Verified local market update", version: 2 },
      },
    });
    const submitted = await command(
      "articles.submit",
      { articleId, expectedVersion: 2 },
      "submit-article-e2e-0001",
    );
    expect(submitted.json()).toMatchObject({
      result: { article: { status: "pending", version: 3 } },
    });

    await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        `UPDATE control.platform_connections
         SET granted_scopes=array_remove(granted_scopes,'articles.publish')
         WHERE id=$1`,
        [connectionId],
      ),
    );
    const denied = await command(
      "articles.publish",
      {
        articleId,
        expectedVersion: 3,
        approval: {
          approvedBy: seed.adminUser,
          approvedAt: new Date().toISOString(),
        },
      },
      "publish-article-denied-0001",
    );
    expect(denied.statusCode).toBe(403);
    await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        `UPDATE control.platform_connections
         SET granted_scopes=array_append(granted_scopes,'articles.publish')
         WHERE id=$1`,
        [connectionId],
      ),
    );

    const published = await command(
      "articles.publish",
      {
        articleId,
        expectedVersion: 3,
        approval: {
          approvedBy: seed.adminUser,
          approvedAt: new Date().toISOString(),
        },
      },
      "publish-article-e2e-0001",
    );
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      result: { article: { status: "published", version: 4 } },
    });
    const readPublished = await command("articles.read", { articleId });
    expect(readPublished.json()).toMatchObject({
      result: { article: { status: "published" } },
    });
    expect(fixture.nonces.size).toBe(fixture.requests);
  });

  it("lists only tenant-owned website connections and exposes no secret/config material", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/websites" });
    expect(anonymous.statusCode).toBe(401);
    const own = await app.inject({
      method: "GET",
      url: "/api/websites",
      headers: headers(),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      websites: [
        {
          id: connectionId,
          provider: "businesssite_information",
          displayName: "BusinessSite News Test",
          domain: "news.example.test",
          healthStatus: "unknown",
        },
      ],
    });
    expect(own.body).not.toContain(integrationSecret);
    expect(own.body).not.toContain(secretReference);
    expect(own.body).not.toContain(integrationId);
    expect(own.body).not.toContain(apiBaseUrl);
    const stored = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ secret_reference: string; profile_text: string }>(
        `SELECT connection.secret_reference,
          row_to_json(profile)::text AS profile_text
         FROM control.platform_connections connection
         JOIN control.website_connection_profiles profile
           ON profile.connection_id=connection.id
          AND profile.tenant_id=connection.tenant_id
         WHERE connection.id=$1`,
        [connectionId],
      ),
    );
    expect(stored.rows[0]?.secret_reference).toBe(secretReference);
    expect(stored.rows[0]?.profile_text).not.toContain(integrationSecret);
    await expect(
      listWebsiteConnections(runtime, seed.tenantB),
    ).resolves.toEqual([]);
  });

  it("persists a bounded real article status summary and audits connector actions", async () => {
    const sync = await app.inject({
      method: "POST",
      url: `/api/websites/${connectionId}/sync`,
      headers: headers(),
      payload: {},
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toEqual({
      articleStatusSummary: { draft: 0, pending: 0, published: 1, archived: 0 },
    });
    const websites = await listWebsiteConnections(runtime, seed.tenantA);
    expect(websites[0]?.articleStatusSummary).toEqual({
      draft: 0,
      pending: 0,
      published: 1,
      archived: 0,
    });
    const audit = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM control.audit_events
         WHERE target_id=$1 AND action IN
           ('website.connection_created','connector.command_executed')`,
        [connectionId],
      ),
    );
    expect(audit.rows[0]?.count).toBeGreaterThanOrEqual(8);
  });
});
