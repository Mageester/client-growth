import type { Opportunity } from "@/core/schema";

/**
 * Funnel measurement semantics.
 *
 * The one rule this module exists to enforce: a close rate counts what the
 * CLIENT decided. `sold` is a win, `lost` is the client declining after being
 * presented with the work. `dismissed` is the AGENCY declining internally,
 * often before any client conversation — it is a different decision by a
 * different party and must never appear in a close-rate denominator.
 *
 * Legacy rows (recorded before the funnel existed) keep trustworthy status but
 * may have unknown intermediate milestones. Status is the outcome of record,
 * so a legacy `sold` still counts as sold and a legacy `lost` still counts as
 * a client loss. What is never done is inventing an intermediate milestone:
 * `pitchedOrLater` on a legacy `sold` row is false, because nobody recorded
 * that the client was ever presented with it.
 */

const ACCEPTED_OR_LATER: ReadonlySet<Opportunity["status"]> = new Set([
  "accepted",
  "proposal_prepared",
  "pitched",
  "sold",
  "lost",
]);

/**
 * Has this opportunity reached the "agency decided it is worth pursuing"
 * milestone or beyond? Milestone timestamps matter for legacy rows: a `sold`
 * row with no acceptedAt is a genuine acceptance whose date was never recorded
 * — status remains the evidence of the stage.
 */
export function acceptedOrLater(opp: Opportunity): boolean {
  return ACCEPTED_OR_LATER.has(opp.status);
}

/**
 * Has this opportunity reached the "client was presented with it" milestone or
 * beyond?
 *
 * `pitched` status is the agency's own claim and is trusted on its own. But a
 * terminal outcome (sold/lost) only implies a pitch when the milestone was
 * actually recorded: a legacy sold row with no pitchedAt is known-sold but
 * unknown-pitched, and counting it as pitch evidence would fabricate history
 * the product never observed.
 */
export function pitchedOrLater(opp: Opportunity): boolean {
  if (opp.status === "pitched") return true;
  if (opp.status === "sold" || opp.status === "lost") return opp.pitchedAt !== undefined;
  return false;
}

/**
 * Close rate: sold / (sold + lost), the client-decided outcomes only.
 *
 * Null means "the client has decided nothing yet" — distinct from zero, and
 * never padded with dismissed, snoozed, pending or resolved rows to manufacture
 * a denominator.
 */
export function closeRate(opportunities: readonly Opportunity[]): number | null {
  let sold = 0;
  let lost = 0;
  for (const opp of opportunities) {
    if (opp.status === "sold") sold += 1;
    else if (opp.status === "lost") lost += 1;
  }
  return sold + lost === 0 ? null : sold / (sold + lost);
}

export interface FunnelMetrics {
  /** accepted-or-later / surfaced tracked opportunities. */
  acceptanceRate: number;
  /** pitched-or-later / accepted-or-later. */
  pitchRate: number;
  /** sold / (sold + lost). Null until the client has decided something. */
  closeRate: number | null;
}

/**
 * The three funnel rates over one portfolio/opportunity set.
 *
 * "Surfaced tracked opportunities" is every row in the input: the caller
 * decides which rows belong to the measured window. Dismissed rows count in
 * the acceptance denominator — they were surfaced, and the agency declining
 * them IS the acceptance decision failing — but never in the close rate.
 *
 * Legacy rows whose intermediate milestones were never recorded are counted by
 * status only (a legacy sold row is accepted-or-later) but their unknown
 * stages are not fabricated: a legacy sold row is not pitched evidence.
 */
export function funnelMetrics(opportunities: readonly Opportunity[]): FunnelMetrics {
  let surfaced = 0;
  let accepted = 0;
  let pitched = 0;
  for (const opp of opportunities) {
    // Operational states never entered the funnel: they are not "surfaced
    // tracked opportunities" in the measurement sense. Superseded rows are
    // bookkeeping; resolved/already_covered rows were never sellable as-is.
    if (
      opp.status === "superseded" ||
      opp.status === "already_covered" ||
      opp.status === "resolved" ||
      opp.status === "snoozed"
    ) {
      continue;
    }
    surfaced += 1;
    if (acceptedOrLater(opp)) accepted += 1;
    if (pitchedOrLater(opp)) pitched += 1;
  }

  const close = closeRate(opportunities);
  return {
    acceptanceRate: surfaced === 0 ? 0 : accepted / surfaced,
    pitchRate: accepted === 0 ? 0 : pitched / accepted,
    closeRate: close,
  };
}
