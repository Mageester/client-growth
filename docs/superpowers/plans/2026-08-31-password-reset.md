# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a supported, fail-closed Better Auth password-reset flow with privacy-preserving app screens and a minimal Cloudflare Workers-compatible Resend email sender, so the product can safely enter an external agency pilot.

**Architecture:** Keep Better Auth 1.7.2 as the authority for reset tokens, verification storage, password hashing, expiry, one-time consumption, rate limiting, and session revocation. Add two public React Router routes that call Better Auth’s server API, and wire one small direct-`fetch` Resend adapter into the existing cached auth instance. Use the Worker request’s `ExecutionContext` through `AsyncLocalStorage` so reset-email delivery is registered with `ctx.waitUntil` without capturing a request context in the existing `WeakMap` cache.

**Tech Stack:** React Router 7, Cloudflare Workers, native D1, Better Auth 1.7.2, TypeScript, Vitest, Resend Send Email REST API, and the existing `pnpm` scripts.

**Spec:** User-provided password-reset pilot brief in the active task; no separate repository design document exists.

## Global Constraints

- Preserve the current Better Auth 1.7.2, native D1, React Router, tenant-repository, and route-guard architecture.
- Do not add Stripe, pricing enforcement, a third opportunity rule, a marketing redesign, OAuth, teams/invites/RBAC, notifications, scheduled monitoring, or Morrow integration.
- Do not add a new password-reset table or hand-edit the Better Auth-generated migration. The existing `verification` table in `migrations/0004_better_auth.sql` is the supported token store.
- Do not add a `resend` SDK dependency. Use the Worker-native `fetch` API against Resend’s HTTPS endpoint to minimize package and runtime surface.
- Never derive a reset redirect from `Host`, `Origin`, or an untrusted form field. Use the already-required explicit `BETTER_AUTH_URL` only.
- Keep reset responses and UI copy neutral about account existence. Do not perform a local user lookup in the forgot-password route.
- Never include password-reset tokens, API keys, provider response bodies, or arbitrary callback URLs in application logs or user-facing errors.
- Keep reset pages and redirects cache-resistant, and do not create a session automatically after a password reset.
- A passing local test suite is not evidence that Resend delivery, Worker `waitUntil`, a production D1 binding, DNS, or a real mailbox works. Record those as a separate pilot smoke.
- This planning turn makes no application-code, dependency, migration, secret, branch, or commit changes. The only planned artifact is this plan file.

## Verified Current Boundary

- The working tree is clean on `main` at `c56f850196b19cc62a046f5d304cafa0777f1269`, matching the requested verified commit.
- `pnpm test` currently passes 25 test files and 119 tests. `pnpm typecheck` and `pnpm build` also pass.
- `app/lib/authOptions.ts` builds Better Auth options with email/password enabled, database-backed sessions, database-backed rate limiting, and no password-reset sender yet.
- `app/lib/auth.server.ts` validates `BETTER_AUTH_SECRET` and explicit `BETTER_AUTH_URL`, then caches one Better Auth instance per D1 binding.
- `app/routes/api.auth.$.tsx` delegates both loader and action requests to `getAuth(...).handler(request)`, and `app/routes.ts` mounts that catch-all at `api/auth/*`.
- The installed package and lockfile are exactly `better-auth@1.7.2`. Its verified APIs are `requestPasswordReset`, the GET reset callback at `/reset-password/:token`, and `resetPassword`.
- The existing Better Auth 1.7.2 implementation uses the `verification` table with a `reset-password:<token>` identifier, defaults reset-token lifetime to one hour, consumes the token once during reset, and returns the same generic request response for a known and unknown email. `revokeSessionsOnPasswordReset` is available and defaults to false, so it must be enabled explicitly.
- `wrangler.jsonc` already has `nodejs_compat`, which is sufficient for the small `AsyncLocalStorage` bridge used to connect cached Better Auth background work to the current Worker execution context.
- The current Node test `d1LikeOver` shim cannot initialize Better Auth’s native D1 adapter outside the Worker runtime. Route tests must therefore mock the auth boundary; direct Better Auth behavior tests should continue using the existing in-memory SQLite helper, and real D1/Worker behavior belongs in the manual pilot smoke.

## Decisions

### Better Auth API and token contract

Use the exact 1.7.2 API contract already present in `node_modules`:

- `auth.api.requestPasswordReset({ body: { email, redirectTo }, headers, asResponse: true })` for the forgot action. `redirectTo` is supplied only by server code and is the fixed app URL `${BETTER_AUTH_URL}/reset-password`.
- Better Auth generates the token and stores it in the existing verification table. Its effective email URL is `/api/auth/reset-password/<token>?callbackURL=<fixed-app-reset-url>`, which the existing `api/auth/*` catch-all already handles.
- The catch-all GET callback validates the Better Auth verification record and redirects to `/reset-password?token=<token>` or an error query. The app does not reimplement token lookup.
- `auth.api.resetPassword({ body: { newPassword, token }, headers, asResponse: true })` for the reset action. The token is passed in the POST body, then Better Auth performs the one-time consume and credential update.
- Configure `resetPasswordTokenExpiresIn: 60 * 60`, `minPasswordLength: 8`, `maxPasswordLength: 128`, and `revokeSessionsOnPasswordReset: true` explicitly so the security and UX contract is visible in code rather than depending on defaults.

### Email transport

Use Resend’s `POST https://api.resend.com/emails` endpoint from a new small server-only adapter. The adapter will send a plain-text message with the Better Auth-generated URL, a one-hour expiry notice, and a one-use notice. It will authenticate with `Authorization: Bearer <RESEND_API_KEY>`, use `RESEND_FROM_EMAIL` as the verified sender, and send an `Idempotency-Key` derived from the Better Auth token. The request will have a bounded 10-second timeout, will not automatically retry, and will throw a sanitized delivery error for network or non-2xx responses without reading or exposing the provider response body.

This keeps the dependency surface at the platform’s native `fetch`. Resend’s Cloudflare documentation and Send Email API support the Worker/API shape, while the provider’s idempotency-key facility makes a future safe retry of the same token possible without adding retry behavior to this narrow phase.

### Required configuration

Existing configuration remains required:

- `BETTER_AUTH_SECRET`: secret, at least 32 characters.
- `BETTER_AUTH_URL`: explicit trusted absolute application URL; not derived from a request.

New configuration:

- `RESEND_API_KEY`: secret used only for the Resend `Authorization` header. Store it in local `.dev.vars` and as a Cloudflare secret in deployed environments.
- `RESEND_FROM_EMAIL`: verified Resend sender, for example `Client Growth <auth@verified-agency-domain.example>`. This is not itself secret; keep it in local `.dev.vars` and the deployment environment configuration.

The adapter treats both new variables being absent as “email transport not configured.” In that state Better Auth’s reset endpoint remains disabled and the forgot route returns a generic operational error; ordinary sign-in and tenant behavior continue to work locally. A partial pair is a configuration error and causes auth construction to fail closed; the app route maps that failure to the same generic operational error. External-pilot deployment is blocked until both values are present and the sender domain is verified with Resend.

## User-visible and security behavior

### Forgot-password flow

1. Add a `Forgot password?` link on `app/routes/login.tsx` to the new `/forgot-password` route.
2. Render a public email form. Do not redirect based on session state; a signed-in user may request a reset for their own account and the eventual reset revokes sessions.
3. The action accepts only the email field. It ignores any `redirectTo` form value and constructs the fixed same-origin callback from `getTrustedAuthBaseURL(env)`.
4. Call Better Auth’s `requestPasswordReset` with the action request headers so the existing Better Auth 1.7.2 database/IP rate limiter applies.
5. For the normal configured path, render the same confirmation for an existing or unknown email: “If an account matches, we’ll send a reset link. Check your email.” Do not echo the submitted address.
6. Map missing transport, rate limiting, provider setup, and unexpected failures to a generic operational error such as “We couldn’t start the password reset. Please try again later.” Do not reveal whether an account exists or which failure occurred.

Better Auth’s built-in special rule for `/request-password-reset` is three requests per 60 seconds per identified client IP. Do not add a second app-specific limiter in this phase; preserve the existing database-backed Better Auth limiter and pass through request headers.

### Reset-password flow

1. Add a public `app/routes/reset-password.tsx` route. The existing Better Auth catch-all owns the email-link GET callback and redirects into this page.
2. The loader reads only the `token` and `error` query parameters. Missing token, an error query, and a malformed/expired link render the same generic invalid-or-expired state with a link back to `/forgot-password`.
3. A valid-looking token renders a new-password and confirmation form. Use `autocomplete="new-password"`, `minLength={8}`, and `maxLength={128}`. The token is carried in a hidden field only for the immediate form POST; do not persist it in local storage, cookies, a custom database record, or application logs.
4. The action validates presence, length, and confirmation match locally without consuming the token. Then it calls Better Auth’s `resetPassword` with the token and the original request headers.
5. Map invalid, expired, already-consumed, malformed, and unexpected Better Auth errors to the same “That reset link is invalid or expired. Request a new one.” message. Do not expose Better Auth error codes or database details.
6. On success, redirect to `/login?reset=success`. Do not forward the token and do not set a session. The login page displays a neutral success message, and the user signs in manually with the new password.
7. With `revokeSessionsOnPasswordReset: true`, Better Auth deletes all existing sessions. The previous browser cookie therefore cannot continue to access protected tenant routes; a new login creates the only new session.

### Token, cache, and referrer handling

- Let Better Auth generate, expire, and atomically consume tokens; do not hash or persist a second app token.
- Keep the existing `/api/auth/reset-password/:token` route generated by Better Auth; do not create a competing API route.
- Add route headers for both password-reset pages: `Cache-Control: no-store, private`, `Pragma: no-cache`, and `Referrer-Policy: no-referrer`.
- Never log request URLs or query strings from the reset callback/page. The successful redirect removes the token from the address bar; invalid-link paths do not echo it.
- Keep the callback URL fixed to the explicit configured origin, so an attacker cannot turn a reset email into an open redirect.

## Exact file map

### Files to add

- `app/lib/resend.server.ts` — Resend configuration validation and the Better Auth `sendResetPassword` adapter using native Worker `fetch`.
- `app/lib/workerContext.server.ts` — request-scoped `AsyncLocalStorage` bridge and `waitUntil` registration helper for cached Better Auth background tasks.
- `app/routes/forgot-password.tsx` — public forgot-password loader/action/UI with enumeration-safe responses.
- `app/routes/reset-password.tsx` — public reset callback destination/action/UI with token-safe headers and generic failures.
- `test/email.resend.test.ts` — deterministic Resend request, configuration, and sanitized-error tests.
- `test/auth.passwordReset.test.ts` — Better Auth 1.7.2 token, sender, expiry/one-time, session-revocation, and enumeration tests.
- `test/routes.passwordReset.test.ts` — mocked route action/loader/header tests that avoid the unsupported Node native-D1 shim.

### Files to modify

- `app/lib/authOptions.ts` — accept an optional reset sender and background-task handler; set explicit reset password constraints and session revocation.
- `app/lib/auth.server.ts` — add Resend env fields, factor trusted base-URL validation into an exported helper, and pass the sender/background handler into the cached Better Auth instance.
- `app/routes.ts` — mount `forgot-password` and `reset-password` as public routes.
- `app/routes/login.tsx` — add the forgot-password link and show only the fixed `reset=success` message.
- `test/helpers/testAuth.ts` — pass the reset sender/background handler into in-memory Better Auth tests and support a short expiry override for expiry coverage.
- `workers/app.ts` — add Resend env typings and wrap the existing request handler in the Worker execution-context bridge. Preserve the existing `fetch` contract.
- `.dev.vars.example` — document the two new local variables without real credentials.
- `README.md` — document the reset flow, required pilot configuration, local setup, production secret/variable setup, and the fact that email delivery still requires a live Worker/provider smoke.

### Files deliberately not modified

- `migrations/0004_better_auth.sql` and all other migrations — the existing Better Auth verification table is sufficient.
- `package.json` and `pnpm-lock.yaml` — no Resend SDK is needed.
- `wrangler.jsonc` — `nodejs_compat` is already enabled, and no unverified production sender should be hardcoded.
- Tenant repositories, opportunity rules, evaluator code, onboarding, and unrelated UI/routes.

## Implementation tasks

### Task 1: Add the Worker background-task bridge

- [x] Write `test/workerContext.test.ts` or include equivalent focused coverage in `test/email.resend.test.ts` first. Assert that a fake context receives a promise through `waitUntil`, that the helper preserves the callback return value, and that a call without an active context does not produce an unhandled rejection.
- [x] Add `app/lib/workerContext.server.ts` with a small `AsyncLocalStorage` store typed to the `waitUntil` shape, `runWithWorkerExecutionContext`, and `waitUntilInCurrentWorker`.
- [x] Modify `workers/app.ts` to run the existing `handler(request, { cloudflare: { env, ctx } })` inside the bridge. Add only the two Resend environment typings.
- [x] Run the focused bridge test and `pnpm typecheck`.

### Task 2: Add and wire the Resend adapter

- [x] Write configuration tests for the all-absent, partial, and complete `RESEND_API_KEY`/`RESEND_FROM_EMAIL` cases. Assert that no credential value is included in thrown error text.
- [x] Write a fetch-stub test that asserts `https://api.resend.com/emails`, POST, bearer authorization, JSON content type, idempotency key `password-reset/<token>`, sender, recipient, subject, and generated reset URL in the plain-text body.
- [x] Write non-2xx and rejected-fetch tests with a provider body containing a sentinel secret. Assert that the adapter rejects with a generic delivery error and never exposes that body or secret.
- [x] Add `app/lib/resend.server.ts`. Trim configuration, reject a partial pair, use the verified sender, send plain text only, apply the bounded timeout, and treat only 2xx responses as success. Do not log or parse the provider response body.
- [x] Modify `app/lib/authOptions.ts` to accept `sendResetPassword` and `backgroundTaskHandler` dependencies and set the explicit reset options. Keep the callback omitted when no Resend config exists so Better Auth reports reset as disabled.
- [x] Modify `app/lib/auth.server.ts` to validate the new env pair, build the sender when configured, and pass `waitUntilInCurrentWorker` as the Better Auth background handler. Keep the existing `WeakMap` cache; the handler must look up the current context at task-registration time rather than close over `ctx`.
- [x] Run the focused adapter/options tests and `pnpm typecheck`.

### Task 3: Add the public route wiring and forgot-password screen

- [x] Write route tests with the existing direct-module mocking style. Mock `getAuth` and assert the action passes the submitted email, the request headers, and a callback URL derived from trusted `BETTER_AUTH_URL`, while ignoring a malicious form `redirectTo`.
- [x] Assert that a successful Better Auth response returns the submitted confirmation, that a non-OK response and thrown error return the same generic operational error, and that no account lookup occurs in the route module.
- [x] Add `app/routes/forgot-password.tsx` with the public form, neutral success copy, generic failure copy, and no email echo. Use existing route form/data conventions.
- [x] Add `forgot-password` to `app/routes.ts` and add the login-page link in `app/routes/login.tsx`.
- [x] Add the explicit trusted-base-URL helper in `app/lib/auth.server.ts` and use it for the fixed absolute callback. Preserve the current rejection of missing, non-HTTP, or untrusted URL configuration.
- [x] Run the focused route tests and `pnpm typecheck`.

### Task 4: Add the reset-password destination and session behavior

- [x] Write route tests for missing token, callback error, valid-looking token, local password mismatch/length validation, Better Auth rejection, successful redirect to `/login?reset=success`, no token in the success location, and no-store/referrer headers.
- [x] Write the direct Better Auth flow test using the existing SQLite helper with a captured sender: request a reset, extract only the generated token from the captured Better Auth URL, reset successfully, assert the old session is invalid, assert the new password signs in, and assert a second token use fails.
- [x] Write the direct Better Auth tests for known versus unknown email: both request responses must be 200 with the exact same generic body, while the sender is called only for the known account. Include invalid/expired token and password-boundary assertions.
- [x] Add `app/routes/reset-password.tsx`. Let Better Auth own callback validation and token consumption; the route only carries the token through the one form POST, maps all reset failures to one message, and redirects to login without a session.
- [x] Export no-store/private, no-referrer route headers and add the valid-link form plus invalid-link state.
- [x] Modify `app/routes/login.tsx` to show a success message only when `reset=success` is exactly present; do not reflect arbitrary query parameters.
- [x] Run the focused auth/route tests and `pnpm typecheck`.

### Task 5: Document the pilot configuration and safety boundary

- [x] Add commented `RESEND_API_KEY` and `RESEND_FROM_EMAIL` examples to `.dev.vars.example`; do not read, copy, or commit the existing `.dev.vars` values.
- [x] Update `README.md` local setup with the new variables, Resend verified-sender requirement, and production setup commands for the API-key secret and sender variable.
- [x] Document the exact forgot/reset paths, one-hour/one-use token behavior, generic account-enumeration behavior, no-auto-login result, session revocation, and provider-failure behavior.
- [x] Remove the stale statement that password reset is deferred/not built, while retaining the separate statement that email verification is not part of this phase.
- [x] State explicitly that pilot readiness requires the live email/Worker/D1 smoke in Task 7.

### Task 6: Run deterministic verification and review the diff

- [x] Run `pnpm test` and require a completed exit code; a timeout is inconclusive and must not be reported as passing.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Run `git diff --check`.
- [x] Inspect `git status --short --branch` and confirm only the password-reset slice and its tests/docs are present. Do not stage or commit unrelated work.
- [x] Verify no new migration, package dependency, secret value, arbitrary redirect handling, user lookup in the forgot route, token logging, or auto-session behavior entered the diff.

### Task 7: Perform the separate live pilot smoke

- [ ] In a disposable local Worker+D1 environment, configure a real Resend API key and a verified `RESEND_FROM_EMAIL` without committing them.
- [ ] Create a test account and request a reset for the known address. Confirm the request returns the neutral confirmation, Resend receives the plain-text email, and the link uses the configured origin and `/api/auth/reset-password/<token>` path.
- [ ] Request a reset for an unknown address and confirm the user-visible response is indistinguishable from the known-address response. Do not use provider dashboard data to infer account existence in the product.
- [ ] Click the real link, confirm the Better Auth callback lands on `/reset-password?token=...`, set a new password, and confirm the browser lands on `/login?reset=success` with no token in the final URL.
- [ ] Confirm the old session is rejected after reset and that a fresh login succeeds with the new password. Confirm a second submission of the same token fails generically.
- [ ] Record this as live-provider/Worker/D1 evidence separately from the 119-test deterministic baseline. If Resend, DNS, or deployment configuration fails, report that residual risk rather than marking password reset complete.

## Verification commands

After implementation, the minimum deterministic gate is:

```powershell
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The live pilot smoke in Task 7 is required before inviting an external agency account; it cannot be replaced by the local mock evaluator or by unit-test results.

## References checked for this plan

- Better Auth 1.7.2 installed package declarations and implementation for `requestPasswordReset`, reset callback, `resetPassword`, `sendResetPassword`, `resetPasswordTokenExpiresIn`, `revokeSessionsOnPasswordReset`, and `advanced.backgroundTasks.handler`.
- [Better Auth email/password reset documentation](https://better-auth.com/docs/beta/authentication/email-password)
- [Better Auth options reference](https://better-auth.com/docs/reference/options)
- [Resend Cloudflare Workers guide](https://resend.com/docs/send-with-cloudflare-workers)
- [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Cloudflare AsyncLocalStorage](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/)
