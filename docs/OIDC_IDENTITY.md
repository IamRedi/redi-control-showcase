> Evaluation reference: private pilot names were replaced with fictional examples. Historical implementation/acceptance notes refer to the source project; they are not live-provider acceptance of Aurora Media or this copy. See [EVIDENCE](../EVIDENCE.md).

# Production OIDC identity

## Implemented contract

REDI CONTROL uses a provider-neutral OpenID Connect Authorization Code flow. The implementation lives in `packages/identity`; API routes only compose the adapter with the existing PostgreSQL session/RBAC system.

Security controls:

- exact configured HTTPS issuer and discovery issuer match;
- authorization code flow only;
- PKCE `S256` with a 384-bit verifier;
- 256-bit state, nonce and opaque transaction values;
- state, nonce and transaction stored only as SHA-256 hashes;
- PKCE verifier encrypted with AES-256-GCM and transaction/redirect binding;
- ten-minute, PostgreSQL-backed, single-use transaction;
- token endpoint uses `client_secret_basic`, form encoding, five-second timeout and no redirects;
- discovery, token and JWKS responses use a JSON content-type and 256 KiB limit;
- asymmetric ID-token algorithm allowlist; `none` and HMAC algorithms are forbidden;
- signature, issuer, audience, authorized party, expiry, issued-at freshness and nonce validation;
- verified email is mandatory;
- MFA is true only when `amr` contains `mfa` or `acr` exactly matches an operator-configured accepted value;
- password-only authentication creates a non-MFA session, so sensitive owner actions remain denied;
- callback protocol failures clear the transaction cookie and return a bounded error.
- ordinary sign-in may preserve one short-lived local destination, but only an
  enabled `/en`, `/de` or `/sq` path is accepted. The HttpOnly SameSite cookie
  is revalidated and cleared by the callback; external origins, protocol-
  relative paths, backslashes, fragments, disabled locales and malformed input
  fall back to `/`.

The implementation follows OpenID Connect Core ID-token/nonce validation and RFC 7636 PKCE `S256`. Sources verified 2026-08-20:

- <https://openid.net/specs/openid-connect-core-1_0.html>
- <https://www.rfc-editor.org/info/rfc7636/>
- JOSE verification/JWKS API: <https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md>
- JOSE security guidance: <https://github.com/panva/jose/blob/main/SECURITY.md>

## Runtime configuration

Non-secret values:

- `IDENTITY_ADAPTER=oidc`
- `OIDC_ISSUER` — exact issuer, without query or fragment;
- `OIDC_CLIENT_ID`
- `OIDC_ALLOWED_ID_TOKEN_ALGS` — comma-separated, default `RS256`;
- `OIDC_ACCEPTED_MFA_ACR_VALUES` — optional exact provider ACR allowlist.

Mounted runtime secrets:

- `OIDC_CLIENT_SECRET_FILE`
- `OIDC_TRANSACTION_ENCRYPTION_KEY_FILE` — base64url encoding of exactly 32 random bytes.

Direct secret environment values remain supported for managed platforms that inject secrets as environment variables, but must never be committed or placed in `.env.staging`.

Only the API receives OIDC secrets. The background worker uses its narrower worker configuration schema and receives only its runtime database credential plus bounded job/retrieval settings.

The registered callback is exactly:

`https://<trusted-staging-host>/auth/callback`

No wildcard, alternate path, HTTP callback or localhost callback is valid in staging/production.

## Provider setup checklist

1. Create a separate non-production OIDC application.
2. Register only the exact staging callback.
3. Enable authorization code flow and PKCE `S256`.
4. Ensure `openid email profile` and `email_verified` are available.
5. Configure MFA at the identity provider.
6. Confirm whether the provider emits `amr: ["mfa"]`; otherwise record the provider's exact post-MFA `acr` value in the allowlist.
7. Keep client secret and transaction key in the selected secret manager.
8. Test wrong state, replay, wrong nonce, wrong issuer/audience, unverified email and password-only login before go-live.

## First-owner bootstrap boundary

OIDC authenticates identity; it does not grant tenancy by itself. Normal login still requires an existing active membership and never trusts a tenant from the browser or identity token.

The separately bounded first-owner flow is implemented in [First-owner bootstrap](FIRST_OWNER_BOOTSTRAP.md). It requires an operator-issued, installation-bound, expiring token plus a verified matching email and MFA. It is available only while no Root Owner exists in the target tenant and cannot be reused for later user administration.
