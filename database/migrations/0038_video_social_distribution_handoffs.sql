ALTER TABLE control.video_render_asset_reviews
  ADD CONSTRAINT video_render_asset_reviews_tenant_workspace_id_unique
  UNIQUE (tenant_id,workspace_id,id);

CREATE TABLE control.video_social_distribution_handoffs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  asset_review_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  social_draft_id uuid NOT NULL,
  script_content_hash text NOT NULL CHECK (script_content_hash~'^[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash~'^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,asset_review_id)
    REFERENCES control.video_render_asset_reviews(tenant_id,workspace_id,id),
  FOREIGN KEY (tenant_id,render_job_id)
    REFERENCES control.video_render_jobs(tenant_id,id),
  FOREIGN KEY (tenant_id,workspace_id,media_asset_id)
    REFERENCES control.media_assets(tenant_id,workspace_id,id),
  FOREIGN KEY (tenant_id,workspace_id,social_draft_id)
    REFERENCES control.social_drafts(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  UNIQUE (tenant_id,asset_review_id)
);

CREATE INDEX video_social_distribution_handoffs_workspace_idx
  ON control.video_social_distribution_handoffs
  (tenant_id,workspace_id,created_at DESC,id DESC);

ALTER TABLE control.video_social_distribution_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_social_distribution_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY video_social_distribution_handoffs_tenant_isolation
  ON control.video_social_distribution_handoffs
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.reject_video_social_distribution_handoff_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,control AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_VIDEO_SOCIAL_DISTRIBUTION_HANDOFF';
END $$;
REVOKE ALL ON FUNCTION control.reject_video_social_distribution_handoff_mutation()
  FROM PUBLIC;

CREATE TRIGGER video_social_distribution_handoffs_immutable
  BEFORE UPDATE OR DELETE ON control.video_social_distribution_handoffs
  FOR EACH ROW EXECUTE FUNCTION control.reject_video_social_distribution_handoff_mutation();
CREATE TRIGGER guard_active_workzone_video_social_distribution_handoffs
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_social_distribution_handoffs
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

COMMENT ON TABLE control.video_social_distribution_handoffs IS
  'Immutable provenance from one independently approved exact video asset to one ordinary Social Control draft; it grants no review, schedule or publication authority.';

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_video_distribution_handoffs;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_video_distribution_handoffs(uuid,uuid,uuid)
  FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  base jsonb;
  handoff_rows bigint;
  dependency_rows jsonb;
  blocking_rows bigint;
BEGIN
  base:=control.workzone_lifecycle_impact_before_video_distribution_handoffs(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT count(*) FROM control.video_social_distribution_handoffs item
    WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace
  INTO handoff_rows;
  blocking_rows:=(base->>'blockingReferenceRows')::bigint+handoff_rows;
  SELECT jsonb_agg(
    CASE WHEN dependency->>'key'='publishing_delivery' THEN
      jsonb_set(
        dependency,'{referenceRows}',
        to_jsonb((dependency->>'referenceRows')::bigint+handoff_rows)
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
  'Same-tenant lifecycle preview including exact video distribution handoffs; it does not authorize a transition.';
