# Project Demand — Week over Week (C-Suite Dashboard)

A standalone Google Apps Script (GAS) web app for the CEO / C-suite. It reads **live**
planned-time data from the `Planned Time Tempo` tab and shows, week over week:

- **Most demanded project — each week** (hero strip, top project by planned hours, ★ winner)
- **Project key heatmap** (projects × 8 weeks, cell = planned hours; Top 15/30/All + search)
- **Ranked demand · `<week>`** (horizontal bars in hours for the selected week)
- **People & blending** (distinct projects per person: 1/2/3/4+, avg blend, "stretched ≥ 4")
- **8-week trend — top movers** (multi-line hours trend; click a heatmap row to highlight)

Headline unit is **planned hours**. Time-off (`NETSUITE`) and blank keys are excluded.
Window = **4 past + current + 3 future** ISO weeks, anchored on today.

Spec: `../specs/2026-06-22-project-demand-dashboard-design.md`

## Files

| File | Role |
|---|---|
| `Code.js` | GAS server — `doGet()` serves the HTML; `getDemandData()` reads the sheet by ID, parses the two-row stacked header, aggregates, returns JSON. `_test_demandParse_()` unit test. |
| `Dashboard.html` | Client — loads live via `google.script.run.getDemandData()`; renders all panels. CSV upload is an offline fallback. |

## Data source

- Spreadsheet ID: `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`
- Tab: `Planned Time Tempo` (produced by `TempoPlanExport.js`)
- Configurable in the `CONFIG` block at the top of `Code.js`
  (`SOURCE_SS_ID`, `SHEET_NAME`, `NONPROJECT_KEYS`, `WEEKS_PAST`/`WEEKS_FUTURE`, `WEEKLY_CAPACITY_HRS`).

## Deploy

1. Create a new Apps Script project (script.google.com → New project). This is **separate**
   from the PS report project.
2. Add a script file named **`Code`** and paste `Code.js`. Add an HTML file named **`Dashboard`**
   and paste `Dashboard.html` (the file name must be `Dashboard` so `doGet()` finds it).
3. In the editor, run `_test_demandParse_` once and confirm the log shows
   `✅ _test_demandParse_ passed`.
4. Run `getDemandData` once to trigger the authorization prompt — grant the
   `SpreadsheetApp` (read external spreadsheets) scope. The account you authorize with must be
   able to open the source spreadsheet.
5. Deploy → **New deployment** → type **Web app**. Execute as **Me**, who has access:
   **Anyone within ServiceRocket with the link** (no code-level allowlist in v1). Copy the
   `/exec` URL.
6. Paste that `/exec` URL into the PS report's `PROJECT_DEMAND_URL` constant (the hyperlink card
   on the Trends tab) so the PS dashboard links here.

## Offline / CSV fallback

If opened outside the web app (e.g. the raw file) or if the live read fails, use
**Load CSV (offline)**. Columns: `person, week, project_key, project_name, allocation` where
`allocation` is **planned hours** and `week` is an ISO label like `2026.W22`. Use **CSV template**
for a starter file. The dashboard derives its window from the weeks present in the file.

## Notes

- No caching layer in v1 — each load is a single `getValues()` read. Add `CacheService` later
  only if load latency warrants it.
- If the current ISO week is outside the sheet's exported date range, the out-of-range weeks
  simply show zero demand (no error).
