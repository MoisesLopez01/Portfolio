# Performance Record — from the hour total to the evidence in Tempo

**Date:** 2026-10-14 (2026.W42) · **Surface:** `PS Dashboard.html`, 📈 Performance Record (person card: history table and week-by-week evidence) + 📖 Documentation · **Server:** `PS Contribution Report.js` · **Status:** built on branch `worktree-tempo-links`, on top of the hours/help release (@301); not yet deployed

## Why

The field review of V3 (participants P01–P08) put one ask above every other: *reach the primary evidence from the metric*. The tab says "30 hours this week", but a manager who wants to see **which issues** those hours went to has to leave for Tempo, rebuild the filter by hand, and risk finding a number that does not match the report (P07 scored evidence 2, trust 4 for exactly that reason; P01 said the same from the other side — the detail under the summary lives in another system).

The hours themselves became plain totals per week, month and quarter earlier in 2026.W42, with a plain-English hover on every measure. This change closes the loop: **every hour total is now a link that opens the same person and the same period in Tempo's own report**, grouped by space and work item — the issues behind the number, in the system that holds it.

## What changed

### The link

An hour total in the person card — Logged time or Planned time, in the history table at every grain (evaluated week, 8 weeks, month, quarter) and in the week-by-week evidence table — is an `<a class="prp-hlink">` that opens, in a new tab:

| Measure | Tempo report | Path |
|---|---|---|
| Logged time | **Logged Time** | `…/reports/logged-time` |
| Planned time | **Planned Time** | `…/reports/planned-time` |

with the parameters Tempo's own UI writes when you build the report by hand (verified in the browser on 2026-10-14 against the two links Alex shared):

- `from` = the Monday of the earliest ISO week in the period, `to` = the Sunday of the latest, `days` = the span, `periodType=FIXED` (a fixed window, never "this week" relative to today);
- `viewType=TIMESHEET`, `dateDisplayType=weeks` (one column per ISO week, so a month shows its 4–5 weeks side by side and the Total column matches the cell);
- `groupBy=project&groupBy=issue` — **Space, then Work item**. This is the grouping that answers "in which issues"; the planned-time link Alex shared grouped by project only, and the report accepts both;
- `workerId=<Jira account id>`, URL-encoded (the colon in `712020:…` becomes `%3A`), filtered to the one person;
- the Planned Time report also carries `includeProjectPlans=false&includeRejectedRecords=false` as Tempo's UI does.

The cell keeps its signal colour; the link is a dotted underline and a small ↗, hidden in PNG/print captures (`.pr-print` / `.pr-printing`). The `title` names the report, the period and the grouping ("Open Logged time in Tempo for 2026.W41 — by space and work item"). A dash (no data) stays a dash. A person with no Tempo worker id, or a payload without the reports base, renders the plain text exactly as before — never a dead link.

### Where the worker id comes from

Tempo filters by **Jira account id**, which no dashboard sheet carried as a column — except one: **`Capacity Tempo`** (written by `TempoCapacityTime.js`) keys column A by `Account ID` with the display name in column B, and `Change Names.js` already normalises those names to the roster's, like the hours tabs. The server reads that tab once per report build (`readTempoWorkerIds_` → `parseTempoWorkerIds_`, pure and unit-tested), joins on `normPS_(name)` exactly as the hours join, and ships the id as `employees[].tempoId`. The reports base (`CONFIG_PS.TEMPO_REPORTS_BASE`: the Tempo app id and environment id inside this Jira site, stable per site) ships as `meta.tempoReportsBase`, so the page hardcodes nothing about the Tempo install.

Guards in the parser: the `Account ID` / `User` header row is located wherever it sits in the first rows (the tab has two stacked header rows), only values shaped like an account id are accepted (`712020:<uuid>`, `557058:<uuid>`, or a bare 24-hex legacy id), so the `TOTAL` and `Last Export:` footers never map, and the first row per name wins.

### Help and Documentation

- The Logged time and Planned time hover tips end with *Click an hour total to open the same person and period in Tempo, by space and work item.*
- The card's *How to read the score* hint says the same.
- 📖 Documentation: the Time planned and Time tracked metric cards name the Tempo report the link opens and note that Tempo applies its own permissions; the Performance Record *History* row explains the link as the primary evidence behind the number.

## Invariants

- **Nothing new about a person leaves the server.** The payload is already scoped per viewer (own org tree, pinned team, self-exclusion); the account id is an opaque identifier added to rows the viewer already receives. Tempo enforces its own permissions when the link opens — a manager who cannot see a timesheet in Tempo sees Tempo's empty report, not the dashboard's number.
- `perfIsoWeekRange_` and `perfTempoReportUrl_` live inside the pure engine region (`⟦PERF-ENGINE-START⟧ … END⟧`) and read no `DATA` / `STATE` / DOM; `perfTempoLink_` / `perfTempoAnchor_` are the page-side wrappers that read the payload.
- The week range is computed from the ISO label with UTC arithmetic (same rule as the server's `mondayOfIsoWeek_PS_`), so no viewer timezone can shift a Monday.
- The history cell text stays `perfFmtHrs_(…)` — the link wraps the total, it never changes it (the 2026.W42 "plain totals, no ratio" rule holds, and `tests/perf-record-help-checks.js` still asserts it).
- Month and quarter buckets keep their `weekLabels` in the history renderer (they were dropped before), which is what lets a period link span the right dates.

## Not in scope (named for the record)

- Kudos evidence ("which kudo") and goal status/progress (asks 1 and 4 of the field review) are separate sources — Kudos sheet and Goals — and get their own links or panels.
- The Team grid cells still open the person card; the link lives on the card where the period is explicit.
- Exports (CSV, presentation view) — ask 6 of the field review — are a separate change.

## Deploy notes

1. `clasp push` from the branch, then a versioned deployment (deployments are versioned; a push alone is never live).
2. **Bust the report cache** after deploying (`bustReportCache_()` from the editor, or save any Scoring Weights setting): cached payloads built before this version carry no `tempoId` / `tempoReportsBase`, and the page renders plain text for them until the TTL expires.
3. The `Capacity Tempo` tab must exist in the container workbook with its `Account ID` / `User` header (it does today; `TempoCapacityTime.js` writes it). A person missing from it, or whose Tempo display name `Change Names.js` has not mapped yet, simply shows no link — the fix is the `NAME_MAPST.TEMPO` entry, not the dashboard.

## Tests

- `tests/perf-record-tempo-links-checks.js` (new, 54 checks): engine placement and purity; `perfIsoWeekRange_` (W41, W1 across the year boundary, W53, padded labels, invalid labels); `perfTempoReportUrl_` (both reports, every parameter, encoded worker id last, month and cross-year spans ordered by date, every missing-input case → `''`); page wiring (history cells, month/quarter `weekLabels`, evidence links, CSS, tips, hint, Documentation); server config, `buildEmployeeRows_` signature and `tempoId`, meta base, and `parseTempoWorkerIds_` against a realistic `Capacity Tempo` fixture (stacked headers, legacy id, duplicate, TOTAL and Last Export footers, missing header); the render-harness fixture ships ids and a base.
- Existing suites unchanged and green: `perf-record-help-checks` (96), `perf-record-checks` (221), `pulse-tips-checks` (41), `responsive-checks` (54), `rcr-source-checks` (34).
- Render check with `tests/render-harness` (Playwright, fixture with ids on most people and none on some): evaluated-week history shows one link per time cell with the right week window; month links span the bucket's weeks (28 or 35 days), quarter links 91 days; the week-by-week evidence links both figures; a person without an id renders the same cells with no links. The one page error in the harness (`siLabel … toFixed` on the Overview KPIs) is pre-existing on the baseline page with the synthetic fixture and unrelated.
