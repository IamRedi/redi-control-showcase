import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DeterministicSocialProvider,
  DisabledSocialProvider,
  LocalObjectStorageClient,
  buildLocalObjectStorageServer,
  metaConnectorManifest,
  tiktokConnectorManifest,
  youtubeConnectorManifest,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("local object storage security boundary", () => {
  it("enforces signed expiry and exact metadata, supports ranges, and detects content", async () => {
    const root = await mkdtemp(join(tmpdir(), "redi-storage-"));
    roots.push(root);
    const server = buildLocalObjectStorageServer({
      rootDirectory: root,
      signingSecret: "unit-signing-secret",
      maxObjectBytes: 1024,
    });
    await server.listen({ host: "127.0.0.1", port: 0 });
    try {
      const client = new LocalObjectStorageClient(
        server.listeningOrigin,
        "unit-signing-secret",
      );
      const bytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("safe"),
      ]);
      const key = `tenant/${randomUUID()}/media/${randomUUID()}/original.png`;
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const grant = await client.createUploadGrant({
        objectKey: key,
        mimeType: "image/png",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
        expiresAt: new Date(Date.now() + 60_000),
        resumable: true,
      });
      expect(
        (
          await fetch(grant.uploadUrl, {
            method: "PUT",
            headers: { "content-range": `bytes 0-4/${bytes.length}` },
            body: bytes.subarray(0, 5),
          })
        ).status,
      ).toBe(308);
      expect(
        (
          await fetch(grant.uploadUrl, {
            method: "PUT",
            headers: {
              "content-range": `bytes 5-${bytes.length - 1}/${bytes.length}`,
            },
            body: bytes.subarray(5),
          })
        ).status,
      ).toBe(201);
      expect(
        (await fetch(grant.uploadUrl, { method: "PUT", body: bytes })).status,
      ).toBe(409);
      await expect(client.head(key)).resolves.toMatchObject({
        sizeBytes: bytes.length,
        checksumSha256: checksum,
        declaredMimeType: "image/png",
        observedMimeType: "image/png",
      });
      const download = await client.createDownloadUrl(
        key,
        new Date(Date.now() + 60_000),
      );
      expect(Buffer.from(await (await fetch(download)).arrayBuffer())).toEqual(
        bytes,
      );
      expect(
        (
          await fetch(`${grant.uploadUrl}tampered`, {
            method: "PUT",
            body: bytes,
          })
        ).status,
      ).toBe(403);
      const expired = await client.createUploadGrant({
        objectKey: key,
        mimeType: "image/png",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
        expiresAt: new Date(Date.now() - 1_000),
        resumable: false,
      });
      expect(
        (await fetch(expired.uploadUrl, { method: "PUT", body: bytes })).status,
      ).toBe(403);
    } finally {
      await server.close();
    }
  });
});

describe("provider contracts", () => {
  it("keeps TikTok fail-closed and makes Meta retries deterministic", async () => {
    const tiktok = new DisabledSocialProvider(
      "tiktok",
      tiktokConnectorManifest,
    );
    await expect(tiktok.publish()).rejects.toMatchObject({
      category: "disabled",
      retryable: false,
    });
    const meta = new DeterministicSocialProvider("meta", metaConnectorManifest);
    const payload = {
      caption: "local",
      media: [
        {
          assetId: randomUUID(),
          objectKey: `tenant/${randomUUID()}/media/${randomUUID()}/original.png`,
          mimeType: "image/png" as const,
          sizeBytes: 12,
        },
      ],
    };
    const context = {
      accountType: "facebook_page",
      idempotencyKey: "same-revision-target",
      token: "local-only",
    };
    expect(await meta.publish(payload, context)).toEqual(
      await meta.publish(payload, context),
    );
    expect(meta.calls).toBe(1);
    const [mediaItem] = payload.media;
    if (!mediaItem) throw new Error("TEST_MEDIA_MISSING");
    const youtube = new DeterministicSocialProvider(
      "youtube",
      youtubeConnectorManifest,
    );
    youtube.mode = "transient";
    await expect(
      youtube.publish(
        {
          ...payload,
          media: [{ ...mediaItem, mimeType: "video/mp4" }],
        },
        {
          ...context,
          accountType: "youtube_channel",
          idempotencyKey: "youtube-transient",
        },
      ),
    ).rejects.toMatchObject({ category: "transient", retryable: true });
    youtube.mode = "success";
    await expect(
      youtube.publish(
        {
          ...payload,
          media: [{ ...mediaItem, mimeType: "video/mp4" }],
        },
        {
          ...context,
          accountType: "youtube_channel",
          idempotencyKey: "youtube-success",
        },
      ),
    ).resolves.toMatchObject({ status: "published" });
  });
});
