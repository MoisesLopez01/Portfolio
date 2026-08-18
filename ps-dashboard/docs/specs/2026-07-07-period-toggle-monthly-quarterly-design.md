# Period Toggle — Monthly & Quarterly Views (Exec Brief · Team Radar · Trends)

**Date:** 2026-07-07 (2026.W28)
**Status:** Approved design, pending implementation plan
**Files:** `PS Dashboard.html` (primary), `PS Contribution Report.js` (history windows)

## Problem

The dashboard measures PS team health week after week, but managers and the CEO
also need to review a closed **month** or **fiscal quarter** as one evaluated
period. Today the Executive Brief narrates a single week, the Team Radar
evaluates a single week, and the Trends charts plot weekly points only.

## Decision summary

| Decision | Choice |
|---|---|
| Interaction model | Granularity toggle `[Week \| Month \| Quarter]` + specific-period picker |
| Views in scope | Executive Brief, Team Radar, Trends (all three) |
| History depth | Two fiscal quarters (extend backend Goals/PTO windows) |
| Brief format | Same Facts/Highlights/Notes/Concerns/Trends sections, period lens |
| Aggregation location | Client-side, after `getFilteredEmployees()` |

## 1. Period model & shared UX state

- **Granularity**: `week` (default, today's behavior) · `month` · `quarter`.
- **Months** are calendar months. A week belongs to the month containing its
  **Thursday** (ISO 8601 majority-of-workdays rule). Example: 2026.W27
  (Jun 29–Jul 5) → July 2026. No week is ever split across two months.
- **Quarters** are fiscal quarters (e.g. `FY26Q4`), consistent with Goals/SI,
  resolved from the existing fiscal context (`Q4_BASE_ISO_WEEK` machinery /
  `meta.fiscalContext`).
- **Labels** always carry the ISO week range:
  `Jun 2026 · 2026.W23–W27`, `FY26Q4 · 2026.W14–W26`.
  The current period is suffixed `(in progress)`.
- **Shared state**: `STATE.periodGranularity` + `STATE.selectedPeriod` are
  shared across the three views. Selecting "Jun 2026" on the Brief keeps the
  Radar and Trends evaluating June when switching tabs. Changing granularity
  defaults `selectedPeriod` to the most recent **closed** period.
- **Controls**: each of the three tabs renders the same compact segmented
  control next to its existing picker. The Brief's week dropdown and the
  Radar's "Evaluate Week" dropdown (`radarWeekSelect`) become period-aware:
  in `week` mode they list weeks exactly as today; in `month`/`quarter` mode
  they list the available periods.

## 2. Backend changes (`PS Contribution Report.js`)

History-window extensions only — **no server-side aggregation**:

1. **Goals** — compute the prior quarter's weekly compliance *always*, not
   only during the grace period. Reuse the existing `goalsPrevResult` +
   `mergeGoalsResults_` machinery; the Goals sheet already holds all quarters'
   rows, so this is one extra pass over already-loaded data. `goalsQ4Hist`
   (and `continuityQWeeks`) then span two quarters. Grace-period display
   semantics (frozen snapshot, per-week dual view) are unchanged.
2. **PTO** — extend `ptoQ4History` back to the prior quarter's start using the
   same `readPTOPlanningHealthByWeek_` over the widened continuity window.
   Linear cost per week.
3. **Tracked/Planned/Kudos/Comments** — bump `CONFIG_PS.TRACKED_HIST_WEEKS`
   from 24 to 27 so `trackedHistory` always covers two full fiscal quarters.
4. **RCR / SI** — untouched. `meta.rcrHistory` (FY-to-date monthly) and
   `meta.siHistory` (quarterly) already ship what the period views need.
5. Payload grows modestly; the 5-minute cache model is unchanged. Deployment
   bumps `PS_CACHE_VER` as usual so the wider payload takes effect immediately.

Naming: keep the `goalsQ4Hist` / `ptoQ4History` payload keys (frontend compat);
their JSDoc is updated to say "current + prior fiscal quarter".

## 3. Client aggregation module (new, in `PS Dashboard.html`)

A pure-function layer, applied **after** `getFilteredEmployees()` so delegate
scope, FTE/Crew mode, and team filters are respected in every period view.

- `buildPeriodBuckets(granularity)` →
  `[{ key, label, weekRangeLabel, weekLabels: [], isPartial }]`
  Maps the shipped weekly history (`trackedHistory` labels as the week
  universe) into month/quarter buckets via the Thursday rule and fiscal
  quarters. `isPartial` = the period contains the current (unclosed) week or
  extends beyond the available history window.
- `aggregateBucket(bucket, filteredEmps)` → one object shaped like a weekly
  history entry, using per-metric semantics:

| Metric | Period value |
|---|---|
| Tracked / Planned time | **Average hrs/person/week** across the period's closed weeks; period totals also kept |
| Kudos | **Sum** over the period |
| Goal self-comments | Average comments/person/week; commented-% averaged across weeks |
| Goals compliance | **Period-end standing** — last closed week's compliance % (point-in-time standing, not additive) |
| PTO health | **Period-end standing** (same reasoning) |
| RCR | Month → that month's native `rcrHistory` value. Quarter → mean of the quarter's monthly team values, flagged **approx** (true RCR is SUM(RC)/SUM(TCC), never an average of averages) |
| SI | Quarter → native quarterly value. Month → owning quarter's value, shown as context |

## 4. Per-view behavior

### Executive Brief
- Same section structure: Facts / Highlights / Notes / Concerns / Trends.
- Every statement is computed over the selected bucket and compared with the
  **prior bucket**: "Tracked time avg 31.2h/person in Jun 2026, up from 29.8h
  in May".
- The Brief's internal Trends section shows week-by-week progression *inside*
  a month, and month-by-month progression inside a quarter.
- Header: `Team Executive Brief — Jun 2026 (2026.W23–W27)`.
- Copy-to-clipboard and the Gemini polish pipeline are reused unchanged (the
  store/prompt already serialize whatever sections contain).

### Team Radar
- "Evaluate Week" becomes "Evaluate Period" (same select element, period-aware
  options).
- Standing axes (Goals, PTO Health) evaluate at the period-end week; flow axes
  (Tracked compliance, Planned compliance, Kudos, Tracked avg, Planned avg)
  use period averages/sums normalized exactly as today.
- The prior-week reference polygon becomes prior-month / prior-quarter.
- The Data Reference tab's "Team Radar — Axis Definitions" copy is updated to
  describe period mode.

### Trends
- In Month/Quarter mode, weekly charts re-bucket their x-axis into period
  points: Time Momentum, Goals Standing, PTO trend, correlation charts, and
  the project heatmap columns.
- The RCR card is already monthly — unchanged in Month mode; grouped into
  fiscal quarters (approx-flagged mean) in Quarter mode.
- Trends verdict lines (target → gap → direction → action → owner) recompute
  against the bucketed series.

## 5. Edge handling

- **In-progress periods**: labeled `(in progress)`; numbers use closed weeks
  only; the Brief states coverage explicitly ("4 of 5 weeks closed").
- **Missing prior bucket** (e.g. quarterly Goals beyond the 2-quarter window):
  comparisons degrade to "no prior-period data" — never a fake zero or 0%.
- **Quarter-boundary weeks**: a week shared by two quarters dedupes the same
  way `continuityQWeeks` already does — the current-quarter copy wins.
- **Legacy payloads** (cache still serving the old window): period views
  render with whatever weeks exist and mark buckets `isPartial`; no errors.

## 6. Testing

- `_test_periodBuckets()` (GAS editor + Node-runnable like
  `_test_weightsResolver`): week→month Thursday-rule mapping incl. boundary
  weeks (W27-type straddles), week→fiscal-quarter mapping, in-progress
  flagging, prior-bucket resolution.
- Browser QA matrix: {Brief, Radar, Trends} × {Week, Month, Quarter} ×
  {unfiltered, delegate scope, FTE/Crew, team filter}.
- Exec Brief smoke: copy-to-clipboard output and one Gemini polish run in
  Month and Quarter modes.

## Out of scope

- No new backend rollup endpoints; no per-period caching.
- No FY-to-date (>2 quarters) history for Goals/PTO in this iteration.
- No PDF/email export of the period brief (existing copy/PNG export only).
