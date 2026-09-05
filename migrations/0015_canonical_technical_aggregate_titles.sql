-- Correct aggregate titles materialized by 0014 when legacy evidence contains
-- more than one URL spelling for the same crawl page or link target.
--
-- This is intentionally additive: 0014 is already part of migration history,
-- so canonical counting belongs in a follow-on migration rather than a rewrite
-- of an applied file.

WITH raw_refs AS (
  SELECT
    opportunities.id AS id,
    CASE WHEN refs.value LIKE 'page:%' THEN 'page:' ELSE 'target:' END AS prefix,
    CASE WHEN refs.value LIKE 'page:%'
      THEN substr(refs.value, 6)
      ELSE substr(refs.value, 8)
    END AS url
  FROM opportunities
  LEFT JOIN json_each(opportunities.evidence_refs) AS refs ON TRUE
  WHERE opportunities.dedupe_key LIKE 'technical::%'
    AND opportunities.rule_id IN (
      'missing-title', 'duplicate-title', 'thin-service-page', 'missing-h1',
      'broken-internal-link', 'missing-meta-description', 'missing-structured-data',
      'missing-image-alt'
    )
    AND (refs.value LIKE 'page:%' OR refs.value LIKE 'target:%')
), canonical_refs AS (
  SELECT
    id,
    prefix || CASE
      -- Three slashes means the root path (`https://host/` or `http://host/`);
      -- preserve that slash when collapsing a root index file. Nested index
      -- files collapse to the parent path, matching the runtime crawl key.
      WHEN url LIKE '%/index.html' THEN
        CASE WHEN length(url) - length(replace(url, '/', '')) = 3
          THEN substr(url, 1, length(url) - length('/index.html')) || '/'
          ELSE substr(url, 1, length(url) - length('/index.html'))
        END
      WHEN url LIKE '%/index.htm' THEN
        CASE WHEN length(url) - length(replace(url, '/', '')) = 3
          THEN substr(url, 1, length(url) - length('/index.htm')) || '/'
          ELSE substr(url, 1, length(url) - length('/index.htm'))
        END
      WHEN url LIKE '%/index.php' THEN
        CASE WHEN length(url) - length(replace(url, '/', '')) = 3
          THEN substr(url, 1, length(url) - length('/index.php')) || '/'
          ELSE substr(url, 1, length(url) - length('/index.php'))
        END
      WHEN url LIKE '%/' AND length(url) - length(replace(url, '/', '')) > 3
        THEN rtrim(url, '/')
      ELSE url
    END AS canonical_ref
  FROM raw_refs
), counts AS (
  SELECT
    opportunities.id AS id,
    COUNT(DISTINCT CASE WHEN canonical_refs.canonical_ref LIKE 'page:%' THEN canonical_refs.canonical_ref END) AS page_count,
    COUNT(DISTINCT CASE WHEN canonical_refs.canonical_ref LIKE 'target:%' THEN canonical_refs.canonical_ref END) AS target_count
  FROM opportunities
  LEFT JOIN canonical_refs ON canonical_refs.id = opportunities.id
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
