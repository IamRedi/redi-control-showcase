> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Source Discovery & Ingestion — Milestone 4

## Delivered scope

REDI CONTROL can queue manual HTTPS retrieval, configured RSS/Atom retrieval, provider-neutral search and provider-neutral API/feed discovery. Results are normalized, conservatively deduplicated, inspected by an editor and selectively attached to the existing Research Case. No AI extraction, synthesis, claim generation, monitoring, browser automation or publication is present.

## Flow

1. An authenticated editor with `content:edit` starts a run using a trusted session tenant and existing workspace/case.
2. The API creates one idempotent `discovery_run` plus a `source.ingestion` PostgreSQL job.
3. The worker atomically claims only that job type, bounded by `WORKER_CONCURRENCY`, and applies exponential retry/backoff with a maximum of four attempts.
4. Manual/feed network access crosses `HardenedOutboundFetcher`; providers use a strict adapter and optional opaque SecretProvider reference.
5. Normalized results remain untrusted discovery records. The editor selects results to attach to the existing `research_case_sources` relation.
6. Requests/results/provider/cost are recorded without credentials. Audit/outbox records cover request, cancellation, provider configuration, feed configuration and attachment.

## Fetch threat model

- HTTPS only, no URL credentials/custom port, strict URL parsing.
- DNS resolves all addresses; any private/link-local/reserved result denies the request. The request is pinned to a validated address.
- Maximum three redirects; each destination repeats URL and DNS validation.
- Default 10 second timeout, 2 MB maximum response and explicit HTML/XML/feed/JSON MIME allowlist.
- `Accept-Encoding: identity`, honest configurable user-agent, no cookies, no session/provider authorization forwarding and no remote JavaScript execution.
- Remote data is bounded, normalized and marked `untrusted`; it is not instructions or verified evidence.

## Provider contract

`SearchDiscoveryProvider` returns title, URL, publisher, snippet, optional publication time, stable provider result ID and bounded metadata. `ApiFeedProvider` uses the same normalized result. A production provider configuration stores only non-secret JSON plus `secret://…`; the worker resolves it at execution for the current tenant/configuration ID. `deterministic-local` exists for tests and local UI only.

## Operations

Apply migration `0010_source_discovery_ingestion_m4.sql` and set `EXPECTED_MIGRATION_COUNT=10`. Configure `SOURCE_FETCH_TIMEOUT_MS`, `SOURCE_FETCH_MAX_BYTES` and an honest policy URL in `SOURCE_FETCH_USER_AGENT`. Production requires an injected external SecretProvider for credentialed providers. Keep outbound network egress denial enabled independently of application checks.

Cancellation prevents queued work and is rechecked before persistence after retrieval. Failed jobs expose bounded error codes/details, back off exponentially and dead-letter after their bounded attempt count. Provider usage records request/result count and optional estimated/actual cost; this milestone creates no AI cost.

## API

- `GET/POST /api/research/discovery`
- `POST /api/research/discovery/:runId/cancel`
- `POST /api/research/discovery/:runId/attach`
- `GET/POST /api/research/feeds`
- `GET/POST /api/research/providers`

All routes derive tenant from the authenticated session, require Research entitlement/feature availability in the service, use CSRF protection for mutations and rely on forced PostgreSQL RLS.

## Deferred

Real commercial search provider selection, live vendor credentials, continuous monitoring, automatic selection, AI extraction/synthesis, claim generation, social scraping, browser automation, AuroraMedia source configuration and autonomous publishing remain out of scope.
