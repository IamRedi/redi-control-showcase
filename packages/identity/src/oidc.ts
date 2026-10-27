import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { DatabasePool } from "@redi-control/database";
import {
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

import type {
  BeginIdentityRequest,
  BeginIdentityResult,
  CompleteIdentityRequest,
  IdentityAdapter,
  IdentityPrincipal,
} from "./index.js";

const transactionLifetimeMs = 10 * 60 * 1000;
const maximumJsonBytes = 256 * 1024;

export class OidcProtocolError extends Error {
  public constructor(message = "OIDC authentication failed") {
    super(message);
    this.name = "OidcProtocolError";
  }
}

export interface OidcTransactionInput {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expiresAt: Date;
}

export interface ConsumedOidcTransaction {
  readonly nonceHash: string;
  readonly codeVerifier: string;
}

export interface OidcTransactionStore {
  create(input: OidcTransactionInput): Promise<string>;
  consume(input: {
    readonly transaction: string;
    readonly state: string;
    readonly redirectUri: string;
  }): Promise<ConsumedOidcTransaction | null>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodeOpaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function encryptionKey(value: Uint8Array): Buffer {
  const key = Buffer.from(value);
  if (key.byteLength !== 32)
    throw new Error("OIDC transaction encryption key must be 32 bytes");
  return key;
}

function encrypt(value: string, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decrypt(value: string, key: Buffer, aad: string): string {
  const parts = value.split(".");
  if (parts.length !== 3) throw new OidcProtocolError();
  const [ivValue, tagValue, ciphertextValue] = parts;
  if (!ivValue || !tagValue || !ciphertextValue) throw new OidcProtocolError();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new OidcProtocolError();
  }
}

export class PostgresOidcTransactionStore implements OidcTransactionStore {
  readonly #key: Buffer;

  public constructor(
    private readonly pool: DatabasePool,
    key: Uint8Array,
  ) {
    this.#key = encryptionKey(key);
  }

  public async create(input: OidcTransactionInput): Promise<string> {
    const transaction = encodeOpaque();
    const transactionHash = sha256(transaction);
    const aad = `${transactionHash}:${input.redirectUri}`;
    await this.pool.query(
      `WITH removable AS (
         SELECT id
         FROM control.identity_transactions
         WHERE expires_at < now() - interval '1 day'
            OR used_at < now() - interval '1 day'
         ORDER BY created_at
         LIMIT 100
       )
       DELETE FROM control.identity_transactions AS transactions
       USING removable
       WHERE transactions.id = removable.id`,
    );
    await this.pool.query(
      `INSERT INTO control.identity_transactions
       (id, transaction_hash, state_hash, nonce_hash, pkce_verifier_ciphertext,
        redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        transactionHash,
        sha256(input.state),
        sha256(input.nonce),
        encrypt(input.codeVerifier, this.#key, aad),
        input.redirectUri,
        input.expiresAt,
      ],
    );
    return transaction;
  }

  public async consume(input: {
    readonly transaction: string;
    readonly state: string;
    readonly redirectUri: string;
  }): Promise<ConsumedOidcTransaction | null> {
    const transactionHash = sha256(input.transaction);
    const result = await this.pool.query<{
      nonce_hash: string;
      pkce_verifier_ciphertext: string;
    }>(
      `UPDATE control.identity_transactions
       SET used_at = now()
       WHERE transaction_hash = $1
         AND state_hash = $2
         AND redirect_uri = $3
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING nonce_hash, pkce_verifier_ciphertext`,
      [transactionHash, sha256(input.state), input.redirectUri],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      nonceHash: row.nonce_hash,
      codeVerifier: decrypt(
        row.pkce_verifier_ciphertext,
        this.#key,
        `${transactionHash}:${input.redirectUri}`,
      ),
    };
  }
}

interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly response_types_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported?: readonly string[];
  readonly id_token_signing_alg_values_supported?: readonly string[];
}

export interface OidcIdentityAdapterOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly transactionStore: OidcTransactionStore;
  readonly allowedIdTokenAlgorithms?: readonly string[];
  readonly acceptedMfaAcrValues?: readonly string[];
  readonly requestedAcrValues?: readonly string[];
  readonly fetch?: typeof fetch;
  readonly allowInsecureHttpForTests?: boolean;
  readonly now?: () => number;
}

function assertUrl(value: string, allowInsecureHttpForTests: boolean): URL {
  const parsed = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.protocol !== "https:" && !(allowInsecureHttpForTests && loopback))
  )
    throw new OidcProtocolError("OIDC endpoint is not trusted");
  return parsed;
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

function parseDiscovery(
  value: unknown,
  expectedIssuer: string,
  allowInsecureHttpForTests: boolean,
): OidcDiscoveryDocument {
  if (!value || typeof value !== "object") throw new OidcProtocolError();
  const candidate = value as Record<string, unknown>;
  if (candidate.issuer !== expectedIssuer)
    throw new OidcProtocolError("OIDC issuer mismatch");
  const authorizationEndpoint = candidate.authorization_endpoint;
  const tokenEndpoint = candidate.token_endpoint;
  const jwksUri = candidate.jwks_uri;
  const responseTypes = stringArray(candidate.response_types_supported);
  const challengeMethods = stringArray(
    candidate.code_challenge_methods_supported,
  );
  if (
    typeof authorizationEndpoint !== "string" ||
    typeof tokenEndpoint !== "string" ||
    typeof jwksUri !== "string" ||
    !responseTypes?.includes("code") ||
    !challengeMethods?.includes("S256")
  )
    throw new OidcProtocolError("OIDC provider lacks required capabilities");
  assertUrl(authorizationEndpoint, allowInsecureHttpForTests);
  assertUrl(tokenEndpoint, allowInsecureHttpForTests);
  assertUrl(jwksUri, allowInsecureHttpForTests);
  return {
    issuer: expectedIssuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    jwks_uri: jwksUri,
    response_types_supported: responseTypes,
    code_challenge_methods_supported: challengeMethods,
    ...(stringArray(candidate.token_endpoint_auth_methods_supported)
      ? {
          token_endpoint_auth_methods_supported: stringArray(
            candidate.token_endpoint_auth_methods_supported,
          )!,
        }
      : {}),
    ...(stringArray(candidate.id_token_signing_alg_values_supported)
      ? {
          id_token_signing_alg_values_supported: stringArray(
            candidate.id_token_signing_alg_values_supported,
          )!,
        }
      : {}),
  };
}

function parseJwks(value: unknown): JSONWebKeySet {
  if (!value || typeof value !== "object") throw new OidcProtocolError();
  const keys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 32)
    throw new OidcProtocolError("OIDC JWKS is invalid");
  return { keys: keys as JSONWebKeySet["keys"] };
}

function safeNonceMatch(actual: unknown, expectedHash: string): boolean {
  if (typeof actual !== "string") return false;
  const actualBuffer = Buffer.from(sha256(actual), "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  return (
    actualBuffer.byteLength === expectedBuffer.byteLength &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function claimString(payload: JWTPayload, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formEncode(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

export class OidcIdentityAdapter implements IdentityAdapter {
  public readonly id = "oidc";
  readonly #issuer: string;
  readonly #fetch: typeof fetch;
  readonly #allowInsecureHttpForTests: boolean;
  readonly #allowedAlgorithms: readonly string[];
  readonly #acceptedMfaAcrValues: ReadonlySet<string>;
  readonly #now: () => number;
  #discovery: Promise<OidcDiscoveryDocument> | undefined;
  #jwks?: { value: JSONWebKeySet; expiresAt: number };

  public constructor(private readonly options: OidcIdentityAdapterOptions) {
    this.#allowInsecureHttpForTests =
      options.allowInsecureHttpForTests === true;
    const issuer = assertUrl(options.issuer, this.#allowInsecureHttpForTests);
    if (issuer.search) throw new OidcProtocolError("OIDC issuer is invalid");
    this.#issuer = issuer.href.replace(/\/$/, "");
    if (!options.clientId.trim() || !options.clientSecret)
      throw new Error("OIDC client credentials are required");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#allowedAlgorithms = options.allowedIdTokenAlgorithms ?? ["RS256"];
    if (
      this.#allowedAlgorithms.length === 0 ||
      this.#allowedAlgorithms.some((algorithm) =>
        ["none", "HS256", "HS384", "HS512"].includes(algorithm),
      )
    )
      throw new Error("OIDC ID token algorithm allowlist is invalid");
    this.#acceptedMfaAcrValues = new Set(options.acceptedMfaAcrValues ?? []);
    this.#now = options.now ?? Date.now;
  }

  public async begin(
    request: BeginIdentityRequest,
  ): Promise<BeginIdentityResult> {
    const redirectUri = assertUrl(
      request.redirectUri,
      this.#allowInsecureHttpForTests,
    ).href;
    const discovery = await this.#configuration();
    const state = encodeOpaque();
    const nonce = encodeOpaque();
    const codeVerifier = encodeOpaque(48);
    const codeChallenge = createHash("sha256")
      .update(codeVerifier, "ascii")
      .digest("base64url");
    const transaction = await this.options.transactionStore.create({
      state,
      nonce,
      codeVerifier,
      redirectUri,
      expiresAt: new Date(this.#now() + transactionLifetimeMs),
    });
    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set("client_id", this.options.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (this.options.requestedAcrValues?.length)
      authorizationUrl.searchParams.set(
        "acr_values",
        this.options.requestedAcrValues.join(" "),
      );
    return { authorizationUrl: authorizationUrl.href, transaction };
  }

  public async complete(
    request: CompleteIdentityRequest,
  ): Promise<IdentityPrincipal> {
    const redirectUri = assertUrl(
      request.redirectUri,
      this.#allowInsecureHttpForTests,
    ).href;
    const stored = await this.options.transactionStore.consume({
      transaction: request.transaction,
      state: request.state,
      redirectUri,
    });
    if (!stored) throw new OidcProtocolError();
    const discovery = await this.#configuration();
    const tokenResponse = await this.#token(discovery, {
      code: request.code,
      redirectUri,
      codeVerifier: stored.codeVerifier,
    });
    const payload = await this.#verifyIdToken(
      discovery,
      tokenResponse.id_token,
    );
    if (!safeNonceMatch(payload.nonce, stored.nonceHash))
      throw new OidcProtocolError("OIDC nonce mismatch");
    const subject = claimString(payload, "sub");
    const email = claimString(payload, "email");
    if (
      !subject ||
      subject.length > 255 ||
      !email ||
      email.length > 320 ||
      !email.includes("@") ||
      payload.email_verified !== true
    )
      throw new OidcProtocolError("OIDC identity claims are incomplete");
    const audiences = Array.isArray(payload.aud)
      ? payload.aud
      : payload.aud
        ? [payload.aud]
        : [];
    if (
      audiences.length > 1 &&
      claimString(payload, "azp") !== this.options.clientId
    )
      throw new OidcProtocolError("OIDC authorized party mismatch");
    const amr = stringArray(payload.amr) ?? [];
    const acr = claimString(payload, "acr");
    return {
      provider: this.#issuer,
      subject,
      email,
      emailVerified: true,
      mfaVerified:
        amr.includes("mfa") ||
        Boolean(acr && this.#acceptedMfaAcrValues.has(acr)),
    };
  }

  public async health(): Promise<boolean> {
    try {
      const discovery = await this.#configuration();
      await this.#keySet(discovery, true);
      return true;
    } catch {
      return false;
    }
  }

  async #configuration(): Promise<OidcDiscoveryDocument> {
    if (!this.#discovery) {
      this.#discovery = this.#fetchJson(
        new URL(`${this.#issuer}/.well-known/openid-configuration`),
      )
        .then((value) =>
          parseDiscovery(value, this.#issuer, this.#allowInsecureHttpForTests),
        )
        .catch((error: unknown) => {
          this.#discovery = undefined;
          throw error;
        });
    }
    return this.#discovery;
  }

  async #token(
    discovery: OidcDiscoveryDocument,
    input: {
      readonly code: string;
      readonly redirectUri: string;
      readonly codeVerifier: string;
    },
  ): Promise<{ readonly id_token: string }> {
    if (
      discovery.token_endpoint_auth_methods_supported &&
      !discovery.token_endpoint_auth_methods_supported.includes(
        "client_secret_basic",
      )
    )
      throw new OidcProtocolError(
        "OIDC provider does not support client_secret_basic",
      );
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
    const credentials = Buffer.from(
      `${formEncode(this.options.clientId)}:${formEncode(this.options.clientSecret)}`,
      "utf8",
    ).toString("base64");
    const value = await this.#fetchJson(new URL(discovery.token_endpoint), {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const idToken =
      value && typeof value === "object"
        ? (value as Record<string, unknown>).id_token
        : undefined;
    if (typeof idToken !== "string" || idToken.length > 32_768)
      throw new OidcProtocolError("OIDC token response is invalid");
    return { id_token: idToken };
  }

  async #verifyIdToken(
    discovery: OidcDiscoveryDocument,
    idToken: string,
  ): Promise<JWTPayload> {
    const advertised = discovery.id_token_signing_alg_values_supported;
    if (
      advertised &&
      !advertised.some((value) => this.#allowedAlgorithms.includes(value))
    )
      throw new OidcProtocolError("OIDC signing algorithms are incompatible");
    const verify = async (refresh: boolean): Promise<JWTPayload> => {
      const jwks = await this.#keySet(discovery, refresh);
      const result = await jwtVerify(idToken, createLocalJWKSet(jwks), {
        issuer: this.#issuer,
        audience: this.options.clientId,
        algorithms: [...this.#allowedAlgorithms],
        clockTolerance: 5,
        currentDate: new Date(this.#now()),
      });
      if (
        typeof result.payload.exp !== "number" ||
        typeof result.payload.iat !== "number" ||
        result.payload.iat > this.#now() / 1000 + 5 ||
        result.payload.iat < this.#now() / 1000 - transactionLifetimeMs / 1000
      )
        throw new OidcProtocolError("OIDC token lifetime is invalid");
      return result.payload;
    };
    try {
      return await verify(false);
    } catch {
      try {
        return await verify(true);
      } catch {
        throw new OidcProtocolError("OIDC ID token validation failed");
      }
    }
  }

  async #keySet(
    discovery: OidcDiscoveryDocument,
    refresh: boolean,
  ): Promise<JSONWebKeySet> {
    if (!refresh && this.#jwks && this.#jwks.expiresAt > this.#now())
      return this.#jwks.value;
    const value = parseJwks(await this.#fetchJson(new URL(discovery.jwks_uri)));
    this.#jwks = { value, expiresAt: this.#now() + 5 * 60 * 1000 };
    return value;
  }

  async #fetchJson(url: URL, init: RequestInit = {}): Promise<unknown> {
    assertUrl(url.href, this.#allowInsecureHttpForTests);
    const response = await this.#fetch(url, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {
      throw new OidcProtocolError("OIDC provider is unavailable");
    });
    if (!response.ok)
      throw new OidcProtocolError("OIDC provider rejected request");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/i.test(contentType))
      throw new OidcProtocolError("OIDC provider returned invalid content");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maximumJsonBytes)
      throw new OidcProtocolError("OIDC response is too large");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumJsonBytes)
      throw new OidcProtocolError("OIDC response is too large");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new OidcProtocolError("OIDC provider returned invalid JSON");
    }
  }
}
