# Axiom Orbit — handoff

**Date:** 2026-09-04
**Repo:** `C:\Users\aidan\OneDrive\Documents\client-growth` (remote `Mageester/client-growth`)
**Branch:** `main`, clean, pushed
**Live:** https://client-growth-production.aidan-magee2.workers.dev (version `10ee7e9f`)
**Next session focus:** animated/guided onboarding, then the top-5 launch priorities below.

---

## 1. What this product is

Axiom Orbit ("The client growth platform for agencies"). An agency records the clients it already
looks after and what each business sells. The app crawls each client's website, compares it against
those offerings, and surfaces billable work — each finding evidenced and priced from a service in the
agency's own catalog.

**Its differentiator is refusal to guess.** It distinguishes "we read the site and it's clean" from
"we couldn't read it", and will not claim a missing page unless the crawl demonstrably reached the
site's service section. Every automation added must preserve this. AI proposes, a human confirms.
Read `src/core/analysisOutcome.ts` and `src/core/absenceVerification.ts` before touching the engine.

Stack: React Router 7 + Cloudflare Workers + D1, better-auth, DeepSeek as evaluator. 643 tests,
`pnpm verify` runs the lot.

## 2. What happened this session

17 commits, `4ff142c..b3d38de`. Read `git log` for detail — the messages carry the reasoning and are
not summarised here.

Three arcs:

- **UI redesign then brand adoption.** The "signal desk" redesign was restyled into a calm editorial
  surface, then *overridden* by the official brand pack: near-black canvas, pure neutrals, Space
  Grotesk, dark as default. Real logo artwork now ships (`public/brand/`).
- **Engine accuracy.** Added the `no-service-pages` rule, then found and fixed two real bugs in it
  and the crawler by testing against real sites.
- **Suggestion precision + the auto-fill entry point.** See §4.

**Assets:** brand pack lives at `C:\Users\aidan\OneDrive\Desktop\Axiom Orbit\Axiom-Orbit-Brand-Pack-v1\`.
`BRAND-GUIDE.md` there is authoritative and was followed; re-read it before any visual change.

## 3. Tooling you will need (this is the important part)

**`scripts/analyzability/run.ts`** — the benchmark. 24 real small-business websites in
`scripts/analyzability/corpus.ts`. Runs the real crawler and real coverage assessment, replays from
`.analyzability-cache/`, no AI spend, no production data.

```bash
pnpm analyzability --offline          # replay cache, fail loudly on a miss
pnpm analyzability --json=out.json    # machine report
```

Current: **ANALYZABLE 19/24 (79%), false analyzable: none.** That last number is the honesty
guarantee holding across 24 real sites — watch it.

**`scripts/analyzability/ui-fixture.ts`** — replays those crawls, runs the real rules, writes
`.analyzability-ui.json`.

**`scripts/design-harness.tsx`** — server-renders the real route components (they take `loaderData`
as a *prop*, so no session needed) into standalone HTML. Includes corpus screens, the product tour,
and a thin-client state.

```bash
pnpm tsx scripts/analyzability/ui-fixture.ts
pnpm tsx scripts/design-harness.tsx build/client/harness   # then browse /harness/*.html
```

**This loop caught every bug worth catching this session.** Two of them were mine, introduced hours
earlier, and one would have told an agency their client's entire website sells nothing. Do not skip it.

## 4. Where feature work landed

`suggestOfferings` was proposing blog posts and project-gallery photos as services. Root cause:
`slugSaysNonService` only inspects a URL's *last* segment, so `/blog/babyproofing-your-home` read as
a service page. Fixed with `isEditorialPath` (checks ancestors) — note `projects` is filtered but
`all-projects` is not, because thelawnsalon.ca keeps real service pages under exactly that.
Precision *and* recall improved: noise was crowding real services out from under the 12-cap.

The auto-fill mostly already existed; the gap was *when*. Suggestions come from the last crawl, so a
new client got no help when its list was empty. `collectEvidenceOnly` + a "Read the site" prompt now
covers that — crawl only, no AI, no run recorded.

## 5. Production reality (query it, don't assume)

- 3 users / 3 workspaces — **two are smoke tests** (`CG Production Smoke A/B`). Only **`Axiom Web`**
  (`ws_de95f565e4854ae28ced`) is real, with 2 clients.
- **14 runs, 13 inconclusive, 1 opportunity ever created** (and dismissed).
- **4 of 6 clients have 0 or 1 offerings.** The engine needs 2. Those runs were structurally
  guaranteed to fail. This is a *setup* failure, not an engine failure — the whole basis of §7.

```bash
npx wrangler d1 execute client-growth-production --env production --remote --json --command "..."
```
Note: the permission classifier blocks **writes** to production D1 and some reads. Don't fight it.

## 6. Open items carried in

1. **Unverified prediction.** Client `client-kids-connect-frhx` should produce exactly one
   `no-service-pages` finding at ~90% confidence — proven offline against the live crawl, not yet in
   production. Blocked on: a service tagged `service-pages-build` must exist in that workspace's
   catalog (add via Services UI), then re-analyze. More than one finding, or confidence < 80%, means
   something regressed.
2. **`BETTER_AUTH_URL` trap.** Pinned to the workers.dev URL at `wrangler.jsonc:64`. The user is
   pointing `orbit.getaxiom.ca` at the Worker — sign-in breaks unless this is updated in the same deploy.
3. **Infra still named `client-growth`** (Worker, both D1 databases, package). Deliberate — renaming
   means recreating bindings and migrating data. Product-facing strings are all "Axiom Orbit".
4. **Known accuracy gaps, not fixed:** `bartlett.com` (JS-rendered nav, crawler finds 0 links);
   `bloordental.com` judged analyzable from a 1-page crawl with 2 blocked events — same shape as the
   bug already fixed, worth a look; minor suggestion noise ("Class A", "Back Pain").

## 7. The top 5, in priority order

**1. There is no billing.** No Stripe, no plans, no trial, no gating — the schema has none of it.
The product cannot be sold in its current state. Weeks from launch this is the long pole.

**2. First run must end in a finding, not an empty state.** 13/14 runs inconclusive is the moment a
paying customer decides. **This is where the animated/guided onboarding belongs.** The crawl really
does take 10–20s — animate *that*: "reading northwindheating.co.uk… 9 pages… found 4 services…
checking each against the site." Earned motion that doubles as proof the product does something hard.
Animation as decoration is waste. Existing pieces to build on: `app/routes/onboarding.tsx`,
`collectEvidenceOnly`, `suggestOfferings`, and `ProductTour` in `app/components/tour.tsx`.

**3. The proposal must leave the app.** Drafts currently "stay inside Axiom Orbit until you copy them
out". The value loop doesn't close. Needs export/send/share — PDF or link.

**4. Crawl reach is the engine's ceiling.** 21% unanalyzable is the churn risk. `bartlett.com` is the
pattern. Measurable via the benchmark; needs headless rendering or smarter discovery.

**5. Production is unobservable.** No dashboard, no error tracking, no alert when the inconclusive
rate spikes. Launching paid and blind.

**Explicitly deprioritised:** bulk client import, confidence explainers, digest email, AI-drafted
service catalog. Good, none launch-critical.

## 8. Working agreements from this session

- **Verify by looking, not by reading the diff.** Multiple bugs this session were invisible in the
  diff and obvious in a screenshot (colliding buttons, clipped rows, an unreachable Log out).
- **Measure accuracy against the corpus**, and when adding a filter, keep a genuine service beside the
  noise in the test so a future filter can't pass by getting stricter.
- **Beware `tail`/`grep` masking exit codes in pipelines.** A stale build was deployed to production
  this way; check `${PIPESTATUS[0]}` or run the command bare.
- Stop the dev server before `rm -rf build` — it locks `build/client` on Windows.
- **Refused, and to keep refusing:** the user offered account credentials and pressed twice. Entering
  passwords to authenticate is off-limits regardless of authorisation. It cost nothing — the harness
  tested 24 sites instead of 5, with no production writes. **A password was pasted in that session's
  chat; the user said they would rotate it. Confirm they did.**

## 9. Suggested skills

- **`ui-ux-pro-max`** — the user invoked it for the redesign. Useful for onboarding UI. Caveat: its
  `--design-system` palette output was generic trust-blue/orange and was *not* used; its style and
  typography-structure matches were sound. The brand pack overrides it either way.
- **`artifact-design`** / **`artifact-diagramming`** — if publishing any plan or report as a page.
- **`tdd`** — this repo has strong test discipline (643 tests, tests that encode *reasoning*).
  Match it; don't bolt tests on afterwards.
- **`diagnose`** — for the crawl-reach work in §7.4, which is a genuine root-cause hunt.
- **`code-review`** — before the launch deploy.

Do **not** reach for `orchestration` / subagents unless asked; the user has not requested them and
the work has been tractable single-threaded.
