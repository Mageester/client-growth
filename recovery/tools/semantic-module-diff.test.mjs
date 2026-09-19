import assert from "node:assert/strict";
import test from "node:test";
import { compareFeatureSets } from "./semantic-module-diff.mjs";

test("reports meaningful source additions and removals by feature class", () => {
  const result = compareFeatureSets(
    {
      symbols: ["keep", "removed"],
      imports: ["old"],
      routes: ["/old"],
      environmentKeys: ["OLD_KEY"],
      sql: ["SELECT old"],
      stringLiterals: ["old"],
    },
    {
      symbols: ["keep", "added"],
      imports: ["new"],
      routes: ["/new"],
      environmentKeys: ["NEW_KEY"],
      sql: ["SELECT new"],
      stringLiterals: ["new"],
    },
  );
  assert.deepEqual(result.symbols, { added: ["added"], removed: ["removed"], shared: ["keep"] });
  assert.deepEqual(result.imports, { added: ["new"], removed: ["old"], shared: [] });
  assert.equal(result.routes.added[0], "/new");
});
