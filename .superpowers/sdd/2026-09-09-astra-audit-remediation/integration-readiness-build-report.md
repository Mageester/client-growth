# Integration readiness build boundary report

## Scope

- Kept evidence, coverage, catalog, and offering derivation in `app/lib/analysis-readiness.server.ts`.
- Moved the pure admission blocker/reason projection to client-safe `app/lib/analysis-readiness.ts`.
- Pointed onboarding, client detail, and opportunities at the same pure projection; removed the opportunities-only duplicate.
- Changed no readiness presentation markup or CSS.

## RED evidence

1. `pnpm build`
   - Exit: `1`
   - Client build stopped after 84 transformed modules.
   - Exact boundary error: `[commonjs--resolver] Server-only module referenced by client`.
   - Import trace named `../lib/analysis-readiness.server` from `app/routes/onboarding.tsx` and explained that non-server route exports depended on it.

2. `pnpm test -- test/app.analysisReadinessPresentation.test.ts`
   - The first run exposed only a missing-module resolution error, so a non-behavioral scaffold was added and the test was rerun.
   - Behavioral RED: 1 failed, 1 passed.
   - Exact assertion: expected blocker rule id `broken-conversion-path`, received `undefined`.

## GREEN evidence

- `pnpm test -- test/app.analysisReadinessPresentation.test.ts`
  - Exit: `0`; 1 file passed, 2 tests passed.
- `pnpm build`
  - Exit: `0`; client build transformed 153 modules and SSR build transformed 154 modules.
- Focused route/readiness command:
  - `pnpm test -- test/core.analysisReadiness.test.ts test/app.analysisReadinessPresentation.test.ts test/routes.analysisReadiness.test.ts test/routes.onboarding.test.ts test/routes.opportunityDecisions.test.ts test/routes.catalogAndClients.test.ts`
  - Exit: `0`; 6 files passed, 111 tests passed.
- `pnpm typecheck`
  - First run correctly found that the new helper type required more catalog metadata than loader-serialized views retain.
  - The helper contract was narrowed to only the fields its algorithm consumes.
  - Fresh rerun exit: `0`.
- `pnpm test`
  - Exit: `0`; 142 files passed, 1,294 tests passed.
- `git diff --check`
  - Exit: `0`; no whitespace errors.

The full test run emitted existing intentional stderr from failure-path fixtures and Node's experimental SQLite warning; no test failed.

## Self-review

- The client-safe module has runtime dependencies on no server module; its core imports are type-only.
- The server module now exports only the builder that reads/derives evidence and catalog state.
- All action and rendered-component call sites use one admission-reason implementation, so server rejection copy and disabled-control copy cannot drift.
- The structural input type intentionally requires only `rules`, catalog rule ids, and nullable service ids. This accepts full server readiness and loader-serialized readiness without coupling presentation to unused catalog metadata.
- The production build is the integration regression for React Router's route-export splitting; the unit test protects matched-rule blocker precedence.

## Residual concerns

- React Router reports only its existing v8 future-flag warnings during the successful build.
- No browser interaction was needed because this change alters no markup or styling and preserves the existing formatter output exactly.
