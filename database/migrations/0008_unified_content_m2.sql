ALTER TABLE control.media_assets
  ADD CONSTRAINT media_assets_tenant_workspace_id_unique
  UNIQUE (tenant_id, workspace_id, id);

ALTER TABLE control.social_accounts
  ADD CONSTRAINT social_accounts_tenant_workspace_id_unique
  UNIQUE (tenant_id, workspace_id, id);

ALTER TABLE control.social_drafts
  ADD CONSTRAINT social_drafts_tenant_workspace_id_unique
  UNIQUE (tenant_id, workspace_id, id);

ALTER TABLE control.platform_connections
  ADD CONSTRAINT platform_connections_tenant_workspace_id_unique
  UNIQUE (tenant_id, workspace_id, id);

ALTER TABLE control.installation_profiles
  DROP CONSTRAINT installation_profiles_enabled_modules_check;
ALTER TABLE control.installation_profiles
  ADD CONSTRAINT installation_profiles_enabled_modules_check
  CHECK (enabled_modules <@ ARRAY['platforms','media','social','websites','unified_content','context_studio','ai','automations']::text[]);
ALTER TABLE control.installation_entitlements
  DROP CONSTRAINT installation_entitlements_enabled_modules_check;
ALTER TABLE control.installation_entitlements
  ADD CONSTRAINT installation_entitlements_enabled_modules_check
  CHECK (enabled_modules <@ ARRAY['platforms','media','social','websites','unified_content','context_studio','ai','automations']::text[]);

ALTER TABLE control.media_usage_references
  DROP CONSTRAINT media_usage_references_usage_type_check;
ALTER TABLE control.media_usage_references
  ADD CONSTRAINT media_usage_references_usage_type_check
  CHECK (usage_type IN ('social_draft', 'published_social', 'content_item', 'manual'));

CREATE TABLE control.content_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES control.users(id),
  updated_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workspace_id, id)
);

CREATE TABLE control.content_item_media (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 49),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id, content_item_id)
    REFERENCES control.content_items(tenant_id, workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, asset_id)
    REFERENCES control.media_assets(tenant_id, workspace_id, id),
  UNIQUE (tenant_id, content_item_id, asset_id),
  UNIQUE (tenant_id, content_item_id, position),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.content_item_variants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  destination text NOT NULL CHECK (destination IN ('website', 'facebook', 'instagram')),
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN (
    'provisioning', 'draft', 'ready_for_review', 'approved', 'rejected',
    'scheduled', 'queued', 'publishing', 'published', 'partial', 'failed',
    'retry_scheduled', 'needs_reauthorization', 'cancelled', 'archived'
  )),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  website_connection_id uuid,
  social_draft_id uuid,
  social_account_id uuid,
  external_id text CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 500),
  safe_error text CHECK (safe_error IS NULL OR char_length(safe_error) <= 500),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id, content_item_id)
    REFERENCES control.content_items(tenant_id, workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, website_connection_id)
    REFERENCES control.platform_connections(tenant_id, workspace_id, id),
  FOREIGN KEY (tenant_id, workspace_id, social_draft_id)
    REFERENCES control.social_drafts(tenant_id, workspace_id, id),
  FOREIGN KEY (tenant_id, workspace_id, social_account_id)
    REFERENCES control.social_accounts(tenant_id, workspace_id, id),
  CHECK (
    (destination = 'website' AND website_connection_id IS NOT NULL
      AND social_draft_id IS NULL AND social_account_id IS NULL)
    OR
    (destination IN ('facebook', 'instagram') AND website_connection_id IS NULL
      AND social_account_id IS NOT NULL)
  ),
  UNIQUE (tenant_id, content_item_id, destination),
  UNIQUE (tenant_id, social_draft_id),
  UNIQUE (tenant_id, id)
);

CREATE INDEX content_items_workspace_updated_idx
  ON control.content_items (tenant_id, workspace_id, updated_at DESC, id DESC);
CREATE INDEX content_variants_item_idx
  ON control.content_item_variants (tenant_id, content_item_id, destination);

ALTER TABLE control.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_items FORCE ROW LEVEL SECURITY;
ALTER TABLE control.content_item_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_item_media FORCE ROW LEVEL SECURITY;
ALTER TABLE control.content_item_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_item_variants FORCE ROW LEVEL SECURITY;

CREATE POLICY content_items_tenant_isolation ON control.content_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY content_item_media_tenant_isolation ON control.content_item_media
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY content_item_variants_tenant_isolation ON control.content_item_variants
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMENT ON TABLE control.content_items IS
  'Shared editorial identity for one workspace/brand; destination publication state remains native and independent.';
COMMENT ON TABLE control.content_item_variants IS
  'Links a Content Item destination to the existing Website Control article or one existing Social draft workflow.';
