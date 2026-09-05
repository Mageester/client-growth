# P0 crawl and technical-finding addendum

**Date:** 2026-09-04

This addendum folds the defects found by using the deployed app against
cambridgeheating.ca into the active technical-finding P0 slice.

## Requirements

1. Treat `/`, `/index.html`, `/index.htm`, `/index.php`, and trailing-slash
   variants of the same path as one crawl page before allocating page budget and
   before technical rules count affected pages. Content-hash deduplication is
   optional; the URL-shape rule is required.
2. Technical aggregate rows must identify their subject. A row such as
   `Missing meta description — 7 pages` is acceptable; a count-only row named
   `Missing meta description` is not. Detail evidence must retain the affected
   page URLs and the readable case must not collapse to a bare count.
3. A same-site link discovered in readable HTML must be eligible for a direct
   404/410 probe even when its target was not selected for the bounded page
   crawl. Probe scheduling must not let unrelated conversion CTA probes starve
   the discovered-internal-link check.
4. `/clients`, `/services`, and `/changes` must align their page heading with
   their constrained content column. The full-width Opportunities desk and
   correctly centred detail pages must remain unchanged.
5. P1 crawl-discovery work is gated on production reach evidence. Measure the
   corpus through the deployed Worker (or an equivalent Worker-side check) and
   report production reach separately from the residential/cache benchmark;
   do not tune discovery against the cache-only number.
6. Long mapped-service values in the opportunity inspector must wrap or stack
   without left-side clipping.

## Acceptance target

After deployment, re-analyse cambridgeheating.ca in the production app and
record the finding count, exact titles, and potential-value range. The reference
result to beat is 15 findings and `$3.5k-$8.2k`, with exactly one finding
confirmed real by the agency.

## Non-goals

- Do not add content-hash fetching, headless rendering, or a new crawler budget.
- Do not change evaluator, pricing, tenant, auth, migration, or proposal
  semantics outside the technical aggregate compatibility already in P0.
- Do not claim the residential analyzability benchmark represents production
  Cloudflare reach.
