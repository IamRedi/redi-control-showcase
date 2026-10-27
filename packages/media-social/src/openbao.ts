import { createHash } from "node:crypto";

import { z } from "zod";

import type { TokenSecretProvider } from "./oauth.js";

const referenceSchema = z.string().regex(/^secret:\/\/[a-zA-Z0-9/_-]{3,240}$/);
const contextSchema = z.object({
  tenantId: z.string().uuid(),
  connectionId: z.string().uuid(),
});
const loginResponseSchema = z.object({
  auth: z.object({
    client_token: z.string().min(16).max(16_384),
    lease_duration: z.number().int().positive().max(86_400),
  }),
});
const readResponseSchema = z.object({
  data: z.object({
    data: z.object({ value: z.string().max(131_072) }),
  }),
});

export interface OpenBaoTokenSecretProviderOptions {
  readonly address: string;
  readonly roleId: string;
  readonly secretId: string;
  readonly requestTimeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

interface CachedToken {
  readonly value: string;
  readonly usableUntil: number;
}

/**
 * A tenant-bound KV v2 token store. The caller-supplied reference is hashed so
 * it can never alter an OpenBao path; trusted tenant and connection identifiers
 * remain visible in the OpenBao audit trail.
 */
export class OpenBaoTokenSecretProvider implements TokenSecretProvider {
  public readonly configured = true;
  readonly #origin: string;
  readonly #roleId: string;
  readonly #secretId: string;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #token: CachedToken | undefined;
  #login: Promise<CachedToken> | undefined;

  public constructor(options: OpenBaoTokenSecretProviderOptions) {
    const address = new URL(options.address);
    if (
      address.protocol !== "https:" ||
      address.username ||
      address.password ||
      address.pathname !== "/" ||
      address.search ||
      address.hash
    )
      throw new Error("INVALID_OPENBAO_CONFIGURATION");
    if (
      !options.roleId.trim() ||
      options.roleId.length > 4096 ||
      !options.secretId.trim() ||
      options.secretId.length > 16_384
    )
      throw new Error("INVALID_OPENBAO_CONFIGURATION");
    const timeout = options.requestTimeoutMs ?? 5_000;
    if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 30_000)
      throw new Error("INVALID_OPENBAO_CONFIGURATION");

    this.#origin = address.origin;
    this.#roleId = options.roleId;
    this.#secretId = options.secretId;
    this.#requestTimeoutMs = timeout;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }

  public async health(): Promise<boolean> {
    try {
      const response = await this.#authorizedRequest(
        "/v1/auth/token/lookup-self",
        { method: "GET" },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  public async store(
    reference: string,
    value: string,
    context: { tenantId: string; connectionId: string },
  ): Promise<void> {
    if (!value || Buffer.byteLength(value, "utf8") > 131_072)
      throw new Error("SECRET_STORE_FAILED");
    const path = this.#secretPath(reference, context, "data");
    const response = await this.#authorizedRequest(path, {
      method: "POST",
      body: JSON.stringify({ data: { value } }),
    });
    if (!response.ok) throw new Error("SECRET_STORE_FAILED");
  }

  public async resolve(
    reference: string,
    context: { tenantId: string; connectionId: string },
  ): Promise<string> {
    const path = this.#secretPath(reference, context, "data");
    const response = await this.#authorizedRequest(path, { method: "GET" });
    if (!response.ok) throw new Error("SECRET_UNAVAILABLE");
    try {
      return readResponseSchema.parse(await this.#boundedJson(response)).data
        .data.value;
    } catch {
      throw new Error("SECRET_UNAVAILABLE");
    }
  }

  public async revoke(
    reference: string,
    context: { tenantId: string; connectionId: string },
  ): Promise<void> {
    const path = this.#secretPath(reference, context, "metadata");
    const response = await this.#authorizedRequest(path, { method: "DELETE" });
    if (!response.ok && response.status !== 404)
      throw new Error("SECRET_REVOKE_FAILED");
  }

  #secretPath(
    reference: string,
    context: { tenantId: string; connectionId: string },
    kind: "data" | "metadata",
  ): string {
    const safeReference = referenceSchema.safeParse(reference);
    const safeContext = contextSchema.safeParse(context);
    if (!safeReference.success || !safeContext.success)
      throw new Error("INVALID_SECRET_CONTEXT");
    const digest = createHash("sha256").update(reference).digest("hex");
    return `/v1/redi-control/${kind}/tenants/${safeContext.data.tenantId}/connections/${safeContext.data.connectionId}/${digest}`;
  }

  async #authorizedRequest(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: string },
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.#getToken();
      const response = await this.#request(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-vault-token": token,
        },
      });
      if (response.status !== 403 || attempt === 1) return response;
      this.#token = undefined;
    }
    throw new Error("SECRET_PROVIDER_UNAVAILABLE");
  }

  async #getToken(): Promise<string> {
    if (this.#token && this.#token.usableUntil > this.#now())
      return this.#token.value;
    this.#login ??= this.#authenticate().finally(() => {
      this.#login = undefined;
    });
    this.#token = await this.#login;
    return this.#token.value;
  }

  async #authenticate(): Promise<CachedToken> {
    try {
      const response = await this.#request("/v1/auth/approle/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role_id: this.#roleId,
          secret_id: this.#secretId,
        }),
      });
      if (!response.ok) throw new Error("login rejected");
      const parsed = loginResponseSchema.parse(
        await this.#boundedJson(response),
      ).auth;
      const leaseMs = parsed.lease_duration * 1_000;
      const safetyMargin = Math.min(30_000, Math.max(1_000, leaseMs / 10));
      return {
        value: parsed.client_token,
        usableUntil: this.#now() + leaseMs - safetyMargin,
      };
    } catch {
      throw new Error("SECRET_PROVIDER_UNAVAILABLE");
    }
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(`${this.#origin}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      throw new Error("SECRET_PROVIDER_UNAVAILABLE");
    }
  }

  async #boundedJson(response: Response): Promise<unknown> {
    const length = response.headers.get("content-length");
    if (length && Number(length) > 262_144)
      throw new Error("SECRET_PROVIDER_INVALID_RESPONSE");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 262_144)
      throw new Error("SECRET_PROVIDER_INVALID_RESPONSE");
    return JSON.parse(body) as unknown;
  }
}
