-- Multi-tenant foundation.
--
--  * workspaces + workspace_members (one owner per workspace in V0)
--  * a demo workspace (ws_demo) that pre-existing single-tenant rows fold into
--  * workspace_id on every tenant table, with composite foreign keys so it is
--    impossible at the DB level to store a row that references another
--    workspace's client/service.
--
-- SQLite cannot add a foreign key with ALTER, so the tenant tables are rebuilt.
-- Runs on a populated single-tenant dev DB or a fresh one alike.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

-- Demo workspace. The demo user row lives in the better-auth `user` table
-- (migration 0004). INSERT OR IGNORE so this is safe to re-run.
INSERT OR IGNORE INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES ('user_demo', 'Demo', 'demo@clientgrowth.local', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO workspaces (id, name, owner_user_id, created_at)
  VALUES ('ws_demo', 'Demo Agency', 'user_demo', '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at)
  VALUES ('ws_demo', 'user_demo', 'owner', '2026-01-01T00:00:00.000Z');

-- 1. add workspace_id (temporary default so the ALTER applies to existing rows)
ALTER TABLE services ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
ALTER TABLE client_coverage ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
ALTER TABLE evidence_bundles ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
ALTER TABLE opportunities ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';

-- 2. fold any pre-existing single-tenant rows into the demo workspace
UPDATE services SET workspace_id = 'ws_demo' WHERE workspace_id = '';
UPDATE clients SET workspace_id = 'ws_demo' WHERE workspace_id = '';
UPDATE client_coverage SET workspace_id = 'ws_demo' WHERE workspace_id = '';
UPDATE evidence_bundles SET workspace_id = 'ws_demo' WHERE workspace_id = '';
UPDATE opportunities SET workspace_id = 'ws_demo' WHERE workspace_id = '';

-- 3. rebuild each tenant table with proper foreign keys and no temp default.
--    Order: parents (services, clients) before children.

CREATE TABLE services_new (
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
INSERT INTO services_new (id, workspace_id, name, description, price_min, price_max, tags, active, updated_at)
  SELECT id, workspace_id, name, description, price_min, price_max, tags, active, updated_at FROM services;
DROP TABLE services;
ALTER TABLE services_new RENAME TO services;
CREATE UNIQUE INDEX services_ws_id ON services (workspace_id, id);
CREATE INDEX idx_services_ws ON services (workspace_id);

CREATE TABLE clients_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  offerings TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
INSERT INTO clients_new (id, workspace_id, name, domain, offerings, notes, updated_at)
  SELECT id, workspace_id, name, domain, offerings, notes, updated_at FROM clients;
DROP TABLE clients;
ALTER TABLE clients_new RENAME TO clients;
CREATE UNIQUE INDEX clients_ws_id ON clients (workspace_id, id);
CREATE INDEX idx_clients_ws ON clients (workspace_id);

CREATE TABLE client_coverage_new (
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (client_id, service_id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, service_id) REFERENCES services (workspace_id, id) ON DELETE CASCADE
);
INSERT INTO client_coverage_new (workspace_id, client_id, service_id, note)
  SELECT workspace_id, client_id, service_id, note FROM client_coverage;
DROP TABLE client_coverage;
ALTER TABLE client_coverage_new RENAME TO client_coverage;
CREATE INDEX idx_client_coverage_ws ON client_coverage (workspace_id);

CREATE TABLE evidence_bundles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  bundle TEXT NOT NULL,
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id) ON DELETE CASCADE
);
INSERT INTO evidence_bundles_new (id, workspace_id, client_id, source, captured_at, bundle)
  SELECT id, workspace_id, client_id, source, captured_at, bundle FROM evidence_bundles;
DROP TABLE evidence_bundles;
ALTER TABLE evidence_bundles_new RENAME TO evidence_bundles;
CREATE INDEX idx_evidence_ws ON evidence_bundles (workspace_id, client_id, captured_at DESC);

CREATE TABLE opportunities_new (
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
INSERT INTO opportunities_new (
  id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, rationale,
  suggested_service_id, suggested_scope, price_min, price_max, confidence, billable_status,
  status, snooze_until, proposal_md, verification, conversion_defect, updated_at
)
  SELECT
    id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs, rationale,
    suggested_service_id, suggested_scope, price_min, price_max, confidence, billable_status,
    status, snooze_until, proposal_md, verification, conversion_defect, updated_at
  FROM opportunities;
DROP TABLE opportunities;
ALTER TABLE opportunities_new RENAME TO opportunities;
CREATE INDEX idx_opp_ws ON opportunities (workspace_id, client_id);
