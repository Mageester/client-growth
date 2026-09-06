# Alerting

The product has one in-app alert (an elevated inconclusive rate, on Settings →
Check health) and one that is impossible to miss (no email transport, same
page). Both require somebody to open the page. Everything below reaches a person
who is not looking.

None of this is configured in code — it is Cloudflare dashboard configuration,
recorded here so it is set deliberately rather than discovered missing.

## Set these before launch

**Notifications → Workers → Error rate.** The Worker's own failure rate.
Covers the case where every request is failing and nobody has tried to load a
page. This is the single most valuable one.

**Notifications → Workers → Cron trigger failure.** The scheduled monitoring
tick runs hourly, unattended, against production data, and is the one path with
no human waiting on it. `workers/app.ts` logs
`[monitoring] tick failed before reporting: …` and then rethrows specifically so
this alert fires — the rethrow is load-bearing, not tidiness.

**Notifications → D1.** Storage and read/write volume against the account's
limits.

**Provider spend.** DeepSeek bills separately from Cloudflare and Cloudflare
cannot see it. Set a spending cap in the DeepSeek console. The worst case the
service permits in one UTC day is `ANALYSIS_PLATFORM_DAILY_LIMIT ×
MAX_AI_CALLS_PER_RUN` evaluator calls — `pnpm production:preflight` prints that
number on every deploy so it cannot drift silently.

## Reading the logs

Observability is on with invocation logs off, so the log is deliberately quiet:

- `[monitoring] considered=… scanned=… …` — one line per successful cron tick.
  Its absence for several hours is itself the signal.
- `[monitoring] tick failed before reporting: …` — the tick threw before its own
  error handling. Something structural: a binding, D1, or configuration.
- `[monitoring] scan failed for <client>: …` — one client's analysis failed. The
  tick continues, backs that client off, and this is normal in small numbers.
- `[auth] sign-up refused: no email transport is configured` — nobody can create
  an account. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

```bash
wrangler tail --env production --format pretty
wrangler tail --env production --search "[monitoring]"
```
