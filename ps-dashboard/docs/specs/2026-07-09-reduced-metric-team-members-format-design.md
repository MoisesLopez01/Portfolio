# Team Members format for reduced-metric teams (R&D / Sales & Success) — Design

**Date:** 2026-07-09 (2026.W28)
**File touched:** `PS Dashboard.html` only (frontend-only; no backend, no payload change, no `PS_CACHE_VER` bump)
**Related:** `ps-dashboard/docs/specs/2026-07-08-org-team-toggle-design.md` (team registry, `hasMetric_`)

## Problem

The Team Members table was designed around tracked/planned hours. R&D and
Sales & Success (JF004) carry only `si, goals, kudos, pto` (`TEAMS_` in
`PS Teams.js`) — no tracked, planned, or RCR. For those teams today:

- Every week cell leads with a dead `—` in the primary (hours) slot; the real
  weekly signal — Goals ✓/✗, kudos, PTO — is squeezed into 9px meta pills.
- Future week columns render but can never hold anything (no planned data):
  a column of `—` + `Goals —` pending pills.
- Week-column sort sorts by nonexistent hours — meaningless.
- The drawer's hour-ish pieces (RCR monthly card, PROJECTS row, low-hours
  coaching prompt) hide only because their *data* happens to be absent, not
  because the team's metric set excludes them.

## Decision (user-approved, Option C of three mockups)

**Uniform pill stack.** For reduced-metric teams the week cell drops the
big-number/meta hierarchy entirely: each cell is a compact, centered stack of
equal-weight pills. No hours placeholder, ever.

## Design

### 1. Gating rule — team-agnostic

One derived flag in the frontend, next to `hasMetric_`:

```js
function isHoursTeam_() { return hasMetric_('tracked') || hasMetric_('planned'); }
```

- Services (has both) → today's rendering, byte-for-byte untouched.
- R&D and Sales & Success (has neither) → pill-stack format.
- Any future team follows its own `TEAMS_` metric set with no further UI work.
- Legacy payloads without `meta.team` → `hasMetric_` returns true for all
  keys → hours rendering (pre-toggle behavior preserved).

### 2. Week universe — past + current only

Reduced-metric teams have no forward-looking data. At the top of
`renderEmployeeTable()` and `buildDetailHTML()`:

```js
var weeks = DATA.weeks;
if (!isHoursTeam_()) weeks = weeks.filter(function(w) { return !w.isFuture; });
```

Every colspan/header/cell in both renderers derives from this local `weeks`
array, so layout adjusts automatically. Services keeps the full
past/current/future window.

### 3. Week cell rendering (`renderEmployeeTable()`)

When `!isHoursTeam_()`, each week cell is a centered pill stack
(vertically centered — there is no primary/meta hierarchy):

| Week state | Pills |
|---|---|
| Past, compliant | `Goals ✓` (green) · `♥ n` kudos (if any) · `PH` (if any) |
| Past, non-compliant | `Goals ✗` (red) · kudos/PH as above |
| Past, no goals record | kudos/PTO/PH pills if any; muted `—` only when the cell would otherwise be empty |
| Current, not yet compliant | amber `in progress` · kudos/PH as they land |
| Current, compliant | `Goals ✓` · kudos/PH |
| Current, no goals record | same empty-cell rule as past weeks |

- Existing pill classes are reused (`wc-goal-ok`, `wc-goal-err`, `kudos-pill`,
  `ph-pill`); one new amber `in progress` pill style.
- PTO pill: `nh PTO` when `ptoPlannedHrs > 0` for the week (data-driven —
  in practice absent for these teams since it comes from the planning sheet).
- Crew guard unchanged: `isCrewEmp(emp)` suppresses goals pills (crew exist
  only in the Services population in practice, but the gate stays).
- The goals compliance dot next to the name and the Ramp-Up badge are
  unchanged (already metric-independent).

### 4. Header + sorting

- Column status labels: already blank for these teams
  (`hasMetric_('tracked'/'planned')` gates in the `<th>` builder) — no change.
  Future headers disappear with the week filter (§2).
- `sortEmployees()` `week:` branch: when `!isHoursTeam_()`, sort by goals
  compliance (`goalsDetail.compliant` → 1, else 0), tiebreak by kudos count,
  instead of tracked/planned hours.

### 5. Drawer (`buildDetailHTML()` + `buildActionPrompt_()`) — explicit metric gates

Replace incidental data-absence hiding with metric-set gates so hour-ish
pieces can never leak into a reduced-metric team's drawer:

| Piece | Gate added |
|---|---|
| RCR exec trend card + "RCR — monthly" full chart | `hasMetric_('rcr')` |
| PROJECTS row | `hasMetric_('planned')` (AND the existing any-data check) |
| Coaching prompt №0 (RCR below team) | `hasMetric_('rcr')` |
| Coaching prompt №2 (low tracked hours) | `hasMetric_('tracked')` |

Unchanged: GOALS rows, KUDOS rows, PTO rows, SI quarterly card, and the
Contribution Fingerprint radar (its axes already filter by `hasMetric_`,
which is why these teams see a 4-axis radar).

The drawer's week columns also shrink to past + current via §2.

## Out of scope

- Team Contribution Pulse (8-week summary table) — separate surface.
- Adding a Week/Month/Quarter granularity toggle to Team Members.
- Backend/payload changes of any kind.
- Services-team rendering.

## Testing

Manual QA via the org team toggle, one member expanded per team:

1. **Services** — renders exactly as before (hours cells, future columns,
   PROJECTS/RCR in drawer, hours sort). Crew filter still behaves.
2. **R&D** — pill-stack cells; no future columns; no `—` hours placeholders;
   week-column sort orders compliant → non-compliant; drawer shows SI card +
   GOALS/KUDOS/PTO rows + 4-axis radar; no RCR/PROJECTS; coaching prompt
   never mentions hours or RCR.
3. **Sales & Success** — same assertions as R&D.
4. **Current week** — amber `in progress` flips to `Goals ✓` when compliant.
5. **Legacy payload guard** — with `meta.team` absent (simulated), hours
   rendering everywhere.
