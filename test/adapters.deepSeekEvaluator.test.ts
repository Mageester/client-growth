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
            verdict: "surface",
            confidence: 0.74,
            rationale: "Focused landing page is sellable work.",
            suggestedScope: ["Build the page", "On-page SEO"],
          }),
        ),
      ),
    });

    const result = await evaluator.evaluate(input);
    expect(result.verdict).toBe("surface");
    expect(result.confidence).toBeCloseTo(0.74);
    expect(evaluator.lastUsage).toEqual({
      promptTokens: 700,
      completionTokens: 120,
      totalTokens: 820,
    });
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
