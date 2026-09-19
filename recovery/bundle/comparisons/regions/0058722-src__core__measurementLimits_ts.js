// src/core/measurementLimits.ts
var ORBIT_LIMIT_OBSERVATION_KEY = "orbit-measurement-limit";
var ORBIT_LIMIT_REASONS = [
  /response body exceeds/i,
  /response body byte cap exceeded/i,
  /content-length exceeds/i,
  /capture too large/i,
  /render budget exhausted/i,
  /could not be captured reliably/i,
  /screenshot evidence was (?:marked )?unavailable/i
];
function isOrbitLimitReason(value) {
  return ORBIT_LIMIT_REASONS.some((pattern2) => pattern2.test(value));
}
__name(isOrbitLimitReason, "isOrbitLimitReason");
function broadDetailsOf(diagnostic) {
  const details = diagnostic.details;
  return details && details.kind === "broad" ? details : void 0;
}
__name(broadDetailsOf, "broadDetailsOf");
function isOrbitMeasurementDiagnostic(diagnostic) {
  if (diagnostic.origin === "MEASUREMENT") return true;
  const details = broadDetailsOf(diagnostic);
  if (details?.observationKeys.includes(ORBIT_LIMIT_OBSERVATION_KEY)) return true;
  const assessment = diagnostic.assessment;
  const evidence = [
    diagnostic.observation,
    ...assessment.limitations,
    ...assessment.counterEvidence,
    ...details ? [details.reason] : []
  ];
  return evidence.some(isOrbitLimitReason);
}
__name(isOrbitMeasurementDiagnostic, "isOrbitMeasurementDiagnostic");
