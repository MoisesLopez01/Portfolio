# Project Demand Dashboard — FTE/Crew Filter + Tracked vs Planned Signals
**Date:** 2026-06-30  
**Branch:** feature/portfolio-live-demos (local)  
**Files:** `docs/superpowers/project-demand-dashboard/Code.js`, `Dashboard.html`

---

## Problem

The dashboard currently shows all org members (FTEs and crew/contractors) without any way to filter by member type. Managers and the CEO need to evaluate planning health for the Services FTE team specifically — crew members plan and track differently and can distort the signals.

The week selector bar only drove the now-removed Ranked Demand chart and adds noise without purpose. The Ranked Demand chart itself restates what the heatmap already shows, without adding trend context useful to the CEO.

Finally, there is no signal-oriented per-week view. Managers need to know *what needs a conversation and why* — not a raw data table they must decode.

---

## Design Principles

- **Signal, not dataset.** The CEO and managers have Tempo. The dashboard's job is to surface the exception, with just enough context to understand it before asking a question.
- **Context before judgment.** Every gap signal includes why (multi-project fragmentation, PTO that week) so the manager arrives at a conversation informed.
- **Don't touch what works.** Team Availability — with its location / family / manager / role / blend filters — is unchanged.

---

## Scope

### Removed
| Element | Rationale |
|---|---|
| **Week selector bar** (`weekbar`) | Only drove Ranked Demand (removed). `SEL_ISO` defaults to `CURRENT_ISO`. |
| **Ranked Demand chart** (`renderBars()`) | Duplicates heatmap ranking without trend context. Not actionable for CEO/managers. |

### Added
| Element | Where |
|---|---|
| **FTE/Crew `<select>` filter** | Team Availability `avail-filters` bar, alongside existing location/family/manager dropdowns |
| **Tracked vs Planned Signals panel** | Between "Planned vs Tracked" line chart and "Team Availability" |

### Unchanged
- Team Availability (all filters: location, family, manager, All/Mgrs/ICs, blend 1/2/3/4+)
- Planned vs Tracked aggregate line chart
- Project Key Heatmap and all its color modes / question filters

---

## Backend — `Code.js`

**Single change:** add `isCrew` to profile objects in `readRosterFull_()`.

Detection regex (mirrors `PS Contribution Report.js`):
```js
var isCrew = /crew member|contractor/i.test(title);
```

Profile object gains one field:
```js
profiles[norm(name)] = {
  location:  loc,
  jobFamily: fam,
  manager:   mgr,
  isManager: !!(lvlM && lvlM[1].charAt(0) === 'M'),
  isCrew:    isCrew   // ← new
};
```

`buildPersonAvailability_()` already copies roster profile fields into `personMeta`. Add `isCrew` the same way `isManager` is handled — no other backend changes required.

---

## Frontend — `Dashboard.html`

### 1. Removals

**HTML:** delete `<div class="weekbar" id="weekbar">` block.  
**HTML:** delete the `<div class="cols">` block containing the Ranked Demand panel.  
**JS:** delete `renderWeekbar()` and `renderBars()` functions.  
**JS:** remove `renderWeekbar()` and `renderBars()` calls from `renderAll()`.  
**JS:** `SEL_ISO` stays in state (used for Team Availability person-drill) but is set once to `CURRENT_ISO` on `applyModel()` and never changed again.

### 2. FTE/Crew filter in Team Availability

**New state variable:**
```js
var AVAIL_CREW = "";   // "" = all, "fte" = FTE only, "crew" = crew only
```

**New `<select>` in `avail-filters` bar** (after the manager dropdown, before the role chip-toggle):
```html
<select class="sigfilter" id="availCrew">
  <option value="">All members</option>
  <option value="fte">FTE Only</option>
  <option value="crew">Crew Only</option>
</select>
```

**`populateAvailFilters()`** — wire up `onchange` for `availCrew` mirroring the pattern for `availLoc/availFam/availMgr`.

**Filter predicate** in `renderAvailability()` people filter:
```js
if (AVAIL_CREW === 'fte'  && m.isCrew)  return false;
if (AVAIL_CREW === 'crew' && !m.isCrew) return false;
```

**`clearAvailFilters()`** — reset `AVAIL_CREW = ""` and reset the `availCrew` select value.

**Filter summary line** — include crew filter label alongside existing ones:
```js
if (AVAIL_CREW === 'fte')  filterParts.push('FTE only');
if (AVAIL_CREW === 'crew') filterParts.push('Crew only');
```

### 3. Tracked vs Planned Signals panel

#### Position
Inserted between the "Planned vs Tracked" panel and the "Team Availability" panel.

#### State
```js
var SIGNALS_OPEN_ISO = null;   // ISO key of the currently expanded week row, or null
```

#### Data sources (all already in model, no new backend work)
| Field | Used for |
|---|---|
| `model.weeks` | Week list with status (done/now/plan) |
| `model.fidelity[iso]` | Aggregate tracked/planned ratio per week |
| `model.weekTotal[iso]` | Total planned hours per week |
| `model.personSignals[iso].plannedNotTracked` | Gap signals: planned ≥4h, tracked <20% |
| `model.personSignals[iso].untrackedWorkers` | Swarm signals: tracked with no plan |
| `model.personWeekPTO[np][iso]` | PTO context for gap signals |
| `model.personProjectPlan[np]` | Blend count context for gap signals |

#### Collapsed row (all 8 weeks)

Each row shows:
```
▶  2026.W26  Current    78% fidelity   ⚠ 3 gaps
▶  2026.W25  Past       91% fidelity   ✓
▶  2026.W24  Past       64% fidelity   ⚠ 5 gaps · 2 unplanned
▶  2026.W27  Upcoming   312h planned   —
```

- Fidelity chip: green (≥90%), amber (60–89%), red (<60%) — past/current only
- Gap count: `personSignals[iso].plannedNotTracked.length`
- Unplanned count: `personSignals[iso].untrackedWorkers.length`
- Future weeks: show planned total only, no fidelity chip

#### Expanded — past/current weeks

Two signal groups rendered only when signals exist:

**Gap signals** (planned but not tracking):
```
Ana Smith  ·  ACME  ·  20h planned  ·  on 3 projects
Ben Lee    ·  BETA  ·  16h planned  ·  PTO that week
```
Context appended per person:
- "on N projects" when `blendCount(np, iso) > 1` (multi-project fragmentation)
- "PTO that week" when `personWeekPTO[np][iso] > 0`

**Unplanned work** (swarm signals):
```
Cara Diaz  ·  8h on PROJ-X  ·  not in plan
```

**Healthy weeks** (≥90% fidelity, no gaps): expand to a single line —  
*"Execution on track — no gaps above threshold."*

#### Expanded — upcoming weeks
```
312h planned across 14 projects — tracking not yet available.
```

#### Interaction
- Click a week row → toggle open/closed (`SIGNALS_OPEN_ISO` = that iso or null)
- Only one week open at a time (accordion)
- `renderSignals()` function added; called from `renderAll()`

#### Implementation note
`blendCount(np, iso)` is currently a local function inside `renderAvailability()`. Extract it to module scope so `renderSignals()` can call it without duplication.

---

## Data flow summary

```
readRosterFull_()
  └─ profiles[np].isCrew  ← new

buildPersonAvailability_()
  └─ personMeta[np].isCrew  ← copied from profile (new)

getDemandData()
  └─ model.personMeta       ← carries isCrew to frontend
  └─ model.personSignals    ← gap + swarm signals (existing, unchanged)
  └─ model.fidelity         ← aggregate fidelity per week (existing, unchanged)

Dashboard.html
  ├─ renderAvailability()   ← reads AVAIL_CREW, filters on isCrew (new)
  ├─ renderSignals()        ← new; reads personSignals + fidelity
  └─ renderAll()            ← calls renderSignals() (new call added)
```

---

## Success criteria

- Crew filter appears in Team Availability filter bar; FTE Only hides all crew members; Crew Only hides all FTEs; "Clear all" resets it.
- Week selector bar and Ranked Demand panel are gone from the page.
- Signals panel shows one collapsible row per week; past weeks with gaps name the people and their context; healthy past weeks say "on track"; future weeks say "tracking not yet available."
- No raw data tables visible to the CEO or manager — only signals with context.
