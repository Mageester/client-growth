import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_TIMEOUT_MS,
  createAnalysisDeadline,
} from "../app/lib/analysis.server";

describe("analysis deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts at the whole-run wall-clock limit", () => {
    vi.useFakeTimers();
    const deadline = createAnalysisDeadline();

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.timedOut).toBe(false);

    vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS - 1);
    expect(deadline.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut).toBe(true);

    deadline.dispose();
  });

  it("propagates a caller cancellation without misclassifying it as a timeout", () => {
    const parent = new AbortController();
    const deadline = createAnalysisDeadline(parent.signal);

    parent.abort("user stopped the run");

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut).toBe(false);

    deadline.dispose();
  });
});
