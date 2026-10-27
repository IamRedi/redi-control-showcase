CREATE TABLE control.editorial_story_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES control.tenants(id),
  workspace_id uuid NOT NULL,
  research_case_id uuid,
  content_item_id uuid,
  assignee_user_id uuid NOT NULL REFERENCES control.users(id),
  assigned_by_user_id uuid NOT NULL REFERENCES control.users(id),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'high', 'urgent')),
  due_at timestamptz,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES control.business_workspaces(tenant_id, id),
  FOREIGN KEY (tenant_id, workspace_id, research_case_id)
    REFERENCES control.research_cases(tenant_id, workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, content_item_id)
    REFERENCES control.content_items(tenant_id, workspace_id, id) ON DELETE CASCADE,
  CHECK ((research_case_id IS NULL) <> (content_item_id IS NULL)),
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX editorial_story_assignment_research_idx
  ON control.editorial_story_assignments (tenant_id, research_case_id)
  WHERE research_case_id IS NOT NULL;
CREATE UNIQUE INDEX editorial_story_assignment_content_idx
  ON control.editorial_story_assignments (tenant_id, content_item_id)
  WHERE content_item_id IS NOT NULL;
CREATE INDEX editorial_story_assignment_due_idx
  ON control.editorial_story_assignments
  (tenant_id, workspace_id, due_at, updated_at DESC);
CREATE INDEX editorial_story_assignment_assignee_idx
  ON control.editorial_story_assignments
  (tenant_id, assignee_user_id, updated_at DESC);

ALTER TABLE control.editorial_story_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.editorial_story_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY editorial_story_assignments_tenant_isolation
  ON control.editorial_story_assignments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

COMMENT ON TABLE control.editorial_story_assignments IS
  'One accountable owner and optional deadline for a canonical editorial story; workflow state remains in Research, Content and destination records.';
