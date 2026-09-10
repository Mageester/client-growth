# Axiom Orbit — Astra Product Audit

## 1. Executive Verdict

**Overall: 4.5/10. Verdict: YES, AFTER THESE SPECIFIC BLOCKERS.**

Orbit has the beginnings of a useful agency account-review product. It can turn public website evidence into work matched to an agency's services and prices, preserve a sales decision, and produce something an agency can show a client. I completed that sequence in an isolated workspace. It also has meaningful tenant isolation, input validation, and conservative evidence handling.

It is not ready for an aggressive paid launch. A new visitor cannot actually request the advertised pilot access. A successfully read website can be prevented from reaching the analysis engine. A shared report remains public after a refresh removes its revocation controls. The privacy disclosure contradicts the catalog assistant's implemented data transfer. The deployed paid monitoring feature is disabled, has no actionable purchase/contact path, and contains an additional broken manual-digest action when enabled locally.

The strongest immediate commercial route is a **paid, assisted portfolio review for a small agency**, with an explicit scope and human review of every recommendation. A broad recurring software subscription needs evidence that repeated scans produce work worth discussing after the initial cleanup. That evidence was not established by this audit.

| Dimension | Score / 10 | Reason |
|---|---:|---|
| Product clarity | 6.5 | The public promise identifies agencies and existing clients. Inside, findings, opportunities, projects, proposals, reports, and potential revenue compete for meaning. |
| First impression | 7 | Restrained identity, clear headline, credible restraint around illustrative examples. The main CTA immediately undermines that impression. |
| Visual quality | 6.5 | Consistent dark shell and a considered report treatment. Excessive scale and spacing postpone useful information; a selected client filter overflows on a compact screen. |
| Activation | 3 | Public access stops; an important readable-site case also stops before analysis. A second local site did activate successfully. |
| Time-to-value | 3.5 | Setup, site read, offering confirmation, analysis, and interpretation are separate cognitive steps. The first result may be a minor markup defect. |
| Core usefulness | 5.5 | Evidence, catalog pricing, contract coverage, proposal preparation, and outcome recording are useful together. Commercial significance is weaker than defect detection. |
| Returning-user value | 3 | History and preserved outcomes work. Automatic monitoring is unavailable in the deployed configuration, and repeated useful new work remains unproven. |
| Reliability | 6 | Strong deterministic tests and several successful real local workflows. Failures occur at the seams between otherwise tested components. |
| Trust | 4 | Isolation and share-token handling are encouraging. Inaccurate data disclosure and disappearing report-management controls are serious trust defects. |
| Differentiation | 5 | Agency-specific evidence, coverage, prices, and persistent decisions offer more than a chat transcript. Generic health findings and sales wrappers dilute that advantage. |
| Commercial readiness | 2.5 | No functioning inbound pilot request, no defined purchasable offer in the product, no current paid-monitor access path, and no audited willingness-to-pay evidence. |

These are reviewer judgments about the current experience, not measured customer satisfaction or market demand. No P0 was demonstrated. Five P1 blockers are detailed in section 4; they are not five security vulnerabilities.

**Audit basis and boundaries.** Audited September 9, 2026. Repository HEAD was `8bd4240486f26636cee6b73f681084e78a3cf95c` and the working tree began clean. The deployed Worker version inspected read-only was `4772248c-844a-40a5-9e3f-e2d36eee8073`, deployed at `2026-09-09T03:56:12.381Z`. Eleven asset filenames referenced by the deployed public product page matched the current local build. This supports frontend correspondence; it does not independently establish an exact deployed backend Git hash.

The deployed public journey was followed before inspecting authenticated pages. An authenticated Axiom Web session became available; those real records were inspected read-only. All account creation, site reads, analysis, proposal/report creation, invitations, imports, outcome changes, and deletion tests took place at `http://localhost:8799` using an isolated D1 database, synthetic accounts, a mock evaluator, and console email. Production configuration, customer records, messages, and provider usage were not changed. Public website reads made by the local crawler were bounded reads, not changes to those sites.

No production source was edited. The deliverables are this report and [audit evidence](docs/audit-evidence/2026-09-09/README.md). The local harness and credentials remain in ignored `.wrangler/astra-audit/`; credentials and real account email screenshots are excluded from the report evidence. The Product Design audit workflow informed the inspection. The user brief controlled scope where generic skill workflows would otherwise suggest implementation.

## 2. What Orbit Actually Is

Orbit today is a **workspace for agencies to review existing client websites, identify supported gaps or defects, attach the agency's services and prices, and prepare a client conversation**. It also contains opt-in scheduled reanalysis and digest infrastructure, gated by an operator-controlled entitlement. It is neither a complete account-growth system nor proof that a detected website issue represents additional client budget.

The essential nouns are:

| Concept | Actual responsibility |
|---|---|
| Workspace | Agency, service catalog, branding, members, and tenant boundary. |
| Client | Business name/domain, what the business sells, internal notes, contract coverage, optional competitors. |
| Evidence | Bounded public-page observations, crawl coverage and limitations, verification results. |
| Finding / opportunity | Rule-supported work mapped to a catalog service, price range, confidence, billability, and review/sales state. |
| Project | Primarily a derived grouping of findings in the UI. Its existence does not establish a confirmed package quote. |
| Proposal | Editable opportunity-specific copy and a fixed public share snapshot. |
| Client report | A separate persisted, styled snapshot assembled from selected findings, agency notes, and optional confirmed package inputs. |
| Monitoring | Weekly per-client due dates processed by a bounded scheduler; changes and digest history are additional persistent records. |

The most promising customer hypothesis is an owner or account lead at a small web/digital agency with roughly 15–100 maintained client sites and an existing habit of client reviews. That range is a proposed pilot segment, not a measured product limit or validated ICP. The agency must have authority to recommend work, real services to sell, and enough client context to reject irrelevant recommendations.

The strongest capability is the **connection between evidence and the agency's actual commercial context**: exact affected pages, catalog prices, existing contract coverage, preserved decisions, and an output that can begin a client conversation. A CRM generally needs someone to supply that website evidence. A spreadsheet can track the work but does not gather and reconcile it. ChatGPT can help interpret a site and draft prose, but the inspected product adds recurring state, tenant ownership, coverage exclusions, and a stable review history. Those are meaningful differences only when they reduce actual agency effort and survive ordinary return visits.

The primary risk is economic: Orbit may reliably find a finite set of low-value maintenance issues, package them as potential revenue, and run out of reasons to return after the first cleanup. More polished cards do not solve that. A repeat-review paid experiment must test it.

## 3. End-to-End User Journey

### Public entry and access

The deployed home page quickly communicates “grow the clients you already won.” The audience and account-growth direction are substantially clearer than a generic AI productivity pitch. Public product illustrations are labeled illustrative; I did not treat their numbers as customer proof. Product, privacy, terms, login, and access routes were inspected. The secondary Pipeline Engine mention creates an unnecessary second product decision before Orbit has earned attention.

The main request-pilot CTA leads to `/signup`. With production `SIGNUP_MODE=invite` and an empty allowlist, that page offers explanatory text and login links, but no way to submit a request. It tells a prospect to ask without providing the action that completes the ask. This is a conversion failure, not an argument for unrestricted signup.

### Activation in the isolated environment

1. Created and verified a synthetic account through the real local Worker/Better Auth endpoints using console-delivered verification. Browser login rejected incorrect credentials and succeeded with the correct ones. Blank/malformed form constraints were inspected.
2. Reached a zero-data onboarding screen. The AI catalog assistant occupies prominent space above required client setup. A preselected starter catalog is collapsed; its prices and empty descriptions can become proposal inputs with little conscious review.
3. Added `[TEST] Kids Connect Evidence Sample` against `kids-connect.ca`. Orbit read five pages and classified the crawl as exhaustive. The confirmation screen nevertheless said it could not read the client yet, immediately followed by an explanation that it had read the whole site and found no service pages.
4. Entered two clearly synthetic test offerings and saved. The client persisted, but Analyze site was disabled. Readiness reported only one of twelve checks limited. Returning Home suggested a first analysis that this client could not start. Re-reading the same structural site shape is not a remedy.
5. Added `[TEST] Salon Evidence Sample` against `www.tekniksalon.com`, reviewed seven site-suggested offerings, and completed analysis. The crawl read ten pages and produced H1 and meta-description findings, with exact affected URLs and catalog ranges. No paid evaluator quality is established by these deterministic health findings.
6. Opened a finding, created and edited proposal copy, created a local share, checked the anonymous public result, and revoked it. Marked the H1 work pitched and then sold for a synthetic $225. The recorded outcome was reflected in the product and survived a later analysis.
7. Reanalyzed the salon. Existing sales context remained. The current open finding was a missing meta description on `/collections/kashmir`, priced $200–$500 from the catalog. Repeated immediate analysis was rate-limited rather than silently duplicated. The rejection exposed an unfriendly raw timestamp, but the limit itself worked.
8. Generated a client report with selected supporting health work and synthetic notes. The report rendered as a coherent document. Anonymous sharing worked; refreshing the private preview removed sharing/revocation controls while the public snapshot remained available. Returning through the client offered a new builder instead of the saved report.

The audit was interrupted by inspection and reproduction, so elapsed audit time is **not** a valid onboarding stopwatch. Conceptually, even the successful path requires an agency to distinguish its own services from client offerings, confirm crawl suggestions, initiate analysis, judge whether a finding matters, and prepare the output. For the readable/no-service-page case, time-to-value is indefinite because the route blocks progress. A proposed release acceptance target is a first reviewable recommendation or an honest completed-no-opportunity result within ten minutes on a representative supported site; that is a target, not current measured performance.

### Returning use

There is useful persistence: client context, exact evidence, analysis history, proposals, and the synthetic sold outcome remained. A selected client's feed explicitly said there were no new opportunities and that open work was unchanged. This is better than relabeling the same finding as new.

The reason to open Orbit tomorrow is currently weak: manually check whether an already reviewed client changed, prepare an outstanding proposal, or record a sale. Production monitoring is gated off. In the isolated environment I enabled the local entitlement, saved one client to Weekly, and verified a next-check date and persisted monitoring state. This establishes UI configuration, not a successfully delivered production recurring service. The manual digest button did not execute its advertised action.

The compounding value could be credible when Orbit preserves what the agency dismissed, sold, already covers, and has verified as resolved, then brings back only material changes. History and parts of that state model exist; a proven recurring commercial yield and a managed sent-document lifecycle do not.

### Coverage of the accessible application

| Surface / interaction | Evidence and result |
|---|---|
| `/`, `/product`, `/signup`, `/login`, `/privacy`, `/terms` | Deployed public journey and copy inspected. Pilot request dead end reproduced. Legal pages inspected for product/data consistency, not a legal compliance certification. |
| Onboarding / partial setup | Real local auth and D1, two site shapes. Blocked path saved client context; successful site proceeded to results. Contradictory readiness traced into the engine. |
| Home / Clients / Opportunities | Deployed populated read-only views and local zero/small/32-client states. Search positive and no-match states worked. Client and finding filters, detail navigation, refresh, and repeated analysis exercised. |
| Client creation / edit / import | Offering confirmation and editing exercised. Thirty synthetic CSV clients imported without crawling; malformed domain, existing domain, and within-file duplicate rejected with row-specific explanations. |
| Services | Starter catalog inspected; manual synthetic service saved. Inverted $500–$100 range rejected; corrected $500–$900 saved. Unmapped service warning was honest. AI blank-input JSON error reproduced; successful provider generation not attempted. |
| Findings / proposal / outcome | Evidence read, proposal edited and shared, pitched and sold outcome recorded. Anonymous proposal response inspected; completed revocation returned 404. Reanalysis retained sold state. Other state semantics additionally inspected in tests/source; not every state transition was browser-replayed. |
| Client reports / public report | Generated and shared a synthetic report. Verified public 200 without cookies, fixed snapshot, loss of controls on refresh, and absent saved-report navigation. Print button clicked, but no saved PDF artifact was obtained or certified. |
| Competitors | Client's own domain rejected. Two explicitly synthetic example-domain competitors added; comparison returned an explicit insufficient-read limitation and claimed no gap. Successful real competitive-gap inference remains unverified in this run. |
| Monitor | Deployed entitlement denial inspected read-only. Local-only entitlement enabled, one cadence saved and persisted; manual digest wrong-action defect reproduced twice. No production cron or email delivery was exercised. |
| Settings / branding / Team | Navigation, account fields, report-style options, logo input, invite creation, wrong-email acceptance rejection, and revocation inspected. Real customer configuration was not changed. |
| Operations / export | Deployed operations read-only; count/detail mismatch found. Actual export endpoint tested with another local workspace: 200, private/no-store, no first-workspace client data. Export is reachable under Check health, not missing from the code. |
| Destructive controls | Synthetic unused imported client: wrong confirmation rejected; exact name deletion succeeded, portfolio fell from 32 to 31. Workspace-reset confirmation inspected but full destructive reset not executed. |
| Auth / return visits | Logout, protected report deep link, login, and local console password recovery exercised. A second verified local account received 404 for the first workspace's client, opportunity, and report. Anonymous access redirected to login. Recovery succeeded using a new password; no live email was sent. |
| Responsive use | Normal 1440×1000, laptop 1280×800, mobile 390×844, compact 355×767; dimensions read from the browser. Deployed public desktop and mobile shared-document checks supplement the app views. No screen-reader or full accessibility certification. |

Worker logs, HTTP status/header checks, DOM observations, saved screenshots, the current rule engine, and existing test suites supported the audit. No synthetic production load test, billing transaction, real prospect message, penetration-test campaign, backup restore, or week-long retention observation was performed. Historical acceptance documents were context, not substituted for present execution.

## 4. Critical Findings

Severity here reflects launch, activation, trust, and commercial importance. Effort estimates include a focused regression check, assume the current architecture, and are estimates rather than commitments.

### C1 — P1: The main acquisition CTA has no conversion action

**Route and reproduction:** On the deployed home or product page, select Request pilot access. Arrive at `/signup` while signed out.

**Observed:** The invitation-only page explains pilot access and offers login. It does not accept an access request, provide a contact address, or link to a booking/request workflow. Production was configured with invite-only signup and no allowlist. The generic Axiom credit is not an explicit access request.

**Expected:** A prospect can complete one clear action and knows what happens next. Invite-only admission can remain intact.

**Cause / location:** `app/routes/signup.tsx:54` derives availability from policy; the closed-page branch around `:216`–`:250` renders copy and login when there is no allowlist. Public CTAs route there. This is a missing conversion step, not a malfunctioning registration API.

**Consequence:** Every uninvited self-directed prospect reaches a dead end. Axiom loses intent at the moment it should be collecting it. High user and revenue impact; universal for this entry state; confidence high; effort roughly 1–3 hours for an explicit contact/request action and a clear response expectation.

**Resolution:** Add a functional Request an agency pilot action using a real Axiom-controlled destination and a specific next step. State the pilot scope and who it is for. Verify the complete click-to-request handoff without auto-enrolling or sending unsolicited messages.

Evidence: [live home](docs/audit-evidence/2026-09-09/01-live-home-desktop.png), [live access dead end](docs/audit-evidence/2026-09-09/02-live-pilot-dead-end.png), [deployment identity](docs/audit-evidence/2026-09-09/deployment-observation.json).

### C2 — P1: A readable site is blocked from the useful analysis it supports

**Route and reproduction:** Create a local client for `kids-connect.ca`, complete the site read, save test offerings and the starter catalog, then attempt Analyze site. The supplied offering labels were synthetic test input; this audit does not validate them as that business's actual services.

**Observed:** Five readable pages, exhaustive crawl, zero service pages. The UI says it could not read the site, later acknowledges reading the whole site, and disables analysis. Readiness simultaneously reports eleven of twelve rules ready. The same stored evidence, passed read-only through the unchanged rule engine, produces a `no-service-pages` candidate at raw confidence 0.9.

**Expected:** Separate unreadable evidence from a successfully read site with no service pages. Run eligible checks; suppress only claims the evidence cannot support. Do not force a sellable result: candidate validation, real offering confirmation, and evaluator/billability gates still apply.

**Cause / location:** `app/routes/clients.$id.tsx:597`–`:616` rejects the entire analysis on `!assessServiceCoverage(...).analyzable`; `:704`–`:705` applies the same global condition to the button. `app/routes/onboarding.tsx:390`–`:408` repeats the gate. The confirmation heading at `:922` and explanation at `:937` expose the contradictory model. `src/core/analysisReadiness.ts:8`–`:25` explicitly defines per-rule readiness. `src/core/rules/noServicePages.ts:37`–`:70` deliberately handles exhaustive, readable sites whose service coverage is not analyzable.

**Consequence:** The product blocks a class of clients for which it already implements a potentially valuable service-pages project. It also suppresses other checks that can use readable pages. An agency cannot repair this by guessing more offerings or retrying an unchanged site. High activation and revenue impact; frequency conditional on this site shape, observed directly and represented in the cached corpus; confidence high; effort approximately 0.5–1.5 engineering days.

**Resolution:** Use one capability/readiness result across setup, client CTA, action, and engine. Distinguish no readable evidence, limited service-page inference, and supported whole-site absence. Add an integration regression that uses the real readable/no-service-page fixture through the route, not just a pure-rule test. Confirm that JS shells, blocked sites, and incomplete crawls still fail closed for absence claims.

Evidence: [contradictory onboarding](docs/audit-evidence/2026-09-09/07-local-readable-site-called-unreadable.png), [disabled analysis](docs/audit-evidence/2026-09-09/08-local-analysis-disabled.png), [same-evidence rule and readiness reproduction](docs/audit-evidence/2026-09-09/readiness-reproduction.json). This proves a reachable candidate is gated away; it is not proof of a real customer's willingness to buy that work.

### C3 — P1: Sent reports lack a reliable retrieval and revocation lifecycle

**Route and reproduction:** Client → Create report → select work and notes → Generate → Create secure share link. Open the link anonymously. Reload the private `/reports/:id` page, then return to the client.

**Observed:** The public report still responds 200 without cookies after reload. The private page loses its share callout and Revoke active links control. The client has only Create report, which opens a fresh builder with no previous selection/notes loaded. The report is persisted; the ordinary navigation path has lost it. An owner with the private URL can work around revocation by creating another share to expose the controls again.

**Expected:** Saved reports should be retrievable from the client. Existing active shares should be visible and revocable whenever an authorized owner returns, independently of the immediately preceding POST response.

**Cause / location:** `app/routes/reports.$id.tsx:22`–`:29` loads the report and owner permission but no active-share state. `:63`–`:67` derives the link only from `actionData`. `:102`–`:123` renders revocation inside that transient-link branch. `app/routes/clients.$id.tsx:747` exposes creation but no saved-report listing. `src/db/clientReports.ts` persists snapshots and shares, but the application does not supply a report-list retrieval workflow.

**Consequence:** The moment after sending a client document is when an agency most needs to recover it, verify what was sent, and revoke outdated access. Lost controls damage trust and can prolong unintended link access. This is not an authentication bypass or public discovery of private reports. High user/trust impact; occurs on every shared-preview refresh; confidence high; effort approximately 1–2 days for durable metadata, minimal listing, and regressions.

**Resolution:** Return share status/count/expiry from the loader; show revocation independently of raw token availability. Keep token hashes at rest. Show saved report snapshots with date and private preview link on the client. Raw old tokens need not become recoverable: make a deliberate “create replacement link” path if needed. Test create → share → reload → revisit from client → revoke → anonymous 404.

Evidence: [before refresh](docs/audit-evidence/2026-09-09/16-local-report-share-before-refresh.png), [after refresh](docs/audit-evidence/2026-09-09/17-local-report-share-after-refresh.png), [HTTP and navigation reproduction](docs/audit-evidence/2026-09-09/report-sharing-reproduction.json).

### C4 — P1: The privacy promise does not describe the catalog assistant's implemented transfer

**Route and reproduction:** Read deployed `/privacy`, then inspect the agency catalog assistant on onboarding or Services and trace its provider request.

**Observed disclosure:** The DeepSeek paragraph says the provider receives only the client name, domain, and a single subject; it explicitly excludes page content, catalog, prices, and anything about the agency.

**Observed implementation:** The agency catalog generator submits the user-written agency summary and website evidence as the provider's user message. The crawler supplies URL, title, up to thirty headings, and a text excerpt up to 2,000 characters per readable page, with a twelve-page crawl bound. Production is configured for DeepSeek. The local mock environment declines catalog generation, so this audit did not send actual agency content to a paid provider.

**Cause / location:** `app/routes/privacy.tsx:84`–`:90` describes the narrow candidate evaluator as if it were the only AI use. `app/lib/catalog-assistant.server.ts:91`–`:114` builds website excerpts and `:120`–`:154` forwards summary/pages. `src/adapters/catalog/DeepSeekAgencyCatalogGenerator.ts:24`–`:31` builds that payload and `:49`–`:65` sends it. The Resend paragraph also describes account email without the now-implemented monitoring digest.

**Consequence:** Users cannot make an informed decision about entering agency information when the public promise is false for a feature prominently offered during setup. High trust and sales impact; conditional on using the assistant, not proof that every session transfers this data; confidence high on disclosure/payload mismatch; effort approximately 2–4 hours for a complete inventory and accurate copy, longer if product policy requires different behavior.

**Resolution:** Publish accurate per-feature data handling and add a short, specific explanation beside the catalog-generation action. Cover summaries, public-page excerpts, provider use, and digest recipients/content. Retain review-before-save and price provenance safeguards. Do not claim provider retention/training guarantees that Axiom has not actually verified. This is a product trust finding, not a legal opinion.

### C5 — P1: The recurring paid offer is neither reachable nor consistently described

**Route and reproduction:** Open deployed Monitor. Follow the only available action. Compare the public product capability text with the implemented scheduler and the locally enabled monitor screen.

**Observed:** Production `MONITOR_ENTITLEMENT_MODE=off` disables the advertised paid feature. The gate says to ask Axiom to enable it but supplies only Back to clients. There is no defined plan, request/purchase action, or delivery expectation. The public product page says monitoring has no email alerts yet, while Monitor advertises a weekly digest. Monitor also promises noticing something a competitor added, but scheduled orchestration runs normal client analysis; the competitor comparison is a separate explicit workflow.

**Cause / location:** `app/routes/monitor.tsx:171`–`:200` renders the gate and promises. `app/routes/product.tsx:153`–`:160` says no email alerts. `app/lib/monitoring.server.ts:187` invokes normal scheduled `runAnalysis`; `app/lib/competitors.server.ts` implements the separate comparison. The production runtime observation confirms the entitlement state. Keeping entitlement off is a legitimate launch control; presenting it as an actionable paid offer without the next step is the defect.

**Consequence:** Orbit's strongest claimed reason to return is unavailable to the current self-directed buyer. Axiom cannot honestly demonstrate the promised recurring service from the deployed experience. High revenue/retention impact; applies to deployed workspaces under the observed configuration; confidence high for availability and claim mismatch, unvalidated for customer demand; effort 0.5–1 day for truthful offer/access messaging plus the separate operational acceptance gate.

**Resolution:** Decide what is actually sold in the pilot: assisted one-time review, recurring client rechecks, or both. Provide an explicit request path and operator-owned enrollment process. Manually invoice/grant an allowlisted cohort if appropriate; Stripe is not required to validate revenue. Remove scheduled-competitor claims until that behavior is intentionally implemented and proven. Before selling monitoring, fix F1 and prove scheduled processing plus a real authorized digest delivery in a safe test cohort. Do not simply set production entitlement to open.

Evidence: [synthetic reproduction of the deployed gate](docs/audit-evidence/2026-09-09/14-local-monitor-gated.png), [runtime observation](docs/audit-evidence/2026-09-09/deployment-observation.json). The gated screenshot uses a synthetic local email to avoid retaining real account details.

## 5. Product / UX Findings

### U1 — P2: Minor health checks are promoted as account-growth revenue

**Observed:** The deployed Home's “Clients worth contacting” included an H1 repair worth $150–$300. In the local feed, health work is explicitly described as supporting work rather than the reason to call, yet it contributes to the prominent potential-revenue number and large Project wrappers. Two health findings initially appeared as two identically titled Site health improvement projects. The primary card leads with generic grouping and empty package-price information before the actual defect.

**Inference:** Finding an H1 omission does not establish a new budget, material commercial consequence, or a tactful client conversation. For some agencies it is already part of maintenance. Treating every catalog-priced defect as revenue risks weakening the agency's credibility. This does not mean all health repairs are valueless.

**Source:** `app/routes/changes.tsx:151` presents the contact list; `src/core/projectPackaging.ts:143`–`:144` groups health findings by rule/title and `:185` assigns the generic title. Contract coverage exists and should remain central. Commercial report package-price inputs also exist; the criticism is the feed's unhelpful default wrapper, not absence of every pricing control.

**Recommendation:** Lead with “what changed, why it matters, what to verify, what to propose.” Put routine hygiene in a compact maintenance section and keep it out of an implied expected-revenue total by default. Show a catalog range as a potential quote input, never as likely earned revenue. Give the agency one explicit relevance/coverage decision before elevating minor repairs into contact recommendations.

Impact high for perceived usefulness and willingness to return; frequency common in the audited results; confidence high for presentation, medium for buyer reaction; effort 1–2 days for a focused presentation/priority change. Evidence: [live H1 detail](docs/audit-evidence/2026-09-09/05-live-h1-opportunity.png), [laptop feed](docs/audit-evidence/2026-09-09/18-local-opportunities-laptop.png).

### U2 — P2: Setup promotes optional generation before the minimum useful action

The first onboarding screen gives the AI catalog assistant major prominence above required client inputs. Twelve default services are available behind a collapsed review, with prices but empty client-facing descriptions. The Services screen later warns that missing descriptions flow into proposals. A user can reasonably wonder why a tool that should review a client first needs to reconstruct the agency's entire catalog.

Recommendation: Present the agency/client distinction in one sentence, then a single first-client path. Make the selected catalog and pricing basis visible at a useful level; allow a brief, intentional starter-service review. Defer a full catalog reconstruction until the first analysis demonstrates a reason to invest. This is a sequencing change, not a request for another onboarding wizard.

High impact on activation, medium revenue impact, every first-time setup; confidence high for layout and defaults, medium for abandonment inference; effort 0.5–1 day. Evidence: [first onboarding screen](docs/audit-evidence/2026-09-09/06-local-onboarding-first-screen.png), `app/routes/onboarding.tsx:702` onward and `:447`–`:515` for starter catalog saving.

### U3 — P2: Several navigation promises do not match their destinations

Billing / Plans and payments opens the account email anchor. Integrations / Connected tools opens monitoring text, not connected applications. These labels imply implemented product areas that the destination does not deliver. The public product page additionally relegates outcomes to future direction even though I recorded a sold value successfully.

Recommendation: Rename the actual account/monitoring sections, remove nonexistent billing/integration promises, and maintain one accurate capability inventory for marketing and in-app descriptions. Surface the existing export under a plainly named data action; it currently lives under Check health. These are navigation/copy corrections, not reasons to build billing or integrations now.

Medium user and revenue impact, frequent during evaluation, confidence high, effort 1–3 hours. Source: `app/components/settings-navigation.tsx:38`–`:75`, `app/routes/product.tsx:203`; [Billing destination](docs/audit-evidence/2026-09-09/13-local-billing-anchor.png).

### U4 — P3: Error and branding controls expose implementation vocabulary

A blank catalog-assistant submission returns a serialized validation array with `code`, `path`, and `message` instead of a normal field error. The optional proposal-logo field asks a business user for a base64 data URL or HTTPS URL. The analysis cooldown and invitation expiry expose raw UTC timestamps. These are actual UI observations, but they rank below the blocked workflows.

Recommendation: Extract the human-readable validation message, associate it with the field, format dates in the workspace/browser locale, and provide a simple image-selection experience only if pilot users need branding. Do not build an asset-management subsystem. Confidence high; impact low–medium; frequency conditional; effort 2–6 hours for the error/date subset.

## 6. Functional / Reliability Findings

### F1 — P2: “Send me this week's digest” runs the save-preferences action

In the isolated environment, with entitlement enabled and console email configured, I saved a client to Weekly and clicked Send me this week's digest twice. Both times the status was **Digest preferences saved**. No digest-send history appeared. This is not a provider-delivery failure.

`app/routes/monitor.tsx:267`–`:268` includes a hidden `intent=save-digest-settings`; the send button at `:294` supplies another `intent=send-digest-now`. The action reads `form.get("intent")` at `:108`, so the first value selects preference saving. The browser's DOM inspection exposes the two named controls; hidden values are not exposed by that inspection surface, so the exact hidden value is established from source. `test/routes.monitor.test.ts:158` supplies only the intended send value and therefore misses the real form submission.

Expected: explicit send action, truthful success/failure, and a recorded send attempt. Use separate forms or an unambiguous submitter intent; include a browser or real-form serialization regression. The scheduled path is separate and was not shown to fail. Medium user impact, high importance to a paid-monitor demo, deterministic on every click of this control; confidence high; effort 1–3 hours. Evidence: [digest reproduction](docs/audit-evidence/2026-09-09/digest-form-reproduction.json), [control layout](docs/audit-evidence/2026-09-09/15-local-digest-wrong-action.png).

### F2 — P2: Operations reports failures without a corresponding investigation record

The deployed Check health page showed one analysis failure while Checks to investigate said there were no such checks. The failure counter reads `analysis_limit_reservations.failed`; the detail query only reads completed `analysis_runs` with evaluator errors or an inconclusive outcome. A failed start can therefore increase the headline without supplying a client/time/reason in the investigation list.

Source: `src/db/workspaceOperations.ts:210`–`:267`; rendering in `app/routes/operations.tsx`. Incomplete starts are already aged by ten minutes before counting, so this is not a claim that every active run is reported failed. The audit did not establish the cause of the real recorded failure.

Expected: every actionable failure count leads to a scoped record or an honest explanation of the missing detail. Join/project failed reservations into the investigation view with client, stage, time, and a safe reason where stored. Medium support/reliability and revenue impact; conditional on failed starts; confidence high on the observed count/detail mismatch; effort 0.5–1 day.

### F3 — P2: An expired session loses ordinary protected deep-link intent

After local logout, opening a private report redirected to bare `/login`. `app/lib/session.server.ts:64` sends that redirect without `returnTo`. Login supports a safe return target (`app/routes/login.tsx:15`), but ordinary protected loaders do not supply it. Invitation routes handle this explicitly. The result is lost task context when an agency returns through a saved internal link; it compounds C3's poor report retrieval.

Recommendation: Carry a validated relative return path through the standard auth guard and preserve its query string. Verify logout/expiry → protected report → login → same report. Medium user impact, conditional returning-user frequency, high confidence, effort 2–4 hours. This is not an open-redirect finding; the existing login sanitizer should remain.

### Working behaviors worth preserving

The audit confirmed row-level import feedback, no crawl on import, successful 30-row creation, useful no-match search, wrong-price rejection, duplicate own-site competitor rejection, and explicit inconclusive comparison feedback. Local analysis admission resisted immediate duplicate/repeat execution. Proposal revocation returned 404 after completion. Sold context survived reanalysis. An exact-name client deletion guard rejected wrong text and deleted only the selected synthetic client after the correct name.

Real local auth sessions were used for [cross-account HTTP checks](docs/audit-evidence/2026-09-09/account-boundaries.json). Another verified workspace could not read the first client's detail, opportunity, or report; its export did not contain first-workspace data. Public proposal/report responses used private/no-store and no-referrer headers. These checks provide bounded evidence, not a proof of all authorization paths or all sharing edge cases.

## 7. Engineering / Architecture Findings

### The architecture is viable; the damaging defects are integration contradictions

React 19 / React Router 7 renders routes and server actions inside a Cloudflare Worker. D1 persists auth, workspace and client state, catalog/coverage, opportunities/evidence, reports/shares, invitations, analysis admission/history, and monitoring/digests. Better Auth handles verified email/password and database sessions. Resend is the email adapter; DeepSeek is the configured production evaluator/catalog provider. The portable TypeScript domain code separates rules, evidence adapters, billability, pricing, and repositories from UI/Worker orchestration. All 26 migrations applied successfully to the isolated local database.

That separation is broadly sound. A microservice split or queue rewrite is not justified by the audit. The high-leverage engineering work is making each user-facing invariant authoritative across layers:

| Invariant | Current contradiction | Required boundary test |
|---|---|---|
| Readable evidence permits the rules it supports | Per-rule readiness says ready; routes block globally | Real evidence → route admission → rule execution → honest result |
| A shared document remains manageable on return | Persistent share exists; control visibility depends on POST data | Create/share → reload → retrieve → revoke → anonymous denial |
| A clicked action executes that action | Hidden intent wins over send-button intent | Serialize/render actual form, then execute its action |
| Published data statements describe actual adapters | Privacy describes evaluator only; catalog has a broader payload | Review every outbound provider payload against user-facing disclosure |
| Failure counters explain actionable failures | Reservations and run-detail projections omit each other's records | Failed reservation without analysis-run row → useful operations detail |

**Maintainability risks with demonstrated consequences:** readiness/admission logic is duplicated across onboarding and client routes; share UI state is not projected from its persistent authority; proposals and client reports implement overlapping outbound-document concepts with different retrieval/management behavior; product claims are independently maintained across marketing, upsell, and privacy. Consolidate these specific policies/projections. Do not consolidate unrelated code merely for symmetry.

**Security and trust boundaries:** Tenant-scoped repository calls and composite foreign keys are a real defense. Private report lookup checks tenant scope; owner permission controls report-share management; public share tokens are hashed and expiring. The tested invitation refuses a different email. Website evidence is treated as untrusted and bounded; the catalog generator constrains returned source URLs and does not let provider prose invent prices. Existing tests cover malformed provider output, SSRF/network boundaries, denial/unknown semantics, and concurrent admission. This audit did not demonstrate a production tenant escape or SSRF exploit. The documented DNS/network residual limitations remain residuals, not invented findings.

**Performance/operations:** The observed 32-client local portfolio and search did not expose a material delay. This is not a load test or proof at hundreds of active clients. Local Worker logs showed successful route/data responses for the exercised successful flows; intentional errors were presented in the UI. Manual analysis remains an observable request-bound operation with limits and history. Before paying cohorts scale, measure real crawl/provider latency, failure rates, and cost per accepted recommendation; the available evidence does not justify an N+1 or infrastructure-rewrite claim. No backup restore or production monitoring alert delivery was demonstrated here.

### What the tests actually prove

Ran `pnpm verify` once on Node `v24.13.1` / pnpm `10.12.1`: repository safety, production configuration preflight, **141 test files / 1,260 tests**, type generation/typecheck, and production build all passed. [Complete log](docs/audit-evidence/2026-09-09/verify.log). Expected error logs from fault-injection tests are not product failures. No full-suite rerun was used to hide or reinterpret a failure.

The suite meaningfully exercises auth schema compatibility, tenant persistence, migration/foreign-key safety, bounded request handling, admission/concurrency, deterministic rules, proposal/report snapshots, monitoring claims, and failure semantics. These are valuable. Many route/UI checks use direct action calls, static rendered markup, mocked session resolvers, and explicit synthetic form fields. `vitest.config.ts:17`–`:18` excludes `test/live/**` from the default suite. `package.json:28` makes verify local-only; it is not proof of Cloudflare deployment health, actual email delivery, live provider precision, or browser usability.

The clearest false-confidence cases are specific: thin-site rule semantics pass independently of the route that prevents reaching them; blocked-onboarding tests cover the unreadable case without integrating the readable/no-service case; report tests do not establish durable browser retrieval/revocation after reload; the digest route test constructs a cleaner form than the browser submits. Add a small acceptance set at these seams, not thousands of implementation-mirroring assertions.

### Crawler and evaluator evidence must not be conflated

| Current run | Result | What it establishes / does not establish |
|---|---|---|
| `pnpm analyzability --offline` on 24 cached sites | 19/24 analyzable; actual service-content pages read on 16/24; 3 SITE_TOO_THIN, 2 BLOCKED; 0 false-analyzable labels; 1 site with an obvious missed page | Current logic against cached HTTP evidence. 292 responses replayed, zero freshly fetched, 39 refused. Not current live reach or opportunity precision. |
| Existing UI-fixture candidate script against that corpus | 24 raw candidates: 4 service-page commercial candidates, 20 health candidates | Rule outputs before evaluator judgment; not 24 approved sales opportunities. Illustrates the importance of health/commercial distinction and the gated no-service-page rule. |
| `pnpm bench` | MockEvaluator adversarial set: 15/37 GOOD, 22 BAD, 22 false positives, 0 false negatives, 35 mock evaluator calls; command exited 0 | A diagnostic mock is weak on semantic decoys. This does **not** show production DeepSeek has a 59% error rate. Exit 0 does not mean the benchmark met a quality bar. |

Evidence: [analyzability](docs/audit-evidence/2026-09-09/analyzability.json), [raw candidate corpus](docs/audit-evidence/2026-09-09/current-corpus-candidates.json), [benchmark log](docs/audit-evidence/2026-09-09/bench.log). A current, authorized production-provider evaluation remains necessary before making sales claims about semantic recommendation quality. Historical real-site gauntlet documents are not a substitute for that gate. Missing live evidence is reported as unknown, not zero risk, zero cost, or a failing result.

## 8. Visual Quality Findings

The best parts of the visual system are its restraint, recognizable agency-oriented identity, limited accent palette, and readable document output. The app does not need another visual reinvention. It needs to spend less screen space announcing categories and more on the decision a user came to make.

| Priority / observation | Evidence | Effect and specific change |
|---|---|---|
| P2 — Results arrive too far down the page | At 1280×800, the first actual included finding falls near/below the bottom after headline, revenue summary, coverage, explanation, monitoring note, filters, section introduction, and Project wrapper. At 390×844, the first viewport largely contains navigation and setup for the result. | Compress repeated meta information into a short summary; make the first actual recommendation visible earlier. Retain readable touch targets and useful context. High frequency, high confidence; medium effort. |
| P2 — Generic project titles obscure the evidence | Repeated Site health improvement titles, empty Package price fields, and a second underlying-opportunity value repeat information before naming the defect. | Use the concrete recommendation as the title. Collapse single-finding wrappers and hide empty commercial fields until the agency is actually assembling a quote. High confidence; medium effort; overlaps U1 and should be fixed once. |
| P2 — Compact mobile selected-client filter overflows | At measured 355×767, selecting `[TEST] Salon Evidence Sample` gives a 300px control container a 323px scroll width. The compact navigation also exceeds its available width by about 9px. At 390px with All clients selected, the same overflow was not observed. | Bound the filter to available width, truncate or wrap the label accessibly, and keep the menu trigger visible. Verify a selected long name, not only the default. Medium impact, conditional frequency, high confidence; 1–3 hours. |
| P2 — Onboarding hierarchy favors an optional tool | The catalog assistant is the dominant early module while the required first-client setup is lower down. | Lead with the minimal first success and progressively expose agency-catalog work. This is the U2 change, not another redesign project. |
| P3 — Document cover takes precedence over the recommendation | The local report is visually considered, but its large cover and repeated Prepared by information postpone the summary. A health-only report then announces that no commercial priorities were selected. | Make report density depend on content. A short maintenance report needs a compact header and useful summary, not the same cover treatment as a multi-project review. Medium confidence on preference, high on observed layout. |
| P3 — App and proposal wording exposes internal machinery | Raw Markdown editing, confidence percentages, base64-logo instruction, UTC timestamps, and validation JSON leak implementation concepts into business tasks. | Use client-facing language at the handoff, retain detailed confidence/evidence internally, and show technical fields only where the agency needs them. |

References: [desktop report](docs/audit-evidence/2026-09-09/12-local-client-report-desktop.png), [laptop feed](docs/audit-evidence/2026-09-09/18-local-opportunities-laptop.png), [390px mobile](docs/audit-evidence/2026-09-09/19-local-opportunities-mobile-390.png), [355px selected-client defect](docs/audit-evidence/2026-09-09/20-local-mobile-client-filter.png), [measured dimensions](docs/audit-evidence/2026-09-09/responsive-selected-client.json). The original screenshot named `09-live-product-desktop.png` is desktop; it is not mobile evidence. Shared proposal layout was also inspected at 430×928.

Typography and borders were generally consistent enough that changing fonts, radii, accent colors, or animation would have low commercial leverage. I did not establish a contrast-ratio violation or an animation performance regression, so neither is asserted. Keyboard/screen-reader coverage and printed PDF pagination still require dedicated acceptance if those become launch requirements. The print control was exercised, but a successfully saved PDF was not available to inspect.

## 9. What Should Be Removed or Simplified

1. **Remove false destinations immediately.** Billing should not mean account email; Integrations should not mean monitoring prose. Name what the destination actually does.
2. **Collapse single-finding project wrappers.** A card should not need a project label, generic project title, underlying opportunity value, empty package price, and Work in motion to explain one missing description.
3. **Stop leading ordinary health work with an account-growth revenue implication.** Keep it available in a maintenance queue and include it in a proposal only after the agency judges relevance and coverage.
4. **Simplify the first-run choices.** Keep one first-client action and a small visible service/pricing confirmation. Move extensive catalog generation after the user understands the value.
5. **Converge the outbound-document workflow.** Proposals and reports can remain different presentations, but should share one understandable saved/sent/replaced/revoked lifecycle. Do not maintain two disconnected notions of “I sent this client something.”
6. **Remove capabilities from sales copy when they are not supplied.** Scheduled competitor-change detection is not established by the current monitor path. A capability roadmap is not a current paid entitlement.
7. **Reduce mandatory technical vocabulary.** Confidence, raw timestamps, validation objects, and encoded logo data should not be the default language of an agency review.
8. **Keep the useful persistent states.** Do not delete contract coverage, evidence limitations, dismissal/snooze/sold context, or history to make the UI look simpler. They prevent repeated irrelevant selling and form the best case for recurring software value.

These changes intentionally concentrate on comprehension and task completion. None requires a generic CRM, a new dashboard framework, or a new brand system.

## 10. Missing Product Connections

| Existing pieces | Missing connection | Smallest useful completion |
|---|---|---|
| Public CTA + controlled signup | Prospect intent never reaches an operator | Real pilot request/contact destination with a response expectation. |
| Site read + per-rule readiness + no-service-pages rule | Route admission contradicts the engine | One readiness/admission policy and truthful result states. |
| Catalog prices + contract coverage + findings | A defect's commercial relevance is assumed too early | One agency review decision: relevant, already covered, or ignore, before promoting contact value. |
| Findings + evidence + proposal | Evidence does not automatically become a persuasive business reason | A concise editable reason-to-raise, exact support, proposed deliverable, and confirmed price basis. Avoid invented impact estimates. |
| Report snapshots + expiring shares | Saved/sent documents cannot be managed naturally later | Client report list, stable private preview, durable active-share metadata and revocation. |
| Monitoring policy + scheduler + weekly digest | The deployed offer cannot be enrolled and one action is miswired | Explicit pilot entitlement process, fixed send action, authorized end-to-end delivery check. |
| Competitor comparison + Monitor sales promise | Manual comparison is described as recurring competitor detection | Correct the promise now; build scheduling only if a paid cohort demonstrates a need. |
| Sold outcomes + analysis history | Product copy and returning view underuse proven persistent value | Show what was proposed/sold and whether underlying evidence is now resolved; distinguish manual sales records from verified delivery. |
| Failure reservations + Operations | Count lacks actionable investigation detail | One joined failure timeline with stage/client/time and safe reason. |
| Login return-target support + protected routes | Session expiry loses the task | Common safe relative return path. |

The coherent target loop is: **choose client → review current evidence → reject covered/irrelevant work → confirm a recommendation and price → create and retrieve a client artifact → record decision → verify changes on later checks**. Orbit can perform important stretches of this loop today. It does not reliably complete the loop from acquisition through a return visit after sharing.

## 11. Revenue Readiness

### What would stop me taking a customer's money today

I would not present the current deployed app as an independently usable, recurring account-growth subscription. I would expect to intervene in access, explain contradictory capabilities, work around a legitimate site's blocked analysis, and recover shared reports manually. I also could not make an accurate promise about provider data processing using the current privacy page.

For an explicitly assisted review service, the technical scope can be smaller: Axiom can perform onboarding, validate each result, prepare the conversation, and charge for useful work delivered. That still requires truthful disclosure, controllable documents, and no knowingly blocked core site class. “Assisted” cannot be a label for concealing defects from a buyer.

The current product is most credible when saying: **“Review the client sites you already maintain, identify evidence-backed work that fits your services, and prepare the next client conversation.”** The word “revenue” should describe actual agency outcomes or a clearly labeled price range, not imply that summing catalog prices forecasts sales.

### Feature value and placement

| Capability | Input → output | Commercial assessment |
|---|---|---|
| Client import | Existing client list → persistent portfolio | Clear activation value for an agency. Keep; no need to build a CRM migration platform. |
| Website analysis | Domain + offerings + catalog → supported findings and limitations | Core capability. Must show useful completion for supported readable sites and be honest when no opportunity exists. |
| Contract coverage | Work already included → suppression of inappropriate upsells | Strong trust value and a real agency-specific distinction. Surface at the right moment. |
| Health findings | Public markup/evidence → repair suggestions | Useful supporting work, weak standalone reason for a recurring growth subscription. |
| Competitor comparison | Agency-selected rivals → corroborated gaps or limits | Potentially differentiated, but requires manual inputs and reliable coverage. Successful live commercial inference unproven in this run. |
| Catalog assistant | Agency summary/site → reviewable service draft | Helpful setup aid, not the product's core value. Disclosure must be fixed; provider success and quality were not live-validated here. |
| Proposals/reports | Reviewed findings + agency wording/price → client document | Strong immediate utility if the saved/sent lifecycle works. Current report retrieval and controls undermine it. |
| Sales outcomes | Agency decision/amount → persistent context and rollups | Useful lightweight feedback. Manual sale entry is not attribution, delivered work, or independently verified ROI. |
| Monitoring/digest | Selected clients + cadence → change history and notification | Best potential retention mechanism. Needs accessible enrollment, correct action wiring, and actual recurring delivery proof. |
| Team/branding/styles | People/identity choices → shared access and presentation | Supporting adoption value; further depth can wait until agencies pay and request it. |

### Smallest paid behavioral experiment

**Hypothesis, not validated demand:** Agencies with enough existing client sites and a real review cadence will pay Axiom to turn a short portfolio review into at least one credible client conversation, and some will pay again when a later review brings a material new reason to act.

After the concrete blockers below are fixed, offer **five agencies a clearly bounded paid pilot**. Proposed test offer: **CAD $300 for a 14-day assisted review of up to ten client sites**, including human validation, one review call, and usable client-facing recommendations. This is a deliberately testable price/scope assumption, not a market estimate or recommended permanent plan. Axiom should verify that the promised human effort fits the price before quoting it. Use a manual invoice and explicit pilot terms; do not build billing infrastructure to conduct this experiment.

Record actual behavior:

- Agency supplies the client list and confirms which services are already included in contracts.
- Axiom classifies each candidate as supported, relevant, already covered, too weak, or incorrect before showing it as billable work.
- Agency approves at least one recommendation for a real client conversation or explicitly explains why none is worth raising.
- Agency actually sends/uses the artifact; record the decision, time saved, objections, and any outcome without claiming causal revenue attribution prematurely.
- A second review tests whether there is a new material change and whether the agency chooses to pay for another review or monitoring period.

**Proposed decision thresholds:** Continue refining the offer if at least three of the first five qualified agencies pay, at least two use a reviewed artifact with a client, and at least two choose a paid continuation. These are small-sample operating thresholds, not statistical proof. If agencies pay for the first review but decline repeat value, sell a one-time/periodic review service and do not force a monthly SaaS model. If supported findings repeatedly produce “already covered” or “not worth discussing,” change the recommendation focus before expanding the crawler or sales UI. If few qualified agencies pay at all, investigate the problem/offer with observed objections before building more features.

No agencies were contacted in this audit. No price, conversion rate, customer result, retention rate, or willingness to pay was validated. Axiom must collect that evidence rather than treating this proposal as a sales result.

### Unit economics that still need measurement

Record website requests, provider calls and authoritative usage, failed/retried work, human validation minutes, and the number of recommendations an agency actually accepts. Measure cost **per useful accepted recommendation and per paid workspace**, not just cost per scan. Provider spending in this audit was not a production cost sample; local mock runs cannot establish gross margin. Unknown provider usage/cost should remain unknown. Default workspace/platform caps are useful protection, but caps do not prove a sustainable business.

## 12. Top 10 Highest-Leverage Changes

Exactly ten actions, ranked by expected effect on successful use and near-term revenue. Effort is rough implementation plus focused acceptance, excluding customer response time and external approvals.

| Rank | Action / why | Affected workflow | Expected impact | Rough effort | Evidence / confidence |
|---:|---|---|---|---|---|
| 1 | Repair per-rule analysis admission and truthful site states; existing useful rules must be reachable | First client → first result | Very high activation and usefulness | 0.5–1.5 days | C2, same-evidence engine/route contradiction; high |
| 2 | Finish the pilot request handoff and state a concrete assisted offer | Public visit → qualified paid conversation | Very high acquisition, minimal build cost | 1–3 hours plus offer decision | C1, live dead end; high on defect, offer demand unvalidated |
| 3 | Correct provider/data disclosures at the action and privacy page | Trust during catalog setup and sale | High trust; prerequisite to informed use | 2–4 hours | C4, exact adapter payload; high |
| 4 | Make reports retrievable and shares manageable after refresh | Prepare → send → return/revoke | High reliability and client-facing trust | 1–2 days | C3, browser + anonymous HTTP; high |
| 5 | Make the monitoring offer truthful and executable for an explicit cohort, including the digest intent fix and a delivery gate | Paid access → recurring review/notification | High retention/revenue readiness | 0.5–1 day code; operational delivery proof separately | C5/F1, runtime + repeated UI defect; high; recurrence value unknown |
| 6 | Put meaningful recommendations before health/revenue wrappers; require relevance/coverage review | Result → client conversation | High perceived usefulness and credibility | 1–2 days | U1, live/local feed and cached candidate composition; high presentation evidence, medium buyer-impact confidence |
| 7 | Reduce first-client setup to the smallest intentional catalog and site review | Signup → activation | Medium–high speed and comprehension | 0.5–1 day | U2, first-run browser evidence; high |
| 8 | Run the small paid pilot and measure actual artifact use plus paid continuation | Product output → Axiom revenue and learning | Very high decision value | 0.5 day preparation + 14 days observation | Section 11; hypothesis, not established demand |
| 9 | Add a small browser acceptance set for the demonstrated seams | Release → safe use | High prevention of repeated integration regressions | 0.5–1 day after fixes | Green suite missed C2/C3/F1; high |
| 10 | Finish return navigation and failure triage, with honest Settings labels and compact-width control bounds | Returning user → actionable next step | Medium support, trust, and usability | 0.5–1.5 days | F2/F3/U3 and measured mobile overflow; high |

Do not interpret these estimates as a promise to complete all ten in two days. Actions 1–5 are the immediate product/access/trust gates; action 8 determines whether deeper investment is commercially justified.

## 13. 48-Hour Ship List

This is the smallest high-leverage candidate release, not a mandate to squeeze unfinished work into a clock. If a gate is incomplete, keep the affected paid promise closed. No fixes in this list were implemented during the audit.

| Window | Ship | Acceptance that must be visible |
|---|---|---|
| First 4 hours | Functional pilot request action; a short explicit pilot scope/next step; accurate AI/digest disclosure; remove fake Billing/Integrations labels and unsupported scheduled-competitor copy | A new visitor reaches a real request destination; the user can identify what happens next; disclosures match all implemented outbound adapters. |
| Day 1 core | One per-rule analysis admission policy and corrected readable/no-service-page wording | The saved five-page fixture can run eligible checks through the actual route; unreadable/incomplete/JS-shell fixtures do not generate absence claims; browser completes either a supported recommendation or an honest no-opportunity result. |
| Day 1/2 core | Minimal saved-report list and durable active-share metadata/revocation | Create → share → refresh → leave → reopen from client → revoke → anonymous 404, without creating another link to expose controls. |
| Short parallel-sized fix, not a new system | Correct digest submit intent and add a real-form regression | Send now enters the send path and records truthful local success/failure; scheduled path remains independently tested. |
| Final release gate | Focused browser acceptance of the above, appropriate existing verification, and one explicitly authorized operational monitoring/email check if monitoring will be sold | Actual observed result is recorded; no mock or console-only result is represented as production email delivery. |

If report retrieval/revocation exceeds the available engineering capacity, explicitly withhold report sharing from the paid pilot until fixed and use a reviewed controlled artifact handoff; do not knowingly ship the current sharing promise. The release decision should prefer a smaller honest offer over unfinished claims. That is a scope decision, not a request to implement another report system.

Defer feed redesign, new report styles, additional rule families, CRM-like fields, competitor scheduling, and payment automation beyond this window. Start selling the defined assisted pilot only after its actual access, analysis, disclosure, and document-control gates are met.

## 14. Do-Not-Build List

- **A generic CRM:** contacts, tasks, lead pipelines, sequences, a sales inbox, and account notes everywhere. Orbit's value is discovering and reviewing supported work for existing clients.
- **A chatbot as the main interface.** It would not fix unavailable analysis or make sent reports manageable.
- **More opportunity categories before accepted-recommendation quality is measured.** Rule count is not customer value.
- **Automatic client outreach.** A weak or already-covered recommendation should not be sent faster. Human approval is central to the initial offer.
- **Stripe plans, coupons, metered billing, or a pricing configurator before paid demand.** Manual invoicing is sufficient for a small explicit pilot.
- **Scheduled competitor crawling because the current upsell copy mentions it.** Correct the copy; build only after observed demand and safe evidence quality justify the recurring cost.
- **A reporting design studio, more themes, or a logo asset manager.** Retrieve and revoke the existing documents first.
- **Broad integrations, Slack alerts, or CRM synchronization.** Prove one correct and useful notification channel first.
- **A microservice migration, general background-job framework, or database rewrite without measured operational need.** The demonstrated defects are policy/projection/form seams.
- **AI-driven prices, expected-revenue projections, or claimed ROI based on summed catalog ranges.** Preserve agency-controlled prices and distinguish estimates from recorded outcomes.
- **A full visual rebrand or animation pass.** Hierarchy, density, and truthful interaction labels have higher leverage.
- **Large dashboard and analytics expansion.** First measure whether agencies accept, use, pay for, and return for the recommendations.

## 15. Final Verdict

**YES, AFTER THESE SPECIFIC BLOCKERS.**

I would begin selling a narrowly scoped, paid, assisted Orbit pilot after fixing the analysis gate, providing a real access-request handoff, correcting provider disclosures, and making shared reports retrievable and revocable after a return visit. If the offer includes recurring monitoring, I would additionally require truthful capability copy, the manual-digest fix, explicit cohort enrollment, and an observed authorized scheduler/email delivery check.

I would not aggressively sell the current deployed experience as a self-serve recurring growth product today. It has real engineering and some real utility, but its acquisition, activation, document return flow, and recurring offer are not yet coherent enough to carry that promise. No customer-payment or repeat-value evidence was established here.

The decision after those fixes is behavioral: do agencies pay, use the recommendations with clients, and choose to pay again? If the answer is only “the first audit is useful,” sell the first audit. If repeated monitoring produces meaningful new reasons to act and customers pay for them, invest in the subscription. Do not build a larger product to avoid learning which of those businesses Axiom actually has.

**Audit completion:** The deployed product was exercised read-only; the core client-to-result-to-proposal-to-outcome flow and substantial adversarial cases were executed in isolation; consequential findings were traced to implementation; existing verification and diagnostic suites were run; screenshots and machine-readable evidence were saved. This report proposes fixes but implements none. The stated production-provider, email, PDF, load, accessibility, and paid-demand limits remain explicit.
