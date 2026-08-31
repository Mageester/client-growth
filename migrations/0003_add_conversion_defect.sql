-- Preserve the deterministic broken-conversion-path record (exact element, URL,
-- target and observed HTTP status) alongside each opportunity.

ALTER TABLE opportunities ADD COLUMN conversion_defect TEXT;
