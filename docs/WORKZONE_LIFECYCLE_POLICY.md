> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Workzone lifecycle policy

**Status:** All seven decisions accepted by the owner and Archive/Restore
implemented locally, 2026-08-30. Permanent delete remains unauthorized.

## Purpose

This policy defines the safety contract that must be accepted before REDI
CONTROL can add a Workzone lifecycle mutation. It builds on the read-only
impact preview from migration `0030_workzone_lifecycle_impact.sql` and preserves
the rule that a Workzone is an operational subdivision inside one media tenant,
not a security or customer boundary.

## Implemented state

- `business_workspaces` carries constrained `active|archived` state, a monotonic
  lifecycle version and archive actor/reason/time evidence.
- The operational schema has 41 dependency relations with `workspace_id`. The
  separate append-only lifecycle ledger also carries `workspace_id` but is
  deliberately excluded from its own recursive impact inventory.
- There are 23 direct foreign keys to `business_workspaces`; all use `NO ACTION`
  and none uses `CASCADE`. PostgreSQL therefore blocks an unplanned physical
  Workzone deletion while direct references remain.
- Personal saved views may point to a Workzone and one may be the user's default.
  The strict browser contract currently requires every saved-view Workzone to
  appear in the returned Workzone list.
- Workzone provisioning counts every existing Workzone against the installation
  entitlement. There is no separate active/archive quota.
- Migration `0031_workzone_archive_restore.sql` is implemented and accepted on
  disposable PostgreSQL only. Production remains unchanged pending a separate
  rollout authorization.

## Non-negotiable invariants

1. Tenant, actor and installation authority come from the authenticated server
   context. A browser-supplied tenant is never accepted.
2. Archive is reversible operational state, not deletion. It never removes
   content, evidence, media, assignments, views, audit or provider records.
3. Archive and restore require an exact own-tenant Root/White-label Owner,
   recent MFA, CSRF, a bounded reason and transactional audit/outbox evidence.
4. Archived Workzones cannot accept new editorial, upload, AI, scheduling,
   publication, connection or assignment writes. This must be enforced in
   services/workers, not only hidden in the UI.
5. Archive never calls a live provider and never claims to disconnect an
   external account. Stored connections remain evidence but execution is denied.
6. A lifecycle request is serialized under tenant/workspace locks, idempotent
   under a client request key and revalidates every blocker inside its final
   transaction.
7. The last active Workzone of an active installation cannot be archived.
8. Physical delete remains unavailable until its separate quarantine, legal,
   backup-expiry and two-person authorization policy is accepted and tested.

## Accepted archive and restore contract

The following baseline is accepted and implemented locally:

| Area                         | Proposed archive behavior                                                                                                                                     | Proposed restore behavior                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| State                        | `active -> archived`, recording actor, reason and absolute timestamp                                                                                          | `archived -> active`, recording actor, reason and absolute timestamp                        |
| Entitlement                  | Archived Workzones continue to count toward the package limit; archive cannot bypass commercial capacity                                                      | Restore does not alter quota consumption                                                    |
| Content, research and media  | Preserve every row and immutable provenance edge; omit from normal active operational queues                                                                  | Return preserved records to normal active projections                                       |
| Team assignments             | Preserve but exclude from active workload/assignment selectors                                                                                                | Reactivate the preserved operational assignments                                            |
| Personal saved views         | Preserve rows; clear any default pointing to the archived Workzone; expose them as unavailable instead of deleting them                                       | Make preserved views selectable again; never silently restore an old default                |
| Connections/accounts         | Preserve local records and secrets; deny new OAuth, connection and delivery actions; do not call providers                                                    | Re-enable only local eligibility checks; live provider health must still pass independently |
| Scheduled/in-flight delivery | Block archive while a target is scheduled, queued or publishing, while an upload/OAuth transaction is active, or while a lifecycle request is already pending | No automatic replay; operators review stale/failed work explicitly                          |
| Read access                  | Hide from default active Workzone selectors; expose through a clearly labelled read-only archive view to already-authorized tenant members                    | Return to ordinary tenant-readable selectors                                                |
| Slug/identity                | Preserve ID, slug and installation ownership; prevent slug reuse                                                                                              | Restore the same identity                                                                   |

### Saved-view compatibility

Archive must not delete another user's private preference merely to make a
contract pass. Before archive exists, the Workboard snapshot needs a versioned
availability field for Workzones/saved views. Startup must ignore an unavailable
default and use the ordinary active fallback. The archive transaction may clear
`is_default` for affected views without reading or exposing their names/users to
the owner. Restore does not reassign a default because the user's later intent
cannot be inferred.

### Lifecycle evidence

The implementation should use an append-only lifecycle event/request relation
alongside current state, not only mutable columns. At minimum it records:

- event/request ID, version, tenant, installation and Workzone;
- requested action, bounded reason and idempotency key digest;
- requester and executor identity;
- requested, executed or refused timestamp and state;
- lifecycle-impact schema/policy version plus blocking category counts;
- correlation and causation IDs;
- safe refusal code, never raw provider or database errors.

One accepted transition writes the current Workzone state, lifecycle evidence,
audit event and transactional outbox event atomically. Replays return the same
result and conflicting keys fail closed.

## Permanent delete remains out of scope

No hard-delete SQL, API route, button, job or cascade should be added in the
archive slice. A later deletion design must separately decide:

- who may request and who independently executes deletion;
- a default 30-day recoverable quarantine and how restore works;
- legal hold, export and customer notification requirements;
- ordered deletion across content, evidence, media objects, provider secrets,
  idempotency records, jobs, preferences and derived artifacts;
- immutable audit/security evidence retained for the accepted 365-day policy;
- object-storage purge verification and provider-side data limitations;
- PostgreSQL backup expiry, currently targeted at 35 days after purge;
- partial-failure retry, reconciliation and proof of completion.

The existing `NO ACTION` foreign keys stay unchanged until that complete purge
workflow has independent integration and restore evidence.

## Owner decisions accepted on 2026-08-30

- [x] Archived Workzones continue to count toward package capacity.
- [x] Indefinite preservation until a separate delete policy is approved.
- [x] Preserve saved views, clear affected defaults and never
      silently restoring a previous default.
- [x] Block archive while delivery/upload/OAuth work is active.
- [x] Preserve provider records without making an external disconnect
      call.
- [x] One-owner archive/restore with recent MFA and reason; permanent
      deletion remains a separate two-person/quarantine process.
- [x] At least one active Workzone must remain per active installation.

These decisions authorize only the reversible Archive/Restore slice. They do
not authorize permanent deletion, external provider calls or production rollout.
