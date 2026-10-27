CREATE TABLE control.video_briefs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  program_id text NOT NULL CHECK (program_id IN ('product_faq_ads','daily_news_flash')),
  topic text NOT NULL CHECK (char_length(btrim(topic)) BETWEEN 3 AND 240),
  objective text NOT NULL CHECK (char_length(btrim(objective)) BETWEEN 10 AND 2000),
  audience text NOT NULL CHECK (char_length(btrim(audience)) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review_required','approved','rejected')),
  current_script_revision integer NOT NULL DEFAULT 1 CHECK (current_script_revision > 0),
  created_by uuid NOT NULL REFERENCES control.users(id),
  updated_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,workspace_id,id)
);

CREATE TABLE control.video_brief_evidence (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 12),
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('aggregate_audience_signal','verified_product_fact','approved_editorial_story')
  ),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 240),
  source_reference text NOT NULL CHECK (char_length(btrim(source_reference)) BETWEEN 3 AND 500),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 10 AND 2000),
  aggregate_count integer CHECK (aggregate_count IS NULL OR aggregate_count BETWEEN 2 AND 1000000),
  privacy_class text NOT NULL CHECK (
    privacy_class IN ('aggregated_internal','verified_business_fact','approved_editorial')
  ),
  CHECK (
    (evidence_kind='aggregate_audience_signal'
      AND privacy_class='aggregated_internal' AND aggregate_count IS NOT NULL)
    OR
    (evidence_kind='verified_product_fact'
      AND privacy_class='verified_business_fact' AND aggregate_count IS NULL)
    OR
    (evidence_kind='approved_editorial_story'
      AND privacy_class='approved_editorial' AND aggregate_count IS NULL)
  ),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,brief_id)
    REFERENCES control.video_briefs(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,brief_id,position)
);

CREATE TABLE control.video_script_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  script text NOT NULL CHECK (char_length(btrim(script)) BETWEEN 20 AND 20000),
  content_hash text NOT NULL CHECK (content_hash~'^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,brief_id)
    REFERENCES control.video_briefs(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,brief_id,revision_number)
);

CREATE TABLE control.video_script_approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES control.users(id),
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES control.users(id),
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500),
  approved_content_hash text CHECK (
    approved_content_hash IS NULL OR approved_content_hash~'^[0-9a-f]{64}$'
  ),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  FOREIGN KEY (tenant_id,workspace_id,brief_id)
    REFERENCES control.video_briefs(tenant_id,workspace_id,id),
  FOREIGN KEY (tenant_id,revision_id)
    REFERENCES control.video_script_revisions(tenant_id,id),
  CHECK (
    (decision='pending' AND decided_by IS NULL AND decided_at IS NULL AND approved_content_hash IS NULL)
    OR
    (decision='approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND approved_content_hash IS NOT NULL)
    OR
    (decision='rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND approved_content_hash IS NULL AND char_length(btrim(reason)) BETWEEN 10 AND 500)
  ),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,brief_id,revision_id)
);

CREATE TABLE control.video_command_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  command_name text NOT NULL CHECK (command_name IN (
    'brief.create','script.revise','approval.request','approval.decide'
  )),
  request_hash text NOT NULL CHECK (request_hash~'^[0-9a-f]{64}$'),
  response jsonb NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key)
);

CREATE INDEX video_briefs_queue_idx ON control.video_briefs
  (tenant_id,workspace_id,status,updated_at DESC,id DESC);
CREATE INDEX video_evidence_brief_idx ON control.video_brief_evidence
  (tenant_id,brief_id,position);
CREATE INDEX video_revisions_brief_idx ON control.video_script_revisions
  (tenant_id,brief_id,revision_number DESC);
CREATE INDEX video_approvals_queue_idx ON control.video_script_approvals
  (tenant_id,workspace_id,decision,requested_at DESC,id DESC);

ALTER TABLE control.video_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_briefs FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_brief_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_brief_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_script_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_script_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_script_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_script_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_command_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY video_briefs_tenant_isolation ON control.video_briefs
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_evidence_tenant_isolation ON control.video_brief_evidence
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_revisions_tenant_isolation ON control.video_script_revisions
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_approvals_tenant_isolation ON control.video_script_approvals
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_receipts_tenant_isolation ON control.video_command_receipts
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE TRIGGER video_evidence_immutable
  BEFORE UPDATE OR DELETE ON control.video_brief_evidence
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE TRIGGER video_revisions_immutable
  BEFORE UPDATE OR DELETE ON control.video_script_revisions
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE TRIGGER video_receipts_immutable
  BEFORE UPDATE OR DELETE ON control.video_command_receipts
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();

CREATE TRIGGER guard_active_workzone_video_briefs
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_briefs
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_brief_evidence
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_brief_evidence
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_script_revisions
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_script_revisions
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_script_approvals
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_script_approvals
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_command_receipts
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_command_receipts
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

COMMENT ON TABLE control.video_briefs IS
  'Tenant/workzone-scoped governed video topic briefs; no provider or publication authority.';
COMMENT ON TABLE control.video_brief_evidence IS
  'Immutable minimized evidence. Raw private-message content is not an accepted evidence kind.';
COMMENT ON TABLE control.video_script_revisions IS
  'Immutable scripts; every edit creates a new revision and resets exact-content approval.';
COMMENT ON TABLE control.video_script_approvals IS
  'Human decision for one exact script revision; approval is not render or publication authority.';

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_video;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_video(uuid,uuid,uuid)
  FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  base jsonb;
  video_rows bigint;
  dependency_rows jsonb;
  blocking_rows bigint;
BEGIN
  base:=control.workzone_lifecycle_impact_before_video(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT
    (SELECT count(*) FROM control.video_briefs item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_brief_evidence item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_script_revisions item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_script_approvals item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_command_receipts item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO video_rows;
  blocking_rows:=(base->>'blockingReferenceRows')::bigint+video_rows;
  SELECT jsonb_agg(
    CASE WHEN dependency->>'key'='editorial_content' THEN
      jsonb_set(
        dependency,'{referenceRows}',
        to_jsonb((dependency->>'referenceRows')::bigint+video_rows)
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
  'Same-tenant lifecycle preview including governed video artifacts; it does not authorize a transition.';
