import { describe, expect, it } from "vitest";

import {
  ConnectorRuntime,
  ConnectorRuntimeError,
  InMemorySecretProvider,
  ReferenceConnector,
  connectorManifestSchema,
  referenceConnectorManifest,
  verifyWebhookSignature,
  type ConnectionDescriptor,
  type ConnectorRuntimeStore,
  type StoredIdempotentResult,
} from "../src/index.js";

class MemoryStore implements ConnectorRuntimeStore {
  public connection: ConnectionDescriptor = {
    id: "connection-a",
    tenantId: "tenant-a",
    connectorId: "reference-saas-local",
    connectorVersion: "1.0.0",
    status: "active",
    grantedScopes: ["profile.read"],
    discoveredCapabilities: ["profile.read"],
    killSwitched: false,
    featureEnabled: true,
  };
  public calls = 0;
  readonly #results = new Map<string, StoredIdempotentResult>();
  public loadConnection(tenantId: string, connectionId: string) {
    return Promise.resolve(
      tenantId === this.connection.tenantId &&
        connectionId === this.connection.id
        ? this.connection
        : null,
    );
  }
  public consumeRateLimit() {
    this.calls += 1;
    return Promise.resolve(this.calls <= 5);
  }
  public loadIdempotentResult(
    _tenant: string,
    _connection: string,
    _command: string,
    key: string,
  ) {
    return Promise.resolve(this.#results.get(key) ?? null);
  }
  public recordCommandResult(input: {
    key?: string;
    requestHash: string;
    result: unknown;
  }) {
    if (input.key)
      this.#results.set(input.key, {
        requestHash: input.requestHash,
        result: input.result,
      });
    return Promise.resolve();
  }
  public recordHealth() {
    return Promise.resolve();
  }
}

const context = {
  tenantId: "tenant-a",
  connectionId: "connection-a",
  actorUserId: "user-a",
  permissions: ["platform:read", "platform:connect"],
  correlationId: "correlation-a",
} as const;

describe("Connector Manifest v1", () => {
  it("accepts the final bounded reference contract", () => {
    expect(
      connectorManifestSchema.parse(referenceConnectorManifest).commands[0]
        ?.mode,
    ).toBe("read");
  });

  it("fails closed for unknown schemas and undeclared command capabilities", () => {
    expect(() =>
      connectorManifestSchema.parse({ schemaVersion: "2.0" }),
    ).toThrow();
    expect(() =>
      connectorManifestSchema.parse({
        ...referenceConnectorManifest,
        commands: [
          {
            ...referenceConnectorManifest.commands[0],
            capability: "undeclared.read",
          },
        ],
      }),
    ).toThrow("invalid capability");
  });

  it("denies undeclared and malformed webhooks", () => {
    expect(
      verifyWebhookSignature({
        manifest: referenceConnectorManifest,
        event: "profile.changed",
        rawBody: "{}",
        signature: "invalid",
        timestampSeconds: 1,
        nowSeconds: 1,
        secret: "not-persisted",
      }),
    ).toBe(false);
  });
});

describe("Connector runtime policy", () => {
  it("resolves test secrets behind an opaque provider boundary", async () => {
    const provider = new InMemorySecretProvider();
    provider.set("secret://local/example", "test-value-never-persisted");
    await expect(
      provider.resolve("secret://local/example", {
        tenantId: "tenant-a",
        connectionId: "connection-a",
      }),
    ).resolves.toBe("test-value-never-persisted");
    await expect(
      provider.resolve("secret://local/missing", {
        tenantId: "tenant-a",
        connectionId: "connection-a",
      }),
    ).rejects.toMatchObject({ code: "SECRET_UNAVAILABLE" });
  });

  it("executes deterministic reads and deduplicates retries", async () => {
    const store = new MemoryStore();
    const adapter = new ReferenceConnector();
    const runtime = new ConnectorRuntime(
      store,
      new InMemorySecretProvider(),
      "0.2.0",
    );
    await runtime.register(adapter);
    const first = await runtime.executeRead(
      context,
      "profile.read",
      { workspaceKey: "alpha" },
      "request-0001",
    );
    const retry = await runtime.executeRead(
      context,
      "profile.read",
      { workspaceKey: "alpha" },
      "request-0001",
    );
    expect(retry).toEqual(first);
    expect(adapter.executions).toBe(1);
  });

  it("rejects context injection, missing scope/capability, kill switch and undeclared writes", async () => {
    const store = new MemoryStore();
    const runtime = new ConnectorRuntime(
      store,
      new InMemorySecretProvider(),
      "0.2.0",
    );
    await runtime.register(new ReferenceConnector());
    await expect(
      runtime.executeRead(
        context,
        "profile.read",
        { workspaceKey: "a", tenantId: "tenant-b" },
        "request-0002",
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMMAND_INPUT" });
    store.connection = { ...store.connection, grantedScopes: [] };
    await expect(
      runtime.executeRead(
        context,
        "profile.read",
        { workspaceKey: "a" },
        "request-0003",
      ),
    ).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    store.connection = {
      ...store.connection,
      grantedScopes: ["profile.read"],
      discoveredCapabilities: [],
    };
    await expect(
      runtime.executeRead(
        context,
        "profile.read",
        { workspaceKey: "a" },
        "request-0004",
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    store.connection = {
      ...store.connection,
      discoveredCapabilities: ["profile.read"],
      killSwitched: true,
    };
    await expect(
      runtime.executeRead(
        context,
        "profile.read",
        { workspaceKey: "a" },
        "request-0005",
      ),
    ).rejects.toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    store.connection = { ...store.connection, killSwitched: false };
    await expect(
      runtime.executeRead(context, "content.write", {}, "request-0006"),
    ).rejects.toMatchObject({ code: "COMMAND_NOT_DECLARED" });
  });

  it("fails closed on incompatible versions, timeouts and rate limits", async () => {
    const store = new MemoryStore();
    const timeoutRuntime = new ConnectorRuntime(
      store,
      new InMemorySecretProvider(),
      "0.2.0",
    );
    await timeoutRuntime.register(new ReferenceConnector("timeout"));
    await expect(timeoutRuntime.health(context)).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    const incompatible = new ConnectorRuntime(
      new MemoryStore(),
      new InMemorySecretProvider(),
      "0.3.0",
    );
    await incompatible.register(new ReferenceConnector());
    await expect(incompatible.health(context)).rejects.toMatchObject({
      code: "CONNECTOR_INCOMPATIBLE",
    });

    const limitedStore = new MemoryStore();
    limitedStore.calls = 5;
    const limited = new ConnectorRuntime(
      limitedStore,
      new InMemorySecretProvider(),
      "0.2.0",
    );
    await limited.register(new ReferenceConnector());
    await expect(
      limited.executeRead(
        context,
        "profile.read",
        { workspaceKey: "a" },
        "request-0007",
      ),
    ).rejects.toBeInstanceOf(ConnectorRuntimeError);
  });
});
