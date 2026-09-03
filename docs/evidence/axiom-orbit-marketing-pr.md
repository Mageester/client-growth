## Summary

- Adds a premium public Axiom Orbit showcase at `/`.
- Adds a detailed public product story at `/product`, structured around Monitor, Understand, Find, Act, and Grow.
- Uses the approved Axiom Orbit brand pack and clearly labeled illustrative product fragments grounded in the real application.

## Product truth

- Monitoring is described as opt-in and Weekly, with honest Inconclusive states.
- The live detection scope is bounded to the current evidence-backed categories.
- Proposal drafts remain inside Orbit until copied.
- Revenue and outcome tracking is labeled Direction, not current functionality.

## QA

- Focused marketing tests: 18/18 passed.
- Typecheck and production build passed.
- Browser-tested `/` and `/product` at 1440 and 390; home additionally checked at 1024 and 768.
- No horizontal overflow or browser console errors found.
- Mobile navigation opens, exposes its links, and closes with Escape.
- Reduced-motion behavior verified.
- Full `pnpm verify`, `pnpm bench`, and final diff check are recorded in the final task report.

## Parallel-work safety

The marketing work was isolated from concurrent application/evidence work. Shared-root changes are limited to marketing-route shell and metadata handling; no crawler, monitoring, auth, database, evaluator, or security behavior changed.

Not deployed. Not merged.
