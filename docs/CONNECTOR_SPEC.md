> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Connector Manifest and SDK v1

## M3A social profiles

Meta and YouTube reuse Manifest v1 as explicitly declared write adapters: Facebook Page image/video, Instagram image/video/carousel, and YouTube video publication. Provider URLs are intentionally absent from local adapters; API version and credentials are deployment configuration and missing setup fails closed. TikTok declares `video.upload`/`video.publish` schemas but execution is disabled. M3B must revalidate raw scopes, endpoints/version, media constraints, rates and reconciliation against official documentation and test accounts before activation.

Status: **Manifest v1 and local runtime completed in Milestone 2.** The executable schema, runtime, secret interface, signature primitive, and reference connector are in `packages/connector-sdk`.

## Manifest

Each immutable connector release declares:

- schema version, stable connector/platform IDs, display name, semantic connector version, and category;
- minimum/maximum platform API version and REDI CONTROL compatibility range;
- supported auth methods (`none`, `oauth2`, `api_key`, `service_token`) and whether secret resolution is required;
- individually documented scopes and capabilities with read/write mode and risk;
- immutable commands binding capability, required scopes, mode/risk, JSON Schema input/output, idempotency, and timeout;
- health deadline and degraded support;
- webhook event inventory and signature algorithm/timestamp tolerance;
- rate window, bounded retry classification, deprecation/sunset, and optional replacement.

Capabilities are deny-by-default. A manifest capability, granted remote scope, tenant feature flag, connection health, actor permission, and action policy must all allow an operation.

## Runtime contract

A connector call derives tenant and actor from the authenticated server context, loads the connection through RLS, and checks permission, status, feature flag, kill switch, version, scope, and discovered capability. User input cannot supply or override trusted tenant/connection/actor/correlation fields. The runtime validates command input/output, enforces a deadline/abort signal, stores durable idempotency results, and returns bounded error codes without provider bodies.

Provider payloads never escape adapters into core domain contracts. Logs redact tokens, personal data, request bodies by default, and signed URLs. Metrics use bounded labels—never tenant names, emails, external IDs, or error bodies.

## Connection flow

1. User selects connector and reviews verified capabilities/scopes.
2. Server creates tenant/session-bound OAuth state and PKCE verifier where supported, or requests a secret through the approved secret path.
3. Provider callback validates state and exchanges code server-side.
4. Tokens are stored encrypted/by vault reference; returned scopes are compared with requirements.
5. User selects authorized remote business/page/channel.
6. System runs health and a read-only smoke operation.
7. Read status becomes active. Write/publish remains separately feature-flagged and approval-gated.

## Reliability and webhooks

- Rate limiting exists per provider/connector/connection/tenant and respects official reset/retry headers.
- Retry uses exponential backoff with jitter only for classified safe transient errors.
- Write operations require a stable idempotency key; if a provider lacks one, REDI CONTROL maintains a durable attempt/result record and reconciles ambiguous timeouts before retry.
- Webhooks verify the provider's current official signature procedure over raw bytes, timestamp tolerance, event identity, and replay cache before durable receipt.
- A connector/operation kill switch stops new jobs without destroying connection history.

## Contract tests

Every connector release must validate manifest/schema, auth and missing-scope behavior, input/output normalization, timeout/cancellation, rate limits, retries, idempotency, webhook valid/invalid/replay cases, secret/log redaction, health transitions, and provider sandbox fixtures. Fixtures must be sanitized and versioned.

## Active connector implementations

`reference-saas-local@1.0.0` remains the deterministic local read-only connector. `businesssite-information@1.0.0` is the first `website` connector and implements the verified BusinessSite Phase 7 Information contract. Its exact commands, HMAC canonicalization, runtime schemas and deployment boundary are documented in [Website Control Milestone 1](WEBSITE_CONTROL_MILESTONE_1.md).

## PitLaneOne discovery gate

Before PitLaneOne code: obtain owner-approved API specifications, base/test URLs, authentication/scopes, resource/event inventory, pagination/filtering, rate limits, version/deprecation policy, health semantics, webhook signing, error format, sandbox/test tenant, data sensitivity, and platform technical contact. Until then PitLaneOne has no manifest, endpoint, credential flow, or activatable connection.

Only these read-only namespace proposals may be used during discovery; they are vocabulary candidates, not claims that an API exists:

| Product    | Proposed namespaces                                                         | Explicitly excluded before verified specification and separate approval                        |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| PitLaneOne | `workshop.profile.read`, `service.catalog.read`, `appointment.summary.read` | customer or vehicle records, invoices/payments/fiscal data, staff, inventory, write operations |

No URL, route, field, scope, event, rate limit, or authentication behavior is inferred from product PDFs or marketing material.
