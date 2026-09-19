# Orbit production recovery notes

This report records reconstruction confidence separately from the production
bundle evidence. The bundle is authoritative for the deployed behavior, but it
is not an exact editable TypeScript source tree: it contains esbuild wrappers,
minified helper names, and no recovered `sourcesContent`.

## Current evidence

- Production version: `529a96b3-f525-413f-90da-c32c20505baf`.
- The authenticated Cloudflare version and content endpoints expose one
  `app.js` module and no source-map module or `sourcesContent`.
- The exact deployed bundle is preserved under
  `recovery/evidence/known/extracted/app.js` and indexed under
  `recovery/bundle/module-index.json`.
- The index contains 100 project-owned emitted regions. The comparison matrix
  finds 64 corresponding paths on the closest reachable GitHub baseline and
  36 production-only paths.
- Semantic comparison is heuristic for compiled-only code. It is used to
  guide reconstruction and cannot upgrade a reconstructed file to exact-source
  confidence without a verified source map or matching source blob.

## Confidence labels

- **exact**: source content is recovered from a verified source map or exact
  source blob with provenance and hash.
- **high**: behavior and declarations are directly supported by the deployed
  region plus an independently matching repository contract or test.
- **medium**: the deployed region supports the behavior, but one or more type
  boundaries, import contracts, or persistence details are reconstructed.
- **unresolved**: the bundle exposes the module or symbol, but there is not
  enough evidence to safely recreate an editable implementation.

## Semantic comparison status

`recovery/bundle/comparisons/semantic-diffs.json` and
`semantic-diff.md` contain one record per project-owned emitted region. Each
record keeps the region boundary, closest Git candidate when available, and
normalized declaration/import/export/route/environment/SQL signals. Emitted
helper wrappers and variable renaming are excluded from the similarity score.

No module is currently labeled exact. The first reconstruction slices are
limited to bounded schemas, deterministic accounting/lifecycle utilities, and
small persistence helpers whose contracts can be checked locally.

## Known production-region inconsistency

The direct production `src/core/ruleIds.ts` region contains both
`duplicate-title` and `visual-conversion-opportunity`. The older Git baseline
schema/registry omitted the visual rule, so the editable recovery restores both
production values at the candidate boundary and adds the visual catalog link.

## Reconstruction rules

1. Preserve the deployed region in the evidence vault before editing source.
2. Prefer existing repository types and SQL conventions over inferred APIs.
3. Add a local deterministic test before implementing a missing behavior.
4. Keep provider calls injectable and never call production services from tests.
5. Mark inferred boundaries medium or unresolved; do not silently claim source
   recovery when only compiled behavior is available.
