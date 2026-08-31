import type { EvaluatorInput } from "@/ports/OpportunityEvaluator";

export const EVALUATOR_SYSTEM_PROMPT =
  "You are a senior digital-agency strategist. A deterministic pre-check has " +
  "ALREADY established the finding below — either (a) a missing dedicated service " +
  "page, verified against crawled pages, navigation, every discovered link, and " +
  "the sitemap, or (b) a broken conversion element, verified by its exact HTTP " +
  "status or a provably malformed value. Treat the finding as established fact — " +
  "do NOT dispute or re-derive it. Judge only whether it is worth bringing to " +
  "this client now, and describe the fix and its likely impact. Reject only if " +
  "the finding is commercially trivial or a fix would add no plausible value " +
  "(e.g. a deliberately retired page). Never invent evidence. Reply with ONLY a " +
  'JSON object: {"verdict":"surface"|"reject","confidence":number between 0 and 1,' +
  '"rationale":string,"suggestedScope":string[]}.';

export function buildEvaluatorUserPrompt(input: EvaluatorInput): string {
  const { candidate, client, evidence } = input;

  if (candidate.conversionDefect) {
    const d = candidate.conversionDefect;
    return JSON.stringify(
      {
        client: { name: client.name, domain: client.domain },
        rule: candidate.ruleId,
        confirmedConversionDefect: {
          kind: d.kind,
          onPage: d.pageUrl,
          element: d.elementText,
          elementHref: d.elementHref,
          target: d.target ?? null,
          observedHttpStatus: d.observedStatus ?? null,
          alsoSeenOn: d.seenOn.slice(0, 10),
          note: d.note,
        },
        detected: candidate.detected,
        deterministicConfidence: candidate.rawConfidence,
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      client: { name: client.name, domain: client.domain, offerings: client.offerings },
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
      crawledPages: evidence.site.pages.map((p) => ({ url: p.url, title: p.title, h1s: p.h1s })),
      navigationLabels: evidence.site.nav.slice(0, 40),
    },
    null,
    2,
  );
}
