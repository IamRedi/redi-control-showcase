ALTER TABLE control.video_render_jobs
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN locked_by text CHECK (
    locked_by IS NULL OR char_length(btrim(locked_by)) BETWEEN 3 AND 120
  ),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count smallint NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 20
  ),
  ADD COLUMN max_attempts smallint NOT NULL DEFAULT 5 CHECK (
    max_attempts BETWEEN 1 AND 20
  ),
  ADD CONSTRAINT video_render_jobs_lease_state_check CHECK (
    (
      status='submitting'
      AND locked_at IS NOT NULL
      AND locked_by IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND attempt_count>0
    )
    OR (
      status<>'submitting'
      AND locked_at IS NULL
      AND locked_by IS NULL
      AND lease_expires_at IS NULL
    )
  );

DROP INDEX control.video_render_jobs_claim_idx;
CREATE INDEX video_render_jobs_claim_idx ON control.video_render_jobs
  (tenant_id,provider_id,available_at,reserved_at,id)
  WHERE status='reserved';
CREATE INDEX video_render_jobs_lease_recovery_idx ON control.video_render_jobs
  (tenant_id,provider_id,lease_expires_at,id)
  WHERE status='submitting';

COMMENT ON COLUMN control.video_render_jobs.lease_expires_at IS
  'Bounded internal claim lease. It grants no provider execution authority.';
COMMENT ON COLUMN control.video_render_jobs.attempt_count IS
  'Internal submission attempts; a lease expiry is recovered before another claim.';
