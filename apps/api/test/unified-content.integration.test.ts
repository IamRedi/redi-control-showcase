import { randomUUID } from "node:crypto";

import { InMemorySecretProvider } from "@redi-control/connector-sdk";
import {
  createBusinessSiteWebsiteConnection,
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import { SessionStore } from "@redi-control/identity";
import {
  LocalTokenSecretProvider,
  SocialPublishingService,
} from "@redi-control/media-social";
import { UnifiedContentService } from "@redi-control/unified-content";
import { BusinessSiteInformationConnector } from "@redi-control/website-control";
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
const admin = createPool(adminUrl, "unified-content-admin");
const runtime = createPool(runtimeUrl, "unified-content-runtime");
const auth = createPool(authUrl, "unified-content-auth");

let seed: SeedResult;
let app: ReturnType<typeof buildApp>;
let adminSession: Awaited<ReturnType<SessionStore["create"]>>;
let analystSession: Awaited<ReturnType<SessionStore["create"]>>;
let approverSession: Awaited<ReturnType<SessionStore["create"]>>;
let approverWithoutMfaSession: Awaited<ReturnType<SessionStore["create"]>>;
let assetId: string;
let facebookId: string;
let instagramId: string;
let websiteConnectionId: string;
let itemId: string;
const websiteArticleId = "11111111-1111-4111-8111-111111111111";
const websiteSecret = "unified-content-website-secret-0123456789abcdef";

function headers(session: typeof adminSession) {
  return {
    cookie: `redi_session=${session.token}; redi_csrf=${session.csrfToken}`,
    "x-csrf-token": session.csrfToken,
  };
}

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  assetId = randomUUID();
  facebookId = randomUUID();
  instagramId = randomUUID();
  await withTenant(runtime, seed.tenantA, async (client) => {
    await client.query(
      `INSERT INTO control.media_assets
       (id,tenant_id,workspace_id,created_by,original_filename,status,processing_status)
       VALUES ($1,$2,$3,$4,'unified.webp','ready','ready')`,
      [assetId, seed.tenantA, seed.workspaceA, seed.adminUser],
    );
    for (const [id, type, external] of [
      [facebookId, "facebook_page", "page-unified"],
      [instagramId, "instagram_account", "instagram-unified"],
    ] as const) {
      await client.query(
        `INSERT INTO control.social_accounts
         (id,tenant_id,workspace_id,provider,account_type,provider_account_id,
          display_name,authorized_scopes,token_reference,status)
         VALUES ($1,$2,$3,'meta',$4,$5,$5,ARRAY['content_publish'],$6,'active')`,
        [
          id,
          seed.tenantA,
          seed.workspaceA,
          type,
          external,
          `secret://test/${external}`,
        ],
      );
    }
  });
  websiteConnectionId = await createBusinessSiteWebsiteConnection(runtime, {
    tenantId: seed.tenantA,
    installationId: seed.installationA,
    workspaceId: seed.workspaceA,
    actorUserId: seed.adminUser,
    correlationId: randomUUID(),
    environment: "test",
    secretReference: "secret://test/unified-businesssite",
    apiBaseUrl: "http://127.0.0.1:39001/api/integrations/redi-control/v1",
    integrationId: "unified-content-test",
    displayName: "Unified News",
    domain: "unified.example.test",
    grantedScopes: ["articles.read", "articles.create", "articles.update"],
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
  const approverUser = randomUUID();
  const approverSubject = `website-approver-${randomUUID()}`;
  await admin.query(
    `INSERT INTO control.users(id,identity_subject,email)
     VALUES($1,$2,$3)`,
    [
      approverUser,
      `local|${approverSubject}`,
      `website-approver-${approverUser}@example.invalid`,
    ],
  );
  await admin.query(
    `INSERT INTO control.memberships(tenant_id,user_id,role)
     VALUES($1,$2,'approver')`,
    [seed.tenantA, approverUser],
  );
  approverSession = await sessions.create({
    provider: "local",
    subject: approverSubject,
    email: `website-approver-${approverUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: true,
  });
  approverWithoutMfaSession = await sessions.create({
    provider: "local",
    subject: approverSubject,
    email: `website-approver-${approverUser}@example.invalid`,
    emailVerified: true,
    mfaVerified: false,
  });
  const publishing = new SocialPublishingService(
    runtime,
    new LocalTokenSecretProvider(),
  );
  const connectorSecrets = new InMemorySecretProvider();
  connectorSecrets.set("secret://test/unified-businesssite", websiteSecret);
  app = buildApp({
    database: { runtime, auth },
    cookieSecure: false,
    socialPublishing: publishing,
    connectorSecretProvider: connectorSecrets,
    businessSiteConnector: new BusinessSiteInformationConnector(() => {
      const timestamp = new Date().toISOString();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            article: {
              id: websiteArticleId,
              externalReference: `content-item:${itemId}`,
              slug: "one-story-three-destinations",
              title: "One story, three destinations",
              excerpt: "Shared facts with destination-specific copy.",
              body: {
                version: 1,
                blocks: [{ type: "paragraph", text: "Website copy" }],
              },
              articleMedia: [],
              tags: [],
              sources: [],
              status: "draft",
              featured: false,
              version: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            externalReferenceReplay: false,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await Promise.all([admin.end(), runtime.end(), auth.end()]);
});

describe("Unified Content Milestone 2", () => {
  it("migrates the aggregate and exact-revision Website review boundary with forced RLS", async () => {
    const migrations = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM control.schema_migrations",
    );
    expect(migrations.rows[0]?.count).toBe(44);
    const tables = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='control' AND table_name LIKE 'content_item%' ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "content_item_media",
      "content_item_variants",
      "content_items",
    ]);
    expect(tables.rows.some((row) => row.table_name.includes("approval"))).toBe(
      false,
    );
  });

  it("enforces RBAC, creates one item and attaches existing tenant media", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/content-items",
      headers: headers(analystSession),
      payload: { workspaceId: seed.workspaceA, title: "Denied" },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/content-items",
      headers: headers(adminSession),
      payload: {
        workspaceId: seed.workspaceA,
        title: "One story, three destinations",
        summary: "Shared facts with destination-specific copy.",
        mediaAssetIds: [assetId],
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{
      item: { id: string; mediaAssetIds: string[] };
    }>();
    itemId = body.item.id;
    expect(body.item.mediaAssetIds).toEqual([assetId]);

    const evidence = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM control.audit_events
          WHERE target_id=$1 AND action='content.item_created'`,
        [itemId],
      ),
    );
    expect(evidence.rows[0]?.count).toBe(1);
  });

  it("preflights Website readiness without creating a variant or calling a connector", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/content-items/${itemId}/website-preflight`,
    });
    expect(anonymous.statusCode).toBe(401);
    const override = await app.inject({
      method: "GET",
      url: `/api/content-items/${itemId}/website-preflight?tenantId=${seed.tenantB}`,
      headers: headers(adminSession),
    });
    expect(override.statusCode).toBe(400);

    const before = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM control.content_item_variants
          WHERE content_item_id=$1 AND destination='website'`,
        [itemId],
      ),
    );
    const response = await app.inject({
      method: "GET",
      url: `/api/content-items/${itemId}/website-preflight`,
      headers: headers(adminSession),
    });
    expect(response.statusCode).toBe(200);
    const responseBody = response.json<{
      preflight: {
        checks: Array<{ code: string; severity: string }>;
      };
    }>();
    expect(responseBody).toMatchObject({
      preflight: {
        itemId,
        workspaceId: seed.workspaceA,
        status: "ready",
        connections: [
          {
            connectionId: websiteConnectionId,
            domain: "unified.example.test",
            eligible: true,
          },
        ],
        createsVariant: false,
        callsConnector: false,
        publicationAuthorized: false,
      },
    });
    expect(responseBody.preflight.checks).toEqual(
      expect.arrayContaining([
        { code: "WEBSITE_CONNECTION_ELIGIBLE", severity: "pass" },
        {
          code: "WEBSITE_MEDIA_MAPPING_REQUIRES_CONFIRMATION",
          severity: "warning",
        },
      ]),
    );
    const after = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM control.content_item_variants
          WHERE content_item_id=$1 AND destination='website'`,
        [itemId],
      ),
    );
    expect(before.rows[0]?.count).toBe(0);
    expect(after.rows[0]?.count).toBe(0);
  });

  it("creates and revises a local Website draft without connector execution", async () => {
    const denied = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft`,
      headers: headers(analystSession),
      payload: {
        slug: "local-website-draft",
        title: "Denied local draft",
        bodyText: "No authority.",
      },
    });
    expect(denied.statusCode).toBe(403);
    const tenantOverride = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft`,
      headers: headers(adminSession),
      payload: {
        slug: "local-website-draft",
        title: "One story, Website draft",
        bodyText: "Prepared locally.",
        tenantId: seed.tenantB,
      },
    });
    expect(tenantOverride.statusCode).toBe(400);
    const created = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft`,
      headers: headers(adminSession),
      payload: {
        slug: "one-story-website-draft",
        title: "One story, Website draft",
        excerpt: "Prepared without BusinessSite.",
        bodyText: "First paragraph.\n\nSecond paragraph.",
        mediaAssetIds: [assetId],
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{
      draft: {
        id: string;
        currentRevision: number;
        revision: { id: string; contentHash: string; mediaAssetIds: string[] };
        createsVariant: boolean;
        callsConnector: boolean;
        publicationAuthorized: boolean;
      };
    }>();
    expect(createdBody.draft).toMatchObject({
      itemId,
      workspaceId: seed.workspaceA,
      currentRevision: 1,
      createsVariant: false,
      callsConnector: false,
      publicationAuthorized: false,
      revision: { revision: 1, mediaAssetIds: [assetId] },
    });
    expect(createdBody.draft.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const stale = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/revisions`,
      headers: headers(adminSession),
      payload: {
        expectedRevision: 2,
        slug: "one-story-website-draft",
        title: "Stale edit",
        bodyText: "Stale.",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: "WEBSITE_DRAFT_REVISION_CONFLICT",
    });
    const revised = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/revisions`,
      headers: headers(adminSession),
      payload: {
        expectedRevision: 1,
        slug: "one-story-website-draft",
        title: "One story, Website draft v2",
        excerpt: "Second exact local revision.",
        bodyText: "Revised first paragraph.\n\nRevised second paragraph.",
        mediaAssetIds: [assetId],
      },
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.json()).toMatchObject({
      draft: {
        currentRevision: 2,
        revision: {
          revision: 2,
          title: "One story, Website draft v2",
          bodyText: "Revised first paragraph.\n\nRevised second paragraph.",
          mediaAssetIds: [assetId],
        },
        createsVariant: false,
        callsConnector: false,
        publicationAuthorized: false,
      },
    });
    const read = await app.inject({
      method: "GET",
      url: `/api/content-items/${itemId}/website-draft`,
      headers: headers(adminSession),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      draft: { id: createdBody.draft.id, currentRevision: 2 },
    });

    const evidence = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{
        revisions: number;
        media: number;
        usage: number;
        variants: number;
        audits: number;
      }>(
        `SELECT
          (SELECT count(*)::int FROM control.content_website_draft_revisions
            WHERE draft_id=$1) revisions,
          (SELECT count(*)::int FROM control.content_website_draft_media
            WHERE draft_id=$1) media,
          (SELECT count(*)::int FROM control.media_usage_references
            WHERE usage_type='website_draft' AND asset_id=$2) usage,
          (SELECT count(*)::int FROM control.content_item_variants
            WHERE content_item_id=$3 AND destination='website') variants,
          (SELECT count(*)::int FROM control.audit_events
            WHERE target_id=$3::text AND action IN
              ('content.website_draft_created','content.website_draft_revised')) audits`,
        [createdBody.draft.id, assetId, itemId],
      ),
    );
    expect(evidence.rows[0]).toEqual({
      revisions: 2,
      media: 2,
      usage: 2,
      variants: 0,
      audits: 2,
    });
    await expect(
      admin.query(
        `UPDATE control.content_website_draft_revisions
            SET title='mutated' WHERE id=$1`,
        [createdBody.draft.revision.id],
      ),
    ).rejects.toThrow(/IMMUTABLE_CONTENT_WEBSITE_DRAFT_REVISION/);
  });

  it("queues and independently approves only the exact current Website revision", async () => {
    const override = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/review`,
      headers: headers(adminSession),
      payload: { expectedRevision: 2, tenantId: seed.tenantB },
    });
    expect(override.statusCode).toBe(400);

    const requested = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/review`,
      headers: headers(adminSession),
      payload: { expectedRevision: 2 },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({
      draft: {
        currentRevision: 2,
        review: {
          decision: "pending",
          revision: 2,
          requestedByCurrentUser: true,
          publicationAuthorized: false,
        },
        createsVariant: false,
        callsConnector: false,
        publicationAuthorized: false,
      },
    });

    const queueOverride = await app.inject({
      method: "GET",
      url: `/api/content-items/website-review-queue?tenantId=${seed.tenantB}`,
      headers: headers(adminSession),
    });
    expect(queueOverride.statusCode).toBe(400);
    const queue = await app.inject({
      method: "GET",
      url: `/api/content-items/website-review-queue?workspaceId=${seed.workspaceA}`,
      headers: headers(adminSession),
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      items: [
        {
          itemId,
          workspaceId: seed.workspaceA,
          revision: 2,
          requestedByCurrentUser: true,
        },
      ],
      permissions: { canEdit: true, canApprove: true, mfaVerified: true },
    });

    const selfDecision = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/review-decision`,
      headers: headers(adminSession),
      payload: { expectedRevision: 2, decision: "approved" },
    });
    expect(selfDecision.statusCode).toBe(409);
    expect(selfDecision.json()).toMatchObject({
      error: "WEBSITE_DRAFT_SELF_APPROVAL_DENIED",
    });

    const withoutMfa = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/review-decision`,
      headers: headers(approverWithoutMfaSession),
      payload: { expectedRevision: 2, decision: "approved" },
    });
    expect(withoutMfa.statusCode).toBe(403);

    const approved = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/review-decision`,
      headers: headers(approverSession),
      payload: { expectedRevision: 2, decision: "approved" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      draft: {
        currentRevision: 2,
        review: {
          decision: "approved",
          revision: 2,
          requestedByCurrentUser: false,
          publicationAuthorized: false,
        },
        createsVariant: false,
        callsConnector: false,
        publicationAuthorized: false,
      },
    });

    const evidence = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{
        reviews: number;
        approved: number;
        variants: number;
        audits: number;
      }>(
        `SELECT
          (SELECT count(*)::int FROM control.content_website_draft_reviews) reviews,
          (SELECT count(*)::int FROM control.content_website_draft_reviews
            WHERE decision='approved') approved,
          (SELECT count(*)::int FROM control.content_item_variants
            WHERE content_item_id=$1 AND destination='website') variants,
          (SELECT count(*)::int FROM control.audit_events
            WHERE target_id=$1::text AND action IN
              ('content.website_draft_review_requested',
               'content.website_draft_approved')) audits`,
        [itemId],
      ),
    );
    expect(evidence.rows[0]).toEqual({
      reviews: 1,
      approved: 1,
      variants: 0,
      audits: 2,
    });
    await expect(
      admin.query(
        `UPDATE control.content_website_draft_reviews
            SET reason='mutated approval' WHERE decision='approved'`,
      ),
    ).rejects.toThrow(/IMMUTABLE_CONTENT_WEBSITE_DRAFT_REVIEW/);

    const revised = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/website-draft/revisions`,
      headers: headers(adminSession),
      payload: {
        expectedRevision: 2,
        slug: "one-story-website-draft",
        title: "One story, Website draft v3",
        excerpt: "Approval remains on revision two.",
        bodyText: "A new exact revision requires a new review.",
        mediaAssetIds: [assetId],
      },
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.json()).toMatchObject({
      draft: { currentRevision: 3 },
    });
    expect(revised.json<{ draft: { review?: unknown } }>().draft.review).toBe(
      undefined,
    );
    const queueAfterRevision = await app.inject({
      method: "GET",
      url: `/api/content-items/website-review-queue?workspaceId=${seed.workspaceA}`,
      headers: headers(approverSession),
    });
    expect(queueAfterRevision.json()).toMatchObject({ items: [] });
  });

  it("creates independent Facebook and Instagram native drafts and revisions", async () => {
    for (const [destination, socialAccountId] of [
      ["facebook", facebookId],
      ["instagram", instagramId],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/content-items/${itemId}/variants`,
        headers: headers(adminSession),
        payload: {
          destination,
          socialAccountId,
          caption: `${destination} copy`,
        },
      });
      expect(response.statusCode).toBe(201);
    }
    let item = await new UnifiedContentService(runtime).get(
      seed.tenantA,
      itemId,
    );
    const facebook = item.variants.find(
      (variant) => variant.destination === "facebook",
    )!;
    const instagram = item.variants.find(
      (variant) => variant.destination === "instagram",
    )!;
    expect(facebook.socialDraftId).toBeTruthy();
    expect(instagram.socialDraftId).toBeTruthy();
    expect(facebook.socialDraftId).not.toBe(instagram.socialDraftId);

    const revised = await app.inject({
      method: "PATCH",
      url: `/api/content-items/${itemId}/variants/${facebook.id}`,
      headers: headers(adminSession),
      payload: { expectedRevision: 1, caption: "Facebook revision two" },
    });
    expect(revised.statusCode).toBe(200);
    item = revised.json<{ item: typeof item }>().item;
    expect(
      item.variants.find((variant) => variant.destination === "facebook")
        ?.currentRevision,
    ).toBe(2);
    expect(
      item.variants.find((variant) => variant.destination === "instagram")
        ?.currentRevision,
    ).toBe(1);
  });

  it("links a website variant to Website Control and preserves partial success", async () => {
    const service = new UnifiedContentService(runtime);
    const created = await app.inject({
      method: "POST",
      url: `/api/content-items/${itemId}/variants`,
      headers: headers(adminSession),
      payload: {
        destination: "website",
        websiteConnectionId,
        slug: "one-story-three-destinations",
        websiteBody: {
          version: 1,
          blocks: [{ type: "paragraph", text: "Website copy" }],
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const website = created
      .json<{ item: Awaited<ReturnType<UnifiedContentService["get"]>> }>()
      .item.variants.find((variant) => variant.destination === "website")!;
    expect(website.externalId).toBe(websiteArticleId);
    await service.completeVariant({
      tenantId: seed.tenantA,
      itemId,
      variantId: website.id,
      actorUserId: seed.adminUser,
      status: "published",
      currentRevision: 3,
      externalId: websiteArticleId,
      correlationId: randomUUID(),
    });
    const item = await service.get(seed.tenantA, itemId);
    const facebook = item.variants.find(
      (variant) => variant.destination === "facebook",
    )!;
    await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        "UPDATE control.social_drafts SET status='failed' WHERE id=$1",
        [facebook.socialDraftId],
      ),
    );
    const result = await service.get(seed.tenantA, itemId);
    expect(result.deliveryStatus).toBe("partial");
    expect(
      result.variants.find((variant) => variant.destination === "website")
        ?.status,
    ).toBe("published");
    expect(
      result.variants.find((variant) => variant.destination === "facebook")
        ?.status,
    ).toBe("failed");
  });

  it("enforces RLS, workspace media ownership and feature entitlements", async () => {
    const service = new UnifiedContentService(runtime);
    await expect(service.get(seed.tenantB, itemId)).rejects.toThrow(
      "CONTENT_ITEM_NOT_FOUND",
    );
    await expect(
      service.websiteDestinationPreflight({
        tenantId: seed.tenantB,
        itemId,
      }),
    ).rejects.toThrow("CONTENT_ITEM_NOT_FOUND");
    await expect(
      service.getWebsiteDraft({ tenantId: seed.tenantB, itemId }),
    ).rejects.toThrow("CONTENT_ITEM_NOT_FOUND");
    await expect(
      service.create({
        tenantId: seed.tenantA,
        workspaceId: seed.workspaceA,
        actorUserId: seed.adminUser,
        title: "Foreign media",
        mediaAssetIds: [randomUUID()],
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("CONTENT_MEDIA_NOT_READY_OR_NOT_FOUND");
    await withTenant(runtime, seed.tenantA, (client) =>
      client.query(
        "UPDATE control.feature_flags SET enabled=false WHERE name='module.unified-content'",
      ),
    );
    await expect(
      service.create({
        tenantId: seed.tenantA,
        workspaceId: seed.workspaceA,
        actorUserId: seed.adminUser,
        title: "Disabled",
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("UNIFIED_CONTENT_NOT_ENTITLED");
  });
});
