import { describe, expect, it } from "vitest";

import { judge } from "@/core/judgment";
import { CandidateSchema, type Candidate, type Evaluation } from "@/core/schema";

/**
 * The commercial gate, tested on its own.
 *
 * This is the layer that decides whether "fully insured" becomes a $900–$1,800
 * landing-page quote, so it is tested directly rather than only through the
 * pipeline. Every case here is a way for a provider to be wrong, vague, or
 * silent — and each one has to end in "do not surface".
 */

function serviceCandidate(subject = "heat pump installation"): Candidate {
  return CandidateSchema.parse({
    ruleId: "missing-service-page",
    subject,
    detected: "No dedicated page for this offering.",
    evidenceRefs: ["https://x.example/"],
    rawConfidence: 0.7,
    suggestedServiceId: "svc-landing-page",
  });
}

function defectCandidate(): Candidate {
  return CandidateSchema.parse({
    ruleId: "broken-conversion-path",
    subject: "contact",
    detected: "The contact CTA returns 404.",
    evidenceRefs: ["https://x.example/", "https://x.example/contact"],
    rawConfidence: 0.9,
    suggestedServiceId: "svc-cro-fix",
    conversionDefect: {
      kind: "dead-conversion-link",
      pageUrl: "https://x.example/",
      elementText: "Get in touch",
      elementHref: "/contact",
      target: "https://x.example/contact",
      observedStatus: 404,
      seenOn: ["https://x.example/"],
      note: "the contact link returns 404",
    },
  });
}

const base: Evaluation = {
  verdict: "surface",
  confidence: 0.7,
  rationale: "Worth raising.",
  suggestedScope: ["Build the page"],
};

describe("judgment gate", () => {
  it("surfaces a distinct service the evaluator says is actionable", () => {
    const decision = judge(serviceCandidate(), {
      ...base,
      subjectType: "distinct_service",
      commerciallyActionable: true,
    });
    expect(decision.surface).toBe(true);
  });

  it.each([
    ["trust_signal", "fully insured"],
    ["promotion", "free quotes"],
    ["generic_claim", "quality workmanship"],
    ["ambiguous", "bespoke packages"],
  ] as const)("refuses to surface a %s however confident the verdict", (subjectType, subject) => {
    const decision = judge(serviceCandidate(subject), {
      ...base,
      confidence: 1,
      subjectType,
      commerciallyActionable: true,
    });
    expect(decision.surface).toBe(false);
    expect(decision.reason).toMatch(/classif|confiden/i);
  });

  it("fails closed when the evaluator classifies nothing at all", () => {
    // A provider that answers the old contract, a provider that drops the field,
    // and a provider that quietly changes its output shape all land here.
    const decision = judge(serviceCandidate(), base);
    expect(decision.surface).toBe(false);
    expect(decision.reason).toMatch(/no subject classification/i);
  });

  it("fails closed when the subject is a service but not actionable", () => {
    const decision = judge(serviceCandidate(), {
      ...base,
      subjectType: "distinct_service",
      commerciallyActionable: false,
    });
    expect(decision.surface).toBe(false);
  });

  it("never surfaces a reject verdict, whatever the classification says", () => {
    const decision = judge(serviceCandidate(), {
      ...base,
      verdict: "reject",
      subjectType: "distinct_service",
      commerciallyActionable: true,
    });
    expect(decision.surface).toBe(false);
  });

  it("drops a surfaced finding whose evidence strength is below the floor", () => {
    const decision = judge(serviceCandidate(), {
      ...base,
      confidence: 0.49,
      subjectType: "distinct_service",
      commerciallyActionable: true,
    });
    expect(decision.surface).toBe(false);
  });

  it("does not demand a subject classification for a probed conversion defect", () => {
    // The defect is an HTTP fact, not a subject to categorise, so requiring a
    // taxonomy answer there would reject real findings for no reason.
    const decision = judge(defectCandidate(), { ...base, commerciallyActionable: true });
    expect(decision.surface).toBe(true);
  });

  it("still honours a defect the evaluator judged not worth raising", () => {
    const decision = judge(defectCandidate(), {
      ...base,
      commerciallyActionable: false,
    });
    expect(decision.surface).toBe(false);
  });
});
