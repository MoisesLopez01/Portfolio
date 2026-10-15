# Performance Record: hours at a glance and plain-English help — 2026.W42

**Date:** 2026-10-14 · **Surface:** 📈 Performance Record and 📖 Documentation in the Contribution Report · **Audience:** managers and above

## What you asked for

Managers reading a person's record wanted two things: the plain hour totals behind the time rates (how many hours were planned and logged this week, this month, this quarter), and a way to understand what each rate means without guessing. One manager could not tell what "the rate for Goals" was. Both are now built into the tab.

## What you will see

**Hours in the history table.** The Logged time and Planned time rows of the history table ("The 8 weeks up to the evaluated week", or month by month, quarter by quarter) now show the plain hour total for each period and nothing else: hours logged, hours planned, per week, per month, per quarter. No ratio is added; the colour is the only judgement. The table is now one real table, so every value sits directly under its period header, whatever the cell holds. (A separate "Hours at a glance" block with a "% of plan" column was built first and removed the same day at the user's request.)

**PTO balance.** The PTO plan row shows the PTO balance in hours at the close of each period, coloured Good / At risk, instead of a bare "Good". The evaluated-week tile, the grid tooltip and the evidence panel show the balance too.

**RCR is context, not a focus.** The rocketeer does not control RCR, so it stays on the metric checklist (its cell, its colour, its monthly chart in the evidence) but it no longer appears in "The short version", in "Worth asking about", in the Team grid's lane or Why, or in the flag counts.

**Help where you need it.** Hover any measure name (in the history table or the Team grid headers) for a plain-English explanation of what it measures, how its rate is built at week, month and quarter grain, and where the bar sits. Click the name, or the ⓘ beside a grid header, and Documentation opens on the matching section, highlighted. The Goals explanation says it outright: the rate is the share of checked weeks that passed, so up to date in 3 of 4 weeks of a month shows as 75%.

**Documentation.** The Performance Record section gained a table, "How every rate is built — week, month, quarter", with one row per measure: the one-week reading, the month or quarter reading, and the bar.

**PNG exports.** The person card, the grid's evidence panel and the grid itself now save in one format: the whole history table (nothing scrolled off or clipped), the action buttons out, the same file name pattern (`performance-card-<name>-<period>.png`).

Also in this release: the hover bubbles on the Team Contribution Pulse rows of the Overview, published on 2026-10-13, had been dropped by the deployments that followed the same day. They are back.

## What did not change

- Who can see whom: the tab still reads only the report the server already scoped to you, and nobody but a super admin sees their own record.
- The signals and bars: every colour on the tab is the same as before; the hours are shown beside them, not instead of them.

## Where it lives

- Branch `worktree-perf-record-hours-help` (local repo, D:\Development), on top of the @299 baseline.
- Design spec: `ps-dashboard/docs/specs/2026-10-14-perf-record-hours-and-help-design.md`.
- Tests: `tests/perf-record-help-checks.js` (new) and `tests/perf-record-checks.js`.

## Follow-up the same week: from the hour total to Tempo (2026.W42)

Every hour total on the person card — Logged time and Planned time, in the history table at every grain and in the week-by-week evidence — now opens the same person and the same period in Tempo's own report (Logged Time or Planned Time), grouped by space and work item, in a new tab. This is the field review's first ask: reach the primary evidence from the metric without rebuilding the filter by hand. The worker id comes from the `Capacity Tempo` tab; a person without one keeps the plain number. Tempo applies its own permissions once the link opens. Spec: `ps-dashboard/docs/specs/2026-10-14-perf-record-tempo-links-design.md`; tests: `tests/perf-record-tempo-links-checks.js`. Branch `worktree-tempo-links`, not yet deployed — bust the report cache after deploying.
