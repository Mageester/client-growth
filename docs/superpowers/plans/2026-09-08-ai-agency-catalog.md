# AI Agency Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agency generate, review, price, and atomically save its service catalog from its website, a written summary, or both.

**Architecture:** A strict catalog-generator port and DeepSeek adapter produce provenance-bound draft rows from bounded existing crawl evidence. Route actions return drafts without writing, reusable review UI collects explicit confirmation and prices, and one repository batch persists validated services. A separate reservation table caps this paid feature per workspace and platform.

**Tech Stack:** TypeScript, React Router 7, React 19, Zod, Cloudflare Workers/D1, DeepSeek chat completions, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-ai-agency-catalog-design.md`

## Global Constraints

- Node must remain exactly `24.x`; pnpm remains `10.12.1`.
- Generation never writes services; only explicit confirmation writes.
- The model never supplies or estimates prices.
- Website-derived rows require a source URL from the pages actually read.
- Website content is untrusted data, not model instructions.
- At most 30 draft rows and one paid provider call per generation request.
- Manual service entry remains functional and visible.
- Saving selected draft rows is atomic and tenant-scoped.

---

### Task 1: Strict catalog generation boundary

**Files:**
- Create: `src/ports/AgencyCatalogGenerator.ts`
- Create: `src/core/agencyCatalogDraft.ts`
- Create: `src/adapters/catalog/DeepSeekAgencyCatalogGenerator.ts`
- Create: `src/adapters/catalog/createAgencyCatalogGenerator.ts`
- Test: `test/core.agencyCatalogDraft.test.ts`
- Test: `test/adapters.deepSeekAgencyCatalogGenerator.test.ts`

**Interfaces:**
- Produces: `AgencyCatalogGenerator.generate(input): Promise<AgencyCatalogDraftItem[]>`.
- Produces: `sanitizeCatalogDraft({ raw, allowedPageUrls, existingServices }): AgencyCatalogDraftItem[]`.

- [ ] **Step 1: Write failing core tests** for invalid rows, source URLs outside the crawl, source-less website rows, normalized duplicates, existing-service duplicates, and the 30-row cap.
- [ ] **Step 2: Run `pnpm vitest run test/core.agencyCatalogDraft.test.ts`** and confirm the missing module/behavior fails.
- [ ] **Step 3: Implement the Zod schemas and pure sanitization function** exactly as defined in the spec, preserving only valid evidence-backed rows.
- [ ] **Step 4: Run the core test** and confirm it passes.
- [ ] **Step 5: Write failing adapter tests** using an injected `fetchImpl` for JSON request shape, untrusted-content delimiters, timeout/non-2xx/malformed response, and source filtering.
- [ ] **Step 6: Implement the DeepSeek adapter** with one request, temperature zero, JSON object response format, 20-second timeout, and no retry.
- [ ] **Step 7: Run both focused tests** and confirm they pass.
- [ ] **Step 8: Commit** with `git commit -m "feat(orbit): add strict agency catalog generator"`.

### Task 2: Paid-request limits and atomic catalog persistence

**Files:**
- Create: `migrations/0025_catalog_generation_limits.sql`
- Create: `src/db/catalogGenerationLimits.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/repositories.ts`
- Modify: `src/config/env.ts`
- Modify: `scripts/production-preflight.ts`
- Test: `test/db.catalogGenerationLimits.test.ts`
- Test: `test/db.repositories.test.ts`
- Test: `test/production.migrations.test.ts`

**Interfaces:**
- Produces: `reserveCatalogGeneration(scope, options): Promise<CatalogGenerationAdmission>`.
- Produces: `upsertServicesAtomic(scope, services): Promise<void>`.

- [ ] **Step 1: Write failing database tests** proving workspace isolation, 10/day workspace cap, 200/day platform cap, UTC reset, and atomic rollback on ownership conflict.
- [ ] **Step 2: Run the focused database tests** and confirm they fail.
- [ ] **Step 3: Add migration and canonical schema** for `catalog_generation_reservations(workspace_id, reserved_at)` with indexed UTC-day lookup.
- [ ] **Step 4: Implement reservation admission** as one transaction-safe batch/statement path with configurable validated caps.
- [ ] **Step 5: Implement atomic service upsert** with preflight ownership checks and a single `SqlDb.batch` call.
- [ ] **Step 6: Update production preflight** to report the catalog-generation worst-case alongside analysis calls.
- [ ] **Step 7: Run focused database, migration, and preflight tests** and confirm they pass.
- [ ] **Step 8: Commit** with `git commit -m "feat(orbit): bound and atomically save AI catalogs"`.

### Task 3: Server orchestration and Services route

**Files:**
- Create: `app/lib/catalog-assistant.server.ts`
- Create: `app/components/catalog-assistant.tsx`
- Modify: `app/routes/services._index.tsx`
- Modify: `app/styles/app.css`
- Test: `test/routes.catalogAssistant.test.ts`
- Modify: `test/routes.catalogAndClients.test.ts`

**Interfaces:**
- Consumes: generator, reservation, existing evidence crawler, `upsertServicesAtomic`.
- Produces: `generateAgencyCatalogDraft(scope, env, input, signal)` and reusable `CatalogAssistant` UI.

- [ ] **Step 1: Write failing route tests** for missing inputs, mock-provider refusal, crawl failure before reservation, successful website/summary generation, no persistence during generation, tampered payload rejection, invalid pricing, and one atomic save.
- [ ] **Step 2: Run route tests** and confirm the new intents fail.
- [ ] **Step 3: Implement server orchestration** that validates input, performs the bounded crawl, reserves one call, invokes the configured generator, and returns measured page/source counts.
- [ ] **Step 4: Implement `generate-catalog` and `save-generated-catalog` actions** with strict review-payload parsing, server-generated IDs, deterministic tags, and atomic persistence.
- [ ] **Step 5: Build the assistant/review UI** with website and summary inputs, editable selected rows, visible provenance, bulk pricing, disabled invalid save, and explicit loading/error states.
- [ ] **Step 6: Keep `New service` and the existing side-panel editor unchanged** and add responsive styling using existing tokens.
- [ ] **Step 7: Run route/render tests** and confirm they pass.
- [ ] **Step 8: Commit** with `git commit -m "feat(orbit): add AI catalog review to services"`.

### Task 4: Onboarding integration and acceptance

**Files:**
- Modify: `app/routes/onboarding.tsx`
- Modify: `app/components/catalog-assistant.tsx`
- Modify: `app/styles/app.css`
- Modify: `test/routes.onboarding.test.ts`

**Interfaces:**
- Consumes: reusable draft generation/review contracts from Task 3.
- Produces: an onboarding setup post that persists either confirmed AI rows or the existing confirmed starter services before crawling the first client.

- [ ] **Step 1: Write failing onboarding tests** proving draft generation writes no services, confirmed rows replace starter selection, skipped AI preserves starter behavior, and a hand-crafted cross-workspace ID is rejected.
- [ ] **Step 2: Run the onboarding tests** and confirm they fail.
- [ ] **Step 3: Add agency website/summary generation to setup** while preserving entered agency and client fields across the generation response.
- [ ] **Step 4: Submit selected reviewed rows with setup** and persist them atomically before the first client crawl; retain the starter catalog when AI is skipped.
- [ ] **Step 5: Run focused onboarding and catalog tests** and confirm they pass.
- [ ] **Step 6: Run `pnpm verify` and `pnpm analyzability --offline`**; require zero test/type/build failures and zero false-analyzable sites.
- [ ] **Step 7: Use Playwright against the built app** to generate from a real agency website, edit/bulk-price/save, reopen Services, and manually add a service; capture screenshots and console output.
- [ ] **Step 8: If a local DeepSeek key is configured, run one explicit live generation** and verify every returned URL belongs to the captured evidence. Otherwise record live-provider acceptance as not reached.
- [ ] **Step 9: Commit** with `git commit -m "feat(orbit): generate agency services during onboarding"`.

