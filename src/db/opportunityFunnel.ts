import type { Opportunity } from "@/core/schema";
import type { TenantScope } from "@/db/tenant";

/**
 * The single domain-level path for opportunity sales-funnel transitions.
 *
 * Route files must not scatter raw status writes: every commercial transition
 * goes through `applyFunnelTransition`, which owns two invariants the rest of
 * the product depends on:
 *
 * 1. Milestones are FIRST-TIME stamps. `acceptedAt ??= now`, never `= now`.
 *    Re-accepting, re-pitching or re-marking a loss never rewrites history.
 * 2. Later milestones imply earlier ones. Recording a sale straight from `new`
 *    stamps acceptedAt and pitchedAt too, because the sale proves both happened
 *    — the agency records the outcome, not the ceremony.
 *
 * Terminal client outcomes (`sold`, `lost`) and the internal rejection
 * (`dismissed`) are never casually reverted. `dismissed` and `lost` are
 * different decisions by different parties: an internal rejection never
 * becomes a client loss, and a recorded win never becomes a loss.
 */

export type FunnelAction =
  | { kind: "accept" }
  | { kind: "dismiss" }
  | { kind: "prepare-proposal"; proposalMd: string }
  | { kind: "pitch" }
  | { kind: "sold"; soldAmount?: number; at?: string }
  | { kind: "lost" }
  | { kind: "snooze"; snoozeUntil: string }
  | { kind: "cover" }
  | { kind: "reopen" };

export interface FunnelTransitionOptions {
  now?: Date;
}

/**
 * Which current statuses each action may fire from. Deliberately explicit:
 * this table is the whole transition policy, and anything not listed fails
 * closed (the call returns false and writes nothing). `snoozed` appears only
 * where the snooze is known-expired (the caller's open guard has already
 * checked it): the transition clears the snooze as a side effect.
 */
const ALLOWED_FROM: Record<FunnelAction["kind"], ReadonlySet<Opportunity["status"]>> = {
  accept: new Set(["new", "accepted", "snoozed"]),
  dismiss: new Set(["new", "accepted", "proposal_prepared", "snoozed"]),
  "prepare-proposal": new Set(["new", "accepted", "proposal_prepared", "snoozed"]),
  pitch: new Set(["new", "accepted", "proposal_prepared", "pitched"]),
  // A sale can be recorded after the fact from any actionable state, and
  // re-recording on a sold row is an explicit correction of amount/date.
  sold: new Set(["new", "accepted", "proposal_prepared", "pitched", "dismissed", "lost", "sold"]),
  // "Lost" means the client saw it and declined: never from sold (a recorded
  // win is revenue history) and never from dismissed (an internal rejection
  // must not grow a client conversation it never had).
  lost: new Set(["new", "accepted", "proposal_prepared", "pitched", "lost"]),
  snooze: new Set(["new", "accepted", "proposal_prepared", "pitched", "snoozed"]),
  // Contract coverage is authoritative over the agency's own decisions, but
  // never over a terminal client outcome (sold/lost stay untouched).
  cover: new Set([
    "new",
    "accepted",
    "proposal_prepared",
    "pitched",
    "snoozed",
    "dismissed",
    "already_covered",
    "resolved",
  ]),
  // Reopen is for the agency's own non-terminal states: an internal dismissal
  // is reconsidered, an active snooze is cancelled, and a resolved finding can
  // be manually returned (existing product behavior — genuine re-detection of
  // a resolved finding also starts a fresh cycle on its own). Sold and lost are
  // client-decided history and are conspicuously absent.
  reopen: new Set(["dismissed", "snoozed", "resolved"]),
};

/**
 * The stage of the sales funnel an opportunity has reached, for compact
 * progress display. Milestones win over status where they disagree (a legacy
 * row may carry milestones without this run's status vocabulary), and
 * operational states that never entered the funnel read as not-started.
 */
export function salesStageOf(
  opp: Pick<
    Opportunity,
    "status" | "acceptedAt" | "proposalPreparedAt" | "pitchedAt" | "proposalMd"
  >,
): "found" | "accepted" | "proposal" | "pitched" | "sold" | "lost" | "dismissed" | null {
  switch (opp.status) {
    case "sold":
      return "sold";
    case "lost":
      return "lost";
    case "dismissed":
      return "dismissed";
    case "already_covered":
    case "resolved":
    case "superseded":
      return null;
    default:
      break;
  }
  // A draft exists: the row is at the proposal stage no matter what
  // operational wrapper (including an active snooze) sits on top of it, so
  // draft review stays aligned across every surface.
  if (opp.status === "pitched" || opp.pitchedAt) return "pitched";
  if (opp.status === "proposal_prepared" || opp.proposalPreparedAt) return "proposal";
  if (opp.status === "accepted" || opp.acceptedAt) return "accepted";
  // A plain `new` row is always at the funnel's first question, even if a
  // draft survived an earlier cycle via reopen: the stage reflects where the
  // AGENCY is, and a reopened row is back at the start.
  if (opp.status === "new") return "found";
  if (opp.proposalMd) return "proposal";
  return "found";
}

/**
 * Apply one funnel transition, tenant-scoped, all-or-nothing.
 *
 * Returns false — and writes nothing — when the opportunity does not exist in
 * this workspace, is superseded, or the action is not valid from its current
 * status. Callers surface that as an error; the database is never left with a
 * half-applied decision.
 */
export async function applyFunnelTransition(
  t: TenantScope,
  id: string,
  action: FunnelAction,
  options: FunnelTransitionOptions = {},
): Promise<boolean> {
  const current = await t.db
    .prepare(
      "SELECT * FROM opportunities WHERE id = ? AND workspace_id = ? AND status <> 'superseded'",
    )
    .bind(id, t.workspaceId)
    .first<{
      status: Opportunity["status"];
      accepted_at: string | null;
      proposal_prepared_at: string | null;
      pitched_at: string | null;
      lost_at: string | null;
      dismissed_at: string | null;
      sold_amount: number | null;
      sold_at: string | null;
      snooze_until: string | null;
    }>();
  if (!current) return false;

  if (!ALLOWED_FROM[action.kind].has(current.status)) return false;

  const now = (options.now ?? new Date()).toISOString();
  const keep = (first: string | null, stamp?: string): string | null => first ?? stamp ?? null;

  const next: {
    status: Opportunity["status"];
    accepted_at: string | null;
    proposal_prepared_at: string | null;
    pitched_at: string | null;
    lost_at: string | null;
    dismissed_at: string | null;
    sold_amount: number | null;
    sold_at: string | null;
    snooze_until: string | null;
    proposal_md?: string;
    clearProposalMd?: boolean;
    billable_status?: string;
  } = {
    status: current.status,
    accepted_at: current.accepted_at,
    proposal_prepared_at: current.proposal_prepared_at,
    pitched_at: current.pitched_at,
    lost_at: current.lost_at,
    dismissed_at: current.dismissed_at,
    sold_amount: current.sold_amount,
    sold_at: current.sold_at,
    snooze_until: current.snooze_until ?? null,
  };

  switch (action.kind) {
    case "accept":
      next.status = "accepted";
      next.accepted_at = keep(current.accepted_at, now);
      next.snooze_until = null;
      break;
    case "dismiss":
      next.status = "dismissed";
      next.dismissed_at = keep(current.dismissed_at, now);
      next.snooze_until = null;
      break;
    case "prepare-proposal": {
      const md = action.proposalMd.trim();
      if (!md) return false;
      next.status = "proposal_prepared";
      // First proposal implies acceptance; editing never resets the milestone.
      next.accepted_at = keep(current.accepted_at, now);
      next.proposal_prepared_at = keep(current.proposal_prepared_at, now);
      next.proposal_md = md;
      next.snooze_until = null;
      break;
    }
    case "pitch":
      next.status = "pitched";
      next.accepted_at = keep(current.accepted_at, now);
      next.pitched_at = keep(current.pitched_at, now);
      next.snooze_until = null;
      break;
    case "sold": {
      next.status = "sold";
      next.accepted_at = keep(current.accepted_at, now);
      next.pitched_at = keep(current.pitched_at, now);
      // Re-recording on a sold row is an explicit correction; the existing
      // recordOpportunitySale behaviour is preserved.
      next.sold_at = action.at ?? now;
      next.sold_amount =
        typeof action.soldAmount === "number" &&
        Number.isFinite(action.soldAmount) &&
        action.soldAmount >= 0
          ? action.soldAmount
          : null;
      next.snooze_until = null;
      break;
    }
    case "lost":
      next.status = "lost";
      next.accepted_at = keep(current.accepted_at, now);
      // The client saw it — that is what "lost" means — so the pitch
      // milestone always exists on a lost row.
      next.pitched_at = keep(current.pitched_at, now);
      next.lost_at = keep(current.lost_at, now);
      next.snooze_until = null;
      break;
    case "snooze":
      next.status = "snoozed";
      next.snooze_until = action.snoozeUntil;
      break;
    case "cover":
      next.status = "already_covered";
      next.billable_status = "already_covered";
      next.snooze_until = null;
      break;
    case "reopen": {
      const wasResolved = current.status === "resolved";
      next.status = "new";
      next.snooze_until = null;
      // Stale funnel milestones are cleared either way: the row is back at the
      // funnel's first question, and milestones belonging to the previous pass
      // must not read as this one's history.
      next.accepted_at = null;
      next.proposal_prepared_at = null;
      next.pitched_at = null;
      next.lost_at = null;
      next.dismissed_at = null;
      // A resolved row is a CLOSED cycle: its draft belonged to work the client
      // already fixed, so the reopened cycle starts clean. A dismissed or
      // snoozed row is the SAME sales opportunity reconsidered — the agency's
      // draft may legitimately be reused.
      next.clearProposalMd = wasResolved;
      // Fail-safe inherited from the previous reopen path: nothing that can be
      // reopened carries a recorded sale, and none may survive a reopen.
      next.sold_amount = null;
      next.sold_at = null;
      break;
    }
  }

  const r = await t.db
    .prepare(
      `UPDATE opportunities SET
         status = ?,
         accepted_at = ?,
         proposal_prepared_at = ?,
         pitched_at = ?,
         lost_at = ?,
         dismissed_at = ?,
         sold_amount = ?,
         sold_at = ?,
         snooze_until = ?,
         billable_status = COALESCE(?, billable_status),
         proposal_md = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, proposal_md) END,
         updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = ? AND status <> 'superseded'`,
    )
    .bind(
      next.status,
      next.accepted_at,
      next.proposal_prepared_at,
      next.pitched_at,
      next.lost_at,
      next.dismissed_at,
      next.sold_amount,
      next.sold_at,
      next.snooze_until,
      next.billable_status ?? null,
      next.clearProposalMd ? 1 : 0,
      next.proposal_md ?? null,
      now,
      id,
      t.workspaceId,
      current.status,
    )
    .run();
  return r.rowsAffected > 0;
}
