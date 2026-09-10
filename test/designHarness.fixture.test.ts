import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const generated: string[] = [];

afterEach(() => {
  for (const path of generated.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

/**
 * The one test that still runs the harness the way a person runs it: spawn
 * `tsx`, generate every screen, read the files off disk. That end-to-end path
 * is worth proving once — it covers argv handling, the write loop and the
 * output filenames, none of which `renderHarnessPage` exercises.
 *
 * It is worth proving exactly once, though. A second test was doing the same
 * work to inspect one page, and the pair cost ~8s of wall clock; each landed
 * near 4.1s of vitest's 5s default on an idle machine and crossed it under the
 * full parallel suite, failing the release gate for reasons unrelated to the
 * product. That one now calls `renderHarnessPage` directly.
 *
 * The timeout below is explicit because this test genuinely is an integration
 * test: it starts a Node process, compiles TypeScript through esbuild, and
 * server-renders nineteen React pages. Four seconds of real work does not fit
 * a budget meant for unit tests, and raising it hides nothing — the assertions
 * are unchanged, and a harness that got slower would still be visible in the
 * reporter's per-test timing.
 */
const HARNESS_GENERATION_TIMEOUT_MS = 60_000;

describe("design harness fixture truth", () => {
  it("keeps opportunity evidence attached to the selected client", () => {
    const output = mkdtempSync(join(tmpdir(), "axiom-orbit-harness-"));
    generated.push(output);

    execFileSync(
      process.execPath,
      [join("node_modules", "tsx", "dist", "cli.mjs"), "scripts/design-harness.tsx", output],
      { cwd: process.cwd(), stdio: "pipe" },
    );

    const detail = readFileSync(join(output, "opportunity-detail.html"), "utf8");
    expect(detail).toContain("cambridgeheating.ca/services");
    expect(detail).not.toContain("northwindheating.co.uk/services");

    const queue = readFileSync(join(output, "opportunities.html"), "utf8");
    expect(queue).toContain("Review proposal");
  }, HARNESS_GENERATION_TIMEOUT_MS);
});
