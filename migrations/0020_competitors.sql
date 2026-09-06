-- The competitors an agency names for a client.
--
-- The first data in this product about a business the agency does NOT work for,
-- and the reason the competitor-service-gap rule can exist. Deliberately typed
-- in by the agency rather than discovered: who a small business actually
-- competes with is local knowledge, and guessing it from a search result would
-- be exactly the kind of confident invention the engine refuses everywhere else.
--
-- Bounded to three per client in code (src/db/competitors.ts). Each comparison
-- crawls every competitor, so the cap is a cost ceiling as much as a UI choice.
--
-- Composite foreign key, like every other tenant-scoped table: a competitor can
-- only ever reference a client in the same workspace, enforced by the database
-- and not only by the repository.
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
