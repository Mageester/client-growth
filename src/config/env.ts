import { z } from "zod";

import { MONITORING_MAX_CLIENTS_PER_RUN } from "@/core/monitoring";
import {
  ANALYSIS_PLATFORM_DAILY_LIMIT,
  ANALYSIS_WORKSPACE_DAILY_LIMIT,
} from "@/db/analysisLimits";

/**
 * Validated runtime configuration. The default provider is "mock": nothing pays
 * for anything unless the environment explicitly opts in.
 */
export const EnvSchema = z.object({
  AI_PROVIDER: z.enum(["mock", "deepseek"]).default("mock"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  MAX_AI_CALLS_PER_RUN: z.coerce.number().int().positive().max(100).default(10),
  /**
   * Clients one scheduled invocation may analyze. Multiplied by
   * MAX_AI_CALLS_PER_RUN this is the hard evaluator ceiling for a single tick.
   * Capped well below anything that could surprise a bill.
   */
  MONITORING_MAX_CLIENTS_PER_RUN: z.coerce
    .number()
    .int()
    .positive()
    .max(25)
    .default(MONITORING_MAX_CLIENTS_PER_RUN),
  /** Analysis starts one workspace may make in a UTC day. */
  ANALYSIS_WORKSPACE_DAILY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(ANALYSIS_WORKSPACE_DAILY_LIMIT),
  /**
   * Analysis starts EVERY workspace may make between them in a UTC day. This is
   * the only ceiling on the operator's own bill: the per-workspace cap bounds a
   * tenant, not the number of tenants. Keep it deliberately low until billing
   * exists, and raise it as a decision rather than as a surprise.
   */
  ANALYSIS_PLATFORM_DAILY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(ANALYSIS_PLATFORM_DAILY_LIMIT),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, unknown> = {}): Env {
  return EnvSchema.parse(raw);
}

/**
 * Just the admission caps, validated on their own.
 *
 * Admission has to be the first stateful step in an analysis — an accepted
 * start must be counted even when a later stage throws — so it cannot wait for
 * the whole environment to validate. A broken `AI_PROVIDER` must not buy a
 * caller free, unmetered attempts; it should fail *after* the ledger has
 * charged for the start. A broken cap still throws here, before anything is
 * reserved, because a ceiling nobody can parse is not a ceiling.
 */
export const AnalysisCapsSchema = EnvSchema.pick({
  ANALYSIS_WORKSPACE_DAILY_LIMIT: true,
  ANALYSIS_PLATFORM_DAILY_LIMIT: true,
});

export type AnalysisCaps = z.infer<typeof AnalysisCapsSchema>;

export function parseAnalysisCaps(raw: Record<string, unknown> = {}): AnalysisCaps {
  return AnalysisCapsSchema.parse({
    ANALYSIS_WORKSPACE_DAILY_LIMIT: raw.ANALYSIS_WORKSPACE_DAILY_LIMIT,
    ANALYSIS_PLATFORM_DAILY_LIMIT: raw.ANALYSIS_PLATFORM_DAILY_LIMIT,
  });
}
