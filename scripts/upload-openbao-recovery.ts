import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

function value(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (file) return readFileSync(file, "utf8").trim();
  throw new Error(`Missing ${name} or ${name}_FILE`);
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath || !isAbsolute(inputPath))
    throw new Error("An absolute encrypted recovery-bundle path is required");
  const metadata = statSync(inputPath);
  if (!metadata.isFile() || metadata.size < 128 || metadata.size > 1024 * 1024)
    throw new Error("Invalid encrypted recovery bundle");
  if ((metadata.mode & 0o077) !== 0)
    throw new Error("Recovery bundle must not be group/world accessible");

  const bytes = readFileSync(inputPath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const key = value("OPENBAO_RECOVERY_OBJECT_KEY");
  if (
    !/^redi-control\/production\/recovery\/openbao\/[a-zA-Z0-9._-]{20,180}\.gpg$/.test(
      key,
    )
  )
    throw new Error("Invalid recovery object key");

  const client = new S3Client({
    endpoint: value("OBJECT_STORAGE_ENDPOINT"),
    region: value("OBJECT_STORAGE_REGION"),
    forcePathStyle: value("OBJECT_STORAGE_FORCE_PATH_STYLE") === "true",
    credentials: {
      accessKeyId: value("OBJECT_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: value("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    },
  });
  const bucket = value("OBJECT_STORAGE_BUCKET");

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    throw new Error("Recovery object already exists; refusing overwrite");
  } catch (error) {
    if (
      !(error instanceof S3ServiceException) ||
      error.$metadata.httpStatusCode !== 404
    )
      throw error;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/pgp-encrypted",
      Metadata: { "local-sha256": checksum },
    }),
  );

  const stored = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const downloaded = Buffer.from(await stored.Body!.transformToByteArray());
  const storedChecksum = createHash("sha256").update(downloaded).digest("hex");
  if (!downloaded.equals(bytes) || storedChecksum !== checksum)
    throw new Error("Stored recovery bundle verification failed");

  process.stdout.write(
    `Encrypted OpenBao recovery bundle uploaded and verified.\nObject: s3://${bucket}/${key}\nSHA-256: ${checksum}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Recovery upload failed"}\n`,
  );
  process.exitCode = 1;
});
