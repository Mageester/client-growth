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
  /**
   * Business-to-site mismatch is paused until its additive schema is approved
   * and deployed. The string form is what Wrangler supplies; parsing it
   * explicitly avoids z.coerce.boolean turning "false" into true.
   */
  ENABLE_EXTERNAL_BUSINESS_MISMATCH: z
    .preprocess(
      (value) => {
        if (value === "true") return true;
        if (value === "false") return false;
        return value;
      },
      z.boolean(),
    )
    .default(false),
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
 * The only boundary that may make the paused external-claims repository
 * reachable. Keep this strict and default-off: a missing flag must mean the
 * production schema can omit external_business_claims safely.
 */
export function isExternalBusinessMismatchEnabled(raw: Record<string, unknown>): boolean {
  return raw.ENABLE_EXTERNAL_BUSINESS_MISMATCH === true || raw.ENABLE_EXTERNAL_BUSINESS_MISMATCH === "true";
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
