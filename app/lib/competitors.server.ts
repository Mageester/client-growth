import { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
import { createEvaluator } from "@/adapters/evaluator/createEvaluator";
import { parseAnalysisCaps, parseEnv } from "@/config/env";
import { judge } from "@/core/judgment";
import { assembleOpportunity } from "@/core/assembleOpportunity";
import { resolveBillability } from "@/core/billability";
import {
  findCompetitorGaps,
  type CompetitorGap,
  type CompetitorSite,
} from "@/core/competitorGaps";
import { serviceForRule } from "@/core/rules/registry";
import { CandidateSchema, ClientSchema, type EvidenceBundle } from "@/core/schema";
import { requireAnalysisReservation, type AnalysisLimitOptions } from "@/db/analysisLimits";
import { listCompetitors } from "@/db/competitors";
import * as repo from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";

/**
 * Compare a client against the competitors the agency named for them.
 *
 * Deliberately a separate, explicit action rather than part of every analysis.
 * One comparison crawls up to three whole websites, so folding it into the
 * ordinary run would triple the outbound cost of the thing users press most
 * often, and would do it invisibly. Here the agency asks for it, it takes a
 * slot from the same admission ledger as an analysis, and the cost is legible.
 *
 * Findings land in the normal opportunity queue, priced from the normal catalog
 * and suppressed by the normal prior decisions — a competitor gap is ordinary
 * sellable work with an unusually good argument attached, not a separate
 * feature bolted to the side of the product.
 */

/** Competitor crawls are shallower than the client's own: enough to see the shape. */
const COMPETITOR_MAX_PAGES = 8;

export interface CompetitorComparison {
  gaps: CompetitorGap[];
  readableCompetitors: string[];
  unreadableCompetitors: string[];
  limitation?: string;
  /** Opportunities written. Empty when nothing new was found. */
  surfaced: number;
  /** Set when the catalog cannot price this kind of work. */
  catalogGap?: string;
  /** Gaps the judgment gate refused to put in front of a client. */
  rejected: number;
  /** Evaluator calls this comparison spent. */
  evaluatorCalls: number;
}

export interface CompareCompetitorsOptions extends AnalysisLimitOptions {
  /** Injected in tests; production always crawls for real. */
  crawl?: (domain: string) => Promise<EvidenceBundle | null>;
}

async function crawlCompetitor(domain: string): Promise<EvidenceBundle | null> {
  try {
    const provider = new HttpEvidenceProvider({ maxPages: COMPETITOR_MAX_PAGES });
    const evidence = await provider.getEvidence(
      ClientSchema.parse({
        // The competitor is not a client and is never persisted as one. This
        // shape exists only because the crawler takes a client.
        id: `competitor:${domain}`,
        name: domain,
        domain,
        offerings: [],
      }),
    );
    const readable = evidence.site.pages.filter(
      (page) => page.status >= 200 && page.status < 300 && page.wordCount > 0,
    ).length;
    // One readable page is a homepage, not a picture of what a business sells.
    // Returning null here is what keeps an unreadable competitor out of the
    // count entirely rather than silently voting "does not have it".
    return readable >= 2 ? evidence : null;
  } catch {
    return null;
  }
}

function detectedSentence(gap: CompetitorGap, clientDomain: string): string {
  const others = gap.competitorDomains;
  const list =
    others.length === 1
      ? others[0]!
      : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]!}`;
  return (
    `${others.length} of this client's named competitors have a page for "${gap.label}" ` +
    `and ${clientDomain} has none: ${list}. ` +
    (gap.exampleUrl ? `Example: ${gap.exampleUrl}. ` : "") +
    `The client neither records this as an offering nor has a page about it.`
  );
}

export async function compareWithCompetitors(
  t: TenantScope,
  env: Record<string, unknown>,
  clientId: string,
  options: CompareCompetitorsOptions = {},
): Promise<CompetitorComparison> {
  const client = await repo.getClient(t, clientId);
  if (!client) throw new Response("Client not found", { status: 404 });

  const competitors = await listCompetitors(t, clientId);
  if (competitors.length === 0) {
    return {
      gaps: [],
      readableCompetitors: [],
      unreadableCompetitors: [],
      surfaced: 0,
      rejected: 0,
      evaluatorCalls: 0,
      limitation:
        "No competitors are recorded for this client. Add the businesses they actually " +
        "compete with, and the comparison can run.",
    };
  }

  // Same ledger as an analysis: this is the other action that spends real money
  // on outbound requests, and it must not be a way around the daily cap.
  const caps = parseAnalysisCaps(env);
  await requireAnalysisReservation(t, clientId, {
    now: options.now,
    cooldownMs: options.cooldownMs,
    dailyLimit: options.dailyLimit ?? caps.ANALYSIS_WORKSPACE_DAILY_LIMIT,
    platformDailyLimit: options.platformDailyLimit ?? caps.ANALYSIS_PLATFORM_DAILY_LIMIT,
  });

  const crawl = options.crawl ?? crawlCompetitor;
  const sites: CompetitorSite[] = [];
  for (const competitor of competitors) {
    sites.push({ domain: competitor.domain, evidence: await crawl(competitor.domain) });
  }

  // The client's own evidence comes from their last analysis rather than a
  // fresh crawl: comparing against a site we already read is honest, and
  // re-reading it here would double the cost of the action for no new fact.
  const clientEvidence = await repo.getLatestEvidence(t, clientId);

  const result = findCompetitorGaps({
    clientOfferings: client.offerings,
    clientEvidence,
    competitors: sites,
  });

  if (result.gaps.length === 0) {
    return { ...result, surfaced: 0, rejected: 0, evaluatorCalls: 0 };
  }

  const catalog = await repo.listServices(t);
  const service = serviceForRule(catalog, "competitor-gap");
  if (!service) {
    return {
      ...result,
      surfaced: 0,
      rejected: 0,
      evaluatorCalls: 0,
      catalogGap:
        "Competitor gaps were found, but no active service in your catalog is tagged to " +
        "sell them, so none could be priced. Add one on the Services page.",
    };
  }

  // findCompetitorGaps refuses to produce a gap without client evidence, so
  // this is unreachable — narrowed explicitly rather than asserted, because the
  // invariant lives in another module and a change there should fail here.
  if (!clientEvidence) {
    return { ...result, surfaced: 0, rejected: 0, evaluatorCalls: 0 };
  }

  const coverage = await repo.listCoverage(t, clientId);
  const billableStatus = resolveBillability(service.id, coverage);
  const now = options.now ?? new Date();

  const parsed = parseEnv(env);
  const evaluator = createEvaluator(parsed);
  const opportunities = [];
  let rejected = 0;
  let evaluatorCalls = 0;

  for (const gap of result.gaps) {
    if (evaluatorCalls >= parsed.MAX_AI_CALLS_PER_RUN) break;

    const candidate = CandidateSchema.parse({
      ruleId: "competitor-service-gap",
      subject: gap.label,
      detected: detectedSentence(gap, client.domain),
      evidenceRefs: [
        ...gap.competitorDomains.map((domain) => `competitor:${domain}`),
        ...(gap.exampleUrl ? [`page:${gap.exampleUrl}`] : []),
      ],
      // Deterministic and observed, but about someone else's website: the
      // claim "competitors sell this" is solid, while "your client should"
      // is a judgement the agency makes. Scored below a verified absence on
      // the client's own site for exactly that reason.
      rawConfidence: gap.competitorDomains.length >= 3 ? 0.8 : 0.7,
      suggestedServiceId: service.id,
    });

    // The same gate, for the same reason. The subject here was scraped from a
    // competitor's navigation, which is no more trustworthy than the agency's
    // offerings box: "Free Quotes" appears in both, and priced as a page it is
    // the pitch that ends a client relationship.
    evaluatorCalls += 1;
    let evaluation;
    try {
      evaluation = await evaluator.evaluate({ candidate, client, evidence: clientEvidence });
    } catch (error) {
      console.error(
        `[competitors] evaluator failed for "${candidate.subject}": ${
          error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        }`,
      );
      rejected += 1;
      continue;
    }

    if (!judge(candidate, evaluation).surface) {
      rejected += 1;
      continue;
    }

    opportunities.push(
      assembleOpportunity({ candidate, evaluation, billableStatus, service, clientId, now }),
    );
  }

  if (opportunities.length > 0) await repo.saveAnalysis(t, opportunities);
  return { ...result, surfaced: opportunities.length, rejected, evaluatorCalls };
}
