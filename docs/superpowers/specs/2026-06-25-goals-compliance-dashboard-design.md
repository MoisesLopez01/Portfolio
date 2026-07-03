# Goals Compliance Dashboard — Design Spec
**Date:** 2026-06-25  **Files:** `goalCompliance.js` + `GDash.html`

## Architecture
GAS Web App. Two files in one Apps Script project. `goalCompliance.js` serves `GDash.html` and exposes server functions via `google.script.run`.

## Data Sources
| Source | Spreadsheet | Sheet | Purpose |
|--------|------------|-------|---------|
| Goals | `1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ` | `RD` | Goal records (one row per goal+comment) |
| Roster | `1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0` | `Data` (company-wide raw export — NOT the PS-filtered `Roster` tab) | Active/inactive status, zero-goal employee injection, location/department/supervisor lookup, manager org-tree scoping |
| HR Tracker | Goals SS | `HR Follow-Up Tracker` | Notes written by HR (auto-created on first save) |

**RD fields used:** Rocketeer, Department, Class, Supervisor, Goal ID, Start Date, Mood, Goal Name, Goal Status, Comment Date, Comment Text, Commentator, Fiscal Quarter, Job Title

**Job Family** derived from `Job Title` via keyword mapping (no extra sheet read).

## Aggregation Logic (server-side)
- Group RD rows by Rocketeer → Goal ID
- Count unique Goal IDs per Rocketeer → `totalGoals`
- Count comments where `Commentator == Rocketeer` → `selfComments`; where `Commentator == Supervisor` → `managerComments`
- Status: **On Target** = 10+ goals; **Less Than 10** = 1–9; **No Goals** = 0
- Result cached in ScriptCache for 5 min (key per quarter)

## Layout
Hybrid A+B: sticky header → filter chips bar → tab nav → tab content.

### Tabs
| Tab | Content |
|-----|---------|
| Overview | 5 KPI cards · dept stacked bar · status donut · "who needs support" preview |
| Departments | Full-width 100% stacked horizontal bar + dept summary table |
| Locations | Compliance rate bar chart + location table |
| Job Families | Stacked bar by derived family + table |
| ⚠ At Risk | Categorised table (No Goals / <8 / 8–9) with HR review button per row |
| HR Tracker | Notes log · compliance delta (was→now) · reviewed/pending counters |

### Filter Chips (all tabs, all charts respond)
Location · Department · Job Family · Status · Supervisor — multi-select, reset-all

## HR Follow-Up Tracker
Sheet columns: `Timestamp, Rocketeer, NormName, Quarter, ReviewedBy, Note, FollowUpDate, Status, Supervisor, Department`

Modal captures: status (Reviewed/Needs Follow-up/Escalated/Resolved), free-text note, follow-up date. Reviewer email auto-filled from `Session.getActiveUser()`.

## Export
- Per-chart PNG via `html2canvas`
- At-Risk and HR Tracker CSV via Blob download
