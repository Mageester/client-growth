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
- **Recurring monitoring** — an hourly Cloudflare Cron Trigger runs one
  `scheduled` handler that asks D1 which monitored clients are *due*, claims a
  bounded batch, and analyzes each one through the normal pipeline. Scheduler
  frequency and client cadence are independent concepts; monitoring is per client
  and defaults to **off**. Policy lives in `src/core/monitoring.ts` (pure),
  storage in `src/db/monitoring.ts`, orchestration in
  `app/lib/monitoring.server.ts`.
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
  -> judgment gate             (is this distinct, sellable work? fail closed)
```

`AI_PROVIDER` defaults to `mock`. Nothing costs money unless the environment opts in.

## The judgment gate

The deterministic rules answer "is there evidence?". They cannot answer the
question that decides whether a finding is safe to put in front of a client:
**is the subject a distinct piece of work someone hires this business for?**
The offerings box is free text, so it routinely contains "fully insured" or
"free quotes" — and a missing page for one of those is otherwise priced exactly
like a missing page for "heat pump installation".

So the evaluator is asked for a classification, not a vibe:

```jsonc
{
  "subjectType": "distinct_service" | "trust_signal" | "promotion"
               | "generic_claim" | "ambiguous",
  "commerciallyActionable": true,
  "verdict": "surface" | "reject",
  "rationale": "...",
  "suggestedScope": ["..."]
}
```

`src/core/judgment.ts` then surfaces a missing-service-page finding **only** when
the subject is positively classified `distinct_service` AND
`commerciallyActionable`. Everything else fails closed — including `ambiguous`,
and including an evaluator that simply did not answer. A provider that returns
the wrong shape is a malformed response, and the pipeline already fails closed on
those.

There is no model-reported confidence anywhere in this path. A measured
calibration run showed the provider's own numbers did not separate a real service
line from a trust claim, so the field was removed rather than left in place
looking meaningful; the `confidence` on an opportunity is the deterministic
evidence strength the rules computed.

`MockEvaluator` applies none of this — it *asserts* `distinct_service` for every
candidate. That is deliberate (offline tests need a free, deterministic
evaluator) and it is measured: `pnpm bench` shows exactly what the mock costs on
the adversarial set.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm verify               # local-only release gate: safety, preflight, tests, typecheck, build
pnpm test                 # offline tests — zero network, zero paid calls
pnpm typecheck            # react-router typegen && tsc
pnpm build                # react-router build -> build/client + build/server

pnpm db:migrate:local     # apply migrations 0001..latest to local D1
pnpm db:seed:local        # demo workspace (ws_demo) only — real workspaces are never seeded
pnpm seed:generate        # regenerate scripts/seed.sql from fixtures/hvac/*
pnpm dev                  # react-router build && wrangler dev

pnpm bench                      # offline engine scorecard: core cases + adversarial judgment set
pnpm eval:live                  # LIVE DeepSeek smoke test (needs DEEPSEEK_API_KEY)
CG_LIVE_SCAN=1 pnpm eval:live   # also run the LIVE real-website + conversion-probe crawls

# paid, opt-in: judge every case with the real provider and measure stability
CG_BENCH_MAX_CALLS=200 pnpm bench --deepseek --samples=3
```

Node 24 is the supported runtime; `.node-version` and `package.json` keep local
development and CI on the same major version. `pnpm verify` never contacts
Cloudflare, remote D1, Resend, or paid AI providers and does not require
production secrets.

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

## Recurring monitoring

Monitoring is opt-in per client and defaults to `off`, including for every client
that already exists. Nothing is scanned in the background until someone turns it
on from the client's page.

```
cron (hourly)  ->  scheduled()  ->  runMonitoringTick()
                                      |
                                      |- listDueClients(limit)      bounded selection
                                      |- claimClient(...)           one owner per client
                                      |- runAnalysis(trigger=scheduled)
                                      \- finishMonitoringRun(...)   outcome + next due
```

Cost ceilings, all enforced in code:

| Control | Where | Default |
| --- | --- | --- |
| Clients per scheduled tick | `MONITORING_MAX_CLIENTS_PER_RUN` | 5 (production: 3) |
| Evaluator calls per client | `MAX_AI_CALLS_PER_RUN` | 10 |
| Wall-clock per tick | `MONITORING_INVOCATION_BUDGET_MS` | 5 min |
| Retries after a failed scan | `MONITORING_FAILURE_BACKOFF_MS` | 1h, 6h, 24h, then cadence |

A completed scan — findings, clean, or inconclusive — always costs one full
cadence interval. Only a scan that *threw* retries sooner, at most three times.

**Operator trigger.** `POST /internal/monitoring/run` runs the same
`runMonitoringTick` the cron calls, for verifying a canary without waiting for a
cron boundary. It is inert unless `MONITORING_TRIGGER_TOKEN` is set as a Wrangler
secret (32+ chars), requires `Authorization: Bearer <token>`, processes only
clients that are genuinely due, and returns counts only.

```bash
curl -X POST -H "Authorization: Bearer $MONITORING_TRIGGER_TOKEN"   https://client-growth-production.aidan-magee2.workers.dev/internal/monitoring/run
```

Locally: `wrangler dev --test-scheduled`, then `curl -X POST localhost:8788/__scheduled`.

## Status

- **Commercial judgment layer** — structured `subjectType` /
  `commerciallyActionable` contract with a fail-closed gate, plus a 37-case
  adversarial judgment benchmark (true services, trust signals, promotions,
  generic claims, ambiguous edges). Production still runs `AI_PROVIDER=mock`.
- **Rule #1** `missing-service-page` — V0 complete (absence verification + crawl-coverage gate).
- **Rule #2** `broken-conversion-path` — V0 complete (dead CTA / broken form / malformed `tel:` / placeholder booking link, all deterministically established before AI).
- **Multi-tenancy** — Better Auth + per-workspace isolation enforced at the repo
  and DB level; aggressive isolation test matrix (repo + route/HTTP + unauthenticated).
- **Password reset** — Better Auth token/session behavior, enumeration-safe
  routes, and Worker-compatible Resend transport implemented; live Worker + D1
  + Resend smoke remains required before an external pilot.

- **Recurring monitoring** — opt-in per client (`off` / `weekly`), hourly
  scheduler, bounded batches, claim-based duplicate prevention, bounded failure
  backoff, and change detection (new / still open / resolved) recorded on every
  run. Ships with monitoring **off for every existing client**; canary first.

Not built: Stripe/billing, pricing enforcement, team invites/RBAC, email
verification, client portal, autonomous outreach, Morrow execution, email or
Slack digests, a third opportunity rule.
