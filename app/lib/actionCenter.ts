import type { AnalysisRun } from "@/db/repositories";
import type { Client, Opportunity } from "@/core/schema";
import { acceptedOrLater, closeRate, pitchedOrLater } from "@/core/salesFunnel";
import { tierForRule } from "@/core/rules/registry";
import {
  groupOpportunitiesByFamily,
  type OpportunityFamilyKey,
} from "@/core/opportunityGrouping";
import { byPotentialValue, isOpen, nextAction, sumTotals, totalsFor } from "./portfolio";

export interface ActionCenterInput {
  clients: readonly Client[];
  opportunitiesByClient: ReadonlyMap<string, readonly Opportunity[]>;
  latestRunsByClient: ReadonlyMap<string, AnalysisRun>;
}

export type ActionKind = "commercial" | "site-health" | "analysis";
export type AnalysisActionState = "inconclusive" | "never";

export interface ActionQueueItem {
  id: string;
  kind: ActionKind;
  analysisState?: AnalysisActionState;
  client: Pick<Client, "id" | "name" | "domain">;
  family: OpportunityFamilyKey | null;
  stage: ActionStage | null;
  title: string;
  detail: string;
  action: string;
  href: string;
  count: number;
  priceMin: number;
  priceMax: number;
  /** Display-only references. The underlying opportunity rows are unchanged. */
  opportunityIds: string[];
}

export interface PipelineSummary {
  newCount: number;
  acceptedCount: number;
  pitchedCount: number;
  soldCount: number;
  lostCount: number;
  closeRate: number | null;
  /** Null means sold work exists but no sold amount was recorded. */
  soldRevenue: number | null;
  openCount: number;
  openPriceMin: number;
  openPriceMax: number;
}

export interface ActionCenter {
  queue: ActionQueueItem[];
  pipeline: PipelineSummary;
}

export interface RecentActivityItem {
  id: string;
  clientId: string;
  clientName: string;
  label: string;
  detail: string;
  at: string;
  href: string;
}

export interface RecentActivityInput {
  since?: string;
  runs: readonly {
    id: number;
    clientId: string;
    clientName: string;
    finishedAt: string;
    outcome: AnalysisRun["outcome"];
    summary: string;
    newCount: number;
    resolvedCount: number;
    offeringDrift: readonly string[];
  }[];
  findings: readonly {
    id: string;
    title: string;
    clientId: string;
    clientName: string;
    acceptedAt?: string | null;
    proposalPreparedAt?: string | null;
    pitchedAt?: string | null;
    soldAt?: string | null;
    lostAt?: string | null;
  }[];
}

type ActionStage = "pitched" | "proposal_prepared" | "accepted" | "new";

const ACTION_STAGE_ORDER: Record<ActionStage, number> = {
  pitched: 0,
  proposal_prepared: 1,
  accepted: 2,
  new: 3,
};

function actionStage(opportunities: readonly Opportunity[]): ActionStage {
  if (opportunities.some((opp) => opp.status === "pitched")) return "pitched";
  if (opportunities.some((opp) => opp.status === "proposal_prepared")) {
    return "proposal_prepared";
  }
  if (opportunities.some((opp) => opp.status === "accepted")) return "accepted";
  return "new";
}

function opportunityForStage(opportunities: readonly Opportunity[], stage: ActionStage): Opportunity {
  return opportunities.find((opp) => opp.status === stage) ?? opportunities[0]!;
}

function familyTitle(kind: ActionKind, family: OpportunityFamilyKey, count: number): string {
  if (kind === "site-health") return count > 1 ? "Site health improvements" : "Site health improvement";
  if (family === "conversion") return count > 1 ? "Conversion improvements" : "Conversion improvement";
  return count > 1 ? "Service expansion opportunity" : "Service expansion opportunity";
}

function familyDetail(
  kind: ActionKind,
  stage: ActionStage,
  count: number,
  opportunities: readonly Opportunity[],
): string {
  if (kind === "site-health") {
    return `${count} related ${count === 1 ? "website fix" : "website fixes"} supporting the client work.`;
  }
  if (stage === "pitched") return "Pitched work awaiting the client's decision.";
  if (stage === "proposal_prepared") return "A proposal is ready to send to the client.";
  if (stage === "accepted") return "Accepted work ready for a proposal.";
  if (opportunities.length === 1) return "A new commercial opportunity is ready for review.";
  return `${count} related commercial findings from the same service-visibility work.`;
}

function opportunityHref(clientId: string): string {
  return `/opportunities?client=${encodeURIComponent(clientId)}`;
}

function clientHref(clientId: string): string {
  return `/clients/${encodeURIComponent(clientId)}`;
}

function opportunityItem(
  client: Client,
  family: OpportunityFamilyKey,
  opportunities: readonly Opportunity[],
): ActionQueueItem {
  const ordered = [...opportunities].sort(byPotentialValue);
  const kind: ActionKind = ordered.some((opp) => tierForRule(opp.ruleId) === "commercial")
    ? "commercial"
    : "site-health";
  const stage = actionStage(ordered);
  const totals = totalsFor(ordered);
  const count = ordered.length;

  return {
    id: `opportunities:${client.id}:${family}`,
    kind,
    client: { id: client.id, name: client.name, domain: client.domain },
    family,
    stage,
    title: familyTitle(kind, family, count),
    detail: familyDetail(kind, stage, count, ordered),
    action: kind === "site-health" ? "Review" : nextAction(opportunityForStage(ordered, stage)),
    href: opportunityHref(client.id),
    count,
    priceMin: totals.priceMin,
    priceMax: totals.priceMax,
    opportunityIds: ordered.map((opp) => opp.id),
  };
}

function analysisItem(
  client: Client,
  state: AnalysisActionState,
  run: AnalysisRun | undefined,
): ActionQueueItem {
  const inconclusive = state === "inconclusive";
  return {
    id: `analysis:${client.id}`,
    kind: "analysis",
    analysisState: state,
    client: { id: client.id, name: client.name, domain: client.domain },
    family: null,
    stage: null,
    title: inconclusive ? "Analysis needs another look" : "Ready for a first analysis",
    detail: inconclusive
      ? run?.summary || "The site could not be fully assessed."
      : "This client has not been checked yet.",
    action: inconclusive ? "Retry analysis" : "Run first analysis",
    href: clientHref(client.id),
    count: 0,
    priceMin: 0,
    priceMax: 0,
    opportunityIds: [],
  };
}

function itemPriority(item: ActionQueueItem): number {
  if (item.kind === "analysis") return item.analysisState === "inconclusive" ? 0 : 40;
  if (item.kind === "site-health") return 30;

  return 10 + ACTION_STAGE_ORDER[item.stage ?? "new"];
}

function compareItems(a: ActionQueueItem, b: ActionQueueItem): number {
  return (
    itemPriority(a) - itemPriority(b) ||
    b.priceMax - a.priceMax ||
    b.count - a.count ||
    a.client.name.localeCompare(b.client.name) ||
    a.id.localeCompare(b.id)
  );
}

function flatten(input: ActionCenterInput): Opportunity[] {
  return [...input.opportunitiesByClient.values()].flatMap((rows) => [...rows]);
}

function pipelineSummary(opportunities: readonly Opportunity[]): PipelineSummary {
  const sold = opportunities.filter((opp) => opp.status === "sold");
  const soldAmounts = sold
    .map((opp) => opp.soldAmount)
    .filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount));
  const totals = sumTotals([totalsFor([...opportunities])]);

  return {
    newCount: opportunities.filter(
      (opp) => opp.status === "new" && opp.billableStatus === "billable",
    ).length,
    acceptedCount: opportunities.filter(acceptedOrLater).length,
    pitchedCount: opportunities.filter(pitchedOrLater).length,
    soldCount: sold.length,
    lostCount: opportunities.filter((opp) => opp.status === "lost").length,
    closeRate: closeRate(opportunities),
    soldRevenue:
      sold.length === 0 ? 0 : soldAmounts.length === 0 ? null : soldAmounts.reduce((a, b) => a + b, 0),
    openCount: totals.open,
    openPriceMin: totals.priceMin,
    openPriceMax: totals.priceMax,
  };
}

/**
 * Project persisted dates into a compact feed. This is not event sourcing:
 * analysis runs and funnel milestone timestamps are already durable facts, so
 * the dashboard can show them without inventing a second activity ledger.
 */
export function buildRecentActivity(input: RecentActivityInput): RecentActivityItem[] {
  const sinceMs = input.since ? Date.parse(input.since) : Number.NEGATIVE_INFINITY;
  const activity: RecentActivityItem[] = input.runs.map((run) => {
    const details: string[] = [];
    if (run.outcome === "inconclusive") {
      details.push(run.summary || "The site could not be fully assessed.");
    } else if (run.newCount > 0) {
      details.push(
        `${run.newCount} new ${run.newCount === 1 ? "opportunity" : "opportunities"} surfaced.`,
      );
    } else if (run.resolvedCount > 0) {
      details.push(
        `${run.resolvedCount} ${run.resolvedCount === 1 ? "opportunity" : "opportunities"} confirmed fixed.`,
      );
    } else {
      details.push(run.summary || "Analysis completed.");
    }
    if (run.offeringDrift.length > 0) details.push(`New on site: ${run.offeringDrift.join(", ")}`);

    return {
      id: `run:${run.id}`,
      clientId: run.clientId,
      clientName: run.clientName,
      label: run.outcome === "inconclusive" ? "Analysis needs attention" : "Analysis completed",
      detail: details.join(" "),
      at: run.finishedAt,
      href: clientHref(run.clientId),
    };
  });

  const milestones: Array<{
    key: "acceptedAt" | "proposalPreparedAt" | "pitchedAt" | "soldAt" | "lostAt";
    label: string;
  }> = [
    { key: "acceptedAt", label: "Opportunity accepted" },
    { key: "proposalPreparedAt", label: "Proposal prepared" },
    { key: "pitchedAt", label: "Pitched to client" },
    { key: "soldAt", label: "Sold" },
    { key: "lostAt", label: "Not closed" },
  ];

  for (const finding of input.findings) {
    for (const milestone of milestones) {
      const at = finding[milestone.key];
      if (!at || Date.parse(at) < sinceMs) continue;
      activity.push({
        id: `opportunity:${finding.id}:${milestone.key}`,
        clientId: finding.clientId,
        clientName: finding.clientName,
        label: milestone.label,
        detail: finding.title,
        at,
        href: opportunityHref(finding.clientId),
      });
    }
  }

  return activity.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id),
  );
}

/**
 * Build the Action Center from the same rows used by the existing portfolio.
 * This is a presentation projection only: it never creates, merges, or
 * changes opportunity records, statuses, prices, or funnel milestones.
 */
export function buildActionCenter(input: ActionCenterInput): ActionCenter {
  const queue: ActionQueueItem[] = [];

  for (const client of input.clients) {
    const opportunities = [...(input.opportunitiesByClient.get(client.id) ?? [])];
    const open = opportunities.filter(isOpen);
    const groups = groupOpportunitiesByFamily(
      open.map((opportunity) => ({ opportunity, client })),
    );

    for (const group of groups) {
      queue.push(
        opportunityItem(
          client,
          group.family.key,
          group.entries.map((entry) => entry.opportunity),
        ),
      );
    }

    const latest = input.latestRunsByClient.get(client.id);
    if (latest?.outcome === "inconclusive") {
      queue.push(analysisItem(client, "inconclusive", latest));
    } else if (!latest && open.length === 0) {
      queue.push(analysisItem(client, "never", latest));
    }
  }

  return {
    queue: queue.sort(compareItems),
    pipeline: pipelineSummary(flatten(input)),
  };
}
