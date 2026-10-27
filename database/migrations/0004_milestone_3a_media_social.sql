CREATE TYPE control.media_status AS ENUM (
  'uploading', 'quarantined', 'processing', 'ready', 'rejected', 'failed',
  'pending_deletion', 'deleted'
);
CREATE TYPE control.upload_status AS ENUM (
  'initiated', 'uploading', 'uploaded', 'finalized', 'expired', 'cancelled'
);
CREATE TYPE control.social_provider AS ENUM ('meta', 'youtube', 'tiktok');
CREATE TYPE control.social_account_status AS ENUM (
  'pending', 'active', 'degraded', 'reauthorization_required', 'disabled', 'revoked'
);
CREATE TYPE control.social_draft_status AS ENUM (
  'draft', 'ready_for_review', 'approved', 'rejected', 'scheduled', 'queued',
  'publishing', 'published', 'partial', 'failed', 'retry_scheduled',
  'needs_reauthorization', 'cancelled'
);
CREATE TYPE control.publication_attempt_status AS ENUM (
  'queued', 'publishing', 'published', 'failed', 'retry_scheduled',
  'needs_reauthorization', 'cancelled'
);

CREATE TABLE control.media_assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES control.users(id),
  source text NOT NULL DEFAULT 'user_upload'
    CHECK (source IN ('user_upload', 'connector_import', 'generated_local')),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  status control.media_status NOT NULL DEFAULT 'uploading',
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'scanning', 'processing', 'ready', 'rejected', 'failed')),
  retention_class text NOT NULL DEFAULT 'standard'
    CHECK (retention_class IN ('temporary', 'standard', 'legal_hold')),
  retention_until timestamptz,
  soft_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.media_objects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  asset_id uuid NOT NULL,
  object_kind text NOT NULL CHECK (object_kind IN ('original', 'thumbnail', 'preview', 'channel_variant')),
  object_key text NOT NULL CHECK (object_key ~ '^tenant/[0-9a-f-]{36}/media/[0-9a-f-]{36}/[a-z0-9._-]+$'),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  derived_from_id uuid REFERENCES control.media_objects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES control.media_assets(tenant_id, id),
  UNIQUE (tenant_id, object_key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.media_upload_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  object_key text NOT NULL,
  upload_mode text NOT NULL CHECK (upload_mode IN ('single', 'multipart')),
  expected_mime_type text NOT NULL,
  expected_size_bytes bigint NOT NULL CHECK (expected_size_bytes > 0),
  expected_checksum_sha256 text NOT NULL CHECK (expected_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  part_size_bytes integer CHECK (part_size_bytes IS NULL OR part_size_bytes >= 262144),
  multipart_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status control.upload_status NOT NULL DEFAULT 'initiated',
  expires_at timestamptz NOT NULL,
  finalized_at timestamptz,
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES control.business_workspaces(tenant_id, id),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES control.media_assets(tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, object_key)
);

CREATE TABLE control.media_usage_references (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  asset_id uuid NOT NULL,
  usage_type text NOT NULL CHECK (usage_type IN ('social_draft', 'published_social', 'manual')),
  usage_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES control.media_assets(tenant_id, id),
  UNIQUE (tenant_id, asset_id, usage_type, usage_reference)
);

CREATE TABLE control.media_deletion_workflows (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  asset_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES control.users(id),
  status text NOT NULL CHECK (status IN ('requested', 'blocked_by_usage', 'deleting', 'completed', 'failed')),
  safe_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (tenant_id, asset_id) REFERENCES control.media_assets(tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.oauth_transactions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES control.users(id),
  provider control.social_provider NOT NULL,
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  pkce_verifier_reference text CHECK (
    pkce_verifier_reference IS NULL OR pkce_verifier_reference ~ '^secret://[a-zA-Z0-9/_-]{3,240}$'
  ),
  redirect_uri text NOT NULL,
  requested_scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.social_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  provider control.social_provider NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('facebook_page', 'instagram_account', 'youtube_channel', 'tiktok_account')),
  provider_account_id text NOT NULL,
  display_name text NOT NULL,
  authorized_scopes text[] NOT NULL DEFAULT '{}',
  token_reference text NOT NULL CHECK (token_reference ~ '^secret://[a-zA-Z0-9/_-]{3,240}$'),
  token_expires_at timestamptz,
  refresh_status text NOT NULL DEFAULT 'current'
    CHECK (refresh_status IN ('current', 'refresh_due', 'refresh_failed', 'revoked')),
  status control.social_account_status NOT NULL DEFAULT 'pending',
  health_status control.connector_health_status NOT NULL DEFAULT 'unknown',
  last_synced_at timestamptz,
  last_successful_publish_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, provider, provider_account_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.social_drafts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES control.users(id),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  status control.social_draft_status NOT NULL DEFAULT 'draft',
  scheduled_for timestamptz,
  schedule_timezone text,
  cancellation_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.social_draft_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  draft_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title text,
  caption text,
  description text,
  media_attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  channel_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES control.social_drafts(tenant_id, id),
  UNIQUE (tenant_id, draft_id, revision_number),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.social_draft_targets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  draft_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  account_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('facebook', 'instagram', 'youtube', 'tiktok')),
  status control.publication_attempt_status NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES control.social_drafts(tenant_id, id),
  FOREIGN KEY (tenant_id, revision_id) REFERENCES control.social_draft_revisions(tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES control.social_accounts(tenant_id, id),
  UNIQUE (tenant_id, draft_id, revision_id, account_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE control.social_approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  draft_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES control.users(id),
  decided_by uuid REFERENCES control.users(id),
  decision text NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected')),
  approved_content_hash text,
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  FOREIGN KEY (tenant_id, draft_id) REFERENCES control.social_drafts(tenant_id, id),
  FOREIGN KEY (tenant_id, revision_id) REFERENCES control.social_draft_revisions(tenant_id, id),
  UNIQUE (tenant_id, draft_id, revision_id)
);

CREATE TABLE control.publication_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  draft_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  target_id uuid NOT NULL,
  account_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status control.publication_attempt_status NOT NULL DEFAULT 'queued',
  provider_reference text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  failure_category text CHECK (failure_category IN ('authorization', 'validation', 'rate_limited', 'transient', 'provider', 'disabled')),
  safe_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, draft_id) REFERENCES control.social_drafts(tenant_id, id),
  FOREIGN KEY (tenant_id, revision_id) REFERENCES control.social_draft_revisions(tenant_id, id),
  FOREIGN KEY (tenant_id, target_id) REFERENCES control.social_draft_targets(tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES control.social_accounts(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);

CREATE FUNCTION control.reject_social_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'social_draft_revisions are immutable';
END;
$$;
CREATE TRIGGER social_revisions_immutable
  BEFORE UPDATE OR DELETE ON control.social_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION control.reject_social_revision_mutation();

ALTER TABLE control.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE control.media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.media_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE control.media_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.media_upload_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE control.media_usage_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.media_usage_references FORCE ROW LEVEL SECURITY;
ALTER TABLE control.media_deletion_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.media_deletion_workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE control.oauth_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.oauth_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE control.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.social_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE control.social_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.social_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE control.social_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.social_draft_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE control.social_draft_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.social_draft_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE control.social_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.social_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE control.publication_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.publication_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY media_assets_tenant_isolation ON control.media_assets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_objects_tenant_isolation ON control.media_objects
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_uploads_tenant_isolation ON control.media_upload_sessions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_usage_tenant_isolation ON control.media_usage_references
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY media_deletion_tenant_isolation ON control.media_deletion_workflows
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY oauth_transactions_tenant_isolation ON control.oauth_transactions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY social_accounts_tenant_isolation ON control.social_accounts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY social_drafts_tenant_isolation ON control.social_drafts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY social_revisions_tenant_isolation ON control.social_draft_revisions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY social_targets_tenant_isolation ON control.social_draft_targets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY social_approvals_tenant_isolation ON control.social_approvals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY publication_attempts_tenant_isolation ON control.publication_attempts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX media_assets_workspace_idx ON control.media_assets (tenant_id, workspace_id, created_at DESC);
CREATE INDEX upload_sessions_expiry_idx ON control.media_upload_sessions (expires_at) WHERE status IN ('initiated', 'uploading', 'uploaded');
CREATE INDEX social_accounts_workspace_idx ON control.social_accounts (tenant_id, workspace_id, provider);
CREATE INDEX social_drafts_schedule_idx ON control.social_drafts (scheduled_for) WHERE status IN ('scheduled', 'retry_scheduled');
CREATE INDEX publication_attempt_status_idx ON control.publication_attempts (tenant_id, status, created_at);

COMMENT ON COLUMN control.social_accounts.token_reference IS 'Secret-provider reference only; token material is forbidden.';
COMMENT ON TABLE control.social_draft_revisions IS 'Immutable content revisions; editing creates a new revision and resets approval.';
