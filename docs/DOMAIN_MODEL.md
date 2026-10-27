> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Domain model

## Hierarchy and tenancy

- **Installation:** one white-label deployment/configuration. It may host multiple tenants.
- **Tenant:** the primary security, billing/quotas, retention, encryption, and audit boundary.
- **Business:** an operating brand inside a tenant. A tenant may manage multiple businesses.
- **Membership:** a user-to-tenant role assignment. Business-level grants may be introduced only if a real need is approved.
- **Platform connection:** tenant/business-scoped authorization for a Connector definition and remote account.

Every business belongs to exactly one tenant. A user sees a tenant only through active membership, except the break-glass Root Owner path, which is separately audited and time-bound.

## Core aggregates

| Aggregate            | Owns                                        | Key invariants                                                            |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Tenant               | identity, status, policy references         | no tenant-owned operation without effective tenant                        |
| Membership           | role grants                                 | grant/revoke is audited; cannot remove the last authorized owner silently |
| Connector definition | manifest/version/capabilities               | immutable published manifest version                                      |
| Platform connection  | remote account ref, granted scopes, health  | secrets stored by reference; capability cannot exceed verified scopes     |
| Context source       | authorized origin and sync state            | provenance preserved; disconnect does not erase history silently          |
| Context fact         | normalized value, confidence/freshness/lock | confirmed/locked values are not overwritten automatically                 |
| Context version      | published fact snapshot                     | immutable and reproducible                                                |
| Approval request     | action, risk, reviewer policy, outcome      | execution payload hash must match approved payload hash                   |
| Job                  | operation, tenant, status, attempts         | idempotency key unique within operation scope                             |
| Audit event          | actor/action/target/result                  | append-only at application boundary                                       |

Later aggregates are Website Proposal/Release, Media Asset, Social Publication, AI Invocation, Automation Definition/Execution, and Usage Ledger.

## Context vocabulary

- Business Core Context: shared identity, services, products, prices, areas, hours, contact, languages, audiences, tone, rules, objectives.
- Platform Context: platform-specific offers, appointments/capacity, enabled capabilities, notices, and operational events.
- Channel Context: format, length, cadence, audience, topic, CTA, and channel restrictions.
- Context Pack: small immutable task snapshot containing only relevant approved facts/rules/media/history/statistics and freshness metadata.

Fact states are `proposed`, `confirmed`, `locked`, `conflicted`, `stale`, and `retired`. Manual confirmation outranks automatic extraction; a lock prevents automated replacement. Conflicting authoritative candidates create a review item rather than an automatic winner.

## Approval risk levels

- L0: read-only observation; no approval after authorization.
- L1: reversible draft/internal suggestion; policy may auto-allow.
- L2: external but bounded/reversible action; explicit approver by default.
- L3: bulk, destructive, financial, identity/price-critical, or hard-to-reverse action; high-level approval and stronger confirmation. Autonomous execution is prohibited.

Exact action-to-level mappings are Milestone-specific policy data, not hard-coded connector behavior.

## BusinessSite bounded context

Known product concepts: personalized multilingual site, business identity, services/products/prices/offers, gallery, hours/location/contacts/social links, publication privacy, domain, and booking requests with service/date/time/contact/note and confirm/change/reject lifecycle. API representation is unknown and must not be inferred from the marketing context.

## PitLaneOne bounded context

Known concepts: customers, vehicles/service history, work orders/labor/materials, invoices/payment states, inventory/movements/barcodes, counter sales, appointments/calendar, staff/roles, daily reports, and public business site. Fiscal certification, German cash-register compliance, GoBD, and automated WhatsApp are not verified capabilities.
