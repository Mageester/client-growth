-- Preserve what the site advertised on each analysis run so scheduled checks
-- can announce only new, evidence-backed offering suggestions.
--
-- The first exhaustive snapshot is a silent baseline. Incomplete crawls are
-- retained for history but never become a baseline or emit drift.
ALTER TABLE analysis_runs ADD COLUMN crawl_exhaustive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN suggested_offerings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE analysis_runs ADD COLUMN offering_drift TEXT NOT NULL DEFAULT '[]';
