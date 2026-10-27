CREATE TYPE control.workzone_responsibility AS ENUM (
  'lead','editorial','approval','research','social','operations'
);

ALTER TABLE control.business_workspaces
  ADD COLUMN slug text,
  ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description)<=500),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE control.business_workspaces
SET slug='w-'||replace(id::text,'-','') WHERE slug IS NULL;

ALTER TABLE control.business_workspaces
  ALTER COLUMN slug SET DEFAULT ('w-'||replace(gen_random_uuid()::text,'-','')),
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT business_workspaces_slug_format CHECK (slug~'^[a-z][a-z0-9-]{1,62}$'),
  ADD CONSTRAINT business_workspaces_tenant_installation_slug_key
    UNIQUE(tenant_id,installation_id,slug);

CREATE TABLE control.workzone_team_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL REFERENCES control.business_workspaces(id),
  user_id uuid NOT NULL REFERENCES control.users(id),
  responsibility control.workzone_responsibility NOT NULL,
  assigned_by uuid NOT NULL REFERENCES control.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE(tenant_id,workspace_id,user_id),
  UNIQUE(tenant_id,id)
);

ALTER TABLE control.workzone_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.workzone_team_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY workzone_team_assignments_tenant_isolation
  ON control.workzone_team_assignments
  USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.assert_workzone_provisioning_admin(
  actor_user_id uuid,target_tenant uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM control.memberships membership
    WHERE membership.tenant_id=target_tenant AND membership.user_id=actor_user_id
      AND membership.role IN ('root_owner','white_label_owner'))
  THEN RAISE EXCEPTION 'WORKZONE_PROVISIONING_DENIED' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION control.workzone_provisioning_snapshot(
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
    RAISE EXCEPTION 'WORKZONE_PROVISIONING_UNAVAILABLE' USING ERRCODE='22023';
  END IF;
  SELECT count(*)::int INTO current_workzones FROM control.business_workspaces workspace
    WHERE workspace.tenant_id=target_tenant AND workspace.installation_id=selected_installation;
  RETURN jsonb_build_object(
    'installationId',selected_installation,'maximumWorkzones',maximum_workzones,
    'workzoneCount',current_workzones,
    'remainingCapacity',greatest(maximum_workzones-current_workzones,0),
    'securityBoundary','tenant_membership',
    'workzones',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',workspace.id,'slug',workspace.slug,'name',workspace.name,
      'description',workspace.description,'createdAt',workspace.created_at,
      'updatedAt',workspace.updated_at,'assignments',coalesce((SELECT jsonb_agg(
        jsonb_build_object('id',assignment.id,'userId',assignment.user_id,
          'email',user_record.email,'responsibility',assignment.responsibility,
          'assignedAt',assignment.assigned_at) ORDER BY user_record.email,assignment.id)
        FROM control.workzone_team_assignments assignment
        JOIN control.users user_record ON user_record.id=assignment.user_id
        WHERE assignment.tenant_id=target_tenant AND assignment.workspace_id=workspace.id
      ),'[]'::jsonb)) ORDER BY workspace.created_at,workspace.id)
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

CREATE FUNCTION control.create_tenant_workzone(
  actor_user_id uuid,target_tenant uuid,requested_slug text,requested_name text,
  requested_description text,correlation uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE selected_installation uuid; maximum_workzones integer; workzone_count integer;
  workzone_id uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);
  IF requested_slug !~ '^[a-z][a-z0-9-]{1,62}$'
    OR char_length(btrim(requested_name)) NOT BETWEEN 2 AND 160
    OR char_length(btrim(requested_description))>500
  THEN RAISE EXCEPTION 'INVALID_WORKZONE_PROVISIONING' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_tenant::text,1));
  SELECT installation.id,entitlement.maximum_workspaces
    INTO selected_installation,maximum_workzones
  FROM control.white_label_installations installation
  JOIN control.tenants tenant ON tenant.id=installation.tenant_id
  JOIN control.installation_entitlements entitlement
    ON entitlement.tenant_id=installation.tenant_id
   AND entitlement.installation_id=installation.id
   AND entitlement.effective_from<=now()
   AND (entitlement.effective_until IS NULL OR entitlement.effective_until>now())
  WHERE installation.tenant_id=target_tenant AND installation.status='active'
    AND tenant.status='active'
  ORDER BY installation.created_at LIMIT 1 FOR UPDATE OF installation;
  IF selected_installation IS NULL THEN
    RAISE EXCEPTION 'WORKZONE_PROVISIONING_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  SELECT count(*)::int INTO workzone_count FROM control.business_workspaces workspace
    WHERE workspace.tenant_id=target_tenant AND workspace.installation_id=selected_installation;
  IF workzone_count>=maximum_workzones THEN
    RAISE EXCEPTION 'WORKZONE_LIMIT_REACHED' USING ERRCODE='23514'; END IF;
  INSERT INTO control.business_workspaces
    (id,tenant_id,installation_id,slug,name,description)
    VALUES(workzone_id,target_tenant,selected_installation,requested_slug,
      btrim(requested_name),btrim(requested_description));
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'workzone.created','business_workspace',
      workzone_id::text,correlation,jsonb_build_object('slug',requested_slug,'name',btrim(requested_name)));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'workzone.created',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',workzone_id),correlation);
  RETURN workzone_id;
END $$;

CREATE FUNCTION control.update_tenant_workzone(
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
    WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKZONE_NOT_FOUND' USING ERRCODE='22023'; END IF;
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

CREATE FUNCTION control.assign_tenant_workzone_member(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid,target_user uuid,
  requested_responsibility control.workzone_responsibility,correlation uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE assignment_id uuid; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);
  IF NOT EXISTS(SELECT 1 FROM control.business_workspaces workspace
      WHERE workspace.id=target_workspace AND workspace.tenant_id=target_tenant)
    OR NOT EXISTS(SELECT 1 FROM control.memberships membership
      WHERE membership.tenant_id=target_tenant AND membership.user_id=target_user)
  THEN RAISE EXCEPTION 'WORKZONE_ASSIGNMENT_NOT_ELIGIBLE' USING ERRCODE='22023'; END IF;
  INSERT INTO control.workzone_team_assignments
    (id,tenant_id,workspace_id,user_id,responsibility,assigned_by)
    VALUES(gen_random_uuid(),target_tenant,target_workspace,target_user,
      requested_responsibility,actor_user_id)
    ON CONFLICT(tenant_id,workspace_id,user_id) DO UPDATE SET
      responsibility=EXCLUDED.responsibility,assigned_by=EXCLUDED.assigned_by,updated_at=now()
    RETURNING id INTO assignment_id;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'workzone.member_assigned',
      'workzone_team_assignment',assignment_id::text,correlation,
      jsonb_build_object('workspaceId',target_workspace,'userId',target_user,
        'responsibility',requested_responsibility));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'workzone.member_assigned',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',assignment_id),correlation);
  RETURN assignment_id;
END $$;

CREATE FUNCTION control.remove_tenant_workzone_member(
  actor_user_id uuid,target_tenant uuid,target_workspace uuid,target_user uuid,
  correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.workzone_team_assignments%ROWTYPE; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);
  DELETE FROM control.workzone_team_assignments assignment
    WHERE assignment.tenant_id=target_tenant AND assignment.workspace_id=target_workspace
      AND assignment.user_id=target_user RETURNING * INTO selected;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKZONE_ASSIGNMENT_NOT_FOUND' USING ERRCODE='22023'; END IF;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'workzone.member_removed',
      'workzone_team_assignment',selected.id::text,correlation,
      jsonb_build_object('workspaceId',selected.workspace_id,'userId',selected.user_id,
        'responsibility',selected.responsibility));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'workzone.member_removed',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',selected.id),correlation);
END $$;

REVOKE INSERT ON control.business_workspaces FROM redi_control_runtime;
REVOKE ALL ON control.workzone_team_assignments FROM PUBLIC;
REVOKE ALL ON FUNCTION control.assert_workzone_provisioning_admin(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.workzone_provisioning_snapshot(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.create_tenant_workzone(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.update_tenant_workzone(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.assign_tenant_workzone_member(uuid,uuid,uuid,uuid,control.workzone_responsibility,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.remove_tenant_workzone_member(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;

COMMENT ON TABLE control.workzone_team_assignments IS
  'Operational workzone responsibility for an existing tenant member; never an authorization grant or tenant boundary.';
