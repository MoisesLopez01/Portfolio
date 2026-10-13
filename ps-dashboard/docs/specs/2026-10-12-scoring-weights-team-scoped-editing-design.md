# Scoring Weights — one team at a time, edited by Super Admins and Org Admins — design

**Date:** 2026-10-12 (2026.W42) · **Status:** implemented on branch `worktree-scoring-weights-prod`; deployed 2026-10-12 as @289 under GTT-935
**Report (plain English):** `ps-dashboard/docs/reports/2026-W42-scoring-weights-team-scoped-editing.md`
**Reference build:** the thesis demo replica (Vantara) Scoring Weights page, which carries the 2026.W41 design
**Builds on:** `2026-07-09-team-aligned-scoring-design.md` (team gates, family tunes), the 2026.W41 Scoring Weights
page (company default strip + one "Points by role" table whose rows fold open to levels), `2026-09-01-view-as-impersonation-design.md`.

## 1. Ask

1. Everyone who can open the dashboard can read the Scoring Weights page.
2. Only Super Admins and Org Admins can change it. Plain Admins, viewers and managers read.
3. The page shows one department at a time: Services shows its own roles and levels, R&D its own, Sales & Success
   its own, and Advanced settings follows the same grouping.

## 2. Page behaviour

- **The table follows the team toggle.** `renderScoringSummary_` filters `cfg.sections` to the served team
  (`swTeamKey_()` = `DATA.meta.team.key`, falling back to `STATE.activeTeam`) before `buildRoleRows_`, so the one
  table lists that team's job families only. The tools line names the team ("Services — 9 roles"). Nothing else on the
  page changes: company default strip, level folds, "How a score is built".
- **Org-scoped callers** (payload carries `managerScopeName`: managers, delegates, org admins) still get
  `buildScopedRows_` — only the roles and levels their own people hold, with headcounts — now inside the team on screen.
- **Advanced settings** renders the per-level matrix of the team on screen only (one separator, its family blocks,
  its catch-all). The company default editor (flat base) is built for super admins only.
- **Config is fetched once.** `loadScoringMatrix_(force)` renders from `MATRIX_CFG` when it is already loaded, so a
  team switch is instant; a save (`saveRoleWeights_`, `saveMatrixToSheet_`) forces a refetch, and `loadData(true)`
  (Refresh) clears the cache.

## 3. Who may edit — two gates in PS Security.js

| Helper | True for | Governs |
|---|---|---|
| `canEditScoring_` | superadmin, **orgadmin** | the matrix: role rows (inline rates) and level cells (Advanced settings) |
| `canEditScoringBase_` | superadmin | the company default (`saveWeightSettings`, PS Settings sheet) |

Plain Admin loses the edit it had before 2026.W42; the ask names Super Admins and Org Admins only. The company default
stays with Super Admins because it re-weights every team at once, which an org-scoped editor must not be able to do.

**Which teams** — `scoringEditTeams_(access, loadRoster)` in PS Contribution Report.js:

- superadmin → every `TEAMS_` key (the roster loader is never called);
- orgadmin → the teams their own org tree holds: `resolveManagerScope_` over the bridged roster
  (`readPSRoster_(bridges)`, so a dropped mid-level manager severs nothing), own row dropped, then
  `availableTeams_` — exactly how `getPSReportData` scopes their dashboard, so the editor can never reach a team
  the toggle does not show;
- an org admin with an empty tree, plain admins, viewers, managers → `[]`.

`getScoringConfig` ships `editTeams` and `canEditBase`; `canEdit` is true only when `editTeams` is non-empty. An org
admin's editor payload is narrowed to those teams: `sections` (which carry headcounts), `matrix` (so what they post
back can only name those blocks) and the Services unmapped-title audit. `saveScoringMatrix` re-resolves `editTeams`
and **refuses the whole save** when the payload names any other team, logging who posted what — never a silent trim.
`saveWeightSettings` gates on `canEditScoringBase_`.

Client: `canEditScoring_()` (superadmin / orgadmin, never while 👁 previewing), `canEditScoringBase_()`
(`isSuperAdmin_()`), and `swCanEditTeam_(cfg)` = both the client gate and `cfg.editTeams` containing the team on
screen. The "Other job titles" row has no block to write (`targets` empty) and never carries inputs; `swRateInput_`
skips rows without inputs so a read-only row cannot block Save.

## 4. Blast radius, stated on the page

A role row is the family's block-wide `ALL` cell of the team on screen. An org admin for part of Services who changes
"Service Delivery" changes it for every Services rocketeer in that family, not only their own tree — the matrix is per
(team, family), not per org tree. The tools line says so for editors: "a change applies to every Services rocketeer in
that role".

## 5. Tests

`tests/scoring-weights-view-checks.js` (109 checks): policy of both gates; `scoringEditTeams_` as a pure function over
a stub roster (super admin all teams without loading the roster; org admin through a dropped row; empty tree, plain
admin, manager, denied → none); server wiring (gates, narrowing, refusal); client (team filter, `swCanEditTeam_`,
company default for super admins only, cached config, team-scoped Advanced settings). Rendered in the static harness
for superadmin, orgadmin (edit + save + R&D switch), admin and manager.
