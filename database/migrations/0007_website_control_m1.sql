CREATE TABLE control.website_connection_profiles (
  connection_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  provider text NOT NULL DEFAULT 'businesssite_information'
    CHECK (provider = 'businesssite_information'),
  api_base_url text NOT NULL CHECK (
    api_base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?/api/integrations/redi-control/v1$'
    OR api_base_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/api/integrations/redi-control/v1$'
  ),
  external_integration_id text NOT NULL
    CHECK (
      char_length(external_integration_id) BETWEEN 1 AND 300
      AND external_integration_id ~ '^[A-Za-z0-9._:-]+$'
    ),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  domain text NOT NULL CHECK (
    domain = lower(domain) AND char_length(domain) BETWEEN 1 AND 253
    AND domain ~ '^[a-z0-9.-]+$'
  ),
  preview_url text CHECK (
    preview_url IS NULL
    OR preview_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?(/.*)?$'
    OR preview_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$'
  ),
  article_status_summary jsonb NOT NULL DEFAULT
    '{"draft":0,"pending":0,"published":0,"archived":0}'::jsonb
    CHECK (jsonb_typeof(article_status_summary) = 'object'),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES control.platform_connections(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, connection_id),
  UNIQUE (tenant_id, external_integration_id)
);

CREATE INDEX website_profiles_tenant_status_idx
  ON control.website_connection_profiles (tenant_id, updated_at DESC);

ALTER TABLE control.website_connection_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.website_connection_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY website_profiles_tenant_isolation
  ON control.website_connection_profiles
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMENT ON TABLE control.website_connection_profiles IS
  'Non-secret provider configuration for website-category platform connections. HMAC material remains an opaque secret reference on platform_connections.';
