CREATE TABLE control.video_render_asset_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  script_content_hash text NOT NULL CHECK (script_content_hash~'^[0-9a-f]{64}$'),
  requested_by uuid NOT NULL REFERENCES control.users(id),
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES control.users(id),
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 10 AND 500),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  FOREIGN KEY (tenant_id,render_job_id)
    REFERENCES control.video_render_jobs(tenant_id,id),
  FOREIGN KEY (tenant_id,workspace_id,media_asset_id)
    REFERENCES control.media_assets(tenant_id,workspace_id,id),
  FOREIGN KEY (tenant_id,revision_id)
    REFERENCES control.video_script_revisions(tenant_id,id),
  CHECK (
    (decision='pending' AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL)
    OR
    (decision='approved' AND decided_by IS NOT NULL AND decided_by<>requested_by
      AND decided_at IS NOT NULL AND reason IS NULL)
    OR
    (decision='rejected' AND decided_by IS NOT NULL AND decided_by<>requested_by
      AND decided_at IS NOT NULL AND reason IS NOT NULL)
  ),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,render_job_id),
  UNIQUE (tenant_id,media_asset_id)
);

CREATE INDEX video_render_asset_reviews_queue_idx
  ON control.video_render_asset_reviews
  (tenant_id,workspace_id,decision,requested_at,id);

ALTER TABLE control.video_render_asset_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.video_render_asset_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY video_render_asset_reviews_tenant_isolation
  ON control.video_render_asset_reviews
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.guard_video_render_asset_review_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,control AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_VIDEO_RENDER_ASSET_REVIEW'; END IF;
  IF OLD.tenant_id<>NEW.tenant_id OR OLD.workspace_id<>NEW.workspace_id
    OR OLD.render_job_id<>NEW.render_job_id OR OLD.media_asset_id<>NEW.media_asset_id
    OR OLD.revision_id<>NEW.revision_id
    OR OLD.script_content_hash<>NEW.script_content_hash
    OR OLD.requested_by<>NEW.requested_by OR OLD.requested_at<>NEW.requested_at
    OR OLD.decision<>'pending' OR NEW.decision='pending'
  THEN RAISE EXCEPTION 'IMMUTABLE_VIDEO_RENDER_ASSET_REVIEW'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION control.guard_video_render_asset_review_change() FROM PUBLIC;

CREATE TRIGGER video_render_asset_reviews_guard
  BEFORE UPDATE OR DELETE ON control.video_render_asset_reviews
  FOR EACH ROW EXECUTE FUNCTION control.guard_video_render_asset_review_change();
CREATE TRIGGER guard_active_workzone_video_render_asset_reviews
  BEFORE INSERT OR UPDATE OR DELETE ON control.video_render_asset_reviews
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

ALTER TABLE control.video_command_receipts
  DROP CONSTRAINT video_command_receipts_command_name_check;
ALTER TABLE control.video_command_receipts
  ADD CONSTRAINT video_command_receipts_command_name_check CHECK (command_name IN (
    'brief.create','script.revise','approval.request','approval.decide',
    'render.prepare','render.review.decide'
  ));

COMMENT ON TABLE control.video_render_asset_reviews IS
  'Independent human decision bound to one exact verified render asset and approved script hash; it grants no publication authority.';

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_video_asset_reviews;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_video_asset_reviews(uuid,uuid,uuid)
  FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  base jsonb;
  review_rows bigint;
  dependency_rows jsonb;
  blocking_rows bigint;
BEGIN
  base:=control.workzone_lifecycle_impact_before_video_asset_reviews(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT count(*) FROM control.video_render_asset_reviews item
    WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace
  INTO review_rows;
  blocking_rows:=(base->>'blockingReferenceRows')::bigint+review_rows;
  SELECT jsonb_agg(
    CASE WHEN dependency->>'key'='editorial_content' THEN
      jsonb_set(
        dependency,'{referenceRows}',
        to_jsonb((dependency->>'referenceRows')::bigint+review_rows)
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
  'Same-tenant lifecycle preview including exact rendered-asset reviews; it does not authorize a transition.';
