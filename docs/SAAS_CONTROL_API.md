> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# REDI CONTROL SaaS Control API

## Current implemented control plane

REDI CONTROL is one multi-tenant SaaS control plane, not one code fork or
service per media. The Platform Owner dashboard and API use the same governed
application service, PostgreSQL RLS, audit/outbox and server-defined package
catalog.

Current operator routes:

- `POST /api/platform-owner/access` — recent-MFA, reason-coded 1–60 minute
  platform grant;
- `GET /api/platform-owner/tenants` — aggregate tenant/setup/lifecycle inventory
  plus the safe package catalog;
- `POST /api/platform-owner/tenants` — pending tenant/installation/workzone shell;
- `PUT /api/platform-owner/tenants/:tenantId/setup` — Media Starter, Team or
  Network configuration with locale, brand accent, modules and server-owned
  limits;
- `POST /api/platform-owner/tenants/:tenantId/api-clients` — issue one
  installation-bound read-only machine credential and return its secret once;
- `DELETE /api/platform-owner/api-clients/:clientId` — revoke the client and
  every still-valid token immediately;
- lifecycle request/execute routes — independent two-person suspend,
  reactivate and pending-deletion control.

Every mutation requires the authenticated Root Owner session, current CSRF and
the short platform grant. The API derives operator/authority tenant from the
session. It does not accept browser-supplied authority, impersonate a customer
or return provider secrets.

## Package behavior

Package identifiers are stable policy inputs; the server owns their modules and
limits. Browser payloads cannot invent quotas or enable providers. Setup keeps
the installation pending and provider availability empty. Owner onboarding,
domain verification and provider acceptance remain independent activation
gates.

| Package       | Users | Workzones | Social accounts | Monthly publications | Storage |
| ------------- | ----: | --------: | --------------: | -------------------: | ------: |
| Media Starter |     5 |         1 |               5 |                  250 |   25 GB |
| Media Team    |    15 |         2 |              15 |                2,000 |  100 GB |
| Media Network |    50 |         5 |              50 |               10,000 |  500 GB |

Team/Network expose the governed Context/AI surfaces but set external provider
availability and runtime AI quota to zero. A configured package is therefore
not a live connector or model activation.

Video Intelligence is bounded by the existing `media_intelligence` module. Its
governed brief workflow permits tenant-derived editorial writes and independent
MFA approval, while package configuration remains server-owned. Video
generation is a separate installation add-on and provider acceptance, so no
package silently includes HeyGen credits, API access or automatic publishing.
An approved rendered video may be prepared as an ordinary tenant-scoped Social
Control draft and, independently, as an ordinary Unified Content draft. These
browser-session workflows are not part of the external customer machine API.
The latter creates no Website variant or connector call; neither grants review,
scheduling or publication authority.

The panel reports package, add-on and provider states independently.
An entitled editor may persist an immutable blocked render preparation for an
approved script, but this creates no provider job and consumes no paid quota.
An internal, unwired reservation boundary can enforce an explicitly configured
workzone credit/concurrency policy and create one lifecycle per output. An
MFA-verified tenant administrator can configure that policy through the browser
session API and see UTC reserved usage; this is not a provider connection or a
customer machine API. Policy creation remains explicit and disabled by default.
The lease-safe internal state machine is also unwired and refusal-by-default;
reserved credits remain conservative accounting, not evidence of a HeyGen
charge or request.
The local completion boundary remains outside both browser and customer APIs.
It may mark success only after a provider-generated MP4 is already a verified,
ready same-workzone Media Library asset; it then reconciles credits and records
the durable asset usage. No package or policy setting can bypass this boundary.
The external customer machine API remains read-only and does not expose this
tenant mutation.
The browser-session Video Studio may review only the exact verified output. Its
decision requires tenant-derived `content:approve`, recent MFA and CSRF, and
uses a short-lived private Media Library preview. This human decision is not a
customer machine API capability and never becomes publication authority.

## External customer machine API — read-only v1

The first external contract is implemented locally without sharing a browser
session or global API key:

1. A Root Owner uses the governed console to issue a client only for an active
   installation that already has a Root Owner. The plaintext secret is returned
   once; PostgreSQL stores only its SHA-256 digest.
2. The client sends HTTP Basic credentials to `POST /api/v1/oauth/token` with
   form fields `grant_type=client_credentials` and `scope=control:read`.
3. The response is an opaque Bearer token valid for at most 15 minutes. Only its
   digest is stored.
4. `GET /api/v1/control/summary` returns safe installation name/status, plan,
   enabled modules, limits, workzone names and explicit capability flags. The
   tenant and installation are derived exclusively from the token.

Token exchange is limited to 10 successful exchanges per client per minute;
read requests are limited to 60 per client per minute in PostgreSQL, in addition
to the API's IP limits. Revoking a client invalidates its tokens. Suspended
tenants/installations and expired clients/tokens fail closed. Inventory, audit
and outbox never contain the plaintext secret or access token.

This v1 slice has no write, content, social, provider-connection, publishing,
impersonation or BusinessSite route. A future write API requires separately
accepted scopes, request idempotency, resource-level authorization, replay and
audit tests. Calling the token path OAuth-like client credentials does not claim
general OAuth authorization-server conformance.

## Customer credential center

An authenticated customer `root_owner` or `white_label_owner` can manage only
the API clients belonging to their own session tenant at
`/{locale}/settings/api`. Reads require recent MFA; issue, rotate and revoke
also require CSRF. The server derives the tenant from the session and never
accepts it from the browser payload.

- `GET /api/installation-api/clients` returns safe client metadata and bounded
  24-hour/30-day request and exchange counters;
- `POST /api/installation-api/clients` issues a client for the tenant's active
  installation and reveals the secret once;
- `POST /api/installation-api/clients/:clientId/rotate` preserves the client ID,
  replaces its secret digest and atomically revokes all existing access tokens;
- `DELETE /api/installation-api/clients/:clientId` revokes the client and all
  active tokens;
- `GET /api/v1/openapi.json` publishes the exact read-only external contract.

Usage is calculated from the existing PostgreSQL rate-limit ledger; it is not a
billing ledger and does not require an external analytics service. No secret,
token digest, provider identifier or raw failure is returned. The OpenAPI
document deliberately contains only token exchange and control summary; admin
credential routes remain person-session operations and are not advertised as
customer machine capabilities.

## Customer onboarding center

The Platform Owner inventory now includes a safe readiness projection per
customer tenant: SaaS package, installation, canonical domain, workzone count,
Root Owner presence and first-owner invitation status. It returns blocker codes
but no recipient email, invitation hash or token.

An invitation can be issued only when the target tenant, configured package,
installation and canonical domain are active and that tenant has neither a Root
Owner nor another live invitation. The random token is returned once; only its
SHA-256 digest and normalized-email digest are stored. Revocation is immediate,
and successful consumption still requires the matching verified OIDC email and
MFA. Root Owner uniqueness and the active-invitation lock are per tenant, which
supports the SaaS model without allowing one media to affect another.

The center does not register or activate a domain, send email, provision an
identity-provider account, connect a provider, impersonate the customer or
activate production. Token delivery remains an explicit out-of-band operator
step.
