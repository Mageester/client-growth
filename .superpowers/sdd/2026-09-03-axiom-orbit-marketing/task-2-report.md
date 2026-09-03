# Task 2 report — public Axiom Orbit landing showcase

## Scope

Implemented the public `/` showcase in the approved marketing surface. The page consumes `MarketingLayout`, keeps the authenticated app untouched, and introduces the three requested reusable fragments:

- `OpportunityEvidenceVisual` — a deterministic, clearly marked opportunity/evidence surface.
- `OrbitLoop` — the six-step Client portfolio → Monitor → Understand → Find → Review → Act sequence.
- `MonitoringTimeline` — opt-in Weekly setup and New / Still open / Resolved / Inconclusive states.

Owned implementation files are `app/components/marketing-visuals.tsx`, `app/routes/_index.tsx`, `app/styles/marketing.css`, and `test/app.marketing.test.ts`.

## Content and truth review

- Hero starts directly with the exact H1 `Grow the clients you’ve already won.` and uses only `Request access` → `/signup` and `Explore the product` → `/product` as public hero actions.
- Category contrast appears once in the hero: Pipeline Engine acquires new clients; Orbit grows and retains existing ones.
- Section order is Hero → Portfolio problem → Orbit loop → Evidence before action → What Orbit watches → Continuous monitoring → Agency workflow → Economic case → Pilot CTA.
- The product fragments use only explanatory display data: Northstar HVAC, Broken quote path, Conversion optimisation, Open, Strong evidence, checked source paths, and `Review & prepare proposal`.
- The fragments are labelled `Illustrative product view` and `Illustrative data — not customer proof.`; no customer metrics, logos, testimonials, charts, percentages, ROI, or revenue claims were added.
- Monitoring is explicitly opt-in per client, Off by default, with Weekly as the selectable cadence. Inconclusive is described as an incomplete read, never as a clean result.
- `Available now` and `Direction` distinguish current product capability from account-growth/outcome/revenue tracking direction. Proposal drafts stay inside Orbit until copied out.
- CSS is namespaced to `.marketing-page`, uses the approved near-black/chrome palette, preserves the existing brand asset treatment, adds restrained transform/line/state motion, and includes reduced-motion fallbacks. Grids collapse to semantic one-column order below 900px and avoid `100vw` overflow math.

## Test-first evidence

1. Added static-rendering landing content and metadata assertions before implementation.
2. RED captured with `pnpm exec vitest run test/app.marketing.test.ts`: 9 tests ran, 2 failed as expected because the existing index rendered `null` and had no `meta()` export; the 7 existing shell assertions passed.
3. GREEN after implementation: `pnpm exec vitest run test/app.marketing.test.ts` — **9 tests passed**.
4. `git diff --check` — **passed**.
5. `pnpm typecheck` — **passed** while using the brief-approved temporary untracked `app/routes/product.tsx` placeholder, required because the current route table references that not-yet-present shared route. The placeholder was removed immediately after verification.
6. `pnpm build` — **passed** with the same temporary placeholder; React Router emitted only its existing future-flag warnings. The placeholder was removed immediately after verification.

## Remaining integration note

The worktree route table currently references `app/routes/product.tsx`, but that module is outside this task’s ownership and was absent during verification. The temporary placeholder is not present in the final slice. The shared `app/root.tsx` still contains its existing generic relative `og:image` tag; the landing route exports the required absolute OG image and canonical/Twitter descriptors, while final shared-head deduplication can be handled by the owner of that shared file if needed.

## Review round 1 evidence

The follow-up review identified five concrete presentation/accessibility issues. I verified each against the rendered markup and CSS before changing it:

- The hero fragment’s `h3` appeared before the first page `h2`; it is now a styled non-heading label (`Opportunity detail`).
- `compact` previously changed only the card shadow; it now renders a shorter record-only structure with account, signal, mapped service, status, evidence strength, checked sources, and action, leaving the case narrative to the full evidence surface.
- Loop, watch, and workflow fragments now use open editorial rows with small inline SVG line icons instead of repeated numbered tiles.
- The visual loop sequence remains available as a decorative CSS line but is `aria-hidden`, leaving the ordered list as the only audible sequence.
- The monitoring rail uses a dedicated `scaleY` progression keyframe at the 900px mobile breakpoint and below; reduced-motion still disables it.
- All semantic content grids now collapse to one column below 900px, with the existing 620px/420px refinements retained for tighter screens.

Review-round TDD evidence:

1. Added focused tests for heading order, compact-structure distinction, decorative loop semantics, non-numbered editorial fragments, and vertical mobile animation.
2. RED captured with `pnpm exec vitest run test/app.marketing.test.ts`: 12 tests ran, 3 failed as expected for the heading, compact, and loop/vertical-motion behaviors; the other 9 passed.
3. GREEN captured with `pnpm exec vitest run test/app.marketing.test.ts` — **12 tests passed**.
4. `git diff --check` — **passed**.
5. `pnpm typecheck` and `pnpm build` — **passed** with the brief-approved temporary untracked `app/routes/product.tsx` placeholder; the placeholder was removed after both checks. Build emitted only the existing React Router future-flag warnings.
