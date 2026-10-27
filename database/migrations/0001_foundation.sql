CREATE SCHEMA IF NOT EXISTS control;

CREATE TYPE control.membership_role AS ENUM (
  'root_owner',
  'white_label_owner',
  'admin',
  'approver',
  'editor',
  'analyst'
);

CREATE TABLE control.tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.users (
  id uuid PRIMARY KEY,
  identity_subject text NOT NULL UNIQUE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.memberships (
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  user_id uuid NOT NULL REFERENCES control.users(id),
  role control.membership_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, role)
);

CREATE TABLE control.audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  actor_user_id uuid REFERENCES control.users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE control.outbox_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  event_type text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  payload jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text
);

CREATE INDEX audit_events_tenant_time_idx ON control.audit_events (tenant_id, occurred_at DESC);
CREATE INDEX outbox_events_pending_idx ON control.outbox_events (available_at) WHERE published_at IS NULL;

ALTER TABLE control.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE control.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE control.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_tenant_isolation ON control.memberships
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY audit_events_tenant_isolation ON control.audit_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY outbox_events_tenant_isolation ON control.outbox_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMENT ON SCHEMA control IS 'REDI CONTROL modular-monolith data; app roles must not own tables or have BYPASSRLS.';
COMMENT ON TABLE control.audit_events IS 'Append-only at application boundary; mutation privileges must be denied to runtime roles.';

