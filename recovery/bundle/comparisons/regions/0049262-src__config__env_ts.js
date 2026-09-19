// src/config/env.ts
var EnvSchema = external_exports.object({
  AI_PROVIDER: external_exports.enum(["mock", "deepseek"]).default("mock"),
  DEEPSEEK_API_KEY: external_exports.string().optional(),
  DEEPSEEK_BASE_URL: external_exports.string().url().optional(),
  DEEPSEEK_MODEL: external_exports.string().default("deepseek-flash"),
  DEEPSEEK_VISION_MODEL: external_exports.string().default("deepseek-flash"),
  /**
   * Business-to-site mismatch is paused until its additive schema is approved
   * and deployed. The string form is what Wrangler supplies; parsing it
   * explicitly avoids z.coerce.boolean turning "false" into true.
   */
  ENABLE_EXTERNAL_BUSINESS_MISMATCH: external_exports.preprocess(
    (value) => {
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    },
    external_exports.boolean()
  ).default(false),
  MAX_AI_CALLS_PER_RUN: external_exports.coerce.number().int().positive().max(100).default(10),
  /**
   * Clients one scheduled invocation may analyze. Multiplied by
   * MAX_AI_CALLS_PER_RUN this is the hard evaluator ceiling for a single tick.
   * Capped well below anything that could surprise a bill.
   */
  MONITORING_MAX_CLIENTS_PER_RUN: external_exports.coerce.number().int().positive().max(25).default(MONITORING_MAX_CLIENTS_PER_RUN),
  /**
   * Workspaces one MONITOR digest tick may email. The digest reads
   * already-computed monitoring output and triggers no analysis, so this bounds
   * email fan-out, not provider spend; kept modest so a single bad tick cannot
   * blast a whole tenant list.
   */
  MONITOR_DIGEST_MAX_PER_RUN: external_exports.coerce.number().int().positive().max(200).default(25),
  /** Analysis starts one workspace may make in a UTC day. */
  ANALYSIS_WORKSPACE_DAILY_LIMIT: external_exports.coerce.number().int().positive().max(1e3).default(ANALYSIS_WORKSPACE_DAILY_LIMIT),
  /**
   * Analysis starts EVERY workspace may make between them in a UTC day. This is
   * the only ceiling on the operator's own bill: the per-workspace cap bounds a
   * tenant, not the number of tenants. Keep it deliberately low until billing
   * exists, and raise it as a decision rather than as a surprise.
   */
  ANALYSIS_PLATFORM_DAILY_LIMIT: external_exports.coerce.number().int().positive().max(1e4).default(ANALYSIS_PLATFORM_DAILY_LIMIT),
  /** AI-assisted catalog drafts one workspace may request per UTC day. */
  CATALOG_AI_WORKSPACE_DAILY_LIMIT: external_exports.coerce.number().int().positive().max(1e4).default(CATALOG_AI_WORKSPACE_DAILY_LIMIT),
  /** Operator-wide ceiling on paid catalog-generation requests per UTC day. */
  CATALOG_AI_PLATFORM_DAILY_LIMIT: external_exports.coerce.number().int().positive().max(1e4).default(CATALOG_AI_PLATFORM_DAILY_LIMIT)
});
function parseEnv(raw = {}) {
  return EnvSchema.parse(raw);
}
__name(parseEnv, "parseEnv");
function isExternalBusinessMismatchEnabled(raw) {
  return raw.ENABLE_EXTERNAL_BUSINESS_MISMATCH === true || raw.ENABLE_EXTERNAL_BUSINESS_MISMATCH === "true";
}
__name(isExternalBusinessMismatchEnabled, "isExternalBusinessMismatchEnabled");
var AnalysisCapsSchema = EnvSchema.pick({
  ANALYSIS_WORKSPACE_DAILY_LIMIT: true,
  ANALYSIS_PLATFORM_DAILY_LIMIT: true
});
function parseAnalysisCaps(raw = {}) {
  return AnalysisCapsSchema.parse({
    ANALYSIS_WORKSPACE_DAILY_LIMIT: raw.ANALYSIS_WORKSPACE_DAILY_LIMIT,
    ANALYSIS_PLATFORM_DAILY_LIMIT: raw.ANALYSIS_PLATFORM_DAILY_LIMIT
  });
}
__name(parseAnalysisCaps, "parseAnalysisCaps");
var CatalogGenerationCapsSchema = EnvSchema.pick({
  CATALOG_AI_WORKSPACE_DAILY_LIMIT: true,
  CATALOG_AI_PLATFORM_DAILY_LIMIT: true
});
