// src/core/commercialLanguage.ts
var NON_SERVICE_PATTERNS = [
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
    test: /\bfree\s+(quotes?|quotation|consultations?|estimates?|surveys?|advice|call[\s-]?outs?)\b/
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
    test: /\b(affordable|cheap)\b|\bcompetitive\s+(prices?|pricing|rates?)\b|\bbest\s+prices?\b/
  },
  { kind: "generic claim", test: /\b24\s*\/\s*7\s+(?:service|support|availability)\b/ },
  { kind: "generic claim", test: /\b(friendly|reliable|professional|trusted)\s+(service|team|staff)\b/ },
  { kind: "generic claim", test: /\bcustomer\s+(satisfaction|service)\b|\b5[\s-]star\b/ }
];
function classifyCommercialLanguage(phrase) {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return null;
  return NON_SERVICE_PATTERNS.find((p) => p.test.test(lower))?.kind ?? null;
}
__name(classifyCommercialLanguage, "classifyCommercialLanguage");
