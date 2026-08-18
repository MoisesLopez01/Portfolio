# Finance STF-Gaps View (GDash)

**Date:** 2026-07-13 (2026.W29)
**Files:** `GDash.html` (new tab only)
**Visibility:** admin only (`VIEWS` roles `['admin']`)
**Status:** Shipped, then superseded 2026-07-16 (2026.W29): the manager chart,
threshold slider, and the two manager-grouped sections were replaced by a single
flat table (Emp # / Rocketeer / Job Title / Manager / compliance stats / STF tag),
sorted worst compliance record first, with a "Needs follow-up ↔ All rocketeers"
toggle. `buildFinanceGaps_` → `buildFinanceRows_` (still in the FINANCE-PURE
block, still node-tested); `employeeNumber` now ships on the employee payload
(`goalCompliance.js`, cache `gd_v25_`). The reason classification
(`classifyStfReason_`) and CSV export survive unchanged in spirit.

## Purpose

Give Finance a single admin-only view that lists every Rocketeer who is **not
eligible for STF** (Set-the-Future pay) and, for each, explains **why** — so
Finance can call out exactly who to follow up on and route each case to the
right manager. STF eligibility (unchanged, from `goalCompliance.js`) is:

```
stfEligible = stfGoalsCompleted >= 8         (STF_MIN_COMPLETED)
           && stfGoalsWithSufficientComments >= 6   (STF_MIN_CMT_GOALS, i.e. completed goals carrying 8+ comments)
```

The faster Finance spots the missing-qualifying records grouped by manager, the
faster they follow up and report team performance.

## Scope & constraints

- **Frontend-only.** Every field this view needs already ships to the GDash
  client on each employee object: `stfEligible`, `stfGoalsCompleted`,
  `stfGoalsWithSufficientComments`, `goalsInProgress`, `goalsPlanned`,
  `goalsCanceled`, `goalsNotCompleted`, `goalsCompleted`, `supervisor`,
  `isNewHire`, `onLeave`, `normName`, `goalsList`.
- **No `goalCompliance.js` change. No cache bump** (`PS_CACHE_VER` / `gd_v`
  untouched — the backend payload is unchanged). Deploy = `GDash.html` only.
- New tab `finance`, label **💰 STF Gaps (Finance)**, added to `VIEWS` with
  `roles: ['admin']`. Gating is enforced by the existing `applyRoleToNav_` +
  `switchTab` forbidden-id → Overview mechanism (same as Policy Lab), not by
  hiding a button alone.

## Population

Starts from `getFiltered()` (respects the filter bar exactly like every other
tab), then keeps only rows where **all** of the following hold:

- `stfEligible === false`
- not a new hire (`!isNewHire`) and not on leave (`!onLeave`) — both are already
  excluded from STF math upstream, so they are never STF-ineligible in a
  meaningful sense and would only add noise. Attrition/interns are already out
  of the `employees` array.

## Reason taxonomy (the "signal")

Per-person derived values:

- `completed`     = `stfGoalsCompleted`
- `wellCommented` = `stfGoalsWithSufficientComments`
- `pending`       = `goalsInProgress + goalsPlanned`
- `lost`          = `goalsCanceled + goalsNotCompleted`
- `gap`           = `8 - completed` (goals still needed to reach the bar)

Each ineligible person is assigned exactly one **primary reason** (drives the
chart segment and sort) by the precedence below, and also carries **every
applicable badge** for the row detail.

The precedence is **first match wins**, and the four rules are exhaustive over
the ineligible population (rule 4 is the catch-all for every remaining
`completed < 8` case):

| Primary reason | Condition (first match wins) | Finance read |
|---|---|---|
| 🗨 **Comments shortfall** | `completed >= 8` (so only the comment bar fails) | Completed enough; just under-commented |
| ⏳ **Pending closure** | `completed < 8` and `pending >= gap` | Recoverable this quarter; closing open goals reaches 8 — nudge to close |
| ✖ **Canceled / Not-completed** | `completed < 8`, `pending < gap`, and `lost > 0` | Goals fell through; re-plan / explain |
| ▽ **Too few goals** | `completed < 8`, `pending < gap`, `lost = 0` (catch-all) | Not enough goals in the pipeline to ever reach 8 |

**Badges** (row detail) are separate from the primary reason and are purely
factual counts — no interpretive promise — so a badge can never overstate a
person's recoverability. Each is shown only when its count is non-zero:

- `⏳ P pending` — when `pending > 0`
- `✖ L canceled/not-completed` — when `lost > 0`
- `🗨 needs comments (wellCommented/6)` — when `completed >= 8` and `wellCommented < 6`
- `▽ only totalGoals logged` — shown when the primary reason is Too few goals

So an under-bar person with both open and canceled goals shows both `⏳` and `✖`
badges regardless of which primary bucket precedence assigned them; the
"can still reach 8" interpretation lives only on the primary-reason label and the
chart segment tooltip, never on a badge.

**Comments shortfall** is deliberately the top-precedence bucket because those
people have `completed >= 8` and therefore never appear under the
completion-threshold filter — they must not be lost.

## Layout (top → bottom)

```
💰 STF Gaps (Finance)                                    [Export CSV]
Company-wide · STF-ineligible Rocketeers · new hires/on-leave excluded · respects the filter bar

Max completed goals to show:  ●────────  7    (slider, range 0–7, default 7, live value label)

Summary strip:  ⏳ Pending N · ✖ Canceled N · 🗨 Comments N · ▽ Too few N     (X ineligible of Y evaluated)

┌ Ineligible Rocketeers by manager (stacked bar; managers sorted worst-first) ┐
│ Jane Cruz   [⏳⏳⏳][✖✖][🗨]                6                                  │
│ Ben Tan     [⏳⏳][🗨]                     3                                  │
│ …           hover a segment → reason + count; click a bar → scroll to group │
└─────────────────────────────────────────────────────────────────────────────┘

── Under the completion bar  (completed ≤ threshold) ──  grouped by manager
  ▸ Jane Cruz (4)
     Rocketeer   Completed  Pending  Canceled/NC  Reason signal(s)
     A. Lopez      3 / 8       2          1        ⏳ 2 pending   ✖ 1 canceled
     …
  ▸ Ben Tan (3) …

── Comments shortfall  (8+ completed, <6 well-commented) ──  grouped by manager
  ▸ Jane Cruz (2)
     Rocketeer   Completed  Well-commented   Reason signal
     R. Diaz       9 / 8        4 / 6         🗨 needs comments
```

### Threshold control
- A range **slider** `0–7`, default **7**, with a live value label.
- Filters **only** the "Under the completion bar" section and the
  pending / canceled / too-few segments of the chart (all of which are
  `completed < 8`).
- The **Comments shortfall** section and its chart segment are **independent** of
  the threshold — those people have `completed >= 8`.
- Rationale for 0–7: 8 is the STF completion bar, so 0–7 is the full range of
  "below the bar." Default 7 shows everyone below the bar; lowering it narrows
  to the furthest-behind (e.g. 3 → only those with ≤3 completed).

### Sorting
- **Managers:** by ineligible count **descending** (worst teams first).
- **Within a manager:** by `completed` ascending (furthest from the bar first).

### Drill-down & export
- Each Rocketeer row reuses the existing individual drill-down
  (`toggleIndividualDrill_` via a `data-normname` attribute, delegated click
  handler) — no new drill code; Finance clicks a name to see the goal thread.
- **Export CSV** mirrors the REX Tracker export pattern (~line 4389). Columns:
  `Manager, Rocketeer, Department, Completed, Pending, Canceled/NotCompleted,
  Well-commented, Primary reason, All reasons`. Respects the current filter and
  threshold.

## Code shape (all in `GDash.html`)

- `VIEWS` entry `{ id:'finance', label:'💰 STF Gaps (Finance)', location:'tabbar', roles:['admin'] }`.
- A `<div id="pane-finance">` pane with the slider, summary strip, chart
  container, and two section containers.
- Tab-button markup `data-tab="finance"` + a `renderTab` dispatch case → `renderFinance()`.
- `classifyStfReason_(emp)` — pure helper returning
  `{ primary, badges:[...], completed, pending, lost, wellCommented, gap, totalGoals }`.
  Unit-testable, no DOM.
- `buildFinanceGaps_(emps, threshold)` — filters/classifies, returns
  `{ underBar: groupsByMgr, commentsShortfall: groupsByMgr, totals }`.
  Groups sorted worst-first as above.
- `renderFinance()` — reads the slider, calls `buildFinanceGaps_`, renders the
  summary strip, `renderFinanceChart_()` (stacked bars in the existing
  inline-div/SVG chart idiom used elsewhere in the file), and the two grouped
  tables (reusing `renderRosterGroups_` where its column-config shape fits;
  otherwise a small local table builder consistent with existing ones).
- `setFinanceThreshold_(v)` — slider handler → updates label, re-renders.
- `exportFinanceCsv_()`.

## Testing

- `classifyStfReason_` fixtures cover each precedence branch:
  comment-only (`completed 9, wellCommented 4` → Comments shortfall),
  recoverable-pending (`completed 5, pending 4` → Pending closure),
  canceled-blocked (`completed 5, pending 1, lost 3` → Canceled/Not-completed,
  since `pending 1 < gap 3`), too-few both as no-pipeline (`completed 3,
  pending 0, lost 0`) and as the fixed orphan case (`completed 5, pending 1,
  lost 0` → Too few, because pending can't close the gap and nothing was lost),
  and a genuinely eligible person (excluded).
- Threshold boundary: a `completed = 7` person shows at default (7), hidden at 6.
- New-hire and on-leave ineligible people are excluded from both sections and
  from totals.
- Manager sort order (worst-first) and within-group order (furthest-behind first).
- Empty state when the filter yields no ineligible Rocketeers.
- Chart segment counts equal the summary strip counts equal the table row counts
  (single source of truth: `buildFinanceGaps_`).

## Out of scope

- No new `finance` role or GD Security change (admins operate/export on Finance's
  behalf).
- No backend payload change; no historical/all-quarters view (this quarter,
  respecting the filter bar).
- No write-back (no marking follow-ups done here — REX Tracker owns follow-up state).
