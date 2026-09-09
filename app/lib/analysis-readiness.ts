import type { AnalysisReadiness, RuleReadiness } from "@/core/analysisReadiness";
import type { RuleId } from "@/core/schema";

export type AnalysisAdmissionReadiness = Pick<AnalysisReadiness, "rules"> & {
  catalog: {
    rules: Array<{ ruleId: RuleId; serviceId: string | null }>;
  };
};

/** The first blocker among rules this catalog can actually run. */
export function analysisAdmissionBlocker(
  readiness: AnalysisAdmissionReadiness,
): RuleReadiness | undefined {
  const matchedRuleIds = new Set(
    readiness.catalog.rules
      .filter((rule) => rule.serviceId !== null)
      .map((rule) => rule.ruleId),
  );
  return (
    readiness.rules.find(
      (rule) => matchedRuleIds.has(rule.ruleId) && rule.state !== "ready",
    ) ?? readiness.rules.find((rule) => rule.state !== "ready")
  );
}

export function analysisAdmissionReason(readiness: AnalysisAdmissionReadiness): string {
  return (
    analysisAdmissionBlocker(readiness)?.reason
    ?? "No ready analysis rule is available for this client yet."
  );
}
