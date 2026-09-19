// app/lib/monitoring.server.ts
function describeError(err) {
  const text = err instanceof Response ? `${err.status} ${err.statusText}` : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 200);
}
__name(describeError, "describeError");
async function recordFailedRun(t, clientId2, input) {
  try {
    await recordAnalysisRun(t, {
      clientId: clientId2,
      startedAt: input.startedAt,
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: "http",
      outcome: "inconclusive",
      summary: "This scheduled check could not be completed, so nothing was assessed.",
      limitation: `Monitoring could not finish reading this site. Nothing was concluded and no finding was changed. The next check is scheduled automatically. (${input.detail})`,
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
      evaluatorErrors: 0
    });
  } catch (err) {
    console.error(
      `[monitoring] could not record the failed run for ${clientId2}: ${describeError(err)}`
    );
  }
}
__name(recordFailedRun, "recordFailedRun");
async function deferAfterAnalysisLimit(t, clientId2, retryAt) {
  await t.db.prepare(
    `UPDATE clients SET
         monitoring_claimed_at = NULL,
         monitoring_next_due_at = CASE
           WHEN monitoring_cadence = 'off' THEN NULL
           WHEN monitoring_next_due_at IS NULL OR monitoring_next_due_at < ? THEN ?
           ELSE monitoring_next_due_at
         END
       WHERE id = ? AND workspace_id = ?`
  ).bind(retryAt, retryAt, clientId2, t.workspaceId).run();
}
__name(deferAfterAnalysisLimit, "deferAfterAnalysisLimit");
async function runMonitoringTick(options) {
  const startedAtMs = Date.now();
  const now2 = options.now ?? new Date(startedAtMs);
  const limit = Math.max(0, options.limit ?? MONITORING_MAX_CLIENTS_PER_RUN);
  const budgetMs = options.budgetMs ?? MONITORING_INVOCATION_BUDGET_MS;
  const analyze = options.analyze ?? ((t, env2, clientId2) => runAnalysis(t, env2, clientId2, { trigger: "scheduled", now: options.now }));
  const result = {
    startedAt: now2.toISOString(),
    finishedAt: now2.toISOString(),
    considered: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    newFindings: 0,
    resolvedFindings: 0,
    evaluatorCalls: 0,
    budgetExhausted: false,
    clients: []
  };
  if (limit === 0) {
    result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    return result;
  }
  const due = await listDueClients(options.db, { now: now2, limit });
  result.considered = due.length;
  const policy3 = parseMonitorEntitlementPolicy(options.env);
  let entitledWorkspaces = null;
  if (policy3.mode === "off") {
    entitledWorkspaces = /* @__PURE__ */ new Set();
  } else if (policy3.mode === "allowlist") {
    const ids = [...new Set(due.map((candidate) => candidate.workspaceId))];
    const emails = await ownerEmailsForWorkspaces(options.db, ids);
    entitledWorkspaces = new Set(
      ids.filter(
        (id) => decideMonitorEntitlement({ policy: policy3, ownerEmail: emails.get(id) ?? null }).entitled
      )
    );
  }
  for (const candidate of due) {
    if (Date.now() - startedAtMs >= budgetMs) {
      result.budgetExhausted = true;
      break;
    }
    if (entitledWorkspaces && !entitledWorkspaces.has(candidate.workspaceId)) {
      result.skipped++;
      result.clients.push({
        clientId: candidate.clientId,
        workspaceId: candidate.workspaceId,
        outcome: "skipped",
        newCount: 0,
        resolvedCount: 0,
        evaluatorCalls: 0
      });
      continue;
    }
    const t = { db: options.db, workspaceId: candidate.workspaceId };
    const claimed = await claimClient(options.db, candidate, now2);
    if (!claimed) {
      result.skipped++;
      result.clients.push({
        clientId: candidate.clientId,
        workspaceId: candidate.workspaceId,
        outcome: "skipped",
        newCount: 0,
        resolvedCount: 0,
        evaluatorCalls: 0
      });
      continue;
    }
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    let outcome = "failed";
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
      if (isAnalysisLimitExceeded(err)) {
        try {
          await deferAfterAnalysisLimit(t, candidate.clientId, err.retryAt);
        } catch (deferErr) {
          console.error(
            `[monitoring] could not defer limited client ${candidate.clientId}: ${describeError(deferErr)}`
          );
        }
        result.skipped++;
        result.clients.push({
          clientId: candidate.clientId,
          workspaceId: candidate.workspaceId,
          outcome: "skipped",
          newCount: 0,
          resolvedCount: 0,
          evaluatorCalls: 0
        });
        continue;
      }
      const detail = describeError(err);
      console.error(`[monitoring] scan failed for ${candidate.clientId}: ${detail}`);
      await recordFailedRun(t, candidate.clientId, { startedAt, detail });
    }
    try {
      await finishMonitoringRun(t, candidate.clientId, { outcome });
    } catch (err) {
      console.error(
        `[monitoring] could not record monitoring state for ${candidate.clientId}: ${describeError(err)}`
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
      evaluatorCalls
    });
  }
  result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  return result;
}
__name(runMonitoringTick, "runMonitoringTick");
