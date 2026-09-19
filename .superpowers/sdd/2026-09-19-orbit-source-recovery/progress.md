# SDD ledger — plan: docs/superpowers/plans/2026-09-19-orbit-source-recovery.md

Setup: recovery clone verified; original checkout is separate and clean.

Pre-flight shared interfaces:
- Task 1 -> Tasks 2-4: the evidence vault and ledger provide immutable known artifacts and evidence paths; verified by the recovery directory and hash manifest before dependent tasks.
- Task 2 -> Tasks 6-8: Cloudflare metadata/source-map findings feed candidate selection and configuration/migration comparison; verified by redacted endpoint records and hashes.
- Task 3 -> Task 9: live asset inventory/maps feed client source recovery; verified by same-origin URL records and map hashes.
- Task 4 -> Tasks 6-8: Git/source candidates feed baseline selection, module recovery, and config/migration recovery; verified by branch/blob/object IDs before extraction.
- Task 5 -> Tasks 6-10: module index and literal inventory feed all semantic/build comparisons; verified by deterministic repeated indexing.
- Task 6 -> Task 7: matrix selects the closest source candidates and required actions; verified by a row for every project-owned bundle module.
- Tasks 7-9 -> Tasks 10-11: reconstructed source/config/assets feed build and safe-route comparison; verified by local-only checks.
- Tasks 10-11 -> Task 12: verification reports feed final confidence counts/verdict; verified by report cross-checks.

Ruling: create `recovery/orbit-production-2026-09-18` before reconstruction begins — the user authorized a dedicated recovery branch and the execution workflow forbids implementation on a main branch; cost if wrong: the branch exists earlier than the requested finalization point but no production or shared branch is affected.

Task 1: Ruling: exclude `hashes.json` from its own input set — self-hashing would make the manifest unstable and would not describe the three source artifacts; cost if wrong: the manifest omits only its generated bookkeeping file, while all preserved evidence files remain hashed.

Task status:
- Task 1: complete (hash equality verified for all three known artifacts; hash script deterministic)
- Task 2: complete (official docs reviewed; four read-only surfaces probed; beta/modules and multipart each exposed only app.js; no token leakage)
- Task 3: complete (same-origin public graph captured; 15 canonical records all HTTP 200; route manifest extracted; no maps; CDN infrastructure excluded)
- Task 4: complete (17 GitHub branches fetched; candidate filename/symbol history empty; local fsck/reflog/stash/worktree and bounded cache searches recorded; original checkout clean)
- Task 5: complete (603 emitted regions indexed; all 100 project-owned boundary comments matched in order; 37 rejected generic comments diagnosed; delimiter warnings retained)
- Task 6: complete (100 matrix rows; 64 modules present on GitHub main; 36 absent from every fetched branch; main has the highest aggregate overlap among 15 unique branch tips)
- Task 7: in progress (semantic diff inputs and 100 exact emitted-region artifacts generated; no exact source maps recovered; lifecycle/pricing/usage, taxonomy, accounting, visual, insight-schema, lifecycle persistence, site-understanding, evidence-ledger, problem-synthesis, finding, claim-binding, provider, browser-capture, visual-review, broad detector, and pipeline orchestration slices reconstructed and locally compiled/tested; configuration/database/frontend comparison remains)
- Task 8: pending
- Task 9: pending
- Task 10: pending
- Task 11: pending
- Task 12: pending

Task 2: Ruling: use the beta Worker-version endpoint with `include=modules` in addition to the stable script-version and content/v2 endpoints — official documentation identifies it as the surface that can include module code and sourcemap content; cost if wrong: one additional authenticated read request and a preserved 7.8 MB response.

Task 3: Ruling: preserve the initial asset capture under `live-assets-initial` and use a corrected canonical capture after adding `/cdn-cgi/` filtering — the first run captured one Cloudflare challenge script, and deleting evidence would violate preservation; cost if wrong: three duplicate public captures increase artifact size but preserve a complete audit trail.

Task 4: Ruling: add GitHub as a read-only fetch remote in the isolated clone while retaining the local `origin` baseline remote — complete branch coverage requires the live GitHub refs, but no shared ref may be changed; cost if wrong: local remote configuration gains one harmless fetch/push URL and no push is performed.

Task 4: Ruling: search `refs/remotes/github` history and objects instead of local `--all` for GitHub provenance — local recovery commits otherwise appear as false symbol hits; cost if wrong: a source object reachable only from an un-fetched local ref would be excluded from the GitHub report, while the separate local-Git fsck/reflog search covers that case.

Task 5: Ruling: treat delimiter imbalance as a diagnostic rather than rejecting an emitted region — esbuild bundle regions can share wrapper scope and are not standalone TypeScript files; cost if wrong: a malformed boundary could remain in the index, but rejecting it would lose exact production module path coverage and hide the evidence needed for reconstruction.

Task 6: Ruling: use GitHub main as the closest clean baseline while retaining branch-specific candidates per module — main has the greatest aggregate meaningful overlap (64 candidate regions, mean score 65.8586), and no fetched branch contains the 36 production-only paths; cost if wrong: a closer source may exist outside reachable GitHub refs, so every missing file remains explicitly unresolved until bundle reconstruction proves its semantics.

Task 6: Ruling: deduplicate branches with identical tip commits for aggregate scoring but retain all equivalent ref names on each candidate — this avoids over-weighting `new-ui`/`premium-signal-desk-redesign` and release-safety aliases without losing provenance; cost if wrong: branch-specific metadata not encoded in the tree is not represented in the score.

Task 7: Ruling: preserve every project-owned emitted region as a standalone evidence artifact before reconstructing source — compiled regions are the strongest remaining production evidence after the source-map endpoints returned no map content; cost if wrong: 100 small evidence files add repository volume, but deleting or overwriting them would make later reconstruction unauditable.

Task 7: Ruling: use semantic similarity only to prioritize and compare candidates, never to label a TypeScript file exact — esbuild output has wrappers and renamed bindings and no recovered `sourcesContent`; cost if wrong: some medium-confidence work may be delayed, while falsely claiming exact source would undermine the recovery verdict.

Task 7: Ruling: restore `duplicate-title` and `visual-conversion-opportunity` to the editable rule-id contract — the direct production `ruleIds.ts` region contains both values, while the older baseline schema/registry omitted the visual rule; cost if wrong: retaining the older narrower enum would reject production diagnostics and prevent visual findings from crossing the candidate boundary.

Task 7: Ruling: keep published measurement limitations in the same bounded `PublishedFinding` collection as the emitted production contract, while distinguishing them from customer-facing findings at the `FindingSet` field level — the bundle explicitly preserves auditable Orbit capture ceilings without treating them as website defects; cost if wrong: separating them into a new shape would break the recovered wire contract and lose limitation provenance.

Task 7: Ruling: extend the editable evidence contract with the production rich-parser, crawl-coverage, rendered-observation, availability, and visual-review fields — the emitted `schema.ts` region validates those optional observations and the broad detectors read them; cost if wrong: leaving the legacy schema would silently strip production evidence before persistence and make the recovered detectors inert.

Task 7: Ruling: keep provider/browser adapters failed-closed and injectable — production evidence shows bounded DeepSeek calls, same-site screenshot redirects, request-host allowlists, render budgets, exact screenshot identities, and strict visual references; cost if wrong: a looser adapter could produce findings from unsafe or unverifiable evidence even if its happy-path output looked similar.

Task 7: Ruling: route the recovered pipeline through typed diagnostics and preserve the legacy evaluator as a compatibility boundary — the production module emits one shared model budget, visual validation, grouped understanding/critic stages, insight snapshots, and published findings, while current callers still depend on legacy opportunity fields; cost if wrong: a compatibility layer may retain some older behavior, but dropping the legacy surface would break existing persistence and tests without proving the production contract was fully wired.

Task 7: Ruling: materialize rich parser, resource, console, performance, and rendered aliases in the evidence ledger before snapshot publication — broad detector drafts cite these aliases and unresolved refs would otherwise be silently withheld; cost if wrong: the ledger contains additional bounded evidence rows, but omitting them would make production-only diagnostics non-publishable despite valid source observations.
