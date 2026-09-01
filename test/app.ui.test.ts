import { describe, expect, it, vi } from "vitest";

import { deferMenuClose } from "../app/components/ui";

describe("menu activation", () => {
  it("defers closing until a nested form can submit", () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];

      deferMenuClose(() => events.push("close"));
      events.push("submit");

      expect(events).toEqual(["submit"]);
      vi.runOnlyPendingTimers();
      expect(events).toEqual(["submit", "close"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
