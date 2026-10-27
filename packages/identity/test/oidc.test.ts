import {
  OidcIdentityAdapter,
  type OidcTransactionInput,
  type OidcTransactionStore,
} from "../src/index.js";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

const issuer = "https://identity.example.test";
const clientId = "redi-control-test";
const clientSecret = "test secret:with/special+characters";
const now = Date.parse("2026-08-20T12:00:00.000Z");

class MemoryTransactionStore implements OidcTransactionStore {
  public created?: OidcTransactionInput;
  public used = false;

  public create(input: OidcTransactionInput): Promise<string> {
    this.created = input;
    return Promise.resolve("opaque-transaction");
  }

  public consume(input: {
    readonly transaction: string;
    readonly state: string;
    readonly redirectUri: string;
  }) {
    if (
      this.used ||
      input.transaction !== "opaque-transaction" ||
      input.state !== this.created?.state ||
      input.redirectUri !== this.created.redirectUri
    )
      return Promise.resolve(null);
    this.used = true;
    return Promise.resolve({
      nonceHash: sha256(this.created.nonce),
      codeVerifier: this.created.codeVerifier,
    });
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key" };
});

async function signIdToken(input: {
  nonce: string;
  issuer?: string;
  audience?: string;
  emailVerified?: boolean;
  amr?: string[];
}): Promise<string> {
  return new SignJWT({
    email: "owner@example.test",
    email_verified: input.emailVerified ?? true,
    nonce: input.nonce,
    amr: input.amr ?? ["pwd", "mfa"],
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .setIssuer(input.issuer ?? issuer)
    .setAudience(input.audience ?? clientId)
    .setSubject("owner-subject")
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 300)
    .sign(privateKey);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response,
): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(requestUrl(input), init));
}

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    id_token_signing_alg_values_supported: ["RS256"],
    ...overrides,
  };
}

describe("provider-neutral OIDC identity", () => {
  it("uses code + PKCE, validates the ID token and denies transaction replay", async () => {
    const store = new MemoryTransactionStore();
    let idToken = "";
    let tokenRequest: RequestInit | undefined;
    const fetcher = mockFetch((url, init) => {
      if (url.endsWith("/.well-known/openid-configuration"))
        return json(discovery());
      if (url.endsWith("/token")) {
        tokenRequest = init;
        return json({ id_token: idToken });
      }
      if (url.endsWith("/jwks")) return json({ keys: [publicJwk] });
      return json({}, 404);
    });
    const adapter = new OidcIdentityAdapter({
      issuer,
      clientId,
      clientSecret,
      transactionStore: store,
      fetch: fetcher,
      now: () => now,
      requestedAcrValues: ["2"],
    });
    const redirectUri = "https://api.example.test/auth/callback";
    const started = await adapter.begin({ redirectUri });
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(authorization.searchParams.get("state")).toBe(store.created?.state);
    expect(authorization.searchParams.get("nonce")).toBe(store.created?.nonce);
    expect(authorization.searchParams.get("acr_values")).toBe("2");
    idToken = await signIdToken({ nonce: store.created?.nonce ?? "" });
    const principal = await adapter.complete({
      code: "authorization-code",
      state: store.created?.state ?? "",
      transaction: started.transaction,
      redirectUri,
    });
    expect(principal).toEqual({
      provider: issuer,
      subject: "owner-subject",
      email: "owner@example.test",
      emailVerified: true,
      mfaVerified: true,
    });
    await expect(adapter.health()).resolves.toBe(true);
    expect(tokenRequest?.redirect).toBe("error");
    const tokenBody = tokenRequest?.body;
    expect(typeof tokenBody === "string" ? tokenBody : "").toContain(
      `code_verifier=${encodeURIComponent(store.created?.codeVerifier ?? "")}`,
    );
    expect(typeof tokenBody === "string" ? tokenBody : "").not.toContain(
      clientSecret,
    );
    expect(new Headers(tokenRequest?.headers).get("authorization")).toMatch(
      /^Basic /,
    );
    await expect(
      adapter.complete({
        code: "authorization-code",
        state: store.created?.state ?? "",
        transaction: started.transaction,
        redirectUri,
      }),
    ).rejects.toThrow("OIDC authentication failed");
  });

  it("rejects a nonce mismatch, wrong issuer and unverified email", async () => {
    for (const mode of ["nonce", "issuer", "email"] as const) {
      const store = new MemoryTransactionStore();
      let idToken = "";
      const fetcher = mockFetch((url) => {
        if (url.endsWith("/.well-known/openid-configuration"))
          return json(discovery());
        if (url.endsWith("/token")) return json({ id_token: idToken });
        return json({ keys: [publicJwk] });
      });
      const adapter = new OidcIdentityAdapter({
        issuer,
        clientId,
        clientSecret,
        transactionStore: store,
        fetch: fetcher,
        now: () => now,
      });
      const redirectUri = "https://api.example.test/auth/callback";
      const started = await adapter.begin({ redirectUri });
      idToken = await signIdToken({
        nonce: mode === "nonce" ? "wrong-nonce" : (store.created?.nonce ?? ""),
        ...(mode === "issuer" ? { issuer: "https://attacker.example" } : {}),
        ...(mode === "email" ? { emailVerified: false } : {}),
      });
      await expect(
        adapter.complete({
          code: "authorization-code",
          state: store.created?.state ?? "",
          transaction: started.transaction,
          redirectUri,
        }),
      ).rejects.toThrow();
    }
  });

  it("does not infer MFA from a password-only authentication", async () => {
    const store = new MemoryTransactionStore();
    let idToken = "";
    const fetcher = mockFetch((url) => {
      if (url.endsWith("/.well-known/openid-configuration"))
        return json(discovery());
      if (url.endsWith("/token")) return json({ id_token: idToken });
      return json({ keys: [publicJwk] });
    });
    const adapter = new OidcIdentityAdapter({
      issuer,
      clientId,
      clientSecret,
      transactionStore: store,
      fetch: fetcher,
      now: () => now,
    });
    const redirectUri = "https://api.example.test/auth/callback";
    const started = await adapter.begin({ redirectUri });
    idToken = await signIdToken({
      nonce: store.created?.nonce ?? "",
      amr: ["pwd"],
    });
    expect(
      (
        await adapter.complete({
          code: "authorization-code",
          state: store.created?.state ?? "",
          transaction: started.transaction,
          redirectUri,
        })
      ).mfaVerified,
    ).toBe(false);
  });

  it("rejects providers without code + S256 and refuses HTTP endpoints", async () => {
    const store = new MemoryTransactionStore();
    const adapter = new OidcIdentityAdapter({
      issuer,
      clientId,
      clientSecret,
      transactionStore: store,
      fetch: mockFetch(() =>
        json(
          discovery({
            code_challenge_methods_supported: ["plain"],
          }),
        ),
      ),
      now: () => now,
    });
    await expect(
      adapter.begin({ redirectUri: "https://api.example.test/auth/callback" }),
    ).rejects.toThrow("required capabilities");
    expect(
      () =>
        new OidcIdentityAdapter({
          issuer: "http://identity.example.test",
          clientId,
          clientSecret,
          transactionStore: store,
        }),
    ).toThrow("not trusted");
  });
});
