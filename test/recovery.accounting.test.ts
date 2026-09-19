import { describe, expect, it } from "vitest";
import {
  BudgetUsageSchema,
  InsightAccountingSchema,
  RenderBudget,
  legacyInsightAccounting,
} from "@/core/analysisAccounting";

describe("recovered accounting contracts", () => {
  it("rejects inconsistent budgets and caps reservations deterministically", () => {
    expect(() =>
      BudgetUsageSchema.parse({
        limit: 2,
        used: 2,
        remaining: 1,
        attempted: 2,
        capped: false,
      }),
    ).toThrow();

    const budget = new RenderBudget("run-1", 2);
    expect(budget.reserve("desktop homepage", 1)).toBe(true);
    expect(budget.reserve("mobile homepage", 2)).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      limit: 2,
      used: 1,
      remaining: 1,
      attempted: 3,
      capped: true,
    });
  });

  it("keeps legacy snapshots explicitly unassessed", () => {
    const accounting = legacyInsightAccounting();
    expect(accounting.state).toBe("unassessed");
    expect(accounting.categories).toHaveLength(10);
    expect(InsightAccountingSchema.parse(accounting)).toEqual(accounting);
  });
});
