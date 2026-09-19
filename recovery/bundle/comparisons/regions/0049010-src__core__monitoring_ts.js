// src/core/monitoring.ts
var MONITORING_CADENCES = ["off", "daily", "weekly"];
function isMonitoringCadence(value) {
  return MONITORING_CADENCES.includes(value);
}
__name(isMonitoringCadence, "isMonitoringCadence");
var HOUR = 60 * 60 * 1e3;
var DAY = 24 * HOUR;
var CADENCE_INTERVAL_MS = {
  off: 0,
  daily: DAY,
  weekly: 7 * DAY
};
var MONITORING_MAX_CLIENTS_PER_RUN = 5;
var MONITORING_INVOCATION_BUDGET_MS = 5 * 60 * 1e3;
var MONITORING_CLAIM_TTL_MS = 30 * 60 * 1e3;
var MONITORING_FAILURE_BACKOFF_MS = [HOUR, 6 * HOUR, DAY];
var MONITORING_MAX_ACCELERATED_RETRIES = MONITORING_FAILURE_BACKOFF_MS.length;
var MONITORING_OUTCOMES = ["findings", "clean", "inconclusive", "failed"];
function isMonitoringOutcome(value) {
  return MONITORING_OUTCOMES.includes(value);
}
__name(isMonitoringOutcome, "isMonitoringOutcome");
var iso = /* @__PURE__ */ __name((ms) => new Date(ms).toISOString(), "iso");
function nextDueAfterRun(input) {
  if (input.cadence === "off") return null;
  const interval = CADENCE_INTERVAL_MS[input.cadence];
  if (input.outcome !== "failed" || input.consecutiveFailures > MONITORING_MAX_ACCELERATED_RETRIES) {
    return iso(input.now.getTime() + interval);
  }
  const step = Math.max(1, input.consecutiveFailures) - 1;
  const backoff = MONITORING_FAILURE_BACKOFF_MS[step] ?? interval;
  return iso(input.now.getTime() + Math.min(backoff, interval));
}
__name(nextDueAfterRun, "nextDueAfterRun");
function changeHeadline(outcome, change) {
  if (outcome === "failed") return "This check could not be completed.";
  if (outcome === "inconclusive") return "Monitoring couldn't fully analyze this site.";
  const parts = [];
  if (change.newCount > 0) parts.push(`${change.newCount} new since last scan`);
  if (change.resolvedCount > 0) parts.push(`${change.resolvedCount} fixed since last scan`);
  if (parts.length > 0) return parts.join(" \xB7 ");
  return change.stillOpenCount > 0 ? "No new opportunities \u2014 everything open is unchanged." : "No new opportunities.";
}
__name(changeHeadline, "changeHeadline");
