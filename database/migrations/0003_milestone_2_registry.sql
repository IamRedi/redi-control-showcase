CREATE TYPE control.connector_lifecycle_status AS ENUM (
  'draft', 'pending', 'active', 'degraded', 'disabled', 'revoked'
);

CREATE TYPE control.connector_environment AS ENUM (
  'local', 'test', 'sandbox', 'production'
);

CREATE TYPE control.connector_health_status AS ENUM (
  'unknown', 'healthy', 'degraded', 'unavailable'
);

CREATE TABLE control.platform_definitions (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('saas', 'website', 'social', 'storage', 'ai', 'reference')),
  status control.connector_lifecycle_status NOT NULL DEFAULT 'draft',
  documentation_status text NOT NULL DEFAULT 'local_only'
    CHECK (documentation_status IN ('local_only', 'proposed', 'verified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.connector_versions (
  connector_id text NOT NULL CHECK (connector_id ~ '^[a-z][a-z0-9-]{1,62}$'),
  connector_version text NOT NULL CHECK (connector_version ~ '^\d+\.\d+\.\d+$'),
  platform_id text NOT NULL REFERENCES control.platform_definitions(id),
  manifest jsonb NOT NULL,
  manifest_checksum text NOT NULL CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
  status control.connector_lifecycle_status NOT NULL DEFAULT 'draft',
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_id, connector_version)
);

CREATE TABLE control.white_label_installations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name text NOT NULL,
  data_region text NOT NULL DEFAULT 'EU',
  status control.connector_lifecycle_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.business_workspaces (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  name text NOT NULL,
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  UNIQUE (tenant_id, installation_id, name),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.platform_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  workspace_id uuid NOT NULL REFERENCES control.business_workspaces(id),
  connector_id text NOT NULL,
  connector_version text NOT NULL,
  environment control.connector_environment NOT NULL DEFAULT 'local',
  status control.connector_lifecycle_status NOT NULL DEFAULT 'pending',
  required_scopes text[] NOT NULL DEFAULT '{}',
  granted_scopes text[] NOT NULL DEFAULT '{}',
  discovered_capabilities text[] NOT NULL DEFAULT '{}',
  secret_reference text CHECK (
    secret_reference IS NULL OR secret_reference ~ '^secret://[a-zA-Z0-9/_-]{3,240}$'
  ),
  health_status control.connector_health_status NOT NULL DEFAULT 'unknown',
  last_health_at timestamptz,
  last_healthy_at timestamptz,
  kill_switched boolean NOT NULL DEFAULT false,
  disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connector_id, connector_version)
    REFERENCES control.connector_versions(connector_id, connector_version),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.connector_health_checks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  connection_id uuid NOT NULL REFERENCES control.platform_connections(id),
  status control.connector_health_status NOT NULL,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  safe_reason text,
  correlation_id uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES control.platform_connections(tenant_id, id)
);

CREATE TABLE control.connector_idempotency (
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  connection_id uuid NOT NULL REFERENCES control.platform_connections(id),
  command_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, connection_id, command_id, idempotency_key),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES control.platform_connections(tenant_id, id)
);

CREATE TABLE control.connector_rate_limits (
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  connection_id uuid NOT NULL REFERENCES control.platform_connections(id),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (tenant_id, connection_id, window_started_at),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES control.platform_connections(tenant_id, id)
);

CREATE INDEX connector_connections_tenant_idx
  ON control.platform_connections (tenant_id, status, connector_id);
CREATE INDEX connector_health_tenant_time_idx
  ON control.connector_health_checks (tenant_id, checked_at DESC);

ALTER TABLE control.white_label_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.white_label_installations FORCE ROW LEVEL SECURITY;
ALTER TABLE control.business_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.business_workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE control.platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.platform_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE control.connector_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.connector_health_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE control.connector_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.connector_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE control.connector_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.connector_rate_limits FORCE ROW LEVEL SECURITY;

CREATE POLICY installations_tenant_isolation ON control.white_label_installations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY workspaces_tenant_isolation ON control.business_workspaces
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY connections_tenant_isolation ON control.platform_connections
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY health_checks_tenant_isolation ON control.connector_health_checks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY idempotency_tenant_isolation ON control.connector_idempotency
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY connector_rate_limits_tenant_isolation ON control.connector_rate_limits
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMENT ON COLUMN control.platform_connections.secret_reference IS
  'Opaque secret-provider reference only. Secret material is forbidden.';
COMMENT ON TABLE control.platform_connections IS
  'Tenant-scoped connector instance; distinct from platform, connector version, installation and workspace.';
