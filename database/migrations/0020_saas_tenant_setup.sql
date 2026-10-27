CREATE TYPE control.platform_tenant_setup_status AS ENUM ('configured','awaiting_owner');

CREATE TABLE control.platform_tenant_setups (
  id uuid PRIMARY KEY,
  authority_tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  target_tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  installation_id uuid NOT NULL REFERENCES control.white_label_installations(id),
  workspace_id uuid NOT NULL REFERENCES control.business_workspaces(id),
  template_id text NOT NULL CHECK (template_id IN ('media_starter','media_team','media_network')),
  status control.platform_tenant_setup_status NOT NULL DEFAULT 'configured',
  default_locale text NOT NULL CHECK (default_locale IN ('en','de','sq')),
  enabled_locales text[] NOT NULL CHECK (
    enabled_locales <@ ARRAY['en','de','sq']::text[] AND
    cardinality(enabled_locales) BETWEEN 1 AND 3 AND
    default_locale=ANY(enabled_locales)
  ),
  configured_by uuid NOT NULL REFERENCES control.users(id),
  configured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (target_tenant_id,installation_id)
    REFERENCES control.white_label_installations(tenant_id,id),
  FOREIGN KEY (target_tenant_id,workspace_id)
    REFERENCES control.business_workspaces(tenant_id,id),
  UNIQUE (target_tenant_id),
  UNIQUE (authority_tenant_id,id)
);

ALTER TABLE control.platform_tenant_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.platform_tenant_setups FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tenant_setups_authority_isolation
  ON control.platform_tenant_setups
  USING (authority_tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (authority_tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE FUNCTION control.platform_owner_tenant_setups(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid
) RETURNS TABLE(
  target_tenant_id uuid,template_id text,status text,default_locale text,
  enabled_locales text[],configured_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  RETURN QUERY SELECT setup.target_tenant_id,setup.template_id,setup.status::text,
    setup.default_locale,setup.enabled_locales,setup.configured_at
  FROM control.platform_tenant_setups setup
  ORDER BY setup.configured_at DESC,setup.id DESC;
END $$;

CREATE FUNCTION control.configure_platform_tenant(
  actor_user_id uuid,authority_tenant uuid,access_grant_id uuid,
  target_tenant uuid,requested_template text,requested_default_locale text,
  requested_locales text[],brand_accent text,correlation uuid
) RETURNS TABLE(installation_id uuid,workspace_id uuid,setup_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $$
DECLARE selected_installation uuid; selected_workspace uuid;
  modules text[]; plan text; users_limit integer; workspaces_limit integer;
  accounts_limit integer; publication_limit integer; storage_limit bigint;
  setup_id uuid; audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM control.assert_platform_access(actor_user_id,authority_tenant,access_grant_id);
  IF target_tenant=authority_tenant
    OR requested_template NOT IN ('media_starter','media_team','media_network')
    OR requested_default_locale NOT IN ('en','de','sq')
    OR requested_locales IS NULL OR cardinality(requested_locales) NOT BETWEEN 1 AND 3
    OR NOT requested_locales <@ ARRAY['en','de','sq']::text[]
    OR requested_default_locale<>ALL(requested_locales)
    OR brand_accent !~ '^#[0-9A-Fa-f]{6}$'
  THEN RAISE EXCEPTION 'INVALID_PLATFORM_TENANT_SETUP' USING ERRCODE='22023'; END IF;

  SELECT installation.id INTO selected_installation
  FROM control.white_label_installations installation
  JOIN control.tenants tenant ON tenant.id=installation.tenant_id
  WHERE installation.tenant_id=target_tenant AND installation.status='pending'
    AND tenant.status='active'
  ORDER BY installation.created_at LIMIT 1 FOR UPDATE OF installation;
  IF selected_installation IS NULL OR EXISTS(
    SELECT 1 FROM control.memberships WHERE tenant_id=target_tenant
  ) THEN RAISE EXCEPTION 'PLATFORM_TENANT_SETUP_NOT_ELIGIBLE' USING ERRCODE='22023'; END IF;

  SELECT workspace.id INTO selected_workspace FROM control.business_workspaces workspace
  WHERE workspace.tenant_id=target_tenant AND workspace.installation_id=selected_installation
  ORDER BY workspace.created_at LIMIT 1;
  IF selected_workspace IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_TENANT_SETUP_NOT_ELIGIBLE' USING ERRCODE='22023';
  END IF;

  modules:=ARRAY['platforms','media','social','websites','unified_content','media_intelligence'];
  IF requested_template IN ('media_team','media_network') THEN
    modules:=modules||ARRAY['context_studio','ai'];
  END IF;
  SELECT value.plan,value.maximum_users,value.maximum_workspaces,
    value.maximum_accounts,value.publications,value.storage_bytes
  INTO plan,users_limit,workspaces_limit,accounts_limit,publication_limit,storage_limit
  FROM (VALUES
    ('media_starter','media_starter',5,1,5,250,26843545600::bigint),
    ('media_team','media_team',15,2,15,2000,107374182400::bigint),
    ('media_network','media_network',50,5,50,10000,536870912000::bigint)
  ) value(template,plan,maximum_users,maximum_workspaces,maximum_accounts,publications,storage_bytes)
  WHERE value.template=requested_template;

  UPDATE control.installation_profiles profile SET
    brand=profile.brand||jsonb_build_object('accent',upper(brand_accent)),
    enabled_locales=(SELECT array_agg(DISTINCT locale ORDER BY locale) FROM unnest(requested_locales) locale),
    default_locale=requested_default_locale,enabled_modules=modules,updated_at=now()
  WHERE profile.installation_id=selected_installation AND profile.tenant_id=target_tenant;
  UPDATE control.installation_entitlements entitlement SET
    plan_id=plan,enabled_modules=modules,maximum_businesses=1,
    maximum_workspaces=workspaces_limit,maximum_social_accounts=accounts_limit,
    monthly_publication_quota=publication_limit,storage_quota_bytes=storage_limit,
    maximum_users=users_limit,provider_availability=ARRAY[]::control.social_provider[],
    shared_oauth_allowed=false,dedicated_oauth_allowed=false,future_ai_quota=0,
    effective_from=now(),effective_until=NULL,updated_at=now()
  WHERE entitlement.installation_id=selected_installation AND entitlement.tenant_id=target_tenant;

  INSERT INTO control.feature_flags(tenant_id,name,enabled,updated_by)
  SELECT target_tenant,feature.name,feature.enabled,actor_user_id FROM (VALUES
    ('module.overview',true),('module.media',true),('module.social',true),
    ('module.websites',true),('module.unified-content',true),
    ('module.media-intelligence',true),
    ('module.context-studio',requested_template IN ('media_team','media_network')),
    ('module.ai',requested_template IN ('media_team','media_network')),
    ('module.automations',false)
  ) feature(name,enabled)
  ON CONFLICT(tenant_id,name) DO UPDATE SET enabled=EXCLUDED.enabled,
    updated_by=EXCLUDED.updated_by,updated_at=now();

  INSERT INTO control.platform_tenant_setups(
    id,authority_tenant_id,target_tenant_id,installation_id,workspace_id,
    template_id,status,default_locale,enabled_locales,configured_by
  ) VALUES(gen_random_uuid(),authority_tenant,target_tenant,selected_installation,
    selected_workspace,requested_template,'awaiting_owner',requested_default_locale,
    requested_locales,actor_user_id)
  ON CONFLICT(target_tenant_id) DO UPDATE SET
    authority_tenant_id=EXCLUDED.authority_tenant_id,
    template_id=EXCLUDED.template_id,status='awaiting_owner',
    default_locale=EXCLUDED.default_locale,enabled_locales=EXCLUDED.enabled_locales,
    configured_by=EXCLUDED.configured_by,configured_at=now(),updated_at=now()
  RETURNING id INTO setup_id;

  INSERT INTO control.audit_events(
    id,tenant_id,actor_user_id,action,target_type,target_id,correlation_id,metadata
  ) VALUES(audit_id,authority_tenant,actor_user_id,'platform.tenant_setup_configured',
    'tenant',target_tenant::text,correlation,jsonb_build_object(
      'setupId',setup_id,'templateId',requested_template,'defaultLocale',requested_default_locale,
      'enabledLocales',requested_locales,'installationId',selected_installation));
  INSERT INTO control.outbox_events(id,tenant_id,event_type,event_version,payload,correlation_id)
  VALUES(gen_random_uuid(),authority_tenant,'platform.tenant_setup_configured',1,
    jsonb_build_object('auditEventId',audit_id,'targetId',target_tenant),correlation);
  RETURN QUERY SELECT selected_installation,selected_workspace,'awaiting_owner'::text;
END $$;

REVOKE ALL ON FUNCTION control.platform_owner_tenant_setups(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.configure_platform_tenant(uuid,uuid,uuid,uuid,text,text,text[],text,uuid) FROM PUBLIC;

COMMENT ON TABLE control.platform_tenant_setups IS 'Server-defined SaaS package configuration for a pending tenant shell; not domain, owner or provider activation.';
