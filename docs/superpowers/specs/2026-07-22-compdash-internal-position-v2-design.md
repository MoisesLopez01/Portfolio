# CompDash — Internal Position V2 (Peer-Median Compa, Market Benchmarks, Priority Score, Universal Filters)

**Date:** 2026-07-22 (2026.W30) — revised same day to integrate market benchmark data
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

Additionally integrate the **external market benchmark compilation** (Benchmarking
file) so the Market Gap tab goes live and — critically — **"N-of-1" Rocketeers**
(unique Job Title + Location, e.g. a sole Data Analyst in El Salvador) are anchored
to the **external market midpoint** instead of a misleading 100 % internal-equity
score. Internal equity has a structural blind spot for unique roles; external
market parity is the primary baseline there.

Also fixes the two V1 usability complaints: singleton "no peers" groups everywhere
(unique Job Title + Location records), and per-tab-only filters. Tabs + filters
become one sticky, universal bar with a Rocketeer name search.

Reference guidelines (context, not data sources):
- Submit for adjustment — `servicerocket-coe.atlassian.net/wiki/spaces/DEV/pages/111118287`
- Guidelines for Leveling (3/6/9) — `…/pages/111116540`
- MyCompensation V2.0 — `…/wiki/spaces/rantsm/pages/96753602`
- Using AI for salary benchmarking research — `…/wiki/spaces/TEAM/pages/93160153`

---

## 2. Decisions log

| Decision | Choice |
|---|---|
| Compa anchor | **Peer-median proxy midpoint** (no salary-band sheet exists). Median TCC of ACTIVE peers, local currency. Labeled "Internal Position (vs peer median)" |
| Grouping | Key Location + Job Title stays the primary peer group; **tiered fallback** when the title group is small: market midpoint first, then Key Location + Level cohort |
| Anchor stability | Anchors always computed server-side from the FULL active population — UI filters/search never recompute them (user directive) |
| Market source | **Benchmarking** spreadsheet `1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0`, tab `Compilation` — columns KEY, Job Code, Location, Job Title, Local Currency, 25th Percentile TCC, Mean TCC, 75th Percentile TCC, Source or Website |
| Market join | Normalized **Location + Job Title** ↔ roster **Key Location + Job Title**; all values LOCAL currency; missing rows expected ("we are going to compile it later") — everything degrades to pending per row |
| Market midpoint | **Mean TCC** — labeled "Mean (market midpoint)" everywhere, never presented as P50/median |
| N-of-1 rule | Unique-role Rocketeers anchor to the external market mean (External Market Parity replaces internal equity when no peers exist); real title peers still win when they exist, market then shows as a separate vs-market ratio |
| Market Gap tab | Goes **LIVE** (was V1 placeholder) — per-employee P25 / Mean / P75 + suggestion, coverage banner while compilation is in progress |
| Ratings source | Tab `Small Improvements RD` in the contribution-data spreadsheet `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`; ID column = Employee Number |
| Priority Score | **Full composite now**, weights in `CONFIG_CD` (auditable, tunable). Rendered as a ranked table on the Internal Position tab |
| Mastery band (3/6/9) | **Out of scope this iteration** (user: "ignore this one"). Its 40/30/20/10 weight share renormalizes to perf 57 / tenure 29 / compaGap 14 |
| Also still deferred | Cost-of-Labor (COL) cross-regional multiplier, Skills Assessment Score, Role Impact Factor — named in the Unique Role framework but no data source exists yet; recorded as intended future data drops |
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

BENCH_SS_ID:    "1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0", // CD_BENCH_SS_ID override
BENCH_TAB:      "Compilation",                                  // CD_BENCH_TAB override
MARKET_LOW:     0.90,     // vs-market ratio below this = "largest market gap" priority read

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

### New reader — `readBenchmarks_()`

- Opens `CD_BENCH_SS_ID` → tab `Compilation` (tolerant `fetchTab_` lookup).
- Columns by header name: `Location`, `Job Title`, `Local Currency`,
  `25th Percentile TCC`, `Mean TCC`, `75th Percentile TCC`, `Source or Website`
  (`KEY` / `Job Code` read-ignored — the join key is built internally).
- Returns a map keyed by `normCD_(Location) + "||" + normCD_(Job Title)` →
  `{ p25, mean, p75, currency, source }`. Rows with no parsable Mean TCC are kept
  only if P25 or P75 parses (partial rows render what they have).
- **Join**: employee `Key Location + Job Title` (normalized) → benchmark row.
  All benchmark values are LOCAL currency; if the benchmark `Local Currency`
  disagrees with the employee's roster currency, the row is ignored for that
  employee and counted in a `currencyMismatch` diagnostic — never silently
  compared across currencies.
- Missing rows are normal while the compilation grows — per-employee fields stay
  null and every consumer shows a pending state.
- Failure → `meta.sources.benchmarks = "error: …"`; Market Gap tab reverts to the
  V1 pending banner, anchor engine skips the market tier.

### Anchor engine V2 (replaces max anchor in `buildCompaGroups_`)

Per Key Location + Job Title group, over ACTIVE members with TCC > 0, local currency:

1. Group size ≥ `SMALL_GROUP_MIN` → `anchor = median(group TCC)`, `anchorTier: "title"`.
2. Else, if the group's Location + Job Title has a benchmark row with a Mean TCC →
   `anchor = market mean`, `anchorTier: "market"` — External Market Parity replaces
   internal equity for unique roles (the N-of-1 rule).
3. Else → `anchor = median(Key Location + Level cohort TCC)` where the cohort has
   ≥ `SMALL_GROUP_MIN` members, `anchorTier: "level"`. Members with level `"—"`
   never borrow a cohort (this tier is unavailable for them).
4. Else → `ratio: null`, `anchorTier: "none"`, flag `insufficientPeers`.

`ratio = tcc ÷ anchor` (3 dp) — may exceed 1.0. Group payload keeps `count`,
`missingTcc`, `smallGroup`; member rows gain `anchor`, `anchorTier`. Members sort
**ratio ascending** (lowest position first — priority read; null ratios last),
was TCC descending.
Anchors derive from the full active population before any UI filtering, always.

### Per-employee derived fields (on `employees[]`)

| Field | Derivation |
|---|---|
| `ratio`, `anchor`, `anchorTier` | From the anchor engine (denormalized for the ranking table) |
| `p25`, `p50`, `p75`, `benchSource` | From the benchmark join (`p50` field carries **Mean TCC** — UI labels it "Mean"; field name kept for the V1 Market Gap renderer contract); null when no row |
| `marketRatio` | `tcc ÷ mean` — the "Compa-Ratio vs Market (not Peers)" indicator, computed for **everyone** with benchmark data, independent of `anchorTier` |
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

The `compaGap` component consumes the **resolved anchor's** ratio — for N-of-1
Rocketeers that is the market-mean ratio, so "at 80 % of market but 100 % of
internal equity" correctly reads as underpaid and ranks high. This also satisfies
the headcount-allocation rule (prioritize vs-market ratio < `MARKET_LOW` = 0.90):
those rows carry the largest gap component. One weight set for all tiers —
per-tier weight boosts (the "historical contribution counts more for unique
roles" idea) are deliberately deferred until leadership has seen the base score.

### Payload additions

- `people[]` — compact ALL-records array (active + terminated) for client-side
  attrition recompute under filters: `{ empNo, name, dept, level, keyLocation,
  hireDate, termDate, termCls, regretted }`.
- `meta.sources.ratings`, `meta.ratingsCount`, `meta.priorityCfg`, new-shape
  `meta.compaBands = { low, target, high }`.
- `meta.sources.benchmarks`, `meta.benchCoverage = { rows, matchedEmployees,
  currencyMismatch }` — powers the Market Gap coverage banner.
- `marketSuggestion_()` now runs **server-side** per employee (status + %-to-P25 /
  %-to-mean), retiring the V1 client-only mirror `marketRow()` and its
  documented drift risk. Thresholds: below P25 = red priority, P25→mean = yellow,
  at/above mean = green.

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
   Ratio, vs Market, Avg rating, Tenure (Cmp/Prof), TTM growth, Score. Default
   sort: score descending. The vs-Market chip renders red below `MARKET_LOW`
   (0.90) — the headcount-allocation priority read. `partial` rows show a hollow
   score chip with a tooltip naming the missing component. Click → drill.
3. **Group cards** below, as V1 but: anchor line shows the tier badge —
   "median · title peers", "**market mean**" (the N-of-1 case), or
   "median · level cohort" — member rows sorted ratio ascending, 4-band chip
   colors (red < 0.80, yellow < 0.95, green ≤ 1.10, violet "above median" > 1.10).

### Market Gap tab — LIVE

The V1 "benchmark data pending" banner is replaced by a **coverage banner**:
"Market data: N of M active Rocketeers matched (compilation in progress)" from
`meta.benchCoverage`, plus the currency-mismatch count when non-zero. Columns as
V1 (Emp #, Name, Job Title, TCC, P25, **Mean**, P75, vs market, Suggestion) — the
middle column header reads "Mean (midpoint)", values render from the server-side
suggestion, and the `Source or Website` value appears as a tooltip on the market
cells. Unmatched employees keep per-row pending chips, so the tab is useful from
the first compiled row onward.

### Drill panel additions

Under the existing chips/waterfall: **Priority Score chip with component
breakdown** (perf/tenure/gap × weight), **ratings history strip** — one chip per
fiscal quarter (`FY24Q2 · 4`), colored green ≥ 4 / neutral 3 / red < 3, explanation
as title-tooltip — plus avg-rating, company/profile tenure, TTM growth, and
(when benchmarked) vs-market chips with the benchmark source in a tooltip.

### Overview

KPI card #2 becomes "median Internal Position (vs peer median)". KPI card #3
("Is our band still competitive in the market?") **lights up**: median vs-market
ratio across benchmarked Rocketeers, subtitle "N of M benchmarked". All six cards
recompute under filters (subtitle shows "filtered" when active).

### Data Reference

New/updated rows: Internal Position formula (anchor tiers **including the N-of-1
market rule** + new bands, numbers interpolated from `meta.compaBands`),
Priority Score (weights/caps from `meta.priorityCfg`, redistribution rule),
Ratings source (tab, join key, scale), Benchmark source (Compilation tab, join
key, "Mean is a mean, not P50", currency rule, coverage stats), Tenure
definitions, TTM growth, and the filter-behavior note ("anchors never recompute
under filters"). Sources table gains ratings + benchmarks rows with live status.

---

## 6. Error handling

- `readRatings_()` failure → banner on Internal Position + Data Reference status;
  Priority Score degrades via weight redistribution (`partial`), never crashes.
- `readBenchmarks_()` failure → Market Gap reverts to the V1 pending banner and
  the anchor engine skips the market tier (falls through to the level cohort).
- Employees absent from the ratings tab → no perf component, `partial` flag.
- Benchmark row with mismatched currency → ignored for that employee, counted in
  `meta.benchCoverage.currencyMismatch`, surfaced on the coverage banner.
- `anchorTier: "none"` rows render "insufficient peers" chip, blank ratio, and a
  compaGap-less priority score.
- Existing V1 source-banner pattern (`meta.sources`) extends to `ratings` and
  `benchmarks`.

---

## 7. Testing (`CompDash/tests`, Node-runnable)

Pure functions, GAS-free: anchor tiering (≥3 title / market fallback / level
fallback / none, benchmark-currency mismatch), median edge cases, priority score
+ weight redistribution (incl. market-anchored gap), tenure derivations (promo
event vs fallback), TTM growth (event ≤ asOf − 1y, short history → null),
ratings aggregation + fiscal-quarter ordering, benchmark join normalization +
partial rows (Mean missing but P25/P75 present), `marketSuggestion_` thresholds
against the mean, and a client/server attrition parity test (unfiltered client
re-bucket of `people[]` must equal the server block). `debugCompPipeline()` adds:
ratings join hit-rate (matched ÷ active), benchmark coverage (rows, matched
employees, currency mismatches), anchor-tier distribution
(title / market / level / none counts).

---

## 8. Deployment

1. Push `Code.js` + `ViewDash.html` to the GAS project.
2. Script Properties: set `CD_RATINGS_SS_ID` + `CD_BENCH_SS_ID` (fallbacks are in
   code), `CD_CONTRIB_URL` = the live PS Contribution Report exec URL.
3. Run `debugCompPipeline()` — verify ratings join hit-rate, benchmark coverage,
   and anchor-tier distribution.
4. Run `bustCompCache_()` (payload shape changed).
5. New web-app deployment version.

---

## 9. Explicitly deferred

- Mastery band (3/6/9) parsing + its Priority Score weight (user descoped).
- Cost-of-Labor cross-regional multiplier, Skills Assessment Score, Role Impact
  Factor, per-tier Priority weights for unique roles — no data sources yet;
  named by the Unique Role framework as future drops.
- True salary-band midpoints (payload's `anchor` field is the drop-in point).
- Official QTA source, org-scoped manager access, crew inclusion
  (V1 deferrals, unchanged).
