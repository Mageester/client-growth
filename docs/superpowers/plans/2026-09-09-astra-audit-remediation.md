# Axiom Orbit Astra Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair every repository-fixable launch, trust, reliability, clarity, and responsive defect in the September 9 Astra audit, verify the real local product flows, and deploy the verified build to production.

**Architecture:** Keep React Router actions/loaders, portable domain logic, and D1 repositories as the existing boundaries. Consolidate only the duplicated policies proven defective: analysis readiness, persistent report/share projection, pilot-request construction, authentication return targets, and operations failure projection. Product-copy and layout changes reuse existing components and persistence rather than adding billing, CRM, lead storage, or a new UI system.

**Tech Stack:** TypeScript 5.9, React 19, React Router 7, Cloudflare Workers/Wrangler, D1/SQLite, Vitest 3, pnpm 10.12.1, Node 24.x.

**Spec:** `docs/superpowers/specs/2026-09-09-astra-audit-remediation-design.md`

## Global Constraints

- Preserve untracked `ASTRA_PRODUCT_AUDIT.md` and `docs/audit-evidence/`; they are user-owned evidence and are never staged by this plan.
- AI proposes; humans confirm. A rule candidate, catalog range, or manual sale record is never presented as guaranteed relevance, delivery, ROI, or revenue.
- Unreadable, incomplete, coverage-limited, readable-with-no-service-pages, and completed-with-no-opportunity stay distinct.
- Analysis is admitted when at least one catalog-backed rule is ready; each limited rule suppresses only itself.
- Missing provider, delivery, cost, deployment, or commercial evidence remains `unknown` and is not substituted with mocks or cached evidence.
- Preserve tenant scope, composite foreign keys, hashed/expiring share tokens, owner-only share management, invitation-only access, rate limits, and safe return-target sanitization.
- Preserve exact Node `24.x`, pnpm `10.12.1`, local-only `pnpm verify`, migration/foreign-key gates, and tracked-file-only secret scanning.
- Monitoring remains operator-enabled. Do not open production entitlement or claim scheduled competitor detection.
- Do not add billing automation, CRM behavior, automatic outreach, scheduled competitor crawling, an asset manager, a report designer, new rule families, microservices, or broad analytics.
- Production deployment is authorized only after focused tests, independent reviews, `pnpm verify`, analyzability replay, design harness, browser acceptance, and `git diff --check` pass.

---

### Task 1: Make Per-Rule Readiness the Analysis Admission Authority

**Files:**
- Create: `app/lib/analysis-readiness.server.ts`
- Modify: `app/routes/clients.$id.tsx`
- Modify: `app/routes/onboarding.tsx`
- Modify: `src/pipeline/analyzeClient.ts`
- Test: `test/core.analysisReadiness.test.ts`
- Test: `test/routes.analysisReadiness.test.ts`
- Test: `test/routes.onboarding.test.ts`

**Interfaces:**
- Consumes: `assessAnalysisReadiness(ReadinessInput): AnalysisReadiness`, `assessServiceCoverage({ client, evidence })`, `suggestOfferings(...)`, `Client`, `Service`, and `EvidenceBundle`.
- Produces: `analysisReadinessForClient(input): AnalysisReadiness`, the only route-side builder for current catalog/client/evidence readiness.
- Produces: route admission defined as `readiness.catalog.matched > 0 && readiness.readyCount > 0`.

- [ ] **Step 1: Write the failing shared-readiness and route admission tests**

Add a literal exhaustive readable/no-service-pages fixture with at least three successful pages, `crawlExhaustive: true`, no service-like pages, one confirmed client offering, and an active `service-pages-build` catalog service. Assert:

```ts
expect(readiness.readyCount).toBeGreaterThan(0);
expect(readiness.rules.find((rule) => rule.ruleId === "no-service-pages")?.state).toBe("ready");
expect(renderedClientHtml).toContain("Analyze site");
expect(renderedClientHtml).not.toContain("disabled");
```

Exercise the actual client-detail and onboarding actions and assert the post is not rejected by the former global coverage error. Keep literal blocked/JS-shell/incomplete fixtures and assert no absence candidate is persisted.

- [ ] **Step 2: Run focused RED tests**

Run:

```text
pnpm exec vitest run test/core.analysisReadiness.test.ts test/routes.analysisReadiness.test.ts test/routes.onboarding.test.ts
```

Expected: FAIL because client detail and onboarding still gate on `coverage.analyzable` and describe the readable/no-service case as blocked.

- [ ] **Step 3: Add the shared readiness builder**

Implement this boundary in `app/lib/analysis-readiness.server.ts` using the repository's exact domain types:

```ts
export function analysisReadinessForClient(input: {
  client: Client;
  catalog: Service[];
  evidence: EvidenceBundle | null;
}): AnalysisReadiness {
  const coverage = input.evidence
    ? assessServiceCoverage({ client: input.client, evidence: input.evidence })
    : null;
  const readablePages = input.evidence
    ? input.evidence.site.pages.filter((page) =>
        page.status >= 200 && page.status < 300 && page.wordCount > 0,
      ).length
    : 0;
  const suggestedOfferings = input.evidence
    ? suggestOfferings({ evidence: input.evidence, existingOfferings: input.client.offerings, max: 8 }).length
    : 0;

  return assessAnalysisReadiness({
    catalog: input.catalog,
    offerings: input.client.offerings.length,
    lastCrawl: input.evidence
      ? {
          analyzable: coverage?.analyzable ?? false,
          readablePages,
          suggestedOfferings,
          limitation: coverage?.limitation ?? null,
        }
      : undefined,
  });
}
```

- [ ] **Step 4: Replace every global route gate**

Use the shared builder in both loaders and actions. Set:

```ts
const canAnalyze = readiness.catalog.matched > 0 && readiness.readyCount > 0;
```

Reject crafted posts only when `canAnalyze` is false, with a readiness-derived explanation. Render zero-readable, coverage-limited, and exhaustive-no-service wording from the same readiness state. Delete stale comments in `src/pipeline/analyzeClient.ts` that imply global service coverage controls all rules; do not change the pipeline's per-rule fail-closed semantics.

- [ ] **Step 5: Run GREEN and regression suites**

Run:

```text
pnpm exec vitest run test/core.analysisReadiness.test.ts test/core.noServicePages.test.ts test/core.analysisOutcome.test.ts test/routes.analysisReadiness.test.ts test/routes.onboarding.test.ts test/pipeline.analyzeClient.test.ts test/pipeline.blockedCoverage.test.ts test/integration.analysisRuns.test.ts test/integration.analyze-persist.test.ts
```

Expected: PASS; readable no-service evidence reaches eligible rules, while blocked/incomplete evidence cannot create absence claims.

- [ ] **Step 6: Commit the slice**

```text
git add app/lib/analysis-readiness.server.ts app/routes/clients.$id.tsx app/routes/onboarding.tsx src/pipeline/analyzeClient.ts test/core.analysisReadiness.test.ts test/routes.analysisReadiness.test.ts test/routes.onboarding.test.ts
git commit -m "fix(orbit): admit analysis by ready rule"
```

---

### Task 2: Make Saved Reports and Share Controls Durable

**Files:**
- Modify: `src/db/clientReports.ts`
- Modify: `app/routes/reports.$id.tsx`
- Modify: `app/routes/clients.$id.tsx`
- Test: `test/db.clientReports.test.ts`
- Test: `test/routes.clientReports.test.ts`

**Interfaces:**
- Consumes: existing `client_report_snapshots`, `client_report_shares`, `getClientReportById`, `createClientReportShare`, `revokeClientReportShares`, and public hashed-token lookup.
- Produces: `ClientReportSummary`, `ClientReportShareMetadata`, `listClientReportSummaries(scope, clientId, now?)`, and `listActiveClientReportShares(scope, reportId, now?)`.

- [ ] **Step 1: Write failing repository projection tests**

Use two reports and multiple shares with literal timestamps. Assert newest-first report ordering and active-share filtering:

```ts
expect(summaries.map((report) => report.reportId)).toEqual([newerReportId, olderReportId]);
expect(activeShares.map((share) => share.shareId)).toEqual([activeShareId]);
expect(JSON.stringify(activeShares)).not.toContain(rawToken);
```

Also assert tenant B receives no summaries/metadata for tenant A.

- [ ] **Step 2: Run repository RED tests**

Run:

```text
pnpm exec vitest run test/db.clientReports.test.ts
```

Expected: FAIL because the list and persistent share-metadata projections do not exist.

- [ ] **Step 3: Implement tenant-scoped report/share projections**

Add narrow additive types:

```ts
export interface ClientReportSummary {
  reportId: string;
  clientId: string;
  generatedAt: string;
  recommendedProjectCount: number;
  supportingProjectCount: number;
  activeShareCount: number;
  nearestActiveShareExpiresAt: string | null;
}

export interface ClientReportShareMetadata {
  shareId: string;
  createdAt: string;
  expiresAt: string;
}
```

Queries must include `workspace_id`, use `generated_at DESC, id DESC`, and define active as `revoked_at IS NULL AND expires_at > now`. Parse only stored snapshot counts. Never select or expose `token_hash`.

- [ ] **Step 4: Write failing route lifecycle tests**

Extend the existing report route fixture to perform:

```ts
const createdShare = await reportAction(/* create share */);
const reloaded = await reportLoader(/* private GET, no actionData */);
expect(reloaded.activeShares).toHaveLength(1);
expect(renderReport(reloaded)).toContain("Revoke active links");
expect(renderClient(clientLoaderData)).toContain(`/reports/${reportId}`);
```

Then revoke and assert the anonymous loader throws a 404 response.

- [ ] **Step 5: Project persistent state into the report and client loaders**

Load independent report/share queries with existing parallel loader work. Keep the immediate raw `shareUrl` only in POST action data. Render persistent active count/expiry and owner-only revoke controls on every private visit. Label link creation `Create replacement link` when an active share exists. Add a compact Saved reports list to client detail with date, project counts, private preview link, and active-share state.

- [ ] **Step 6: Run GREEN and security regressions**

Run:

```text
pnpm exec vitest run test/db.clientReports.test.ts test/routes.clientReports.test.ts test/proposalShares.test.ts test/routes.tenantIsolation.test.ts
```

Expected: PASS; create/share/reload/reopen/revoke works, cross-tenant access remains denied, and anonymous access is 404 after revocation.

- [ ] **Step 7: Commit the slice**

```text
git add src/db/clientReports.ts app/routes/reports.$id.tsx app/routes/clients.$id.tsx test/db.clientReports.test.ts test/routes.clientReports.test.ts
git commit -m "fix(orbit): retain report share controls"
```

---

### Task 3: Add a Real Pilot Handoff and Accurate Provider/Monitoring Disclosures

**Files:**
- Create: `app/lib/pilot-request.ts`
- Modify: `app/routes/signup.tsx`
- Modify: `app/routes/privacy.tsx`
- Modify: `app/components/catalog-assistant.tsx`
- Modify: `app/routes/monitor.tsx`
- Modify: `app/routes/product.tsx`
- Modify: `app/routes/_index.tsx`
- Test: `test/routes.signupAccess.test.ts`
- Test: `test/app.publicPages.test.ts`
- Test: `test/routes.catalogAssistant.test.ts`
- Test: `test/routes.monitor.test.ts`
- Test: `test/app.marketing.test.ts`

**Interfaces:**
- Produces: `pilotRequestHref(): string`, reused by signup and locked Monitor.
- Preserves: invite/allowlist decisions and all existing authenticated signup paths.

- [ ] **Step 1: Write failing pilot-action and truthful-copy tests**

Assert the closed signup and locked Monitor render one link whose parsed URL has:

```ts
expect(url.protocol).toBe("mailto:");
expect(url.pathname).toBe("hello@getaxiom.ca");
expect(url.searchParams.get("subject")).toBe("Axiom Orbit agency pilot request");
expect(url.searchParams.get("body")).toContain("Agency name:");
expect(url.searchParams.get("body")).toContain("Client sites managed:");
```

Assert visible copy includes `14-day assisted review`, `up to ten client sites`, and `within two business days`. Add negative assertions for scheduled competitor detection, nonexistent email behavior, and the narrow privacy claim that excluded agency/page data.

- [ ] **Step 2: Run focused RED tests**

Run:

```text
pnpm exec vitest run test/routes.signupAccess.test.ts test/app.publicPages.test.ts test/routes.catalogAssistant.test.ts test/routes.monitor.test.ts test/app.marketing.test.ts
```

Expected: FAIL on absent mailto action and contradictory disclosure/monitoring copy.

- [ ] **Step 3: Implement the shared pilot request URL**

Use `URLSearchParams` so subject/body are encoded once:

```ts
const PILOT_BODY = [
  "Agency name:",
  "Client sites managed:",
  "Current client-review process:",
  "What you want the review to help with:",
].join("\n");

export function pilotRequestHref(): string {
  const query = new URLSearchParams({
    subject: "Axiom Orbit agency pilot request",
    body: PILOT_BODY,
  });
  return `mailto:hello@getaxiom.ca?${query.toString()}`;
}
```

Render it as the closed signup's primary action and the locked Monitor's contact action. Do not add a database write or auto-enrollment.

- [ ] **Step 4: Correct disclosure and capability copy**

Describe candidate evaluation, catalog-assistant summary/bounded public-page excerpts, account/invitation/recovery email, and monitoring-digest recipient/content separately. Add a concise disclosure beside `Build my service catalog`. Do not claim unverified provider retention/training guarantees.

Reconcile marketing and Monitor language: weekly client rechecks plus optional digest for enrolled workspaces; digest depends on configured transport; competitor comparison is manual and separate. Remove/subordinate Pipeline Engine from the first public impression.

- [ ] **Step 5: Run GREEN suites**

Run the Step 2 command again. Expected: PASS with invite-only behavior and return targets unchanged.

- [ ] **Step 6: Commit the slice**

```text
git add app/lib/pilot-request.ts app/routes/signup.tsx app/routes/privacy.tsx app/components/catalog-assistant.tsx app/routes/monitor.tsx app/routes/product.tsx app/routes/_index.tsx test/routes.signupAccess.test.ts test/app.publicPages.test.ts test/routes.catalogAssistant.test.ts test/routes.monitor.test.ts test/app.marketing.test.ts
git commit -m "fix(orbit): make pilot and monitoring claims actionable"
```

---

### Task 4: Repair Digest Intent, Failure Investigation, and Auth Return Paths

**Files:**
- Create: `app/lib/return-to.ts`
- Modify: `app/lib/session.server.ts`
- Modify: `app/routes/login.tsx`
- Modify: `app/routes/signup.tsx`
- Modify: `app/routes/monitor.tsx`
- Modify: `src/db/workspaceOperations.ts`
- Modify: `app/routes/operations.tsx`
- Test: `test/routes.monitor.test.ts`
- Test: `test/db.workspaceOperations.test.ts`
- Test: `test/routes.loginReturnTo.test.ts`
- Test: `test/routes.signupReturnTo.test.ts`
- Test: `test/routes.tenantIsolation.test.ts`

**Interfaces:**
- Produces: `safeReturnTo(value): string | undefined` and `requestReturnTo(request): string`.
- Produces: unified operations investigation rows with `kind`, `clientName`, `stage`, `at`, and safe `reason`.
- Preserves: `requireSession`, `requireTenant`, digest persistence, and all tenant authorization.

- [ ] **Step 1: Write three failing seam regressions**

1. Render the actual Monitor component and assert the send form serializes exactly one `intent=send-digest-now`, while the preferences form serializes exactly one `intent=save-digest-settings`.
2. Create an aged failed reservation without a completed run and assert `failedStarts === 1` and one matching investigation row with the literal fallback `The run stopped before a detailed record was created.`
3. Request `/reports/report-1?view=summary` anonymously and assert the guard redirects to `/login?returnTo=%2Freports%2Freport-1%3Fview%3Dsummary`; assert `https://evil.example`, `//evil.example`, and malformed values resolve to `/` after login.

- [ ] **Step 2: Run focused RED tests**

Run:

```text
pnpm exec vitest run test/routes.monitor.test.ts test/db.workspaceOperations.test.ts test/routes.loginReturnTo.test.ts test/routes.signupReturnTo.test.ts test/routes.tenantIsolation.test.ts
```

Expected: FAIL for duplicate form intent, missing failure row, and bare login redirect.

- [ ] **Step 3: Split the digest forms and preserve outcome truth**

Close the preferences form after its Save button. Render a second form containing only:

```tsx
<input type="hidden" name="intent" value="send-digest-now" />
<button type="submit" disabled={busy || !emailConfigured}>
  Send me this week&apos;s digest
</button>
```

Keep sent, skipped, unconfigured, and failed messages derived from `sendDigestNow`'s actual result and existing digest history.

- [ ] **Step 4: Unify operations count and investigation rows**

Select aged failed reservations with a workspace-constrained left join to clients. Produce one row for each counted failure; use stored safe summaries for completed runs and the exact fallback for a failed start with no detailed run. Derive `failedStarts` from those same rows. Do not expose raw provider exceptions or payloads. Update Operations rendering to show client, stage, locale-formatted time, and reason.

- [ ] **Step 5: Centralize and carry safe return paths**

Move the duplicated sanitizer from login/signup into `app/lib/return-to.ts`:

```ts
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  try {
    const parsed = new URL(value, "https://orbit.invalid");
    return parsed.origin === "https://orbit.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : undefined;
  } catch {
    return undefined;
  }
}

export function requestReturnTo(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}
```

`requireSession` redirects to `/login?returnTo=${encodeURIComponent(requestReturnTo(request))}`. Login remains the final sanitizer before navigation.

- [ ] **Step 6: Run GREEN and adjacent regressions**

Run the Step 2 command plus:

```text
pnpm exec vitest run test/monitorDigest.tick.test.ts test/db.monitorDigests.test.ts test/resend.monitorDigest.test.ts test/routes.clientReports.test.ts
```

Expected: PASS with no cross-tenant or open-redirect regression.

- [ ] **Step 7: Commit the slice**

```text
git add app/lib/return-to.ts app/lib/session.server.ts app/routes/login.tsx app/routes/signup.tsx app/routes/monitor.tsx src/db/workspaceOperations.ts app/routes/operations.tsx test/routes.monitor.test.ts test/db.workspaceOperations.test.ts test/routes.loginReturnTo.test.ts test/routes.signupReturnTo.test.ts test/routes.tenantIsolation.test.ts
git commit -m "fix(orbit): close reliability seams"
```

---

### Task 5: Put Reviewed Recommendations Before Maintenance and Simplify Onboarding

**Files:**
- Modify: `app/lib/actionCenter.ts`
- Modify: `src/core/projectPackaging.ts`
- Modify: `app/routes/changes.tsx`
- Modify: `app/routes/opportunities._index.tsx`
- Modify: `app/components/signal-desk.tsx`
- Modify: `app/routes/onboarding.tsx`
- Modify: `app/lib/catalog-assistant.server.ts`
- Modify: `app/routes/services._index.tsx`
- Modify: `app/routes/clients.$id.report.tsx`
- Modify: `app/components/client-report.tsx`
- Test: `test/app.actionCenter.test.ts`
- Test: `test/core.projectPackaging.test.ts`
- Test: `test/app.approvedRedesign.test.ts`
- Test: `test/routes.onboarding.test.ts`
- Test: `test/routes.catalogAssistant.test.ts`
- Test: `test/core.clientReport.test.ts`
- Test: `test/routes.clientReports.test.ts`

**Interfaces:**
- Consumes: existing commercial/site-health classification and opportunity statuses.
- Produces: `new` health work as maintenance review; progressed health (`accepted`, `proposal_prepared`, `pitched`, `sold`) remains visible in the contact/proposal path.
- Preserves: covered/dismissed/snoozed/sold/resolved state and agency-controlled price inputs.

- [ ] **Step 1: Write failing hierarchy and onboarding tests**

Assert a literal new H1 health finding is absent from `Clients worth contacting`, present under `Maintenance review`, and excluded from the contact-value total. Change it to `proposal_prepared` and assert it appears in the progressed contact/proposal path.

Assert a one-finding package title equals the concrete finding title, not `Site health improvement`, and empty package-price fields do not render. Assert first-client fields occur before `AI catalog assistant` in rendered onboarding HTML.

For blank catalog input, assert the response contains a human message such as `Describe the agency or add its website.` and does not contain `"code"`, `"path"`, or a serialized Zod issue array.

- [ ] **Step 2: Run focused RED tests**

Run:

```text
pnpm exec vitest run test/app.actionCenter.test.ts test/core.projectPackaging.test.ts test/app.approvedRedesign.test.ts test/routes.onboarding.test.ts test/routes.catalogAssistant.test.ts test/core.clientReport.test.ts test/routes.clientReports.test.ts
```

Expected: FAIL on health promotion, generic wrappers/empty price, assistant order, and validation JSON.

- [ ] **Step 3: Reclassify health work without changing persistence**

Use existing status as the human decision boundary. New site-health entries remain maintenance; positive progress (`accepted`, `proposal_prepared`, `pitched`, or recorded sold state) moves them into the contact/proposal workflow. Exclude unreviewed health ranges from the prominent contact total. Label remaining ranges `Potential quote input`.

For a single finding, return its concrete title from `projectTitle`; preserve family titles for multi-finding packages. In opportunity/project views, lead with finding/evidence and hide `Package price` until an explicit package amount exists.

- [ ] **Step 4: Simplify first-client sequencing and errors**

Move `<CatalogAssistant deferSave ... />` below the agency/client/read form and starter-service confirmation without changing hidden reviewed-catalog serialization. Keep it optional and retain the same crawl-only first action.

When catalog request validation throws a `ZodError`, return `error.issues[0]?.message` through the existing action error shape. Do not surface schema codes/paths.

- [ ] **Step 5: Strengthen proposal/report handoff**

Reuse stored `rationale`, evidence refs/affected URLs, `suggestedScope`, mapped service, and agency-confirmed price. Ensure the editable proposal/report surface presents these as reason to raise, support, deliverable, and price basis. Do not generate impact/ROI text or infer a sale.

- [ ] **Step 6: Run GREEN suites**

Run the Step 2 command again plus:

```text
pnpm exec vitest run test/app.portfolio.test.ts test/core.opportunityState.test.ts test/routes.opportunityOutcome.test.ts
```

Expected: PASS with persistent decision semantics unchanged.

- [ ] **Step 7: Commit the slice**

```text
git add app/lib/actionCenter.ts src/core/projectPackaging.ts app/routes/changes.tsx app/routes/opportunities._index.tsx app/components/signal-desk.tsx app/routes/onboarding.tsx app/lib/catalog-assistant.server.ts app/routes/services._index.tsx app/routes/clients.$id.report.tsx app/components/client-report.tsx test/app.actionCenter.test.ts test/core.projectPackaging.test.ts test/app.approvedRedesign.test.ts test/routes.onboarding.test.ts test/routes.catalogAssistant.test.ts test/core.clientReport.test.ts test/routes.clientReports.test.ts
git commit -m "fix(orbit): prioritize reviewed recommendations"
```

---

### Task 6: Make Settings, Dates, Reports, and Compact Layouts Honest

**Files:**
- Modify: `app/components/settings-navigation.tsx`
- Modify: `app/routes/settings.tsx`
- Modify: `app/routes/operations.tsx`
- Modify: `app/routes/invite.$token.tsx`
- Modify: `app/routes/reports.$id.tsx`
- Modify: `app/components/client-report.tsx`
- Modify: `app/routes/opportunities._index.tsx`
- Modify: `app/styles/orbit-approved.css`
- Test: `test/app.approvedRedesign.test.ts`
- Test: `test/app.ui.test.ts`
- Test: `test/routes.clientReports.test.ts`
- Test: `test/routes.teamInvitations.test.ts`

**Interfaces:**
- Consumes: existing `formatDate(value, withTime?)`, `time[dateTime]`, report snapshot commercial/supporting project split, and selected-client control.
- Produces: truthful Settings labels and content-sensitive report density with no new theme or persistence model.

- [ ] **Step 1: Write failing label/date/density/layout tests**

Assert Settings renders exactly:

```ts
expect(labels).toEqual(["General", "Monitoring", "Services", "Data and health", "Team", "Account"]);
```

Assert descriptions match the spec, export remains visible, and `Billing`, `Integrations`, and `Plans and payments` are absent.

Render pending invitation/report dates and assert a `<time dateTime="<ISO>">` contains `formatDate(iso)`, not raw ISO or `.slice(0, 10)`. Render health-only versus multi-project reports and assert distinct `data-report-density="compact"` / `"full"` values.

Add a CSS behavior guard for bounded selected-client trigger rules, while reserving actual overflow measurement for browser acceptance.

- [ ] **Step 2: Run focused RED tests**

Run:

```text
pnpm exec vitest run test/app.approvedRedesign.test.ts test/app.ui.test.ts test/routes.clientReports.test.ts test/routes.teamInvitations.test.ts
```

Expected: FAIL on false labels, raw date output, absent density mode, and compact bounds.

- [ ] **Step 3: Rename real destinations and simplify branding language**

Use these label/description pairs:

```ts
[
  ["General", "Workspace settings"],
  ["Monitoring", "Automated client rechecks"],
  ["Services", "Agency service catalog"],
  ["Data and health", "Export and analysis reliability"],
  ["Team", "Users and permissions"],
  ["Account", "Email and account access"],
]
```

Label the logo field `Optional HTTPS logo URL`. Keep data-URL compatibility only in an advanced hint; add no upload/storage subsystem.

- [ ] **Step 4: Normalize dates and report density**

Use `formatDate` for visible invitation/report/share/cooldown timestamps while retaining ISO `dateTime`. Derive report density during render:

```ts
const reportDensity =
  snapshot.recommendedProjects.length === 0 && snapshot.supportingProjects.length <= 1
    ? "compact"
    : "full";
```

Apply `data-report-density={reportDensity}`. Compact reports use a short header and summary; full reports retain the existing cover. Do not add a theme.

- [ ] **Step 5: Bound compact client controls and compress repeated chrome**

In the late-loaded Orbit stylesheet, constrain the selected-client trigger and its text using `min-width: 0`, `max-width: 100%`, and accessible ellipsis/wrapping rules; ensure the menu icon cannot shrink away. At `max-width: 700px`, keep the filter/navigation container within `100%`/`100vw` without page-level horizontal overflow. Reduce repeated project/header spacing so the first real recommendation is visible earlier at 1280x800 and 390x844 without removing evidence or touch targets.

- [ ] **Step 6: Run GREEN and build-level regressions**

Run the Step 2 command again, then:

```text
pnpm typecheck
pnpm build
```

Expected: PASS with no React/type/build errors.

- [ ] **Step 7: Commit the slice**

```text
git add app/components/settings-navigation.tsx app/routes/settings.tsx app/routes/operations.tsx app/routes/invite.$token.tsx app/routes/reports.$id.tsx app/components/client-report.tsx app/routes/opportunities._index.tsx app/styles/orbit-approved.css test/app.approvedRedesign.test.ts test/app.ui.test.ts test/routes.clientReports.test.ts test/routes.teamInvitations.test.ts
git commit -m "fix(orbit): clarify settings and compact views"
```

---

## Integrated Acceptance and Deployment Gate

After all six reviewed tasks and the final whole-branch review:

1. Run focused cross-slice suites for analysis admission, reports, monitor, operations, auth return, onboarding, marketing/privacy, recommendation hierarchy, and responsive markup.
2. Run fresh deterministic gates:

```text
pnpm verify
pnpm analyzability --offline
pnpm tsx scripts/analyzability/ui-fixture.ts
pnpm tsx scripts/design-harness.tsx .design-harness
git diff --check
```

3. Start the real local Worker against an isolated D1 with synthetic accounts, mock evaluator, and console email. Browser-check:
   - home/product -> signup -> pilot mail action;
   - readable/no-service analysis and fail-closed negative evidence;
   - create/share/reload/reopen/revoke/anonymous 404 report lifecycle;
   - real digest click versus independent preference save;
   - expired report deep link -> login -> same path/query;
   - failed reservation -> Operations investigation row;
   - recommendation/onboarding/settings/export/privacy/Monitor clarity;
   - 1440x1000, 1280x800, 390x844, and 355x767, including a long selected client.
4. Capture page identity, meaningful DOM, console health, interaction state, measurements, and screenshots outside committed source.
5. Re-run `pnpm verify` and `git diff --check` after any acceptance fix.
6. Verify Wrangler account and production migration state, run the production preflight and dry-run, then deploy:

```text
pnpm production:preflight
pnpm db:migrations:production
pnpm deploy:production
```

7. Record the deployed Worker version and perform controlled public/protected smoke checks without changing customer records, opening Monitor entitlement, calling paid AI, or sending production email.
8. Report production provider quality/cost, real digest delivery, paid-pilot results, PDF quality, and accessibility certification as outstanding operational evidence unless separately observed.
