# Performance Record merge (Leading Behaviours) + top bar — design

**Date:** 2026-10-10 (2026.W41) · **Status:** implemented locally, not deployed (see the W41 report)
**Report (plain English):** `ps-dashboard/docs/reports/2026-W41-performance-record-and-filters.md`
**Mock approved:** https://claude.ai/artifact/8kRY1KSxaaJV8R9yDa5D2r
**Builds on:** `2026-08-18-performance-record-*` specs, `2026-09-10-sidebar-shell-brand-design.md`, branch `ps-dash/compact-topbar`.

## 1. Navigation

- The `rocketeers` VIEWS entry, its static sidebar button, pane (`#tabRocketeers`), renderer
  (`renderTopRocketeers`, `toggleAllRocketeers`, `togglePerfCard`) and week select
  (`#rkWeekSelect`, `populateRkWeekSelect`) are removed. The `.perf-*` card CSS is left in place
  because it sits inside type-scale selector groups that `responsive-checks.js` asserts on.
- Order in VIEWS and in the static `#tabNav` buttons: overview, radar, **perfrecord**, trends, execbrief.
- `switchTab()` aliases `"rocketeers"` → `"perfrecord"` before resolving the view, so saved state,
  old links and `previewWeights()` (now "Preview on Performance Record ↗") still land.

## 2. Performance Record — two layouts

`STATE.prView` = `'people'` (default) | `'grid'`. `renderPerfRecordTab_()` is now the dispatcher:
it renders the header controls (`#prViewCtl`, `#prGranCtl`, `#prEvalWeekSelect`), then calls
`renderPerfPeople_(emps)` or `renderPerfGrid_(emps)` (the former grid renderer, unchanged apart
from losing the control rendering). The grid's slide-in panel (`renderPerfPanel_`) only opens
in grid view.

### 2.1 Lens

`STATE.prLens` = `'eval' | 'week' | 'month' | 'quarter'`; `STATE.prGranularity` follows it
(`eval` → `week`) so the grid, the embedded evidence and `perfModel_()` keep their meaning.
`prSetLens_` (people view) and `prSetGran_` (grid / evidence) keep both in sync.

| Lens | List value (`perfLensValue_`) | Delta | History columns (`perfHistory_`) |
|---|---|---|---|
| eval | `computeRkScore(emp, STATE.prEvalWeek ‖ last closed week).score` | vs previous open week | the 8 weeks up to the evaluated week, built with `perfEmpAggs_` |
| week | mean of the last 8 closed weeks | vs the 8 before | `perfModelFor_('week')` buckets (8 closed + current) |
| month | `perfModelFor_('month')` last closed bucket score | vs previous closed bucket | month buckets of the 3-quarter window |
| quarter | `perfModelFor_('quarter')` last closed bucket score | vs previous closed bucket | quarter buckets; SI row from `meta.siByEmployee[norm][FYxxQy]` |

A week is "empty" (no score) when `perfWeekIsEmpty_` says so — pre-hire weeks never count.

### 2.2 Models per granularity

`perfModel_()` became `perfModelFor_(gran)` with one memo slot per granularity
(`_perfModelByGran`), because the card reads week, month and quarter models side by side and a
single-slot memo would rebuild on every render. `_perfModelMemo` still points at the grid's model
for the grid's per-row cell cache. The per-employee aggregation moved to `perfEmpAggs_` (shared by
the models and the eval-lens history) and the grace-week set to `perfGraceLabels_()`.

### 2.3 Ranking population

`perfRankable_(emp)` = not ramp-up and not on extended leave (Leading Behaviours parity). Rankable
people with a null value for the lens and non-rankable people are listed apart (with the reason)
under the ranked list. Ties break by name.

### 2.4 Bands

`perfTier_()` reuses `PERF_BARS.score` (75 / 50): Strong / On track / Needs a look. The mock showed
the old Leading Behaviours 45 cut-off; one tab cannot carry two rules, so the grid's existing bars
win. Changing the bars changes the grid, the list and the card together.

### 2.5 Plain-English engine (pure, tested)

Inside the `⟦PERF-ENGINE⟧` sentinels: `perfTier_`, `perfAvg_`, `perfCap_`, `perfTrendWord_`,
`PERF_STORY_METRICS`, `perfStory_(inp)`. `perfStoryInput_` (glue, outside the engine) builds `inp`
from the last 13 closed weeks:

- `met[metric]` per week is `true` / `false` / `null` (not evaluable). It is judged with the same
  cohort bars as the grid (`perfSignalFor_ === 'g'`). Carved metrics (`perfExceptions_`), metrics
  the team lacks (`hasMetric_`) and non-compliant grace weeks are `null`, so they are never counted.
- RCR: last 3 months of `meta.rcrByEmployee`. The bar is `PERF_BARS.rcr[cohort].g` (2.0) and the
  target is 2.5.
- Flags: `onLeave`, `ramp`, `crew`, `noMandate`, plus `ptoWeeks` (weeks whose PTO-adjusted
  target is under 40 h).

`perfStory_` rules:

- trend = last 4 scored weeks vs the 4 before, ±6 points
- tier = mean of the last 8 scored weeks
- strength / gap = best / worst hit rate among measures with ≥ 3 evaluable weeks; "mostly in
  <month>" only when that month holds ≥ half of ≥ 3 misses
- "worth asking" = a measure missed ≥ 2 of the last 4 weeks; kudos only when absent all 4 weeks
  (kudos is never a miss on its own, matching the grid's never-red rule); RCR under its bar
- context lines for every exception
- observations only, no recommendations

### 2.6 Card

`perfCardHtml_` contains, in order:

1. head (name, meta, exception chips, verdict and trend pills, Copy summary, PNG, Open in Overview)
2. the short version
3. week / month / quarter tiles (`perfTiles_`)
4. worth asking about and context
5. history chart and table
6. "Full evidence": `perfDrillHtml_(…, { embedded: true })`, the existing drill without its own
   header
7. how to read the score

The card is a size container (`container-name: prpcard`); at ≥ 1100 px card width it splits into
two columns. Copy summary is `copyPerfStory_` (plain text); the PNG is `savePerfCardPng_`, which
`exportPerfGridPNG_` also uses in people view.

### 2.7 Interaction and state

- One delegated click listener on `#prPeople` (`prWirePeople_`): items, KPI counters
  (`STATE.prTier`), `[data-lens]` tiles and buttons, `[data-act]` actions.
- Selection: `STATE.prSel`. It falls back to the top of the visible list when filtered away.
- URL state (`google.script.history`): `view`, `lens`, `wk`, `sel` were added beside the existing
  `gran`, `emp`, `focus`.
- The list keeps its scroll position across re-renders. The history table opens scrolled to its
  newest column.
- `.prp-list` is `position: sticky` under `--topbar-h`. `#tabPerfRecord > .section-card` uses
  `overflow: clip`, not `hidden`, because `hidden` makes the card the sticky scroll container.
- Phone (≤ 720 px): `.prp-card` is hidden. Selecting a person sets `STATE.prCardOpen` and
  `body.prp-card-open`, which shows the card fixed full screen. "‹ All people" (`prCloseCard_`),
  Esc, or leaving the tab closes it.

## 3. Top bar (on top of `ps-dash/compact-topbar`)

| Behaviour | Mechanism |
|---|---|
| Fold on scroll | `initShell_` scroll listener toggles `body.tb-scrolled` at > 80 px, clears at < 24 px (hysteresis); CSS hides `.header`. `--topbar-h` follows through the existing ResizeObserver. |
| Wide alignment | `@media (min-width: 1024px) body .header, body .filter-bar` pad to `max(24s, (100% − 1600s)/2 + 24s)` (s = `--scale`), i.e. `main`'s content edge. |
| Phone drawer | ≤ 720 px: `--navw: 0`, `.sidenav` translated off-canvas, `#btnMenu` in the header toggles `body.navOpen` (`toggleNavDrawer_`), `#navScrim` closes it, `switchTab` closes it. Labels/logo shown in the drawer. |
| Phone filter sheet | ≤ 720 px: the bar shows `.fb-search` + `#fbMoreBtn` ("Filters", count `#fbAllCount` = folded + member type ≠ FTE + supervisor). `toggleMoreFilters_(open)` toggles `body.fb-sheet-open`, which turns `.filter-bar` into a fixed bottom sheet with labels visible and `#fbDoneBtn` ("Show N Rocketeers"). `.topbar` is lifted to z-index 270 while open because the sheet sits inside its stacking context (z 100) and would otherwise render under `#fbScrim` (z 250). |
| Esc | closes the sheet, then the drawer. |

Chips for active filters (in the mock) were not built: the approved one-row bar marks folded
filters with a count and an active colour, at no extra row.

## 4. Tests

- `tests/perf-record-checks.js`: tiers, averages, trend word, `perfStory_` scenarios (steady,
  rising, falling, low, ramp-up, leave, crew + PTO, RCR, empty) and static guards (view removed,
  alias, VIEWS order, button order, default view, delegated clicks, size container, sticky list,
  phone sheet, embedded drill, per-granularity memo).
- `tests/responsive-checks.js`: icon count 6 (5 tabs + collapse), the `toggleMoreFilters_(`
  signature, scroll fold, wide alignment, phone drawer, phone bar contents, phone sheet, Filters
  count, sheet labels, Esc.
- Render harness: `tests/render-harness/` holds `fixture.js` (synthetic payload, 40 fake people),
  `stub.js` (a `google.script.run` stub that answers `getPSReportData` with the fixture) and
  `open.js`. Copy the three files and `PS Dashboard.html` (as `dash.html`) into the worktree's `.playwright-mcp/`, then run `open.js` with `browser_run_code_unsafe`; both scripts are added with `page.addInitScript`, so the page boots normally. The fixture has no team KPIs, so Overview logs one `toFixed` error — unrelated to Performance Record.
