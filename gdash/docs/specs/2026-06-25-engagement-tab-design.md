# Engagement Tab — Design Spec
**Date:** 2026-06-25  
**Files:** `goalCompliance.js` (backend) + `GDash.html` (frontend)  
**Replaces:** existing "Comments Trend" tab

---

## Summary

Replace the "Comments Trend" tab with a broader **"Engagement"** tab that tells the full story: how actively rocketeers are commenting on their goals, which teams are falling behind, which managers are reaching their people, and who needs HR follow-up. The trend chart is preserved and anchors the top of the page; the new sections flow below it.

---

## Tab Structure

Tab label changes from `Comments Trend` → `Engagement` in the tab nav (data-tab value stays `trend` to avoid breaking `switchTab` state).

**Scroll order (top to bottom):**
1. KPI cards (6 cards)
2. Trend chart + weekly table (existing, unchanged)
3. Two-column row: Team Engagement (left) + Manager Scorecard (right)
4. Individual Engagement List (full width)

---

## Section 1 — KPI Cards

Six cards in a single row:

| Card | Value | Colour | Sub-label |
|------|-------|--------|-----------|
| Org Engagement Rate | `engagingPct%` | `#058CDC` | `≥1 self-comment this quarter` |
| Active Commenters | `activeCount` | `#00A86B` | `self-commented this qtr` |
| Silent | `silentCount` | `#EF4444` | `0 self-comments` |
| Below Pace | `belowPaceCount` | `#F59E0B` | `< ½ weeks elapsed` |
| Avg Self-Cmts | `avgSelfCmts` | `#9B59B6` | `per rocketeer` |
| Avg Mgr-Cmts | `avgMgrCmts` | `#2864E6` | `per team member` |

**Definitions:**
- `engagingPct` = employees with ≥1 self-comment / total employees × 100
- `activeCount` = employees with ≥1 self-comment
- `silentCount` = employees with 0 self-comments AND totalGoals > 0
- `belowPaceCount` = employees with selfComments > 0 AND selfComments < paceThreshold
- `avgSelfCmts` = total self-comments across all employees / total employees (1 decimal)
- `avgMgrCmts` = total manager comments across all team members / total employees (1 decimal)

---

## Section 2 — Trend Chart

Existing dual-axis Chart.js line chart, unchanged. Tab rename does not affect chart rendering.

- Left y-axis: total comments
- Right y-axis (dashed green line): unique self-commenters per week
- Department toggle chips above chart
- Weekly data table below chart (ISO Week | Total Cmts | Unique People | dept columns)

---

## Section 3A — Team Engagement Rate (left column)

Horizontal progress bars, one per department, sorted descending by rate.

Each row shows:
- Department name
- `N / M · XX%` (N = employees with ≥1 self-comment; M = total employees in dept)
- Bar colour: `#00A86B` if rate ≥ 75%, `#F59E0B` if 50–74%, `#EF4444` if < 50%

Legend below bars: `🟢 ≥75% · 🟡 50–74% · 🔴 <50%`

Only employees with at least 1 goal are counted in M.

---

## Section 3B — Manager Scorecard (right column)

Sortable table. One row per unique supervisor value found in the employee list.

**Columns:** Manager name | Avg Cmts | Coverage | Team size

**Avg Cmts** = total comments the supervisor left on their team members' goals / team size (1 decimal). Colour: green `#DCFCE7/#15803D` if ≥ 2.0, amber `#FEF9C3/#854D0E` if 1.0–1.9, red `#FEE2E2/#B91C1C` if < 1.0.

**Coverage** = count of team members with ≥1 manager comment on any of their goals / team size. Displayed as `N/M`. Same colour thresholds proportionally (≥75% green, 50–74% amber, <50% red).

**Senior Leader detection:** job title matches `/\b(vp|vice.?president|director|chief|c[a-z]o|ceo|cto|cfo|coo)\b/i` → badge `Senior Leader` (blue `#EEF4FF/#1D4ED8`) added after name. Included in scorecard, not excluded.

Job title lookup order for each supervisor: (1) check if supervisor appears as an employee in the `employees` list (they may also have goals); (2) if not found, check a `supervisorTitleMap_` built from the Roster sheet — extend `getLocationMap_()` pattern to also capture `Job Title` from Roster rows keyed by normName. If neither source has a title, `isSeniorLeader_` returns false (no badge).

**Team size** = distinct employees who list this person as `Supervisor` (interns and offboarded already filtered upstream).

---

## Section 4 — Individual Engagement List

Full-width table. All employees with goals included, sorted: Silent first, then Below Pace, then At Pace.

**Pace threshold:** `paceThreshold = Math.floor(weeksElapsed / 2)`  
`weeksElapsed` = calendar ISO weeks from `quarterDates.start` to today (inclusive), computed as `dateToISOWeek_(today) - dateToISOWeek_(quarterDates.start) + 1` (clamped to quarter length). This is a new value `weeksElapsedSinceStart` added to the payload — distinct from `totalQtrWeeks` which only counts weeks with comment activity.

**Tier assignment:**
| Tier | Condition | Row style |
|------|-----------|-----------|
| Silent | selfComments === 0 | `background:#FFF5F5` |
| Below Pace | selfComments > 0 AND selfComments < paceThreshold | `background:#FFFBEB` |
| At Pace | selfComments ≥ paceThreshold | default |

**Columns:** Rocketeer | Supervisor | Department | Goals | Self-Cmts | Mgr-Cmts | Pace Status badge | HR Review button

- HR Review button shown only for Silent and Below Pace rows (reuses existing `openModal()`)
- At Pace rows show `—` in HR Review column
- Pace Status badge uses existing tier CSS classes: `tier-nogoals` (Silent), `tier-watch` (Below Pace), `tier-ontarget` (At Pace)
- Export: CSV button (all rows) + PNG button (visible table)

---

## Backend Changes (`goalCompliance.js`)

### New helper: `getSupervisorTitleMap_()`

Reads the Roster sheet. Returns `{ normName → jobTitle }` for all rows that have a Job Title column. Called once in `buildComplianceData_()` alongside `getLocationMap_()`.

### New function: `computeEngagementData_(employees, weeksElapsed, supervisorTitleMap)`

Returns:
```javascript
{
  engagingPct:    Number,   // %
  activeCount:    Number,
  silentCount:    Number,
  belowPaceCount: Number,
  avgSelfCmts:    Number,
  avgMgrCmts:     Number,
  paceThreshold:  Number,   // floor(weeksElapsed / 2)
  teamRates:      [{ dept, engaging, total, rate }],  // sorted desc
  managerScorecard: [{ name, normName, isSeniorLeader, avgCmts, covered, teamSize }], // sorted desc avgCmts
  engagerList:    [{ ...emp fields, selfComments, managerComments, paceStatus }],     // sorted by tier
}
```

`managerComments` per employee = comments where `normName(Commentator) === normName(Supervisor)` — already available as `emp.totalManagerComments`.

### New helper: `isSeniorLeader_(jobTitle)`

```javascript
return /\b(vp|vice.?president|director|chief|c[a-z]o|ceo|cto|cfo|coo)\b/i.test(jobTitle || '');
```

### New computed value: `weeksElapsedSinceStart`

Computed in `buildComplianceData_()` after `parseQuarterDates_()`:
```javascript
var weeksElapsedSinceStart = 1;
if (quarterDates) {
  var startWk = dateToISOWeek_(new Date(quarterDates.start));
  var todayWk = dateToISOWeek_(new Date(today));
  // Simple difference — same-year assumption holds for one quarter
  var diff = todayWk.split('.W')[1] - startWk.split('.W')[1];
  weeksElapsedSinceStart = Math.max(1, Math.min(diff + 1, totalQtrWeeks));
}
```
Added to return payload as `weeksElapsedSinceStart`.

### Updated `buildComplianceData_()` return payload

```javascript
var supervisorTitleMap = getSupervisorTitleMap_();
// ...
engagementData: computeEngagementData_(employees, weeksElapsedSinceStart, supervisorTitleMap)
```

### Cache version

Bump `CACHE_VER` to `'gd_v4_'`.

---

## Frontend Changes (`GDash.html`)

### Tab nav
Change tab button label text from `Comments Trend` → `Engagement`. Keep `data-tab="trend"` and `id="tab-btn-trend"` unchanged.

### `renderTrend(emps)` → becomes `renderEngagement(emps)`

Rename function. Existing KPI cards and chart logic moved into it. Add calls to:
- `renderTeamEngagement_(eng)` — writes to `#engagement-team`
- `renderManagerScorecard_(eng)` — writes to `#engagement-managers`
- `renderEngagerList_(eng)` — writes to `#engagement-list`

### New HTML containers in `pane-trend`

After the trend chart section card, add:
```html
<div class="col-row">
  <div class="section-card" id="card-engagement-team">...</div>
  <div class="section-card" id="card-engagement-managers">...</div>
</div>
<div class="section-card" id="card-engagement-list">...</div>
```

### KPI cards

Replace the existing 4 trend KPI cards with the 6 engagement KPI cards defined in Section 1.

### CSS additions

No new CSS classes needed — reuse `.tier-nogoals`, `.tier-watch`, `.tier-ontarget`, `.elig-badge`, `.rate-chip`, `.section-divider-label`.

---

## Data Flow

```
RD rows (quarter-filtered)
  └─ aggregateByRocketeer_()    emp.totalSelfComments, emp.totalManagerComments
        └─ computeCommentTrend_()   orgUnique, byDeptUnique (existing)
        └─ computeEngagementData_() teamRates, managerScorecard, engagerList (NEW)
              └─ returned in payload as engagementData
                    └─ renderEngagement() in frontend
```

---

## Out of Scope

- No changes to At Risk, Overview, Breakdown, or HR Tracker tabs
- No new server-side calls — all engagement data computed server-side in `buildComplianceData_` and delivered in the existing payload
- No new modal — HR Review reuses the existing review modal (`openModal()`)
