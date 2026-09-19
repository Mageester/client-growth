// src/core/analysisLifecycle.ts
var ANALYSIS_STAGES = [
  "queued",
  "preparing",
  "crawling",
  "rendering",
  "analyzing",
  "synthesizing",
  "completed",
  "completed_with_limitations",
  "failed",
  "unavailable",
  "blocked"
];
var ANALYSIS_FAILURE_CODES = [
  "timeout",
  "cancelled",
  "configuration",
  "policy",
  "network",
  "provider",
  "persistence",
  "unknown"
];
var ACTIVE_STAGES = [
  "queued",
  "preparing",
  "crawling",
  "rendering",
  "analyzing",
  "synthesizing"
];
var TERMINAL_STAGES = /* @__PURE__ */ new Set([
  "completed",
  "completed_with_limitations",
  "failed",
  "unavailable",
  "blocked"
]);
function isTerminalAnalysisStage(stage) {
  return TERMINAL_STAGES.has(stage);
}
__name(isTerminalAnalysisStage, "isTerminalAnalysisStage");
function canTransitionAnalysisStage(current, next) {
  if (current === next) return true;
  if (isTerminalAnalysisStage(current)) return false;
  if (isTerminalAnalysisStage(next)) return true;
  return ACTIVE_STAGES.indexOf(next) > ACTIVE_STAGES.indexOf(current);
}
__name(canTransitionAnalysisStage, "canTransitionAnalysisStage");
function classifyTerminalAnalysisStage(input) {
  if (input.outcome !== "inconclusive") {
    return input.limitation ? "completed_with_limitations" : "completed";
  }
  if (input.readablePages > 0) return "completed_with_limitations";
  if (input.blockedEvents > 0 && input.inconclusiveEvents === 0) return "blocked";
  return "failed";
}
__name(classifyTerminalAnalysisStage, "classifyTerminalAnalysisStage");
