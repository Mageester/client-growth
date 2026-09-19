-- Sep 18 production recovery: lifecycle-aware analysis completion,
-- typed insight persistence, visual captures, and provider metering.
ALTER TABLE analysis_limit_reservations ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE analysis_limit_reservations ADD COLUMN stage_updated_at TEXT;
ALTER TABLE analysis_limit_reservations ADD COLUMN failure_code TEXT;
ALTER TABLE analysis_limit_reservations ADD COLUMN failure_message TEXT;
ALTER TABLE analysis_limit_reservations ADD COLUMN analysis_run_id INTEGER;
ALTER TABLE analysis_limit_reservations ADD COLUMN completion_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_analysis_limits_stage
  ON analysis_limit_reservations (workspace_id, stage, stage_updated_at DESC);

CREATE TABLE IF NOT EXISTS analysis_insight_accounting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  accounting TEXT NOT NULL,
  shadow_drafts TEXT NOT NULL DEFAULT '[]',
  critic_decisions TEXT NOT NULL DEFAULT '[]',
  stage_durations TEXT NOT NULL DEFAULT '{}',
  detector_manifest TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, run_id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_evidence_refs (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  locator TEXT NOT NULL,
  page_url TEXT,
  screenshot_id TEXT,
  viewport TEXT,
  position INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id, id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_diagnostics (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  detector_id TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  category TEXT NOT NULL,
  problem_type TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  state TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id, id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_problems (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  category TEXT NOT NULL,
  problem_type TEXT NOT NULL,
  surface_key TEXT NOT NULL,
  quality_gate TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id, id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_category_assessments (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  category TEXT NOT NULL,
  state TEXT NOT NULL,
  diagnostic_count INTEGER NOT NULL,
  problem_count INTEGER NOT NULL,
  reason TEXT,
  limitations TEXT NOT NULL DEFAULT '[]',
  snapshot_limitations TEXT,
  position INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, run_id, id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_screenshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  metadata TEXT NOT NULL,
  data_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id TEXT,
  user_id TEXT,
  job_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  request_status TEXT NOT NULL DEFAULT 'unknown',
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  cache_miss_input_tokens INTEGER,
  cost_basis TEXT NOT NULL DEFAULT 'unavailable',
  cost_micros INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  pricing_version TEXT,
  limitation TEXT
);
