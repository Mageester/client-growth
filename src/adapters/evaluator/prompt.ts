import type { EvaluatorInput } from "@/ports/OpportunityEvaluator";

/**
 * Two prompts, because there are two genuinely different questions.
 *
 * A missing-service-page candidate needs a CLASSIFICATION: the deterministic
 * rules cannot tell "heat pump installation" (a thing customers hire this
 * business for) from "fully insured" (a thing the business says about itself),
 * and the second one priced as a landing page is the pitch that ends a client
 * relationship. A broken-conversion-path candidate needs no classification at
 * all - the defect is a probed HTTP fact - only a judgment about whether it is
 * worth raising.
 *
 * Neither prompt asks for a confidence number. A calibration run showed the
 * provider's self-reported confidence did not separate a real service line from
 * a trust claim, so the field was removed rather than left in place looking
 * meaningful.
 */

export const SERVICE_JUDGMENT_SYSTEM_PROMPT = [
  "You are a senior digital-agency strategist deciding whether a finding is worth pitching.",
  "",
  "A deterministic pre-check has ALREADY established, against crawled pages, navigation,",
  "every discovered link and the sitemap, that this client's website has no dedicated page",
  "for the SUBJECT below. Treat that absence as established fact - do NOT dispute it, do NOT",
  "re-derive it, and never invent evidence.",
  "",
  "Your only job is to classify what the SUBJECT actually is, and say whether building a paid",
  "dedicated page for it is legitimate, distinct client work.",
  "",
  "The subject comes from a free-text list the agency typed, so it is often NOT a service.",
  "Classify it as exactly one of:",
  "",
  '  "distinct_service"  - something customers actually hire or pay this business to do,',
  "                        specific enough to search for and to sell on its own.",
  "                        e.g. heat pump installation, drain cleaning, EV charger installation,",
  "                        Invisalign, commercial roofing, emergency boiler repair.",
  '  "trust_signal"      - a credential, reassurance or attribute of the business, not work',
  "                        it sells. e.g. fully insured, family owned, licensed technicians,",
  "                        award winning, 24 years experience, DBS checked, Gas Safe registered.",
  '  "promotion"         - a sales mechanic, offer or commercial term. e.g. free quotes,',
  "                        free consultation, financing available, satisfaction guarantee,",
  "                        10% off, no call-out fee, lifetime warranty.",
  '  "generic_claim"     - marketing language that names no specific work. e.g. quality service,',
  "                        fast response, affordable pricing, customer satisfaction.",
  '  "ambiguous"         - you cannot confidently place it in one of the above. Use this',
  "                        whenever you are unsure. It is the correct answer for a genuinely",
  "                        borderline subject, and it is never penalised.",
  "",
  "Then set commerciallyActionable: true ONLY if a dedicated page for this subject is real,",
  "individually sellable work an agency could defend to this client. A page whose entire",
  "content would be a claim about the business, an offer, or filler is NOT actionable.",
  "",
  'Set verdict "surface" only for a distinct_service that is commerciallyActionable. Anything',
  'else - trust_signal, promotion, generic_claim, ambiguous, or a service that would not be',
  'worth its own page - is "reject". When in doubt, reject: pitching a client a paid landing',
  "page for something they do not sell is far more damaging than staying quiet.",
  "",
  "Reply with ONLY a JSON object:",
  '{"subjectType":"distinct_service"|"trust_signal"|"promotion"|"generic_claim"|"ambiguous",',
  '"commerciallyActionable":boolean,"verdict":"surface"|"reject","rationale":string,',
  '"suggestedScope":string[]}',
  "",
  "rationale: one or two sentences an agency owner could read aloud to their client.",
  "suggestedScope: the concrete deliverables for the page, or [] when rejecting.",
].join("\n");

export const DEFECT_JUDGMENT_SYSTEM_PROMPT = [
  "You are a senior digital-agency strategist deciding whether a finding is worth pitching.",
  "",
  "A deterministic pre-check has ALREADY confirmed the broken conversion element below by its",
  "exact HTTP status or a provably malformed value. Treat the defect as established fact - do",
  "NOT dispute or re-derive it, and never invent evidence.",
  "",
  "Judge only whether it is worth bringing to this client now, and describe the fix and its",
  'likely impact. Reject only if the finding is commercially trivial or a fix would add no',
  "plausible value (e.g. a deliberately retired page).",
  "",
  "Reply with ONLY a JSON object:",
  '{"commerciallyActionable":boolean,"verdict":"surface"|"reject","rationale":string,',
  '"suggestedScope":string[]}',
].join("\n");

/** Which system prompt (and therefore which wire schema) this candidate needs. */
export function systemPromptFor(input: EvaluatorInput): string {
  return input.candidate.conversionDefect
    ? DEFECT_JUDGMENT_SYSTEM_PROMPT
    : SERVICE_JUDGMENT_SYSTEM_PROMPT;
}

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
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      client: { name: client.name, domain: client.domain },
      rule: candidate.ruleId,
      subject: candidate.subject,
      // The other entries the agency typed. Useful context for classification:
      // a list of real service lines with one credential in it makes the odd one
      // out easier to see.
      otherEntriesInTheSameList: client.offerings.filter((o) => o !== candidate.subject),
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
      crawledPages: evidence.site.pages.map((p) => ({ url: p.url, title: p.title, h1s: p.h1s })),
      navigationLabels: evidence.site.nav.slice(0, 40),
    },
    null,
    2,
  );
}
