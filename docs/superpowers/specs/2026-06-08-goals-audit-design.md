# Goals Audit & Compliance Override — Design Spec
**Date:** 2026-06-08  
**Quarter:** FY26Q4 (Apr 1 – May 30, 2026 / ISO 2026.W14–W22)  
**Files:** `PS Contribution Report.js`, `PS Dashboard.html`

---

## Problem

1. Rocketeers who have completed all goals and fully documented them are still shown as non-compliant in late Q4 weeks because the weekly comment-per-week rule keeps running.
2. Managers and HR have no quick way to identify rocketeers with no self-comment activity since Q4 start — a direct STF payment risk signal.

---

## Compliance Override Rule

### Trigger conditions
A rocketeer is marked **fully compliant for all Q4 weeks** when **either** of these is true:

| Condition | Threshold |
|---|---|
| Primary | `completedGoals >= 8` AND `goalsWithEightPlusComments >= 6` |
| Floor exception | `completedGoals >= 8` AND `goalsWithEightPlusComments >= 5` |

"Goals with 8+ comments" = goals where cumulative Q4 self-comments ≥ 8.

### Behaviour
- The override check runs **before** the existing 3 compliance rules in `evaluateGoalsCompliance_()`.
- If the override fires, `goalsDetail` receives: `overrideCompliant: true`, `fullyDocumentedCount: number`.
- After all per-week data is built, a **backfill pass** sets `compliant: true` on every Q4 week for that person.
- KPI card and summary table both reflect this automatically (they read the same `byEmployee` structure).

### No changes to existing rules
Rules 1, 2, and 3 are untouched for everyone who does not meet the override threshold.

---

## Audit Flag Detection

### New function: `buildGoalsAudit_(goalMap, rosterRows)`
Runs after `readGoalsEngagement_()`. Scans every non-ramp-up rocketeer. Excludes anyone who triggered the compliance override.

### Flag definitions

| Flag | Severity | Condition |
|---|---|---|
| `no-activity` | 🔴 Red | 0 total self-comments across all Q4 goals AND no supervisor comments on any goal |
| `supervisor-only` | 🟡 Amber | ≥ 50% of goals have 0 rocketeer self-comments AND supervisor has commented on ≥ 1 of those goals |

**"Supervisor comment" defined:** any comment row where `normPS_(Commentator) !== normPS_(rocketeerName)`. This reuses the existing self-comment detection logic in reverse — no new data needed.

The two conditions are mutually exclusive by construction: `no-activity` requires zero non-self comments; `supervisor-only` requires at least one. No explicit priority handling is needed.

Goal status (Planned / In Progress / Completed) is **not** a factor — only self-comment presence matters.

### Output: `goalsAudit[]`

```js
{
  name: string,                        // display name
  flag: "no-activity" | "supervisor-only",
  totalGoals: number,
  completedGoals: number,
  totalSelfComments: number,           // Q4 cumulative
  lastSelfCommentDate: string | null,  // ISO date e.g. "2026-04-03", null if none
  goalsWithNoSelfComments: number,
  supervisorCommentedGoalIds: string[] // populated only for supervisor-only flag
}
```

---

## Payload & Scoping

`goalsAudit` is added to the `getPSReportData()` return value alongside the existing `goals` and `goalsQ4Hist` blocks.

- **Admin / Viewer:** full team array.
- **Delegate (manager scope):** filtered to their org tree using the same mechanism as `filterGoalsBySubset_()`.
- **Cache:** existing 5-minute cache covers `goalsAudit` automatically (it's part of the same payload).

---

## Frontend: Roster Badge

### Data setup
At dashboard load, build a lookup: `goalsAuditMap = {}` keyed by `normName` (using `normPS_()` convention) from `DATA.goalsAudit`. The same normalization is used when looking up a rocketeer's row so the join is consistent.

### Badge rendering
In the existing employee table expanded row, inside the goals detail column, render the badge **above** the existing per-rule breakdown:

| State | Badge text |
|---|---|
| Override compliant | `✅ All done — {N} completed, {M} documented` |
| Supervisor-only | `🟡 Supervisor-only comments — {N} goals, 0 self-comments` |
| No activity | `🔴 No activity since Apr 1 — {N} goals, 0 comments` |
| Normal | *(existing compliance indicators, no badge)* |

Badge is read from `goalsAuditMap[normName]` and `goalsDetail.overrideCompliant`. It does not replace existing per-rule indicators — it adds a headline above them.

---

## What is NOT in scope

- Export / download of the audit list.
- Email notifications to managers.
- A dedicated Trends section for audit (deferred — roster badges cover the immediate need).
- Changes to scoring weights or the Top Rocketeers algorithm.

---

## Config constants referenced

| Constant | Value | Role |
|---|---|---|
| `GOALS_MIN_COUNT` | 8 | Min goals for evaluation |
| `GOALS_ACTIVE_COMMENT_COUNT` | 6 | Goals needing comments (rule 3) |
| `Q4_BASE_ISO_WEEK` | 14 | Q4 start week |
| `GOALS_QUARTER` | `"FY26Q4"` | Sheet filter |
| Override primary threshold | 6 goals with ≥ 8 comments | Hardcoded in override check |
| Override floor threshold | 5 goals with ≥ 8 comments | Hardcoded in override check |
| Supervisor-only majority | ≥ 50% goals with 0 self-comments | Hardcoded in `buildGoalsAudit_` |
