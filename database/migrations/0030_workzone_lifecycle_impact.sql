CREATE FUNCTION control.workzone_lifecycle_impact(
  actor_user_id uuid,
  target_tenant uuid,
  target_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,control AS $$
DECLARE
  publishing_delivery bigint;
  editorial_content bigint;
  research_evidence bigint;
  ai_governance bigint;
  tenant_setup bigint;
  team_assignments bigint;
  personal_saved_views bigint;
  blocking_total bigint;
  informational_total bigint;
BEGIN
  PERFORM control.assert_workzone_provisioning_admin(actor_user_id,target_tenant);

  IF NOT EXISTS(
    SELECT 1
    FROM control.business_workspaces workspace
    JOIN control.white_label_installations installation
      ON installation.id=workspace.installation_id
     AND installation.tenant_id=workspace.tenant_id
    JOIN control.tenants tenant ON tenant.id=workspace.tenant_id
    WHERE workspace.id=target_workspace
      AND workspace.tenant_id=target_tenant
      AND installation.status='active'
      AND tenant.status='active'
  ) THEN
    RAISE EXCEPTION 'WORKZONE_NOT_FOUND' USING ERRCODE='22023';
  END IF;

  SELECT
    (SELECT count(*) FROM control.platform_connections item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.media_assets item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.media_upload_sessions item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.oauth_transactions item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.social_accounts item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.social_drafts item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO publishing_delivery;

  SELECT
    (SELECT count(*) FROM control.content_items item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.content_item_media item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.content_item_variants item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.editorial_story_assignments item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.editorial_context_packs item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.editorial_drafts item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.editorial_draft_promotions item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO editorial_content;

  SELECT
    (SELECT count(*) FROM control.media_profiles item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.media_profile_revisions item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.source_registry item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.source_performance_observations item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.research_cases item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.research_case_sources item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.research_claims item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.research_evidence item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.editorial_candidates item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.source_provider_configurations item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.source_feeds item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.discovery_runs item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.discovery_results item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.provider_usage_events item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO research_evidence;

  SELECT
    (SELECT count(*) FROM control.ai_model_routes item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.ai_budget_policies item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.ai_runs item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.ai_usage_events item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.research_claim_proposals item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.research_evidence_proposals item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.evidence_packs item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.factual_syntheses item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.synthesis_promotions item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.ai_route_proposals item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
    +(SELECT count(*) FROM control.ai_route_evaluations item WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace)
  INTO ai_governance;

  SELECT count(*) INTO tenant_setup FROM control.platform_tenant_setups item
    WHERE item.target_tenant_id=target_tenant AND item.workspace_id=target_workspace;
  SELECT count(*) INTO team_assignments FROM control.workzone_team_assignments item
    WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace;
  SELECT count(*) INTO personal_saved_views FROM control.workboard_saved_views item
    WHERE item.tenant_id=target_tenant AND item.workspace_id=target_workspace;

  blocking_total:=publishing_delivery+editorial_content+research_evidence+ai_governance+tenant_setup;
  informational_total:=team_assignments+personal_saved_views;

  RETURN jsonb_build_object(
    'schemaVersion',1,
    'workspaceId',target_workspace,
    'evaluatedAt',now(),
    'mode','preview_only',
    'operations',jsonb_build_object(
      'archiveAvailable',false,
      'deleteAvailable',false,
      'reason','policy_not_implemented'
    ),
    'blockingReferenceRows',blocking_total,
    'informationalReferenceRows',informational_total,
    'hasBlockingReferences',blocking_total>0,
    'dependencies',jsonb_build_array(
      jsonb_build_object('key','publishing_delivery','kind','blocking','referenceRows',publishing_delivery),
      jsonb_build_object('key','editorial_content','kind','blocking','referenceRows',editorial_content),
      jsonb_build_object('key','research_evidence','kind','blocking','referenceRows',research_evidence),
      jsonb_build_object('key','ai_governance','kind','blocking','referenceRows',ai_governance),
      jsonb_build_object('key','tenant_setup','kind','blocking','referenceRows',tenant_setup),
      jsonb_build_object('key','team_assignments','kind','informational','referenceRows',team_assignments),
      jsonb_build_object('key','personal_saved_views','kind','informational','referenceRows',personal_saved_views)
    )
  );
END $$;

REVOKE ALL ON FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid) FROM PUBLIC;

COMMENT ON FUNCTION control.workzone_lifecycle_impact(uuid,uuid,uuid) IS
  'Read-only, same-tenant reference-row preview. It does not authorize or perform archive or delete.';
