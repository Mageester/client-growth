import {
  MONITORING_INVOCATION_BUDGET_MS,
  MONITORING_MAX_CLIENTS_PER_RUN,
  type MonitoringOutcome,
} from "@/core/monitoring";
import * as monitoring from "@/db/monitoring";
import * as repo from "@/db/repositories";
import type { SqlDb } from "@/db/sql";
import type { TenantScope } from "@/db/tenant";
import { runAnalysis, type RunAnalysisResult } from "./analysis.server";

/**
 * The scheduled monitoring tick.
 *
 * One invocation, whatever invoked it — the Worker's `scheduled` handler, the
 * operator trigger route, or a test — runs exactly this function. There is no
 * second implementation of the schedule anywhere, so what a canary exercises is
 * what production runs.
 *
 * The shape is deliberately "select a little, claim it, do it, record it":
 *
 *   - the candidate list is capped before any work begins, so a large portfolio
 *     costs the same per tick as a small one;
 *   - each client is claimed with a single conditional UPDATE, so two overlapping
 *     invocations cannot both scan the same client;
 *   - every client is wrapped individually, so one client's crawl failure,
 *     provider outage or database error cannot stop the others or affect another
 *     workspace;
 *   - clients still due when the budget runs out are simply left due. Nothing is
 *     queued, nothing is retried in-process, and the next tick picks them up.
 */

export type AnalyzeForMonitoring = (
  t: TenantScope,
  env: Record<string, unknown>,
  clientId: string,
) => Promise<RunAnalysisResult>;

export interface MonitoringTickOptions {
  db: SqlDb;
  env: Record<string, unknown>;
  now?: Date;
  /** Clients this invocation may analyze. Defaults to the global cost ceiling. */
  limit?: number;
  /** Wall-clock budget, checked between clients only. */
  budgetMs?: number;
  /**
   * The analysis to run per client. Injected so the scale tests drive this exact
   * scheduler against deterministic sites with no live provider — the seam is
   * the analysis, never the scheduling.
   */
  analyze?: AnalyzeForMonitoring;
}

export interface MonitoringClientResult {
  clientId: string;
  workspaceId: string;
  outcome: MonitoringOutcome | "skipped";
  newCount: number;
  resolvedCount: number;
  evaluatorCalls: number;
}

export interface MonitoringTickResult {
  startedAt: string;
  finishedAt: string;
  /** Due clients this tick looked at (already capped by `limit`). */
  considered: number;
  /** Clients this tick took ownership of and analyzed to a verdict. */
  scanned: number;
  /** Due at selection, not ours by claim time: disabled, deleted, or taken. */
  skipped: number;
  /** Scans that threw. Recorded, backed off, never silently swallowed. */
  failed: number;
  newFindings: number;
  resolvedFindings: number;
  evaluatorCalls: number;
  /** True when the wall-clock budget stopped this tick early. */
  budgetExhausted: boolean;
  clients: MonitoringClientResult[];
}

/** Never let a provider or crawl detail become an unbounded stored string. */
function describeError(err: unknown): string {
  const text =
    err instanceof Response
      ? `${err.status} ${err.statusText}`
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
  return text.slice(0, 200);
}

/**
 * Persist a run row for a scan that never reached a verdict.
 *
 * A failed scheduled check must be visible — an agency that sees nothing cannot
 * tell "monitoring found nothing" from "monitoring did not run". It is recorded
 * as `inconclusive` because that is exactly what it is from the product's point
 * of view: we could not look. The client's own monitoring state separately
 * records `failed`, which is what drives the retry backoff.
 *
 * Best-effort by design: if the database is what failed, this fails too, and
 * the tick must still finish the remaining clients.
 */
async function recordFailedRun(
  t: TenantScope,
  clientId: string,
  input: { startedAt: string; detail: string },
): Promise<void> {
  try {
    await repo.recordAnalysisRun(t, {
      clientId,
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
      source: "http",
      outcome: "inconclusive",
      summary: "This scheduled check could not be completed, so nothing was assessed.",
      limitation:
        "Monitoring could not finish reading this site. Nothing was concluded and no finding was changed. " +
        `The next check is scheduled automatically. (${input.detail})`,
      pagesRead: 0,
      pagesFetched: 0,
      blockedEvents: 0,
      inconclusiveEvents: 0,
      surfaced: 0,
      stats: { failed: 1 },
      trigger: "scheduled",
      newCount: 0,
      resolvedCount: 0,
      evaluatorCalls: 0,
      evaluatorRejections: 0,
      evaluatorErrors: 0,
    });
  } catch (err) {
    console.error(
      `[monitoring] could not record the failed run for ${clientId}: ${describeError(err)}`,
    );
  }
}

export async function runMonitoringTick(
  options: MonitoringTickOptions,
): Promise<MonitoringTickResult> {
  const startedAtMs = Date.now();
  const now = options.now ?? new Date(startedAtMs);
  const limit = Math.max(0, options.limit ?? MONITORING_MAX_CLIENTS_PER_RUN);
  const budgetMs = options.budgetMs ?? MONITORING_INVOCATION_BUDGET_MS;
  const analyze: AnalyzeForMonitoring =
    options.analyze ??
    ((t, env, clientId) => runAnalysis(t, env, clientId, { trigger: "scheduled" }));

  const result: MonitoringTickResult = {
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    considered: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    newFindings: 0,
    resolvedFindings: 0,
    evaluatorCalls: 0,
    budgetExhausted: false,
    clients: [],
  };

  if (limit === 0) {
    result.finishedAt = new Date().toISOString();
    return result;
  }

  const due = await monitoring.listDueClients(options.db, { now, limit });
  result.considered = due.length;

  for (const candidate of due) {
    // Between clients only: a scan is never abandoned half-recorded.
    if (Date.now() - startedAtMs >= budgetMs) {
      result.budgetExhausted = true;
      break;
    }

    // The workspace comes from the client's own row and scopes everything after
    // this point. A scheduled scan can touch exactly one workspace at a time.
    const t: TenantScope = { db: options.db, workspaceId: candidate.workspaceId };

    const claimed = await monitoring.claimClient(options.db, candidate, now);
    if (!claimed) {
      result.skipped++;
      result.clients.push({
        clientId: candidate.clientId,
        workspaceId: candidate.workspaceId,
        outcome: "skipped",
        newCount: 0,
        resolvedCount: 0,
        evaluatorCalls: 0,
      });
      continue;
    }

    const startedAt = new Date().toISOString();
    let outcome: MonitoringOutcome = "failed";
    let newCount = 0;
    let resolvedCount = 0;
    let evaluatorCalls = 0;

    try {
      const run = await analyze(t, options.env, candidate.clientId);
      outcome = run.verdict.outcome;
      newCount = run.change.newCount;
      resolvedCount = run.change.resolvedCount;
      evaluatorCalls = run.stats.aiCalls;
    } catch (err) {
      const detail = describeError(err);
      console.error(`[monitoring] scan failed for ${candidate.clientId}: ${detail}`);
      await recordFailedRun(t, candidate.clientId, { startedAt, detail });
    }

    // Always runs, including after a failure: leaving a claim behind would keep
    // the client out of every later tick until the TTL expired.
    try {
      await monitoring.finishMonitoringRun(t, candidate.clientId, { outcome });
    } catch (err) {
      console.error(
        `[monitoring] could not record monitoring state for ${candidate.clientId}: ${describeError(err)}`,
      );
    }

    if (outcome === "failed") result.failed++;
    else result.scanned++;
    result.newFindings += newCount;
    result.resolvedFindings += resolvedCount;
    result.evaluatorCalls += evaluatorCalls;
    result.clients.push({
      clientId: candidate.clientId,
      workspaceId: candidate.workspaceId,
      outcome,
      newCount,
      resolvedCount,
      evaluatorCalls,
    });
  }

  result.finishedAt = new Date().toISOString();
  return result;
}
