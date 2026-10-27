CREATE TABLE control.video_generation_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  provider_id text NOT NULL CHECK (provider_id='heygen'),
  daily_credit_limit integer NOT NULL CHECK (daily_credit_limit BETWEEN 0 AND 1000000),
  monthly_credit_limit integer NOT NULL CHECK (monthly_credit_limit BETWEEN 0 AND 10000000),
  maximum_concurrency smallint NOT NULL CHECK (maximum_concurrency BETWEEN 1 AND 20),
  billing_timezone text NOT NULL DEFAULT 'UTC' CHECK (billing_timezone='UTC'),
  enabled boolean NOT NULL DEFAULT false,
  configured_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,workspace_id,provider_id)
);

ALTER TABLE control.video_render_outputs
  ADD CONSTRAINT video_render_outputs_preparation_id_unique
  UNIQUE (tenant_id,preparation_id,id);

CREATE TABLE control.video_render_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  output_id uuid NOT NULL,
  provider_id text NOT NULL CHECK (provider_id='heygen'),
  status text NOT NULL DEFAULT 'reserved' CHECK (
    status IN ('reserved','submitting','submitted','succeeded','failed','cancelled')
  ),
  reservation_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash~'^[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  reserved_credits integer NOT NULL CHECK (reserved_credits BETWEEN 1 AND 1000000),
  actual_credits integer CHECK (actual_credits IS NULL OR actual_credits BETWEEN 0 AND 1000000),
  provider_request_id text CHECK (
    provider_request_id IS NULL OR char_length(provider_request_id) BETWEEN 1 AND 200
  ),
  safe_failure_code text CHECK (
    safe_failure_code IS NULL OR safe_failure_code~'^[A-Z][A-Z0-9_]{2,79}$'
  ),
  requested_by uuid NOT NULL REFERENCES control.users(id),
  correlation_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,preparation_id)
    REFERENCES control.video_render_preparations(tenant_id,workspace_id,id),
  FOREIGN KEY (tenant_id,preparation_id,output_id)
    REFERENCES control.video_render_outputs(tenant_id,preparation_id,id),
  CHECK (
    (status IN ('reserved','submitting') AND submitted_at IS NULL AND completed_at IS NULL AND provider_request_id IS NULL)
    OR (status='submitted' AND submitted_at IS NOT NULL AND completed_at IS NULL AND provider_request_id IS NOT NULL)
    OR (status='succeeded' AND submitted_at IS NOT NULL AND completed_at IS NOT NULL AND provider_request_id IS NOT NULL AND safe_failure_code IS NULL)
    OR (status='failed' AND completed_at IS NOT NULL AND safe_failure_code IS NOT NULL)
    OR (status='cancelled' AND submitted_at IS NULL AND completed_at IS NOT NULL AND provider_request_id IS NULL)
  ),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,output_id),
  UNIQUE (tenant_id,preparation_id,reservation_key,output_id),
  UNIQUE (tenant_id,provider_id,idempotency_key)
);

CREATE TABLE control.video_generation_usage_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  provider_id text NOT NULL CHECK (provider_id='heygen'),
  event_type text NOT NULL CHECK (event_type IN ('reserved','reconciled','released')),
  credits integer NOT NULL CHECK (credits BETWEEN 0 AND 1000000),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,render_job_id)
    REFERENCES control.video_render_jobs(tenant_id,id),
  FOREIGN KEY (tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,render_job_id,event_type)
);

CREATE INDEX video_render_jobs_claim_idx ON control.video_render_jobs
  (tenant_id,provider_id,status,reserved_at,id)
  WHERE status IN ('reserved','submitting','submitted');
CREATE INDEX video_generation_usage_budget_idx ON control.video_generation_usage_events
  (tenant_id,workspace_id,provider_id,recorded_at);

ALTER TABLE control.video_generation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_generation_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_render_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_generation_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_generation_usage_events FORCE ROW LEVEL SECURITY;

CREATE POLICY video_generation_policies_tenant_isolation
  ON control.video_generation_policies
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_render_jobs_tenant_isolation
  ON control.video_render_jobs
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_generation_usage_events_tenant_isolation
  ON control.video_generation_usage_events
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE TRIGGER video_generation_usage_events_immutable
  BEFORE UPDATE OR DELETE ON control.video_generation_usage_events
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();

CREATE TRIGGER guard_active_workzone_video_generation_policies
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_generation_policies
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_render_jobs
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_render_jobs
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_generation_usage_events
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_generation_usage_events
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

COMMENT ON TABLE control.video_generation_policies IS
  'Per-workzone provider credit and concurrency limits. A policy does not accept or connect a provider.';
COMMENT ON TABLE control.video_render_jobs IS
  'One internal render lifecycle per prepared output; reservation does not grant provider execution or publication authority.';
COMMENT ON TABLE control.video_generation_usage_events IS
  'Immutable credit reservation and reconciliation ledger for video generation.';

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_video_jobs;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_video_jobs(uuid,uuid,uuid)
  FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  base jsonb;
  video_job_rows bigint;
  dependency_rows jsonb;
  blocking_rows bigint;
BEGIN
  base:=control.workzone_lifecycle_impact_before_video_jobs(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT
    (SELECT count(*) FROM control.video_generation_policies item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_render_jobs item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_generation_usage_events item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO video_job_rows;
  blocking_rows:=(base->>'blockingReferenceRows')::bigint+video_job_rows;
  SELECT jsonb_agg(
    CASE WHEN dependency->>'key'='editorial_content' THEN
      jsonb_set(
        dependency,'{referenceRows}',
        to_jsonb((dependency->>'referenceRows')::bigint+video_job_rows)
      )
    ELSE dependency END
  ) INTO dependency_rows
  FROM jsonb_array_elements(base->'dependencies') dependency;
  RETURN jsonb_set(
    jsonb_set(
      jsonb_set(base,'{blockingReferenceRows}',to_jsonb(blocking_rows)),
      '{hasBlockingReferences}',to_jsonb(blocking_rows>0)
    ),
    '{dependencies}',dependency_rows
  );
END $$;

REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid) FROM PUBLIC;
COMMENT ON FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid) IS
  'Same-tenant lifecycle preview including video job and usage accounting rows; it does not authorize a transition.';
