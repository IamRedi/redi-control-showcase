CREATE TABLE control.member_invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  identity_subject text NOT NULL UNIQUE CHECK (length(identity_subject) BETWEEN 3 AND 1024),
  role control.membership_role NOT NULL,
  expires_at timestamptz NOT NULL,
  delivered_at timestamptz,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES control.users(id),
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX member_invitations_active_email_idx
  ON control.member_invitations (tenant_id, email_hash)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX member_invitations_pending_identity_idx
  ON control.member_invitations (identity_subject, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE control.member_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.member_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY member_invitations_runtime_tenant_access
  ON control.member_invitations
  TO redi_control_runtime
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE FUNCTION control.consume_member_invitation(
  p_identity_subject text,
  p_email_hash text,
  p_email text,
  p_identity_provider text,
  p_installation_id uuid,
  p_mfa_verified boolean,
  p_correlation_id uuid
)
RETURNS TABLE (user_id uuid, tenant_id uuid, roles text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
DECLARE
  selected control.member_invitations%ROWTYPE;
  resolved_user_id uuid;
  audit_id uuid := gen_random_uuid();
BEGIN
  IF NOT p_mfa_verified THEN
    RAISE EXCEPTION 'MEMBER_INVITATION_MFA_REQUIRED';
  END IF;

  SELECT invitation.* INTO selected
  FROM control.member_invitations invitation
  JOIN control.tenants tenant ON tenant.id = invitation.tenant_id
  JOIN control.white_label_installations installation
    ON installation.id = invitation.installation_id
   AND installation.tenant_id = invitation.tenant_id
  WHERE invitation.identity_subject = p_identity_subject
    AND invitation.email_hash = p_email_hash
    AND invitation.installation_id = p_installation_id
    AND invitation.consumed_at IS NULL
    AND invitation.revoked_at IS NULL
    AND invitation.expires_at > now()
    AND tenant.status = 'active'
    AND installation.status = 'active'
  FOR UPDATE OF invitation;

  IF selected.id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_INVITATION_INVALID';
  END IF;

  INSERT INTO control.users (id, identity_subject, email)
  VALUES (gen_random_uuid(), p_identity_subject, p_email)
  ON CONFLICT (identity_subject) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO resolved_user_id;

  INSERT INTO control.memberships (tenant_id, user_id, role)
  VALUES (selected.tenant_id, resolved_user_id, selected.role)
  ON CONFLICT DO NOTHING;

  UPDATE control.member_invitations
  SET consumed_at = now(), consumed_by = resolved_user_id
  WHERE id = selected.id;

  INSERT INTO control.audit_events
    (id, tenant_id, actor_user_id, action, target_type, target_id,
     correlation_id, metadata)
  VALUES
    (audit_id, selected.tenant_id, resolved_user_id,
     'identity.member_invitation_consumed', 'member_invitation',
     selected.id::text, p_correlation_id,
     jsonb_build_object('role', selected.role, 'identityProvider', p_identity_provider));

  INSERT INTO control.outbox_events
    (id, tenant_id, event_type, event_version, payload, correlation_id)
  VALUES
    (gen_random_uuid(), selected.tenant_id,
     'identity.member_invitation_consumed', 1,
     jsonb_build_object('auditEventId', audit_id), p_correlation_id);

  RETURN QUERY
    SELECT resolved_user_id, selected.tenant_id,
      ARRAY(SELECT membership.role::text
            FROM control.memberships membership
            WHERE membership.user_id = resolved_user_id
              AND membership.tenant_id = selected.tenant_id
            ORDER BY membership.role::text);
END;
$$;

REVOKE ALL ON control.member_invitations FROM PUBLIC;
REVOKE ALL ON FUNCTION control.consume_member_invitation(
  text, text, text, text, uuid, boolean, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.consume_member_invitation(
  text, text, text, text, uuid, boolean, uuid
) TO redi_control_auth;

COMMENT ON TABLE control.member_invitations IS
  'Short-lived verified identity invitations for one tenant. Recipient plaintext is never stored.';
