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
 *  - every failure mode is a thrown typed error and produces NO opportunity
 *    (the pipeline catches it and fails closed);
 *  - `fetchImpl` is injectable for contract tests that stub the HTTP layer.
 */

/** Raised when the provider is unreachable or returns a non-2xx response. */
export class DeepSeekRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekRequestError";
  }
}

/** Raised when the provider responds but the content is not a valid Evaluation. */
export class MalformedEvaluationError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "MalformedEvaluationError";
  }
}

export interface DeepSeekEvaluatorConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms. Default 20_000. */
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Token usage from the most recent call, for cost reporting. */
export interface DeepSeekUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class DeepSeekEvaluator implements OpportunityEvaluator {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  /** Usage from the last successful call, or null. */
  lastUsage: DeepSeekUsage | null = null;

  constructor(config: DeepSeekEvaluatorConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error(
        "DeepSeekEvaluator requires a non-empty apiKey. Set AI_PROVIDER=deepseek and " +
          "DEEPSEEK_API_KEY only for explicit live runs (pnpm eval:live). Normal " +
          "development and the default test suite use MockEvaluator.",
      );
    }
    const rawFetch = config.fetchImpl ?? globalThis.fetch;
    if (typeof rawFetch !== "function") {
      throw new Error("DeepSeekEvaluator: no fetch implementation available");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config.model ?? "deepseek-chat";
    // Bind so it can be called as `this.fetchImpl(...)` without an "illegal
    // invocation" on runtimes (workerd) that require `fetch`'s original receiver.
    this.fetchImpl = config.fetchImpl ?? rawFetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  async evaluate(input: EvaluatorInput): Promise<Evaluation> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
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
    } catch (err) {
      throw new DeepSeekRequestError(
        `DeepSeekEvaluator: request failed (${(err as Error).message})`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new DeepSeekRequestError(
        `DeepSeekEvaluator: provider returned HTTP ${response.status} ${bodyText.slice(0, 200)}`.trim(),
        response.status,
      );
    }

    let json: ChatCompletionResponse;
    try {
      json = (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new MalformedEvaluationError("DeepSeekEvaluator: response body was not JSON");
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content || content.trim() === "") {
      throw new MalformedEvaluationError("DeepSeekEvaluator: response had no message content");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new MalformedEvaluationError(
        "DeepSeekEvaluator: message content was not valid JSON",
        content.slice(0, 300),
      );
    }

    const parsed = EvaluationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MalformedEvaluationError(
        "DeepSeekEvaluator: model output did not match the Evaluation contract",
        parsed.error.issues,
      );
    }

    this.lastUsage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    };

    return parsed.data;
  }
}
