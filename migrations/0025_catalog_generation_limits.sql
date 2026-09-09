-- Count every accepted paid catalog-generation request, including requests
-- whose provider call later fails. This append-only ledger is the concurrency
-- boundary for both tenant fairness and the operator's total daily spend.
CREATE TABLE IF NOT EXISTS catalog_generation_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  reserved_at TEXT NOT NULL,
  day_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_generation_limits_workspace_day
  ON catalog_generation_reservations (workspace_id, day_utc);
CREATE INDEX IF NOT EXISTS idx_catalog_generation_limits_day_all
  ON catalog_generation_reservations (day_utc);
