import { z } from "zod";

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
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, unknown> = {}): Env {
  return EnvSchema.parse(raw);
}
