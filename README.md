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
- **PASSWORD RESET IS REQUIRED BEFORE ANY EXTERNAL AGENCY PILOT.** Email
  verification and password reset are deliberately deferred this phase (no email
  sender yet). Do not invite real external users until reset is implemented.

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
pnpm test                 # 119 tests — zero network, zero paid calls
pnpm typecheck            # react-router typegen && tsc
pnpm build                # react-router build -> build/client + build/server

pnpm db:migrate:local     # apply migrations 0001..0005 to local D1
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
- optionally `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY=...` for real evaluations

Then `pnpm db:migrate:local && pnpm db:seed:local && pnpm dev`, and sign up at
`/signup`. For a clean slate: delete `.wrangler/state/v3/d1` and re-run migrate + seed.

## Status

- **Rule #1** `missing-service-page` — V0 complete (absence verification + crawl-coverage gate).
- **Rule #2** `broken-conversion-path` — V0 complete (dead CTA / broken form / malformed `tel:` / placeholder booking link, all deterministically established before AI).
- **Multi-tenancy** — Better Auth + per-workspace isolation enforced at the repo
  and DB level; aggressive isolation test matrix (repo + route/HTTP + unauthenticated).

Not built: Stripe/billing, pricing enforcement, team invites/RBAC, email
verification, password reset, client portal, autonomous outreach, Morrow
execution, notifications, scheduled monitoring, a third opportunity rule.
