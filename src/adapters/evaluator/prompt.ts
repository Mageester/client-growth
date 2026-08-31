import type { EvaluatorInput } from "@/ports/OpportunityEvaluator";

export const EVALUATOR_SYSTEM_PROMPT =
  "You are a senior digital-agency strategist. A deterministic pre-check has " +
  "ALREADY verified that the client has no dedicated page for the offering: it " +
  "searched crawled pages, navigation, every discovered link, and the sitemap, " +
  "and (where relevant) fetched the closest candidate pages. Treat that absence " +
  "as established fact — do not re-litigate it. Your job is to judge whether a " +
  "dedicated page for this offering is a legitimate, individually billable piece " +
  "of work worth bringing to this client now. Reject only if the offering itself " +
  "is commercially trivial, not a real service line, or a page would add no " +
  "plausible value. Never invent evidence. Reply with ONLY a JSON object of the " +
  'form {"verdict":"surface"|"reject","confidence":number between 0 and 1,' +
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
      offering: candidate.subject,
      detected: candidate.detected,
      absenceVerification: candidate.verification
        ? {
            conclusion: candidate.verification.conclusion,
            reason: candidate.verification.reason,
            pagesFetchedToConfirm: candidate.verification.inspectedUrls,
            nearestMatchesRejected: candidate.verification.closeMatches
              .filter((m) => !m.satisfied)
              .map((m) => ({ value: m.value, why: m.reason })),
          }
        : null,
      deterministicConfidence: candidate.rawConfidence,
      crawledPages: evidence.site.pages.map((p) => ({
        url: p.url,
        title: p.title,
        h1s: p.h1s,
      })),
      navigationLabels: evidence.site.nav.slice(0, 40),
    },
    null,
    2,
  );
}
