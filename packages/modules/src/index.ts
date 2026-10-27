/** Explicit modular-monolith boundaries. Implementations are deferred to approved milestones. */
export const moduleNames = [
  "identity-tenancy-rbac",
  "platform-registry",
  "context-studio",
  "ai-gateway",
  "media-pipeline",
  "automation-engine",
  "approvals",
  "audit",
] as const;

export type ModuleName = (typeof moduleNames)[number];

export interface DomainEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly payload: Readonly<TPayload>;
}

export interface TransactionalOutboxMessage {
  readonly event: DomainEvent;
  readonly availableAt: string;
  readonly attemptCount: number;
}
