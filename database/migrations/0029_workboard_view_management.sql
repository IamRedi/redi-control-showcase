CREATE FUNCTION control.rename_workboard_view(
  actor_user_id uuid,
  target_tenant uuid,
  target_view uuid,
  requested_name text,
  correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
DECLARE
  current_view control.workboard_saved_views%ROWTYPE;
  audit_id uuid := gen_random_uuid();
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  IF requested_name IS NULL
    OR char_length(btrim(requested_name)) NOT BETWEEN 2 AND 80
  THEN
    RAISE EXCEPTION 'INVALID_WORKBOARD_VIEW' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_tenant::text || ':' || actor_user_id::text, 2)
  );
  SELECT saved.* INTO current_view
  FROM control.workboard_saved_views saved
  WHERE saved.id = target_view
    AND saved.tenant_id = target_tenant
    AND saved.user_id = actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM control.workboard_saved_views saved
    WHERE saved.tenant_id = target_tenant
      AND saved.user_id = actor_user_id
      AND saved.id <> target_view
      AND saved.name_key = lower(btrim(requested_name))
  ) THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_NAME_CONFLICT' USING ERRCODE = '23505';
  END IF;

  UPDATE control.workboard_saved_views saved
  SET name = btrim(requested_name),
      updated_at = CASE
        WHEN saved.name IS DISTINCT FROM btrim(requested_name) THEN now()
        ELSE saved.updated_at
      END
  WHERE saved.id = target_view
    AND saved.tenant_id = target_tenant
    AND saved.user_id = actor_user_id;

  INSERT INTO control.audit_events(
    id, tenant_id, actor_user_id, action, target_type, target_id,
    correlation_id, metadata
  ) VALUES (
    audit_id, target_tenant, actor_user_id, 'workboard.saved_view_renamed',
    'workboard_saved_view', target_view::text, correlation,
    jsonb_build_object(
      'oldName', current_view.name,
      'newName', btrim(requested_name),
      'isDefault', current_view.is_default
    )
  );
  INSERT INTO control.outbox_events(
    id, tenant_id, event_type, event_version, payload, correlation_id
  ) VALUES (
    gen_random_uuid(), target_tenant, 'workboard.saved_view_renamed', 1,
    jsonb_build_object('auditEventId', audit_id, 'targetId', target_view),
    correlation
  );
END $$;

CREATE FUNCTION control.duplicate_workboard_view(
  actor_user_id uuid,
  target_tenant uuid,
  source_view_id uuid,
  requested_name text,
  correlation uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, control AS $$
DECLARE
  source_view control.workboard_saved_views%ROWTYPE;
  duplicated_id uuid := gen_random_uuid();
  audit_id uuid := gen_random_uuid();
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id, target_tenant);
  IF requested_name IS NULL
    OR char_length(btrim(requested_name)) NOT BETWEEN 2 AND 80
  THEN
    RAISE EXCEPTION 'INVALID_WORKBOARD_VIEW' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_tenant::text || ':' || actor_user_id::text, 2)
  );
  SELECT saved.* INTO source_view
  FROM control.workboard_saved_views saved
  WHERE saved.id = source_view_id
    AND saved.tenant_id = target_tenant
    AND saved.user_id = actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM control.workboard_saved_views saved
    WHERE saved.tenant_id = target_tenant
      AND saved.user_id = actor_user_id
      AND saved.name_key = lower(btrim(requested_name))
  ) THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_NAME_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF (
    SELECT count(*) FROM control.workboard_saved_views saved
    WHERE saved.tenant_id = target_tenant
      AND saved.user_id = actor_user_id
  ) >= 20 THEN
    RAISE EXCEPTION 'WORKBOARD_VIEW_LIMIT_REACHED' USING ERRCODE = '23514';
  END IF;

  INSERT INTO control.workboard_saved_views(
    id, tenant_id, user_id, workspace_id, name, stage, search_query,
    assignment_scope, focus, handoff_filter, sort_order, is_default
  ) VALUES (
    duplicated_id, target_tenant, actor_user_id, source_view.workspace_id,
    btrim(requested_name), source_view.stage, source_view.search_query,
    source_view.assignment_scope, source_view.focus,
    source_view.handoff_filter, source_view.sort_order, false
  );

  INSERT INTO control.audit_events(
    id, tenant_id, actor_user_id, action, target_type, target_id,
    correlation_id, metadata
  ) VALUES (
    audit_id, target_tenant, actor_user_id, 'workboard.saved_view_duplicated',
    'workboard_saved_view', duplicated_id::text, correlation,
    jsonb_build_object(
      'sourceViewId', source_view_id,
      'workspaceId', source_view.workspace_id,
      'isDefault', false
    )
  );
  INSERT INTO control.outbox_events(
    id, tenant_id, event_type, event_version, payload, correlation_id
  ) VALUES (
    gen_random_uuid(), target_tenant, 'workboard.saved_view_duplicated', 1,
    jsonb_build_object(
      'auditEventId', audit_id,
      'targetId', duplicated_id,
      'sourceViewId', source_view_id
    ), correlation
  );
  RETURN duplicated_id;
END $$;

REVOKE ALL ON FUNCTION control.rename_workboard_view(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.duplicate_workboard_view(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC;
