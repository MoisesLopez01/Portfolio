# Delivery Health Dashboard — Final 4-Tile Version — Design

**Date:** 2026-07-31 (2026.W31) · **Target ship: 2026.W32** · **Status:** Design approved in brainstorming; pending user spec review
**Companion doc:** `D:\Delivery Health Dashboard- Metrics Dictionary.md` (four-metric final vision)

## 1. What this is

A new **standalone GAS web app** (its own Apps Script project + deployment), cloned from the
`project-demand-dashboard` skeleton, that answers: *what percentage of available delivery hours
is logged as billable client work?* Delivery labor is mostly fixed cost, so each utilization
point moves gross margin directly.

**Target: the final dashboard version ships in 2026.W32** with all four metrics-dictionary
tiles — **Utilization Rate** (plus its people × weeks grid), **On-Time Delivery Rate** and
**Forecast Accuracy** (computed live from `Jira Raw`), and **Quality/Rework** as an empty
"data pending" placeholder tile until the reopen/CSAT feeds exist. Same Region/Team/trend
controls on every tile.

## 2. Decisions log (from brainstorming, 2026-07-31)

| Decision | Choice |
|---|---|
| App shape | New standalone GAS web app (demand-dashboard skeleton) |
| Headline metric | **Billable utilization** = NS Total Billable Hours ÷ net capacity; tracked ÷ capacity shown as companion |
| Denominator | **Net capacity** = scheduled hours − PTO − public holidays ("available delivery hours") |
| Region source | **Issue-level Jira `Region` field** (`Jira Raw` col 32) — the standard lens for every tile (decided 2026-07-31, superseding the earlier Roster-Key-Location choice). For person-level metrics (utilization), a person's Region = the region receiving the **majority of their tracked hours** in the trend window (tracked `Key` → `Jira Raw` Region join); fallback = Roster `Key Location` bucket when none of their tracked work is region-classified. Roster Key Location still drives the ANZ 38h capacity fallback (schedule, not rollup) |
| Team source | `Team` column from Tempo Tracked/Planned exports (pipe-joined; each combo = its own filter value, never collapsed) |
| Population | Active Roster, Class = Professional Services / Department = Services, **FTE + crew** (`Data` + `Contractors Data` tabs) |
| Week window (grid) | **6 weeks: 2 completed + current + 3 future**, `YYYY.WN` labels |
| Week bar | **Single stacked bar** (billable / non-billable / idle / OOO segments, planned ▼ tick) |
| Bar drill-down | **Inline accordion row** under the person, containing the layered bullet-line comparison |
| Collapsed cells | Capacity hours, **tinted by billable utilization** for past/current weeks; future weeks neutral |
| Page composition | **KPI tile first** (with Region/Team filters scoping everything), grid below; Phase-2 tiles slot beside it |
| Data pipeline | **Approach 1:** direct multi-sheet reads in the GAS server, gzip cache + warmer (no staging sheet, no shared library) |
| NS Billable location | Tab `NS Billable` in the **same spreadsheet** as the Tempo export tabs (`SOURCE_SS_ID`) |
| Scope & timeline | **Final 4-tile version in 2026.W32**: Utilization + On-Time Delivery + Forecast Accuracy live; Quality/Rework = placeholder tile with an explicit "data pending" empty state (decided 2026-07-31) |

## 3. Data sources

All sheet/spreadsheet IDs live in a `CONFIG_DH` block; overridable via Script Properties.

| Source | Spreadsheet | Tab | Used for |
|---|---|---|---|
| Capacity | Tempo hours SS (`SOURCE_SS_ID`) | `Capacity Tempo` | Per-person scheduled hours per ISO week (32/40 etc.). Person × week grid, join on normalized name |
| Tracked | same | `Tempo Tracked Time` | Tracked hours per person-week (NETSUITE keys excluded); `Team` person attribute |
| Planned | same | `Planned Time Tempo` | Planned hours per person-week (NETSUITE excluded); **NETSUITE rows = PTO** per person-week (exists for past + future) |
| Billable | same | `NS Billable` | Daily rows: `Employee, Employee Type Category, Billable Hours Billed, Billable Hours Unbilled, Total Billable Hours, Non-Billable Hours, Total Hours (B+NB), Date` → bucketed to ISO weeks; we use **Total Billable Hours** and **Non-Billable Hours** |
| Holidays | same | `PH` | `Date \| Location \| Holiday` → per-person holiday hours by location |
| Roster | Roster SS (`ROSTER_SS_ID`) | `Data` + `Contractors Data` | Population gate (active, PS/Services), `Key Location` → ANZ capacity fallback + Region fallback |
| Jira | Tempo hours SS (`SOURCE_SS_ID`) | `Jira Raw` | **Region** (col 32) + **Team** (col 33) per issue; On-Time Delivery (`Due Date` 12, `Resolution Date` 11, `Completed Date` 19, issue type 3, `Labels` 20); Forecast Accuracy (`Original Estimate (sec)` 23, `Time Spent (sec)` 24, `Epic Key` 17, `Epic Tempo Rollup` 28); weekly `Week` snapshots (col 0) feed the 6-period trends |

**Name joins:** all person joins use the existing normalization convention
(`toLowerCase().replace(/\s+/g," ").trim()`) plus the "Last, First" / "Last First" alias
variants the planned-time reader already supports. Tempo sheets are already
roster-normalized by `Change Names.js`; the NS Billable `Employee` format must be verified
against a real row during implementation (open item #1).

## 4. Server model (`Code.js`)

`buildDeliveryModel_()` — the full compute, shared by cache-first `getDeliveryData(forceRefresh)`
and the `warmDeliveryCache()` trigger.

**Window:** anchored on today. Grid weeks = 2 completed + current + 3 future. Internally
aggregate **6 completed weeks + current + 3 future (10 weeks)** — the 4 extra past weeks feed
the tile's 6-period trend only.

**Per person-week record:**

```
capacity   = Capacity Tempo hours; fallback: 38 if Key Location = Australia & New Zealand else 40
pto        = NETSUITE hours from Planned Time Tempo that week
holiday    = per-person PH hours (8h/day, 7.6h ANZ) minus already-booked NETSUITE hours
             that week, floored at 0 (never double-count a booked holiday)
available  = max(0, capacity − pto − holiday)
planned    = planned hours (non-NETSUITE)
tracked    = tracked hours (non-NETSUITE)
billable   = NS Billable "Total Billable Hours" summed over the ISO week
nonBillable= NS Billable "Non-Billable Hours" summed over the ISO week
```

**Derived:** `billableUtil = billable/available`, `trackedUtil = tracked/available`,
`trackedVsPlanned = tracked/planned` (each null when the denominator is 0).

**Person Region:** tracked rows carry issue `Key`; joining `Key` → `Jira Raw` Region gives
region-tagged tracked hours per person. Person Region = the region with the most tracked hours
over the trend window; fallback = Roster `Key Location` bucket when no tracked work is
region-classified. The accordion notes when a person's region is roster-fallback.

**Rollups:** by Region, by Team, and overall — per week: Σbillable, Σavailable, Σtracked,
Σplanned → utilization rates. Trend series = last 6 completed weeks, filter-scoped.

**Jira tiles (same payload):** from `Jira Raw` weekly snapshots, grouped by issue-level
Region/Team — `onTime` (resolved ≤ Due Date ÷ resolved-with-Due-Date per week) and
`forecast` (1 − |Time Spent − Original Estimate| ÷ Original Estimate, averaged over epics
resolved in the period; estimate-less epics excluded and counted as coverage). `Jira Raw`
missing → those tiles degrade to a "Jira data unavailable" state; utilization unaffected.

**Payload:** `{ meta (weeks, generatedAt, thresholds, regions, teams), people[ {name, region,
team, weeks{...}} ], rollups, trend }` — one JSON, gzip-chunked into CacheService
(`dh_v<DH_CACHE_VER>`, TTL 65 min). `setupDeliveryCacheWarmer()` installs the 30-min warmer;
`bustDeliveryCache_()` bumps the version. Error models are never cached. ↻ Refresh
(`getDeliveryData(true)`) bypasses cache.

## 5. Frontend (`Dashboard.html`)

Reuses the demand-dashboard visual system: palette (`--void #0F1941`, `--orbe #058CDC`,
`--royal #2864E6`, `--june #FF9B87`, `--ivory #DCCDBE`), fluid `--scale` responsive tokens,
light/dark themes, per-panel ⬇ Save PNG.

**Header / tile row (page layout A):**
- **Four tiles**, one per metrics-dictionary metric, each with the same anatomy — headline for
  the **last completed week**, companion line, 6-week trend sparkline, so-what line, RAG color:
  1. **Utilization Rate** (headline billable %, companion `tracked/capacity`),
  2. **On-Time Delivery Rate** (companion: n resolved with Due Date),
  3. **Forecast Accuracy** (companion: estimate coverage %),
  4. **Quality/Rework** — placeholder: muted tile, "data pending — reopen/CSAT feed not yet
     connected", no fake numbers.
- **Filters:** Region chips + Team dropdown (unique pipe-joined combos) + person search box.
  Filters scope the tile, trend, and grid together.
- ↻ Refresh (live read) · 🔒 Access (admins) · theme toggle.

**People × weeks grid:**
- Rows: people, **alphabetical**; columns: the 6 window weeks; current week visually marked;
  future weeks slightly muted.
- **Collapsed cell:** capacity hours. Past + current cells get a subtle green/amber/red tint by
  billable utilization (`≥70% green · 50–70% amber · <50% red`, `CONFIG_DH.TINT`); future
  cells neutral.
- **Expand a week** (click its header): every cell in that column becomes a **stacked bar** —
  width = capacity; segments left→right: billable (navy) · non-billable (slate) · idle/unlogged
  (light) · OOO = PTO + holiday (coral hatch); **planned** = ▼ tick on the same scale.
  Future weeks have no tracked/billable yet → bar shows OOO + planned tick over an empty track.
  Multiple weeks may be expanded; the table lives in an `overflow-x: auto` container.
- **Overflow rules:** planned or tracked exceeding capacity never stretches the bar — the
  segment/tick clamps at 100% and the cell gets a ⚠ + the real % in text ("planned can never
  surpass capacity" is enforced as a display clamp + flag, since sheet data may violate it).
- **Click a bar → inline accordion row** under that person (multiple may be open): four stats —
  billable util (billable/available), tracked/capacity, tracked/planned, OOO hours (PTO ·
  holiday split) — plus the layered bullet lines (capacity track with hatched OOO end, planned
  line, tracked line split billable/non-billable).

## 6. Access control (`Security.js`)

Same model as the demand dashboard (`SEC_PD` → `SEC_DH`): bootstrap admin
(`moises.lopez@servicerocket.com`), code-level `DEFAULT_ADMINS` / `DEFAULT_VIEWERS`, runtime
Script Properties `DH_DASH_ADMINS` / `DH_DASH_VIEWERS` managed from a 🔒 Access panel,
`OPEN_ACCESS_DEFAULT = false`. No manager org-tree scoping. Per the metrics dictionary's
tiering, margin-adjacent detail is for **directs and above** — enforced by keeping the viewer
allowlist to that audience. Enforced server-side in **both** `doGet()` and
`getDeliveryData()` (defense in depth).

## 7. Error handling / degradation

| Failure | Behavior |
|---|---|
| `NS Billable` tab missing/unreadable | Billable metrics + tints off; tile falls back to tracked/capacity with a "billable data unavailable" chip; grid still renders |
| Person/week missing from `Capacity Tempo` | Fallback base hours (38 ANZ / 40 else); cell flagged "capacity estimated" in the accordion |
| `PH` tab missing / bad rows | Holiday signals silently off (demand-dashboard convention) |
| Roster unreadable | Error model (population and Region can't be derived — no silent guess) |
| Cache chunk missing | Clean cache miss → recompute |
| Person in NS Billable/Tempo but not in population | Excluded from grid and rollups (population is roster-gated) |
| `Jira Raw` missing/unreadable | On-Time + Forecast tiles show "Jira data unavailable"; person Region falls back to roster buckets; utilization tile + grid unaffected |

## 8. Testing

Pure `_test_` functions in `Code.js`, runnable in the GAS editor and locally via
`node-tests.js` (stubbed `Logger`/`Utilities`/cache — same pattern as the demand dashboard):

- `_test_nsWeekBucketing_` — daily NS rows → ISO weeks (incl. Sunday/Monday boundaries)
- `_test_netCapacity_` — capacity − PTO − holiday math, floor at 0, booked-holiday no-double-count
- `_test_nameJoin_` — normalization + "Last, First" alias variants across the four sheets
- `_test_personRegion_` — majority-of-tracked-hours region assignment + roster-bucket fallback (incl. ties and fully-unclassified people)
- `_test_regionMap_` — Key Location → fallback region buckets + `Other`
- `_test_overflowClamp_` — planned/tracked > capacity → clamp + flag
- `_test_utilizationRollup_` — person → Region/Team rollup math with zero-denominator guards
- `_test_onTimeRate_` — resolved ≤ Due Date bucketing per week (no-Due-Date exclusion, boundary day)
- `_test_forecastAccuracy_` — |actual − estimate| ÷ estimate averaging, estimate-less exclusion + coverage count
- `_test_cacheRoundtrip_` — gzip chunk write/read
- Render smoke test for `Dashboard.html` (CompDash `tests/render_smoke.js` pattern) — nice-to-have

## 9. Deploy (summary)

New Apps Script project; paste `Code`, `Security`, `Dashboard` (HTML). Run tests once; run
`getDeliveryData` once to grant scopes (must open both the Tempo and Roster spreadsheets);
deploy as Web app (Execute as Me; ServiceRocket-with-link; allowlist is the real gate); run
`setupDeliveryCacheWarmer()` once as owner. Model-shape changes require `bustDeliveryCache_()`.

## 10. Open items for implementation (2026.W32)

1. **Verify NS Billable `Employee` name format** against a real row; extend alias handling if it's "Last, First".
2. **Enumerate actual Roster `Key Location` values** → finalize the fallback `LOCATION_REGION_MAP` buckets, and confirm they match the value set of Jira Raw's `Region` field (one filter vocabulary).
3. **Confirm tint/RAG thresholds** (≥70 / 50–70 / <50) with the business before the MBR uses them.
4. Decide whether `Employee Type Category` (NS Billable) should annotate crew rows in the accordion (display only — population stays roster-gated).
5. **Required for the W32 build:** audit `Jira Raw` fill rates for `Due Date`, `Original Estimate`, `Region` (col 32), `Team` (col 33) — low coverage changes tile so-what wording, not the design.
6. **Parallel (unblocks the Rework tile later):** agree the rework convention (reopen changelog vs `Rework` link/label) and the CSAT feed — see §11.

## 11. Jira data requirements per tile (final dashboard, ships 2026.W32)

The final dashboard is **four tiles** (metrics dictionary), each with the same Region filter +
Team filter + 6-period trend controls. The `Jira Raw` sheet (produced by `Jira Backlog.js`
into the same Tempo spreadsheet) already exports most of the required fields — including
issue-level **Region** (col 32, Resource region field) and **Team** (col 33, Atlassian Team
field), so the metrics dictionary's "stand up Region/Team fields" prerequisite is about
**fill-rate coverage**, not field creation. **On-Time Delivery and Forecast Accuracy build
now** from these columns; **Quality/Rework ships as a placeholder tile** (muted, "data
pending") until its feeds exist.

| Tile | Formula (dictionary) | Jira Raw columns available today | Gaps to close |
|---|---|---|---|
| **On-Time Delivery Rate** | resolved ≤ Due Date ÷ resolved-with-Due-Date, ×100 | `Due Date` (12), `Resolution Date` (11), `Completed Date` (19), `Workstream (Issue Type)` (3), `Labels` (20 — Client Commitment), `Region` (32), `Team` (33). `Jira Backlog.js` already computes "Delivered On Time (≤ Due Date)" WoW | Due Date fill-rate audit; agree the commitment scope (Epic/Milestone vs Client Commitment label) |
| **Forecast Accuracy** | 1 − (\|actual − estimate\| ÷ estimate), avg over closed engagements | `Original Estimate (sec)` (23), `Time Spent (sec)` (24), `Tempo Logged (hrs)` (26), `Epic Tempo Rollup (hrs)` (28), `Epic Key` (17) — epic-level fidelity section already exists in Jira Backlog | Original Estimate fill-rate at Epic level; define "engagement closed in period" (Epic resolution vs Fix Version) |
| **Quality / Rework Rate** — **placeholder this release** | reopened-or-Rework-linked ÷ delivered, ×100 (+ CSAT companion) | `Resolution` (22), `Issue Links (count)` (25), `Status` (8) | **Reopen events are not exported** — needs either a changelog fetch (new export work) or an agreed `Rework` link type / label convention; CSAT lives outside Jira entirely (survey tool feed TBD). Tile ships muted with a "data pending" empty state — no numbers |
| **Utilization Rate** | billable ÷ available capacity | n/a — Tempo + NS Billable + Roster (§3); person Region via tracked-hours → `Jira Raw` Region join (§4) | — |

**Region lens (resolved 2026-07-31):** the standard is the **issue-level Jira `Region` field**
across all tiles. Jira tiles group by it directly; utilization derives each person's Region
from the majority of their region-tagged tracked hours (roster fallback, labeled in the UI).

**Cadence:** the dictionary reviews monthly ahead of the MBR; the tile trend stays weekly with
6 periods visible, which a monthly review can read directly (no separate monthly rollup needed
until asked).

## 12. Out of scope (this release)

- Quality/Rework **numbers** (tile ships as a "data pending" placeholder — see §11).
- FTE vs crew toggle (population includes both; toggle is backlog).
- Monthly/quarterly period rollups (tile trend is weekly; MBR cadence reads the weekly trend).
- Manager org-tree scoping.
