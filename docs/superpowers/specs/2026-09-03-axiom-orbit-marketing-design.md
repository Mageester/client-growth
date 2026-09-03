# Axiom Orbit Public Marketing Experience

## Objective

Create a production-quality public landing page and product page for Axiom Orbit that explain the post-sale agency-growth category, connect the product to legitimate revenue opportunities within existing client accounts, and invite agency owners into the pilot through the existing signup flow.

The pages must present the real product honestly. They will not claim unavailable features, customers, results, revenue, or integrations.

## Audience and message

The primary audience is an agency owner or operator who already manages a portfolio of client websites but reviews those accounts inconsistently.

The opening promise is: **Grow the clients you have already won.** Orbit continuously reviews the accounts an agency already manages, identifies meaningful changes and gaps, and presents evidence-backed work for human review.

The category distinction must remain explicit:

- Pipeline Engine helps agencies acquire new clients.
- Axiom Orbit helps agencies grow and retain existing clients.
- Orbit is not a CRM, generic scanner, SEO dashboard, lead-generation product, or cold-outreach tool.

## Chosen architecture

Build a self-contained marketing surface inside the existing React Router application.

- `/` becomes the public landing page.
- `/product` becomes the detailed product page.
- `/signup` remains the primary pilot CTA destination.
- `/login` remains the separate sign-in destination.
- Authenticated product routes and backend behavior remain unchanged.

New marketing components and styles will be isolated from the authenticated application shell. The root layout may receive only the smallest route-aware integration needed to avoid rendering the existing public app header around marketing pages. Existing product UI styles will not be refactored.

This approach is preferred over extending the existing public shell because Claude is actively changing shared application UI files. Isolation reduces conflicts and permits a distinct editorial composition without changing product behavior.

## Shared marketing system

The two pages share a focused marketing layout and component set:

- route-aware header with approved Axiom Orbit branding;
- desktop navigation and accessible mobile navigation;
- consistent CTA treatment for `Request access` and `Sign in`;
- editorial section wrapper, technical labels, hairlines, and responsive type scale;
- real-product-inspired opportunity, evidence, and monitoring surfaces;
- restrained footer linking the product, signup, sign-in, and parent Axiom brand.

The visual language is near-black, white, and warm technical grays with one restrained status accent derived from existing product semantics. Space Grotesk, Inter, and JetBrains Mono already present in the approved branding work provide display, body, and technical label roles.

Composition uses open space, rules, precise grids, cropped product surfaces, and diagrammatic sequences. It avoids card grids as the default layout, decorative space imagery, generic gradients, glassmorphism, inflated radii, and fabricated charts.

Motion is limited to navigation disclosure, subtle entrance/line progression, and product-state emphasis. All motion is disabled or reduced under `prefers-reduced-motion`.

## Landing page

The landing page sells the category and economic result in this order:

1. **Hero** — concise promise, short explanation, `Request access` primary CTA, `Explore the product` secondary CTA, and a first-view product surface showing a monitored account and a defensible opportunity.
2. **Portfolio problem** — an editorial statement that valuable client relationships go unreviewed while conversion breaks, service gaps, and account changes accumulate.
3. **Orbit loop** — a linear visual sequence: Client portfolio → Monitor → Understand → Find → Review → Act. The agency remains the decision-maker.
4. **Evidence before action** — a realistic opportunity example that connects an observation, source evidence, commercial rationale, and suggested next step without promising automated sales.
5. **What Orbit watches** — a sparse technical inventory covering recurring change, conversion paths, service coverage, and honest new/open/resolved/inconclusive states.
6. **Continuous monitoring** — a time-based narrative showing that Orbit revisits accounts rather than producing a one-off audit.
7. **Agency workflow** — review, qualify, price with agency context, and prepare the conversation. Current product capabilities are distinguished from product direction.
8. **Economic close** — the software is framed as a way to systematically inspect already-won relationships, not with a fabricated ROI claim.
9. **Pilot CTA** — `Request access` links to `/signup`; `Sign in` remains available separately.

## Product page

The product page explains the system in five capability chapters:

1. **Monitor** — recurring checks, detected changes, state transitions, and explicit inconclusive outcomes.
2. **Understand** — crawl evidence, client/account context, current services, and offering suggestions.
3. **Find** — legitimate opportunities such as broken conversion paths and missing service coverage. Future categories are described as extensibility, not live functionality.
4. **Act** — opportunity review, evidence inspection, service-pricing context, and proposal preparation. Any partially built workflow is labeled accurately.
5. **Grow** — the future account-growth lifecycle, including outcome and revenue tracking, is presented as direction rather than a currently available claim.

Each chapter pairs concise commercial copy with a realistic interface fragment or lightweight CSS diagram derived from actual product concepts. An availability legend uses `Available now`, `In development`, and `Direction` only where necessary.

## Product visuals and brand assets

Use the approved assets introduced by commit `40a4ce9`:

- `public/brand/axiom-orbit-primary-transparent.png`;
- `public/brand/axiom-orbit-icon-chrome-transparent.png`;
- approved favicon/app-icon sizes;
- `public/brand/axiom-orbit-social-1200x630.png` for social sharing.

Product surfaces will reuse the real language and interaction anatomy visible in the existing clients, opportunities, monitoring, services, and onboarding UI. They may use deterministic display data solely to explain the interface, but must not be presented as customer proof or measured business outcomes.

## Metadata and discovery

Both routes define a useful title and description. The canonical origin is `https://orbit.getaxiom.ca`, producing canonical URLs for `/` and `/product`. Open Graph and Twitter metadata use the approved 1200×630 social asset and do not include unsupported claims.

Semantic landmarks, one H1 per page, logical heading order, descriptive links, and crawlable copy are required.

## Accessibility and responsive behavior

- Keyboard-visible focus treatment on every link and control.
- Mobile navigation uses a real button with `aria-expanded`, a named target, Escape handling, and sensible focus behavior.
- Touch targets are at least 40px where space permits.
- Decorative imagery has empty alternative text; brand images have appropriate accessible names through their containing links.
- Contrast meets WCAG AA for essential text and controls.
- No content or interaction depends on animation.

Responsive acceptance viewports are 1440, 1024, 768, and 390 pixels wide. Hero composition, diagrams, product mockups, navigation, CTAs, long labels, sticky behavior, and overflow must be inspected at each width.

## Testing and verification

Implementation follows focused RED/GREEN coverage for route registration, metadata, navigation destinations, CTA destinations, availability language, and key semantic structure where the repository test harness supports it.

Final verification includes:

- rendered browser inspection of `/` and `/product`;
- all public navigation and CTA paths;
- console errors;
- keyboard navigation and visible focus;
- 1440, 1024, 768, and 390 responsive screenshots;
- reduced-motion behavior and horizontal overflow;
- comparison of implemented branding and product surfaces against the approved assets and current application;
- `pnpm bench`, reading the report rather than treating exit zero as trust acceptance;
- `pnpm verify`;
- focused marketing tests;
- `git diff --check`.

The known adversarial benchmark weakness remains diagnostic and must not be represented as resolved by this work.

## Git and parallel-work boundary

Implementation occurs on `codex/axiom-orbit-marketing` in an isolated worktree rooted at `40a4ce9`. Claude's ongoing uncommitted tour and product UI work in the main checkout is outside scope.

Before final integration and PR creation:

1. fetch and inspect the latest `main` and Claude activity;
2. incorporate canonical branding/UI primitives conservatively;
3. resolve shared-file conflicts without overwriting newer product work;
4. stage only the marketing slice;
5. commit, push, and open a PR;
6. do not merge or deploy.

## Acceptance

The result is ready for review when an agency owner can understand within seconds what Orbit is, how it may create revenue from existing accounts, why evidence and continuous monitoring matter, and how to request access—without encountering a fabricated claim, broken route, inaccessible control, responsive defect, or visible conflict with the real product identity.
