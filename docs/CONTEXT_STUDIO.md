> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Context Studio

## Purpose and boundary

Context Studio is the controlled source of truth used to construct AI inputs. It does not replace BusinessSite/PitLaneOne as operational systems of record. It stores normalized, provenance-rich facts and explicit authority decisions. AI has no direct platform-database access; data enters through authorized connectors/tools.

## Information model

Each fact includes tenant/business, context level (Business Core, Platform, Channel), typed field/key, normalized value, source reference and source snapshot hash, extraction method/version, observed/valid/checked timestamps, confidence, freshness rule, state, manual confirmation, lock, authoritative-source decision, superseded version, and audit correlation.

Sources include onboarding form, authorized SaaS/website/social connectors, user-selected documents/media, explicit user feedback, and verified events. Hidden scraping and unauthorized private information are prohibited.

## Ingestion flow

`authorized source → durable snapshot → extract → validate/normalize → deduplicate → detect conflict → human review when policy requires → publish context version`

Ingestion never overwrites a published version in place. Price, offer, identity, locked, and manually confirmed conflicts produce a review item. A user selects or changes the authoritative source with a reason; the decision is versioned and audited.

## States and precedence

- `proposed`: machine/user candidate not yet published.
- `confirmed`: person verified current value.
- `locked`: person prevents automatic replacement.
- `conflicted`: competing current candidates need resolution.
- `stale`: freshness threshold exceeded or source unavailable.
- `retired`: no longer current, retained according to policy.

Locked/confirmed facts outrank automatic candidates but are still visibly marked stale. Freshness varies by type; appointment capacity may be minutes, hours may be daily, and brand tone may be quarterly. Exact defaults require product-owner confirmation and per-source capability data.

## Context Pack

For each task the Context Builder produces an immutable, size-bounded pack containing business identity, target platform/channel, task goal, relevant services/offers/media, applicable rules/prohibitions, recent content to avoid repetition, allowed statistics, fact freshness, and provenance IDs. It excludes unrelated businesses, sensitive operational/customer data, and stale/conflicted facts unless the task explicitly asks for review.

The pack records tenant, business, task type, policy version, context release/version, selected fact IDs/versions, token/size estimate, created/expiry time, and purpose. The AI invocation points to this pack so an evaluator can reproduce what was available.

## UX

Tabs: Overview, Sources, Brand, Services & Offers, Audience, Content Pillars, Channels, Rules, History, Questions. Each offers add/edit/confirm/lock/restore with clear source, age, confidence, state, and “why used” detail. Accessibility and editing clarity take priority over decorative effects.

## Sync and lifecycle

Use verified webhooks for immediate changes, scheduled sync where webhooks do not exist, and manual refresh. Source disconnect marks affected facts and stops refresh; it does not silently delete history. Export covers current values, versions, sources, and decisions in documented formats. Deletion is a tracked workflow across context, snapshots, search/vector indexes if later used, media derivatives, caches, and backups according to approved retention/legal policy.

## Required tests

Cross-tenant negative cases; provenance completeness; deterministic normalization/deduplication; confirmed/locked precedence; stale calculation; conflict creation/resolution; immutable versions/restore; minimal pack selection; sensitive-field exclusion; export/deletion propagation; and audit of every authority-changing action.
