import assert from "node:assert/strict";
import test from "node:test";
import { parseBundle } from "./index-bundle.mjs";

test("indexes project module comments with one-based inclusive line ranges", () => {
  const source = [
    "const banner = `// src/not-a-module.ts`;",
    "const multiline = `",
    "// src/fake.ts",
    "`;",
    "// src/first.ts",
    "export const first = 1;",
    "// app/route.ts",
    "export function loader() { return 'ok'; }",
    "//# sourceMappingURL=app.js.map",
  ].join("\n");
  const result = parseBundle(source);
  assert.deepEqual(result.regions.map((region) => ({ path: region.path, start: region.startLine, end: region.endLine })), [
    { path: "src/first.ts", start: 5, end: 6 },
    { path: "app/route.ts", start: 7, end: 9 },
  ]);
  assert.equal(result.regions.every((region) => region.delimiterBalance.balanced), true);
  assert.deepEqual(result.rejectedComments, [{ line: 3, candidate: "src/fake.ts", reason: "inside-template" }]);
});
