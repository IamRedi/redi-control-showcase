> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Universal Media Dashboard

**Status:** dashboard foundation plus central Media Workzone implemented locally;
external integrations remain gated, 2026-08-27.

## Purpose

REDI CONTROL will provide one clear operational dashboard for an individual
media organisation. It is a newsroom control plane, not a replacement for the
media's public website or a hidden publisher for external channels.

The initial pilot is Aurora Media. The design is universal: another media uses
the same product and configuration, never a source-code fork.

## Security boundary

A media organisation is a REDI CONTROL **tenant**. This is the existing
database/RLS boundary and is the only acceptable boundary for a journalist who
must not see another media's stories, sources, drafts, channels or analytics.

- A Root Owner administers the active media tenant and may invite/manage its
  members with recent MFA.
- Journalists receive the existing `editor` role: they can research and create
  drafts but cannot approve their own sensitive publication.
- Approvers and admins are separate roles. Publication remains destination
  specific and approval-bound.
- A future cross-media owner console needs an explicit privileged
  provisioning/tenant-switch design and security tests. It is not implemented
  by treating a browser-selected workspace as authority.

`business_workspaces` remain useful for desks, brands or projects inside one
media, but do not provide the security isolation required between independent
media organisations.

## Dashboard information architecture

1. **Overview** — live operational summary, approvals, delivery exceptions and
   channel connection status. It contains no fabricated analytics.
2. **Newsroom** — research cases, manual/RSS/provider discovery, source
   provenance, freshness and verification decisions.
3. **Article studio** — evidence-backed factual synthesis and editorial draft
   creation. Every AI operation remains budgeted, schema-validated and tied to
   immutable Evidence and Editorial Context Packs.
4. **Publishing** — one Content Item with independent Website, Facebook,
   Instagram and, later, TikTok variants. A destination is visibly
   `not connected` until its real connector has been accepted.
5. **Channels** — Website, Meta/Facebook, Instagram, TikTok, email and
   WhatsApp connection cards. This module shows status and required next steps;
   it never stores credentials in the browser or repository.
6. **People and roles** — Root Owner-managed journalist, approver, analyst and
   admin memberships. Inviting a new identity requires a dedicated,
   verified-identity flow; a raw email alone must not create an account.
7. **Operations** — audit trail, backup/health alert state and later analytics.

## Scope of the first dashboard slice

The first implementation slice replaces the current sample-heavy overview with
a truthful media-dashboard shell and connects it only to existing tenant-safe
read models. It exposes the Newsroom, Content and Website workflows already in
the repository and shows external channels as unavailable until their real
provider acceptance. It also provides an MFA-protected tenant-local People &
Roles directory; this is a directory only, not an unsafe email-to-account
shortcut.

Website status is projected from the tenant's connector registry and
Facebook/Instagram status from its discovered social accounts. `connected`
means active plus healthy; an existing but unhealthy or otherwise inactive
connection is `needs_attention`. The remaining channels stay `not_connected`
or `planned` until an accepted connector exists.

It does **not**:

- connect Meta, Facebook, Instagram, TikTok, email or WhatsApp;
- claim live analytics or inbox messages;
- scrape social platforms or search engines;
- create journalist identities without a verified OIDC invitation workflow;
- allow autonomous publication.

## Delivery sequence

1. Replace demo dashboard navigation/cards with a reusable, accessible media
   shell and truthful connection/status cards.
2. Expand the tenant-safe overview read model for newsroom, content, approval
   and channel counts; add authorization and tenant-isolation coverage.
3. Add a Root Owner people-management flow using verified identity invitations
   and MFA. No workspace-only access control is accepted as a substitute for
   tenant isolation.
4. Add a privileged, separately audited owner-provisioning console for creating
   additional media tenants only after its security contract is approved.
5. Accept real Website, Meta/Facebook/Instagram/TikTok, email and WhatsApp
   adapters one by one with official-provider documentation, credentials kept
   outside Git, narrow scopes and end-to-end tests.

The central Workzone portion of steps 1–3 is now implemented as a bounded
read-only aggregate and EN/DE/SQ operational page. It links the existing
Research, Content, Composer, Review, Calendar, Publications and People flows;
shows Website/Facebook/Instagram/YouTube/TikTok connection truth; and projects
only safe configured AI route metadata. See
[Media Workzone plan](MEDIA_WORKZONE_PLAN.md). Global cross-media provisioning,
editorial-image model activation and all real destination connections remain
later separately gated slices.

The separate EN/DE/SQ Editorial Workboard now joins active Research Cases,
approved Research-to-Content promotions and current Unified Content destination
state into one bounded read-only board. It provides search, stage filtering and
a detail summary, but keeps exact revision comparison and decisions inside the
existing governed modules. It introduces no assignment table, due-date model or
publication command.

## Acceptance criteria for slice one

- The overview contains no sample business metrics or pretend channel health.
- It clearly labels disconnected integrations and links to the real existing
  Newsroom, Content and Website workflows.
- It is keyboard accessible and responsive.
- The API continues to derive the tenant from the authenticated session; no
  client-provided tenant identifier is accepted as authority.
- Existing tenant/RLS, approval and audit guarantees remain intact.

## Verified journalist invitation flow

The People page may invite only `editor`, `approver` and `analyst` roles. It
requires a current tenant administrator with MFA and never accepts a tenant ID
from the browser. The server creates a new, unverified Keycloak identity and
uses Keycloak's action-email endpoint to issue one 24-hour link for email
verification, a user-chosen password and TOTP setup. After Keycloak completes
those actions, the normal OIDC callback atomically consumes the matching
tenant-bound invitation and creates the membership/session.

REDI CONTROL stores only a normalized-email hash and the immutable OIDC subject
for the pending invitation. There is no reusable bearer invitation token in a
URL, database row or audit event. Invitations are single-use, expire after 24
hours and are bound to the active installation host. A failed delivery removes
the newly created identity; a failed REDI CONTROL write also attempts that
compensating deletion. Existing identities are intentionally refused in this
first slice rather than silently granting cross-media access.

The Keycloak service account is purpose-built and must have only
`view-users`, `query-users` and `manage-users` in the `realm-management`
client. It cannot change tenant roles, create tenants or publish content.
