-- Preserve the deterministic absence-verification record (URLs inspected,
-- near-matches considered and why) alongside each opportunity.

ALTER TABLE opportunities ADD COLUMN verification TEXT;
