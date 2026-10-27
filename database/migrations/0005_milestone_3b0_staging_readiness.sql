CREATE TYPE control.domain_status AS ENUM ('pending', 'verified', 'active', 'disabled');
CREATE TYPE control.oauth_application_mode AS ENUM ('shared', 'dedicated');
CREATE TYPE control.oauth_application_status AS ENUM ('pending', 'active', 'disabled');

CREATE TABLE control.installation_profiles (
  installation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  brand jsonb NOT NULL,
  enabled_locales text[] NOT NULL DEFAULT ARRAY['en','de'],
  default_locale text NOT NULL DEFAULT 'en',
  enabled_modules text[] NOT NULL DEFAULT '{}',
  privacy_url text,
  terms_url text,
  data_deletion_url text,
  support_url text,
  support_email text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  CHECK (default_locale = ANY(enabled_locales)),
  CHECK (enabled_locales <@ ARRAY['en','de','sq','it']::text[]),
  CHECK (enabled_modules <@ ARRAY['platforms','media','social','websites','context_studio','ai','automations']::text[]),
  CHECK (privacy_url IS NULL OR privacy_url ~ '^https://'),
  CHECK (terms_url IS NULL OR terms_url ~ '^https://'),
  CHECK (data_deletion_url IS NULL OR data_deletion_url ~ '^https://'),
  UNIQUE (tenant_id, installation_id)
);

CREATE TABLE control.installation_domains (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  hostname text NOT NULL CHECK (
    hostname = lower(hostname) AND
    hostname ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  domain_kind text NOT NULL CHECK (domain_kind IN ('canonical','custom')),
  status control.domain_status NOT NULL DEFAULT 'pending',
  verification_token_hash text CHECK (
    verification_token_hash IS NULL OR verification_token_hash ~ '^[0-9a-f]{64}$'
  ),
  verified_at timestamptz,
  activated_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  UNIQUE (hostname),
  UNIQUE (tenant_id, installation_id, id)
);
CREATE UNIQUE INDEX one_canonical_domain_per_installation
  ON control.installation_domains (installation_id)
  WHERE domain_kind = 'canonical' AND status <> 'disabled';

CREATE TABLE control.installation_oauth_applications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  provider control.social_provider NOT NULL,
  application_mode control.oauth_application_mode NOT NULL,
  client_id_reference text NOT NULL CHECK (client_id_reference ~ '^secret://[a-zA-Z0-9/_-]{3,240}$'),
  client_secret_reference text NOT NULL CHECK (client_secret_reference ~ '^secret://[a-zA-Z0-9/_-]{3,240}$'),
  status control.oauth_application_status NOT NULL DEFAULT 'pending',
  configured_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  UNIQUE (tenant_id, installation_id, provider),
  UNIQUE (tenant_id, installation_id, id)
);

CREATE TABLE control.installation_entitlements (
  installation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  plan_id text NOT NULL CHECK (plan_id ~ '^[a-z][a-z0-9_-]{1,62}$'),
  enabled_modules text[] NOT NULL DEFAULT '{}',
  maximum_businesses integer NOT NULL CHECK (maximum_businesses >= 0),
  maximum_workspaces integer NOT NULL CHECK (maximum_workspaces >= 0),
  maximum_social_accounts integer NOT NULL CHECK (maximum_social_accounts >= 0),
  monthly_publication_quota integer NOT NULL CHECK (monthly_publication_quota >= 0),
  storage_quota_bytes bigint NOT NULL CHECK (storage_quota_bytes >= 0),
  maximum_users integer NOT NULL CHECK (maximum_users >= 0),
  provider_availability control.social_provider[] NOT NULL DEFAULT '{}',
  shared_oauth_allowed boolean NOT NULL DEFAULT false,
  dedicated_oauth_allowed boolean NOT NULL DEFAULT false,
  future_ai_quota integer NOT NULL DEFAULT 0 CHECK (future_ai_quota >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  CHECK (enabled_modules <@ ARRAY['platforms','media','social','websites','context_studio','ai','automations']::text[]),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  UNIQUE (tenant_id, installation_id)
);

ALTER TABLE control.oauth_transactions
  ADD COLUMN installation_id uuid,
  ADD COLUMN expected_origin text,
  ADD COLUMN post_connect_path text NOT NULL DEFAULT '/en/social/accounts';
UPDATE control.oauth_transactions transaction
SET installation_id = workspace.installation_id,
    expected_origin = regexp_replace(transaction.redirect_uri, '(/api/.*)$', '')
FROM control.business_workspaces workspace
WHERE workspace.id = transaction.workspace_id;
ALTER TABLE control.oauth_transactions
  ALTER COLUMN installation_id SET NOT NULL,
  ALTER COLUMN expected_origin SET NOT NULL,
  ADD FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  ADD CHECK (expected_origin ~ '^(https://[a-z0-9.-]+(:[0-9]+)?|http://(127\.0\.0\.1|localhost)(:[0-9]+)?)$'),
  ADD CHECK (post_connect_path IN ('/en/social/accounts','/de/social/accounts'));

ALTER TABLE control.installation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE control.installation_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_oauth_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_oauth_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE control.installation_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY installation_profiles_tenant_isolation ON control.installation_profiles
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY installation_domains_tenant_isolation ON control.installation_domains
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY installation_oauth_tenant_isolation ON control.installation_oauth_applications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY installation_entitlements_tenant_isolation ON control.installation_entitlements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION control.resolve_active_installation_domain(requested_hostname text)
RETURNS TABLE (tenant_id uuid, installation_id uuid, canonical_hostname text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
  SELECT domain.tenant_id, domain.installation_id, canonical.hostname
  FROM control.installation_domains domain
  JOIN control.white_label_installations installation
    ON installation.id = domain.installation_id AND installation.tenant_id = domain.tenant_id
  JOIN control.installation_domains canonical
    ON canonical.installation_id = domain.installation_id
   AND canonical.domain_kind = 'canonical' AND canonical.status = 'active'
  WHERE domain.hostname = lower(trim(trailing '.' FROM requested_hostname))
    AND domain.status = 'active' AND installation.status = 'active'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION control.resolve_active_installation_domain(text) FROM PUBLIC;

CREATE INDEX installation_domains_installation_idx
  ON control.installation_domains (tenant_id, installation_id, status);
CREATE INDEX oauth_applications_installation_idx
  ON control.installation_oauth_applications (tenant_id, installation_id, provider, status);

COMMENT ON TABLE control.installation_oauth_applications IS
  'Installation/provider OAuth app selection. Client identifiers and secrets are opaque SecretProvider references only.';
COMMENT ON FUNCTION control.resolve_active_installation_domain(text) IS
  'Returns only active verified mapping identifiers needed before tenant context is known.';
