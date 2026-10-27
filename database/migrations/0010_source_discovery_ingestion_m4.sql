ALTER TABLE control.research_case_sources
  ADD COLUMN author text NOT NULL DEFAULT '' CHECK (char_length(author) <= 240),
  ADD COLUMN summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 12000),
  ADD COLUMN extracted_material text NOT NULL DEFAULT '' CHECK (char_length(extracted_material) <= 100000),
  ADD COLUMN discovery_method text NOT NULL DEFAULT 'manual' CHECK (discovery_method IN ('manual','search','rss','api_feed')),
  ADD COLUMN normalized_url text NOT NULL DEFAULT '' CHECK (char_length(normalized_url) <= 2000),
  ADD COLUMN content_fingerprint text NOT NULL DEFAULT '' CHECK (char_length(content_fingerprint) <= 128),
  ADD COLUMN retrieval_status text NOT NULL DEFAULT 'succeeded' CHECK (retrieval_status IN ('pending','running','succeeded','failed','cancelled')),
  ADD COLUMN retrieval_error text NOT NULL DEFAULT '' CHECK (char_length(retrieval_error) <= 2000);
ALTER TABLE control.research_case_sources
  ADD CONSTRAINT research_case_sources_tenant_id_unique UNIQUE (tenant_id,id);

CREATE TABLE control.source_provider_configurations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  provider_id text NOT NULL CHECK (provider_id ~ '^[a-z][a-z0-9._-]{1,80}$'),
  provider_kind text NOT NULL CHECK (provider_kind IN ('search','api_feed')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  secret_reference text CHECK (secret_reference IS NULL OR secret_reference ~ '^secret://[a-zA-Z0-9/_-]{3,240}$'),
  configuration jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE (tenant_id,workspace_id,id),
  UNIQUE (tenant_id,workspace_id,provider_id)
);

CREATE TABLE control.source_feeds (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  registry_source_id uuid NOT NULL,
  feed_url text NOT NULL CHECK (char_length(feed_url) BETWEEN 1 AND 2000),
  normalized_url text NOT NULL CHECK (char_length(normalized_url) BETWEEN 1 AND 2000),
  enabled boolean NOT NULL DEFAULT true,
  last_retrieved_at timestamptz,
  last_status text NOT NULL DEFAULT 'never' CHECK (last_status IN ('never','pending','running','succeeded','failed','cancelled')),
  last_error text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 2000),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,registry_source_id) REFERENCES control.source_registry(tenant_id,workspace_id,id) ON DELETE CASCADE,
  UNIQUE (tenant_id,workspace_id,id),
  UNIQUE (tenant_id,workspace_id,normalized_url)
);

CREATE TABLE control.discovery_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  research_case_id uuid,
  method text NOT NULL CHECK (method IN ('manual','search','rss','api_feed')),
  provider_id text NOT NULL DEFAULT 'manual',
  query text NOT NULL DEFAULT '' CHECK (char_length(query) <= 1000),
  requested_url text NOT NULL DEFAULT '' CHECK (char_length(requested_url) <= 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  error_code text NOT NULL DEFAULT '' CHECK (char_length(error_code) <= 120),
  error_detail text NOT NULL DEFAULT '' CHECK (char_length(error_detail) <= 2000),
  cancellation_requested boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES control.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id),
  FOREIGN KEY (tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,workspace_id,id),
  UNIQUE (tenant_id,workspace_id,idempotency_key)
);

CREATE TABLE control.discovery_results (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  discovery_run_id uuid NOT NULL,
  provider_result_id text NOT NULL DEFAULT '' CHECK (char_length(provider_result_id) <= 240),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 1 AND 2000),
  canonical_url text NOT NULL CHECK (char_length(canonical_url) BETWEEN 1 AND 2000),
  normalized_url text NOT NULL CHECK (char_length(normalized_url) BETWEEN 1 AND 2000),
  publisher text NOT NULL DEFAULT '' CHECK (char_length(publisher) <= 240),
  author text NOT NULL DEFAULT '' CHECK (char_length(author) <= 240),
  snippet text NOT NULL DEFAULT '' CHECK (char_length(snippet) <= 12000),
  extracted_material text NOT NULL DEFAULT '' CHECK (char_length(extracted_material) <= 100000),
  publication_at timestamptz,
  retrieved_at timestamptz,
  content_fingerprint text NOT NULL DEFAULT '' CHECK (char_length(content_fingerprint) <= 128),
  provider_metadata jsonb NOT NULL DEFAULT '{}',
  provenance jsonb NOT NULL DEFAULT '{}',
  retrieval_status text NOT NULL DEFAULT 'pending' CHECK (retrieval_status IN ('pending','running','succeeded','failed','cancelled')),
  retrieval_error text NOT NULL DEFAULT '' CHECK (char_length(retrieval_error) <= 2000),
  attached_case_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,discovery_run_id) REFERENCES control.discovery_runs(tenant_id,workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,attached_case_source_id) REFERENCES control.research_case_sources(tenant_id,id),
  UNIQUE (tenant_id,discovery_run_id,id),
  UNIQUE (tenant_id,discovery_run_id,normalized_url)
);

CREATE TABLE control.provider_usage_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  discovery_run_id uuid,
  provider_id text NOT NULL CHECK (char_length(provider_id) BETWEEN 1 AND 120),
  operation text NOT NULL CHECK (operation IN ('search','retrieve_url','retrieve_feed','api_feed')),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count BETWEEN 0 AND 100000),
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count BETWEEN 0 AND 1000000),
  estimated_cost numeric(14,6),
  actual_cost numeric(14,6),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id),
  FOREIGN KEY (tenant_id,workspace_id,discovery_run_id) REFERENCES control.discovery_runs(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,id)
);

CREATE INDEX discovery_runs_queue_idx ON control.discovery_runs(tenant_id,workspace_id,created_at DESC);
CREATE INDEX discovery_results_run_idx ON control.discovery_results(tenant_id,discovery_run_id,created_at);
CREATE INDEX provider_usage_workspace_idx ON control.provider_usage_events(tenant_id,workspace_id,recorded_at DESC);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['source_provider_configurations','source_feeds','discovery_runs','discovery_results','provider_usage_events'] LOOP
  EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I_tenant_isolation ON control.%I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
END LOOP; END $$;

CREATE OR REPLACE FUNCTION control.claim_source_ingestion_job(p_worker_id text)
RETURNS TABLE(id uuid, tenant_id uuid, job_type text, payload jsonb, attempt_count integer, max_attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, control AS $$
  UPDATE control.jobs job SET status='running',locked_at=now(),locked_by=p_worker_id,attempt_count=job.attempt_count+1,updated_at=now()
  WHERE job.id=(SELECT candidate.id FROM control.jobs candidate WHERE candidate.job_type='source.ingestion' AND candidate.status IN ('pending','failed') AND candidate.available_at<=now() AND candidate.attempt_count<candidate.max_attempts ORDER BY candidate.available_at,candidate.created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING job.id,job.tenant_id,job.job_type,job.payload,job.attempt_count,job.max_attempts;
$$;
REVOKE ALL ON FUNCTION control.claim_source_ingestion_job(text) FROM PUBLIC;

COMMENT ON TABLE control.discovery_results IS 'Untrusted discovery material. Presence never implies verification or editorial truth.';
COMMENT ON COLUMN control.research_case_sources.extracted_material IS 'Bounded untrusted source text retained for human research; never executable instructions.';
