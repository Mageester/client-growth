import type { Diagnostic } from "@/core/insightSchema";

const ORBIT_LIMIT_OBSERVATION_KEY = "orbit-measurement-limit";
const ORBIT_LIMIT_REASONS = [
  /response body exceeds/i,
  /response body byte cap exceeded/i,
  /content-length exceeds/i,
  /capture too large/i,
  /render budget exhausted/i,
  /could not be captured reliably/i,
  /screenshot evidence was (?:marked )?unavailable/i,
];

function isOrbitLimitReason(value: string): boolean { return ORBIT_LIMIT_REASONS.some((pattern) => pattern.test(value)); }
function broadDetailsOf(diagnostic: Diagnostic): Extract<NonNullable<Diagnostic["details"]>, { kind: "broad" }> | undefined { const details = diagnostic.details; return details?.kind === "broad" ? details : undefined; }

export function isOrbitMeasurementDiagnostic(diagnostic: Diagnostic): boolean {
  if (diagnostic.origin === "MEASUREMENT") return true;
  const details = broadDetailsOf(diagnostic);
  if (details?.observationKeys.includes(ORBIT_LIMIT_OBSERVATION_KEY)) return true;
  const evidence = [diagnostic.observation, ...diagnostic.assessment.limitations, ...diagnostic.assessment.counterEvidence, ...(details ? [details.reason] : [])];
  return evidence.some(isOrbitLimitReason);
}
