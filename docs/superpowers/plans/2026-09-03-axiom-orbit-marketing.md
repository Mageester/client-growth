# Axiom Orbit Marketing Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a premium landing page and product page that clearly sell Axiom Orbit's post-sale agency-growth category and send pilot interest to the existing signup flow.

**Architecture:** Add a self-contained marketing component and style system to the React Router app, register `/product`, and turn `/` into a public page. Keep authenticated routes and backend behavior unchanged; shared-root integration is limited to suppressing the existing public app header on the two marketing routes.

**Tech Stack:** React 19, React Router 7, TypeScript 5.9, plain CSS, Vitest 3, React server-rendering tests, existing Axiom Orbit PNG assets.

**Spec:** `docs/superpowers/specs/2026-09-03-axiom-orbit-marketing-design.md`

## Global Constraints

- Every `Request access` CTA links to `/signup`; `Sign in` links to `/login`.
- Preserve Node `24.x`, pnpm `10.12.1`, and the existing local-only `pnpm verify` gate.
- Add no UI framework or heavy dependency.
- Do not change crawler, monitoring, auth, database, evaluator, AI, or security behavior.
- Use only approved assets under `public/brand/`.
- Fabricated customers, testimonials, results, revenue, integrations, and product claims are prohibited.
- Revenue/outcome lifecycle functionality is labeled `Direction`, not `Available now`.
- Support 1440, 1024, 768, and 390 widths, visible keyboard focus, strong contrast, and reduced motion.
- Work only in the isolated `codex/axiom-orbit-marketing` worktree. Do not merge or deploy.

---

### Task 1: Route contracts and shared marketing shell

**Files:**
- Create: `app/components/marketing-layout.tsx`
- Create: `app/styles/marketing.css`
- Create: `test/app.marketing.test.ts`
- Modify: `app/routes.ts`
- Modify: `app/root.tsx`

**Interfaces:**
- Produces `MarketingLayout`, `MarketingHeader`, and `MarketingFooter` React components.
- Registers `route("product", "routes/product.tsx")`.
- Marketing routes `/` and `/product` bypass `.public-topbar` and `.public-content`; every other route retains existing shell behavior.

- [ ] **Step 1: Write the failing shell tests**

Create `test/app.marketing.test.ts` using `renderToStaticMarkup` and `MemoryRouter`. Assert that `app/routes.ts` contains the product route, `MarketingHeader` renders links to `/product`, `/signup`, and `/login`, the primary label is `Request access`, and `MarketingFooter` contains `An Axiom product` with no fake-proof language.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run test/app.marketing.test.ts`. Expect module-not-found and missing-route failures.

- [ ] **Step 3: Implement the shared shell**

Build semantic header/main/footer markup with the approved primary or chrome brand asset. The mobile menu uses a real button, `aria-expanded`, a named target, click-to-close links, and Escape handling. Import `marketing.css` from the component.

- [ ] **Step 4: Integrate the root safely**

In `app/root.tsx`, define `const isMarketingRoute = location.pathname === "/" || location.pathname === "/product";`. When true, render the route content directly after the existing skip link. Do not alter authenticated shell behavior. Add the product route to `app/routes.ts`.

- [ ] **Step 5: Establish the isolated CSS system**

Namespace styles under `.marketing-page` or `marketing-*`. Define near-black surfaces, white/warm-gray text, one restrained status accent, 1200px content width, fluid type, precise hairlines, small radii, focus-visible outlines, 40px touch targets, mobile nav collapse at 760px, and reduced-motion overrides.

- [ ] **Step 6: Verify GREEN and commit**

Run `pnpm exec vitest run test/app.marketing.test.ts` and `pnpm typecheck`. Both must pass. Commit the five files as `feat(marketing): add public Orbit shell`.

---

### Task 2: Landing page and real-product visual language

**Files:**
- Create: `app/components/marketing-visuals.tsx`
- Modify: `app/routes/_index.tsx`
- Modify: `app/styles/marketing.css`
- Modify: `test/app.marketing.test.ts`

**Interfaces:**
- Consumes `MarketingLayout`.
- Produces `OpportunityEvidenceVisual`, `OrbitLoop`, and `MonitoringTimeline`.
- Produces landing `meta()` with canonical `https://orbit.getaxiom.ca/` and matching Open Graph/Twitter data.

- [ ] **Step 1: Add failing landing tests**

Statically render the landing route and assert the exact H1 `Grow the clients you’ve already won.`, links to `/signup` and `/product`, the labels `Evidence before action` and `Inconclusive`, and absence of `revolutionize`, `supercharge`, and `unparalleled`. Assert `meta()` contains a canonical link descriptor for `https://orbit.getaxiom.ca/`.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run test/app.marketing.test.ts`. Expect failures because `_index.tsx` still redirects.

- [ ] **Step 3: Build the ordered landing narrative**

Replace the redirect page with: hero; portfolio problem; Orbit loop; evidence-before-action example; what Orbit watches; continuous monitoring; agency workflow; economic close; pilot CTA. The hero secondary action is `Explore the product` → `/product`. Use a lightweight session-only loader only if needed for an `Open workspace` shortcut; do not query workspace data or change auth behavior.

- [ ] **Step 4: Build credible explanatory visuals**

Use actual Orbit concepts: a clearly labeled `Illustrative product view`, account `Northstar HVAC`, signal `Broken quote path`, mapped service `Conversion optimisation`, checked sources, status `Open`, evidence strength, and an agency review action. Do not present deterministic display data as customer proof.

- [ ] **Step 5: Finish responsive composition and verify**

Use asymmetric editorial grids above 900px and semantic single-column order below it. Contain every visual so the page cannot overflow horizontally. At 1440px, retain a hint of the next section below the hero. Run the focused test and `pnpm build`; both must pass.

- [ ] **Step 6: Commit**

Commit the landing files as `feat(marketing): build Orbit landing page`.

---

### Task 3: Product capability narrative

**Files:**
- Create: `app/routes/product.tsx`
- Modify: `app/components/marketing-visuals.tsx`
- Modify: `app/styles/marketing.css`
- Modify: `test/app.marketing.test.ts`

**Interfaces:**
- Consumes `MarketingLayout` and the shared product visuals.
- Produces canonical metadata for `https://orbit.getaxiom.ca/product`.
- Produces ordered sections with IDs `monitor`, `understand`, `find`, `act`, and `grow`.

- [ ] **Step 1: Add failing product tests**

Statically render the product page. Assert visible chapter labels `Monitor`, `Understand`, `Find`, `Act`, and `Grow`; availability labels `Available now` and `Direction`; and `Revenue and outcome tracking` is not paired with `Available now`. Assert the exact product canonical URL.

- [ ] **Step 2: Verify RED**

Run `pnpm exec vitest run test/app.marketing.test.ts`. Expect module-not-found and content failures.

- [ ] **Step 3: Build the five chapters**

Create a compact product hero followed by alternating chapters: Monitor shows New/Still open/Resolved/Inconclusive states; Understand shows inspected evidence and client context; Find shows broken conversion and missing service coverage; Act shows review, pricing context, and proposal preparation; Grow shows the lifecycle with revenue/outcome tracking explicitly labeled `Direction`.

- [ ] **Step 4: Add responsive chapter treatment**

Alternate copy and visuals above 900px while preserving copy-before-visual DOM order. Stack below 900px. At 390px, any capability rail may scroll within its own container but the page must not overflow.

- [ ] **Step 5: Verify GREEN and commit**

Run the focused test, `pnpm typecheck`, and `pnpm build`. All must pass. Commit as `feat(marketing): explain the Orbit product system`.

---

### Task 4: Browser fidelity, accessibility, and responsive repair

**Files:**
- Modify only marketing source/test files when defects are found.
- Create: `docs/evidence/axiom-orbit-marketing-fidelity.md`
- Create screenshots under `docs/evidence/` for home at 1440, 1024, 768, 390 and product at 1440, 390.

**Interfaces:**
- Produces inspectable screenshots and a fidelity ledger covering copy, layout, typography, palette, asset treatment, spacing, navigation, responsive behavior, and motion.

- [ ] **Step 1: Start the deterministic app**

Run `pnpm dev:fixture`, record the localhost URL, and confirm `/` and `/product` render.

- [ ] **Step 2: Inspect desktop behavior**

At 1440px, check first-viewport balance, next-section visibility, approved logo, H1 breaks, CTA prominence, product visual legibility, full scroll narrative, and console output. Click product, signup, login, footer, and home links.

- [ ] **Step 3: Capture required responsive evidence**

Capture home at 1440, 1024, 768, and 390; capture product at 1440 and 390. Use the exact viewport widths, not approximate browser resizing.

- [ ] **Step 4: Audit accessibility and overflow**

Tab through navigation and CTAs, verify visible focus, confirm Escape closes the mobile menu, check `scrollWidth <= clientWidth`, and emulate `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Write and resolve the fidelity ledger**

Record `Design requirement`, `Rendered evidence`, and `Fix/result` for at least: copy, first viewport, typography, palette, approved asset treatment, product visual fidelity, responsive collapse, navigation, and motion. Repair every fixable mismatch.

- [ ] **Step 6: Inspect final images**

Use the image viewer on the approved primary brand asset and the latest 1440/390 screenshots in one QA pass. Reject clipped copy, accidental wraps, unreadable labels, fake-looking product surfaces, rough cards, logo mismatch, and mobile overflow.

- [ ] **Step 7: Verify and commit**

Run the focused marketing test, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Commit repairs and evidence as `fix(marketing): finish responsive visual QA`.

---

### Task 5: Reconcile parallel work and open the PR

**Files:**
- Modify only files with demonstrated conflicts from current `main`.
- Create: `docs/evidence/axiom-orbit-marketing-pr.md`.

**Interfaces:**
- Produces a pushed `codex/axiom-orbit-marketing` branch and review PR. It does not merge or deploy.

- [ ] **Step 1: Re-check Claude and remote activity**

Inspect the main checkout status, its latest five commits, current origin/main, and all overlap with marketing files. Preserve current uncommitted tour/product work.

- [ ] **Step 2: Rebase conservatively**

Fetch origin and run `git rebase origin/main`. Resolve only demonstrated overlap and preserve newer canonical branding/product-shell behavior. Abort and reassess rather than guessing about product behavior.

- [ ] **Step 3: Run the release gate**

Run `pnpm verify`. Repository safety, production preflight, tests, typecheck, and build must all pass locally.

- [ ] **Step 4: Run and read the benchmark**

Run `pnpm bench`. Record core, judgment, and adversarial GOOD/QUESTIONABLE/BAD totals. Do not infer trust from exit zero, alter the benchmark, or enable production DeepSeek.

- [ ] **Step 5: Verify the final slice**

Run `git diff --check origin/main...HEAD`, inspect status, and inspect `origin/main..HEAD`. The worktree must be clean and contain only marketing/spec/plan/evidence commits plus conservative conflict resolutions.

- [ ] **Step 6: Push and open the PR**

Push `codex/axiom-orbit-marketing`. Create a PR to `main` whose body summarizes both routes, actual assets, browser evidence, verification totals, conflicts avoided, the diagnostic benchmark weakness, and the explicit statements `Not deployed` and `Not merged`.
