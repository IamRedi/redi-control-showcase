ALTER TABLE control.media_usage_references
  DROP CONSTRAINT media_usage_references_usage_type_check;
ALTER TABLE control.media_usage_references
  ADD CONSTRAINT media_usage_references_usage_type_check
  CHECK (usage_type IN (
    'social_draft','published_social','content_item','website_draft','manual',
    'video_render'
  ));

CREATE TABLE control.content_website_drafts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,content_item_id)
    REFERENCES control.content_items(tenant_id,workspace_id,id) ON DELETE CASCADE,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,workspace_id,id),
  UNIQUE (tenant_id,content_item_id)
);

CREATE TABLE control.content_website_draft_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  slug text NOT NULL CHECK (
    char_length(slug) BETWEEN 1 AND 180
    AND slug~'^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  excerpt text NOT NULL DEFAULT '' CHECK (char_length(excerpt) <= 1000),
  body jsonb NOT NULL CHECK (
    jsonb_typeof(body)='object' AND octet_length(body::text) <= 100000
  ),
  content_hash text NOT NULL CHECK (content_hash~'^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,draft_id)
    REFERENCES control.content_website_drafts(tenant_id,workspace_id,id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,workspace_id,draft_id,id),
  UNIQUE (tenant_id,draft_id,revision)
);

ALTER TABLE control.content_website_drafts
  ADD CONSTRAINT content_website_drafts_current_revision_fk
  FOREIGN KEY (tenant_id,id,current_revision)
  REFERENCES control.content_website_draft_revisions(tenant_id,draft_id,revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE control.content_website_draft_media (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 19),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workspace_id,draft_id,revision_id)
    REFERENCES control.content_website_draft_revisions(
      tenant_id,workspace_id,draft_id,id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,workspace_id,asset_id)
    REFERENCES control.media_assets(tenant_id,workspace_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,revision_id,asset_id),
  UNIQUE (tenant_id,revision_id,position)
);

CREATE INDEX content_website_drafts_workspace_idx
  ON control.content_website_drafts
  (tenant_id,workspace_id,updated_at DESC,id DESC);
CREATE INDEX content_website_draft_revisions_idx
  ON control.content_website_draft_revisions
  (tenant_id,draft_id,revision DESC);

ALTER TABLE control.content_website_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_website_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE control.content_website_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_website_draft_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE control.content_website_draft_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_website_draft_media FORCE ROW LEVEL SECURITY;

CREATE POLICY content_website_drafts_tenant_isolation
  ON control.content_website_drafts
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY content_website_draft_revisions_tenant_isolation
  ON control.content_website_draft_revisions
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY content_website_draft_media_tenant_isolation
  ON control.content_website_draft_media
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.reject_content_website_draft_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,control AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_CONTENT_WEBSITE_DRAFT_REVISION';
END $$;
REVOKE ALL ON FUNCTION control.reject_content_website_draft_revision_mutation()
  FROM PUBLIC;

CREATE TRIGGER content_website_draft_revisions_immutable
  BEFORE UPDATE OR DELETE ON control.content_website_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION control.reject_content_website_draft_revision_mutation();
CREATE TRIGGER content_website_draft_media_immutable
  BEFORE UPDATE OR DELETE ON control.content_website_draft_media
  FOR EACH ROW EXECUTE FUNCTION control.reject_content_website_draft_revision_mutation();

CREATE TRIGGER guard_active_workzone_content_website_drafts
  BEFORE INSERT OR UPDATE OR DELETE ON control.content_website_drafts
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_content_website_draft_revisions
  BEFORE INSERT OR UPDATE OR DELETE ON control.content_website_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
CREATE TRIGGER guard_active_workzone_content_website_draft_media
  BEFORE INSERT OR UPDATE OR DELETE ON control.content_website_draft_media
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

COMMENT ON TABLE control.content_website_drafts IS
  'Local Website composition head for one Unified Content item; it is not a destination variant and grants no connector or publication authority.';
COMMENT ON TABLE control.content_website_draft_revisions IS
  'Immutable exact Website copy revisions prepared locally before any connector execution.';
COMMENT ON TABLE control.content_website_draft_media IS
  'Immutable ordered Media Library snapshot for one local Website draft revision.';

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_content_website_drafts;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_content_website_drafts(uuid,uuid,uuid)
  FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  base jsonb;
  draft_rows bigint;
  dependency_rows jsonb;
  blocking_rows bigint;
BEGIN
  base:=control.workzone_lifecycle_impact_before_content_website_drafts(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT
    (SELECT count(*) FROM control.content_website_drafts item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.content_website_draft_revisions item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.content_website_draft_media item
      WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO draft_rows;
  blocking_rows:=(base->>'blockingReferenceRows')::bigint+draft_rows;
  SELECT jsonb_agg(
    CASE WHEN dependency->>'key'='editorial_content' THEN
      jsonb_set(
        dependency,'{referenceRows}',
        to_jsonb((dependency->>'referenceRows')::bigint+draft_rows)
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
  'Same-tenant lifecycle preview including local Website draft heads, immutable revisions and media snapshots; it does not authorize a transition.';
