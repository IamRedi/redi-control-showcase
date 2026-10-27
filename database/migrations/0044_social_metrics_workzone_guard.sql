-- 0043 is already deployed; preserve its checksum and repair additively.
-- Existing observations remain intact. Archived workzones reject new writes.
CREATE TRIGGER guard_active_workzone_social_metric_observations
  BEFORE INSERT OR UPDATE OR DELETE ON control.social_metric_observations
  FOR EACH ROW EXECUTE FUNCTION control.guard_active_workzone_row();
