import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPool,
  migrateDatabase,
  seedLocalTestData,
  withTenant,
  type SeedResult,
} from "@redi-control/database";
import {
  DeterministicMalwareScanner,
  DeterministicMediaInspector,
  DeterministicSocialOAuthAdapter,
  DeterministicSocialProvider,
  LocalObjectStorageClient,
  LocalTokenSecretProvider,
  MediaLibraryService,
  OAuthFoundationService,
  SocialPublishingService,
  buildLocalObjectStorageServer,
  metaConnectorManifest,
} from "@redi-control/media-social";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

const adminUrl = required("DATABASE_ADMIN_URL");
const runtimeUrl = required("DATABASE_URL");
const runtimePassword = required("DATABASE_RUNTIME_PASSWORD");
const authPassword = required("DATABASE_AUTH_PASSWORD");
const admin = createPool(adminUrl, "redi-control-m3a-admin");
const runtime = createPool(runtimeUrl, "redi-control-m3a-runtime");
const secrets = new LocalTokenSecretProvider();
const redirect = "http://127.0.0.1:3001/api/social/oauth/callback";
let seed: SeedResult;
let storageRoot: string;
let storageServer: ReturnType<typeof buildLocalObjectStorageServer>;
let media: MediaLibraryService;
let oauth: OAuthFoundationService;
let oauthAdapter: DeterministicSocialOAuthAdapter;
let publishing: SocialPublishingService;
let meta: DeterministicSocialProvider;
let assetId: string;
let accountIds: readonly string[];

beforeAll(async () => {
  await admin.query("DROP SCHEMA IF EXISTS control CASCADE");
  await migrateDatabase({ adminUrl, runtimePassword, authPassword });
  seed = await seedLocalTestData(adminUrl);
  await admin.query(
    "INSERT INTO control.memberships (tenant_id,user_id,role) VALUES ($1,$2,'approver')",
    [seed.tenantA, seed.analystUser],
  );
  storageRoot = await mkdtemp(join(tmpdir(), "redi-m3a-storage-"));
  storageServer = buildLocalObjectStorageServer({
    rootDirectory: storageRoot,
    signingSecret: "integration-signing-secret",
    maxObjectBytes: 1024 * 1024,
  });
  await storageServer.listen({ host: "127.0.0.1", port: 0 });
  media = new MediaLibraryService(
    runtime,
    new LocalObjectStorageClient(
      storageServer.listeningOrigin,
      "integration-signing-secret",
    ),
    new DeterministicMalwareScanner(),
    new DeterministicMediaInspector(),
    {
      allowedMimeTypes: new Set(["image/png", "video/mp4"]),
      maxImageBytes: 1024,
      maxVideoBytes: 1024,
      uploadTtlSeconds: 60,
      downloadTtlSeconds: 60,
      standardRetentionDays: 90,
      multipartThresholdBytes: 10,
    },
  );
  oauth = new OAuthFoundationService(
    runtime,
    secrets,
    "oauth-state-signing-secret",
    new Set([redirect]),
  );
  oauthAdapter = new DeterministicSocialOAuthAdapter(
    "meta",
    [
      {
        providerAccountId: "page-a",
        accountType: "facebook_page",
        displayName: "Page A",
      },
      {
        providerAccountId: "instagram-a",
        accountType: "instagram_account",
        displayName: "Instagram A",
      },
    ],
    [
      "pages.show-list",
      "pages.manage-posts",
      "instagram.basic",
      "instagram.content-publish",
    ],
  );
  oauth.register(oauthAdapter);
  publishing = new SocialPublishingService(runtime, secrets);
  meta = new DeterministicSocialProvider("meta", metaConnectorManifest);
  publishing.registerProvider(meta);
});

afterAll(async () => {
  await storageServer.close();
  await rm(storageRoot, { recursive: true, force: true });
  await Promise.all([admin.end(), runtime.end()]);
});

describe("Milestone 3A real storage, OAuth, RLS and publishing gates", () => {
  it("migrates from empty with a real non-bypass runtime role", async () => {
    expect(
      (
        await admin.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM control.schema_migrations",
        )
      ).rows[0]?.count,
    ).toBe(44);
    expect(
      (
        await runtime.query(
          "SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0],
    ).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("uploads directly, verifies bytes, rejects reuse and isolates object metadata", async () => {
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisomlocal-video"),
    ]);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const upload = await media.requestUpload({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      originalFilename: "local.mp4",
      mimeType: "video/mp4",
      sizeBytes: bytes.length,
      checksumSha256: checksum,
      correlationId: randomUUID(),
    });
    expect(upload.resumable).toBe(true);
    expect(
      (await fetch(upload.uploadUrl, { method: "PUT", body: bytes })).status,
    ).toBe(201);
    assetId = await media.finalizeUpload({
      tenantId: seed.tenantA,
      uploadSessionId: upload.uploadSessionId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    await expect(
      media.finalizeUpload({
        tenantId: seed.tenantA,
        uploadSessionId: upload.uploadSessionId,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("UPLOAD_SESSION_ALREADY_FINALIZED");
    expect(await media.list(seed.tenantA, seed.workspaceA)).toHaveLength(1);
    expect(await media.list(seed.tenantB, seed.workspaceB)).toHaveLength(0);
    await expect(
      media.createDownload({ tenantId: seed.tenantB, assetId }),
    ).rejects.toThrow("MEDIA_ASSET_NOT_FOUND");
    const hidden = await withTenant(runtime, seed.tenantB, (client) =>
      client.query("SELECT id FROM control.media_assets WHERE id=$1", [
        assetId,
      ]),
    );
    expect(hidden.rowCount).toBe(0);
    const changed = await withTenant(runtime, seed.tenantB, (client) =>
      client.query(
        "UPDATE control.media_assets SET original_filename='stolen' WHERE id=$1",
        [assetId],
      ),
    );
    expect(changed.rowCount).toBe(0);

    const spoof = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypnot-a-png"),
    ]);
    const spoofUpload = await media.requestUpload({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      originalFilename: "spoof.png",
      mimeType: "image/png",
      sizeBytes: spoof.length,
      checksumSha256: createHash("sha256").update(spoof).digest("hex"),
      correlationId: randomUUID(),
    });
    expect(
      (await fetch(spoofUpload.uploadUrl, { method: "PUT", body: spoof }))
        .status,
    ).toBe(201);
    await expect(
      media.finalizeUpload({
        tenantId: seed.tenantA,
        uploadSessionId: spoofUpload.uploadSessionId,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("media_verification_failed");

    const expired = await media.requestUpload({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      originalFilename: "expired.mp4",
      mimeType: "video/mp4",
      sizeBytes: bytes.length,
      checksumSha256: checksum,
      correlationId: randomUUID(),
    });
    await admin.query(
      "UPDATE control.media_upload_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.uploadSessionId],
    );
    await expect(
      media.finalizeUpload({
        tenantId: seed.tenantA,
        uploadSessionId: expired.uploadSessionId,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("UPLOAD_SESSION_EXPIRED");
  });

  it("consumes signed OAuth state once, validates redirect and scope, and persists only secret references", async () => {
    await expect(
      oauth.begin({
        tenantId: seed.tenantA,
        workspaceId: seed.workspaceA,
        actorUserId: seed.adminUser,
        provider: "meta",
        redirectUri: "https://evil.invalid/callback",
        scopes: ["pages.manage-posts"],
      }),
    ).rejects.toThrow("REDIRECT_URI_NOT_ALLOWED");
    const begin = await oauth.begin({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      provider: "meta",
      redirectUri: redirect,
      scopes: [
        "pages.show-list",
        "pages.manage-posts",
        "instagram.basic",
        "instagram.content-publish",
      ],
    });
    await expect(
      oauth.complete({
        tenantId: seed.tenantA,
        state: begin.state,
        code: "local-valid-code",
        redirectUri: redirect,
        expectedOrigin: "https://other.example.test",
        provider: "meta",
      }),
    ).rejects.toThrow("OAUTH_STATE_CONTEXT_MISMATCH");
    await expect(
      oauth.complete({
        tenantId: seed.tenantA,
        state: begin.state,
        code: "local-valid-code",
        redirectUri: redirect,
        provider: "youtube",
      }),
    ).rejects.toThrow("OAUTH_STATE_CONTEXT_MISMATCH");
    await expect(
      oauth.complete({
        tenantId: seed.tenantA,
        state: `${begin.state}x`,
        code: "local-valid-code",
        redirectUri: redirect,
      }),
    ).rejects.toThrow("INVALID_OAUTH_STATE");
    accountIds = (
      await oauth.complete({
        tenantId: seed.tenantA,
        state: begin.state,
        code: "local-valid-code",
        redirectUri: redirect,
      })
    ).accountIds;
    await expect(
      oauth.complete({
        tenantId: seed.tenantA,
        state: begin.state,
        code: "local-valid-code",
        redirectUri: redirect,
      }),
    ).rejects.toThrow("OAUTH_STATE_EXPIRED_OR_USED");
    oauthAdapter.mode = "scope-mismatch";
    const mismatch = await oauth.begin({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      provider: "meta",
      redirectUri: redirect,
      scopes: ["pages.manage-posts"],
    });
    await expect(
      oauth.complete({
        tenantId: seed.tenantA,
        state: mismatch.state,
        code: "local-valid-code",
        redirectUri: redirect,
      }),
    ).rejects.toThrow("OAUTH_SCOPE_MISMATCH");
    await expect(
      oauth.complete({
        tenantId: seed.tenantA,
        state: mismatch.state,
        code: "local-valid-code",
        redirectUri: redirect,
      }),
    ).rejects.toThrow("OAUTH_STATE_EXPIRED_OR_USED");
    oauthAdapter.mode = "success";
    await oauth.refreshAccount({
      tenantId: seed.tenantA,
      accountId: accountIds[0]!,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    const persisted = await withTenant(runtime, seed.tenantA, (client) =>
      client.query("SELECT token_reference FROM control.social_accounts"),
    );
    expect(JSON.stringify(persisted.rows)).toContain("secret://social/meta/");
    expect(JSON.stringify(persisted.rows)).not.toContain("local-access-");
    expect(
      JSON.stringify(
        (
          await admin.query(
            "SELECT metadata::text FROM control.audit_events UNION ALL SELECT payload::text FROM control.outbox_events",
          )
        ).rows,
      ),
    ).not.toContain("local-access-");
  });

  it("enforces immutable approved revisions, independent approval, timezone jobs, idempotency and partial outcomes", async () => {
    const otherWorkspace = randomUUID();
    await admin.query(
      `INSERT INTO control.business_workspaces
       (id,tenant_id,installation_id,name) VALUES ($1,$2,$3,$4)`,
      [
        otherWorkspace,
        seed.tenantA,
        seed.installationA,
        `Other workspace ${otherWorkspace.slice(0, 8)}`,
      ],
    );
    await expect(
      publishing.createDraft({
        tenantId: seed.tenantA,
        workspaceId: otherWorkspace,
        actorUserId: seed.adminUser,
        accountIds: [accountIds[0]!],
        content: { caption: "cross-workspace", mediaAssetIds: [assetId] },
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("MEDIA_NOT_READY_OR_NOT_FOUND");
    await admin.query(
      "UPDATE control.social_accounts SET status='revoked' WHERE id=$1",
      [accountIds[0]],
    );
    await expect(
      publishing.createDraft({
        tenantId: seed.tenantA,
        workspaceId: seed.workspaceA,
        actorUserId: seed.adminUser,
        accountIds: [accountIds[0]!],
        content: { caption: "revoked-target", mediaAssetIds: [assetId] },
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("SOCIAL_ACCOUNT_NOT_FOUND");
    await admin.query(
      "UPDATE control.social_accounts SET status='active' WHERE id=$1",
      [accountIds[0]],
    );
    const draftId = await publishing.createDraft({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      accountIds,
      content: { caption: "revision one", mediaAssetIds: [assetId] },
      correlationId: randomUUID(),
    });
    await publishing.submitForReview({
      tenantId: seed.tenantA,
      draftId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    await expect(
      publishing.decide({
        tenantId: seed.tenantA,
        draftId,
        reviewerUserId: seed.adminUser,
        decision: "approved",
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("SELF_APPROVAL_DENIED");
    await publishing.decide({
      tenantId: seed.tenantA,
      draftId,
      reviewerUserId: seed.analystUser,
      decision: "approved",
      correlationId: randomUUID(),
    });
    await expect(
      admin.query(
        "UPDATE control.social_draft_revisions SET caption='mutated' WHERE draft_id=$1",
        [draftId],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      publishing.schedule({
        tenantId: seed.tenantA,
        draftId,
        actorUserId: seed.adminUser,
        scheduledFor: new Date(Date.now() + 60_000),
        timezone: "Not/AZone",
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("INVALID_TIMEZONE");
    await publishing.schedule({
      tenantId: seed.tenantA,
      draftId,
      actorUserId: seed.adminUser,
      scheduledFor: new Date(Date.now() + 60_000),
      timezone: "Europe/Berlin",
      correlationId: randomUUID(),
    });
    const targets = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ id: string }>(
        "SELECT id FROM control.social_draft_targets WHERE draft_id=$1 ORDER BY channel",
        [draftId],
      ),
    );
    expect(
      (
        await withTenant(runtime, seed.tenantA, (client) =>
          client.query(
            "SELECT id FROM control.jobs WHERE payload->>'draftId'=$1",
            [draftId],
          ),
        )
      ).rowCount,
    ).toBe(2);
    const first = await publishing.publishTarget({
      tenantId: seed.tenantA,
      targetId: targets.rows[0]!.id,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    expect(
      await publishing.publishTarget({
        tenantId: seed.tenantA,
        targetId: targets.rows[0]!.id,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).toEqual(first);
    expect(meta.calls).toBe(1);
    meta.mode = "failure";
    expect(
      await publishing.publishTarget({
        tenantId: seed.tenantA,
        targetId: targets.rows[1]!.id,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).toEqual({ status: "failed" });
    expect(
      (
        await withTenant(runtime, seed.tenantA, (client) =>
          client.query<{ status: string }>(
            "SELECT status FROM control.social_drafts WHERE id=$1",
            [draftId],
          ),
        )
      ).rows[0]?.status,
    ).toBe("partial");
    const evidence = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ audits: number; outbox: number }>(
        "SELECT (SELECT count(*)::int FROM control.audit_events WHERE target_id=$1::text) audits,(SELECT count(*)::int FROM control.outbox_events WHERE payload->>'targetId'=$1::text) outbox",
        [draftId],
      ),
    );
    expect(evidence.rows[0]?.audits).toBeGreaterThan(0);
    expect(evidence.rows[0]?.outbox).toBeGreaterThan(0);
  });

  it("requires reapproval after editing and refuses expired and TikTok publication", async () => {
    meta.mode = "success";
    const draftId = await publishing.createDraft({
      tenantId: seed.tenantA,
      workspaceId: seed.workspaceA,
      actorUserId: seed.adminUser,
      accountIds: [accountIds[0]!],
      content: { caption: "before", mediaAssetIds: [assetId] },
      correlationId: randomUUID(),
    });
    await publishing.submitForReview({
      tenantId: seed.tenantA,
      draftId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    await publishing.decide({
      tenantId: seed.tenantA,
      draftId,
      reviewerUserId: seed.analystUser,
      decision: "approved",
      correlationId: randomUUID(),
    });
    expect(
      await publishing.reviseDraft({
        tenantId: seed.tenantA,
        draftId,
        actorUserId: seed.adminUser,
        accountIds: [accountIds[0]!],
        content: { caption: "after", mediaAssetIds: [assetId] },
        correlationId: randomUUID(),
      }),
    ).toBe(2);
    await expect(
      publishing.schedule({
        tenantId: seed.tenantA,
        draftId,
        actorUserId: seed.adminUser,
        scheduledFor: new Date(Date.now() + 60_000),
        timezone: "UTC",
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("DRAFT_NOT_APPROVED");
    await publishing.submitForReview({
      tenantId: seed.tenantA,
      draftId,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    await publishing.decide({
      tenantId: seed.tenantA,
      draftId,
      reviewerUserId: seed.analystUser,
      decision: "approved",
      correlationId: randomUUID(),
    });
    await publishing.schedule({
      tenantId: seed.tenantA,
      draftId,
      actorUserId: seed.adminUser,
      scheduledFor: new Date(Date.now() + 60_000),
      timezone: "UTC",
      correlationId: randomUUID(),
    });
    await admin.query(
      "UPDATE control.social_accounts SET token_expires_at=now()-interval '1 minute' WHERE id=$1",
      [accountIds[0]],
    );
    const target = await withTenant(runtime, seed.tenantA, (client) =>
      client.query<{ id: string }>(
        "SELECT id FROM control.social_draft_targets WHERE draft_id=$1 AND revision_id=(SELECT id FROM control.social_draft_revisions WHERE draft_id=$1 AND revision_number=2)",
        [draftId],
      ),
    );
    expect(
      await publishing.publishTarget({
        tenantId: seed.tenantA,
        targetId: target.rows[0]!.id,
        actorUserId: seed.adminUser,
        correlationId: randomUUID(),
      }),
    ).toEqual({ status: "needs_reauthorization" });
    expect(
      (
        await withTenant(runtime, seed.tenantA, (client) =>
          client.query<{ status: string }>(
            "SELECT status FROM control.social_accounts WHERE id=$1",
            [accountIds[0]],
          ),
        )
      ).rows[0]?.status,
    ).toBe("reauthorization_required");
    await oauth.revokeAccount({
      tenantId: seed.tenantA,
      accountId: accountIds[0]!,
      actorUserId: seed.adminUser,
      correlationId: randomUUID(),
    });
    expect(
      (
        await withTenant(runtime, seed.tenantA, (client) =>
          client.query<{ status: string }>(
            "SELECT status FROM control.social_accounts WHERE id=$1",
            [accountIds[0]],
          ),
        )
      ).rows[0]?.status,
    ).toBe("revoked");
  });
});
