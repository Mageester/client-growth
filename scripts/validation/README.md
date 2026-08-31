# Product validation harness

Runs real business websites through the current `missing-service-page` rule +
absence verification + the real DeepSeek evaluator, for manual grading. Not
product code.

```bash
# franchise set (round 1)
DEEPSEEK_API_KEY=... pnpm exec tsx scripts/validation/run.ts
# independent local-business set (rounds 2-3)
VAL_CASESET=local VAL_OUT=results.local.json pnpm exec tsx scripts/validation/run.ts
```

`VAL_LIMIT=N` runs a subset; `VAL_MAX_AI=N` lowers the hard AI-call stop.

- `cases.ts` / `cases.local.ts` — the two test sets
- `catalog.ts` — a realistic small-agency catalog
- `run.ts` — the harness (crawl → coverage gate → verification → DeepSeek)
- `results*.json` — latest outputs; `*.before.json` are pre-change snapshots

## Progress

| round | set | analyzable | surfaced | GOOD/QUES/BAD | AI calls | cost |
|---|---|---|---|---|---|---|
| 1 (pre-verification) | franchise | 20/20 | 31 | — / — / ~most | 35 | $0.033 |
| 1 (post-verification) | franchise | 20/20 | 7 | mixed | 7 | $0.0036 |
| 2 | local | 19/20 crawled | 31 | 9 / 12 / 10 | 31 | $0.0144 |
| 3 (post coverage-gate + inconclusive fix) | local | **15/20** | **12** | **6 / 5 / 1** | 12 | $0.0059 |

Round 3 changes: (a) a crawl **service-coverage** gate — a site is only analyzed
when ≥2 offerings are positively found on it, or ≥2 service-like crawled pages,
or ≥3 service-like sitemap URLs; otherwise NOT_ANALYZABLE and nothing is claimed
missing; (b) a matching nav label with **no href** is `inconclusive`, not
`absent` — we suppress rather than claim absence we cannot verify.
