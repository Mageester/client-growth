-- Additive client-facing report snapshots and expiring share links.
--
-- This migration is intentionally numbered after 0023. It must not be
-- deployed or applied while the intentionally pending 0023 mismatch
-- migration remains unapplied in production.

CREATE TABLE IF NOT EXISTS client_report_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  evidence_reviewed_at TEXT,
  snapshot TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_report_snapshots_client
  ON client_report_snapshots (workspace_id, client_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS client_report_shares (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  report_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (workspace_id, report_id) REFERENCES client_report_snapshots (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_report_shares_report
  ON client_report_shares (workspace_id, report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_report_shares_token_status
  ON client_report_shares (token_hash, revoked_at, expires_at);
