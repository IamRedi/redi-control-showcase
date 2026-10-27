import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Fastify, { type FastifyInstance } from "fastify";

const objectKeyPattern =
  /^tenant\/[0-9a-f-]{36}\/media\/[0-9a-f-]{36}\/[a-z0-9._-]+$/;

export interface SignedUploadGrant {
  readonly uploadUrl: string;
  readonly uploadHeaders?: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly objectKey: string;
  readonly resumable: boolean;
}

export interface StoredObjectMetadata {
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly declaredMimeType: string;
  readonly observedMimeType: string;
}

export interface ObjectStoragePort {
  health(): Promise<boolean>;
  createUploadGrant(input: {
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    expiresAt: Date;
    resumable: boolean;
  }): Promise<SignedUploadGrant>;
  head(objectKey: string): Promise<StoredObjectMetadata | null>;
  createDownloadUrl(objectKey: string, expiresAt: Date): Promise<string>;
  delete(objectKey: string): Promise<void>;
}

export interface S3CompatibleObjectStorageOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle?: boolean;
  readonly keyPrefix?: string;
}

function signaturePayload(input: {
  method: string;
  key: string;
  expires: string;
  mime: string;
  size: string;
  checksum: string;
  resumable: string;
}): string {
  return [
    input.method,
    input.key,
    input.expires,
    input.mime,
    input.size,
    input.checksum,
    input.resumable,
  ].join("\n");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function observedMime(bytes: Buffer): string {
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  return "application/octet-stream";
}

function validatedPath(root: string, key: string): string {
  if (!objectKeyPattern.test(key)) throw new Error("INVALID_OBJECT_KEY");
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, key);
  const relativeTarget = relative(resolvedRoot, target);
  if (
    !relativeTarget ||
    isAbsolute(relativeTarget) ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`)
  )
    throw new Error("INVALID_OBJECT_KEY");
  return target;
}

interface StorageQuery {
  expires?: string;
  mime?: string;
  size?: string;
  checksum?: string;
  resumable?: string;
  signature?: string;
}

export function buildLocalObjectStorageServer(options: {
  rootDirectory: string;
  signingSecret: string;
  maxObjectBytes: number;
}): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: options.maxObjectBytes + 1024,
  });
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );

  app.get("/health/live", () => ({ status: "alive" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await mkdir(options.rootDirectory, { recursive: true });
      await stat(options.rootDirectory);
      return { status: "ready", storage: "writable_local" };
    } catch {
      return reply
        .code(503)
        .send({ status: "not_ready", storage: "unavailable" });
    }
  });

  function authorize(
    method: string,
    key: string,
    query: StorageQuery,
  ): boolean {
    const expires = query.expires ?? "";
    const candidate = query.signature ?? "";
    if (
      !/^\d+$/.test(expires) ||
      Number(expires) <= Math.floor(Date.now() / 1000)
    )
      return false;
    const expected = sign(
      options.signingSecret,
      signaturePayload({
        method,
        key,
        expires,
        mime: query.mime ?? "",
        size: query.size ?? "",
        checksum: query.checksum ?? "",
        resumable: query.resumable ?? "false",
      }),
    );
    return safeEqual(candidate, expected);
  }

  app.put<{ Params: { "*": string }; Querystring: StorageQuery }>(
    "/objects/*",
    async (request, reply) => {
      const key = request.params["*"];
      if (!authorize("PUT", key, request.query))
        return reply
          .code(403)
          .send({ error: "Invalid or expired upload grant" });
      if (!objectKeyPattern.test(key))
        return reply.code(400).send({ error: "Invalid object key" });
      const expectedSize = Number(request.query.size);
      if (
        !Number.isSafeInteger(expectedSize) ||
        expectedSize <= 0 ||
        expectedSize > options.maxObjectBytes
      )
        return reply.code(400).send({ error: "Invalid object size" });
      const bytes = request.body as Buffer;
      const target = validatedPath(options.rootDirectory, key);
      await mkdir(dirname(target), { recursive: true });
      const existingSize = await stat(target).then(
        (details) => details.size,
        () => 0,
      );
      if (existingSize === expectedSize)
        return reply.code(409).send({ error: "Upload grant already consumed" });
      const contentRange = request.headers["content-range"];
      if (contentRange) {
        if (request.query.resumable !== "true")
          return reply.code(400).send({ error: "Upload is not resumable" });
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
        if (
          !match ||
          Number(match[3]) !== expectedSize ||
          Number(match[2]) - Number(match[1]) + 1 !== bytes.length
        )
          return reply.code(400).send({ error: "Invalid content range" });
        const currentSize = existingSize;
        if (
          Number(match[1]) !== currentSize ||
          currentSize + bytes.length > expectedSize
        )
          return reply.code(409).send({ error: "Unexpected upload offset" });
        await appendFile(target, bytes);
      } else {
        if (existingSize > 0)
          return reply.code(409).send({ error: "Object already exists" });
        if (bytes.length !== expectedSize)
          return reply.code(400).send({ error: "Object size mismatch" });
        await writeFile(target, bytes);
      }
      await writeFile(
        `${target}.meta.json`,
        JSON.stringify({ declaredMimeType: request.query.mime }),
      );
      const current = await stat(target);
      return reply
        .code(current.size === expectedSize ? 201 : 308)
        .send({ receivedBytes: current.size });
    },
  );

  app.route<{ Params: { "*": string }; Querystring: StorageQuery }>({
    method: ["HEAD", "GET", "DELETE"],
    url: "/objects/*",
    handler: async (request, reply) => {
      const key = request.params["*"];
      if (!authorize(request.method, key, request.query))
        return reply.code(403).send();
      const target = validatedPath(options.rootDirectory, key);
      if (request.method === "DELETE") {
        await Promise.all([
          rm(target, { force: true }),
          rm(`${target}.meta.json`, { force: true }),
        ]);
        return reply.code(204).send();
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(target);
      } catch {
        return reply.code(404).send();
      }
      const metadata = JSON.parse(
        await readFile(`${target}.meta.json`, "utf8"),
      ) as { declaredMimeType: string };
      reply
        .header("x-object-size", String(bytes.length))
        .header(
          "x-object-checksum-sha256",
          createHash("sha256").update(bytes).digest("hex"),
        )
        .header("x-object-declared-mime", metadata.declaredMimeType)
        .header("x-object-observed-mime", observedMime(bytes));
      if (request.method === "HEAD") return reply.code(200).send();
      return reply.type(metadata.declaredMimeType).send(bytes);
    },
  });
  return app;
}

export class LocalObjectStorageClient implements ObjectStoragePort {
  public constructor(
    private readonly baseUrl: string,
    private readonly signingSecret: string,
  ) {}
  public async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  #url(
    method: string,
    key: string,
    input: {
      expiresAt: Date;
      mime?: string;
      size?: number;
      checksum?: string;
      resumable?: boolean;
    },
  ): string {
    if (!objectKeyPattern.test(key)) throw new Error("INVALID_OBJECT_KEY");
    const query = {
      expires: String(Math.floor(input.expiresAt.getTime() / 1000)),
      mime: input.mime ?? "",
      size: input.size === undefined ? "" : String(input.size),
      checksum: input.checksum ?? "",
      resumable: String(input.resumable ?? false),
    };
    const signature = sign(
      this.signingSecret,
      signaturePayload({ method, key, ...query }),
    );
    const parameters = new URLSearchParams({ ...query, signature });
    return `${this.baseUrl}/objects/${key}?${parameters.toString()}`;
  }
  public createUploadGrant(input: {
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    expiresAt: Date;
    resumable: boolean;
  }): Promise<SignedUploadGrant> {
    return Promise.resolve({
      uploadUrl: this.#url("PUT", input.objectKey, {
        expiresAt: input.expiresAt,
        mime: input.mimeType,
        size: input.sizeBytes,
        checksum: input.checksumSha256,
        resumable: input.resumable,
      }),
      expiresAt: input.expiresAt.toISOString(),
      objectKey: input.objectKey,
      resumable: input.resumable,
    });
  }
  public async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    const response = await fetch(
      this.#url("HEAD", objectKey, {
        expiresAt: new Date(Date.now() + 30_000),
      }),
      { method: "HEAD" },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`OBJECT_STORAGE_UNAVAILABLE_${String(response.status)}`);
    return {
      objectKey,
      sizeBytes: Number(response.headers.get("x-object-size")),
      checksumSha256: response.headers.get("x-object-checksum-sha256") ?? "",
      declaredMimeType: response.headers.get("x-object-declared-mime") ?? "",
      observedMimeType: response.headers.get("x-object-observed-mime") ?? "",
    };
  }
  public createDownloadUrl(
    objectKey: string,
    expiresAt: Date,
  ): Promise<string> {
    return Promise.resolve(this.#url("GET", objectKey, { expiresAt }));
  }
  public async delete(objectKey: string): Promise<void> {
    const response = await fetch(
      this.#url("DELETE", objectKey, {
        expiresAt: new Date(Date.now() + 30_000),
      }),
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404)
      throw new Error("OBJECT_STORAGE_UNAVAILABLE");
  }
}

function hexSha256ToBase64(checksum: string): string {
  if (!/^[0-9a-f]{64}$/.test(checksum))
    throw new Error("INVALID_MEDIA_CHECKSUM");
  return Buffer.from(checksum, "hex").toString("base64");
}

function base64Sha256ToHex(checksum: string | undefined): string {
  if (!checksum) return "";
  const bytes = Buffer.from(checksum, "base64");
  return bytes.length === 32 ? bytes.toString("hex") : "";
}

function storageErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata;
  return metadata?.httpStatusCode;
}

async function hashAndSniffBody(body: unknown): Promise<{
  checksumSha256: string;
  prefix: Buffer;
}> {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body))
    throw new Error("OBJECT_STORAGE_BODY_NOT_STREAMABLE");
  const hash = createHash("sha256");
  let prefix = Buffer.alloc(0);
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    const bytes =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    hash.update(bytes);
    if (prefix.length < 16)
      prefix = Buffer.concat([prefix, bytes.subarray(0, 16 - prefix.length)]);
  }
  return { checksumSha256: hash.digest("hex"), prefix };
}

/**
 * Vendor-neutral S3-compatible adapter. Object keys remain private and are
 * exposed only through short-lived, operation-specific signed URLs.
 */
export class S3CompatibleObjectStorageClient implements ObjectStoragePort {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #keyPrefix: string;

  public constructor(options: S3CompatibleObjectStorageOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:")
      throw new Error("OBJECT_STORAGE_ENDPOINT_MUST_USE_HTTPS");
    if (!options.bucket.trim())
      throw new Error("OBJECT_STORAGE_BUCKET_REQUIRED");
    const keyPrefix = options.keyPrefix?.replace(/^\/+|\/+$/g, "") ?? "";
    if (keyPrefix && !/^[a-z0-9][a-z0-9/_-]{0,239}$/.test(keyPrefix))
      throw new Error("INVALID_OBJECT_STORAGE_KEY_PREFIX");
    this.#bucket = options.bucket;
    this.#keyPrefix = keyPrefix;
    this.#client = new S3Client({
      endpoint: endpoint.origin,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  #physicalKey(objectKey: string): string {
    if (!objectKeyPattern.test(objectKey))
      throw new Error("INVALID_OBJECT_KEY");
    return this.#keyPrefix ? `${this.#keyPrefix}/${objectKey}` : objectKey;
  }

  public async health(): Promise<boolean> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
      return true;
    } catch {
      return false;
    }
  }

  public async createUploadGrant(input: {
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    expiresAt: Date;
    resumable: boolean;
  }): Promise<SignedUploadGrant> {
    const physicalKey = this.#physicalKey(input.objectKey);
    const expiresIn = Math.floor(
      (input.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (expiresIn < 1 || expiresIn > 3600)
      throw new Error("INVALID_UPLOAD_GRANT_EXPIRY");
    const checksum = hexSha256ToBase64(input.checksumSha256);
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: physicalKey,
      ContentType: input.mimeType,
      ContentLength: input.sizeBytes,
      ChecksumSHA256: checksum,
      Metadata: {
        "declared-mime-type": input.mimeType,
        "checksum-sha256": input.checksumSha256,
      },
    });
    return {
      uploadUrl: await getSignedUrl(this.#client, command, { expiresIn }),
      uploadHeaders: {
        "content-type": input.mimeType,
        "x-amz-checksum-sha256": checksum,
      },
      expiresAt: input.expiresAt.toISOString(),
      objectKey: input.objectKey,
      // Multipart orchestration is deliberately not emulated. A signed PUT is
      // safe and portable; true multipart will be a separate storage capability.
      resumable: false,
    };
  }

  public async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    const physicalKey = this.#physicalKey(objectKey);
    try {
      const [head, object] = await Promise.all([
        this.#client.send(
          new HeadObjectCommand({
            Bucket: this.#bucket,
            Key: physicalKey,
            ChecksumMode: "ENABLED",
          }),
        ),
        this.#client.send(
          new GetObjectCommand({
            Bucket: this.#bucket,
            Key: physicalKey,
          }),
        ),
      ]);
      // Some S3-compatible providers accept checksum headers but neither
      // enforce nor return them. Stream the stored bytes through SHA-256 so
      // upload finalization never trusts client-controlled object metadata.
      const verified = await hashAndSniffBody(object.Body);
      const providerChecksum = base64Sha256ToHex(head.ChecksumSHA256);
      if (providerChecksum && providerChecksum !== verified.checksumSha256)
        throw new Error("OBJECT_STORAGE_CHECKSUM_MISMATCH");
      return {
        objectKey,
        sizeBytes: head.ContentLength ?? -1,
        checksumSha256: verified.checksumSha256,
        declaredMimeType:
          head.Metadata?.["declared-mime-type"] ?? head.ContentType ?? "",
        observedMimeType: observedMime(verified.prefix),
      };
    } catch (error) {
      if (storageErrorStatus(error) === 404) return null;
      throw new Error("OBJECT_STORAGE_UNAVAILABLE", { cause: error });
    }
  }

  public async createDownloadUrl(
    objectKey: string,
    expiresAt: Date,
  ): Promise<string> {
    const physicalKey = this.#physicalKey(objectKey);
    const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (expiresIn < 1 || expiresIn > 3600)
      throw new Error("INVALID_DOWNLOAD_GRANT_EXPIRY");
    return getSignedUrl(
      this.#client,
      new GetObjectCommand({ Bucket: this.#bucket, Key: physicalKey }),
      { expiresIn },
    );
  }

  public async delete(objectKey: string): Promise<void> {
    const physicalKey = this.#physicalKey(objectKey);
    try {
      await this.#client.send(
        new DeleteObjectCommand({ Bucket: this.#bucket, Key: physicalKey }),
      );
    } catch (error) {
      throw new Error("OBJECT_STORAGE_UNAVAILABLE", { cause: error });
    }
  }
}

export interface MalwareScanner {
  readonly configured: boolean;
  health(): Promise<boolean>;
  scan(
    metadata: StoredObjectMetadata,
  ): Promise<{ safe: boolean; reason?: string }>;
}

export class DeterministicMalwareScanner implements MalwareScanner {
  public readonly configured = true;
  public constructor(
    private readonly blockedChecksums: ReadonlySet<string> = new Set(),
  ) {}
  public scan(
    metadata: StoredObjectMetadata,
  ): Promise<{ safe: boolean; reason?: string }> {
    return Promise.resolve(
      this.blockedChecksums.has(metadata.checksumSha256)
        ? { safe: false, reason: "deterministic_test_signature" }
        : { safe: true },
    );
  }
  public health(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export class UnconfiguredMalwareScanner implements MalwareScanner {
  public readonly configured = false;
  public health(): Promise<boolean> {
    return Promise.resolve(false);
  }
  public scan(): Promise<{ safe: boolean; reason?: string }> {
    return Promise.resolve({
      safe: false,
      reason: "production_scanner_unconfigured",
    });
  }
}
