import type { TenantScope } from "@/db/tenant";
import type { AnalysisOutcome } from "@/core/analysisOutcome";
import { parseOfferingLabels } from "@/core/offeringDrift";

export async function portfolioChanges(t: TenantScope, now = new Date()) {
  const until = now.toISOString();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const range = "r.workspace_id = ? AND r.finished_at >= ? AND r.finished_at <= ?";
  const [summary, rawRuns, findings] = await Promise.all([
    t.db.prepare(`SELECT COUNT(*) AS checks, COUNT(DISTINCT client_id) AS clientsChecked,
      COALESCE(SUM(new_count),0) AS newFindings, COALESCE(SUM(resolved_count),0) AS resolvedFindings,
      COALESCE(SUM(CASE WHEN outcome = 'inconclusive' THEN 1 ELSE 0 END),0) AS inconclusive
      FROM analysis_runs r WHERE ${range}`).bind(t.workspaceId,since,until).first<{
        checks:number;clientsChecked:number;newFindings:number;resolvedFindings:number;inconclusive:number;
      }>(),
    t.db.prepare(`SELECT r.id, r.client_id AS clientId, c.name AS clientName,
      r.finished_at AS finishedAt, r.outcome, r.summary, r.trigger,
      r.new_count AS newCount, r.resolved_count AS resolvedCount,
      r.offering_drift AS offeringDrift
      FROM analysis_runs r JOIN clients c ON c.id = r.client_id AND c.workspace_id = r.workspace_id
      WHERE ${range} ORDER BY r.finished_at DESC,r.id DESC LIMIT 200`)
      .bind(t.workspaceId,since,until).all<{
        id:number;clientId:string;clientName:string;finishedAt:string;outcome:AnalysisOutcome;
        summary:string;trigger:string;newCount:number;resolvedCount:number;offeringDrift:string;
      }>(),
    // These rows carry current state plus durable funnel milestone timestamps.
    // The dashboard may project those timestamps into activity, but it never
    // infers a historical transition from updated_at alone.
    t.db.prepare(`SELECT o.id,o.title,o.status,c.name AS clientName,o.client_id AS clientId,
        o.updated_at AS updatedAt, o.accepted_at AS acceptedAt,
        o.proposal_prepared_at AS proposalPreparedAt, o.pitched_at AS pitchedAt,
        o.sold_at AS soldAt, o.lost_at AS lostAt
      FROM opportunities o JOIN clients c ON c.id = o.client_id AND c.workspace_id = o.workspace_id
      WHERE o.workspace_id = ? AND (
        (o.updated_at >= ? AND o.updated_at <= ? AND o.status IN ('new','accepted','proposal_prepared','pitched','resolved','sold','lost'))
        OR (o.accepted_at >= ? AND o.accepted_at <= ?)
        OR (o.proposal_prepared_at >= ? AND o.proposal_prepared_at <= ?)
        OR (o.pitched_at >= ? AND o.pitched_at <= ?)
        OR (o.sold_at >= ? AND o.sold_at <= ?)
        OR (o.lost_at >= ? AND o.lost_at <= ?)
      )
      ORDER BY o.updated_at DESC,o.id LIMIT 100`).bind(
        t.workspaceId,
        since,
        until,
        since,
        until,
        since,
        until,
        since,
        until,
        since,
        until,
        since,
        until,
      )
      .all<{
        id:string;title:string;status:string;clientName:string;clientId:string;updatedAt:string;
        acceptedAt:string|null;proposalPreparedAt:string|null;pitchedAt:string|null;
        soldAt:string|null;lostAt:string|null;
      }>(),
  ]);
  const runs = rawRuns.map((run) => ({
    ...run,
    offeringDrift: parseOfferingLabels(run.offeringDrift),
  }));
  return { since,until,summary:summary!,runs,findings };
}
