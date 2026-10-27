import { randomUUID } from "node:crypto";

import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
} from "@redi-control/database";

import type {
  MalwareScanner,
  ObjectStoragePort,
  StoredObjectMetadata,
} from "./storage.js";

export interface MediaLimits {
  readonly allowedMimeTypes: ReadonlySet<string>;
  readonly maxImageBytes: number;
  readonly maxVideoBytes: number;
  readonly uploadTtlSeconds: number;
  readonly downloadTtlSeconds: number;
  readonly standardRetentionDays: number;
  readonly multipartThresholdBytes: number;
}

export interface MediaTechnicalMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
}

export interface MediaInspector {
  inspect(metadata: StoredObjectMetadata): Promise<MediaTechnicalMetadata>;
}

export class DeterministicMediaInspector implements MediaInspector {
  public inspect(
    metadata: StoredObjectMetadata,
  ): Promise<MediaTechnicalMetadata> {
    if (metadata.observedMimeType.startsWith("image/"))
      return Promise.resolve({ width: 1, height: 1 });
    if (metadata.observedMimeType === "video/mp4")
      return Promise.resolve({ width: 1920, height: 1080, durationMs: 1000 });
    return Promise.reject(new Error("UNSUPPORTED_MEDIA_TYPE"));
  }
}

export interface RequestedUpload {
  readonly assetId: string;
  readonly uploadSessionId: string;
  readonly uploadUrl: string;
  readonly uploadHeaders?: Readonly<Record<string, string>>;
  readonly objectKey: string;
  readonly expiresAt: string;
  readonly resumable: boolean;
}

async function evidence(
  client: DatabaseClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  await client.query(
    `INSERT INTO control.audit_events
     (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      auditId,
      input.tenantId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.correlationId,
      input.metadata ?? {},
    ],
  );
  await client.query(
    `INSERT INTO control.outbox_events
     (id,tenant_id,event_type,event_version,payload,correlation_id)
     VALUES ($1,$2,$3,1,$4,$5)`,
    [
      randomUUID(),
      input.tenantId,
      input.action,
      {
        auditEventId: auditId,
        targetType: input.targetType,
        targetId: input.targetId,
      },
      input.correlationId,
    ],
  );
}

function extensionFor(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
  };
  const extension = extensions[mimeType];
  if (!extension) throw new Error("MEDIA_TYPE_NOT_ALLOWED");
  return extension;
}

export class MediaLibraryService {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ObjectStoragePort,
    private readonly scanner: MalwareScanner,
    private readonly inspector: MediaInspector,
    private readonly limits: MediaLimits,
  ) {}

  public async requestUpload(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    correlationId: string;
  }): Promise<RequestedUpload> {
    if (!this.limits.allowedMimeTypes.has(input.mimeType))
      throw new Error("MEDIA_TYPE_NOT_ALLOWED");
    if (!/^[0-9a-f]{64}$/.test(input.checksumSha256))
      throw new Error("INVALID_MEDIA_CHECKSUM");
    if (
      !input.originalFilename ||
      input.originalFilename.length > 255 ||
      /[\\/\0]/.test(input.originalFilename)
    )
      throw new Error("INVALID_MEDIA_FILENAME");
    const maximum = input.mimeType.startsWith("video/")
      ? this.limits.maxVideoBytes
      : this.limits.maxImageBytes;
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > maximum
    )
      throw new Error("MEDIA_SIZE_NOT_ALLOWED");
    const assetId = randomUUID();
    const uploadSessionId = randomUUID();
    const objectKey = `tenant/${input.tenantId}/media/${assetId}/original.${extensionFor(input.mimeType)}`;
    const expiresAt = new Date(
      Date.now() + this.limits.uploadTtlSeconds * 1000,
    );
    const resumableRequested =
      input.mimeType.startsWith("video/") ||
      input.sizeBytes >= this.limits.multipartThresholdBytes;
    const grant = await this.storage.createUploadGrant({
      objectKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      expiresAt,
      resumable: resumableRequested,
    });
    const resumable = grant.resumable;
    await withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO control.media_assets
         (id,tenant_id,workspace_id,created_by,original_filename,status,retention_until)
         VALUES ($1,$2,$3,$4,$5,'uploading',now() + ($6 || ' days')::interval)`,
        [
          assetId,
          input.tenantId,
          input.workspaceId,
          input.actorUserId,
          input.originalFilename,
          String(this.limits.standardRetentionDays),
        ],
      );
      await client.query(
        `INSERT INTO control.media_upload_sessions
         (id,tenant_id,workspace_id,asset_id,object_key,upload_mode,expected_mime_type,
          expected_size_bytes,expected_checksum_sha256,part_size_bytes,expires_at,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          uploadSessionId,
          input.tenantId,
          input.workspaceId,
          assetId,
          objectKey,
          resumable ? "multipart" : "single",
          input.mimeType,
          input.sizeBytes,
          input.checksumSha256,
          resumable ? 5 * 1024 * 1024 : null,
          expiresAt,
          input.actorUserId,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "media.upload_requested",
        targetType: "media_asset",
        targetId: assetId,
        correlationId: input.correlationId,
        metadata: {
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          resumable,
        },
      });
    });
    return {
      assetId,
      uploadSessionId,
      uploadUrl: grant.uploadUrl,
      ...(grant.uploadHeaders ? { uploadHeaders: grant.uploadHeaders } : {}),
      objectKey,
      expiresAt: grant.expiresAt,
      resumable,
    };
  }

  public async finalizeUpload(input: {
    tenantId: string;
    uploadSessionId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<string> {
    const session = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{
          asset_id: string;
          object_key: string;
          expected_mime_type: string;
          expected_size_bytes: string;
          expected_checksum_sha256: string;
          status: string;
          expires_at: Date;
        }>(
          `SELECT asset_id,object_key,expected_mime_type,expected_size_bytes,
          expected_checksum_sha256,status,expires_at
         FROM control.media_upload_sessions WHERE id = $1`,
          [input.uploadSessionId],
        );
        return result.rows[0] ?? null;
      },
    );
    if (!session) throw new Error("UPLOAD_SESSION_NOT_FOUND");
    if (session.status === "finalized")
      throw new Error("UPLOAD_SESSION_ALREADY_FINALIZED");
    if (session.expires_at.getTime() <= Date.now())
      throw new Error("UPLOAD_SESSION_EXPIRED");
    const metadata = await this.storage.head(session.object_key);
    if (!metadata) throw new Error("UPLOADED_OBJECT_NOT_FOUND");
    const valid =
      metadata.sizeBytes === Number(session.expected_size_bytes) &&
      metadata.checksumSha256 === session.expected_checksum_sha256 &&
      metadata.declaredMimeType === session.expected_mime_type &&
      metadata.observedMimeType === session.expected_mime_type;
    const scan = valid
      ? await this.scanner.scan(metadata)
      : { safe: false, reason: "media_verification_failed" };
    if (!valid || !scan.safe) {
      await withTenant(this.pool, input.tenantId, async (client) => {
        await client.query(
          "UPDATE control.media_upload_sessions SET status = 'cancelled' WHERE id = $1 AND status <> 'finalized'",
          [input.uploadSessionId],
        );
        await client.query(
          "UPDATE control.media_assets SET status = 'rejected', processing_status = 'rejected', updated_at = now() WHERE id = $1",
          [session.asset_id],
        );
        await evidence(client, {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: "media.upload_rejected",
          targetType: "media_asset",
          targetId: session.asset_id,
          correlationId: input.correlationId,
          metadata: { reason: scan.reason ?? "media_verification_failed" },
        });
      });
      throw new Error(scan.reason ?? "MEDIA_VERIFICATION_FAILED");
    }
    const technical = await this.inspector.inspect(metadata);
    const objectId = randomUUID();
    await withTenant(this.pool, input.tenantId, async (client) => {
      const claimed = await client.query(
        `UPDATE control.media_upload_sessions SET status = 'finalized', finalized_at = now()
         WHERE id = $1 AND status IN ('initiated','uploading','uploaded') AND expires_at > now()
         RETURNING id`,
        [input.uploadSessionId],
      );
      if (claimed.rowCount !== 1)
        throw new Error("UPLOAD_SESSION_ALREADY_FINALIZED");
      await client.query(
        `INSERT INTO control.media_objects
         (id,tenant_id,asset_id,object_kind,object_key,mime_type,size_bytes,
          checksum_sha256,width,height,duration_ms)
         VALUES ($1,$2,$3,'original',$4,$5,$6,$7,$8,$9,$10)`,
        [
          objectId,
          input.tenantId,
          session.asset_id,
          session.object_key,
          metadata.observedMimeType,
          metadata.sizeBytes,
          metadata.checksumSha256,
          technical.width ?? null,
          technical.height ?? null,
          technical.durationMs ?? null,
        ],
      );
      await client.query(
        "UPDATE control.media_assets SET status = 'ready', processing_status = 'ready', updated_at = now() WHERE id = $1",
        [session.asset_id],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "media.upload_finalized",
        targetType: "media_asset",
        targetId: session.asset_id,
        correlationId: input.correlationId,
        metadata: {
          mimeType: metadata.observedMimeType,
          sizeBytes: metadata.sizeBytes,
          checksumSha256: metadata.checksumSha256,
        },
      });
    });
    return session.asset_id;
  }

  public list(
    tenantId: string,
    workspaceId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT asset.id,asset.original_filename,asset.status,asset.processing_status,
          asset.retention_class,asset.retention_until,asset.created_at,
          object.mime_type,object.size_bytes,object.checksum_sha256,
          object.width,object.height,object.duration_ms
         FROM control.media_assets asset
         LEFT JOIN control.media_objects object ON object.asset_id = asset.id AND object.object_kind = 'original'
         WHERE asset.workspace_id = $1 AND asset.soft_deleted_at IS NULL
         ORDER BY asset.created_at DESC`,
        [workspaceId],
      );
      return result.rows;
    });
  }

  public async createDownload(input: {
    tenantId: string;
    assetId: string;
  }): Promise<{ downloadUrl: string; expiresAt: string }> {
    const objectKey = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{ object_key: string }>(
          `SELECT object.object_key FROM control.media_objects object
         JOIN control.media_assets asset ON asset.id = object.asset_id
         WHERE asset.id = $1 AND asset.status = 'ready' AND asset.soft_deleted_at IS NULL
           AND object.object_kind = 'original'`,
          [input.assetId],
        );
        if (!result.rows[0]) throw new Error("MEDIA_ASSET_NOT_FOUND");
        return result.rows[0].object_key;
      },
    );
    const expiresAt = new Date(
      Date.now() + this.limits.downloadTtlSeconds * 1000,
    );
    return {
      downloadUrl: await this.storage.createDownloadUrl(objectKey, expiresAt),
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async requestDeletion(input: {
    tenantId: string;
    assetId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<string> {
    const workflowId = randomUUID();
    await withTenant(this.pool, input.tenantId, async (client) => {
      const usages = await client.query(
        "SELECT id FROM control.media_usage_references WHERE asset_id = $1 LIMIT 1",
        [input.assetId],
      );
      const status = usages.rowCount ? "blocked_by_usage" : "requested";
      await client.query(
        "UPDATE control.media_assets SET status = 'pending_deletion', soft_deleted_at = now(), updated_at = now() WHERE id = $1",
        [input.assetId],
      );
      await client.query(
        `INSERT INTO control.media_deletion_workflows
         (id,tenant_id,asset_id,requested_by,status,safe_reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          workflowId,
          input.tenantId,
          input.assetId,
          input.actorUserId,
          status,
          usages.rowCount ? "asset_is_in_use" : null,
        ],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "media.deletion_requested",
        targetType: "media_asset",
        targetId: input.assetId,
        correlationId: input.correlationId,
        metadata: { status },
      });
    });
    return workflowId;
  }

  public async completeDeletion(input: {
    tenantId: string;
    workflowId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<void> {
    const objects = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const workflow = await client.query<{ asset_id: string }>(
          "SELECT asset_id FROM control.media_deletion_workflows WHERE id = $1 AND status = 'requested'",
          [input.workflowId],
        );
        const row = workflow.rows[0];
        if (!row) throw new Error("DELETION_NOT_READY");
        const result = await client.query<{ object_key: string }>(
          "SELECT object_key FROM control.media_objects WHERE asset_id = $1",
          [row.asset_id],
        );
        return {
          assetId: row.asset_id,
          keys: result.rows.map((item) => item.object_key),
        };
      },
    );
    for (const key of objects.keys) await this.storage.delete(key);
    await withTenant(this.pool, input.tenantId, async (client) => {
      await client.query(
        "DELETE FROM control.media_objects WHERE asset_id = $1",
        [objects.assetId],
      );
      await client.query(
        "UPDATE control.media_assets SET status = 'deleted', processing_status = 'ready', updated_at = now() WHERE id = $1",
        [objects.assetId],
      );
      await client.query(
        "UPDATE control.media_deletion_workflows SET status = 'completed', completed_at = now() WHERE id = $1",
        [input.workflowId],
      );
      await evidence(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "media.permanently_deleted",
        targetType: "media_asset",
        targetId: objects.assetId,
        correlationId: input.correlationId,
      });
    });
  }
}
