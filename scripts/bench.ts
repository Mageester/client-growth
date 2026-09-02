/**
 * Opportunity-engine benchmark.
 *
 *   pnpm bench                    deterministic, offline, free (MockEvaluator)
 *   pnpm bench --deepseek         ALSO runs the real provider and compares
 *   pnpm bench --deepseek --samples=3
 *                                 repeats the adversarial judgment set N times
 *                                 and reports per-subject stability
 *
 * The default run is the number engine quality is judged by: false positives
 * count far more than low opportunity volume, because a wrong pitch costs the
 * agency its client relationship and a missed one costs it a quote.
 *
 * `--deepseek` is opt-in, requires DEEPSEEK_API_KEY in the environment, and is
 * capped at CG_BENCH_MAX_CALLS evaluator calls (default 20 — raise it
 * deliberately for a sampled adversarial run). It never touches production data
 * — every site is a local fixture.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";
import type { OpportunityEvaluator } from "@/ports/OpportunityEvaluator";

import { CASES, type JudgmentCategory } from "../test/bench/cases";
import { JUDGMENT_CASES } from "../test/bench/judgmentCases";
import { ADVERSARIAL_CASES, categoryCounts } from "../test/bench/adversarialCases";
import { runBenchmark, type CaseResult, type Scorecard } from "../test/bench/harness";
import { metered, newMeter, type EvaluatorMeter } from "../test/bench/meteredEvaluator";

const PAD = 46;
const wantDeepSeek = process.argv.includes("--deepseek");
const SAMPLES = Number(
  process.argv.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? "1",
);
const MAX_CALLS = Number(process.env.CG_BENCH_MAX_CALLS ?? "20");

/**
 * Read a value from `.dev.vars` (git-ignored) without printing it.
 *
 * The key belongs in the file the Worker already reads, not in a shell history,
 * a process listing or anyone's terminal scrollback. Nothing here ever logs the
 * value, and the file is the same one `wrangler dev` uses.
 */
function fromDevVars(name: string): string | undefined {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".dev.vars");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`).exec(line);
    if (!match) continue;
    const value = match[1]!.trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return undefined;
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

function printCard(card: Scorecard, title: string) {
  console.log("");
  console.log(title);
  console.log("=".repeat(110));
  console.log(
    "case".padEnd(PAD) +
      "outcome".padEnd(14) +
      "cand".padEnd(6) +
      "thr".padEnd(6) +
      "supp".padEnd(6) +
      "eval".padEnd(6) +
      "rej".padEnd(6) +
      "surf".padEnd(6) +
      "exp".padEnd(5) +
      "grade",
  );
  console.log("-".repeat(110));

  for (const r of card.results) {
    const suppressed = r.stats.suppressedByCoverage + r.stats.suppressedByPriorDecision;
    console.log(
      r.id.slice(0, PAD - 1).padEnd(PAD) +
        r.outcome.padEnd(14) +
        String(r.stats.candidates).padEnd(6) +
        String(r.stats.passedEvidenceThreshold).padEnd(6) +
        String(suppressed).padEnd(6) +
        String(r.stats.evaluated).padEnd(6) +
        String(r.stats.rejectedByEvaluator).padEnd(6) +
        String(r.stats.surfaced).padEnd(6) +
        String(r.expected).padEnd(5) +
        r.grade,
    );
    if (r.grade !== "GOOD") console.log("".padEnd(PAD) + "↳ " + r.why);
  }

  console.log("-".repeat(110));
  console.log(
    `GOOD ${card.good}/${card.results.length} (${pct(card.good, card.results.length)})   ` +
      `QUESTIONABLE ${card.questionable}   BAD ${card.bad}`,
  );
  console.log(
    `false positives ${card.falsePositives}   false negatives ${card.falseNegatives}   ` +
      `evaluator calls ${card.evaluatorCalls}`,
  );
}

function printSurfaced(card: Scorecard) {
  console.log("");
  for (const r of card.results) {
    if (r.surfaced.length === 0) continue;
    console.log(`${r.clientName} (${r.id})`);
    for (const s of r.surfaced) {
      console.log(`  • [${s.ruleId}] ${s.title} — $${s.priceMin}–$${s.priceMax}`);
    }
  }
}

function printComparison(mock: Scorecard, real: Scorecard, meter: EvaluatorMeter) {
  console.log("");
  console.log("MOCK vs DEEPSEEK vs HUMAN LABEL");
  console.log("=".repeat(110));
  console.log(
    "case".padEnd(PAD) + "human".padEnd(8) + "mock".padEnd(8) + "deepseek".padEnd(10) + "agreement",
  );
  console.log("-".repeat(110));

  let divergences = 0;
  for (let i = 0; i < mock.results.length; i++) {
    const m = mock.results[i]!;
    const d = real.results[i]!;
    const agree = m.surfaced.length === d.surfaced.length && m.grade === d.grade;
    if (!agree) divergences++;
    console.log(
      m.id.slice(0, PAD - 1).padEnd(PAD) +
        String(m.expected).padEnd(8) +
        `${m.surfaced.length} ${m.grade[0]}`.padEnd(8) +
        `${d.surfaced.length} ${d.grade[0]}`.padEnd(10) +
        (agree ? "same" : "DIVERGED"),
    );
  }
  console.log("-".repeat(110));
  console.log(`divergences ${divergences}/${mock.results.length}`);
  printSpend(meter);
  for (const v of meter.verdicts.slice(-mock.results.length * 3)) {
    console.log(
      `  - ${v.verdict.padEnd(8)} ${(v.subjectType ?? "-").padEnd(18)}` +
        `actionable=${String(v.commerciallyActionable ?? "-").padEnd(6)} ${v.subject}`,
    );
  }
}

function printSpend(meter: EvaluatorMeter) {
  console.log(
    `deepseek calls ${meter.calls} (cap ${MAX_CALLS})   failures ${meter.failures}   ` +
      `tokens in ${meter.promptTokens} out ${meter.completionTokens}   ` +
      `est. cost $${meter.costUsd.toFixed(4)}`,
  );
}

/**
 * The category scorecard: what the judgment layer is actually for.
 *
 * A single aggregate GOOD count hides the only asymmetry that matters, so this
 * splits results by what kind of subject was being judged. The trust-signal,
 * promotion and generic-claim rows are the ones that have to be zero.
 */
const CATEGORY_ORDER: JudgmentCategory[] = [
  "true_service",
  "trust_signal",
  "promotion",
  "generic_claim",
  "ambiguous",
];

const CATEGORY_LABEL: Record<JudgmentCategory, string> = {
  true_service: "true services (should surface)",
  trust_signal: "trust signals (must not surface)",
  promotion: "promotions (must not surface)",
  generic_claim: "generic claims (must not surface)",
  ambiguous: "ambiguous (must fail closed)",
};

function printCategoryCard(results: CaseResult[], title: string) {
  console.log("");
  console.log(title);
  console.log("=".repeat(110));
  console.log(
    "category".padEnd(36) +
      "cases".padEnd(7) +
      "judged".padEnd(8) +
      "surfaced".padEnd(10) +
      "rate".padEnd(7) +
      "GOOD".padEnd(6) +
      "QUES".padEnd(6) +
      "BAD",
  );
  console.log("-".repeat(110));

  for (const category of CATEGORY_ORDER) {
    const rows = results.filter((r) => r.category === category);
    if (rows.length === 0) continue;
    const judged = rows.reduce((n, r) => n + r.stats.evaluated, 0);
    const surfaced = rows.reduce((n, r) => n + r.stats.surfaced, 0);
    console.log(
      CATEGORY_LABEL[category].padEnd(36) +
        String(rows.length).padEnd(7) +
        String(judged).padEnd(8) +
        String(surfaced).padEnd(10) +
        pct(surfaced, rows.length).padEnd(7) +
        String(rows.filter((r) => r.grade === "GOOD").length).padEnd(6) +
        String(rows.filter((r) => r.grade === "QUESTIONABLE").length).padEnd(6) +
        String(rows.filter((r) => r.grade === "BAD").length),
    );
  }
  console.log("-".repeat(110));
}

/**
 * Repeated sampling.
 *
 * One run of a stochastic judge is an anecdote. Every adversarial case is run
 * `SAMPLES` times and reported as a surface rate, so an unstable subject shows
 * up as 2/3 instead of as whichever answer arrived first.
 */
interface Stability {
  id: string;
  category: JudgmentCategory | null;
  surfaced: number;
  runs: number;
  grades: string[];
}

async function runSampled(
  evaluator: OpportunityEvaluator,
  samples: number,
): Promise<{ cards: Scorecard[]; stability: Stability[] }> {
  const cards: Scorecard[] = [];
  const byId = new Map<string, Stability>();

  for (let i = 0; i < samples; i++) {
    const card = await runBenchmark(evaluator, ADVERSARIAL_CASES);
    cards.push(card);
    for (const r of card.results) {
      const row = byId.get(r.id) ?? {
        id: r.id,
        category: r.category,
        surfaced: 0,
        runs: 0,
        grades: [],
      };
      row.runs++;
      row.surfaced += r.stats.surfaced;
      row.grades.push(r.grade[0]!);
      byId.set(r.id, row);
    }
    console.log(
      `  sample ${i + 1}/${samples}: GOOD ${card.good} QUESTIONABLE ${card.questionable} BAD ${card.bad}`,
    );
  }
  return { cards, stability: [...byId.values()] };
}

function printStability(rows: Stability[]) {
  console.log("");
  console.log("PER-SUBJECT STABILITY (surfaced / runs)");
  console.log("=".repeat(110));
  for (const category of CATEGORY_ORDER) {
    const inCategory = rows.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    console.log(CATEGORY_LABEL[category]);
    for (const row of inCategory) {
      const unstable = row.surfaced > 0 && row.surfaced < row.runs;
      console.log(
        "  " +
          row.id.padEnd(PAD) +
          `${row.surfaced}/${row.runs}`.padEnd(8) +
          row.grades.join("") +
          (unstable ? "   UNSTABLE" : ""),
      );
    }
  }
  console.log("-".repeat(110));
}

async function main() {
  const counts = categoryCounts();
  console.log(
    `Adversarial judgment set: ${ADVERSARIAL_CASES.length} cases — ` +
      CATEGORY_ORDER.map((c) => `${counts[c]} ${c}`).join(", "),
  );

  const mock = await runBenchmark(new MockEvaluator());
  printCard(mock, "OPPORTUNITY ENGINE BENCHMARK — MockEvaluator, fixture sites, no network");
  printSurfaced(mock);

  const mockJudgment = await runBenchmark(new MockEvaluator(), JUDGMENT_CASES);
  printCard(
    mockJudgment,
    "JUDGMENT CASES — evidence sufficient, commercial call not automatic (MockEvaluator)",
  );

  const mockAdversarial = await runBenchmark(new MockEvaluator(), ADVERSARIAL_CASES);
  printCard(mockAdversarial, "ADVERSARIAL JUDGMENT SET — MockEvaluator (no commercial judgment)");
  printCategoryCard(mockAdversarial.results, "ADVERSARIAL BY CATEGORY — MockEvaluator");

  if (wantDeepSeek) {
    const apiKey = process.env.DEEPSEEK_API_KEY ?? fromDevVars("DEEPSEEK_API_KEY");
    if (!apiKey) {
      console.error(
        "\n--deepseek needs DEEPSEEK_API_KEY. Nothing was called.\n" +
          "Add a DEEPSEEK_API_KEY=... line to .dev.vars (git-ignored); this script reads it\n" +
          "from there and never prints it.",
      );
      process.exitCode = 2;
      return;
    }

    const meter = newMeter();
    const evaluator = metered(
      new DeepSeekEvaluator({
        apiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? fromDevVars("DEEPSEEK_BASE_URL"),
        model: process.env.DEEPSEEK_MODEL ?? fromDevVars("DEEPSEEK_MODEL"),
      }),
      meter,
      MAX_CALLS,
    );

    console.log(`\nRunning ${CASES.length} core cases against DeepSeek (cap ${MAX_CALLS} calls)…`);
    const real = await runBenchmark(evaluator);
    printCard(real, "OPPORTUNITY ENGINE BENCHMARK — DeepSeekEvaluator, same fixture sites");
    printComparison(mock, real, meter);

    const realJudgment = await runBenchmark(evaluator, JUDGMENT_CASES);
    printCard(realJudgment, "JUDGMENT CASES — DeepSeekEvaluator");
    printComparison(mockJudgment, realJudgment, meter);

    console.log(
      `\nRunning the ${ADVERSARIAL_CASES.length}-case adversarial set × ${SAMPLES} sample(s)…`,
    );
    const { cards, stability } = await runSampled(evaluator, SAMPLES);
    const last = cards[cards.length - 1]!;
    printCard(last, `ADVERSARIAL JUDGMENT SET — DeepSeekEvaluator (final of ${SAMPLES} sample(s))`);
    for (const [i, card] of cards.entries()) {
      printCategoryCard(card.results, `ADVERSARIAL BY CATEGORY — DeepSeek, sample ${i + 1}`);
    }
    printStability(stability);
    printSpend(meter);

    const worstBad = Math.max(...cards.map((c) => c.bad));
    if (real.bad > 0 || realJudgment.bad > 0 || worstBad > 0) process.exitCode = 1;
  }

  console.log("");
  if (mock.bad > 0) process.exitCode = 1;
}

void main();
