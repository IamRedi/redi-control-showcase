import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
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

async function sha256Stream(
  stream: AsyncIterable<Uint8Array>,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath || !isAbsolute(inputPath))
    throw new Error("An absolute encrypted PostgreSQL backup path is required");
  const metadata = statSync(inputPath);
  if (!metadata.isFile() || metadata.size < 256)
    throw new Error("Invalid encrypted PostgreSQL backup");
  if ((metadata.mode & 0o077) !== 0)
    throw new Error("PostgreSQL backup must not be group/world accessible");

  const key = value("POSTGRES_BACKUP_OBJECT_KEY");
  if (
    !/^redi-control\/production\/backups\/postgres\/redi-control-[0-9]{8}T[0-9]{6}Z\.dump\.gpg$/.test(
      key,
    )
  )
    throw new Error("Invalid PostgreSQL backup object key");

  const checksum = await sha256Stream(createReadStream(inputPath));
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
    throw new Error(
      "PostgreSQL backup object already exists; refusing overwrite",
    );
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
      Body: createReadStream(inputPath),
      ContentType: "application/pgp-encrypted",
      Metadata: { "local-sha256": checksum },
    }),
  );

  const stored = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!stored.Body) throw new Error("Stored PostgreSQL backup has no body");
  const storedChecksum = await sha256Stream(
    stored.Body as AsyncIterable<Uint8Array>,
  );
  if (storedChecksum !== checksum)
    throw new Error("Stored PostgreSQL backup verification failed");

  process.stdout.write(
    `Encrypted PostgreSQL backup uploaded and verified.\nObject: s3://${bucket}/${key}\nSHA-256: ${checksum}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "PostgreSQL backup upload failed"}\n`,
  );
  process.exitCode = 1;
});
