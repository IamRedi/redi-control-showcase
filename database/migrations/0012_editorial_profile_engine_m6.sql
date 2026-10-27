ALTER TABLE control.ai_model_routes DROP CONSTRAINT ai_model_routes_operation_check;
ALTER TABLE control.ai_model_routes ADD CONSTRAINT ai_model_routes_operation_check CHECK(operation IN ('claim_extraction','evidence_comparison','factual_synthesis','grounding_validation','editorial_transformation','editorial_grounding_validation'));
ALTER TABLE control.ai_runs DROP CONSTRAINT ai_runs_operation_check;
ALTER TABLE control.ai_runs ADD CONSTRAINT ai_runs_operation_check CHECK(operation IN ('claim_extraction','evidence_comparison','factual_synthesis','grounding_validation','editorial_transformation','editorial_grounding_validation'));

ALTER TABLE control.media_profiles
  ADD COLUMN tagline text NOT NULL DEFAULT '' CHECK(char_length(tagline)<=300),
  ADD COLUMN country text NOT NULL DEFAULT '' CHECK(char_length(country)<=2),
  ADD COLUMN editorial_config jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN configuration_version integer NOT NULL DEFAULT 1 CHECK(configuration_version>0);

UPDATE control.media_profiles SET editorial_config = '{"sections":[{"slug":"general","name":"General","priority":50,"enabled":true,"satire":false}],"topicPriorities":[],"style":{"tone":["clear","accurate"],"readability":"general","headlineMaxCharacters":120,"headlineRules":["Never exceed the evidence"],"articleMinWords":250,"articleMaxWords":1200,"terminologyRules":["Explain specialist terms"]},"verification":{"strict":true,"allowUnverifiedAsConfirmed":false,"requirePrimaryForImportant":true,"independentCrossChecks":1,"checkNamesNumbersDatesLocationsInstitutions":true,"scientific":{"requireOriginalSource":true,"requireInstitution":true,"distinguishPeerReview":true,"requireLimitations":true,"distinguishStudySubject":true}},"sourceRequirements":{"acceptedTiers":["primary","strong_reporting"],"seriousCrossCheckForImportant":true},"freshness":{"freshHours":48,"staleHours":168,"discloseStale":true},"destinations":{"website":true,"facebook":true,"instagram":true},"visual":{"family":"editorial","categoryThemes":{},"cardHeadlineMaxCharacters":80,"supportingFactsMax":3,"requireSourceAttribution":true,"fullCaptionInsideImage":false,"realPeoplePolicy":"licensed_photo_or_thematic_graphic","generatedImageDisclosure":true},"approval":{"humanReviewRequired":true,"publishPermissionRequired":true},"publishing":{"targetsPerDay":0,"windows":[]}}'::jsonb WHERE editorial_config='{}'::jsonb;

CREATE TABLE control.media_profile_revisions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, media_profile_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0), snapshot jsonb NOT NULL, snapshot_hash text NOT NULL CHECK(char_length(snapshot_hash)=64),
  created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,media_profile_id) REFERENCES control.media_profiles(tenant_id,workspace_id,id),
  UNIQUE(tenant_id,media_profile_id,version), UNIQUE(tenant_id,id)
);

CREATE TABLE control.editorial_context_packs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL,
  media_profile_id uuid NOT NULL, profile_revision_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  snapshot jsonb NOT NULL, snapshot_hash text NOT NULL CHECK(char_length(snapshot_hash)=64), created_by uuid NOT NULL REFERENCES control.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id),
  FOREIGN KEY(tenant_id,workspace_id,media_profile_id) REFERENCES control.media_profiles(tenant_id,workspace_id,id),
  FOREIGN KEY(tenant_id,profile_revision_id) REFERENCES control.media_profile_revisions(tenant_id,id),
  UNIQUE(tenant_id,research_case_id,version), UNIQUE(tenant_id,id)
);

CREATE TABLE control.editorial_drafts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL, research_case_id uuid NOT NULL,
  factual_synthesis_id uuid NOT NULL, evidence_pack_id uuid NOT NULL, editorial_context_pack_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  draft jsonb NOT NULL, validation jsonb NOT NULL, verification_state text NOT NULL CHECK(verification_state IN ('verified','developing','partially_verified','unverified','conflicting','stale')),
  freshness_state text NOT NULL CHECK(freshness_state IN ('fresh','aging','stale','unknown')), approval_ready boolean NOT NULL,
  status text NOT NULL CHECK(status IN ('review_required','approved','rejected','blocked','promoted')),
  generation_run_id uuid NOT NULL, validation_run_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES control.users(id),
  approved_by uuid REFERENCES control.users(id), approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,factual_synthesis_id) REFERENCES control.factual_syntheses(tenant_id,id),
  FOREIGN KEY(tenant_id,evidence_pack_id) REFERENCES control.evidence_packs(tenant_id,id),
  FOREIGN KEY(tenant_id,editorial_context_pack_id) REFERENCES control.editorial_context_packs(tenant_id,id),
  FOREIGN KEY(tenant_id,generation_run_id) REFERENCES control.ai_runs(tenant_id,id), FOREIGN KEY(tenant_id,validation_run_id) REFERENCES control.ai_runs(tenant_id,id),
  FOREIGN KEY(tenant_id,workspace_id,research_case_id) REFERENCES control.research_cases(tenant_id,workspace_id,id),
  UNIQUE(tenant_id,research_case_id,version), UNIQUE(tenant_id,id)
);

CREATE TABLE control.editorial_draft_promotions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES control.tenants(id), workspace_id uuid NOT NULL,
  editorial_draft_id uuid NOT NULL, content_item_id uuid NOT NULL, promoted_by uuid NOT NULL REFERENCES control.users(id), promoted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,editorial_draft_id) REFERENCES control.editorial_drafts(tenant_id,id),
  FOREIGN KEY(tenant_id,workspace_id,content_item_id) REFERENCES control.content_items(tenant_id,workspace_id,id),
  UNIQUE(tenant_id,editorial_draft_id), UNIQUE(tenant_id,content_item_id), UNIQUE(tenant_id,id)
);

ALTER TABLE control.editorial_candidates
  ADD COLUMN section text NOT NULL DEFAULT '' CHECK(char_length(section)<=160),
  ADD COLUMN event_date timestamptz,
  ADD COLUMN recommendation_reason text NOT NULL DEFAULT '' CHECK(char_length(recommendation_reason)<=2000),
  ADD COLUMN verification_state text NOT NULL DEFAULT 'unverified' CHECK(verification_state IN ('verified','partially_verified','developing','unverified','conflicting','stale')),
  ADD COLUMN primary_source_id uuid,
  ADD COLUMN cross_check_source_ids uuid[] NOT NULL DEFAULT '{}';

INSERT INTO control.media_profile_revisions(id,tenant_id,workspace_id,media_profile_id,version,snapshot,snapshot_hash,created_by)
SELECT gen_random_uuid(),p.tenant_id,p.workspace_id,p.id,p.configuration_version,to_jsonb(p),md5(to_jsonb(p)::text)||md5(to_jsonb(p)::text||':revision'),p.updated_by
FROM control.media_profiles p
ON CONFLICT(tenant_id,media_profile_id,version) DO NOTHING;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['media_profile_revisions','editorial_context_packs','editorial_drafts','editorial_draft_promotions'] LOOP
  EXECUTE format('ALTER TABLE control.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE control.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I_tenant_isolation ON control.%I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
END LOOP; END $$;

CREATE TRIGGER media_profile_revisions_immutable BEFORE UPDATE OR DELETE ON control.media_profile_revisions FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE TRIGGER editorial_context_packs_immutable BEFORE UPDATE OR DELETE ON control.editorial_context_packs FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();
CREATE FUNCTION control.prevent_editorial_draft_content_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.draft IS DISTINCT FROM OLD.draft OR NEW.validation IS DISTINCT FROM OLD.validation OR NEW.editorial_context_pack_id IS DISTINCT FROM OLD.editorial_context_pack_id OR NEW.evidence_pack_id IS DISTINCT FROM OLD.evidence_pack_id THEN RAISE EXCEPTION 'IMMUTABLE_EDITORIAL_DRAFT_CONTENT'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER editorial_draft_content_immutable BEFORE UPDATE ON control.editorial_drafts FOR EACH ROW EXECUTE FUNCTION control.prevent_editorial_draft_content_change();
CREATE TRIGGER editorial_drafts_no_delete BEFORE DELETE ON control.editorial_drafts FOR EACH ROW EXECUTE FUNCTION control.prevent_immutable_research_artifact_change();

CREATE INDEX editorial_context_case_idx ON control.editorial_context_packs(tenant_id,research_case_id,version DESC);
CREATE INDEX editorial_drafts_case_idx ON control.editorial_drafts(tenant_id,research_case_id,version DESC);
COMMENT ON TABLE control.editorial_context_packs IS 'Immutable communication-policy snapshot; contains no factual evidence.';
COMMENT ON TABLE control.editorial_drafts IS 'Grounded editorial transformation linked to separate factual and editorial context artifacts; content is immutable and promotion requires human approval.';
