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
  });
});
