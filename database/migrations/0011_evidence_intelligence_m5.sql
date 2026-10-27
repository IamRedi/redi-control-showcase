CREATE TABLE control.ai_model_routes (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('claim_extraction','evidence_comparison','factual_synthesis','grounding_validation')),
  provider_id text NOT NULL CHECK(char_length(provider_id) BETWEEN 1 AND 120), model text NOT NULL CHECK(char_length(model) BETWEEN 1 AND 160),
  prompt_version text NOT NULL CHECK(char_length(prompt_version) BETWEEN 1 AND 80), max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 64 AND 32000), enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id), UNIQUE(tenant_id,workspace_id,operation), UNIQUE(tenant_id,id)
);
CREATE TABLE control.ai_budget_policies (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL,
  daily_cost_limit numeric(14,6) NOT NULL CHECK(daily_cost_limit>=0), monthly_cost_limit numeric(14,6) NOT NULL CHECK(monthly_cost_limit>=0),
  maximum_concurrency integer NOT NULL CHECK(maximum_concurrency BETWEEN 1 AND 50), enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id), UNIQUE(tenant_id,workspace_id), UNIQUE(tenant_id,id)
);
CREATE TABLE control.ai_runs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('claim_extraction','evidence_comparison','factual_synthesis','grounding_validation')),
  provider_id text NOT NULL, model text NOT NULL, prompt_version text NOT NULL, idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 240), request_hash text NOT NULL CHECK(char_length(request_hash)=64),
  status text NOT NULL CHECK(status IN ('running','succeeded','failed')), safe_error text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  actor_user_id uuid NOT NULL REFERENCES control.users(id), correlation_id text NOT NULL, provider_request_id text, structured_result jsonb,
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id), UNIQUE(tenant_id,workspace_id,operation,idempotency_key), UNIQUE(tenant_id,id)
);
CREATE TABLE control.ai_usage_events (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, ai_run_id uuid NOT NULL,
  operation text NOT NULL, provider_id text NOT NULL, model text NOT NULL, input_tokens integer NOT NULL CHECK(input_tokens>=0), output_tokens integer NOT NULL CHECK(output_tokens>=0),
  estimated_cost numeric(14,6) NOT NULL DEFAULT 0 CHECK(estimated_cost>=0), actual_cost numeric(14,6) CHECK(actual_cost>=0), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,ai_run_id) REFERENCES control.ai_runs(tenant_id,id), FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE control.research_claim_proposals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, ai_run_id uuid NOT NULL,
  statement text NOT NULL CHECK(char_length(statement) BETWEEN 1 AND 4000), importance text NOT NULL CHECK(importance IN ('low','medium','high','critical')),
  proposed_verification_state text NOT NULL CHECK(proposed_verification_state IN ('verified','partially_verified','developing','unverified','conflicting','stale')),
  explanation text NOT NULL CHECK(char_length(explanation) BETWEEN 1 AND 4000), uncertainty text NOT NULL DEFAULT '' CHECK(char_length(uncertainty)<=4000),
  decision text NOT NULL DEFAULT 'proposed' CHECK(decision IN ('proposed','accepted','rejected')), decided_by uuid REFERENCES control.users(id), decided_at timestamptz, accepted_claim_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id), FOREIGN KEY(tenant_id,ai_run_id) REFERENCES control.ai_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,research_case_id,accepted_claim_id) REFERENCES control.research_claims(tenant_id,research_case_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE control.research_evidence_proposals (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, claim_proposal_id uuid NOT NULL, case_source_id uuid NOT NULL,
  relationship text NOT NULL CHECK(relationship IN ('supports','contradicts','mentions','primary_evidence')), notes text NOT NULL DEFAULT '' CHECK(char_length(notes)<=2000),
  decision text NOT NULL DEFAULT 'proposed' CHECK(decision IN ('proposed','accepted','rejected')), decided_by uuid REFERENCES control.users(id), decided_at timestamptz, accepted_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,claim_proposal_id) REFERENCES control.research_claim_proposals(tenant_id,id), FOREIGN KEY(tenant_id,research_case_id,case_source_id) REFERENCES control.research_case_sources(tenant_id,research_case_id,id),
  FOREIGN KEY(tenant_id,accepted_evidence_id) REFERENCES control.research_evidence(tenant_id,id), UNIQUE(tenant_id,claim_proposal_id,case_source_id,relationship), UNIQUE(tenant_id,id)
);
CREATE TABLE control.evidence_packs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  snapshot jsonb NOT NULL, snapshot_hash text NOT NULL CHECK(char_length(snapshot_hash)=64), unresolved_conflicts integer NOT NULL CHECK(unresolved_conflicts>=0),
  created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id), UNIQUE(tenant_id,research_case_id,version), UNIQUE(tenant_id,id)
);
CREATE TABLE control.factual_syntheses (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, evidence_pack_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  synthesis jsonb NOT NULL, validation jsonb NOT NULL, approval_ready boolean NOT NULL, generation_run_id uuid NOT NULL, validation_run_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,evidence_pack_id) REFERENCES control.evidence_packs(tenant_id,id), FOREIGN KEY(tenant_id,generation_run_id) REFERENCES control.ai_runs(tenant_id,id), FOREIGN KEY(tenant_id,validation_run_id) REFERENCES control.ai_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id), UNIQUE(tenant_id,research_case_id,version), UNIQUE(tenant_id,id)
);
CREATE TABLE control.synthesis_promotions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL, synthesis_id uuid NOT NULL, content_item_id uuid NOT NULL,
  promoted_by uuid NOT NULL REFERENCES control.users(id), promoted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,synthesis_id) REFERENCES control.factual_syntheses(tenant_id,id), FOREIGN KEY(tenant_id,workspace_id,content_item_id) REFERENCES control.content_items(tenant_id,workspace_id,id), UNIQUE(tenant_id,synthesis_id), UNIQUE(tenant_id,content_item_id), UNIQUE(tenant_id,id)
);

CREATE INDEX ai_usage_budget_idx ON control.ai_usage_events(tenant_id,workspace_id,created_at);
CREATE INDEX ai_runs_case_idx ON control.ai_runs(tenant_id,research_case_id,started_at DESC);
CREATE INDEX claim_proposals_case_idx ON control.research_claim_proposals(tenant_id,research_case_id,created_at);
CREATE INDEX evidence_packs_case_idx ON control.evidence_packs(tenant_id,research_case_id,version DESC);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ai_model_routes','ai_budget_policies','ai_runs','ai_usage_events','research_claim_proposals','research_evidence_proposals','evidence_packs','factual_syntheses','synthesis_promotions'] LOOP
  EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I_tenant_isolation ON control.%I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
END LOOP; END $$;

CREATE FUNCTION control.prevent_immutable_research_artifact_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_RESEARCH_ARTIFACT'; END $$;
CREATE TRIGGER evidence_packs_immutable BEFORE UPDATE OR DELETE ON control.evidence_packs FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE TRIGGER factual_syntheses_immutable BEFORE UPDATE OR DELETE ON control.factual_syntheses FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();

COMMENT ON TABLE control.evidence_packs IS 'Immutable, versioned snapshot of human-approved evidence used as the sole factual generation context.';
COMMENT ON TABLE control.factual_syntheses IS 'Immutable synthesis plus independent grounding-validator result; approval_ready is false for unsupported material claims.';
COMMENT ON TABLE control.research_claim_proposals IS 'AI output is a proposal only. Human decision is mandatory before it can become a Research Claim.';
