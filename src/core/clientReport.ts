import type { Client, Opportunity, OpportunityStatus } from "@/core/schema";
import { parseEvidenceRef } from "@/core/evidenceRef";
import { normalizeAndValidateUrl } from "@/adapters/evidence/urlPolicy";
import {
  buildProjectViews,
  type ProjectEntry,
  type ProjectView,
} from "@/core/projectPackaging";
import { tierForRule } from "@/core/rules/registry";

/** The plain-language notice shown on every client-facing report. */
export const CLIENT_REPORT_NOTICE =
  "This document summarizes identified opportunities and recommended work for discussion. Pricing and outcomes are not guaranteed unless explicitly confirmed.";

/** A report never recommends closed, paused, or already-covered work. */
const REPORTABLE_STATUSES = new Set<OpportunityStatus>([
  "new",
  "accepted",
  "proposal_prepared",
  "pitched",
]);

const INTERNAL_LANGUAGE =
  /\b(?:rule[_ -]?id|crawler|evaluator|deepseek|confidence\s+(?:score|machinery)|finding\s+type|opportunity\s+id|internal\s+metadata)\b/i;

export type ReportCandidateCategory = "commercial" | "health";

export interface ReportCandidateInput {
  client: Pick<Client, "id" | "name" | "domain">;
  opportunities: Opportunity[];
  serviceNameById?: Readonly<Record<string, string>>;
  latestRun?: {
    outcome: "findings" | "clean" | "inconclusive";
    finishedAt: string;
    limitation?: string | null;
  } | null;
}

export interface ReportCandidate {
  key: string;
  category: ReportCandidateCategory;
  project: ProjectView<ProjectEntry>;
  defaultSelected: boolean;
}

export interface ReportCandidates {
  commercial: ReportCandidate[];
  health: ReportCandidate[];
  defaultSelectedKeys: string[];
  eligibleOpportunityIds: string[];
  excludedOpportunityIds: string[];
  limitations: string[];
  evidenceReviewedAt: string | null;
  canGenerate: boolean;
}

export interface ClientReportEvidenceSnapshot {
  label: string;
  url: string | null;
  note: string;
}

export interface ClientReportFindingSnapshot {
  title: string;
  observed: string;
  evidence: ClientReportEvidenceSnapshot[];
}

export interface ClientReportPackagePrice {
  amount: number;
  currency: "USD";
}

export interface ClientReportProjectSnapshot {
  title: string;
  rationale: string;
  observed: string;
  scope: string[];
  findings: ClientReportFindingSnapshot[];
  underlyingOpportunityValue: { min: number; max: number } | null;
  packagePrice: ClientReportPackagePrice | null;
}

export interface ClientReportPublicSnapshot {
  schemaVersion: 1;
  agency: { name: string; logo: string | null };
  client: { name: string; domain: string };
  preparedBy: string;
  generatedAt: string;
  evidenceReviewedAt: string | null;
  notice: string;
  executiveSummary: {
    recommendedProjectCount: number;
    strongestCommercialArea: string | null;
    underlyingOpportunityValue: { min: number; max: number } | null;
  };
  recommendedProjects: ClientReportProjectSnapshot[];
  supportingProjects: ClientReportProjectSnapshot[];
  agencyNote: string | null;
  nextStep: string;
  limitations: string[];
}

export interface ClientReportAuditOpportunitySnapshot {
  id: string;
  dedupeKey: string;
  ruleId: Opportunity["ruleId"];
  title: string;
  suggestedServiceId: string;
  confidence: number;
  status: OpportunityStatus;
  billableStatus: Opportunity["billableStatus"];
  priceMin: number;
  priceMax: number;
  detected: string;
  rationale: string;
  suggestedScope: string[];
  evidenceRefs: string[];
  verification?: Opportunity["verification"];
  conversionDefect?: Opportunity["conversionDefect"];
}

/** Internal provenance retained for integrity/audit, never returned publicly. */
export interface ClientReportAuditSnapshot {
  workspaceId: string;
  clientId: string;
  createdByUserId: string;
  selectedProjectKeys: string[];
  includedOpportunityIds: string[];
  includedOpportunities: ClientReportAuditOpportunitySnapshot[];
}

export interface ClientReportStoredSnapshot {
  public: ClientReportPublicSnapshot;
  audit: ClientReportAuditSnapshot;
}

export interface BuildClientReportSnapshotInput {
  workspaceId: string;
  createdByUserId: string;
  client: Pick<Client, "id" | "name" | "domain">;
  agency: { name: string; logo: string | null };
  preparedBy: string;
  generatedAt: string;
  evidenceReviewedAt: string | null;
  candidates: ReportCandidates;
  selection: {
    selectedKeys: string[];
    orderedKeys: string[];
    showUnderlyingValue: boolean;
    packagePrices?: Readonly<Record<string, number | null | undefined>>;
    /** Keys explicitly confirmed by a human in the builder. */
    confirmedPackagePriceKeys?: readonly string[];
    agencyNote?: string | null;
    nextStepNote?: string | null;
  };
}

export class ClientReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientReportValidationError";
  }
}

function projectCategory(project: ProjectView<ProjectEntry>): ReportCandidateCategory {
  return tierForRule(project.entries[0]?.opportunity.ruleId ?? "missing-title") === "commercial"
    ? "commercial"
    : "health";
}

function maxConfidence(project: ProjectView<ProjectEntry>): number {
  return Math.max(...project.entries.map((entry) => entry.opportunity.confidence), 0);
}

function compareCandidates(a: ReportCandidate, b: ReportCandidate): number {
  return (
    b.project.underlyingPriceMax - a.project.underlyingPriceMax ||
    b.project.underlyingPriceMin - a.project.underlyingPriceMin ||
    maxConfidence(b.project) - maxConfidence(a.project) ||
    a.project.title.localeCompare(b.project.title) ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Report eligibility is narrower than the opportunity feed. A report is a
 * client conversation, so it only uses active billable rows from a completed
 * readable run and never turns a paused, closed, or inconclusive row into a
 * recommendation.
 */
export function isReportableOpportunity(opportunity: Opportunity): boolean {
  if (opportunity.billableStatus !== "billable") return false;
  if (!REPORTABLE_STATUSES.has(opportunity.status)) return false;
  if (
    opportunity.verification &&
    opportunity.verification.conclusion !== "absent"
  ) {
    return false;
  }
  return true;
}

function limitationForRun(input: ReportCandidateInput): string[] {
  if (input.latestRun?.outcome !== "inconclusive") return [];
  return [
    input.latestRun.limitation?.trim() ||
      "The latest review could not be completed, so no recommendations were included.",
  ];
}

/**
 * Derive the small set of report choices from persisted opportunity rows. The
 * default is deliberately conservative: at most three strongest commercial
 * projects, with health work available but never preselected.
 */
export function buildReportCandidates(input: ReportCandidateInput): ReportCandidates {
  // Persisted opportunities are unique by client/dedupe key, but keeping the
  // derivation idempotent also protects callers that combine multiple reads.
  const opportunities = [...new Map(input.opportunities.map((opportunity) => [opportunity.id, opportunity])).values()];
  const allIds = opportunities.map((opportunity) => opportunity.id);
  const limitations = limitationForRun(input);
  const latestRunIsInconclusive = input.latestRun?.outcome === "inconclusive";
  const eligible = latestRunIsInconclusive
    ? []
    : opportunities.filter(isReportableOpportunity);
  const eligibleIds = new Set(eligible.map((opportunity) => opportunity.id));
  const entries: ProjectEntry[] = eligible.map((opportunity) => ({
    client: input.client,
    opportunity,
    serviceName: input.serviceNameById?.[opportunity.suggestedServiceId],
  }));

  const derived = buildProjectViews(entries).map((project): ReportCandidate => ({
    key: project.displayKey,
    category: projectCategory(project),
    project,
    defaultSelected: false,
  }));
  const commercial = derived.filter((candidate) => candidate.category === "commercial").sort(compareCandidates);
  const health = derived.filter((candidate) => candidate.category === "health").sort(compareCandidates);
  const defaultSelectedKeys = commercial.slice(0, 3).map((candidate) => candidate.key);
  const defaultSet = new Set(defaultSelectedKeys);
  for (const candidate of [...commercial, ...health]) {
    candidate.defaultSelected = defaultSet.has(candidate.key);
  }

  return {
    commercial,
    health,
    defaultSelectedKeys,
    eligibleOpportunityIds: [...eligibleIds],
    excludedOpportunityIds: allIds.filter((id) => !eligibleIds.has(id)),
    limitations,
    evidenceReviewedAt: input.latestRun?.finishedAt ?? null,
    canGenerate: !latestRunIsInconclusive && eligible.length > 0,
  };
}

function publicTitleFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "");
    if (!path) return "Home page";
    const segments = path
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .map((segment) => segment.replace(/\.(?:html?|php|aspx?)$/i, "").replace(/[-_]+/g, " "))
      .filter(Boolean);
    return segments.length
      ? segments.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" / ")
      : "Home page";
  } catch {
    return "Website page";
  }
}

function publicEvidenceForOpportunity(opportunity: Opportunity): ClientReportEvidenceSnapshot[] {
  const items: ClientReportEvidenceSnapshot[] = [];
  const seen = new Set<string>();
  const add = (raw: string, note: string) => {
    const policy = normalizeAndValidateUrl(raw);
    if (!policy.ok) return;
    const url = policy.url.toString();
    if (seen.has(url) || items.length >= 4) return;
    seen.add(url);
    items.push({ label: publicTitleFromUrl(url), url, note });
  };

  for (const raw of opportunity.evidenceRefs) {
    const reference = parseEvidenceRef(raw);
    if (!reference.url) continue;
    if (reference.kind === "page") add(reference.url, "Page reviewed during the website check.");
    if (reference.kind === "verified") add(reference.url, "Page checked to verify the recommendation.");
    if (reference.kind === "considered") add(reference.url, "Page reviewed as a close match.");
    if (reference.kind === "external") add(reference.url, "Owner-provided business profile source.");
  }
  for (const raw of opportunity.verification?.inspectedUrls ?? []) {
    add(raw, "Page checked to verify the recommendation.");
  }
  if (opportunity.conversionDefect?.pageUrl) {
    add(opportunity.conversionDefect.pageUrl, "Page containing the observed issue.");
  }
  return items;
}

function safeText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed && !INTERNAL_LANGUAGE.test(trimmed) ? trimmed : fallback;
}

function safeScope(project: ProjectView<ProjectEntry>): string[] {
  const scope = [...new Set(
    project.entries.flatMap((entry) => entry.opportunity.suggestedScope.map((line) => line.trim())),
  )].filter((line) => line && !INTERNAL_LANGUAGE.test(line));
  if (scope.length > 0) return scope;
  return project.family.key === "site-health"
    ? ["Review and address the listed website improvements."]
    : ["Review, plan and create the relevant service pages."];
}

function projectObserved(project: ProjectView<ProjectEntry>): string {
  const count = project.entries.length;
  const fallback =
    count === 1
      ? "The website review identified a specific opportunity connected to this service."
      : `The website review identified ${count} related opportunities in this area.`;
  const observed = project.entries.length === 1 ? project.entries[0]!.opportunity.detected : "";
  return safeText(observed, fallback);
}

function projectSnapshot(
  candidate: ReportCandidate,
  showUnderlyingValue: boolean,
  packagePrice: number | null | undefined,
): ClientReportProjectSnapshot {
  const project = candidate.project;
  const packageSnapshot =
    packagePrice === null || packagePrice === undefined
      ? null
      : { amount: packagePrice, currency: "USD" as const };
  return {
    title: safeText(project.title, "Recommended website work"),
    rationale: safeText(
      project.summary,
      "A focused piece of work connected to what this business offers.",
    ),
    observed: projectObserved(project),
    scope: safeScope(project),
    findings: project.entries.map((entry) => ({
      title: safeText(entry.opportunity.title, "Website opportunity"),
      observed: safeText(
        entry.opportunity.detected,
        "The website review identified this opportunity.",
      ),
      evidence: publicEvidenceForOpportunity(entry.opportunity),
    })),
    underlyingOpportunityValue: showUnderlyingValue
      ? { min: project.underlyingPriceMin, max: project.underlyingPriceMax }
      : null,
    packagePrice: packageSnapshot,
  };
}

function snapshotVerification(
  verification: Opportunity["verification"],
): Opportunity["verification"] {
  if (!verification) return undefined;
  return {
    ...verification,
    inspectedUrls: [...verification.inspectedUrls],
    closeMatches: verification.closeMatches.map((match) => ({ ...match })),
  };
}

function snapshotConversionDefect(
  defect: Opportunity["conversionDefect"],
): Opportunity["conversionDefect"] {
  if (!defect) return undefined;
  return {
    ...defect,
    seenOn: [...defect.seenOn],
  };
}

function validateSelection(
  candidates: ReportCandidates,
  selectedKeys: readonly string[],
  orderedKeys: readonly string[],
): ReportCandidate[] {
  if (selectedKeys.length === 0) {
    throw new ClientReportValidationError("Select at least one project before generating the report.");
  }
  if (new Set(selectedKeys).size !== selectedKeys.length) {
    throw new ClientReportValidationError("A project can only be included once.");
  }
  if (new Set(orderedKeys).size !== orderedKeys.length || orderedKeys.length !== selectedKeys.length) {
    throw new ClientReportValidationError("Project order must contain each selected project exactly once.");
  }
  const byKey = new Map(
    [...candidates.commercial, ...candidates.health].map((candidate) => [candidate.key, candidate]),
  );
  const selectedSet = new Set(selectedKeys);
  if (orderedKeys.some((key) => !selectedSet.has(key))) {
    throw new ClientReportValidationError("Project order contains an unselected project.");
  }
  const selected = orderedKeys.map((key) => byKey.get(key));
  if (selected.some((candidate) => !candidate)) {
    throw new ClientReportValidationError("One selected project is no longer available.");
  }
  return selected as ReportCandidate[];
}

function validatePackagePrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new ClientReportValidationError("A confirmed package price must be greater than zero.");
  }
  return value;
}

/** Build the immutable public projection and its private integrity snapshot. */
export function buildClientReportSnapshot(
  input: BuildClientReportSnapshotInput,
): ClientReportStoredSnapshot {
  const selected = validateSelection(
    input.candidates,
    input.selection.selectedKeys,
    input.selection.orderedKeys,
  );
  const selectedKeys = selected.map((candidate) => candidate.key);
  const packagePrices = input.selection.packagePrices ?? {};
  const confirmedPackagePriceKeys = new Set(input.selection.confirmedPackagePriceKeys ?? []);
  const commercialCandidates = selected.filter((candidate) => candidate.category === "commercial");
  const healthCandidates = selected.filter((candidate) => candidate.category === "health");
  const packageFor = (candidate: ReportCandidate) =>
    candidate.category === "commercial" && confirmedPackagePriceKeys.has(candidate.key)
      ? validatePackagePrice(packagePrices[candidate.key])
      : null;
  const recommendedProjects = commercialCandidates.map((candidate) =>
    projectSnapshot(candidate, input.selection.showUnderlyingValue, packageFor(candidate)),
  );
  const supportingProjects = healthCandidates.map((candidate) =>
    projectSnapshot(candidate, input.selection.showUnderlyingValue, packageFor(candidate)),
  );
  const includedEntries = selected.flatMap((candidate) => candidate.project.entries);
  const publicValue = input.selection.showUnderlyingValue
    ? {
        min: includedEntries.reduce((sum, entry) => sum + entry.opportunity.priceMin, 0),
        max: includedEntries.reduce((sum, entry) => sum + entry.opportunity.priceMax, 0),
      }
    : null;
  const agencyName = input.agency.name.trim() || "Your agency";
  const agencyNote = input.selection.agencyNote?.trim() || null;
  const nextStep =
    input.selection.nextStepNote?.trim() ||
    `Review the recommended priorities with ${agencyName}, confirm the scope and pricing, then decide what to do next.`;
  const limitations = [...new Set(input.candidates.limitations.map((limitation) => limitation.trim()).filter(Boolean))];

  return {
    public: {
      schemaVersion: 1,
      agency: { name: agencyName, logo: input.agency.logo ?? null },
      client: { name: input.client.name, domain: input.client.domain },
      preparedBy: input.preparedBy.trim() || "Your agency team",
      generatedAt: input.generatedAt,
      evidenceReviewedAt: input.evidenceReviewedAt,
      notice: CLIENT_REPORT_NOTICE,
      executiveSummary: {
        recommendedProjectCount: recommendedProjects.length,
        strongestCommercialArea: recommendedProjects[0]?.title ?? null,
        underlyingOpportunityValue: publicValue,
      },
      recommendedProjects,
      supportingProjects,
      agencyNote,
      nextStep,
      limitations,
    },
    audit: {
      workspaceId: input.workspaceId,
      clientId: input.client.id,
      createdByUserId: input.createdByUserId,
      selectedProjectKeys: selectedKeys,
      includedOpportunityIds: includedEntries.map((entry) => entry.opportunity.id),
      includedOpportunities: includedEntries.map((entry) => ({
        id: entry.opportunity.id,
        dedupeKey: entry.opportunity.dedupeKey,
        ruleId: entry.opportunity.ruleId,
        title: entry.opportunity.title,
        suggestedServiceId: entry.opportunity.suggestedServiceId,
        confidence: entry.opportunity.confidence,
        status: entry.opportunity.status,
        billableStatus: entry.opportunity.billableStatus,
        priceMin: entry.opportunity.priceMin,
        priceMax: entry.opportunity.priceMax,
        detected: entry.opportunity.detected,
        rationale: entry.opportunity.rationale,
        suggestedScope: [...entry.opportunity.suggestedScope],
        evidenceRefs: [...entry.opportunity.evidenceRefs],
        verification: snapshotVerification(entry.opportunity.verification),
        conversionDefect: snapshotConversionDefect(entry.opportunity.conversionDefect),
      })),
    },
  };
}
