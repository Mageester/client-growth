-- 0024: additive agency theme preference for client-facing report snapshots.
--
-- This migration is independent from the paused Business-to-site mismatch
-- feature. It must never create or reference external_business_claims.

ALTER TABLE workspace_branding
  ADD COLUMN report_theme TEXT NOT NULL DEFAULT 'studio';
