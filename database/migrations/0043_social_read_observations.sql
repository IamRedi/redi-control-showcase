-- Read-only provider observations. These rows deliberately contain no access
-- token, message body, recipient identity, draft, publication or webhook data.
CREATE TABLE control.social_metric_observations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  account_id uuid NOT NULL,
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z0-9_]{1,96}$'),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  value numeric(20,4) NOT NULL,
  source text NOT NULL DEFAULT 'meta_graph' CHECK (source='meta_graph'),
  provider_reported_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id) REFERENCES control.business_workspaces(tenant_id,id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES control.social_accounts(tenant_id,id),
  UNIQUE (tenant_id,account_id,metric_key,period_start,period_end),
  UNIQUE (tenant_id,id),
  CHECK (period_end>period_start)
);

CREATE INDEX social_metric_observations_dashboard_idx
  ON control.social_metric_observations
  (tenant_id,workspace_id,account_id,period_end DESC,metric_key);

ALTER TABLE control.social_metric_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.social_metric_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY social_metric_observations_tenant_isolation
  ON control.social_metric_observations
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

COMMENT ON TABLE control.social_metric_observations IS
  'Date-bounded, provider-returned read-only social metrics. No estimated values, content text, messages or publication state.';
