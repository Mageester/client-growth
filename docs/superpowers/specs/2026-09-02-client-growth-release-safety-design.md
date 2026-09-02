# Client Growth Release Safety Design

## Goal

Make pull requests and local pre-deployment verification reliably exercise the
existing correctness, security, schema, and production-configuration checks
without contacting Cloudflare, sending email, using paid AI, or changing
application behavior.

## Scope and boundaries

- Standardize the repository and CI tooling on Node 24 and the pinned
  `pnpm@10.12.1` package manager.
- Add one deterministic repository-safety check for committed sensitive files,
  high-confidence credential signatures, and local diff whitespace hygiene.
- Keep test fixtures and documented placeholders allowed only through explicit,
  narrow exceptions; never scan ignored local developer files.
- Reject secret-like keys under Wrangler plaintext `vars`; production secrets
  remain names declared under the existing secret-binding metadata.
- Strengthen the existing fresh migration test with an explicit migration
  ledger, foreign-key integrity check, and final demo-fixture absence checks.
- Add `pnpm verify` as the local gate for repository safety, structural
  production preflight, the complete offline test suite, typecheck, and build.
- Add a GitHub Actions workflow for pull requests and pushes to `main` with
  frozen-lockfile installation, caching, minimal permissions, cancellation, and
  clear verification steps.

The workflow and local gate do not run live provider tests, remote D1 commands,
deployment, email delivery, or paid AI evaluation. Those remain explicit
operator actions.

## Components

1. `scripts/repo-safety.ts` lists tracked files with Git, checks forbidden
   sensitive filenames, scans text files for high-confidence credential
   signatures without printing matched values, and runs `git diff --check`.
2. `scripts/production-preflight.ts` continues to validate only committed,
   structural Wrangler configuration and additionally rejects secret-like
   plaintext variable names at both root and production scopes.
3. Existing Vitest coverage remains the source of truth for application,
   tenancy, network, auth/reset, waitUntil, schema, and migration behavior.
   The migration test adds explicit ledger and integrity assertions rather than
   duplicating a second migration runner.
4. `pnpm verify` composes the local checks. CI runs the same checks as named
   steps after a clean frozen-lockfile install and adds PR/push patch hygiene.

## Node baseline

Node is standardized as `24.x` in `package.json`, `.node-version` contains
`24`, and Actions uses `node-version: 24`. This is required because the test
SQLite adapter uses `node:sqlite` behavior that is not available in the old
Node 20 baseline.

## Failure behavior

- Any repository safety finding exits non-zero and reports only the file path,
  line number, or rule name; credential values are never printed.
- Any plaintext secret-like Wrangler variable fails production preflight with a
  remediation pointing to secret bindings.
- Any unexpected, missing, or reordered migration filename fails the migration
  test until the migration set is deliberately updated.
- Any foreign-key violation or residual demo fixture fails the migration test.
- Any failed local gate stops subsequent commands through the existing shell
  fail-fast composition.
