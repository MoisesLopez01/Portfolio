# Week-of-Quarter Cadence Combo Chart — Policy Lab (GDash)

**Date:** 2026-07-08 (2026.W28)
**File:** `GDash.html` (Policy Lab tab only — frontend, no backend/payload change)
**Visibility:** admin only (inside the existing admin-only Policy Lab)
**Status:** Approved design, pending implementation plan

## Purpose

Make the end-of-quarter comment back-loading behavior undeniable to a
non-technical audience: overlay the most recent 4 fiscal quarters on a single
week-of-quarter axis so a shared spike into the grace-period weeks is obvious at
a glance. Answers "where does the comment weight land in the quarter, and is the
cramming systemic across quarters?"

## Chart

One Chart.js combo chart appended to the Policy Lab, below "Behaviors & spread".

- **X-axis:** week-of-quarter, 1..N (N = max quarter length across the shown
  quarters, ~13). Alignment by week-of-quarter (not calendar week) is what lets
  quarters overlay.
- **Grace band:** the last 2 week-of-quarter columns shaded (June/peach accent,
  `BRAND.JUNE_SOFT`), labeled "grace · goals close". Uses each quarter's own
  length so the band sits at the true final 2 weeks.
- **4 line series** (most recent 4 quarters): each week's value = **% of that
  quarter's total self-comments** landing in that week-of-quarter. Brand
  categorical colors (`DEPT_COLORS`). Comparable regardless of headcount/volume.
- **Bar series (behind lines):** the **unweighted 4-quarter average %** per
  week-of-quarter — the "behaviour weight". Muted Ivory/Orbe-soft fill,
  `order` higher than lines so it renders behind.
- **In-progress quarter:** included, drawn **dashed** and labeled "(in
  progress)"; its line naturally stops at the current week-of-quarter so the
  truncation is not misread as a drop.
- **Verdict line above the chart** (counts only, per the no-names rule):
  "On average, NN% of a quarter's comments land in the final 2 weeks."
- **PNG export** button (existing `exportPNG` pattern).

## Data

Reuses what the Lab already builds via `policyQuarters_()`: each quarter's
`weeklySelf` ({ISO week → self-comment count}) and its ordered `weeks` array.
Map each ISO week to its index in `weeks` (1-based) = week-of-quarter. Aggregate
self-comment counts per week-of-quarter across all people in the quarter, divide
by the quarter's total self-comments → percentage series. No backend change; the
current quarter's `weeklySelf` comes from the already-present `employees`
records, prior quarters from `history` blocks.

Quarter selection: the most recent 4 quarters available (history + current),
newest last. If fewer than 4 exist, show what's available (down to 1).

## Pure helper (unit-tested in Node)

`weekOfQuarterPct_(weeklySelf, weeks)` → array of length `weeks.length`, each =
% of the quarter's total self-comments in that week-of-quarter (0 when the
quarter has no comments). Tested: even distribution, all-in-final-week, empty.

## Out of scope

- Manager/Rocketeer toggle (this chart is population-wide by design).
- Per-person drill from the chart (the heatmap already drills).
- Any backend/payload/cache change.
- Non-admin visibility (stays inside the admin-only Policy Lab).

## Testing

Node: `_test`-style assertions on `weekOfQuarterPct_`; frontend script-block
parse-check; stubbed-DOM smoke that `renderPolicyLab()` still runs and the new
`renderCadenceChart_()` produces a Chart config (Chart stubbed) without throwing
on 1-quarter and 4-quarter fixtures.
