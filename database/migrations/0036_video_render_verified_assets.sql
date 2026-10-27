ALTER TABLE control.media_assets
  DROP CONSTRAINT media_assets_source_check;
ALTER TABLE control.media_assets
  ADD CONSTRAINT media_assets_source_check CHECK (
    source IN ('user_upload','connector_import','generated_local','generated_provider')
  );

ALTER TABLE control.media_usage_references
  DROP CONSTRAINT media_usage_references_usage_type_check;
ALTER TABLE control.media_usage_references
  ADD CONSTRAINT media_usage_references_usage_type_check CHECK (
    usage_type IN ('social_draft','published_social','content_item','manual','video_render')
  );

ALTER TABLE control.video_render_jobs
  ADD COLUMN media_asset_id uuid,
  ADD CONSTRAINT video_render_jobs_media_asset_fkey
    FOREIGN KEY (tenant_id,workspace_id,media_asset_id)
    REFERENCES control.media_assets(tenant_id,workspace_id,id),
  ADD CONSTRAINT video_render_jobs_completion_asset_check CHECK (
    (
      status='succeeded'
      AND media_asset_id IS NOT NULL
      AND actual_credits IS NOT NULL
    )
    OR (
      status<>'succeeded'
      AND media_asset_id IS NULL
    )
  ),
  ADD CONSTRAINT video_render_jobs_media_asset_unique
    UNIQUE (tenant_id,media_asset_id);

COMMENT ON COLUMN control.video_render_jobs.media_asset_id IS
  'Tenant/workzone-bound ready Media Library asset verified before successful completion.';
