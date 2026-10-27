# Verification

Source snapshot: `IamRedi/redi-control`, `rws/rc-pilot-v0.1`,
`3816fb4757596a7e5cae7913734dc4d36969ec5d`. Original code/branches, production,
accounts and pilot remain private and untouched. The Windows checkout was clean
and older than this source. Newer unpushed work on another host is not inferred.

This candidate contains the original 44 migrations and 50 original test files, plus two two-case regression suites for the local login form destination.
The source reported 155 unit and 100 integration cases; the exact final local
results and execution environment are recorded in `docs/verification-local.json`.
A file count or historical source claim is not a current passed-test count.

The historical checkpoint `6049d51` had successful CI with 150 unit and 96
integration tests. There were no check runs on the later source commit. This
copy therefore runs its own quality, integration, offline-boundary and browser
gates. Remote CI is configured for this repository and must be read from its
actual result; local passing checks are not labeled remote CI.

Core tenant, RLS, approval, idempotency, audit/outbox and SSRF gates remain.
The frozen work-standard checksum verification remains enabled and byte-identical;
no RWS certification or production readiness follows from that document.

Private operator/history records, initial context PDFs and UI-reference imagery
are omitted. Pilot labels and installation references are neutralized. Two
unit-test-only secret markers were made visibly synthetic; no scanner allowlist
was added. Production source preservation/sanitization is itemized in
[source-snapshot.json](docs/source-snapshot.json).

The review uses a separate native PostgreSQL 17.11 runtime from official PGDG
packages, with private temporary credentials and loopback-only services. This
does not replace the original PostgreSQL or Docker installation. Container build
and production contracts are recorded separately; no production deploy/probe,
Meta reconnect, AI call, provider write or external publication is performed.

Browser screenshots use the real web/API session and stored fictional data.
Seeded role/MFA state is a local fixture. Visible connected/pending status is
not changed into fake live success. See [scope](docs/PUBLIC_SCOPE.md),
[demo](docs/DEMO.md) and [media](docs/MEDIA.md).

## Current candidate results

- Format, TypeScript, ESLint and all workspace builds: passed on Node 22.23.4.
- Unit: **159 passed / 37 files**; integration: **101 passed / 15 files**, on isolated PostgreSQL 17.11.
- Dependency audit: **0 reported vulnerabilities** after bounded updates; see [dependency updates](docs/DEPENDENCY_UPDATES.md).
- Offline guard: fetch, direct TCP and HTTPS attempts rejected (3 checks).
- Real browser: nine authenticated routes and one mobile capture; anonymous dashboard denied (401), consumed token denied in a fresh session (403); no external browser requests.
- Production Compose and tunnel contract checks: passed without starting services.
- Local Docker image builds: not run because the Desktop engine was unavailable; the CI gate is retained.

Browser acceptance exposed a real local-form issue: `form-action 'self'` prevented
Chromium from following the API-to-web redirect across loopback ports. This copy
adds only the configured loopback web origin to the local-demo form policy,
rejects external/non-HTTP destinations, and leaves the bootstrap form's existing
policy unchanged. It does not bypass token, session, tenant, CSRF or role checks.
The source checkout is not edited. The capture runner exercises the real form.

The captured web UI runs in local development mode so the original BFF policy permits loopback HTTP; production builds are verified separately. Local deterministic social adapters satisfy the read-model dependencies, but no provider connection, execution worker or non-authentication write is used. A seeded attachment shape was corrected to `{assetId}` objects and is now checked through the real API and the UI parser in the integration suite.

The Social Studio BFF already returns validated normalized summaries. Its UI decoder incorrectly attempted to decode them as raw API records a second time. The copy reconstructs the expected wire fields before calling the existing strict validators; non-empty round-trip and malformed-field regression tests cover this fix. Browser capture now rejects unavailable-state screens, in addition to requiring successful authenticated reads.

Pending approvals have no decider. The revision read model now serializes that comparison as `false` rather than SQL `NULL`, matching the existing strict boolean contract. The integration regression verifies the complete pending-review response through the UI decoder; approval authority and transitions remain unchanged.

Unit workers are bounded to two to avoid resource-contention timeouts on the local host; existing test timeouts and assertions remain intact. The final full run passes all 159 unit and 101 integration cases.
