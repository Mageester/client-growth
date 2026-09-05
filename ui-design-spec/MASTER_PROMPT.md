# Axiom Orbit / Client Growth — Premium UI Redesign Master Prompt

You are the senior product designer and senior frontend engineer responsible for a complete redesign of the existing Client Growth / Axiom Orbit application.

This repository already contains working product logic. Your job is **not** to invent a different product and **not** to rewrite the backend. Your job is to transform the existing frontend into a highly refined, minimal, premium product while preserving real functionality and data flow.

## Visual source of truth

A visual reference pack is attached. Treat these files as the approved design direction:

- `images/00_overview_approved_direction.png` — global design language and page family
- `images/01_home.png` — Home
- `images/02_clients.png` — Clients
- `images/03_opportunities.png` — Opportunities
- `images/04_opportunity_detail.png` — Opportunity detail
- `images/05_settings_services.png` — Settings / Services

The screenshots are the source of truth for **visual language, hierarchy, spacing, density, navigation, typography mood, surfaces, row anatomy, interaction model, and restraint**.

Do **not** treat sample names, amounts, dates, counts, labels, or fake screenshot data as authoritative. Use the application's real domain models and real data. If screenshot content conflicts with working product behavior, preserve the real behavior while keeping the visual structure.

## Non-negotiable product feeling

The final app must feel:

- extremely refined
- extremely minimal
- premium and expensive
- calm
- elegant
- fast
- obvious to understand
- deeply polished without being flashy
- modern without looking trendy or generic

The quality bar is closer to **Linear / Attio / Apple-level restraint and interaction polish** than a typical SaaS dashboard.

This must **not** look like:

- a generic admin dashboard
- a component-library demo
- a card grid
- a monitoring console
- a developer tool
- an AI-generated SaaS template
- a Dribbble concept that is impractical to use
- a cyberpunk/neon UI
- a dashboard full of charts and KPIs

The app should feel as though **almost nothing is present until the user needs it**.

## Core UX principle

The product exists to help agencies find valuable work inside their existing client portfolio.

The hierarchy should communicate:

**Client → Opportunity → Evidence → Action**

not:

**Scanner → Technical finding → System status**

Technical details still matter, but they should usually be secondary and progressively disclosed.

A user should understand the purpose of a screen in roughly 3 seconds.

One obvious primary action per screen.

## Information architecture

The preferred top-level shell is intentionally small:

- Home
- Clients
- Opportunities
- Settings

Secondary systems such as services, integrations, workspace configuration, analysis/check health, billing, and team management should live naturally beneath Settings or the relevant entity rather than competing as permanent top-level destinations.

Do not add new top-level navigation without a strong functional reason.

## Visual system

### Layout

- Narrow, quiet persistent sidebar on desktop.
- Main content gets the visual emphasis.
- Generous horizontal breathing room.
- Prefer open composition, rows, lists, dividers, and whitespace over nested cards.
- Use bordered panels only where a contained surface genuinely improves comprehension.
- Avoid giant rounded wrappers around everything.
- Avoid bento layouts.
- Avoid decorative metric walls.

### Color

Use a sophisticated charcoal/blue-black dark theme rather than pure black everywhere.

Approximate direction only — derive final tokens from the references:

- app background: near `#0A0F15`
- sidebar/background depth: near `#0B1118`
- subtle raised surface: near `#111923`
- primary text: near `#F5F7FA`
- secondary text: cool muted gray-blue
- hairline borders: white at very low opacity
- primary accent: restrained ice/sky blue
- semantic green/amber/red only when status actually requires it

Accent color should be sparse. Most of the product should remain neutral.

No rainbow of status colors. No gradients everywhere. No glow effects.

### Typography

Typography and spacing should carry most of the design.

- clean sans-serif system with excellent legibility
- large, confident page titles
- restrained weights
- muted supporting text
- uppercase micro-labels only where shown in the references
- deliberate line-height and tracking
- controls must have intentionally specified typography; never rely on browser defaults

Avoid oversized marketing-style typography inside the app.

### Borders and elevation

- hairline borders
- extremely subtle elevation
- shadows should be nearly invisible and only communicate layering
- avoid thick outlines
- avoid noisy separators

### Radius

Use restrained, consistent radii. Rounded does not mean pill-shaped.

Do not turn every control, label, or status into a pill.

## Page behavior

### Home

Home is not a dashboard.

It should calmly answer:

**What deserves my attention?**

Keep the page sparse. Prioritize a handful of meaningful items, followed by a very small portfolio summary. No analytics wall. No donut chart. No decorative graph collection.

### Clients

Clients should feel like the foundation of the product.

Use a clean, highly scannable list/table hybrid. A user should immediately understand:

- client identity
- opportunities
- potential value
- status
- last checked

Rows should feel spacious and premium, not like a dense database spreadsheet.

### Opportunities

The opportunity list should feel close to a refined issue/work queue.

Make it easy to scan:

- opportunity
- client
- value
- confidence
- age/status

Do not expose every available attribute at once.

Selection/hover should be clear but subtle.

### Opportunity detail

This is a focused workspace, not a giant side panel.

The user should immediately understand:

- what the opportunity is
- which client it belongs to
- potential value
- confidence
- recommended service
- why it matters
- evidence
- next action

Use progressive disclosure for evidence, recommendations, and activity.

Primary action should be visually obvious without dominating the entire screen.

### Settings / Services

Settings should feel structured and quiet.

Use a secondary settings navigation rather than dumping all configuration into the primary sidebar.

Services should read as a simple catalog of what the agency can sell, not an admin database.

## Motion and interaction system

Motion is a major part of the perceived quality. It must feel **expensive and quiet**, never flashy.

Use animation to explain state and improve orientation.

### Timing

Typical interactions:

- hover feedback: 100–140ms
- buttons / selection: 120–180ms
- tabs / filters / small layout changes: 160–200ms
- route/content transitions: 160–220ms
- drawers/dialogs/large reveal surfaces: 200–260ms

Use smooth ease-out curves. Avoid elastic or bouncy spring behavior for ordinary UI.

### Recommended motion behaviors

- page content: subtle fade + 3–6px vertical translation on route entry
- sidebar selection: smoothly interpolated selection background/indicator
- rows: gentle surface tint on hover; chevron can shift 2–3px
- buttons: subtle background/border response; no scaling gimmick
- tabs: animated underline/selection indicator
- filters: crossfade/layout interpolation rather than hard popping
- number/status updates: short crossfade or restrained count transition
- loading: elegant skeletons; avoid prominent spinners except where genuinely necessary
- detail surfaces: smooth fade/translate or shared-layout transition when practical
- dialogs/drawers: fade + small transform, fast and controlled
- expanding content: animate height/opacity without layout jank

Do not animate everything merely because animation is possible.

### Performance requirements for animation

- favor opacity and transforms
- avoid layout-thrashing animation patterns
- keep scrolling at 60fps
- do not use huge blur/backdrop-filter effects that hurt performance
- no continuous decorative animations on normal screens
- respect `prefers-reduced-motion`

If this is React, use the existing animation solution if one is present. If none exists and adding a dependency is appropriate, a lightweight modern motion library is acceptable. Do not add a large dependency solely for trivial hover transitions.

## Engineering constraints

1. Inspect the repository before changing anything.
2. Preserve backend/domain behavior and existing data contracts.
3. Do not replace functional UI with static screenshots.
4. Do not hard-code mock screenshot data into production code.
5. Reuse existing frontend architecture when it is healthy.
6. Refactor frontend structure only where it materially improves consistency or implementation quality.
7. Build a small coherent design system rather than one-off styling each page.
8. Avoid giant components.
9. Avoid duplicated CSS and duplicated interaction logic.
10. Maintain accessibility: keyboard navigation, visible focus, semantic controls, adequate contrast, reduced motion.
11. Preserve responsive behavior and improve it if needed.
12. Do not add features that were not requested merely to fill space.

If the repo is React/Next.js, follow strong React performance practices: parallelize independent data work, avoid unnecessary client rendering, control bundle size, minimize re-renders, avoid defining components inside components, and keep animation from causing unnecessary render churn.

## Implementation workflow — follow this sequence

### Phase 0 — inspect

Before implementation, inspect:

- framework and routing
- page structure
- shared layout
- component library
- styling approach
- current design tokens
- state management
- API/data layer
- existing animation dependencies
- responsive behavior
- current tests

Write a short implementation map before changing the UI.

### Phase 1 — extract the design system

Create/normalize:

- background/surface tokens
- text hierarchy
- borders
- accent/semantic colors
- spacing scale
- typography scale
- radii
- button/input variants
- row/list variants
- sidebar/navigation primitives
- focus states
- motion durations/easing

Do not start by independently styling five pages.

### Phase 2 — app shell

Implement and verify:

- sidebar
- main content frame
- page title pattern
- navigation transitions
- responsive shell
- base buttons/inputs/selects

Take a browser screenshot and compare it to the references before moving on.

### Phase 3 — Home

Implement Home faithfully to `01_home.png` and the approved overview.

Verify visual fidelity before proceeding.

### Phase 4 — Clients

Implement Clients faithfully to `02_clients.png`.

Verify visual fidelity before proceeding.

### Phase 5 — Opportunities

Implement Opportunities faithfully to `03_opportunities.png`.

Verify filtering/search/selection states as applicable.

### Phase 6 — Opportunity detail

Implement the detail experience faithfully to `04_opportunity_detail.png`.

Preserve the actual product's evidence and action workflows.

### Phase 7 — Settings / Services

Implement the quieter secondary information architecture from `05_settings_services.png`.

Move secondary items only when the real application supports doing so safely.

### Phase 8 — remaining states

Extend the same system to any existing screens not explicitly shown:

- client detail
- add/edit flows
- loading
- empty states
- errors
- analysis/check failures
- confirmation dialogs
- responsive/mobile

Do not invent a different design language for missing screens.

### Phase 9 — premium polish pass

Audit the entire product for:

- spacing consistency
- typography consistency
- border density
- icon consistency
- hover/focus behavior
- motion consistency
- alignment
- loading states
- empty states
- responsive collapse
- keyboard use
- reduced motion
- awkward copy wrapping
- jitter/layout shift

Remove anything that feels decorative, generic, or excessive.

## Mandatory visual QA loop

A successful build is not enough.

After every major page:

1. run the app
2. render the target page in a desktop viewport close to the reference aspect ratio (the page references are approximately 1586×992)
3. capture a screenshot
4. compare the screenshot side-by-side with the corresponding reference
5. create a short mismatch list
6. fix mismatches
7. repeat until the page would pass a serious design review

Compare at minimum:

- overall composition
- sidebar width
- content width and gutters
- type scale and weight
- row height
- spacing rhythm
- border visibility
- surface colors
- accent usage
- icon size/stroke
- control sizing
- hover/selected states
- empty space
- visual density

Then verify one mobile-sized viewport and at least one narrower desktop/laptop viewport.

Do not claim completion based only on tests or build output.

## Anti-patterns — explicitly prohibited

Do not:

- add a dashboard grid of cards
- add charts because there is empty space
- add large gradient blobs
- add glows
- add glassmorphism everywhere
- add excessive backdrop blur
- add decorative badges/pills
- use multiple competing accent colors
- fill whitespace merely to make the app look busy
- use large animated hero sections inside the app
- convert list/table screens into card grids
- add floating action widgets
- invent new metrics
- make technical scanner health a primary visual focus
- overuse tooltips to compensate for unclear design
- use slow or theatrical animation
- add fake data to make screenshots look better

## Completion standard

The redesign is complete only when:

- the product still works
- all important current workflows remain available
- the app visibly belongs to the same design family as the references
- the implementation feels calm and premium at normal desktop size
- animation feels natural and never gets in the way
- interactions are immediately understandable
- desktop and mobile are both polished
- there are no obvious visual inconsistencies between pages
- there are no generic template-looking sections
- the browser screenshots are close enough to the references that a high-end product design review would approve them

Do not stop at “looks better than before.”

The goal is **exceptionally refined**.
