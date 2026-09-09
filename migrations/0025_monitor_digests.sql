-- 0025: MONITOR weekly digest.
--
-- MONITOR turns the recurring scanner into something an agency pays for: it
-- watches a portfolio and emails one weekly digest of what changed in terms of
-- billable work, so the agency does not have to log in to find out. This adds
-- the two things a per-workspace, once-a-week email needs that nothing else
-- already stores — the schedule and preferences, and a durable record of what
-- was actually sent.
--
-- Additive only. Every added column has a default, so the ALTERs apply to
-- existing workspace rows without a rebuild. The digest is inert for a workspace
-- whose owner is not entitled to MONITOR (entitlement is env policy — see
-- src/core/entitlements.ts), and it can never send the same week twice
-- (UNIQUE (workspace_id, period_start) on the log below).

-- Per-workspace digest schedule + preferences, mirroring how a client carries
-- its own monitoring state (0008). Cadence defaults to 'weekly' because that is
-- the product's only on-setting; it stays inert until the owning workspace is
-- entitled and has at least one monitored client with something to report.
ALTER TABLE workspaces ADD COLUMN monitor_digest_cadence TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE workspaces ADD COLUMN monitor_digest_only_on_change INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspaces ADD COLUMN monitor_digest_recipient TEXT;
ALTER TABLE workspaces ADD COLUMN monitor_digest_next_due_at TEXT;
ALTER TABLE workspaces ADD COLUMN monitor_digest_last_sent_at TEXT;
ALTER TABLE workspaces ADD COLUMN monitor_digest_claimed_at TEXT;

-- The digest tick's only selection query is "which workspaces have a digest due
-- now", across every workspace — the same shape as the monitoring due index.
CREATE INDEX IF NOT EXISTS idx_workspaces_digest_due
  ON workspaces (monitor_digest_cadence, monitor_digest_next_due_at);

-- What each digest tick actually did per workspace — sent, deliberately skipped,
-- or failed. This is the digest's history for the console AND its idempotency:
-- UNIQUE (workspace_id, period_start) means a retry or an overlapping tick can
-- never email the same week twice.
CREATE TABLE IF NOT EXISTS monitor_digest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  recipient TEXT,
  outcome TEXT NOT NULL,
  new_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  client_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  UNIQUE (workspace_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_monitor_digest_runs_ws
  ON monitor_digest_runs (workspace_id, sent_at DESC);
