# Public-share CSP runtime remediation

Date: 2026-09-09
Scope: `app/root.tsx`, the root/public-share regression in `test/app.ui.test.ts`, and browser acceptance evidence.

## Root cause

`/report/share` deliberately returns a restrictive CSP with `script-src 'self'`. The root layout nevertheless emitted React Router's inline `ScrollRestoration` script and inline hydration/bootstrap scripts on every route. The public report itself rendered from SSR, but the browser rejected those five inline scripts. Proposal and client-report shares are already classified by `isStandalonePublicShare` and expose no client-side interactions, so hydration is unnecessary on either standalone share surface.

## RED

Before changing production code, a server-rendered root regression exercised the real `Layout` under React Router's framework and data-router contexts. The new cases required zero script tags for:

- `/proposal/share`
- `/report/share`
- normalized `/REPORT/%73HARE/`

It also required `/login` to retain the React Router runtime. The first run failed exactly on the three standalone-share cases: the rendered documents contained the scroll-restoration inline script plus React Router bootstrap scripts. The normal-route retention assertion passed.

Command: `pnpm test -- test/app.ui.test.ts`
Observed RED: 3 failed, 32 passed.

## Fix

The root now omits both `<ScrollRestoration />` and `<Scripts />` only when `isStandalonePublicShare` is true. CSP was not weakened, `unsafe-inline` was not introduced, and ordinary public/authenticated app routes still receive the React Router runtime.

Path-normalization coverage now checks report shares as well as proposal shares: case variations, trailing slashes, percent-decoded path segments, and malformed near-matches (extra suffix, doubled slash, encoded slash).

## GREEN and browser evidence

- Focused share/root suite: `pnpm test -- test/app.ui.test.ts test/proposalShares.test.ts test/routes.clientReports.test.ts` -> 3 files, 60 tests passed.
- Full suite: `pnpm test` -> 142 files, 1,310 tests passed.
- Type safety: `pnpm typecheck` -> exit 0.
- Production build: `pnpm build` -> exit 0.
- Fresh local Worker HTTP check, using a temporary share row for the existing local report snapshot:
  - status `200`
  - original strict CSP present, including `script-src 'self'`
  - rendered report content present
  - `0` script tags
  - no `react-router-scroll-positions` bootstrap
- In-app browser on that valid report share:
  - full client report visibly rendered
  - `document.scripts.length === 0`
  - no scroll bootstrap in the document
  - browser warning/error log: empty (`[]`), replacing the previously reproducible five CSP violations
- The temporary local-only report-share row was deleted after acceptance (`removed: 1`, `remaining: 0`) and the local server was stopped.

## Self-review

- The conditional reuses the existing exact/normalized standalone-share classification; it does not introduce a second route list that could drift.
- The mutation check is direct: restoring unconditional `ScrollRestoration`/`Scripts` makes every standalone-share document assertion fail, while removing runtime scripts globally makes the `/login` assertion fail.
- Both share paths use the same root branch. A valid report share received browser verification because the local D1 already held a report snapshot. Proposal-share behavior is covered at the root SSR boundary plus its focused repository/route suite; no persistent proposal fixture was added merely for browser setup.
- Residual boundary: these standalone pages must remain server-only. If interactive controls are added later, the route will need an explicit CSP-compatible runtime design (for example nonced/hashes or an external bundle), not silent re-enablement of unrestricted inline scripts.
