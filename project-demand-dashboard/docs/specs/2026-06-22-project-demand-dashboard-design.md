# Project Demand — Week over Week (C-Suite Dashboard) — Design

**Date:** 2026-06-22 (2026.W26)
**Status:** Approved design — ready for implementation plan
**New project:** `project-demand-dashboard/` (separate Google Apps Script web app)
**Also touches:** `PS Dashboard.html` (remove Trends card + add hyperlink)

---

## 1. Summary

A standalone, CEO/C-suite-facing **Project Demand** dashboard, served as its own Google Apps
Script (GAS) web app, reading **live** from the Tempo planned-time data. It answers, week over
week: *which projects are in most demand, how is the team spread across them, and how is that
shifting?*

It replaces the team-level "Project context — planned demand by week" card that was added to the
PS report's Trends tab (that card is removed; the per-rocketeer PROJECTS row in the PS report
stays). The PS report links out to this new dashboard.

The reference artifact is the user-provided standalone HTML sample ("Project Demand — Week over
Week"). This design keeps its **format, theme, and ServiceRocket colors**, keeps five of its
panels, drops the KPI cards, and rewires it from synthetic data to live sheet data.

## 2. Data source

- **Spreadsheet ID:** `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`
- **Tab:** `Planned Time Tempo`
- This is the same sheet the PS report reads (produced by `TempoPlanExport.js`). The new GAS
  project is a **separate** Apps Script project and opens the spreadsheet **by ID** with
  `SpreadsheetApp.openById(...)` (it is not container-bound to it).
- Live: data loads on page open via `google.script.run`. The sample's CSV upload is retained as
  an **offline fallback** only.

### Sheet shape (two-row stacked header)

- **Row 1:** ISO week labels (`2026.W14`, …) over the week columns; blank over the fixed columns.
- **Row 2:** field names — `User`, `Space`, `Key`, `Planned (hrs)`, `<week date-range>` per week,
  `Total (hrs)`.
- **Rows 3+:** one row per `User × Project`, with planned **hours** in each week column.
- A `TOTAL` footer row (skipped — resolves to no real person).

## 3. Data model & mapping

Each data row → zero or more allocation records `{ person, iso, key, hours }`:

- **person** = `User` cell; **key** = `Key` cell; **iso** = the ISO label of that week column;
  **hours** = the numeric cell value (skip ≤ 0).
- **Exclusions:** skip blank keys and the non-project key `NETSUITE` (time-off synced from
  NetSuite — already represented elsewhere; never a project here). Implemented as a configurable
  list `NONPROJECT_KEYS = ["NETSUITE"]` (matched case-insensitively), mirroring the PS report.
- **Headline unit = planned hours.** No FTE conversion is required for the headline numbers; an
  `≈ hrs ÷ 40` capacity hint may appear as small secondary text where the capacity framing helps,
  but hours are what every panel displays.

### Week window

- **8 weeks: 4 past + current + 3 future**, anchored on the **current ISO week** (computed
  server-side from "today"). Each week is tagged `done` (past), `now` (current), or `plan`
  (future). ISO week math matches the PS report's helpers (Monday-start, ISO-8601).
- The window is defined by config constants so it can be retuned without code surgery.

### Aggregates (returned by `getDemandData()`)

Computed once, server-side, over the in-window allocation records:

- `weeks`: `[{ iso, wk, status }]` for the 8-week window.
- `cap[key][iso]` = summed planned **hours** for that project that week (demand).
- `head[key][iso]` = distinct **people** count for that project that week.
- `winners[iso]` = `{ key, hours }` — the project with the most hours that week (heatmap/hero ★).
- `activeProj[iso]` = count of projects with hours > 0 that week.
- `weekTotal[iso]` = total planned hours that week.
- `blendByWeek[iso]` = `{1:n,2:n,3:n,4:n}` — count of people on exactly 1/2/3/4+ distinct projects.
- `avgBlend[iso]`, `stretched[iso]` (people on ≥ 4 projects), `activePeople[iso]`.
- `order` = project keys sorted by total in-window hours (drives Top-N and trend leaders).
- `keyName` = `{ key → Space/name }` for labels and tooltips; `maxCell` for heatmap scaling.

The client renders purely from this object (same shape the sample's `aggregate()` produced,
re-expressed in hours), so the sample's render functions need minimal change.

## 4. Files

New folder `project-demand-dashboard/`:

- **`Code.js`** — GAS server:
  - `doGet()` → `HtmlService.createHtmlOutputFromFile('Dashboard')` with title and
    `XFrameOptionsMode.ALLOWALL` not required; set viewport meta via the HTML.
  - `getDemandData()` → opens the source spreadsheet by ID, reads `Planned Time Tempo`, parses
    the stacked header, builds allocation records, aggregates per §3, returns the JSON model.
  - Helper functions: ISO week math (`isoWeekNum_`, `isoWeekYear_`, `mondayOfIsoWeek_`),
    header/column detection (employee column, ISO label row, `Key` column, week columns),
    `CONFIG` block (spreadsheet ID, tab name, `NONPROJECT_KEYS`, window split 4/1/3, weekly
    capacity 40 for the optional FTE hint).
  - A `_test_demandParse_()` unit function (Node/GAS-runnable, stubbed `Logger`) that feeds a
    fake stacked-header matrix and asserts the aggregates (hours summed, NETSUITE excluded,
    winner + blend counts correct).
- **`Dashboard.html`** — the sample's HTML/CSS/JS, with these changes:
  - **Boot** calls `google.script.run.withSuccessHandler(onData).withFailureHandler(onErr).getDemandData()`
    instead of `generateRows()/aggregate()`. `onData` stores the model and calls `renderAll()`.
  - **Remove** the synthetic generator (`generateRows`, `mulberry32`) and the `PROJECTS`
    catalog — names/keys now come from the live `keyName` map. Keep `KEY_COLORS`/`keyColor`.
  - **Remove the KPI cards**: delete the `#kpis` container and `renderKPIs()`; drop it from
    `renderAll()`. (The "stretched ≥ 4" signal still lives in the People & blending note.)
  - **Hours everywhere**: relabel "FTE"/"blended FTE"/"person-weeks" to planned **hours**; the
    `fmt()`/axis/tooltip text reads hours. Optional `≈ FTE` hint = `hours/40`.
  - **CSV fallback** retained: `parseCSV` maps `person, week, project_key, allocation(hours)`;
    the template download still works. A small "live / offline" indicator shows which source is
    active.
  - Panels kept: week selector bar, **Most demanded project — each week** (hero), **Project key
    heatmap**, **Ranked demand · `<week>`**, **People & blending**, **8-week trend — top movers**.

### README

A short `README.md` in the folder: what it is, the data source, how to deploy (create Apps Script
project, add `Code.js` + `Dashboard.html`, deploy as web app — execute as owner, access "anyone
at ServiceRocket with the link"), and how to paste the resulting `/exec` URL into the PS report
hyperlink (see §5).

## 5. PS report changes (`PS Dashboard.html`)

- **Remove** the Trends "Project context — planned demand by week" card:
  - Delete the `#projCtxCard` container markup in the Trends pane.
  - Delete `renderProjectContext(...)` and `toggleProjCtxHrs(...)`.
  - Delete the `renderProjectContext(_tf);` call inside `renderTrendsTab()`.
  - Delete the `.projctx-*` CSS rules and the dark-mode `.projctx-wk-cur` rule.
- **Keep** `.proj-pill` / `.proj-pill-new` (still used by the rocketeer PROJECTS row) and the
  rocketeer-panel PROJECTS row itself (unchanged).
- **Add a hyperlink** in the Trends tab, where the card was: a small `section-card` with a title
  like *"Project Demand — Week over Week"* and a button/link *"Open C-Suite view ↗"* that opens
  the new dashboard in a new tab (`target="_blank" rel="noopener"`).
  - The URL is a single clearly-labeled JS constant near the top of the script,
    `var PROJECT_DEMAND_URL = "";` — empty renders the card in a "link pending deployment"
    disabled state; once the new app is deployed, paste its `/exec` URL there.

## 6. Out of scope (YAGNI)

- No code-level access allowlist in v1 — access is the GAS deployment setting (org-restricted
  link). The PS-style email gate can be added later if the data sensitivity warrants it.
- No write-back, no scheduling, no caching layer in v1 (the sheet read is a single
  `getValues()`; add `CacheService` later only if load latency warrants it).
- No new metric beyond hours + distinct-project blend (no entropy/concentration index).
- No change to `TempoPlanExport.js` or the source sheet.

## 7. Risks & notes

- **Sheet format dependency:** relies on the two-row stacked header and ISO labels from
  `TempoPlanExport.js`. The reader detects header rows/columns defensively (same approach as the
  PS report's `buildPlannedResult_`); a legacy single-row export degrades gracefully (no project
  data rather than a crash).
- **Permissions:** the web app executes as the deploying owner, who must be able to read the
  source spreadsheet by ID. First run will prompt for the `SpreadsheetApp` authorization scope.
- **Window vs. available data:** if the current ISO week sits outside the sheet's exported range,
  some of the 8 columns will simply have zero demand — the UI shows empty weeks rather than
  erroring.
- **Hyperlink ordering:** the PS hyperlink depends on the new app's deploy URL, so the PS edit is
  finished by pasting the URL after the new app is deployed (tracked as the final step).
- **Two independent deliverables:** the new dashboard project and the PS-report edit are separable;
  the plan sequences the dashboard first, then the PS edit (which needs the deploy URL).
