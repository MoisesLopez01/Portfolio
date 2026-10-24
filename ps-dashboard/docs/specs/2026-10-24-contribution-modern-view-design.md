# Contributor Intelligence — modern view (prototype for the PS Dashboard)

**Date:** 2026-10-24 (2026.W43) · **Status:** implemented, not deployed ·
**Files:** `Contribution.js` (model + payload + endpoints), `Contribution View.html` (the page) ·
**Tests:** `tests/contribution-view-checks.js` · **Harness:** `tests/contribution-view-harness/`

## Why

`Contribution.js` only produced formatted sheets. A leader reading three wide tabs cannot
sort, filter, drill into one person or see movement. The page is also the testbed for the
PS Dashboard's next look: it uses the dashboard's own tokens, so each block can be lifted
into `PS Dashboard.html` as it proves itself.

## Design

### One model, two outputs

`runContributorIntelligence_` was split into:

| Function | Job |
|---|---|
| `buildContributionModel_(orgLeader)` | read sheets → join → org scope (leader excluded) → satellite override → segment into Contributors / Non-Contributors / Crew |
| `writeContributionSheets_(ss, model)` | the three tabs, unchanged |
| `buildContributionViewPayload_(model)` | **pure** JSON for the page |

The sheets and the page read the same model, so a number cannot differ between them.
Order inside each segment is the sheet's (Critical → Watch → Healthy → Champion → No Data;
non-contributors by tier then goal engagement).

### Entry points

| Function | Reachable from | Gate |
|---|---|---|
| `getContributionView(orgLeader)` | the page via `google.script.run` | `requireMaintainer_` |
| `showContributionView()` | menu › 🖥 Open modern view (1400×860 modeless dialog) | `requireMaintainer_` |
| `listOrgReportCandidates()` | the org selector (existing) | `requireMaintainer_` |

Same audience as the exporters: it is the same people data. `callable-surface-checks` passes.

### The page

Left rail (Overview · Contributors · Non-contributors · Crew · Teams) + one sticky top bar
(scope chip, org selector, search, reload, theme, print).

- **Overview** — five KPIs (people, group RCR with method + n, critical, goal engagement,
  SI), tier mix per segment (click a count → that slice), "needs attention" (critical
  contributors, team-risk first), contributor tier mix per month.
- **Tables** — tier pills with counts, supervisor filter, search, sortable headers,
  RCR sparkline against the 1.0 line, goal bar, SI dots, four-week hours mini-bars
  (a zero week is red), first signal with `(+n)`.
- **Drawer** — tier note, six figures, every signal, RCR chart with the three thresholds,
  weekly hours/Jira/comments, SI by quarter. Modal: focus trap, Esc, focus returns.
- **Teams** — supervisor / job-profile / region roll-ups with tier mix; a supervisor row
  opens that person's people.
- Light/dark, reduced motion, print stylesheet, ≤900 px rail becomes a top strip. Tier is
  always a word + colour, never colour alone.

### Rules that carry over

- Tier thresholds 1.0 / 1.5 / 2.5 come from `meta.thresholds`; the page never hard-codes them.
- The monthly tier-mix chart applies today's thresholds to each person's own value for that
  month. It deliberately does **not** plot a group RCR per month: ratio months and rate
  months are different methods and one line would imply they are comparable.
- Org scope: the leader's own record is excluded and the page says so (chip + footnote).
- Every free-text field goes through `esc()`; no inline handlers.

## Porting to `PS Dashboard.html`

| Block here | Dashboard equivalent / what to do |
|---|---|
| tokens (`:root`) | identical names — nothing to port |
| `.rail` / `.nav-item` | already the `VIEWS`-driven sidebar; only the `count` pill is new |
| `.kpi` with accent edge | replaces flat KPI cards on Overview |
| `.badge` + `.stack` tier mix | reusable anywhere a tier is shown |
| `spark()`, `minibars()`, `pctBar()` | pure string functions; copy as-is |
| drawer | Performance Record's drawer should adopt the focus trap |

## Not done here

- No web-app route. It opens from the Sheet menu only; serving it from `doGet` needs the
  `PS Security.js` role model (a maintainer-only gate is not the dashboard's tiers).
- No cache: each open recomputes from the sheets (~ the same cost as a sheet run).
- Not deployed, not pushed.

## Visual harness

`node ps-dashboard/tests/contribution-view-harness/make-fixture.js <dir>` writes `fixture.js`
(the real payload builder over 48 invented people, incl. a name containing HTML) and
`stub.js` (a `google.script.run` stub). Copy those plus `Contribution View.html` as `cv.html`
into `<worktree>/.playwright-mcp/`, add both as init scripts and route a URL to `cv.html`.
