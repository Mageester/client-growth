import type { Opportunity, RuleId } from "@/core/schema";
import { tierForRule, type RuleTier } from "@/core/rules/registry";

/**
 * What this agency actually sells, measured from their own history.
 *
 * The product's weakest property is that every scan starts from nothing. It
 * knows which findings are TRUE — the rules and the judgment gate see to that —
 * and nothing about which are WORTH PUTTING IN FRONT OF A CLIENT. Those are
 * different questions, and only the agency's own outcomes answer the second.
 *
 * So: count what sold, per rule, and let that ordering carry forward. An agency
 * that has sold six missing-service-page findings and never once sold a missing
 * alt attribute should not be shown the alt attributes with equal billing, and
 * no amount of cleverness in the rules can work that out on its own.
 *
 * Deliberately descriptive. It reports what happened and does not predict, does
 * not model, and does not manufacture a number from a thin sample — a rule with
 * two outcomes says "2 of 2", never "100%".
 */

/**
 * Outcomes that count as a decided sales attempt: the CLIENT's answers. A
 * dismissal is the agency declining internally — often with no client
 * conversation ever happening — so it is not a client loss and must never sit
 * in a close-rate denominator. See core/salesFunnel.ts for the full funnel
 * semantics this module shares.
 */
const DECIDED = new Set<Opportunity["status"]>(["sold", "lost"]);

export interface RuleWinRate {
  ruleId: RuleId;
  tier: RuleTier;
  /** Findings the client decided: sold or lost. */
  decided: number;
  sold: number;
  /** Total of every recorded sale amount for this rule. */
  soldValue: number;
  /** Sales that recorded an amount; soldValue is an average over these only. */
  valuedSales: number;
  /**
   * sold / (sold + lost), or null when the client has decided nothing yet.
   * Null is not zero: "never sold" and "never tried" must not look the same.
   */
  rate: number | null;
  averageSale: number | null;
}

export interface WinRates {
  byRule: ReadonlyMap<RuleId, RuleWinRate>;
  totalSold: number;
  totalSoldValue: number;
  /** Rules with at least one decision, best-converting first. */
  ranked: readonly RuleWinRate[];
}

function blank(ruleId: RuleId): RuleWinRate {
  return {
    ruleId,
    tier: tierForRule(ruleId),
    decided: 0,
    sold: 0,
    soldValue: 0,
    valuedSales: 0,
    rate: null,
    averageSale: null,
  };
}

export function computeWinRates(opportunities: readonly Opportunity[]): WinRates {
  const byRule = new Map<RuleId, RuleWinRate>();
  let totalSold = 0;
  let totalSoldValue = 0;

  for (const opp of opportunities) {
    if (!DECIDED.has(opp.status)) continue;
    const entry = byRule.get(opp.ruleId) ?? blank(opp.ruleId);
    entry.decided += 1;
    if (opp.status === "sold") {
      entry.sold += 1;
      totalSold += 1;
      if (typeof opp.soldAmount === "number" && Number.isFinite(opp.soldAmount)) {
        entry.soldValue += opp.soldAmount;
        entry.valuedSales += 1;
        totalSoldValue += opp.soldAmount;
      }
    }
    byRule.set(opp.ruleId, entry);
  }

  for (const entry of byRule.values()) {
    entry.rate = entry.decided > 0 ? entry.sold / entry.decided : null;
    entry.averageSale = entry.valuedSales > 0 ? entry.soldValue / entry.valuedSales : null;
  }

  const ranked = [...byRule.values()].sort(
    (a, b) =>
      (b.rate ?? 0) - (a.rate ?? 0) ||
      b.sold - a.sold ||
      a.ruleId.localeCompare(b.ruleId),
  );

  return { byRule, totalSold, totalSoldValue, ranked };
}

/**
 * Order findings by what this agency converts, then by value.
 *
 * Tier leads, always. A health finding with a freakish win rate off two sales
 * does not get to outrank the commercial work an agency is in business to sell;
 * evidence reorders findings within a tier, it does not redefine the product.
 *
 * A rule with no history sorts as if it converts at the tier's own observed
 * rate rather than at zero, so a new rule is not buried before it has ever been
 * given a chance to be sold.
 */
/**
 * Rebuild a WinRates from the plain array a loader can serialize.
 *
 * `byRule` is a Map, which does not survive the loader boundary. Rather than
 * make every caller re-derive the rates from the full opportunity history on
 * the client, the ranked array crosses and the index is rebuilt here.
 */
export function winRatesFromRanked(
  ranked: readonly RuleWinRate[] | undefined | null,
): WinRates {
  // Absent is a legitimate input, not a bug to crash on: a page rendered before
  // this field existed, or any caller with no history to hand. "No outcomes
  // recorded" is exactly what an empty set of rates means, and ranking already
  // handles it by giving every rule the benefit of the doubt.
  const rows = ranked ?? [];
  return {
    byRule: new Map(rows.map((entry) => [entry.ruleId, entry])),
    totalSold: rows.reduce((sum, entry) => sum + entry.sold, 0),
    totalSoldValue: rows.reduce((sum, entry) => sum + entry.soldValue, 0),
    ranked: rows,
  };
}

export function rankingScore(opp: Opportunity, rates: WinRates): number {
  const entry = rates.byRule.get(opp.ruleId);
  if (entry?.rate !== null && entry?.rate !== undefined) return entry.rate;

  const tier = tierForRule(opp.ruleId);
  const peers = [...rates.byRule.values()].filter(
    (candidate) => candidate.tier === tier && candidate.rate !== null,
  );
  if (peers.length === 0) return 0.5;
  return peers.reduce((sum, peer) => sum + (peer.rate ?? 0), 0) / peers.length;
}

export function byEvidencedValue(
  rates: WinRates,
): (a: Opportunity, b: Opportunity) => number {
  return (a, b) => {
    const tierA = tierForRule(a.ruleId) === "commercial" ? 0 : 1;
    const tierB = tierForRule(b.ruleId) === "commercial" ? 0 : 1;
    return (
      tierA - tierB ||
      rankingScore(b, rates) - rankingScore(a, rates) ||
      b.priceMax - a.priceMax ||
      b.confidence - a.confidence ||
      a.title.localeCompare(b.title)
    );
  };
}
