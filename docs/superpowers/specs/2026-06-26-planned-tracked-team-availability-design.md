# Design: Planned vs Tracked + Team Availability
**Date:** 2026-06-26  
**Status:** Approved for implementation  
**Branch:** feature/portfolio-live-demos

---

## Overview

Three enhancements to the Project Demand Dashboard to turn delivery-gap data into an actionable C-suite and manager signal:

1. **Planned vs Tracked chart** — relabel, add threshold line and fidelity badge
2. **Heatmap People mode** — 4th chip toggles cells from hours → headcount
3. **Team Availability panel** — new section showing per-person execution (past) and planning coverage (future)

---

## Feature 1 — Planned vs Tracked Chart

### What changes
The panel heading `Planned vs Delivered` becomes **`Planned vs Tracked`**.  
The existing dual-line SVG chart already renders both lines correctly. The enhancement is:

- **Target threshold line** — dashed horizontal line at `DATA.planTarget` (default 0.9 = 90%) rendered across the full chart width, labeled "Target" in `--muted` color.
- **Fidelity badge** — the existing `#capChip` status chip already shows execution %. Ensure the label reads `XX% execution` (not "utilisation"). No structural change to `renderCapacity()` — just verify the chip label wording.
- **Heading rename** — change `h2` inner text from `Planned vs Delivered` to `Planned vs Tracked` in the HTML structure.
- **So-What copy** — update `#capSoWhat` logic in `renderCapacity()` to reference "tracked" not "delivered" in its narrative strings.

### No changes to
Chart SVG geometry, data, axes, or the People Signals panel.

---

## Feature 2 — Heatmap People Mode (4th chip)

### Toggle placement
The existing `chip-toggle` row reads: **Change | Risk | Hours**.  
Add a 4th button: **👥 People** — same DOM structure as the other three.

```html
<button onclick="setColorMode('people')" id="cmPeople">👥 People</button>
```

### State
`COLOR_MODE` gains a new value: `'people'`.  
All existing mode branches (`'hours'`, `'change'`, `'risk'`) are unchanged.

### Cell rendering in people mode
In `renderHeat()`, when `COLOR_MODE === 'people'`:
- **Cell value:** `DATA.head[key][iso] ?? ''` (headcount integer, or blank if zero)
- **Color scale:** interpolate between `--surface-2` (0 people) → `--royal` (#2864E6) → `--void` (#0F1941) at max headcount. Same `heatColor_()` helper, just different palette constants passed in.
- **Cell text:** append `p` suffix — e.g. `"6p"`.
- **Legend:** swap to "0 people → N people" scale with the royal→void gradient bar.

### Data requirement
`DATA.head[key][iso]` already exists in the payload (computed by `readPlannedAllocations_()` in Code.js). No server change needed.

---

## Feature 3 — Team Availability Panel

### Purpose
A person-centric grid showing:
- **Past weeks** — execution rate bar per person (planned vs tracked), color-coded by threshold
- **Current week** — in-progress bar (tracked so far vs planned)
- **Future weeks** — planning coverage (has plan = dashed blue bar; no plan = red warning cell)

Target users: managers scanning who is under-delivering and who has no project assignment ahead.

### New server-side payload fields (Code.js)

Three new fields added to the `getDemandData()` return object:

```js
personWeekPlan:    { normName: { iso: totalPlannedHours } }
personWeekTracked: { normName: { iso: totalTrackedHours } }
personMeta:        { normName: { displayName, jobFamily, manager, location } }
```

**Computation:** In `buildPersonAvailability_(plannedRows, trackedRows, roster)`:
- Iterate `plannedRows` (already parsed by `parseAllocations_()`): sum all project-key columns per person per ISO week → `personWeekPlan`.
- Iterate `trackedRows` similarly → `personWeekTracked`.
- Join to roster on normalized name → `personMeta` (display name, `jobFamily` = roster `Department` column value, manager = roster `Supervisor` column, location = roster `Location` column if present).
- Only include names present in roster (active employees). Exclude ramp-up employees consistent with `RAMP_UP_MONTHS` exclusion used elsewhere.

**Call site:** invoked inside `getDemandData()` after `readPlannedAllocations_()` and `readTrackedAllocations_()` complete.

### Frontend — HTML structure

New panel inserted **after** the People Signals panel (`#sigPanel`), **before** the Project Key Heatmap:

```html
<div class="panel" id="availPanel" style="display:none">
  <div class="panel-h">
    <h2>Team Availability</h2>
    <div class="panel-tools">
      <!-- reuse same sigfilter dropdowns for Loc / Family / Manager -->
      <select class="sigfilter" id="availLoc" onchange="renderAvailability()">…</select>
      <select class="sigfilter" id="availFam" onchange="renderAvailability()">…</select>
      <select class="sigfilter" id="availMgr" onchange="renderAvailability()">…</select>
    </div>
  </div>
  <div id="avail"></div>
</div>
```

Panel is hidden (`display:none`) until `DATA` loads; shown in `renderAll()` if `DATA.personWeekPlan` is present.

### Frontend — `renderAvailability()` function

**Layout:** CSS grid with columns `[140px repeat(N, 1fr)]` where N = `DATA.isoList.length` (same week window as the rest of the dashboard).

**Week header row:**
- Past weeks: label in `--orbe`, sub-label "past" in `--muted`
- Current week: amber background tint (`color-mix(in srgb, var(--amber) 10%, var(--surface-2))`)
- Future weeks: label in `--muted`, sub-label "future"
- A thin `border-top: 1px solid var(--border)` separates past from future columns visually (applied via CSS on future-column cells).

**Person rows** (one per person, sorted by: most "no plan" future weeks first, then by lowest mean past execution):

For each `iso` in `DATA.isoList`:

| Week status | Bar fill color | Label |
|---|---|---|
| Past, execution ≥ planTarget | `--pos` (#1F8A57 / #34D399) | `XX%` |
| Past, execution 60–planTarget | `--amber` (#B45309 / #FDBA74) | `XX%` |
| Past, execution < 60% | `--warn` (#C2410C / #FB7185) | `XX%` |
| Past, over-allocated (tracked > planned × 1.05) | `--june` (#FF9B87) | `XX%` |
| Current week | `--amber` partial fill, `"now"` label | `in progress` |
| Future, has plan | `--orbe` dashed-border fill (50% opacity) | `XXh` |
| Future, no plan (zero planned hours) | `--warn` dashed-border cell, `!` icon | `no plan` |

Bar width = `min(1, trackedH / plannedH) * 100%` for past weeks. If `plannedH === 0` for a past week, render a blank cell (no bar, no label) — the person had no planned work that week.  
For future weeks, bar width = `min(1, plannedH / DATA.baseCapacity) * 100%`.

**Person name cell:** displays `displayName` (line 1) and `jobFamily` (line 2, `--muted`).

**Row drill-down (click to expand):**  
Clicking a person row toggles an inline `.drill` sub-row showing a compact keychip list of their projects for the selected week (`SEL_ISO`), with planned hours per project. Uses `DATA.cap` filtered to keys where the person appears in `DATA.head`. This is display-only — no extra data fetch.

### CSS additions

```css
/* Team Availability */
.avail-grid { display:grid; gap:2px; align-items:center; }
.avail-cell { height:26px; border-radius:4px; position:relative; overflow:hidden;
  border:1px solid var(--border); display:flex; align-items:center; justify-content:center; }
.avail-cell .fill { position:absolute; left:0; top:0; height:100%; border-radius:3px; }
.avail-cell .lbl { position:relative; font-size:9px; font-weight:700; font-family:'Roboto Condensed'; }
.avail-cell.noplan { border:1px dashed var(--warn); background:color-mix(in srgb,var(--warn) 8%,var(--surface-2)); }
.avail-cell.future-plan { border:1px dashed var(--orbe); background:color-mix(in srgb,var(--orbe) 8%,var(--surface-2)); }
.avail-cell.current { background:color-mix(in srgb,var(--amber) 10%,var(--surface-2)); }
.avail-name { font-size:11.5px; font-weight:600; cursor:pointer; padding:4px 6px; border-radius:6px; }
.avail-name:hover { background:var(--surface-2); }
.avail-name .sub { font-size:10px; color:var(--muted); font-weight:400; }
.avail-drill { grid-column:1/-1; background:var(--surface-2); border-radius:8px; padding:8px 12px;
  display:none; font-size:11.5px; }
.avail-drill.open { display:block; }
```

### Legend
Below the grid, a compact flex row:
- ● Green — `≥ planTarget execution`
- ● Amber — `60–planTarget`
- ● Red — `< 60% (needs help)`
- ● Coral — `over-allocated`
- □ Blue dashed — `future: planned`
- □ Red dashed — `future: no plan`

### Sorting
Default sort: people with the most "no plan" future weeks appear at top (descending), then by lowest mean past execution ascending. A secondary "sort" chip toggle (`Signals first | A–Z`) is **out of scope** for v1.

### Filters
`availLoc`, `availFam`, `availMgr` — same option population pattern as `sigfilter` dropdowns in People Signals. Each change calls `renderAvailability()` which filters `Object.keys(DATA.personMeta)` before rendering rows.

---

## Files changed

| File | Change |
|---|---|
| `Code.js` | Add `buildPersonAvailability_()`, add 3 fields to payload, call it in `getDemandData()` |
| `Dashboard.html` | (1) Rename heading + update copy; (2) Add People chip to heatmap toggle + `COLOR_MODE='people'` branch in `renderHeat()`; (3) Add `#availPanel` HTML, `renderAvailability()` JS, `.avail-*` CSS |

---

## Out of scope (v1)
- Clicking a future "no plan" cell to pre-fill a planning form
- Export / CSV of the availability grid
- Sorting toggle (Signals first | A–Z)
- Push notifications when a person has N consecutive "no plan" future weeks
