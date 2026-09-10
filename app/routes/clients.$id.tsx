import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import { ClientSchema, type Client } from "@/core/schema";
import {
  confirmExternalBusinessProfileClaims,
  importGoogleBusinessProfileServiceList,
  OfficialBusinessProfileExportSchema,
  importOfficialBusinessProfile,
  resolveCurrentExternalClaims,
  type ExternalBusinessClaim,
} from "@/core/externalBusinessEvidence";
import {
  analysisAdmissionRefusal,
  canRunAnalysis,
  type ReadinessState,
} from "@/core/analysisReadiness";
import { assessServiceCoverage } from "@/core/absenceVerification";
import { listClientReportSummaries, type ClientReportSummary } from "@/db/clientReports";
import { analysisReadinessForClient } from "../lib/analysis-readiness.server";
import { suggestOfferings, type SuggestedOffering } from "@/core/offeringSuggestions";
import { isExternalBusinessMismatchEnabled } from "@/config/env";
import {
  summarizeEvidenceFailure,
  type EvidenceFailureSummary,
} from "@/core/evidenceDiagnostics";
import { groupOpportunitiesByFamily } from "@/core/opportunityGrouping";
import { deleteClient } from "@/db/deleteClient";
import { isAnalysisLimitExceeded } from "@/db/analysisLimits";
import {
  CADENCE_LABEL,
  SELECTABLE_CADENCES,
  changeHeadline,
  isMonitoringCadence,
  type MonitoringCadence,
  type MonitoringState,
} from "@/core/monitoring";
import * as monitoringRepo from "@/db/monitoring";
import { isWorkspaceEntitledToMonitor } from "@/core/entitlements";
import { parseJobValue } from "@/core/clientValue";
import { MAX_COMPETITORS_PER_CLIENT } from "@/core/competitorGaps";
import {
  addCompetitor,
  listCompetitors,
  removeCompetitor,
  CompetitorError,
} from "@/db/competitors";
import { compareWithCompetitors } from "../lib/competitors.server";
import * as repo from "@/db/repositories";
import {
  AnalysisAbortedError,
  collectEvidenceOnly,
  runAnalysis,
} from "../lib/analysis.server";
import {
  byPotentialValue,
  clientState,
  isOpen,
  statusBadge,
  totalsFor,
  CLIENT_STATE_LABEL,
} from "../lib/portfolio";
import {
  AnalysisBanner,
  AnalysisRunning,
  EmptyState,
  Fact,
  Icon,
  SidePanel,
  StateDot,
  formatCompactRange,
  formatCurrencyRange,
  formatDate,
  formatDue,
  formatRelative,
  pluralize,
} from "../components/ui";
import { OfferingGuidance } from "../components/offering-guidance";
import { requireTenant } from "../lib/session.server";
import { normalizeDomain, offeringWarnings, validateClientInput } from "../lib/validation";
import type { Route } from "./+types/clients.$id";

/** The readiness shape after it has crossed the loader's JSON boundary. */
type AnalysisReadinessView = {
  state: ReadinessState;
  rules: Array<{
    ruleId: string;
    label: string;
    state: ReadinessState;
    reason: string;
    actionable: boolean;
  }>;
  catalog: { matched: number; total: number; unmatchedLabels: string[] };
  readyCount: number;
  total: number;
};

type WebsiteCoverageView = {
  analyzable: boolean;
  reason: string;
  limitation: "site-too-thin" | "coverage-limited" | null;
};

type BusinessProfilePreview = {
  profileJson: string;
  items: Array<{
    id: string;
    rawServiceLabel: string;
    normalizedLabel: string;
    semanticState: ExternalBusinessClaim["semanticState"];
    semanticReason: string;
  }>;
  rejectedLabels: string[];
};

const MAX_BUSINESS_PROFILE_UPLOAD_BYTES = 256_000;
const EXTERNAL_MISMATCH_INTENTS = new Set([
  "preview-business-profile",
  "confirm-business-profile",
  "import-external-profile",
]);

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? data.client.name + " · Axiom Orbit" : "Client" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const t = await requireTenant(request, context);
  // Onboarding sends the user here when the very first analysis could not run, so
  // the workspace is usable and the failure is explained rather than swallowed.
  const firstRunFailed = new URL(request.url).searchParams.get("firstRun") === "failed";
  const client = await repo.getClient(t.scope, params.id);
  if (!client) throw new Response("Client not found", { status: 404 });
  const externalMismatchEnabled = isExternalBusinessMismatchEnabled(
    context.cloudflare.env as unknown as Record<string, unknown>,
  );
  // Recurring monitoring is part of MONITOR, the paid tier. V0 is single-owner,
  // so the signed-in user's address is the workspace owner's address the gate
  // keys off. Off is always permitted; only turning it on requires entitlement.
  const monitorEntitled = isWorkspaceEntitledToMonitor(
    context.cloudflare.env as unknown as Record<string, unknown>,
    t.user.email,
  );
  const [services, coverage, opportunities, runs, monitoring, evidence, competitors, savedReports] =
    await Promise.all([
      repo.listServices(t.scope),
      repo.listCoverage(t.scope, client.id),
      repo.listOpportunities(t.scope, client.id),
      repo.listAnalysisRuns(t.scope, client.id, 6),
      monitoringRepo.getMonitoring(t.scope, client.id),
      repo.getLatestEvidence(t.scope, client.id),
      listCompetitors(t.scope, client.id),
      // A report the agency wrote is a document, not a one-way export. Without
      // this the only route to a saved report was the redirect that created it.
      listClientReportSummaries(t.scope, client.id),
    ]);
  const externalClaims = externalMismatchEnabled
    ? await repo.listExternalBusinessClaims(t.scope, client.id)
    : [];
  const totals = totalsFor(opportunities);
  const latest = runs[0] ?? null;

  // What the site's own evidence says this business sells that the client's
  // profile does not mention. Read-only and never applied automatically: the
  // agency confirms every line. See <SuggestedServices/>.
  const suggestions = evidence
    ? suggestOfferings({ evidence, existingOfferings: client.offerings, max: 8 })
    : [];
  const readablePages = evidence
    ? evidence.site.pages.filter(
        (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
      ).length
    : 0;
  const crawlFailure: EvidenceFailureSummary | null =
    evidence && readablePages === 0 && evidence.networkEvents.length > 0
      ? summarizeEvidenceFailure(evidence)
      : null;

  // Readiness is per rule, and it is worked out from what the LAST crawl
  // actually managed rather than from the client's offering count alone. That
  // is what lets the page tell "your setup is thin" apart from "we could not
  // read this site" — two sentences that need two different reactions.
  //
  // It is built by the shared builder, which is also what the action admits on,
  // so a disabled button and a refused POST can never give different reasons.
  const crawlCoverage = evidence ? assessServiceCoverage({ client, evidence }) : null;
  const readiness = analysisReadinessForClient({ client, catalog: services, evidence });

  return {
    client,
    services,
    coveredIds: coverage.map((c) => c.serviceId),
    opportunities,
    totals,
    runs,
    monitoring: monitoring ?? monitoringRepo.MONITORING_OFF,
    monitorEntitled,
    firstRunFailed,
    readiness,
    suggestions,
    competitors,
    externalMismatchEnabled,
    externalClaims: resolveCurrentExternalClaims(externalClaims, new Date()),
    maxCompetitors: MAX_COMPETITORS_PER_CLIENT,
    /** Whether a crawl has ever stored evidence for this client. */
    hasEvidence: evidence !== null,
    websiteCoverage: crawlCoverage
      ? {
          analyzable: crawlCoverage.analyzable,
          reason: crawlCoverage.reason,
          limitation: crawlCoverage.limitation,
        }
      : null,
    crawlFailure,
    savedReports,
    state: clientState({ outcome: latest?.outcome ?? null, openCount: totals.open }),
  };
}

async function readBusinessProfileUpload(form: FormData): Promise<
  | { ok: true; profileJson: string }
  | { ok: false; error: string }
> {
  const file = form.get("profileFile");
  if (!file || typeof file === "string" || typeof file.text !== "function") {
    return { ok: false, error: "Choose the official business-profile response file first." };
  }
  if (typeof file.size === "number" && file.size > MAX_BUSINESS_PROFILE_UPLOAD_BYTES) {
    return { ok: false, error: "That profile response is too large to import safely." };
  }
  const profileJson = (await file.text()).trim();
  if (!profileJson) return { ok: false, error: "The selected profile response is empty." };
  if (new TextEncoder().encode(profileJson).byteLength > MAX_BUSINESS_PROFILE_UPLOAD_BYTES) {
    return { ok: false, error: "That profile response is too large to import safely." };
  }
  return { ok: true, profileJson };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const t = await requireTenant(request, context);
  const existing = await repo.getClient(t.scope, params.id);
  if (!existing) throw new Response("Client not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (
    EXTERNAL_MISMATCH_INTENTS.has(intent) &&
    !isExternalBusinessMismatchEnabled(context.cloudflare.env as unknown as Record<string, unknown>)
  ) {
    return {
      ok: false as const,
      error: "Business profile comparison is paused until its evidence storage is approved.",
    };
  }

  if (intent === "delete") {
    const result = await deleteClient(
      t.scope,
      existing.id,
      String(form.get("confirmation") ?? ""),
    );
    if (result.status === "confirmation_mismatch") {
      return {
        ok: false as const,
        error: `Type ${existing.name} exactly to confirm deletion.`,
      };
    }
    if (result.status === "not_found") throw new Response("Client not found", { status: 404 });
    throw redirect("/clients");
  }

  if (intent === "save") {
    const input = {
      name: String(form.get("name") ?? ""),
      domain: String(form.get("domain") ?? ""),
      offerings: String(form.get("offerings") ?? ""),
    };
    const problem = validateClientInput(input);
    if (problem) return { ok: false as const, error: problem };
    const jobValue = parseJobValue(String(form.get("averageJobValue") ?? ""));
    if (!jobValue.ok) return { ok: false as const, error: jobValue.error };
    await repo.upsertClient(
      t.scope,
      ClientSchema.parse({
        id: existing.id,
        name: input.name.trim(),
        domain: normalizeDomain(input.domain),
        offerings: input.offerings
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        ...(jobValue.value === undefined ? {} : { averageJobValue: jobValue.value }),
        notes: String(form.get("notes") ?? "").trim(),
      }),
    );
    return { ok: true as const, message: "Client details saved." };
  }

  // Reading the site purely to populate the suggestion list. Separate from
  // Analyze on purpose: this client has nothing to analyze against yet, so
  // running one would spend AI calls to conclude what is already known.
  if (intent === "suggest-from-site") {
    try {
      const { readablePages } = await collectEvidenceOnly(t.scope, existing.id, request.signal);
      if (readablePages === 0) {
        const evidence = await repo.getLatestEvidence(t.scope, existing.id);
        const failure = evidence ? summarizeEvidenceFailure(evidence) : null;
        return {
          ok: false as const,
          error:
            failure && failure.code !== "unknown"
              ? failure.detail
              : "No page on this site could be read, so there is nothing to suggest from.",
        };
      }
      return {
        ok: true as const,
        message: `Read ${readablePages} ${readablePages === 1 ? "page" : "pages"}. Anything found is below, for you to confirm.`,
      };
    } catch {
      return { ok: false as const, error: "The site could not be read. Nothing was concluded from the incomplete read." };
    }
  }

  // Confirming suggested offerings. The suggestions themselves are computed
  // from crawled evidence and shown for review; this is the only path that
  // writes any of them, it only ever runs because a person pressed the button,
  // and it appends — an existing offering is never rewritten or removed.
  if (intent === "accept-suggestions") {
    const accepted = form
      .getAll("offering")
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (accepted.length === 0) {
      return { ok: false as const, error: "No suggested services were selected." };
    }

    const existingKeys = new Set(existing.offerings.map((o) => o.trim().toLowerCase()));
    const added = accepted.filter((o) => !existingKeys.has(o.toLowerCase()));
    const offerings = [...existing.offerings, ...added];
    const problem = validateClientInput({
      name: existing.name,
      domain: existing.domain,
      offerings: offerings.join("\n"),
    });
    if (problem) return { ok: false as const, error: problem };

    await repo.upsertClient(
      t.scope,
      ClientSchema.parse({ ...existing, offerings }),
    );
    const latestEvidence = await repo.getLatestEvidence(t.scope, existing.id);
    const coverageBlocked = latestEvidence
      ? !assessServiceCoverage({ client: { offerings }, evidence: latestEvidence }).analyzable
      : false;
    return {
      ok: true as const,
      message:
        added.length === 0
          ? "Those services were already in this client's profile."
          : coverageBlocked
            ? `Added ${added.length} ${added.length === 1 ? "service" : "services"} to ${existing.name} as client context. The site still needs to be read sufficiently before analysis can check missing service pages.`
            : `Added ${added.length} ${added.length === 1 ? "service" : "services"} to ${existing.name}. Re-analyze to check them against the site.`,
    };
  }

  if (intent === "preview-business-profile") {
    if (form.get("ownerAuthorized") !== "on") {
      return {
        ok: false as const,
        error: "Confirm that you are authorized to use this business profile first.",
      };
    }
    const upload = await readBusinessProfileUpload(form);
    if (!upload.ok) return upload;
    let parsed: unknown;
    try {
      parsed = JSON.parse(upload.profileJson);
    } catch {
      return { ok: false as const, error: "That profile response is not valid JSON." };
    }
    const imported = importGoogleBusinessProfileServiceList(
      { workspaceId: t.scope.workspaceId, clientId: existing.id },
      parsed,
      new Date(),
      { ownerAuthorized: true },
    );
    if (!imported.ok) return imported;
    const businessProfilePreview: BusinessProfilePreview = {
      profileJson: upload.profileJson,
      items: imported.claims.map((claim) => ({
        id: claim.id,
        rawServiceLabel: claim.rawServiceLabel,
        normalizedLabel: claim.normalizedLabel,
        semanticState: claim.semanticState,
        semanticReason: claim.semanticReason,
      })),
      rejectedLabels: imported.rejectedLabels,
    };
    return { ok: true as const, businessProfilePreview };
  }

  if (intent === "confirm-business-profile") {
    if (form.get("ownerAuthorized") !== "on") {
      return {
        ok: false as const,
        error: "Confirm that you are authorized to use this business profile first.",
      };
    }
    const profileJson = String(form.get("profileJson") ?? "").trim();
    if (!profileJson) return { ok: false as const, error: "Review the profile response before saving it." };
    if (new TextEncoder().encode(profileJson).byteLength > MAX_BUSINESS_PROFILE_UPLOAD_BYTES) {
      return { ok: false as const, error: "That profile response is too large to import safely." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(profileJson);
    } catch {
      return { ok: false as const, error: "That profile response is not valid JSON." };
    }
    const imported = importGoogleBusinessProfileServiceList(
      { workspaceId: t.scope.workspaceId, clientId: existing.id },
      parsed,
      new Date(),
      { ownerAuthorized: true },
    );
    if (!imported.ok) return imported;
    const confirmedIds = new Set(form.getAll("confirmClaim").map(String));
    const claims = confirmExternalBusinessProfileClaims(imported.claims, confirmedIds);
    await repo.saveExternalBusinessClaims(t.scope, claims);
    const accepted = claims.filter((claim) => claim.semanticState === "accepted").length;
    const uncertain = claims.filter((claim) => claim.semanticState === "ambiguous").length;
    return {
      ok: true as const,
      message:
        `Imported ${accepted} confirmed profile ${accepted === 1 ? "service" : "services"}. ` +
        (uncertain > 0
          ? `${uncertain} uncertain ${uncertain === 1 ? "label remains" : "labels remain"} excluded until confirmed. `
          : "") +
        "Re-analyze to compare the official profile with the readable website.",
    };
  }

  // Internal compatibility path for existing normalized fixtures. The normal
  // client page never renders this contract; user-facing imports use the
  // official ServiceList upload and review flow above.
  if (intent === "import-external-profile") {
    const rawExport = String(form.get("profileExport") ?? "").trim();
    if (!rawExport) {
      return { ok: false as const, error: "Paste the owner-authorized official profile export first." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawExport);
    } catch {
      return { ok: false as const, error: "That profile export is not valid JSON." };
    }
    const exportResult = OfficialBusinessProfileExportSchema.safeParse(parsed);
    if (!exportResult.success) {
      return {
        ok: false as const,
        error:
          "Use the supported official profile export fields: provider, sourceRecordId, sourceUrl, authorization, sourceField, observedAt, retrievedAt and services.",
      };
    }
    const imported = importOfficialBusinessProfile(
      { workspaceId: t.scope.workspaceId, clientId: existing.id },
      exportResult.data,
      new Date(),
    );
    if (!imported.ok) return { ok: false as const, error: imported.error };
    await repo.saveExternalBusinessClaims(t.scope, imported.claims);
    const accepted = imported.claims.filter((claim) => claim.semanticState === "accepted").length;
    return {
      ok: true as const,
      message:
        `Stored ${accepted} current profile service ${accepted === 1 ? "claim" : "claims"}. ` +
        "Re-analyze to compare them with the readable website. Nothing is surfaced from this source alone.",
    };
  }

  if (intent === "toggle-coverage") {
    const serviceId = String(form.get("serviceId") ?? "");
    if (form.get("covered") === "on") {
      const applied = await repo.setCoverage(
        t.scope,
        existing.id,
        serviceId,
        "Set from the client page",
      );
      if (!applied) return { ok: false as const, error: "That service is not in your catalog." };
      return { ok: true as const, message: "Marked as covered by contract." };
    }
    await repo.removeCoverage(t.scope, existing.id, serviceId);
    return { ok: true as const, message: "Coverage removed. Future gaps here become billable." };
  }

  if (intent === "add-competitor") {
    const name = String(form.get("competitorName") ?? "").trim();
    const rawDomain = String(form.get("competitorDomain") ?? "");
    const domain = normalizeDomain(rawDomain);
    if (!name) return { ok: false as const, error: "Give the competitor a name." };
    if (!domain) return { ok: false as const, error: "Enter the competitor's website." };
    try {
      await addCompetitor(t.scope, {
        clientId: existing.id,
        name,
        domain,
        clientDomain: existing.domain,
      });
    } catch (error) {
      if (error instanceof CompetitorError) return { ok: false as const, error: error.message };
      throw error;
    }
    return { ok: true as const, message: `${name} added. Run a comparison to see the gaps.` };
  }

  if (intent === "remove-competitor") {
    await removeCompetitor(t.scope, existing.id, String(form.get("competitorId") ?? ""));
    return { ok: true as const, message: "Competitor removed." };
  }

  if (intent === "compare-competitors") {
    try {
      const result = await compareWithCompetitors(
        t.scope,
        context.cloudflare.env as never,
        existing.id,
      );
      if (result.limitation) return { ok: false as const, error: result.limitation };
      if (result.catalogGap) return { ok: false as const, error: result.catalogGap };
      if (result.surfaced === 0) {
        return {
          ok: true as const,
          message:
            `Read ${result.readableCompetitors.length} competitor ` +
            `${result.readableCompetitors.length === 1 ? "site" : "sites"} and found no service ` +
            `they share that this client is missing.`,
        };
      }
      return {
        ok: true as const,
        message:
          `Found ${result.surfaced} ${result.surfaced === 1 ? "gap" : "gaps"} against ` +
          `${result.readableCompetitors.length} competitor sites. They are in the opportunity queue.`,
      };
    } catch (error) {
      if (isAnalysisLimitExceeded(error)) {
        return { ok: false as const, error: error.reason, limitation: error.limitation };
      }
      throw error;
    }
  }

  if (intent === "set-monitoring") {
    const cadence = String(form.get("cadence") ?? "");
    if (!isMonitoringCadence(cadence)) {
      return { ok: false as const, error: "That is not a monitoring option." };
    }
    // Turning monitoring ON is a paid capability (MONITOR). Off is always
    // allowed, so a workspace that loses entitlement can still stop its scans —
    // and the enable path is the only way monitoring is ever switched on, so
    // gating it here is what keeps unentitled workspaces out of the scheduler.
    if (
      cadence !== "off" &&
      !isWorkspaceEntitledToMonitor(
        context.cloudflare.env as unknown as Record<string, unknown>,
        t.user.email,
      )
    ) {
      return {
        ok: false as const,
        error:
          "Recurring monitoring is part of MONITOR, which isn’t enabled for this workspace yet.",
      };
    }
    // The first scheduled check is measured from the last completed analysis, so
    // enabling monitoring right after analyzing does not immediately re-scan.
    const latest = await repo.getLatestAnalysisRun(t.scope, existing.id);
    const state = await monitoringRepo.setMonitoringCadence(t.scope, existing.id, cadence, {
      lastAnalyzedAt: latest?.finishedAt ?? null,
    });
    if (!state) return { ok: false as const, error: "Client not found." };
    return {
      ok: true as const,
      message:
        state.cadence === "off"
          ? "Monitoring turned off. This client is only checked when you press Analyze."
          : `Monitoring on. ${existing.name} will be checked ${CADENCE_LABEL[
              state.cadence
            ].toLowerCase()}, starting ${formatDate(state.nextDueAt, true)}.`,
    };
  }

  if (intent === "analyze") {
    // The button is disabled for this, but a form post must not be able to
    // start a run that provably cannot check anything. Readiness is recomputed
    // here from the CURRENT catalog and the latest stored evidence, so a stale
    // page cannot smuggle in a run the workspace is no longer set up for.
    //
    // It admits whenever one catalog-backed rule is ready. A rule that cannot
    // work from this site's evidence suppresses itself inside the pipeline; it
    // no longer refuses the run on behalf of the rules beside it.
    const [catalog, latestEvidence] = await Promise.all([
      repo.listServices(t.scope),
      repo.getLatestEvidence(t.scope, existing.id),
    ]);
    const refusal = analysisAdmissionRefusal(
      analysisReadinessForClient({ client: existing, catalog, evidence: latestEvidence }),
    );
    if (refusal) return { ok: false as const, error: refusal };
    try {
      const result = await runAnalysis(t.scope, context.cloudflare.env as never, existing.id, {
        signal: request.signal,
      });
      return {
        ok: true as const,
        message: null,
        run: {
          outcome: result.verdict.outcome,
          summary: result.verdict.summary,
          limitation: result.verdict.limitation,
        },
      };
    } catch (err) {
      if (isAnalysisLimitExceeded(err)) {
        return { ok: true as const, message: err.message, limited: true as const, retryAt: err.retryAt };
      }
      if (err instanceof AnalysisAbortedError) {
        return { ok: false as const, error: err.message, analysisAborted: true as const };
      }
      const error =
        err instanceof Response
          ? `${err.status} ${err.statusText}`
          : err instanceof Error
            ? err.message
            : "Analysis could not be completed.";
      return { ok: false as const, error };
    }
  }

  throw new Response("Unknown action", { status: 400 });
}

export default function ClientDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    client,
    services,
    coveredIds,
    opportunities,
    totals,
    runs,
    monitoring,
    // Defaulted: a fixture or an older loader payload predates the paid gate, so
    // it renders as "not entitled" (the locked upsell) rather than throwing.
    monitorEntitled = false,
    state,
    firstRunFailed,
    readiness,
    suggestions,
    // Defaulted: loader data is a boundary, and a page rendered from a fixture
    // or an older payload must degrade rather than throw.
    competitors = [],
    maxCompetitors = MAX_COMPETITORS_PER_CLIENT,
    externalMismatchEnabled = false,
    externalClaims = [],
    websiteCoverage = null,
    savedReports = [],
  } = loaderData;
  const navigation = useNavigation();
  const intent = navigation.formData?.get("intent");
  const analyzing = intent === "analyze";
  const saving = intent === "save";
  const deleting = intent === "delete";
  const comparing = intent === "compare-competitors";
  const busy = navigation.state !== "idle";
  const [editOpen, setEditOpen] = useState(false);
  const [editOfferings, setEditOfferings] = useState(() => client.offerings.join("\n"));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSubmitted, setDeleteSubmitted] = useState(false);
  const businessProfilePreview =
    actionData && "businessProfilePreview" in actionData
      ? (actionData.businessProfilePreview as BusinessProfilePreview)
      : undefined;

  // Refresh the editor from persisted data after a save/revalidation, while
  // keeping in-progress typing intact if another form happens to revalidate.
  useEffect(() => {
    if (!editOpen) setEditOfferings(client.offerings.join("\n"));
  }, [client.id, client.offerings, editOpen]);

  const closeDeletePanel = () => {
    setDeleteOpen(false);
    setDeleteSubmitted(false);
  };

  // A run is worth starting when ANY rule can produce a finding. Blocking it
  // because one rule of several is limited would refuse to look for a broken
  // checkout on a client whose offerings list happens to be short — or, as the
  // audit found, refuse to check a site that had been read from end to end.
  //
  // `coverageBlocked` survives because several panels below still need to know
  // whether the SERVICE-PAGE evidence is sufficient. It is a fact about one
  // rule's evidence now, not a verdict on the run.
  const coverageBlocked = websiteCoverage !== null && !websiteCoverage.analyzable;
  const canAnalyze = canRunAnalysis(readiness);
  const analysisRefusal = analysisAdmissionRefusal(readiness);
  const latest = runs[0] ?? null;
  const open = opportunities.filter(isOpen).sort(byPotentialValue);
  const closed = opportunities.filter((opp) => !isOpen(opp)).sort(byPotentialValue);
  const opportunityFamilies = groupOpportunitiesByFamily(
    [...open, ...closed].map((opportunity) => ({ opportunity, client })),
  );
  const activeServices = services.filter((service) => service.active);

  return (
    <div className="detail">
      <Link className="backlink" to="/clients">
        <Icon name="arrow-left" size={14} />
        Clients
      </Link>

      <header className="detail-head">
        <div className="detail-head-row">
          <div className="detail-head-copy">
            <div className="detail-meta detail-meta-top">
              <StateDot state={state} />
              <span>{CLIENT_STATE_LABEL[state]}</span>
            </div>
            <h1 className="title-lg">{client.name}</h1>
            <div className="detail-meta">
              <a
                href={"https://" + client.domain}
                target="_blank"
                rel="noreferrer"
                className="row-tight"
              >
                {client.domain}
                <Icon name="external" size={12} />
              </a>
              <span className="dot-sep">·</span>
              <span>
                {client.offerings.length}{" "}
                {pluralize(client.offerings.length, "offering", "offerings")} tracked
              </span>
            </div>
          </div>
          <div className="detail-head-actions">
            <Link className="btn" to={`/clients/${encodeURIComponent(client.id)}/report`}>
              <Icon name="document" size={14} />
              Create report
            </Link>
            <button className="btn" type="button" onClick={() => setEditOpen(true)}>
              <Icon name="pencil" size={13} />
              Edit
            </button>
            <Form method="post">
              <input type="hidden" name="intent" value="analyze" />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !canAnalyze}
                title={analysisRefusal ?? undefined}
              >
                <Icon name="refresh" size={15} className={analyzing ? "spin" : undefined} />
                {analyzing ? "Reading the site…" : latest ? "Re-analyze" : "Analyze site"}
              </button>
            </Form>
          </div>
        </div>

        <dl className="factbar">
          <Fact label="Last analyzed">
            {latest ? formatRelative(latest.finishedAt) : <span className="faint">Never</span>}
          </Fact>
          <Fact label="Open opportunities">
            {totals.open > 0 ? (
              <Link className="link num" to={"/opportunities?client=" + client.id}>
                {totals.open}
              </Link>
            ) : (
              <span className="faint">None</span>
            )}
          </Fact>
          <Fact label="Potential value">
            {totals.open > 0 ? (
              <span className="num">{formatCompactRange(totals.priceMin, totals.priceMax)}</span>
            ) : (
              <span className="faint">—</span>
            )}
          </Fact>
          <Fact label="Covered by contract">
            {coveredIds.length > 0 ? (
              <span className="num">
                {coveredIds.length} of {services.length}
              </span>
            ) : (
              <span className="faint">Nothing marked</span>
            )}
          </Fact>
        </dl>
      </header>

      <MonitoringRow
        monitoring={monitoring}
        monitorEntitled={monitorEntitled}
        busy={busy}
        canAnalyze={canAnalyze}
        blockedReason={analysisRefusal ?? undefined}
      />

      <Readiness readiness={readiness} clientName={client.name} />
      <ReadSiteForOfferings
        client={client}
        hasEvidence={loaderData.hasEvidence}
        crawlFailure={loaderData.crawlFailure}
        suggestionCount={suggestions.length}
        coverage={websiteCoverage}
        busy={busy}
      />
      <SuggestedServices
        suggestions={suggestions}
        clientName={client.name}
        busy={busy}
        onEditClient={() => setEditOpen(true)}
        coverageBlocked={coverageBlocked}
      />
      <SavedReports reports={savedReports} />

      {analyzing && (
        <AnalysisRunning
          clientName={client.name}
          domain={client.domain}
          stopHref={`/clients/${client.id}`}
        />
      )}
      {!analyzing && actionData && "run" in actionData && actionData.run && (
        <AnalysisBanner
          outcome={actionData.run.outcome}
          summary={actionData.run.summary}
          limitation={actionData.run.limitation}
        >
          {totals.open > 0 && (
            <Link className="link runcard-link" to={"/opportunities?client=" + client.id}>
              Open the findings
              <Icon name="arrow-right" size={12} />
            </Link>
          )}
        </AnalysisBanner>
      )}
      {!analyzing && actionData && actionData.ok && "message" in actionData && actionData.message && (
        <div className={"limited" in actionData ? "notice" : "notice ok"} role="status">
          <Icon name="check" size={15} />
          <span>{actionData.message}</span>
        </div>
      )}
      {!analyzing && actionData && !actionData.ok && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>{actionData.error}</span>
        </div>
      )}

      {!analyzing && !actionData && firstRunFailed && (
        <div className="notice err" role="alert">
          <Icon name="alert" size={15} />
          <span>
            {client.name} was saved, but the first analysis could not be completed. Check the
            website address below, then try again.
          </span>
        </div>
      )}

      {!analyzing && !actionData && !firstRunFailed && latest?.outcome === "inconclusive" && (
        <AnalysisBanner
          outcome="inconclusive"
          summary={latest.summary}
          limitation={latest.limitation}
        />
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Findings</h2>
            <p>What the last analysis surfaced for this client.</p>
          </div>
          {open.length > 0 && (
            <Link className="btn btn-sm" to={"/opportunities?client=" + client.id}>
              Open in feed
              <Icon name="arrow-up-right" size={13} />
            </Link>
          )}
        </div>
        {opportunities.length === 0 ? (
          <EmptyState
            icon={state === "inconclusive" ? "alert" : state === "never" ? "target" : "check"}
            title={
              state === "never"
                ? "This site has not been read yet"
                : state === "inconclusive"
                  ? "The last analysis was inconclusive"
                  : "Nothing billable found"
            }
            inset
          >
            {state === "never"
              ? "Run an analysis to see what this client's website does and does not cover."
              : (latest?.summary ??
                "The site was read and no unmet billable work was found.")}
          </EmptyState>
        ) : (
          <div className="opportunity-families">
            {opportunityFamilies.map((family) => (
              <section className="opportunity-family" key={family.key}>
                <div className="section-head">
                  <div>
                    <h3 className="title-section">{family.family.label}</h3>
                    <p>
                      {family.family.description} {family.entries.length} related{" "}
                      {family.entries.length === 1 ? "finding" : "findings"}.
                    </p>
                  </div>
                </div>
                <ul className="records">
                  {family.entries.map(({ opportunity: opp }) => {
                    const badge = statusBadge(opp);
                    const live = isOpen(opp);
                    return (
                      <li key={opp.id}>
                        <Link
                          className={"record" + (live ? "" : " is-quiet")}
                          to={"/opportunities/" + opp.id}
                        >
                          <span className="record-main">
                            <span className="record-name">{opp.title}</span>
                            <span className="record-meta">
                              <span className={"pill " + badge.tone}>{badge.label}</span>
                              <span className="dot-sep">·</span>
                              <span>{opp.detected}</span>
                            </span>
                          </span>
                          <span className="record-end">
                            <span className="record-stat wide">
                              <b className="num">{formatCurrencyRange(opp.priceMin, opp.priceMax)}</b>
                              <span>potential value</span>
                            </span>
                            <span className="record-stat">
                              <b className="num">{Math.round(opp.confidence * 100)}%</b>
                              <span>confident</span>
                            </span>
                            <Icon name="chevron-right" size={15} className="record-chevron" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      {externalMismatchEnabled && (
        <ExternalProfileEvidence
          claims={externalClaims}
          busy={busy}
          preview={businessProfilePreview}
        />
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Contract coverage</h2>
            <p>
              Work you already do for this client. Covered services never appear as a billable
              opportunity, however clearly the site shows the gap.
            </p>
          </div>
        </div>
        {activeServices.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No active services in your catalog"
            inset
            actions={
              <Link className="btn" to="/services">
                Open the catalog
              </Link>
            }
          >
            Add the work your agency sells before marking what this client already pays for.
          </EmptyState>
        ) : (
          <ul className="records">
            {activeServices.map((service) => {
              const covered = coveredIds.includes(service.id);
              return (
                <li key={service.id}>
                  <Form method="post" className="record">
                    <input type="hidden" name="intent" value="toggle-coverage" />
                    <input type="hidden" name="serviceId" value={service.id} />
                    {!covered && <input type="hidden" name="covered" value="on" />}
                    <button
                      type="submit"
                      className={"check-toggle" + (covered ? " on" : "")}
                      disabled={busy}
                      aria-pressed={covered}
                      aria-label={
                        (covered ? "Remove contract coverage for " : "Mark as covered by contract: ") +
                        service.name
                      }
                    >
                      <Icon name="check" size={12} strokeWidth={2.4} />
                    </button>
                    <span className="record-main">
                      <span className="record-name">{service.name}</span>
                      <span className="record-meta">
                        <span>{covered ? "Covered by contract" : "Available to sell"}</span>
                      </span>
                    </span>
                    <span className="record-end">
                      <span className="record-stat wide is-zero">
                        <b className="num">
                          {formatCurrencyRange(service.priceMin, service.priceMax)}
                        </b>
                        <span>typical range</span>
                      </span>
                    </span>
                  </Form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">
              {coverageBlocked ? "Know what they offer?" : "What this business sells"}
            </h2>
            <p>
              {coverageBlocked
                ? "You can save services as client context while the website read is blocked. They do not replace website evidence."
                : "Every analysis checks the site against this list."}
            </p>
          </div>
          <button className="btn btn-sm" type="button" onClick={() => setEditOpen(true)}>
            <Icon name="pencil" size={13} />
            Edit
          </button>
        </div>
        {client.offerings.length === 0 ? (
          <EmptyState
            icon="tag"
            title="No offerings recorded"
            inset
            actions={
              <button className="btn" type="button" onClick={() => setEditOpen(true)}>
                Add offerings
              </button>
            }
          >
            {coverageBlocked
              ? "Add what you know now if it helps your client profile. Orbit still needs enough readable website evidence before it can check for missing service pages."
              : "Without this list, Axiom Orbit cannot tell whether the site covers what the business actually does — so it will not claim anything is missing."}
          </EmptyState>
        ) : (
          <>
            <ul className="tag-row tag-row-lg">
              {client.offerings.map((offering) => (
                <li key={offering} className="pill quiet">
                  {offering}
                </li>
              ))}
            </ul>
            <OfferingQuality offerings={client.offerings} onEdit={() => setEditOpen(true)} />
          </>
        )}
        <OfferingGuidance
          offerings={client.offerings}
          showWarnings={false}
          coverageBlocked={coverageBlocked}
        />
        {client.notes && <p className="prose client-notes">{client.notes}</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Who they compete with</h2>
            <p>
              Name the businesses this client actually loses work to. A comparison reads
              their sites and reports services two or more of them sell that this client
              has no page for — the strongest argument for a new page there is.
            </p>
          </div>
          {competitors.length > 0 && (
            <Form method="post" className="inline">
              <input type="hidden" name="intent" value="compare-competitors" />
              <button className="btn btn-sm" type="submit" disabled={busy}>
                {comparing ? "Comparing…" : "Compare"}
              </button>
            </Form>
          )}
        </div>

        {competitors.length === 0 ? (
          <p className="prose faint">
            None recorded. Two are the minimum for a comparison — one competitor having a
            page is that competitor&rsquo;s choice, not a pattern worth telling a client
            about.
          </p>
        ) : (
          <ul className="tag-row tag-row-lg">
            {competitors.map((competitor) => (
              <li key={competitor.id} className="pill quiet">
                {competitor.name}
                <span className="faint"> · {competitor.domain}</span>
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="remove-competitor" />
                  <input type="hidden" name="competitorId" value={competitor.id} />
                  <button
                    className="linklike"
                    type="submit"
                    disabled={busy}
                    aria-label={`Remove ${competitor.name}`}
                  >
                    ×
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}

        {competitors.length < maxCompetitors && (
          <Form method="post" className="row-tight competitor-add">
            <input type="hidden" name="intent" value="add-competitor" />
            <label className="sr-only" htmlFor="competitor-name">
              Competitor name
            </label>
            <input id="competitor-name" name="competitorName" type="text" placeholder="Name" required />
            <label className="sr-only" htmlFor="competitor-domain">
              Competitor website
            </label>
            <input
              id="competitor-domain"
              name="competitorDomain"
              type="text"
              placeholder="competitor.example"
              required
            />
            <button className="btn btn-sm" type="submit" disabled={busy}>
              Add
            </button>
          </Form>
        )}
        <p className="field-hint">
          Up to {maxCompetitors}. A comparison crawls every one of them and takes a slot
          from the same daily analysis limit.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="title-section">Analysis history</h2>
            <p>
              Every check and what it concluded, including the ones that concluded nothing and the
              ones that ran while nobody was watching.
            </p>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="prose faint">No analysis has been run for this client yet.</p>
        ) : (
          <ol className="runlog">
            {runs.map((run) => (
              <li key={run.id} className={"runlog-item " + run.outcome}>
                <span className="runlog-mark" aria-hidden="true" />
                <div className="runlog-body">
                  <div className="runlog-top">
                    <span className="runlog-outcome">
                      {run.outcome === "findings"
                        ? "Findings"
                        : run.outcome === "clean"
                          ? "Clean"
                          : "Inconclusive"}
                    </span>
                    <span className="dot-sep">·</span>
                    <time dateTime={run.finishedAt}>{formatDate(run.finishedAt, true)}</time>
                    <span className="dot-sep">·</span>
                    <span className="faint">
                      {run.pagesRead} {pluralize(run.pagesRead, "page", "pages")} read
                    </span>
                    {run.trigger === "scheduled" && (
                      <>
                        <span className="dot-sep">·</span>
                        <span className="pill quiet runlog-trigger">Monitoring</span>
                      </>
                    )}
                  </div>
                  <p className="runlog-summary">{run.summary}</p>
                  {(run.newCount > 0 || run.resolvedCount > 0) && (
                    <p className="runlog-change">
                      {[
                        run.newCount > 0
                          ? `${run.newCount} new ${pluralize(run.newCount, "opportunity", "opportunities")}`
                          : null,
                        run.resolvedCount > 0
                          ? `${run.resolvedCount} fixed since the previous check`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {run.limitation && <p className="runlog-limit">{run.limitation}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="section" aria-labelledby="delete-client-heading">
        <div className="section-head">
          <div>
            <h2 className="title-section" id="delete-client-heading">
              Remove client
            </h2>
            <p>
              Permanently remove {client.name}, its findings, site evidence, analysis history, and
              monitoring schedule.
            </p>
          </div>
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => {
              setDeleteSubmitted(false);
              setDeleteOpen(true);
            }}
            disabled={busy}
          >
            Delete client
          </button>
        </div>
      </section>

      <SidePanel
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit client"
        description="The site and offering context every analysis is checked against."
      >
        <Form method="post" onSubmit={() => setEditOpen(false)}>
          <input type="hidden" name="intent" value="save" />
          <div className="field">
            <label htmlFor="edit-name">Client name</label>
            <input id="edit-name" name="name" type="text" defaultValue={client.name} required />
          </div>
          <div className="field">
            <label htmlFor="edit-domain">Website</label>
            <input
              id="edit-domain"
              name="domain"
              type="text"
              defaultValue={client.domain}
              required
            />
            <div className="field-hint">Just the domain — https:// is optional.</div>
          </div>
          <div className="field">
            <label htmlFor="edit-offerings">What customers hire this business for</label>
            <textarea
              id="edit-offerings"
              name="offerings"
              rows={6}
              value={editOfferings}
              onChange={(event) => setEditOfferings(event.target.value)}
            />
            <div className="field-hint">
              One per line: things customers actually hire or pay them for. Not claims about the
              business — no "free quotes", "fully insured", "family owned" or "financing available".
              {coverageBlocked
                ? "These entries are client context. Orbit still needs enough readable website evidence before it can analyze missing service pages."
                : "Two or more makes the analysis far better."}
            </div>
            <OfferingGuidance raw={editOfferings} coverageBlocked={coverageBlocked} />
          </div>
          <div className="field">
            <label htmlFor="edit-job-value">Typical job value (optional)</label>
            <input
              id="edit-job-value"
              name="averageJobValue"
              type="text"
              inputMode="decimal"
              defaultValue={client.averageJobValue ?? ""}
              placeholder="e.g. 4000"
            />
            <div className="field-hint">
              What one typical job is worth to <em>this business</em>, not to you. Findings then
              say what the work costs in their terms — &ldquo;pays for itself with one job&rdquo;
              is a sentence you can say on a call. Leave it blank if you do not know; nothing is
              estimated from it.
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-notes">Notes</label>
            <textarea
              id="edit-notes"
              name="notes"
              rows={3}
              defaultValue={client.notes}
              placeholder="Optional context for your team"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
          </div>
        </Form>
      </SidePanel>

      <SidePanel
        open={deleteOpen}
        onClose={closeDeletePanel}
        title={`Delete ${client.name}?`}
        description="This permanently removes the client and everything recorded for its site."
      >
        {deleteSubmitted && actionData && !actionData.ok && (
          <div className="notice err" role="alert">
            <Icon name="alert" size={15} />
            <span>{actionData.error}</span>
          </div>
        )}
        <p className="prose">
          This removes the findings, crawl evidence, analysis history, and monitoring schedule for
          {" "}
          <b>{client.name}</b>. Your agency, service catalog, and other clients stay intact.
        </p>
        <Form method="post" onSubmit={() => setDeleteSubmitted(true)}>
          <input type="hidden" name="intent" value="delete" />
          <div className="field">
            <label htmlFor="delete-confirmation">Type {client.name} to confirm</label>
            <input
              id="delete-confirmation"
              name="confirmation"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
            />
            <div className="field-hint">The name must match exactly.</div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-danger" disabled={busy}>
              {deleting ? "Deleting…" : "Delete client permanently"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={closeDeletePanel}>
              Cancel
            </button>
          </div>
        </Form>
      </SidePanel>
    </div>
  );
}

/**
 * Monitoring, stated in one line.
 *
 * The whole feature is "you do not have to remember to press Analyze", so the
 * only things worth showing are whether it is on, when it last looked, when it
 * looks next, and how to change that. Everything a run produced already has a
 * home in the findings and the history below.
 *
 * The last outcome is only shown when it is something the agency should know
 * about: a check that could not read the site, or a run of failures. A healthy
 * weekly check should be quiet.
 */
function MonitoringRow({
  monitoring,
  monitorEntitled,
  busy,
  canAnalyze,
  blockedReason,
}: {
  monitoring: MonitoringState;
  monitorEntitled: boolean;
  busy: boolean;
  canAnalyze: boolean;
  blockedReason?: string;
}) {
  const on = monitoring.cadence !== "off";
  const troubled =
    monitoring.lastOutcome === "failed" || monitoring.lastOutcome === "inconclusive";

  // MONITOR is not enabled for this workspace. Show what it does and where to
  // learn more instead of a control that would only be refused on submit. If a
  // workspace was de-entitled while a client was still monitored, keep a single
  // "Turn off" action so the agency can stop scans it can no longer manage.
  if (!monitorEntitled) {
    return (
      <div className="monitorbar monitorbar-locked">
        <div className="monitorbar-copy">
          <span className="monitorbar-label">
            <Icon name="refresh" size={13} />
            Monitoring
          </span>
          <span className="monitorbar-state">Part of MONITOR</span>
          <span className="monitorbar-meta">
            <span className="dot-sep">·</span>
            <span>Recurring checks and a weekly digest of new billable work.</span>
          </span>
        </div>
        <div className="monitorbar-actions">
          <Link className="btn btn-sm" to="/monitor">
            Learn more
          </Link>
          {on && (
            <Form method="post">
              <input type="hidden" name="intent" value="set-monitoring" />
              <input type="hidden" name="cadence" value="off" />
              <button type="submit" className="btn btn-sm btn-ghost" disabled={busy}>
                Turn off
              </button>
            </Form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={"monitorbar" + (on ? " is-on" : "")}>
      <div className="monitorbar-copy">
        <span className="monitorbar-label">
          <Icon name="refresh" size={13} />
          Monitoring
        </span>
        <span className="monitorbar-state">{CADENCE_LABEL[monitoring.cadence]}</span>
        {on ? (
          <span className="monitorbar-meta">
            <span className="dot-sep">·</span>
            <span>
              {monitoring.lastSuccessAt
                ? "last checked " + formatRelative(monitoring.lastSuccessAt)
                : "not checked yet"}
            </span>
            {monitoring.nextDueAt && (
              <>
                <span className="dot-sep">·</span>
                <span>next check {formatDue(monitoring.nextDueAt)}</span>
              </>
            )}
          </span>
        ) : (
          <span className="monitorbar-meta">
            <span className="dot-sep">·</span>
            <span>this client is only checked when you press Analyze</span>
          </span>
        )}
      </div>

      <Form method="post" className="monitorbar-actions">
        <input type="hidden" name="intent" value="set-monitoring" />
        <label className="sr-only" htmlFor="monitoring-cadence">
          Monitoring frequency
        </label>
        <select
          id="monitoring-cadence"
          name="cadence"
          defaultValue={monitoring.cadence}
          disabled={busy || !canAnalyze}
          className="monitorbar-select"
        >
          {(SELECTABLE_CADENCES as readonly MonitoringCadence[]).map((cadence) => (
            <option key={cadence} value={cadence}>
              {CADENCE_LABEL[cadence]}
            </option>
          ))}
          {/* Keeps a cadence set elsewhere visible instead of silently rewriting it. */}
          {!(SELECTABLE_CADENCES as readonly string[]).includes(monitoring.cadence) && (
            <option value={monitoring.cadence}>{CADENCE_LABEL[monitoring.cadence]}</option>
          )}
        </select>
        <button
          type="submit"
          className="btn btn-sm"
          disabled={busy || !canAnalyze}
          title={
            canAnalyze
              ? undefined
              : (blockedReason ??
                "Add a service that is offered for a website gap before turning monitoring on.")
          }
        >
          Save
        </button>
      </Form>

      {on && troubled && (
        <p className="monitorbar-note">
          {changeHeadline(monitoring.lastOutcome ?? "failed", {
            newCount: 0,
            stillOpenCount: 0,
            resolvedCount: 0,
          })}
          {monitoring.consecutiveFailures > 1 &&
            ` The last ${monitoring.consecutiveFailures} checks in a row could not be completed.`}{" "}
          Nothing was concluded and no finding was changed.
        </p>
      )}
    </div>
  );
}

/**
 * What this analysis would actually be able to check — shown BEFORE the run,
 * not explained afterwards.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not collapse the rules into one verdict. Whether the crawl can reach
 * a site's service pages decides whether a missing page can be claimed; it has
 * nothing to do with whether a call-to-action returns 404. A client with one
 * offering used to be warned as though nothing could be checked, which is both
 * untrue and discouraging.
 *
 * And it does not offer the agency a fix for something they cannot fix. When
 * the limit is the crawler, it says so plainly. Telling someone to add more
 * offerings when the real problem is that the site would not load is worse than
 * saying nothing: they do the work and the next run fails identically.
 */
function Readiness({
  readiness,
  clientName,
}: {
  readiness: AnalysisReadinessView;
  clientName: string;
}) {
  // Nothing in the catalog answers any kind of website gap: the run cannot
  // produce a finding whatever the site looks like.
  if (readiness.catalog.matched === 0) {
    return (
      <div className="notice err" role="alert">
        <Icon name="alert" size={15} />
        <span>
          An analysis cannot check anything yet. Every finding is priced from something you sell,
          and no active service says which kind of website gap it answers.{" "}
          <Link className="link" to="/services">
            Set that up in your catalog
          </Link>
          , then analyze.
        </span>
      </div>
    );
  }

  const limited = readiness.rules.filter((rule) => rule.state !== "ready");
  if (limited.length === 0) return null;

  // One line, not one banner per rule. A dozen identical amber bars is a wall
  // the reader stops seeing; the detail is a click away and still complete.
  const blocked = limited.filter((rule) => rule.state === "not_ready").length;

  return (
    <details className={"readiness" + (blocked > 0 ? " is-blocked" : "")}>
      <summary>
        <Icon name={blocked > 0 ? "alert" : "shield"} size={17} />
        <span className="readiness-headline">
          {blocked > 0
            ? `${blocked} of ${readiness.rules.length} checks cannot run yet`
            : `${limited.length} of ${readiness.rules.length} checks are limited by what is on the site`}
        </span>
        <span className="readiness-hint">Details</span>
        <Icon name="chevron-down" size={16} className="readiness-caret" />
      </summary>
      <ul>
        {limited.map((rule) => (
          <li key={rule.ruleId} data-state={rule.state}>
            <strong>{rule.label}</strong> — {rule.reason}{" "}
            {rule.state === "not_ready" && (
              <Link className="link" to="/services">
                Open the catalog
              </Link>
            )}
            {rule.state === "site_coverage_limited" && !rule.actionable && (
              <span className="faint">
                {clientName}&rsquo;s setup is not the limit here, so there is nothing to change.
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The offer to read the site when the profile is too thin to analyze against.
 *
 * A client with fewer than two offerings cannot produce a missing-page finding
 * — the crawl can never demonstrate it reached the service section — so the run
 * is inconclusive before it starts. Rather than let someone spend a run finding
 * that out, this offers the crawl that populates the list instead, and says
 * plainly that nothing is saved without them.
 */
function ReadSiteForOfferings({
  client,
  hasEvidence,
  crawlFailure,
  suggestionCount,
  coverage,
  busy,
}: {
  client: Client;
  hasEvidence: boolean;
  crawlFailure: EvidenceFailureSummary | null;
  suggestionCount: number;
  coverage: WebsiteCoverageView | null;
  busy: boolean;
}) {
  const coverageBlocked = coverage !== null && !coverage.analyzable;
  // Once suggestions are on screen, SuggestedServices is the thing to look at
  // and this would be a second button saying the same thing.
  if (!coverageBlocked && suggestionCount > 0) return null;
  if (!coverageBlocked && client.offerings.length >= 2) return null;

  const canRetry = coverageBlocked || !hasEvidence || crawlFailure !== null;

  return (
    <div className="notice suggested-services" role="status">
      <Icon name="search" size={16} />
      <div>
        <p>
          {crawlFailure ? (
            <>
              <strong>{crawlFailure.title}</strong>{" "}
              {crawlFailure.detail}
            </>
          ) : coverageBlocked ? (
            <>
              <strong>
                {coverage.limitation === "site-too-thin"
                  ? "The whole site was read, but no service pages were found."
                  : "The last read did not reach enough of the site's service structure."}
              </strong>{" "}
              Manual offerings are client context only and do not replace website evidence.
            </>
          ) : (
            <>
              {client.offerings.length === 0
                ? `Nothing is recorded for ${client.name} yet, so there is nothing to check the site against.`
                : `Only one service is recorded for ${client.name}, which is rarely enough to confirm a crawl reached the site's services.`}{" "}
              {hasEvidence
                ? "The last crawl of this site found nothing to add."
                : "Axiom Orbit can read the site and propose what this business sells."}
            </>
          )}
        </p>
        {canRetry && (
          <Form method="post" className="suggested-actions">
            <input type="hidden" name="intent" value="suggest-from-site" />
            <button className="btn btn-primary" type="submit" disabled={busy}>
              <Icon name="search" size={15} />
              {hasEvidence || coverageBlocked ? "Try reading it again" : "Read the site"}
            </button>
            <span className="suggested-note">
              {coverageBlocked
                ? "Save client context separately; a retry is what can change website coverage."
              : "Nothing is saved until you confirm it. No analysis is run."}
            </span>
          </Form>
        )}
      </div>
    </div>
  );
}


/**
 * The reports this agency has already written for this client.
 *
 * A report is a document an agency showed a client, and the audit found there
 * was no way back to one: `Create report` was the only entry point, so a saved
 * report could only be reached from the redirect that made it. Refreshing lost
 * it. Closing the tab lost it. The public link it was shared through, however,
 * stayed live — which made "is this still shared?" a question with no answer.
 *
 * So this stays compact and answers exactly that: when it was written, what it
 * contains, whether anyone outside can currently read it, and a way in.
 */
function SavedReports({ reports }: { reports: ClientReportSummary[] }) {
  if (reports.length === 0) return null;

  return (
    <section className="section saved-reports">
      <div className="section-head">
        <div>
          <h2 className="title-section">Saved reports</h2>
          <p>
            Each one is a fixed snapshot of what was recommended on the day it was generated. Open
            one to read it, share it, or revoke a link that is still live.
          </p>
        </div>
      </div>
      <ul className="saved-report-list">
        {reports.map((report) => (
          <li key={report.reportId}>
            <Link className="link saved-report-link" to={`/reports/${encodeURIComponent(report.reportId)}`}>
              <time dateTime={report.generatedAt}>{formatDate(report.generatedAt)}</time>
            </Link>
            <span className="faint saved-report-contents">
              {report.recommendedProjectCount}{" "}
              {pluralize(report.recommendedProjectCount, "recommendation", "recommendations")}
              {report.supportingProjectCount > 0 && (
                <>
                  {" · "}
                  {report.supportingProjectCount} supporting
                </>
              )}
            </span>
            <span className={"pill" + (report.activeShareCount > 0 ? "" : " faint")}>
              {report.activeShareCount === 0
                ? "Not shared"
                : report.activeShareCount === 1
                  ? "1 active link"
                  : `${report.activeShareCount} active links`}
              {report.nearestActiveShareExpiresAt && (
                <>
                  {" · expires "}
                  <time dateTime={report.nearestActiveShareExpiresAt}>
                    {formatDate(report.nearestActiveShareExpiresAt)}
                  </time>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "These look like services customers can hire this business for."
 *
 * This is the difference between a scanner that says "insufficient coverage"
 * and a product. When a client cannot be analyzed because Axiom Orbit was
 * told about one of the six things the business sells, the site itself already
 * contains the answer — and the run that failed has it sitting in evidence.
 *
 * Every line here is a SUGGESTION. Nothing is added by opening this panel, and
 * nothing is added by ignoring it. The agency opens the editor, keeps what is
 * right, changes what is nearly right, and deletes the rest. Each suggestion
 * shows where it came from, because a list of services with no provenance is
 * something an agency has to verify from scratch anyway.
 */
function SuggestedServices({
  suggestions,
  clientName,
  busy,
  onEditClient,
  coverageBlocked,
}: {
  suggestions: SuggestedOffering[];
  clientName: string;
  busy: boolean;
  onEditClient: () => void;
  coverageBlocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (suggestions.length === 0) return null;

  return (
    <div className="notice suggested-services" role="status">
      <Icon name="alert" size={15} />
      <div>
        <p>
          {coverageBlocked
            ? `The last read found ${suggestions.length} ${pluralize(suggestions.length, "possible service", "possible services")} for ${clientName}&rsquo;s client profile. They are context only; the website evidence is still insufficient for a missing-service check.`
            : `The last crawl found ${suggestions.length} ${pluralize(suggestions.length, "service", "services")} on this site that ${suggestions.length === 1 ? "is" : "are"} not in ${clientName}&rsquo;s profile. These look like services customers can hire this business for.`}
        </p>
        <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Review suggested services"}
        </button>

        {open && (
          <>
            <ul className="suggestion-list">
              {suggestions.map((suggestion) => (
                <li key={suggestion.label}>
                  <div className="suggestion-head">
                    <span className="suggestion-label">{suggestion.label}</span>
                    <span className="pill faint">
                      {suggestion.confidence === "high" ? "Strong evidence" : "Worth checking"}
                    </span>
                  </div>
                  <ul className="suggestion-evidence">
                    {suggestion.evidence.map((item, index) => (
                      <li key={index}>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer" className="link">
                            {item.detail}
                          </a>
                        ) : (
                          item.detail
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <Form method="post" className="suggestion-actions">
              <input type="hidden" name="intent" value="accept-suggestions" />
              {suggestions.map((suggestion) => (
                <input key={suggestion.label} type="hidden" name="offering" value={suggestion.label} />
              ))}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Add all {suggestions.length} to {clientName}
              </button>
              <button type="button" className="btn" onClick={onEditClient} disabled={busy}>
                Edit the list instead
              </button>
            </Form>
            <p className="faint">
              {coverageBlocked
                ? "Nothing has been added yet. Anything you add is saved as client context; it does not unlock analysis until the site can be read sufficiently."
                : "Nothing has been added yet. Anything you add is checked against the site like a service, and a missing page for one would be priced like a service."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ExternalProfileEvidence({
  claims,
  busy,
  preview,
}: {
  claims: ExternalBusinessClaim[];
  busy: boolean;
  preview?: BusinessProfilePreview;
}) {
  const stateLabel: Record<ExternalBusinessClaim["semanticState"], string> = {
    accepted: "Current profile evidence",
    ambiguous: "Needs confirmation",
    rejected: "Not treated as a service",
    stale: "Out of date",
    conflicting: "Conflicting exports",
  };
  return (
    <section className="section" aria-labelledby="external-profile-heading">
      <div className="section-head">
        <div>
          <h2 className="title-section" id="external-profile-heading">
            Business profile evidence
          </h2>
          <p>
            Import a current service list from an official, owner-authorized business profile. Orbit
            keeps the source details for you and never uses reviews, social posts, ads or directory
            listings.
          </p>
        </div>
      </div>
      {claims.length > 0 && (
        <ul className="tag-row tag-row-lg" aria-label="Imported official profile services">
          {claims.map((claim) => (
            <li key={claim.id} className="pill quiet">
              {claim.normalizedLabel}
              <span className="faint"> · {stateLabel[claim.semanticState]}</span>
              <a
                className="link"
                href={claim.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open source for ${claim.normalizedLabel}`}
              >
                source
              </a>
            </li>
          ))}
        </ul>
      )}
      <details className="advanced-details" open={Boolean(preview)}>
        <summary>Import business profile</summary>
        <p className="field-hint">
          Upload the official Google Business Profile service-list response from an authorized
          connection. Orbit reads the service names, identifies anything uncertain, and leaves the
          website coverage check as the final gate. Importing evidence does not create a finding by
          itself.
        </p>
        {preview && (
          <div className="notice" role="region" aria-labelledby="profile-review-heading">
            <div className="section-head">
              <div>
                <h3 className="title-section" id="profile-review-heading">
                  Review what Orbit found
                </h3>
                <p>
                  Confirm only the labels marked as uncertain. Clear evidence is already included;
                  rejected labels will not be treated as services.
                </p>
              </div>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="confirm-business-profile" />
              <input type="hidden" name="profileJson" value={preview.profileJson} />
              <ul className="suggestion-list confirm-list" aria-label="Profile service review">
                {preview.items.map((item) => {
                  const ambiguous = item.semanticState === "ambiguous";
                  const rejected = item.semanticState === "rejected";
                  return (
                    <li key={item.id}>
                      {ambiguous ? (
                        <label className="confirm-toggle">
                          <input
                            type="checkbox"
                            name="confirmClaim"
                            value={item.normalizedLabel}
                          />
                          <span className="confirm-copy">
                            <span className="suggestion-head">
                              <span className="suggestion-label">{item.normalizedLabel}</span>
                              <span className="pill warn">Needs confirmation</span>
                            </span>
                            <span className="field-hint">{item.semanticReason}</span>
                          </span>
                        </label>
                      ) : (
                        <div className="confirm-toggle">
                          <Icon name={rejected ? "alert" : "check"} size={15} />
                          <span className="confirm-copy">
                            <span className="suggestion-head">
                              <span className="suggestion-label">{item.normalizedLabel}</span>
                              <span className="pill faint">
                                {rejected ? "Not treated as a service" : "Ready"}
                              </span>
                            </span>
                            {rejected && <span className="field-hint">{item.semanticReason}</span>}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <label className="confirm-toggle">
                <input type="checkbox" name="ownerAuthorized" required />
                <span className="confirm-copy">
                  I confirm this profile data came from a business account I am authorized to use.
                </span>
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Importing…" : "Import confirmed services"}
                </button>
              </div>
            </Form>
          </div>
        )}
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="preview-business-profile" />
          <div className="field">
            <label htmlFor="profile-file">Official profile data</label>
            <input
              id="profile-file"
              name="profileFile"
              type="file"
              accept=".json,application/json"
              required
            />
            <p className="field-hint">
              Upload the official ServiceList response from your authorized profile connection. No
              Orbit fields or manual service normalization are needed.
            </p>
          </div>
          <label className="confirm-toggle">
            <input type="checkbox" name="ownerAuthorized" required />
            <span className="confirm-copy">
              I have permission from the business to use this profile data.
            </span>
          </label>
          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Reading profile…" : "Review profile"}
            </button>
          </div>
        </Form>
      </details>
    </section>
  );
}

/**
 * Says out loud when the offerings list contains things nobody buys.
 *
 * Every line in that box is checked against the site and a gap becomes a priced
 * page recommendation, so "fully insured" sitting in there is one analysis away
 * from a proposal for a page about the client's insurance. The warning is
 * advisory and nothing is removed — the agency may have a good reason — but it
 * is stated plainly, before a run turns it into a number.
 */
function OfferingQuality({
  offerings,
  onEdit,
}: {
  offerings: string[];
  onEdit: () => void;
}) {
  const warnings = offeringWarnings(offerings);
  if (warnings.length === 0) return null;

  return (
    <div className="notice warn offering-quality">
      <Icon name="alert" size={14} />
      <div>
        <p>
          {warnings.length === 1
            ? "One entry looks like a claim about the business rather than work customers buy:"
            : `${warnings.length} entries look like claims about the business rather than work customers buy:`}
        </p>
        <ul className="tag-row">
          {warnings.map((w) => (
            <li key={w.value} className="pill">
              {w.value} <span className="faint">— {w.kind}</span>
            </li>
          ))}
        </ul>
        <p className="faint">
          Nothing has been changed. Left in the list, each of these is checked against the site like
          a service, and a missing page for one would be priced like a service.{" "}
          <button type="button" className="btn-link" onClick={onEdit}>
            Edit the list
          </button>
          .
        </p>
      </div>
    </div>
  );
}
