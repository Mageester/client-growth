# Final whole-branch review remediation — round 1

Date: 2026-09-09. Base reviewed HEAD: `efc6596`. Runtime: Node `v24.13.1`.
Worktree: `C:\Users\aidan\OneDrive\Documents\client-growth\.worktrees\astra-audit-fixes`.

## Changes

1. Onboarding presentation now recomputes coverage and per-rule readiness using current checked/typed offerings and the loader's current catalog/site facts. The server action still recomputes admission from submitted/persisted client state and authoritative evidence. The regression calls the real loader with zero persisted offerings, an exhaustive readable crawl, only the service-pages-build catalog match, and newly discovered checked offerings; it requires the Analyze intent and verifies the loader did not save offerings.
2. The contact bucket is labeled **Recommendations to consider** because it contains both new commercial findings and explicitly progressed work. The new-commercial render regression rejects **Reviewed recommendations**. Commercial ordering, maintenance separation, and progression logic are unchanged.
3. Each report candidate has a labeled, controlled **Reason to raise** textarea, initialized from distinct stored opportunity rationales and bounded to 1,200 characters. Preview and generation use the same core snapshot input. Submitted reasons are checked as text, trimmed, length-validated, and checked against the existing internal-language policy. Missing/blank reasons use the stored default. Private and public reports use the existing snapshot `rationale` field, so no DB schema, migration, snapshot version, or parser change is needed. Existing React rendering escapes user markup. Original opportunity rationales remain in the private integrity snapshot.

## Literal RED / GREEN evidence

All commands ran in this worktree. Each listed RED was observed before its corresponding production implementation; each GREEN reran the same selection.

| Command | RED observation | GREEN result |
| --- | --- | --- |
| `pnpm test -- test/routes.onboarding.test.ts -t "enables Analyze from current"` | 1 failed: real-loader markup had `intent=save`, missing `intent=analyze`. An earlier test-setup attempt referenced nonexistent `saveService`; corrected to `setServiceActive` before recording this behavioral RED. | 1 passed, 25 skipped |
| `pnpm test -- test/routes.opportunityDecisions.test.ts -t "presents related service findings"` | 1 failed: new-commercial markup lacked `Recommendations to consider`. | 1 passed, 28 skipped |
| `pnpm test -- test/routes.clientReports.test.ts -t "retains the concrete stored reason"` | 1 failed: saved rationale was generic `A focused service-page opportunity for Water Heater Repair.` instead of the stored concrete rationale. | 1 passed, 5 skipped before parameterization |
| `pnpm test -- test/routes.clientReports.test.ts -t "retains the"` | 1 failed/1 passed: edited reason was discarded in the saved snapshot; default lifecycle passed. | 2 passed, 5 skipped at that step |
| `pnpm test -- test/routes.clientReports.test.ts -t "offers a bounded reason editor"` | 1 failed: named reason textarea absent. | 1 passed, 7 skipped |
| `pnpm test -- test/routes.clientReports.test.ts -t "reason on the server"` | 2 failed: oversized/internal reasons generated redirects instead of validation errors. | 2 passed, 8 skipped |
| `pnpm test -- test/routes.clientReports.test.ts -t "rejects a file submitted"` | 1 failed: multipart File value was coerced to text and saved (302). | 1 passed, 10 skipped |

An attempted `-t "retains the edited reason"` selection skipped all tests because Vitest renders the parameter label with quotes; the subsequent broader `-t "retains the"` command above exercised the real failure. Skipped selection is not counted as evidence.

The lifecycle regression covers generation, private reload/render, share creation, and public loader/render for both a default stored rationale and an edited rationale containing literal script markup. Both render escaped text and preserve the exact trimmed saved reason.

## Final verification on the completed code

Focused command:

```text
pnpm test -- test/core.analysisReadiness.test.ts test/core.catalogReadiness.test.ts test/app.analysisReadinessPresentation.test.ts test/routes.analysisReadiness.test.ts test/routes.onboarding.test.ts test/app.actionCenter.test.ts test/routes.opportunityDecisions.test.ts test/core.clientReport.test.ts test/db.clientReports.test.ts test/routes.clientReports.test.ts test/proposalShares.test.ts test/routes.tenantIsolation.test.ts
```

- Focused: exit 0; **12 files, 160 tests passed** (11:59 Toronto, 3.79 s).
- `pnpm typecheck`: exit 0. Initial run found `TS2339` in the legacy onboarding fallback after narrowing; destructuring persisted readiness before the branch fixed it. Final rerun passed.
- `pnpm build`: exit 0; client and SSR builds passed (final client 3.77 s, SSR 2.03 s).
- `pnpm test`: exit 0; **142 files, 1,302 tests passed** (11:59:35 Toronto, 8.46 s).
- `git diff --check`: exit 0, no output; repeated after the report was added.

Earlier complete-code checks before the final multipart validation regression were also green: 159 focused tests, 1,301 full tests, build/typecheck. Final counts above supersede them.

## Self-review and residual concerns

- `src/core/absenceVerification.ts` has only a type change: `assessServiceCoverage` accepts `Pick<EvidenceBundle, "site">` instead of a full bundle. Its implementation and domain semantics are identical. This is required to recompute from the same site structure without serializing network diagnostics or unrelated evidence into onboarding data.
- Catalog/client/evidence reads remain tenant-scoped. Readiness presentation cannot authorize a run; the existing server admission check remains authoritative. Existing no-service/readable, unreadable, zero-catalog, crafted-action, and tenant-isolation tests pass.
- Selection and candidate eligibility are still recomputed by the report action. Reason input cannot introduce an unowned opportunity or alter private audit provenance. Owner-only share controls, public projection, revocation, security headers, and snapshot integrity paths are unchanged and their suites pass.
- No revenue inference, sale state, ROI claim, service price mutation, schema change, or migration was introduced. Task 5 hierarchy and Task 6 styles remain unchanged; the reason field reuses the report textarea styling.
- Bounded defaults concatenate distinct client-safe stored rationales and truncate at 1,200 characters. Older saved snapshots continue to render their previously frozen rationale; this fix intentionally does not rewrite saved reports.
- Evidence is deterministic local route/database/render testing plus production compilation. No live-provider run, production mutation, deployment, or interactive browser acceptance was performed in this fix round. Live typing, checkbox toggling, and visual layout remain browser acceptance items for the parent review.
- Build emitted existing React Router v8 future-flag and empty-route-chunk notices; tests emitted expected negative-path logs and SQLite experimental warnings. None caused a failed check.

The TDD skill guided sequential behavioral regression and implementation cycles. No extra agent was spawned.

## Round 2 — remaining mixed-bucket summary wording

Base: `944acf1189c568d189ec7e83e370aaf633972179`. The first fix changed the section heading but missed the lowercase metric summary. The summary now says `open recommendation(s)`; section order, commercial-first grouping, and the maintenance split are untouched. The existing all-new-commercial render regression now rejects `/reviewed recommendations?/i` across the whole rendered page.

- RED: `pnpm test -- test/routes.opportunityDecisions.test.ts -t "presents related service findings"` exited 1 at 12:03:19 Toronto: 1 failed / 28 skipped because the markup still matched `/reviewed recommendations?/i`.
- GREEN: the identical command exited 0 at 12:03:31: 1 passed / 28 skipped after the literal correction.
- `pnpm test -- test/routes.opportunityDecisions.test.ts test/app.actionCenter.test.ts test/app.ui.test.ts`: exit 0, **3 files / 75 tests passed** (12:03:46 Toronto).
- `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0; client and SSR builds passed, with the same existing empty-chunk/future-flag notices.
- `git diff --check`: exit 0 after this report update.

Self-review: only one production copy literal, one strengthened assertion, and this evidence appendix changed. No behavioral, ordering, maintenance, security, pricing, or schema change. No additional browser acceptance performed for this literal correction.
