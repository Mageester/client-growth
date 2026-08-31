# Product validation harness

Runs real business websites through the current `missing-service-page` rule +
the real DeepSeek evaluator and records results for manual grading. Not product
code.

```bash
DEEPSEEK_API_KEY=... pnpm exec tsx scripts/validation/run.ts
# optional: VAL_LIMIT=3 to run a subset
```

- `cases.ts` — the 20 test sites and their realistic offerings
- `catalog.ts` — a realistic small-agency service catalog
- `run.ts` — the harness (hard AI-call budget stop at 70)
- `results.json` — latest run output
- `results.before.json` — baseline snapshot taken **before** absence verification
  was added (31 surfaced from 35 candidates), kept for the before/after record

## Before / after — absence verification

| | candidates | AI calls | surfaced | rejected | verify GETs | approx cost |
|---|---|---|---|---|---|---|
| before | 35 | 35 | 31 | 4 | 0 | $0.033 |
| after  | 7  | 7  | 7  | 0 | 7 | $0.0036 |

23 offerings that the bounded crawl had wrongly treated as "missing" are now
recognized as already present (nav label / link href / sitemap / fetched page),
before any AI call.
