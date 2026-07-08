# GDash — Data Integrity & Information Architecture Fixes (Spec 1 of 3)

**Date:** 2026-07-08 (2026.W28)
**Files:** `goalCompliance.js` (backend), `GDash.html` (frontend)
**Status:** Approved design — awaiting implementation plan

## Context

A full review of the Goals Compliance Dashboard produced five improvement
workstreams. They are decomposed into three sequenced specs:

1. **This spec — data integrity + IA/labeling fixes.** Must land before any
   redesign so the numbers being restyled are trustworthy.
2. **Spec 2 (future)** — visual redesign: brand tokens per Identity Lockdown
   (Void Blue / Orbe / Ivory / Light Cream, 60/30/10 ratio, status-color
   governance), Roboto/Roboto Condensed type scale, responsive layout
   (ultra-wide max-width cap, fluid KPI grid, mobile filter drawer, table→card
   collapse), icon-set and export-button consistency, dark mode.
3. **Spec 3 (future)** — new insight metrics: Goal Completion Rate as a
   headline peer of Compliance Rate, pace-based At-Risk forecasting,
   recency-weighted engagement (weeks since last comment), manager
   span-of-control vs engagement, RPI/STF predictive-validity check,
   HR-review SLA timing, QoQ overlays on Overview.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| At Risk/Watch mismatch across tabs | Relabel only — keep both pools, make scope explicit in card sub-labels |
| Contractors ("Location: Unknown") | Merge the Roster spreadsheet's `Contractors Data` tab into `getFullRosterMap_()` (Approach 1) |
| Crewmember treatment | Enrich + Crew badge + Employment filter; metrics unchanged |
| Glossary placement | ☰ menu → 📖 Data Reference closable temp-tab page (PS Dashboard pattern) |

## Root causes established (verified in code)

- **Stale grace banner:** `isCompletionGrace = today >= gracePeriodCompletionStart`
  (goalCompliance.js step 8) has no upper bound — once a quarter enters its
  final 2 weeks the flag is true forever for that quarter. Viewing FY26Q4
  after quarter close still shows "Active — ends 2026-06-30".
- **Cmts/Wks "/24":** `totalQtrWeeks` counts distinct ISO weeks present in the
  quarter's *comment data*, and goal comments keep accruing after quarter
  close (goals bucket by Start Date), inflating the denominator past the real
  13–14 calendar weeks. Also silently inflates `weeksElapsedSinceStart` for
  closed quarters, over-tightening the RPI criterion-2 cadence requirement.
- **Engagement rate 97.2% vs 97.3%:** denominator is rocketeers **with goals**
  (`withGoals`, ~215), not total headcount (220). Calculation is intentional;
  the card label is not honest about its base.
- **Location: Unknown:** backend reads only the Roster spreadsheet's `Data`
  tab (`CONFIG_GD.SHEET_ROSTER`). Contractors/crewmembers live in a second tab
  `Contractors Data` (fields: Name, Department, Termination/Release Date,
  Class, Supervisor, Key Location) and never enter `fullRosterMap`, so they
  fall through to `'Unknown'`.

---

## Section 1 — Backend fixes (goalCompliance.js)

### 1a. Grace flags bounded + quarter state

```
isGoalCreationGrace = quarterDates && today >= quarterDates.start
                                   && today <= quarterDates.gracePeriodGoalsEnd
isCompletionGrace   = quarterDates && today >= quarterDates.gracePeriodCompletionStart
                                   && today <= quarterDates.end
quarterState        = !quarterDates ? null
                    : today <  quarterDates.start ? 'upcoming'
                    : today >  quarterDates.end   ? 'closed'
                    : 'active'
```

`quarterState` ships in the payload so the client distinguishes "grace active"
from "viewing a closed quarter" instead of inferring.

### 1b. Calendar-derived `totalQtrWeeks` + clamped comment weeks

- `totalQtrWeeks` = number of ISO weeks spanned by `[quarterDates.start,
  quarterDates.end]` (13–14). Fallback: when the quarter label doesn't parse
  (`parseQuarterDates_` returns null), keep the current data-driven distinct-
  week count.
- `emp._selfCmtWeeks` (→ `emp.commentWeeks`) counts only comment dates inside
  the quarter window, so the Cmts/Wks numerator matches the new denominator.
- Ripple (accepted as a correction): `weeksElapsedSinceStart` is capped by
  `totalQtrWeeks` and drives the engagement pace threshold and RPI criterion 2.
  Closed quarters previously capped at ~24 weeks; RPI scores for past quarters
  will shift toward what the policy intended. See 4b for the audit.

### 1c. Contractors Data merge in `getFullRosterMap_()`

- New `CONFIG_GD.SHEET_CONTRACTORS = 'Contractors Data'` (same spreadsheet as
  `SHEET_ROSTER`).
- Rows normalize to the existing roster record shape:
  `Key Location` → `location`, `Supervisor` → `supervisor`,
  `Class` → `classVal`, `Department` → department field, plus `isCrew: true`
  (records from the `Data` tab get `isCrew: false`).
- Active flag: `Termination/Release Date` non-empty **and** ≤ today →
  `active: false`; otherwise active.
- Collision rule: a normalized name present in both tabs keeps the `Data`
  record.
- Fields the Contractors tab lacks: `jobTitle` stays empty (crew are never
  intern-stripped by roster title) and there is no hire date, so
  `isNewHire_` stays false for crew. `deriveJobFamily_` gains an `isCrew`
  short-circuit → job family `"Crew"`, so the Job Family filter buckets
  crew meaningfully instead of `"Unknown"`.
- Bump `CACHE_VER` so the cached roster map and drill index rebuild.
- Downstream consumers (`locMap`, `terminatedSet`, `supTitleMap`, manager
  org-tree scoping, zero-goal roster injection) require no changes — that is
  the point of merging at the single integration point.

### 1d. Denominator exposure (no math changes)

Payload adds `withGoalsCount` (and keeps `totalRocketeers`) so the frontend
can label the engagement card's base. The engagement calculation itself is
untouched.

---

## Section 2 — Frontend labeling & scope fixes (GDash.html)

### 2a. At Risk / Watch scope labels

- Overview cards: sub-label "… — all rocketeers, incl. new hires".
- Needing Support cards: sub-label "… — excl. N new hires" with N computed
  from the tab's existing pool split. Both tabs explain their own scope; no
  metric changes.

### 2b. Engagement denominator on the card

Org Engagement Rate sub-label: "X of Y rocketeers with goals — excludes Z
with no goals set", filled from `withGoalsCount` / `totalRocketeers`. Never
hardcoded.

### 2c. Goal Status Distribution footnote

Muted one-liner under the table: "A rocketeer appears once per status they
hold — the People column exceeds total headcount by design."

### 2d. Cmts/Wks

No client change beyond 1b (column already renders
`commentWeeks + '/' + qtrWeeks`). The Data Reference page documents the
counting rule.

### 2e. Crew badge + Employment filter

- `isCrew` employees get a small "Crew" badge next to their name in Needing
  Support, Team & Individuals, and REX Tracker tables; `classVal` shows in
  the badge tooltip.
- Filter bar gains "Employment: All / FTE / Crew", wired through the existing
  `buildFilterDropdowns()` / `getFiltered()` path so all tabs, KPIs, and
  charts respect it.

### 2f. Grace banner display states

Driven by `quarterState` + grace flags:

| State | Banner |
|---|---|
| Active quarter, goal-creation grace | Current orange bar (unchanged) |
| Active quarter, completion grace | Current red bar (unchanged) |
| Active quarter, no grace | No bar |
| Closed quarter | Slim neutral bar: "FY26Q4 — quarter closed Jun 30, 2026" (no urgency styling) |
| Upcoming quarter | Slim neutral bar: "FY27Q2 — starts Oct 1, 2026" |

---

## Section 3 — Information architecture

### 3a. 📖 Data Reference page (☰ menu, all roles)

- New `VIEWS` entry: `{ id: 'dataref', label: '📖 Data Reference',
  location: 'menu', roles: null }` — reuses the existing closable temp-tab
  mechanics (same as Access Control).
- Content sections:
  - **Metric definitions** — RPI (3 criteria × 2 pts), STF eligibility
    (6+ completed goals with 8+ comments), REX (tracker case + statuses),
    compliance tiers (On Target ≥10 / Watch 8–9 / At Risk <8).
  - **Denominators & scopes** — the three population bases (total
    rocketeers / with-goals / excl. new hires) and which cards use which;
    why Goal Status "People" exceeds headcount.
  - **Calendar rules** — fiscal quarters, grace windows (first 4 weeks
    goal-creation; final 2 weeks completion), Cmts/Wks counting rule.
  - **Data sources** — RD sheet, Roster `Data` tab, `Contractors Data` tab,
    name-normalization join.
- Quarter-dependent values fill from the payload at render (PS Dashboard
  `updateQuarterLabels_()` principle) — nothing hardcoded per quarter.

### 3b. Team & Individuals opens readable

First render shows the Org Breakdown top tier expanded with summary rows;
only person-level drill-downs start collapsed. Expand/collapse behavior
afterward is unchanged.

### 3c. REX Tracker parity

Crew badges, Employment filter, scope-labeled KPI sub-labels ("this
quarter's notes"), and glossary coverage apply to the tracker tab. Mostly
verification since it renders through the shared helpers.

---

## Section 4 — Testing & rollout

### 4a. Unit tests (GAS-editor runnable, `_test_*` pattern)

- **Grace bounds / quarter state:** after-end date → `isCompletionGrace`
  false + `'closed'`; inside final 2 weeks → true + `'active'`; pre-start →
  both flags false + `'upcoming'`.
- **Calendar weeks:** every FY quarter parses to 13–14 weeks; out-of-window
  comment dates don't count toward `commentWeeks`; unparseable quarter label
  falls back to the data-driven count.
- **Contractor merge:** Contractors Data row lands in the map with
  `isCrew: true` + Key Location; both-tabs name keeps the `Data` record;
  past Termination/Release Date → `active: false`.

### 4b. RPI shift audit

Temporary before/after logging of RPI scores for the current quarter to
confirm every shift traces to the week-cap correction. Removed after
verification.

### 4c. Rollout order

1. Backend fixes + `CACHE_VER` bump; verify live (banner correct, /13–14
   denominators, contractors located).
2. Frontend labeling + IA changes.

Repo stays local — no push unless explicitly requested (standing rule).

### 4d. Live QA checklist

- [ ] FY26Q4 (closed) shows the neutral closed-quarter bar, no "Active" grace.
- [ ] FY27Q1 (current, started Jul 1) shows goal-creation grace ending ~Jul 29.
- [ ] Cmts/Wks renders n/13 or n/14 on all tabs, numerator ≤ denominator.
- [ ] Overview shows "incl. new hires" scope; Needing Support shows
      "excl. N new hires"; counts explained by the labels.
- [ ] Engagement card names its with-goals base.
- [ ] Sofia Mardones Bustamante (and other crew) show a real location +
      Crew badge; "Location: Unknown" gone for everyone in Contractors Data.
- [ ] Employment filter recomputes every KPI/chart/table on every tab.
- [ ] 📖 Data Reference opens/closes as a temp tab for viewer and admin roles.
- [ ] Team & Individuals first load shows the expanded top tier.
- [ ] RPI shift audit reviewed; shifts trace to the week-cap fix.

## Out of scope (this spec)

- All Spec 2 visual/responsive work (brand tokens, dark mode, mobile).
- All Spec 3 new metrics.
- Any change to compliance/engagement math beyond the week-window correction.
- HRIS source-data corrections outside the Contractors Data merge.
