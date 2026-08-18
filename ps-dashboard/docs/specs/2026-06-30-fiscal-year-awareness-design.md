# Fiscal Year Awareness — Design Spec
**Date:** 2026-06-30  
**Branch:** feature/portfolio-live-demos  
**Status:** Approved for implementation

---

## Problem

All fiscal-year and quarter boundaries in `PS Contribution Report.js` are hardcoded constants
(`GOALS_QUARTER`, `Q4_BASE_ISO_WEEK`, `Q4_BASE_YEAR`, `SI_QUARTER_COL`, `MONTH_COLS`) that
require manual code edits at every quarter rollover. There is no grace period when a quarter
closes, no goal-writing ramp at quarter start, and PTO carry-over/expiry events are invisible
to users.

---

## Fiscal Year Definition

- FY starts **July 1**, ends **June 30** the following calendar year.
- Example: FY26 = July 1 2025 – June 30 2026.
- Quarter boundaries are calendar-fixed:

| Quarter | Months | FY26 example |
|---------|--------|--------------|
| Q1 | Jul–Sep | Jul 1 – Sep 30 2025 |
| Q2 | Oct–Dec | Oct 1 – Dec 31 2025 |
| Q3 | Jan–Mar | Jan 1 – Mar 31 2026 |
| Q4 | Apr–Jun | Apr 1 – Jun 30 2026 |

---

## Solution: Approach A — Full Auto-Compute

Replace all hardcoded constants with a single `computeFiscalContext_()` helper. Zero manual
CONFIG_PS updates at quarter or year rollover.

---

## Section 1 — `computeFiscalContext_(referenceDate?)` Helper

**Location:** `PS Contribution Report.js`, alongside existing ISO week helpers (~line 677).

**Signature:**
```js
function computeFiscalContext_(referenceDate) {
  // referenceDate: optional Date override for testing; defaults to new Date()
}
```

**Return shape:**
```js
{
  fyLabel:          "FY27",          // current fiscal year label
  qLabel:           "Q1",            // current quarter label
  goalsQuarter:     "FY27Q1",        // replaces CONFIG_PS.GOALS_QUARTER
  siQuarterCol:     "Small Improvements Manager Rating FY26Q4",
                                     // replaces CONFIG_PS.SI_QUARTER_COL
                                     // always points to last completed quarter
  monthCols:        ["Jul 26","Aug 26","Sep 26","Oct 26","Nov 26","Dec 26",
                     "Jan 27","Feb 27","Mar 27","Apr 27","May 27","Jun 27"],
                                     // replaces CONFIG_PS.MONTH_COLS
  qStartIsoWeek:    27,              // replaces CONFIG_PS.Q4_BASE_ISO_WEEK
  qStartIsoYear:    2026,            // replaces CONFIG_PS.Q4_BASE_YEAR
  inGracePeriod:    false,           // true for days 0–13 of new quarter
  inGoalWritingRamp: false,          // true for days 0–27 of new quarter (4 weeks)
  prevGoalsQuarter: "FY26Q4",        // prior quarter label, used during grace period
  prevQStartIsoWeek: 14,             // prior quarter ISO week start
  prevQStartIsoYear: 2026,           // prior quarter ISO year start
}
```

**FY derivation logic:**
```
month >= 7  →  fyStartCalYear = thisYear,   fyNum = thisYear + 1
month < 7   →  fyStartCalYear = thisYear-1, fyNum = thisYear
```

**Quarter derivation:**
```
Jul–Sep → Q1   Oct–Dec → Q2   Jan–Mar → Q3   Apr–Jun → Q4
```

**SI quarter rule:** SI ratings are published after a quarter closes. `siQuarterCol` always
points to the **last completed quarter** — one behind the current goals quarter. During grace
period the goals quarter has already flipped to the new quarter, so SI flips simultaneously.

**Testing:** Pass an explicit date to verify boundary conditions without waiting for a real
quarter rollover:
```js
computeFiscalContext_(new Date("2026-07-07"))  // grace period active
computeFiscalContext_(new Date("2026-07-28"))  // still in goal-writing ramp, grace over
computeFiscalContext_(new Date("2026-08-01"))  // fully in FY27Q1, no ramp
```

---

## Section 2 — Goals: Grace Period Dual-Load + Q1 Writing Ramp

### Grace Period (days 0–13 of new quarter)

`readGoalsEngagement_()` receives the fiscal context and, when `ctx.inGracePeriod` is true,
executes the sheet read **twice**:
1. Filter on `ctx.prevGoalsQuarter` — prior quarter records, flagged `{ gracePeriod: true }`
2. Filter on `ctx.goalsQuarter` — new quarter records, no flag

Results are merged per employee. If an employee has no new-quarter goals yet, only their
prior-quarter record appears (with the grace flag). The frontend renders prior-quarter goals
with a distinct label (e.g., "Q4 — Closed").

### Q1 Writing Ramp (days 0–27 of new quarter)

Employees have 4 weeks from the start of any quarter to write their goals. During this
window, the minimum goal count for compliance is relaxed to 0.

Implementation in `readGoalsEngagement_()`:
```js
const weekOfQtr = Math.max(1, isoW - ctx.qStartIsoWeek + 1);
const goalsRequired = weekOfQtr <= 4 ? 0 : CONFIG_PS.GOALS_MIN_COUNT;
```

The existing **comment ramping** (`reqCmt = Math.max(1, qWeek - 4)`) is unchanged — it
already handles comment-count ramp-up independently.

### `buildQ4Weeks_PS_()` → `buildCurrentQWeeks_PS_()`

Rename and generalize the function to use `ctx.qStartIsoWeek` / `ctx.qStartIsoYear` instead
of hardcoded constants. During grace period, it returns two arrays: one for the prior quarter
weeks and one for the current quarter weeks.

The old name `buildQ4Weeks_PS_()` is kept as a one-line alias for one release cycle:
```js
function buildQ4Weeks_PS_() { return buildCurrentQWeeks_PS_(); }
```

### Continuous metrics — no change

Tracked time, planned time, RCR, SI, kudos, and PTO week windows remain continuous
week-over-week. The fiscal year boundary is invisible to these readers.

---

## Section 3 — PTO: Year End Expiry / Carryover Display Labels

### Background

The Accumulation Cost sheet contains rows with `Adjustment Type` values of `"Year End Expiry"`
and `"Carryover"`. These occur in December/January and explain why a user's PTO balance
changes sharply at year-end. The current code treats them identically to all other accrual
transactions — the balance math is correct. Users have no visibility into why the balance shifted.

### Change: Labeled PTO Events

`readPTOPlanningHealthByWeek_()` adds detection for the two special types:

```js
const isYearExpiry = adjType === "Year End Expiry";
const isCarryover  = adjType === "Carryover";
```

These transactions continue to be included in the accrual sum unchanged. Additionally, each
one is appended to a `ptoEvents` array on the employee record:

```js
ptoEvents: [
  { week: "2026.W01", type: "carryover",   hours: 40  },
  { week: "2026.W01", type: "year-expiry", hours: -24 },
]
```

**Frontend:** In the PTO panel, weeks containing these events display a small inline badge:
- `+40h carried over`
- `−24h expired`

No scoring change. No compliance impact. If the sheet has no such rows, `ptoEvents` is empty
and the UI renders identically to today.

---

## Section 4 — Migration & No-Breaking-Change Guarantees

### CONFIG_PS changes

**Removed constants** (derived automatically):

| Removed | Replaced by |
|---------|-------------|
| `GOALS_QUARTER` | `ctx.goalsQuarter` |
| `Q4_BASE_ISO_WEEK` | `ctx.qStartIsoWeek` |
| `Q4_BASE_YEAR` | `ctx.qStartIsoYear` |
| `SI_QUARTER_COL` | `ctx.siQuarterCol` |
| `MONTH_COLS` | `ctx.monthCols` |

**Added escape hatch:**
```js
SI_COL_OVERRIDE: null
// Set to an explicit string (e.g. "Small Improvements Manager Rating FY27Q1")
// only if the auto-generated SI column name doesn't match the sheet's actual header.
// Null = always use auto-compute.
```

### Payload shape

The report payload gains two new top-level fields — `fiscalContext` and `ptoEvents` per
employee — and removes nothing. The frontend receives a strict superset of the prior payload.

### Cache

The report cache key (`ps_v<VER>_...`) is unchanged. Cache versioning behavior is identical.

### Continuity guarantees

- Tracked time and planned time: week-over-week, no FY boundary — no change.
- RCR `MONTH_COLS`: shifts automatically at FY rollover — no manual update.
- `buildQ4Weeks_PS_()` alias preserved for one release cycle.
- HTML Data Reference tab still contains hard-coded quarter week labels — these are already
  marked `<!-- UPDATE EACH QUARTER: … -->` and are a display-layer concern outside this spec.

---

## Files Changed

| File | Change |
|------|--------|
| `PS Contribution Report.js` | Add `computeFiscalContext_()`, update `readGoalsEngagement_()`, rename `buildCurrentQWeeks_PS_()`, update `readPTOPlanningHealthByWeek_()`, remove 5 CONFIG_PS constants, add `SI_COL_OVERRIDE` |
| `PS Dashboard.html` | Add grace-period label to goals panel; add PTO event badges |

---

## Out of Scope

- HTML Data Reference tab hard-coded quarter labels (separate manual update, existing process)
- SI ratings availability timing (the SI column flip happens at quarter boundary regardless of
  whether the SI manager has submitted ratings — that is a data concern, not a code concern)
- Automatic detection of FY rollover in `MONTH_COLS` for the RCR sheet header row (the column
  names in the RCR Google Sheet itself are not changed by this spec)
