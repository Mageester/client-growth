// src/db/providerUsage.ts
function boundedInteger(value) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}
__name(boundedInteger, "boundedInteger");
async function recordProviderUsage(t, usage2) {
  const result = await t.db.prepare(
    `INSERT INTO provider_usage (
         workspace_id, client_id, user_id, job_id, provider, model, feature,
         started_at, finished_at, duration_ms, request_status,
         input_tokens, output_tokens, cached_input_tokens, cache_miss_input_tokens,
         cost_basis, cost_micros, currency, pricing_version, limitation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    t.workspaceId,
    usage2.clientId,
    usage2.userId,
    usage2.jobId,
    usage2.provider,
    usage2.model,
    usage2.feature,
    usage2.startedAt,
    usage2.finishedAt,
    boundedInteger(usage2.durationMs),
    usage2.requestStatus,
    usage2.inputTokens,
    usage2.outputTokens,
    usage2.cachedInputTokens,
    usage2.cacheMissInputTokens,
    usage2.costBasis,
    usage2.costMicros,
    usage2.currency,
    usage2.pricingVersion,
    usage2.limitation
  ).run();
  if (!Number.isSafeInteger(result.lastRowId) || result.lastRowId <= 0) {
    throw new Error("Provider usage insert did not return its assigned id.");
  }
  return result.lastRowId;
}
__name(recordProviderUsage, "recordProviderUsage");
async function beginProviderUsage(t, usage2) {
  return recordProviderUsage(t, {
    ...usage2,
    finishedAt: usage2.startedAt,
    durationMs: 0,
    requestStatus: "unknown",
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheMissInputTokens: null,
    costBasis: "unavailable",
    costMicros: null,
    currency: "USD",
    pricingVersion: null,
    limitation: "The provider request did not record a terminal outcome."
  });
}
__name(beginProviderUsage, "beginProviderUsage");
async function finishProviderUsage(t, id, usage2) {
  const result = await t.db.prepare(
    `UPDATE provider_usage SET
         finished_at = ?, duration_ms = ?, request_status = ?,
         input_tokens = ?, output_tokens = ?, cached_input_tokens = ?,
         cache_miss_input_tokens = ?, cost_basis = ?, cost_micros = ?,
         currency = ?, pricing_version = ?, limitation = ?
       WHERE id = ? AND workspace_id = ? AND request_status = 'unknown'`
  ).bind(
    usage2.finishedAt,
    boundedInteger(usage2.durationMs),
    usage2.requestStatus,
    usage2.inputTokens,
    usage2.outputTokens,
    usage2.cachedInputTokens,
    usage2.cacheMissInputTokens,
    usage2.costBasis,
    usage2.costMicros,
    usage2.currency,
    usage2.pricingVersion,
    usage2.limitation,
    id,
    t.workspaceId
  ).run();
  return result.rowsAffected > 0;
}
__name(finishProviderUsage, "finishProviderUsage");
