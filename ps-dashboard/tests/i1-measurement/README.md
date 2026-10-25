# I1 measurement kit (PTO, planned and logged hours)

Re-runs the second measurement of indicator I1 (spec: thesis support folder,
`REGISTRO - Segunda medicion I1 (zona horaria PTO) 2026-W43.md`). **No data lives here**: the
extracts hold people's records and are deleted after each run; only counts leave the
authorised environment.

| File | Job |
|---|---|
| `dump_sheets.py` | reads the exported `.xlsx` files into one local JSON (dates as civil date-times, as the workbook shows them) |
| `run-engine.js` | runs the REAL engine (`PS Contribution Report.js` of any commit) over that JSON with Google Sheets semantics: a date cell reaches `getValues()` as midnight in the **workbook's** zone, the script runs in America/Guatemala |
| `reconcile.py` | independent reconciler: reads the `.xlsx` directly, takes the ISO week of the civil day the workbook shows (no time-zone arithmetic, nothing shared with the engine), compares per person-week with ±0.5 h |

## Run

1. Export three workbooks as `.xlsx` into a new, empty folder `I1_EXT`: the PTO workbook as `pto.xlsx`, the roster workbook as `roster.xlsx`, the container ("Contribution Dataset") as `container.xlsx`. Never run these scripts from inside that folder.
2. `python -I dump_sheets.py` with `I1_EXT` set (and `I1_PYLIB` pointing at the folder that holds `openpyxl`, because `-I` ignores the user site).
3. Put the engine under test in a folder (`PS Teams.js` + `PS Contribution Report.js` at the commit to measure; use `git show <commit>:ps-dashboard/<file>`), then
   `node run-engine.js <engineDir> <I1_EXT>/sheets.json <out.json> [W39,W40,W41,W42]`.
   Set `CV_TZ_PTO` / `CV_TZ_ROSTER` / `CV_TZ_CONTAINER` to the zones read in **File → Settings → Time zone** of each book (defaults are the 2026-10-24 reading: PTO America/Chicago, roster and container America/Guatemala).
4. `python -I reconcile.py <out.json> [--mutate-monday-to-sunday] [--json detail.json]`.

## Roster contrast (people and their fields)

Jira is out of scope for the PS Contribution metrics (owner, 2026-10-24); the **roster is in**.
Export only the roster workbook as `roster.xlsx`, run `dump_sheets.py` (it skips absent books), then

1. `I1_ROSTER_ONLY=1 node run-engine.js <engineDir> <I1_EXT>/sheets.json <roster-out.json>` dumps every profile `readPSRoster_` builds and the instant it ran.
2. `python -I reconcile_roster.py <roster-out.json> [--mutate] [--json detail.json]` rebuilds the roster from the `.xlsx` with the specified rules in separate code and compares 13 fields per person. Critical = a person in/out wrongly, or supervisor, employee number, internal ID, crew flag, ramp-up, long leave, class, department, location. Non-critical = job title, email, hire date.
3. `--mutate` is the control: one supervisor changed, one person turned "Terminated", one hire date moved a day — expect 2 critical + 1 non-critical.

Limit: it checks that the app implements the rules; it cannot catch a mistake in the rules themselves.

## Goals contrast (weekly self-comment counts and compliance verdicts)

Export the goals workbook as `goals.xlsx` (tab `RD`) plus `roster.xlsx`, run `dump_sheets.py`, then

1. `I1_GOALS=1 node run-engine.js <engineDir> <I1_EXT>/sheets.json <goals-out.json>` runs the production flow (three quarter runs, 41-week history, PTO exemption off) and dumps per person-week comment counts and verdicts. The goals book's zone defaults to America/Los_Angeles (`CV_TZ_GOALS`).
2. `python -I reconcile_goals.py <goals-out.json> [--mutate] [--json detail.json]` assigns each comment to the ISO week of the civil day the workbook shows and applies the compliance rules as specified. `--mutate` moves a Sunday comment to Monday 00:30 (the protocol's alteration test; expect 2 critical).
3. The real comment dates carry no time of day, so nothing can shift. `python -I inject_late_comments.py <sheets.json> <goals-out.json> <sheets-inj.json>` gives a few real comments an evening time **in a copy** and prints the weeks involved; run both engines on the copy and contrast with the original `.xlsx`: the pre-fix engine must miss, the corrected one must not, and the noon control must move in neither.
4. `node diff_engines.js <goals-305.json> <goals-307.json>` compares the two engines head to head: person-week verdicts and comment counts that differ, and how many people have a different verdict.

Note: the app compares comment instants with UTC day boundaries, so the exposure of a timed comment starts at 17:00 Pacific (16:00 in winter) on Sunday, not at the Guatemala offset.

## Controls the protocol asks for

- **Mutation 1** — `--mutate-monday-to-sunday` moves one Monday PTO movement to the previous Sunday in memory; the corrected engine must then show a critical.
- **Mutation 2** — run the pre-fix engine (commit 24a9892, @305) over the same extracts; it must reproduce the week-shift errors.
- A zero is only worth citing when both controls fire.

## Classification

Critical = another person or another week (hours present on one side only, or a week shift). Non-critical = same person-week, both sides non-zero, differing by more than 0.5 h. A planned figure that differs only because its PTO week is wrong is counted as *propagated* (the cause is already counted once, under PTO).

Written 2026-10-24 (2026.W43).
