> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Evidence Intelligence & Verified Synthesis — Milestone 5

Status: implemented checkpoint. This milestone stops before editorial-style transformation, monitoring and autonomous publication.

## Pipeline and ownership

`Research Case sources → claim proposals → comparison/evidence proposals → human decisions → immutable Evidence Pack → factual synthesis → independent grounding validation → optional Unified Content promotion`.

Business truth remains in the Milestone 3 Research Case model. AI output is never written directly as approved evidence. Accepted claim proposals become existing `research_claims`; accepted relationship proposals become existing `research_evidence`. A content approver builds the Evidence Pack after review.

## AI Gateway contract

`@redi-control/ai-gateway` is the only model-provider boundary. Domain code selects a persisted route by operation, not a vendor/model constant. A route records provider, model, prompt version and output limit. Providers receive a fixed system safety instruction and a clearly delimited `untrustedContext`; source text is never represented as system/developer instructions. Responses are untrusted until strict Zod validation succeeds.

Operations are independently routable: `claim_extraction`, `evidence_comparison`, `factual_synthesis` and `grounding_validation`. No production provider is bundled. Deployment injects approved provider adapters; the deterministic provider is test-only. Provider secrets must remain in external secret storage and never enter prompts, database rows or logs.

## Evidence Pack and grounding

Evidence Packs are immutable, versioned snapshots containing only the selected Research Case, human-approved claims/evidence, referenced sources, source tiers, freshness, provenance and unresolved conflicts. Factual synthesis receives that snapshot only—not tenant history or unrestricted model context.

Synthesis includes headline, summary, body, key points, category/tags, claim/source provenance and structured uncertainty. Server checks every generated reference against the pack. A separately routed validator classifies material statements as supported, partially supported, unsupported or conflicting. Any material `unsupported` or `conflicting` result sets `approval_ready=false` and blocks promotion.

Promotion uses existing Unified Content and records: `Research Case → Evidence Pack version → Factual Synthesis version → Content Item`.

## Human and security controls

- AI execution requires `content:edit`; pack creation, synthesis and promotion require `content:approve`, CSRF and MFA at API routes.
- Proposal decisions and human edits are audited.
- Forced RLS applies to every M5 tenant table.
- Runtime has no UPDATE/DELETE permission on packs/syntheses; database triggers also reject privileged mutation.
- Entitlements and `module.ai` fail closed.
- Daily/monthly budgets, concurrency, output limits, idempotency hashes and usage/cost events are enforced.
- Raw prompts, secrets and unrestricted provider output are not stored.

## Operations and deferred scope

Apply `0011_evidence_intelligence_m5.sql` and set `EXPECTED_MIGRATION_COUNT=11`. Configure all four model routes and an explicit budget before enabling `module.ai`. Keep AI disabled until an approved provider adapter, privacy/retention policy and evaluation baseline exist.

AuroraMedia styling, production provider choice, continuous monitoring, ranking automation, social-specific generation, image generation, satire, autonomous publishing and engagement learning remain deferred.
