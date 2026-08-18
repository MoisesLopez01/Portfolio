# Demand Dashboard — Utilization Panel + Capacity CSV — Design

**Date:** 2026-07-15 (2026.W29)
**Files to change:** `project-demand-dashboard/Code.js`, `project-demand-dashboard/Dashboard.html`, `project-demand-dashboard/node-tests.js`
**Upstream data:** `Capacity Tempo` sheet (built by `TempoCapacityTime.js` — spec `2026-07-15-tempo-capacity-export-design.md`), same demand spreadsheet as the `Planned Time Tempo` / `Tempo Tracked Time` tabs.
**Purpose:** Surface **utilization = Tracked ÷ Capacity per week** in the project demand dashboard, using real Tempo work-schedule capacity, plus a person×week CSV report covering past/current/future weeks.

---

## Decisions locked with the user (2026-07-15)

| Decision | Choice |
|---|---|
| Placement | **New Utilization panel** directly below Planned vs Tracked, same visual language; PvT chart unchanged |
| Capacity denominator | **Utilization only** — the existing Demand-vs-Capacity headline/band/heatmap keep the roster heuristic (38 ANZ/40 else − PTO − holidays) untouched; swapping that is a separate later decision |
| Export | **Person×week CSV, full capacity range** (past + current + future weeks), from a `⇣ CSV` button on the panel |
| Population | **Services scope** for panel AND CSV — same roster `countsForCapacity` population as every other dashboard figure |

---

## 1. Backend (Code.js)

### New reader: `readTempoCapacity_(ss)`

Reads the `Capacity Tempo` tab (new `CONFIG.CAPACITY_SHEET_NAME = "Capacity Tempo"`) from the same spreadsheet handle the tracked-time reader uses. Called inside the cached demand compute alongside the other sheet reads.

Sheet layout consumed (produced by `TempoCapacityTime.js`):
```
Row 1:  "" | ""   | 2026.W14 … 2026.W33 | ""            (ISO labels)
Row 2:  Account ID | User | date-range labels | Total (hrs)
Row 3+: data; footer row has User = "TOTAL" and blank Account ID
```

Parse rules:
- Week columns = row-1 cells matching `/^\d{4}\.W\d{2}$/` between col C and the last column exclusive (Total).
- Data rows: skip when Account ID (col A) is blank (footer/stray rows).
- People keyed by `norm(User)` — the same normalization already applied to tracked/planned names, so capacity joins `personWeekTracked` and roster profiles with no new mapping.
- **Numeric cells only** become values; blank stays absent. Blank = unknown, explicit 0 = scheduled zero — never coerce.
- Missing sheet / unrecognized header → `{ personWeekCapacity: {}, capacityIsoList: [], capacityError: "…" }`; the dashboard renders everything else normally and the panel shows a hint instead of a chart.

### Model additions (cached payload)

| Field | Shape | Notes |
|---|---|---|
| `personWeekCapacity` | `{ normName: { iso → hrs } }` | Only people present in the roster with `countsForCapacity` (Services scope); non-Services rows in the sheet are dropped server-side to keep the payload lean |
| `capacityIsoList` | `string[]` sorted ISO labels | Every week column the sheet holds, **including future weeks** — this is what lets the chart/CSV cover past+current+future |
| `capacityError` | `string \| null` | Set when the sheet is missing/malformed |

Cache: model shape changes → deploy requires `bustDemandCache_()`.

### Pure helpers (Node-tested)

- `parseCapacityGrid_(values)` — 2-D sheet values → `{ byName: {normName→{iso→hrs}}, isoList }`; lives in Code.js, pure, covered by `node-tests.js` (header detection, footer skip, blank-vs-zero, non-numeric junk cells).
- The client-side aggregation and CSV builders (`utilWeekTotals_`, `buildUtilCsvRows_`, §2) are written as pure functions (inputs in, rows/totals out — no DOM access) inside Dashboard.html. The implementation plan decides how `node-tests.js` loads them (script-block extraction like other client-logic tests if the harness already does that, else mirrored test copies asserted char-identical); either way all three test suites in §3 must run under `node node-tests.js`.

## 2. Frontend (Dashboard.html)

### Panel

New panel `#utilPanel` directly below the Planned vs Tracked panel, same card chrome:

- **Header:** `Utilization` + hint text: capacity = Tempo work schedules (from the Friday export); tracked = all tracked hours (billing chips do NOT filter this panel — utilization is whole-tracked by design); respects People filters; % = Tracked ÷ Capacity over people with capacity data that week.
- **Series per week:** capacity (line or light bar, existing palette) vs tracked (existing tracked green), % label per week like PvT's fidelity %.
  - Past weeks: solid bars + %.
  - Current ISO week: ghosted bar + hollow point, % rendered but visually "in progress" (same treatment PvT uses for the still-logging week).
  - Future weeks: dashed/ghosted **capacity only**, no % (nothing tracked yet).
- **Week range:** union of the PvT QTD window and every week in `capacityIsoList` — past weeks with tracked data through the last future week with capacity.
- **Filters:** People filters (manager/person) apply through the same normalized-name membership check PvT uses. Billing chips: ignored (stated in hint).
- **Feedback rule honored:** chart-area verdict/summary lines show counts and percentages only, never individual names.

### Utilization math (client, mirrored by tests)

For each week `iso` over the filtered people set:
- `capSum` = Σ capacity over people with a **numeric** capacity cell that week.
- `trkSum` = Σ tracked over **that same sub-set of people** (someone tracked-but-capacity-blank never inflates the rate).
- `util% = trkSum / capSum * 100` when `capSum > 0`; no % otherwise.
- Coverage note: when some filtered people have tracked hours that week but no capacity cell, the tooltip appends "capacity data for N of M people"; their tracked hours are excluded from the % (and visibly included in the PvT panel above, so nothing is hidden).
- Utilization above 100% renders as-is — real overtime signal, no cap.

### CSV export

`⇣ CSV` button in the panel header, fully client-side (Blob + anchor download, same pattern as the PNG export wiring):

- One row per (person, week) over the **full `capacityIsoList` range**, restricted to the current People filter (Services scope by construction).
- Columns: `User, Week, Capacity hrs, Tracked hrs, Utilization %` — per-person % = tracked/capacity for that person-week, blank when capacity is blank/0-division or the week is future.
- Blank capacity or tracked cells stay **empty** in the CSV (never 0).
- CSV hygiene: values quoted/escaped; any field starting with `= + - @` is prefixed with `'` (formula-injection guard — this new exporter does not inherit the known gap in older exporters).
- Filename: `utilization-<currentISO>.csv` (e.g. `utilization-2026.W29.csv`).
- Display name shown in the CSV is the raw `User` value from the capacity sheet (matching Tempo/Jira display names used across the other exports).

### Degraded modes

| Condition | Behavior |
|---|---|
| `capacityError` set / `capacityIsoList` empty | Panel body shows one hint line ("Capacity Tempo sheet not found — run fetchTempoCapacity() in the Tempo export project"); CSV button hidden; rest of dashboard unaffected |
| Offline CSV preview mode (`SOURCE !== 'live'`) | Panel hidden (capacity data isn't part of the offline CSV), same as other live-only affordances |
| Person in capacity sheet but not in roster Services scope | Dropped server-side; never reaches panel or CSV |

## 3. Testing

Appended to `project-demand-dashboard/node-tests.js` (existing harness pattern):
- `_test_capacityParse_` — header detection, footer skip, blank-vs-zero preservation, junk cells, missing-sheet shape.
- `_test_utilizationMath_` — weekly aggregation incl. the capacity-coverage rule (tracked-without-capacity excluded), 0-capacity week (no %), >100% pass-through, People-filter subset.
- `_test_utilizationCsv_` — row building: full range, future weeks capacity-only, blank preservation, formula-injection guard, filename ISO.

## 4. Deploy

- Owner deploys demand `Code.js` + `Dashboard.html`, then runs `bustDemandCache_()` (**required** — model shape changed).
- No changes to `TempoCapacityTime.js`, the Tempo export project, `Security.js`, or the PS dashboard.
- Data freshness note: capacity updates every Friday (or on manual `fetchTempoCapacity()` runs); the panel hint already points at the export as the source.

## 5. Out of scope (possible fast-follows)

- Per-person utilization drill grid (person×week expandable, heatmap-style).
- Replacing the Demand-vs-Capacity headline heuristic with Tempo schedule capacity.
- PM- or project-level utilization; billing-filtered utilization.
