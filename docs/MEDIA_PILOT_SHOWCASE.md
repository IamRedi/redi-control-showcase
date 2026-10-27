> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Media Pilot Showcase

## Purpose

`/{locale}/showcase` is the authenticated presentation surface for a media
pilot such as Aurora Media. It reads the same tenant-safe dashboard overview as
the operational home page. It does not seed sample metrics, create a provider
connection, expose a credential or trigger publication.

The screen demonstrates four product facts:

1. one isolated Workzone carries the media's sources, content, assets, people
   and channel state;
2. the governed flow is Research → Create → Adapt → Review → Distribute;
3. Website, Facebook and Instagram editorial readiness is separate from the
   external account connection state;
4. the same domain model can be packaged as a multi-tenant SaaS without a code
   fork per media customer.

For a presentation before any real provider is accepted, run the isolated
synthetic harness described in `docs/LOCAL_MANUAL_TESTING.md`. It supplies a
real authenticated tenant/Workzone workflow in disposable local data while
keeping every external connection and publication adapter disabled.

## Suggested seven-minute presentation

1. Open **Pilot showcase** and identify the current Workzone. Explain that the
   four counters come from verified stored state, not a sales-demo dataset.
2. Walk through the five-step editorial pipeline and the human approval rule.
3. Open **Newsroom** to show source/evidence collection and then **Content
   Studio** to show one story with independent destinations.
4. Show the local Website draft, lazy preview and exact-revision approval.
5. Open **Social Control** to show Composer, revision comparison, approval,
   timezone-safe Calendar and provider preflight.
6. Return to the Showcase channel cards. A disconnected status means exactly
   that; the professional workflow may be ready while external OAuth remains
   gated.
7. Close with the SaaS model: one tenant per independent media, owner-controlled
   roles, server-owned packages and bounded customer API access.

## First real connection options

No real external connection is created by this checkpoint.

### Website

This is the shortest code path because the versioned BusinessSite Information
connector already exists. It must wait for the independent BusinessSite work to
reach a clean compatible checkpoint and then pass the explicit staging
connector acceptance. REDI CONTROL must never access its database directly.

### Instagram Login

This is the smallest independent social pilot when the target is an Instagram
Professional account and Facebook Page control is not required. Meta's current
official Instagram collection says this login model does not require a linked
Facebook Page. The initial publishing path requires a Meta App, OAuth, the
`instagram_business_basic` and `instagram_business_content_publish` scopes and
publicly reachable media at publishing time.

### Facebook Login for Facebook plus Instagram

This offers the stronger combined demonstration when Aurora Media already has a
Facebook Page linked to an Instagram Professional account. It adds Page asset
discovery and a broader reviewed permission set, so it is not the smallest
first acceptance.

Before either Meta path starts, the owner must identify the test Professional
account/Page and create or select the Meta test app outside Git and chat. Tokens
remain only behind the production secret-provider boundary. The first
acceptance uses test assets and manual human approval; autonomous publication
remains prohibited.

## Provider verification

Rechecked 2026-09-01 against Meta's official Instagram API Postman workspace:

- <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api>
- <https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login>
- <https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login>
- <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672>

Exact Graph version, redirect, scopes, access level and App Review evidence must
be revalidated in the owner-controlled Meta dashboard immediately before the
adapter and live acceptance are authorized.
