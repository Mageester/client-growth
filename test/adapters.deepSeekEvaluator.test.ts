import { describe, expect, it, vi } from "vitest";

import {
  DeepSeekEvaluator,
  DeepSeekRequestError,
  MalformedEvaluationError,
} from "@/adapters/evaluator/DeepSeekEvaluator";
import type { EvaluatorInput } from "@/ports/OpportunityEvaluator";
import { CandidateSchema, ClientSchema, EvidenceBundleSchema } from "@/core/schema";

const input: EvaluatorInput = {
  candidate: CandidateSchema.parse({
    ruleId: "missing-service-page",
    subject: "heat pump installation",
    detected: "no page",
    evidenceRefs: ["https://x.example/"],
    rawConfidence: 0.8,
    suggestedServiceId: "svc-landing-page",
  }),
  client: ClientSchema.parse({
    id: "c1",
    name: "X",
    domain: "x.example",
    offerings: ["heat pump installation"],
  }),
  evidence: EvidenceBundleSchema.parse({
    clientId: "c1",
    source: "fixture",
    capturedAt: "2026-08-30T00:00:00.000Z",
    site: { pages: [], nav: [] },
  }),
};

function stubFetch(body: unknown, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      ...init,
    }),
  ) as unknown as typeof fetch;
}

function completion(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 700, completion_tokens: 120, total_tokens: 820 },
  };
}

describe("DeepSeekEvaluator", () => {
  it("parses a well-formed evaluation and records token usage", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(
        completion(
          JSON.stringify({
            subjectType: "distinct_service",
            commerciallyActionable: true,
            verdict: "surface",
            rationale: "Focused landing page is sellable work.",
            suggestedScope: ["Build the page", "On-page SEO"],
          }),
        ),
      ),
    });

    const result = await evaluator.evaluate(input);
    expect(result.verdict).toBe("surface");
    expect(result.confidence).toBe(input.candidate.rawConfidence);
    expect(result.subjectType).toBe("distinct_service");
    expect(result.commerciallyActionable).toBe(true);
    expect(evaluator.lastUsage).toEqual({
      promptTokens: 700,
      completionTokens: 120,
      totalTokens: 820,
    });
  });

  it("refuses the old, unclassified contract instead of surfacing on it", async () => {
    // A provider (or a rolled-back prompt) answering the previous shape - a
    // verdict and a self-reported confidence, with no subject classification -
    // must be treated as malformed. Accepting it would put "fully insured" back
    // in front of a client at $900-$1,800.
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(
        completion(
          JSON.stringify({
            verdict: "surface",
            confidence: 0.92,
            rationale: "Looks worth doing.",
            suggestedScope: ["Build the page"],
          }),
        ),
      ),
    });
    await expect(evaluator.evaluate(input)).rejects.toBeInstanceOf(MalformedEvaluationError);
  });

  it("fails closed on a classification outside the taxonomy", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(
        completion(
          JSON.stringify({
            subjectType: "probably_a_service",
            commerciallyActionable: true,
            verdict: "surface",
            rationale: "Sure.",
            suggestedScope: [],
          }),
        ),
      ),
    });
    await expect(evaluator.evaluate(input)).rejects.toBeInstanceOf(MalformedEvaluationError);
  });

  it("keeps a rejection with its classification, so the reason survives", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(
        completion(
          JSON.stringify({
            subjectType: "trust_signal",
            commerciallyActionable: false,
            verdict: "reject",
            rationale: "Being insured is a reassurance, not work the client sells.",
            suggestedScope: [],
          }),
        ),
      ),
    });

    const result = await evaluator.evaluate(input);
    expect(result.verdict).toBe("reject");
    expect(result.subjectType).toBe("trust_signal");
    expect(result.commerciallyActionable).toBe(false);
  });

  it("fails closed when the content is not JSON", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(completion("not json at all")),
    });
    await expect(evaluator.evaluate(input)).rejects.toBeInstanceOf(MalformedEvaluationError);
  });

  it("fails closed when the JSON does not match the Evaluation contract", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(
        completion(JSON.stringify({ verdict: "maybe", confidence: 5 })),
      ),
    });
    await expect(evaluator.evaluate(input)).rejects.toBeInstanceOf(MalformedEvaluationError);
  });

  it("fails closed on an empty message", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch(completion("")),
    });
    await expect(evaluator.evaluate(input)).rejects.toBeInstanceOf(MalformedEvaluationError);
  });

  it("raises a request error on a non-2xx response", async () => {
    const evaluator = new DeepSeekEvaluator({
      apiKey: "sk-test",
      fetchImpl: stubFetch("upstream boom", { status: 500 }),
    });
    await expect(evaluator.evaluate(input)).rejects.toBeInstanceOf(DeepSeekRequestError);
  });
});
