# Axiom Orbit Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before claiming completion.

**Goal:** Resolve every confirmed finding in the 9 September 2026 product audit and verify the complete agency-review-to-recipient journey locally.

**Architecture:** Preserve the existing React Router/Cloudflare/D1 boundaries. Consolidate shared truth in small core/repository helpers, keep immutable proposal/report snapshots at public boundaries, and repair responsive/form behavior through existing UI primitives and CSS rather than adding a new subsystem.

**Tech Stack:** React 19, React Router 7, TypeScript, Cloudflare Workers/D1, Vitest, in-app browser Playwright controls.

**Spec:** `/home/dread/.codex/visualizations/2026/09/09/01a0872c-093a-7eb3-ad99-198b7ad3e6b0/axiom-orbit-audit/audit-report.md`

## Global Constraints

- Keep analysis outcome, evidence/readiness, sales progress, and visibility distinct.
- Only a fresh completed analysis may establish clean or resolved site health.
- The client-facing snapshot must exactly match the reviewed commercial document; source evidence remains separate.
- Existing share snapshots never mutate when live records change.
- Do not weaken evidence gates, invent business impact, spend on live providers, deploy, or contact real recipients.
- Keep all work tenant-scoped; preserve owner-only link management and token-hash storage.
- Support 390px, 768px, and 1440px without page-level horizontal overflow, and preserve keyboard/focus behavior.
- Add no dependency unless it materially reduces the implementation.

---

### Task 1: Truthful state and correction paths

**Files:** `app/lib/portfolio.ts`, `app/lib/actionCenter.ts`, `app/routes/changes.tsx`, `app/routes/clients._index.tsx`, `app/routes/clients.$id.tsx`, `app/routes/opportunities._index.tsx`, `app/routes/opportunities.$id.tsx`, `src/db/opportunityFunnel.ts`, focused tests.

- [ ] Add failing tests for findings 1, 2, 3, and 12.
- [ ] Represent a completed findings run separately from clean even when no work remains open.
- [ ] Derive entry-point actions from persisted evidence/readiness, not absence of an analysis run alone.
- [ ] Give every filtered-empty state an explicit clear action and no health conclusion.
- [ ] Add deliberate correction actions for sold amount/status, covered decisions, and removed coverage.
- [ ] Run the focused core/route tests.

### Task 2: Reviewed proposal and durable link management

**Files:** `src/core/proposal.ts`, `src/db/proposalShares.ts`, `app/routes/opportunities.$id.tsx`, `app/routes/proposal.share.tsx`, focused tests.

- [ ] Add failing tests for findings 4, 5, 14, 15, and 16.
- [ ] Store and render a structured reviewed proposal snapshot with one title, scope, price/currency, and next step.
- [ ] Keep evidence as a separate source section without repeating commercial commitments.
- [ ] Provide approachable fields plus a complete formatted preview and derived counts/saved state.
- [ ] Persist retrievable active-link URLs using the existing raw token boundary without storing raw tokens in D1; expose copy/open/expiry/revoke/version controls after refresh.
- [ ] Replace bare confidence percentages with verification-language and limitations.

### Task 3: Report history, versions, and recipient recovery

**Files:** `src/core/clientReport.ts`, `src/db/clientReports.ts`, `app/components/client-report.tsx`, `app/routes/clients.$id.tsx`, `app/routes/clients.$id.report.tsx`, `app/routes/reports.$id.tsx`, `app/routes/report.share.tsx`, focused tests.

- [ ] Add failing tests for findings 5, 6, 15, 23, and 27.
- [ ] List saved report versions from the client with private/shared state, open, duplicate/revise, and sharing actions.
- [ ] Load active report-link management after refresh.
- [ ] Make headings/titles sequential and specific, and expose a configured agency contact next step.
- [ ] Use recipient-safe expired/revoked recovery and correct report empty-state tokens.

### Task 4: Responsive shell, dense queue, and accessible overlays

**Files:** `app/root.tsx`, `app/components/ui.tsx`, `app/routes/clients._index.tsx`, `app/routes/clients.$id.tsx`, `app/routes/opportunities._index.tsx`, existing stylesheets, focused UI tests.

- [ ] Add structural regression tests for findings 7, 8, 13, and 22.
- [ ] Constrain menus/drawers to the viewport and remove page-level horizontal overflow.
- [ ] Stack/wrap client actions and use readable mobile client cards.
- [ ] Keep primary destination labels visible on narrow screens.
- [ ] Render single findings as compact rows; reserve package summaries for real multi-finding packages and hide unset metrics.
- [ ] Verify focus trap, Escape, return focus, reduced motion, and long content.

### Task 5: Activation, forms, settings, and professional defaults

**Files:** `app/routes/onboarding.tsx`, `app/components/catalog-assistant.tsx`, `app/routes/services._index.tsx`, `app/routes/clients.import.tsx`, `app/routes/login.tsx`, `app/components/tour.tsx`, `app/components/settings-navigation.tsx`, `app/routes/settings.tsx`, `app/routes/monitor.tsx`, related styles/tests.

- [ ] Add failing tests for findings 9, 10, 11, 17, 18, 19, 20, 21, 24, 25, 26, and 29.
- [ ] Put the first client action first; demote optional catalog assistance and advertise availability before input.
- [ ] Use field-level plain-language validation and focus the invalid field.
- [ ] Preserve meaningful drafts across drawer dismissal and failed login.
- [ ] Add CSV file import/template guidance and post-import activation actions.
- [ ] Add local upload/preview/remove for PNG/JPEG logos while retaining optional HTTPS URL entry.
- [ ] Rename settings around actual capabilities and add an honest prefilled MONITOR request path with pilot terms.
- [ ] Replace technical starter names/descriptions and update the tour/recovery copy.

### Task 6: Public shell, copy pass, and end-to-end release gate

**Files:** `app/root.tsx`, public/marketing/legal routes and components, relevant styles/tests, `docs/audit/2026-09-09-audit-finding-checklist.md`.

- [ ] Add failing tests for findings 28 and 29 and run the complete copy/claim review.
- [ ] Render one public shell on privacy/terms and use consistent access language.
- [ ] Run `pnpm verify`, focused benchmarks, and no-paid-call guards.
- [ ] Walk a fresh disposable workspace through onboarding, import, analysis states, evidence, proposal/report edit/save/share/reopen/revoke, corrections, settings, mobile, keyboard, refresh, and back/forward.
- [ ] Capture/inspect material screenshots, browser console, exact viewport measurements, and reconcile all 29 dispositions.
