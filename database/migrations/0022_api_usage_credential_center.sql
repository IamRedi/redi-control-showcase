CREATE FUNCTION control.assert_tenant_api_admin(
  actor_user_id uuid,target_tenant uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM control.memberships
    WHERE tenant_id=target_tenant AND user_id=actor_user_id
      AND role IN ('root_owner','white_label_owner')
  ) THEN RAISE EXCEPTION 'TENANT_API_ADMIN_DENIED' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION control.tenant_api_clients(
  actor_user_id uuid,target_tenant uuid
) RETURNS TABLE(
  id uuid,installation_id uuid,display_name text,client_identifier text,
  scopes text[],status text,created_at timestamptz,expires_at timestamptz,
  last_exchanged_at timestamptz,active_token_count integer,
  request_count_24h bigint,request_count_30d bigint,exchange_count_30d bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_tenant_api_admin(actor_user_id,target_tenant);
  RETURN QUERY SELECT client.id,client.installation_id,client.display_name,
    client.client_identifier,client.scopes,client.status::text,client.created_at,
    client.expires_at,client.last_exchanged_at,
    (SELECT count(*)::int FROM control.installation_api_tokens token
      WHERE token.tenant_id=target_tenant AND token.api_client_id=client.id
        AND token.revoked_at IS NULL AND token.expires_at>now()),
    coalesce((SELECT sum(rate.request_count) FROM control.installation_api_rate_limits rate
      WHERE rate.tenant_id=target_tenant AND rate.api_client_id=client.id
        AND rate.operation='request' AND rate.window_started_at>=now()-interval '24 hours'),0),
    coalesce((SELECT sum(rate.request_count) FROM control.installation_api_rate_limits rate
      WHERE rate.tenant_id=target_tenant AND rate.api_client_id=client.id
        AND rate.operation='request' AND rate.window_started_at>=now()-interval '30 days'),0),
    coalesce((SELECT sum(rate.request_count) FROM control.installation_api_rate_limits rate
      WHERE rate.tenant_id=target_tenant AND rate.api_client_id=client.id
        AND rate.operation='exchange' AND rate.window_started_at>=now()-interval '30 days'),0)
  FROM control.installation_api_clients client
  WHERE client.tenant_id=target_tenant
  ORDER BY client.created_at DESC,client.id DESC;
END $$;

CREATE FUNCTION control.issue_tenant_api_client(
  actor_user_id uuid,target_tenant uuid,requested_identifier text,
  requested_secret_hash text,requested_name text,requested_expiry timestamptz,
  correlation uuid
) RETURNS TABLE(id uuid,installation_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected_installation uuid; new_id uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_tenant_api_admin(actor_user_id,target_tenant);
  SELECT installation.id INTO selected_installation
  FROM control.white_label_installations installation
  JOIN control.tenants tenant ON tenant.id=installation.tenant_id
  WHERE installation.tenant_id=target_tenant AND installation.status='active'
    AND tenant.status='active'
  ORDER BY installation.created_at LIMIT 1;
  IF selected_installation IS NULL
    OR requested_identifier !~ '^rc_[A-Za-z0-9_-]{32,96}$'
    OR requested_secret_hash !~ '^[0-9a-f]{64}$'
    OR char_length(btrim(requested_name)) NOT BETWEEN 2 AND 120
    OR requested_expiry<=now() OR requested_expiry>now()+interval '366 days'
  THEN RAISE EXCEPTION 'TENANT_API_CLIENT_NOT_ELIGIBLE' USING ERRCODE='22023'; END IF;
  INSERT INTO control.installation_api_clients
    (id,tenant_id,installation_id,client_identifier,secret_hash,display_name,created_by,expires_at)
    VALUES(new_id,target_tenant,selected_installation,requested_identifier,
      requested_secret_hash,btrim(requested_name),actor_user_id,requested_expiry);
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'installation.api_client_issued',
      'installation_api_client',new_id::text,correlation,
      jsonb_build_object('installationId',selected_installation,'displayName',btrim(requested_name),
        'scopes',ARRAY['control:read'],'expiresAt',requested_expiry));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'installation.api_client_issued',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',new_id),correlation);
  RETURN QUERY SELECT new_id,selected_installation,requested_expiry;
END $$;

CREATE FUNCTION control.rotate_tenant_api_client(
  actor_user_id uuid,target_tenant uuid,requested_client uuid,
  requested_secret_hash text,correlation uuid
) RETURNS TABLE(client_identifier text,rotated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.installation_api_clients%ROWTYPE; rotation_time timestamptz:=now();
  audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_tenant_api_admin(actor_user_id,target_tenant);
  SELECT * INTO selected FROM control.installation_api_clients
    WHERE id=requested_client AND tenant_id=target_tenant AND status='active'
      AND expires_at>now() FOR UPDATE;
  IF NOT FOUND OR requested_secret_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'TENANT_API_CLIENT_NOT_FOUND' USING ERRCODE='22023'; END IF;
  UPDATE control.installation_api_clients SET secret_hash=requested_secret_hash,
    last_exchanged_at=NULL WHERE id=selected.id AND tenant_id=target_tenant;
  UPDATE control.installation_api_tokens SET revoked_at=rotation_time
    WHERE tenant_id=target_tenant AND api_client_id=selected.id AND revoked_at IS NULL;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'installation.api_client_rotated',
      'installation_api_client',selected.id::text,correlation,
      jsonb_build_object('installationId',selected.installation_id,'activeTokensRevoked',true));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'installation.api_client_rotated',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',selected.id),correlation);
  RETURN QUERY SELECT selected.client_identifier,rotation_time;
END $$;

CREATE FUNCTION control.revoke_tenant_api_client(
  actor_user_id uuid,target_tenant uuid,requested_client uuid,correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.installation_api_clients%ROWTYPE; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_tenant_api_admin(actor_user_id,target_tenant);
  SELECT * INTO selected FROM control.installation_api_clients
    WHERE id=requested_client AND tenant_id=target_tenant AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TENANT_API_CLIENT_NOT_FOUND' USING ERRCODE='22023'; END IF;
  UPDATE control.installation_api_clients SET status='revoked',revoked_at=now(),revoked_by=actor_user_id
    WHERE id=selected.id AND tenant_id=target_tenant;
  UPDATE control.installation_api_tokens SET revoked_at=now()
    WHERE tenant_id=target_tenant AND api_client_id=selected.id AND revoked_at IS NULL;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,target_tenant,actor_user_id,'installation.api_client_revoked',
      'installation_api_client',selected.id::text,correlation,
      jsonb_build_object('installationId',selected.installation_id));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),target_tenant,'installation.api_client_revoked',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',selected.id),correlation);
END $$;

REVOKE ALL ON FUNCTION control.assert_tenant_api_admin(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.tenant_api_clients(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.issue_tenant_api_client(uuid,uuid,text,text,text,timestamptz,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.rotate_tenant_api_client(uuid,uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.revoke_tenant_api_client(uuid,uuid,uuid,uuid) FROM PUBLIC;

COMMENT ON FUNCTION control.tenant_api_clients(uuid,uuid) IS 'Safe tenant-admin credential inventory and bounded usage projection; never returns secret or token hashes.';
COMMENT ON FUNCTION control.rotate_tenant_api_client(uuid,uuid,uuid,text,uuid) IS 'Atomically replaces one client secret digest and revokes every previously issued access token.';
