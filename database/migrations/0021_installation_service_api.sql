CREATE TYPE control.installation_api_client_status AS ENUM ('active','revoked');

CREATE TABLE control.installation_api_clients (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  client_identifier text NOT NULL UNIQUE CHECK (client_identifier ~ '^rc_[A-Za-z0-9_-]{32,96}$'),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
  scopes text[] NOT NULL DEFAULT ARRAY['control:read']::text[] CHECK (
    scopes <@ ARRAY['control:read']::text[] AND cardinality(scopes)=1
  ),
  status control.installation_api_client_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES control.users(id),
  last_exchanged_at timestamptz,
  FOREIGN KEY (tenant_id,installation_id)
    REFERENCES control.white_label_installations(tenant_id,id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days'),
  CHECK ((status='revoked')=(revoked_at IS NOT NULL AND revoked_by IS NOT NULL)),
  UNIQUE (tenant_id,id)
);

CREATE TABLE control.installation_api_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  api_client_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['control:read']::text[] AND cardinality(scopes)=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id,installation_id)
    REFERENCES control.white_label_installations(tenant_id,id),
  FOREIGN KEY (tenant_id,api_client_id)
    REFERENCES control.installation_api_clients(tenant_id,id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes')
);

CREATE TABLE control.installation_api_rate_limits (
  tenant_id uuid NOT NULL,
  api_client_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('exchange','request')),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 1000),
  FOREIGN KEY (tenant_id,api_client_id)
    REFERENCES control.installation_api_clients(tenant_id,id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id,api_client_id,operation,window_started_at)
);

ALTER TABLE control.installation_api_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_api_clients FORCE ROW LEVEL SECURITY;
ALTER TABLE control.installation_api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_api_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE control.installation_api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.installation_api_rate_limits FORCE ROW LEVEL SECURITY;

CREATE POLICY installation_api_clients_tenant_isolation ON control.installation_api_clients
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY installation_api_tokens_tenant_isolation ON control.installation_api_tokens
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY installation_api_rate_limits_tenant_isolation ON control.installation_api_rate_limits
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.platform_owner_api_clients(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid
) RETURNS TABLE(
  id uuid,target_tenant_id uuid,target_name text,installation_id uuid,
  display_name text,client_identifier text,scopes text[],status text,
  created_at timestamptz,expires_at timestamptz,last_exchanged_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  RETURN QUERY SELECT client.id,client.tenant_id,tenant.display_name,
    client.installation_id,client.display_name,client.client_identifier,client.scopes,
    client.status::text,client.created_at,client.expires_at,client.last_exchanged_at
  FROM control.installation_api_clients client
  JOIN control.tenants tenant ON tenant.id=client.tenant_id
  ORDER BY client.created_at DESC,client.id DESC LIMIT 200;
END $$;

CREATE FUNCTION control.issue_platform_api_client(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid,target_tenant uuid,
  requested_identifier text,requested_secret_hash text,requested_name text,
  requested_expiry timestamptz,correlation uuid
) RETURNS TABLE(id uuid,installation_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected_installation uuid; new_id uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  SELECT installation.id INTO selected_installation
  FROM control.white_label_installations installation
  JOIN control.tenants tenant ON tenant.id=installation.tenant_id
  WHERE installation.tenant_id=target_tenant AND installation.status='active'
    AND tenant.status='active'
  ORDER BY installation.created_at LIMIT 1;
  IF target_tenant=authority_tenant OR selected_installation IS NULL
    OR NOT EXISTS (SELECT 1 FROM control.memberships WHERE tenant_id=target_tenant AND role='root_owner')
    OR requested_identifier !~ '^rc_[A-Za-z0-9_-]{32,96}$'
    OR requested_secret_hash !~ '^[0-9a-f]{64}$'
    OR char_length(btrim(requested_name)) NOT BETWEEN 2 AND 120
    OR requested_expiry<=now() OR requested_expiry>now()+interval '366 days'
  THEN RAISE EXCEPTION 'PLATFORM_API_CLIENT_NOT_ELIGIBLE' USING ERRCODE='22023'; END IF;
  INSERT INTO control.installation_api_clients
    (id,tenant_id,installation_id,client_identifier,secret_hash,display_name,created_by,expires_at)
    VALUES(new_id,target_tenant,selected_installation,requested_identifier,
      requested_secret_hash,btrim(requested_name),actor_user_id,requested_expiry);
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.api_client_issued',
      'installation_api_client',new_id::text,correlation,
      jsonb_build_object('targetTenantId',target_tenant,'installationId',selected_installation,
        'displayName',btrim(requested_name),'scopes',ARRAY['control:read'],'expiresAt',requested_expiry));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.api_client_issued',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',new_id),correlation);
  RETURN QUERY SELECT new_id,selected_installation,requested_expiry;
END $$;

CREATE FUNCTION control.revoke_platform_api_client(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid,
  requested_client uuid,correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.installation_api_clients%ROWTYPE; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  SELECT * INTO selected FROM control.installation_api_clients
    WHERE id=requested_client AND status='active' FOR UPDATE;
  IF NOT FOUND OR selected.tenant_id=authority_tenant
  THEN RAISE EXCEPTION 'PLATFORM_API_CLIENT_NOT_FOUND' USING ERRCODE='22023'; END IF;
  UPDATE control.installation_api_clients SET status='revoked',revoked_at=now(),revoked_by=actor_user_id
    WHERE id=selected.id;
  UPDATE control.installation_api_tokens SET revoked_at=now()
    WHERE api_client_id=selected.id AND revoked_at IS NULL;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.api_client_revoked',
      'installation_api_client',selected.id::text,correlation,
      jsonb_build_object('targetTenantId',selected.tenant_id,'installationId',selected.installation_id));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.api_client_revoked',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',selected.id),correlation);
END $$;

CREATE FUNCTION control.exchange_installation_api_client(
  requested_identifier text,requested_secret_hash text,new_token_hash text,requested_scope text
) RETURNS TABLE(expires_at timestamptz,scope text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.installation_api_clients%ROWTYPE; token_expiry timestamptz:=now()+interval '15 minutes';
  current_window timestamptz:=date_trunc('minute',now()); current_count integer;
BEGIN
  SELECT client.* INTO selected FROM control.installation_api_clients client
  JOIN control.tenants tenant ON tenant.id=client.tenant_id
  JOIN control.white_label_installations installation ON installation.id=client.installation_id
  WHERE client.client_identifier=requested_identifier AND client.secret_hash=requested_secret_hash
    AND client.status='active' AND client.expires_at>now()
    AND tenant.status='active' AND installation.status='active';
  IF NOT FOUND OR requested_scope<>'control:read' OR NOT requested_scope=ANY(selected.scopes)
    OR new_token_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'INVALID_API_CLIENT_CREDENTIALS' USING ERRCODE='28000'; END IF;
  INSERT INTO control.installation_api_rate_limits(tenant_id,api_client_id,operation,window_started_at,request_count)
    VALUES(selected.tenant_id,selected.id,'exchange',current_window,1)
    ON CONFLICT(tenant_id,api_client_id,operation,window_started_at) DO UPDATE
      SET request_count=control.installation_api_rate_limits.request_count+1
    RETURNING request_count INTO current_count;
  IF current_count>10 THEN RAISE EXCEPTION 'API_RATE_LIMIT_EXCEEDED' USING ERRCODE='P0001'; END IF;
  INSERT INTO control.installation_api_tokens
    (id,tenant_id,installation_id,api_client_id,token_hash,scopes,expires_at)
    VALUES(gen_random_uuid(),selected.tenant_id,selected.installation_id,selected.id,
      new_token_hash,ARRAY[requested_scope],token_expiry);
  UPDATE control.installation_api_clients SET last_exchanged_at=now() WHERE id=selected.id;
  RETURN QUERY SELECT token_expiry,requested_scope;
END $$;

CREATE FUNCTION control.installation_api_control_summary(
  requested_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected record; current_window timestamptz:=date_trunc('minute',now()); current_count integer;
  result jsonb;
BEGIN
  SELECT token.api_client_id,token.tenant_id,token.installation_id INTO selected
  FROM control.installation_api_tokens token
  JOIN control.installation_api_clients client ON client.id=token.api_client_id
  JOIN control.tenants tenant ON tenant.id=token.tenant_id
  JOIN control.white_label_installations installation ON installation.id=token.installation_id
  WHERE token.token_hash=requested_token_hash AND token.revoked_at IS NULL
    AND token.expires_at>now() AND 'control:read'=ANY(token.scopes)
    AND client.status='active' AND client.expires_at>now()
    AND tenant.status='active' AND installation.status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_API_ACCESS_TOKEN' USING ERRCODE='28000'; END IF;
  INSERT INTO control.installation_api_rate_limits(tenant_id,api_client_id,operation,window_started_at,request_count)
    VALUES(selected.tenant_id,selected.api_client_id,'request',current_window,1)
    ON CONFLICT(tenant_id,api_client_id,operation,window_started_at) DO UPDATE
      SET request_count=control.installation_api_rate_limits.request_count+1
    RETURNING request_count INTO current_count;
  IF current_count>60 THEN RAISE EXCEPTION 'API_RATE_LIMIT_EXCEEDED' USING ERRCODE='P0001'; END IF;
  SELECT jsonb_build_object(
    'installation',jsonb_build_object('name',installation.display_name,'status',installation.status),
    'plan',entitlement.plan_id,
    'enabledModules',entitlement.enabled_modules,
    'limits',jsonb_build_object('maximumUsers',entitlement.maximum_users,
      'maximumWorkspaces',entitlement.maximum_workspaces,
      'maximumSocialAccounts',entitlement.maximum_social_accounts,
      'monthlyPublicationQuota',entitlement.monthly_publication_quota,
      'storageQuotaBytes',entitlement.storage_quota_bytes),
    'workzones',coalesce((SELECT jsonb_agg(jsonb_build_object('name',workspace.name)
      ORDER BY workspace.created_at) FROM control.business_workspaces workspace
      WHERE workspace.tenant_id=selected.tenant_id AND workspace.installation_id=selected.installation_id),'[]'::jsonb),
    'capabilities',jsonb_build_object('readOnly',true,'publishing',false,'providerConnections',false)
  ) INTO result
  FROM control.white_label_installations installation
  JOIN control.installation_entitlements entitlement
    ON entitlement.installation_id=installation.id AND entitlement.tenant_id=installation.tenant_id
  WHERE installation.id=selected.installation_id AND installation.tenant_id=selected.tenant_id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION control.platform_owner_api_clients(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.issue_platform_api_client(uuid,uuid,uuid,uuid,text,text,text,timestamptz,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.revoke_platform_api_client(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.exchange_installation_api_client(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.installation_api_control_summary(text) FROM PUBLIC;

COMMENT ON TABLE control.installation_api_clients IS 'Installation-bound machine identities. Plaintext client secrets are never persisted.';
COMMENT ON TABLE control.installation_api_tokens IS 'Opaque, hashed, maximum 15-minute installation API access tokens.';
COMMENT ON FUNCTION control.installation_api_control_summary(text) IS 'Tenant-derived, read-only v1 API summary; token holder cannot select another tenant.';
