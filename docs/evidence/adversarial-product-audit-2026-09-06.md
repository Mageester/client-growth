# Axiom Orbit — Adversarial Product-Validation Audit

**Auditor:** Adversarial product-validation agent  
**Date:** 2026-09-06  
**Scope:** Full repository read — commercial rules, competitor intelligence, monitoring, opportunity lifecycle, ranking, onboarding, proposal flow, tests, validation corpus.  
**Standard:** Revenue-producing signal. Engineering effort matters only where it directly produces it.

---

## 1. What can Orbit genuinely discover today that an agency could sell?

**Three commercial findings, one explicit-action finding:**

| Rule | What it surfaces | Price band (starter) |
|---|---|---|
| `missing-service-page` | Client sells X, site has no dedicated page for X | $900–$1,800 |
| `no-service-pages` | Whole site describes none of the services the business sells | $2,500–$6,000 |
| `broken-conversion-path` | Dead CTA / broken form / malformed tel: / placeholder booking link | $300–$900 |
| `competitor-service-gap` | 2+ named competitors have a page for a service the client doesn't | $900–$1,800 |

**Plus 8 health findings** (titles, H1s, meta descriptions, structured data, alt text, thin pages, broken internal links) — real, evidenced, billable, and also what Screaming Frog gives away for free.

**What the validation corpus actually produced (round 3):** 15 of 20 sites analyzable → 12 surfaced findings. Roughly one commercial finding per 6–8 sites that pass the coverage gate. This is the honest yield.

**The competitor gap is the only finding that reads external sites** and the only one that renews itself when a competitor publishes. It is also gated behind an explicit action (not automatic), capped at 3 competitors, and requires 2+ to agree. This is the most defensible "sellable" signal in the product.

---

## 2. Which findings are differentiated from Lighthouse/Screaming Frog/SEO tools?

**Differentiated:**

1. **Missing service page (commercial).** Requires knowing what the *business sells* — which comes from the agency's offerings box, not from the crawl. Screaming Frog cannot tell you "this client sells heat pump installation but has no page for it" because it doesn't know what the client sells. This is the core moat.

2. **Competitor service gap.** The only rule that reads sites the client doesn't own. "Two of your competitors have a page for emergency callouts and you have none" is a market argument, not a document argument. No SEO tool frames it this way because none know what the *business* sells vs. what its *competitors* sell.

3. **Broken conversion path (probed).** Not "your CTA could be better" — a literal 404 on a "Book Now" link, a form posting to `#`, a `tel:` that dials `555-0100`. Deterministically probed, not inferred.

4. **Judgment gate.** The `subjectType` classification (distinct_service vs. trust_signal vs. promotion vs. generic_claim) is what keeps "fully insured" from becoming a $1,800 landing-page proposal. No auditor does this.

**NOT differentiated (commodity):**

- Missing title, duplicate title, missing H1, missing meta description, missing structured data, missing alt text, thin service page, broken internal link. These are real and evidenced. They are also exactly what Sitebulb, Screaming Frog, and Lighthouse report. Orbit's only advantage here is that it bundles them with commercial findings — which is also the problem (see §3).

---

## 3. Where is commercial recall likely being lost?

**3.1 The coverage gate is too aggressive.**  
`assessServiceCoverage` requires ≥2 offerings represented OR ≥2 service-like crawled pages OR ≥3 service-like sitemap URLs. On the validation corpus, this rejected 5 of 20 sites. Some of those 5 *did* have missing service pages — they just had one offering, or the crawl didn't reach a `/services/` path. The gate is correct to be conservative, but every rejected site is a potentially sellable finding that never reaches the agency.

**3.2 The offerings bottleneck.**  
The entire commercial engine is a comparison between what the agency recorded and what the crawl finds. If the agency records 1 offering, the coverage gate fails. If they record 2 but the site has 6 services, 4 gaps go undetected. The two-stage onboarding (crawl → suggest → confirm) mitigates this, but only for the first run. Post-onboarding, offerings are static until the agency manually updates them.

**3.3 Competitor gaps are opt-in and capped.**  
Only 3 competitors. Only explicit action. Only when 2+ agree. This is honest but means the most renewable signal is also the least automatic. An agency that names 1 competitor gets nothing.

**3.4 Monitoring defaults to off.**  
Every existing client has monitoring disabled. No recurring signal means no recurring discovery. The weekly cadence is correct for cost control, but the default-off posture means the product's only source of *unattended* revenue intelligence is opt-in.

**3.5 The evaluator cap (10 AI calls/run).**  
If a run produces 15 candidates that pass the evidence threshold, only 10 reach the evaluator. The remaining 5 are silently dropped. With DeepSeek at ~$0.0002/call, this is a $0.001 savings that costs unknown commercial recall.

---

## 4. Where can false commercial opportunities still occur?

**4.1 Offering pollution from the agency.**  
The offerings box is free text. Despite `commercialLanguage.ts` filtering and the judgment gate, an agency can still type "emergency plumbing service" (legitimate) alongside "free quotes" (promotion). The judgment gate catches the promotion, but the *legitimate* offering still produces a finding. If the agency's offerings list is bloated with 20 items, the engine will try to verify all 20 and surface findings for all missing ones — even if the agency doesn't actually want to sell pages for all of them.

**4.2 Competitor label scraping.**  
`competitorGaps.ts` reads competitor navigation and suggests services from their words. A competitor's navigation might say "Our Services" → "Drain Cleaning" but the client might already have a page for it under a different name. The token-subset matching (`clientAlreadyCovers`) is generous but not perfect. A false gap here is an agency telling a client "your competitors have a page for X" when the client does.

**4.3 Absence verification edge cases.**  
The `strengthOf` function uses token overlap with stemming. "Heat pump installation" vs. "heat pump services" — the page exists but the verification concludes "absent" because the tokens don't align. The targeted fetch mitigates this, but only when a URL is available and the budget isn't exhausted.

**4.4 The `no-service-pages` deterministic evaluation.**  
This rule bypasses the evaluator entirely (correctly — there's no subject to classify). But its claim is "the site describes none of the services this business sells." If the crawl is incomplete (not exhaustive), this claim is false. The `crawlExhaustive` flag guards this, but a site with a large sitemap and a small crawl budget may not be exhaustive.

---

## 5. What information does Orbit require from the agency that creates onboarding friction?

**5.1 The offerings list — still the core bottleneck.**  
Two-stage onboarding (crawl → suggest → confirm) is the right design. But the agency must still:
- Review 5–10 suggested offerings
- Check/uncheck each one
- Optionally type more
- Understand that every line becomes a priced page recommendation

This is 2–5 minutes of cognitive work. For an agency with 20 clients, this is 40–100 minutes of setup before the product produces any value.

**5.2 The catalog — 11 services with price bands.**  
Onboarding pre-fills 11 starter services (one per rule). The agency must review and accept/reject each one. This is a `<details>` accordion (collapsed by default), so most agencies will click "Read the site" without reviewing. The result: they get health findings priced at $150–$300 that they don't actually want to sell.

**5.3 Average job value (optional but friction-adjacent).**  
Not required, but the payback sentence ("Pays for itself with one job") only appears when this is recorded. An agency that skips it loses the most persuasive line in the proposal.

**5.4 Competitor domains (for the 4th finding).**  
The competitor gap requires the agency to name 1–3 competitor domains. This is a separate action, not part of the initial flow. Most agencies won't do it without prompting.

---

## 6. What parts of the product are overbuilt relative to demonstrated customer value?

**6.1 The 8 health rules.**  
They outnumber commercial findings 24:6 on the real corpus. They require 8 catalog entries, 8 starter price bands, 8 deterministic rule implementations, 8 aggregation paths, 8 reconciliation checks. They produce findings that Screaming Frog gives away. The tier system correctly demotes them, but they still consume crawl budget, evaluator calls, and UI attention. **The engineering effort is disproportionate to the revenue signal.**

**6.2 The monitoring system.**  
Hourly cron, bounded batches, claim-based deduplication, failure backoff, change detection, portfolio health aggregation. This is ~1,500 lines of code for a feature that defaults to off and produces findings at a weekly cadence. The monitoring *policy* is correct; the *implementation* is overbuilt for a product with no paying customers and no demonstrated demand for weekly rescans.

**6.3 The technical rule reconciliation system.**  
`canReconcileTechnicalRule`, `technicalSubjectWasRevisited`, suppressed evidence refs, page-level aggregation into site-level findings. This is ~300 lines handling edge cases (what if a page was dismissed but the defect is still there?) that will rarely trigger. Correct for a mature product; premature for one with no external users.

**6.4 The proposal share system.**  
Public token-based proposal sharing with snapshot isolation, no-store headers, evidence rendering. This is a nice-to-have that assumes agencies are sending proposals to clients. No evidence this is how agencies actually sell.

**6.5 Multi-tenancy with Better Auth, password reset, email verification, team invitations.**  
Correct for a SaaS product. Overbuilt for a single-agency tool. The `workspace_members` table exists but is always one owner. Team invitations are built but unused.

---

## 7. What are the 5 highest-value experiments we can run WITHOUT adding major features?

### E1. Run the competitor gap against the agency's existing client base
**Effort:** Low (the rule exists, just needs a bulk action)  
**Impact:** High  
**Evidence:** The competitor gap is the only finding that renews itself and the only one that reads external sites. Take the agency's 10 existing clients, crawl 2 competitors each, and see how many gaps emerge. If >30% produce a gap, this is the product's sharpest weapon. If <10%, the competitor feature is a distraction.

### E2. Measure the offerings-to-finding correlation
**Effort:** Low (log analysis)  
**Impact:** High  
**Evidence:** The entire commercial engine is a function of the offerings list. Log how many offerings each client has and whether a finding is produced. If clients with <3 offerings never produce findings, the onboarding flow is failing at its primary job. If clients with 5+ offerings produce 3+ findings, the product works but needs better onboarding.

### E3. A/B the judgment gate (mock vs. real evaluator) on the validation corpus
**Effort:** Medium (re-run validation with real DeepSeek)  
**Impact:** High  
**Evidence:** The mock evaluator asserts `distinct_service` for everything. The real DeepSeek evaluator may reject 20–40% of candidates. Run the 20-site corpus with the real evaluator and measure: (a) how many true services are rejected (false negative), (b) how many trust signals are surfaced (false positive). This tells you whether the judgment gate is a revenue protector or a revenue blocker.

### E4. Offer the payback sentence to the agency as a sales script
**Effort:** Low (UI change)  
**Impact:** Medium  
**Evidence:** "Pays for itself with one job" is the only client-facing language that converts a finding into a reason to call. Currently it's hidden behind an optional `averageJobValue` field. Make it prominent. Record the job value during onboarding. Show the sentence on every commercial finding. Measure whether agencies with the sentence enabled close more findings.

### E5. Rescan 5 existing clients manually and measure delta
**Effort:** Low (use existing monitoring infrastructure)  
**Impact:** Medium  
**Evidence:** The monitoring system exists but defaults to off. Manually rescan 5 clients that were analyzed >30 days ago. Measure: (a) how many new findings appear, (b) how many resolved findings are detected. If >50% of rescans produce new or resolved findings, monitoring is worth promoting. If <10%, it's a cost center.

---

## 8. What should we explicitly NOT build yet?

**8.1 Stripe / billing / pricing enforcement.**  
No paying customers. No pricing page. No billing logic. Adding it now is building a payment system for a product that hasn't proven it can produce a finding an agency will sell.

**8.2 A third commercial rule.**  
The README says "Not built: a third commercial rule." Correct. Two commercial rules (+ competitor gap) produce ~1 finding per 6 sites. A third rule at that yield is noise. Build a third rule only when the first two are producing >1 finding per 3 sites consistently.

**8.3 Client portal.**  
Agencies sell to clients; clients don't log in to Orbit. The proposal share link is sufficient. A full client portal (login, dashboard, status tracking) is a different product.

**8.4 Autonomous outreach / email digests / Slack integrations.**  
The product's job is to produce findings. Distribution is the agency's job. Automated outreach before the findings are reliable is how you get agencies to churn.

**8.5 RBAC beyond owner/member.**  
One workspace, one owner. The `workspace_members` table exists for later. Don't build role management for a team that doesn't exist.

**8.6 Morrow execution / project management.**  
Orbit identifies work. It doesn't do the work. Integration with project management tools is a post-revenue feature.

---

## 9. What metrics would prove Orbit works commercially?

**Primary (revenue):**

| Metric | Target | Why |
|---|---|---|
| **Findings per analyzed client** | ≥1.0 for commercial rules | Below 1.0 means the product is producing silence for most clients |
| **Offer-to-finding conversion** | ≥30% of confirmed offerings produce a finding | Below 30% means the offerings list is too broad or the crawl is missing pages |
| **Finding-to-sale conversion** | ≥15% of surfaced findings marked `sold` | Below 15% means the findings aren't sellable |
| **Average sold value** | ≥$900 (one landing page) | Below $900 means the product is surfacing health findings as commercial |
| **Time to first finding** | <5 minutes from signup | Above 5 minutes means onboarding friction is too high |

**Secondary (product health):**

| Metric | Target | Why |
|---|---|---|
| **Coverage gate pass rate** | ≥75% of sites | Below 75% means the gate is too aggressive or the crawler is failing |
| **Judgment gate pass rate** | 40–70% of candidates | Below 40% means the evaluator is too strict; above 70% means it's too lenient |
| **Monitoring rescan hit rate** | ≥30% of rescans produce new/resolved findings | Below 30% means monitoring isn't worth its compute cost |
| **Competitor gap yield** | ≥20% of comparisons produce a gap | Below 20% means the competitor feature is a distraction |

**Anti-metrics (what NOT to optimize):**

- Total findings produced (health findings inflate this)
- Crawl depth (more pages ≠ more findings)
- Evaluator call count (cost, not value)
- Proposal shares sent (vanity metric unless they convert)

---

## 10. Three representative client journeys end-to-end

### Journey A: HVAC client, missing service page found and sold

**Input:**  
Client: "Cool Breeze HVAC", domain: `coolbreezehvac.example`, offerings: ["heat pump installation", "air conditioning repair", "furnace installation", "duct cleaning"]

**Crawl:**  
`HttpEvidenceProvider` fetches 8 pages. Pages include home, about, contact, and 3 service pages (AC repair, furnace install, duct cleaning). No page for "heat pump installation."

**Evidence:**  
`EvidenceBundle` with 8 pages, 14 nav labels, 22 links, 5 sitemap URLs. `crawlExhaustive: true`.

**Rule (missing-service-page):**  
For each offering, `verifyOfferingAbsence` runs:
- "heat pump installation" → checks 8 pages, 14 nav labels, 22 links, 5 sitemap URLs → no match → `conclusion: "absent"`, `inspectedUrls: []`
- "air conditioning repair" → matched on `/ac-repair` page → `conclusion: "present"` → suppressed
- "furnace installation" → matched on `/furnace-install` page → suppressed
- "duct cleaning" → matched on `/duct-cleaning` page → suppressed

**Verification:**  
`Verification { conclusion: "absent", inspectedUrls: [], closeMatches: [], reason: "No crawled page, navigation entry, link, or sitemap URL mentions \"heat pump installation\"." }`

**Evaluator:**  
DeepSeek receives: subject="heat pump installation", otherEntriesInTheSameList=["air conditioning repair", "furnace installation", "duct cleaning"], crawledPages=[...], navigationLabels=[...]. Returns: `{ subjectType: "distinct_service", commerciallyActionable: true, verdict: "surface", rationale: "Heat pump installation is a specific, searchable HVAC service line that customers hire for. A dedicated page is standard for the industry.", suggestedScope: ["Dedicated landing page for heat pump installation", "Service-specific copy covering types, benefits, and pricing", "On-page SEO targeting 'heat pump installation [city']", "Lead-capture CTA for free estimate"] }`

**Judgment:**  
`judge()` → `subjectType === "distinct_service"` ✓, `commerciallyActionable === true` ✓, `confidence (0.65) >= 0.5` ✓ → `surface: true`

**Opportunity:**  
`assembleOpportunity` → Opportunity { id: "...", clientId: "client-coolbreeze", ruleId: "missing-service-page", title: "Heat Pump Installation — dedicated service page", detected: "The client offers \"heat pump installation\" but targeted verification found no dedicated page for it. Checked 8 crawled page(s), 14 navigation label(s), 22 discovered link(s), and 5 sitemap URL(s).", suggestedServiceId: "svc-landing-page", priceMin: 900, priceMax: 1800, confidence: 0.65, billableStatus: "billable", status: "new" }

**Proposal:**  
`generateProposalDraft` → Markdown with title, detected statement, rationale, scope, evidence, investment ($900–$1,800), next step.

**Sales outcome:**  
Agency reviews proposal, edits scope, shares via `/proposal/share?token=...`. Client approves. Agency marks `sold` with `soldAmount: 1200`. Win rate for `missing-service-page` increments.

---

### Journey B: Plumbing client, site too thin, no findings

**Input:**  
Client: "Quick Fix Plumbing", domain: `quickfixplumbing.example`, offerings: ["emergency plumbing", "drain cleaning"]

**Crawl:**  
Fetches 4 pages: home, about, contact, blog. No service pages. `crawlExhaustive: true`.

**Coverage gate:**  
`assessServiceCoverage` → 0 offerings represented in structure, 0 service-like pages, 0 service-like sitemap URLs → `analyzable: false`, `limitation: "site-too-thin"`

**Rule (missing-service-page):**  
`ctx.coverage.analyzable === false` → returns `[]` immediately. No candidates.

**Outcome:**  
`classifyAnalysis` → `outcome: "inconclusive"`, `summary: "This site has no pages describing what the business sells, so no gap can be claimed."`, `limitation: "This site has no service pages: the crawl followed every link on it and found 0 offering(s) represented..."`

**Agency experience:**  
"We looked at Quick Fix Plumbing and found nothing billable." Correct. The site is a 4-page brochure. No finding is surfaced. No evaluator call is made. No opportunity is created.

**Revenue impact:**  
$0. But the agency now knows the site needs service pages before Orbit can find gaps. This is honest, not a failure.

---

### Journey C: Dental practice, competitor gap found

**Input:**  
Client: "Bright Smile Dental", domain: `brightsmiledental.example`, offerings: ["teeth whitening", "dental implants", "Invisalign"]. Competitors: `sparkledental.example`, `pearldental.example`, `sunshinedental.example`.

**Crawl (client):**  
Fetches 10 pages. Has pages for teeth whitening and dental implants. No Invisalign page.

**Crawl (competitors):**  
- sparkledental.example: 12 pages, nav includes "Invisalign", "Teeth Whitening", "Dental Implants", "Veneers"
- pearldental.example: 9 pages, nav includes "Invisalign", "Teeth Whitening", "Dental Implants"
- sunshinedental.example: crawl failed (403) → `evidence: null`

**Rule (competitor-service-gap):**  
`findCompetitorGaps`:
- sparkledental: suggests ["Invisalign", "Teeth Whitening", "Dental Implants", "Veneers"]
- pearldental: suggests ["Invisalign", "Teeth Whitening", "Dental Implants"]
- sunshinedental: unreadable, excluded

Tally:
- "Invisalign": 2 competitors (sparkle, pearl) → ≥ `minCompetitors` → gap
- "Teeth Whitening": 2 competitors → but client has offering → suppressed
- "Dental Implants": 2 competitors → but client has offering → suppressed
- "Veneers": 1 competitor → < `minCompetitors` → suppressed

Result: 1 gap — "Invisalign" from sparkledental.example and pearldental.example.

**Evaluator:**  
DeepSeek receives: subject="Invisalign", otherEntriesInTheSameList=["teeth whitening", "dental implants"], competitor evidence. Returns: `{ subjectType: "distinct_service", commerciallyActionable: true, verdict: "surface", rationale: "Invisalign is a specific orthodontic service that patients search for and request by name. Two competitors have dedicated pages.", suggestedScope: ["Dedicated Invisalign landing page", "Before/after gallery", "Cost and financing information", "Free consultation CTA"] }`

**Judgment:**  
`surface: true`

**Opportunity:**  
Opportunity { ruleId: "competitor-service-gap", title: "Invisalign — dedicated service page", detected: "Two of your competitors (pearldental.example, sparkledental.example) have a page for Invisalign. None of your pages cover it.", priceMin: 900, priceMax: 1800, confidence: 0.72 }

**Sales outcome:**  
Agency uses the competitor argument on a call: "Two of your competitors have Invisalign pages and you don't." Client agrees to a $1,500 page. Agency marks `sold`.

---

## Recommendation ranking

| # | Recommendation | Revenue impact | Effort | Evidence |
|---|---|---|---|---|
| 1 | Run competitor gap against existing client base (E1) | High | Low | Competitor gap is the only renewable signal; untested at scale |
| 2 | A/B judgment gate on validation corpus (E3) | High | Medium | Mock evaluator is a 100% pass rate; real one is unknown |
| 3 | Measure offerings-to-finding correlation (E2) | High | Low | Offerings are the entire input; correlation is unmeasured |
| 4 | Promote payback sentence in UI (E4) | Medium | Low | Most persuasive client-facing language; currently hidden |
| 5 | Manual rescan of 5 clients (E5) | Medium | Low | Monitoring exists but is untested for hit rate |
| 6 | Reduce health rule prominence further | Medium | Low | 24:6 health-to-commercial ratio buries the product |
| 7 | Add offerings nudges post-onboarding | Medium | Medium | Offerings decay; no mechanism to update them |
| 8 | Increase evaluator cap to 20 | Low | Low | $0.002 cost for unknown recall gain |

---

## Proposed 7-day validation sprint

**Goal:** Determine whether Orbit produces ≥1 sellable commercial finding per 3 clients and whether ≥15% of those findings convert to sales.

**Day 1–2: Data collection**
- Run the competitor gap against 10 existing clients (E1)
- Re-run the 20-site validation corpus with the real DeepSeek evaluator (E3)
- Log offerings count vs. finding yield for all clients (E2)

**Day 3: Analysis**
- Tabulate: findings per client, coverage gate pass rate, judgment gate pass rate
- Identify: which clients produce no findings and why (offerings? coverage? evaluator rejection?)
- Grade competitor gaps: how many are real vs. noise

**Day 4: Agency interview (hypothetical — no real agency yet)**
- Show 5 surfaced findings to a friendly agency owner
- Ask: "Would you call a client about this?"
- Record which findings they'd act on and why

**Day 5: Quick wins**
- Promote the payback sentence in the UI (E4)
- Add a "Record job value" prompt to the client detail page
- Add a "Name competitors" nudge to the client detail page

**Day 6: Rescan test**
- Manually rescan 5 clients analyzed >30 days ago (E5)
- Measure new/resolved finding delta

**Day 7: Decision**
- If ≥1 finding per 3 clients AND ≥15% judged "would call" → proceed to pilot
- If <1 finding per 6 clients → fix onboarding (offerings bottleneck)
- If findings are produced but agencies wouldn't call → fix judgment gate or rule design
- If competitor gaps are >30% yield → make them automatic, not opt-in

**Success criteria for the sprint:**
- ≥1 commercial finding per 3 clients analyzed
- ≥15% of findings rated "would call about" by agency
- ≥30% of competitor comparisons produce a gap
- ≥30% of manual rescans produce new or resolved findings

If any two of these fail, the product is not ready for external pilot. Fix the bottleneck and re-run.

---

## Final assessment

**Orbit is a legitimate revenue intelligence product with a sophisticated judgment layer wrapped around a thin commercial signal.**

The engineering is careful, the honesty constraints are real, and the judgment gate is the right architectural decision. But the product is currently optimized for *correctness* over *yield*. Every gate (coverage, evidence, judgment, evaluator cap) is a potential finding that doesn't reach the agency. The result is a product that rarely makes a false claim but also rarely makes any claim at all.

The path to first revenue is not more rules, better monitoring, or a client portal. It is:
1. **More findings per client** (fix the offerings bottleneck, relax the coverage gate where safe)
2. **Better findings** (validate the judgment gate against a real provider)
3. **Renewable findings** (competitor gaps, made automatic)

The product should be judged on one metric: **how many times this month an agency called a client because of something Orbit surfaced.** Everything else is engineering in service of that number.