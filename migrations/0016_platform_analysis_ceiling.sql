-- The platform-wide daily analysis ceiling counts reservations across every
-- workspace, so it needs a day-only index. The existing index is
-- (workspace_id, day_utc), whose leading column the unscoped COUNT cannot use.
CREATE INDEX IF NOT EXISTS idx_analysis_limits_day_all
  ON analysis_limit_reservations (day_utc);
