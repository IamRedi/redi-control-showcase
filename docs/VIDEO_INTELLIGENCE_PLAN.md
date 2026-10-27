> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Video Intelligence plan

## Product boundary

Video Intelligence is one bounded REDI CONTROL workspace for planning governed
videos. It is not part of Social Composer, Model Studio, Meta connection setup
or provider billing. Those systems remain separate and are joined only through
versioned contracts.

The local foundation has no provider key, external model execution, comments or
message ingestion, executable render job, paid credit use, automatic
publication or live account mutation. It may persist a blocked provider-neutral
render preparation without granting execution authority.

## Two programs, not one generic generator

| Program          | Input boundary                                               | Cadence       | Intended result                                   |
| ---------------- | ------------------------------------------------------------ | ------------- | ------------------------------------------------- |
| Weekly FAQ Ads   | Aggregated audience questions plus verified product facts    | Weekly        | One explanatory product-video brief               |
| Daily News Flash | Newsroom stories that have already passed editorial approval | Daily evening | One bounded anchor script for the day's headlines |

Private message text is not a default model input. A future audience listener
must minimize and redact personal data, retain provider/source provenance and
store aggregate topic evidence separately from individual conversations.

## One explicit pipeline

```text
Signals -> Topic brief -> Script -> Render -> Human review -> Distribution
```

- **Signals** observes approved editorial content or permitted, minimized
  audience feedback. It does not create a publishable claim.
- **Topic brief** records why the topic was selected and the facts that may be
  used.
- **Script** is an immutable editorial revision with provenance.
- **Render** begins with an immutable preparation bound to the exact approved
  script, language, duration, rights evidence and formats. The asynchronous
  provider job remains absent until an adapter, secret, budget and data policy
  pass separate acceptance.
- **Human review** approves the exact rendered asset and script revision.
- **Distribution** reuses existing Website/Social targets, scheduling,
  idempotency, publication attempts and reconciliation. It is not duplicated
  inside Video Intelligence.

No stage grants authority to the next stage. A successful render is not
publication approval.

## SaaS and package separation

The planning workspace belongs to the existing `media_intelligence` module and
is available only when that module is entitled and enabled for the tenant.
Provider-backed generation is a separate installation add-on with its own
monthly budget/usage policy; connecting HeyGen is a separate provider
acceptance. Buying a package or add-on never connects an account automatically.

| Layer                   | Owner                                          | Foundation state   |
| ----------------------- | ---------------------------------------------- | ------------------ |
| Media package           | Server-defined SaaS entitlement                | Read-only planning |
| Video-generation add-on | Installation quota and billing policy          | Not configured     |
| HeyGen provider         | Secret reference, model and webhook acceptance | Not connected      |
| Audience listener       | Meta permissions and privacy acceptance        | Not connected      |
| Website/social delivery | Existing approval and publication contracts    | Not connected here |

The UI must always display these layers independently. It must not present an
included planning screen as paid generation capacity or a provider connection.

## Provider adapter requirements

A future HeyGen adapter must live behind the AI/connector boundary and include:

- API v3 request/response schemas, idempotency and bounded retries;
- server-only API-key resolution through the accepted secret provider;
- explicit tenant/workspace/program, script revision and correlation IDs;
- duration, aspect-ratio, concurrency and monetary budget checks before calls;
- signed webhook verification, replay protection and safe failure mapping;
- immediate transfer of completed output to private object storage because
  provider download URLs are temporary;
- rights/consent evidence for avatar, voice and supplied media;
- immutable provider/model/prompt/template provenance without exposing provider
  IDs, secrets or raw errors to the browser.

Official HeyGen references rechecked 2026-08-31:

- <https://developers.heygen.com/generate-avatar-video>
- <https://developers.heygen.com/reference/create-video-agent-session>
- <https://developers.heygen.com/docs/webhook-events>
- <https://developers.heygen.com/docs/pricing>

## Audience and distribution gates

Comment/message collection requires a real Meta app, the exact accepted login
model, Professional/Page assets, reviewed permissions, signed webhooks,
retention/deletion policy and live test evidence. Paid ad campaign management
is not Video Intelligence; it requires a separate Meta Marketing API scope,
budget and approval contract.

Official Meta references rechecked 2026-08-31:

- <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api>
- <https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api>

Autonomous publishing remains prohibited. A future scheduling mode may prepare
and render automatically, but distribution continues to require approval of the
exact asset until a separate policy decision and acceptance suite change this
boundary.

## Delivery sequence

1. **Foundation:** read-only catalog, package/add-on/provider truth and the two
   separate programs. Implemented locally in `68d9fc9`.
2. **Governed briefs:** persisted ordered topic evidence, immutable scripts,
   idempotent commands and independent exact-revision approval, without
   provider execution. Implemented locally after `68d9fc9`.
3. **Blocked render preparation:** immutable language, duration, rights and
   output-format specification bound to the exact approved revision. It remains
   `provider_not_accepted` and creates no job or paid call. Implemented locally
   in migration 0033.
4. **HeyGen sandbox:** the fixed-origin v3 request/response adapter contract is
   implemented locally and remains execution-disabled. Migration 0034 plus the
   unwired reservation service now provide one internal lifecycle per output,
   atomic UTC credit/concurrency enforcement and immutable accounting evidence.
   Migration 0035 adds bounded claim leases, retry exhaustion and exact
   reserved-to-submitting-to-submitted transitions; an MFA/CSRF tenant-admin
   panel configures and reports the internal policy. The state machine is not
   registered in the worker. Migration 0036 and the refusal-by-default
   completion service require a same-tenant ready Media Library MP4 with exact
   aspect/duration checks before reconciling credits and marking success.
   Migration 0037 adds exact-job/asset/script-hash human review with private
   Media Library preview, MFA/CSRF, independent approval and immutable evidence;
   approval still grants no publication authority. Migration 0038 adds one
   immutable exact-asset-to-Social-draft handoff for selected existing
   same-workzone accounts. Migration 0039 adds an independent exact-asset to
   Unified Content draft handoff. Migration 0040 then provides a local Website
   composer with immutable exact copy/media revisions. Migration 0041 adds the
   independent exact-revision Website review and bounded pending queue. None of
   these results creates a Website variant, connector call, schedule, queue job
   or publication. Provider submission,
   webhooks or polling and the actual streamed S3 transfer remain pending
   separate acceptance.
5. **Audience listener:** minimized comment/message signals after Meta privacy
   and permission acceptance.
6. **Distribution acceptance:** Social and Website-content preparation
   boundaries are local. Unified Content now provides a local revisioned
   Website composer, exact-revision human review and read-only destination preflight; exact approved MP4
   remains blocked because the accepted Website connector has no video-delivery
   contract. Destination transfer, scheduling, publishing and reconciliation
   remain pending.

Each slice receives its own tests and owner authorization. BusinessSite is not
a dependency for the first four slices.

See `docs/HEYGEN_V3_SANDBOX_ADAPTER.md` for the implemented boundary and its
remaining fail-closed gates.

### Governed brief rules

- Weekly FAQ Ads require at least one aggregated audience signal and one
  verified product fact. Raw comment/message bodies are not accepted evidence.
- Daily News Flash requires approved editorial-story evidence and rejects
  audience-signal or product-fact substitution.
- Script editing appends a revision; a revision under review or with an active/
  successful render reservation cannot be edited.
- Review binds the current revision hash. A different MFA-verified approver
  must approve or reject it, and rejection requires a bounded reason.
- Render review separately binds the exact successful job, verified Media
  Library asset and approved script hash. The render requester cannot decide;
  approval does not authorize distribution.
- Social draft preparation requires that exact asset approval and creates no
  downstream approval, schedule, publication job or provider attempt.
- Every mutation is CSRF-protected, idempotent, audited and outboxed in the same
  transaction. Approval still leaves Render and Distribution blocked.
