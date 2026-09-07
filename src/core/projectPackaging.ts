import { z } from "zod";

import type {
  Client,
  Opportunity,
  OpportunityStatus,
} from "@/core/schema";
import { coreTokens, significantTokens, singularize } from "@/core/text";
import {
  groupOpportunitiesByFamily,
  type OpportunityFamily,
  type OpportunityFamilyKey,
} from "@/core/opportunityGrouping";

/**
 * A row that can appear in a derived project view. The row is always the
 * persisted opportunity; packaging never creates a replacement record.
 */
export interface ProjectEntry {
  client: Pick<Client, "id" | "name" | "domain">;
  opportunity: Opportunity;
  /** The agency catalog label, when the caller already has it available. */
  serviceName?: string;
}

export type ProjectStatusSummary = Partial<Record<OpportunityStatus, number>>;

export interface ProjectGroupingBasis {
  kind: "deterministic" | "semantic";
  key: string;
  labels: string[];
}

export interface ProjectView<T extends ProjectEntry = ProjectEntry> {
  /** Display-only identity. It is never written as an opportunity ID. */
  displayKey: string;
  client: Pick<Client, "id" | "name" | "domain">;
  family: OpportunityFamily;
  title: string;
  summary: string;
  entries: T[];
  opportunityIds: string[];
  /** The exact additive value of the included underlying opportunity rows. */
  underlyingPriceMin: number;
  underlyingPriceMax: number;
  /** Intentionally absent until a defensible agency package-price basis exists. */
  packagePriceMin?: number;
  packagePriceMax?: number;
  pricingBasis: "not-set";
  statusSummary: ProjectStatusSummary;
  evidenceRefs: string[];
  groupingBasis: ProjectGroupingBasis;
}

/**
 * The only shape a future semantic grouper may return. It can name clusters,
 * but it cannot supply prices, statuses, evidence, or new opportunity IDs.
 */
export const ProjectGroupingProposalSchema = z
  .object({
    clusters: z
      .array(
        z
          .object({
            opportunityIds: z.array(z.string().min(1)).min(1),
            title: z.string().trim().min(1).max(120),
            summary: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type ProjectGroupingProposal = z.infer<typeof ProjectGroupingProposalSchema>;

const SERVICE_RULES = new Set([
  "missing-service-page",
  "no-service-pages",
  "competitor-service-gap",
]);

const GENERIC_SERVICE_NAME = /(?:service|landing)\s*page|page\s*build/i;

function subjectLabel(entry: ProjectEntry): string {
  const { opportunity } = entry;
  if (opportunity.ruleId === "no-service-pages") return "all service pages";

  const titleSubject = opportunity.title.split(/\s+[—–-]\s+/)[0]?.trim();
  if (SERVICE_RULES.has(opportunity.ruleId) && titleSubject) return titleSubject;

  const serviceName = entry.serviceName?.trim();
  if (serviceName && !GENERIC_SERVICE_NAME.test(serviceName)) return serviceName;
  return titleSubject || serviceName || "website work";
}

function normalizedLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugLabel(label: string): string {
  const tokens = significantTokens(label);
  const fallback = coreTokens(label).map(singularize);
  return (tokens.length > 0 ? tokens : fallback).join("-") || "general";
}

/**
 * Conservative deterministic affinities for common service-page families.
 * These are presentation clusters only; they do not assert that the services
 * are equivalent or change any underlying finding.
 */
function serviceAffinity(label: string): string {
  const value = normalizedLabel(label);
  if (/\b(?:water\s+heater|tankless)\b/.test(value)) return "water-heater";
  if (
    /\bwater\s+(?:filtration|treatment)\b/.test(value) ||
    /\b(?:sump\s+pump|water\s+(?:and|sewer)\s+line|sewer\s+line)\b/.test(value)
  ) {
    return "water-systems";
  }
  if (/\b(?:emergency|24\s*(?:hour|7)|drain|leak|garbage\s+disposal)\b/.test(value)) {
    return "emergency-repair";
  }
  if (/\b(?:furnace|boiler|heat\s+pump|heating|radiator|hvac|air\s+conditioning)\b/.test(value)) {
    return "heating";
  }
  return slugLabel(label);
}

function clusterKey(entry: ProjectEntry, family: OpportunityFamilyKey): string {
  const { opportunity } = entry;
  if (family === "service-visibility") {
    if (opportunity.ruleId === "no-service-pages") return "sitewide";
    return serviceAffinity(subjectLabel(entry));
  }
  if (family === "conversion") {
    return `conversion-${opportunity.conversionDefect?.kind ?? slugLabel(opportunity.title)}`;
  }
  const title = opportunity.title.split(/\s+[—–-]\s+/)[0] ?? opportunity.title;
  return `health-${opportunity.ruleId}-${slugLabel(title)}`;
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function joinLabels(labels: string[]): string {
  const unique = [...new Set(labels.map(lowerFirst))];
  if (unique.length <= 1) return unique[0] ?? "related work";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

function affinityFromKey(key: string): string {
  return key.replace(/^conversion-/, "").replace(/^health-[^-]+-/, "");
}

function projectTitle(
  family: OpportunityFamily,
  key: string,
  entries: readonly ProjectEntry[],
): string {
  if (family.key === "service-visibility") {
    if (entries.length === 1) return "Service expansion opportunity";
    switch (affinityFromKey(key)) {
      case "water-heater":
        return "Water Heater Service Expansion";
      case "water-systems":
        return "Water Systems Expansion";
      case "emergency-repair":
        return "Emergency & Repair Expansion";
      case "heating":
        return "Heating Service Expansion";
      default:
        return "Service Page Expansion";
    }
  }
  if (family.key === "conversion") {
    return entries.length > 1 ? "Conversion improvements" : "Conversion improvement";
  }
  return entries.length > 1 ? "Site health improvements" : "Site health improvement";
}

function projectSummary(
  family: OpportunityFamily,
  key: string,
  entries: readonly ProjectEntry[],
): string {
  const labels = entries.map(subjectLabel);
  if (family.key === "service-visibility") {
    if (entries.length === 1) {
      return `A focused service-page opportunity for ${labels[0] ?? "this service"}.`;
    }
    switch (affinityFromKey(key)) {
      case "water-heater":
        return "A stronger service-page structure covering water-heater repair, replacement and tankless service.";
      case "water-systems":
        return "A clearer service-page structure for water filtration, sump-pump and water-line services.";
      case "emergency-repair":
        return "A focused service-page structure for emergency and related repair services.";
      case "heating":
        return "A coherent service-page structure covering the client's heating services.";
      default:
        return `A coherent service-page scope covering ${joinLabels(labels)}.`;
    }
  }
  if (family.key === "conversion") {
    return "Related conversion-path fixes that can be reviewed as one client conversation.";
  }
  return family.description;
}

function statusSummary(entries: readonly ProjectEntry[]): ProjectStatusSummary {
  const result: ProjectStatusSummary = {};
  for (const entry of entries) {
    result[entry.opportunity.status] = (result[entry.opportunity.status] ?? 0) + 1;
  }
  return result;
}

function buildProject<T extends ProjectEntry>(
  family: OpportunityFamily,
  key: string,
  entries: readonly T[],
  overrides?: Pick<ProjectGroupingBasis, "kind"> & Partial<Pick<ProjectView<T>, "title" | "summary">>,
): ProjectView<T> {
  const first = entries[0]!;
  const safeKey = key.replace(/[^a-z0-9:_-]+/gi, "-");
  const underlyingPriceMin = entries.reduce((total, entry) => total + entry.opportunity.priceMin, 0);
  const underlyingPriceMax = entries.reduce((total, entry) => total + entry.opportunity.priceMax, 0);
  return {
    displayKey: `project:${first.client.id}:${family.key}:${safeKey}`,
    client: first.client,
    family,
    title: overrides?.title ?? projectTitle(family, key, entries),
    summary: overrides?.summary ?? projectSummary(family, key, entries),
    entries: [...entries],
    opportunityIds: entries.map((entry) => entry.opportunity.id),
    underlyingPriceMin,
    underlyingPriceMax,
    pricingBasis: "not-set",
    statusSummary: statusSummary(entries),
    evidenceRefs: [...new Set(entries.flatMap((entry) => entry.opportunity.evidenceRefs))],
    groupingBasis: {
      kind: overrides?.kind ?? "deterministic",
      key,
      labels: entries.map(subjectLabel),
    },
  };
}

function deterministicProjects<T extends ProjectEntry>(entries: readonly T[]): ProjectView<T>[] {
  const familyGroups = groupOpportunitiesByFamily([...entries]);
  const projects: ProjectView<T>[] = [];
  for (const familyGroup of familyGroups) {
    const clusters = new Map<string, T[]>();
    for (const entry of familyGroup.entries) {
      const key = clusterKey(entry, familyGroup.family.key);
      const cluster = clusters.get(key);
      if (cluster) cluster.push(entry);
      else clusters.set(key, [entry]);
    }
    for (const [key, cluster] of clusters) {
      projects.push(buildProject(familyGroup.family, key, cluster));
    }
  }
  return projects;
}

const UNSAFE_SEMANTIC_TEXT = /[$€£]|\b(?:package\s+price|suggested\s+price|estimate|quote|discount|markup|hourly\s+rate)\b/i;

function semanticTextIsGrounded(
  title: string,
  summary: string,
  entries: readonly ProjectEntry[],
): boolean {
  const proposalTokens = new Set(coreTokens(`${title} ${summary}`).map(singularize));
  return entries.some((entry) =>
    coreTokens(subjectLabel(entry)).some((token) => proposalTokens.has(singularize(token))),
  );
}

function semanticProjects<T extends ProjectEntry>(
  entries: readonly T[],
  rawProposal: unknown,
): ProjectView<T>[] | null {
  const parsed = ProjectGroupingProposalSchema.safeParse(rawProposal);
  if (!parsed.success) return null;

  const entryById = new Map(entries.map((entry) => [entry.opportunity.id, entry]));
  if (entryById.size !== entries.length) return null;

  const familyById = new Map<string, OpportunityFamilyKey>();
  for (const familyGroup of groupOpportunitiesByFamily([...entries])) {
    for (const entry of familyGroup.entries) familyById.set(entry.opportunity.id, familyGroup.family.key);
  }

  const seen = new Set<string>();
  const projects: ProjectView<T>[] = [];
  for (const cluster of parsed.data.clusters) {
    const clusterEntries: T[] = [];
    let family: OpportunityFamilyKey | undefined;
    let clientId: string | undefined;
    for (const id of cluster.opportunityIds) {
      if (seen.has(id)) return null;
      const entry = entryById.get(id);
      const entryFamily = familyById.get(id);
      if (!entry || !entryFamily) return null;
      if (UNSAFE_SEMANTIC_TEXT.test(cluster.title) || UNSAFE_SEMANTIC_TEXT.test(cluster.summary)) {
        return null;
      }
      if (family && family !== entryFamily) return null;
      if (clientId && clientId !== entry.client.id) return null;
      family = entryFamily;
      clientId = entry.client.id;
      seen.add(id);
      clusterEntries.push(entry);
    }
    if (!family || clusterEntries.length === 0) return null;
    if (!semanticTextIsGrounded(cluster.title, cluster.summary, clusterEntries)) return null;
    const familyDefinition = {
      ...groupOpportunitiesByFamily([clusterEntries[0]!])[0]!.family,
    };
    projects.push(
      buildProject(familyDefinition, `semantic-${projects.length}`, clusterEntries, {
        kind: "semantic",
        title: cluster.title,
        summary: cluster.summary,
      }),
    );
  }
  if (seen.size !== entries.length) return null;
  return projects;
}

/**
 * Build a presentation-only project list. A semantic proposal is optional and
 * must cover the exact supplied rows; any malformed or unsafe result falls
 * back to the deterministic clusters.
 */
export function buildProjectViews<T extends ProjectEntry>(
  entries: readonly T[],
  semanticProposal?: unknown,
): ProjectView<T>[] {
  const deterministic = deterministicProjects(entries);
  if (semanticProposal === undefined) return deterministic;
  return semanticProjects(entries, semanticProposal) ?? deterministic;
}

const STATUS_LABELS: Partial<Record<OpportunityStatus, string>> = {
  new: "new",
  accepted: "accepted",
  proposal_prepared: "proposal ready",
  pitched: "pitched",
  sold: "sold",
  lost: "lost",
  dismissed: "dismissed",
  already_covered: "covered",
  snoozed: "snoozed",
  resolved: "resolved",
  superseded: "superseded",
};

const STATUS_ORDER: OpportunityStatus[] = [
  "proposal_prepared",
  "accepted",
  "pitched",
  "new",
  "sold",
  "lost",
  "resolved",
  "dismissed",
  "already_covered",
  "snoozed",
  "superseded",
];

export function formatProjectStatusSummary(summary: ProjectStatusSummary): string {
  return STATUS_ORDER.filter((status) => (summary[status] ?? 0) > 0)
    .map((status) => `${summary[status]} ${STATUS_LABELS[status] ?? status}`)
    .join(" · ");
}
