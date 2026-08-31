import type { EvaluatorInput } from "@/ports/OpportunityEvaluator";

export const EVALUATOR_SYSTEM_PROMPT =
  "You are a senior digital-agency strategist. Given a deterministic observation " +
  "about an existing client's website, judge whether it is a legitimate, " +
  "individually billable piece of work the agency could offer this client right " +
  "now. Reject weak, generic, speculative, or non-commercial ideas. Never invent " +
  "evidence. Reply with ONLY a JSON object of the form " +
  '{"verdict":"surface"|"reject","confidence":number between 0 and 1,' +
  '"rationale":string,"suggestedScope":string[]}.';

export function buildEvaluatorUserPrompt(input: EvaluatorInput): string {
  const { candidate, client, evidence } = input;
  return JSON.stringify(
    {
      client: {
        name: client.name,
        domain: client.domain,
        offerings: client.offerings,
      },
      rule: candidate.ruleId,
      subject: candidate.subject,
      detected: candidate.detected,
      deterministicConfidence: candidate.rawConfidence,
      evidencePages: evidence.site.pages.map((p) => ({
        url: p.url,
        title: p.title,
        h1s: p.h1s,
        headings: p.headings,
      })),
      navigation: evidence.site.nav,
    },
    null,
    2,
  );
}
