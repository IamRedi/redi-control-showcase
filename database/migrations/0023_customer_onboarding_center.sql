ALTER TABLE control.first_owner_invitations
  ADD COLUMN issued_by uuid REFERENCES control.users(id),
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by uuid REFERENCES control.users(id),
  ADD CONSTRAINT first_owner_invitation_revocation_consistent CHECK (
    (revoked_at IS NULL) = (revoked_by IS NULL)
  );

CREATE OR REPLACE FUNCTION control.consume_first_owner_invitation(
  p_token_hash text,p_email_hash text,p_identity_subject text,p_email text,
  p_identity_provider text,p_installation_id uuid,p_mfa_verified boolean,
  p_correlation_id uuid
) RETURNS TABLE(user_id uuid,tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.first_owner_invitations%ROWTYPE;
  resolved_user_id uuid; audit_id uuid:=gen_random_uuid();
BEGIN
  IF NOT p_mfa_verified THEN RAISE EXCEPTION 'FIRST_OWNER_MFA_REQUIRED'; END IF;
  SELECT invitation.* INTO selected
  FROM control.first_owner_invitations invitation
  JOIN control.tenants tenant ON tenant.id=invitation.tenant_id
  JOIN control.white_label_installations installation
    ON installation.id=invitation.installation_id
   AND installation.tenant_id=invitation.tenant_id
  WHERE invitation.token_hash=p_token_hash AND invitation.email_hash=p_email_hash
    AND invitation.installation_id=p_installation_id
    AND invitation.consumed_at IS NULL AND invitation.revoked_at IS NULL
    AND invitation.expires_at>now() AND tenant.status='active'
    AND installation.status='active'
  FOR UPDATE OF invitation;
  IF selected.id IS NULL THEN RAISE EXCEPTION 'FIRST_OWNER_INVITATION_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM control.memberships membership
    WHERE membership.tenant_id=selected.tenant_id AND membership.role='root_owner')
  THEN RAISE EXCEPTION 'FIRST_OWNER_ALREADY_EXISTS'; END IF;
  INSERT INTO control.users(id,identity_subject,email)
    VALUES(gen_random_uuid(),p_identity_subject,p_email)
    ON CONFLICT(identity_subject) DO UPDATE SET email=EXCLUDED.email
    RETURNING id INTO resolved_user_id;
  INSERT INTO control.memberships(tenant_id,user_id,role)
    VALUES(selected.tenant_id,resolved_user_id,'root_owner');
  UPDATE control.first_owner_invitations SET consumed_at=now(),consumed_by=resolved_user_id
    WHERE id=selected.id;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,selected.tenant_id,resolved_user_id,'identity.first_owner_bootstrapped',
      'installation',selected.installation_id::text,p_correlation_id,
      jsonb_build_object('invitationId',selected.id,'identityProvider',p_identity_provider));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),selected.tenant_id,'identity.first_owner_bootstrapped',1,
      jsonb_build_object('auditEventId',audit_id),p_correlation_id);
  RETURN QUERY SELECT resolved_user_id,selected.tenant_id;
END $$;

CREATE FUNCTION control.platform_owner_onboarding(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid
) RETURNS TABLE(
  target_tenant_id uuid,installation_id uuid,setup_status text,tenant_status text,
  installation_status text,domain_status text,owner_count integer,workspace_count integer,
  pending_invitation_id uuid,invitation_expires_at timestamptz,invitation_status text,
  invitation_eligible boolean,blockers text[]
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  RETURN QUERY
  SELECT tenant.id,installation.id,coalesce(setup.status::text,'not_configured'),
    tenant.status,coalesce(installation.status::text,'not_provisioned'),
    coalesce(domain.status,'not_configured'),
    (SELECT count(*)::int FROM control.memberships membership
      WHERE membership.tenant_id=tenant.id AND membership.role='root_owner'),
    (SELECT count(*)::int FROM control.business_workspaces workspace
      WHERE workspace.tenant_id=tenant.id),invitation.id,invitation.expires_at,
    CASE WHEN invitation.id IS NULL THEN 'not_issued'
      WHEN invitation.consumed_at IS NOT NULL THEN 'consumed'
      WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
      WHEN invitation.expires_at<=now() THEN 'expired' ELSE 'active' END,
    setup.id IS NOT NULL AND tenant.status='active' AND installation.status='active'
      AND domain.status='active'
      AND NOT EXISTS(SELECT 1 FROM control.memberships membership
        WHERE membership.tenant_id=tenant.id AND membership.role='root_owner')
      AND NOT EXISTS(SELECT 1 FROM control.first_owner_invitations active_invitation
        WHERE active_invitation.tenant_id=tenant.id
          AND active_invitation.consumed_at IS NULL AND active_invitation.revoked_at IS NULL
          AND active_invitation.expires_at>now()),
    array_remove(ARRAY[
      CASE WHEN setup.id IS NULL THEN 'package_not_configured' END,
      CASE WHEN tenant.status<>'active' THEN 'tenant_not_active' END,
      CASE WHEN installation.id IS NULL OR installation.status<>'active'
        THEN 'installation_not_active' END,
      CASE WHEN domain.status IS DISTINCT FROM 'active' THEN 'canonical_domain_not_active' END,
      CASE WHEN EXISTS(SELECT 1 FROM control.memberships membership
        WHERE membership.tenant_id=tenant.id AND membership.role='root_owner')
        THEN 'owner_already_active' END,
      CASE WHEN EXISTS(SELECT 1 FROM control.first_owner_invitations active_invitation
        WHERE active_invitation.tenant_id=tenant.id
          AND active_invitation.consumed_at IS NULL AND active_invitation.revoked_at IS NULL
          AND active_invitation.expires_at>now()) THEN 'invitation_active' END
    ]::text[],NULL)
  FROM control.tenants tenant
  LEFT JOIN LATERAL(SELECT candidate.id,candidate.status FROM control.white_label_installations candidate
    WHERE candidate.tenant_id=tenant.id ORDER BY candidate.created_at LIMIT 1) installation ON true
  LEFT JOIN control.platform_tenant_setups setup ON setup.target_tenant_id=tenant.id
  LEFT JOIN LATERAL(SELECT candidate.status::text status FROM control.installation_domains candidate
    WHERE candidate.tenant_id=tenant.id AND candidate.installation_id=installation.id
      AND candidate.domain_kind='canonical'
    ORDER BY CASE candidate.status WHEN 'active' THEN 0 WHEN 'verified' THEN 1
      WHEN 'pending' THEN 2 ELSE 3 END,candidate.created_at LIMIT 1) domain ON true
  LEFT JOIN LATERAL(SELECT candidate.id,candidate.expires_at,candidate.consumed_at,candidate.revoked_at
    FROM control.first_owner_invitations candidate WHERE candidate.tenant_id=tenant.id
    ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1) invitation ON true
  WHERE tenant.id<>authority_tenant AND tenant.status<>'deleted'
  ORDER BY tenant.created_at,tenant.id;
END $$;

CREATE FUNCTION control.issue_platform_first_owner_invitation(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid,target_tenant uuid,
  requested_token_hash text,requested_email_hash text,lifetime_hours integer,correlation uuid
) RETURNS TABLE(id uuid,installation_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected_installation uuid; invitation_id uuid:=gen_random_uuid();
  invitation_expiry timestamptz; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(target_tenant::text,0));
  IF target_tenant=authority_tenant OR requested_token_hash !~ '^[0-9a-f]{64}$'
    OR requested_email_hash !~ '^[0-9a-f]{64}$' OR lifetime_hours NOT BETWEEN 1 AND 168
  THEN RAISE EXCEPTION 'PLATFORM_OWNER_INVITATION_NOT_ELIGIBLE' USING ERRCODE='22023'; END IF;
  SELECT installation.id INTO selected_installation
  FROM control.white_label_installations installation
  JOIN control.tenants tenant ON tenant.id=installation.tenant_id
  JOIN control.platform_tenant_setups setup ON setup.target_tenant_id=tenant.id
  WHERE tenant.id=target_tenant AND tenant.status='active' AND installation.status='active'
    AND EXISTS(SELECT 1 FROM control.installation_domains domain
      WHERE domain.tenant_id=target_tenant AND domain.installation_id=installation.id
        AND domain.domain_kind='canonical' AND domain.status='active')
  ORDER BY installation.created_at LIMIT 1 FOR UPDATE OF installation;
  IF selected_installation IS NULL
    OR EXISTS(SELECT 1 FROM control.memberships membership
      WHERE membership.tenant_id=target_tenant AND membership.role='root_owner')
    OR EXISTS(SELECT 1 FROM control.first_owner_invitations invitation
      WHERE invitation.tenant_id=target_tenant AND invitation.consumed_at IS NULL
        AND invitation.revoked_at IS NULL AND invitation.expires_at>now())
  THEN RAISE EXCEPTION 'PLATFORM_OWNER_INVITATION_NOT_ELIGIBLE' USING ERRCODE='22023'; END IF;
  invitation_expiry:=now()+make_interval(hours=>lifetime_hours);
  INSERT INTO control.first_owner_invitations
    (id,tenant_id,installation_id,token_hash,email_hash,expires_at,correlation_id,issued_by)
    VALUES(invitation_id,target_tenant,selected_installation,requested_token_hash,
      requested_email_hash,invitation_expiry,correlation,actor_user_id);
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.owner_invitation_issued',
      'tenant',target_tenant::text,correlation,jsonb_build_object(
        'invitationId',invitation_id,'installationId',selected_installation,
        'expiresAt',invitation_expiry));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.owner_invitation_issued',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',target_tenant),correlation);
  RETURN QUERY SELECT invitation_id,selected_installation,invitation_expiry;
END $$;

CREATE FUNCTION control.revoke_platform_first_owner_invitation(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid,
  invitation_id uuid,correlation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected control.first_owner_invitations%ROWTYPE; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  SELECT invitation.* INTO selected FROM control.first_owner_invitations invitation
    WHERE invitation.id=invitation_id AND invitation.tenant_id<>authority_tenant
      AND invitation.consumed_at IS NULL AND invitation.revoked_at IS NULL
      AND invitation.expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_OWNER_INVITATION_NOT_FOUND' USING ERRCODE='22023'; END IF;
  UPDATE control.first_owner_invitations SET revoked_at=now(),revoked_by=actor_user_id
    WHERE id=selected.id;
  INSERT INTO control.audit_events
    (id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata)
    VALUES(audit_id,authority_tenant,actor_user_id,'platform.owner_invitation_revoked',
      'tenant',selected.tenant_id::text,correlation,
      jsonb_build_object('invitationId',selected.id,'installationId',selected.installation_id));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
    VALUES(gen_random_uuid(),authority_tenant,'platform.owner_invitation_revoked',1,
      jsonb_build_object('auditEventId',audit_id,'targetId',selected.tenant_id),correlation);
END $$;

REVOKE ALL ON FUNCTION control.platform_owner_onboarding(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.issue_platform_first_owner_invitation(uuid,uuid,uuid,uuid,text,text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.revoke_platform_first_owner_invitation(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;

COMMENT ON FUNCTION control.platform_owner_onboarding(uuid,uuid,uuid) IS
  'Safe cross-tenant onboarding readiness; excludes recipient identity and secret material.';
