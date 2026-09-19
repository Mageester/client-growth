# Axiom Orbit Production Source Recovery Design

**Date:** 2026-09-19  
**Authoritative runtime:** Cloudflare Worker `client-growth-production`, version `529a96b3-f525-413f-90da-c32c20505baf`  
**Recovery target:** The cleanest editable TypeScript/TSX/configuration source tree corresponding to the 2026-09-18 production deployment

## Purpose

Recover the most faithful editable source representation of the deployed Axiom Orbit application without changing production, overwriting GitHub `main`, or treating a behaviorally equivalent reconstruction as the original source. The recovery must preserve evidence provenance and distinguish exact source recovery from high- and medium-confidence reconstruction.

## Constraints and safety invariants

- The original checkout at `C:\Users\Aidan\Documents\Repos\client-growth` remains untouched and non-destructive.
- All work occurs in `C:\Users\Aidan\Documents\Repos\orbit-sep18-recovery`.
- Cloudflare operations are read-only: no deploy, traffic change, secret mutation, D1 write, migration apply, version deletion, or settings update.
- No production users, paid analyses, email, monitoring, or authenticated private data are accessed.
- Production version `529a96b3-f525-413f-90da-c32c20505baf` is the runtime authority; current GitHub `main` is only one source candidate.
- Secrets and access tokens are never written to reports, source files, command output, or commits.
- Evidence files are preserved and hashed before processing. Existing recovery artifacts are copied, never overwritten.
- Any recovery branch is created only in the isolated clone and is never merged into `main` automatically.

## Evidence authority order

Evidence is evaluated in this order, with lower-ranked evidence used to fill gaps rather than override stronger evidence:

1. Original source or source maps retrieved from Cloudflare or the deployed asset set.
2. Exact source found in GitHub branches, commits, Git objects, worktrees, stashes, or local caches.
3. Source that matches the production bundle's module boundaries and semantics from a dated branch or commit.
4. Source reconstructed from the readable production bundle using existing project types and neighboring source.
5. Independent behavioral inference from public production routes.

Every recovered file records its evidence source, commit or artifact identifier where available, and confidence category.

## Workspaces and artifacts

The recovery clone is the project root. Evidence and generated reports are kept separate from editable source:

```text
orbit-sep18-recovery/
  app/, src/, workers/, migrations/, public/, test/, ...  # isolated source tree
  recovery/
    evidence/
      cloudflare/
      live-assets/
      github/
      local-git/
      caches/
      database/
    bundle/
      app.js
      module-index.json
      module-index.md
      comparisons/
    reports/
      RECOVERY-EVIDENCE.md
      RECOVERY-MATRIX.md
      RECOVERY-NOTES.md
      BUILD-COMPARISON.md
      LIVE-BEHAVIOR-COMPARISON.md
  docs/superpowers/
    specs/2026-09-19-orbit-source-recovery-design.md
    plans/2026-09-19-orbit-source-recovery.md
```

The known artifacts are copied into `recovery/evidence/known/`:

- `worker-live.mjs`
- `version-529a96b3.json`
- `extracted/app.js`

`RECOVERY-EVIDENCE.md` records SHA-256 hashes, version/deployment metadata, recovery start time, all inspected locations, API results, and negative findings such as unavailable source maps.

## Recovery stages

### Stage A: Evidence acquisition

Create and hash the evidence vault. Query Cloudflare's version, script content, multipart, source-map, version-resource, deployment, asset, and metadata surfaces using the existing authenticated Wrangler/API context if available. Inspect public HTML and application-owned static assets from `https://orbit.getaxiom.ca`, following only application-owned references and fetching referenced source maps when public. Enumerate every reachable GitHub branch and commit, search local Git objects and reflogs, and inspect narrowly targeted editor/agent/worktree caches for the distinctive production module paths.

This stage must produce a complete evidence inventory before reconstruction begins. Failed or unavailable avenues are recorded with the exact command or endpoint and a safe result summary, without exposing credentials.

### Stage B: Bundle indexing and source comparison

Parse the readable `app.js` by its original module-boundary comments. A boundary is accepted only after checking that the region has balanced syntax at the bundle's emitted level and that repeated comments or nested comments do not create false regions. For each region, record line range, original path, exported or top-level symbols, SQL/config literals, and references to neighboring modules.

For each project-owned module, compare the bundle-derived inventory to every candidate source file. The comparison records whether the file is exact, modified, absent, or only represented by emitted code. Transpiler helpers and bundler boilerplate are ignored; meaningful logic, schemas, routes, binding access, model names, flags, and database calls are retained.

### Stage C: Reconstruction

Select the closest clean baseline by measured overlap, not branch name. Apply production-only changes in the isolated clone. When a source file exists in a candidate branch, preserve its style and types and make only evidence-backed changes. When it is absent, reconstruct a small TypeScript/TSX module from the bundle and surrounding interfaces; uncertain choices are marked in `RECOVERY-NOTES.md` and never described as original.

Recover configuration and migrations separately from application modules. Preserve the production runtime facts: compatibility date `2026-08-31`, `nodejs_compat`, the known Worker/DB/assets bindings, `AI_PROVIDER=deepseek`, `DEEPSEEK_MODEL=deepseek-flash`, `DEEPSEEK_VISION_MODEL=deepseek-flash`, and `BETTER_AUTH_URL=https://orbit.getaxiom.ca`, while keeping secrets external.

### Stage D: Verification and comparison

Install only the historically appropriate pinned dependencies in the isolated clone. Run the repository's tests, typecheck, build, and repository safety checks. Compare the reconstructed Worker output to the authoritative bundle using module paths, symbols, literals, feature flags, SQL/schema strings, route names, binding accesses, and normalized function bodies where practical. Run the local app only and compare harmless public/unauthenticated behavior with production. Do not invoke paid or state-changing paths.

The result is classified per module as:

- `EXACT SOURCE RECOVERED`
- `HIGH-CONFIDENCE RECONSTRUCTION`
- `MEDIUM-CONFIDENCE RECONSTRUCTION`
- `UNRESOLVED`

The final verdict is based on the distribution and significance of those module-level results, not on an invented single percentage.

## Deliverables

- `recovery/reports/RECOVERY-EVIDENCE.md`
- `recovery/reports/RECOVERY-MATRIX.md`
- `recovery/reports/RECOVERY-NOTES.md`
- `recovery/bundle/module-index.json`
- `recovery/bundle/module-index.md`
- `recovery/reports/BUILD-COMPARISON.md`
- `recovery/reports/LIVE-BEHAVIOR-COMPARISON.md`
- An isolated recovery branch named `recovery/orbit-production-2026-09-18`
- A final report using the requested `# RECOVERY VERDICT` structure, including exact hashes, source evidence, Cloudflare/Git recovery, file counts, production-only features, configuration/database differences, build results, uncertainties, branch/commit/push status, deployment safety, and one next priority

## Success criteria

The operation is successful when the evidence vault is hash-verified, all reasonable read-only recovery avenues have been attempted and logged, the module index and recovery matrix cover every project-owned module represented in the production bundle, the isolated source tree builds and passes applicable checks, and each reconstructed file's provenance is honestly labeled. The original checkout and live Worker remain unchanged throughout.

## Non-goals

- Deploying or previewing the recovered source against Cloudflare production.
- Applying migrations or changing production data.
- Refactoring, modernizing, or fixing production behavior unrelated to recovery fidelity.
- Claiming original source when only equivalent emitted behavior is proven.
