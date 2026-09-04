/**
 * Canonical **application** schema (tenant + workspace tables). Applied verbatim
 * by the node:sqlite adapter in tests and by the local seed. The migration files
 * (0001..0007) must converge on this exact shape — test/db.schema-parity.test.ts
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

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
  verification TEXT,
  conversion_defect TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, dedupe_key),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_opp_ws ON opportunities (workspace_id, client_id);

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
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_ws
  ON analysis_runs (workspace_id, client_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_trigger
  ON analysis_runs (workspace_id, trigger, finished_at DESC);

/**
 * Accepted analysis starts. This is deliberately an append-only workspace
 * ledger: the client id is descriptive and is not a foreign key, so deleting
 * and recreating a client cannot reset the workspace's daily cap.
 */
CREATE TABLE IF NOT EXISTS analysis_limit_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  day_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_limits_client
  ON analysis_limit_reservations (workspace_id, client_id, reserved_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_limits_day
  ON analysis_limit_reservations (workspace_id, day_utc);
`;
