> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Test strategy

## Milestone 3A additions

The integration profile rebuilds PostgreSQL from empty and starts an isolated real local object server. It covers tenant RLS read/write/download denial, signed grant expiry/tamper/ranges, byte metadata/finalization reuse, MIME spoofing, OAuth redirect/state/scope attacks and secret leakage, revision immutability/reapproval/self-approval, timezone jobs, idempotent retries, partial outcomes and reauthorization. Contract tests exercise deterministic Meta/YouTube modes and disabled TikTok. Live provider E2E is a separate M3B gate.

## Milestone 3B-0 additions

The clean-database suite now applies migrations through 0006 and proves active/unknown/pending domain resolution, Host parsing, cross-installation denial, RLS visibility, shared/dedicated OAuth reference isolation, installation/origin/provider-bound state, entitlement denial, and readiness failure. Configuration tests reject deterministic providers, HTTP/localhost/wildcards, local secret/storage/scanner modes and example secrets in staging. Container acceptance builds web/API/worker/migrate, runs `/en`, `/de`, `/sq`, liveness/readiness, worker startup/shutdown and migration idempotency, and demonstrates production-like fake-provider startup refusal.

## Test layers

- **Unit:** pure domain policies, RBAC, context precedence/freshness, risk classification, idempotency hashing, configuration, and schema validation.
- **Integration:** repositories/migrations/RLS with disposable PostgreSQL and non-owner role; queue/outbox/locks; storage signing/policy; auth session; audit append-only behavior.
- **Contract:** each connector manifest, official sandbox/fixtures, normalization, scopes, rate limits, errors, webhooks, and redaction.
- **E2E:** sign in/tenant switch; connect and health; context review; website preview/approve/publish/rollback; media upload/process; social draft/approve/publish; failed job recovery.
- **Security:** cross-tenant CRUD/object/cache/job/context-pack attempts, privilege escalation, CSRF/session, OAuth state/PKCE, webhook forgery/replay, SSRF, upload abuse, approval payload swap, secret/log leakage, rate limiting.
- **AI eval:** versioned sanitized cases for grounding/provenance, tool selection/arguments, injection resistance, forbidden claims/actions, brand/language, risk/approval, cost/latency.
- **Resilience/performance:** upload/queue scheduling load, connector/provider faults, worker restart, retry storms, DLQ, database failover as topology permits, backup restore, and incident simulation.

## Foundation checks

`npm run check` runs formatting, strict TypeScript project references, lint, unit/contract tests, and production builds. `npm run test:integration` rebuilds types and recreates the real PostgreSQL control schema before DB/API acceptance tests. `npm run check:full` adds integration tests and dependency audit. Current M1 evidence is 7 unit/schema tests and 10 real DB/API integration tests; this is a strong baseline, not a production certification.

## Milestone gates

Each ticket declares acceptance tests. CI blocks merge on format/lint/type/unit; affected integration/contract suites are required. Milestone 1 additionally blocks on two-tenant RLS CRUD tests, role matrix/API denial tests, session negative cases, audit coverage, migration up test, and accessible auth/tenant shell E2E.

Later release gates require zero known tenant/approval bypass, 100% critical action audit mapping, no duplicate publish under retry, verified website rollback, connector break/token expiry alerts, cost attribution, and clean-environment install/restore drills.

## Test data and evidence

Use synthetic tenants and sanitized/versioned provider fixtures; never production credentials or personal data. Tests create at least Tenant A/Tenant B and attempt both read and mutation attacks. AI datasets record version, provenance/consent, expected rubric, reviewer, and change history. Store machine-readable reports and release evidence with bounded retention.

## Definition of done

A ticket is done only when behavior and non-goals are documented, acceptance criteria pass, relevant negative/security/accessibility cases pass, migrations/contracts are versioned and reversible/compatible, logs/metrics/audit/redaction are covered, docs/decision/risk entries are updated, and no real secret or unauthorized external change exists.

## Website Control Milestone 1

The BusinessSite Information connector has independent canonical HMAC/signature tests, deterministic raw-body/idempotency retry tests, strict schema and URL trust tests, exact operation inventory, editorial media/archive routing tests and a real PostgreSQL/Fastify/HTTP fixture integration. The integration fixture independently verifies signatures, fresh nonces and idempotency headers while exercising draft creation/replay/read/update/submit/publish/read. Negative evidence covers anonymous access, missing editorial write/approve permission, missing connector publish scope, disabled website entitlement, cross-tenant visibility and secret/config leakage.

Unified Content adds a clean-migration PostgreSQL/API suite for its three-table aggregate/link model. It verifies forced tenant isolation, RBAC and CSRF mutation gates, module entitlement denial, tenant/workspace media ownership, audit evidence, independent native Facebook and Instagram draft revisions, Website Control connection binding and derived partial success. Existing social publishing and Website Control suites remain the source of truth for approval and provider/remote execution semantics.
