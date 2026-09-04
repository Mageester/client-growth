-- Explicit workspace branding and immutable, expiring proposal snapshots.
--
-- Share URLs carry a 256-bit opaque token. Only its SHA-256 digest is stored;
-- the public route can therefore read one snapshot without resolving a tenant,
-- client, service or current opportunity row.

CREATE TABLE IF NOT EXISTS workspace_branding (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  logo TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposal_shares (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  snapshot TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposal_shares_opportunity
  ON proposal_shares (workspace_id, opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposal_shares_token_status
  ON proposal_shares (token_hash, revoked_at, expires_at);
