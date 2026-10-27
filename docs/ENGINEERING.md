# A practical engineering tour

| Concern                    | Mechanism                                                                    | Inspect                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tenant isolation           | Actor context, parameterized SQL, transaction-local tenant and forced RLS    | [Data layer](../packages/database/src/index.ts), [migrations](../database/migrations)                         |
| Authorization and identity | Roles, bounded sessions, CSRF, recent MFA and invitation/OIDC contracts      | [Core](../packages/core/src/index.ts), [identity](../packages/identity/src/index.ts)                          |
| Connector boundary         | Versioned manifests, typed envelopes, scopes and replay/idempotency controls | [Connector SDK](../packages/connector-sdk/src/index.ts)                                                       |
| Shared editorial identity  | One Content Item with independent native destination variants                | [Unified Content](../packages/unified-content/src/index.ts)                                                   |
| Approval and publication   | Revision/payload binding, preflight, auditable lifecycle and provider ports  | [Media/social](../packages/media-social/src), [API](../apps/api/src)                                          |
| Source safety              | Bounded ingestion, URL/redirect validation, SSRF defenses and provenance     | [Source ingestion](../packages/source-ingestion/src/index.ts)                                                 |
| Evidence and AI            | Evidence packs, schemas, tenant-filtered context, budgets and governed tools | [Evidence](../packages/evidence-intelligence/src/index.ts), [AI gateway](../packages/ai-gateway/src/index.ts) |
| Video orchestration        | Review, reservations, leases and verified-asset handoff contracts            | [Video](../packages/video-intelligence/src)                                                                   |
| White-label and Workzones  | Configuration, entitlements, team and lifecycle boundaries                   | [Installation](../packages/installation/src/index.ts)                                                         |

Inspect failure paths and integration tests as well as successful UI paths.
The evaluation runtime uses synthetic records with the existing session and
tenant-aware read models. The separate network preload blocks non-loopback
Node connections; its checks cover fetch, direct TCP and HTTPS. The browser
also rejects external requests during acceptance/capture. These are evaluation
controls, not a replacement for a production network policy.
