> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Local manual testing

## Local Aurora Media media workspace

The repository includes an isolated, local-only media demo for authenticated
browser QA and presentations without Meta, BusinessSite, HeyGen or any other
external account.

Start it from the repository root:

```bash
npm run demo:start
```

The command:

- starts a separately named PostgreSQL 17 and object-storage stack bound only
  to loopback;
- keeps both data directories in container `tmpfs`;
- applies the current migrations and seeds one synthetic Aurora Media tenant,
  Workzone, team, Research cases, Content, media, Website review and Social
  review/calendar state;
- starts the API, Web and source-ingestion worker processes locally;
- writes a ten-minute, one-time login token to the ignored mode-`0600` file
  `tmp/local-demo-token` without printing the token.

Open <http://127.0.0.1:3001/auth/local-demo>, paste the token from that local
file and continue to the Albanian Showcase. The resulting session uses the
ordinary PostgreSQL `SessionStore`, CSRF state, tenant membership and audit
path. The token is stored in PostgreSQL only as SHA-256 and is atomically
consumed; replay fails.

After login, open <http://127.0.0.1:3000/sq/research>. Confirm that:

1. **Aurora Media Newsroom — Demo** is selected by name and no raw Workzone or
   Profile ID is requested anywhere.
2. The summary, editorial profiles, source registry and Research cases change
   together with the active Workzone context.
3. **Konfiguro** opens structured identity, section, style, verification,
   destination and visual settings rather than JSON textareas. Saving a profile
   revision remains an admin/recent-MFA action.
4. New sources and cases use profile names from controlled selectors; opening a
   case continues into the provenance and News Intake flow below.

Within an opened Research Case, verify the five visible stages: **Burimet**,
**Pretendimet**, **Provat**, **Analiza dhe drafti editorial**, then
**Kandidatët editorialë**. Attach evidence by choosing the source and claim by
name. The editorial-draft preview is readable without JSON; its approval still
requires the existing independent approver and does not publish anything.

Useful lifecycle commands:

```bash
npm run demo:status
npm run demo:refresh
npm run demo:stop
```

`demo:refresh` invalidates any unused prior token and creates a fresh one.
`demo:stop` stops the three development processes and removes the isolated
containers; PostgreSQL and object bytes disappear with their `tmpfs` mounts.

## Real News Intake acceptance

Open one of the Research cases and use **News Intake**:

1. Paste a public HTTPS article URL under **Një artikull**.
2. The screen polls the bounded PostgreSQL job until the worker reports a final
   state; inspect the source, publisher, retrieval time and excerpt.
3. Select only the relevant results and choose **Bashkëngjit të zgjedhurat**.
4. Confirm the material appears under **Sources & provenance** before creating
   claims or editorial copy.

RSS/Atom uses a registered source rather than a raw database identifier. Add a
source of type `RSS / Atom feed` in Source Registry, choose it in the case,
configure its public HTTPS feed URL and retrieve the latest items. Search is
intentionally shown as unavailable until a real provider with provenance and
cost controls is accepted. Synthetic search results are never presented as
real news.

## Truth boundary

Seeded editorial records are marked synthetic. Manually retrieved public
articles and feeds are real external source material but remain explicitly
untrusted until an editor selects and evaluates them. Facebook and Instagram rows
are deliberately `pending`/not connected. `SOCIAL_PROVIDER_MODE` remains
`unconfigured`; no OAuth, provider adapter, worker publication job, external
request or performance metric is created. Website transfer, HeyGen execution
and live distribution remain fail-closed.

`LOCAL_DEMO_MODE=true` is rejected unless `DEPLOYMENT_ENV=local`, the API binds
to a loopback host and the public API origin is loopback HTTP. The login routes
are not registered at all when the mode is disabled. Staging and production
examples keep it false.

Do not place production credentials in the generated local environment or use
this harness against a persistent/pre-existing database. Integration tests
must continue to use disposable PostgreSQL data because they recreate the
`control` schema.

## Automated acceptance

Repository acceptance remains separate from the browser demo:

```bash
npm run check
npm run test:integration
npm audit
npm run check:production
npm run security:secrets
```

The integration suite verifies disabled-route behavior, hashed token storage,
expiry/single use, normal session creation, role/MFA state, redirect safety and
the audit record with the restricted runtime/auth roles.
