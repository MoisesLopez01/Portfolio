# Project Demand Dashboard — Public Holiday Signals

**Date:** 2026-07-10 (2026.W28)
**Status:** Approved design
**Files:** `docs/superpowers/project-demand-dashboard/Code.js`, `Dashboard.html`, `node-tests.js`

## Problem

Weeks containing public holidays look identical to weeks where demand is genuinely
softening. A 2-day holiday in Chile drops planned/tracked hours for everyone based
there, but the dashboard shows it as an unexplained dip and — because most of the
team does **not** book holidays as `NETSUITE` time-off in Tempo — the capacity
denominator stays at a full 5-day week, so the utilization chip (Headroom/Tight/Over)
overstates available capacity. Some people work the holiday and bank a compensatory
day, so a holiday is not always zero work — but planning should never *rely* on
holiday work.

Two fixes, both in scope:

1. **Math** — reduce weekly capacity by unbooked holiday hours (3–4-day weeks get a
   3–4-day denominator).
2. **Narrative** — badge holiday weeks so managers read dips correctly.

## Data source

The `PH` tab in the contribution main dataset spreadsheet — the **same spreadsheet**
the dashboard already reads (`CONFIG.SOURCE_SS_ID` = `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`).
No new access, scopes, or config plumbing. Schema (as used by the PS report):

| Column | Example |
|---|---|
| Date | 2026-09-18 |
| Location | Chile |
| Holiday | Fiestas Patrias |

Single source of truth: the same tab already feeds the PS dashboard's PH feature,
so maintaining it is zero *new* work.

## Backend (`Code.js`)

### New CONFIG keys

```js
PH_SHEET:                "PH",   // tab in SOURCE_SS_ID
HOLIDAY_HRS_PER_DAY:     8,      // standard day
ANZ_HOLIDAY_HRS_PER_DAY: 7.6,    // 38-hr week ÷ 5 — consistent with ANZ_CAPACITY_HRS
```

### New helpers (ported from `PS Contribution Report.js`, adapted)

- **`readPHData_()`** — reads `PH_SHEET` from `SOURCE_SS_ID`; returns
  `[{ date: "yyyy-MM-dd", location, holiday }]`. Any failure (missing tab, empty,
  bad rows) → `[]` and a `⚠️` log; the dashboard renders exactly as today.
- **`phLocMatchesEmp_(phLoc, empLoc)`** — verbatim port of the fuzzy matcher:
  splits compound PH locations on `&` / `and` / `/`, case-insensitive
  substring match against roster `Key Location`.
- **`buildHolidaysByWeek_(phData, weeks, rosterFull, netsuiteByPersonWeek)`** —
  per displayed ISO week in the window (the hidden `baselineIso` lookback week is
  skipped — it has no capacity computation and never renders):
  - Groups PH rows falling in that week by `location||holiday`.
  - Counts affected people **only among capacity-counted roster rows** (see flag
    below) whose `Key Location` matches — the affected count and the capacity
    denominator use the same population.
  - Computes per-person holiday hours and the NETSUITE shortfall (see math).
  - Returns `{ [iso]: { entries: [{date, location, holiday, affectedCount}],
    totalAffected, holidayHours, shortfallHours } }`.

### `readRosterFull_()` change

Each profile gains `countsForCapacity: true|false` — true for rows that pass the
existing capacity filter (Class = `ROSTER_CLASS`, Dept = `ROSTER_DEPT`, active,
no termination date). Holiday affected-people counts and capacity deductions use
only these rows, keeping numerator and denominator aligned.

### Capacity math (`attachCapacity_`)

Capacity is already `gross − NETSUITE time-off`. Holidays subtract only the
**shortfall** NETSUITE didn't cover, so nothing is double-counted:

```
per capacity-counted person p, week w:
  phHours(p,w)   = matching holiday days × (ANZ_HOLIDAY_HRS_PER_DAY if ANZ else HOLIDAY_HRS_PER_DAY)
  shortfall(p,w) = max(0, phHours(p,w) − netsuiteHours(p,w))    // netsuite from scopedPtoRecs (planned sheet)
holidayShortfallByWeek[iso] = Σp shortfall(p,w)
capByWeek[iso] = max(0, grossCapByWeek[iso] − timeOffByWeek[iso] − holidayShortfallByWeek[iso])
```

Equivalent to `max(booked time-off, holiday hours)` per person:

- Booked the holiday in Tempo → shortfall 0, unchanged (no double count).
- Didn't book it (the common case) → full day(s) removed from capacity.
- Works the holiday for a comp day → capacity still reduced, deliberately:
  planning must not depend on holiday work.

**Fallback (`capacityMode: "planned"`, roster unreadable):** no locations → no
holiday capacity adjustment and no affected counts. Badges still render from the
PH rows (name + location + date only).

### Model additions

- `model.holidaysByWeek` — shape above; empty object when no PH data.
- `model.holidayShortfallByWeek` — per-iso hours actually deducted (for tooltips
  and the so-what line).

`buildDemandModel_()` wiring: read PH after the roster read; pass `scopedPtoRecs`
aggregated to person×week for the shortfall; call `buildHolidaysByWeek_` before
`attachCapacity_`, which now takes the shortfall map.

## Frontend (`Dashboard.html`)

- **Demand vs Capacity panel** — weeks with holidays get a 🏖 marker at the week's
  x-axis label. Hover/tooltip lists entries:
  `Fiestas Patrias · Chile · Sep 18 · 12 people · −96h`. The so-what line
  incorporates the adjustment when a visible week has holiday hours, e.g.
  *“Capacity dips in W38 (−192h public holidays, Chile) — not a demand drop.”*
- **Heatmap** — a small 🏖 chip in affected week column headers so WoW signals
  (Losing >20%, Dropping to zero) are read against a shortened week.
- **Chart-verdict rule** — holiday names, locations, dates, hours, and people
  *counts* only; never individual people's names in chart areas.
- Weeks without holidays render pixel-identical to today.

## Errors & degradation

| Condition | Behavior |
|---|---|
| PH tab missing / renamed / empty | `readPHData_` → `[]`; no badges, capacity as today |
| PH row with bad date / blank cell | Row skipped (same as PS reader) |
| Roster unreadable (planned fallback) | Badges without counts; no capacity adjustment |
| PH location matches nobody | Entry dropped (affectedCount 0), same as PS `buildPHByWeek_` |

## Testing

New `_test_holidayCapacity_()` (GAS editor + `node-tests.js`):

- Shortfall de-dup: person with 16h NETSUITE + 2 holiday days → shortfall 0;
  person with 0h booked → 16h; person with 8h booked + 2 days → 8h.
- ANZ person credited 7.6h/day; non-ANZ 8h/day.
- Non-capacity roster rows (other Class/Dept, terminated) excluded from
  affectedCount and shortfall.
- Compound PH location (`Australia & New Zealand`) matches an ANZ profile.
- Missing PH data → `holidaysByWeek` empty, `capByWeek` unchanged.

## Deploy

1. Paste updated `Code.js` and `Dashboard.html` into the GAS project.
2. Run `_test_holidayCapacity_` (plus existing `_test_demandParse_`,
   `_test_headcount_`, `_test_cacheRoundtrip_`) — all `✅`.
3. Model shape changed → bump `PD_CACHE_VER` (run `bustDemandCache_` /
   the existing bump helper) or press ↻ Refresh once; the 30-min warmer
   repopulates.

## Out of scope

- Auto-fetching holidays (Google Calendar / Nager.Date) — rejected: new
  scopes/dependencies and a second source of truth vs the PH tab.
- Per-person holiday views or names in the UI.
- Changes to the PS dashboard's existing PH feature.
