ALTER TABLE control.business_workspaces
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','archived')),
  ADD COLUMN lifecycle_version integer NOT NULL DEFAULT 1
    CHECK (lifecycle_version > 0),
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES control.users(id),
  ADD COLUMN archive_reason text CHECK (
    archive_reason IS NULL OR char_length(btrim(archive_reason)) BETWEEN 10 AND 1000
  ),
  ADD CONSTRAINT business_workspaces_archive_state CHECK (
    (lifecycle_status='active' AND archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR
    (lifecycle_status='archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL AND archive_reason IS NOT NULL)
  );

CREATE TABLE control.workzone_lifecycle_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('archive','restore')),
  outcome text NOT NULL CHECK (outcome IN ('executed','refused')),
  result_code text NOT NULL CHECK (result_code IN (
    'WORKZONE_ARCHIVED','WORKZONE_RESTORED','WORKZONE_LAST_ACTIVE',
    'WORKZONE_ACTIVE_OPERATIONS','WORKZONE_ALREADY_ARCHIVED','WORKZONE_ALREADY_ACTIVE'
  )),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash~'^[0-9a-f]{64}$'),
  requested_by uuid NOT NULL REFERENCES control.users(id),
  executed_by uuid REFERENCES control.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  status_before text NOT NULL CHECK (status_before IN ('active','archived')),
  status_after text NOT NULL CHECK (status_after IN ('active','archived')),
  lifecycle_version_after integer NOT NULL CHECK (lifecycle_version_after>0),
  impact_snapshot jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  FOREIGN KEY(tenant_id,installation_id)
    REFERENCES control.white_label_installations(tenant_id,id),
  FOREIGN KEY(tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  CHECK ((outcome='executed')=(executed_by IS NOT NULL AND executed_at IS NOT NULL)),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key_hash)
);

ALTER TABLE control.workzone_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.workzone_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workzone_lifecycle_events_tenant_isolation
  ON control.workzone_lifecycle_events
  USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

ALTER FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid)
  RENAME TO workzone_reference_impact;
REVOKE ALL ON FUNCTION control.workzone_reference_impact(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  reference_impact jsonb;
  selected_status text;
  active_workzones integer;
  active_uploads bigint;
  active_oauth bigint;
  active_delivery bigint;
  active_operations bigint;
  archive_available boolean;
  restore_available boolean;
  operation_reason text;
BEGIN
  reference_impact:=control.workzone_reference_impact(
    actor_user_id,target_tenant,target_workspace
  );
  SELECT workspace.lifecycle_status INTO selected_status
  FROM control.business_workspaces workspace
  WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant;
  SELECT count(*)::int INTO active_workzones
  FROM control.business_workspaces workspace
  JOIN control.business_workspaces selected
    ON selected.id=target_workspace
   AND selected.tenant_id=target_tenant
   AND selected.installation_id=workspace.installation_id
  WHERE workspace.tenant_id=target_tenant AND workspace.lifecycle_status='active';
  SELECT count(*) INTO active_uploads FROM control.media_upload_sessions upload
    WHERE upload.tenant_id=target_tenant AND upload.workspace_id=target_workspace
      AND upload.status IN ('initiated','uploading','uploaded')
      AND upload.expires_at>now();
  SELECT count(*) INTO active_oauth FROM control.oauth_transactions oauth
    WHERE oauth.tenant_id=target_tenant AND oauth.workspace_id=target_workspace
      AND oauth.used_at IS NULL AND oauth.expires_at>now();
  SELECT count(*) INTO active_delivery FROM control.social_drafts draft
    WHERE draft.tenant_id=target_tenant AND draft.workspace_id=target_workspace
      AND draft.status IN ('scheduled','queued','publishing','retry_scheduled');
  active_operations:=active_uploads+active_oauth+active_delivery;
  archive_available:=selected_status='active' AND active_workzones>1 AND active_operations=0;
  restore_available:=selected_status='archived';
  operation_reason:=CASE
    WHEN selected_status='archived' THEN 'ready_to_restore'
    WHEN active_workzones<=1 THEN 'last_active_workzone'
    WHEN active_operations>0 THEN 'active_operations'
    ELSE 'ready_to_archive'
  END;
  RETURN (reference_impact-'schemaVersion'-'operations') || jsonb_build_object(
    'schemaVersion',2,
    'status',selected_status,
    'operations',jsonb_build_object(
      'archiveAvailable',archive_available,
      'restoreAvailable',restore_available,
      'deleteAvailable',false,
      'reason',operation_reason
    ),
    'transitionBlockers',jsonb_build_array(
      jsonb_build_object('key','active_uploads','count',active_uploads),
      jsonb_build_object('key','active_oauth','count',active_oauth),
      jsonb_build_object('key','active_delivery','count',active_delivery),
      jsonb_build_object('key','last_active_workzone','count',CASE
        WHEN selected_status='active' AND active_workzones<=1 THEN 1 ELSE 0 END)
    )
  );
END $$;

CREATE FUNCTION control.guard_active_workzone_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE checked_workspace uuid;
BEGIN
  checked_workspace:=CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  IF EXISTS(SELECT 1 FROM control.business_workspaces workspace
    WHERE workspace.id=checked_workspace AND workspace.lifecycle_status='archived')
  THEN RAISE EXCEPTION 'WORKZONE_ARCHIVED' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    AND EXISTS(SELECT 1 FROM control.business_workspaces workspace
      WHERE workspace.id=OLD.workspace_id AND workspace.lifecycle_status='archived')
  THEN RAISE EXCEPTION 'WORKZONE_ARCHIVED' USING ERRCODE='55000'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$
DECLARE selected record; trigger_name text;
BEGIN
  FOR selected IN
    SELECT column_record.table_name
    FROM information_schema.columns column_record
    WHERE column_record.table_schema='control'
      AND column_record.column_name='workspace_id'
      AND column_record.table_name NOT IN (
        'workzone_lifecycle_events','workboard_saved_views'
      )
    ORDER BY column_record.table_name
  LOOP
    trigger_name:='guard_active_workzone_'||selected.table_name;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON control.%I '
      'FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row()',
      trigger_name,selected.table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER guard_active_workzone_workboard_saved_views
  BEFORE INSERT OR UPDATE ON control.workboard_saved_views
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();

CREATE FUNCTION control.transition_tenant_workzone(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid,
  requested_action text,requested_reason text,requested_idempotency_key uuid,
  correlation uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  selected control.business_workspaces%ROWTYPE;
  existing control.workzone_lifecycle_events%ROWTYPE;
  impact jsonb;
  event_id uuid:=gen_random_uuid();
  audit_id uuid:=gen_random_uuid();
  key_hash text:=encode(sha256(convert_to(requested_idempotency_key::text,'UTF8')),'hex');
  transition_outcome text;
  transition_code text;
  next_status text;
  next_version integer;
  action_name text;
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);
  IF requested_action NOT IN ('archive','restore')
    OR char_length(btrim(requested_reason)) NOT BETWEEN 10 AND 1000
  THEN RAISE EXCEPTION 'INVALID_WORKZONE_LIFECYCLE' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_tenant::text||':'||target_workspace::text,31
  ));
  SELECT * INTO existing FROM control.workzone_lifecycle_events event
    WHERE event.tenant_id=target_tenant AND event.idempotency_key_hash=key_hash;
  IF FOUND THEN
    IF existing.workspace_id<>target_workspace OR existing.action<>requested_action
      OR existing.reason<>btrim(requested_reason) OR existing.requested_by<>actor_user_id
    THEN RAISE EXCEPTION 'WORKZONE_LIFECYCLE_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object(
      'eventId',existing.id,'outcome',existing.outcome,'code',existing.result_code,
      'status',existing.status_after,'lifecycleVersion',existing.lifecycle_version_after,
      'replayed',true
    );
  END IF;
  SELECT workspace.* INTO selected FROM control.business_workspaces workspace
    JOIN control.white_label_installations installation
      ON installation.id=workspace.installation_id
     AND installation.tenant_id=workspace.tenant_id
    JOIN control.tenants tenant ON tenant.id=workspace.tenant_id
    WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant
      AND installation.status='active' AND tenant.status='active'
    FOR UPDATE OF workspace;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKZONE_NOT_FOUND' USING ERRCODE='22023'; END IF;
  impact:=control.workzone_lifecycle_impact(actor_user_id,target_tenant,target_workspace);
  next_status:=selected.lifecycle_status;
  next_version:=selected.lifecycle_version;
  transition_outcome:='executed';
  IF requested_action='archive' THEN
    IF selected.lifecycle_status='archived' THEN
      transition_outcome:='refused'; transition_code:='WORKZONE_ALREADY_ARCHIVED';
    ELSIF NOT (impact->'operations'->>'archiveAvailable')::boolean THEN
      transition_outcome:='refused';
      transition_code:=CASE impact->'operations'->>'reason'
        WHEN 'last_active_workzone' THEN 'WORKZONE_LAST_ACTIVE'
        ELSE 'WORKZONE_ACTIVE_OPERATIONS' END;
    ELSE
      UPDATE control.workboard_saved_views saved SET is_default=false,updated_at=now()
        WHERE saved.tenant_id=target_tenant AND saved.workspace_id=target_workspace
          AND saved.is_default;
      UPDATE control.business_workspaces workspace SET lifecycle_status='archived',
        lifecycle_version=lifecycle_version+1,archived_at=now(),archived_by=actor_user_id,
        archive_reason=btrim(requested_reason),updated_at=now()
        WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant
        RETURNING lifecycle_status,lifecycle_version INTO next_status,next_version;
      transition_code:='WORKZONE_ARCHIVED';
    END IF;
  ELSE
    IF selected.lifecycle_status='active' THEN
      transition_outcome:='refused'; transition_code:='WORKZONE_ALREADY_ACTIVE';
    ELSE
      UPDATE control.business_workspaces workspace SET lifecycle_status='active',
        lifecycle_version=lifecycle_version+1,archived_at=NULL,archived_by=NULL,
        archive_reason=NULL,updated_at=now()
        WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant
        RETURNING lifecycle_status,lifecycle_version INTO next_status,next_version;
      transition_code:='WORKZONE_RESTORED';
    END IF;
  END IF;
  INSERT INTO control.workzone_lifecycle_events(
    id,tenant_id,installation_id,workspace_id,action,outcome,result_code,reason,
    idempotency_key_hash,requested_by,executed_by,executed_at,status_before,
    status_after,lifecycle_version_after,impact_snapshot,correlation_id
  ) VALUES(
    event_id,target_tenant,selected.installation_id,target_workspace,requested_action,
    transition_outcome,transition_code,btrim(requested_reason),key_hash,actor_user_id,
    CASE WHEN transition_outcome='executed' THEN actor_user_id END,
    CASE WHEN transition_outcome='executed' THEN now() END,
    selected.lifecycle_status,next_status,next_version,impact,correlation
  );
  action_name:='workzone.'||requested_action||CASE
    WHEN transition_outcome='executed' THEN 'd' ELSE '_refused' END;
  INSERT INTO control.audit_events(
    id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata
  ) VALUES(
    audit_id,target_tenant,actor_user_id,action_name,'business_workspace',
    target_workspace::text,correlation,jsonb_build_object(
      'eventId',event_id,'outcome',transition_outcome,'code',transition_code,
      'reason',btrim(requested_reason),'statusBefore',selected.lifecycle_status,
      'statusAfter',next_status,'lifecycleVersion',next_version
    )
  );
  INSERT INTO control.outbox_events(
    id,tenant_id,event_type,event_version,payload,correlation_id
  ) VALUES(
    gen_random_uuid(),target_tenant,action_name,1,
    jsonb_build_object('auditEventId',audit_id,'targetId',target_workspace,
      'lifecycleEventId',event_id,'outcome',transition_outcome),correlation
  );
  RETURN jsonb_build_object(
    'eventId',event_id,'outcome',transition_outcome,'code',transition_code,
    'status',next_status,'lifecycleVersion',next_version,'replayed',false
  );
END $$;

CREATE OR REPLACE FUNCTION control.workzone_provisioning_snapshot(
  actor_user_id uuid,target_tenant uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE selected_installation uuid; maximum_workzones integer; current_workzones integer;
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);
  SELECT installation.id,entitlement.maximum_workspaces INTO selected_installation,maximum_workzones
  FROM control.white_label_installations installation
  JOIN control.tenants tenant ON tenant.id=installation.tenant_id
  JOIN control.installation_entitlements entitlement
    ON entitlement.tenant_id=installation.tenant_id
   AND entitlement.installation_id=installation.id
   AND entitlement.effective_from<=now()
   AND (entitlement.effective_until IS NULL OR entitlement.effective_until>now())
  WHERE installation.tenant_id=target_tenant AND installation.status='active'
    AND tenant.status='active'
  ORDER BY installation.created_at LIMIT 1;
  IF selected_installation IS NULL THEN
    RAISE EXCEPTION 'WORKZONE_PROVISIONING_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  SELECT count(*)::int INTO current_workzones FROM control.business_workspaces workspace
    WHERE workspace.tenant_id=target_tenant AND workspace.installation_id=selected_installation;
  RETURN jsonb_build_object(
    'installationId',selected_installation,'maximumWorkzones',maximum_workzones,
    'workzoneCount',current_workzones,
    'activeWorkzoneCount',(SELECT count(*)::int FROM control.business_workspaces workspace
      WHERE workspace.tenant_id=target_tenant AND workspace.installation_id=selected_installation
        AND workspace.lifecycle_status='active'),
    'archivedWorkzoneCount',(SELECT count(*)::int FROM control.business_workspaces workspace
      WHERE workspace.tenant_id=target_tenant AND workspace.installation_id=selected_installation
        AND workspace.lifecycle_status='archived'),
    'remainingCapacity',greatest(maximum_workzones-current_workzones,0),
    'securityBoundary','tenant_membership',
    'workzones',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',workspace.id,'slug',workspace.slug,'name',workspace.name,
      'description',workspace.description,'status',workspace.lifecycle_status,
      'lifecycleVersion',workspace.lifecycle_version,'archivedAt',workspace.archived_at,
      'createdAt',workspace.created_at,'updatedAt',workspace.updated_at,
      'assignments',coalesce((SELECT jsonb_agg(
        jsonb_build_object('id',assignment.id,'userId',assignment.user_id,
          'email',user_record.email,'responsibility',assignment.responsibility,
          'assignedAt',assignment.assigned_at) ORDER BY user_record.email,assignment.id)
        FROM control.workzone_team_assignments assignment
        JOIN control.users user_record ON user_record.id=assignment.user_id
        WHERE assignment.tenant_id=target_tenant AND assignment.workspace_id=workspace.id
      ),'[]'::jsonb)) ORDER BY workspace.lifecycle_status,workspace.created_at,workspace.id)
      FROM control.business_workspaces workspace
      WHERE workspace.tenant_id=target_tenant
        AND workspace.installation_id=selected_installation),'[]'::jsonb),
    'members',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'userId',member.user_id,'email',member.email,'roles',member.roles)
      ORDER BY member.email,member.user_id) FROM (
        SELECT membership.user_id,user_record.email,
          array_agg(membership.role::text ORDER BY membership.role)::text[] roles
        FROM control.memberships membership
        JOIN control.users user_record ON user_record.id=membership.user_id
        WHERE membership.tenant_id=target_tenant
        GROUP BY membership.user_id,user_record.email
      ) member),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION control.update_tenant_workzone(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid,
  requested_name text,requested_description text,correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.business_workspaces%ROWTYPE; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);
  IF char_length(btrim(requested_name)) NOT BETWEEN 2 AND 160
    OR char_length(btrim(requested_description))>500
  THEN RAISE EXCEPTION 'INVALID_WORKZONE_PROVISIONING' USING ERRCODE='22023'; END IF;
  SELECT * INTO selected FROM control.business_workspaces workspace
    WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant
      AND workspace.lifecycle_status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKZONE_NOT_ACTIVE' USING ERRCODE='55000'; END IF;
  UPDATE control.business_workspaces SET name=btrim(requested_name),
    description=btrim(requested_description),updated_at=now()
    WHERE id=selected.id AND tenant_id=target_tenant;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'workzone.updated','business_workspace',
      selected.id::text,correlation,jsonb_build_object('slug',selected.slug,
        'previousName',selected.name,'name',btrim(requested_name)));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'workzone.updated',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',selected.id),correlation);
END $$;

CREATE OR REPLACE FUNCTION control.workboard_view_snapshot(
  actor_user_id uuid,target_tenant uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_workboard_view_member(actor_user_id,target_tenant);
  RETURN jsonb_build_object(
    'maximumSavedViews',20,
    'defaultViewId',(
      SELECT saved.id FROM control.workboard_saved_views saved
      JOIN control.business_workspaces workspace
        ON workspace.id=saved.workspace_id AND workspace.tenant_id=saved.tenant_id
      WHERE saved.tenant_id=target_tenant AND saved.user_id=actor_user_id
        AND saved.is_default AND workspace.lifecycle_status='active' LIMIT 1
    ),
    'workspaces',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',workspace.id,'displayName',workspace.name,'status',workspace.lifecycle_status
    ) ORDER BY workspace.lifecycle_status,workspace.created_at,workspace.id)
      FROM control.business_workspaces workspace
      WHERE workspace.tenant_id=target_tenant),'[]'::jsonb),
    'savedViews',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',saved.id,'name',saved.name,'workspaceId',saved.workspace_id,
      'availability',CASE WHEN workspace.lifecycle_status='active'
        THEN 'active' ELSE 'workspace_archived' END,
      'stage',saved.stage,'query',saved.search_query,
      'assignmentScope',saved.assignment_scope,'focus',saved.focus,
      'handoffFilter',saved.handoff_filter,'sortOrder',saved.sort_order,
      'createdAt',saved.created_at,'updatedAt',saved.updated_at
    ) ORDER BY lower(saved.name),saved.id)
      FROM control.workboard_saved_views saved
      JOIN control.business_workspaces workspace
        ON workspace.id=saved.workspace_id AND workspace.tenant_id=saved.tenant_id
      WHERE saved.tenant_id=target_tenant AND saved.user_id=actor_user_id),'[]'::jsonb)
  );
END $$;

REVOKE ALL ON TABLE control.workzone_lifecycle_events FROM PUBLIC;
REVOKE ALL ON FUNCTION control.workzone_reference_impact(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.guard_active_workzone_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.transition_tenant_workzone(uuid,uuid,uuid,text,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.workboard_view_snapshot(uuid,uuid) FROM PUBLIC;
REVOKE UPDATE ON control.business_workspaces FROM redi_control_runtime;

COMMENT ON TABLE control.workzone_lifecycle_events IS
  'Append-only archive/restore evidence and idempotency ledger; never a physical-delete workflow.';
COMMENT ON COLUMN control.business_workspaces.lifecycle_status IS
  'Reversible operational state. Archived workzones retain identity and all referenced data.';
