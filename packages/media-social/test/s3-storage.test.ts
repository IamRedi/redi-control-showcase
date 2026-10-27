import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { S3CompatibleObjectStorageClient } from "../src/storage.js";

const objectKey =
  "tenant/00000000-0000-4000-8000-000000000001/media/00000000-0000-4000-8000-000000000002/original.jpg";
const checksum = "ab".repeat(32);

function storage(): S3CompatibleObjectStorageClient {
  return new S3CompatibleObjectStorageClient({
    endpoint: "https://objects.example.test",
    region: "eu-central-1",
    bucket: "redi-control-test",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    forcePathStyle: true,
    keyPrefix: "installations/production",
  });
}

afterEach(() => vi.restoreAllMocks());

describe("S3-compatible object storage", () => {
  it("creates a short-lived private direct-upload grant without vendor URLs", async () => {
    const grant = await storage().createUploadGrant({
      objectKey,
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      checksumSha256: checksum,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      resumable: false,
    });
    const url = new URL(grant.uploadUrl);
    expect(url.origin).toBe("https://objects.example.test");
    expect(url.pathname).toContain("redi-control-test");
    expect(url.pathname).toContain("installations/production/tenant/");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    );
    expect(url.searchParams.get("x-amz-checksum-sha256")).toBe(
      Buffer.from(checksum, "hex").toString("base64"),
    );
    expect(grant.uploadHeaders).toEqual({
      "content-type": "image/jpeg",
      "x-amz-checksum-sha256": Buffer.from(checksum, "hex").toString("base64"),
    });
    expect(grant.resumable).toBe(false);
  });

  it("streams stored bytes to verify their checksum and sniff their type", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    const streamedChecksum = createHash("sha256").update(bytes).digest("hex");
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({
        ContentLength: 1234,
        ContentType: "image/jpeg",
        Metadata: {
          "declared-mime-type": "image/jpeg",
          "checksum-sha256": checksum,
        },
      } as never)
      .mockResolvedValueOnce({
        Body: Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]),
      } as never);
    await expect(storage().head(objectKey)).resolves.toEqual({
      objectKey,
      sizeBytes: 1234,
      checksumSha256: streamedChecksum,
      declaredMimeType: "image/jpeg",
      observedMimeType: "image/jpeg",
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(
      (send.mock.calls[1]?.[0] as GetObjectCommand).input.Range,
    ).toBeUndefined();
  });

  it("fails closed when a provider checksum differs from stored bytes", async () => {
    vi.spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({
        ContentLength: 4,
        ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64"),
      } as never)
      .mockResolvedValueOnce({
        Body: Readable.from([Uint8Array.from([0xff, 0xd8, 0xff, 0x00])]),
      } as never);
    await expect(storage().head(objectKey)).rejects.toThrow(
      "OBJECT_STORAGE_UNAVAILABLE",
    );
  });

  it("uses bucket-scoped readiness and idempotent S3 deletion", async () => {
    const commands: string[] = [];
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    const client = storage();
    await expect(client.health()).resolves.toBe(true);
    await expect(client.delete(objectKey)).resolves.toBeUndefined();
    commands.push(
      ...send.mock.calls.map(([command]) => command.constructor.name),
    );
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(commands).toEqual(["HeadBucketCommand", "DeleteObjectCommand"]);
  });

  it("rejects insecure endpoints and invalid tenant object keys", async () => {
    expect(
      () =>
        new S3CompatibleObjectStorageClient({
          endpoint: "http://objects.example.test",
          region: "eu-central-1",
          bucket: "redi-control-test",
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret-key",
        }),
    ).toThrow("OBJECT_STORAGE_ENDPOINT_MUST_USE_HTTPS");
    await expect(
      storage().createDownloadUrl(
        "another-tenant/object.jpg",
        new Date(Date.now() + 60_000),
      ),
    ).rejects.toThrow("INVALID_OBJECT_KEY");
  });
});
