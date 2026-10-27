> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Data model

## Milestone 6 editorial artifacts

`media_profile_revisions` and `editorial_context_packs` are immutable versioned policy snapshots. `editorial_drafts` links a factual synthesis, Evidence Pack and Context Pack and stores independent validation plus human-review state. A human edit is a new immutable row with `revision_kind=human_edit`, a `source_draft_id`, a required reason and fresh validation; its predecessor becomes `superseded`. `editorial_draft_promotions` preserves the provenance edge to Unified Content. All use forced RLS.

## Media Workzone responsibility

`editorial_story_assignments` stores one primary tenant member, priority,
optional absolute deadline and bounded note for either a Research Case or a
direct Content Item. Exactly one target is present. Once Content is linked to
Research, the service resolves Research as the canonical target so the
responsibility survives promotion. This table does not store or override
editorial stage, approval, schedule or destination delivery state. It uses
forced RLS; mutations additionally require tenant-admin permission, MFA, CSRF,
same-tenant membership validation, audit and transactional outbox evidence.

`business_workspaces` now has a stable installation-scoped slug, bounded
description and update timestamp. `workzone_team_assignments` links an existing
same-tenant member to one existing workzone with one operational responsibility
and assignment evidence. Its composite tenant foreign keys, uniqueness and
forced RLS prevent cross-tenant links. It is not an authorization relation;
`memberships` remains the sole source of tenant role authority. Workspace
creation is available only through the quota-enforcing governed function, not
through direct runtime-role insertion.

`workboard_saved_views` stores one user's personal Editorial Workboard preset:
one same-tenant workzone, one accepted board stage, bounded search text,
assignment scope, operational focus and deterministic sort order. A
generated case-insensitive name key prevents duplicate personal names and a
governed function caps each tenant/user pair at twenty rows. Forced RLS includes
both tenant and user identity; runtime receives function execution only, not
direct table access. These rows reference no story and never change membership,
assignment, workflow, approval, schedule or provider state. Personal queue
flags are not stored: the Workboard derives them from the current session user,
canonical assignment, absolute deadline and workflow stage at one server
evaluation timestamp. Team workload is likewise not stored: active per-member
and unassigned counts are derived only from the bounded Workboard result. Its
coverage flag records whether that result is complete, so it is not a durable
capacity ledger or historical utilization model.

Editorial handoff checks are also projections, not relations. Ownership comes
from `editorial_story_assignments`; evidence comes from the canonical Research
status; content, review and delivery come from the existing Content and
destination workflow records. No checklist, completion flag, acknowledgement
or override is stored, so handoff guidance cannot diverge into a second source
of editorial truth.

Handoff summary counts and checklist states are not stored. Migration `0027`
adds only a constrained `handoff_filter` selector to `workboard_saved_views`;
existing rows default to `all`. The selector is owner-private preference data,
not a story reference, completion flag, acknowledgement or workflow override.
Migration `0028` adds only `is_default` to the same personal saved-view row. A
partial unique index permits at most one default per tenant/user, and deleting
that view naturally removes the preference. It grants no workzone access and
stores no new editorial state.

Migration `0029` adds no relation or authority-bearing column. Its governed
rename function changes only the personal view name and therefore preserves the
row ID and `is_default`; its duplicate function copies the bounded filter fields
into a new non-default row. The existing unique name key and twenty-row cap
remain authoritative.

Migration `0030` adds no lifecycle state and changes no foreign-key behavior.
Its governed preview counts workspace-owned rows across the complete current
schema and groups them as publishing/delivery, editorial content,
research/evidence, AI governance, tenant setup, team assignments and personal
saved views. Counts are reference rows, not distinct stories or provider
objects. Blocking/informational classification is planning metadata only;
archive and delete remain unavailable in that migration.

Migration `0031` adds reversible `active|archived` Workzone state and an
append-only, forced-RLS lifecycle event/idempotency ledger. Archive preserves
all referenced data, clears affected personal defaults, blocks active upload,
OAuth and delivery work, and refuses the final active Workzone. Restore keeps
the same ID/slug and never silently reinstates an old default. Database write
guards reject workspace-owned mutations while archived. Permanent delete and
provider-side disconnect remain absent.

## Source Discovery & Ingestion Milestone 4

Migration `0010_source_discovery_ingestion_m4.sql` extends `research_case_sources` with bounded extracted material, normalized URL/fingerprint, author, discovery method and retrieval outcome. This remains the one Research evidence store.

`source_provider_configurations` stores provider-neutral non-secret settings and opaque `secret://` references only. `source_feeds` binds configured RSS/Atom URLs to existing Source Registry feed entries. `discovery_runs` and `discovery_results` are operational/editor-selection records; results are explicitly untrusted and do not become evidence until attached. `provider_usage_events` is an immutable no-AI request/result/cost ledger. All five relations use composite tenant/workspace references and forced RLS.

## Milestone 3A media/social relations

`media_assets` owns tenant/workspace identity, lifecycle and retention. `media_objects` stores original/derived lineage and verified metadata; `media_upload_sessions` binds expected bytes to a short-lived server key; usage references and deletion workflows make purge explicit. `oauth_transactions` stores state hashes and PKCE secret references. `social_accounts` stores provider identities/scopes/health and token references only. `social_drafts` points to append-only revisions; approvals bind revision hashes, while targets and publication attempts retain per-account idempotency/outcome. Every tenant relation has forced RLS.

## Milestone 3B-0 installation relations

`installation_profiles`, `installation_domains`, `installation_oauth_applications`, and `installation_entitlements` extend each white-label installation without creating a parallel tenant model. Composite tenant/installation foreign keys and RLS prevent cross-installation access. Only the security-definer resolver may return the minimal tenant/installation/canonical identifiers for an active trusted hostname before tenant context exists. OAuth transactions now persist installation, exact expected origin and an enumerated post-connect path alongside the signed state hash.

## Foundation schema

`database/migrations/0001_foundation.sql`, `0002_milestone_1.sql`, and `0003_milestone_2_registry.sql` create the current control schema:

- `tenants` and `users` are identity roots.
- `memberships` binds roles to users within tenants.
- `audit_events` records append-only critical activity.
- `outbox_events` atomically records events for worker delivery.
- `sessions` stores opaque-token hashes, CSRF hashes, tenant/user/provider/MFA state, expiry, rotation and revocation.
- `local_demo_bootstrap_tokens` exists only for the explicitly enabled local
  synthetic harness. It stores a SHA-256 token digest, fixed seeded tenant/user,
  a maximum fifteen-minute expiry and atomic consumption timestamp. Runtime can
  select/update it only through the auth role; the plaintext token exists only
  in an ignored mode-`0600` local file and never becomes durable application
  data.
- `feature_flags` enforces tenant module availability on the server.
- `jobs` is the PostgreSQL-first tenant queue with status, idempotency, attempts, locks and dead-letter state.
- `platform_definitions` and `connector_versions` are global, non-secret catalog records with checksummed Manifest v1 documents.
- `white_label_installations`, `business_workspaces`, and `platform_connections` distinguish deployment branding, tenant business context, and an individual connector instance.
- `connector_health_checks`, `connector_idempotency`, and `connector_rate_limits` are tenant/connection-scoped runtime evidence and controls.

UUID values are application-generated; timestamps are UTC `timestamptz`. Runtime roles must not own tables or have `BYPASSRLS`. Migrations run under a distinct owner role. Tenant tables use `ENABLE` and `FORCE ROW LEVEL SECURITY` plus explicit `USING` and `WITH CHECK` policies.

## Planned logical tables

| Module     | Tables/records                                                                                                        | Tenant key                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Registry   | Implemented in migration 0003; no additional Registry table is currently planned                                      | all installation/workspace/connection rows      |
| Context    | businesses, context_sources, context_facts, context_fact_versions, context_conflicts, context_releases, context_packs | all tenant-owned rows                           |
| Approval   | approval_requests, approval_decisions                                                                                 | both                                            |
| Website    | website_proposals, website_previews, website_releases                                                                 | all                                             |
| Media      | media_assets, media_variants, media_jobs                                                                              | all; also storage prefix                        |
| Social     | social_drafts, publication_attempts                                                                                   | all                                             |
| AI         | prompt_versions, tool_versions, ai_invocations, usage_ledger, eval_runs                                               | usage/invocations; global definitions separated |
| Automation | automation_definitions, automation_versions, executions, event_receipts                                               | all                                             |

Rows other than Registry remain designs, not authorization to add their migrations.

## Modeling rules

- Use normalized relational columns for identity, state, ownership, time, uniqueness, and queryable policy; JSONB only for versioned provider payloads or schemas with bounded validation.
- Every tenant-owned foreign key includes or verifies tenant consistency. Prefer composite uniqueness such as `(tenant_id, external_id)`.
- Soft deletion does not satisfy legal deletion by itself; deletion workflows track provider/object/database copies and audit the completion without retaining deleted content.
- Audit metadata excludes secrets and minimizes personal data. Sensitive values use references/envelopes and explicit retention.
- Optimistic version columns protect edits; publication/approval stores a canonical payload hash to prevent time-of-check/time-of-use changes.
- Idempotency records bind tenant, operation, key, request hash, status, and result reference. Reusing a key with another payload is rejected.
- Provider raw data is quarantined/normalized before becoming Context Studio facts.

## Tenant session contract

Within each database transaction the API must set the verified tenant with `SET LOCAL app.tenant_id = $1`. Connection pooling must never use session-wide tenant state. A missing/invalid setting defaults to no tenant rows. Integration tests must try select/insert/update/delete across two tenants using the actual runtime role.

## Audit and outbox

Audit entries are immutable from application code. Corrections are new linked events. Outbox consumers claim rows safely, publish/handle at least once, record attempts, and rely on idempotent consumers. Operational retention and archive periods require an owner/legal decision.

## Website Control Milestone 1 relation

`website_connection_profiles` extends an existing `platform_connections` row with provider-neutral non-secret website configuration: exact API base URL, external integration identifier, display name, domain, optional preview URL, bounded article-status summary and last-sync time. A composite `(tenant_id, connection_id)` foreign key and forced RLS preserve tenant isolation. HMAC material remains only an opaque `secret_reference` on the platform connection. The existing installation/workspace/entitlement/connector model remains authoritative; no parallel website tenant or credential model was introduced.

`content_items` provides the shared editorial identity for one story/campaign in one existing workspace. `content_item_media` orders references to existing Media Library assets. `content_item_variants` links each initial destination to its native state: website variants use an existing BusinessSite Platform Registry connection and remote article ID; Facebook/Instagram variants use separate existing social drafts/accounts. Social revisions, approvals, schedules and publication attempts are not duplicated. See [Unified Content Milestone 2](UNIFIED_CONTENT_MILESTONE_2.md).

Migration `0040_content_website_drafts.sql` adds one local Website draft head per
Content Item. `content_website_draft_revisions` freezes slug, title, excerpt,
structured body and an exact content hash; `content_website_draft_media` freezes
the ordered ready Media Library selection for that revision. Forced RLS,
same-tenant/workspace composite keys, active-Workzone guards and immutable
revision/media triggers preserve isolation and provenance. These rows are local
preparation only: they contain no connection, remote ID, approval, schedule,
connector call or publication authority.

## Evidence Intelligence (Milestone 5)

`ai_model_routes`, `ai_budget_policies`, `ai_runs` and `ai_usage_events` hold provider-neutral routing, prompt/model versions, budgets, idempotency and cost telemetry. One tenant-scoped usage row per AI run moves from `reserved` to `reconciled` or `failed`; failed calls retain measured usage when supplied by the provider and otherwise retain the conservative reservation. `research_claim_proposals` and `research_evidence_proposals` hold AI suggestions until an audited human decision materializes accepted rows into existing M3 claims/evidence. `evidence_packs` and `factual_syntheses` are immutable/versioned. `synthesis_promotions` is the provenance edge into existing Unified Content. Every M5 table uses forced RLS.

## Governed model administration

- `ai_model_routes` remains the separately controlled runtime routing source.
- `ai_budget_policies` holds the workspace cost/concurrency boundary; Model
  Studio can update only its bounded numeric policy.
- `ai_route_proposals` is an append-only tenant/workspace candidate route with
  operation, provider/model label, prompt version, output limit, data-policy
  review status, rationale and creator evidence.
- `ai_route_evaluations` is append-only evidence attached to one same-workspace
  proposal. It stores dataset version, sample size, schema/grounding/safety/
  language rates, decision, notes, evaluator and actual evaluation time.
- Proposal/evaluation rows use forced RLS and immutable update/delete triggers.
  No foreign key or trigger promotes them into runtime routing.

## Governed Video Intelligence

Migration `0032_video_intelligence_briefs.sql` adds planning records without a
provider, render job or publication path:

- `video_briefs` is the current topic/program header and points to the current
  immutable script revision.
- `video_brief_evidence` stores ordered, immutable minimized evidence. Its
  enumerated kinds exclude raw private messages.
- `video_script_revisions` stores each exact script and SHA-256 content hash;
  edits append and reset the brief to draft.
- `video_script_approvals` binds a human decision to one exact revision. The
  requester cannot decide their own request.
- `video_command_receipts` binds tenant, workspace, actor, command, UUID key,
  request hash and safe response for deterministic replay/conflict rejection.

All five relations use composite tenant/workspace references, forced RLS and
active-Workzone guards. Evidence, revisions and receipts are immutable.
Lifecycle impact counts all five as preserved editorial references.

Migration `0033_video_render_preparations.sql` adds the provider-neutral handoff:

- `video_render_preparations` immutably binds the tenant/workzone, approved
  brief revision and approval to presentation mode, language, duration and a
  bounded rights/consent reference;
- `video_render_outputs` stores one or two ordered, unique `9:16`/`16:9`
  requests under the same tenant/workzone composite foreign key;
- every preparation is structurally `blocked` with
  `provider_not_accepted`. No `jobs` row, provider identifier, credential,
  usage charge or rendered asset is created.

Both relations use forced RLS, active-Workzone guards and immutable triggers.
Lifecycle impact counts them as preserved editorial references.

Migration `0034_video_render_job_reservations.sql` adds the internal accounting
boundary without enabling provider execution:

- `video_generation_policies` stores one disabled-by-default HeyGen credit and
  concurrency policy per workzone, with explicit UTC accounting windows;
- `video_render_jobs` binds exactly one lifecycle and provider idempotency key
  to each prepared output, while retaining safe status/failure fields for later
  reconciliation;
- `video_generation_usage_events` is the immutable reservation/reconciliation/
  release ledger.

All three relations use forced RLS, composite same-tenant references and active
Workzone guards. A locked policy serializes concurrent reservations. The local
reservation service inserts the output jobs, ledger, audit and outbox rows in
one transaction and creates no general worker job or provider request.

Migration `0035_video_render_job_leases.sql` adds the internal submission
lease boundary without registering execution:

- `available_at`, `locked_at`, `locked_by` and `lease_expires_at` support one
  bounded worker claim without holding a database transaction during a future
  provider request;
- `attempt_count` and `max_attempts` bound retries; an expired lease returns to
  `reserved` with backoff or becomes `failed` with the safe
  `VIDEO_SUBMISSION_LEASE_EXHAUSTED` code;
- a database check requires a complete lease only while status is
  `submitting`, and requires all lease fields to be empty in every other state.

The local state machine emits audit/outbox evidence for claim, recovery,
exhaustion and submitted transitions. It defaults to refusal, is not registered
with the worker and performs no provider, credential or network operation.

Migration `0036_video_render_verified_assets.sql` adds the successful-output
handoff without creating a second media store:

- Media Library accepts the explicit `generated_provider` source and
  `video_render` usage-reference type;
- a succeeded render job must reference one unique ready Media Library asset in
  the same tenant/workzone and must contain reconciled actual credits;
- the local completion service verifies original MP4 metadata, checksum
  presence, positive size, expected aspect ratio, bounded duration, requester
  attribution and conservative credit ceiling before the atomic transition;
- success inserts one immutable `reconciled` usage event, media usage reference,
  audit event and outbox event. Exact replay is idempotent; changed replay fails.

The service defaults to refusal and is not registered in an API route or
worker. It does not download a provider URL or upload an object; only a trusted
future transfer path that has completed Media Library verification may call it.

Migration `0037_video_render_asset_reviews.sql` adds the independent output
decision without creating another asset or publication workflow:

- each successful render owns one review bound immutably to its job, verified
  Media Library asset, approved script revision and exact script hash;
- completion creates the pending review in the same transaction as asset
  binding and credit reconciliation;
- forced RLS and database checks prevent cross-tenant binding, requester
  self-approval, decision reset and mutation/deletion of the exact bindings;
- an MFA/CSRF-protected `content:approve` command records approve/reject,
  requires a bounded rejection reason, replays exactly and emits audit/outbox
  evidence with `publicationAuthorized=false`.

The read model shows bounded MP4 metadata and uses the existing short-lived
Media Library download contract for private preview. It stores no preview URL.

Migration `0038_video_social_distribution_handoffs.sql` adds the first bounded
distribution preparation without adding a second publisher:

- one approved exact-asset review may produce one ordinary Social Control draft
  for selected existing accounts in the same tenant/workzone;
- the immutable handoff records the review, render job, Media Library asset,
  exact script hash, Social draft, actor and exact idempotent request hash;
- the draft contains the approved video as its only media attachment and starts
  at `draft`; no social approval, schedule, queue job or provider attempt exists;
- forced RLS, server-derived tenant authority, CSRF, exact replay and a unique
  review binding prevent tenant override, asset substitution and duplicate
  handoffs.

The handoff is visible in Video Studio and links into the existing Social
Composer. Destination preflight, scheduling, publication and reconciliation
remain separate fail-closed steps.

Migration `0039_video_website_content_handoffs.sql` adds a separate Website
preparation boundary without invoking BusinessSite:

- one approved exact-asset review may create one ordinary Unified Content item
  in `draft`, with the verified video attached through the existing media
  lifecycle;
- the immutable handoff records the review, render job, Media Library asset,
  exact script hash, Content Item, actor and exact idempotent request hash;
- forced RLS, active-Workzone guards, server-derived tenant authority, CSRF,
  exact replay and unique review/item bindings prevent tenant override, asset
  substitution and duplicate Website handoffs;
- no `content_item_variants` row, BusinessSite article, connector call, approval
  or publication job is created.

Video Studio links the draft into Unified Content. A later intentional command
must still choose a Website connection and create/review the destination
variant before any connector execution can exist.

D-081 adds no table or migration. Website destination preflight is a bounded
read projection over the existing Content Item, installation entitlement,
feature flag, destination variant, attached Media Library objects and safe
same-workzone connection profile. It persists no readiness claim and returns no
secret reference. MP4 remains a blocker until an accepted connector contract
can deliver the exact reviewed video without bypassing destination review.

D-082 and migration `0040_content_website_drafts.sql` add the local Website
composer boundary described above. A later review must bind an exact revision,
and a later transfer must explicitly choose an accepted connection; neither is
implied by the current draft head.

D-083 and migration `0041_content_website_draft_reviews.sql` add one review per
immutable Website revision. The row duplicates the exact revision hash under a
composite foreign key, starts pending and may transition once to approved or
rejected; finalized rows cannot be edited or deleted. The requester and decider
must differ. Approval has no destination, connector or publication authority.

## Platform owner governance

- `platform_access_grants` stores the Root Owner, authority tenant, bounded
  reason and maximum 60-minute expiry. It is a temporary capability, not a new
  membership or impersonation session.
- `platform_tenant_lifecycle_requests` stores suspend, reactivate or
  pending-deletion requests. The requester cannot execute the same request.
- Security-definer functions expose only the governed global projection and
  validated shell/lifecycle commands. Runtime roles have no direct table
  privilege; all ordinary tenant tables retain forced RLS.
- A provisioned shell contains a tenant, pending installation, one workspace,
  empty profile/modules and foundation entitlements. It contains no member,
  domain, OAuth application, provider account or credential.
- `platform_tenant_setups` records the selected server-owned SaaS package,
  locale set, configuration status and operator evidence for one pending shell.
  Package application updates the existing installation profile, entitlements
  and module flags; it does not create a parallel tenant/settings model.
- `installation_api_clients` stores an installation-bound public identifier,
  secret digest, sole read scope, bounded expiry and revocation evidence. The
  plaintext secret is never persisted.
- `installation_api_tokens` stores only opaque token digests with a maximum
  15-minute expiry. `installation_api_rate_limits` persists per-client exchange
  and request windows. Security-definer functions derive tenant/installation
  from these rows; the runtime role has no direct table privilege.
- The tenant credential center adds no credential or telemetry table. Governed
  functions project safe client metadata and aggregate the existing rate-limit
  windows; issue/rotate/revoke remain tenant-derived, audited and outboxed.
  Rotation updates only the digest and revokes all active tokens atomically.
- `first_owner_invitations` now records optional platform issuer/revoker
  evidence while retaining only token/email digests. Active invitation and
  Root Owner uniqueness are tenant-scoped, not platform-global. The onboarding
  center is a governed projection over setup, installation, canonical domain,
  workzone, membership and invitation state; it creates no parallel customer or
  workspace model.
