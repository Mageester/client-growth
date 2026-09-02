/**
 * Opportunity-engine benchmark.
 *
 *   pnpm bench                 deterministic, offline, free (MockEvaluator)
 *   pnpm bench --deepseek      ALSO runs the real provider and compares
 *
 * The default run is the number engine quality is judged by: false positives
 * count far more than low opportunity volume, because a wrong pitch costs the
 * agency its client relationship and a missed one costs it a quote.
 *
 * `--deepseek` is opt-in, requires DEEPSEEK_API_KEY in the environment, and is
 * capped at CG_BENCH_MAX_CALLS evaluator calls (default 20). It never touches
 * production data — every site is a local fixture.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DeepSeekEvaluator } from "@/adapters/evaluator/DeepSeekEvaluator";
import { MockEvaluator } from "@/adapters/evaluator/MockEvaluator";

import { CASES } from "../test/bench/cases";
import { JUDGMENT_CASES } from "../test/bench/judgmentCases";
import { runBenchmark, type Scorecard } from "../test/bench/harness";
import { metered, newMeter, type EvaluatorMeter } from "../test/bench/meteredEvaluator";

const PAD = 30;
const wantDeepSeek = process.argv.includes("--deepseek");
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
  console.log("=".repeat(96));
  console.log(
    "case".padEnd(PAD) +
      "outcome".padEnd(14) +
      "cand".padEnd(6) +
      "thr".padEnd(6) +
      "supp".padEnd(6) +
      "eval".padEnd(6) +
      "surf".padEnd(6) +
      "exp".padEnd(5) +
      "grade",
  );
  console.log("-".repeat(96));

  for (const r of card.results) {
    const suppressed = r.stats.suppressedByCoverage + r.stats.suppressedByPriorDecision;
    console.log(
      r.id.slice(0, PAD - 1).padEnd(PAD) +
        r.outcome.padEnd(14) +
        String(r.stats.candidates).padEnd(6) +
        String(r.stats.passedEvidenceThreshold).padEnd(6) +
        String(suppressed).padEnd(6) +
        String(r.stats.evaluated).padEnd(6) +
        String(r.stats.surfaced).padEnd(6) +
        String(r.expected).padEnd(5) +
        r.grade,
    );
    if (r.grade !== "GOOD") console.log("".padEnd(PAD) + "↳ " + r.why);
  }

  console.log("-".repeat(96));
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
  console.log("=".repeat(96));
  console.log(
    "case".padEnd(PAD) + "human".padEnd(8) + "mock".padEnd(8) + "deepseek".padEnd(10) + "agreement",
  );
  console.log("-".repeat(96));

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
  console.log("-".repeat(96));
  console.log(`divergences ${divergences}/${mock.results.length}`);
  console.log(
    `deepseek calls ${meter.calls} (cap ${MAX_CALLS})   failures ${meter.failures}   ` +
      `tokens in ${meter.promptTokens} out ${meter.completionTokens}   ` +
      `est. cost $${meter.costUsd.toFixed(4)}`,
  );
  const rejected = meter.verdicts.filter((v) => v.verdict === "reject");
  console.log(
    `deepseek verdicts: ${meter.verdicts.length - rejected.length} surface, ${rejected.length} reject`,
  );
  for (const v of meter.verdicts) {
    console.log(`  - ${v.verdict.padEnd(8)} ${v.confidence.toFixed(2)}  ${v.subject}`);
  }
}

async function main() {
  const mock = await runBenchmark(new MockEvaluator());
  printCard(mock, "OPPORTUNITY ENGINE BENCHMARK — MockEvaluator, fixture sites, no network");
  printSurfaced(mock);

  const mockJudgment = await runBenchmark(new MockEvaluator(), JUDGMENT_CASES);
  printCard(
    mockJudgment,
    "JUDGMENT CASES — evidence sufficient, commercial call not automatic (MockEvaluator)",
  );
  printSurfaced(mockJudgment);

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

    console.log(`\nRunning ${CASES.length + JUDGMENT_CASES.length} cases against DeepSeek (cap ${MAX_CALLS} calls)…`);
    const real = await runBenchmark(evaluator);
    printCard(real, "OPPORTUNITY ENGINE BENCHMARK — DeepSeekEvaluator, same fixture sites");
    printSurfaced(real);
    printComparison(mock, real, meter);

    const realJudgment = await runBenchmark(evaluator, JUDGMENT_CASES);
    printCard(realJudgment, "JUDGMENT CASES — DeepSeekEvaluator");
    printSurfaced(realJudgment);
    printComparison(mockJudgment, realJudgment, meter);

    if (real.bad > 0 || realJudgment.bad > 0) process.exitCode = 1;
  }

  console.log("");
  if (mock.bad > 0) process.exitCode = 1;
}

void main();
