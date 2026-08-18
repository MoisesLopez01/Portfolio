# Goals Compliance Dashboard — Comment Drill-Down Redesign, Trends Tab & QoQ Engagement

**Date:** 2026-07-04 (2026.W27)
**Files:** `goalCompliance.js` (backend), `GDash.html` (frontend)
**Status:** Approved design — ready for implementation planning

## Purpose

Three connected improvements to the Goals Compliance Dashboard so HR and managers can
detect comment patterns on goals and offer support on time to people in risk status:

1. **Comment drill-down redesign** — the per-goal comment thread becomes a
   conversation timeline built for pattern-spotting (silence gaps, one-sided
   threads, cadence).
2. **Filter-aware weekly trend** — the Comments Volume Trend chart moves to a new
   **Trends** tab and recomputes from the globally filtered rocketeer set instead
   of showing global-only data.
3. **Quarter-over-quarter engagement** — twin panels compare this quarter's
   rocketeer and manager engagement week-over-week against the previous quarter's
   "shadow", with behavior-derived thresholds and delta strips, plus a code-level
   manager exception list.

## Decisions already made (with the user)

| Topic | Decision |
|---|---|
| Comment view layout | Conversation timeline (chat-style, IC left / Manager right) with week separators and gap callouts — plus per-side counts in the goal header |
| Weekly trend treatment | Combo: stacked self/mgr bars + labeled "rocketeers engaging" line, with a Count / % toggle for the line |
| QoQ treatment | Twin panels (Rocketeer % / Manager %), previous quarter as gray shadow area, red threshold band, delta strip under each panel |
| Manager exception list | Code constant in `CONFIG_GD` (git-versioned; user maintains the file) |
| Low-engagement threshold | Previous quarter's median weekly engagement %, recomputed under active filters |
| Placement | New **Trends** tab (weekly trend moves there from Overview; QoQ panels live there) |
| Excepted managers in Scorecard | Shown with an "Excepted" tag, excluded from engagement math |
| Data architecture | Per-employee sparse weekly series in the payload; all charts recompute client-side from the filtered set (no server round-trip per filter change) |

---

## 1 · Backend changes (`goalCompliance.js`)

### 1.1 CONFIG

```js
MANAGER_ENGAGEMENT_EXCEPTIONS: [],  // full names, e.g. ['Jane Doe'] — matched via normName_
CACHE_VER: 'gd_v14_',               // payload shape changed (weekly series + prevQuarter block)
```

Exceptions are normalized once per build (`normName_`) and shipped to the client as
`managerExceptions: ['jane doe', …]` in the payload.

### 1.2 Per-employee weekly series

`aggregateByRocketeer_` additionally accumulates, per employee, from rows it already
iterates:

- `weeklySelf` — `{ '2026.W14': 3, … }` count of self-comments per ISO week
  (sparse: only weeks with activity).
- `weeklyMgr` — same shape, manager comments received per ISO week.

Both survive into the finalized employee record (they are the raw material for every
client-side chart). Existing derived fields (`commentWeeks`, `commentWeekList`,
totals) are unchanged.

### 1.3 Full quarter week list — `trendWeeks`

`buildComplianceData_` computes `trendWeeks`: every ISO week label from the quarter's
start date through `min(today, quarter end)`, using `parseQuarterDates_` +
`dateToISOWeek_`. This replaces deriving the week axis from weeks-that-have-comments
(`commentTrend.weeks`), which silently dropped fully silent weeks — on the new charts
a silent week renders as zero, which is exactly the signal HR needs.

The existing `commentTrend` block and `totalQtrWeeks` computation stay as-is (RPI
eligibility depends on `totalQtrWeeks`; do not change its semantics).

### 1.4 Previous-quarter block — `prevQuarter`

Derived from the same `allRd` array already in memory (no additional sheet read):

```js
prevQuarter: {
  quarter: 'FY26Q3',          // the quarter immediately before the selected one,
                              // from the same Start-Date-derived quarter labels
  weeks: ['2026.W01', …],     // full ISO-week list of that quarter (start → end)
  employees: [{               // lite records — enough to re-apply every filter chip
    normName, name, department, supervisor, location, jobFamily,
    totalGoals, weeklySelf, weeklyMgr,
  }, …],
}
```

Construction: filter `allRd` to the previous quarter via the existing
`deriveRowQuarter_`, run the same `aggregateByRocketeer_` + `stripInterns_` over it,
narrow with the same manager `scopeSet`, then map to lite records. `location` and
`jobFamily` resolve through the same roster/`deriveJobFamily_` enrichment used for
the main list. Terminated employees are **kept** in `prevQuarter.employees` (they
were active then; dropping them would understate the shadow).

If the selected quarter is the earliest available, `prevQuarter` is `null`.

The previous quarter is computed by decrementing the parsed quarter label
(`FY26Q3` → `FY26Q2`, `FY26Q1` → `FY25Q4`), not by scanning the quarters list —
a data gap quarter must not silently make the shadow jump two quarters back.
If the decremented quarter has zero RD rows, `prevQuarter` is `null`.

### 1.5 Manager exceptions in engagement data

`computeEngagementData_`:

- Each `managerScorecard` entry gains `isExcepted: true|false` (normName match
  against the exception list).
- Excepted managers stay in the scorecard array (UI tags them) but are excluded
  from any org-level manager-engagement aggregates added by this design. Existing
  aggregates (`avgMgrCmts` etc.) are left untouched — they measure comments
  *received by rocketeers*, which is real regardless of who wrote them.

### 1.6 Payload size

~200 employees × ~13 weeks × 2 quarters of small sparse maps ≈ 100–200 KB extra raw
JSON. `cachePutChunked_` already splits at 90 KB per key; no cache changes needed
beyond the version bump.

---

## 2 · Comment drill-down redesign (`GDash.html`)

`renderIndividualDrillContent_` keeps its data source (`getRocketeerGoalDetail`,
unchanged server-side) and its expandable-row container. What changes is the
rendering of each goal card and its thread.

### 2.1 Goal card header

- Goal name + status badge (unchanged).
- **Prominent per-side counts**: `🧑 Self N · 👤 Mgr N` (existing counts, promoted
  from small side-labels to the header's primary metadata), plus start date, mood,
  and quarter (All-Time mode) as today.

### 2.2 Weekly cadence strip (single-quarter mode only)

Above the thread inside an expanded goal: one small square per elapsed quarter week
(`S.data.trendWeeks`), colored:

- **blue** — rocketeer self-commented that week (number = self-comment count)
- **amber** — only the manager commented that week
- **red/muted** — no comments that week

Hidden when the drill was opened in All-Time mode (`quarter === 'ALL'`) — weeks from
different quarters cannot share one strip.

### 2.3 Conversation timeline

Replaces the flat comment list:

- Chronological, ascending by date (data is already date-sorted server-side).
- **IC comments left-aligned** (blue bubble), **manager comments right-aligned**
  (amber bubble), **other commentators** center/neutral (gray bubble) — each with
  commentator name + date + week label.
- **Week separators**: a thin labeled rule (`2026.W14`) whenever the ISO week
  changes between consecutive comments.
- **Gap callouts**: between consecutive comments, if ≥2 full ISO weeks passed with
  no comment from anyone, insert an amber callout row:
  `⚠ N-week silence (W16–W17) — no comments from anyone`. Computed client-side
  from the comment dates; applies in both single-quarter and All-Time modes
  (in All-Time, gaps that span a quarter boundary are suppressed — a new quarter
  legitimately restarts the conversation).
- Empty thread keeps the current "No comments recorded on this goal." state.

XSS posture unchanged: all text through `esc()`.

---

## 3 · New Trends tab

### 3.1 Navigation

`VIEWS` gains `{ id: 'trends', label: 'Trends', location: 'tabbar', roles: null }`
between Overview and Team & Individuals. `renderTab` dispatches to a new
`renderTrends(emps)`. Managers see it automatically scoped to their org tree (their
payload only contains in-scope people).

The **Comments Volume Trend section moves out of Overview** into this tab. The
per-chart department chips (`buildTrendDeptChips_`) are **removed** — the global
filter bar covers department and now genuinely drives the chart. `renderOverview`
drops its trend rendering; Overview keeps KPI cards, goal status, HR summary, Team
Engagement, Manager Scorecard, Needs Support, and Attrition.

Both Trends charts re-render on any filter change (same `renderTab(S.activeTab)`
path the tables already use) and on quarter change.

### 3.2 Weekly combo chart (filter-aware)

Built client-side from `getFiltered()`:

- **X axis**: `S.data.trendWeeks` (short `W14` labels, full label in tooltip).
- **Stacked bars**: Σ `weeklySelf[w]` (blue) and Σ `weeklyMgr[w]` (amber) across
  the filtered employees.
- **Line (2nd axis)**: unique rocketeers engaging = count of filtered employees
  with `weeklySelf[w] > 0`, green dashed, **datalabel on every point** (the
  headline requirement: rocketeer counts visible as labels).
- **Count / % toggle**: two-button toggle (same pattern as the roster's
  This Quarter / All Time buttons). % mode switches the line to
  `engaging / eligible × 100`, where eligible = filtered employees with
  `totalGoals > 0`; axis becomes 0–100%.
- **Subtitle** states the denominator: "of N filtered rocketeers with goals" —
  keeps small-group percentages honest.
- Empty filter result → chart area shows the standard empty-state.

### 3.3 QoQ engagement twin panels

Two Chart.js panels side by side (stacked on narrow screens), each with a delta
strip underneath. All series computed client-side.

**Alignment**: by week-of-quarter index. Current series indexes into
`S.data.trendWeeks`; shadow series indexes into `prevQuarter.weeks`. X labels are
`Wk 1 … Wk 13` (tooltip shows both real ISO weeks, e.g. "Wk 5 — 2026.W18 vs
2026.W05").

**Panel 1 — Rocketeer engagement %** (per week `w`):
`engaged(w) / eligible × 100` — engaged = filtered employees with
`weeklySelf[w] > 0`; eligible = filtered employees with `totalGoals > 0`.

**Panel 2 — Manager engagement %** (per week `w`):
managers = distinct supervisors of filtered employees with `totalGoals > 0`,
**minus** exception-listed names. A manager is engaged in week `w` if any of their
filtered reports has `weeklyMgr[w] > 0`. Value = engaged managers / total managers × 100.

**Previous-quarter shadow**: same two computations over `prevQuarter.employees`,
with the **same filter predicate re-applied** (department/location/jobFamily/
supervisor chips; the status chip is skipped for the shadow — compliance status is
quarter-specific). Rendered as a soft gray filled area under the current bold line.

**Threshold band**: red translucent band from 0 to the previous quarter's **median**
weekly value of that panel's shadow series (recomputed under active filters). If
`prevQuarter` is null, no band.

**Delta strip**: small bar chart under each panel, one bar per week index:
`current% − shadow%` — green ≥ 0, red < 0. Only spans weeks that exist in both
quarters' elapsed ranges.

**Degradation**: `prevQuarter === null` → panels render current-quarter lines only,
with a muted note "No previous quarter data — shadow and threshold unavailable."

### 3.4 Manager Scorecard tag (Overview)

Scorecard rows where `isExcepted` render an "Excepted" pill after the name and are
sorted to the bottom of the table. Tooltip/subtitle notes: "Excluded from engagement
metrics by configuration." Their row metrics still display (transparent and
auditable). The QoQ manager panel and any engagement aggregate skip them entirely.

---

## 4 · Edge cases & error handling

| Case | Behavior |
|---|---|
| Silent week mid-quarter | Renders as zero on all charts (fixed by `trendWeeks`) |
| Quarter with no prior data | `prevQuarter: null` → no shadow/threshold/delta, muted note |
| Filters match nobody | Standard empty-state in each chart card |
| Current quarter early (2 weeks in) | Delta strip covers only elapsed weeks; QoQ lines stop at today |
| All-Time drill | Cadence strip hidden; gap callouts suppressed across quarter boundaries |
| Excepted manager also an IC with goals | Exception affects only manager-side metrics; their own rocketeer engagement counts normally |
| Employee in current but not previous quarter (new hire) | Simply absent from shadow denominators — no imputation |
| Payload growth | Handled by existing chunked cache; `CACHE_VER` bump invalidates old entries |

## 5 · Testing

GAS-editor-runnable, Node-compatible (stubbed `Logger`), same style as existing
`_test_*` functions:

- `_test_weeklySeries_` — `aggregateByRocketeer_` produces correct sparse
  `weeklySelf`/`weeklyMgr` (self vs manager vs other attribution, week bucketing).
- `_test_prevQuarterLabel_` — quarter decrement math incl. FY boundary
  (`FY26Q1` → `FY25Q4`).
- `_test_trendWeeks_` — full week list start→today clamping, year-boundary weeks.
- `_test_managerExceptions_` — normName matching; excepted manager tagged in
  scorecard and excluded from the manager-engagement computation.

Client-side chart math (QoQ %, median threshold, delta, gap detection) is factored
into small pure functions at the top of the script block so they can be eyeballed
and unit-tested by extraction if needed.

## 6 · Out of scope

- No changes to `getRocketeerGoalDetail`, HR Tracker, access control, or the
  Overview KPI/Needs Support/Attrition sections (beyond removing the trend section
  and adding the Excepted pill).
- No admin UI for the exception list (code constant by decision).
- No N-quarter overlay (rejected option C) — the design compares exactly
  current vs previous.
