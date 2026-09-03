# Design QA — Client Growth Signal Desk

## Evidence

- Source visual truth: `docs/design/client-growth-signal-desk-concept.png`
- Rendered implementation: `C:/Users/aidan/.codex/visualizations/2026/09/03/01a06527-0fed-7f50-a5ac-223d139a4338/client-growth-final/signal-desk-light-1440.png`
- Additional states: `signal-desk-dark-1440.png`, `signal-desk-inspector-light-390.png`, `clients-light-1440.png` in the same final evidence directory
- Intended CSS viewport: 1440 × 1024 at device scale 1
- Source pixels: 1487 × 1058; implementation pixels: 1425 × 1013 (the in-app browser's content viewport after scrollbar/browser framing)
- Normalization: both images were inspected together at their full, near-identical 1.405–1.407 aspect ratios. No density scaling was required.
- State: signed-in seeded Cobalt QA workspace, Opportunities route, Blue Peak HVAC heat-pump finding selected, explicit Light theme

## Full-view comparison

The implementation preserves the selected direction's core composition: a narrow navy workspace rail, light operational canvas, compact opportunity queue, blue selected row, and persistent evidence inspector with a fixed primary action. It intentionally omits speculative mock-only routes and billing UI so the shipped navigation stays aligned with the existing product contracts.

The implementation is slightly denser than the concept and moves account/service context into each row's secondary line. This keeps all seven real seeded opportunities above the fold while preserving the same hierarchy. The inspector retains the concept's value, strength, evidence, mapped service, rationale, and proposal action.

## Focused region comparison

The queue and inspector were readable at full-view resolution, so separate crops were not required. Focused interaction inspection covered the selected-row state, value and confidence columns, status pills, evidence links, inspector scrolling, fixed proposal action, workspace account menu, and theme selector.

## Required fidelity surfaces

- Fonts and typography: the implementation uses Inter/Segoe UI system fallbacks consistently, with a strong 26 px page title, 13 px scannable queue labels, tabular numeric values, and uppercase 9–11 px operational labels. Weight and line-height remain readable in both themes.
- Spacing and layout rhythm: rail, queue, and inspector proportions match the source direction. Rows use an 86 px desktop rhythm, quiet 1 px dividers, 8–10 px radii, and restrained elevation. The 1024 layout collapses to compact navigation and defers the inspector until selection; 768 and 390 remain overflow-free.
- Colors and visual tokens: light uses navy/cobalt/white/cool-grey tokens; dark uses a purpose-built navy surface hierarchy rather than simple inversion. Green, amber, red, selected, focus, and disabled states retain semantic contrast.
- Image quality and asset fidelity: the target is a product UI with no required photographic or illustrative assets. The existing icon family is used throughout; there are no placeholder images, CSS illustrations, emojis, or handcrafted replacement assets.
- Copy and content: all visible copy is grounded in actual client, service, opportunity, monitoring, and proposal data. Speculative Signal Desk, Monitoring, Reports, plan, and billing routes from the concept were not introduced.
- Icons: the existing single-stroke icon set is consistently sized at 13–18 px and aligned with nav, evidence, actions, and status surfaces.
- States and interactions: opportunity selection, confidence filters, client scope, inspector close, add/edit drawers, navigation, theme selection, and proposal route links were exercised. Theme choice supports Light, Dark, and System and persists through storage/cookie fallback.
- Accessibility: semantic links/buttons, current states, labelled menus/dialogs, focus rings, reduced-motion handling, 44 px mobile controls, and document-level overflow checks are present.

## Findings

No actionable P0, P1, or P2 differences remain.

- [P3] The concept shows row-level timestamps and overflow menus that are not backed by current product actions. These were intentionally omitted rather than inventing semantics.
- [P3] The implementation uses the existing Client Growth icon family instead of the concept's illustrative avatars. This keeps the shipped visual language coherent and avoids fake identity assets.

## Comparison history

1. Earlier P2 — the desktop inspector's proposal action initially fell below the first viewport because the inspector used the full viewport height after a 132 px page header. Fixed by sizing the desktop inspector to `calc(100vh - 132px)` and separating its scroll region from the action footer. Post-fix evidence: `signal-desk-light-1440.png` shows the action pinned and visible.
2. Earlier P2 — at 1024 px the desktop rail and inspector compressed the queue enough to truncate its decision columns. Fixed by moving the compact app bar and off-canvas inspector breakpoint to 1100 px. Post-fix browser evidence recorded zero document overflow and a full-width queue at 1024 px.
3. User-requested enhancement — added explicit Light, Dark, and System themes, verified by keyboard selection and separate final captures. This was an additive product requirement, not a source-fidelity correction.

## Implementation checklist

- [x] Preserve real product routes and backend semantics
- [x] Keep Opportunities as the primary operational workspace
- [x] Make selected evidence and next action persistent and visible
- [x] Reframe Clients as managed accounts and Services as a commercial catalog
- [x] Provide Light, Dark, and System workspace themes
- [x] Verify desktop, tablet, and mobile responsive states
- [x] Verify no document-level horizontal overflow
- [x] Run deterministic tests, benchmark, release gate, and diff checks before handoff

## Follow-up polish

- P3: if row-level collaboration actions are added later, the final column can adopt a real overflow menu without changing the queue architecture.

final result: passed
