# Performance Record — hours at a glance and plain-English help

**Date:** 2026-10-14 (2026.W42) · **Surface:** `PS Dashboard.html`, 📈 Performance Record + 📖 Documentation · **Status:** live as @300 (GTT-943, 2026-10-14)

### PNG exports (added the same day)

One routine, `perfCapturePng_`, serves the person card, the grid's evidence panel and the grid export: scale 2, theme background, action chrome hidden, `pr-print` on the element (`pr-printing` on the people host), every horizontal scroller reset to 0 and opened, the measure column unstuck, the card forced to one column with the list hidden so the History and Hours tables come out whole; the panel's print grid lets `.span2` blocks (Hours) span both columns. Filenames follow the card: `performance-card-<name>-<grain>.png`; the grid keeps `performance-record-<grain>-<week>.png`. The evidence fold and the hover hint leave the capture.

## Why

Two things managers kept asking in 1:1s and calibration threads:

1. *"How many hours did they actually plan and log?"* The tab only showed rates — Logged time as a percentage of target, Planned time as hours per week — and the hour totals were buried in the evidence charts. A manager reads hours first and rates second.
2. *"What does the rate for Goals mean?"* A manager saw "Goals 75%" and could not tell whether it was a share of goals, of comments or of weeks. The formula lived in Documentation, but nothing on the tab pointed there.

The ask: total hours per week, then per month, then per quarter; a plain-English hover on every measure; and a way from the measure straight to the Documentation paragraph that defines it (goals and its calculation, PTO, kudos, and so on).

## What changed

### Hours at a glance

A small table, rendered by `perfHoursHtml_` from `perfHoursRows_`, in two places:

- the **person card** (People view), under the Week · Month · Quarter tiles;
- the **evidence panel** of the Team grid, right after the exception report, at every grain. The embedded copy of the drill inside the card skips it so the card never shows it twice.

Rows, per grain: the **closed** period first, then the period **still running** under it, faded and marked *so far*.

| Period | Planned | Logged | Of plan | Per week |
|---|---|---|---|---|
| Week · 2026.W40 (evaluated week) | 37 h | 36 h | 97% | |
| 2026.W41 · so far | 37 h | 37 h | 100% | |
| Month · Sep 2026 · 4 weeks with data | 152 h | 146 h | 96% | 37 h / 38 h |
| Oct 2026 · so far | … | | | |
| Quarter · FY27Q1 · 13 weeks with data | 496 h | 486 h | 98% | 37 h / 38 h |
| FY27Q2 · so far | … | | | |

- The week row is the **evaluated week** (People view drop-down) or the last closed week (grid); the current week follows when it is a different one.
- Hours come from the same per-bucket aggregates the history table and the grid read (`perfBucketAgg_` → `trackedHrs` / `plannedHrs` sums, `weeks` = weeks with data), so the three surfaces cannot disagree.
- **Of plan** is logged ÷ planned, **not capped** — a week with more logged than planned reads above 100%. It is deliberately a different number from the Logged time *rate* (logged ÷ 90% of plan, capped), and the tip says so.
- The **colour** is the Logged time signal for the bucket against the cohort bar (IC / manager), so the table never contradicts the dot on the row. A job family outside the time mandate gets slate (shown, not evaluated) and a note.
- Teams without the tracked metric (team gate) render no block.

### Hours in the places that already showed rates

- **History table** (card): Logged time and Planned time now show the **hour total in the cell and the rate underneath** (`37 h` over `100% of target`; for a month `146 h` over `96% of target · 37 h/wk`). Signal colouring is unchanged.
- **Team grid tooltips**: Tracked and Planned cells append the plain hours behind the rate — `logged 36 h of 37 h planned in 2026.W40`, or `… over 4 weeks` for a month.
- The evaluated-week tile uses the same rounding as the table (`perfHrs_` → `perfFmtHrs_`: whole hours from 10 h up, one decimal below).

### Plain-English help (`PERF_METRIC_TIPS`)

One registry per measure (score, goals, tracked, planned, rcr, kudos, pto, si, plus `hours`), each with:

- `title`, `text` — what it measures and how the rate is built at week / month / quarter grain, in words a manager can repeat; the Goals entry says outright that the rate is *the share of checked weeks that passed — 3 of 4 weeks in a month shows as 75%*;
- `note` — the bar, named **Met / Close / Missed** (the card legend's words) rather than a colour, because the grid paints the same signal in green/yellow/red and the card in green/blue/orange;
- `doc` — the Documentation anchor the label opens.

Surfaces:

- **History table** measure names and the **Hours at a glance** heading are real `<button>`s (`perfTipLabel_`): hover or focus shows the bubble, click (Enter/Space) opens Documentation.
- **Team grid headers**: the label span carries the bubble; the header click stays the sort, and a **ⓘ** beside it (`perfDocLink_`) opens Documentation. The bubble's footer says which is which.
- The *How to read the score* box links to the rates table.

The bubble is the one that shipped for the Team Contribution Pulse rows in 2026.W42 (`#pulseTip`, `initPulseTips_`): fixed-position so no scrolling container clips it, delegated listeners so re-renders need no re-binding. The selector now accepts any `.tipq[data-tip]` element, reads `data-tip-title`, and adds a footer when `data-doc` / `data-doc-via` is set. `focusin`/`focusout` mirror the pointer events; a scroll that follows a focus repositions the bubble instead of closing it.

### Documentation anchors and the rates table

- Stable ids on the sections the tips point at: `docMetrics`, `docRcr`, `docSi`, `docGoalsMetric`, `docPlanned`, `docTracked`, `docKudos`, `docPto`, `docGoals` (Goals Evaluation — the calculation), `docPerfRecord`, and a new `docRates`.
- `openDocSection_(id)` switches to the Documentation view, scrolls the target just under the sticky top bar and flashes it (`.doc-flash`), clearing any earlier flash.
- The Performance Record section gained a row for *Hours at a glance*, a note on hover help, and **How every rate is built — week, month, quarter**: one table with, per measure, the one-week reading, the month/quarter reading and the bar. This is where Score, Logged time, Planned time and the Hours block send the reader; Goals sends to Goals Evaluation; RCR, Kudos, PTO and SI to their metric cards.

## Where the tips send the reader

| Measure | Opens |
|---|---|
| Goals | Goals Evaluation (`docGoals`) — the three rules and the grace window |
| Score · Logged time · Planned time · Hours | How every rate is built (`docRates`) |
| RCR | RCR metric card (`docRcr`) |
| Kudos | Kudos metric card (`docKudos`) |
| PTO plan | PTO metric card (`docPto`) |
| SI rating | SI metric card (`docSi`) |

## Invariants

- Nothing new comes from the server: scope and self-exclusion stay exactly the payload's (see the `VIEWS` comment on Performance Record).
- `perfFmtHrs_`, `perfHoursLine_` and `perfHoursPhrase_` sit inside the pure engine region (`⟦PERF-ENGINE-START⟧ … END⟧`) and must stay free of `DATA` / `STATE` / DOM references.
- Tip copy never names a colour; it names Met / Close / Missed.
- Every `doc` anchor in `PERF_METRIC_TIPS` must exist exactly once in the page.

## Tests

- `tests/perf-record-checks.js` — `perfFmtHrs_` rounding, `perfHoursLine_` (uncapped pct, no-plan, zero-plan, nothing recorded, per-week averages), `perfHoursPhrase_`.
- `tests/perf-record-help-checks.js` — every `PERF_COLS` id has a tip, tips are prose without HTML or colour words, every anchor exists once, Goals opens Goals Evaluation, the rates table says *3 of 4 = 75%*, the bubble accepts `.tipq`, keyboard handlers exist, the hours surfaces are wired, the helpers live in the engine region.
- `tests/pulse-tips-checks.js` — unchanged and still green (the bubble generalisation keeps the pulse wiring).
- Render check with `tests/render-harness` (Playwright): card hours rows, history cells, bubble on hover and on focus, click → Documentation with the section flashed under the top bar, grid headers with ⓘ, grid tooltip text, panel block order.
