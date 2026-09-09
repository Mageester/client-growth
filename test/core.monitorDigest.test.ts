import { describe, expect, it } from "vitest";

import {
  buildMonitorDigest,
  digestSubject,
  renderMonitorDigestHtml,
  renderMonitorDigestText,
  shouldSendDigest,
  type MonitorDigestClientFacts,
  type MonitorDigestFacts,
} from "@/core/monitorDigest";

// The same internal vocabulary the client report scrubs. A digest is
// agency-facing, but rule ids and crawler/evaluator talk still have no place in
// it, so the render is held to the same bar.
const INTERNAL_LANGUAGE =
  /\b(?:rule[_ -]?id|crawler|evaluator|deepseek|confidence\s+(?:score|machinery)|finding\s+type|opportunity\s+id|internal\s+metadata)\b/i;

const BASE = "https://orbit.example";

function clientFacts(over: Partial<MonitorDigestClientFacts> = {}): MonitorDigestClientFacts {
  return {
    clientId: "cli_1",
    clientName: "Acme Plumbing",
    domain: "acme.example",
    newCount: 0,
    resolvedCount: 0,
    couldNotRead: false,
    latestOutcome: "clean",
    openCount: 0,
    openPriceMin: 0,
    openPriceMax: 0,
    topOpportunity: null,
    averageJobValue: null,
    ...over,
  };
}

function facts(over: Partial<MonitorDigestFacts> = {}): MonitorDigestFacts {
  return {
    workspaceName: "Northwind Digital",
    period: { since: "2026-09-01T13:00:00.000Z", until: "2026-09-08T13:00:00.000Z" },
    monitoredClients: 3,
    clients: [],
    ...over,
  };
}

describe("buildMonitorDigest", () => {
  it("only lines up clients that gained or resolved work, and totals the rest", () => {
    const model = buildMonitorDigest(
      facts({
        monitoredClients: 4,
        clients: [
          clientFacts({ clientId: "a", clientName: "Alpha", newCount: 1, latestOutcome: "findings", openCount: 1, openPriceMin: 900, openPriceMax: 1800, topOpportunity: { id: "o_a", title: "No page for water heater replacement", priceMin: 900, priceMax: 1800 } }),
          clientFacts({ clientId: "b", clientName: "Bravo", resolvedCount: 2, latestOutcome: "clean" }),
          clientFacts({ clientId: "c", clientName: "Charlie" }), // scanned, nothing changed
        ],
      }),
    );

    expect(model.lines.map((l) => l.clientId)).toEqual(["a", "b"]); // charlie has no change
    expect(model.totals.newFindings).toBe(1);
    expect(model.totals.resolvedFindings).toBe(2);
    expect(model.totals.clientsWithChange).toBe(2);
    expect(model.totals.monitoredClients).toBe(4);
    expect(model.quiet).toBe(false);
  });

  it("sorts lines by new count, then by open value", () => {
    const model = buildMonitorDigest(
      facts({
        clients: [
          clientFacts({ clientId: "low", clientName: "Low", newCount: 1, openCount: 1, openPriceMax: 500 }),
          clientFacts({ clientId: "high", clientName: "High", newCount: 3 }),
          clientFacts({ clientId: "mid", clientName: "Mid", newCount: 1, openCount: 1, openPriceMax: 5000 }),
        ],
      }),
    );
    expect(model.lines.map((l) => l.clientId)).toEqual(["high", "mid", "low"]);
  });

  it("is quiet when nothing new or resolved happened", () => {
    const model = buildMonitorDigest(
      facts({ clients: [clientFacts({ clientId: "a", latestOutcome: "clean" })] }),
    );
    expect(model.quiet).toBe(true);
    expect(model.lines).toEqual([]);
  });

  it("counts sites it could not read without making them a headline", () => {
    const model = buildMonitorDigest(
      facts({
        clients: [
          clientFacts({ clientId: "a", couldNotRead: true, latestOutcome: "inconclusive" }),
          clientFacts({ clientId: "b", couldNotRead: true, latestOutcome: "inconclusive" }),
        ],
      }),
    );
    expect(model.couldNotRead).toBe(2);
    expect(model.quiet).toBe(true); // unreadable alone is not "change"
  });

  it("derives the payoff sentence from the recorded job value", () => {
    const model = buildMonitorDigest(
      facts({
        clients: [
          clientFacts({
            clientId: "a",
            newCount: 1,
            latestOutcome: "findings",
            openCount: 1,
            openPriceMin: 900,
            openPriceMax: 1800,
            averageJobValue: 2000,
            topOpportunity: { id: "o", title: "Booking form is broken", priceMin: 900, priceMax: 1800 },
          }),
        ],
      }),
    );
    expect(model.lines[0]?.payoff).toBe("Pays for itself with one job.");
  });
});

describe("shouldSendDigest", () => {
  const changed = buildMonitorDigest(
    facts({ clients: [clientFacts({ newCount: 1, latestOutcome: "findings" })] }),
  );
  const quiet = buildMonitorDigest(facts({ clients: [clientFacts({})] }));
  const empty = buildMonitorDigest(facts({ monitoredClients: 0, clients: [] }));

  it("never sends when nothing is monitored", () => {
    expect(shouldSendDigest(empty, { cadence: "weekly", onlyOnChange: false })).toBe(false);
  });

  it("with only-on-change, sends on change and stays silent on a quiet week", () => {
    expect(shouldSendDigest(changed, { cadence: "weekly", onlyOnChange: true })).toBe(true);
    expect(shouldSendDigest(quiet, { cadence: "weekly", onlyOnChange: true })).toBe(false);
  });

  it("without only-on-change, sends the weekly heartbeat even when quiet", () => {
    expect(shouldSendDigest(quiet, { cadence: "weekly", onlyOnChange: false })).toBe(true);
  });

  it("never sends when the cadence is off", () => {
    expect(shouldSendDigest(changed, { cadence: "off", onlyOnChange: false })).toBe(false);
  });
});

describe("rendering", () => {
  const model = buildMonitorDigest(
    facts({
      workspaceName: "Northwind Digital",
      clients: [
        clientFacts({
          clientId: "cli_a",
          clientName: "Acme Plumbing",
          domain: "acme.example",
          newCount: 2,
          latestOutcome: "findings",
          openCount: 2,
          openPriceMin: 1200,
          openPriceMax: 2600,
          averageJobValue: 3000,
          topOpportunity: { id: "opp_9", title: "No page for water heater replacement", priceMin: 900, priceMax: 1800 },
        }),
        clientFacts({ clientId: "cli_b", couldNotRead: true, latestOutcome: "inconclusive" }),
      ],
    }),
  );

  it("text names the client, the change and a working deep link", () => {
    const text = renderMonitorDigestText(model, BASE);
    expect(text).toContain("Northwind Digital");
    expect(text).toContain("Acme Plumbing (acme.example)");
    expect(text).toContain("2 new since last scan");
    expect(text).toContain("https://orbit.example/opportunities/opp_9");
    expect(text).toContain("https://orbit.example/monitor");
    expect(text).toContain("Pays for itself with one job.");
    expect(text).toContain("1 site couldn't be fully read");
  });

  it("html escapes content and links to the opportunity", () => {
    const html = renderMonitorDigestHtml(model, BASE + "/");
    expect(html).toContain("https://orbit.example/opportunities/opp_9");
    expect(html).not.toContain("orbit.example//opportunities"); // trailing slash trimmed
    expect(html).toContain("Acme Plumbing");
  });

  it("never leaks internal vocabulary", () => {
    expect(renderMonitorDigestText(model, BASE)).not.toMatch(INTERNAL_LANGUAGE);
    expect(renderMonitorDigestHtml(model, BASE)).not.toMatch(INTERNAL_LANGUAGE);
  });

  it("headlines the subject on new work, and falls back when quiet", () => {
    expect(digestSubject(model)).toBe(
      "Axiom Orbit — 2 new opportunities across your clients",
    );
    const quiet = buildMonitorDigest(facts({ clients: [clientFacts({})] }));
    expect(digestSubject(quiet)).toBe("Axiom Orbit — your weekly monitoring digest");
  });
});
