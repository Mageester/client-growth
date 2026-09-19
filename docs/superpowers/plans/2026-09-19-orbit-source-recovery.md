# Axiom Orbit Production Source Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Recover and verify the cleanest editable source tree corresponding to Cloudflare Worker version \`529a96b3-f525-413f-90da-c32c20505baf\` without mutating production or the original checkout.

**Architecture:** Work only in the isolated clone at \`C:\Users\Aidan\Documents\Repos\orbit-sep18-recovery\`. Preserve immutable evidence under \`recovery/evidence\`, analyze the production bundle with deterministic scripts under \`recovery/tools\`, and keep source reconstruction, reports, and verification outputs separate. Exact source evidence takes precedence over branch-derived matches, and bundle reconstruction is used only after cleaner evidence is exhausted.

**Tech Stack:** PowerShell, Git, Node.js/TypeScript, pnpm, Wrangler read-only API commands, Cloudflare REST API where authenticated, React Router/Vite/Cloudflare Workers, Vitest, SHA-256 hashes, and local HTTP inspection.

**Spec:** \`docs/superpowers/specs/2026-09-19-orbit-source-recovery-design.md\`

## Global Constraints

- Never run \`wrangler deploy\`, any deployment script, traffic change, secret mutation, D1 write, migration apply, version deletion, or settings update.
- Never modify \`C:\Users\Aidan\Documents\Repos\client-growth\`; all edits occur in this recovery clone.
- Treat Worker version \`529a96b3-f525-413f-90da-c32c20505baf\` as authoritative runtime state.
- Preserve \`worker-live.mjs\`, \`version-529a96b3.json\`, and \`extracted/app.js\`; never overwrite an existing evidence file.
- Do not print, commit, or write API tokens, secret values, cookies, authenticated HTML, or private user data.
- Do not create production users, invoke paid production analysis, send email, or run production monitoring.
- Preserve the runtime facts \`compatibility_date=2026-08-31\`, \`nodejs_compat\`, \`AI_PROVIDER=deepseek\`, \`DEEPSEEK_MODEL=deepseek-flash\`, \`DEEPSEEK_VISION_MODEL=deepseek-flash\`, and \`BETTER_AUTH_URL=https://orbit.getaxiom.ca\` when reconstructing configuration.
- Do not upgrade dependencies; use the period-correct versions already present in recovered lockfiles or the closest dated source candidate.
- A file is not labeled original unless its content is recovered from source evidence; equivalent bundle behavior is labeled reconstruction.

## Review Focus

- Cloudflare source-map and multipart behavior: an unavailable default endpoint must not be treated as proof that no independent source-map or version-resource endpoint exists; Task 2 records every tested surface and response class.
- Public asset enumeration: only application-owned production assets and publicly referenced maps are fetched; Task 3 tests same-origin filtering and source-map references.
- Git object provenance: unreachable blobs may contain missing source but must not be altered or attached to refs until recorded; Task 4 records object IDs before extraction.
- Bundle boundary accuracy: repeated comments and emitted strings must not create false module regions; Task 5 validates boundary context and rejected candidates.
- Production equivalence versus source provenance: matching behavior without source evidence is not exact source; Tasks 6 and 7 pin confidence labels and evidence links.

### Task 1: Initialize and hash the recovery evidence vault

**Files:**
- Create: \`recovery/evidence/known/worker-live.mjs\`
- Create: \`recovery/evidence/known/version-529a96b3.json\`
- Create: \`recovery/evidence/known/extracted/app.js\`
- Create: \`recovery/reports/RECOVERY-EVIDENCE.md\`
- Create: \`recovery/tools/hash-evidence.ps1\`

**Interfaces:**
- Consumes: Known artifacts from \`C:\Users\Aidan\Documents\Repos\orbit-live-recovery\` and repository metadata from the isolated clone.
- Produces: Immutable evidence copies, SHA-256 manifest, deployment facts, and the recovery directory layout.

- [ ] **Step 1: Verify both checkout states**

    Run \`git -C 'C:\Users\Aidan\Documents\Repos\orbit-sep18-recovery' status --short --branch\` and \`git -C 'C:\Users\Aidan\Documents\Repos\client-growth' status --short --branch\`. Expected: recovery clone has only the committed design divergence and the original checkout is clean on \`main\`.

- [ ] **Step 2: Create evidence directories**

    Create \`recovery/evidence/known/extracted\`, \`cloudflare\`, \`live-assets\`, \`github\`, \`local-git\`, \`caches\`, \`database\`, \`recovery/bundle/comparisons\`, \`recovery/reports\`, and \`recovery/tools\` with \`New-Item -ItemType Directory -Force\`. Do not delete or replace existing files.

- [ ] **Step 3: Copy and verify the three known artifacts**

    Copy \`worker-live.mjs\`, \`version-529a96b3.json\`, and \`extracted/app.js\` from \`orbit-live-recovery\` into \`recovery/evidence/known\`. Compare source/destination byte lengths and stop for a hash comparison if any destination already exists.

- [ ] **Step 4: Add a deterministic hash script**

    Create \`recovery/tools/hash-evidence.ps1\` that accepts a root, recursively sorts files, and emits relative path, byte length, and lowercase SHA-256 JSON using \`Get-FileHash -Algorithm SHA256\`. It must not read outside the supplied root.

- [ ] **Step 5: Hash evidence and write the ledger**

    Run the hash script over \`recovery/evidence/known\`. Write \`RECOVERY-EVIDENCE.md\` with recovery start time, Worker/account/version/deployment facts, artifact sizes and hashes, original checkout SHA \`1d8e5d0e66ecaa5991b1182fc187738c6da69f1b\`, and a table reserved for each inspected source and result.

- [ ] **Step 6: Validate and checkpoint**

    Run \`git diff --check\`, verify only intended setup files are present, and commit the setup with \`git add recovery && git commit -m "chore: initialize Orbit recovery evidence vault"\`.

### Task 2: Perform Cloudflare read-only forensics

**Files:**
- Create: \`recovery/evidence/cloudflare/README.md\`
- Create: \`recovery/evidence/cloudflare/version.json\`
- Create: \`recovery/evidence/cloudflare/content/\`
- Create: \`recovery/evidence/cloudflare/responses/\`
- Create: \`recovery/evidence/cloudflare/source-maps/\`
- Create: \`recovery/tools/cloudflare-forensics.ps1\`
- Modify: \`recovery/reports/RECOVERY-EVIDENCE.md\`

**Interfaces:**
- Consumes: Account ID, Worker/version identifiers, existing Wrangler authentication, and current official Cloudflare API documentation.
- Produces: Redacted response metadata, endpoint inventory, source-map/resource findings, and a clear account of what Cloudflare exposed.

- [ ] **Step 1: Check Wrangler authentication safely**

    Run only non-secret metadata checks such as \`wrangler whoami\`. Record exit status, account identifiers, and login method; do not print environment variables, token files, headers, cookies, or request bodies containing secrets.

- [ ] **Step 2: Read official Cloudflare documentation**

    Use official Cloudflare documentation to identify version content, multipart, source-map, uploaded module, version-resource, deployment, asset-manifest, and preview-resource endpoints. Record URLs, parameters, read-only status, and documentation dates in \`cloudflare/README.md\`.

- [ ] **Step 3: Query version metadata/content safely**

    Use Wrangler or authenticated REST requests for account \`fe468a56a5b8c7f8fc5d39e265c2f791\`, Worker \`client-growth-production\`, and version \`529a96b3-f525-413f-90da-c32c20505baf\`. Save only redacted bodies and non-secret status/content metadata. Query the default multipart endpoint and record every returned part name and type.

- [ ] **Step 4: Test independent source-map/resource surfaces**

    Probe every documented read-only surface that can return source maps, uploaded source, resources, deployments, or preview metadata. For each, save endpoint, method, status, content type, length, and classification. Preserve returned maps unchanged under \`source-maps\` and hash them immediately.

- [ ] **Step 5: Inspect bundle and responses for hidden references**

    Search known artifacts and saved responses for \`sourceMappingURL\`, \`.map\`, upload identifiers, resource URLs, manifest names, deployment annotations, and source paths. Attempt each discovered map/resource reference independently and record both successes and safe negatives.

- [ ] **Step 6: Verify no mutation and commit**

    Review the command log for forbidden verbs/endpoints, append all results to \`RECOVERY-EVIDENCE.md\`, run \`git diff --check\`, and commit with \`git add recovery && git commit -m "docs: record Cloudflare production evidence"\`.

### Task 3: Recover public production assets and maps

**Files:**
- Create: \`recovery/evidence/live-assets/index.html\`
- Create: \`recovery/evidence/live-assets/manifest.json\`
- Create: \`recovery/evidence/live-assets/assets/\`
- Create: \`recovery/evidence/live-assets/maps/\`
- Create: \`recovery/tools/enumerate-live-assets.mjs\`
- Create: \`recovery/reports/LIVE-ASSET-INVENTORY.md\`
- Modify: \`recovery/reports/RECOVERY-EVIDENCE.md\`

**Interfaces:**
- Consumes: Public same-origin \`https://orbit.getaxiom.ca\` HTML and application-owned static references.
- Produces: Asset inventory, hashes, map results, route/build manifest findings, and extracted \`sourcesContent\` files when available.

- [ ] **Step 1: Fetch public HTML**

    Fetch the public homepage with redirects and a bounded timeout, without cookies or authorization headers. Save only public HTML and record final URL, status, content type, length, ETag/Last-Modified, and SHA-256.

- [ ] **Step 2: Enumerate and filter references**

    Parse scripts, stylesheets, preload links, manifests, favicon references, and inline \`sourceMappingURL\`. Accept only same-origin absolute/root-relative URLs with static extensions. Reject third-party, data, JavaScript, query-only, auth, and user-data routes.

- [ ] **Step 3: Download accepted assets exactly once**

    Resolve each URL and validate the destination remains within \`recovery/evidence/live-assets/assets\`. Save content, URL, status, type, bytes, hash, and discovery path. Stop on unexpected HTML or cross-origin redirects.

- [ ] **Step 4: Discover source maps/manifests**

    Search JS/CSS/JSON for \`sourceMappingURL\`, \`.map\`, route-manifest keys, build hashes, source paths, and \`sourcesContent\`. Fetch only same-origin maps and validate their JSON.

- [ ] **Step 5: Extract map source content**

    Write each map's \`sources\`/source-content mapping and hash to the inventory. Extract source content into \`maps/sources-content\` only when the map provides it; never overwrite source files in \`app/\` or \`src/\` at this stage.

- [ ] **Step 6: Inventory and checkpoint**

    Create \`LIVE-ASSET-INVENTORY.md\`, append the asset scope and result to \`RECOVERY-EVIDENCE.md\`, run \`git diff --check\`, and commit with \`git add recovery && git commit -m "docs: preserve public production asset evidence"\`.

### Task 4: Audit GitHub branches and local Git history

**Files:**
- Create: \`recovery/evidence/github/remote-branches.txt\`
- Create: \`recovery/evidence/github/branch-commits.txt\`
- Create: \`recovery/evidence/github/candidate-files.json\`
- Create: \`recovery/evidence/local-git/fsck.txt\`
- Create: \`recovery/evidence/local-git/reflog.txt\`
- Create: \`recovery/evidence/local-git/object-candidates.json\`
- Create: \`recovery/tools/git-forensics.ps1\`
- Modify: \`recovery/reports/RECOVERY-EVIDENCE.md\`

**Interfaces:**
- Consumes: All remote-tracking branches, reachable/unreachable objects, reflogs, stashes, worktrees, and bounded local caches.
- Produces: Branch/commit inventory, candidate source paths and blob IDs, dangling-object evidence, and immutable candidate copies.

- [ ] **Step 1: Record all refs without mutation**

    Save \`git branch -a --no-color\` and \`git for-each-ref --format='%(refname) %(objectname)' refs/remotes/origin\`. Verify the listed release-safety, UI, productization, monitoring, analyzability, and production-activation branches are represented.

- [ ] **Step 2: Search reachable commits and trees**

    Search \`git rev-list --all --objects\`, all branch tips, and \`git grep\` for every production-only filename/symbol from the recovery brief. Store branch, commit, path, blob ID, and match type in \`candidate-files.json\`; filename alone is not proof of identity.

- [ ] **Step 3: Run integrity/object scans**

    Run \`git fsck --full\`, \`git fsck --lost-found\`, \`git reflog --all\`, \`git stash list\`, and \`git worktree list --porcelain\` in the original checkout and recovery clone. Save outputs. Do not prune, repack, reset, checkout, or update refs.

- [ ] **Step 4: Search unreachable blobs**

    Inspect dangling blobs/trees read-only for distinctive production module paths, model names, visual-review strings, provider usage, lifecycle, and schema literals. Record object IDs before extracting any content.

- [ ] **Step 5: Inspect bounded local caches**

    Search only under \`C:\Users\Aidan\Documents\Repos\`, \`C:\Users\Aidan\.codex\`, relevant \`.claude\` directories, \`%TEMP%\`, and known worktree metadata. Exclude browser profiles, credential directories, and broad user data. Record matching paths and hashes without copying secrets.

- [ ] **Step 6: Extract candidates and checkpoint**

    Copy candidates under \`recovery/evidence/github/candidates/<commit-or-object>/<repo-relative-path>\` or \`local-git/candidates/<object>/<path>\`, preserving source IDs and refusing hash-mismatched overwrite. Update the evidence ledger, run \`git diff --check\`, and commit with \`git add recovery && git commit -m "docs: inventory Git and local recovery evidence"\`.

### Task 5: Build and validate the production bundle module index

**Files:**
- Create: \`recovery/tools/index-bundle.mjs\`
- Create: \`recovery/bundle/module-index.json\`
- Create: \`recovery/bundle/module-index.md\`
- Create: \`recovery/bundle/production-literals.json\`
- Modify: \`recovery/reports/RECOVERY-EVIDENCE.md\`

**Interfaces:**
- Consumes: \`recovery/evidence/known/extracted/app.js\` and any verified equivalent Cloudflare copy.
- Produces: Module regions with line ranges, paths, symbols, imports/references, SQL/config literals, boundary diagnostics, and input hash.

- [ ] **Step 1: Implement a line-preserving scanner**

    Read UTF-8 text, split into lines, recognize comments of the form \`// <project-owned path>\` and known bundler markers, retain byte/line offsets, and track string/template/comment state sufficiently to reject markers inside emitted string content.

- [ ] **Step 2: Extract symbols and meaningful literals**

    For each accepted region collect function/class/const/let/var declarations, export-like assignments, import paths, SQL statements, binding names, environment keys, model names, route strings, and source-map references. Store exact-text and normalized-whitespace hashes.

- [ ] **Step 3: Validate boundaries**

    Check non-empty ranges, monotonic line order, adjacent consistency, and a balanced emitted brace/paren/bracket diagnostic. Report warnings instead of rewriting code. Record rejected candidates and reasons.

- [ ] **Step 4: Generate stable JSON/Markdown**

    Write sorted \`module-index.json\` and readable \`module-index.md\` with input hash, parser version, generated time, region range, path, symbols, imports, literals, and diagnostics.

- [ ] **Step 5: Verify determinism and coverage**

    Run the indexer twice, compare output after removing only generated time, confirm each listed production-only path appears, and confirm helpers/source-map markers are not mislabeled as project modules.

- [ ] **Step 6: Commit the index**

    Run \`git diff --check\` and commit with \`git add recovery && git commit -m "chore: index production bundle modules"\`.

### Task 6: Select the closest source baseline and produce the recovery matrix

**Files:**
- Create: \`recovery/tools/compare-source-candidates.mjs\`
- Create: \`recovery/reports/RECOVERY-MATRIX.md\`
- Create: \`recovery/bundle/comparisons/candidate-scores.json\`
- Create: \`recovery/bundle/comparisons/module-candidates.json\`
- Modify: \`recovery/reports/RECOVERY-EVIDENCE.md\`

**Interfaces:**
- Consumes: Bundle index, Git/local candidate inventory, isolated source tree, and source-map content.
- Produces: Per-module candidate scores, selected baseline, exact/modified/missing state, confidence, and action required.

- [ ] **Step 1: Normalize source candidates**

    Compute path, module-path, exported-symbol, function/class-name, string-literal, SQL-identifier, import, and token-shingle features while preserving original bytes. Store normalized forms only in comparison JSON.

- [ ] **Step 2: Score overlap transparently**

    Rank exact source-map path/content matches first, then path, exported symbols, meaningful literals, SQL/schema identifiers, and normalized token overlap. A filename-only match cannot select a candidate.

- [ ] **Step 3: Generate the required matrix**

    Write columns \`Production module\`, \`Main state\`, \`Best branch/source\`, \`Confidence\`, and \`Action required\`, plus evidence IDs, scores, and unresolved reasons.

- [ ] **Step 4: Select baseline after all branches**

    Select the branch/commit with greatest meaningful overlap and verify configuration, migrations, routes, and package lock are internally consistent. Record why it beats other candidates. Do not change the working tree yet.

- [ ] **Step 5: Commit the baseline decision**

    Run \`git diff --check\` and commit with \`git add recovery && git commit -m "docs: identify closest production source baseline"\`.

### Task 7: Perform semantic comparison and recover production-only backend source

**Files:**
- Create: \`recovery/tools/semantic-module-diff.mjs\`
- Create: \`recovery/reports/RECOVERY-NOTES.md\`
- Create/Modify: production-only modules selected by the matrix, including visual capture/review, lifecycle, usage, synthesis, evidence ledger, and publication modules
- Create: \`recovery/bundle/comparisons/semantic-diff-*.json\`

**Interfaces:**
- Consumes: Selected baseline, bundle index, candidate evidence, and production symbol/literal inventory.
- Produces: Evidence-backed source changes, semantic diffs, notes, and per-file confidence updates.

- [ ] **Step 1: Generate semantic diff inputs**

    Compare source declarations/imports/exports, schema fields, route names, binding access, environment reads, SQL strings, and deterministic constants. Ignore emitted helper wrappers, variable renaming, and bundler shims.

- [ ] **Step 2: Restore exact source-map content**

    Where verified maps provide project-owned \`sourcesContent\`, compare path/hash/symbols and write the source to the corresponding editable path. Record \`EXACT SOURCE RECOVERED\` with map hash.

- [ ] **Step 3: Apply branch-derived candidates with evidence**

    Copy or merge only candidates with branch/commit/blob IDs and bundle-region evidence. Preserve candidate style/types and reject unrelated branch UI/config changes.

- [ ] **Step 4: Reconstruct absent modules in small units**

    Use the closest source skeleton and bundle region to restore imports, interfaces, functions, schemas, and literals. Mark only evidence-backed files high-confidence; mark inferred type boundaries medium-confidence or unresolved in \`RECOVERY-NOTES.md\`.

- [ ] **Step 5: Add deterministic tests for recovered logic**

    Adapt existing Vitest patterns for evidence ledgers, lifecycle transitions, provider-usage accounting, finding publication, visual-review normalization, and schema parsing. Fixtures must remain local and must not call production services.

- [ ] **Step 6: Typecheck each coherent slice**

    Run targeted tests and \`pnpm typecheck\` after each group. Fix only recovery integration errors; record pre-existing or uncertain mismatches instead of redesigning production logic.

- [ ] **Step 7: Commit coherent recovery slices**

    Use focused commits such as \`recovery: restore visual evidence modules\` and \`recovery: restore analysis lifecycle and usage accounting\`, keeping matrix and notes updated.

### Task 8: Recover migrations and production-equivalent configuration

**Files:**
- Create: \`recovery/evidence/database/README.md\`
- Create: \`recovery/evidence/database/production-migration-list.json\`
- Create: \`recovery/evidence/database/schema-readonly.json\`
- Create/Modify: \`migrations/*.sql\` only with source evidence
- Modify: \`wrangler.jsonc\`, \`package.json\`, \`pnpm-lock.yaml\`, \`react-router.config.ts\`, \`vite.config.ts\`, \`tsconfig.json\`, \`workers/app.ts\`, and environment declarations only with production evidence
- Create: \`recovery/reports/DATABASE-DIFFERENCES.md\`
- Create: \`recovery/reports/CONFIGURATION-DIFFERENCES.md\`

**Interfaces:**
- Consumes: Bundle SQL/schema strings, read-only D1 metadata if authenticated, candidate configs/lockfiles, and Worker metadata.
- Produces: Migration comparison, schema evidence, period-correct package/config, and explicit secret/binding handling.

- [ ] **Step 1: Extract schema signals**

    Search the bundle/index for \`CREATE TABLE\`, \`ALTER TABLE\`, \`CREATE INDEX\`, column names, migration IDs, screenshot, lifecycle, provider usage, and analysis-run strings. Map each signal to an existing or missing migration.

- [ ] **Step 2: Inspect D1 read-only**

    Use only list/schema/read queries. Record applied migrations and schema metadata without \`INSERT\`, \`UPDATE\`, \`DELETE\`, \`ALTER\`, \`PRAGMA writable_schema\`, or migration commands. If unavailable, record the safe failure and do not infer state.

- [ ] **Step 3: Compare migration trees**

    Produce migration name, repository presence, production evidence, branch/commit, and confidence. Recover missing SQL from Git objects or exact bundle strings only when complete and provenance-recorded.

- [ ] **Step 4: Reconcile runtime config**

    Compare candidate Wrangler/package/lockfile/Router/Vite/TypeScript/Worker/environment files. Preserve known bindings/vars and keep Better Auth, Resend, and DeepSeek secrets external with no values in source.

- [ ] **Step 5: Verify dependency era**

    Select versions from the nearest candidate lockfile or dated history; do not upgrade registry packages. Record lockfile hash and rationale.

- [ ] **Step 6: Commit configuration recovery**

    Run safe local static checks and commit with \`git add migrations wrangler.jsonc package.json pnpm-lock.yaml react-router.config.ts vite.config.ts tsconfig.json workers app src recovery && git commit -m "recovery: restore production database and runtime configuration"\`.

### Task 9: Recover client source and assets

**Files:**
- Create: \`recovery/tools/client-asset-analysis.mjs\`
- Create: \`recovery/evidence/live-assets/source-content/\`
- Create/Modify: \`app/\`, \`public/\`, and client-side config only with map/Git/asset evidence
- Create: \`recovery/reports/FRONTEND-RECOVERY.md\`

**Interfaces:**
- Consumes: Public JS/CSS/manifests/maps, exact source-map content, branch source, and public route tree.
- Produces: Client module inventory, source/style recovery, and public UI comparison.

- [ ] **Step 1: Classify client assets**

    Separate server-bundle modules from client chunks using content type, manifests, source maps, and component references. Do not call compiled code editable source when a map or Git source exists.

- [ ] **Step 2: Restore exact frontend sources**

    Extract map content, compare source paths/hash/candidates, and copy exact source only with evidence. Keep compiled-only modules labeled reconstruction candidates.

- [ ] **Step 3: Reconcile routes/resources**

    Compare production route names, route modules, CSS, icons, fonts, and public assets with recovered source. Record production-only and unresolved client modules.

- [ ] **Step 4: Check local public routes**

    Start only local/mock configuration. Check homepage, marketing/product pages, login/signup entries, legal pages, and safe unauthenticated routes for status, title, key text, and asset references without paid calls.

- [ ] **Step 5: Commit frontend recovery**

    Run relevant public-route tests and commit with \`git add app public recovery && git commit -m "recovery: restore production client sources and assets"\`.

### Task 10: Build, test, and compare the reconstructed Worker

**Files:**
- Create: \`recovery/reports/BUILD-VERIFICATION.md\`
- Create: \`recovery/reports/BUILD-COMPARISON.md\`
- Create: \`recovery/tools/compare-build.mjs\`
- Create: \`recovery/bundle/comparisons/reconstructed-build/\`
- Modify: matrix/notes reports

**Interfaces:**
- Consumes: Reconstructed source, pinned lockfile, authoritative bundle, module index, and prior reports.
- Produces: Test/typecheck/build results, normalized build comparison, confidence updates, and discrepancy list.

- [ ] **Step 1: Install pinned dependencies**

    Run \`corepack pnpm --version\` and \`pnpm install --frozen-lockfile\`. If an optional platform package fails, record the exact error and use only a lockfile-compatible local workaround; do not change versions.

- [ ] **Step 2: Run safe tests**

    Run \`pnpm verify:repo\` and \`pnpm test\`. Do not run a command that invokes production preflight or remote resources; record any intentionally skipped production-contacting check.

- [ ] **Step 3: Typecheck and build**

    Run \`pnpm typecheck\` and \`pnpm build\`. Save commands, exit codes, elapsed times, and bounded outputs in \`BUILD-VERIFICATION.md\` without environment dumps.

- [ ] **Step 4: Compare build to authoritative bundle**

    Compare input/build hashes, source paths, symbols, handler shape, literals, feature flags, SQL/schema strings, routes, binding accesses, and normalized project-owned function bodies. Do not claim byte equality where metadata/dependency ordering differs.

- [ ] **Step 5: Update confidence from discrepancies**

    Classify differences as transpilation noise, build metadata, formatting, meaningful behavior, or unresolved. Update matrix/notes; a successful build never upgrades source provenance to exact.

- [ ] **Step 6: Commit verification**

    Run \`git diff --check\` and commit with \`git add recovery && git commit -m "test: verify reconstructed Orbit build"\`.

### Task 11: Compare safe local behavior with production

**Files:**
- Create: \`recovery/tools/public-route-check.mjs\`
- Create: \`recovery/reports/LIVE-BEHAVIOR-COMPARISON.md\`
- Create: \`recovery/evidence/live-behavior/\`

**Interfaces:**
- Consumes: Local reconstructed Worker and public production endpoints.
- Produces: Status/title/content/asset-reference comparison for safe unauthenticated routes.

- [ ] **Step 1: Start local safe app**

    Confirm local config does not load production secrets or production D1 IDs. Start the local app, capture process/port, and never use remote/deployment flags.

- [ ] **Step 2: Probe fixed GET-only route set**

    Check \`/\`, \`/product\`, \`/privacy\`, \`/terms\`, \`/login\`, \`/signup\`, and \`/forgot-password\` locally and publicly. Record status, content type, title, canonical origin, links, and app-owned asset references. Do not submit forms or follow sign-in flows.

- [ ] **Step 3: Compare normalized responses**

    Normalize timestamps, build hashes, nonce-like values, absolute origin, and minified whitespace. Compare availability, status, title, headings, links, CSS/JS references, and error behavior; differences are not source proof.

- [ ] **Step 4: Stop local app and write report**

    Save only public metadata/sanitized excerpts, route table, differences, and safety statement. Stop the local process.

- [ ] **Step 5: Commit behavior comparison**

    Run \`git diff --check\` and commit with \`git add recovery && git commit -m "docs: compare recovered public behavior"\`.

### Task 12: Create recovery branch and final report

**Files:**
- Create: \`recovery/reports/FINAL-RECOVERY-REPORT.md\`
- Modify: all recovery reports as needed
- Git ref: \`recovery/orbit-production-2026-09-18\`

**Interfaces:**
- Consumes: All evidence, source, comparisons, verification, and branch history from Tasks 1-11.
- Produces: Final provenance-aware verdict, committed recovery branch, and push status without deployment.

- [ ] **Step 1: Reconcile file counts and labels**

    Count exact, high-confidence, medium-confidence, and unresolved project-owned files from the matrix. Ensure every bundle module has a matrix row and every reconstructed file has an evidence note.

- [ ] **Step 2: Write final report with exact requested headings**

    Include \`# RECOVERY VERDICT\`, \`# AUTHORITATIVE PRODUCTION\`, \`# SOURCES OF EVIDENCE\`, \`# CLOUDFLARE RECOVERY\`, \`# GIT/GITHUB RECOVERY\`, \`# FILE RECOVERY SUMMARY\`, \`# PRODUCTION-ONLY FEATURES FOUND\`, \`# CONFIGURATION DIFFERENCES\`, \`# DATABASE DIFFERENCES\`, \`# BUILD VERIFICATION\`, \`# PRODUCTION COMPARISON\`, \`# UNCERTAINTIES\`, \`# RECOVERY BRANCH\`, \`# WHAT MUST NOT HAPPEN YET\`, and \`# NEXT SINGLE PRIORITY\`. Use only the four allowed verdict values.

- [ ] **Step 3: Create requested branch after source is ready**

    Run \`git status --short\`, \`git diff --check\`, then \`git switch -c recovery/orbit-production-2026-09-18\`. Create it only in the isolated clone after reports/source are ready.

- [ ] **Step 4: Run final verification**

    On the recovery branch run \`pnpm test\`, \`pnpm typecheck\`, \`pnpm build\`, \`git diff --check\`, and \`git status --short --branch\`. Never run a deploy script.

- [ ] **Step 5: Commit the complete recovered tree**

    Commit with \`recovery: reconstruct Orbit production source for 2026-09-18\`, including evidence/report paths in the body. Verify no secrets or unrelated generated files are included.

- [ ] **Step 6: Prove original main is untouched**

    Confirm the recovery branch exists in the isolated clone and the original checkout remains at \`1d8e5d0e66ecaa5991b1182fc187738c6da69f1b\` and clean.

- [ ] **Step 7: Push only the recovery branch if authentication is already available**

    Verify the remote is GitHub \`Mageester/client-growth\`, current branch is exactly the recovery branch, and no command can target \`main\`. Push only the named branch when already authenticated; otherwise record that push was not attempted. Never force-push or embed credentials.

- [ ] **Step 8: Deliver final report**

    Return the exact requested headings, evidence-backed results, branch/commit/push status, local report links, deployment safety statement, and one next priority only.

## Completion Gate

Before claiming completion, confirm:

- Original \`client-growth\` is clean and unchanged.
- No Cloudflare mutation command ran.
- Known/new evidence has SHA-256 records.
- Cloudflare, assets, GitHub branches, local Git objects, bounded caches, and read-only D1 metadata were attempted and logged.
- Module index and recovery matrix cover every production-owned module.
- Reconstructed source has per-file provenance/confidence.
- Tests, typecheck, build, and safe public-route results are recorded.
- Recovery branch/commit/push status is accurate.
- Final verdict never calls equivalent reconstruction original source.

