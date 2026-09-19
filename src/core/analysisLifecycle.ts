import type { AnalysisOutcome } from "@/core/analysisOutcome";

export const ANALYSIS_STAGES = [
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
  "blocked",
] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export const ANALYSIS_FAILURE_CODES = [
  "timeout",
  "cancelled",
  "configuration",
  "policy",
  "network",
  "provider",
  "persistence",
  "unknown",
] as const;
export type AnalysisFailureCode = (typeof ANALYSIS_FAILURE_CODES)[number];

const ACTIVE_STAGES: readonly AnalysisStage[] = [
  "queued",
  "preparing",
  "crawling",
  "rendering",
  "analyzing",
  "synthesizing",
];

const TERMINAL_STAGES = new Set<AnalysisStage>([
  "completed",
  "completed_with_limitations",
  "failed",
  "unavailable",
  "blocked",
]);

export function isTerminalAnalysisStage(stage: AnalysisStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

export function canTransitionAnalysisStage(
  current: AnalysisStage,
  next: AnalysisStage,
): boolean {
  if (current === next) return true;
  if (isTerminalAnalysisStage(current)) return false;
  if (isTerminalAnalysisStage(next)) return true;
  return ACTIVE_STAGES.indexOf(next) > ACTIVE_STAGES.indexOf(current);
}

export interface TerminalAnalysisInput {
  outcome: AnalysisOutcome;
  limitation: boolean;
  readablePages: number;
  blockedEvents: number;
  inconclusiveEvents: number;
}

export function classifyTerminalAnalysisStage(
  input: TerminalAnalysisInput,
): AnalysisStage {
  if (input.outcome !== "inconclusive") {
    return input.limitation ? "completed_with_limitations" : "completed";
  }
  if (input.readablePages > 0) return "completed_with_limitations";
  if (input.blockedEvents > 0 && input.inconclusiveEvents === 0) return "blocked";
  return "failed";
}
