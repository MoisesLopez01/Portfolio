# Planned-Time Project Context — Design

**Date:** 2026-06-22 (2026.W26)
**Status:** Approved design — ready for implementation plan
**Files touched:** `PS Contribution Report.js` (backend), `PS Dashboard.html` (frontend)

---

## 1. Summary

Add a **project-context satellite** to the PS dashboard: a display-only, week-over-week
record of how many distinct projects each rocketeer is *planned* across, derived from the
`Key` column of the **Planned Time Tempo** sheet.

It answers a question the report can't answer today: *is this person switching context
across many projects each week, or staying focused on a single project context?*

It is **pure context** — it never feeds the contribution score, the Top Rocketeers ranking,
or the scoring-weights matrix, and carries no good/bad judgment (high variety is situational,
not inherently better or worse). This mirrors how RCR is already framed in the dashboard.

Surfaced in two places:
- **Rocketeer expandable panel** — the primary home: a per-week record per employee.
- **Trends tab** — a light team-level view of which projects are in demand each week.

## 2. The metric & data rules

- **Count** = number of distinct project keys with planned hours > 0 in that ISO week
  (raw distinct count). Read across the row, the count trend (`2 → 3 → 4 → 4 → 2 → 1`)
  shows fragmentation vs. steady single-context focus.
- **Non-project key exclusions** — the `NETSUITE` key is "Time-off synced from NetSuite";
  time-off is already represented in the main report, so it is excluded from project
  context. Implemented as a configurable list so future non-project keys are trivial to add:
  ```js
  CONFIG_PS.PLANNED_NONPROJECT_KEYS = ["NETSUITE"]   // matched case-insensitively
  ```
- **"New this week"** = a project key present in a week but absent in the **immediately
  prior week within the report window**. The earliest week in the window has no in-window
  predecessor, so nothing is flagged "new" there — it is the baseline. (Both the rocketeer
  panel and Trends use the same definition, computed client-side.)
- **Source** — read directly from the planned project-key rows. This is independent of the
  PTO-subtraction logic (`subtractPTOFromPlanned_`), which only adjusts the time-off rows
  that project context already excludes.
- **Coverage** — populated for **past and future weeks** (planned data fills the future, so
  this doubles as a forward look at upcoming context load), and applies to **both FTE and
  crew** since it is context, not a scored pillar.
- **Hours** — per project, in the same scoped per-week hours the planned reader already
  produces (`totalPlannedSecondsInScope`-based), rounded for display.

## 3. Architecture

**One payload addition; everything else is derived client-side.**

### Backend (`PS Contribution Report.js`)

- Extend `readPlannedTimeByWeek_` to also retain hours **split by project key**, not just the
  per-employee total it computes today. The reader already locates the employee column and the
  per-week hour columns; it additionally has the `Key` column (col C of the export). For each
  (employee, week) it accumulates `{ KEY: hrs }`, skipping any key in
  `CONFIG_PS.PLANNED_NONPROJECT_KEYS` and any blank key.
  - Concretely, `result[w.label]` gains `byEmployeeProjects[norm] = { KEY: hrs, ... }`
    alongside the existing `byEmployee[norm]` total. **The existing planned-total and headcount
    math is left exactly as-is** (it continues to sum every week-column hour as it does today,
    including the time-off rows); the new per-key map is a parallel accumulation that *additionally*
    excludes `PLANNED_NONPROJECT_KEYS`. Project context and the planned-hours total are therefore
    independent — changing one does not move the other.
- In `buildEmployeeRows_`, add one field to each `empWeeks[label]`:
  ```js
  projects: [ { key: "ACME", hrs: 16 }, { key: "BETA", hrs: 10 }, ... ]   // sorted hrs desc, non-project keys excluded
  ```
  Empty array when the employee has no planned project hours that week.

### Client (`PS Dashboard.html`) — derives the rest from `emp.weeks[label].projects`

- **Count** = `projects.length`.
- **New-this-week** = a key in this week's `projects` whose key is not in the prior week's
  `projects` (per employee for the panel; per filtered-team union for Trends).
- **Trends aggregation** = rolled up across `getFilteredEmployees()` so it respects the active
  Trends filters (consistent with every other Trends card). Per week, per key: summed hours and
  a people count (number of filtered employees with that key, hrs > 0).

**Rejected alternative:** precomputing Trends aggregates server-side. It would bypass the
client-side filter system that all other Trends cards use and duplicate the rollup logic.
The single-field contract keeps one source of truth (`emp.weeks[label].projects`) for both views.

## 4. Display — Rocketeer expandable panel (`buildDetailHTML`)

A new `PROJECTS` row in the existing per-week metric table (`det-ts-tbl`), styled like the
Goals/PTO rows (summary row + expandable detail row).

- **Collapsed (summary row):** the distinct project **count** per week. Current week in orange
  (`--orbe`), future weeks muted, matching the existing week-column color convention.
- **Expanded (detail row), per week cell:**
  - Project **key pills** on top, sorted by hours descending.
  - Pills that are **new vs. the prior week** rendered amber (`#FEF3C7` bg / `#92400E` text),
    same treatment as elsewhere; carried-over projects use the standard pill style
    (`#EEF4FF` / `#3730A3`).
  - A **compact hours line** directly beneath the pills, sorted to match the pill order:
    e.g. `16 · 10 · 8 · 6h`.
- Populated for past **and** future weeks. Shown for FTE and crew alike.

## 5. Display — Trends tab (`renderTrendsTab`)

A new light card, "Project context" (no graphs). Per-week blocks, newest behavior emphasized.

- **Collapsed (default):** one block per week showing the **project keys active** that week as
  tags, with a small count caption (`6 projects active · 2 new`). Keys **new vs. prior week**
  are amber. The current week's block is visually emphasized (orange border/tint).
- **Expandable per week:** planned **hours per project**, sorted descending, each annotated with
  the **people assigned**: `ACME — 182h · 9 people`. New keys keep the amber treatment.
- **Filter-aware:** all counts, hours, and people totals roll up across
  `getFilteredEmployees()`, so the card responds to the Trends filters like its siblings.

## 6. Out of scope (YAGNI)

- No scoring integration (now or implied) — see §1. (The payload field is generic enough that a
  future scored variant could be built on it without rework, but no hook is added now.)
- No concentration/entropy index — the raw distinct count was chosen deliberately for
  transparency.
- No graphs/charts in the Trends card.
- No server-side Trends aggregation.
- No new sheet reads — reuses the Planned Time Tempo data already loaded.

## 7. Risks & notes

- **Sheet format dependency:** relies on the `Key` column produced by `TempoPlanExport.js`
  (col C). The planned reader was recently updated to handle the two-row stacked header and the
  `2026.W14` ISO labels; project context reads from the same rows, so it inherits that handling.
- **Payload size:** adds a per-employee, per-week project list. For ~50 people × 7 weeks ×
  a handful of projects each, this is small relative to the existing payload; no concern, but
  worth a sanity check after wiring.
- **Blank / malformed keys:** rows with an empty `Key` are skipped (not counted as a project).
- **Caching:** no new cache surface; rides the existing `getPSReportData()` cache.
