# Axiom Orbit Product Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Orbit's public entry, first-client activation, opportunity workflow, and proposal handoff read as one fast, truthful, client-ready product journey.

**Architecture:** Preserve existing React Router actions, repositories, and schemas. Implement the polish as three independent route/style slices plus one primary-agent integration slice; behavioral changes are limited to progressive disclosure, access-policy routing/copy, contextual labels, and presentation-only proposal framing.

**Tech Stack:** React 19, React Router 7, TypeScript 5.9, Vitest 3, Cloudflare Workers, CSS.

**Spec:** `docs/superpowers/specs/2026-09-06-axiom-orbit-product-polish-design.md`

## Global Constraints

- Preserve evidence-first and inconclusive-not-clean semantics.
- Do not add runtime dependencies, persistence, billing, messaging, signing, or production mutations.
- Preserve Node `24.x`, pnpm `10.12.1`, tenant scoping, and deterministic local verification.
- Use RED/GREEN: run each focused test before implementation and record the expected assertion failure.
- Do not edit files owned by another task; report cross-slice needs to the primary agent.
- Do not commit or push unless the user explicitly requests it.

---

### Task 1: Truthful marketing and account entry

**Files:**
- Modify: `app/routes/_index.tsx`
- Modify: `app/routes/product.tsx`
- Modify: `app/routes/signup.tsx`
- Modify: `app/components/marketing-visuals.tsx`
- Modify: `app/styles/marketing.css`
- Test: `test/app.marketing.test.ts`
- Test: `test/app.publicPages.test.ts`
- Test: `test/routes.signupAccess.test.ts`

**Interfaces:**
- Consumes: existing `loaderData.publicSignup: boolean` and invitation `returnTo` behavior.
- Produces: capability-family marketing copy, deliberate proposal-share wording, and an access-policy-consistent public signup state.

- [ ] **Step 1: Add failing marketing assertions**

Assert that rendered public routes mention evidence-backed checks without the obsolete three-category limit, describe deliberate expiring proposal links, retain the no-auto-send boundary, and do not contain `Drafts stay inside Axiom Orbit until you copy them out`.

```ts
expect(productSource).toContain("expiring share link");
expect(productSource).toContain("Nothing is sent automatically");
expect(productSource).not.toContain("three detection categories");
```

- [ ] **Step 2: Add failing access-policy assertions**

When `publicSignup` is false, assert that the page labels the state as pilot/invitation access and does not present a misleading self-serve `Create account` primary action to an uninvited visitor. Preserve invitation-return behavior.

- [ ] **Step 3: Run RED**

Run: `pnpm test -- test/app.marketing.test.ts test/app.publicPages.test.ts test/routes.signupAccess.test.ts`

Expected: FAIL on obsolete product claims and the uninvited account-creation presentation.

- [ ] **Step 4: Implement the minimal truthful entry flow**

Update copy and conditional presentation using the existing loader contract. Keep the hero, navigation, illustrative labels, and future-direction boundary. Do not change signup admission logic or auth policy.

- [ ] **Step 5: Polish marketing responsiveness and motion**

Use existing selectors. Ensure essential hero content remains visible under `prefers-reduced-motion`, and tighten first-viewport proof without new assets.

- [ ] **Step 6: Run GREEN**

Run: `pnpm test -- test/app.marketing.test.ts test/app.publicPages.test.ts test/routes.signupAccess.test.ts`

Expected: PASS.

---

### Task 2: Progressive first-client activation

**Files:**
- Modify: `app/routes/onboarding.tsx`
- Modify: `app/styles/orbit-approved.css` only for selectors scoped under `.onboarding`
- Test: `test/routes.onboarding.test.ts`
- Test: `test/app.approvedRedesign.test.ts` only for onboarding-specific assertions

**Interfaces:**
- Consumes: `STARTER_SERVICES`, current stage-one form field names, `ReadingSite`, and existing stage-two confirmation behavior.
- Produces: a collapsed-by-default starter-pricing editor without changing posted field names, defaults, validation, or route actions.

- [ ] **Step 1: Add failing progressive-disclosure assertions**

Assert that stage one contains a visible starter-service summary, a `Review starter pricing` disclosure, and keeps all existing service form names/default values inside the form while the first viewport prioritizes agency/client/site fields.

```ts
expect(source).toContain("Review starter pricing");
expect(source).toContain("<details");
expect(source).toContain("Read the site");
```

- [ ] **Step 2: Add failing honesty-state assertions**

Assert that copy states: defaults price early findings, can be reviewed before analysis, the first action is crawl-only, and the confirm stage remains the gate before analysis.

- [ ] **Step 3: Run RED**

Run: `pnpm test -- test/routes.onboarding.test.ts test/app.approvedRedesign.test.ts`

Expected: FAIL because starter pricing is always expanded and precedes the client fields.

- [ ] **Step 4: Reorder and collapse the editor**

Render agency and first-client fields first. Move the existing `STARTER_SERVICES.map` block into a semantic `<details>` section after a compact summary. Preserve every checkbox, service-name input, min/max input, default, constraint, and POST name.

- [ ] **Step 5: Polish narrow-width layout**

Keep the summary and disclosure operable at 390px, stack price inputs without horizontal overflow, and retain 44px interaction targets.

- [ ] **Step 6: Run GREEN**

Run: `pnpm test -- test/routes.onboarding.test.ts test/app.approvedRedesign.test.ts`

Expected: PASS.

---

### Task 3: Actionable opportunities and client-ready proposal share

**Files:**
- Modify: `app/routes/opportunities._index.tsx`
- Modify: `app/routes/opportunities.$id.tsx`
- Modify: `app/routes/proposal.share.tsx`
- Modify: `app/components/signal-desk.tsx`
- Modify: `app/styles/signal-desk.css`
- Test: `test/app.signalDesk.test.ts`
- Test: `test/app.ui.test.ts` only for signal-desk/proposal assertions
- Test: `test/routes.opportunityDecisions.test.ts`
- Test: `test/proposalShares.test.ts`

**Interfaces:**
- Consumes: existing opportunity status, confidence, evidence refs, immutable proposal snapshot, and proposal-share persistence.
- Produces: contextual action labels, plain-language evidence strength, wrap-safe rows, first-viewport evidence summary, and a presentation-only proposal next step.

- [ ] **Step 1: Add failing opportunity-presentation assertions**

Assert that open findings use `Prepare client proposal`, prepared findings use `Review proposal`, queue rows expose evidence-strength text, and ordering copy explains billable fit/evidence/recency.

- [ ] **Step 2: Add failing proposal-share assertions**

Assert that the public share includes `Next step`, an estimate/scope disclaimer, and no acceptance, signing, payment, or send control.

```ts
expect(html).toContain("Next step");
expect(html).toContain("confirm the final scope");
expect(html).not.toMatch(/accept proposal|sign|pay now/i);
```

- [ ] **Step 3: Run RED**

Run: `pnpm test -- test/app.signalDesk.test.ts test/app.ui.test.ts test/routes.opportunityDecisions.test.ts test/proposalShares.test.ts`

Expected: FAIL on contextual labels, evidence wording, and client next-step framing.

- [ ] **Step 4: Implement contextual presentation**

Use existing status and confidence helpers. Do not change ranking, price calculations, decisions, share-token behavior, or snapshot persistence. Place an evidence summary before the proposal action and group disposition actions below the primary workflow.

- [ ] **Step 5: Implement share next-step framing**

Add a neutral contact-the-preparing-agency next step and estimate disclaimer derived solely from existing snapshot fields. Do not add a form or external link when no contact destination exists.

- [ ] **Step 6: Polish wrapping and print styles**

Allow two-line identity/title cells, prevent ambiguous ellipses, stack fact bars on narrow widths, and add print-safe contrast and spacing in existing owned CSS.

- [ ] **Step 7: Run GREEN**

Run: `pnpm test -- test/app.signalDesk.test.ts test/app.ui.test.ts test/routes.opportunityDecisions.test.ts test/proposalShares.test.ts`

Expected: PASS.

---

### Task 4: Integration, fixture truth, accessibility, and rendered QA

**Files:**
- Modify: `scripts/design-harness.tsx`
- Modify: `app/styles/app.css` only when a shared primitive is required by two or more slices
- Modify: focused tests only when integration exposes a real uncovered contract

**Interfaces:**
- Consumes: completed outputs of Tasks 1-3.
- Produces: consistent fixture identity, cross-route styling, verified desktop/mobile screenshots, and final deterministic evidence.

- [ ] **Step 1: Write a failing fixture-consistency test or assertion**

Ensure every opportunity fixture's evidence domain matches its client domain. The Cambridge Heating fixture must not render Northwind Heating evidence.

- [ ] **Step 2: Run RED**

Run the smallest test or harness assertion that proves the current mixed-client fixture fails.

- [ ] **Step 3: Correct fixture identity and shared primitives**

Update only fixture values and genuinely shared accessibility/responsive primitives. Do not rewrite agent-owned slices during integration.

- [ ] **Step 4: Run focused integration checks**

Run: `pnpm test -- test/app.marketing.test.ts test/app.publicPages.test.ts test/routes.signupAccess.test.ts test/routes.onboarding.test.ts test/app.approvedRedesign.test.ts test/app.signalDesk.test.ts test/app.ui.test.ts test/routes.opportunityDecisions.test.ts test/proposalShares.test.ts`

Expected: PASS.

- [ ] **Step 5: Build and inspect the design harness**

Run:

```powershell
pnpm tsx scripts/design-harness.tsx build/client/harness
node scripts/harness-server.mjs build/client 4321
```

Inspect marketing entry, signup policy, onboarding setup/confirm/unreadable, opportunities, opportunity detail, and branded proposal at approximately 1440px and 390px. Check focus visibility, contrast risks, wrapping, page overflow, reduced-motion behavior, and console warnings/errors.

- [ ] **Step 6: Exercise hydrated interactions**

Run the local fixture app when needed and verify the pricing disclosure, opportunity search/filter, contextual proposal action, and narrow navigation each produce the expected visible state.

- [ ] **Step 7: Run final verification**

Run:

```powershell
pnpm verify
git diff --check
```

Expected: exit 0, no test failures, no type/build errors, and no whitespace errors.
