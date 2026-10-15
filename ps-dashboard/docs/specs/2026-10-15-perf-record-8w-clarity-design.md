# Performance Record — the 8-week table a new manager can read

**Date:** 2026-10-15 (2026.W42) · **Surface:** `PS Dashboard.html`, 📈 Performance Record (person card: history table, tiles, evidence) + the Supervisor filter + 📖 Documentation · **Server:** `PS Contribution Report.js` · **Status:** built on branch `worktree-perf-record-8w-clarity`, on top of the Tempo-links release (@302)

## Why

The owner's review of the card after @302, in their words: the 8-week table is "pretty informative", yet
the Goals row needs to be "clear and simple for managers, showing total goals in compliance with the
rules / total goals"; people "get confused when reading 1-1" on the Kudos row; "people say they cannot
keep open the note from hover over"; the Score row "needs to have a different colour than metrics to
avoid confusion", and a click or hover on it should "showcase the score earned on each week" — "not sure
if the bar charts should be the ones broken by score colour". Keep the Week · Weeks · Months · Quarters
toggles. Separately: when filtering for a manager, "the manager scoring is included within the list! it
should not happen"; planned time must "include the PTO within those hours, even public holidays", as the
delivery-health dashboard already does; a note must explain a planned or logged total that disagrees with
Tempo (cancelled PTO still in Tempo, duplicated entries) and the 40 h / 38 h regional cap; and PTO keeps
the balance number.

## What changed

### The Score row is the chart

The separate score bar chart above the table is gone. The table's first row is the **Score** row, set
apart from the measure rows (`tr.prp-r-score`, surface background, heavier rule under it): the score in
its band colour as a pill, above a **bar stacked by measure** — the points each measure earned that week,
in the Team Radar palette (`PERF_PART_COLORS`: Goals blue, Logged amber, Planned orange, Kudos coral, RCR
green, PTO teal, SI violet), with dashed marks at the Strong (75) and On-track (50) bars. Because it is a
table row, every bar sits exactly under its week, month or quarter header and scrolls with the measures —
the "most practical way to align that with the table". A legend under the table names the colours.

**Hover a score** for the numbers: a small table of *measure · points earned / points available*
(`data-tip-rows`), with the band and a pointer to ⚖️ Scoring Weights. **Click (or Enter / Space) a score**
to keep that note open (`data-tip-pin`). The points come from `computeRkScore`, which now returns `pts`
per measure — `got = norm × weight ÷ availW × 100`, `max = weight ÷ availW × 100` — on the same rules as
the score, so the parts add up to it; a measure outside the week's denominator is absent. Month and
quarter cells average the parts over the scored weeks (every measure divided by the same count), so they
still add up to the period's average score (`perfScorePartsFromRows_`, pure).

### Goals: goals meeting the rules / all goals

A single week reads **`6 / 8`** with the verdict underneath — *up to date*, or the rule that failed:
*needs 8 goals* (rule 1), *most not in progress* (rule 2), *needs 6 with comments* (rule 3) — plus *PTO
week* (rule 3 exempt), *all completed* / *quarter done* (override, printed as `8 / 8`), *0 goals ·
writing weeks* (the first four weeks of a quarter). The row help switches with the lens: *meeting the
rules / all goals* for a week, *weeks up to date / checked* for a month or quarter (unchanged `3 / 4`).

Server: every weekly verdict in `readGoalsEngagement_` now carries `qualifying` (goals meeting the comment
rule), `totalGoals`, `threshold` and `required`, whichever rule decided the week — before, rules 1 and 2
returned without the counts. `qualifying` is computed before rule 1 decides. A payload built before this
falls back to *Up to date* / *Behind* (`perfGoalsWeekCell_`, pure).

### Kudos: words, not a pair of numbers

The cell reads **`1 given`** over **`1 received`**; the row help, the tiles, the evidence table and the
grid tips say *given · received* in the same order everywhere (`perfKudosCell_`, pure).

### Hours are full-week hours

The Logged time and Planned time cells show the person's week the way the delivery-health dashboard does
(its 2026-09-11 "PTO enters planned time" and 2026-10-13 public-holiday rules): **project hours + the PTO
the NetSuite record (Accumulation Cost, `ptoUsageByWeek`) holds for that week + public holidays for the
person's location** (one fifth of the standard week per distinct weekday holiday, from `phByWeek`).
**Planned time is capped at the standard week — 40 h, 38 h in Australia & New Zealand**
(`CONFIG_PS.WEEKLY_CAPACITY_HRS`, `ANZ_LOCATION`, `ANZ_CAPACITY_HRS`); **Logged time is never capped** —
people can log more than a week and the card must show it (owner correction after @303, 2026-10-15: @303
had capped both; @304 lifts the cap on logged). A week fully on leave reads as a full week; the split — *23 h work · 16 h PTO*,
*32 h work · 8 h holiday* — sits under the number whenever time off is part of it. The NetSuite record is the authority for leave: Tempo's own
time-off rows (`byEmployeeTimeOff`, the NETSUITE keys) are swapped out, never added, so a cancelled request
still sitting in Tempo cannot inflate the total.

**The PTO rule (owner correction after @303, same day).** Tempo's own time-off rows — the NETSUITE key —
are never counted; PTO comes only from the NetSuite usage record. `subtractPTOFromPlanned_` therefore
removes Tempo's NETSUITE rows (`byEmployeeTimeOff`) from the plan, not the ledger PTO: 23 h of pure work
with 16 h of ledger PTO is 23 h of project plan (it used to come out as 7 h, which the card then printed as
"23 h · incl. 16 h PTO"), and the card shows 23 + 16 = 39 h. `ptoByEmployee` is the ledger PTO for everyone
the ledger names that week, so a person on leave with no plan row still gets a PTO-adjusted target. This
also corrects the scoring target and the Overview PTO pill for the same people; the duplication clamp
(plan repeated across projects → 40 h) and the capacity-after-PTO clamp are unchanged.

**Crew PTO joins by name (same day).** Crew members sit on the Contractors Data tab with no Employee
Number, and the ledger carries their rows with a blank number and the roster spelling of the name (the
Accumulation Cost formula keeps named rows since 2026-10-13). `readPTOAccumulationProfiles_` keys those
rows `name:<normPS_>` (no department gate — the roster join is the gate), `ptoProfileFor_` resolves a
roster member by number first, else by name, and `buildPTOUsageByWeek_` takes a roster to resolve the
name-keyed profiles, never for a person who already has a numbered profile. PTO health and the weekly PTO
both follow, so crew get their PTO balance, their PTO-adjusted target and the full-week hours like everyone.

Server: `fullWeekHours_` (pure) builds `capacityHrs`, `timeOffHrs`, `holidayHrs`, `plannedFullHrs`,
`trackedFullHrs`, `plannedRawHrs`, `trackedRawHrs` per employee-week in `buildEmployeeRows_`, which takes
an optional `fullWeek = { ptoUsageByWeek, phByWeek }`; the planned sheet parser keeps the time-off rows
apart (`byEmployeeTimeOff`) and the PTO subtraction keeps the raw totals (`byEmployeeRaw`). Client:
`computeRkScore` carries the fields, `perfBucketAgg_` sums them, `perfHoursCell_` (pure) prints the cell
with its sub-line and a **cell note** (the hover title): *Planned 40 h = 24 h on projects + 16 h PTO
(NetSuite record) · capped at the 40 h week*, and, when Tempo held more than the card counts, *Tempo as
exported: 56 h (cancelled PTO still in Tempo, or duplicated entries, are the known causes)*. A month or
quarter note says each week is capped, not the sum. The tiles, the hours chart and the week-by-week
evidence read the same full-week figures.

**Scoring is untouched.** The colour signals and the score still judge the project hours against the
PTO-adjusted target (`ptoAdjustedTargetHrs`); `plannedHrs` / `trackedHrs` keep their meaning. The
Overview Team Members table is unchanged (it shows PTO as its own pill).

### PTO keeps the balance

Unchanged from @301: the PTO plan cell shows the balance in hours at period close with Good / At risk
underneath. The render harness fixture now carries a balance so the check shows the real shape.

### Keep-open help bubble

The shared bubble (`initPulseTips_`) is now hover-safe: moving the pointer onto it keeps it; leaving closes
after a 180 ms grace instead of on the first stray pixel. It can be **pinned** — *📌 Keep open* in the
bubble, or a click / Enter / Space on a cell that carries `data-tip-pin` (the score cells). A pinned
bubble ignores other hovers and closes on *✕ Close*, Esc (capture phase, so an open note takes the first
Esc and the card the next), a click elsewhere, or its anchor leaving the page; on scroll it follows its
anchor. The bubble is placed beside the anchor, never over it (right, else left, else below, else above),
because it takes the pointer now. `data-tip-rows` renders a small table with colour chips.

### Supervisor filter: the supervisor's own row is out

`getFilteredEmployees` scopes a Supervisor pick through `orgScopeForSupervisor_` = `resolveOrgTree_`
minus the anchor. A manager's own evaluation belongs on *their* manager's dashboard — the rule the server
applies to a signed-in manager (`scope.delete(managerNorm)`) now holds for the filter too.
`resolveOrgTree_` itself still seeds with the anchor for any other caller.

### Toggles

Week · Weeks · Months · Quarters stay on the card and on the list; nothing about them changed except
that the score row, the goals cell and the hours cells follow the lens (the row help for Goals switches
wording).

## Invariants

- Pure helpers (`perfScorePartsFromRows_`, `perfGoalsWeekCell_`, `perfKudosCell_`, `perfHoursCell_`,
  `perfPts_`, the `PERF_PART_*` tables) live inside `⟦PERF-ENGINE-START⟧ … END⟧` and read no `DATA` /
  `STATE` / DOM; `perfScoreParts_` is the page-side wrapper.
- Score parts add up to the score (week) or the average score (period) exactly as printed.
- A payload without the new fields renders as before: words for goals, project hours, no notes.
- Nothing new about a person leaves the server: the counts and hours are the person's own, already in the
  viewer's scoped payload.

## Not in scope

- The Overview Team Members week cells (PTO stays a pill there); the Executive Brief; CSV exports.
- Public holidays netted against a shortened Tempo schedule (delivery-health reads Capacity Tempo for
  that); here the cap does the work.

## Deploy notes

1. `clasp push` from the branch, then a versioned deployment.
2. **Bust the report cache** (Refresh in the app, or `bustReportCache_()`): the goal counts and the
   full-week hours ride on the payload; cached entries render the old words and project hours until then.
3. The `PH` tab and the Accumulation Cost ledger are read as before; nothing new to configure.

## Tests

- `tests/perf-record-8w-clarity-checks.js` (new, 104 checks): engine placement and purity; the four pure
  cells; score parts; `fullWeekHours_`, `weeklyCapacityHrs_`, `phHoursForWeek_`; every goals verdict
  carries the counts; the Supervisor filter scope; `computeRkScore` parts and full-week fields; page
  wiring (score row, bars, pin, Esc, placement, legend, lens buttons); tips and Documentation; the fixture.
- Existing suites updated where the markup moved (`perf-record-help-checks`: the hours cell and the
  table width; `perf-record-tempo-links-checks`: the `buildEmployeeRows_` signature) and green: 17 suites.
- Render-checked in the Playwright harness (light and dark): score row with bars and breakdown rows, goals
  `6 / 8 · up to date` and `0 / 8 · needs 6 with comments`, kudos `1 given / 2 received`, PTO balances,
  full-week hours with *0 h work · 40 h PTO* on a leave week, month/quarter lenses, hover → bubble with rows →
  leave closes → click pins → other hover ignored → Esc closes → bubble hover keeps → Keep open / Close.
