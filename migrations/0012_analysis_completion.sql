ALTER TABLE analysis_limit_reservations ADD COLUMN finished_at TEXT;
ALTER TABLE analysis_limit_reservations ADD COLUMN failed INTEGER NOT NULL DEFAULT 0;

-- Preserve the completion evidence for starts recorded before this migration.
UPDATE analysis_limit_reservations SET finished_at = (
  SELECT MAX(r.finished_at) FROM analysis_runs r
  WHERE r.workspace_id = analysis_limit_reservations.workspace_id
    AND r.client_id = analysis_limit_reservations.client_id
    AND r.started_at = analysis_limit_reservations.reserved_at
);
