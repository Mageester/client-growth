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
export interface WorkspaceExportOptions {
  /** Include paused business-profile evidence only when its schema is enabled. */
  includeExternalBusinessClaims?: boolean;
}

export async function workspaceExport(
  t: TenantScope,
  now = new Date(),
  options: WorkspaceExportOptions = {},
) {
  const tables = [
    "clients",
    "services",
    "client_coverage",
    "opportunities",
    "evidence_bundles",
    "analysis_runs",
  ] as const;

  const externalBusinessClaims = options.includeExternalBusinessClaims
    ? boundedRows<Record<string, unknown>>(
        t.db
          .prepare(
            `SELECT * FROM external_business_claims WHERE workspace_id = ? LIMIT ${EXPORT_QUERY_LIMIT}`,
          )
          .bind(t.workspaceId),
      )
    : Promise.resolve([] as Record<string, unknown>[]);

  const [rows, workspace, brandingRows, members, shareRows, reportRows, reportShareRows, externalClaims] = await Promise.all([
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
    boundedRows<{ workspace_id: string; logo: string | null; report_theme: string; updated_at: string }>(
      t.db
        .prepare(
          `SELECT workspace_id, logo, report_theme, updated_at
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
    boundedRows<{
      id: string;
      workspace_id: string;
      client_id: string;
      created_by_user_id: string;
      generated_at: string;
      evidence_reviewed_at: string | null;
      snapshot: string;
    }>(
      t.db
        .prepare(
          `SELECT id, workspace_id, client_id, created_by_user_id, generated_at,
                  evidence_reviewed_at, snapshot
           FROM client_report_snapshots
           WHERE workspace_id = ?
           ORDER BY generated_at DESC, id DESC
           LIMIT ${EXPORT_QUERY_LIMIT}`,
        )
        .bind(t.workspaceId),
    ),
    boundedRows<{
      id: string;
      workspace_id: string;
      report_id: string;
      token_hash: string;
      created_by_user_id: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      t.db
        .prepare(
          `SELECT id, workspace_id, report_id, token_hash, created_by_user_id,
                  created_at, expires_at, revoked_at
           FROM client_report_shares
           WHERE workspace_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ${EXPORT_QUERY_LIMIT}`,
        )
        .bind(t.workspaceId),
    ),
    externalBusinessClaims,
  ]);

  const nowIso = now.toISOString();
  const proposalShares = shareRows.map((share) => ({
    ...share,
    status: share.revoked_at ? "revoked" : share.expires_at <= nowIso ? "expired" : "active",
  }));
  const clientReportShares = reportShareRows.map((share) => ({
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
    clientReports: reportRows,
    clientReportShares,
    clients: rows[0],
    services: rows[1],
    coverage: rows[2],
    opportunities: rows[3],
    evidence: rows[4],
    analysisRuns: rows[5],
    externalBusinessClaims: externalClaims,
  };
}

interface CompletedRunRow {
  id: number;
  clientName: string;
  finishedAt: string;
  outcome: string;
  summary: string;
  evaluatorErrors: number;
}

interface FailedStartRow {
  id: number;
  clientId: string;
  clientName: string | null;
  reservedAt: string;
  finishedAt: string | null;
}

/**
 * One row an operator can act on, whichever way the check went wrong.
 *
 * `kind` is what separates "we ran and could not conclude" from "we never got
 * far enough to record anything" — two very different investigations that were
 * previously one number and one incomplete list.
 */
export interface AnalysisInvestigationRow {
  id: string;
  kind: "completed-run" | "failed-start";
  clientName: string;
  /** How far the check got before it stopped. */
  stage: string;
  at: string;
  /** A stored, safe explanation — never a raw provider exception or payload. */
  reason: string;
  evaluatorErrors: number;
}

/**
 * What we say when nothing was recorded.
 *
 * Not a guess at a cause. A reservation that failed before its run existed
 * leaves no evidence of why, and inventing one — "the site was unreachable",
 * "the provider timed out" — would send an operator to fix something that may
 * be fine.
 */
const NO_DETAIL_REASON = "The run stopped before a detailed record was created.";

function investigationRows(
  completed: CompletedRunRow[],
  failedStarts: FailedStartRow[],
): AnalysisInvestigationRow[] {
  const rows: AnalysisInvestigationRow[] = [
    ...completed.map((run) => ({
      id: `run-${run.id}`,
      kind: "completed-run" as const,
      clientName: run.clientName,
      stage: run.outcome === "inconclusive" ? "Completed, inconclusive" : "Completed with errors",
      at: run.finishedAt,
      reason: run.summary,
      evaluatorErrors: run.evaluatorErrors,
    })),
    ...failedStarts.map((start) => ({
      id: `start-${start.id}`,
      kind: "failed-start" as const,
      // A reservation can outlive the client it was made for; naming the id is
      // still more use to an operator than an empty cell.
      clientName: start.clientName ?? start.clientId,
      stage: "Failed before completing",
      at: start.finishedAt ?? start.reservedAt,
      reason: NO_DETAIL_REASON,
      evaluatorErrors: 0,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
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

  const [current, previous, incomplete, completedRuns, failedStartRows] = await Promise.all([
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
      .all<CompletedRunRow>(),
    // The failures the headline count is made of. Previously this was a bare
    // COUNT(*) and the list beside it came from analysis_runs, so a start that
    // failed before recording a run showed up as a number with nothing to
    // investigate. Rows and count now come from the same query.
    //
    // The join to clients is workspace-constrained on both columns, so a client
    // id that happens to collide across agencies cannot name the wrong client.
    t.db
      .prepare(
        `SELECT a.id, a.client_id AS clientId, c.name AS clientName,
                a.reserved_at AS reservedAt, a.finished_at AS finishedAt
         FROM analysis_limit_reservations a
         LEFT JOIN clients c ON c.id = a.client_id AND c.workspace_id = a.workspace_id
         WHERE a.workspace_id = ? AND a.reserved_at >= ? AND a.reserved_at < ? AND a.failed = 1
         ORDER BY a.reserved_at DESC, a.id DESC
         LIMIT 30`,
      )
      .bind(t.workspaceId, since, end)
      .all<FailedStartRow>(),
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
    failedStarts: failedStartRows.length,
    recentErrors: investigationRows(completedRuns, failedStartRows),
  };
}
