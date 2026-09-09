# Axiom Orbit Astra Audit Remediation Design

**Date:** 2026-09-09

**Authority:** `ASTRA_PRODUCT_AUDIT.md` and its evidence bundle under
`docs/audit-evidence/2026-09-09/` define the observed defects. This design
turns every repository-fixable finding into one coherent implementation while
preserving the audit's evidence and commercial-honesty boundaries.

## Goal

Make Axiom Orbit safe to offer as a narrowly scoped, assisted agency portfolio
review by repairing acquisition, analysis admission, document management,
disclosure, monitoring, operations, return navigation, and the most damaging
clarity/responsive defects found by the Astra audit.

The implementation must not claim that code changes prove willingness to pay,
production AI quality, live email delivery, PDF quality, accessibility
certification, or recurring commercial value.

## Product Position and Scope

Orbit's primary loop is:

`choose client -> review evidence -> reject covered or irrelevant work -> confirm a recommendation and price -> create and retrieve a client artifact -> record the decision -> verify later changes`

The initial commercial offer is a **14-day assisted review of up to ten client
sites**. The product does not publish a price until Axiom confirms that the
human effort fits the price. Pilot requests use an Axiom-controlled
`mailto:hello@getaxiom.ca` action with the subject `Axiom Orbit agency pilot
request` and copy promising a reply within two business days. This keeps
invite-only admission intact and avoids adding a lead database, public write
endpoint, spam surface, or billing system.

Monitoring remains an operator-enabled option for enrolled workspaces. The
locked screen uses the same pilot-contact action and explains that Axiom
enables weekly client rechecks and an optional digest after agreeing scope.
Orbit does not claim scheduled competitor-change detection: competitor
comparison remains a separate, user-initiated workflow.

## Global Invariants

- AI proposes; a human confirms. Candidate generation never proves commercial
  relevance, billability, delivery, or revenue.
- Unreadable, incomplete, coverage-limited, readable-with-no-service-pages,
  and completed-with-no-opportunity remain distinct states.
- Analysis may run when at least one catalog-backed rule is ready. A limited
  rule suppresses only itself; it does not block independent eligible rules.
- Missing authoritative provider, delivery, cost, or commercial evidence is
  reported as unknown, never zero or implicitly successful.
- Tenant scope, composite foreign keys, hashed share tokens, share expiry,
  invitation-only access, rate limits, and safe return-target sanitization are
  preserved.
- Exact Node `24.x`, pnpm `10.12.1`, deterministic local `pnpm verify`,
  migration/foreign-key gates, and tracked-file-only secret scanning remain
  unchanged.
- No production deployment, provider call, email send, entitlement opening,
  or customer-data mutation is part of this repository implementation.
- Do not build a CRM, billing automation, automatic outreach, scheduled
  competitor crawling, asset manager, reporting design studio, new rule
  family, microservice split, or broad analytics expansion.

## 1. Authoritative Analysis Admission

`assessAnalysisReadiness` becomes the single admission authority used by
onboarding, client detail loaders, client action handlers, and analyze-button
state. Admission is allowed when `readyCount > 0`; catalog coverage must still
match at least one rule.

The client action recomputes readiness from the latest stored evidence and
current catalog before starting a run. It no longer rejects the entire run on
`assessServiceCoverage(...).analyzable === false`. The engine retains its
per-rule fail-closed behavior, so unreadable, JS-shell, blocked, or incomplete
evidence cannot create unsupported absence claims.

User-facing status derives from the same readiness result:

- zero readable pages: the site could not be read;
- incomplete/coverage-limited evidence: only checks supported by available
  evidence can run;
- exhaustive readable site with no service pages: Orbit read the site and can
  check whether a service-page project is appropriate;
- no ready catalog-backed rules: explain the exact setup action;
- ready rules: show how many checks can run, without promising a finding.

Route-level regression coverage must pass the saved readable/no-service-pages
fixture through actual admission and analysis orchestration. Negative fixtures
must prove that unreadable, incomplete, and JS-shell evidence still fail closed
for absence rules.

## 2. Durable Client Reports and Shares

The report repository adds tenant-scoped projections for:

- saved report summaries by client, newest first;
- active share count and nearest expiry for a report;
- active share identifiers suitable for owner-only revocation.

No raw historical share token is persisted or recovered. The private report
loader returns persistent share metadata on every visit. Revocation controls
render from that metadata, not from transient POST `actionData`. Creating a
new link is explicitly labelled as a new/replacement link.

Client detail displays a compact Saved reports section with generation date,
content summary, private preview link, and active-share state. `Create report`
remains available and opens a new builder; it is no longer the only report
path.

Required lifecycle acceptance is:

`create -> share -> private reload -> leave -> reopen from client -> revoke -> anonymous 404`

The test also confirms owner-only management, tenant isolation, token hashing,
expiry, and no token disclosure from loaders.

## 3. Acquisition, Disclosure, and Monitoring Truth

The closed signup page contains a primary `Request an agency pilot` mail link,
the assisted-review scope, qualifying audience, and two-business-day response
expectation. Public home/product CTAs still route through `/signup`, so visitors
first see access policy and then a real action. The email is prefilled with
agency name, site count, current review process, and desired outcome prompts.

The privacy page inventories outbound handling by feature:

- candidate evaluation: client name, domain, candidate subject, and bounded
  supporting evidence required for evaluation;
- catalog assistant: agency-written summary plus bounded public-page URL,
  title, headings, and excerpts;
- account email: address and account/recovery content;
- monitoring digest: configured recipient and portfolio change summary.

The catalog-assistant UI repeats the specific summary/public-page/provider
disclosure immediately beside its action. Copy does not make unverified
provider retention or training claims. Review-before-save and agency-controlled
prices remain mandatory.

Public Product and Monitor copy agree: enrolled workspaces can receive weekly
client rechecks and a digest; email is not promised where transport is not
configured; scheduled competitor detection is not implemented. The locked
Monitor view links to pilot contact and explains operator enrollment without
opening production entitlement.

## 4. Monitoring Form and Operations Reliability

Digest preferences and send-now are separate forms. Each form submits exactly
one intent. Clicking `Send me this week's digest` executes `send-digest-now`,
records a digest attempt through the existing server path, and reports the
actual sent, skipped, unconfigured, or failed outcome. Preference saves remain
independent.

A regression must serialize the rendered send form with its submitter, rather
than constructing an idealized `FormData` object by hand.

Operations uses one investigation projection spanning completed analysis runs
and aged failed admission reservations. Every failure included in the headline
count produces a tenant-scoped row with client, stage, time, and a safe stored
reason. When no safe reason exists, the row says that the run stopped before a
detailed record was created; it does not invent a cause. Counts and rows are
derived from the same query boundary.

## 5. Return Navigation and Honest Settings

The standard protected-route guard redirects anonymous or expired sessions to
`/login?returnTo=<encoded relative path and query>`. The existing sanitizer is
the sole authority before redirecting after login. External, protocol-relative,
or malformed targets resolve to `/`.

Settings navigation names real destinations:

- General — workspace settings;
- Monitoring — automated client rechecks;
- Services — agency service catalog;
- Data and health — export and analysis reliability;
- Team — users and permissions;
- Account — email and account access.

There are no Billing or Integrations labels until those areas exist. Workspace
export receives a plainly labelled action in the Data and health surface.
Marketing may describe manual recorded outcomes, but never imply verified
customer revenue or delivery.

## 6. Recommendation Hierarchy and Onboarding

The opportunity feed separates commercially reviewed recommendations from
routine maintenance:

- exact finding and evidence lead each item;
- `new` health findings remain in a compact Maintenance review section;
- a health item reaches the contact/proposal queue only after the agency uses
  the existing positive action to prepare a proposal;
- `already_covered`, dismissed, snoozed, sold, and resolved context remains
  visible and persistent;
- catalog ranges are labelled potential quote inputs and excluded from the
  prominent contact-value total until positively reviewed;
- single-finding groups use the concrete finding title, not a generic Site
  health improvement wrapper;
- empty package-price and duplicate underlying-value fields stay hidden until
  a quote is being assembled.

Proposal/report composition surfaces an editable reason to raise the work,
exact supporting evidence/URLs, the proposed deliverable, and the selected
catalog or agency-confirmed price basis. It never invents impact or ROI.

Onboarding leads with the agency/client distinction, first-client details,
site read, and a compact visible service/pricing confirmation. Starter services
are reviewable before save. The AI catalog assistant moves below the minimum
first-client path and is explicitly optional; no new wizard or catalog
reconstruction requirement is introduced.

## 7. Business-Language and Responsive Cleanup

- Catalog validation returns the first actionable field message rather than a
  serialized validation array.
- Cooldown, invitation, report, and share dates use the existing locale-aware
  UI formatting helpers while retaining machine-readable `dateTime` values.
- The logo field is labelled as an optional HTTPS image URL. Existing data-URL
  compatibility may remain behind an advanced hint, but base64 is not the
  default business instruction. No asset manager is added.
- Long selected-client labels fit at 355x767 and 390x844 without horizontal
  page overflow; the trigger remains visible, focusable, and labelled.
- At 1280x800 and 390x844, the first actionable recommendation appears before
  repeated explanatory chrome. Context is compressed, not deleted.
- Health-only reports use a compact header and summary. Multi-project reports
  retain the richer cover. The content type, not a new theme system, selects
  density.
- The secondary Pipeline Engine promotion is removed from the public first
  impression or subordinated to Orbit without a competing CTA.

## 8. Testing and Acceptance

Every behavior change follows red-green-refactor. Focused deterministic suites
cover each subsystem before the full gate. New tests assert user-visible or
repository behavior, not mocks alone.

Final deterministic verification:

```text
pnpm verify
pnpm analyzability --offline
pnpm tsx scripts/analyzability/ui-fixture.ts
pnpm tsx scripts/design-harness.tsx .design-harness
git diff --check
```

The real local Worker is exercised with an isolated D1 database, synthetic
accounts, mock evaluator, and console email. Browser acceptance covers:

1. signed-out home/product -> signup -> pilot-contact link;
2. readable/no-service-pages onboarding and client analysis, plus fail-closed
   negative fixtures;
3. report create/share/reload/reopen/revoke/anonymous denial;
4. real rendered digest send form and independent preference save;
5. logout/expiry -> protected report -> login -> same report/query;
6. operations failed reservation -> matching investigation row;
7. recommendation, onboarding, settings/export, privacy/catalog disclosure,
   and Monitor gate clarity;
8. responsive views at 1440x1000, 1280x800, 390x844, and 355x767, including a
   selected long client name.

Browser evidence includes page identity, meaningful DOM, no framework overlay,
relevant console health, target-flow interaction state, and screenshots. A
passing build is not accepted as visual proof.

## 9. Explicitly Separate Operational Gates

These remain incomplete after repository verification unless separately
authorized and observed:

- receipt of a real pilot email by `hello@getaxiom.ca`;
- production DeepSeek catalog/evaluator behavior and authoritative usage cost;
- production scheduler execution and Resend inbox delivery for an enrolled
  canary workspace;
- deployment identity and production smoke after release;
- saved-PDF pagination and visual inspection;
- keyboard, screen-reader, and full accessibility certification;
- five-agency paid-pilot conversion, artifact use, repeat purchase, and unit
  economics.

No local mock, cached crawl, console email, static render, or passing unit test
may be substituted for those claims.

## 10. Delivery Structure

Implementation is split into reviewed vertical slices:

1. analysis admission and truthful state;
2. durable reports and shares;
3. acquisition, privacy, and monitoring claims;
4. digest form, operations details, and auth return path;
5. recommendation/onboarding hierarchy;
6. settings, business-language, report-density, and responsive cleanup;
7. integrated browser acceptance and final release verification.

Agents work sequentially on production changes to avoid shared-file conflicts.
Read-only investigation and final review may run in parallel. Each slice owns
its tests, receives an independent spec/code-quality review, and must converge
before the next dependent slice begins.
