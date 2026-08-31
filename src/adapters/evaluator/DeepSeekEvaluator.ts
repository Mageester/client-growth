import type { EvaluatorInput, OpportunityEvaluator } from "@/ports/OpportunityEvaluator";
import { EvaluationSchema, type Evaluation } from "@/core/schema";
import {
  EVALUATOR_SYSTEM_PROMPT,
  buildEvaluatorUserPrompt,
} from "@/adapters/evaluator/prompt";

/**
 * Real, paid provider (DeepSeek chat completions, OpenAI-compatible).
 *
 * Guardrails:
 *  - the constructor throws without a non-empty API key, so it cannot be created
 *    by accident during normal dev or tests;
 *  - it is only selected when AI_PROVIDER === "deepseek" (see createEvaluator);
 *  - `fetchImpl` is injectable for contract tests that stub the HTTP layer.
 */

export interface DeepSeekEvaluatorConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class DeepSeekEvaluator implements OpportunityEvaluator {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DeepSeekEvaluatorConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error(
        "DeepSeekEvaluator requires a non-empty apiKey. Set AI_PROVIDER=deepseek and " +
          "DEEPSEEK_API_KEY only for explicit live runs (pnpm eval:live). Normal " +
          "development and the default test suite use MockEvaluator.",
      );
    }
    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("DeepSeekEvaluator: no fetch implementation available");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config.model ?? "deepseek-chat";
    this.fetchImpl = fetchImpl;
  }

  async evaluate(input: EvaluatorInput): Promise<Evaluation> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EVALUATOR_SYSTEM_PROMPT },
          { role: "user", content: buildEvaluatorUserPrompt(input) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeekEvaluator: provider returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content ?? "";

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("DeepSeekEvaluator: provider response was not valid JSON");
    }
    return EvaluationSchema.parse(parsed);
  }
}
