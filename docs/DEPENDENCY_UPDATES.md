# Evaluation dependency maintenance

The source snapshot's dependency audit reported issues in direct dependencies
and their transitive dependencies. This copy updates the affected direct pins:

| Package | Source        | Evaluation copy |
| ------- | ------------- | --------------- |
| Next.js | 16.3.1        | 16.4.3          |
| Fastify | 5.12.3        | 5.12.7          |
| Zod     | 4.3.6 / 4.4.3 | 4.6.7           |
| Vitest  | 3.2.7         | 5.0.5           |

The lockfile also refreshes patched transitive dependencies. No advisory is
allowlisted or suppressed, and no `audit-level` filter is used. `npm audit`
reported zero vulnerabilities at verification time. This is a dated observation,
not a promise about future advisories. The original source repository is untouched.

Relevant primary reports include [Tinypool](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)
and [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
All unit/integration tests, types, lint and workspace builds were rerun after
these updates, including the major test-runner update. No assertion was removed.
