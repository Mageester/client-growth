// src/adapters/evaluator/DeepSeekEvaluator.ts
var DeepSeekRequestError = class extends Error {
  constructor(message2, status) {
    super(message2);
    this.status = status;
    this.name = "DeepSeekRequestError";
  }
  status;
  static {
    __name(this, "DeepSeekRequestError");
  }
};
var MalformedEvaluationError = class extends Error {
  constructor(message2, detail) {
    super(message2);
    this.detail = detail;
    this.name = "MalformedEvaluationError";
  }
  detail;
  static {
    __name(this, "MalformedEvaluationError");
  }
};
var DeepSeekEvaluator = class {
  static {
    __name(this, "DeepSeekEvaluator");
  }
  apiKey;
  baseUrl;
  model;
  fetchImpl;
  timeoutMs;
  /** Usage from the last successful call, or null. */
  lastUsage = null;
  constructor(config3) {
    if (!config3.apiKey || config3.apiKey.trim() === "") {
      throw new Error(
        "DeepSeekEvaluator requires a non-empty apiKey. Set AI_PROVIDER=deepseek and DEEPSEEK_API_KEY only for explicit live runs (pnpm eval:live). Normal development and the default test suite use MockEvaluator."
      );
    }
    const rawFetch = config3.fetchImpl ?? globalThis.fetch;
    if (typeof rawFetch !== "function") {
      throw new Error("DeepSeekEvaluator: no fetch implementation available");
    }
    this.apiKey = config3.apiKey;
    this.baseUrl = (config3.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.model = config3.model ?? "deepseek-flash";
    this.fetchImpl = config3.fetchImpl ?? rawFetch.bind(globalThis);
    this.timeoutMs = config3.timeoutMs ?? 2e4;
  }
  async evaluate(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onCallerAbort = /* @__PURE__ */ __name(() => controller.abort(input.signal?.reason), "onCallerAbort");
    if (input.signal) {
      if (input.signal.aborted) onCallerAbort();
      else input.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    try {
      let response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            thinking: { type: "disabled" },
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPromptFor(input) },
              { role: "user", content: buildEvaluatorUserPrompt(input) }
            ]
          })
        });
      } catch (err) {
        throw new DeepSeekRequestError(
          `DeepSeekEvaluator: request failed (${err.message})`
        );
      }
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new DeepSeekRequestError(
          `DeepSeekEvaluator: provider returned HTTP ${response.status} ${bodyText.slice(0, 200)}`.trim(),
          response.status
        );
      }
      let json2;
      try {
        json2 = await response.json();
      } catch {
        throw new MalformedEvaluationError("DeepSeekEvaluator: response body was not JSON");
      }
      const content = json2.choices?.[0]?.message?.content;
      if (!content || content.trim() === "") {
        throw new MalformedEvaluationError("DeepSeekEvaluator: response had no message content");
      }
      let raw;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new MalformedEvaluationError(
          "DeepSeekEvaluator: message content was not valid JSON",
          content.slice(0, 300)
        );
      }
      this.lastUsage = {
        promptTokens: json2.usage?.prompt_tokens ?? 0,
        completionTokens: json2.usage?.completion_tokens ?? 0,
        totalTokens: json2.usage?.total_tokens ?? 0
      };
      return toEvaluation(input, raw);
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
};
function toEvaluation(input, raw) {
  const { candidate } = input;
  if (candidate.conversionDefect) {
    const parsed2 = DefectJudgmentSchema.safeParse(raw);
    if (!parsed2.success) {
      throw new MalformedEvaluationError(
        "DeepSeekEvaluator: model output did not match the defect judgment contract",
        parsed2.error.issues
      );
    }
    return {
      verdict: parsed2.data.verdict,
      confidence: candidate.rawConfidence,
      rationale: parsed2.data.rationale,
      suggestedScope: parsed2.data.suggestedScope,
      subjectType: "conversion_defect",
      commerciallyActionable: parsed2.data.commerciallyActionable
    };
  }
  const parsed = ServiceJudgmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MalformedEvaluationError(
      "DeepSeekEvaluator: model output did not match the service judgment contract",
      parsed.error.issues
    );
  }
  return {
    verdict: parsed.data.verdict,
    confidence: candidate.rawConfidence,
    rationale: parsed.data.rationale,
    suggestedScope: parsed.data.suggestedScope,
    subjectType: parsed.data.subjectType,
    commerciallyActionable: parsed.data.commerciallyActionable
  };
}
__name(toEvaluation, "toEvaluation");
