# Client Growth (working name)

Subscription SaaS for small web/digital agencies. It answers one question:

> **What legitimate, valuable, billable work could this agency offer this existing client right now?**

Not an auditor, not lead-gen, not a CRM, not an SEO dashboard, not a chatbot.

## Architecture

Two layers, kept deliberately separate:

- **`src/` — the portable domain engine.** Pure TypeScript: schemas, deterministic
  rules, billability, the analysis pipeline, ports, adapters, D1 repositories.
  No Cloudflare, no React. Fully testable with fixtures at $0.
- **`app/` + `workers/` — the Cloudflare edge.** React Router v7 served by a
  Cloudflare Worker, D1 for persistence. A delivery mechanism only; the engine
  never imports it.

Three replaceable boundaries (`src/ports/`):

| Port | V0 status |
| --- | --- |
| `EvidenceProvider` | `FixtureEvidenceProvider` (seeded demo) + `HttpEvidenceProvider` (real fetch-only crawl, same-origin, ≤10 pages) |
| `OpportunityEvaluator` | `MockEvaluator` (default, deterministic, $0) + `DeepSeekEvaluator` (opt-in; constructor throws without a key; fails closed on malformed output) |
| `ExecutionProvider` | **interface only** — future Morrow integration, not implemented |

## Pipeline order (cost control is structural)

```
deterministic rules
  -> evidence threshold          (drop thin candidates before any spend)
  -> resolve billability          (is the mapped service already covered?)
  -> suppress                     (prior dismiss/cover/snooze, or covered work)
  -> ONLY THEN call the evaluator (never judge work we cannot sell)
```

`AI_PROVIDER` defaults to `mock`. Nothing costs money unless the environment
explicitly opts in.

## Commands

```bash
pnpm install
pnpm test                 # 46 tests — zero network, zero paid calls
pnpm typecheck            # react-router typegen && tsc
pnpm build                # react-router build -> build/client + build/server

pnpm db:migrate:local     # apply migrations to local D1
pnpm db:seed:local        # load the HVAC fixture (run pnpm seed:generate first if fixtures changed)
pnpm dev                  # react-router build && wrangler dev  (local Worker + local D1)

pnpm eval:live            # LIVE DeepSeek smoke test (needs DEEPSEEK_API_KEY)
CG_LIVE_SCAN=1 pnpm eval:live   # also run the LIVE real-website crawl
```

### Enabling the real DeepSeek provider locally

Copy `.dev.vars.example` to `.dev.vars` (git-ignored), set `AI_PROVIDER=deepseek`
and `DEEPSEEK_API_KEY=...`, then `pnpm dev`. The seeded demo client
(`coolbreezehvac.example`) always uses the bundled fixture; any other client is
crawled for real over HTTP.

## Status

Phases A–E complete: scaffold, portable engine, DeepSeek provider, D1
persistence, and the Services / Clients / Opportunities / Opportunity-detail UI
with Prepare-proposal / Dismiss / Mark-covered / Snooze.

Not built: Stripe/billing, client portal, email, CRM, autonomous outreach,
Morrow execution, production deploy automation.
