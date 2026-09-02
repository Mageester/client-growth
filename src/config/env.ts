import { z } from "zod";

import { MONITORING_MAX_CLIENTS_PER_RUN } from "@/core/monitoring";

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
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, unknown> = {}): Env {
  return EnvSchema.parse(raw);
}
