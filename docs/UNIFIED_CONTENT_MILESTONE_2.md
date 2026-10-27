> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Unified Content Milestone 2

## Scope and boundary

Milestone 2 introduces one tenant-scoped `Content Item` for a story or campaign and independent `website`, `facebook`, and `instagram` destination variants. The later local Website composer extension prepares exact revisioned copy without creating a destination variant. It does not introduce research, AI, monitoring, autonomous publishing, WordPress, or a customer Lite experience.

## Domain model

- `content_items` is the shared editorial identity. It belongs to exactly one existing installation workspace/brand and contains a title, shared summary, lifecycle state, and optimistic version.
- `content_item_media` is an ordered association to existing, ready, non-deleted Media Library assets in the same tenant and workspace. `media_usage_references` prevents deletion while an asset is attached.
- `content_item_variants` is a link, not a second publishing workflow. V1 allows at most one variant for each destination on a Content Item.
- `content_website_drafts` is one local Website preparation head per Content Item. Its `content_website_draft_revisions` and ordered `content_website_draft_media` snapshots are immutable and remain independent from destination variants and BusinessSite.
- `content_website_draft_reviews` binds one governed human decision to one immutable Website revision ID and content hash. A later revision has no inherited review.
- A Facebook or Instagram variant links to exactly one existing `social_drafts` row and one matching existing `social_accounts` row. Its immutable content revisions, approvals, target state, publication attempts, scheduling, provider error and external publication ID remain authoritative in the existing social tables.
- A website variant links to one active `businesssite-information` Platform Registry connection. BusinessSite remains the article source of truth. The local variant records the remote article ID, remote revision and last safe status returned by the strict Website Control connector.

There is deliberately no `content_item_approvals`, scheduling table, publication-attempt table, or credential model. Shared editorial intent does not make approval transferable between destinations: social approval remains bound to the immutable social revision, and BusinessSite approval remains bound to the BusinessSite article/version. Destination publication state remains independent.

## API

- `GET /api/content-items` lists at most 50 tenant-owned items, optionally filtered by workspace.
- `GET /api/content-items/:itemId` reads one item with ordered media and derived destination state.
- `GET /api/content-items/:itemId/website-preflight` performs a read-only
  Website readiness check for the session tenant. It creates no variant, calls
  no connector and authorizes no publication.
- `GET /api/content-items/:itemId/website-draft` reads the local Website draft
  and its current exact revision.
- `POST /api/content-items/:itemId/website-draft` creates the first local
  revision; `POST /api/content-items/:itemId/website-draft/revisions` appends a
  revision using optimistic current-revision matching.
- `GET /api/content-items/website-review-queue` lists at most 50 pending current
  revisions without returning full article bodies. `POST .../review` requests
  review and `POST .../review-decision` approves or rejects the exact revision.
- `POST /api/content-items` creates an item and attaches existing media.
- `PATCH /api/content-items/:itemId` updates shared fields/media using `expectedVersion`.
- `POST /api/content-items/:itemId/variants` creates a website, Facebook, or Instagram variant through the native destination service.
- `PATCH /api/content-items/:itemId/variants/:variantId` creates the next native destination revision using `expectedRevision`.

Mutation routes require `content:edit` and CSRF. Read routes require `platform:read`. Request schemas reject additional properties and bound text/media collections. The operator shell at `/{locale}/content` provides real list/create/inspect behavior without replacing the final composer.

The localized Content shell loads Website preflight only on explicit operator
request. The strict BFF reconstructs the safe response and drops unknown
fields. The projection checks entitlement, existing variant state, eligible
same-workzone connections, copy and attached media. The same shell offers a
local slug/title/excerpt/body composer and snapshots the Content Item's current
ready media into each immutable revision. It reports attached MP4 as
`WEBSITE_VIDEO_DELIVERY_UNAVAILABLE`: the current connector creates articles
and supports its accepted image boundary, but has no accepted video-delivery
contract. Neither the composer nor preflight may bypass this blocker by calling
the existing immediate `articles.create` variant route.

The shell also provides a bounded Review & Approval Queue and a lazy local
Website preview. Review request requires edit authority; decision requires
independent `content:approve`, recent MFA and CSRF. Rejection requires a reason.
Approval is revision-local and returns `publicationAuthorized=false`; a new
revision must be reviewed again.

## Security and availability

All aggregate, link and local Website-draft tables use forced PostgreSQL RLS. Composite foreign keys bind the item, media, social account/draft and website connection to one tenant and workspace. Server-side checks require `module.unified-content`, the `unified_content` installation entitlement and the existing destination module flag/entitlement. The API never accepts arbitrary media URLs or plaintext connector credentials.

Every aggregate mutation emits tenant-scoped audit and transactional outbox evidence. Failed native provisioning leaves a bounded `VARIANT_PROVISION_FAILED` state while successful destination variants remain unchanged. Aggregate `deliveryStatus=partial` is derived when a published destination coexists with an incomplete or failed destination.

## Migration and verification

Migration `0008_unified_content_m2.sql` extends the existing module allowlists and media usage type, adds the three aggregate/link tables, composite ownership constraints, indexes and forced RLS policies. Migration `0040_content_website_drafts.sql` adds the local Website draft head, immutable revisions and immutable media snapshots, active-workzone guards, deletion-blocking usage references and lifecycle accounting. Migration `0041_content_website_draft_reviews.sql` adds exact-hash review binding, governed finalization, forced RLS and lifecycle accounting. No existing social or website data is rewritten.

The real PostgreSQL/API suite covers clean migration, RLS, RBAC, feature/entitlement denial, media ownership, audit evidence, independent Facebook/Instagram native drafts and revisions, read-only Website preflight, exact video blocking, local Website revision/media immutability, Website Control linking and partial success. Live provider publication and a live BusinessSite staging endpoint remain deployment acceptance risks rather than local Milestone 2 claims.
