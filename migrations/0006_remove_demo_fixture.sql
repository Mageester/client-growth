-- Keep demo data local-only.
-- Migration 0005 historically created ws_demo/user_demo so the local seed could
-- assume its parents. Remove those rows from every migrated database before a
-- Worker can serve it; scripts/seed.sql re-creates them only with --local.

DELETE FROM opportunities WHERE workspace_id = 'ws_demo';
DELETE FROM evidence_bundles WHERE workspace_id = 'ws_demo';
DELETE FROM client_coverage WHERE workspace_id = 'ws_demo';
DELETE FROM clients WHERE workspace_id = 'ws_demo';
DELETE FROM services WHERE workspace_id = 'ws_demo';
DELETE FROM workspace_members WHERE workspace_id = 'ws_demo';
DELETE FROM workspaces WHERE id = 'ws_demo';
DELETE FROM session WHERE userId = 'user_demo';
DELETE FROM account WHERE userId = 'user_demo';
DELETE FROM "user" WHERE id = 'user_demo';
