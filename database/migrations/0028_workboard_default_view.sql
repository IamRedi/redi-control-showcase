ALTER TABLE control.workboard_saved_views
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX workboard_saved_views_one_default_per_user
  ON control.workboard_saved_views(tenant_id, user_id)
  WHERE is_default;

CREATE OR REPLACE FUNCTION control.workboard_view_snapshot(
  actor_user_id uuid,
  target_tenant uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  RETURN jsonb_build_object(
    'maximumSavedViews', 20,
    'defaultViewId', (
      SELECT saved.id
      FROM control.workboard_saved_views saved
      WHERE saved.tenant_id = target_tenant
        AND saved.user_id = actor_user_id
        AND saved.is_default
      LIMIT 1
    ),
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
        'handoffFilter', saved.handoff_filter,
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

CREATE FUNCTION control.set_workboard_default_view(
  actor_user_id uuid,
  target_tenant uuid,
  target_view uuid,
  correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
DECLARE
  audit_id uuid := gen_random_uuid();
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_tenant::text || ':' || actor_user_id::text, 2)
  );

  IF target_view IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM control.workboard_saved_views saved
    WHERE saved.id = target_view
      AND saved.tenant_id = target_tenant
      AND saved.user_id = actor_user_id
  ) THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  UPDATE control.workboard_saved_views saved
  SET is_default = false,
      updated_at = now()
  WHERE saved.tenant_id = target_tenant
    AND saved.user_id = actor_user_id
    AND saved.is_default
    AND saved.id IS DISTINCT FROM target_view;

  IF target_view IS NOT NULL THEN
    UPDATE control.workboard_saved_views saved
    SET is_default = true,
        updated_at = now()
    WHERE saved.id = target_view
      AND saved.tenant_id = target_tenant
      AND saved.user_id = actor_user_id
      AND NOT saved.is_default;
  END IF;

  INSERT INTO control.audit_events(
    id, tenant_id, actor_user_id, action, target_type, target_id,
    correlation_id, metadata
  ) VALUES (
    audit_id, target_tenant, actor_user_id,
    CASE WHEN target_view IS NULL
      THEN 'workboard.saved_view_default_cleared'
      ELSE 'workboard.saved_view_default_set'
    END,
    CASE WHEN target_view IS NULL THEN 'user' ELSE 'workboard_saved_view' END,
    coalesce(target_view::text, actor_user_id::text), correlation,
    jsonb_build_object('viewId', target_view)
  );
  INSERT INTO control.outbox_events(
    id, tenant_id, event_type, event_version, payload, correlation_id
  ) VALUES (
    gen_random_uuid(), target_tenant,
    CASE WHEN target_view IS NULL
      THEN 'workboard.saved_view_default_cleared'
      ELSE 'workboard.saved_view_default_set'
    END,
    1, jsonb_build_object(
      'auditEventId', audit_id,
      'targetId', coalesce(target_view::text, actor_user_id::text)
    ), correlation
  );
END $$;

REVOKE ALL ON FUNCTION control.workboard_view_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.set_workboard_default_view(
  uuid, uuid, uuid, uuid
) FROM PUBLIC;

COMMENT ON COLUMN control.workboard_saved_views.is_default IS
  'Owner-private startup preference only; it grants no workspace or workflow authority.';
