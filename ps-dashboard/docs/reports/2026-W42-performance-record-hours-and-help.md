# Performance Record: hours at a glance and plain-English help — 2026.W42

**Date:** 2026-10-14 · **Surface:** 📈 Performance Record and 📖 Documentation in the Contribution Report · **Audience:** managers and above

## What you asked for

Managers reading a person's record wanted two things: the plain hour totals behind the time rates (how many hours were planned and logged this week, this month, this quarter), and a way to understand what each rate means without guessing. One manager could not tell what "the rate for Goals" was. Both are now built into the tab.

## What you will see

**Hours at a glance.** Under the Week · Month · Quarter tiles on a person's card there is a small table with hours planned in Tempo and hours actually logged for:

- the evaluated week, then the current week so far;
- the last closed month, then the current month so far;
- the last closed quarter, then the current quarter so far.

Each row shows "Of plan" (logged ÷ planned, not capped, so a week with more logged than planned reads above 100%) and, for a month or a quarter, the average per week. Rows still running are faded and marked "so far". The same table opens at the top of the evidence panel in the Team grid.

**Hours in the history table.** The Logged time and Planned time rows now show the hour total in the cell and the rate underneath, so you read hours first.

**Help where you need it.** Hover any measure name (in the history table, the Hours block or the Team grid headers) for a plain-English explanation of what it measures, how its rate is built at week, month and quarter grain, and where the bar sits. Click the name, or the ⓘ beside a grid header, and Documentation opens on the matching section, highlighted. The Goals explanation says it outright: the rate is the share of checked weeks that passed, so up to date in 3 of 4 weeks of a month shows as 75%.

**Documentation.** The Performance Record section gained a table, "How every rate is built — week, month, quarter", with one row per measure: the one-week reading, the month or quarter reading, and the bar.

**PNG exports.** The person card, the grid's evidence panel and the grid itself now save in one format: the whole table (nothing scrolled off or clipped), the action buttons out, the same file name pattern (`performance-card-<name>-<period>.png`).

Also in this release: the hover bubbles on the Team Contribution Pulse rows of the Overview, published on 2026-10-13, had been dropped by the deployments that followed the same day. They are back.

## What did not change

- Who can see whom: the tab still reads only the report the server already scoped to you, and nobody but a super admin sees their own record.
- The signals and bars: every colour on the tab is the same as before; the hours are shown beside them, not instead of them.

## Where it lives

- Branch `worktree-perf-record-hours-help` (local repo, D:\Development), on top of the @299 baseline.
- Design spec: `ps-dashboard/docs/specs/2026-10-14-perf-record-hours-and-help-design.md`.
- Tests: `tests/perf-record-help-checks.js` (new, 79 checks) and `tests/perf-record-checks.js` (220 checks).
