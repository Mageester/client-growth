# P0 Crawl and Technical-Finding Addendum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active technical-finding P0 slice count real pages once, preserve an actionable page-by-page case, surface discovered broken internal links, and restore aligned index layouts.

**Architecture:** Put URL-shape canonicalization at the evidence boundary and reuse the canonical crawl key in technical rule counting and reconciliation. Keep individual rules literal, but make the aggregate own the page list, detail sentence, and count-aware title. Give probe-bearing rules a bounded priority allocation so discovered internal links cannot be starved by conversion probes, and scope the CSS correction to index surfaces.

**Tech Stack:** React 19, React Router 7, TypeScript 5.9, Cloudflare Workers, Vitest, CSS, Wrangler/D1.

**Spec:** `docs/superpowers/specs/2026-09-04-p0-crawl-aggregation-addendum.md`

## Global Constraints

- Preserve existing/uncommitted `.analyzability-after2.json`; stage only this coherent P0 slice and its plan/spec files.
- Preserve Node `24.x`, pnpm `10.12.1`, the local-only deterministic benchmark boundary, and all existing evidence/privacy/tenant contracts.
- URL-shape canonicalization is required; content-hash deduplication and headless rendering are out of scope.
- Technical aggregate evidence must retain affected page URLs, historic dismissal refs, and readable rationale; no bare count-only opportunity row is valid.
- `maxProbes` remains a bounded per-analysis budget; discovered internal-link checks receive reserved capacity when conversion probing is also active.
- P1 discovery tuning is blocked until production Worker reach is measured separately from the residential/cache analyzability result.
- Do not enter passwords, create credentials, or claim live email/AI/billing evidence from local tests.

---

### Task 1: Canonicalize crawl identity and technical page counting

**Files:**
- Modify: `src/adapters/evidence/urlPolicy.ts`
- Modify: `src/adapters/evidence/HttpEvidenceProvider.ts`
- Modify: `src/core/rules/technical.ts`
- Modify: `src/core/rules/missingTitle.ts`
- Modify: `src/core/rules/duplicateTitle.ts`
- Modify: `src/core/rules/thinServicePage.ts`
- Modify: `src/core/rules/missingH1.ts`
- Modify: `src/core/rules/missingMetaDescription.ts`
- Modify: `src/core/rules/missingStructuredData.ts`
- Modify: `src/core/rules/missingImageAlt.ts`
- Test: `test/adapters.httpEvidenceDiscovery.test.ts`
- Test: `test/core.technicalRules.test.ts`
- Test: `test/pipeline.technicalRules.test.ts`

**Interfaces:**
- Consumes: `normalizeAndValidateUrl`, `crawlKey`, bounded HTTP frontier state, and `EvidencePage` arrays.
- Produces: `canonicalizeCrawlUrl(input)` for request/frontier normalization and `uniquePages(pages)` for deterministic technical-rule counting and reconciliation.

- [x] **Step 1: Write failing URL-shape crawl tests**

Add a discovery case whose homepage links to `/`, `/index.html`, `/index.htm`, `/index.php`, and `/about/`/`/about`. Assert that the crawler requests one URL for each canonical page identity, emits one evidence page for the homepage and one for `/about`, and spends no page slot on aliases:

```ts
it("collapses index files and trailing slashes before spending crawl slots", async () => {
  const { fetchImpl, requested } = siteFetch({
    "https://example.com/": page("Home", [
      "/index.html", "/index.htm", "/index.php", "/about/", "/about",
    ]),
    "https://example.com/about": page("About"),
  });
  const evidence = await new HttpEvidenceProvider({ fetchImpl, maxPages: 2 })
    .getEvidence(client("example.com"));

  expect(evidence.site.pages.map((item) => item.url)).toEqual([
    "https://example.com/",
    "https://example.com/about",
  ]);
  expect(requested.filter((url) => /\/index\.(?:html?|php)$/.test(url))).toHaveLength(0);
});
```

Add a core-rule regression using the same readable page twice under `/` and `/index.html`; assert the aggregate has one page ref and one image count for that page.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run test/adapters.httpEvidenceDiscovery.test.ts test/core.technicalRules.test.ts test/pipeline.technicalRules.test.ts`

Expected: the new crawler test observes duplicate aliases or an over-consumed page budget, and the technical test observes duplicate page evidence/counts.

- [x] **Step 3: Implement the canonical crawl key**

In `urlPolicy.ts`, normalize a terminal `index.html`, `index.htm`, or `index.php` to its parent path and normalize non-root trailing slashes away. Export `canonicalizeCrawlUrl` and make `crawlKey` use the same path function. In `HttpEvidenceProvider`, canonicalize URLs before inserting the frontier and before returning sitemap candidates; key the frontier by `crawlKey` so aliases cannot occupy separate entries. Keep the actual fetched URL in evidence when a non-alias redirect produces it.

- [x] **Step 4: Reuse canonical identity in rules and reconciliation**

Add `uniquePages` in `technical.ts`, keyed by `crawlKey`, and make all eight technical rules operate on the unique page list. Use the same key for page/target lookup, `readablePageUrls`, and `technicalSubjectWasRevisited`. When aggregating evidence refs, keep the first readable URL for a canonical page and prevent image counts from adding the same canonical page twice.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run: `pnpm exec vitest run test/adapters.httpEvidenceDiscovery.test.ts test/core.technicalRules.test.ts test/pipeline.technicalRules.test.ts`

Expected: PASS, with the alias crawl using one homepage slot and technical aggregates counting canonical pages once.

### Task 2: Preserve page-specific aggregate cases and count-aware titles

**Files:**
- Modify: `src/core/rules/technical.ts`
- Modify: `src/core/assembleOpportunity.ts`
- Modify: `app/lib/evidence.ts`
- Test: `test/core.technicalRules.test.ts`
- Test: `test/pipeline.technicalRules.test.ts`
- Test: `test/app.signalDesk.test.ts`

**Interfaces:**
- Consumes: canonical `page:`/`target:` evidence refs and the existing deterministic technical evaluation.
- Produces: aggregate `detected` prose containing the affected URLs and opportunity titles such as `Missing meta description — 7 pages`.

- [x] **Step 1: Write failing aggregate presentation tests**

Extend the technical aggregate test to assert that a multi-page metadata candidate includes every affected URL in `detected`. Extend the pipeline test to assert the assembled opportunity title includes its page count:

```ts
expect(meta?.detected).toContain(`${ORIGIN}/about`);
expect(meta?.detected).toContain(`${ORIGIN}/contact`);
expect(result.opportunities.find((item) => item.ruleId === "missing-meta-description")?.title)
  .toBe("Missing meta description — 1 page");
```

Add a signal-row assertion for `Missing meta description — 7 pages`, proving the queue no longer renders indistinguishable count-free rows.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run test/core.technicalRules.test.ts test/pipeline.technicalRules.test.ts test/app.signalDesk.test.ts`

Expected: the current aggregate sentence omits the page list and `titleFor` still returns `Missing meta description`.

- [x] **Step 3: Generate detailed aggregate evidence**

Have `aggregateTechnicalGroup` derive canonical page URLs, target URLs, title refs, and image counts from the retained refs. Build rule-specific sentences that state the count and list URLs; for duplicate titles preserve the title text and the full readable-page list. For broken links state both the verified targets and the source pages. Keep suppressed evidence refs attached without allowing them to alter active page counts.

- [x] **Step 4: Build count-aware technical titles**

In `assembleOpportunity.ts`, derive the page count from canonical `page:` refs and target count from canonical `target:` refs. Return count-aware titles for every technical rule, using singular/plural labels (`1 page`, `7 pages`, `1 target`) and retain the existing non-technical and conversion titles.

- [x] **Step 5: Keep the detail evidence readable**

Update `buildEvidenceCase` only where needed so canonical aliases do not duplicate evidence items and aggregate page refs remain linkable. Keep the existing evidence headline, rationale, and primary/secondary ordering; do not replace the case with a count-only item.

- [x] **Step 6: Run the focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core.technicalRules.test.ts test/pipeline.technicalRules.test.ts test/app.signalDesk.test.ts`

Expected: PASS with page-specific aggregate prose, count-aware queue titles, and a detail case that lists affected URLs.

### Task 3: Make discovered internal-link probes resilient to crawl priority

**Files:**
- Modify: `src/core/rules/context.ts`
- Modify: `src/core/rules/index.ts`
- Modify: `src/core/rules/brokenInternalLink.ts`
- Modify: `src/core/rules/brokenConversionPath.ts`
- Modify: `src/pipeline/analyzeClient.ts`
- Test: `test/core.technicalRules.test.ts`
- Test: `test/pipeline.technicalRules.test.ts`

**Interfaces:**
- Consumes: every `EvidenceLink` retained from readable HTML, `ProbeResult`, and the existing `maxProbes` input.
- Produces: at least reserved bounded probe capacity for the discovered internal-link rule when both probe-bearing rules are active; no increase beyond the per-run total.

- [x] **Step 1: Write a failing starvation regression**

Add a fixture where a readable homepage exposes twelve conversion CTA links and one later-discovered, non-conversion internal link marked `inNav: true`; the page cap leaves the target out of `site.pages`. Run both rules through `runRules` with eight probes and assert the 404 target is surfaced, its source page is in evidence, and total probe calls do not exceed eight.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/core.technicalRules.test.ts test/pipeline.technicalRules.test.ts`

Expected: the current shared budget is consumed by conversion/internal work before the later target is probed, so no broken-internal candidate is returned.

- [x] **Step 3: Allocate the bounded probe budget by rule**

In `runRules`, detect whether the catalog has active `broken-internal-link` and `conversion-fix` services. If both are active, reserve at least one probe and split the configured total between the two rule contexts; if only one is active, give that rule the full configured budget. Keep all probe budgets bounded by the original total.

- [x] **Step 4: Prioritize discovered internal targets**

In `brokenInternalLinkRule`, deduplicate targets by canonical crawl key and order candidates so navigation links and non-conversion links are checked before ordinary conversion CTAs. Continue to include crawled 404/410 pages without probing them; probe uncrawled discovered same-site links when reserved capacity remains. Preserve the existing fail-closed behavior for timeouts, blocked results, and non-404/410 statuses.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run: `pnpm exec vitest run test/core.technicalRules.test.ts test/pipeline.technicalRules.test.ts test/core.brokenConversionPath.test.ts test/bench.engine.test.ts`

Expected: PASS, with the discovered 404 surfaced and every benchmark case still using no more than eight probes.

### Task 4: Scope the index-layout repair and inspector wrapping

**Files:**
- Modify: `app/routes/changes.tsx`
- Modify: `app/styles/signal-desk.css`
- Modify: `test/app.ui.test.ts`
- Modify: `test/app.signalDesk.test.ts`

**Interfaces:**
- Consumes: existing route loader data and signal-desk classes.
- Produces: aligned heading/body columns on `/clients`, `/services`, and `/changes`; wrapped mapped-service values in the opportunity inspector; unchanged full-bleed Opportunities desk and centred detail pages.

- [x] **Step 1: Write failing CSS contracts**

Add assertions that the stylesheet gives directory/weekly index pageheads a constrained, `border-box` width matching their content column, and that `.inspector-metrics dd` uses block wrapping with `overflow-wrap:anywhere` rather than flex-end ellipsis. Add a route markup assertion that the Changes root carries the index-page class.

- [x] **Step 2: Run the focused UI tests and verify RED**

Run: `pnpm exec vitest run test/app.ui.test.ts test/app.signalDesk.test.ts`

Expected: the current stylesheet still declares flex-end/nowrap/text-overflow for metric values and no scoped Changes index class exists.

- [x] **Step 3: Align only index pageheads**

Keep the global `.pagehead` rules for Opportunities. Add scoped rules for `.directory-page > .pagehead` and the Changes index class so the title and constrained records/sections share the same left edge at desktop widths, with responsive overrides matching the existing 1100px and 650px gutters. Add the class to `changes.tsx`; leave client/service detail routes and the single-finding detail layout alone.

- [x] **Step 4: Make inspector values wrap from the right edge**

Replace the metric `dd` flex/ellipsis declarations with a shrinkable block value, normal whitespace, right alignment, and `overflow-wrap:anywhere`. Preserve the compact two-column metric row for short values; a long mapped service may occupy multiple lines instead of being clipped from the left.

- [x] **Step 5: Run focused UI tests and inspect rendered screens**

Run: `pnpm exec vitest run test/app.ui.test.ts test/app.signalDesk.test.ts`

Then render the existing design harness and inspect `/clients`, `/services`, `/changes`, and the Opportunities inspector at desktop and phone widths. Expected: index headings align with records/sections, mapped service text is readable, and the Opportunities desk/detail alignment is unchanged.

### Task 5: Integrated verification and production-evidence boundary

**Files:**
- Modify: `docs/launch-acceptance-2026-09-04.md` only if the final verified production evidence is recorded there.
- Modify: `docs/HANDOFF.md` only if the P1 production-reach gate needs to be carried forward.

**Interfaces:**
- Consumes: completed P0 code, the deployed Worker, and the existing production smoke boundary.
- Produces: fresh deterministic gates, a separate production-vs-cache reach report, and the Cambridge production finding/title/value report if the deployed account/session can run it without credential entry.

- [x] **Step 1: Run the local deterministic gates**

Run: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm analyzability --offline`, and `git diff --check`.

Expected: exit code 0 for each; a timeout or missing live provider is reported as inconclusive, never as passing.

- [x] **Step 2: Check production migration/deploy prerequisites without exposing secrets**

Run: `pnpm production:preflight` and inspect the pending migration/deployment state. Apply only the committed migration required by the active P0 slice, deploy the verified build with the guarded production script, and do not switch on a paid provider or enter credentials through a browser.

- [ ] **Step 3: Measure reach in both environments before P1**

Run the existing corpus report from the cache and a production Worker-side/canonical deployed analysis path for the same domains. Record `cache analyzable/total`, `production analyzable/total`, blocked/inconclusive counts, and the date/provider path separately. Do not use the cache-only 19/24 figure as production reach.

Status: blocked pending an authorized production session or a Worker-side corpus
check; the deployed auth boundary returned no session, so the cache result is
reported separately and no production denominator is invented.

- [ ] **Step 4: Re-analyse Cambridge in production when an existing authorized session/path is available**

Use the deployed app against `cambridgeheating.ca`, then record the finding count, exact titles, potential-value range, and which finding is real. Capture the affected page URLs for the aggregate rows and confirm the 404 internal target is included if the live HTML exposes it as a discovered link. If the deployed account/session is unavailable without entering a password, report that concrete blocker and do not substitute a local replay for production evidence.

Status: not run because no authorized deployed session is available without
entering or creating credentials.

- [x] **Step 5: Review scope and preserve the dirty boundary**

Run: `git status --short`, `git diff --stat`, and inspect the final diff. Confirm `.analyzability-after2.json` remains untracked and untouched, no unrelated engine-trust work was staged, and only the P0 slice plus plan/spec/acceptance evidence changed.
