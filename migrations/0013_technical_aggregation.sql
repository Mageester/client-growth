-- One canonical, site-level opportunity per technical repair type.
--
-- Page-level technical rows predate aggregation. They remain as audit records
-- (including any page-specific proposal draft), but are superseded so an agency
-- never sees a dismissed page return as part of a newly priced aggregate.

ALTER TABLE opportunities ADD COLUMN suppressed_evidence_refs TEXT NOT NULL DEFAULT '[]';

-- Only change an existing service when its technical tag AND its exact old
-- starter range prove it is still one of Orbit's defaults. An agency's custom
-- pricing is never inferred from a tag alone.
UPDATE services
SET price_min = 150, price_max = 300
WHERE price_min = 150 AND price_max = 400
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'missing-title');

UPDATE services
SET price_min = 200, price_max = 400
WHERE price_min = 200 AND price_max = 500
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'duplicate-title');

UPDATE services
SET price_min = 400, price_max = 800
WHERE price_min = 900 AND price_max = 1800
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'thin-service-page');

UPDATE services
SET price_min = 150, price_max = 300
WHERE price_min = 150 AND price_max = 400
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'missing-h1');

UPDATE services
SET price_min = 200, price_max = 500
WHERE price_min = 200 AND price_max = 600
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'broken-internal-link');

UPDATE services
SET price_min = 300, price_max = 700
WHERE price_min = 300 AND price_max = 800
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'missing-structured-data');

UPDATE services
SET price_min = 150, price_max = 400
WHERE price_min = 900 AND price_max = 2200
  AND EXISTS (SELECT 1 FROM json_each(services.tags) WHERE value = 'missing-image-alt');

WITH legacy AS (
  SELECT *
  FROM opportunities
  WHERE rule_id IN (
    'missing-title', 'duplicate-title', 'thin-service-page', 'missing-h1',
    'broken-internal-link', 'missing-meta-description', 'missing-structured-data',
    'missing-image-alt'
  )
    AND dedupe_key NOT LIKE 'technical::%'
), grouped AS (
  SELECT
    workspace_id,
    client_id,
    rule_id,
    MIN(suggested_service_id) AS suggested_service_id,
    MIN(price_min) AS legacy_price_min,
    MIN(price_max) AS legacy_price_max,
    MIN(confidence) AS confidence,
    MAX(updated_at) AS updated_at,
    SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed_count,
    COUNT(*) AS row_count
  FROM legacy
  GROUP BY workspace_id, client_id, rule_id
)
INSERT OR IGNORE INTO opportunities (
  id, workspace_id, dedupe_key, client_id, rule_id, title, detected, evidence_refs,
  suppressed_evidence_refs, rationale, suggested_service_id, suggested_scope, price_min,
  price_max, confidence, billable_status, status, snooze_until, proposal_md,
  verification, conversion_defect, updated_at
)
SELECT
  'technical::' || g.client_id || '::' || g.rule_id,
  g.workspace_id,
  'technical::' || g.client_id || '::' || g.rule_id,
  g.client_id,
  g.rule_id,
  CASE g.rule_id
    WHEN 'missing-title' THEN 'Missing page title'
    WHEN 'duplicate-title' THEN 'Duplicate page title'
    WHEN 'thin-service-page' THEN 'Thin service page'
    WHEN 'missing-h1' THEN 'Missing H1 heading'
    WHEN 'broken-internal-link' THEN 'Broken internal link'
    WHEN 'missing-meta-description' THEN 'Missing meta description'
    WHEN 'missing-structured-data' THEN 'Missing LocalBusiness or Service schema'
    WHEN 'missing-image-alt' THEN 'Missing image alt attribute'
  END,
  'Legacy page-level findings were consolidated into one site-level technical finding. Re-run analysis to refresh its affected-page count.',
  COALESCE((
    SELECT json_group_array(DISTINCT refs.value)
    FROM legacy AS l
    JOIN json_each(l.evidence_refs) AS refs
    WHERE l.workspace_id = g.workspace_id
      AND l.client_id = g.client_id
      AND l.rule_id = g.rule_id
  ), '[]'),
  COALESCE((
    SELECT json_group_array(DISTINCT refs.value)
    FROM legacy AS l
    JOIN json_each(l.evidence_refs) AS refs
    WHERE l.workspace_id = g.workspace_id
      AND l.client_id = g.client_id
      AND l.rule_id = g.rule_id
      AND l.status = 'dismissed'
      AND refs.value LIKE 'page:%'
  ), '[]'),
  'Page-level technical observations were consolidated so the agency can price one repair for this site instead of a separate project per page.',
  g.suggested_service_id,
  '[]',
  COALESCE(s.price_min, g.legacy_price_min),
  COALESCE(s.price_max, g.legacy_price_max),
  g.confidence,
  CASE WHEN EXISTS (
    SELECT 1 FROM client_coverage AS coverage
    WHERE coverage.workspace_id = g.workspace_id
      AND coverage.client_id = g.client_id
      AND coverage.service_id = g.suggested_service_id
  ) THEN 'already_covered' ELSE 'billable' END,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM client_coverage AS coverage
      WHERE coverage.workspace_id = g.workspace_id
        AND coverage.client_id = g.client_id
        AND coverage.service_id = g.suggested_service_id
    ) THEN 'already_covered'
    WHEN g.dismissed_count = g.row_count THEN 'dismissed'
    ELSE 'new'
  END,
  NULL,
  NULL,
  NULL,
  NULL,
  g.updated_at
FROM grouped AS g
LEFT JOIN services AS s
  ON s.workspace_id = g.workspace_id AND s.id = g.suggested_service_id;

-- Retain the evidence and proposal draft on every legacy row for audit, but
-- make the old per-page identity invisible and non-actionable everywhere else.
UPDATE opportunities
SET status = 'superseded'
WHERE rule_id IN (
  'missing-title', 'duplicate-title', 'thin-service-page', 'missing-h1',
  'broken-internal-link', 'missing-meta-description', 'missing-structured-data',
  'missing-image-alt'
)
  AND dedupe_key NOT LIKE 'technical::%';
