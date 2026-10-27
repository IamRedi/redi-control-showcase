> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Media pipeline

## Target flow

1. Authenticated client requests an upload session with tenant, purpose, declared type/size, and checksum metadata.
2. API authorizes quota/purpose and returns a short-lived exact-object signed URL or multipart/resumable session.
3. Client uploads directly to a tenant-prefixed quarantine bucket/key, never through the app server.
4. Storage event or explicit completion creates an idempotent job via durable receipt/outbox.
5. Worker verifies object ownership, observed type, size, checksum, malware result, and media limits.
6. Sandboxed tools extract metadata, safe thumbnail/proxy, optional OCR/transcript, and channel variants.
7. Asset becomes `ready`, `rejected`, or `failed`; originals/derivatives follow approved retention.
8. AI receives proxy/frame/text references only when task policy permits; publisher gets the validated channel variant.

## State model

`initiated → uploading → uploaded → quarantined → processing → ready`; terminal/exception states are `rejected`, `failed`, `expired`, and `deleted`. Every transition is tenant-bound, idempotent, and audited where security/business relevant. Clients cannot mark an object safe merely by calling completion.

## Security and reliability

- Object keys are server-generated and include opaque tenant/asset IDs; original filenames are metadata only after sanitization.
- Signed grants bind operation/key, short expiry, maximum size, permitted content type/checksum where supported, and no list permission.
- Validate magic bytes, not just extension/header. Define allowlisted types and per-plan dimensions/duration/size before launch.
- Quarantine is not public and not consumable by AI/publishing. Processors have minimal read/write prefixes and resource/time limits.
- Strip unnecessary metadata (including location) according to policy; preserve only explicit business needs.
- Jobs use checksums/idempotency, exponential backoff, bounded attempts, heartbeat/timeouts, and visible DLQ. Orphan multipart uploads are expired.
- Downloads are authorized at request time with short-lived signed URLs; CDN/cache keys cannot cross tenants.

## Data and operations

Track asset, upload session, object/variant, checksum, observed media properties, scan, job attempts, derived-from lineage, retention class, and deletion status. Metrics cover upload completion, processing latency/failure, bytes/variants per tenant, scan rejections, queue age, and orphaned objects without high-cardinality sensitive labels.

## M3A implementation boundary

M3A implements the storage port, server-generated tenant keys, signed direct/resumable local transfer, object/MIME/size/checksum verification, deterministic metadata, fail-closed scan interface, RLS models, usage-aware deletion and real local tests. Thumbnail/proxy generation, codec sandboxing, production malware scanning, CDN/KMS and cloud provider selection remain deployment/expansion work.

## Decisions before production deployment

Storage provider/region, resumable protocol, maximums/quotas, malware service, codec/toolchain, OCR/transcription providers, metadata/location policy, original retention by plan, CDN, encryption keys, and legal consent/deletion rules.
