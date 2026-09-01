# Client Growth (working name)

Multi-tenant SaaS for small web/digital agencies. It answers one question:

> **What legitimate, valuable, billable work could this agency offer this existing client right now?**

Not an auditor, not lead-gen, not a CRM, not an SEO dashboard, not a chatbot.

## Architecture

Three layers, kept deliberately separate:

- **`src/` — the portable domain engine.** Pure TypeScript: schemas, deterministic
  rules, billability, the analysis pipeline, ports, adapters, and the D1
  repositories. No Cloudflare, no React. Fully testable with fixtures at $0.
- **`src/db/` — the tenant boundary.** Every tenant repo takes a `TenantScope`
  (`{ db, workspaceId }`); every read filters by `workspace_id`, every write
  sets it, and cross-workspace writes are rejected at the repo layer AND by
  composite foreign keys (`client_coverage`, `evidence_bundles`, `opportunities`
  reference `clients(workspace_id, id)` / `services(workspace_id, id)`).
- **`app/` + `workers/` — the Cloudflare edge.** React Router v7 on a Worker,
  D1 for persistence, [Better Auth](https://better-auth.com) (email + password,
  native D1, DB-backed sessions and rate limiting). Every protected loader/action
  calls `requireTenant()` and uses only the returned `scope`.
- **HTTP evidence boundary** — the real crawler's URL policy, redirect rules,
  resource/request budgets, failure semantics, and DNS residual limitation are
  documented in [`docs/security/http-evidence-network-boundary.md`](docs/security/http-evidence-network-boundary.md).

## Auth & tenancy

- One account → one agency **workspace** (V0: single owner; `workspace_members`
  exists for later, populated with one `owner` row).
- `migrations/0004_better_auth.sql` is **generated** from the pinned better-auth
  version (`pnpm exec tsx scripts/auth/generate-schema.ts`); `test/auth.schema.test.ts`
  fails if the committed file and the pinned version disagree, and boots Better
  Auth against the migrated schema so drift fails loudly.
- Base URL comes from the explicit trusted `BETTER_AUTH_URL`, never from a
  request Host/Origin header.
- Session cookie caching is **off** (plain DB-backed sessions).
- Password reset uses Better Auth's supported one-hour, one-use token flow.
  Reset links use the fixed `BETTER_AUTH_URL` origin, successful resets revoke
  all existing sessions, and the user signs in again with the new password.
- Password-reset email delivery uses the Worker-native `fetch` API against
  Resend when `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` are set. The
  sender runs through the Worker's background-task handler; provider failures
  remain generic to the requester. The live Worker + D1 + Resend smoke is a
  hard gate before any external agency pilot.
- Email verification is not part of this phase. Do not invite real external
  users until the live password-reset smoke has passed.

## Pipeline order (cost control is structural)

```
crawl service-coverage gate    (missing-service-page only; claim nothing from a thin crawl)
deterministic rules            (missing-service-page, broken-conversion-path)
  -> evidence threshold        (drop thin candidates before any spend)
  -> resolve billability       (is the mapped service already covered?)
  -> suppress                  (prior dismiss/cover/snooze, or covered work)
  -> ONLY THEN call the evaluator
```

`AI_PROVIDER` defaults to `mock`. Nothing costs money unless the environment opts in.

## Commands

```bash
pnpm install
pnpm test                 # 140 tests — zero network, zero paid calls
pnpm typecheck            # react-router typegen && tsc
pnpm build                # react-router build -> build/client + build/server

pnpm db:migrate:local     # apply migrations 0001..0006 to local D1
pnpm db:seed:local        # demo workspace (ws_demo) only — real workspaces are never seeded
pnpm seed:generate        # regenerate scripts/seed.sql from fixtures/hvac/*
pnpm dev                  # react-router build && wrangler dev

pnpm eval:live                  # LIVE DeepSeek smoke test (needs DEEPSEEK_API_KEY)
CG_LIVE_SCAN=1 pnpm eval:live   # also run the LIVE real-website + conversion-probe crawls
```

### Local setup

Copy `.dev.vars.example` to `.dev.vars` (git-ignored) and set:

- `BETTER_AUTH_SECRET` — 32+ random chars (`openssl rand -base64 32`)
- `BETTER_AUTH_URL` — the wrangler dev origin, e.g. `http://localhost:8976`
- `RESEND_API_KEY` — Resend API key; required for password-reset email delivery
- `RESEND_FROM_EMAIL` — verified Resend sender, e.g. `Client Growth <auth@your-verified-domain.example>`
- optionally `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY=...` for real evaluations

Then `pnpm db:migrate:local && pnpm db:seed:local && pnpm dev`, and sign up at
`/signup`. Password reset starts at `/forgot-password`; the emailed Better Auth
callback lands at `/reset-password`. For a clean slate: delete
`.wrangler/state/v3/d1` and re-run migrate + seed.

For production setup, use the [Cloudflare production deployment runbook](docs/production-deployment.md).
Keep `BETTER_AUTH_SECRET` and `RESEND_API_KEY` as encrypted production secrets;
`BETTER_AUTH_URL` and the verified `RESEND_FROM_EMAIL` belong in the production
environment variables. The production migration baseline intentionally contains
no demo workspace, and `scripts/seed.sql` must never be run against production.

The guarded production commands are:

```bash
pnpm production:preflight
pnpm db:migrations:production
pnpm db:migrate:production
pnpm deploy:production
```

## Status

- **Rule #1** `missing-service-page` — V0 complete (absence verification + crawl-coverage gate).
- **Rule #2** `broken-conversion-path` — V0 complete (dead CTA / broken form / malformed `tel:` / placeholder booking link, all deterministically established before AI).
- **Multi-tenancy** — Better Auth + per-workspace isolation enforced at the repo
  and DB level; aggressive isolation test matrix (repo + route/HTTP + unauthenticated).
- **Password reset** — Better Auth token/session behavior, enumeration-safe
  routes, and Worker-compatible Resend transport implemented; live Worker + D1
  + Resend smoke remains required before an external pilot.

Not built: Stripe/billing, pricing enforcement, team invites/RBAC, email
verification, client portal, autonomous outreach, Morrow execution,
notifications, scheduled monitoring, a third opportunity rule.
