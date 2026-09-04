-- Idempotent and reversible: preserve every fixture record and account.
-- Exact IDs and original names were read from production on 2026-09-04.
-- [TEST] is a reserved namespace excluded by the monitoring scheduler.
UPDATE workspaces
SET name = '[TEST] CG Production Smoke A mtiudgwgfhfexl'
WHERE id = 'ws_4420e72588c44c6bb934'
  AND name = 'CG Production Smoke A mtiudgwgfhfexl';
UPDATE workspaces
SET name = '[TEST] CG Production Smoke B mtiudgwgfhfexl'
WHERE id = 'ws_8acaa4f317aa4b1f99bc'
  AND name = 'CG Production Smoke B mtiudgwgfhfexl';
