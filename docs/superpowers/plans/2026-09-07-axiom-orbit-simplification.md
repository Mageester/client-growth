# Axiom Orbit evidence-first simplification v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make client setup evidence-led and commercially coherent while making zero-readable-site failures diagnosable and recoverable without weakening fail-closed analysis.

**Architecture:** Extend the existing HTTP evidence bundle with stable failure metadata and a bounded same-site apex/`www.` retry. Reuse the existing onboarding confirmation and deterministic offering suggestion paths rather than introducing a second crawler or AI workflow. Add a pure derived opportunity-family grouping used only by views.

**Tech Stack:** React Router 7, TypeScript, Cloudflare Workers, D1 JSON evidence bundles, Vitest, existing `HttpEvidenceProvider`, DeepSeek evaluator boundary.

**Spec:** `docs/superpowers/specs/2026-09-07-axiom-orbit-simplification-design.md`

## Global Constraints

- Preserve deterministic technical checks, evidence thresholds, tenant scoping, pricing, and funnel semantics.
- A zero-readable fallback may only use fetched readable HTML and must remain inconclusive otherwise.
- Keep the normal HTTP crawler authoritative; do not add browser rendering or spoof evidence.
- DeepSeek remains semantic-only and fail-closed.
- Preserve existing untracked evidence artifacts and do not perform Git history mutation.
- Every production behavior change follows RED -> focused failure -> minimal GREEN -> focused pass.

---

### Task 1: Structured crawl failure telemetry and safe same-site fallback

**Files:**
- Modify: `src/core/schema.ts` (`EvidenceNetworkEventSchema`)
- Modify: `src/adapters/evidence/HttpEvidenceProvider.ts`
- Create: `src/core/evidenceDiagnostics.ts`
- Test: `test/adapters.httpEvidenceSecurity.test.ts`
- Test: `test/adapters.httpEvidenceDiscovery.test.ts`
- Test: `test/core.evidenceDiagnostics.test.ts`

**Interfaces:**
- Produces `EvidenceFailureCode`, `EvidenceNetworkStage`, `summarizeEvidenceFailure(evidence)`, and enriched `networkEvents` with `code` and `stage` for new captures.
- Keeps old persisted events valid by making new metadata optional at the schema boundary and inferring a code for legacy reasons.

- [ ] Write a failing timeout test asserting a timeout is recorded at the robots, sitemap, and page stages with `code: "timeout"` and `stage` values.
- [ ] Run the focused provider test and verify it fails because robots timeout telemetry is currently discarded and events have no code/stage.
- [ ] Write a failing fallback test where the apex host times out and the allowed `www.` sibling returns readable HTML; assert the returned evidence contains only sibling pages and no false absence claim.
- [ ] Run the focused discovery test and verify it fails because the provider currently stops after the first origin.
- [ ] Write a failing diagnostics test asserting timeout evidence produces a client-safe explanation naming the transport timeout and retry action, while an empty evidence bundle without events retains the generic explanation.
- [ ] Implement stable failure codes/stages, record robots failures, preserve status/redirect metadata, and infer legacy codes in `evidenceDiagnostics.ts`.
- [ ] Implement one bounded alternate-origin attempt using `canonicalSiteHost`/`isSameSite`; retain readable evidence only from a successful attempt and combine failure telemetry only when no attempt yields readable pages.
- [ ] Run the three focused test files and confirm GREEN.

### Task 2: Surface crawl diagnostics in onboarding and client pages

**Files:**
- Modify: `app/lib/analysis.server.ts` only if the shared crawl error needs a typed boundary
- Modify: `app/routes/onboarding.tsx`
- Modify: `app/routes/clients.$id.tsx`
- Modify: `app/routes/clients._index.tsx`
- Test: `test/routes.onboarding.test.ts`
- Test: `test/routes.catalogAndClients.test.ts`

**Interfaces:**
- Loaders return a derived failure summary from the latest evidence without exposing raw internal policy details.
- The client detail retry action returns the same useful diagnostic rather than replacing it with “check the domain.”

- [ ] Write failing route tests for a zero-readable timeout bundle whose rendered onboarding/client output includes a timeout explanation and retry action.
- [ ] Run the focused route tests and verify the generic-only copy fails the new assertions.
- [ ] Implement loader diagnostics and replace generic zero-page copy with the derived safe explanation.
- [ ] Keep incomplete evidence inconclusive and keep retry as normal HTTP only.
- [ ] Run focused route tests and confirm GREEN.

### Task 3: Name + website client entry with automatic evidence handoff

**Files:**
- Modify: `app/routes/clients._index.tsx`
- Modify: `app/routes/onboarding.tsx` only where the existing confirmation redirect needs a catalog-aware continuation
- Test: `test/routes.catalogAndClients.test.ts`
- Test: `test/routes.onboarding.test.ts`

**Interfaces:**
- A normal `/clients` add action accepts name/domain/notes, persists an empty offerings array, runs `collectEvidenceOnly` with the request signal, and redirects to `/onboarding?client=<id>`.
- Direct posts containing legacy `offerings` remain valid for compatibility; the primary form no longer asks for them.

- [ ] Write a failing route test proving a client add triggers a crawl-only read, persists evidence, leaves offerings empty, records no analysis run, and returns the confirmation redirect.
- [ ] Run the focused route test and verify the current JSON response fails the redirect assertion.
- [ ] Implement the action handoff with tenant-scoped writes and bounded failure handling.
- [ ] Remove the primary offerings textarea and update copy to explain that Orbit will read the site first.
- [ ] Run focused route tests and confirm GREEN without changing import behavior.

### Task 4: Plain-language catalog with conservative automatic mapping

**Files:**
- Modify: `app/routes/services._index.tsx`
- Modify: `src/core/serviceTagSuggestions.ts` only for conservative ordinary-language aliases proven by tests
- Test: `test/routes.catalogAndClients.test.ts`
- Test: `test/core.serviceTagSuggestions.test.ts`

**Interfaces:**
- New service saves use deterministic suggestions when the agency does not submit an explicit override.
- Existing explicit matches and legacy tags remain authoritative; the advanced override remains available but is no longer the primary mental model.

- [ ] Write a failing service route test saving “Website service page design” without `matches` and assert it stores the conservative `landing-page` or `service-pages-build` mapping according to the unambiguous text.
- [ ] Run the focused catalog test and verify the current action stores no tags.
- [ ] Add failing language tests for at least one ordinary service phrase and one broad phrase that must remain unmapped.
- [ ] Run the tag tests and verify the broad phrase remains safely unmapped.
- [ ] Implement server-side automatic mapping and adjust UI copy/labels so internal rule labels appear only inside the advanced override.
- [ ] Run focused catalog/tag tests and confirm GREEN.

### Task 5: Derived commercial project families

**Files:**
- Create: `src/core/opportunityGrouping.ts`
- Modify: `app/routes/opportunities._index.tsx`
- Modify: `app/routes/clients.$id.tsx`
- Test: `test/core.opportunityGrouping.test.ts`
- Test: `test/app.ui.test.ts` or the nearest existing route rendering test

**Interfaces:**
- `groupOpportunitiesByFamily<T extends { opportunity: Pick<Opportunity, "ruleId">; client: Pick<Client, "id" | "name"> }>(entries)` returns derived groups with family key/label, client identity, and original entries.
- Grouping never changes child opportunity objects or totals.

- [ ] Write a failing pure test proving service-page/competitor findings group under service visibility, conversion findings under conversion, technical findings under site health, and all child IDs/prices/statuses remain unchanged.
- [ ] Run the focused grouping test and verify the helper is absent.
- [ ] Implement the pure grouping helper and render group headers/disclosures in the portfolio and client findings views without aggregated package pricing.
- [ ] Run focused UI/grouping tests and confirm GREEN.

### Task 6: Integrated verification and GLM provenance report

**Files:**
- Modify: `docs/evidence/` only if a new Artfully reproduction record is needed; do not overwrite existing evidence files.
- Modify: `docs/HANDOFF.md` only if the incident boundary is useful for the next handoff.

- [ ] Run the focused Artfully/provider/route/grouping suites.
- [ ] Run `pnpm test`; if a timeout recurs, rerun the named test with a longer focused timeout and report the full-suite result honestly.
- [ ] Run `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- [ ] Run `pnpm verify` if the earlier full-suite timeout is stable; otherwise report the exact blocked gate rather than treating a partial run as passing.
- [ ] Re-check `git status`, preserve all pre-existing untracked files, and report that Git contains no GLM 5.3 Flash attribution; distinguish exact commit changes from unknown model provenance.
