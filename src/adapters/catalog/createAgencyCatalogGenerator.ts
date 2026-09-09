import type { Env } from "@/config/env";
import type { AgencyCatalogGenerator } from "@/ports/AgencyCatalogGenerator";
import { DeepSeekAgencyCatalogGenerator } from "@/adapters/catalog/DeepSeekAgencyCatalogGenerator";

export function createAgencyCatalogGenerator(env: Env, fetchImpl?: typeof fetch): AgencyCatalogGenerator {
  if (env.AI_PROVIDER !== "deepseek") {
    throw new Error("The AI catalog assistant is not available in this environment.");
  }
  return new DeepSeekAgencyCatalogGenerator({
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
    fetchImpl,
  });
}

