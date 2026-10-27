CREATE TABLE control.workboard_saved_views (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  user_id uuid NOT NULL REFERENCES control.users(id),
  workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  stage text NOT NULL CHECK (
    stage IN ('all','research','ready','drafting','review','scheduled','done','attention')
  ),
  search_query text NOT NULL DEFAULT '' CHECK (char_length(search_query) <= 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES control.business_workspaces(tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id, name_key)
);

ALTER TABLE control.workboard_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.workboard_saved_views FORCE ROW LEVEL SECURITY;

CREATE POLICY workboard_saved_views_owner_isolation
  ON control.workboard_saved_views
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

CREATE FUNCTION control.assert_workboard_view_member(
  actor_user_id uuid,
  target_tenant uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM control.memberships membership
    WHERE membership.tenant_id = target_tenant
      AND membership.user_id = actor_user_id
  ) THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_DENIED' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION control.workboard_view_snapshot(
  actor_user_id uuid,
  target_tenant uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  RETURN jsonb_build_object(
    'maximumSavedViews', 20,
    'workspaces', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', workspace.id,
        'displayName', workspace.name
      ) ORDER BY workspace.created_at, workspace.id)
      FROM control.business_workspaces workspace
      WHERE workspace.tenant_id = target_tenant
    ), '[]'::jsonb),
    'savedViews', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', saved.id,
        'name', saved.name,
        'workspaceId', saved.workspace_id,
        'stage', saved.stage,
        'query', saved.search_query,
        'createdAt', saved.created_at,
        'updatedAt', saved.updated_at
      ) ORDER BY lower(saved.name), saved.id)
      FROM control.workboard_saved_views saved
      WHERE saved.tenant_id = target_tenant
        AND saved.user_id = actor_user_id
    ), '[]'::jsonb)
  );
END $$;

CREATE FUNCTION control.save_workboard_view(
  actor_user_id uuid,
  target_tenant uuid,
  target_workspace uuid,
  requested_name text,
  requested_stage text,
  requested_query text,
  correlation uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
DECLARE
  saved_id uuid;
  audit_id uuid := gen_random_uuid();
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  IF char_length(btrim(requested_name)) NOT BETWEEN 2 AND 80
    OR requested_stage NOT IN (
      'all','research','ready','drafting','review','scheduled','done','attention'
    )
    OR char_length(requested_query) > 160
    OR NOT EXISTS (
      SELECT 1 FROM control.business_workspaces workspace
      WHERE workspace.tenant_id = target_tenant
        AND workspace.id = target_workspace
    )
  THEN
    RAISE EXCEPTION 'INVALID_WORKBOARD_VIEW' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_tenant::text || ':' || actor_user_id::text, 2)
  );
  IF NOT EXISTS (
      SELECT 1 FROM control.workboard_saved_views saved
      WHERE saved.tenant_id = target_tenant
        AND saved.user_id = actor_user_id
        AND saved.name_key = lower(btrim(requested_name))
    ) AND (
      SELECT count(*) FROM control.workboard_saved_views saved
      WHERE saved.tenant_id = target_tenant
        AND saved.user_id = actor_user_id
    ) >= 20
  THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  INSERT INTO control.workboard_saved_views(
    id, tenant_id, user_id, workspace_id, name, stage, search_query
  ) VALUES (
    gen_random_uuid(), target_tenant, actor_user_id, target_workspace,
    btrim(requested_name), requested_stage, requested_query
  )
  ON CONFLICT (tenant_id, user_id, name_key) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    name = EXCLUDED.name,
    stage = EXCLUDED.stage,
    search_query = EXCLUDED.search_query,
    updated_at = now()
  RETURNING id INTO saved_id;

  INSERT INTO control.audit_events(
    id, tenant_id, actor_user_id, action, target_type, target_id,
    correlation_id, metadata
  ) VALUES (
    audit_id, target_tenant, actor_user_id, 'workboard.saved_view_saved',
    'workboard_saved_view', saved_id::text, correlation,
    jsonb_build_object('workspaceId', target_workspace, 'stage', requested_stage)
  );
  INSERT INTO control.outbox_events(
    id, tenant_id, event_type, event_version, payload, correlation_id
  ) VALUES (
    gen_random_uuid(), target_tenant, 'workboard.saved_view_saved', 1,
    jsonb_build_object('auditEventId', audit_id, 'targetId', saved_id), correlation
  );
  RETURN saved_id;
END $$;

CREATE FUNCTION control.delete_workboard_view(
  actor_user_id uuid,
  target_tenant uuid,
  target_view uuid,
  correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
DECLARE
  removed control.workboard_saved_views%ROWTYPE;
  audit_id uuid := gen_random_uuid();
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  DELETE FROM control.workboard_saved_views saved
  WHERE saved.id = target_view
    AND saved.tenant_id = target_tenant
    AND saved.user_id = actor_user_id
  RETURNING * INTO removed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  INSERT INTO control.audit_events(
    id, tenant_id, actor_user_id, action, target_type, target_id,
    correlation_id, metadata
  ) VALUES (
    audit_id, target_tenant, actor_user_id, 'workboard.saved_view_deleted',
    'workboard_saved_view', removed.id::text, correlation,
    jsonb_build_object('workspaceId', removed.workspace_id, 'stage', removed.stage)
  );
  INSERT INTO control.outbox_events(
    id, tenant_id, event_type, event_version, payload, correlation_id
  ) VALUES (
    gen_random_uuid(), target_tenant, 'workboard.saved_view_deleted', 1,
    jsonb_build_object('auditEventId', audit_id, 'targetId', removed.id), correlation
  );
END $$;

REVOKE ALL ON control.workboard_saved_views FROM PUBLIC;
REVOKE ALL ON FUNCTION control.assert_workboard_view_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.workboard_view_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.save_workboard_view(uuid, uuid, uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.delete_workboard_view(uuid, uuid, uuid, uuid) FROM PUBLIC;

COMMENT ON TABLE control.workboard_saved_views IS
  'Personal Workboard filter presets. They grant no workspace, tenant, role, approval or publication authority.';
