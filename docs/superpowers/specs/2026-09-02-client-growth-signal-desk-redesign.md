# Client Growth Signal Desk Redesign

## Product outcome

Client Growth should feel like the post-sale revenue operating system for a small agency. The primary workspace answers, in order: what changed, which client needs attention, what work may be sellable, what evidence supports it, what it may be worth, and what the user should do next.

This is a UI-only redesign. It does not change crawler semantics, evaluator judgment, opportunity rules, tenancy, authentication, monitoring scheduling, database behavior, migrations, evidence rules, or proposal semantics.

## Accepted visual target

The selected reference is [client-growth-signal-desk-concept.png](../../design/client-growth-signal-desk-concept.png).

The reference establishes:

- a deep navy application rail;
- a light, cool-neutral work surface;
- cobalt blue as the primary action and selection color;
- a compact opportunity queue with aligned account, value, and evidence-strength information;
- a persistent evidence/action inspector on wide screens;
- restrained borders, nearly flat elevation, and high information density;
- contemporary sans-serif typography with compact operational labels.

The following elements in the generated reference are explicitly out of scope because the product does not implement them: Reports navigation, a standalone Monitoring route, subscription/plan controls, and billing UI. Existing Settings remains reachable from the workspace account area.

## Information architecture

### Global application shell

Desktop uses a 204px persistent navy rail containing the brand, primary navigation (Opportunities, Clients, Services), and workspace/account access. The main work surface occupies the remaining width. Settings stays in the workspace menu/footer rather than becoming a speculative top-level product area.

Tablet and mobile replace the rail with a compact top application bar and horizontally stable primary navigation. No primary route may disappear behind an unlabeled icon-only control.

### Opportunities

Opportunities is the default and primary work surface. On wide screens it has two product zones inside the global shell:

1. A prioritized signal queue with client scope, Open/Strongest/All filters, analysis action, and aligned opportunity rows.
2. A selected-opportunity inspector with value, evidence strength, mapped service, rationale, evidence sources, and the next action.

Rows use existing opportunity state. `new` open work has the strongest visual emphasis, `proposal_prepared` is distinct but still active, and dismissed/snoozed/covered work recedes into history. Inconclusive analysis is never styled as clean.

The queue-to-inspector selection is client-side and encoded in the URL search parameters so browser navigation remains predictable. The full evidence/proposal route remains the authoritative detail workflow.

On screens below 1024px, the inspector becomes an off-canvas drawer opened from a queue row. On mobile, queue rows collapse into a compact account/title/value/evidence layout and long rationale text is reserved for the inspector.

### Clients

The Clients index is a managed-account portfolio rather than a contacts list. Each row shows account name/domain, monitoring state, last check, current opportunities, potential value, and analysis limitation where relevant.

Client detail is one account workspace with four visible regions rather than many tabs:

- account summary and primary actions;
- monitoring status and analysis limitations;
- active opportunities;
- commercial context: contract coverage, what the client sells, suggested offerings, and analysis history.

Existing edit, analyze, coverage, offering-suggestion, and monitoring actions remain unchanged.

### Services

Services is a sellable catalog. Each row leads with the service and client outcome, followed by finding mappings, price range, active state, and edit action. Creation and editing remain in the existing accessible drawer.

### Opportunity detail and proposal

The detail route remains the deeper review surface. It uses a readable evidence column and a sticky decision/proposal rail on wide screens. The proposal draft remains editable and retains every existing action and submission semantic.

### Settings, onboarding, and auth

Settings uses compact grouped rows and clearer monitoring language. Onboarding uses the same typography, fields, and service-catalog language as the application. Auth screens use a focused two-column brand/workspace composition on desktop and a single-column form on mobile. No auth behavior changes.

## Design system

### Color

- Rail: `#071a33`
- Rail elevated/selected: `#0f2f5b` / `#1265e8`
- Canvas: `#f5f7fa`
- Surface: `#ffffff`
- Strong text: `#152033`
- Muted text: `#667085`
- Divider: `#dfe4ea`
- Primary: `#1265e8`
- Primary hover: `#0d52bf`
- Positive: `#14835f`
- Attention: `#b66a07`
- Negative: `#c53b32`
- Inconclusive: `#687386`

The application uses a fixed light work canvas instead of following system dark mode; the dark rail supplies the high-contrast brand frame.

### Typography

- UI family: Inter with system sans-serif fallback.
- Body: 14-16px, 1.45-1.6 line height.
- Page title: 28-32px, 700 weight.
- Section title: 16-18px, 650-700 weight.
- Operational labels: 11-12px, 600 weight, restrained uppercase tracking.
- Numeric/value text uses tabular numerals; no decorative serif headings.

### Surfaces and spacing

- 4px base spacing unit with 8/12/16/20/24/32px rhythm.
- 8px default control radius, 10px panel radius, pills only for statuses.
- Borders and surface tint separate content before shadows.
- Drawers use one elevation and a scrim; ordinary rows stay flat.

### Icons

Use the existing consistent outline icon component throughout this pass. Do not add emoji, text glyphs, decorative illustrations, or new raster assets.

## Interaction and accessibility

- Preserve semantic landmarks, headings, lists, forms, labels, and skip link.
- Every icon-only action has an accessible name.
- Visible focus uses a 2px cobalt ring with offset.
- Row selection uses both border/surface treatment and `aria-current` or `aria-selected` semantics where appropriate.
- Minimum target height is 40px on desktop and 44px on touch breakpoints.
- Drawers trap focus, close on Escape, restore focus, and prevent background scrolling through the existing `SidePanel` behavior.
- Loading, success, validation, and failure messages retain live-region semantics.
- Motion is limited to short state transitions and disabled under `prefers-reduced-motion`.

## Responsive behavior

- `>= 1280px`: full rail, queue, and 390-420px inspector.
- `1024-1279px`: rail narrows slightly; inspector remains visible when space allows and otherwise becomes an overlay.
- `768-1023px`: top navigation replaces rail; queue is full width; inspector is an overlay drawer.
- `< 640px`: compact header, two-line opportunity rows, 2x2 summary grids, full-width primary actions, bottom-safe drawers, no horizontal page overflow.

## Acceptance

- The live app is visually coherent at 1440, 1024, 768, and 390 widths.
- Opportunities supports queue selection, filtering, client scoping, analysis, inspector review, and navigation to full evidence.
- Clients, account detail, Services, Settings, onboarding, proposal, and auth states use the same design system.
- New/open/history/inconclusive states are visually distinct without implying unsupported facts.
- Console has no relevant errors and the page has no horizontal overflow at required breakpoints.
- `pnpm bench`, `pnpm verify`, and `git diff --check` complete with their existing semantics unchanged.
- Design QA compares the 1440 Opportunities implementation to the accepted visual target and records intentional deviations.
