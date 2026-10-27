> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Universal Media Intelligence — Milestone 3

## Outcome and boundary

Milestone 3 adds a provider-neutral, tenant-scoped manual research foundation. It does not fetch, scrape, crawl, call AI, monitor sources, or publish autonomously. External material is treated as untrusted input and only references, metadata, notes and provenance are stored.

The implemented flow is:

`Media Profile → Source Registry → Research Case → Claims/Evidence → Editorial Candidate → Unified Content`

Research remains separate from Content Items and destination variants. Promotion copies only the candidate title and editorial summary into a new Content Item; source records, claims, evidence and verification rationale remain in the Research Case. The candidate stores the resulting Content Item ID, preserving provenance without duplicating evidence into destination copy.

## Domain model

- `media_profiles`: reusable publication identity, locale/region, audience, pillars, tone, restricted/excluded topics, verification rules, destinations and cadence. A workspace can own multiple profiles.
- `source_registry`: reusable source identity, type, canonical reference/domain, source tier, topics/country, eligibility and explicit provenance.
- `source_performance_observations`: dated, human-readable observations for reliability, speed, freshness, trend relevance and audience relevance. Numeric values prioritize work only; they never assert truth.
- `research_cases`: manual research workspace with freshness and lifecycle state.
- `research_case_sources`: case-specific source references and retrieval provenance. Full external content is not stored.
- `research_claims`: normalized factual claims with explicit verification state and mandatory explanation.
- `research_evidence`: typed Claim↔Source relationships (`supports`, `contradicts`, `mentions`, `primary_evidence`).
- `editorial_candidates`: manual prioritization dimensions and explanation, approval state and an idempotent Content Item promotion link.

## Security and workflow

- Every table has forced PostgreSQL RLS and composite tenant/workspace foreign keys.
- Tenant is always derived from the authenticated session; it is never accepted from request bodies.
- Reads and editorial writes require `content:edit`; candidate approval and promotion require `content:approve`, CSRF and MFA.
- The `media_intelligence` entitlement and `module.media-intelligence` feature flag are both required at the workspace installation boundary.
- All domain mutations emit tenant-scoped audit and transactional outbox evidence.
- Promotion locks the Candidate, requires status `approved`, creates the Content Item in the same transaction, and is idempotent on retry.
- API write bodies use strict allowlists and reject unknown or missing required properties.

## API and UI

The authenticated API is under `/api/research`. It covers Media Profiles, Source Registry, source observations, Research Cases, case sources, claims/evidence, Candidates, decisions and promotion. Lists are bounded to 100 rows.

The UI is available at `/{locale}/research` and `/{locale}/research/{caseId}`. It supports the manual V1 workflow and makes verification explanations and provenance visible. It intentionally does not include automated discovery or a polished composer.

## Operations

Apply migration `0009_universal_media_intelligence_m3.sql` and set `EXPECTED_MIGRATION_COUNT=9`. No new secrets, provider credentials, queues or external services are required.

## Deferred risks

- Source URLs and notes are untrusted display data; future fetchers must use a separate SSRF-hardened ingestion boundary.
- Numeric prioritization inputs are manual and are not calibrated quality guarantees.
- Advanced profile editing, bulk operations and source deduplication UI are deferred.
- Candidate approval currently reuses Content approval roles; more granular research permissions can be added if operational separation becomes necessary.
- AI, monitoring, scraping and autonomous publishing remain explicitly out of scope.
