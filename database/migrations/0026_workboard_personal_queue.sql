ALTER TABLE control.workboard_saved_views
  ADD COLUMN assignment_scope text NOT NULL DEFAULT 'all'
    CHECK (assignment_scope IN ('all','mine','unassigned')),
  ADD COLUMN focus text NOT NULL DEFAULT 'all'
    CHECK (focus IN ('all','attention','overdue','due_soon')),
  ADD COLUMN sort_order text NOT NULL DEFAULT 'smart'
    CHECK (sort_order IN ('smart','deadline','updated'));

CREATE OR REPLACE FUNCTION control.workboard_view_snapshot(
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
        'assignmentScope', saved.assignment_scope,
        'focus', saved.focus,
        'sortOrder', saved.sort_order,
        'createdAt', saved.created_at,
        'updatedAt', saved.updated_at
      ) ORDER BY lower(saved.name), saved.id)
      FROM control.workboard_saved_views saved
      WHERE saved.tenant_id = target_tenant
        AND saved.user_id = actor_user_id
    ), '[]'::jsonb)
  );
END $$;

DROP FUNCTION control.save_workboard_view(
  uuid, uuid, uuid, text, text, text, uuid
);

CREATE FUNCTION control.save_workboard_view(
  actor_user_id uuid,
  target_tenant uuid,
  target_workspace uuid,
  requested_name text,
  requested_stage text,
  requested_query text,
  requested_assignment_scope text,
  requested_focus text,
  requested_sort_order text,
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
    OR requested_assignment_scope NOT IN ('all','mine','unassigned')
    OR requested_focus NOT IN ('all','attention','overdue','due_soon')
    OR requested_sort_order NOT IN ('smart','deadline','updated')
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
    id, tenant_id, user_id, workspace_id, name, stage, search_query,
    assignment_scope, focus, sort_order
  ) VALUES (
    gen_random_uuid(), target_tenant, actor_user_id, target_workspace,
    btrim(requested_name), requested_stage, requested_query,
    requested_assignment_scope, requested_focus, requested_sort_order
  )
  ON CONFLICT (tenant_id, user_id, name_key) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    name = EXCLUDED.name,
    stage = EXCLUDED.stage,
    search_query = EXCLUDED.search_query,
    assignment_scope = EXCLUDED.assignment_scope,
    focus = EXCLUDED.focus,
    sort_order = EXCLUDED.sort_order,
    updated_at = now()
  RETURNING id INTO saved_id;

  INSERT INTO control.audit_events(
    id, tenant_id, actor_user_id, action, target_type, target_id,
    correlation_id, metadata
  ) VALUES (
    audit_id, target_tenant, actor_user_id, 'workboard.saved_view_saved',
    'workboard_saved_view', saved_id::text, correlation,
    jsonb_build_object(
      'workspaceId', target_workspace,
      'stage', requested_stage,
      'assignmentScope', requested_assignment_scope,
      'focus', requested_focus,
      'sortOrder', requested_sort_order
    )
  );
  INSERT INTO control.outbox_events(
    id, tenant_id, event_type, event_version, payload, correlation_id
  ) VALUES (
    gen_random_uuid(), target_tenant, 'workboard.saved_view_saved', 1,
    jsonb_build_object('auditEventId', audit_id, 'targetId', saved_id), correlation
  );
  RETURN saved_id;
END $$;

REVOKE ALL ON FUNCTION control.workboard_view_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.save_workboard_view(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid
) FROM PUBLIC;

COMMENT ON COLUMN control.workboard_saved_views.assignment_scope IS
  'Personal operational filter only; mine and unassigned do not grant or restrict workspace authority.';
