> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Media Workzone plan

**Status:** central Workzone, Editorial Workboard, governed assignments,
admin-only Model Studio, Workzone & Team provisioning, personal saved views,
the assignment-aware personal queue, read-only team workload and reversible
Archive/Restore are included in production revision `d747d7d` as of 2026-08-31.
A derived read-only editorial handoff checklist is also included with bounded
summary/filter and private saved-view persistence. Live provider execution,
BusinessSite binding and permanent deletion remain unavailable.

Video Studio remains a separate module with Weekly FAQ Ads, Daily News Flash
and one explicit governed pipeline. It persists ordered evidence, immutable
script revisions, independent exact-revision approval and blocked render
preparations under `media_intelligence`. Generation add-on, HeyGen execution,
audience listening and distribution remain separate, visibly not connected
acceptance boundaries. See `docs/VIDEO_INTELLIGENCE_PLAN.md`.

Production also treats a tenant with zero Workzones as a normal
onboarding state across Dashboard, Workzone, Workboard, Model Studio, Content
and Social Control. It provides one EN/DE/SQ path to governed Workzone setup and
keeps authentication or infrastructure failures separate. Content uses the
server-derived current Workzone instead of accepting a browser-entered ID.

Ordinary OIDC sign-in preserves the current EN/DE/SQ route through the
callback. Only enabled same-origin locale paths survive; invalid destinations
fall back safely to `/`. This changes navigation only and does not alter
identity, tenant, role, MFA or provider authority.

## Product outcome

Each independent media organisation receives one secure, focused environment in
REDI CONTROL. Its team can discover and verify information, develop original
content, preview and approve revisions, schedule in an explicit timezone and,
only after separate connector acceptance, distribute to the media's Website,
Facebook, Instagram, YouTube and TikTok destinations.

The interface should feel like one newsroom rather than a collection of
unrelated tools. The first `Media Workzone` page therefore assembles the current
modules into one operational path without duplicating their data or policies.

## Ownership and isolation

```text
REDI CONTROL platform
  governed global owner console (implemented locally; no impersonation)
    media tenant (the security and RLS boundary)
      tenant memberships (admin, editor, approver, analyst)
      Media Workzone (the central operational view)
        business workspaces (desk, brand or project inside the media)
        Research -> Content -> Preview/Approval -> Schedule -> Delivery
        Website / Facebook / Instagram / YouTube / TikTok destinations
        AI Gateway model routes and budgets
```

- One independent media is one tenant. A workzone or browser-selected workspace
  never grants cross-media authority.
- The current Root Owner/admin manages dedicated users through the verified
  Keycloak invitation and tenant membership flow. Editors cannot gain approval
  authority by selecting another workspace.
- `business_workspaces` remain useful subdivisions inside a media. Workspace-
  specific memberships are not introduced until a real inside-one-tenant desk
  isolation requirement and its authorization tests are approved.
- Complete cross-media owner control needs a separate provisioning/switching
  contract with recent MFA, explicit global authority, lifecycle audit events,
  tenant limits and negative cross-tenant tests. It is not simulated in this
  slice.

## Editorial workflow

1. **Research:** collect manual/provider/RSS candidates and retain source
   provenance, freshness, claims and evidence.
2. **Create:** promote approved research or start with owner-provided
   information; build one Content Item and independent destination variants.
3. **Preview and approve:** compare immutable revisions, show changed fields and
   require an independent authorized decision.
4. **Schedule:** bind only the approved content hash and retain the explicit IANA
   timezone.
5. **Deliver and reconcile:** destination-specific delivery remains unavailable
   until that connector, account, public media path and provider policy pass a
   separate acceptance gate.

The Workzone currently links these existing modules and shows their real
aggregate counts. Its only story mutation is the audited, MFA-protected
responsibility/deadline contract; it has no stage, approval, publish, retry,
provider-connect or tenant-switch mutation.

## Model Studio policy

Models are installation/workzone configuration behind the existing AI Gateway;
they are never called directly from browser code or embedded into tenant logic.

| Slot                         | Current state                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Research and factual quality | Existing route catalog for claim extraction, evidence comparison, synthesis and validation |
| Editorial imagery            | Reserved; no image provider/model is activated                                             |
| Channel/language adaptation  | Reserved; no provider/model is activated                                                   |

Activation requires a named operation, selected model/provider, structured
input/output schema, prompt/tool version, tenant/workspace scope, budget and
concurrency policy, evaluation threshold, data-handling decision, safe secret
reference and human approval boundary. Editorial images additionally require
rights/provenance metadata and clear generated/edited-media policy. “Best
model” means the best accepted route for a measured task and budget—not a
hard-coded brand or an unverified marketing claim.

## Efficient architecture

- Keep the modular monolith and PostgreSQL-first jobs. Do not create a service,
  database or application fork per media.
- Use one bounded aggregate read model for the Workzone landing page. Load
  editors, revision comparison and media previews only when opened.
- Store durable media directly in private S3-compatible object storage; do not
  move large files through the dashboard or retain them in a web process.
- Perform retrieval, processing, model runs and future delivery as persisted,
  idempotent background units with bounded retries.
- Use configuration and design tokens for branding, enabled modules, model
  routes and destinations.
- Never replace unavailable data with sample analytics or claim a planned
  channel/model is connected.

## Delivery sequence

### Slice 1 — central workzone (implemented locally)

- EN/DE/SQ `Media Workzone` route and persistent navigation.
- Tenant/RLS-scoped aggregate for editorial stages, team count, ready media,
  truthful destinations and safe model-route metadata.
- Strict same-origin response projection; no provider ID, token, secret,
  account identifier or raw failure reaches the browser.
- Links to Research, Content, Composer, Review, Calendar, Publications and
  People & Roles.

### Slice 2 — editorial workboard (implemented locally)

- One prioritized story board joining Research Cases, Content Items and their
  current destination readiness without creating a second source of truth.
- The board recognizes all three existing approved promotion bridges
  (`editorial_candidates`, factual synthesis and editorial draft promotion), so
  promoted Research and Content render as one story instead of duplicates.
- Search, stage filters and a bounded side-panel summary expose source/claim
  counts, freshness and Website/Facebook/Instagram variant/review state. Exact
  immutable copy and revision comparison remain in the existing Research,
  Content and Review modules linked from the panel.
- One canonical primary owner, priority, optional absolute deadline and bounded
  note are implemented without copying workflow state. An assignment made on a
  promoted Content Item resolves back to its Research story and survives that
  bridge. All tenant members can see the responsible colleague inside their
  media; only a tenant administrator with MFA can assign or remove one.
- Deadlines are stored as absolute instants and rendered in the operator's local
  timezone. Overdue is a truthful UI indicator only; no notification,
  escalation or automatic action is claimed.
- YouTube and TikTok remain visible as planned destinations on the Workzone
  landing page; they do not appear as per-story variants because current
  Unified Content supports only Website, Facebook and Instagram.

### Slice 3 — governed model administration (implemented locally)

- EN/DE/SQ admin-only, MFA-protected Model Studio shows current AI Gateway
  routes and measured daily/monthly usage, and updates bounded workspace budget
  policy with CSRF plus audit/outbox evidence.
- Candidate routes are append-only proposals. Each captures operation,
  provider/model identifiers, prompt version, output bound, recorded data-policy
  review and rationale. It never changes `ai_model_routes`.
- Append-only evaluation evidence records dataset version, sample count, four
  bounded pass rates, decision, notes, evaluator and evaluation time. A passing
  record is evidence, not activation approval.
- Editorial-image and channel-adaptation slots can be proposed and evaluated,
  but cannot become runtime routes. No provider adapter, credential, external
  execution or activation/apply control was added.
- The screen is unavailable to non-admin users and every mutation requires MFA.
  Content editors cannot configure budgets, proposals or evaluations.

### Slice 4 — platform owner console

- Explicit global operator identity and tenant provisioning/suspension flow.
- Recent MFA, reauthentication, audit/outbox, limits, two-step destructive
  actions and full cross-tenant negative coverage.
- The console manages media tenants and their admins; it does not bypass the
  media's editorial approval or impersonate a journalist silently.

### Slice 5 — destinations one by one

- Accept BusinessSite separately after its in-progress counterpart checkpoint.
- Accept Meta, YouTube and TikTok separately against current official APIs,
  narrow scopes, test accounts, public media delivery, quotas, webhooks and
  reconciliation evidence.
- Preserve a per-destination selection. “All channels” creates independent
  variants/jobs and never collapses partial outcomes into false success.

## Current non-goals and blockers

- No BusinessSite repository/configuration mutation or production connection.
- No external social account, AI/image provider, credential or paid resource.
- No autonomous publication and no attempt to turn hardened readiness green
  with deterministic/test adapters.
- No tenant impersonation or unrestricted cross-tenant content access. The
  implemented Platform Owner Console is limited to aggregate inventory,
  pending shell provisioning and two-person lifecycle governance under D-053.

## Slice 4 — Platform Owner Console (implemented locally)

- `/{locale}/platform-owner` provides the Root Owner gate, tenant inventory,
  pending-shell form and independent lifecycle approval queue in EN/DE/SQ.
- Access is short-lived and reason-coded; MFA freshness is checked at the API,
  the grant is held only in page memory and browser refresh requires a new
  access reason.
- This slice does not onboard a tenant owner, activate a domain, connect a
  provider, expose media contents or switch into another tenant session.

### Slice 4.1 — SaaS Tenant Setup (implemented locally)

- Pending shells can receive a Media Starter, Team or Network package from the
  same Root Owner dashboard/API. Package modules and limits are server policy;
  the browser selects only package, locale set and brand accent.
- Setup status becomes `awaiting_owner`; installation status stays pending,
  provider availability remains empty and external AI quota remains zero.
- Billing, owner invitation, domain activation and provider connection remain
  separate acceptance slices.

### Slice 4.2 — Installation Service API v1 (implemented locally)

- The Root Owner console can issue/revoke a per-installation machine identity
  only after the tenant, installation and customer Root Owner are active.
- The secret is shown once, stored only as a digest and exchanged for a
  15-minute opaque token with the sole `control:read` scope.
- `/api/v1/control/summary` is tenant-derived, rate-limited and read-only. It
  exposes safe plan/workzone/capability data but no raw tenant authority,
  provider identifier, secret, content, write or publication command.

### Slice 4.3 — API Usage & Credential Center (implemented locally)

- A media Root/White-label Owner can inspect only their tenant's API clients,
  active-token count and bounded 24-hour/30-day usage from Settings → API.
- Issue, rotate and revoke are MFA/CSRF protected. Rotation keeps the stable
  client ID, reveals a new secret once and atomically invalidates older tokens.
- The versioned OpenAPI document lists only the accepted read-only machine
  contract. No provider link, content write or publication capability is added.

### Slice 4.4 — Customer Onboarding Center (implemented locally)

- The Platform Owner card shows package, installation, canonical-domain and
  customer-owner readiness for each media without exposing its contents.
- First-owner invitation issue/revoke requires the short platform grant, recent
  MFA and CSRF. The email/token are stored only as hashes and the token is shown
  once for out-of-band delivery.
- Invitations and Root Owner uniqueness are per tenant. Domain/installation
  activation, email delivery and provider connection remain external gates and
  cannot be bypassed from this screen.

### Slice 4.5 — Workzone & Team Provisioning (implemented locally)

- An exact media Root/White-label Owner can create a desk, brand or project
  only inside their own active installation and only while package capacity
  remains. The browser supplies no tenant, installation, module or quota.
- The owner can edit the workzone profile and attach existing same-tenant
  members with one operational responsibility: lead, editorial, approval,
  research, social or operations. Membership and roles remain managed in
  People & Roles; assignments grant no access or approval authority.
- Reads are bounded to the current tenant. Writes require recent MFA and CSRF,
  run through governed database functions and produce audit plus outbox
  evidence. The runtime role can no longer insert workspaces directly.
- Workzone deletion/archival is intentionally absent until reference inventory,
  retention and a recoverable lifecycle are accepted. This slice sends no
  email and creates no identity, provider connection or external resource.

### Slice 4.6 — Workzone filters & saved views (implemented locally)

- Editorial Workboard exposes the current tenant's workzones as an operational
  selector. Changing it reloads the existing tenant/RLS-scoped story projection;
  it does not grant or remove access.
- Any authenticated tenant member with normal Workboard read authority can save
  up to twenty personal views containing workzone, stage, bounded search,
  assignment scope, operational focus and sort order. Reusing the same
  case-insensitive name updates that personal preset.
- Saved views are private to their creator, use forced RLS and governed database
  functions, and require CSRF for save/delete. Cross-tenant workzones and direct
  runtime writes fail closed; mutations emit audit and outbox evidence.
- No story, assignment, approval, schedule, content or provider state is copied
  into a saved view. Shared/team views remain a future policy decision.

### Slice 4.7 — Personal assignment queue (implemented locally)

- Every Workboard read derives “My assignments” from the authenticated session;
  the browser cannot supply a user or tenant selector.
- One server evaluation timestamp classifies active assigned stories as
  overdue, due within 24 hours or scheduled. Completed stories do not become
  overdue, and workflow exceptions remain distinguishable from deadline risk.
- The Workboard exposes quick queue totals, assignment/focus filters and smart,
  nearest-deadline or recent-update ordering in EN/DE/SQ. Smart ordering is
  deterministic and puts overdue and attention work first.
- Queue filters are operational views over already-readable tenant stories.
  They grant no membership, workzone access, assignment mutation, approval,
  scheduling or publication authority and make no provider/external call.

### Slice 4.8 — Read-only team workload (implemented locally)

- The Workboard derives active load, overdue, due-soon, attention, urgent and
  nearest-deadline totals from the canonical assignments already present in its
  bounded response. Completed stories do not count as active load.
- Coverage is explicit: the API reads one extra candidate to distinguish a
  complete result from a board truncated at its requested limit. The UI labels
  partial coverage instead of presenting bounded counts as exact team totals.
- MFA-verified tenant admins receive the existing tenant team directory and can
  therefore see zero-load members. Other readers receive only assignees already
  visible on readable stories; the workload view never becomes a member
  directory or a new authorization surface.
- The projection is read-only and adds no table, assignment mutation, capacity
  promise, approval, schedule, publication or provider call.

### Slice 4.9 — Derived editorial handoff (implemented locally)

- Every readable story receives five deterministic checks: ownership, evidence,
  content, review and delivery. The next handoff state is the first pending step
  unless an existing rejection/failure makes the story blocked.
- Direct owner-provided Content marks evidence as not applicable rather than
  claiming verification. Approved/promoted Research and existing Content are
  complete only for their own check; review and delivery remain pending until
  their existing workflow state proves otherwise.
- Cards show concise progress and the selected-story preview shows the full
  accessible EN/DE/SQ checklist. The web contract independently recomputes all
  five checks, applicable/completed totals and next state, failing closed on a
  mismatch.
- No checklist row, acknowledgement, waiver or transition is persisted. The
  view cannot assign, approve, schedule, publish or call a provider. Any future
  editable handoff needs explicit ownership, transition, conflict, audit and
  retention policy.

### Slice 4.10 — Bounded handoff summary & filter (implemented locally)

- A compact EN/DE/SQ summary counts every derived handoff state in the currently
  loaded and validated Workboard stories. It repeats the complete/partial
  coverage badge from the bounded response so the numbers are not presented as
  installation-wide totals.
- Each state is an accessible pressed-state control. It combines with workzone,
  stage, assignment, operational focus, search and sort without changing any
  story or authorization state; selecting an active state again returns to all.
- This initial slice kept the filter session-only. Slice 4.11 supersedes that
  persistence detail through a separately versioned governed migration rather
  than an implicit browser-only extension.
- The summary and match logic operate only on already-sanitized `WorkboardStory`
  values and have focused deterministic tests. No API/provider request, write,
  audit event or migration is introduced.

### Slice 4.11 — Saved handoff filter (implemented locally)

- Migration `0027_workboard_handoff_filter.sql` adds one constrained
  `handoff_filter` to each existing personal saved view. Existing rows receive
  `all`, preserving their prior meaning; no checklist/check completion is
  stored.
- The governed PostgreSQL upsert, domain service, API schema, same-origin BFF
  and UI save/apply path carry the accepted selector end to end. Old request
  shapes that omit it safely default to `all`; deploy migration/API before the
  new web image.
- Invalid values fail at browser contract, API schema and database function.
  Saved values remain owner-private under forced RLS, same-tenant workspace
  validation, CSRF, the twenty-view cap, audit and transactional outbox.
- Applying a saved view restores its handoff filter together with workzone,
  stage, search, assignment scope, focus and sort. Manual filtering still
  changes no story, checklist, approval, schedule, publication or provider
  state.

### Slice 4.12 — Personal default Workboard view (implemented locally)

- Migration `0028_workboard_default_view.sql` adds one `is_default` preference
  to the existing owner-private saved-view row. A partial unique index enforces
  at most one default for each tenant/user even under concurrent requests.
- A governed PostgreSQL function verifies that the target view belongs to the
  session-derived tenant/user, serializes switching, clears before setting and
  emits audit/outbox evidence. Set and clear require CSRF; direct runtime table
  writes remain denied.
- The snapshot exposes only a `defaultViewId` that belongs to its sanitized
  saved-view list. The strict BFF converts missing, deleted, malformed or stale
  references to `null`; Workboard startup then loads its standard tenant view
  instead of failing or following another workspace.
- EN/DE/SQ controls mark the selected personal view as default or remove the
  preference. Startup restores workzone and all saved filters; the preference
  grants no workzone, membership, approval, scheduling, publishing or provider
  authority.

### Slice 4.13 — Personal saved-view rename and duplicate (implemented locally)

- Migration `0029_workboard_view_management.sql` adds governed functions, not a
  parallel preference table. Rename changes only the trimmed bounded name and
  keeps the same ID/default; duplicate copies the persisted filters into a new
  ID and explicitly sets it non-default.
- Both actions resolve only an existing view owned by the session-derived
  tenant/user, share the advisory lock, reject case-insensitive name conflicts,
  preserve the twenty-view limit and emit audit/outbox evidence. Direct runtime
  writes remain denied.
- Strict same-origin PATCH/duplicate routes accept only `{ name }`, reject extra
  authority fields and require CSRF. EN/DE/SQ actions present Save, Rename,
  Duplicate, Default and Delete as distinct operations with honest status.
- Duplicating restores the persisted copy in the Workboard, so unsaved browser
  filter changes are not silently mixed into the copied preset. Neither action
  changes workzone access, assignments, workflow, approval, publication or
  provider state.

### Slice 4.14 — Workzone lifecycle impact preview (implemented locally)

- Migration `0030_workzone_lifecycle_impact.sql` adds a governed, read-only
  function that verifies exact own-tenant owner authority and the active
  installation before returning counts for every current `workspace_id`
  relation.
- Seven stable families distinguish durable blocking reference rows from
  informational team/view rows. Counts expose no record, member, provider or
  foreign-tenant detail and are explicitly reference rows rather than entity
  totals.
- The API and same-origin BFF expose one lazy per-workzone GET. EN/DE/SQ UI
  loads it only when expanded; the strict browser contract verifies workspace,
  categories, totals and the fail-closed operation flags.
- At this preview-only slice, Archive and delete remained unavailable. The
  preview performs no mutation, audit/outbox write, provider action or
  BusinessSite integration. The later accepted Archive/Restore slice reuses
  this bounded preview while permanent deletion remains unavailable.

### Slice 4.15 — Workzone lifecycle policy (accepted for Archive/Restore)

- `WORKZONE_LIFECYCLE_POLICY.md` records the verified schema/FK/saved-view
  baseline and the archive/restore contract. The owner accepted its seven
  decisions on 2026-08-30 under D-068.
- The policy preserves all content, evidence, media, assignments, views and
  provider records; blocks active delivery/upload/OAuth work; retains Workzone
  identity; requires recent MFA, CSRF, reason, idempotency, locks and atomic
  audit/outbox evidence.
- Archived Workzones continue counting toward entitlement, and at least one
  active Workzone must remain. This avoids quota bypass and an installation
  with no usable desk.
- Permanent deletion remains a separate two-person, recoverable-quarantine,
  legal/export, ordered-purge and backup-expiry design. It is not authorized by
  the accepted Archive/Restore policy.

### Slice 4.16 — Governed Workzone Archive/Restore (implemented locally)

- Migration `0031_workzone_archive_restore.sql` adds constrained lifecycle
  state/version metadata, an append-only forced-RLS idempotency ledger,
  serialized transition revalidation and atomic lifecycle/audit/outbox
  evidence.
- Exact own-tenant Root/White-label Owners can archive or restore through the
  recent-MFA and CSRF-protected API and same-origin BFF with a bounded mandatory
  reason. Active uploads, OAuth handoffs, delivery work and the final active
  Workzone fail closed.
- Archive preserves identity, content, evidence, media, assignments, provider
  records and private views, while clearing affected default-view pointers and
  denying active writes. Restore keeps the same identity and does not silently
  restore a former default.
- EN/DE/SQ Settings UI keeps archived Workzones visible, disables ordinary
  edits and assignments, and displays only non-zero transition blockers. No
  hard-delete route, provider call, BusinessSite mutation or production rollout
  is included.
