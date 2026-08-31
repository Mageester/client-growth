import type { Candidate, Client, Evaluation, EvidenceBundle } from "@/core/schema";

export interface EvaluatorInput {
  candidate: Candidate;
  client: Client;
  evidence: EvidenceBundle;
}

/**
 * Replaceable boundary #2. Judges and explains a single deterministic candidate.
 * Implementations: MockEvaluator (default, deterministic, $0) and DeepSeekEvaluator
 * (explicit live runs only). The pipeline calls this ONLY after a candidate has
 * passed the evidence threshold and is known to be billable.
 */
export interface OpportunityEvaluator {
  evaluate(input: EvaluatorInput): Promise<Evaluation>;
}
