# MONITOR — the paid monitoring tier

MONITOR is Axiom Orbit's first paid feature. It turns the recurring scanner into
a product an agency pays for: it watches a portfolio of clients on a schedule and
tells the agency, proactively, when there is **new billable work** — a service
page a client still doesn't have, a conversion path that broke, a competitor gap —
and emails one weekly digest. It stays silent when there is nothing to sell.

It is deliberately **not** a generic uptime or content-diff monitor. Every number
and sentence it produces is framed as sellable work, priced from the agency's own
catalog, and has already passed the same judgment gate as the rest of the product.
There is no uptime percentage and no "the page changed" alert, because neither is
billable work.

## What it is made of

| Concern | Where |
| --- | --- |
| Who is entitled (the paid gate) | `src/core/entitlements.ts` (pure) |
| The recurring scan (the engine) | `src/core/monitoring.ts`, `app/lib/monitoring.server.ts` |
| The weekly digest model + rendering | `src/core/monitorDigest.ts` (pure) |
| Digest storage + scheduling | `src/db/monitorDigests.ts`, `migrations/0025_monitor_digests.sql` |
| Digest orchestration (the tick) | `app/lib/monitorDigest.server.ts` |
| The console | `app/routes/monitor.tsx` (`/monitor`) |

## The paid gate (there is no billing yet)

Stripe is not built. Until it is, "this workspace is paying for MONITOR" is a
decision an operator makes on purpose — exactly like admission to the product
(`SIGNUP_MODE`). Entitlement is **env policy, default-closed**:

- `MONITOR_ENTITLEMENT_MODE` — `off` (default, in code), `allowlist`, or `open`.
  An environment that says nothing grants the feature to nobody.
- `MONITOR_ALLOWLIST` — same format as `SIGNUP_ALLOWLIST`: named addresses
  (`owner@agency.example`) or whole domains (`@agency.example`). The gate keys off
  the **workspace owner's** address.

Production `wrangler.jsonc` ships `MONITOR_ENTITLEMENT_MODE: "off"`, and
`pnpm production:preflight` refuses to deploy unless it is declared explicitly —
so the paid feature cannot be switched on by forgetting a variable. Delete the
gate the day billing exists.

**To put an agency on MONITOR**, set `MONITOR_ENTITLEMENT_MODE: "allowlist"` and
add the owner's address (or `@domain`) to `MONITOR_ALLOWLIST` in the production
vars, then redeploy.

The gate is enforced in three places, all fail-closed:

1. Turning per-client monitoring **on** is refused for an unentitled workspace
   (`app/routes/clients.$id.tsx`); turning it **off** is always allowed.
2. The scan tick **never scans** an unentitled workspace, so there is no
   unattended provider spend for a tenant nobody is paying for — even one that was
   entitled when it enabled monitoring and has since been removed
   (`app/lib/monitoring.server.ts`).
3. The digest tick records and skips an unentitled workspace rather than emailing
   it.

## Cost, stated plainly

- The **scan** is the only unattended provider spend, bounded by
  `MONITORING_MAX_CLIENTS_PER_RUN` × `MAX_AI_CALLS_PER_RUN` per hourly tick and by
  the platform daily ceiling. Unchanged by this feature except that it is now
  gated by entitlement.
- The **digest reads already-computed scan output and triggers no analysis**, so
  building or sending one costs nothing at the provider. `MONITOR_DIGEST_MAX_PER_RUN`
  (default 25) bounds email fan-out, not spend.

## The two schedules

`wrangler.jsonc` declares two crons and `workers/app.ts` branches on which fired:

- `0 * * * *` — hourly recurring monitoring (the scan).
- `0 13 * * *` — daily MONITOR digest tick. It runs every day and emails only the
  workspaces whose weekly digest has come due, so a workspace receives at most one
  digest per week regardless of how often the tick runs.

A digest is sent only when the workspace is entitled, its cadence is `weekly`, and
— with "only when something changed" on (the default) — the week was not quiet. A
persistently unreadable site is reported as a footnote, never as a fresh weekly
alarm.

## Operator trigger (canary without waiting for a cron boundary)

`POST /internal/monitoring/digest` runs the exact `runMonitorDigestTick` the cron
calls. Inert (404) unless `MONITOR_DIGEST_TRIGGER_TOKEN` (≥32 chars) is set as a
Wrangler secret; requires `Authorization: Bearer <token>`; returns counts only.

```bash
curl -X POST -H "Authorization: Bearer $MONITOR_DIGEST_TRIGGER_TOKEN" \
  https://orbit.getaxiom.ca/internal/monitoring/digest
```

Locally: `wrangler dev --test-scheduled`, then trigger the `0 13 * * *` cron.

## Launch gate — the live Resend digest smoke

Like the password-reset smoke, MONITOR is not proven until a real digest has been
delivered end to end on `orbit.getaxiom.ca`:

1. Set `MONITOR_ENTITLEMENT_MODE: "allowlist"` with a test agency's owner in
   `MONITOR_ALLOWLIST`, and confirm `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are set.
2. Turn on monitoring for one of that workspace's clients and let (or trigger) a
   scheduled scan that produces a change.
3. On the `/monitor` console, use **"Send me this week's digest"**, or hit the
   operator trigger, and confirm a real email arrives with working deep links.

The safety net makes a failed send loud, which is not the same as proving delivery
works. Do not put an external agency on MONITOR until this smoke has passed.
