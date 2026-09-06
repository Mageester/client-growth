# Axiom Orbit Product Polish Design

**Date:** 2026-09-06  
**Status:** Approved direction; implementation pending  
**Product:** Axiom Orbit

## Objective

Polish the complete customer-facing journey so an agency understands the product, reaches its first evidence-backed result quickly, and can turn that result into a credible client conversation. Preserve Orbit's current near-black editorial visual system, evidence-first product contract, tenant boundaries, and human-review model.

The work is successful when the product feels like one deliberate workflow rather than a collection of individually polished screens:

1. A prospect understands what Orbit does and can take an unambiguous access action.
2. A new user supplies the minimum information needed before Orbit demonstrates value.
3. A returning user can identify the highest-value next action without decoding internal terminology.
4. A shared proposal reads as a client-ready recommendation with a clear next step.

## Product principles

- Evidence remains more prominent than confidence scores or revenue estimates.
- Potential value is never presented as booked revenue, a forecast, or a guarantee.
- Inconclusive reads remain visibly distinct from clean sites.
- Nothing is sent to a client automatically.
- No new billing, CRM, notification, contracting, or analytics subsystem is introduced.
- Existing brand assets, Space Grotesk typography, near-black canvas, and pure-neutral palette remain authoritative.
- Progressive disclosure replaces long configuration walls; it does not silently invent agency services or prices.
- Every state must remain understandable at desktop and narrow mobile widths without clipped labels or horizontal scrolling.

## Slice 1: Marketing and account entry

### Problem

The live marketing story describes an older product. It says Orbit has three detection categories and that proposal drafts remain inside the app even though the current release includes additional deterministic checks and expiring proposal-share links. The primary call to action says "Request access" but opens a full account-creation form that also says the product is invitation-only.

### Design

- Describe the current product in capability families rather than a brittle rule count: commercial gaps, conversion failures, technical content issues, evidence review, proposal drafting and sharing, and opt-in monitoring.
- Replace obsolete "draft stays in Orbit" copy with the truthful boundary: users review and save the draft, then deliberately create an expiring share link; Orbit never sends it automatically.
- Keep future outcome tracking labelled as direction.
- Use one access model consistently. When public signup is disabled, public calls to action become "Request pilot access" and lead to a request-access explanation instead of presenting a misleading self-serve creation path. Invitation links still lead invited users into account creation.
- Preserve the restrained hero and illustrative-product labeling. Bring the existing proof closer to the first viewport rather than adding decorative imagery.

## Slice 2: First-client activation

### Problem

The setup route asks a new user to review twelve enabled service categories, rename each service, and set two prices for each before the first client can be read. The product's strongest proof—the site read and evidence-backed offering confirmation—arrives only after this configuration wall.

### Design

- The first screen asks only for agency name when needed, client name, and website.
- Starter services are created from the existing conservative defaults without requiring line-by-line editing before the crawl. The screen clearly states that these editable defaults will be used to price early findings and can be reviewed before analysis.
- A compact collapsed summary shows how many starter services and price ranges will be added. "Review starter pricing" expands the existing editor for users who need control immediately.
- The primary action remains "Read the site" and remains a crawl-only action. Nothing is analyzed or permanently added beyond the existing confirmed workflow.
- The confirmation stage continues to show each inferred offering, evidence source, default selection, and an explicit manual-add field.
- Copy should make the sequence concrete: read the public site, confirm what the client sells, then analyze for gaps.
- Unreadable, partial, loading, and validation states must retain the existing honesty guarantees and offer a specific recovery action.

## Slice 3: Returning workflow and proposal handoff

### Opportunity queue

- Make the recommended next action apparent from each row, especially when a proposal is ready.
- Keep potential value and client identity scannable, but replace unexplained confidence dominance with a plain-language evidence-strength label alongside the percentage.
- Prevent client, opportunity, and service names from collapsing into ambiguous ellipses at supported widths. Two-line wrapping is preferable to hiding identity.
- Explain ordering in one concise sentence: billable fit first, then evidence strength and recency.
- Empty, filtered-empty, unreadable, and loading states each explain what happened and what the user can do next.

### Opportunity detail

- Keep the existing overview, evidence, recommendation, and activity structure.
- Move a concise evidence summary into the first viewport so the core claim can be evaluated before a proposal is created.
- Keep source URLs and observed facts visibly tied to the selected client. Test fixtures must never mix client identities or domains.
- Give the main action one contextual label: "Prepare client proposal" for open findings and "Review proposal" once a draft exists.
- Keep covered, snooze, sold, and dismiss decisions visually secondary and grouped as disposition controls.

### Shared proposal

- Preserve the immutable snapshot, agency branding, prepared-by identity, recommended work, investment range, scope, and evidence.
- Add a small "Next step" section derived from proposal copy or a neutral default invitation to contact the preparing agency. This is presentation only: no acceptance, signature, payment, or message-sending feature is introduced.
- Make the agency identity and client identity unmistakable. Display a logo when configured; otherwise use the agency name without an empty placeholder.
- Explain that the range is an estimate and that the agency will confirm scope before work starts.
- Improve print and narrow-width layout so the share can be used in a client meeting or saved through the browser's native print flow.

## Accessibility and responsive requirements

- Meet WCAG AA contrast for normal text and interactive states within the existing palette.
- All controls retain visible keyboard focus and meaningful accessible names.
- Do not communicate evidence strength, selection, error, or status by color alone.
- Respect `prefers-reduced-motion`; hero and route transitions must not begin with essential content effectively invisible for reduced-motion users.
- Interactive targets remain at least 44 by 44 CSS pixels where layout permits.
- Validate at approximately 1440px desktop and 390px mobile widths.
- Navigation, tables, service editors, fact bars, and proposal sections must reflow without horizontal page scrolling.

## Technical boundaries

- Reuse current React Router route actions, repositories, schemas, and server contracts.
- Prefer copy, layout, component, and progressive-disclosure changes over new persistence.
- Do not change crawler, evaluator, pricing semantics, monitoring admission, authentication cryptography, tenant scoping, or production bindings.
- Do not add runtime dependencies.
- Preserve exact Node `24.x`, pnpm `10.12.1`, local-only deterministic `pnpm verify`, and tracked-file secret scanning.
- Production deployment and production data mutation are out of scope.

## Test and acceptance strategy

- Follow RED/GREEN for every behavior change. New tests must fail for the intended missing behavior before production code changes.
- Add route/component assertions for current marketing claims, access-policy copy and links, collapsed starter-service defaults, contextual opportunity actions, proposal next-step framing, and mixed-client fixture prevention.
- Run focused tests for each slice before integration.
- Rebuild the current design harness and inspect all affected screens at desktop and mobile widths.
- Exercise at least one meaningful interaction per affected flow in a hydrated local app when the interaction depends on client JavaScript.
- Final verification is `pnpm verify` plus `git diff --check` and a clean browser-console check for the inspected routes.

## Agent ownership

- **Marketing/account-entry agent:** `app/routes/_index.tsx`, `app/routes/product.tsx`, `app/routes/signup.tsx`, marketing/auth-specific tests, and `app/styles/marketing.css`.
- **Activation agent:** `app/routes/onboarding.tsx`, onboarding-specific tests, and onboarding-only selectors in `app/styles/orbit-approved.css`.
- **Returning-workflow agent:** `app/routes/opportunities._index.tsx`, `app/routes/opportunities.$id.tsx`, `app/routes/proposal.share.tsx`, `app/components/signal-desk.tsx`, their focused tests, and `app/styles/signal-desk.css`.
- **Primary agent:** shared primitives and `app/styles/app.css`, fixture consistency, integration conflict resolution, full verification, and rendered QA.

Agents must not edit files owned by another slice or revert existing work. Cross-slice needs are reported to the primary agent for integration.

## Explicit non-goals

- Billing, trials, subscriptions, or pricing-page implementation
- Proposal acceptance, signatures, payments, or outbound email
- CRM integrations or automated outreach
- New analysis rules or crawler reach work
- Production deployment
- Broad component-library or routing refactors
