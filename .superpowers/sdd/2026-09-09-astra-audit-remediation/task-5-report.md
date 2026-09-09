# Task 5 Report: Reviewed Recommendations Before Maintenance

## Status

Implemented and scoped GREEN. The Task 5 focused suite, the repository's actual adjacent state suites, typecheck, and diff check pass. The full repository suite has one unrelated pre-existing production-schema fixture failure, recorded under Residual concerns.

## Behavior delivered

- A new site-health finding stays in `maintenance`; it does not appear in the primary contact queue and does not contribute to contact-ready counts or value.
- Existing status is the only promotion boundary. Health findings with `accepted`, `proposal_prepared`, `pitched`, or `sold` status are classified into the reviewed contact/proposal path. No persistence or migration changed.
- Health and historical findings remain available under the existing `all` filter. Dismissed, covered, snoozed, resolved, lost, and sold rows are not deleted or rewritten.
- Home presents `Clients worth contacting` first, then `Maintenance review`, then operational attention.
- Opportunities presents `Reviewed recommendations` before `Maintenance review`; unreviewed health ranges are labeled `Potential quote input` and excluded from the prominent potential-revenue total.
- A one-finding derived project uses the concrete persisted finding title. Multi-finding family titles remain unchanged.
- Empty package-price facts no longer render in project and client-report views. Agency-entered package price controls and explicit confirmation remain unchanged.
- First-client and starter-price inputs now precede the optional AI catalog assistant. The hidden reviewed-catalog serialization remains in the crawl-only setup form and is still driven by the assistant state.
- Blank catalog input produces `Describe the agency or add its website.`. Zod codes, paths, and serialized issue arrays no longer cross the existing route action error boundary.
- The report builder exposes persisted rationale, observed support and evidence refs, suggested scope, mapped service, and agency service ranges as `Reason to raise`, `What supports it`, `Deliverable`, `Mapped service`, and `Price basis`. Client reports use the same handoff labels and render an agency-confirmed price only when present. No impact, ROI, or sale text is generated.

## RED evidence

Before production edits:

```text
pnpm exec vitest run test/app.actionCenter.test.ts test/core.projectPackaging.test.ts test/app.approvedRedesign.test.ts test/routes.onboarding.test.ts test/routes.catalogAssistant.test.ts test/core.clientReport.test.ts test/routes.clientReports.test.ts
```

Result: 9 failures / 74 passes. Intended failures covered health promotion, generic one-finding titles, missing maintenance hierarchy/contact-total exclusion, onboarding assistant order, serialized Zod issues, report handoff labels, and empty package-price rendering. The ninth failure was the generated design harness reaching Task 4's operations screen without the newly required `investigations` fixture field.

The report-handoff assertions were also run independently before implementation:

```text
pnpm exec vitest run test/routes.clientReports.test.ts
```

Result: 2 failures / 3 passes, specifically missing `Reason to raise` and rendered unset `Package price`.

## GREEN evidence

Focused Task 5 command:

```text
pnpm exec vitest run test/app.actionCenter.test.ts test/core.projectPackaging.test.ts test/app.approvedRedesign.test.ts test/routes.onboarding.test.ts test/routes.catalogAssistant.test.ts test/core.clientReport.test.ts test/routes.clientReports.test.ts
```

Result: 7 files passed, 83 tests passed.

The brief's named `test/core.opportunityState.test.ts` and `test/routes.opportunityOutcome.test.ts` do not exist in this checkout. The combined brief command therefore ran only `test/app.portfolio.test.ts` (17 passed). The repository's actual adjacent state/lifecycle suites were run instead:

```text
pnpm exec vitest run test/app.portfolio.test.ts test/core.salesFunnel.test.ts test/routes.opportunityDecisions.test.ts test/db.portfolioChanges.test.ts
```

Result: 4 files passed, 55 tests passed.

Additional verification:

```text
pnpm typecheck
git diff --check
```

Both passed.

Full repository test run:

```text
pnpm test
```

Result: 140 files passed, 1 failed; 1,285 tests passed, 1 failed. The only failure was `test/pausedMismatchBoundary.test.ts > loads the client route on the production schema without the paused table`, with `no such table: client_report_snapshots`.

## Cross-task integration

`scripts/design-harness.tsx` received only `investigations: []` in the operations fixture. Task 4 made that field part of the rendered operations payload; without it, the Task 5 onboarding harness test crashed before reaching onboarding. No Task 4 production behavior changed.

`test/routes.opportunityDecisions.test.ts` had one stale assertion requiring `Package price / Not set`. It now asserts those empty placeholders are absent, matching both the test's existing “without inventing a package price” intent and the Task 5 brief.

## Self-review

- No schema, migration, repository write, or new revenue state was added.
- Partitioning occurs before project grouping, so a new health row cannot be pulled into a reviewed health project merely because another row in the same family progressed.
- Contact totals are derived from unfiltered scoped opportunities using the same classification boundary, so search/filter presentation cannot change the headline total.
- Closed rows remain in the existing `all` history path; sold health is a reviewed outcome, while dismissed/covered/snoozed/resolved health remains maintenance history.
- The catalog fix normalizes only validation errors and does not mask crawl, quota, provider, or persistence failures.
- Report wording describes recorded evidence, deliverables, mapping, and agency-confirmed price only; it does not infer impact, ROI, or a sale.

## Residual concerns

- The full-suite `client_report_snapshots` fixture failure is outside Task 5 and predates this slice's behavior; focused report suites pass against the migrated schema.
- The two adjacent filenames in the brief are stale. Their closest current replacements are documented above and pass.
- Task 6 owns CSS and density polish. The new report-builder handoff facts intentionally use existing semantic markup without broad styling changes.
