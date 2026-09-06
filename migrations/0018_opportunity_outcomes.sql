-- What actually sold.
--
-- Every other status records a judgement about a finding; this records the
-- outcome. It is the only column in the schema that can answer "which of these
-- findings are worth an agency's attention" with evidence instead of opinion,
-- and it is what lets the product rank by what this agency converts rather than
-- by what a rule happens to price highly.
--
-- Additive and nullable: every existing row keeps its meaning, and a finding
-- that sold before this column existed is simply unrecorded rather than
-- retroactively assumed either way.
ALTER TABLE opportunities ADD COLUMN sold_amount REAL;
ALTER TABLE opportunities ADD COLUMN sold_at TEXT;

CREATE INDEX IF NOT EXISTS idx_opp_sold
  ON opportunities (workspace_id, rule_id, status);
