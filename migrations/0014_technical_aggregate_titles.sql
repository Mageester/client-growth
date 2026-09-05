-- Technical aggregate rows created by 0013 must be identifiable before the
-- next analysis refreshes their detailed, canonical page evidence.
--
-- The runtime assembler is authoritative for fresh evidence. This migration
-- gives already-materialized rows a truthful page/target cardinality rather
-- than leaving a bare, indistinguishable technical title in the feed.

WITH counts AS (
  SELECT
    opportunities.id AS id,
    COUNT(DISTINCT CASE WHEN refs.value LIKE 'page:%' THEN refs.value END) AS page_count,
    COUNT(DISTINCT CASE WHEN refs.value LIKE 'target:%' THEN refs.value END) AS target_count
  FROM opportunities
  LEFT JOIN json_each(opportunities.evidence_refs) AS refs ON TRUE
  WHERE opportunities.dedupe_key LIKE 'technical::%'
    AND opportunities.rule_id IN (
      'missing-title', 'duplicate-title', 'thin-service-page', 'missing-h1',
      'broken-internal-link', 'missing-meta-description', 'missing-structured-data',
      'missing-image-alt'
    )
  GROUP BY opportunities.id
)
UPDATE opportunities
SET title = CASE opportunities.rule_id
  WHEN 'missing-title' THEN 'Missing page title — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  WHEN 'duplicate-title' THEN 'Duplicate page title — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  WHEN 'thin-service-page' THEN 'Thin service page — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  WHEN 'missing-h1' THEN 'Missing H1 heading — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  WHEN 'broken-internal-link' THEN 'Broken internal link — ' || counts.target_count ||
    CASE WHEN counts.target_count = 1 THEN ' target' ELSE ' targets' END
  WHEN 'missing-meta-description' THEN 'Missing meta description — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  WHEN 'missing-structured-data' THEN 'Missing LocalBusiness or Service schema — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  WHEN 'missing-image-alt' THEN 'Missing image alt attribute — ' || counts.page_count ||
    CASE WHEN counts.page_count = 1 THEN ' page' ELSE ' pages' END
  ELSE opportunities.title
END
FROM counts
WHERE opportunities.id = counts.id;
