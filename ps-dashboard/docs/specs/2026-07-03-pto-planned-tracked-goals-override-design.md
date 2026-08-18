# Design: PTO-Aware Planning, Tracking & Goals Compliance

**Date:** 2026.W27 (2026-07-03)
**Status:** Approved for implementation
**Files:** `PS Contribution Report.js`, `PS Dashboard.html`

---

## Overview

PTO already reduces raw Planned Time hours (`subtractPTOFromPlanned_`), and Tracked Time is
correctly left untouched (it's actual logged work — PTO doesn't show up there). What's missing:

1. The **fixed weekly targets** used to *score/normalize* Planned hours (40h cap, 36h radar
   floor, top-performer scoring) don't shrink when someone took PTO — so a PTO week can still
   look like "under-planned" even though the raw number is already net of PTO.
2. **Goals compliance** has no PTO awareness at all — a full-week-PTO rocketeer can fail the
   self-comment-pacing rule for a week they were never able to act on.
3. **Managers have no signal** connecting a dip in the numbers to PTO — the Executive Brief only
   reports team-wide PTO balance health (Good/At-Risk %), not "this week's dip is PTO, not a
   performance issue."

This design closes those three gaps. It does **not** change Tracked Time's raw values, does not
introduce day-level granularity (no data source supports it), and does not add per-employee PTO
detail to any surface beyond what already exists (the employee detail panel's PTO pill).

---

## Non-goals

- No day-level PTO tracking. Every PTO/Planned/Tracked source in this codebase is weekly-only;
  this design stays at weekly granularity.
- No change to raw Tracked Time values — confirmed accurate as-is, uninfluenced by PTO.
- No naming of individuals in the Executive Brief PTO note (aggregate count only).
- No new UI on the employee detail panel (existing `ptoPlannedHrs` pill already covers it).
- No change to the Goals pacing clock for weeks *after* a PTO week — the exemption is a
  per-week snapshot override, not a clock pause/shift.

---

## Feature 1 — PTO-adjusted weekly target

### New backend field

Computed once in `computePSReport_()` → `buildEmployeeRows_()`, alongside the existing
`ptoPlannedHrs`:

```js
emp.weeks[label].ptoAdjustedTargetHrs = Math.max(
  CONFIG_PS.PTO_MIN_TARGET_HRS,                              // floor, default 0
  CONFIG_PS.SCORE_PLANNED_CAP_HRS - (emp.weeks[label].ptoPlannedHrs || 0)
);
```

Normal week (0h PTO) → 40h target, unchanged. A week with 8h PTO → 32h target. A full-PTO week
(40h+) → floors at `PTO_MIN_TARGET_HRS` (0).

### Consumers — corrected after reading the actual implementation

Reading the real code turned up two corrections to the mechanism originally assumed above:

**1. Team Radar** (`PS Dashboard.html` — `computeGroupMetrics()`): the Planned/Tracked axes do
**not** compare hours against a 40h/36h target — they score a **binary compliance percentage**:
"% of the group who logged/planned ANY hours > 0 that week." A numeric PTO-adjusted target
ratio doesn't apply to a binary metric. Fix instead: **exclude** anyone with
`ptoPlannedHrs >= CONFIG_PS.PTO_IMPACT_THRESHOLD_HRS` that week from that axis's denominator (`n`
in `trackedCompliancePct`/`plannedCompliancePct`), so their 0 hours during a PTO week isn't
counted as "failed to plan/track" — the same exclusion pattern already used for Goals.

**2. Top Rocketeers scoring** (`buildTopPerformers_` server-side, `computeRkScore` client-side —
kept in sync in the same commit, per the project's existing SI/PTO-denominator precedent):
```js
// before: plannedNorm = min(plannedHrs / CONFIG_PS.SCORE_PLANNED_CAP_HRS, 1)
plannedNorm = Math.min(plannedHrs / (ptoAdjustedTargetHrs || CONFIG_PS.SCORE_PLANNED_CAP_HRS), 1);
```
Additional related fix (same root cause, found while implementing): `trackedNorm`'s target
falls back to a flat `DEFAULT_TARGET_WEEKLY_HRS` (36h) whenever `plannedHrs` is 0 — which is
exactly what happens in a full-PTO week (Planned is already net of PTO). Without a fix, tracked
score would still be zeroed out on a full-PTO week even after the `plannedNorm` fix above. The
fallback switches to `ptoAdjustedTargetHrs * SCORE_TRACKED_RATIO` instead of the flat constant,
with both `plannedNorm` and `trackedNorm` guarding the target-is-zero case (full credit, not
divide-by-zero) when nothing was expected that week.

**3. Trends — Team Delivery Rate chart** (`renderTimeMomentum`): **no change needed.** It already
sums already-PTO-net planned/tracked totals team-wide, and already returns `null` (renders as a
gap in the line, not a misleading 0%/spike) whenever team planned hours for a week is 0. Listed
here only to record that it was checked, not skipped.

---

## Feature 2 — Goals compliance PTO exemption

`readGoalsEngagement_()` evaluates three rules per employee per week:
1. ≥8 distinct Goal IDs
2. ≥1 goal In Progress/Planned
3. ≥60% of goals have ≥ `max(1, quarterWeek-4)` self-comments as of week end (the pacing clock)

Add a per-week guard using the same weekly PTO figure already computed by
`buildPTOUsageByWeek_`:

```js
const fullWeekPTO = (ptoHrsForWeek || 0) >= CONFIG_PS.PTO_FULL_WEEK_HRS;   // default 40
const rule3Pass = fullWeekPTO ? true : (selfCommentedGoals / totalGoals) >= 0.6;
```

- Only rule 3 is overridden. Rules 1 and 2 are evaluated exactly as before — a full-week-PTO
  rocketeer still needs goals set up and at least one active; they just aren't penalized for not
  commenting during a week they were out.
- **Per-week snapshot only.** This does not shift `quarterWeek-4` for subsequent weeks — if
  they're back the following week, that week's threshold is computed normally, with no
  "catch-up" grace period.
- `byEmployee[norm]` for the exempted week gets `ptoExempt: true` alongside the existing
  compliance fields — recorded now so a future surface could distinguish "genuinely compliant"
  from "PTO-exempted" without re-deriving it, even though no such surface is being added here.

---

## Feature 3 — Executive Brief PTO-impact note

Added to `generateTeamBrief()`, alongside the existing PTO-health block:

```js
const impacted = DATA.employees.filter(e =>
  (e.weeks[weekLabel] && e.weeks[weekLabel].ptoPlannedHrs || 0) >= CONFIG_PS.PTO_IMPACT_THRESHOLD_HRS
);
if (impacted.length > 0) {
  const totalHrs = impacted.reduce((sum, e) => sum + e.weeks[weekLabel].ptoPlannedHrs, 0);
  notes.push(
    impacted.length + ' rocketeer' + (impacted.length > 1 ? 's' : '') +
    ' had a full PTO day this week — ~' + Math.round(totalHrs) +
    'h of planning/tracking capacity excluded from this week’s numbers.'
  );
}
```

- Aggregate count + hours only — no names.
- Goes into the `notes` array (context, not `concerns`/`highlights`) so it reads as an
  explanation, not a red flag.
- Only renders when `impacted.length > 0` for the brief's selected week — silent otherwise,
  consistent with the existing Kudos callout's conditional-render pattern.
- Computed entirely from data already in the payload (`employees[].weeks[label].ptoPlannedHrs`)
  — no new field required for this specific note.

---

## New CONFIG_PS constants

```js
PTO_IMPACT_THRESHOLD_HRS: 8,    // triggers the Executive Brief note (≥1 full PTO day)
PTO_FULL_WEEK_HRS: 40,          // triggers the Goals rule-3 exemption
PTO_MIN_TARGET_HRS: 0,          // floor for ptoAdjustedTargetHrs
```

---

## Files changed

| File | Change |
|---|---|
| `PS Contribution Report.js` | Add 3 CONFIG_PS constants; add `ptoAdjustedTargetHrs` to `buildEmployeeRows_`; update `buildTopPerformers_` plannedNorm calc; add rule-3 PTO guard + `ptoExempt` flag in `readGoalsEngagement_` |
| `PS Dashboard.html` | Update `computeGroupMetrics()` to exclude PTO-impacted employees (≥8h that week) from the Planned/Tracked axis denominators; update `computeRkScore` (plannedNorm + trackedNorm fallback) to use `ptoAdjustedTargetHrs`; add PTO-impact note logic to `generateTeamBrief()`. No change to `renderTimeMomentum` (already PTO-safe). |

---

## Testing

- New/extended unit test (`_test_ptoAdjustments()` or folded into an existing PTO test):
  - `ptoAdjustedTargetHrs` at 0h / 8h / 40h+ PTO — expect 40 / 32 / floor(0).
  - Rule-3 exemption fires at exactly `PTO_FULL_WEEK_HRS` and not at one hour below it.
  - Executive Brief note text at 0 / 1 / multiple impacted rocketeers (singular/plural wording).
- Manual verification against a known PTO-heavy week in the live sheet: confirm Team Radar, Top
  Rocketeers, and the Delivery Rate chart don't show an under-target/red signal for the affected
  population, and the Executive Brief note appears with the correct count and hours.
