ALTER TABLE control.tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE control.tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('active', 'suspended', 'pending_deletion', 'deleted'));

CREATE TABLE control.sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_token_hash text NOT NULL CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES control.users(id),
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  identity_provider text NOT NULL,
  mfa_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  rotation_due_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES control.sessions(id),
  user_agent_hash text,
  ip_prefix inet,
  CHECK (idle_expires_at <= absolute_expires_at),
  CHECK (rotation_due_at <= absolute_expires_at)
);

CREATE INDEX sessions_active_token_idx ON control.sessions (token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX sessions_retention_idx ON control.sessions (absolute_expires_at, revoked_at);

CREATE TABLE control.feature_flags (
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES control.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

CREATE TYPE control.job_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'dead_letter');

CREATE TABLE control.jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  job_type text NOT NULL,
  status control.job_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id uuid NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_type, idempotency_key)
);

CREATE INDEX jobs_claim_idx ON control.jobs (available_at, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE control.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE control.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.users FORCE ROW LEVEL SECURITY;
ALTER TABLE control.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE control.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE control.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_runtime_isolation ON control.tenants
  TO redi_control_runtime
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenants_auth_lookup ON control.tenants
  TO redi_control_auth
  USING (true);

CREATE POLICY users_runtime_isolation ON control.users
  TO redi_control_runtime
  USING (
    EXISTS (
      SELECT 1 FROM control.memberships membership
      WHERE membership.user_id = users.id
        AND membership.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

CREATE POLICY users_auth_lookup ON control.users
  TO redi_control_auth
  USING (true)
  WITH CHECK (true);

CREATE POLICY memberships_auth_lookup ON control.memberships
  TO redi_control_auth
  USING (true);

CREATE POLICY sessions_auth_access ON control.sessions
  TO redi_control_auth
  USING (true)
  WITH CHECK (true);

CREATE POLICY feature_flags_tenant_isolation ON control.feature_flags
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY jobs_tenant_isolation ON control.jobs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION control.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON control.audit_events
  FOR EACH ROW EXECUTE FUNCTION control.reject_audit_mutation();

COMMENT ON TABLE control.sessions IS 'Opaque web session tokens are stored only as SHA-256 hashes.';
COMMENT ON TABLE control.jobs IS 'PostgreSQL-first job queue; workers use tenant context and at-least-once idempotency.';
