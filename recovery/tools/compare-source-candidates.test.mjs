import assert from "node:assert/strict";
import test from "node:test";
import { scoreCandidate } from "./compare-source-candidates.mjs";

test("scores path and semantic feature overlap above a filename-only match", () => {
  const region = {
    path: "src/core/example.ts",
    symbols: ["makeFinding", "Finding"],
    imports: ["zod", "@/core/schema"],
    routes: ["/opportunities"],
    environmentKeys: ["AI_PROVIDER"],
    sql: ["SELECT id FROM findings"],
    stringLiterals: ["AI_PROVIDER", "opportunity"],
  };
  const candidate = {
    path: region.path,
    source: `import { z } from "zod";\nimport { schema } from "@/core/schema";\nexport function makeFinding() {}\nexport class Finding {}\nconst route = "/opportunities";\nconst key = "AI_PROVIDER";\nconst sql = "SELECT id FROM findings";\nconst label = "opportunity";`,
  };
  const scored = scoreCandidate(region, candidate);
  assert.equal(scored.pathMatch, true);
  assert.equal(scored.score >= 70, true);
  assert.equal(scored.overlap.symbols, 2);
});
