> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Website Control Milestone 1

Status: **implemented and locally verified on 2026-08-20; staging credentials and an external secret provider remain deployment work.**

## Delivered boundary

REDI CONTROL now represents `website` as a first-class Platform Registry category and ships the versioned `businesssite-information@1.0.0` connector. The connector is based only on the BusinessSite Phase 7 Information API contract. It does not access the BusinessSite database and adds no News Intelligence, AI, Research Case, Unified Content, WordPress, social-composer, customer-Lite, provisioning or session-handoff behavior.

The implementation reuses the existing installation, tenant, workspace, platform connection, connector manifest/runtime, entitlement, feature flag, secret reference, idempotency, audit/outbox and RLS models. The only new persistence is `control.website_connection_profiles`, which stores bounded non-secret endpoint/display configuration and article-status summaries for an existing platform connection.

## Connector contract

- Base path: `https://<businesssite-host>/api/integrations/redi-control/v1`.
- Authentication headers: `x-integration-id`, `x-signature-timestamp`, `x-signature-nonce`, and `x-signature`.
- Mutations also require `x-idempotency-key`.
- Signature: `v1=` plus lower-case HMAC-SHA256 hex over `integrationId + "\n" + timestamp + "\n" + nonce + "\n" + upper-case method + "\n" + pathname/query + "\n" + sha256(exact raw body)`.
- JSON request bodies are deterministically serialized with recursively sorted object keys. Retries retain the exact body and idempotency key but use a new timestamp and nonce.
- Supported commands are exactly `articles.list`, `articles.read`, `articles.create`, `articles.update`, `articles.submit`, `articles.publish`, `articles.archive`, `media.list`, and `media.upload`.
- Requests and responses are validated twice: by the executable connector manifest and by strict operation-specific Zod schemas. Provider error bodies do not cross the adapter boundary.

## Security and authorization

The API derives tenant, user, permissions and connection from the authenticated session. PostgreSQL forced RLS and composite tenant foreign keys isolate installation/workspace/connection/profile rows. `module.websites` must be enabled both by feature flag and active installation entitlement. Each operation requires its declared remote scope and discovered capability; writes additionally require `content:edit`, while publication requires `content:approve` and the remote BusinessSite approval contract still applies.

Only an opaque `secret://...` reference is stored. The HMAC secret is resolved at execution through `SecretProvider`, passed only in trusted adapter context and excluded from API responses, database profile rows, audit metadata and logs. Production remains fail-closed until an external secret-provider adapter supplies that reference.

Endpoint configuration requires HTTPS, has no userinfo/query/fragment, and must end at the exact versioned Phase 7 path. HTTP is accepted only for explicit local/test configuration on loopback. Preview URLs follow the same HTTPS/loopback rule. Fetch redirects are rejected.

Connection creation requires `platform:connect`, recent MFA and CSRF. Listing requires `platform:read`. The generic command route remains CSRF-protected. A bounded manual sync reads no more than 5,000 articles and persists counts only after complete pagination.

## API and UI shell

- `GET /api/websites` returns tenant-owned connection summaries without integration IDs, endpoint configuration or secret references.
- `POST /api/websites/connections` creates a BusinessSite connection after entitlement, workspace, scope, URL, MFA and CSRF validation.
- `POST /api/websites/:connectionId/sync` refreshes the bounded article-status summary.
- `POST /api/connections/:connectionId/commands/:commandId` executes the declared read/write command through the common runtime.
- `/<locale>/websites` is the minimal EN/DE/SQ website-control shell. Its explicit same-origin Next route forwards only authenticated `GET /api/websites` to the configured API origin; it is not a general API proxy.

No full editor was added.

## Deterministic integration evidence

The real integration suite creates a fresh PostgreSQL schema, applies all seven migrations, uses the restricted runtime/auth roles, starts a local BusinessSite Phase 7 fixture and drives the Fastify endpoint through create, idempotent replay, read, update, submit, denied publish without scope, approved publish, and final published read. The fixture independently verifies every signature, exact raw body, nonce uniqueness and mutation idempotency key. The suite also verifies tenant-isolated summaries, secret-reference-only storage and audit evidence without weakening approval rules.

## Deployment configuration

Create the matching BusinessSite Phase 7 integration first. Store its generated HMAC secret in the approved external secret provider and put only its opaque reference on the REDI CONTROL connection. Configure `PUBLIC_API_ORIGIN` for the web-to-API same-origin bridge. No new plaintext secret environment variable is introduced by this milestone.

Remaining deployment risks are tracked in the handoff: the production secret-provider adapter, staging BusinessSite endpoint, trusted TLS/DNS, retry worker policy and live end-to-end evidence are not fabricated by the local fixture.
