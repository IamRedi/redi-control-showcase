CREATE TABLE control.local_demo_bootstrap_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash~'^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  user_id uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (
    expires_at>created_at
    AND expires_at<=created_at+interval '15 minutes'
  ),
  CHECK (consumed_at IS NULL OR consumed_at>=created_at)
);

CREATE INDEX local_demo_bootstrap_expiry_idx
  ON control.local_demo_bootstrap_tokens(expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE control.local_demo_bootstrap_tokens IS
  'Local-only, short-lived and single-use bootstrap tokens. Only token digests are persisted; the API route remains disabled outside explicit loopback demo mode.';
