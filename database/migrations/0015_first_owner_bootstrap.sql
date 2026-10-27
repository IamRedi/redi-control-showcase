CREATE TABLE control.first_owner_invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES control.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES control.white_label_installations(tenant_id, id),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX first_owner_invitations_active_idx
  ON control.first_owner_invitations (token_hash, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE control.first_owner_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.first_owner_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY first_owner_invitations_auth_access
  ON control.first_owner_invitations
  TO redi_control_auth
  USING (true);

CREATE FUNCTION control.consume_first_owner_invitation(
  p_token_hash text,
  p_email_hash text,
  p_identity_subject text,
  p_email text,
  p_identity_provider text,
  p_installation_id uuid,
  p_mfa_verified boolean,
  p_correlation_id uuid
)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
DECLARE
  selected control.first_owner_invitations%ROWTYPE;
  resolved_user_id uuid;
  audit_id uuid := gen_random_uuid();
BEGIN
  IF NOT p_mfa_verified THEN
    RAISE EXCEPTION 'FIRST_OWNER_MFA_REQUIRED';
  END IF;

  SELECT invitation.* INTO selected
  FROM control.first_owner_invitations invitation
  JOIN control.tenants tenant ON tenant.id = invitation.tenant_id
  JOIN control.white_label_installations installation
    ON installation.id = invitation.installation_id
   AND installation.tenant_id = invitation.tenant_id
  WHERE invitation.token_hash = p_token_hash
    AND invitation.email_hash = p_email_hash
    AND invitation.installation_id = p_installation_id
    AND invitation.consumed_at IS NULL
    AND invitation.expires_at > now()
    AND tenant.status = 'active'
    AND installation.status = 'active'
  FOR UPDATE OF invitation;

  IF selected.id IS NULL THEN
    RAISE EXCEPTION 'FIRST_OWNER_INVITATION_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM control.memberships membership
    WHERE membership.role = 'root_owner'
  ) THEN
    RAISE EXCEPTION 'FIRST_OWNER_ALREADY_EXISTS';
  END IF;

  INSERT INTO control.users (id, identity_subject, email)
  VALUES (gen_random_uuid(), p_identity_subject, p_email)
  ON CONFLICT (identity_subject) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO resolved_user_id;

  INSERT INTO control.memberships (tenant_id, user_id, role)
  VALUES (selected.tenant_id, resolved_user_id, 'root_owner');

  UPDATE control.first_owner_invitations
  SET consumed_at = now(), consumed_by = resolved_user_id
  WHERE id = selected.id;

  INSERT INTO control.audit_events
    (id, tenant_id, actor_user_id, action, target_type, target_id,
     correlation_id, metadata)
  VALUES
    (audit_id, selected.tenant_id, resolved_user_id,
     'identity.first_owner_bootstrapped', 'installation',
     selected.installation_id::text, p_correlation_id,
     jsonb_build_object(
       'invitationId', selected.id,
       'identityProvider', p_identity_provider
     ));

  INSERT INTO control.outbox_events
    (id, tenant_id, event_type, event_version, payload, correlation_id)
  VALUES
    (gen_random_uuid(), selected.tenant_id,
     'identity.first_owner_bootstrapped', 1,
     jsonb_build_object('auditEventId', audit_id), p_correlation_id);

  RETURN QUERY SELECT resolved_user_id, selected.tenant_id;
END;
$$;

REVOKE ALL ON control.first_owner_invitations FROM PUBLIC;
REVOKE ALL ON FUNCTION control.consume_first_owner_invitation(
  text, text, text, text, text, uuid, boolean, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.consume_first_owner_invitation(
  text, text, text, text, text, uuid, boolean, uuid
) TO redi_control_auth;

COMMENT ON TABLE control.first_owner_invitations IS
  'Short-lived, installation-bound, single-use bootstrap invitations. Raw tokens and recipient email are never stored.';
