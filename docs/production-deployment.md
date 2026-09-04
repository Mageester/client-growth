# Client Growth production deployment runbook

This is the first-production preparation and deployment sequence. It contains no credentials, real hostnames, or Cloudflare resource IDs. The committed production configuration intentionally contains placeholders until the operator completes the manual setup below.

Do not run the production resource, secret, migration, or deploy commands until the crawler/network-hardening branch has been integrated and reviewed. This task does not create resources, change DNS, configure secrets, send email, deploy a Worker, or merge that branch.

## Architecture

| Component | Production configuration | Important boundary |
| --- | --- | --- |
| Worker | `client-growth-production`, `workers_dev: true`, fronted by `orbit.getaxiom.ca` | The custom domain is attached in the Cloudflare dashboard, not committed here. `BETTER_AUTH_URL` names it, and it is the only origin Better Auth trusts — the workers.dev hostname still serves pages but cannot sign anyone in. |
| Runtime | `compatibility_date: 2026-08-31`, `nodejs_compat` | React Router SSR and the Worker `AsyncLocalStorage` bridge depend on the Worker-compatible runtime. |
| Static assets | Inherited `ASSETS` binding from `./build/client` | Run `pnpm build` before deploy; `workers/app.ts` imports `build/server`. |
| D1 | Binding `DB` → database `client-growth-production`, migrations in `migrations/` | The production binding is declared separately from local `client-growth-dev`. |
| Auth | Better Auth `1.7.2` on native D1 | Sessions, rate limits, password-reset verification rows, users, and accounts live in the production D1. |
| Email | Worker-native `fetch` to `https://api.resend.com/emails` | Reset delivery is enabled only when both Resend values are configured. |
| Analysis | `AI_PROVIDER=mock` by default | Real public-site analysis is still network-dependent; DeepSeek is an explicit optional paid path. |

Wrangler bindings and variables are environment-specific. The production environment repeats the D1 binding, non-secret `vars`, required secret names, and the invocation-log privacy setting rather than inheriting the development D1 accidentally. See the [Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) and [D1 environment guidance](https://developers.cloudflare.com/d1/configuration/environments/).

## Configuration inventory

### Encrypted secrets

These names are declared under `env.production.secrets.required`. Values must be entered through Wrangler or the Cloudflare dashboard and must never be committed, pasted into `wrangler.jsonc`, or placed in browser code.

| Name | Required when | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Always | Better Auth signing/encryption secret; the application rejects values shorter than 32 characters. |
| `RESEND_API_KEY` | Always for the external pilot | Authenticates password-reset email delivery. Use a Resend sending-only key restricted to the verified sending domain where possible. |
| `DEEPSEEK_API_KEY` | Only if `AI_PROVIDER=deepseek` | Authenticates the optional DeepSeek evaluator. Add this name to `secrets.required` before switching the production provider. |

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, if used for CI or Wrangler authentication, are operator/CI credentials rather than application runtime variables. Keep them in the platform’s secret store, not this repository.

### Plaintext, non-secret configuration

These values are intentionally visible in the production Wrangler config because they are routing/provider selection or resource metadata, not credentials.

| Name | Required value/behavior |
| --- | --- |
| `BETTER_AUTH_URL` | The final public HTTPS origin; do not use a localhost, example, or placeholder host, path, query, or fragment. It must match the origin users use to open the Worker. |
| `RESEND_FROM_EMAIL` | A friendly sender on the verified domain, such as `Client Growth <auth@your-verified-domain>` (illustrative syntax; replace it with the real verified address before preflight). |
| `AI_PROVIDER` | Leave `mock` for the no-cost baseline. Change to `deepseek` only after adding the key and accepting provider spend. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` when DeepSeek is selected; it is ignored in mock mode. |
| `DEEPSEEK_MODEL` | `deepseek-chat` when DeepSeek is selected; it is ignored in mock mode. |
| `MAX_AI_CALLS_PER_RUN` | `10`, matching the current application cap. |
| D1 `database_id` | The non-secret UUID returned by `wrangler d1 create`; never leave the committed placeholder. |

`BETTER_AUTH_URL` is read from the explicit trusted environment value. The application does not derive it from `Host`, `Origin`, or a submitted form field, so changing the public origin requires updating this variable and redeploying deliberately.

## Manual setup

Complete these steps only when you are ready to create the remote resource and configure production.

### 1. Confirm the account and checkout

From the intended clean checkout, after hardening has landed through the normal integration process:

```powershell
git status --short --branch
pnpm install --frozen-lockfile
pnpm exec wrangler whoami
```

Stop if the checkout contains unrelated work, Wrangler is authenticated to the wrong Cloudflare account, or the hardening work is not present.

### 2. Create and bind the production D1

First check whether the named database already exists:

```powershell
pnpm exec wrangler d1 list
```

If `client-growth-production` does not exist, create it once. `enam` is the Eastern North America location hint; it is not a secret and can be changed only before creation if a different primary location is desired.

```powershell
pnpm exec wrangler d1 create client-growth-production --location=enam
```

Copy the UUID returned by Wrangler into `env.production.d1_databases[0].database_id` in `wrangler.jsonc`, replacing only `__SET_AFTER_WRANGLER_D1_CREATE__`. Do not omit the ID, point it at `client-growth-dev`, or rely on automatic resource provisioning. The production database name must remain exactly `client-growth-production`.

Choose the public HTTPS origin and replace the two non-secret placeholders in the same production `vars` block:

- `BETTER_AUTH_URL` — the final Worker/custom-domain origin.
- `RESEND_FROM_EMAIL` — the verified Resend sender.

Then run the local structural guard:

```powershell
pnpm production:preflight
```

It must pass before any remote migration command. It contacts no Cloudflare service and never reads secret values.

### 3. Configure Resend manually

In the Resend dashboard:

1. Create or select the correct Resend team/account.
2. Open Domains, add the sending domain or a dedicated sending subdomain, and copy every SPF, DKIM, and return-path/MX record Resend displays.
3. Add those records at the authoritative DNS provider. Wait until Resend reports the domain as verified. Do not substitute records from another domain; the sender domain must match exactly.
4. Use a reply-capable sender address on that verified domain, then put the friendly `Client Growth <...>` value in `env.production.vars.RESEND_FROM_EMAIL`.
5. Open API Keys and create a production key with sending access restricted to the verified domain. Copy it once into a password manager or other secure secret-handling location; Resend shows the token only at creation.

Resend’s current guidance is in [Managing Domains](https://resend.com/docs/dashboard/domains/introduction), [API key introduction](https://resend.com/docs/dashboard/api-keys/introduction), and the [Send Email API](https://resend.com/docs/api-reference/emails/send-email). Do not use a `resend.dev` test sender for the external pilot; that path is limited and does not prove the verified-domain setup.

### 4. Configure encrypted Worker secrets

For the first deployment, use a secure `.env`-format file stored outside the repository so the required secrets are supplied to the same intentional deployment that creates the Worker version. For example, create `C:\secure\client-growth-production.secrets` in a password-managed or otherwise protected location with only the names required by the selected provider:

```dotenv
BETTER_AUTH_SECRET=<enter a newly generated 32+ character value>
RESEND_API_KEY=<enter the Resend sending key>
```

Do not commit this file. Do not put either value in `wrangler.jsonc`, `vars`, a test fixture, or a browser bundle. If DeepSeek is selected, add `DEEPSEEK_API_KEY=<enter the DeepSeek key>` to this secure file and add `DEEPSEEK_API_KEY` to `env.production.secrets.required` first.

`wrangler secret put` creates and deploys a new Worker version immediately. Use it only during an intentional deployment window for an existing Worker:

```powershell
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production
pnpm exec wrangler secret put RESEND_API_KEY --env production
pnpm exec wrangler secret list --env production
```

For the initial Worker deployment, prefer the `--secrets-file` command in the deployment sequence below so the first version receives all required secrets atomically. The [Cloudflare secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/) explains both behaviors.

## D1 migration and deployment sequence

The migration sequence is deliberately separate from Worker deployment. Cloudflare records applied migrations in `d1_migrations` and captures a backup when applying them; a failed migration is rolled back while prior successful migrations remain applied. See [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) and [D1 Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

1. Ensure `pnpm production:preflight` passes.
2. Inspect pending migrations against the production database:

   ```powershell
   pnpm db:migrations:production
   ```

3. Apply all committed migrations, accepting Wrangler’s confirmation after checking that the target is `client-growth-production`:

   ```powershell
   pnpm db:migrate:production
   ```

   The expected sequence is `0001_init.sql` through `0006_remove_demo_fixture.sql`.

4. List again and confirm there are no unapplied migrations:

   ```powershell
   pnpm db:migrations:production
   ```

5. Verify the schema directly. The output must include the Better Auth tables (`user`, `session`, `account`, `verification`, `rateLimit`), workspace tables (`workspaces`, `workspace_members`), and application tables (`services`, `clients`, `client_coverage`, `evidence_bundles`, `opportunities`), plus Wrangler’s `d1_migrations` table.

   ```powershell
   pnpm exec wrangler d1 execute client-growth-production --env production --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"
   ```

6. Verify the migration baseline contains no local demo identity or workspace:

   ```powershell
   pnpm exec wrangler d1 execute client-growth-production --env production --remote --command 'SELECT (SELECT COUNT(*) FROM "user" WHERE id = ''user_demo'') AS demo_users, (SELECT COUNT(*) FROM workspaces WHERE id = ''ws_demo'') AS demo_workspaces;'
   ```

   Both values must be `0`.

7. Never run `pnpm db:seed:local`, `wrangler d1 execute ... --file=./scripts/seed.sql`, `scripts/generate-seed.ts`, or any fixture SQL against production. Production has no seed requirement: signup creates the user, onboarding creates the workspace/services/client, and the first analysis creates only that tenant’s evidence/opportunities.

8. Before the real deployment, run a no-upload validation with the final config and secure secret file:

   ```powershell
   pnpm exec wrangler deploy --dry-run --env production --secrets-file C:\secure\client-growth-production.secrets --experimental-provision=false --experimental-auto-create=false
   ```

9. Run the first deployment only after the migration and schema checks above pass:

   ```powershell
   pnpm production:preflight
   pnpm typecheck
   pnpm build
   pnpm exec wrangler deploy --env production --secrets-file C:\secure\client-growth-production.secrets --experimental-provision=false --experimental-auto-create=false
   ```

   After that initial version exists and the secrets are stored on the Worker, the repeatable code-only command is:

   ```powershell
   pnpm deploy:production
   ```

   This command does not apply migrations. Repeat the migration-list/apply/verify sequence whenever a new migration is added, before the deploy command.

## Production smoke test

Use two isolated browser contexts and controlled test mailboxes. Record the Worker version, UTC timestamps, D1 migration status, and pass/fail evidence separately from the local deterministic test suite. Never paste a password-reset token into a ticket, chat, screenshot, or log.

### Public/auth baseline

- [ ] `GET /`, `/login`, `/signup`, and `/forgot-password` load over HTTPS with no stack trace.
- [ ] Reset-page responses retain `Cache-Control: no-store, private`, `Pragma: no-cache`, and `Referrer-Policy: no-referrer`.
- [ ] Account A can sign up with a controlled email and agency name; the response creates a session and reaches onboarding.
- [ ] Onboarding saves at least one real agency service and one real client, then reaches Opportunities. No `ws_demo` data is involved.
- [ ] Log out; the previous cookie cannot access protected pages. Log in again with the same credentials.

### Real password-reset email

- [ ] From Account A, submit a known address at `/forgot-password`; the UI gives the neutral confirmation.
- [ ] Submit an unknown address; the status and visible response are indistinguishable from the known-address response.
- [ ] Resend shows one delivered attempt from the verified `RESEND_FROM_EMAIL` to the controlled mailbox.
- [ ] The message contains a link whose origin is exactly `BETTER_AUTH_URL` and whose route is the Better Auth reset callback.
- [ ] Open the link; set a new password. The final browser location is `/login?reset=success`, with no token remaining in the address bar.
- [ ] A second browser context holding Account A’s old session is rejected after reset; the old password fails, the new password signs in, and a second submission of the same reset token fails generically.

### Tenant and opportunity behavior

- [ ] Account A adds a real public client domain at `/clients` and saves it.
- [ ] Account A runs analysis against that public site. Confirm crawl status/evidence is visible, no unsupported absence claim is made when service coverage is inadequate, and any surfaced opportunity is tied to Account A’s client/service rows.
- [ ] Confirm the intended opportunity behavior: surfaced billable candidate, detail/evidence view, re-analysis deduplication, and one decision path such as dismiss, snooze, mark covered, or prepare a proposal draft.
- [ ] Keep `AI_PROVIDER=mock` for a no-cost deterministic smoke, or record DeepSeek request/cost evidence separately if `AI_PROVIDER=deepseek` was explicitly enabled.
- [ ] In browser context B, sign up with a different email and workspace, create a different service/client, and confirm B sees none of A’s clients, services, evidence, or opportunities.
- [ ] From B, try A’s client and opportunity URLs directly; they must resolve as not found/unauthorized without leaking whether the row exists. Confirm A remains unaffected.
- [ ] Confirm unauthenticated access to protected routes redirects to `/login` and logout invalidates each context’s session.

### Crawler/network-hardening checks after integration

Run the exact automated acceptance tests from the integrated hardening branch, then add the live black-box checks below against a disposable account and harmless public endpoints:

- [ ] Reject non-HTTP(S), credential-bearing, malformed, localhost, loopback, private, link-local, multicast, metadata-service, and reserved IP targets, including alternate IPv4/IPv6 spellings and IPv4-mapped IPv6 forms.
- [ ] Validate every redirect destination before the next request; a public URL redirecting to a blocked literal address fails closed.
- [ ] Retain the documented DNS-rebinding limitation: Workers cannot authoritatively resolve arbitrary hostnames before fetch, so a public-looking hostname may still resolve or rebind privately. Do not mark this residual risk as protected.
- [ ] Enforce the configured page-count, redirect, timeout, response-size, and content-type limits; oversized/binary/non-HTML responses do not become evidence.
- [ ] Confirm conversion probes use the same target-safety boundary and do not forward the user’s cookies, Authorization header, or internal network access.
- [ ] Confirm a blocked/failed crawl returns a generic safe error, stores no private response body, and never surfaces an opportunity from insufficient evidence.
- [ ] Confirm the real public-site happy path still produces complete evidence and an opportunity when the deterministic rule conditions are genuinely met.

These checks are intentionally not claimed complete in this preparation commit because the hardening branch is still separate.

## Logging and privacy review

- `observability.enabled` remains `true` for operational errors and custom logs, but `observability.logs.invocation_logs` is explicitly `false` at both the top level and `env.production`. Cloudflare invocation logs include the fetch method and URL; disabling them prevents reset callback paths/tokens from being collected automatically. See [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
- Do not enable invocation logs to debug a reset. Use redacted, event-specific diagnostics if a future change needs them; never log request URLs/query strings, reset tokens, API keys, provider response bodies, passwords, cookies, or authorization headers.
- The reset routes already use no-store/referrer-protection headers and redirect to login without carrying the token forward. `BETTER_AUTH_URL` remains fixed and trusted.
- The current server-render error path and evaluator-failure path use `console.error`. They do not intentionally log reset URLs or credentials, but error objects must not be expanded to include requests or provider payloads. In particular, the current DeepSeek evaluator’s truncated provider-error message is a separate network/provider logging review item before enabling real DeepSeek traffic; it is outside this deployment-preparation slice.
- D1 will contain account emails, authentication records, session metadata, workspace/client data, evidence, and opportunity/proposal content. Restrict Cloudflare account access and define an operational retention/access policy before inviting external agencies.

## Recurring monitoring rollout (canary first)

Monitoring ships **off for every client**, including every client already in
production. Migration `0008_monitoring.sql` adds the columns with
`DEFAULT 'off'` and performs no `UPDATE`, so deploying the scheduler starts no
paid background work. Broad activation is a deliberate, later, human decision.

### Cost ceilings in production

| Control | Value | Where |
| --- | --- | --- |
| Cron frequency | hourly (`0 * * * *`) | `wrangler.jsonc` `triggers.crons` |
| Clients per tick | 3 | `MONITORING_MAX_CLIENTS_PER_RUN` (production var) |
| Evaluator calls per client | 10 | `MAX_AI_CALLS_PER_RUN` |
| Worst case per tick | 30 DeepSeek calls | the product of the two above |

`pnpm production:preflight` fails the deploy if production does not declare
exactly one cron trigger, or if the batch size is outside 1..25.

### Sequence

1. **Migrate.** `pnpm db:migrations:production` to review, then
   `pnpm db:migrate:production`. Confirm afterwards that nothing was enabled:

   ```
   wrangler d1 execute client-growth-production --env production --remote      --command "SELECT COUNT(*) AS monitored FROM clients WHERE monitoring_cadence != 'off';"
   ```

   This must return `0`. If it does not, stop and investigate before deploying.

2. **Set the operator trigger secret.** 32+ random characters:

   ```
   wrangler secret put MONITORING_TRIGGER_TOKEN --env production
   ```

   Without it, `POST /internal/monitoring/run` returns 404 and cannot be used.

3. **Deploy.** `pnpm deploy:production`. The cron is now registered. Because
   every client is `off`, the hourly tick selects nothing and costs nothing.
   Confirm from the Worker logs that a tick logs `considered=0`.

4. **Canary.** Pick ONE low-risk QA client in a workspace you control. Turn
   monitoring to Weekly from that client's page. Its first check is scheduled
   one interval after its last completed analysis, or immediately if it has
   never been analyzed.

5. **Verify the canary without waiting for the cron boundary:**

   ```
   curl -X POST -H "Authorization: Bearer $MONITORING_TRIGGER_TOKEN"      https://orbit.getaxiom.ca/internal/monitoring/run
   ```

   This runs the same `runMonitoringTick` the cron calls. Expect
   `considered: 1`, `scanned: 1`, and an `outcomes` entry. Call it again: the
   second call must report `considered: 0`, proving the schedule advanced and
   no duplicate work or duplicate spend is possible.

6. **Check the evidence.** On the canary client: the analysis history shows the
   run tagged `Monitoring`, "last checked" and "next check" are populated, and
   `evaluatorErrors` is 0 in the Worker's scheduled log line. Leave the canary
   running for at least one real cron-driven cycle before widening.

7. **Widen deliberately**, a few clients at a time, watching `failed`,
   `inconclusive` and `evaluatorErrors` in the tick log after each step.

### Rollback

Turn monitoring off for the affected clients (the product control), which
unschedules them immediately. To stop all scheduled work at once, remove
`triggers.crons` from the production block and redeploy; the columns and history
are unaffected and monitoring can be re-enabled later without a migration.

## Current blockers and stop conditions

The repository is prepared but not deployable from the committed placeholders until these are completed manually:

1. Integrate and review the separate crawler/network-hardening branch; do not merge it from this task.
2. Create `client-growth-production` D1 and replace the placeholder UUID.
3. Choose the public HTTPS origin, configure any DNS/custom-domain work separately, and replace `BETTER_AUTH_URL`.
4. Verify the Resend sending domain and replace `RESEND_FROM_EMAIL`.
5. Configure the encrypted production secrets. Add DeepSeek only if the paid evaluator is deliberately selected.
6. Run the migration/schema checks and the full live smoke, including real email and post-hardening network checks.

Until then, `pnpm production:preflight` is expected to fail on the placeholder D1 ID, origin, and sender. That failure is the safety gate, not a deployment defect.
