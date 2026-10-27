import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{1,80}$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const jsonSchema = z.record(z.string(), z.unknown());

export const connectorManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    connectorId: identifier,
    platformId: identifier,
    displayName: z.string().min(1).max(120),
    connectorVersion: semver,
    category: z.enum([
      "saas",
      "website",
      "social",
      "storage",
      "ai",
      "reference",
    ]),
    platformApi: z.object({
      minimumVersion: z.string().min(1),
      maximumVersion: z.string().min(1).optional(),
    }),
    authentication: z.object({
      methods: z
        .array(z.enum(["none", "oauth2", "api_key", "service_token"]))
        .min(1),
      secretRequired: z.boolean(),
    }),
    scopes: z.array(
      z.object({
        id: identifier,
        required: z.boolean(),
        description: z.string().min(1).max(240),
      }),
    ),
    capabilities: z.array(
      z.object({
        id: identifier,
        mode: z.enum(["read", "write"]),
        risk: z.enum(["low", "medium", "high", "critical"]),
      }),
    ),
    commands: z.array(
      z.object({
        id: identifier,
        capability: identifier,
        mode: z.enum(["read", "write"]),
        risk: z.enum(["low", "medium", "high", "critical"]),
        requiredScopes: z.array(identifier),
        inputSchema: jsonSchema,
        outputSchema: jsonSchema,
        idempotency: z.enum(["none", "optional", "required"]),
        timeoutMs: z.number().int().positive().max(30_000),
      }),
    ),
    health: z.object({
      timeoutMs: z.number().int().positive().max(30_000),
      supportsDegraded: z.boolean(),
    }),
    webhooks: z.object({
      events: z.array(identifier),
      signature: z.object({
        required: z.boolean(),
        algorithm: z.string().min(1).optional(),
        toleranceSeconds: z.number().int().positive().optional(),
      }),
    }),
    limits: z.object({
      timeoutMs: z.number().int().positive().max(30_000),
      rateLimit: z.object({
        requests: z.number().int().positive(),
        windowSeconds: z.number().int().positive(),
      }),
      retry: z.object({
        maxAttempts: z.number().int().min(0).max(10),
        baseDelayMs: z.number().int().positive(),
        retryableCodes: z.array(identifier),
      }),
    }),
    compatibility: z.object({
      minimumControlVersion: semver,
      maximumControlVersion: semver.optional(),
    }),
    deprecation: z.object({
      deprecatedAt: z.string().datetime().optional(),
      sunsetAt: z.string().datetime().optional(),
      replacementConnectorId: identifier.optional(),
    }),
  })
  .superRefine((manifest, context) => {
    const capabilities = new Map(
      manifest.capabilities.map((item) => [item.id, item]),
    );
    const scopes = new Set(manifest.scopes.map((item) => item.id));
    for (const command of manifest.commands) {
      if (capabilities.get(command.capability)?.mode !== command.mode) {
        context.addIssue({
          code: "custom",
          message: `Command ${command.id} declares an invalid capability`,
        });
      }
      for (const scope of command.requiredScopes) {
        if (!scopes.has(scope))
          context.addIssue({
            code: "custom",
            message: `Command ${command.id} declares unknown scope ${scope}`,
          });
      }
    }
    if (
      manifest.authentication.secretRequired &&
      manifest.authentication.methods.every((item) => item === "none")
    ) {
      context.addIssue({
        code: "custom",
        message: "Secret auth method required",
      });
    }
    if (
      manifest.webhooks.signature.required &&
      (!manifest.webhooks.signature.algorithm ||
        !manifest.webhooks.signature.toleranceSeconds)
    ) {
      context.addIssue({
        code: "custom",
        message: "Signed webhooks require an algorithm and timestamp tolerance",
      });
    }
  });

export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
export type ConnectorHealthStatus = "healthy" | "degraded" | "unavailable";
export interface ConnectorHealth {
  readonly status: ConnectorHealthStatus;
  readonly checkedAt: string;
  readonly reason?: string;
}
export interface TrustedConnectorContext {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly actorUserId: string;
  readonly permissions: readonly string[];
  readonly correlationId: string;
}
export interface AdapterExecutionContext {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly correlationId: string;
  readonly secret?: string;
  readonly configuration?: Readonly<Record<string, unknown>>;
}
export interface ConnectorAdapter {
  readonly manifest: ConnectorManifest;
  initialize(): Promise<void>;
  disconnect(context: AdapterExecutionContext): Promise<void>;
  health(
    context: AdapterExecutionContext,
    signal: AbortSignal,
  ): Promise<ConnectorHealth>;
  executeRead(
    commandId: string,
    input: unknown,
    context: AdapterExecutionContext,
    signal: AbortSignal,
  ): Promise<unknown>;
  executeWrite(
    commandId: string,
    input: unknown,
    idempotencyKey: string,
    context: AdapterExecutionContext,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface ConnectionDescriptor {
  readonly id: string;
  readonly tenantId: string;
  readonly connectorId: string;
  readonly connectorVersion: string;
  readonly status:
    | "draft"
    | "pending"
    | "active"
    | "degraded"
    | "disabled"
    | "revoked";
  readonly grantedScopes: readonly string[];
  readonly discoveredCapabilities: readonly string[];
  readonly secretReference?: string;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly killSwitched: boolean;
  readonly featureEnabled: boolean;
}
export interface StoredIdempotentResult {
  readonly requestHash: string;
  readonly result: unknown;
}
export interface ConnectorRuntimeStore {
  loadConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<ConnectionDescriptor | null>;
  consumeRateLimit(
    tenantId: string,
    connectionId: string,
    requests: number,
    windowSeconds: number,
  ): Promise<boolean>;
  loadIdempotentResult(
    tenantId: string,
    connectionId: string,
    commandId: string,
    key: string,
  ): Promise<StoredIdempotentResult | null>;
  recordCommandResult(input: {
    tenantId: string;
    connectionId: string;
    commandId: string;
    key?: string;
    requestHash: string;
    result: unknown;
    actorUserId: string;
    correlationId: string;
  }): Promise<void>;
  recordHealth(input: {
    tenantId: string;
    connectionId: string;
    health: ConnectorHealth;
    latencyMs: number;
    actorUserId: string;
    correlationId: string;
  }): Promise<void>;
}
export interface SecretProvider {
  resolve(
    reference: string,
    context: { tenantId: string; connectionId: string },
  ): Promise<string>;
}
export class InMemorySecretProvider implements SecretProvider {
  readonly #secrets = new Map<string, string>();
  public set(reference: string, value: string): void {
    this.#secrets.set(reference, value);
  }
  public resolve(
    reference: string,
    _context: { tenantId: string; connectionId: string },
  ): Promise<string> {
    void _context;
    const secret = this.#secrets.get(reference);
    if (!secret)
      return Promise.reject(
        new ConnectorRuntimeError("SECRET_UNAVAILABLE", 503),
      );
    return Promise.resolve(secret);
  }
}
export type ConnectorErrorCode =
  | "CONNECTION_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "PERMISSION_DENIED"
  | "CONNECTOR_UNAVAILABLE"
  | "CONNECTOR_INCOMPATIBLE"
  | "COMMAND_NOT_DECLARED"
  | "WRITE_NOT_ALLOWED"
  | "CAPABILITY_DENIED"
  | "SCOPE_DENIED"
  | "INVALID_COMMAND_INPUT"
  | "INVALID_COMMAND_OUTPUT"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "TIMEOUT"
  | "SECRET_UNAVAILABLE"
  | "INVALID_CONFIGURATION"
  | "REMOTE_AUTHENTICATION_FAILED"
  | "REMOTE_PERMISSION_DENIED"
  | "REMOTE_CONFLICT"
  | "REMOTE_REJECTED";
export class ConnectorRuntimeError extends Error {
  public constructor(
    public readonly code: ConnectorErrorCode,
    public readonly statusCode: number,
  ) {
    super(code);
    this.name = "ConnectorRuntimeError";
  }
}
function compareSemver(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function manifestChecksum(manifest: ConnectorManifest): string {
  return createHash("sha256").update(stableJson(manifest)).digest("hex");
}

export function verifyWebhookSignature(input: {
  manifest: ConnectorManifest;
  event: string;
  rawBody: string;
  signature: string;
  timestampSeconds: number;
  secret: string;
  nowSeconds?: number;
}): boolean {
  if (!input.manifest.webhooks.events.includes(input.event)) return false;
  const policy = input.manifest.webhooks.signature;
  if (
    !policy.required ||
    policy.algorithm !== "hmac-sha256" ||
    !policy.toleranceSeconds
  )
    return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestampSeconds) > policy.toleranceSeconds)
    return false;
  if (!/^[0-9a-f]{64}$/.test(input.signature)) return false;
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestampSeconds}.${input.rawBody}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(input.signature, "hex"));
}
function requestHash(input: unknown): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}
const reservedContextKeys = new Set([
  "tenantId",
  "tenant_id",
  "connectionId",
  "connection_id",
  "actorUserId",
  "permissions",
  "scopes",
  "capabilities",
  "correlationId",
]);
function containsReservedContextKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsReservedContextKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      reservedContextKeys.has(key) || containsReservedContextKey(child),
  );
}

export class ConnectorRuntime {
  readonly #adapters = new Map<string, ConnectorAdapter>();
  readonly #validators = new Map<
    string,
    { input: ValidateFunction; output: ValidateFunction }
  >();
  readonly #ajv = new Ajv2020({ allErrors: true, strict: true });
  public constructor(
    private readonly store: ConnectorRuntimeStore,
    private readonly secrets: SecretProvider,
    private readonly controlVersion: string,
  ) {}
  public async register(adapter: ConnectorAdapter): Promise<void> {
    const manifest = connectorManifestSchema.parse(adapter.manifest);
    const key = `${manifest.connectorId}@${manifest.connectorVersion}`;
    if (this.#adapters.has(key))
      throw new Error(`Connector already registered: ${key}`);
    for (const command of manifest.commands)
      this.#validators.set(`${key}:${command.id}`, {
        input: this.#ajv.compile(command.inputSchema),
        output: this.#ajv.compile(command.outputSchema),
      });
    await adapter.initialize();
    this.#adapters.set(key, adapter);
  }
  public manifests(): readonly ConnectorManifest[] {
    return [...this.#adapters.values()].map((item) => item.manifest);
  }
  async #resolve(context: TrustedConnectorContext): Promise<{
    connection: ConnectionDescriptor;
    adapter: ConnectorAdapter;
    adapterContext: AdapterExecutionContext;
  }> {
    if (!context.permissions.includes("platform:read"))
      throw new ConnectorRuntimeError("PERMISSION_DENIED", 403);
    const connection = await this.store.loadConnection(
      context.tenantId,
      context.connectionId,
    );
    if (!connection)
      throw new ConnectorRuntimeError("CONNECTION_NOT_FOUND", 404);
    if (connection.tenantId !== context.tenantId)
      throw new ConnectorRuntimeError("TENANT_MISMATCH", 403);
    if (
      !connection.featureEnabled ||
      connection.killSwitched ||
      !["active", "degraded"].includes(connection.status)
    )
      throw new ConnectorRuntimeError("CONNECTOR_UNAVAILABLE", 409);
    const adapter = this.#adapters.get(
      `${connection.connectorId}@${connection.connectorVersion}`,
    );
    if (!adapter) throw new ConnectorRuntimeError("CONNECTOR_UNAVAILABLE", 503);
    const compatibility = adapter.manifest.compatibility;
    if (
      compareSemver(this.controlVersion, compatibility.minimumControlVersion) <
        0 ||
      (compatibility.maximumControlVersion &&
        compareSemver(
          this.controlVersion,
          compatibility.maximumControlVersion,
        ) > 0)
    )
      throw new ConnectorRuntimeError("CONNECTOR_INCOMPATIBLE", 409);
    const secret = connection.secretReference
      ? await this.secrets.resolve(connection.secretReference, {
          tenantId: context.tenantId,
          connectionId: context.connectionId,
        })
      : undefined;
    return {
      connection,
      adapter,
      adapterContext: {
        tenantId: context.tenantId,
        connectionId: context.connectionId,
        correlationId: context.correlationId,
        ...(secret ? { secret } : {}),
        ...(connection.configuration
          ? { configuration: connection.configuration }
          : {}),
      },
    };
  }
  async #execute(
    context: TrustedConnectorContext,
    commandId: string,
    input: unknown,
    expectedMode: "read" | "write",
    idempotencyKey?: string,
  ): Promise<unknown> {
    const { connection, adapter, adapterContext } =
      await this.#resolve(context);
    const command = adapter.manifest.commands.find(
      (item) => item.id === commandId,
    );
    if (!command) throw new ConnectorRuntimeError("COMMAND_NOT_DECLARED", 404);
    if (command.mode !== expectedMode)
      throw new ConnectorRuntimeError("WRITE_NOT_ALLOWED", 403);
    if (
      expectedMode === "write" &&
      !context.permissions.includes("content:edit")
    )
      throw new ConnectorRuntimeError("PERMISSION_DENIED", 403);
    if (
      command.id === "articles.publish" &&
      !context.permissions.includes("content:approve")
    )
      throw new ConnectorRuntimeError("PERMISSION_DENIED", 403);
    if (!connection.discoveredCapabilities.includes(command.capability))
      throw new ConnectorRuntimeError("CAPABILITY_DENIED", 403);
    if (
      command.requiredScopes.some(
        (scope) => !connection.grantedScopes.includes(scope),
      )
    )
      throw new ConnectorRuntimeError("SCOPE_DENIED", 403);
    if (containsReservedContextKey(input))
      throw new ConnectorRuntimeError("INVALID_COMMAND_INPUT", 400);
    const validators = this.#validators.get(
      `${adapter.manifest.connectorId}@${adapter.manifest.connectorVersion}:${command.id}`,
    );
    if (!validators?.input(input))
      throw new ConnectorRuntimeError("INVALID_COMMAND_INPUT", 400);
    if (command.idempotency === "required" && !idempotencyKey)
      throw new ConnectorRuntimeError("INVALID_COMMAND_INPUT", 400);
    const hash = requestHash(input);
    if (idempotencyKey) {
      const stored = await this.store.loadIdempotentResult(
        context.tenantId,
        connection.id,
        command.id,
        idempotencyKey,
      );
      if (stored) {
        if (stored.requestHash !== hash)
          throw new ConnectorRuntimeError("IDEMPOTENCY_CONFLICT", 409);
        return stored.result;
      }
    }
    if (
      !(await this.store.consumeRateLimit(
        context.tenantId,
        connection.id,
        adapter.manifest.limits.rateLimit.requests,
        adapter.manifest.limits.rateLimit.windowSeconds,
      ))
    )
      throw new ConnectorRuntimeError("RATE_LIMITED", 429);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(command.timeoutMs, adapter.manifest.limits.timeoutMs),
    );
    let result: unknown;
    try {
      result =
        command.mode === "read"
          ? await adapter.executeRead(
              command.id,
              input,
              adapterContext,
              controller.signal,
            )
          : await adapter.executeWrite(
              command.id,
              input,
              idempotencyKey!,
              adapterContext,
              controller.signal,
            );
    } catch (error) {
      if (controller.signal.aborted)
        throw new ConnectorRuntimeError("TIMEOUT", 504);
      if (error instanceof ConnectorRuntimeError) throw error;
      throw new ConnectorRuntimeError("CONNECTOR_UNAVAILABLE", 502);
    } finally {
      clearTimeout(timeout);
    }
    if (!validators.output(result))
      throw new ConnectorRuntimeError("INVALID_COMMAND_OUTPUT", 502);
    await this.store.recordCommandResult({
      tenantId: context.tenantId,
      connectionId: connection.id,
      commandId: command.id,
      ...(idempotencyKey ? { key: idempotencyKey } : {}),
      requestHash: hash,
      result,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
    });
    return result;
  }
  public executeRead(
    context: TrustedConnectorContext,
    commandId: string,
    input: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.#execute(context, commandId, input, "read", idempotencyKey);
  }
  public executeWrite(
    context: TrustedConnectorContext,
    commandId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.#execute(context, commandId, input, "write", idempotencyKey);
  }
  public async executeCommand(
    context: TrustedConnectorContext,
    commandId: string,
    input: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const { adapter } = await this.#resolve(context);
    const command = adapter.manifest.commands.find(
      (item) => item.id === commandId,
    );
    if (!command) throw new ConnectorRuntimeError("COMMAND_NOT_DECLARED", 404);
    if (command.mode === "write" && !idempotencyKey)
      throw new ConnectorRuntimeError("INVALID_COMMAND_INPUT", 400);
    return this.#execute(
      context,
      commandId,
      input,
      command.mode,
      idempotencyKey,
    );
  }
  public async health(
    context: TrustedConnectorContext,
  ): Promise<ConnectorHealth> {
    const { connection, adapter, adapterContext } =
      await this.#resolve(context);
    const controller = new AbortController();
    const started = Date.now();
    const timeout = setTimeout(
      () => controller.abort(),
      adapter.manifest.health.timeoutMs,
    );
    let health: ConnectorHealth;
    try {
      health = await adapter.health(adapterContext, controller.signal);
    } catch {
      if (controller.signal.aborted)
        throw new ConnectorRuntimeError("TIMEOUT", 504);
      health = {
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        reason: "adapter_unavailable",
      };
    } finally {
      clearTimeout(timeout);
    }
    await this.store.recordHealth({
      tenantId: context.tenantId,
      connectionId: connection.id,
      health,
      latencyMs: Date.now() - started,
      actorUserId: context.actorUserId,
      correlationId: context.correlationId,
    });
    return health;
  }
  public async disconnect(context: TrustedConnectorContext): Promise<void> {
    if (!context.permissions.includes("platform:connect"))
      throw new ConnectorRuntimeError("PERMISSION_DENIED", 403);
    const resolved = await this.#resolve({
      ...context,
      permissions: [...context.permissions, "platform:read"],
    });
    await resolved.adapter.disconnect(resolved.adapterContext);
  }
}

export const referenceConnectorManifest = connectorManifestSchema.parse({
  schemaVersion: "1.0",
  connectorId: "reference-saas-local",
  platformId: "reference-saas",
  displayName: "Reference SaaS (local)",
  connectorVersion: "1.0.0",
  category: "reference",
  platformApi: { minimumVersion: "local-v1", maximumVersion: "local-v1" },
  authentication: { methods: ["none"], secretRequired: false },
  scopes: [
    {
      id: "profile.read",
      required: true,
      description: "Read deterministic local profile data",
    },
    {
      id: "metrics.read",
      required: false,
      description: "Read deterministic local metrics",
    },
  ],
  capabilities: [
    { id: "profile.read", mode: "read", risk: "low" },
    { id: "metrics.read", mode: "read", risk: "low" },
  ],
  commands: [
    {
      id: "profile.read",
      capability: "profile.read",
      mode: "read",
      risk: "low",
      requiredScopes: ["profile.read"],
      idempotency: "required",
      timeoutMs: 500,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workspaceKey"],
        properties: {
          workspaceKey: { type: "string", minLength: 1, maxLength: 80 },
        },
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workspaceKey", "displayName", "source"],
        properties: {
          workspaceKey: { type: "string" },
          displayName: { type: "string" },
          source: { const: "local-reference" },
        },
      },
    },
  ],
  health: { timeoutMs: 250, supportsDegraded: true },
  webhooks: { events: [], signature: { required: false } },
  limits: {
    timeoutMs: 500,
    rateLimit: { requests: 5, windowSeconds: 60 },
    retry: {
      maxAttempts: 2,
      baseDelayMs: 50,
      retryableCodes: ["rate-limited", "unavailable"],
    },
  },
  compatibility: {
    minimumControlVersion: "0.2.0",
    maximumControlVersion: "0.2.99",
  },
  deprecation: {},
});
export type ReferenceConnectorMode =
  | "healthy"
  | "degraded"
  | "timeout"
  | "invalid-output";
export class ReferenceConnector implements ConnectorAdapter {
  public readonly manifest = referenceConnectorManifest;
  public executions = 0;
  public constructor(public mode: ReferenceConnectorMode = "healthy") {}
  public initialize(): Promise<void> {
    return Promise.resolve();
  }
  public disconnect(): Promise<void> {
    return Promise.resolve();
  }
  public async health(
    _context: AdapterExecutionContext,
    signal: AbortSignal,
  ): Promise<ConnectorHealth> {
    if (this.mode === "timeout")
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
    return {
      status: this.mode === "degraded" ? "degraded" : "healthy",
      checkedAt: new Date().toISOString(),
      ...(this.mode === "degraded" ? { reason: "simulated_degraded" } : {}),
    };
  }
  public async executeRead(
    commandId: string,
    input: unknown,
    _context: AdapterExecutionContext,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.executions += 1;
    if (this.mode === "timeout")
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
    if (commandId !== "profile.read")
      throw new ConnectorRuntimeError("COMMAND_NOT_DECLARED", 404);
    if (this.mode === "invalid-output") return { secret: "invalid" };
    const workspaceKey = (input as { workspaceKey: string }).workspaceKey;
    return {
      workspaceKey,
      displayName: `Reference ${workspaceKey}`,
      source: "local-reference",
    };
  }
  public executeWrite(): Promise<unknown> {
    return Promise.reject(
      new ConnectorRuntimeError("COMMAND_NOT_DECLARED", 404),
    );
  }
}
