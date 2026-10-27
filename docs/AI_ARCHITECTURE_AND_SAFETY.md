> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# AI architecture and safety

Milestone 6 adds `editorial_transformation` and `editorial_grounding_validation` through the same gateway, routing, budget, idempotency and usage controls. Factual evidence and editorial policy are separate structured fields and neither becomes a system instruction. Server policy independently checks verification labels, freshness disclosure, sections, headline and visual constraints.

Status: provider-neutral gateway and evidence-intelligence runtime implemented in Milestone 5. Production provider selection remains a deployment decision.

## Governed Model Studio boundary

The admin-only Model Studio is a governance ledger over the gateway, not a
provider control plane. Current runtime routes and budget consumption are
read-only. Budget limits may be changed by a tenant administrator with MFA and
CSRF protection. Candidate route proposals and their evaluation results are
append-only, tenant/workspace-scoped, audited and protected by forced RLS.

A proposal or passing evaluation never updates `ai_model_routes`, enables a
provider, resolves a secret or executes a model. The UI and API intentionally
have no activate/apply action. `editorial_image_generation` and
`channel_adaptation` exist only as future proposal slots until their schemas,
rights/provenance, moderation, provider/data policy and human-approval gates are
separately accepted.

## Components

The AI Gateway is the only provider boundary. An Intent Router classifies requests; Context Builder creates an authorized Context Pack; Brand Brain supplies approved brand facts/rules; Planner produces bounded steps; Generator creates proposals; Validator checks schema/business/channel rules; Risk Engine assigns approval; Executor calls registered tools; Evaluator measures quality/safety/cost.

These are responsibilities, not autonomous network agents. Begin with a deterministic orchestration pipeline and add model calls only where evals demonstrate value.

## Invocation contract

Each invocation records tenant/business/user or workload, purpose, provider/model, prompt version, tool schema versions, context-pack ID/version, policy version, budget reservation, structured input/output schema, latency, token/usage/cost estimate, validation outcome, approval/execution references, and safe error. Raw prompts/outputs are retained only under an approved minimization/retention policy.

## Safety invariants

Milestone 5 materializes the boundary in `packages/ai-gateway`. Research source content is placed only inside a delimited untrusted-data envelope. Evidence Intelligence validates structured output and every claim/source identifier server-side. Grounded synthesis uses an immutable Evidence Pack as its complete factual context. Generation and grounding validation are separate, independently configurable operations; unsupported or conflicting material results block approval readiness.

- Provider/model output is untrusted data, not authorization or executable code.
- AI sees only the task-specific Context Pack and can call only allowlisted, versioned tools after server-side tenant/RBAC/policy checks.
- Tool arguments and results validate against strict schemas; extra fields fail closed.
- No production change without validation, preview where applicable, audit, and risk-based approval.
- Financial, deletion, bulk publication, and high-impact identity/price changes never execute autonomously.
- Instructions inside websites, documents, media, connector data, or tool results are treated as content, not higher-priority instructions.
- URLs and file operations use connector/media safety controls; secrets are never placed into model context.

## Budgets, routing, and BYOK

Reserve budget before a call and reconcile actual usage after it. Enforce tenant daily/monthly hard limits, per-user and concurrency limits, task max tokens/time/tools, and provider rate limits. Routing is policy plus eval outcome, not a hard-coded premium model. Cache only safe deterministic artifacts with tenant/purpose/version keys.

BYOK is optional after MVP policy approval. Keys remain vault references, are provider-scoped, never displayed after entry, and do not bypass REDI CONTROL authorization, quotas, content policy, rate limits, or audit. Required decisions include provider list, data processing/region/retention, cost responsibility, key validation/rotation/revocation, and fallback behavior.

## Evals and release gates

Use a versioned, sanitized dataset with BusinessSite/PitLaneOne scenarios: intent/tool choice, schema validity, factual grounding/provenance, brand/language adherence, tenant isolation, prompt injection, forbidden claim refusal, approval classification, duplicate avoidance, latency, and cost. Compare prompt/model/tool changes against an approved baseline; block deployment on safety/tenant/approval regression. Human review samples real pilot outputs only with consent and minimization.

## Live provider boundary and Pilot 6P

The first live acceptance provider is implemented with the OpenAI Responses API behind `AiGateway`; domain services never read provider keys directly. The key is resolved at invocation time through `SecretProvider`, requests use `store: false`, and output must pass both provider-facing JSON Schema and the original Zod runtime schema.

Evidence identifiers and Media Profile categories are converted into bounded enums for provider output. Unsupported Unicode-property regex is omitted only from the provider-facing schema because the provider rejects that regex dialect; the original Zod regex remains mandatory after response parsing.

Milestone 6.5 closes the failed-call accounting gap. The engine reserves a conservative maximum in `ai_usage_events` under a locked workspace budget policy before invocation, then reconciles the same tenant/run row to measured success or measured failure usage. Failures without provider usage retain the reservation and therefore fail closed for budget enforcement. Provider-side spending limits remain a recommended independent operational guard.

Reader-facing editorial output also passes a server-side language policy sourced from the immutable Media Profile revision. Prompt instructions are not considered enforcement: internal identifiers and configured forbidden terminology independently block approval readiness.

## Open decisions

Provider/model, hosting region, retention, initial languages/quality thresholds, moderation needs, human-review sample policy, quota/budget values, and BYOK timing remain unresolved. Current model names or capabilities must be verified in official provider documentation at implementation time.
