CREATE TABLE control.video_render_preparations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  brief_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  presentation_mode text NOT NULL CHECK (
    presentation_mode IN ('presenter_explainer','news_anchor')
  ),
  target_language text NOT NULL CHECK (target_language IN ('en','de','sq')),
  max_duration_seconds smallint NOT NULL CHECK (max_duration_seconds BETWEEN 15 AND 180),
  rights_reference text NOT NULL CHECK (
    char_length(btrim(rights_reference)) BETWEEN 3 AND 500
  ),
  status text NOT NULL DEFAULT 'blocked' CHECK (status='blocked'),
  block_code text NOT NULL DEFAULT 'provider_not_accepted' CHECK (
    block_code='provider_not_accepted'
  ),
  requested_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,brief_id)
    REFERENCES control.video_briefs(tenant_id,workspace_id,id),
  FOREIGN KEY (tenant_id,revision_id)
    REFERENCES control.video_script_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,approval_id)
    REFERENCES control.video_script_approvals(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,workspace_id,id),
  UNIQUE (tenant_id,brief_id,revision_id)
);

CREATE TABLE control.video_render_outputs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 2),
  aspect_ratio text NOT NULL CHECK (aspect_ratio IN ('9:16','16:9')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,preparation_id)
    REFERENCES control.video_render_preparations(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,preparation_id,position),
  UNIQUE (tenant_id,preparation_id,aspect_ratio)
);

CREATE INDEX video_render_queue_idx ON control.video_render_preparations
  (tenant_id,workspace_id,status,created_at DESC,id DESC);

ALTER TABLE control.video_render_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_render_preparations FORCE ROW LEVEL SECURITY;
ALTER TABLE control.video_render_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_render_outputs FORCE ROW LEVEL SECURITY;

CREATE POLICY video_render_preparations_tenant_isolation
  ON control.video_render_preparations
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY video_render_outputs_tenant_isolation
  ON control.video_render_outputs
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE TRIGGER video_render_preparations_immutable
  BEFORE UPDATE OR DELETE ON control.video_render_preparations
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE TRIGGER video_render_outputs_immutable
  BEFORE UPDATE OR DELETE ON control.video_render_outputs
  FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();

CREATE TRIGGER guard_active_workzone_video_render_preparations
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_render_preparations
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_video_render_outputs
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_render_outputs
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

COMMENT ON TABLE control.video_render_preparations IS
  'Immutable provider-neutral render specifications bound to an approved exact script; no executable job or paid call.';
COMMENT ON TABLE control.video_render_outputs IS
  'Ordered requested output formats for one blocked render preparation.';

ALTER TABLE control.video_command_receipts DROP CONSTRAINT video_command_receipts_command_name_check;
ALTER TABLE control.video_command_receipts ADD CONSTRAINT video_command_receipts_command_name_check
  CHECK (command_name IN (
    'brief.create','script.revise','approval.request','approval.decide','render.prepare'
  ));

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_render_preparations;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_render_preparations(uuid,uuid,uuid)
  FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  base jsonb;
  render_rows bigint;
  dependency_rows jsonb;
  blocking_rows bigint;
BEGIN
  base:=control.workzone_lifecycle_impact_before_render_preparations(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT
    (SELECT count(*) FROM control.video_render_preparations item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.video_render_outputs item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO render_rows;
  blocking_rows:=(base->>'blockingReferenceRows')::bigint+render_rows;
  SELECT jsonb_agg(
    CASE WHEN dependency->>'key'='editorial_content' THEN
      jsonb_set(
        dependency,'{referenceRows}',
        to_jsonb((dependency->>'referenceRows')::bigint+render_rows)
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
  'Same-tenant lifecycle preview including blocked render preparations; it does not authorize a transition.';
