# 📈 Performance Record Tab — Design

**Date:** 2026-08-18 (2026.W34)
**Status:** Approved design, pre-implementation
**Audience:** managers + WFP team — coaching prep, promotion review, salary-adjustment review
**Decision trail:** signal source = reuse Leading Behaviours machinery · access = admin+manager ·
window = one window / three bucketings (2 closed quarters + QTD) · layout = metric-per-column grid ·
drill = full evidence panel · dot = last closed bucket + trend · aggregation = client-side.

---

## 1. Purpose

A new dashboard tab that lets a manager or WFP reviewer scan every rocketeer's record of
performance across ~3 quarters, spot excelling vs needs-support areas via micro charts and
red/yellow/green signals, build a focus group with filters and sorting, and drill into the
evidence behind any signal.

**Signals are reading aids, never verdicts.** Every colour carries a deterministic,
rule-generated note stating the observation ("compliant 3 of 13 weeks"). The manager judges;
the tab only makes the data legible.

## 2. Tab registration & access

- New `VIEWS` entry in `PS Dashboard.html`:
  `{ id: "perfrecord", btnId: "tabBtnPerfRecord", paneId: "tabPerfRecord", label: "📈 Performance Record", location: "tabbar", roles: ["admin", "manager"] }`
- Role gating enforced in `switchTab()` (forbidden id → Overview), buttons hidden by
  `applyRoleToNav_()` — both derive from `VIEWS`, no extra wiring.
- Managers see only their org tree (existing manager scoping in the payload).
  WFP members are onboarded via 🔒 Access Control as admins or delegates. Viewers never see the tab.
- The tab follows the **global team toggle** (Services / R&D / Sales & Success) and the
  **FTE vs crew toggle**. Metric columns are gated by `team.metrics` ("team gates, family tunes"):
  R&D and Sales & Success never render Tracked / Planned / RCR columns.

## 3. Data window & bucketing

- **Window:** the two most recently completed fiscal quarters plus the quarter in progress
  (FY starts July 1; quarter boundaries from `computeFiscalContext_()`). As of 2026.W34 that is
  FY26.Q3 + FY26.Q4 closed, FY27.Q1 in progress — up to ~39 ISO weeks.
- **One window, three bucketings.** The Weekly / Monthly / Quarterly toggle only re-buckets the
  same window: ~26–39 weekly bars, ~6–9 monthly bars, 2 closed quarterly bars + 1 in-progress.
  Bucketing reuses the existing period machinery (`periodBucketsForEmp_` for month/quarter;
  the weeks list for weekly).
- **In-progress buckets** render faded (~35% opacity) and are excluded from the signal dot and
  trend arrow. No mean is ever presented over an in-progress bucket as if it were closed.
- **Server change (the only one):** `PS Contribution Report.js` widens the per-employee week
  window (`q4Weeks` + `e.weeks` population) from two quarters to three. Deploy requires a
  `PS_CACHE_VER` bump. The gzip-chunked cache (`cachePutLarge_`) absorbs the ~50% payload
  growth; implementation verifies the chunk count and load time before deploy.

## 4. Per-metric values (client-side, single source of truth)

All values derive from the existing `computeRkScore(emp, weekLabel)` normalizations — this tab
never re-implements scoring math, so it can never disagree with Top Rocketeers.

Per bucket, per employee:

| Metric  | Bucket value | Notes |
|---|---|---|
| Score   | mean of weekly `score` over weeks with data | headline column |
| Goals   | share of weeks with `goalsDetail.compliant` | weeks without goals data excluded |
| Tracked | mean of weekly `trackedNorm` (hrs vs 0.9×plan, PTO-adjusted) | plus raw hrs for evidence |
| Planned | mean of weekly `plannedNorm` (hrs vs PTO-adjusted 40h target) | plus raw hrs |
| Kudos   | received count, given count summed over bucket | norm not averaged — counts shown |
| PTO     | share of weekly snapshots with status "Good" | |
| RCR     | current `emp.rcr.value` | payload carries current value only — value + dot, **no bars** |
| SI      | current `emp.si.value` | same — value + dot, no bars. If per-period history turns out to be available in the payload at plan time, RCR/SI get bars like the rest |

Aggregation runs once per render into a memo keyed by `(teamKey, crewMode, granularity)`,
invalidated on data reload — 140+ employees × 7 metrics × ~39 weeks is trivial client work
but never recomputed per scroll/sort.

## 5. Signals

One `SIGNAL_BARS` constant (hardcoded v1 — thresholds are a reading aid, tuned in code, not
in the ⚖️ Scoring Weights sheet). **Cohort-aware:** managers (Job Catalog track M **or** has
direct reports — the existing cohort rule) get their own tracked/planned bars.

v1 thresholds (green / yellow / red on the bucket value):

| Metric | IC | Manager | Red possible? |
|---|---|---|---|
| Score   | ≥75 / ≥50 / <50 | same | yes |
| Goals   | ≥0.80 / ≥0.40 / <0.40 (weekly granularity: binary green/red; grace-period weeks gray) | same | yes |
| Tracked | ≥0.85 / ≥0.55 / <0.55 | ≥0.50 / <0.50 | **managers never red** (their week is coaching/escalation, which never reaches Tempo) |
| Planned | ≥0.85 / ≥0.50 / <0.50 | ≥0.70 / ≥0.40 / <0.40 (mirrors the 70/40 manager bar) | yes |
| Kudos   | green = gave AND received in bucket · yellow = one of the two · gray = neither | same | **never red** |
| PTO     | "Good" → green · "At Risk" → red · no snapshot → gray | same | yes (no yellow) |
| RCR     | ≥2.0 / ≥1.25 / <1.25 · null → gray | same | yes |
| SI      | ≥4 / ≥3 / <3 · null → gray | same | yes |

- **Dot** (drives sorting and Flagged-only) = the signal of the **last closed bucket** at the
  current granularity, with a trend marker vs the bucket before: ↗ / ↘ when the value moved
  by more than 0.05 (5 pts for Score), else →.
- **Bars** in the micro chart are individually coloured by that bucket's signal.
- **Gray = no data / not evaluated**, distinct from red. Sort severity: red 3 · yellow 2 ·
  green 1 · gray 0.

### Signal notes (deterministic, no AI)

Every non-green dot carries a rule-generated observation, composed from templates:

- Tracked: `"62% of plan in FY26.Q4 (was 88% in Q3)"`
- Goals: `"compliant 3 of 13 weeks in FY26.Q4"`, `"no self-comments since quarter start"`
- Planned: `"planned 4 of 13 weeks"`
- PTO: `"At Risk since 2026.W29 — no recovery plan"`
- Kudos (yellow): `"received 2 · gave 0 in window"`

The row-level **Reading** column synthesizes: names the support-area metrics in severity
order plus the window shape — `"support: goals, tracked · declining 2 buckets"`,
`"green across window · steady or rising"`. Observations only, never recommendations
("coaching candidate", "promotion-ready" and similar verdict language is out of scope by design).

## 6. Table layout (high-level view)

One row per rocketeer:

```
Rocketeer (name, family·level, location, supervisor) | Score dot+val+trend |
[per team.metrics: Goals | Tracked | Planned | RCR | Kudos | PTO | SI] | Reading
```

- Each metric cell: signal dot + trend marker + micro bar chart (one bar per bucket,
  bucket-coloured, in-progress faded). RCR/SI cells: dot + value only.
- Badges on the name cell follow existing policy: 🌱 ramp-up (Goals/Kudos/RCR/SI grayed —
  excluded metrics; Tracked/Planned/PTO live), 🏖 on-leave (all gray), crew rows appear only
  in crew mode and gate to Tracked/RCR/Kudos.
- Rendered only when the tab is active (standard `renderAll()` dispatch via `VIEWS`);
  micro charts are inline SVG/DIV bars, no Chart.js instances (250+ canvases would crawl).
- Horizontal scroll inside the table container on narrow screens; column count ≤9.

## 7. Controls, sorting, export

- **Period toggle** (tab-local, chip-toggle pattern): Weekly / Monthly / **Quarterly (default)**.
- **Global filter bar** applies as on Overview: supervisor, location, job family, search.
- **Flagged only** chip: rows with ≥1 red or yellow dot.
- **Column-header sort**: severity desc, then bucket value asc (worst first); click again to
  invert. Default sort: needs-support-first (red dot count desc → yellow count desc → name).
- **⬇ CSV**: exports the current filtered/sorted view — person, cohort, family·level,
  supervisor, per-metric dot + bucket value + note, Reading. Client-side blob download,
  same pattern as the demand dashboard's person×week CSV.

## 8. Drill-down (evidence panel)

Clicking a row expands an in-place panel (lazy-rendered on first open, demand-dashboard style):

1. **Header:** name, role, family·level, supervisor, tenure, badges, signal chips.
2. **Per-metric evidence blocks** (one per gated metric, at current granularity): a compact
   period table of **real values** — tracked/planned hrs, weeks compliant + self-comments/week,
   kudos entries (week, giver, org values, given/received), PTO status timeline, RCR/SI values —
   with the full signal note as the block title.
3. **Open full profile in Overview →** — existing `viewRocketeerDetails(normName)` hook.

One row expanded at a time (matching Overview's `STATE.expanded` convention).

## 9. Files touched

| File | Change |
|---|---|
| `ps-dashboard/PS Dashboard.html` | `VIEWS` entry, pane HTML, CSS, aggregation memo, signal engine (`SIGNAL_BARS`, `signalFor_`, `trendFor_`, `readingNote_`), table + drill renderers, CSV export |
| `ps-dashboard/PS Contribution Report.js` | widen per-employee week window to 3 quarters |
| deploy | push both files, bump `PS_CACHE_VER` |

No changes to `PS Security.js` (roles already exist) or `PS_Post.js`.

## 10. Testing

- **Unit checks (node-eval):** extract the dashboard `<script>` block, evaluate the pure
  helpers (`bucketize_`, `signalFor_`, `trendFor_`, `readingNote_`, CSV row builder) against
  fixture employees — cohort bars, gray-vs-red, in-progress exclusion, trend arrows,
  ramp-up/on-leave gating, team metric gating.
- **Payload check:** after widening the window, assert cached chunk count and payload size
  against CacheService limits; measure a cold load.
- **Layout QA:** tests are blind to layout — render the tab with live data and review a
  screenshot (per the table-discipline rule) at desktop and narrow widths, light + dark mode.

## 11. Out of scope (explicit)

- Admin-editable signal thresholds (revisit only if tuning churn proves real).
- AI-generated narratives on this tab — notes are template-based on purpose.
- RCR/SI history bars (contingent on payload history — see §4).
- HubSpot metrics for Sales & Success (appended to `TEAMS_` in a later phase, columns will
  follow `team.metrics` automatically).
- Any write-back (coaching notes, review flags) — the tab is read-only v1.
