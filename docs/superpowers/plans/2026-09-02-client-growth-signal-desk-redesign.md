# Client Growth Signal Desk Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Client Growth's UI around the selected Signal Desk concept while preserving every existing backend and workflow contract.

**Architecture:** Keep React Router loaders/actions authoritative and add a presentation-only layer: a responsive global shell, reusable signal-queue/inspector components, and a single tokenized stylesheet imported after the legacy styles. Route changes only reshape rendered information and client-side selection state.

**Tech Stack:** React 19, React Router 7, TypeScript 5.9, CSS, Vitest, Cloudflare Workers/D1.

**Spec:** `docs/superpowers/specs/2026-09-02-client-growth-signal-desk-redesign.md`

## Global Constraints

- Do not change crawler, evaluator, opportunity, tenancy, auth, scheduler, database, migration, evidence, or proposal semantics.
- Do not add Reports, billing, plan management, a standalone Monitoring route, or speculative analytics.
- Use only real loader data and existing product states.
- Preserve Node `24.x`, pnpm `10.12.1`, and the local-only deterministic `pnpm verify` boundary.
- Required QA widths are 1440, 1024, 768, and 390 pixels.

---

### Task 1: Establish the responsive application shell

**Files:**
- Modify: `app/root.tsx`
- Create: `app/styles/signal-desk.css`
- Modify: `test/app.ui.test.ts`

**Interfaces:**
- Consumes: existing root loader `{ signedIn, workspaceName, email }` and existing `Menu` / `Icon` primitives.
- Produces: `.app-frame`, `.app-sidebar`, `.mobile-appbar`, `.work-surface`, and shared design tokens used by every route.

- [ ] **Step 1: Write a failing shell contract test**

Add a server-rendered test for a small exported navigation primitive. Assert that Opportunities, Clients, and Services are present, Settings remains separate, and no speculative Reports/Monitoring route is rendered.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/app.ui.test.ts`

Expected: failure because the new navigation primitive/export does not exist.

- [ ] **Step 3: Implement the shell and tokens**

Export and render the navigation primitive from `app/root.tsx`; retain public/auth header behavior. Add the fixed light canvas, navy rail, Inter typography, focus treatment, responsive top bar, shared controls, rows, panels, and drawer overrides in `signal-desk.css`. Import it after `app.css`.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `pnpm exec vitest run test/app.ui.test.ts && pnpm typecheck`

Expected: PASS and no TypeScript errors.

### Task 2: Build the Opportunities signal queue and inspector

**Files:**
- Create: `app/components/signal-desk.tsx`
- Modify: `app/routes/opportunities._index.tsx`
- Modify: `app/styles/signal-desk.css`
- Create: `test/app.signalDesk.test.tsx`

**Interfaces:**
- Consumes: `Opportunity`, client data, resolved service names, `buildEvidenceCase`, `statusBadge`, `isOpen`, formatting helpers.
- Produces: `OpportunitySignalRow` and `OpportunityInspector`; URL search parameter `opportunity=<id>` selects a queue item.

- [ ] **Step 1: Write failing component tests**

Render the new components in a memory router using a literal opportunity fixture. Assert the row exposes title, client, mapped service, value, evidence strength, and open state; assert the inspector exposes rationale, evidence, and the existing review/proposal destination.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/app.signalDesk.test.tsx`

Expected: failure because `app/components/signal-desk.tsx` does not exist.

- [ ] **Step 3: Implement components and route composition**

Create compact semantic queue rows and the inspector. Update the route so client/filter changes clear stale opportunity selection, wide layouts default to the first visible row, explicit row selection is URL-backed, and mobile selection opens the inspector drawer. Keep the full detail route as the authoritative review/proposal surface.

- [ ] **Step 4: Verify GREEN and preserve portfolio behavior**

Run: `pnpm exec vitest run test/app.signalDesk.test.tsx test/app.portfolio.test.ts`

Expected: PASS.

### Task 3: Reframe Clients and account detail as portfolio workspaces

**Files:**
- Modify: `app/routes/clients._index.tsx`
- Modify: `app/routes/clients.$id.tsx`
- Modify: `app/styles/signal-desk.css`
- Modify: `test/app.ui.test.ts`

**Interfaces:**
- Consumes: current enriched client totals, monitoring state, latest run, suggestions, coverage, and analysis actions.
- Produces: managed-account rows and a cohesive account workspace without changing forms or actions.

- [ ] **Step 1: Add failing presentation-helper tests**

Add assertions for the visible state vocabulary used by managed-account rows, including the distinction between clean, inconclusive, never analyzed, and needs attention.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/app.ui.test.ts`

Expected: failure for the new presentation contract.

- [ ] **Step 3: Restructure route markup and responsive layout**

Keep all loader/action code unchanged. Reorder account row metadata and client-detail regions around attention, monitoring, opportunities, commercial coverage, offerings, suggestions, and history. Preserve edit drawers, analyze buttons, coverage toggles, suggestion decisions, and monitoring submission.

- [ ] **Step 4: Verify GREEN with route tests**

Run: `pnpm exec vitest run test/app.ui.test.ts test/routes.catalogAndClients.test.ts test/routes.monitoring.test.ts test/routes.offeringSuggestions.test.ts`

Expected: PASS.

### Task 4: Align Services, detail/proposal, Settings, onboarding, and auth

**Files:**
- Modify: `app/routes/services._index.tsx`
- Modify: `app/routes/opportunities.$id.tsx`
- Modify: `app/routes/settings.tsx`
- Modify: `app/routes/onboarding.tsx`
- Modify: `app/routes/login.tsx`
- Modify: `app/routes/signup.tsx`
- Modify: `app/routes/forgot-password.tsx`
- Modify: `app/routes/reset-password.tsx`
- Modify: `app/styles/signal-desk.css`

**Interfaces:**
- Consumes: all existing loaders, actions, `SidePanel`, form validation, proposal markdown, and monitoring health data.
- Produces: one coherent visual system across catalog, evidence review, proposal editing, settings, onboarding, and auth.

- [ ] **Step 1: Record existing route behavior with focused tests**

Run: `pnpm exec vitest run test/routes.opportunityDecisions.test.ts test/routes.catalogAndClients.test.ts test/routes.passwordReset.test.ts test/auth.flow.test.ts`

Expected: PASS before markup changes.

- [ ] **Step 2: Apply visual-only markup classes and layout**

Turn Services into a commercial catalog, make the proposal decision region sticky on wide screens, group Settings compactly, and align onboarding/auth typography and forms. Do not rename submitted fields, intents, action values, or routes.

- [ ] **Step 3: Re-run the focused behavior tests**

Run: `pnpm exec vitest run test/routes.opportunityDecisions.test.ts test/routes.catalogAndClients.test.ts test/routes.passwordReset.test.ts test/auth.flow.test.ts`

Expected: PASS.

### Task 5: Rendered responsive and accessibility QA

**Files:**
- Modify: `app/styles/signal-desk.css`
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: accepted 1440 concept and live seeded local application.
- Produces: browser evidence at 1440, 1024, 768, and 390, plus `design-qa.md` with `final result: passed` or an honest blocker.

- [ ] **Step 1: Start the seeded app and inspect major routes**

Run: `pnpm dev`

Browser flow: `/opportunities` -> select an opportunity -> open full evidence -> inspect proposal; then Clients -> client detail -> edit drawer; Services -> new-service drawer; Settings. Also inspect empty/inconclusive states available in seed data.

- [ ] **Step 2: Capture the 1440 comparison and run design QA**

Open the accepted concept and implementation screenshot together. Compare shell, queue, inspector, typography, palette, density, controls, content, and evidence/action hierarchy. Fix every P0/P1/P2 issue and repeat.

- [ ] **Step 3: Check responsive breakpoints**

At 1024, 768, and 390 verify no horizontal page overflow, primary routes remain reachable, rows remain scannable, drawers fit, long evidence wraps, and primary actions remain visible.

- [ ] **Step 4: Check interaction/accessibility state**

Verify keyboard focus, Escape/close behavior, `aria-current`/pressed state, live status messages, target sizes, reduced motion, and console health.

### Task 6: Full release gate, commits, and pull request

**Files:**
- Modify: only files in Tasks 1-5 plus generated lockfile changes if a dependency is required.

**Interfaces:**
- Consumes: all completed UI slices.
- Produces: a clean dedicated branch, verified commits, pushed branch, and open PR without deployment.

- [ ] **Step 1: Run the required product gates**

Run: `pnpm bench`

Run: `pnpm verify`

Run: `git diff --check`

Expected: commands exit 0; benchmark diagnostics retain their existing meaning and are reported honestly.

- [ ] **Step 2: Review scope and repository state**

Run: `git status --short`, `git diff --stat`, and inspect the final diff for backend or migration changes.

- [ ] **Step 3: Commit coherent UI slices**

Commit the accepted concept/spec/plan, the shell/design system, the Opportunities workspace, and the remaining route polish as reviewable commits.

- [ ] **Step 4: Push and open a dedicated PR**

Push `codex/premium-signal-desk-redesign`, create a PR against `main`, include verification evidence and screenshots, and do not deploy.
