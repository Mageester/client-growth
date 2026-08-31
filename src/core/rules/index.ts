import type { Candidate } from "@/core/schema";
import { missingServicePageRule, type RuleContext } from "@/core/rules/missingServicePage";

export type { RuleContext };
export type Rule = (ctx: RuleContext) => Promise<Candidate[]>;

/**
 * V0 ships one rule, done well. Adding a rule later is a new file plus one line
 * here — not a refactor.
 */
export const allRules: Rule[] = [missingServicePageRule];

export async function runRules(ctx: RuleContext): Promise<Candidate[]> {
  const batches = await Promise.all(allRules.map((rule) => rule(ctx)));
  return batches.flat();
}
