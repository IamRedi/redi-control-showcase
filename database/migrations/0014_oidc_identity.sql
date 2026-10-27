CREATE TABLE control.identity_transactions (
  id uuid PRIMARY KEY,
  transaction_hash text NOT NULL UNIQUE CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  pkce_verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 12 AND 2048),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX identity_transactions_expiry_idx
  ON control.identity_transactions (expires_at)
  WHERE used_at IS NULL;

REVOKE ALL ON control.identity_transactions FROM PUBLIC;

COMMENT ON TABLE control.identity_transactions IS
  'Pre-authentication OIDC transactions. Opaque values are hashed, PKCE verifiers are encrypted, and every row is short-lived and single-use.';
