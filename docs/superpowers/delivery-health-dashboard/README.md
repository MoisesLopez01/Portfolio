# Delivery Health Dashboard

A standalone Google Apps Script (GAS) web app for delivery leadership (directs and above). It
answers *what percentage of available delivery hours is logged as billable client work?* —
delivery labor is mostly fixed cost, so each utilization point moves gross margin directly.

Four tiles, one per metrics-dictionary metric, each with a 6-week trend sparkline and RAG color:

1. **Billable Utilization** — billable ÷ available capacity for the last completed week (companion:
   `tracked/capacity`).
2. **On-Time Delivery Rate** — resolved-by-due-date ÷ resolved-with-due-date, computed live from
   `Jira Raw` (companion: n resolved with a Due Date).
3. **Forecast Accuracy** — `1 − |actual − estimate| ÷ estimate` averaged over resolved, estimated
   epics (companion: estimate coverage count).
4. **Quality / Rework** — **placeholder** tile, muted "data pending — reopen/CSAT feed not yet
   connected". No numbers until the reopen/CSAT feeds exist (spec §11).

Below the tiles: a **people × weeks grid** (2 completed + current + 3 future weeks), collapsed to
capacity hours tinted by billable utilization, or expandable per-week into stacked bars
(billable / non-billable / idle / OOO) with a click-through accordion of the underlying stats.

Region chips + Team dropdown + person search scope the tiles, trends, and grid together.

Spec: [`docs/superpowers/specs/2026-07-31-delivery-health-dashboard-design.md`](../specs/2026-07-31-delivery-health-dashboard-design.md).

## Files

| File | Role |
|---|---|
| `Code.js` | GAS server — `doGet()` (access-gated) serves the HTML; `getDeliveryData(forceRefresh)` reads Capacity/Tracked/Planned/NS Billable/PH/Jira Raw + Roster by spreadsheet ID, builds the person × week + Jira-bucket model, returns JSON. `buildDeliveryModel_()` is the full compute, shared by the cache-first endpoint and the `warmDeliveryCache()` 30-min trigger (`setupDeliveryCacheWarmer()` installs it). `probeDeliverySources()` and `auditJiraFillRates()` are one-time post-deploy diagnostics. 13 `_test_*` unit tests. |
| `Security.js` | Email allowlist (admin / viewer / open-access) — `SEC_DH`, `checkDeliveryAccess()`, `getDeliveryAccessSettings()`, `saveDeliveryAccessSettings()`, `buildAccessDeniedPage_()`. Inherited from the demand dashboard's `Security.js` (itself inherited from `PS Security.js`). |
| `Dashboard.html` | Client — loads cache-first via `google.script.run.getDeliveryData(false)`; ↻ Refresh forces a live read; renders tiles + grid; 🔒 Access panel (admins); per-panel ⬇ Save PNG. |
| `node-tests.js` | Local Node runner for the pure `_test_` functions in `Code.js` (stubs `Logger`/`Utilities`/cache) — `node node-tests.js`. Not pasted into the GAS project. |

## Data sources

Seven tabs across two spreadsheets. All IDs live in the `CONFIG_DH` block in `Code.js` and can be
overridden via Script Properties without touching code.

| Source | Spreadsheet | Tab | Used for |
|---|---|---|---|
| Capacity | Tempo hours SS (`SOURCE_SS_ID`) | `Capacity Tempo` | Per-person scheduled hours per ISO week; fallback 38h (ANZ) / 40h (else) when a person/week cell is missing |
| Tracked | same | `Tempo Tracked Time` | Tracked hours per person-week (NETSUITE keys excluded); `Team` cell; `Key` for the Jira Region join |
| Planned | same | `Planned Time Tempo` | Planned hours per person-week (NETSUITE excluded); NETSUITE rows = PTO that week |
| Billable | same | `NS Billable` | Daily rows (`Employee`, `Total Billable Hours`, `Non-Billable Hours`, `Date`, …) bucketed to ISO weeks |
| Holidays | same | `PH` | `Date \| Location \| Holiday` → per-person holiday hours by fuzzy location match |
| Jira | same | `Jira Raw` | `Region` (col 32) and `Team` (col 33) per issue, dedup'd on `Key` (last snapshot wins); On-Time Delivery (`Due Date`, `Resolution Date`) and Forecast Accuracy (`Original Estimate (sec)`, `Time Spent (sec)`, epic type) |
| Roster | Roster SS (`ROSTER_SS_ID`) | `Data` + `Contractors Data` | Population gate — active, Class = Professional Services (Class check skipped for crew) / Department = Services; `Key Location` drives the ANZ capacity fallback and the person-region fallback |

Both spreadsheet IDs are overridable via Script Properties:

```
DH_SOURCE_SS_ID   → overrides CONFIG_DH.SOURCE_SS_ID (Tempo hours + NS Billable + PH + Jira Raw)
DH_ROSTER_SS_ID   → overrides CONFIG_DH.ROSTER_SS_ID (Data + Contractors Data)
```

## Metric formulas

```
capacity   = Capacity Tempo hours; fallback 38h (ANZ) / 40h (else) if the cell is missing
pto        = NETSUITE hours from Planned Time Tempo that week
holiday    = per-person PH hours (8h/day, 7.6h ANZ) minus already-booked NETSUITE hours
             that week, floored at 0 (a booked holiday is never double-counted)
available  = max(0, capacity − pto − holiday)
planned    = planned hours (non-NETSUITE)
tracked    = tracked hours (non-NETSUITE)
billable   = NS Billable "Total Billable Hours" summed over the ISO week
nonBillable= NS Billable "Non-Billable Hours" summed over the ISO week

billableUtil = billable / available     (Utilization tile headline)
trackedUtil  = tracked / available      (Utilization tile companion)
onTime       = resolved ≤ Due Date ÷ resolved-with-Due-Date, per week          (On-Time Delivery tile)
forecastAcc  = avg(1 − |Time Spent − Original Estimate| / Original Estimate)   (Forecast Accuracy tile,
               over resolved epics with a non-zero estimate; negative accuracy floored at 0)
rework       = placeholder — no formula yet (reopen/CSAT feeds don't exist)
```

`NS Billable` unreadable → the Utilization tile falls back to `tracked/capacity` with a "billable
data unavailable" chip; the grid still renders. `Jira Raw` unreadable → On-Time Delivery and
Forecast Accuracy show "Jira data unavailable"; Utilization and the grid are unaffected. Roster
unreadable is the one **fatal** error (population and Region can't be derived without it).

## Region lens

The standard region for every tile is the **issue-level Jira `Region` field** (`Jira Raw` col 32,
decided 2026-07-31, superseding an earlier Roster-Key-Location-only design):

- **Jira tiles** (On-Time Delivery, Forecast Accuracy) group directly by each issue's `Region`.
- **Person-level Region** (Utilization tile + grid) = the region receiving the **majority of that
  person's tracked hours** in the trend window — tracked rows carry an issue `Key`, joined to
  `Jira Raw`'s `Region` for that `Key`. Ties break alphabetically (deterministic).
- **Roster fallback:** a person with no region-tagged tracked hours falls back to their Roster
  `Key Location` bucket (`CONFIG_DH.LOCATION_REGION_MAP`, unmapped locations → `Other`). Their row
  in the grid carries a **◦ marker** next to the name (tooltip: "region from roster location (no
  region-tagged work)") so a roster-derived region is never silently presented as Jira-sourced.

## Team filter semantics

Filter values are the **individual Tempo teams** — the `Team` column on Tracked/Planned rows is
pipe-joined (`"Team A | Team B"`); `splitTeams_()` splits, trims, and dedupes into the dropdown's
individual options (plus "All"). A person matches a team filter by **membership**: someone on
`Team A | Team B` appears under either selection, contributing their **full** hours to each.
Consequently **team rates do not sum to the All total** — this is by design (utilization is a
rate, not an additive count) and is called out in the dashboard's ⓘ note under the tiles.

## Access control (`Security.js`)

Same three-layer model as the other GAS dashboards in this repo (`SEC_DH`), scoped to delivery
leadership — no manager org-tree scoping:

- **Bootstrap admin** (`SEC_DH.BOOTSTRAP_ADMIN`) — always Admin, not removable via the UI.
- **Default admins / viewers** (`SEC_DH.DEFAULT_ADMINS` / `DEFAULT_VIEWERS`) — code-level, always
  active. Edit these for permanent leadership stakeholders.
- **Runtime admins / viewers** — Script Properties `DH_DASH_ADMINS` / `DH_DASH_VIEWERS`
  (comma-separated), additive on top of the defaults. Managed from the dashboard's **🔒 Access**
  button (admins only) → add/remove emails, toggle Open Access, Save. Backed by
  `getDeliveryAccessSettings()` / `saveDeliveryAccessSettings()`.
- **Open access** — `SEC_DH.OPEN_ACCESS_DEFAULT` (default `false`) or `DH_DASH_OPEN_ACCESS`. Set
  `true` only for an all-hands/demo, then flip back — a stored property overrides the code
  default, so check the 🔒 panel if access ever seems too open.

Enforced **server-side** in both `doGet()` (denied users get a minimal "access restricted" page)
and `getDeliveryData()` (returns an error model) — defense in depth, never client-only.

## Cache

`getDeliveryData()` caches its JSON response in `CacheService.getScriptCache()` via
`cachePutLarge_()` / `cacheGetLarge_()`: the JSON is gzipped and split into 90 KB chunks
(`<key>_0..n` + `<key>_meta`), because CacheService rejects any single value over 100 KB. A
missing chunk on read is a clean cache miss (recompute), never an error. TTL is
`CONFIG_DH.CACHE_TTL_SEC` (65 min).

Cache key: `dh_v<DH_CACHE_VER>` — `DH_CACHE_VER` is a Script Property (default `1`).
`bustDeliveryCache_()` bumps it, stranding the prior-version entry (CacheService can't enumerate
keys, so versioning is how a model-shape change takes effect immediately). Run it manually from
the GAS editor after any change to the model's shape.

**Warmer:** `warmDeliveryCache()` runs on a time trigger (install once with
`setupDeliveryCacheWarmer()` in the GAS editor as the owner; interval =
`CONFIG_DH.CACHE_WARM_EVERY_MIN`, 30 min), so loads are warm most of the time. Data can lag sheet
edits by up to the warm interval — the ↻ Refresh button (`loadData(true)`) always bypasses cache
for a live read. Error models are never cached.

## Deploy
1. script.google.com → New project (separate from all existing dashboards).
2. Add files: `Code` (Code.js), `Security` (Security.js), HTML file named `Dashboard` (Dashboard.html — name must match doGet).
3. Run `node node-tests.js` locally — all suites must pass before pasting.
4. In the GAS editor run `probeDeliverySources()` — verify every source logs a row count,
   the NS sample Employee name format, and NS→roster join coverage >90%.
5. Run `auditJiraFillRates()` — record Due Date / Original Estimate / Region / Team fill rates
   (spec §10.5). Low fill ⇒ adjust tile so-what wording, not the design.
6. Run `getDeliveryData` once → grant scopes (account must open BOTH spreadsheets).
7. Deploy → New deployment → Web app → Execute as Me → "Anyone within ServiceRocket with the link".
8. Run `setupDeliveryCacheWarmer()` once as the owner.
9. After any model-shape change: run `bustDeliveryCache_()` then ↻ Refresh.

## Manual QA (after deploy)
- [ ] Tiles show numbers for the last completed week; Rework tile is muted "data pending".
- [ ] Region chips + Team dropdown + search all filter tiles AND grid together.
- [ ] Collapsed past/current cells tinted; future cells neutral; capacity hours correct (32/38/40).
- [ ] Click a week header → stacked bars; ⚠ appears when planned or tracked > capacity.
- [ ] Click a bar → accordion with 4 stats + bullet lines; multiple accordions can be open.
- [ ] A known PTO week shows OOO hatch and reduced available hours.
- [ ] 🔒 Access panel loads/saves for admins; a non-listed account gets the denied page.
- [ ] ↻ Refresh forces a live read (check generatedAt changes).

## Save PNG

Both the tiles row and the grid panel have their own **⬇ PNG** button — each exports just that
element as `delivery-health-<tiles|grid>-<headlineIso>.png`. The first click lazy-loads
`html2canvas` from a pinned CDN (`H2C_URL`); if the GAS sandbox blocks the script, an alert fires
("PNG export unavailable (script blocked)") and the dashboard is otherwise unaffected.

## Notes

- **Security deviation from the original brief:** the 🔒 Access panel's `s.admins`, `s.viewers`,
  and `s.bootstrapAdmin` values are interpolated into HTML `value=`/text attributes. Since these
  are attacker-influenceable strings (admins can paste arbitrary email-like text into the
  allowlist), every interpolation is wrapped in the existing `esc_()` HTML-escaping helper rather
  than concatenated raw, closing a stored-XSS path an admin (or a compromised admin account) could
  otherwise open against every other admin who opens the panel.
- Ramp-up exclusion and FTE-vs-crew toggle are **not** implemented here — population is Roster
  active FTE + crew together (spec §12, backlog item).
- No manager org-tree scoping — this is delivery leadership data with an explicit allowlist.
