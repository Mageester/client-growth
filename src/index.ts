/** Public surface of the portable domain engine. */
export * from "@/core/schema";
export { runRules, allRules } from "@/core/rules";
export { resolveBillability } from "@/core/billability";
export { passesEvidenceThreshold, EVIDENCE_THRESHOLD } from "@/core/threshold";
export { dedupeKey } from "@/core/dedupe";
export {
  importOfficialBusinessProfile,
  resolveCurrentExternalClaims,
  OfficialBusinessProfileExportSchema,
  ExternalBusinessClaimSchema,
  type ExternalBusinessClaim,
  type OfficialBusinessProfileExport,
} from "@/core/externalBusinessEvidence";
export { buildExternalMismatchCandidates } from "@/core/businessSiteMismatch";
export {
  assembleOpportunity,
  assembleCoveredOpportunity,
} from "@/core/assembleOpportunity";

export type { EvidenceProvider } from "@/ports/EvidenceProvider";
export type { OpportunityEvaluator, EvaluatorInput } from "@/ports/OpportunityEvaluator";
export type {
  ExecutionProvider,
  WorkOrder,
  ExecutionResult,
} from "@/ports/ExecutionProvider";

export { FixtureEvidenceProvider } from "@/adapters/evidence/FixtureEvidenceProvider";
export { HttpEvidenceProvider } from "@/adapters/evidence/HttpEvidenceProvider";
export { parseHtml } from "@/adapters/evidence/parseHtml";
export { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
export { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
export { createEvaluator } from "@/adapters/evaluator/createEvaluator";

export { parseEnv, EnvSchema, type Env } from "@/config/env";
export {
  analyzeClient,
  type AnalyzeClientInput,
  type AnalyzeClientResult,
  type AnalyzeClientStats,
} from "@/pipeline/analyzeClient";
