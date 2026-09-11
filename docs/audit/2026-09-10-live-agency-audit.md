# Axiom Orbit live agency audit — 10 September 2026

## 1. Executive verdict

**Recommendation: limited beta only.** The live public experience communicates a focused and credible product: Orbit finds evidence-backed, billable work in existing client accounts, keeps contract coverage separate from opportunity, and leaves client communication under agency control. The strongest public moment is the interactive finding → evidence → proposal example.

The complete operational product could not be validated. `Request pilot access` leads to an explanation page with no form, email link, booking link, or other request mechanism. There was no existing authenticated session, invitation, or sanctioned production test account. Every protected product route correctly redirected to `/login`. As a result, onboarding, 10-client setup, analysis, monitoring, opportunity decisions, proposal generation/sharing, persistence, high-volume behavior, settings, exports, destructive actions, and returning-user workflows remain untested on production.

The public product is not ready for broad acquisition because a qualified visitor cannot request access from the CTA that promises that action. The authenticated product may be usable, but this audit did not obtain the evidence required to claim it.

## 2. Is Orbit genuinely usable today?

- **Invited user:** unknown; authentication credentials or an invitation are required to validate the product.
- **New agency owner arriving from the website:** no. They can understand the product but cannot enter or request the pilot.
- **Public marketing and account-recovery surfaces:** generally functional, responsive, and coherent.

## 3. Is it valuable enough to pay for today?

**Not on the evidence available.** The proposition is strong enough to justify a pilot: a grounded account-growth queue is more useful than another generic website audit. But a buying decision requires proof that the real findings are specific, that a 10–15-client portfolio remains manageable, that monitoring creates a reliable weekly habit, and that proposals save meaningful time. None of those core production workflows were accessible.

## 4. Product and workflow map

### Public and exercised

| Surface | Route | Result |
| --- | --- | --- |
| Homepage | `/` | Product promise, interactive finding/evidence/proposal example, workflow summary, monitoring summary, pilot CTA |
| Product overview | `/product` | Monitor, Understand, Find, Act, Grow chapters; current-vs-direction labels |
| Pilot access | `/signup` | Invitation-only explanation; no access-request mechanism |
| Sign in | `/login` | Required-field validation, malformed-email validation, rejected credentials, recovery link |
| Password recovery | `/forgot-password` | Required-field validation and neutral response for a synthetic nonexistent account |
| Password reset | `/reset-password` | Safe invalid/expired-link state |
| Invitation | `/invite/:token` | Safe invalid/expired-token state using a synthetic token |
| Proposal share | `/proposal/share` | Safe unavailable-link state without a token |
| Report share | `/report/share` | Safe unavailable-link state without a token |
| Privacy | `/privacy` | Data, crawler, subprocessors, export/deletion, and retention disclosures |
| Terms | `/terms` | Service boundary, acceptable use, availability, data, and liability |
| Unknown route | synthetic missing route | 404 state and recovery action |

### Protected and access-checked, but not exercised

`/onboarding`, `/changes`, `/monitor`, `/operations`, `/export/workspace`, `/opportunities`, `/opportunities/:id`, `/reports/:id`, `/clients`, `/clients/import`, `/clients/:id`, `/clients/:id/report`, `/services`, and `/settings` all returned HTTP 302 to `/login` without an authenticated session.

## 5. Workflows completed and data used

- Navigated the public marketing, product, legal, auth, recovery, invitation, share, and error surfaces.
- Exercised homepage tabs with pointer and keyboard arrow navigation.
- Edited the illustrative proposal with a long value prefixed `TEST DATA —`, switched tabs, confirmed the value persisted during the page session, previewed it, refreshed, and confirmed the page reset to its stated example default.
- Submitted login with `orbit-audit-nonexistent@example.com` and a synthetic password; received the generic rejected-credentials state and confirmed the email remained available for correction.
- Submitted password recovery for the same reserved-domain nonexistent address; received a neutral, enumeration-resistant response. No real person or business was contacted.
- Exercised missing reset token, invalid invitation token, missing share token, and unknown-route recovery.
- Checked desktop at 1440×900 and mobile at 390×844, including the responsive menu, Escape dismissal, anchors, browser Back/Forward, horizontal overflow, heading structure, labels, alternative text, duplicate IDs, and console errors.
- Confirmed unauthenticated protection for every known protected route.

No client records were created because the live product did not provide an authenticated test workspace.

## 6. What worked exceptionally well

1. **The promise is unusually specific.** The homepage quickly explains the job: find work worth proposing to clients the agency already manages, grounded in website evidence and matched to the agency catalog.
2. **The product boundary is honest.** `/product` explicitly says Orbit is not a CRM, generic scanner, SEO dashboard, lead-gen product, or cold-outreach tool. It labels current capabilities separately from direction.
3. **The example teaches the decision model.** It shows that a missing page matters only when the client offers the service, the agency sells the work, and the contract does not already cover it.
4. **The public interaction is coherent.** Finding → evidence → proposal works by pointer and keyboard arrows. A long draft survives tab changes, preview mode is clear, and refresh resets exactly as the copy says it will.
5. **Failure states are intentionally non-revealing.** Invalid login, password reset, invitation, and share-link states avoid leaking account or token validity beyond what the user needs.
6. **Responsive structure is stable.** No tested public route produced horizontal overflow at the mobile viewport. The mobile menu opened, exposed the correct links, closed with Escape, and returned focus to the trigger.
7. **Public technical quality was stable.** The tested pages returned promptly from Toronto (roughly 0.08–0.54 seconds for the HTML samples), protected routes redirected consistently, and the browser console recorded no warnings or errors during the exercised flow.

## 7. Confirmed functional defects

### F-01 — The pilot access CTA is a dead end

- **Severity:** High
- **Page/workflow:** Any `Request pilot access` CTA → `/signup`
- **Attempted:** Enter the pilot as a new agency owner.
- **Observed:** `/signup` contains 0 forms, 0 inputs, and 0 buttons. Its links are Home, Log in, the current Signup page, and Axiom. The copy tells the user to request access from Axiom but provides no way to do so.
- **Expected:** A short access-request form, a clearly labeled email link, or a booking/request destination with response expectations.
- **Consistency:** Reproduced on desktop and mobile after the production deployment.
- **Agency impact:** A qualified prospect cannot convert, reach onboarding, or produce first value. This also blocked the requested full product audit.
- **Fix:** Replace the explanation-only state with a minimal agency request form (name, work email, agency, approximate client count) and a clear confirmation/response SLA. If acquisition is intentionally closed, rename all CTAs to `Pilot details` and provide a contact route instead of promising a request action.

### F-02 — Unknown routes expose a raw framework error and send public users to a protected destination

- **Severity:** Medium
- **Page/workflow:** Any unknown public URL, reproduced at `/orbit-audit-missing-page`
- **Attempted:** Recover from a mistyped or stale link.
- **Observed:** The page displays `Error: No route matches URL ...`, has no document title, starts at H2, and offers only `Back to Opportunities`. Clicking it sends an unauthenticated visitor to `/login`.
- **Expected:** A branded H1 (`Page not found`), plain-language explanation, and context-aware Home/Sign in actions. Never show the framework exception to end users.
- **Consistency:** Reproduced on mobile and confirmed as HTTP 404.
- **Agency impact:** Looks unfinished and erodes trust when staff or clients follow an old link.
- **Fix:** Add a branded root error boundary with a proper title, H1, safe message, Home action, and an authenticated-only Opportunities action.

### F-03 — Unavailable shared-document states lack basic document semantics and recovery

- **Severity:** Medium
- **Page/workflow:** `/proposal/share` and `/report/share` without a valid token
- **Attempted:** Open an expired or incomplete client-facing share link.
- **Observed:** Both correctly return HTTP 404 and say the document is unavailable, but the document title is empty, the page starts at H2, there is no agency/product identity, and there is no recovery action.
- **Expected:** A descriptive page title, H1, branded or agency-branded context when safe, and a clear next step such as `Contact the agency that shared this` plus a non-sensitive fallback destination.
- **Consistency:** Reproduced for proposal and report shares.
- **Agency impact:** This is a client-facing failure state. Its anonymity makes a legitimate proposal resemble a broken or suspicious link.
- **Fix:** Give both routes a shared branded unavailable-state component with title, H1, safe context, and recovery guidance.

### F-04 — Protected deep links lose their return destination

- **Severity:** Medium
- **Page/workflow:** Direct unauthenticated request to any protected route, e.g. `/clients`
- **Attempted:** Open a protected deep link while signed out.
- **Observed:** The server returns `302 Location: /login` with no return parameter and no return-target cookie.
- **Expected:** Preserve a validated same-origin path and send the user back to it after successful authentication.
- **Consistency:** Reproduced across onboarding, changes, monitor, operations, export, opportunities, clients, services, and settings.
- **Agency impact:** Staff following a saved client/opportunity link or returning after session expiry must reconstruct where they were going.
- **Fix:** Store a short-lived, same-origin, allowlisted return path or append a signed/validated `returnTo` value; consume it after login.

## 8. UX and comprehension problems

### U-01 — Important product disclaimers miss normal-text contrast on `/product`

- **Severity:** Medium
- **Evidence:** Computed text color `rgb(111,111,118)` on `rgb(5,5,5)` is approximately 4.09:1, below the 4.5:1 WCAG AA threshold for normal text.
- **Affected content:** `Monitoring is off by default... no email or Slack alerts yet`, `Website sources plus agency-entered context — not a CRM sync`, current-vs-direction caveats, illustrative dates/status explanations, and pricing disclaimers.
- **Impact:** The least readable copy is often the copy that prevents a buyer from misunderstanding the product.
- **Fix:** Raise the muted token used for normal text to at least 4.5:1; keep lower-contrast styling only for nonessential decoration.

### U-02 — Illustrative product details become too small on mobile

- **Severity:** Medium
- **Evidence:** Several meaningful labels in `/product` render around 8.1–10.8 px at the tested mobile viewport.
- **Impact:** The examples are meant to prove the product, but a mobile buyer must zoom or skip the details.
- **Fix:** Reflow examples into stacked mobile cards with at least a 12–14 px floor for supporting copy; do not scale desktop-density diagrams down proportionally.

### U-03 — The product page introduces `Pipeline Engine` without context

- **Severity:** Low
- **Impact:** A first-time visitor has to infer whether it is another required product, an integration, or merely a portfolio distinction.
- **Fix:** Use plain copy (`Axiom's acquisition product...`) or link the name to a one-sentence explanation.

### U-04 — Several auth links have undersized mobile targets

- **Severity:** Low
- **Evidence:** The auth-header `Log in` target measured about 36×18.7 px; `Forgot password?` measured about 101×14.1 px.
- **Impact:** These remain visually understandable but are less forgiving for touch and motor accessibility.
- **Fix:** Add vertical padding so standalone navigation and recovery targets are at least 24 px high, preferably 44 px where layout permits.

## 9. Weak, misleading, or low-value outputs

- The homepage example is polished and honest, but it demonstrates one idealized HVAC missing-page case. It does not prove that real production findings avoid generic SEO noise, handle contradictory site evidence, or remain useful across 10 substantially different clients.
- The editable public proposal preview proves interaction quality, not actual time saved: no real proposal structure, agency branding, share experience, or recipient view could be validated.
- The product page says monitoring records results in the workspace with no email or Slack alerts yet. For a 10–15-client agency, a passive history is unlikely to create a weekly operating habit without a prioritized review queue or notification mechanism. The authenticated monitor could not be inspected.

## 10. Missing capabilities that block realistic agency use

Confirmed from the public product's own claims, not inferred from a generic CRM checklist:

- No usable path to request or start the pilot.
- No public pricing or buying model, so ROI cannot be compared with expected client expansion revenue.
- No email or Slack alerts for monitoring, as stated on `/product`.
- Revenue and outcome tracking are explicitly labeled future direction rather than a current capability.
- No CRM sync; the product says context is agency-entered. This may be acceptable for a small pilot but creates duplicate maintenance risk at 25–50 clients unless imports, bulk updates, or integrations are excellent. Those protected workflows were not accessible.

## 11. Cross-feature inconsistencies

- `Request pilot access` describes an action, but `/signup` only explains that access is restricted.
- The 404 recovery action assumes an authenticated product user (`Back to Opportunities`) even when the error occurs on a public route.
- Public marketing is carefully branded and explicit; public share-link error states lose the title, top-level heading, and identity.

## 12. Performance and reliability findings

- Fresh public HTML requests from the audit environment were approximately: Home 0.10 s, Product 0.11 s, Signup 0.09 s, Login 0.10 s, Reset 0.08 s; one Forgot-password sample was 0.54 s. These are request timings, not Core Web Vitals.
- No horizontal overflow was found on the tested public routes at the mobile viewport.
- No browser console warnings or errors were recorded during the exercised interactions.
- Responsive menu, tabs, anchors, Back/Forward, refresh, validation, error states, and redirects behaved consistently.
- Accessibility limits: screenshot and DOM checks do not establish full WCAG compliance. Screen-reader output, 200%/400% zoom, reduced motion, forced colors, and a complete keyboard traversal still require dedicated assistive-technology testing.

## 13. Prioritized issue table

| ID | Severity | Evidence | Agency impact | Recommended fix |
| --- | --- | --- | --- | --- |
| F-01 | High | `/signup`: 0 forms, 0 inputs, 0 buttons; every pilot CTA lands there | Blocks acquisition, onboarding, first value, and full validation | Add an actual request flow or rename the CTA and provide contact |
| F-02 | Medium | Unknown route shows raw router exception, blank title, H2, protected recovery link | Makes stale links look unfinished; loses trust | Branded root 404 with title/H1/Home and context-aware actions |
| F-03 | Medium | Proposal/report share failures have blank titles, H2, no identity/action | Client-facing broken links look suspicious | Shared branded unavailable state with recovery |
| F-04 | Medium | Protected routes 302 to bare `/login`; no return cookie | Staff lose deep-link context after sign-in/session expiry | Preserve validated same-origin return target |
| U-01 | Medium | Key muted text on `/product` measured ~4.09:1 | Critical caveats are easiest to miss | Raise muted normal-text contrast to ≥4.5:1 |
| U-02 | Medium | Mobile illustrative copy measured 8.1–10.8 px | Product proof is difficult to inspect on mobile | Reflow cards; enforce readable type floor |
| U-03 | Low | Unexplained `Pipeline Engine` reference | Adds avoidable first-visit ambiguity | Explain or link the product name |
| U-04 | Low | Mobile auth targets as short as 14–19 px | Reduced touch accessibility | Add vertical target padding |

## 14. Five highest-leverage improvements

1. Turn `Request pilot access` into a real conversion flow with a clear confirmation and response expectation.
2. Provide a dedicated, sanitized production test workspace or invitation so every release can be audited end to end with 10+ labeled test clients.
3. Make monitoring operational for a busy agency: prioritized weekly review, clear freshness, and notification/digest delivery.
4. Close the loop from proposal to sold/lost/delivered outcome so Orbit proves revenue, not only potential value.
5. Repair the public trust edges: branded 404/share failures, return-to-login behavior, mobile example readability, and contrast.

## 15. Realistic day-in-the-life evaluation with 10+ clients

The intended rhythm is credible: open a portfolio queue, see what changed, inspect evidence, decide whether work is billable, prepare a client conversation, and track what remains open. The homepage explains this better than most early products.

The real day-in-the-life could not be executed. With no test workspace, there is no evidence that Orbit answers the questions an operator needs at 9 a.m.: Which clients changed? Which findings are new versus stale? What is blocked by incomplete data? Can similar client names be distinguished? Can ten findings be triaged quickly? Can staff resume yesterday's work? Is the queue ordered by sellability? Do actions persist after refresh? Does monitoring fail visibly? Can proposals be shown to clients without manual cleanup?

Until those are exercised on production with 10–15 varied test clients, the public story remains a promising demo rather than a validated operating system for account growth.

## 16. Final recommendation

**Limited beta.** Keep Orbit invitation-only. Do not treat the current public site as a scalable acquisition funnel, and do not claim the operational suite is ready for 10, 25, or 50 clients from this audit. Fix the access-request dead end and run an authenticated production audit before broader release.

## 17. Retest checklist with explicit pass/fail criteria

### Access and onboarding

- **Pass:** Every `Request pilot access` CTA reaches a working form/contact action and confirmation; **fail:** it only explains access.
- **Pass:** A fresh invited user can create an account, verify it when required, create one workspace, and reach a meaningful first result; **fail:** setup completes without a useful finding/evidence state.
- **Pass:** Empty, invalid, duplicate, very long, and abandoned/resumed inputs preserve safe progress and explain recovery; **fail:** data is lost or errors are generic.

### 10-client operating test

- **Pass:** Create/import at least 10 clearly labeled test clients spanning HVAC, plumbing, roofing, landscaping, dental, automotive, construction, cleaning, legal, and restaurant scenarios; **fail:** repetitive setup becomes impractical or duplicates are ambiguous.
- **Pass:** Incomplete sites, similar names, long names, duplicate domains, invalid domains, and blocked reads remain distinguishable and recoverable; **fail:** Orbit guesses, merges, or silently drops them.
- **Pass:** Portfolio views make new, stale, resolved, inconclusive, covered, snoozed, sold, and lost work scannable; **fail:** staff need a spreadsheet to know what needs attention.

### Analysis and evidence

- **Pass:** Every surfaced claim has openable source evidence, a mapped agency service, contract-coverage status, freshness, and a next action; **fail:** a generic or unsupported finding is presented as sellable.
- **Pass:** Refreshing or navigating away during analysis yields an explicit resumable state; **fail:** duplicate runs, lost work, or uncertain billing.
- **Pass:** Re-analysis preserves agency decisions and historical truth; **fail:** dismissed/covered/sold work reappears as new.

### Opportunity and proposal workflow

- **Pass:** Accept, dismiss, snooze, cover, resolve, pitch, sell, lose, reopen/correct, draft, edit, preview, and share transitions persist after refresh and agree across all counts; **fail:** status or value differs by screen.
- **Pass:** A proposal is client-ready with minor editing, branded correctly, and never sent automatically; **fail:** it is generic, misleading, or loses edits.
- **Pass:** Expired/revoked share links show a titled, branded, accessible recovery state; **fail:** blank-title anonymous errors remain.

### Monitoring, scale, and reliability

- **Pass:** Weekly monitoring clearly shows last attempt, outcome, next run, failures, and what changed; **fail:** `nothing changed` cannot be distinguished from `could not check`.
- **Pass:** A 25- and 50-client seeded workspace remains fast and prioritizable; **fail:** lists, filters, search, or bulk work degrade into manual scanning.
- **Pass:** No console errors, no horizontal overflow at key breakpoints, all normal text meets contrast targets, and complete keyboard/screen-reader testing succeeds; **fail:** any critical task becomes inaccessible.

### Auth and recovery

- **Pass:** Protected deep links return to their validated destination after login; **fail:** users land at a generic home/queue.
- **Pass:** Password reset, invitation expiry, logout, session expiry, and invalid links are secure and recoverable; **fail:** tokens leak, users are stranded, or account existence is exposed.

## Evidence and limits

The live audit was run after deploying Cloudflare Worker version `0b0eac87-67f6-4917-ae96-03969a9e6b73`. Before deployment, the repository release gate passed under Node 24.19.0: 141 test files and 1,289 tests passed, followed by typecheck and production build. Production D1 reported no pending migrations. The live custom domain returned the same hashed JS/CSS asset set emitted by that build.

Screenshots were captured directly in the in-app browser for the desktop and mobile homepage, responsive navigation, finding/evidence/proposal states, mobile product page, signup dead end, rejected login, neutral password recovery, invalid reset link, expired share link, and 404 state. No claim about authenticated product quality is made without authenticated production evidence.
