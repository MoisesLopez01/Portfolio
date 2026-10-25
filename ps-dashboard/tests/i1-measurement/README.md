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

## Controls the protocol asks for

- **Mutation 1** — `--mutate-monday-to-sunday` moves one Monday PTO movement to the previous Sunday in memory; the corrected engine must then show a critical.
- **Mutation 2** — run the pre-fix engine (commit 24a9892, @305) over the same extracts; it must reproduce the week-shift errors.
- A zero is only worth citing when both controls fire.

## Classification

Critical = another person or another week (hours present on one side only, or a week shift). Non-critical = same person-week, both sides non-zero, differing by more than 0.5 h. A planned figure that differs only because its PTO week is wrong is counted as *propagated* (the cause is already counted once, under PTO).

Written 2026-10-24 (2026.W43).
