# Axiom Orbit UI redesign — implementation map

The approved visual direction is `ui-design-spec/` (six reference renders at
1586×992 plus the master prompt). This is what was built against it, and why.

## Product contract

- Every React Router loader, action, database call, route and workflow is
  preserved. Nothing here changes what the product knows or does.
- The references are the source of truth for layout, hierarchy, density,
  typography and restraint. Their sample names, amounts and dates are not:
  every screen renders the workspace's real data.
- The hierarchy the app communicates stays `Client → Opportunity → Evidence →
  Action`.

## Where the design system lives

`app/styles/orbit-approved.css` is one layer scoped to `.app-frame`, so the
public showcase, the auth pages and a shared proposal keep their own
presentation. It is the only place the signed-in application's tokens are
defined:

- surfaces, four ink steps, hairlines, one accent, three semantic colours;
- a type scale measured off the references — 48px page titles, a 33px
  statement line, a 23px summary line, 17–22px row type, a 13px uppercase
  micro-label at 0.16em;
- a 264px sidebar and a 1200px content column (1120px on Home, which is
  deliberately sparser), both centred;
- radii, focus, and four motion durations (120/160/190/230ms, ease-out).

Older declarations in `app.css` and `signal-desk.css` are left alone; this
layer overrides them and defines every token they reference, so nothing falls
back to the previous palette.

## Screen mapping

- `/changes` is Home: the attention list, a small portfolio summary, and the
  week's portfolio changes kept below both so they never compete.
- `/clients` is the spacious list/table hybrid; add and import flows unchanged.
- `/opportunities` is the work queue. One row is always current and the arrow
  keys move it, which is what the highlighted row in the reference means.
- `/opportunities/:id` is the focused workspace; evidence, decisions, proposal
  generation and editing, share links, snooze, cover, dismiss and reopen all
  stay where they were.
- `/services`, `/settings` and `/operations` share one secondary Settings
  navigation, so the primary sidebar stays at four destinations.
- Client detail, imports, onboarding, loading, empty, error and confirmation
  states inherit the same system.

## Decisions worth knowing

- **Client marks are monograms**, tinted deterministically from the domain. The
  references show a distinct logo per client; fetching favicons would mean a
  third-party request per row, so the initials — real data we already hold —
  carry the same "tell rows apart" job. Opportunities and services use the icon
  for the kind of work instead, so a gap looks the same everywhere.
- **The tab strip and the Settings navigation follow the reader.**
  `useCurrentSection` measures scroll position; an indicator pinned to the
  first item is a label that lies.
- **The appearance control beside the page date is a real button** sharing one
  preference with the workspace menu, rather than a decorative sun.
- **Analysis readiness is one line with a disclosure**, not one amber banner
  per rule. A dozen identical warnings is a wall the reader stops seeing.
- **Range prices read `$900 – $1,800`** with spaces, as the references do, so a
  range does not scan as one number.

## Verification

- `test/app.approvedRedesign.test.ts` asserts the information architecture and
  required screen anatomy; the rest of the suite is unchanged.
- `scripts/design-harness.tsx` server-renders every screen with representative
  data; `scripts/harness-server.mjs` serves the output so it can be compared
  against `ui-design-spec/images/` in a browser at 1586×992.
- Checked at 1586, 1400, 1280 and 390 wide, in both themes, with keyboard
  focus, roving queue navigation and reduced motion.
