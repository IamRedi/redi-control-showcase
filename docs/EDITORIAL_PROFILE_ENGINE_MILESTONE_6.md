> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Editorial Profile Engine — Milestone 6

## Boundary

The product is a **universal engine plus configurable Media Profile**, not an Aurora Media-specific news engine. `config/media-profiles/aurora-media.json` is an ordinary, validated pilot preset. Core packages contain no pilot-name branch.

`Evidence Pack` records what is known. `Editorial Context Pack` records how one publication communicates. They are immutable, separately hashed and supplied as separate fields to the AI Gateway.

## Workflow

`Research Case → approved Evidence Pack → factual synthesis → profile revision → Editorial Context Pack → editorial transformation → separate grounding validation → human approval → Unified Content`.

Editorial output contains headline, essence, article body, key points, category, tags, Facebook/Instagram copy, hashtags and visual-card copy. Promotion preserves the link from editorial draft to factual synthesis, Evidence Pack, context pack and Content Item. Website/Facebook/Instagram delivery continues through existing Unified Content destination workflows and their own connection/account requirements.

## Enforced policy

- Strict Zod configuration and provider-output schemas.
- Headline, section, satire-disabled, freshness disclosure, verification-label, visual-card, source-attribution and generated-documentary-image rules are checked server-side.
- `unverified`, conflicting or stale evidence cannot be relabelled `verified`.
- Unsupported material output is blocked by a separate grounding run.
- Generated and edited draft content is immutable. An edit creates a linked `human_edit` revision, reruns grounding and language policy, supersedes its predecessor and records an audit event before it can enter approval review.
- Promotion requires `content:approve`, MFA/CSRF at the API boundary and explicit human approval.
- Candidate ranking cannot approve `unverified`, conflicting or stale material; virality scores never override verification.

## Pilot configuration

Import `config/media-profiles/aurora-media.json` through the normal profile creation API/admin UI, supplying the target `workspaceId`. The profile can then be changed in Overview, Sections, Sources, Verification, Style, Visuals and Publishing. Saving creates a new immutable profile revision; only future Context Packs use it.

Satire is present as a disabled section. No image generation, autonomous monitoring, autonomous publishing or engagement-learning loop is included.

## Deployment

Apply `0012_editorial_profile_engine_m6.sql`, `0013_pilot_6p_hardening_m65.sql`, the identity migrations `0014_oidc_identity.sql` through `0016_member_invitations.sql`, and the later Workzone/platform migrations `0017_editorial_story_assignments.sql` through `0031_workzone_archive_restore.sql`; set `EXPECTED_MIGRATION_COUNT=31`. Configure the two additional AI routes: `editorial_transformation` and `editorial_grounding_validation`. Production AI remains fail-closed until an approved provider, privacy/retention policy, budgets and staging evaluation set are configured. See Milestone 6.5 (private source reference omitted) for language policy, revision and failed-provider accounting details.
