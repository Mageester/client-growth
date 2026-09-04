-- Owner-managed team invitations.
--
-- Tokens are stored only as SHA-256 digests. An invitation can be accepted at
-- most once, expires automatically, and is bound to the verified recipient
-- email by the accepting route.

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_user_id TEXT,
  revoked_at TEXT,
  invited_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace
  ON workspace_invitations (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email
  ON workspace_invitations (workspace_id, invited_email, expires_at);

CREATE TRIGGER IF NOT EXISTS workspace_invitation_accept_member
AFTER UPDATE OF accepted_at ON workspace_invitations
WHEN NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'workspace member already exists')
    WHERE EXISTS (
      SELECT 1 FROM workspace_members WHERE user_id = NEW.accepted_by_user_id
    );
  INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
    VALUES (NEW.workspace_id, NEW.accepted_by_user_id, NEW.role, NEW.accepted_at);
END;
