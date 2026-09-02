-- Recurring client monitoring.
--
-- Two additive, forward-only changes. No table is rebuilt, so production data is
-- preserved verbatim and every existing row keeps its meaning.
--
--   1. clients gains its monitoring state. The DEFAULT is 'off' and there is no
--      UPDATE in this migration, so every client that exists in production when
--      this runs stays unmonitored until a person turns it on. That is the whole
--      point: deploying the scheduler must not start paying for anything.
--
--   2. analysis_runs gains the facts a recurring run has to preserve that a
--      manual one never needed — what triggered it, what actually changed, and
--      how the evaluator behaved. These were previously only inside the `stats`
--      JSON blob, which cannot be aggregated in SQL for a health view.
--
-- Defaults on every added column so the ALTERs apply to existing rows.

ALTER TABLE clients ADD COLUMN monitoring_cadence TEXT NOT NULL DEFAULT 'off';
ALTER TABLE clients ADD COLUMN monitoring_next_due_at TEXT;
ALTER TABLE clients ADD COLUMN monitoring_last_attempt_at TEXT;
ALTER TABLE clients ADD COLUMN monitoring_last_success_at TEXT;
ALTER TABLE clients ADD COLUMN monitoring_last_outcome TEXT;
ALTER TABLE clients ADD COLUMN monitoring_consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN monitoring_claimed_at TEXT;

-- The scheduler's only selection query is "which monitored clients are due",
-- across every workspace. Without this it is a full scan of the clients table on
-- every tick; with it, a tick on an all-off portfolio touches almost nothing.
CREATE INDEX IF NOT EXISTS idx_clients_monitoring_due
  ON clients (monitoring_cadence, monitoring_next_due_at);

ALTER TABLE analysis_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE analysis_runs ADD COLUMN new_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN resolved_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN evaluator_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN evaluator_rejections INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN evaluator_errors INTEGER NOT NULL DEFAULT 0;

-- Health questions are always "scheduled runs, recently, for this workspace".
CREATE INDEX IF NOT EXISTS idx_analysis_runs_trigger
  ON analysis_runs (workspace_id, trigger, finished_at DESC);
