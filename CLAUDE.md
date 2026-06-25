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
| `PS Contribution Report.js` | Main GAS script — data readers, assembly, `doGet`, `getPSReportData` |
| `PS Dashboard.html` | Frontend SPA served by GAS `HtmlService` |
| `PS Security.js` | Email-based access control — `checkDashboardAccess()`, role management |
| `PS Settings` sheet (runtime) | Stores scoring weights, read by `readWeightSettings_()` |

---

## Dashboard navigation (PS Dashboard.html)

Navigation is driven by the `VIEWS` array — single source of truth for every view's
button/pane ids, label, location, and role allow-list. `switchTab()`, `renderAll()`'s
renderer dispatch, role hiding (`applyRoleToNav_()`), and the ☰ menu all derive from it.
Spec: `docs/superpowers/specs/2026-06-10-dashboard-navigation-redesign-design.md`.

- **Tab bar** (always visible): Overview, Team Radar, Leading Behaviours, Trends —
  plus 📋 Team Executive Brief for admins only.
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
Defined in `SEC_.DEFAULT_ADMINS`, `SEC_.DEFAULT_VIEWERS`, `SEC_.DEFAULT_DELEGATES` in `PS Security.js`.
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

## Key CONFIG_PS constants (things that change each quarter)

| Constant | Meaning | Update when |
|---|---|---|
| `GOALS_QUARTER` | e.g. `"FY26Q4"` | New quarter starts |
| `SI_QUARTER_COL` | SI sheet column header | Prior quarter closes |
| `Q4_BASE_ISO_WEEK` / `Q4_BASE_YEAR` | ISO week of Q4 start | New Q4 starts |
| `MONTH_COLS` | FY month columns in RCR sheet | New fiscal year |
| `GOALS_MIN_COUNT` | Min goals for compliance (8) | If target changes |
| `GOALS_ACTIVE_COMMENT_COUNT` | Goals needing self-comments (6) | If target changes |

The HTML Data Reference tab also contains **hard-coded Q4 week labels** (e.g. `2026.W14–W18`).
They are marked with `<!-- UPDATE EACH QUARTER: … -->` — update them when CONFIG_PS changes.

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
- Security constants: `SEC_` object in `PS Security.js`
- Week labels: `YYYY.WN` format (e.g. `2026.W20`) — never `W20` alone in data keys

---

## Scoring weights (Top Rocketeers)

Default: `{ goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 }`
Configurable per deployment via ⚖️ Scoring Weights (☰ menu, admin only) → saved to `PS Settings` sheet.
`saveWeightSettings()` / `readWeightSettings_()` handle persistence.

### Family × Level weight matrix (company-wide)

Weights can be tuned **per job family and level** on top of the flat base above.
Spec: `docs/superpowers/specs/2026-06-10-score-weight-settings-by-family-level-design.md`.

- **Sheets of record** (auto-seeded the first time an admin opens ⚖️ Scoring Weights):
  - `Job Catalog` — Job Title → Code / Family / Track / Level / Role Group.
    Seeded from `COMPANY_ROLES_`; titles matched via `normPS_()`. Role groups are display-only.
  - `PS Scoring Matrix` — rows = `Family × Metric`, columns = levels `I1–I8, M4–M10`.
    Stores per-family overrides only; blank cell = inherit the flat base weight. (No `DEFAULT`
    block — the company default lives solely in the flat Scoring Weights / `PS Settings` sheet.)
- **Single source for the company default**: the flat base weights (Scoring Weights section →
  `readWeightSettings_()`). There is **no editable/stored `DEFAULT` matrix block** — the matrix
  holds only per-family *overrides*. The Scoring Weights page shows the company default as a
  read-only mirror of the flat weights.
- **Resolution order per employee** (`weightsForEmployee_`):
  Job Title → catalog → `(family, levelKey)` → matrix cell (blank metric inherits the flat base
  weight) → `readWeightSettings_()` → `DEFAULT_WEIGHTS_`.
  Any miss falls back to base — an unseeded deployment scores exactly as before. The matrix is
  seeded with blank cells (structure only), so every family reads as "inheriting default" until
  an admin enters an explicit override.
- **Services Team catch-all**: the roster is filtered to Department = "Services"
  (`CONFIG_PS.PS_DEPT`), so titles missing from the Job Catalog are still Services-team
  members — they score with the `SERVICES`/`ALL` matrix block (one weight set, all levels;
  blank = inherit base) instead of silently using the company default. Rendered as the
  "Services Team" block (with the uncatalogued-titles list) at the top of the matrix editor.
- Misses are surfaced in the payload as `weightAudit` and in the Scoring Weights page's
  Services Team block ("view list").
- All family blocks render **collapsed**; the Custom/Inheriting badge signals which have
  overrides.
- Archived families `JF006/JF010/JF011/JF012` are never seeded.
- Editor: ☰ menu → ⚖️ Scoring Weights → "Scoring Weights by Family & Level" (admin only) →
  `getScoringConfig()` / `saveScoringMatrix()` (busts the report cache on save).
- Tests: run `_test_weightsResolver()` in the GAS editor (also runnable in Node with a
  stubbed `Logger`).

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

`getPSReportData()` caches its JSON response in `CacheService.getScriptCache()` for 5 minutes.
Cache key: `ps_v<VER>_admin` (for admin/viewer) or `ps_v<VER>_<email>` (for manager-scoped views),
where `<VER>` is `PS_CACHE_VER` in Script Properties. `saveWeightSettings()` and `saveScoringMatrix()`
call `bustReportCache_()` which bumps `PS_CACHE_VER`, stranding **all** prior-version entries at once
(admin + every manager scope) — CacheService can't enumerate keys, so versioning is how a save takes
effect immediately for everyone, not just the saver. Force-bypass: the Refresh button (`loadData(true)`).
