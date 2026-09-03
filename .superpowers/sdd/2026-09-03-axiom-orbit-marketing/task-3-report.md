# Task 3 report — public Axiom Orbit product detail

## Scope

Implemented the public `/product` showcase as a companion to the public landing page. It consumes `MarketingLayout` and adds five focused, deterministic product fragments while leaving the authenticated application untouched.

Owned implementation files:

- `app/routes/product.tsx`
- `app/components/marketing-visuals.tsx`
- `app/styles/marketing.css`
- `test/app.marketing.test.ts`

## Product story

- Hero starts with `Grow the clients you’ve already won.` and uses `Request access` → `/signup` plus `See how it works` → `#monitor`.
- The boundary statement makes the product distinction explicit: `Not a CRM. Not a generic scanner. A focused post-sale growth workflow.`
- The chapter rail is ordered Monitor → Understand → Find → Act → Grow and includes the Available now / In development / rollout / Direction legend.
- Monitor explains opt-in, per-client Weekly monitoring and New / Still open / Resolved / Inconclusive states.
- Understand is bounded to public-site evidence plus agency-entered offerings, service catalog, and contract coverage.
- Find names only the three current categories: Missing service page, No service pages only when the read supports it, and Broken conversion path.
- Act shows evidence review, agency-catalog potential value, an editable proposal draft, and the `Nothing is sent` boundary.
- Grow is explicitly `Direction · revenue and outcome tracking`; no current outcome, revenue, ROI, win-rate, or retention claim is made.
- Every deterministic fragment is labelled `Illustrative product view` and uses the explanatory `Northstar HVAC` account.

## Test-first evidence

1. Added product semantics, availability, CTA, banned-copy, and metadata tests before creating `app/routes/product.tsx`.
2. RED captured with `pnpm test -- test/app.marketing.test.ts`: **18 tests, 5 failed** as expected because the product route module did not exist; the 13 existing landing/shell checks stayed green.
3. GREEN captured with `pnpm test -- test/app.marketing.test.ts`: **18 tests passed**.

## Verification

- `pnpm typecheck` — **passed**.
- `pnpm build` — **passed**; React Router emitted only its existing future-flag warnings.
- `git diff --check` — **passed**.
- Playwright terminal fallback smoke at 1440×900 and 390×844 confirmed the desktop alternating compositions, mobile copy-before-visual stacking, and page title. Document width checks reported no horizontal overflow (`scrollWidth === clientWidth`: 1425 desktop, 375 mobile).
- Mobile menu smoke confirmed disclosure state changes and Escape returns focus to the menu button.

## Residual concerns

- Browser screenshots, live providers, customer outcomes, and production deployment were not evidence for this task; the UI remains deliberately illustrative.
- The build’s React Router future-flag warnings are pre-existing and outside this task’s ownership.

## Commit

Commit message: `feat(marketing): explain the Orbit product system`
