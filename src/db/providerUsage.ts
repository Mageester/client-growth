import type { TenantScope } from "@/db/tenant";

export type ProviderRequestStatus = "unknown" | "succeeded" | "failed";
export type ProviderCostBasis = "estimated" | "unavailable";

export interface ProviderUsageRecord {
  clientId: string | null;
  userId: string | null;
  jobId: string | null;
  provider: string;
  model: string;
  feature: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestStatus: ProviderRequestStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheMissInputTokens: number | null;
  costBasis: ProviderCostBasis;
  costMicros: number | null;
  currency: string;
  pricingVersion: string | null;
  limitation: string | null;
}

export interface BeginProviderUsageInput {
  clientId: string | null;
  userId: string | null;
  jobId: string | null;
  provider: string;
  model: string;
  feature: string;
  startedAt: string;
}

function boundedInteger(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export async function recordProviderUsage(
  t: TenantScope,
  usage: ProviderUsageRecord,
): Promise<number> {
  const result = await t.db
    .prepare(
      `INSERT INTO provider_usage (
         workspace_id, client_id, user_id, job_id, provider, model, feature,
         started_at, finished_at, duration_ms, request_status,
         input_tokens, output_tokens, cached_input_tokens, cache_miss_input_tokens,
         cost_basis, cost_micros, currency, pricing_version, limitation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.workspaceId,
      usage.clientId,
      usage.userId,
      usage.jobId,
      usage.provider,
      usage.model,
      usage.feature,
      usage.startedAt,
      usage.finishedAt,
      boundedInteger(usage.durationMs),
      usage.requestStatus,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
      usage.cacheMissInputTokens,
      usage.costBasis,
      usage.costMicros,
      usage.currency,
      usage.pricingVersion,
      usage.limitation,
    )
    .run();
  const id = result.lastRowId;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Provider usage insert did not return its assigned id.");
  }
  return id;
}

export async function beginProviderUsage(
  t: TenantScope,
  usage: BeginProviderUsageInput,
): Promise<number> {
  return recordProviderUsage(t, {
    ...usage,
    finishedAt: usage.startedAt,
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
    limitation: "The provider request did not record a terminal outcome.",
  });
}

export interface FinishProviderUsageInput {
  finishedAt: string;
  durationMs: number;
  requestStatus: Exclude<ProviderRequestStatus, "unknown">;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheMissInputTokens: number | null;
  costBasis: ProviderCostBasis;
  costMicros: number | null;
  currency: string;
  pricingVersion: string | null;
  limitation: string | null;
}

export async function finishProviderUsage(
  t: TenantScope,
  id: number,
  usage: FinishProviderUsageInput,
): Promise<boolean> {
  const result = await t.db
    .prepare(
      `UPDATE provider_usage SET
         finished_at = ?, duration_ms = ?, request_status = ?,
         input_tokens = ?, output_tokens = ?, cached_input_tokens = ?,
         cache_miss_input_tokens = ?, cost_basis = ?, cost_micros = ?,
         currency = ?, pricing_version = ?, limitation = ?
       WHERE id = ? AND workspace_id = ? AND request_status = 'unknown'`,
    )
    .bind(
      usage.finishedAt,
      boundedInteger(usage.durationMs),
      usage.requestStatus,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
      usage.cacheMissInputTokens,
      usage.costBasis,
      usage.costMicros,
      usage.currency,
      usage.pricingVersion,
      usage.limitation,
      id,
      t.workspaceId,
    )
    .run();
  return result.rowsAffected > 0;
}
