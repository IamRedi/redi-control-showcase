ALTER TABLE control.ai_usage_events
  ADD COLUMN accounting_status text NOT NULL DEFAULT 'reconciled'
    CHECK(accounting_status IN ('reserved','reconciled','failed')),
  ADD COLUMN provider_request_id text,
  ADD COLUMN failure_code text;

ALTER TABLE control.ai_usage_events
  ADD CONSTRAINT ai_usage_events_run_unique UNIQUE(tenant_id,ai_run_id);

ALTER TABLE control.editorial_drafts
  DROP CONSTRAINT editorial_drafts_status_check;

ALTER TABLE control.editorial_drafts
  ADD CONSTRAINT editorial_drafts_status_check
    CHECK(status IN ('review_required','approved','rejected','blocked','superseded','promoted')),
  ADD COLUMN source_draft_id uuid,
  ADD COLUMN revision_kind text NOT NULL DEFAULT 'generated'
    CHECK(revision_kind IN ('generated','human_edit')),
  ADD COLUMN revision_reason text NOT NULL DEFAULT ''
    CHECK(char_length(revision_reason)<=2000),
  ADD CONSTRAINT editorial_drafts_revision_lineage_check
    CHECK(
      (revision_kind='generated' AND source_draft_id IS NULL) OR
      (revision_kind='human_edit' AND source_draft_id IS NOT NULL AND char_length(btrim(revision_reason))>0)
    ),
  ADD CONSTRAINT editorial_drafts_source_fk
    FOREIGN KEY(tenant_id,source_draft_id)
    REFERENCES control.editorial_drafts(tenant_id,id);

CREATE INDEX editorial_drafts_source_idx
  ON control.editorial_drafts(tenant_id,source_draft_id);

COMMENT ON COLUMN control.ai_usage_events.accounting_status IS
  'Reservation/reconciliation state. Failed calls retain measured usage or their pre-call worst-case reservation.';
COMMENT ON COLUMN control.editorial_drafts.source_draft_id IS
  'Immutable predecessor for an audited human edit followed by fresh grounding validation.';
