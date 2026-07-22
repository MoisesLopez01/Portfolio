# CompDash — Internal Position V2 (Peer-Median Compa, Priority Score, Universal Filters)

**Date:** 2026-07-22 (2026.W30)
**Status:** Approved design, pending implementation plan
**Author:** Moises Lopez + Claude
**Builds on:** `2026-07-21-comp-health-dashboard-design.md` (V1, shipped)

---

## 1. Objective

Move the Comp Health Dashboard's fairness math beyond the V1 "vs peer max" baseline,
following ServiceRocket's salary-adjustment guidelines: anchor compa-ratio to a
**derived peer-median (proxy midpoint)**, integrate **Small Improvements performance
ratings** as a historical record per Rocketeer, add **tenure (company vs profile)**
and **trailing-12-month TCC growth**, and compute a config-weighted
**Priority Score** that tells leadership who to prioritize for adjustment —
high performers currently underpaid relative to their peers.

Also fixes the two V1 usability complaints: singleton "no peers" groups everywhere
(unique Job Title + Location records), and per-tab-only filters. Tabs + filters
become one sticky, universal bar with a Rocketeer name search.

Reference guidelines (context, not data sources):
- Submit for adjustment — `servicerocket-coe.atlassian.net/wiki/spaces/DEV/pages/111118287`
- Guidelines for Leveling (3/6/9) — `…/pages/111116540`
- MyCompensation V2.0 — `…/wiki/spaces/rantsm/pages/96753602`

---

## 2. Decisions log

| Decision | Choice |
|---|---|
| Compa anchor | **Peer-median proxy midpoint** (no salary-band sheet exists). Median TCC of ACTIVE peers, local currency. Labeled "Internal Position (vs peer median)" |
| Grouping | Key Location + Job Title stays the primary peer group; **tiered fallback** to Key Location + Level cohort when the title group is small (Approach A) |
| Anchor stability | Anchors always computed server-side from the FULL active population — UI filters/search never recompute them (user directive) |
| Ratings source | Tab `Small Improvements RD` in the contribution-data spreadsheet `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`; ID column = Employee Number |
| Priority Score | **Full composite now**, weights in `CONFIG_CD` (auditable, tunable). Rendered as a ranked table on the Internal Position tab |
| Mastery band (3/6/9) | **Out of scope this iteration** (user: "ignore this one"). Its 40/30/20/10 weight share renormalizes to perf 57 / tenure 29 / compaGap 14 |
| Profile tenure | Derived from RD events — time since most recent promotion/title-change event; falls back to Hire Date |
| Filter depth | Universal filters recompute **everything** (Overview KPIs, attrition, equity, QTA, ranking) for the filtered population — except peer anchors (above) |
| Search | Name search is one more universal predicate; matching rows open the existing drill |
| Contribution link | `CD_CONTRIB_URL` Script Property set at deploy to the live PS Contribution Report URL |
| 9-month review cadence | Not a build item — QTA interim view already surfaces Next Review overdue-first; cadence policy lives in the wiki |

---

## 3. Config additions (`CONFIG_CD`)

```js
RATINGS_SS_ID:  "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // CD_RATINGS_SS_ID override
RATINGS_TAB:    "Small Improvements RD",                        // CD_RATINGS_TAB override
RATING_MAX:     5,        // Small Improvements scale ceiling — perf normalizes as avg ÷ this

// Anchor tiering (reuses SMALL_GROUP_MIN = 3 as the minimum peer count per tier)

// Compa color bands V2 — ratio can exceed 1.0 now (median anchor)
COMPA_LOW_MIN:    0.80,   // ≥ this renders yellow; below is red
COMPA_TARGET_MIN: 0.95,   // ≥ this renders green ("at target", per the 95–100% guideline)
COMPA_HIGH_MAX:   1.10,   // > this renders the "above median" (ceiling-watch) chip

PRIORITY_W: { perf: 57, tenure: 29, compaGap: 14 },  // sum 100; echoed via meta
PRIORITY_CAPS: { companyYears: 10, profileYears: 5, gapPct: 0.25 },

PROMO_RE: /promot|title change|role change/i,  // RD reasons that reset profile tenure
```

V1's `COMPA_GREEN_MIN` / `COMPA_YELLOW_MIN` are replaced by the three bands above;
`meta.compaBands` ships the new shape and `ratioClass()` + Data Reference prose
consume it (no client literals — same rule as V1).

---

## 4. Data model

### New reader — `readRatings_()`

- Opens `CD_RATINGS_SS_ID` → tab `Small Improvements RD` (tolerant `fetchTab_` lookup).
- Columns by header name: `ID`, `Fiscal Quarter`, `Rate`, `Rating Explanation`.
- Returns `{ byEmp: { empNo: [{ fq, rate, explanation }] }, count }`, rows with a
  blank ID or non-numeric Rate skipped. Consumers sort; fiscal quarters of the form
  `FY24Q2` sort correctly as strings (fixed width).
- Failure → `meta.sources.ratings = "error: …"`; everything else still renders.

### Anchor engine V2 (replaces max anchor in `buildCompaGroups_`)

Per Key Location + Job Title group, over ACTIVE members with TCC > 0, local currency:

1. Group size ≥ `SMALL_GROUP_MIN` → `anchor = median(group TCC)`, `anchorTier: "title"`.
2. Else → `anchor = median(Key Location + Level cohort TCC)` where the cohort has
   ≥ `SMALL_GROUP_MIN` members, `anchorTier: "level"`. Members with level `"—"`
   never borrow a cohort (tier 2 unavailable for them).
3. Else → `ratio: null`, `anchorTier: "none"`, flag `insufficientPeers`.

`ratio = tcc ÷ anchor` (3 dp) — may exceed 1.0. Group payload keeps `count`,
`missingTcc`, `smallGroup`; member rows gain `anchor`, `anchorTier`. Members sort
**ratio ascending** (lowest position first — priority read; null ratios last),
was TCC descending.
Anchors derive from the full active population before any UI filtering, always.

### Per-employee derived fields (on `employees[]`)

| Field | Derivation |
|---|---|
| `ratio`, `anchor`, `anchorTier` | From the anchor engine (denormalized for the ranking table) |
| `perfAvg`, `perfLatest`, `perfCount` | From ratings history; `null`/0 when absent |
| `tenureCompanyYears` | (asOf − Hire Date) in years, 1 dp |
| `tenureProfileYears` | (asOf − most recent RD event matching `PROMO_RE`) in years; falls back to `tenureCompanyYears` |
| `ttmGrowthPct` | Current TCC vs the TCC in effect 12 months ago (last RD event dated ≤ asOf − 1y); `null` when history doesn't reach back a year |
| `priority` | `{ score, components: { perf, tenure, compaGap }, partial }` (below) |

`history[empNo]` (drill payload) gains `ratings: [{ fq, rate, explanation }]`
sorted ascending.

### Priority Score

Components, each normalized 0–1:

- `perf = perfAvg ÷ RATING_MAX`
- `tenure = 0.5 × min(companyYears ÷ 10, 1) + 0.5 × min(profileYears ÷ 5, 1)` (caps from `PRIORITY_CAPS`)
- `compaGap = min(max(0, 1 − ratio) ÷ 0.25, 1)` — full credit at ≥ 25 % below the peer median

`score = round(Σ weight × component)` on a 0–100 scale. A missing component
(no ratings, `ratio: null`) drops out and its weight redistributes proportionally
across the remaining ones; the row is flagged `partial: true`. No component ever
fakes a zero. Weights + caps echo into `meta.priorityCfg` for the Data Reference tab.

### Payload additions

- `people[]` — compact ALL-records array (active + terminated) for client-side
  attrition recompute under filters: `{ empNo, name, dept, level, keyLocation,
  hireDate, termDate, termCls, regretted }`.
- `meta.sources.ratings`, `meta.ratingsCount`, `meta.priorityCfg`, new-shape
  `meta.compaBands = { low, target, high }`.

---

## 5. UI (ViewDash.html)

### Sticky universal bar

Header + tab bar + a new **filter bar** wrap in a single `position: sticky; top: 0`
container so navigation and filters stay pinned while the report scrolls.
Filter bar: **Location / Level / Department** selects + **🔎 name search** input,
backed by global `STATE.filters = { loc, level, dept, q }` (replaces
`STATE.compaFilters`). A "clear filters" chip appears when any predicate is active.

### Filter semantics

- `visible(emp)` helper applies all four predicates (search = case-insensitive
  substring on the normalized name).
- **Every renderer** consumes filtered data: Overview KPI cards, attrition
  chart/rate/slices/detail, Internal Position ranking + group cards, Market Gap,
  Pay Equity flag lists, QTA list.
- **Attrition recompute:** when any filter is active, the client re-buckets from
  `people[]` (ports of the pure `fiscalMonthIdx_` / headcount-mean math — counts per
  fiscal month, vol/invol split, rate = terms ÷ mean(start, end headcount) of the
  filtered population). With no filters active, the server-computed `attrition`
  block renders as the fast path — the two must agree (test below).
- **Never recomputed:** group anchors/ratios and equity group stats' medians —
  computed server-side from full groups. Filters only choose which groups/rows show.
- Pay Equity group *stats* (gender gap %, medians) are server-side facts about full
  groups: filters hide/show groups and flag rows, never re-derive the medians.

### Internal Position tab V2

1. **Banner** rewritten for the median anchor: "TCC ÷ median TCC of active peers
   (same Key Location + Job Title; small groups fall back to the location's level
   cohort). 1.00 = the local peer median — ratios above 1.00 are expected."
2. **🎯 Priority ranking card** (new, top): sortable table — Name, Location, Level,
   Ratio, Avg rating, Tenure (Cmp/Prof), TTM growth, Score. Default sort: score
   descending. `partial` rows show a hollow score chip with a tooltip naming the
   missing component. Click → drill.
3. **Group cards** below, as V1 but: anchor line shows
   "Anchor (median · title peers)" or "median · level cohort" badge, member rows
   sorted ratio ascending, 4-band chip colors (red < 0.80, yellow < 0.95,
   green ≤ 1.10, violet "above median" > 1.10).

### Drill panel additions

Under the existing chips/waterfall: **Priority Score chip with component
breakdown** (perf/tenure/gap × weight), **ratings history strip** — one chip per
fiscal quarter (`FY24Q2 · 4`), colored green ≥ 4 / neutral 3 / red < 3, explanation
as title-tooltip — plus avg-rating, company/profile tenure, and TTM growth chips.

### Overview

KPI card #2 becomes "median Internal Position (vs peer median)"; all six cards
recompute under filters (subtitle shows "filtered" when active).

### Data Reference

New/updated rows: Internal Position formula (anchor tiers + new bands, numbers
interpolated from `meta.compaBands`), Priority Score (weights/caps from
`meta.priorityCfg`, redistribution rule), Ratings source (tab, join key, scale),
Tenure definitions, TTM growth, and the filter-behavior note ("anchors never
recompute under filters"). Sources table gains the ratings row with live status.

---

## 6. Error handling

- `readRatings_()` failure → banner on Internal Position + Data Reference status;
  Priority Score degrades via weight redistribution (`partial`), never crashes.
- Employees absent from the ratings tab → no perf component, `partial` flag.
- `anchorTier: "none"` rows render "insufficient peers" chip, blank ratio, and a
  compaGap-less priority score.
- Existing V1 source-banner pattern (`meta.sources`) extends to `ratings`.

---

## 7. Testing (`CompDash/tests`, Node-runnable)

Pure functions, GAS-free: anchor tiering (≥3 title / level fallback / none),
median edge cases, priority score + weight redistribution, tenure derivations
(promo event vs fallback), TTM growth (event ≤ asOf − 1y, short history → null),
ratings aggregation + fiscal-quarter ordering, and a client/server attrition
parity test (unfiltered client re-bucket of `people[]` must equal the server
block). `debugCompPipeline()` adds: ratings join hit-rate (matched ÷ active),
anchor-tier distribution (title / level / none counts).

---

## 8. Deployment

1. Push `Code.js` + `ViewDash.html` to the GAS project.
2. Script Properties: set `CD_RATINGS_SS_ID` (fallback is in code),
   `CD_CONTRIB_URL` = the live PS Contribution Report exec URL.
3. Run `debugCompPipeline()` — verify ratings join hit-rate and tier distribution.
4. Run `bustCompCache_()` (payload shape changed).
5. New web-app deployment version.

---

## 9. Explicitly deferred

- Mastery band (3/6/9) parsing + its Priority Score weight (user descoped).
- True salary-band midpoints (payload's `anchor` field is the drop-in point).
- Payscale Market Gap data, official QTA source, org-scoped manager access,
  crew inclusion (all V1 deferrals, unchanged).
