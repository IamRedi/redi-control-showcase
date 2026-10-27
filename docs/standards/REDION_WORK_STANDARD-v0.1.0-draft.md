# Redion Work Standard

**Version:** 0.1.0-draft  
**Owner:** Redion Cekrezi  
**Created:** 2026-09-04  
**Status:** Draft for owner review; not authorized for repository rollout  
**Applies to:** Software, SaaS, mobile, AI-agent, media-automation, device and hardware-connected repositories owned or maintained by Redion Cekrezi

---

## 1. Purpose

Redion Work Standard (RWS) defines one recognizable, evidence-based way of working across Redion repositories while preserving the needs of each project.

The standard exists to make work:

- understandable by a new agent without relying on chat history;
- safe for repositories under active development;
- traceable from owner intent to deployed result;
- reviewable independently from the implementing agent;
- resumable without guessing;
- proportionate to project risk;
- open to controlled improvement.

RWS standardizes the workflow around the product. It does not force every project to use the same architecture, framework, test tool, hosting provider or release process.

## 2. Normative language

The words below have precise meanings:

- **MUST:** mandatory for conformance.
- **MUST NOT:** prohibited.
- **SHOULD:** expected unless a documented reason justifies an exception.
- **MAY:** optional.

A repository MUST NOT claim RWS conformance if a mandatory rule is knowingly bypassed without an approved exception record.

## 3. Foundational principles

### 3.1 Human authority

Redion Cekrezi is the default Owner unless a repository explicitly records another owner. AI agents assist, analyze, implement and verify; they do not silently expand their own authority.

Only the Owner or a documented delegate may authorize:

- a new implementation task;
- expansion of scope;
- destructive or irreversible actions;
- external mutations;
- production changes;
- acceptance of residual high-risk issues;
- movement to the next task when a required gate has failed.

### 3.2 Evidence over claims

A claim such as “done”, “safe”, “clean”, “tested”, “accepted” or “deployed” MUST identify the evidence that makes it true.

Absence of evidence MUST be reported as **not verified**, not as success or failure.

### 3.3 One bounded task at a time

An executor MUST work on one authorized task at a time. Future tasks, opportunistic refactors and unrelated cleanup are out of scope unless separately authorized.

### 3.4 Preserve live work

Repositories may be used by multiple humans and agents concurrently. Existing tracked or untracked changes MUST be treated as owned, unresolved work unless provenance is proven.

Agents MUST NOT automatically delete, overwrite, stash, restore, normalize, commit or absorb unrelated work.

### 3.5 Fail closed at authority boundaries

When authorization, environment, identity, target, secrets, production state or destructive scope is unclear, the agent MUST stop and report the exact blocker.

### 3.6 Reversible progression

Work SHOULD advance through small, coherent checkpoints. Each checkpoint SHOULD be independently reviewable and safely reversible without rewriting shared history.

### 3.7 Standardized core, project-specific modules

Every repository uses the RWS core. Additional controls are activated only when relevant:

- database and migrations;
- hosted services and providers;
- production operations;
- security/privacy;
- mobile/device;
- hardware/robotics;
- AI/model behavior;
- media generation and publishing.

## 4. Repository identity and attribution

### 4.1 Required repository identity

Every repository adopting RWS MUST state:

- project name;
- product purpose;
- repository owner;
- primary maintainer;
- standard version;
- repository risk profile;
- canonical branch;
- production status, when applicable.

### 4.2 Redion identity

Repositories owned by Redion Cekrezi SHOULD contain a visible repository-level attribution:

> Created and maintained by Redion Cekrezi.

Attribution SHOULD be recorded through the appropriate combination of:

- README ownership section;
- `AUTHORS.md` or equivalent;
- package/project metadata (`author` or `authors`);
- Git commit authorship;
- `CODEOWNERS` for review ownership;
- `LICENSE` and/or `NOTICE` for legal ownership.

### 4.3 Source-file headers

Redion's name MUST NOT be inserted mechanically into every source file.

File-level copyright headers MAY be used only when a repository-level license policy requires them. They MUST NOT:

- overwrite another contributor's authorship;
- claim ownership of third-party code;
- conflict with an existing open-source license;
- imply that `CODEOWNERS` proves authorship;
- be added through a bulk rewrite without owner authorization.

Git authorship records who made a change. Copyright and license records define legal rights. `CODEOWNERS` defines review responsibility. These concepts MUST remain separate.

## 5. Canonical repository control plane

An RWS repository MUST expose a small, predictable control plane. Exact filenames may be adapted once during adoption, but their authority MUST be mapped explicitly.

### 5.1 Required information categories

| Category | Default canonical artifact | Purpose |
|---|---|---|
| Agent rules | `AGENTS.md` | Authority, roles, boundaries, commands and stop rules |
| Repository identity | `README.md` | Product identity, ownership and human entry point |
| Current state | `docs/work/STATUS.md` | Accepted snapshot, active task, blockers and next eligibility |
| Task ledger | `docs/work/TASKS.yaml` | Machine-readable task lifecycle and evidence links |
| Plans | `docs/work/PLAN.md` | Approved phases, dependencies and non-goals |
| Decisions | `docs/decisions/` | ADRs and owner decisions |
| Handoffs | `docs/work/handoffs/` | Point-in-time transfer of work |
| Evidence | `docs/work/evidence/` | Verification and acceptance records |
| Verification | `docs/VERIFICATION.md` | Commands, CI mapping, prerequisites and evidence meaning |
| Releases | `docs/releases/` | Source/artifact/migration/environment provenance |

Existing repositories do not have to rename strong existing artifacts immediately. Their adoption record MUST instead map each information category to exactly one canonical source.

### 5.2 Document authority registry

Every controlled document MUST be classifiable as one of:

- **canonical:** authoritative for one declared category;
- **derived:** generated or summarized from a canonical source;
- **historical:** retained evidence that no longer governs current work;
- **frozen:** intentionally unchanged baseline;
- **superseded:** replaced by an identified newer artifact.

When documents conflict, the registry decides precedence. A newer timestamp alone MUST NOT override a canonical decision.

### 5.3 Current status rule

Only one artifact may be canonical for current repository status. It MUST contain:

- timestamp and timezone;
- canonical branch and exact HEAD;
- local, remote and deployed revision distinctions;
- tracked, staged and untracked state;
- active task and owner;
- current lifecycle state;
- blockers and unblock conditions;
- next eligible task or an explicit statement that none is verified;
- latest accepted evidence;
- production GO/NO-GO/NOT-APPLICABLE status.

“Tracked files clean” MUST NOT be reported as “worktree clean” when untracked paths exist.

## 6. Roles and separation of duties

### 6.1 Owner

The Owner:

- defines product direction and risk tolerance;
- authorizes tasks and scope changes;
- approves exceptions;
- authorizes external and production actions;
- makes final acceptance decisions when required.

### 6.2 Supervisor

The Supervisor:

- audits the repository before planning;
- resolves canonical sources;
- creates bounded task specifications;
- identifies dependencies, risks, invariants and stop conditions;
- chooses the necessary verification level;
- reviews executor evidence;
- recommends acceptance, correction or rejection;
- MUST NOT silently convert a recommendation into owner authorization.

### 6.3 Executor

The Executor:

- reads the required control-plane documents first;
- repeats its understanding before material work when uncertainty exists;
- implements only the authorized scope;
- preserves unrelated and concurrent work;
- runs only authorized, relevant verification;
- records exact results and unresolved limitations;
- stops after the task handoff;
- MUST NOT start the next task automatically.

### 6.4 Reviewer

The Reviewer:

- is independent from the implementation turn whenever risk justifies it;
- checks scope compliance, behavior, tests, evidence and residual risk;
- attempts to falsify critical acceptance claims;
- returns `PASS`, `PASS WITH ACCEPTED LIMITATIONS`, `FAIL` or `NOT VERIFIABLE`;
- MUST NOT repair discovered defects unless separately authorized as executor.

### 6.5 Operator

The Operator performs environment or provider actions. The role MUST be explicit for:

- production deployments;
- databases and recovery;
- domains and DNS;
- external providers;
- privacy operations;
- hardware/device operations.

Operator authority MUST be limited to an exact target, action class and time or task boundary.

### 6.6 Small-project role combination

One person or model MAY hold multiple roles in a low-risk project, but every handoff MUST state which role produced each claim. Implementation self-report MUST NOT be presented as independent review.

## 7. Task contract

No implementation task is authorized until its contract contains:

1. unique task ID and title;
2. objective and user-visible outcome;
3. authorization owner and timestamp/reference;
4. prerequisites and dependencies;
5. exact scope;
6. explicit non-scope;
7. permitted files/components or boundaries when known;
8. invariants and do-not-change list;
9. risks and safety classification;
10. acceptance criteria;
11. required verification levels;
12. required evidence;
13. stop conditions;
14. commit/push/deploy authority;
15. successor rule.

If material uncertainty prevents a safe contract, the work remains in `planned` or `blocked` state.

## 8. Task lifecycle

### 8.1 Primary lifecycle

`planned → authorized → in_progress → locally_implemented → verified → reviewed → accepted → committed → pushed → ci_verified → deployed`

Not every project requires every state. Skipped states MUST be marked `not_applicable`, never silently omitted when they could affect interpretation.

### 8.2 Alternative states

- `blocked`: cannot proceed until a named condition is met;
- `incomplete`: work stopped before acceptance;
- `failed`: a required gate produced negative evidence;
- `deferred`: intentionally postponed by authority;
- `superseded`: replaced by a named task or decision;
- `cancelled`: explicitly terminated by authority.

### 8.3 State transition rules

- Executors may recommend transitions but may only perform transitions granted by the task contract.
- A failed mandatory gate blocks acceptance.
- `verified` records technical evidence; it does not equal `reviewed`.
- `reviewed` does not equal `accepted` unless the reviewer has explicit acceptance authority.
- `committed` does not equal `pushed`.
- `pushed` does not equal `ci_verified`.
- `ci_verified` does not equal `deployed`.
- A production deployment does not equal production acceptance without required smoke, monitoring and rollback evidence.

## 9. Planning and sequencing

### 9.1 Audit before plan

Before a new phase or remediation stream, the Supervisor SHOULD establish:

- current architecture and repository state;
- canonical sources and drift;
- existing partial work;
- dependencies and risk boundaries;
- current test and CI capability;
- “not now” items.

### 9.2 Phase design

Phases SHOULD be outcome-based. A phase MUST define entry conditions, tasks, exit gates and residual risks.

### 9.3 Task sizing

A task SHOULD be small enough that one reviewer can understand its complete diff and evidence without relying on undocumented chat context.

### 9.4 No speculative future implementation

Planning future tasks is permitted. Implementing them before their prerequisites and authorization is prohibited.

## 10. Live and concurrent repository protocol

Before any material task, the executor MUST capture:

- repository path/identity;
- timestamp;
- branch;
- exact HEAD;
- upstream ahead/behind state when available;
- staged changes;
- unstaged tracked changes;
- untracked paths;
- visible concurrent work.

If unrelated changes exist:

- preserve them;
- identify overlap with the authorized task;
- work around them only when safe;
- stop when safe isolation is not possible;
- never claim ownership without evidence.

Agents MUST NOT use destructive cleanup or history-rewriting commands to make the repository appear clean.

## 11. Git discipline

### 11.1 General rules

- A commit SHOULD represent one coherent authorized task or explicit evidence checkpoint.
- Commit messages SHOULD include the task ID where a task ledger exists.
- Implementation and independently collected external/device evidence MAY be separate commits.
- Commits MUST NOT silently include unrelated pre-existing work.
- Push, merge, rebase, branch deletion and release tagging require explicit authority as defined by the repository.

### 11.2 History safety

Shared history MUST NOT be rewritten without explicit owner authorization. Normal merge strategy and branch lifecycle MUST be stated by the repository.

### 11.3 CI bypass

`[skip ci]` or equivalent MUST be governed. Any use MUST record:

- why CI is unnecessary or impossible;
- which checks still apply;
- who authorized the bypass;
- whether the change affects status, evidence, release interpretation or production operations.

Evidence and status changes MUST NOT bypass coherence checks merely because they do not change runtime code.

## 12. Verification model

### 12.1 Verification levels

RWS defines reusable levels:

| Level | Meaning |
|---|---|
| V0 | Static inspection/document consistency |
| V1 | Formatting, linting and type/static checks |
| V2 | Unit/component tests |
| V3 | Integration/database/migration tests |
| V4 | End-to-end/runtime tests |
| V5 | Device/provider/staging validation |
| V6 | Production/hardware acceptance |

A task contract selects the relevant levels. Passing a lower level MUST NOT be represented as proof of a higher level.

### 12.2 Verification catalog

Each repository MUST document for every required command or CI job:

- exact command/job name;
- control or acceptance criterion it proves;
- prerequisites;
- environment;
- expected side effects;
- whether it is safe during concurrent development;
- output/evidence produced;
- failure meaning;
- whether it is mandatory for commit, review, merge or release.

### 12.3 Result vocabulary

Results MUST use:

- `PASS`: required check ran and succeeded;
- `FAIL`: required check ran and failed;
- `NOT_RUN`: check was intentionally not executed;
- `NOT_VERIFIABLE`: required proof was unavailable;
- `NOT_APPLICABLE`: check does not apply;
- `STALE`: evidence exists but no longer matches the required revision/environment.

### 12.4 Evidence identity

Verification evidence MUST record:

- task ID;
- exact source revision or worktree fingerprint;
- timestamp and timezone;
- command or procedure;
- relevant tool/runtime versions;
- environment;
- result and counts;
- failures or skipped checks;
- artifact/report links;
- agent/person and role.

## 13. CI and automated governance

CI SHOULD enforce the documented Definition of Done rather than a partial undocumented subset.

Repositories SHOULD implement, proportionate to risk:

- status/document coherence;
- format/lint/type/build;
- unit and integration suites;
- database authority and migration preservation;
- secret and dependency scanning;
- artifact/release provenance;
- task/evidence schema validation.

Local “quality passed” MUST identify its coverage. It MUST NOT imply that separately required CI, hosted, database, provider, device, hardware or production gates passed.

## 14. Review and acceptance

### 14.1 Executor handoff

Every executor handoff MUST include:

- task and role;
- starting and ending snapshot;
- exact changes;
- files affected;
- scope/non-scope compliance;
- verification results;
- evidence links;
- unresolved risks and limitations;
- tracked/untracked state;
- commit/push/deploy state;
- requested reviewer decision;
- explicit statement that the next task was not started.

### 14.2 Reviewer verdict

The Reviewer MUST evaluate:

- authorized scope;
- acceptance criteria;
- regression risk;
- evidence validity and freshness;
- repository hygiene;
- security/privacy/production boundaries;
- unresolved findings.

### 14.3 Acceptance record

Acceptance MUST bind:

- task ID;
- accepted revision;
- evidence set;
- reviewer verdict;
- accepted residual risks;
- accepting authority;
- timestamp;
- next-task eligibility.

An acceptance record MUST NOT be silently edited into a different decision. Corrections or supersession must remain traceable.

## 15. Handoff lifecycle

A handoff is a point-in-time transfer, not permanent current status.

Every handoff MUST declare one lifecycle label:

- `active`;
- `completed`;
- `superseded_by: <artifact>`;
- `historical`.

The canonical status MUST reference the current active handoff. Old handoffs MUST NOT continue to state an operative “next task” after supersession.

## 16. Blockers and stop-state protocol

Every blocker MUST contain:

- blocker ID and description;
- affected task/gate;
- evidence;
- owner;
- severity;
- prohibited actions while blocked;
- exact unblock condition;
- required re-verification;
- authority allowed to close it.

An agent MUST stop when:

- a required gate fails;
- repository state overlaps unsafe concurrent work;
- target environment or identity is ambiguous;
- secrets or authority are missing;
- a destructive action exceeds authorization;
- production preconditions are not satisfied;
- acceptance would depend on an unverified claim.

## 17. Release and deployment provenance

Repositories with deployed environments MUST distinguish:

1. local worktree;
2. local committed HEAD;
3. remote pushed revision;
4. CI-observed revision;
5. built artifact/image;
6. migration/schema level;
7. staging revision;
8. accepted release revision;
9. deployed production revision;
10. production-verified revision.

The release record MUST bind source commit, artifact identity, migration level, environment, deployment time, operator, verification evidence and rollback reference.

Production remains `NO-GO` until every mandatory gate is explicitly `PASS` or an authorized exception exists. A successful preflight does not substitute for external or production evidence.

## 18. Security, privacy and external actions

### 18.1 Secrets

Secrets MUST NOT be committed, copied into evidence, printed in audit reports or exposed through prompts. Evidence SHOULD record secret presence/authority without recording the value.

### 18.2 External mutations

Provider, Git hosting, domain, database, communication, publication and production mutations require explicit authorization. The record SHOULD bind:

- approver;
- exact target;
- allowed action class;
- environment;
- time/task boundary;
- result and rollback evidence.

### 18.3 Production roles

High-risk repositories SHOULD assign primary and backup operational roles. Missing mandatory ownership is an abort condition, not a documentation inconvenience.

## 19. Project-specific verification modules

### 19.1 Database module

Activate when persistent schema or tenant data exists. Require migration forward-path, upgrade preservation, rollback/recovery strategy, isolation authority and version evidence.

### 19.2 Provider and production module

Activate when external systems are mutated. Require exact account/project/team identity, isolated validation where possible, pre/post snapshots, rollback and production provenance.

### 19.3 Mobile/device module

Activate when emulator or physical device behavior matters. Keep JVM/unit, integration, emulator/device and real-device evidence separate.

### 19.4 Hardware/robotics module

Activate when software affects physical behavior. Require safe-state behavior, local-stop priority, device identity, hardware evidence and explicit human supervision for hazardous actions.

### 19.5 AI/model module

Activate when model behavior changes product outcomes. Require model/provider identity, deterministic boundaries where possible, prompt/policy version, fallback behavior, hallucination/safety checks and evaluation evidence.

### 19.6 Media/publication module

Activate when content is generated or published. Require asset provenance, approval state, publication authority, platform identity and separation between draft, approved, scheduled and published states.

## 20. Exceptions and evolution

RWS is versioned and designed to improve.

A standard change MUST include:

- reason and observed problem;
- affected rule;
- compatibility impact;
- migration impact;
- reviewer decision;
- owner approval;
- new version.

Repositories SHOULD pin the RWS version they follow. They MUST NOT automatically adopt a new major version during active work.

Exceptions MUST be narrow, time-bounded where possible, risk-assessed and owner-approved. An exception does not silently amend the standard.

## 21. Adoption protocol for an existing live repository

Adoption MUST occur as a dedicated governance task:

1. capture the live repository snapshot;
2. audit existing strong practices and canonical documents;
3. map existing artifacts to RWS categories;
4. identify active/concurrent work;
5. prepare a repository-specific adoption plan;
6. classify changes as documentation-only, automation, CI or runtime-affecting;
7. obtain owner authorization;
8. implement the smallest non-destructive control-plane change;
9. verify that product code, tests and active work remain intact;
10. conduct independent review;
11. record the pinned RWS version and accepted deviations;
12. only then consider deeper automation.

Adoption MUST NOT:

- rewrite product architecture merely for consistency;
- rename or delete strong historical evidence without need;
- overwrite current handoffs or task state;
- absorb uncommitted work;
- modify production configuration by implication;
- mass-add attribution headers;
- start the project's next product task.

## 22. Minimum conformance gates

A repository may claim **RWS Core Conformant** only when:

- ownership and repository identity are explicit;
- the pinned RWS version is recorded;
- agent authority and stop conditions are canonical;
- one canonical current status exists;
- tasks use the defined lifecycle;
- task scope and acceptance are explicit;
- verification meaning is documented;
- handoff and review are distinguishable;
- tracked/untracked and local/remote/deployed states are not conflated;
- existing work has been preserved;
- project-specific modules are identified;
- deviations are recorded.

## 23. Initial rollout decision

This draft is based on workflow audits of:

- HUGO / Looi26;
- REDI CONTROL;
- BusinessSite RC;
- CalmVideo Studio MVP.

Recommended pilot: CalmVideo Studio MVP, because its workflow is linear and its missing control plane makes the effect of the standard measurable.

The pilot MUST be planned against the actual live snapshot at adoption time. This document does not itself authorize any repository change.

---

## Appendix A — Required task record fields

```yaml
id: PROJECT-TASK-ID
title: Short outcome
state: planned
owner: Redion Cekrezi
supervisor: null
executor: null
reviewer: null
authorization:
  status: pending
  reference: null
scope: []
non_scope: []
dependencies: []
invariants: []
risks: []
acceptance_criteria: []
verification_levels: []
stop_conditions: []
evidence: []
source_revision: null
review_verdict: null
accepted_by: null
next_eligible_task: null
```

## Appendix B — Required status fields

```yaml
project: PROJECT_NAME
rws_version: 0.1.0-draft
captured_at: ISO-8601
canonical_branch: main
local_head: COMMIT
upstream:
  branch: origin/main
  ahead: 0
  behind: 0
worktree:
  staged: []
  tracked_unstaged: []
  untracked: []
active_task: null
task_state: null
blockers: []
next_eligible_task: null
accepted_revision: null
deployed_revision: null
production_status: NOT_APPLICABLE
active_handoff: null
```

## Appendix C — Required handoff sections

1. Identity and role
2. Task and authorization
3. Start snapshot
4. Work performed
5. Files changed
6. Scope/non-scope confirmation
7. Verification evidence
8. Failures and skipped checks
9. Risks and unresolved items
10. End snapshot
11. Commit/push/deployment state
12. Requested reviewer decision
13. Next-task prohibition/eligibility
14. Supersession state

## Appendix D — Repository attribution block

Recommended README wording:

> **Owner and primary maintainer:** Redion Cekrezi  
> This repository follows Redion Work Standard version `<version>`.

Recommended `AUTHORS.md` structure:

```markdown
# Authors and maintainers

## Project owner and primary maintainer

Redion Cekrezi

## Contributors

Contributors are credited through Git history and may be listed here when appropriate.
```

Legal attribution MUST be selected per repository through its license and ownership context. No license is granted or changed by RWS itself.
