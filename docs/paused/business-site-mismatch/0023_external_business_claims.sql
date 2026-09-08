-- 0023: owner-authorized external business-profile evidence.
--
-- This is provenance only. It never creates an opportunity by itself. Claims
-- are compared with a readable website by the existing missing-service-page
-- pipeline, and stale/conflicting/ambiguous claims remain ineligible.
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
