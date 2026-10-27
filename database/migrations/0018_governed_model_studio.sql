CREATE TABLE control.ai_route_proposals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN (
    'claim_extraction','evidence_comparison','factual_synthesis',
    'grounding_validation','editorial_transformation',
    'editorial_grounding_validation','editorial_image_generation',
    'channel_adaptation'
  )),
  provider_id text NOT NULL CHECK (char_length(provider_id) BETWEEN 1 AND 120),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 160),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 64 AND 32000),
  data_policy_status text NOT NULL CHECK (
    data_policy_status IN ('unreviewed','approved','rejected')
  ),
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workspace_id, id)
);

CREATE TABLE control.ai_route_evaluations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  dataset_version text NOT NULL CHECK (char_length(dataset_version) BETWEEN 1 AND 120),
  sample_size integer NOT NULL CHECK (sample_size BETWEEN 1 AND 100000),
  schema_pass_rate numeric(5,2) NOT NULL CHECK (schema_pass_rate BETWEEN 0 AND 100),
  grounding_pass_rate numeric(5,2) NOT NULL CHECK (grounding_pass_rate BETWEEN 0 AND 100),
  safety_pass_rate numeric(5,2) NOT NULL CHECK (safety_pass_rate BETWEEN 0 AND 100),
  language_pass_rate numeric(5,2) NOT NULL CHECK (language_pass_rate BETWEEN 0 AND 100),
  decision text NOT NULL CHECK (decision IN ('passed','failed')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  evaluated_by uuid NOT NULL REFERENCES control.users(id),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id, proposal_id)
    REFERENCES control.ai_route_proposals(tenant_id, workspace_id, id),
  UNIQUE (tenant_id, id)
);

CREATE INDEX ai_route_proposals_workspace_idx
  ON control.ai_route_proposals
  (tenant_id, workspace_id, operation, created_at DESC, id DESC);
CREATE INDEX ai_route_evaluations_proposal_idx
  ON control.ai_route_evaluations
  (tenant_id, proposal_id, evaluated_at DESC, id DESC);

ALTER TABLE control.ai_route_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.ai_route_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE control.ai_route_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.ai_route_evaluations FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_route_proposals_tenant_isolation
  ON control.ai_route_proposals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY ai_route_evaluations_tenant_isolation
  ON control.ai_route_evaluations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER ai_route_proposals_immutable
  BEFORE UPDATE OR DELETE ON control.ai_route_proposals
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE TRIGGER ai_route_evaluations_immutable
  BEFORE UPDATE OR DELETE ON control.ai_route_evaluations
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();

COMMENT ON TABLE control.ai_route_proposals IS
  'Immutable candidate route metadata for governed review; it never changes the active runtime route.';
COMMENT ON TABLE control.ai_route_evaluations IS
  'Immutable human-recorded evaluation evidence for one route proposal; it is not activation authorization.';
