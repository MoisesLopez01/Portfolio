# PS Weekly Contribution Report — Project Intelligence

## What this project is

A Google Apps Script (GAS) web app served via `doGet()` in **PS Contribution Report.js**.
It reads from multiple Google Sheets, assembles a 5-week rolling view of PS team health
(RCR, SI, Goals, Tracked Time, Planned Time, Kudos, PTO), and renders it in
**PS Dashboard.html** as a single-page dashboard.

---

## File map

| File | Role |
|---|---|
| `ps-dashboard/PS Contribution Report.js` | Main GAS script — data readers, assembly, `doGet`, `getPSReportData` |
| `ps-dashboard/PS Dashboard.html` | Frontend SPA served by GAS `HtmlService` |
| `ps-dashboard/PS Security.js` | Email-based access control — `checkDashboardAccess()`, role management |
| `PS Settings` sheet (runtime) | Stores scoring weights, read by `readWeightSettings_()` |

---

## Dashboard navigation (PS Dashboard.html)

Navigation is driven by the `VIEWS` array — single source of truth for every view's
button/pane ids, label, location, and role allow-list. `switchTab()`, `renderAll()`'s
renderer dispatch, role hiding (`applyRoleToNav_()`), and the ☰ menu all derive from it.
Spec: `ps-dashboard/docs/specs/2026-06-10-dashboard-navigation-redesign-design.md`.

- **Tab bar** (always visible): Overview, Team Radar, Leading Behaviours, Trends —
  plus 📋 Team Executive Brief (admin/viewer/manager) and 📈 Performance Record
  (admin/manager only — per-rocketeer R/Y/G signal grid over 2 closed quarters + QTD;
  spec `ps-dashboard/docs/specs/2026-08-18-performance-record-tab-design.md`).
- **☰ menu** (top-left in header): 📊 Data Reference (everyone), ⚖️ Scoring Weights and
  🔒 Access Control (admins only). Selecting one opens an IDE-style closable temp tab
  (`STATE.openMenuTabs`); closing it returns to `STATE.lastRegularTab`.
- Role gating is enforced inside `switchTab()` (forbidden id → Overview), not just by
  hiding buttons.

---

## Access control model (PS Security.js)

There are **three layers** of access, applied in order:

### 1. Bootstrap admin — code-level, indestructible
```js
SEC_.BOOTSTRAP_ADMIN = "moises.lopez@servicerocket.com"
```
Always Admin. Cannot be removed via the Settings UI. Do not change.

### 2. Default admins / viewers / delegates — code-level, always active
Defined in `SEC_.DEFAULT_ADMINS`, `SEC_.DEFAULT_VIEWERS`, `SEC_.DEFAULT_DELEGATES` in `ps-dashboard/PS Security.js`.
These survive a Script Properties reset. Edit this file to add permanent stakeholders.

- **Admin**: full dashboard + can manage the access list.
- **Viewer**: read-only dashboard.
- **Delegate**: manager-scoped — sees only their org tree.
  Format: `{ email: "peer@servicerocket.com", scopeName: "Full Name of Roster Supervisor" }`.

### 3. Runtime access — stored in Script Properties, managed via 🔒 Access Control (☰ menu, admin only)
Any Admin can add/remove emails without touching code. Additive on top of defaults.
Property keys: `PS_DASH_ADMINS`, `PS_DASH_VIEWERS`, `PS_DASH_DELEGATES`.

### Open access flag
`SEC_.OPEN_ACCESS_DEFAULT = false` (default). Set to `true` temporarily for demos/all-hands.
Can also be toggled from the 🔒 Access Control page (☰ menu).

### Role resolution flow (checkDashboardAccess)
```
1. email in admins?              → role: "admin"
2. email in viewers?             → role: "viewer"
3. email in delegates?           → role: "manager" (scoped to delegateScopeName)
4. active roster supervisor?     → role: "manager" (scoped to own org tree)
5. openAccess?                   → role: "viewer"  (fallback — only unidentified users)
6. else                         → role: "denied"
```
Manager checks (3–4) run **before** the Open Access fallback (5) on purpose: turning
on Open Access must never silently promote a scoped manager into a full-roster viewer.

---

## Data join keys

| Metric | Joined by |
|---|---|
| Roster → RCR | Name (normalised) → Employee ID bridge via `3. RCR` sheet |
| SI ratings | Employee Number (`employeeNumber` on roster profile) |
| Goals (RD sheet) | Name (normalised via `normPS_()`) |
| Planned Time | Name (with Last, First and "Last First" alias variants) |
| Tracked Time | User name (normalised) |
| Kudos | Recipient / Giver name (normalised) |
| PTO (Accumulation Cost) | Employee Number |

`normPS_(name)` = `toLowerCase().replace(/\s+/g, " ").trim()` — used everywhere for name matching.

---

## Spreadsheet IDs

Three external spreadsheets are referenced. IDs live in `CONFIG_PS` as **fallback defaults**
and can be overridden via `PropertiesService.getScriptProperties()`:

```
ROSTER_SS_ID     → getExternalSSIds_().roster
GOALS_SS_ID      → getExternalSSIds_().goals
PTO_ACCUM_SS_ID  → getExternalSSIds_().ptoAccum
```

To override without touching code:
```js
PropertiesService.getScriptProperties().setProperties({
  ROSTER_SS_ID:    '…',
  GOALS_SS_ID:     '…',
  PTO_ACCUM_SS_ID: '…',
});
```

---

## Fiscal calendar — fully derived, no quarterly maintenance

All quarter/FY constants (goals quarter label, quarter start/end ISO weeks, SI column
header, RCR month columns, grace-period flags) are derived from today's date by
`computeFiscalContext_()` in `ps-dashboard/PS Contribution Report.js` (FY starts July 1) and shipped
to the frontend as `meta.fiscalContext` / `meta.goalsQuarter` / `meta.siQuarter`.
The frontend's header subtitle and every Data Reference quarter mention are filled at
load by `updateQuarterLabels_()` via `.drGoalsQ` / `.drSiQ` / `.drQEnd` / `.drQ1Week`
spans — nothing in the HTML needs a manual update at quarter rollover.
Override hook: `CONFIG_PS.SI_COL_OVERRIDE` forces the SI column header if the
auto-generated name doesn't match the sheet.

Policy constants that still change only if the target changes:

| Constant | Meaning |
|---|---|
| `GOALS_MIN_COUNT` | Min goals for compliance (8) |
| `GOALS_ACTIVE_COMMENT_COUNT` | Goals needing self-comments (6) |
| `GOALS_GRACE_DAYS` | Goals-only transition window after quarter start (21) |

---

## Ramp-up exclusion

Employees hired within `RAMP_UP_MONTHS` (3) of today are excluded from RCR, SI, Goals, and
Kudos team metrics. Included in Tracked/Planned/PTO. Override via `Ramp-Up` column in Roster:
`"No"` graduates early, `"Yes"` forces exclusion regardless of hire date.

Crew members (`/crew member|contractor/i` in Job Title) are additionally separated into an
FTE vs crew toggle in the UI.

---

## Naming conventions

- Private helpers: trailing underscore (`readPSRoster_`, `findCol_PS_`, `log_`)
- Config object: `CONFIG_PS` (all caps prefix, single source of truth)
- Security constants: `SEC_` object in `ps-dashboard/PS Security.js`
- Week labels: `YYYY.WN` format (e.g. `2026.W20`) — never `W20` alone in data keys

---

## Scoring weights (Top Rocketeers)

Default: `{ goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 }`
Configurable per deployment via ⚖️ Scoring Weights (☰ menu, admin only) → saved to `PS Settings` sheet.
`saveWeightSettings()` / `readWeightSettings_()` handle persistence.

### Team-aligned scoring matrix (2026-07-09)

Scoring groups follow the org team toggle (`TEAMS_` in `ps-dashboard/PS Teams.js`): **team gates,
family tunes**. **Hard invariant**: every resolution path in `weightsForEmployee_` ends in
a mask to `team.metrics` (`maskToTeamMetrics_`) — R&D / Sales members can never carry
tracked/planned/RCR weight, even from hand-edited sheet rows.

Full mechanics (sheet schema, resolution order, `blockFillBase_` defaults, editor, tests)
live in the `ps-scoring-matrix` skill — `.claude/skills/ps-scoring-matrix/SKILL.md`.
Spec: `ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md`.

Scoring caps:
- `SCORE_TRACKED_RATIO = 0.9` — tracked/planned threshold for full credit
- `SCORE_PLANNED_CAP_HRS = 40` — max hours for plannedNorm = 1.0
- SI normalised as `value / 5` (score 5 → 100%, score 1 → 20%)
- RCR normalised as `value / 2.5`, capped at 1.0

---

## Gemini narrative

`callGeminiNarrative(prompt)` calls Gemini 2.5 Flash via `UrlFetchApp`.
API key stored in Script Properties as `GEMINI_API_KEY` — sent as `x-goog-api-key` header
(not in the URL) to keep it out of GAS execution logs.

---

## DEBUG logging

Set `CONFIG_PS.DEBUG = true` to enable verbose `log_()` output.
All `⚠️` and `❌` prefixed calls use `Logger.log` directly and are always on.

---

## Cache

`getPSReportData()` caches its JSON response in `CacheService.getScriptCache()` via
`cachePutLarge_()` / `cacheGetLarge_()`: the JSON is **gzipped (~10× smaller) and split into
90 KB chunks** (`<key>_0..n` + `<key>_meta`), because CacheService rejects any single value
over 100 KB — a plain `cache.put()` of the report payload fails silently, which historically
made every load a cold multi-minute compute. A missing chunk on read is treated as a clean miss.
TTL is `CONFIG_PS.CACHE_TTL_SEC` (65 min).

**Warmer:** `warmReportCache()` runs on a time trigger (install once by running
`setupCacheWarmer()` in the GAS editor as the owner; interval = `CONFIG_PS.CACHE_WARM_EVERY_MIN`,
30 min) and force-rebuilds the admin-scope entry, so admin/viewer loads are warm ~always.
Data can therefore lag sheet edits by up to the warm interval — the Refresh button
(`loadData(true)`) always bypasses cache for a live read.

Cache key: `ps_v<VER>_admin` (for admin/viewer) or `ps_v<VER>_<email>` (for manager-scoped views),
where `<VER>` is `PS_CACHE_VER` in Script Properties. `saveWeightSettings()` and `saveScoringMatrix()`
call `bustReportCache_()` which bumps `PS_CACHE_VER`, stranding **all** prior-version entries at once
(admin + every manager scope) — CacheService can't enumerate keys, so versioning is how a save takes
effect immediately for everyone, not just the saver.
