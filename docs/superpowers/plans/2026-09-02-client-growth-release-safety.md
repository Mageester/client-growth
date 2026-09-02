# Client Growth Release Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pull requests and local pre-deployment verification reliably exercise Client Growth's existing correctness, security, schema, and production-configuration checks without contacting production systems.

**Architecture:** Keep application behavior unchanged. Add a pure, deterministic repository scanner; strengthen the existing structural preflight and migration test; compose those checks with the current offline Vitest, typecheck, and build commands; then run the same named checks in a minimal GitHub Actions workflow.

**Tech Stack:** Node 24, pnpm 10.12.1, TypeScript/tsx, Vitest, React Router build, Wrangler JSONC, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-02-client-growth-release-safety-design.md`

## Global Constraints

- Do not modify opportunity rules, evaluator behavior, crawler implementation, onboarding, proposal generation, UI/design, production D1, Cloudflare resources, DNS, Resend, or product features.
- Preserve the other agent's dirty `package.json`, `scripts/bench.ts`, and `test/bench/` changes in the original checkout; this branch must report the package-script overlap for integration.
- `pnpm verify` must be local and deterministic: no Cloudflare, remote D1, production secrets, deployment, email, network crawling, or paid AI calls.
- Scan tracked Git files only; do not scan ignored `.dev.vars` or local `.env` files.
- Never print detected credential values.
- Node standard is `24.x`; pnpm remains `10.12.1` from `package.json`.

### Task 1: Add migration integrity and ledger assertions

**Files:**
- Modify: `test/production.migrations.test.ts`

**Interfaces:**
- Consumes: existing `nodeSqliteDb` migration runner.
- Produces: a fresh-database test that applies the exact expected migration set in order, checks foreign-key integrity, checks demo-fixture absence, and fails on migration-set drift.

- [x] **Step 1: Add the expected migration ledger and integrity assertions.**

  Define the exact seven filenames, assert the sorted directory list equals that constant, enable `PRAGMA foreign_keys = ON` before applying them, run `PRAGMA foreign_key_check` after the complete chain, and assert zero `ws_demo`/`user_demo` rows in all relevant final tables.

- [x] **Step 2: Run the migration test.**

  Run `pnpm test -- test/production.migrations.test.ts`.

  Expected: PASS; the current migration chain already satisfies the strengthened assertions.

### Task 2: Add plaintext-secret preflight coverage

**Files:**
- Modify: `test/production.preflight.test.ts`
- Modify: `scripts/production-preflight.ts`

**Interfaces:**
- Consumes: existing `validateProductionConfig(config: unknown): string[]`.
- Produces: rejection of secret-like variable names in root or production `vars` while preserving the existing secret declaration model.

- [x] **Step 1: Write the failing preflight test.**

  Clone the committed JSONC config in the test, add `RESEND_API_KEY` to production `vars`, and assert the returned errors identify plaintext secret-like variables.

- [x] **Step 2: Run the focused test to verify RED.**

  Run `pnpm test -- test/production.preflight.test.ts`.

  Expected: FAIL because the current validator accepts `RESEND_API_KEY` under `vars`.

- [x] **Step 3: Implement the smallest validator change.**

  Add a secret-like variable-name predicate for keys ending in `KEY`, `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `CREDENTIALS`, or `PRIVATE_KEY`; apply it to root and production `vars`; report the scope and key name without values.

- [x] **Step 4: Run the focused test to verify GREEN.**

  Run `pnpm test -- test/production.preflight.test.ts`.

  Expected: PASS with both existing structural tests and the new plaintext-secret test.

### Task 3: Add deterministic repository safety scanner

**Files:**
- Create: `scripts/repo-safety.ts`
- Create: `test/repo.safety.test.ts`

**Interfaces:**
- Consumes: tracked file paths/content supplied by Git and pure scanner inputs.
- Produces: `findSensitivePaths(paths: readonly string[]): string[]`, `findSecretFindings(files: readonly RepoFile[]): SecretFinding[]`, and `validateRepositoryFiles(files: readonly RepoFile[]): string[]` for deterministic tests and the CLI entrypoint.

- [x] **Step 1: Write focused failing scanner tests.**

  Cover forbidden `.env`/`.dev.vars`/credentials/private-key filenames, allow `.example` files, detect real-looking `re_` and `sk-` values plus PEM private-key markers, and allow only exact known fake fixture literals such as `sk-test` and `test-resend-key`.

- [x] **Step 2: Run the new test to verify RED.**

  Run `pnpm test -- test/repo.safety.test.ts`.

  Expected: FAIL because `scripts/repo-safety.ts` does not exist yet.

- [x] **Step 3: Implement the scanner and CLI.**

  Use `git ls-files -z` so ignored local files are excluded. Normalize path separators, reject only high-signal sensitive filenames except explicit `.example` names, skip binary contents, scan high-confidence credential signatures, remove exact allowlisted fixture literals before scanning, and run both unstaged and staged `git diff --check`. Exit non-zero with paths/rules/line numbers but no matched values.

- [x] **Step 4: Run the focused scanner test.**

  Run `pnpm test -- test/repo.safety.test.ts`.

  Expected: PASS.

### Task 4: Add Node 24 and local verify command

**Files:**
- Modify: `package.json`
- Create: `.node-version`

**Interfaces:**
- Consumes: `scripts/repo-safety.ts`, `scripts/production-preflight.ts`, and existing `test`, `typecheck`, and `build` scripts.
- Produces: `pnpm verify:repo` and `pnpm verify`; the package declares `engines.node` as exactly `24.x`.

- [x] **Step 1: Update package metadata and scripts without removing other scripts.**

  Change `engines.node` to `24.x`; add `verify:repo` for the scanner and `verify` for fail-fast composition: repository safety, structural preflight, tests, typecheck, then build. Keep the existing deployment scripts unchanged.

- [x] **Step 2: Add `.node-version`.**

  Write `24` as the local runtime baseline.

- [x] **Step 3: Verify package metadata and lockfile compatibility.**

  Run `pnpm install --frozen-lockfile` and `pnpm verify:repo`.

  Expected: PASS without lockfile changes or secret values printed.

### Task 5: Add GitHub Actions pre-merge workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: package scripts and `.node-version`/Node 24 baseline.
- Produces: PR and `main` push verification with frozen-lockfile install, pnpm caching, patch whitespace checks, repository safety, production preflight, tests, typecheck, and build.

- [x] **Step 1: Write the workflow.**

  Use `actions/checkout@v4`, `pnpm/action-setup@v4`, and `actions/setup-node@v4`; configure Node 24, pnpm cache, `permissions: contents: read`, cancellation by PR/ref, a 15-minute job timeout, and separate named steps. Use full history only as needed for PR/push `git diff --check` ranges.

- [x] **Step 2: Validate workflow structure locally.**

  Run `git diff --check`, inspect the workflow trigger/job/step structure, and use an installed YAML/action linter if available without adding a dependency.

  Expected: no whitespace errors and no unvalidated YAML syntax issues.

### Task 6: Run the complete local release gate and review the patch

**Files:**
- Review: all files above

- [x] **Step 1: Run the unified gate.**

  Run `pnpm verify` in the isolated worktree.

  Expected: repository safety, structural preflight, all offline tests, typecheck, and production build pass; no remote calls occur.

- [x] **Step 2: Inspect the final diff and status.**

  Run `git diff --check`, `git status --short --branch`, and `git diff --stat`.

  Expected: only the safety-system files and plan/spec docs are changed on this branch; the original checkout's parallel files remain untouched.

- [x] **Step 3: Commit the coherent isolated slice.**

  Stage only the safety-system files, plan/spec docs, and `.node-version`; commit with `chore: add release safety gates`.
