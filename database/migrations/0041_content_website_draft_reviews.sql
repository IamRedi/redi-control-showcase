ALTER TABLE control.content_website_draft_revisions
  ADD CONSTRAINT content_website_draft_revisions_exact_identity_unique
  UNIQUE (tenant_id,workspace_id,draft_id,id,content_hash);

CREATE TABLE control.content_website_draft_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  content_hash text NOT NULL CHECK (content_hash~'^[0-9a-f]{64}$'),
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL REFERENCES control.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES control.users(id),
  decided_at timestamptz,
  reason text,
  FOREIGN KEY (tenant_id,workspace_id,draft_id,revision_id,content_hash)
    REFERENCES control.content_website_draft_revisions(
      tenant_id,workspace_id,draft_id,id,content_hash
    ),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,revision_id),
  CHECK (
    (decision='pending' AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL)
    OR (decision='approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND reason IS NULL)
    OR (decision='rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND char_length(reason) BETWEEN 10 AND 500)
  )
);

CREATE INDEX content_website_draft_reviews_queue_idx
  ON control.content_website_draft_reviews
  (tenant_id,workspace_id,decision,requested_at,id);

ALTER TABLE control.content_website_draft_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.content_website_draft_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY content_website_draft_reviews_tenant_isolation
  ON control.content_website_draft_reviews
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.guard_content_website_draft_review_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,control AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_CONTENT_WEBSITE_DRAFT_REVIEW';
  END IF;
  IF OLD.decision<>'pending'
     OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id
     OR NEW.workspace_id<>OLD.workspace_id OR NEW.draft_id<>OLD.draft_id
     OR NEW.revision_id<>OLD.revision_id OR NEW.revision<>OLD.revision
     OR NEW.content_hash<>OLD.content_hash OR NEW.requested_by<>OLD.requested_by
     OR NEW.requested_at<>OLD.requested_at OR NEW.decision='pending' THEN
    RAISE EXCEPTION 'IMMUTABLE_CONTENT_WEBSITE_DRAFT_REVIEW';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION control.guard_content_website_draft_review_mutation()
  FROM PUBLIC;

CREATE TRIGGER content_website_draft_reviews_governed
  BEFORE UPDATE OR DELETE ON control.content_website_draft_reviews
  FOR EACH ROW EXECUTE FUNCTION control.guard_content_website_draft_review_mutation();
CREATE TRIGGER guard_active_workzone_content_website_draft_reviews
  BEFORE INSERT OR UPDATE OR DELETE ON control.content_website_draft_reviews
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

COMMENT ON TABLE control.content_website_draft_reviews IS
  'One governed human review per immutable local Website draft revision; approval grants no connector or publication authority.';

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_lifecycle_impact_before_content_website_draft_reviews;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact_before_content_website_draft_reviews(uuid,uuid,uuid)
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
  base:=control.workzone_lifecycle_impact_before_content_website_draft_reviews(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT count(*) INTO review_rows
    FROM control.content_website_draft_reviews item
   WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace;
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
  'Same-tenant lifecycle preview including exact-revision local Website draft reviews; it does not authorize a transition.';
