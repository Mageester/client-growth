# Axiom Orbit evidence-first simplification v1

## Goal

Make the first client workflow feel like `name + website -> read -> confirm only uncertain service labels -> analyze`, while preserving the refusal to guess, tenant boundaries, deterministic checks, pricing, and funnel records.

## Incident boundary: Artfully You

The production-equivalent `HttpEvidenceProvider({ maxPages: 10 })` was run inside a temporary remote Cloudflare Worker. `artfullyyou.ca` returned no HTTP response within Orbit's 8-second request timeout for `robots.txt`, `sitemap.xml`, or `/`; a single homepage fetch also remained pending through a 30-second diagnostic ceiling. Local Node fetch reached the same site and the provider read ten pages. The established failure is a Cloudflare Worker-to-origin transport timeout, not robots, redirect, content type, response size, or JavaScript-shell behavior.

Orbit must persist structured failure telemetry (`code`, `stage`, optional status/redirect count) and render a useful client-facing explanation. A zero-readable crawl may try the allowed apex/`www.` sibling through the existing URL policy with a bounded normal-HTTP attempt. It may use only responses actually fetched. If no readable evidence is established, the result remains inconclusive. Browser rendering is not added: this incident occurs before HTML is received, and no supported browser runtime is part of the Worker path.

## Workflow changes

### Client entry

The primary client form asks for client name, website, and optional notes. Existing optional offerings remain accepted server-side for imports/backward compatibility but are removed from the primary add surface. A successful add saves an empty offering list, runs the existing evidence-only crawl, and redirects to the existing evidence-confirmation stage. No evaluator call or analysis run occurs before human confirmation.

### Agency services

The service form continues to require an agency-authored price range because Orbit must never invent commercial pricing. Service name and description are ordinary agency language. Conservative deterministic `suggestServiceTags` mappings are applied automatically on new services; an advanced override remains available for ambiguous or legacy mappings. Unmapped services remain valid catalog data but cannot price findings. DeepSeek is not used for factual checks or routine mapping.

### Semantic AI boundary

DeepSeek remains limited to semantic interpretation of already evidenced candidates: whether a service-shaped subject is a distinct service and whether a confirmed conversion defect is commercially actionable. Technical facts, crawl reach, offering extraction, grouping, pricing, and evidence thresholds remain deterministic. Model failure continues to fail closed.

### Commercial grouping

The UI groups related opportunity rows into project families (`service visibility`, `conversion`, and `site health`) by client. Grouping is a derived view only: no group row is persisted, no child opportunity ID changes, no prices are summed into a new package price, and statuses, dedupe keys, proposal records, and funnel metrics remain attached to the existing rows.

## Invariants

- A failed or partial crawl cannot become clean or produce an absence finding.
- A fallback cannot create evidence without a successful HTTP response and readable parsed content.
- All reads and writes remain tenant-scoped.
- Existing analysis admission, pricing, opportunity, proposal, and sales-funnel semantics are unchanged.
- The raw count of surfaced findings is not an optimization target.
- Existing imports and direct route posts remain compatible where they already accepted offerings.

## Verification

Regression coverage must prove the Artfully timeout classification and telemetry, same-site fallback success/failure, useful zero-page UI messaging, client-add crawl/redirect behavior, automatic conservative service mapping, DeepSeek call boundaries, and grouping preservation. Run focused RED/GREEN tests for each slice, then `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`, and the repository's local verification gate when the full suite is stable.
