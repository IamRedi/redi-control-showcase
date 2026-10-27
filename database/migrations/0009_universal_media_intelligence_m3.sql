ALTER TABLE control.installation_profiles DROP CONSTRAINT installation_profiles_enabled_modules_check;
ALTER TABLE control.installation_profiles ADD CONSTRAINT installation_profiles_enabled_modules_check
  CHECK (enabled_modules <@ ARRAY['platforms','media','social','websites','unified_content','media_intelligence','context_studio','ai','automations']::text[]);
ALTER TABLE control.installation_entitlements DROP CONSTRAINT installation_entitlements_enabled_modules_check;
ALTER TABLE control.installation_entitlements ADD CONSTRAINT installation_entitlements_enabled_modules_check
  CHECK (enabled_modules <@ ARRAY['platforms','media','social','websites','unified_content','media_intelligence','context_studio','ai','automations']::text[]);

CREATE TABLE control.media_profiles (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160), publication_identity text NOT NULL CHECK (char_length(publication_identity) BETWEEN 1 AND 240),
  locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 35), region text NOT NULL DEFAULT '' CHECK (char_length(region)<=120),
  audience text NOT NULL DEFAULT '' CHECK (char_length(audience)<=1000), categories text[] NOT NULL DEFAULT '{}', tone_rules text NOT NULL DEFAULT '' CHECK (char_length(tone_rules)<=4000),
  excluded_topics text[] NOT NULL DEFAULT '{}', restricted_topics text[] NOT NULL DEFAULT '{}', verification_requirements jsonb NOT NULL DEFAULT '{}',
  destination_preferences text[] NOT NULL DEFAULT '{}', cadence jsonb NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES control.users(id), updated_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id), UNIQUE(tenant_id,workspace_id,id), UNIQUE(tenant_id,workspace_id,name)
);
CREATE TABLE control.source_registry (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, media_profile_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 240), source_type text NOT NULL CHECK (source_type IN ('website','feed','document','database','social','manual','other')),
  canonical_ref text NOT NULL CHECK (char_length(canonical_ref) BETWEEN 1 AND 2000), canonical_domain text NOT NULL DEFAULT '' CHECK (char_length(canonical_domain)<=253),
  tier text NOT NULL CHECK (tier IN ('primary','strong_reporting','discovery')), topics text[] NOT NULL DEFAULT '{}', country text NOT NULL DEFAULT '' CHECK (char_length(country)<=2),
  enabled boolean NOT NULL DEFAULT true, verification_eligible boolean NOT NULL DEFAULT false, provenance jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES control.users(id), updated_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id), FOREIGN KEY (tenant_id,workspace_id,media_profile_id) REFERENCES control.media_profiles(tenant_id,workspace_id,id),
  UNIQUE(tenant_id,workspace_id,id), UNIQUE(tenant_id,workspace_id,canonical_ref)
);
CREATE TABLE control.source_performance_observations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, source_id uuid NOT NULL,
  metric text NOT NULL CHECK(metric IN ('reliability','speed','freshness','trend_relevance','audience_relevance')), value smallint NOT NULL CHECK(value BETWEEN 0 AND 100),
  observation text NOT NULL CHECK(char_length(observation) BETWEEN 1 AND 2000), observed_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,source_id) REFERENCES control.source_registry(tenant_id,workspace_id,id) ON DELETE CASCADE, UNIQUE(tenant_id,id)
);
CREATE TABLE control.research_cases (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, media_profile_id uuid NOT NULL,
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 240), topic text NOT NULL CHECK(char_length(topic) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','researching','ready_for_review','approved','rejected','promoted','archived')),
  freshness_at timestamptz, notes text NOT NULL DEFAULT '' CHECK(char_length(notes)<=10000), created_by uuid NOT NULL REFERENCES control.users(id), updated_by uuid NOT NULL REFERENCES control.users(id),
  approved_by uuid REFERENCES control.users(id), approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id), FOREIGN KEY(tenant_id,workspace_id,media_profile_id) REFERENCES control.media_profiles(tenant_id,workspace_id,id),
  UNIQUE(tenant_id,workspace_id,id)
);
CREATE TABLE control.research_case_sources (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, registry_source_id uuid,
  source_ref text NOT NULL CHECK(char_length(source_ref) BETWEEN 1 AND 2000), title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 500), publisher text NOT NULL DEFAULT '' CHECK(char_length(publisher)<=240),
  publication_at timestamptz, retrieved_at timestamptz NOT NULL, source_type text NOT NULL CHECK(source_type IN ('website','feed','document','database','social','manual','other')),
  tier text NOT NULL CHECK(tier IN ('primary','strong_reporting','discovery')), classification text NOT NULL DEFAULT '' CHECK(char_length(classification)<=240), notes text NOT NULL DEFAULT '' CHECK(char_length(notes)<=4000),
  provenance jsonb NOT NULL, created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,workspace_id,registry_source_id) REFERENCES control.source_registry(tenant_id,workspace_id,id), UNIQUE(tenant_id,research_case_id,id)
);
CREATE TABLE control.research_claims (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL,
  statement text NOT NULL CHECK(char_length(statement) BETWEEN 1 AND 4000), importance text NOT NULL CHECK(importance IN ('low','medium','high','critical')),
  verification_state text NOT NULL DEFAULT 'unverified' CHECK(verification_state IN ('verified','partially_verified','developing','unverified','conflicting','stale')),
  verification_explanation text NOT NULL CHECK(char_length(verification_explanation) BETWEEN 1 AND 4000), conflict_notes text NOT NULL DEFAULT '' CHECK(char_length(conflict_notes)<=4000),
  created_by uuid NOT NULL REFERENCES control.users(id), updated_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id) ON DELETE CASCADE, UNIQUE(tenant_id,research_case_id,id)
);
CREATE TABLE control.research_evidence (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, claim_id uuid NOT NULL, case_source_id uuid NOT NULL,
  relationship text NOT NULL CHECK(relationship IN ('supports','contradicts','mentions','primary_evidence')), notes text NOT NULL DEFAULT '' CHECK(char_length(notes)<=2000),
  created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,research_case_id,claim_id) REFERENCES control.research_claims(tenant_id,research_case_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,research_case_id,case_source_id) REFERENCES control.research_case_sources(tenant_id,research_case_id,id) ON DELETE CASCADE,
  UNIQUE(tenant_id,claim_id,case_source_id,relationship), UNIQUE(tenant_id,id)
);
CREATE TABLE control.editorial_candidates (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL,
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 240), summary text NOT NULL DEFAULT '' CHECK(char_length(summary)<=2000), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready_for_review','approved','rejected','promoted')),
  ranking jsonb NOT NULL DEFAULT '{}', ranking_explanation text NOT NULL CHECK(char_length(ranking_explanation) BETWEEN 1 AND 4000),
  created_by uuid NOT NULL REFERENCES control.users(id), approved_by uuid REFERENCES control.users(id), approved_at timestamptz, content_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,workspace_id,content_item_id) REFERENCES control.content_items(tenant_id,workspace_id,id), UNIQUE(tenant_id,research_case_id,id), UNIQUE(tenant_id,content_item_id)
);

CREATE INDEX research_cases_workspace_idx ON control.research_cases(tenant_id,workspace_id,updated_at DESC);
CREATE INDEX research_sources_case_idx ON control.research_case_sources(tenant_id,research_case_id);
CREATE INDEX research_claims_case_idx ON control.research_claims(tenant_id,research_case_id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['media_profiles','source_registry','source_performance_observations','research_cases','research_case_sources','research_claims','research_evidence','editorial_candidates'] LOOP
  EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I_tenant_isolation ON control.%I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
END LOOP; END $$;

COMMENT ON TABLE control.source_performance_observations IS 'Explainable human observations; metric values are prioritization aids and never truth scores.';
COMMENT ON TABLE control.research_case_sources IS 'External material is untrusted evidence with preserved retrieval provenance; no fetched full text is stored.';
COMMENT ON TABLE control.editorial_candidates IS 'Manual prioritization and approval bridge from research to Unified Content; never autonomous publication.';
