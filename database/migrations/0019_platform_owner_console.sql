CREATE TYPE control.platform_tenant_lifecycle_action AS ENUM (
  'suspend','reactivate','request_deletion'
);
CREATE TYPE control.platform_tenant_lifecycle_status AS ENUM (
  'pending','executed','cancelled'
);

CREATE TABLE control.platform_access_grants (
  id uuid PRIMARY KEY,
  authority_tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  user_id uuid NOT NULL REFERENCES control.users(id),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 minutes'),
  UNIQUE (authority_tenant_id,id)
);

CREATE TABLE control.platform_tenant_lifecycle_requests (
  id uuid PRIMARY KEY,
  authority_tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  target_tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  action control.platform_tenant_lifecycle_action NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  status control.platform_tenant_lifecycle_status NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL REFERENCES control.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  executed_by uuid REFERENCES control.users(id),
  executed_at timestamptz,
  CHECK (authority_tenant_id <> target_tenant_id),
  CHECK ((status='executed') = (executed_by IS NOT NULL AND executed_at IS NOT NULL)),
  UNIQUE (authority_tenant_id,id)
);

ALTER TABLE control.platform_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.platform_access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE control.platform_tenant_lifecycle_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.platform_tenant_lifecycle_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_access_grants_authority_isolation ON control.platform_access_grants
  USING (authority_tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (authority_tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY platform_lifecycle_authority_isolation ON control.platform_tenant_lifecycle_requests
  USING (authority_tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (authority_tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.assert_platform_access(
  actor_user_id uuid, authority_tenant uuid, access_grant_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM control.memberships
    WHERE tenant_id=authority_tenant AND user_id=actor_user_id AND role='root_owner'
  ) OR NOT EXISTS (
    SELECT 1 FROM control.platform_access_grants
    WHERE id=access_grant_id AND authority_tenant_id=authority_tenant
      AND user_id=actor_user_id AND revoked_at IS NULL AND expires_at>now()
  ) THEN RAISE EXCEPTION 'PLATFORM_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION control.platform_owner_lifecycle_requests(
  actor_user_id uuid, authority_tenant uuid, access_grant_id uuid
) RETURNS TABLE(
  id uuid,target_tenant_id uuid,target_name text,action text,reason text,
  status text,requested_by uuid,requested_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  RETURN QUERY SELECT request.id,request.target_tenant_id,tenant.display_name,
    request.action::text,request.reason,request.status::text,request.requested_by,
    request.requested_at
  FROM control.platform_tenant_lifecycle_requests request
  JOIN control.tenants tenant ON tenant.id=request.target_tenant_id
  ORDER BY request.requested_at DESC,request.id DESC LIMIT 100;
END $$;

CREATE FUNCTION control.begin_platform_access(
  actor_user_id uuid, authority_tenant uuid, access_reason text,
  lifetime_minutes integer, correlation uuid
) RETURNS TABLE(id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE grant_id uuid:=gen_random_uuid(); grant_expiry timestamptz;
  audit_id uuid:=gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM control.memberships WHERE tenant_id=authority_tenant
    AND user_id=actor_user_id AND role='root_owner')
    OR char_length(btrim(access_reason)) NOT BETWEEN 10 AND 500
    OR lifetime_minutes NOT BETWEEN 1 AND 60
  THEN RAISE EXCEPTION 'PLATFORM_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  grant_expiry:=now()+make_interval(mins=>lifetime_minutes);
  INSERT INTO control.platform_access_grants
    (id,authority_tenant_id,user_id,reason,expires_at)
    VALUES(grant_id,authority_tenant,actor_user_id,btrim(access_reason),grant_expiry);
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.access_started',
      'platform_access_grant',grant_id::text,correlation,
      jsonb_build_object('expiresAt',grant_expiry,'reason',btrim(access_reason)));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.access_started',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',grant_id),correlation);
  RETURN QUERY SELECT grant_id,grant_expiry;
END $$;

CREATE FUNCTION control.platform_owner_inventory(
  actor_user_id uuid, authority_tenant uuid, access_grant_id uuid
) RETURNS TABLE(
  tenant_id uuid,tenant_slug text,display_name text,tenant_status text,
  installation_id uuid,installation_status text,workspace_count integer,
  member_count integer,pending_lifecycle_count integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  RETURN QUERY
    SELECT tenant.id,tenant.slug,tenant.display_name,tenant.status,
      installation.id,coalesce(installation.status::text,'not_provisioned'),
      (SELECT count(*)::int FROM control.business_workspaces w WHERE w.tenant_id=tenant.id),
      (SELECT count(DISTINCT m.user_id)::int FROM control.memberships m WHERE m.tenant_id=tenant.id),
      (SELECT count(*)::int FROM control.platform_tenant_lifecycle_requests r
       WHERE r.target_tenant_id=tenant.id AND r.status='pending')
    FROM control.tenants tenant
    LEFT JOIN LATERAL (
      SELECT i.id,i.status FROM control.white_label_installations i
      WHERE i.tenant_id=tenant.id ORDER BY i.created_at LIMIT 1
    ) installation ON true
    WHERE tenant.status<>'deleted' ORDER BY tenant.created_at,tenant.id;
END $$;

CREATE FUNCTION control.provision_platform_tenant(
  actor_user_id uuid, authority_tenant uuid, access_grant_id uuid,
  tenant_slug text,tenant_name text,installation_slug text,
  installation_name text,workspace_name text,data_region text,correlation uuid
) RETURNS TABLE(tenant_id uuid,installation_id uuid,workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE new_tenant uuid:=gen_random_uuid(); new_installation uuid:=gen_random_uuid();
  new_workspace uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  IF tenant_slug !~ '^[a-z][a-z0-9-]{1,62}$'
    OR installation_slug !~ '^[a-z][a-z0-9-]{1,62}$'
    OR char_length(btrim(tenant_name)) NOT BETWEEN 2 AND 160
    OR char_length(btrim(installation_name)) NOT BETWEEN 2 AND 160
    OR char_length(btrim(workspace_name)) NOT BETWEEN 2 AND 160
    OR data_region NOT IN ('EU','DE')
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_PROVISIONING' USING ERRCODE='22023'; END IF;
  INSERT INTO control.tenants(id,slug,display_name,status)
    VALUES(new_tenant,tenant_slug,btrim(tenant_name),'active');
  INSERT INTO control.white_label_installations
    (id,tenant_id,slug,display_name,data_region,status)
    VALUES(new_installation,new_tenant,installation_slug,btrim(installation_name),data_region,'pending');
  INSERT INTO control.business_workspaces(id,tenant_id,installation_id,name)
    VALUES(new_workspace,new_tenant,new_installation,btrim(workspace_name));
  INSERT INTO control.installation_profiles
    (installation_id,tenant_id,brand,enabled_locales,default_locale,enabled_modules)
    VALUES(new_installation,new_tenant,jsonb_build_object('name',btrim(installation_name)),
      ARRAY['en','de','sq'], 'en', ARRAY[]::text[]);
  INSERT INTO control.installation_entitlements
    (installation_id,tenant_id,plan_id,enabled_modules,maximum_businesses,
     maximum_workspaces,maximum_social_accounts,monthly_publication_quota,
     storage_quota_bytes,maximum_users)
    VALUES(new_installation,new_tenant,'foundation',ARRAY[]::text[],1,1,0,0,0,1);
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.tenant_provisioned','tenant',
      new_tenant::text,correlation,jsonb_build_object('tenantSlug',tenant_slug,
      'installationId',new_installation,'workspaceId',new_workspace,'dataRegion',data_region));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.tenant_provisioned',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',new_tenant),correlation);
  RETURN QUERY SELECT new_tenant,new_installation,new_workspace;
END $$;

CREATE FUNCTION control.request_platform_tenant_lifecycle(
  actor_user_id uuid, authority_tenant uuid, access_grant_id uuid,
  target_tenant uuid,requested_action control.platform_tenant_lifecycle_action,
  request_reason text,correlation uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE request_id uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid();
  target_status text;
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  SELECT status INTO target_status FROM control.tenants WHERE id=target_tenant AND status<>'deleted';
  IF target_tenant=authority_tenant OR char_length(btrim(request_reason)) NOT BETWEEN 10 AND 1000
    OR target_status IS NULL
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_LIFECYCLE_REQUEST' USING ERRCODE='22023'; END IF;
  IF (requested_action='suspend' AND target_status<>'active')
    OR (requested_action='reactivate' AND target_status<>'suspended')
    OR (requested_action='request_deletion' AND target_status NOT IN ('active','suspended'))
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_LIFECYCLE_TRANSITION' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM control.platform_tenant_lifecycle_requests
    WHERE target_tenant_id=target_tenant AND status='pending')
  THEN RAISE EXCEPTION 'PLATFORM_LIFECYCLE_ALREADY_PENDING' USING ERRCODE='23505'; END IF;
  INSERT INTO control.platform_tenant_lifecycle_requests
    (id,authority_tenant_id,target_tenant_id,action,reason,requested_by)
    VALUES(request_id,authority_tenant,target_tenant,requested_action,btrim(request_reason),actor_user_id);
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.tenant_lifecycle_requested',
      'tenant',target_tenant::text,correlation,jsonb_build_object('requestId',request_id,'action',requested_action,'reason',btrim(request_reason)));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.tenant_lifecycle_requested',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',target_tenant),correlation);
  RETURN request_id;
END $$;

CREATE FUNCTION control.execute_platform_tenant_lifecycle(
  actor_user_id uuid, authority_tenant uuid, access_grant_id uuid,
  lifecycle_request_id uuid,correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE requested control.platform_tenant_lifecycle_requests%ROWTYPE; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  SELECT * INTO requested FROM control.platform_tenant_lifecycle_requests
    WHERE id=lifecycle_request_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_LIFECYCLE_REQUEST_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF requested.requested_by=actor_user_id THEN
    RAISE EXCEPTION 'INDEPENDENT_PLATFORM_APPROVAL_REQUIRED' USING ERRCODE='42501';
  END IF;
  UPDATE control.tenants SET status=CASE requested.action
      WHEN 'suspend' THEN 'suspended' WHEN 'reactivate' THEN 'active'
      ELSE 'pending_deletion' END,updated_at=now()
    WHERE id=requested.target_tenant_id;
  IF requested.action<>'reactivate' THEN
    UPDATE control.sessions SET revoked_at=now()
      WHERE tenant_id=requested.target_tenant_id AND revoked_at IS NULL;
  END IF;
  UPDATE control.platform_tenant_lifecycle_requests SET status='executed',
    executed_by=actor_user_id,executed_at=now() WHERE id=requested.id;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,requested.authority_tenant_id,actor_user_id,'platform.tenant_lifecycle_executed',
      'tenant',requested.target_tenant_id::text,correlation,
      jsonb_build_object('requestId',requested.id,'action',requested.action,'requestedBy',requested.requested_by));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),requested.authority_tenant_id,'platform.tenant_lifecycle_executed',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',requested.target_tenant_id),correlation);
END $$;

REVOKE ALL ON FUNCTION control.assert_platform_access(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.begin_platform_access(uuid,uuid,text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.platform_owner_inventory(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.platform_owner_lifecycle_requests(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.provision_platform_tenant(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.request_platform_tenant_lifecycle(uuid,uuid,uuid,uuid,control.platform_tenant_lifecycle_action,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.execute_platform_tenant_lifecycle(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;

COMMENT ON TABLE control.platform_access_grants IS 'Reason-coded maximum 60-minute Root Owner global access; never a tenant membership or impersonation grant.';
COMMENT ON TABLE control.platform_tenant_lifecycle_requests IS 'Two-person platform lifecycle request; requester cannot execute their own action.';
