# Client Growth Production Deployment Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first Client Growth Cloudflare deployment repeatable and safe to execute immediately after the separate crawler/network-hardening branch is integrated.

**Architecture:** Keep the existing React Router Worker, static Assets binding, and single shared D1 database with repository-enforced workspace isolation. Add an explicit `production` Wrangler environment with a production-only D1 binding, non-secret runtime variables, declared required secrets, and a local structural preflight that rejects placeholder resources and origins. Keep demo fixtures local-only by removing the historical migration-created demo workspace in a follow-on migration and documenting that production receives migrations but never `scripts/seed.sql`.

**Tech Stack:** Cloudflare Workers, Wrangler 4, D1, React Router 7, Better Auth 1.7.2, Resend REST API, TypeScript, Vitest, pnpm, PowerShell-friendly CLI commands.

**Spec:** User-provided Client Growth first-production-deployment brief in the active task.

## Global Constraints

- Do not modify crawler, evidence, network, or network-hardening code.
- Do not deploy a Worker, create paid resources, change DNS, configure real secrets, send real email, or merge the hardening branch during preparation.
- Keep `BETTER_AUTH_SECRET` and `RESEND_API_KEY` encrypted Cloudflare secrets; keep `BETTER_AUTH_URL`, `RESEND_FROM_EMAIL`, AI selection, endpoints, and limits as non-secret configuration.
- Production D1 must use a distinct database name and binding from local development, and production setup must never execute `scripts/seed.sql`.
- Preserve migration history; do not rewrite already committed migrations or the generated Better Auth migration.
- Verify the existing test, typecheck, and build commands and report deterministic local evidence separately from live-provider and deployment evidence.

---

### Task 1: Add the explicit production Worker environment and guarded preflight

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `scripts/production-preflight.ts`

**Interfaces:**
- Consumes: the committed JSONC Wrangler configuration and the `production` environment values.
- Produces: `pnpm production:preflight` and `pnpm deploy:production`, where the latter runs structural checks, typecheck, build, and a non-auto-provisioning `wrangler deploy --env production` only when a human invokes it.

- [x] **Step 1: Define the production config contract**

Add a named `production` environment with Worker name `client-growth-production`, D1 binding `DB`, D1 database name `client-growth-production`, migration directory `migrations`, explicit non-secret variables for the public HTTPS Better Auth origin, verified Resend sender, mock-by-default AI provider, DeepSeek defaults, and the existing AI call cap. Declare `BETTER_AUTH_SECRET` and `RESEND_API_KEY` as required production secrets. Keep invocation logs disabled and retain the existing Assets binding/runtime settings.

- [x] **Step 2: Implement the structural preflight**

Read and parse `wrangler.jsonc` without contacting Cloudflare. Require the production environment, exact production database name/binding, a real UUID-shaped D1 ID, an HTTPS origin that is not a localhost/example/placeholder host, a non-placeholder Resend sender, the required auth/email secret names, `nodejs_compat`, and the no-invocation-logs setting. If `AI_PROVIDER` is `deepseek`, also require `DEEPSEEK_API_KEY` in the declared secrets and validate the configured DeepSeek URL/model. Never print secret values.

- [x] **Step 3: Add guarded package commands**

Add `production:preflight`, `db:migrations:production`, `db:migrate:production`, and `deploy:production` scripts. Production database commands must hard-code `client-growth-production`, select `--env production --remote`, and deployment must pass `--experimental-provision=false --experimental-auto-create=false` so missing resources fail rather than being created implicitly.

- [x] **Step 4: Run focused config checks**

Run `pnpm production:preflight` and `pnpm exec wrangler deploy --dry-run --env production` before replacing placeholders. The preflight must fail with actionable missing-setup output; the dry-run may also fail on the intentionally absent D1/secrets and must not upload or create anything.

### Task 2: Ensure migrations leave a clean production baseline

**Files:**
- Create: `migrations/0006_remove_demo_fixture.sql`
- Create: `test/production.migrations.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: migrations `0001_init.sql` through `0005_multitenant.sql` and local `scripts/seed.sql`.
- Produces: a fresh database with the complete schema and zero demo user/workspace rows after migrations; local demo data remains available only after the explicit local seed command.

- [x] **Step 1: Write the migration safety test**

Apply every migration to an in-memory SQLite database and assert that required tables exist and both `user_demo` and `ws_demo` counts are zero after the full migration sequence. Also assert that the existing seed file remains explicitly scoped to `ws_demo`.

- [x] **Step 2: Add the cleanup migration**

Add a small ordered migration that deletes the historical `ws_demo` workspace and `user_demo` user after tenant tables exist. Rely on the existing `ON DELETE CASCADE` relationships for tenant rows and keep the local seed’s re-creation of demo data unchanged.

- [x] **Step 3: Update operator-facing local/production guidance**

Update the README migration count and link to the production runbook. State that production applies migrations only, never the demo seed, and that onboarding creates the first real workspace, services, client, and analysis data.

- [x] **Step 4: Run the focused migration test**

Run `pnpm test -- test/production.migrations.test.ts` and confirm the test proves the production baseline is empty without altering any crawler/evidence/network file.

### Task 3: Write the production setup, deployment, and smoke-test runbook

**Files:**
- Create: `docs/production-deployment.md`

**Interfaces:**
- Consumes: the production Wrangler config, migration directory, auth/Resend behavior, and current route surface.
- Produces: exact manual instructions for Cloudflare/D1/Resend setup, a safe deployment sequence, secret/config inventory, privacy/logging review, and a concrete live smoke checklist.

- [x] **Step 1: Document architecture and inventory**

Document Worker name/environment, inherited Assets/runtime settings, production D1 identity, migration directory, required binding `DB`, and the separation between encrypted secrets and plaintext non-secret configuration. Explain that DeepSeek is conditional: mock mode is the no-cost baseline; real production AI requires `AI_PROVIDER=deepseek` plus `DEEPSEEK_API_KEY`.

- [x] **Step 2: Document manual resource setup**

Give the exact `wrangler d1 create client-growth-production --location=enam` flow, the single replacement of the returned UUID in `wrangler.jsonc`, secret commands with `--env production`, and the requirement to choose/configure the final public HTTPS origin before deployment. Explicitly stop short of executing any of these operations in this task.

- [x] **Step 3: Document D1 migration and verification order**

Require preflight, migration listing, remote migration apply, schema/migration-table verification, demo-row absence verification, and only then Worker deployment. Explicitly prohibit `scripts/seed.sql` and any fixture import against production.

- [x] **Step 4: Document Resend setup**

Describe account creation, sending-domain verification (DNS records), verified sender, API key creation and storage, `RESEND_FROM_EMAIL`, and the real-email smoke. Do not ask for or include an API key.

- [x] **Step 5: Document the complete live smoke**

Cover signup, workspace/onboarding, login/logout, forgot password, delivery, one-use reset, old-session revocation, client creation, real public-site analysis, opportunity behavior, second-account tenant isolation, and the crawler/network security checks to rerun after hardening integration. Mark live D1/Worker/Resend/network evidence separately from local tests.

- [x] **Step 6: Document logging/privacy boundaries and blockers**

Record that automatic invocation logs remain disabled because Cloudflare invocation messages include request URLs, and that the code must not add token/API-key/provider-body logging. State remaining blockers: hardening integration, real production D1 ID, public HTTPS origin/DNS decision, verified Resend domain/API key, and optional DeepSeek choice.

### Task 4: Verify the complete local baseline and hand off

**Files:**
- No additional files beyond Tasks 1–3.

**Interfaces:**
- Consumes: all changes from Tasks 1–3.
- Produces: deterministic local verification results, a clean scoped commit, and the commit SHA for the production-preparation slice.

- [x] **Step 1: Run the required commands**

Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm production:preflight`, `pnpm exec wrangler deploy --dry-run --env production`, and `git diff --check`. Record a timeout as inconclusive rather than passing.

- [x] **Step 2: Review scope and secrets**

Run `git status --short`, `git diff --stat`, and a repository search for secret-like values. Confirm no `.dev.vars` content, API key, password, D1 UUID, or real sender/domain was added, and confirm no crawler/evidence/network path changed.

- [x] **Step 3: Commit only the coherent preparation slice**

Stage the production config, preflight, migration safety, runbook, README, package scripts, and tests. Commit them together with a message such as `chore: prepare Cloudflare production deployment`, then report the SHA and the separate hardening/deployment blockers.
