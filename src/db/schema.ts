/**
 * Canonical **application** schema (tenant + workspace tables). Applied verbatim
 * by the node:sqlite adapter in tests and by the local seed. The migration files
 * (0001..0027) must converge on this exact shape — test/db.schema-parity.test.ts
 * compares table columns AND foreign keys.
 *
 * The Better Auth tables (user / session / account / verification / rateLimit)
 * are NOT here: they are generated from the pinned better-auth version into
 * migrations/0004_better_auth.sql and covered by test/auth.schema.test.ts.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- MONITOR weekly-digest schedule + preferences (0025). Cadence defaults to
  -- 'weekly' but stays inert until the workspace is entitled to MONITOR.
  monitor_digest_cadence TEXT NOT NULL DEFAULT 'weekly',
  monitor_digest_only_on_change INTEGER NOT NULL DEFAULT 1,
  monitor_digest_recipient TEXT,
  monitor_digest_next_due_at TEXT,
  monitor_digest_last_sent_at TEXT,
  monitor_digest_claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspaces_digest_due
  ON workspaces (monitor_digest_cadence, monitor_digest_next_due_at);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

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
-- The signup gate looks an address up before it has a workspace to be scoped by.
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email_all
  ON workspace_invitations (invited_email, expires_at);

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

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_min REAL NOT NULL,
  price_max REAL NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS services_ws_id ON services (workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_services_ws ON services (workspace_id);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  offerings TEXT NOT NULL DEFAULT '[]',
  -- One typical job, in the client's own business. Agency-supplied. See 0019.
  average_job_value REAL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  monitoring_cadence TEXT NOT NULL DEFAULT 'off',
  monitoring_next_due_at TEXT,
  monitoring_last_attempt_at TEXT,
  monitoring_last_success_at TEXT,
  monitoring_last_outcome TEXT,
  monitoring_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  monitoring_claimed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS clients_ws_id ON clients (workspace_id, id);
CREATE INDEX IF NOT EXISTS idx_clients_ws ON clients (workspace_id);
CREATE INDEX IF NOT EXISTS idx_clients_monitoring_due
  ON clients (monitoring_cadence, monitoring_next_due_at);

CREATE TABLE IF NOT EXISTS client_coverage (
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (client_id, service_id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, service_id) REFERENCES services (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_coverage_ws ON client_coverage (workspace_id);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  bundle TEXT NOT NULL,
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_ws ON evidence_bundles (workspace_id, client_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  client_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detected TEXT NOT NULL,
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  suppressed_evidence_refs TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL,
  suggested_service_id TEXT NOT NULL,
  suggested_scope TEXT NOT NULL DEFAULT '[]',
  price_min REAL NOT NULL,
  price_max REAL NOT NULL,
  confidence REAL NOT NULL,
  billable_status TEXT NOT NULL,
  status TEXT NOT NULL,
  snooze_until TEXT,
  proposal_md TEXT,
  -- What the agency charged when they marked this work sold. See 0018.
  sold_amount REAL,
  sold_at TEXT,
  -- Durable sales-funnel milestones: the FIRST time each stage was reached.
  -- Nullable by design; legacy rows have them NULL and nothing may invent a
  -- value from updated_at or status. See 0022 and core/salesFunnel.ts.
  accepted_at TEXT,
  proposal_prepared_at TEXT,
  pitched_at TEXT,
  lost_at TEXT,
  dismissed_at TEXT,
  verification TEXT,
  conversion_defect TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, dedupe_key),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_opp_ws ON opportunities (workspace_id, client_id);
CREATE INDEX IF NOT EXISTS idx_opp_sold ON opportunities (workspace_id, rule_id, status);

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
  trigger TEXT NOT NULL DEFAULT 'manual',
  new_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  evaluator_calls INTEGER NOT NULL DEFAULT 0,
  evaluator_rejections INTEGER NOT NULL DEFAULT 0,
  evaluator_errors INTEGER NOT NULL DEFAULT 0,
  crawl_exhaustive INTEGER NOT NULL DEFAULT 0,
  suggested_offerings TEXT NOT NULL DEFAULT '[]',
  offering_drift TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_ws
  ON analysis_runs (workspace_id, client_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_trigger
  ON analysis_runs (workspace_id, trigger, finished_at DESC);

/** Typed Increment 2 insight persistence written with each completed run. */
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

CREATE INDEX IF NOT EXISTS idx_analysis_insight_accounting_client
  ON analysis_insight_accounting (workspace_id, client_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_analysis_evidence_refs_run
  ON analysis_evidence_refs (workspace_id, client_id, run_id, position);

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

CREATE INDEX IF NOT EXISTS idx_analysis_diagnostics_run
  ON analysis_diagnostics (workspace_id, client_id, run_id, position);

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

CREATE INDEX IF NOT EXISTS idx_analysis_problems_run
  ON analysis_problems (workspace_id, client_id, run_id, position);

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

CREATE INDEX IF NOT EXISTS idx_analysis_category_assessments_run
  ON analysis_category_assessments (workspace_id, client_id, run_id, position);

CREATE TABLE IF NOT EXISTS external_business_claims (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  authorization TEXT NOT NULL,
  raw_service_label TEXT NOT NULL,
  source_field TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_version TEXT,
  normalized_label TEXT NOT NULL,
  semantic_state TEXT NOT NULL,
  semantic_reason TEXT NOT NULL,
  UNIQUE (workspace_id, client_id, provider, source_record_id, source_hash, normalized_label),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_claims_current
  ON external_business_claims (workspace_id, client_id, provider, source_record_id, retrieved_at DESC);

/**
 * Accepted analysis starts. This is deliberately an append-only workspace
 * ledger: the client id is descriptive and is not a foreign key, so deleting
 * and recreating a client cannot reset the workspace's daily cap.
 */
/**
 * Competitors an agency names for a client. See migration 0020 for why this is
 * agency-supplied rather than discovered, and why it is capped at three.
 */
CREATE TABLE IF NOT EXISTS client_competitors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, client_id, domain),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_competitors
  ON client_competitors (workspace_id, client_id, created_at);

CREATE TABLE IF NOT EXISTS analysis_limit_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  finished_at TEXT,
  failed INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'queued',
  stage_updated_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  analysis_run_id INTEGER,
  completion_fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_limits_client
  ON analysis_limit_reservations (workspace_id, client_id, reserved_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_limits_day
  ON analysis_limit_reservations (workspace_id, day_utc);
-- The platform-wide daily ceiling counts across every workspace, so it cannot
-- use an index that leads with workspace_id.
CREATE INDEX IF NOT EXISTS idx_analysis_limits_day_all
  ON analysis_limit_reservations (day_utc);

CREATE INDEX IF NOT EXISTS idx_analysis_limits_stage
  ON analysis_limit_reservations (workspace_id, stage, stage_updated_at DESC);

CREATE TABLE IF NOT EXISTS visual_screenshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  metadata TEXT NOT NULL,
  data_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visual_screenshots_client
  ON visual_screenshots (workspace_id, client_id, captured_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_provider_usage_workspace_started
  ON provider_usage (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_usage_client_started
  ON provider_usage (workspace_id, client_id, started_at DESC);

/**
 * Append-only paid catalog-generation admissions. Unlike services, these rows
 * are accounting records and remain counted when generation later fails.
 */
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

/**
 * Explicitly saved workspace branding used when an owner creates a proposal
 * snapshot. Keeping it separate from the original workspace row makes this
 * additive for the production schema while preserving the existing name field.
 */
CREATE TABLE IF NOT EXISTS workspace_branding (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  logo TEXT,
  report_theme TEXT NOT NULL DEFAULT 'studio',
  updated_at TEXT NOT NULL
);

/**
 * Public proposal links contain their complete snapshot. The token is never
 * persisted; only its SHA-256 digest is. No client/service foreign keys are
 * needed for public reads, but an opportunity deletion revokes its links.
 */
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

/**
 * Client-facing reports persist an immutable public snapshot plus an audit
 * projection that retains source opportunity ids only for integrity checks.
 * Public reads must use the snapshot and never reconstruct from live rows.
 */
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

/**
 * MONITOR digest history and idempotency (0025). One row per (workspace, week)
 * recording what the digest tick did: sent, deliberately skipped, or failed.
 * UNIQUE (workspace_id, period_start) is the idempotency key — a retry or an
 * overlapping tick can never email the same week twice.
 */
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
`;
