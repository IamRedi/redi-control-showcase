> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Multi-tenancy and security

## Threat model summary

Protected assets include tenant data, platform tokens, media, business/price context, publication rights, prompts/tools, usage/cost, and audit evidence. Main threats are cross-tenant access, privilege escalation, confused deputy behavior, leaked tokens, malicious uploads, webhook replay, SSRF, duplicate execution, approval bypass, prompt/tool injection, dependency compromise, and unsafe operator access.

Trust boundaries are browser→web/API, API→database/queue/storage, worker→connector/provider, webhook→API, AI provider→gateway, and operator→production. Every crossing requires authenticated identity/workload, tenant context, validated schema, least privilege, rate/size limits, safe logs, correlation, and failure handling.

## Isolation controls

1. Resolve effective tenant from a trusted authenticated session and current active membership.
2. Authorize action with centralized RBAC/policy; hiding a UI control is not authorization.
3. Set transaction-local tenant context and enforce PostgreSQL RLS with a non-owner runtime role.
4. Prefix and policy storage keys as `tenant/{tenant_id}/...`; signed upload/download URLs are short-lived and bind exact object, operation, content type, and size.
5. Namespace cache/locks/rate limits by tenant; queue messages carry tenant and are re-authorized at execution.
6. Build AI Context Packs from tenant-filtered facts and pass tenant-aware tool credentials/context.
7. Automate negative two-tenant tests for every new repository/query/connector route.

Root Owner is not a normal customer role. Production access must be MFA-protected, time-bound/break-glass where possible, reason-coded, and prominently audited.

## RBAC baseline

| Capability               | Root/White-label owner |                Admin |        Approver | Editor | Analyst |
| ------------------------ | ---------------------: | -------------------: | --------------: | -----: | ------: |
| Tenant configuration     |                    yes | limited/no by policy |              no |     no |      no |
| Connect platform         |                    yes |                  yes |              no |     no |      no |
| Read platforms/analytics |                    yes |                  yes |             yes |    yes |     yes |
| Edit drafts/context      |                    yes |                  yes |             yes |    yes |      no |
| Approve external action  |                    yes |                  yes |             yes |     no |      no |
| Read audit               |                    yes |                  yes | policy decision |     no |      no |

This is a baseline requiring owner confirmation. Separation of duties may forbid a requester from approving their own L2/L3 action.

## Authentication and secrets

Identity is adapter-based; the production contract is OIDC Authorization Code with PKCE and no provider is hard-coded in M1. Sessions use an opaque 256-bit token whose SHA-256 hash is stored server-side. The cookie is `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` outside local development, has no Domain, expires absolutely after 8 hours, idles after 30 minutes, and rotates after 15 minutes. Logout/revocation is server-side. MFA is supported by the adapter and required for owner/admin sensitive operations. OAuth connector flows use high-entropy state bound to tenant/session, PKCE where supported, exact redirect URI, minimal scopes, encrypted token storage by vault/KMS reference, rotation/revocation, and no token logging.

`.env` is local development only. Production secrets require a managed vault/KMS, workload identity, access audit, rotation runbook, and redaction tests.

## Webhooks and outbound requests

Verify signature on raw body using provider-documented algorithms, check timestamp/tolerance, deduplicate provider event ID, reject replay, and acknowledge only after durable receipt. Store minimal safe evidence. Outbound URLs are connector-owned or pass scheme/host/port allowlists, DNS/IP checks, redirect revalidation, timeouts, response/body caps, and private/link-local/metadata-address blocking.

### Source retrieval boundary

Milestone 4 implements the outbound rule for research sources in one boundary. HTTPS is mandatory; URL credentials, custom ports, localhost, private, carrier-grade NAT, link-local, multicast, reserved and documentation ranges are denied. Every DNS answer must be public and the request is pinned to a validated answer. Redirects are manual, bounded and fully revalidated. The request advertises an operator-configured bot identity, requests identity encoding, forwards no user/session cookie or authorization, executes no remote JavaScript, and accepts only bounded HTML/XML/feed/JSON types. Extracted source material is always labelled untrusted and cannot grant permissions, become a verified claim or trigger publication.

## Jobs, approvals, and audit

All repeatable external writes use tenant-scoped idempotency and payload hash. Retry only classified transient failures with exponential backoff/jitter and bounded attempts; permanent/exhausted jobs go to a visible DLQ. Execution reloads current authorization, connection status, kill switch, approval, and exact approved-payload hash. Critical audit covers auth, role/tenant changes, secret connection/revocation, approvals, context authority/locks, external writes, exports/deletions, and break-glass access.

## Media and AI

Media gates include declared/observed type, size/dimensions/duration, malware scan, quarantine, safe filename/key, transcoding sandbox, metadata stripping policy, and retention. AI defenses are described in [AI architecture](AI_ARCHITECTURE_AND_SAFETY.md); model output is untrusted input and never grants authorization.

## Operational gates

Security headers/CSP, dependency and secret scanning, SAST, container/image scan, log redaction, backups, restore drills, incident runbook, retention/export/deletion tests, and independent review are required before production. Task 01 does not claim compliance certification.

## EU/GDPR-first operational defaults

Deploy data in an EU region unless an installation explicitly selects another lawful region. Retain revoked/expired session records for 30 days and audit/security events for 365 days by default. Tenant deletion is an audited state machine with a 30-day recoverable quarantine followed by purge; future backups target 35-day expiry. Policy values remain configurable. Privileged/break-glass access requires MFA, a reason, an audit event, explicit tenant scope, and a maximum 60-minute grant. No sensitive operation may be approved by its requester.

## AI and evidence boundary

External source text is serialized only as delimited untrusted model data. It cannot alter gateway system instructions, request secrets or authorize state changes. The gateway receives only the current tenant/workspace Research or Evidence Pack context. Provider output must pass strict schemas and server-side reference checks. Human decisions, MFA approval, forced RLS, budgets, feature flags and entitlements remain authoritative. OAuth tokens, connector secrets and unrelated tenant history never enter model context.

## Root Owner global authority

Tenant roles never imply global access. The exceptional Platform Owner path
requires an exact `root_owner` membership in the operator's authority tenant,
MFA no older than five minutes and a reason-coded grant of 1–60 minutes. The
grant remains in browser memory only. Global reads return aggregate inventory,
not editorial/media contents, credentials or provider identifiers. Lifecycle
changes require a second Root Owner and revoke target sessions when suspending
or requesting deletion. No impersonation or tenant-session switch exists.

Tenant Setup accepts only a stable package ID, supported locales and a bounded
hex brand accent. Modules, quotas, provider availability and AI quota are
derived by the database function. This prevents a browser from self-granting
capacity or provider capability. Configuration is permitted only while the
target installation is pending and has no tenant membership.

## Installation machine identity

The customer API does not reuse a person session or accept `tenant_id` from a
request. A governed Root Owner may issue a random client only for another active
tenant with an active installation and existing Root Owner. The secret and each
15-minute access token are stored only as SHA-256 digests and are excluded from
inventory, audit and outbox metadata. The sole v1 scope is `control:read`.
PostgreSQL rechecks client/token expiry, revocation and tenant/installation
status on every request and enforces per-client rate windows. Revocation
invalidates all active tokens. No v1 route writes content, connects providers,
publishes, impersonates a user or selects a tenant from caller input.

An own-tenant credential center is available only to exact `root_owner` and
`white_label_owner` memberships with recent MFA; mutations also require CSRF.
It derives the tenant from the person session. Rotation preserves the public
client identifier but replaces the digest and revokes every issued token in the
same transaction. Usage counters aggregate the existing PostgreSQL rate-limit
ledger and expose neither token/secret material nor cross-tenant identifiers.
The external OpenAPI contract advertises only the two accepted read-only v1
paths; credential administration is not a machine scope.

## Customer onboarding authority

Onboarding remains a Platform Owner operation under exact Root Owner, recent
MFA, CSRF and a reason-coded short grant. Readiness is derived server-side from
the target tenant's package, installation, canonical domain, workzones,
membership and invitation rows. Browser-supplied readiness cannot activate a
gate. Issuance is denied until every external prerequisite is active and is
locked per target tenant. Only the token/email digests persist; the recipient
email is never returned in global inventory. Revocation prevents later
consumption. OIDC verified email and MFA remain mandatory, and consumption may
create the first Root Owner only in the invitation's tenant.

## Workzone provisioning authority

Workzones are subdivisions inside one media tenant, never independent customer
boundaries. The API derives tenant and actor from the authenticated session;
only exact Root/White-label Owners with recent MFA may read or mutate the
provisioning center, and mutations additionally require CSRF. Creation locks the
tenant transaction and rechecks the active installation entitlement before the
insert. The runtime role has no direct workspace-insert privilege.

An assignment accepts only a user with an existing membership in the same
tenant. Its responsibility is display/work-allocation metadata and is never
consulted as RBAC, approval or provider authority. People & Roles remains the
only membership/role administration surface. Cross-tenant workspaces and users
fail closed under explicit checks, composite foreign keys and forced RLS; every
accepted mutation emits bounded audit and transactional outbox evidence.

Workboard saved views follow the same tenant boundary but add an owner-user
boundary. The API derives both identities from the session and accepts only a
same-tenant workzone. Forced RLS and governed functions keep each user's names,
stage, search text, assignment scope, focus and sort order private from other
tenant members; direct runtime table writes are absent. Save/delete require
CSRF, enforce a twenty-view limit and
emit audit/outbox evidence. Applying a view only changes the read filter and can
never grant a role, desk access, approval or publication authority.

“My assignments” is derived only by comparing the canonical same-tenant
assignment with the authenticated session user. Overdue and due-soon state use
one server timestamp and absolute `timestamptz` deadlines; clients do not
recalculate authority or queue membership from local time. These operational
flags filter already-readable tenant stories and do not restrict or expand
membership, RBAC, workzone access, approval, scheduling or publication.

The team workload projection aggregates only assignments already present in the
bounded tenant/RLS-scoped Workboard result and exposes whether that result is
complete. It does not infer unseen work. The full tenant member directory,
including zero-load members, is added only for a tenant admin with verified MFA;
all other readers see only assignees already disclosed by their readable
stories. The projection creates no assignment, membership or authorization
state and cannot approve, schedule or publish content.

Editorial handoff is computed only after the Workboard query has applied the
session-derived tenant and PostgreSQL RLS boundary. Its ownership, evidence,
content, review and delivery checks disclose no record beyond the already
readable story. Browser parsing recomputes the checklist and rejects mismatched
state or counts. “Complete”, “pending”, “blocked” and “not applicable” are
read-only guidance, never authorization, approval, acknowledgement, scheduling
or provider execution.

Handoff summary and filtering run only after the same-origin response has
passed the strict Workboard contract. Counts cover only loaded stories and reuse
the server's complete/partial coverage evidence. Filtering cannot request
another tenant, disclose an unseen story, mutate workflow or expand RBAC.
Migration `0027` persists only the accepted selector in the existing personal
saved-view boundary: forced RLS binds tenant and user, the governed function
validates the same-tenant workzone and enum, CSRF protects saves, and audit
metadata records the selector without story/checklist data. Missing legacy
request values default to `all`; unknown values fail in BFF, API and database.

The default Workboard view is also an owner-private preference under the same
forced-RLS relation. Migration `0028` enforces at most one default per
tenant/user with a partial unique index. A governed CSRF-protected function
accepts only an existing view owned by the authenticated actor, serializes
changes, and emits audit/outbox evidence. The same-origin contract resolves a
missing, deleted or stale reference to no default and startup falls back to the
ordinary tenant-scoped Workboard; it never follows a foreign workspace ID.

Rename and duplicate remain inside that same owner-private boundary. Migration
`0029` resolves the source/target only from the session-derived tenant/user,
serializes each operation with the saved-view advisory lock, preserves default
identity during rename and forces duplicates to non-default. PostgreSQL rejects
case-insensitive name conflicts and the twenty-first view; BFF and API accept
only one bounded name field, require CSRF and expose no tenant/user selector.
Both successful actions emit audit and transactional outbox evidence.

The Workzone lifecycle preview reuses the exact owner and recent-MFA boundary,
derives tenant/actor from the session and verifies that the requested workspace
belongs to the active installation. Its security-definer function filters every
count by both tenant and workspace and returns only category totals, never row,
member, provider or foreign-tenant details. It performs no mutation and emits no
audit/outbox event. The browser fetches one preview only when expanded and fails
closed unless all seven categories, totals, workspace binding and unavailable
archive/delete flags validate. A schema-catalog regression test prevents a new
`workspace_id` relation from being silently omitted.
