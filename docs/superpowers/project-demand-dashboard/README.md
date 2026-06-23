# Project Demand — Week over Week (C-Suite Dashboard)

A standalone Google Apps Script (GAS) web app for the CEO / C-suite. It reads **live**
planned-time data from the `Planned Time Tempo` tab, cross-reads the **Roster** for an
available-capacity denominator, and shows — week over week — not just *what* the demand is but
*what's changing and whether we're over- or under-staffed*. Every tile ends in a *so-what*.

Panels (top → bottom):

- **Demand vs capacity** — headline. Planned project hours vs available hours. Capacity = active
  Services team base hours (**38 hrs for Australia & New Zealand, 40 hrs everyone else**) **minus
  per-week PTO & public holidays** (the `NETSUITE` time-off rows). A dashed **90% planning-target
  line** marks healthy planning (nobody plans to 100%). Utilization chip (Headroom / Tight / Over),
  8-week area chart with actual/planned separated, and a suggested-action line.
- **Project key heatmap** (drill-down) — color by **Hours** (default — surfaces planned hours),
  **Change**, or **Risk**; question-filter chips (*Losing >20% WoW · Dropping to zero · New this
  window · Volatile*); Top 15/30/All + search.
- **Risers & fallers** — biggest week-over-week movers (replaces the old "winner each week" strip,
  which repeated the same project 8×). Ramping-up vs falling-off, with a risk flag for projects
  dropping to zero.
- **Ranked demand · `<week>`** — horizontal bars in hours for the selected week.
- **People & blending** — distinct projects per person (1/2/3/4+), an 8-week sparkline of people on
  4+ projects (climbing/easing), and a click-to-drill list of *who* is fragmented across *which*
  projects (top-demand projects badged).
- **8-week trend — biggest movers** — multi-line hours trend; "movers" = steepest week-over-week
  slope (toggle to "Top by volume"); end-of-line labels; actual solid / planned dashed; drop-to-zero
  annotated. Click a heatmap row to highlight.

Each chart section has its own **⬇ Save PNG** button in its header (exports just that panel).

Headline unit is **planned hours**. Time-off (`NETSUITE`) and blank keys are excluded from project
demand — but `NETSUITE` hours are reused to reduce capacity (PTO + public holidays). Window =
**4 past + current + 3 future** ISO weeks, anchored on today. One extra **hidden lookback week**
(`baselineIso`) is aggregated but not displayed, so the first visible week still has a prior week
for week-over-week comparisons (Risers & Fallers, heatmap Change/Risk) instead of showing "no comparison".

Spec: `../specs/2026-06-22-project-demand-dashboard-v2-design.md`
(v1: `../specs/2026-06-22-project-demand-dashboard-design.md`)

## Files

| File | Role |
|---|---|
| `Code.js` | GAS server — `doGet()` (access-gated) serves the HTML; `getDemandData()` reads the Tempo sheet + Roster by ID, parses the two-row stacked header (capturing `NETSUITE` time-off per week), aggregates, returns JSON. `readActiveCapacity_()` sums region-weighted base hours (38 ANZ / 40 else); `attachCapacity_()` subtracts per-week PTO/holidays. `_test_demandParse_()` + `_test_headcount_()` unit tests. |
| `Security.js` | Email allowlist (admin / viewer / open-access), inherited from the PS report's `PS Security.js`. `checkDemandAccess()`, `getDemandAccessSettings()`, `saveDemandAccessSettings()`, `buildAccessDeniedPage_()`. |
| `Dashboard.html` | Client — loads live via `google.script.run.getDemandData()`; renders all panels. Per-panel Save PNG export. |

## Data sources

- **Demand:** spreadsheet `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`, tab `Planned Time Tempo`
  (produced by `TempoPlanExport.js`).
- **Capacity:** spreadsheet `1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0`, tab `Roster`. Sums
  active **Class = Professional Services / Department = Services** people (excluding
  terminated/inactive; ramp-up and crew **included** since they appear in the plan), crediting
  each `ANZ_CAPACITY_HRS` (38) when their **`Key Location`** equals `ANZ_LOCATION`
  (`Australia & New Zealand`) and `WEEKLY_CAPACITY_HRS` (40) otherwise. The result is the **gross**
  weekly base; **net capacity per week = gross − PTO & public holidays** (the `NETSUITE` time-off
  hours summed from the Tempo sheet that week — people on leave can't plan project work).
- All configurable in the `CONFIG` block at the top of `Code.js`: `SOURCE_SS_ID`, `SHEET_NAME`,
  `NONPROJECT_KEYS`, `WEEKS_PAST`/`WEEKS_FUTURE`, `WEEKLY_CAPACITY_HRS`, `ANZ_LOCATION`,
  `ANZ_CAPACITY_HRS`, `PLAN_TARGET` (90% line), `ROSTER_SS_ID`, `ROSTER_SHEET`, `ROSTER_CLASS`,
  `ROSTER_DEPT`, `UTIL_TIGHT`, `UTIL_OVER`, `FRAG_MIN`, `TOPN_STRATEGIC`, `MOVERS_N`.

If the roster can't be read (no access / missing), capacity **falls back** to
`planned people × 40` (still minus per-week PTO/holidays) and the tile is labeled *"capacity
estimated from planned roster"* — the demand panels are unaffected.

## Access control (`Security.js`)

Inherited from `PS Security.js`, scoped to an exec view (no manager org-tree scoping):

- **Bootstrap admin** (`SEC_PD.BOOTSTRAP_ADMIN`) — always Admin, not removable via UI.
- **Default admins / viewers** (`SEC_PD.DEFAULT_ADMINS` / `DEFAULT_VIEWERS`) — code-level, always
  active. Add permanent C-suite / PS-leadership stakeholders here.
- **Runtime admins / viewers** — Script Properties `PD_DASH_ADMINS` / `PD_DASH_VIEWERS`
  (comma-separated), additive on top of defaults, managed by `saveDemandAccessSettings()`.
- **Open access** — `SEC_PD.OPEN_ACCESS_DEFAULT` (default `false`) or `PD_DASH_OPEN_ACCESS`. Set
  `true` only for an all-hands/demo, then flip back.

Enforced **server-side** in both `doGet()` (denied users get a minimal "access restricted" page)
and `getDemandData()` (returns an error model) — defense in depth, never client-only.

## Deploy

1. Create a new Apps Script project (script.google.com → New project). This is **separate**
   from the PS report project.
2. Add three files: `Code` (paste `Code.js`), `Security` (paste `Security.js`), and an **HTML**
   file named `Dashboard` (paste `Dashboard.html` — the name must be `Dashboard` so `doGet()`
   finds it).
3. In the editor, run `_test_demandParse_` and `_test_headcount_` once; confirm both log
   `✅ … passed`.
4. Run `getDemandData` once to trigger the authorization prompt — grant the `SpreadsheetApp` scope.
   The account you authorize with must be able to open **both** the Tempo and Roster spreadsheets.
   (Reading the Roster is a **new auth scope** vs v1 — re-authorize on redeploy.)
5. Confirm your email is covered by `Security.js` (the bootstrap admin is, by default).
6. Deploy → **New deployment** → **Web app**. Execute as **Me**; who has access:
   **Anyone within ServiceRocket with the link** (the email allowlist in `Security.js` is the real
   gate). Copy the `/exec` URL.
7. Paste that `/exec` URL into the PS report's `PROJECT_DEMAND_URL` constant (the hyperlink card on
   the Trends tab) so the PS dashboard links here.

## Save PNG

Every chart section has its own **⬇ Save PNG** button in its header — it exports just that panel as
`project-demand-<panel>-<currentISO>.png` (forced to the light theme for decks; the button hides
itself in the capture). The first click lazy-loads `html2canvas` from a pinned CDN. If the sandbox
blocks the script, it shows *"PNG export unavailable"* and the dashboard is otherwise unaffected. To
make export fully offline, vendor `html2canvas` into the project and load it locally.

## Notes

- No caching layer — each load is two `getValues()` reads (Tempo + Roster). Add `CacheService`
  later only if load latency warrants it.
- Capacity is **net of PTO & public holidays**: gross region-weighted base (38 ANZ / 40 else) minus
  the per-week `NETSUITE` time-off hours. `grossCapByWeek` / `timeOffByWeek` are exposed in the
  payload for the headline breakdown, and a dashed `PLAN_TARGET` (90%) line marks healthy planning.
- "Strategic" projects are a **top-N-by-hours proxy** (`TOPN_STRATEGIC`), not a maintained list.
- If the current ISO week is outside the sheet's exported range, those weeks simply show zero
  demand (no error).
