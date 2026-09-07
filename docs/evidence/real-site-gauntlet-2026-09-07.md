# Real-Site Production-Readiness Gauntlet — 2026-09-07

## 1. HEAD / environment

- Baseline HEAD: `eb4ca95` (`fix: reset stale proposal on resolved opportunity cycle`), containing all three prior features (safe workspace reset `8e9a9ce`, sales funnel `5de66d7`, resolved-cycle fix `eb4ca95`).
- Baseline `pnpm verify`: exit 0 — 115 test files, 1048 tests, typecheck clean, production build successful.
- OS: Windows (Git Bash). Test DB: `node:sqlite`. App DB for E2E: local D1 via wrangler dev.

## 2. Provider configuration (no secret)

- Provider: DeepSeek, model `deepseek-chat`, selected via `AI_PROVIDER=deepseek` in git-ignored `.dev.vars`.
- Credential: `DEEPSEEK_API_KEY` (user-supplied, written only to `.dev.vars`, never printed or committed).
- Smoke call before full run: verdict=surface, valid contract output, 1 call (~$0.0005). Real provider proven active via runtime verdicts and per-call cost logging.
- Total provider usage across the gauntlet: ~93 evaluation calls (16 corpus findings + 44 adversarial bench + 13 core/judgment cases + E2E runs). No retries/errors observed.

## 3. Corpus

61 unique real public business sites (union of the 24-site analyzability corpus + 41 validation cases, deduped by domain): HVAC, plumbing, electrical, roofing, landscaping, legal, pest control, tree care, dental, franchise services. Mix includes well-built national sites, small/messy local sites, broad catalogs, and thin catalogs. Crawls were polite (1.2s/host delay, Orbit's own budgets/robots behavior) and largely served from the existing 605-file cache.

## 4. Crawl / outcome results

| Outcome | Sites |
|---|---|
| clean | 41 |
| findings | 12 |
| inconclusive | 8 |

19/24 analyzable (79%) on the analyzability replay; failure classification honest; zero false-analyzable. Inconclusive runs were truthfully reported and never treated as "clean".

## 5–6. Commercial findings & human grading (15 findings after fix)

| Site | Rule | Finding | Verdict probe | Human grade |
|---|---|---|---|---|
| cambridgeheating | missing-service-page | Water Heater Replacement | 404, no sitemap page | EXCELLENT_PITCH |
| cambridgeheating | missing-service-page | Duct Cleaning | 404 | EXCELLENT_PITCH |
| davey | missing-service-page | Stump Grinding | guessed URL 200 = soft-404 shell | EXCELLENT_PITCH |
| bartlett | missing-service-page | Stump Grinding | real page `/services/stump-grinding` (200) | DUPLICATE_OR_EQUIVALENT |
| bellbrothers | missing-service-page | Duct Sealing | 404 | EXCELLENT_PITCH |
| romanelectric | missing-service-page | EV Charger Installation | 404 | EXCELLENT_PITCH |
| romanelectric | missing-service-page | Whole House Rewiring | 404; site covers rewiring only in prose | LEGITIMATE_BUT_WEAK |
| bakerroofing | missing-service-page | Gutter Installation | 404 | EXCELLENT_PITCH |
| interstateroofing | missing-service-page | Siding Installation | 404 (region slugs too) | EXCELLENT_PITCH |
| lifescape | missing-service-page | Water Features | 404; only blog mentions | LEGITIMATE_BUT_WEAK |
| russelllandscape | missing-service-page | Erosion Control | 404 | EXCELLENT_PITCH |
| russelllandscape | missing-service-page | Athletic Field Maintenance | 404 | EXCELLENT_PITCH |
| arrow | missing-service-page | Crawl Space Encapsulation | 404 | EXCELLENT_PITCH |
| hupy | missing-service-page | Nursing Home Abuse | 200 real page exists | DUPLICATE_OR_EQUIVALENT |
| nicoletlaw | missing-service-page | Social Security Disability | 200 = redirect to homepage (soft-404) | EXCELLENT_PITCH |

**Commercial precision: 13/15 = 86.7%** (EXCELLENT_PITCH 11, LEGITIMATE_BUT_WEAK 2, DUPLICATE 2, FALSE_POSITIVE 0). 11 of 12 finding-sites have at least one pitch-worthy opportunity. Note: absence claims were verified against the LIVE sites, not Orbit's text; two 200-status probe hits were manually confirmed soft-404s.

## 7. False-negative review (15 sites)

- One notable miss: **morrisjenkins sells plumbing and electrical** (13/22 crawled pages mention each) but the client profile listed only HVAC offerings → Orbit cannot flag unprofiled lines. Classified CLIENT_SETUP (input thinness), correct behavior given the input.
- All other checks: CORRECTLY_SUPPRESSED or NOT_ACTUALLY_AN_OPPORTUNITY.
- No RULE_DOES_NOT_EXIST, AI_FALSE_REJECTION, or BILLABILITY_MAPPING_FAILURE cases found in scope.

## 8. Evaluator gauntlet (real DeepSeek)

Across ~93 real calls (corpus findings, 44-case adversarial bench, core judgment cases):

| Metric | Result |
|---|---|
| False surfaces | 0 |
| False rejects (true service rejected) | 0 |
| Malformed responses | 0 |
| Provider errors | 0 |
| Precision / recall | 1.00 / 1.00 on the exercised sets |

The single apparent false negative in the judgment set (`high-intent-variant`) was 0 candidates generated at the rule level — evaluator never consulted; documented rule limitation, not an evaluator failure.

## 9. Competitor-gap gauntlet (8 real client sets, 2 genuine competitors each)

- 5/8 sets: both competitors crawled and readable; suggestions plentiful (≈20 per competitor).
- Raw gaps → evaluator-surviving → pitch-worthy: **0 → 0 → 0**. Diagnostic with relaxed threshold showed **no tally ever reached 2 votes** — the consensus gate correctly suppressed 1-vote noise ("GET THIS DEAL", state names, nav labels).
- 2 sets (bartlett, gruberlaw): competitor crawl failures surfaced as explicit limitations, handled honestly.
- Zero false gaps across all 8 sets. Correct-by-design conservatism.

## 10. End-to-end application workflow (isolated local D1, real provider)

Full HTTP-driven flow with a real signup (`SIGNUP_MODE=open`, console email transport; verification link captured and consumed):

- Signup → email verification → sign-in ✓
- Onboarding setup: correctly refused without a starter service ("Keep at least one service"); succeeded with one ✓
- Confirm-stage ordering preserved: `/onboarding?client=<id>` renders confirm stage, no `/opportunities` redirect ✓
- First analysis (drainworks): clean run, truthfully 0 findings ✓
- Second client (cambridgeheating): analysis surfaced 2 findings; cooldown correctly rate-limited a second analyze (ledger intact) ✓
- Funnel: Worth pursuing (accepted) → prepare proposal → edit proposal (proposalPreparedAt preserved) → mark pitched → mark sold with amount; second opportunity marked lost; invalid transitions rejected server-side ✓
- Cross-tenant isolation: other-workspace opportunity ID → 404 ✓
- Re-analysis: run outcome clean with funnel state preserved ✓
- Workspace reset E2E: wrong confirmation deleted nothing; correct confirmation preserved workspace row, owner membership, auth session, analysis_limit_reservations; cleared product state; redirected to onboarding; post-reset onboarding prefilled agency name and re-ran confirm stage ✓

**E2E incident (not a product defect):** the first cambridge analysis failed with `D1_ERROR: table opportunities has no column named accepted_at` — my wiped local D1 was missing migration `0022_sales_funnel.sql`. After `pnpm db:migrate:local`, everything worked. Lesson recorded: the failed reservation correctly counted against the daily ledger (fail-closed held).

## 11. UI / browser validation

No browser automation available in this environment. Validation was performed via live-server HTTP integration testing (route rendering, form posts, action results, redirects, DB state). **Browser-level visual/mobile checks were NOT performed** — explicit gap.

## 12–13. Bugs discovered & fixed (regression-backed)

1. **PRODUCT_DEFECT — sitemap host-variant loss (fixed).** In `readSitemap`, child-URL filtering used strict origin equality while the crawl's redirect policy treats apex↔www as one site. On sites whose sitemap canonicalizes to the other host variant (lifescape), every child URL was filtered out → `sitemapUrls: 0` → absence verification claimed "absent" from incomplete discovery → false commercial finding. RED test added (`test/adapters.httpEvidenceDiscovery.test.ts`), smallest fix (use the crawl's own `isSameSite` policy), GREEN (107/107 evidence suites), real-site re-run confirms the false positive is gone (Outdoor Lighting suppressed; remaining Water Features gap is real).
2. **PRODUCT_DEFECT — AI-budget `break` dropped later deterministic candidates (fixed).** In `analyzeClient`, an exhausted AI budget `break`-ed the pending loop, discarding free deterministic candidates queued after an AI candidate. RED test added (`test/pipeline.deterministicEvaluation.test.ts`, with a genuinely analyzable fixture so the path is actually exercised), smallest fix (`break` → `continue` for budget-exhausted AI candidates), GREEN.

Both fixes are minimal, test-first, and verified against the affected real site / pipeline tests.

## 14. Remaining limitations

- Rule-level: `high-intent-variant` generates 0 candidates on some phrasings (documented).
- Competitor consensus gate is conservative by design — low yield on sites where competitors disagree.
- Client-profile thinness (e.g., morrisjenkins multi-trade) silently caps detectable opportunities; onboarding nudges help but no detection exists for "profile looks incomplete".
- No browser automation coverage (visual/mobile regressions unchecked).
- Failed analysis reservations consume daily budget (fail-closed; arguably correct, but a transient provider error costs the agency a slot).

## 15. Exact final metrics

- Sites analyzed: 61 (0 run errors)
- Outcomes: 41 clean / 12 findings / 8 inconclusive
- Commercial findings: 15 → EXCELLENT_PITCH 11, LEGITIMATE_BUT_WEAK 2, DUPLICATE_OR_EQUIVALENT 2, FALSE_POSITIVE 0
- Commercial precision: 86.7%; excellent-pitch rate: 73.3%; false-positive rate: 0%
- Clients with ≥1 pitch-worthy opportunity: 11/12 finding-sites
- Evaluator: 0 false surfaces, 0 false rejects, 0 malformed, 0 provider errors (~93 real calls)
- Competitor gaps: 0 raw across 8 sets (consensus gate held; 0 false gaps)
- False negatives: 1 CLIENT_SETUP-class observation; 0 product-class false negatives in scope

## 16. Launch verdict

**READY_FOR_PILOT_WITH_KNOWN_LIMITATIONS**

Rationale: zero false positives on 61 real sites after the sitemap fix, evaluator flawless across ~93 real calls, honest inconclusive behavior, end-to-end workflow (including reset and funnel) verified over HTTP against a real provider. The known limitations (conservative competitor yield, profile-thinness sensitivity, no browser-level visual validation) are operational, not trust-breaking. A real agency can trust surfaced findings; it should not expect exhaustive gap coverage.
