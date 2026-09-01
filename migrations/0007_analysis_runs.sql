-- Persist the truthful outcome of every analysis run.
--
-- Before this table the UI could only ask "is there a stored evidence bundle?",
-- which rendered a domain that never resolved identically to a site that was
-- read successfully and found clean. The crawler deliberately fails closed; the
-- product must preserve that distinction after the request ends.

CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  source TEXT NOT NULL,
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL,
  limitation TEXT,
  pages_read INTEGER NOT NULL DEFAULT 0,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  blocked_events INTEGER NOT NULL DEFAULT 0,
  inconclusive_events INTEGER NOT NULL DEFAULT 0,
  surfaced INTEGER NOT NULL DEFAULT 0,
  stats TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_ws
  ON analysis_runs (workspace_id, client_id, finished_at DESC);
