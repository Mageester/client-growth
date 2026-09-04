-- Count every accepted analysis start, including starts whose crawl, evaluator
-- or persistence later fails. The client id is intentionally not a foreign key:
-- deleting and recreating a client must not reset the workspace daily cap.
CREATE TABLE IF NOT EXISTS analysis_limit_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  day_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_limits_client
  ON analysis_limit_reservations (workspace_id, client_id, reserved_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_limits_day
  ON analysis_limit_reservations (workspace_id, day_utc);
