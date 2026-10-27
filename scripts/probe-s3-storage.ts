import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { S3CompatibleObjectStorageClient } from "../packages/media-social/src/storage.js";

function required(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  const value = file ? readFileSync(file, "utf8").trim() : "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const tenantId = randomUUID();
const assetId = randomUUID();
const objectKey = `tenant/${tenantId}/media/${assetId}/probe.webp`;
const bytes = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBP"),
  randomBytes(64),
]);
const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
const storage = new S3CompatibleObjectStorageClient({
  endpoint: required("OBJECT_STORAGE_ENDPOINT"),
  region: required("OBJECT_STORAGE_REGION"),
  bucket: required("OBJECT_STORAGE_BUCKET"),
  accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY_ID"),
  secretAccessKey: required("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
  forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
  ...(process.env.OBJECT_STORAGE_KEY_PREFIX?.trim()
    ? { keyPrefix: process.env.OBJECT_STORAGE_KEY_PREFIX.trim() }
    : {}),
});

async function main(): Promise<void> {
  try {
    if (!(await storage.health())) throw new Error("Bucket readiness failed");
    const grant = await storage.createUploadGrant({
      objectKey,
      mimeType: "image/webp",
      sizeBytes: bytes.length,
      checksumSha256,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      resumable: false,
    });
    const upload = await fetch(grant.uploadUrl, {
      method: "PUT",
      headers: grant.uploadHeaders ?? {},
      body: bytes,
    });
    if (!upload.ok)
      throw new Error(
        `Signed upload failed with HTTP ${String(upload.status)}`,
      );
    const metadata = await storage.head(objectKey);
    if (
      !metadata ||
      metadata.sizeBytes !== bytes.length ||
      metadata.checksumSha256 !== checksumSha256 ||
      metadata.declaredMimeType !== "image/webp" ||
      metadata.observedMimeType !== "image/webp"
    )
      throw new Error("Stored object integrity verification failed");
    const downloadUrl = await storage.createDownloadUrl(
      objectKey,
      new Date(Date.now() + 60_000),
    );
    const download = await fetch(downloadUrl);
    if (
      !download.ok ||
      !Buffer.from(await download.arrayBuffer()).equals(bytes)
    )
      throw new Error("Signed download verification failed");
    process.stdout.write(
      `S3-compatible storage probe passed for ${new URL(required("OBJECT_STORAGE_ENDPOINT")).hostname}.\n`,
    );
  } finally {
    await storage.delete(objectKey).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
