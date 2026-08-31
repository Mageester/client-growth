/**
 * Canonical schema string. Applied verbatim by the node:sqlite adapter (tests,
 * local seed) and mirrored by migrations/0001_init.sql for `wrangler d1
 * migrations apply`. test/db.schema-parity.test.ts keeps the two in lockstep.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_min REAL NOT NULL,
  price_max REAL NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  offerings TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_coverage (
  client_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (client_id, service_id)
);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  bundle TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_client ON evidence_bundles (client_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
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
  UNIQUE (client_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_opp_client ON opportunities (client_id);
`;
