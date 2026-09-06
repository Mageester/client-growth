-- The signup gate asks whether ANY workspace has a live invitation out to an
-- address, before the person has an account or a tenant to be scoped by. The
-- existing index leads with workspace_id, which that lookup does not have.
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email_all
  ON workspace_invitations (invited_email, expires_at);
