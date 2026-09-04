import type { SqlStatement } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";

const MAX_EXPORT_ROWS = 10_000;
const EXPORT_QUERY_LIMIT = MAX_EXPORT_ROWS + 1;
const EXPORT_TOO_LARGE_MESSAGE =
  "This workspace needs a larger export. Contact support; no partial export was generated.";

async function boundedRows<T>(statement: SqlStatement): Promise<T[]> {
  const rows = await statement.all<T>();
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Response(EXPORT_TOO_LARGE_MESSAGE, { status: 413 });
  }
  return rows;
}

/** Application data only. Authentication tables and invitation secrets are never exported. */
export async function workspaceExport(t: TenantScope, now = new Date()) {
  const tables = [
    "clients",
    "services",
    "client_coverage",
    "opportunities",
    "evidence_bundles",
    "analysis_runs",
  ] as const;

  const [rows, workspace, brandingRows, members, shareRows] = await Promise.all([
    Promise.all(
      tables.map((table) =>
        boundedRows<Record<string, unknown>>(
          t.db
            .prepare(
              `SELECT * FROM ${table} WHERE workspace_id = ? LIMIT ${EXPORT_QUERY_LIMIT}`,
            )
            .bind(t.workspaceId),
        ),
      ),
    ),
    t.db
      .prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?")
      .bind(t.workspaceId)
      .first<{ id: string; name: string; created_at: string }>(),
    boundedRows<{ workspace_id: string; logo: string | null; updated_at: string }>(
      t.db
        .prepare(
          `SELECT workspace_id, logo, updated_at
           FROM workspace_branding
           WHERE workspace_id = ?
           LIMIT ${EXPORT_QUERY_LIMIT}`,
        )
        .bind(t.workspaceId),
    ),
    boundedRows<{
      workspace_id: string;
      user_id: string;
      role: string;
      created_at: string;
    }>(
      t.db
        .prepare(
          `SELECT workspace_id, user_id, role, created_at
           FROM workspace_members
           WHERE workspace_id = ?
           ORDER BY created_at ASC, user_id ASC
           LIMIT ${EXPORT_QUERY_LIMIT}`,
        )
        .bind(t.workspaceId),
    ),
    boundedRows<{
      id: string;
      workspace_id: string;
      opportunity_id: string;
      snapshot: string;
      created_by_user_id: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      t.db
        .prepare(
          `SELECT id, workspace_id, opportunity_id, snapshot, created_by_user_id,
                  created_at, expires_at, revoked_at
           FROM proposal_shares
           WHERE workspace_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ${EXPORT_QUERY_LIMIT}`,
        )
        .bind(t.workspaceId),
    ),
  ]);

  const nowIso = now.toISOString();
  const proposalShares = shareRows.map((share) => ({
    ...share,
    status: share.revoked_at ? "revoked" : share.expires_at <= nowIso ? "expired" : "active",
  }));

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    workspace,
    branding: brandingRows[0] ?? null,
    members,
    proposalShares,
    clients: rows[0],
    services: rows[1],
    coverage: rows[2],
    opportunities: rows[3],
    evidence: rows[4],
    analysisRuns: rows[5],
  };
}

interface HealthTotals {
  checks: number;
  clean: number;
  findings: number;
  inconclusive: number;
  evaluatorErrors: number;
  evaluatorCalls: number;
}

export async function analysisHealth(t: TenantScope, now = new Date()) {
  const end = now.toISOString();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const priorSince = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const totals = (start: string, until: string) =>
    t.db
      .prepare(
        `SELECT COUNT(*) AS checks,
          COALESCE(SUM(CASE WHEN outcome = 'clean' THEN 1 ELSE 0 END),0) AS clean,
          COALESCE(SUM(CASE WHEN outcome = 'findings' THEN 1 ELSE 0 END),0) AS findings,
          COALESCE(SUM(CASE WHEN outcome = 'inconclusive' THEN 1 ELSE 0 END),0) AS inconclusive,
          COALESCE(SUM(evaluator_errors),0) AS evaluatorErrors,
          COALESCE(SUM(evaluator_calls),0) AS evaluatorCalls
         FROM analysis_runs
         WHERE workspace_id = ? AND finished_at >= ? AND finished_at < ?`,
      )
      .bind(t.workspaceId, start, until)
      .first<HealthTotals>();

  const [current, previous, incomplete, failed, recentErrors] = await Promise.all([
    totals(since, end),
    totals(priorSince, since),
    t.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM analysis_limit_reservations a
         WHERE a.workspace_id = ? AND a.reserved_at >= ? AND a.reserved_at < ?
           AND EXISTS (
             SELECT 1 FROM clients c
             WHERE c.id = a.client_id AND c.workspace_id = a.workspace_id
           )
           AND a.finished_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM analysis_runs r
             WHERE r.workspace_id = a.workspace_id
               AND r.client_id = a.client_id
               AND r.started_at = a.reserved_at
           )`,
      )
      .bind(
        t.workspaceId,
        since,
        new Date(now.getTime() - 10 * 60_000).toISOString(),
      )
      .first<{ count: number }>(),
    t.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM analysis_limit_reservations
         WHERE workspace_id = ? AND reserved_at >= ? AND reserved_at < ? AND failed = 1`,
      )
      .bind(t.workspaceId, since, end)
      .first<{ count: number }>(),
    t.db
      .prepare(
        `SELECT r.id, c.name AS clientName, r.finished_at AS finishedAt,
                r.outcome, r.summary, r.evaluator_errors AS evaluatorErrors
         FROM analysis_runs r
         JOIN clients c ON c.id = r.client_id AND c.workspace_id = r.workspace_id
         WHERE r.workspace_id = ? AND r.finished_at >= ? AND r.finished_at < ?
           AND (r.evaluator_errors > 0 OR r.outcome = 'inconclusive')
         ORDER BY r.finished_at DESC, r.id DESC
         LIMIT 30`,
      )
      .bind(t.workspaceId, since, end)
      .all<{
        id: number;
        clientName: string;
        finishedAt: string;
        outcome: string;
        summary: string;
        evaluatorErrors: number;
      }>(),
  ]);

  const rate = current!.checks ? current!.inconclusive / current!.checks : null;
  const previousRate = previous!.checks ? previous!.inconclusive / previous!.checks : null;
  const elevated =
    current!.checks >= 5 &&
    rate !== null &&
    rate >= 0.5 &&
    (previousRate === null || rate - previousRate >= 0.2 || rate >= 0.8);
  const alert = elevated
    ? `Axiom Orbit could not fully assess ${current!.inconclusive} of ${current!.checks} checks this week. Review client setup and recent check results before relying on this portfolio.`
    : null;

  return {
    since,
    until: end,
    current: current!,
    previous: previous!,
    rate,
    previousRate,
    alert,
    incompleteStarts: incomplete?.count ?? 0,
    failedStarts: failed?.count ?? 0,
    recentErrors,
  };
}
