# Reproduce the isolated application

Use Node.js 22.22.1+ and Docker Compose with PostgreSQL 17. `npm ci` installs
the pinned workspace dependencies. `npm run build` builds the original workspaces.
`npm run demo:start` starts the separately named `redi-control-showcase-demo`
stack with temporary data and loopback-only bindings. It never reuses the
original installation, database, accounts or credentials.

Web: `http://127.0.0.1:8787/sq/showcase`. Local login:
`http://127.0.0.1:8788/auth/local-demo`. The one-time token stays in ignored
`tmp/local-demo-token`; do not log it, commit it, put it into URLs or include
the login form in captures. The local fixture binds Aurora Media to ordinary
session, tenant, CSRF and role handling. Seeded MFA state is not real MFA proof.

The source harness was adapted to load `scripts/showcase-offline.mjs`, omit the
ingestion worker, use separate ports/project names and keep all real providers
unconfigured. News Intake/RSS external requests remain blocked. Publishing,
Meta reconnect, comments, messages, HeyGen and website transfers are not enabled.

`npm run showcase:offline-check` verifies blocked fetch/TCP/HTTPS attempts.
`npm run test:showcase` is the managed CI browser test: it requires an explicitly
disposable loopback `rc_showcase_tests` database, creates a separate fresh
`rc_showcase_demo` database, starts the built application and checks/captures the
actual routes with a fresh browser context. It refuses a pre-existing demo DB.
No owner browser/profile is used. Captures go to ignored `tmp/showcase-captures`.

For this review, PostgreSQL 17.11 was extracted from the official PGDG Ubuntu
package into an isolated directory because Docker Desktop did not respond.
No system package, existing PostgreSQL service or original runtime was changed.
This equivalent native local environment and its exact package checksum are
recorded in the verification evidence. Docker container execution is reported
separately rather than inferred from native PostgreSQL success.
