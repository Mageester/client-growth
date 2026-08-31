# Client Growth (working name)

Subscription SaaS for small web/digital agencies. It answers one question:

> **What legitimate, valuable, billable work could this agency offer this existing client right now?**

Not an auditor, not lead-gen, not a CRM, not an SEO dashboard, not a chatbot.

## Architecture

Two layers, kept deliberately separate:

- **`src/` — the portable domain engine.** Pure TypeScript: schemas, deterministic
  rules, billability, the analysis pipeline, ports, and adapters. No Cloudflare,
  no React, no database, no paid API calls. Fully testable with fixtures at $0.
- **`app/` + `workers/` — the Cloudflare edge.** React Router v7 on Workers, D1
  for persistence. A delivery mechanism only; the engine never imports it.

Three replaceable boundaries (`src/ports/`):

| Port | V0 status |
| --- | --- |
| `EvidenceProvider` | `FixtureEvidenceProvider` (default) + `HttpEvidenceProvider` (minimal real crawl) |
| `OpportunityEvaluator` | `MockEvaluator` (default, deterministic) + `DeepSeekEvaluator` (explicit live runs only) |
| `ExecutionProvider` | **interface only** — future Morrow integration, not implemented |

## Pipeline order (cost control is structural)

```
deterministic rules
  -> evidence threshold          (drop thin candidates before any spend)
  -> resolve billability          (is the mapped service already covered?)
  -> suppress                     (prior dismiss/cover/snooze, or covered work)
  -> ONLY THEN call the evaluator (never judge work we cannot sell)
```

`AI_PROVIDER` defaults to `mock`. `DeepSeekEvaluator` throws without an API key.

## Commands

```bash
pnpm install
pnpm test          # default suite — zero network, zero paid calls
pnpm typecheck
pnpm eval:live      # explicit live provider/network runs only
pnpm dev            # Phase E onwards
```

## Status

Phase A (scaffold) + Phase B (engine + acceptance tests) complete.
Phases C (live DeepSeek wiring), D (D1 persistence), E (UI) are not started.
