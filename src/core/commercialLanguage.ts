/**
 * The commercial judgment taxonomy: language that is ABOUT a business rather
 * than something a customer can hire the business to do.
 *
 * This started life inside the client form, warning an agency that "fully
 * insured" typed into the offerings box is one analysis away from a priced
 * landing-page proposal for a claim about the client's insurance. The same
 * judgment is needed in a second place now — anything Axiom Orbit suggests
 * back to the agency from a site's own copy must be filtered by it, or the
 * product would propose "Free Quotes" as a service the client sells.
 *
 * It is deliberately a SMALL phrase list, not a taxonomy of industries. It
 * catches the marketing furniture that service-business websites actually put
 * in their navigation — credentials, offers and filler. It never edits or drops
 * what a person typed: it classifies, and the agency decides.
 */

export type CommercialLanguageKind = "trust signal" | "promotion" | "generic claim";

export interface CommercialLanguageMatch {
  /** The text exactly as it was found. Never rewritten. */
  value: string;
  kind: CommercialLanguageKind;
}

const NON_SERVICE_PATTERNS: Array<{ kind: CommercialLanguageKind; test: RegExp }> = [
  // Credentials and reassurances the business states about itself.
  { kind: "trust signal", test: /\b(fully\s+)?insured\b/ },
  { kind: "trust signal", test: /\b(fully\s+)?licen[cs]ed\b/ },
  { kind: "trust signal", test: /\b(certified|accredited|approved installer)\b/ },
  { kind: "trust signal", test: /\bfamily[\s-](owned|run|business)\b/ },
  { kind: "trust signal", test: /\baward[\s-]winning\b/ },
  { kind: "trust signal", test: /\b\d+\+?\s*years?\b[\s\S]*\bexperience\b/ },
  { kind: "trust signal", test: /\bexperienced\s+(team|staff|engineers?|technicians?)\b/ },
  { kind: "trust signal", test: /\b((dbs|crb)\s*checked|vetted|police\s*checked)\b/ },
  { kind: "trust signal", test: /\b(gas\s*safe|niceic|checkatrade|trustmark)\b/ },

  // Offers and commercial mechanics.
  {
    kind: "promotion",
    test: /\bfree\s+(quotes?|quotation|consultations?|estimates?|surveys?|advice|call[\s-]?outs?)\b/,
  },
  { kind: "promotion", test: /\bno\s+(obligation|call[\s-]?out\s+fee|hidden\s+(costs?|fees?))\b/ },
  { kind: "promotion", test: /\b(financing|finance available|pay\s+monthly)\b|\b0%\s*(apr|interest)\b/ },
  { kind: "promotion", test: /\b(satisfaction\s+)?guarantee[ds]?\b|\bwarrant(y|ies)\b/ },
  { kind: "promotion", test: /\bdiscounts?\b|\b\d+%\s*off\b|\bspecial offers?\b/ },

  // Claims that name no specific work.
  { kind: "generic claim", test: /\bquality\s+(service|work|workmanship)\b|\bhigh[\s-]quality\b/ },
  { kind: "generic claim", test: /\b(fast|quick|rapid|same[\s-]day)\s+(response|turnaround|service)\b/ },
  {
    kind: "generic claim",
    test: /\b(affordable|cheap)\b|\bcompetitive\s+(prices?|pricing|rates?)\b|\bbest\s+prices?\b/,
  },
  { kind: "generic claim", test: /\b24\s*\/\s*7\s+(?:service|support|availability)\b/ },
  { kind: "generic claim", test: /\b(friendly|reliable|professional|trusted)\s+(service|team|staff)\b/ },
  { kind: "generic claim", test: /\bcustomer\s+(satisfaction|service)\b|\b5[\s-]star\b/ },
];

/**
 * Classify one phrase, or null when nothing in the taxonomy matches.
 *
 * Matching only ever says "this looks like marketing language". It never says
 * the phrase IS a service — that judgment belongs to the agency (in the client
 * form) or to the evaluator (in the pipeline).
 */
export function classifyCommercialLanguage(phrase: string): CommercialLanguageKind | null {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return null;
  return NON_SERVICE_PATTERNS.find((p) => p.test.test(lower))?.kind ?? null;
}

/** Flag entries that look like marketing copy rather than work customers buy. */
export function flagCommercialLanguage(phrases: string[]): CommercialLanguageMatch[] {
  const matches: CommercialLanguageMatch[] = [];
  for (const raw of phrases) {
    const value = raw.trim();
    if (!value) continue;
    const kind = classifyCommercialLanguage(value);
    if (kind) matches.push({ value, kind });
  }
  return matches;
}
