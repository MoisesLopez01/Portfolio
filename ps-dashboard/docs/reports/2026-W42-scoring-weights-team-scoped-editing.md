# PS Contribution Report — Scoring Weights by team, edited by Super Admins and Org Admins (2026.W42)

**Status:** built, tested, ticketed and deployed on 2026-10-12 (2026.W42) as live deployment **@289** under **GTT-935** (Done, 6h logged).
**Branch:** `worktree-scoring-weights-prod` (local worktree `D:\Development\.claude\worktrees\scoring-weights-prod`), based on the deployed @288 baseline.
**Reference:** the Scoring Weights page of the thesis demo replica, which already carried the 2026.W41 page design.

## Summary

- **Everyone can open Scoring Weights.** Every role that can open the dashboard sees how the score is built: the company default, one "Points by role" table, and each role's levels folded underneath.
- **The page shows one department at a time.** It follows the Services / R&D / Sales & Success toggle at the top. Services lists the Services roles and levels, R&D its own, Sales & Success its own. Advanced settings follows the same grouping.
- **Only Super Admins and Org Admins can change the weights.** A Super Admin can change any team. An Org Admin can change only the teams their own org holds, and the page names the team and says that a change applies to every rocketeer of that team in the role. Plain Admins, viewers and managers read.
- **The company default stays with Super Admins.** It re-weights every team at once, so an Org Admin never sees that editor.

## What a reader sees

1. The company default strip: how the 100 points split before any role tunes them.
2. One table for the team on screen: a row per role, the score mix bar, the points per metric. A metric a role cannot earn shows a dash.
3. A fold under each role (▸) listing its levels, the job titles at each level, and the points each level scores with; a highlighted cell is where a level differs from the role.
4. "How a score is built" in four steps, folded.

Managers and Org Admins see only the roles and levels their own people hold, with headcounts.

## What an editor can do

- **Super Admin:** type a new rate in any role cell of any team and Save (each role must add up to 100). Under Advanced settings: the company default, and the per-level matrix of the team on screen.
- **Org Admin:** the same role cells, for their own teams only. Under Advanced settings: the per-level matrix of the team on screen. No company default.
- A save is checked on the server. An Org Admin whose request names another team is refused outright and the attempt is logged.

## Where the rules live

- Who may edit: `canEditScoring_` and `canEditScoringBase_` in `PS Security.js`.
- Which teams: `scoringEditTeams_` in `PS Contribution Report.js`, using the same org-tree walk as the dashboard.
- Tests: `tests/scoring-weights-view-checks.js` (109 checks).
- Design: `docs/specs/2026-10-12-scoring-weights-team-scoped-editing-design.md`.

## Done in 2026.W42

- GTT-935 created (Task, component Models, Metrics, Agents (MMA)), closed as Done with 6h logged.
- `clasp pull` into a scratch dir showed no editor-only edits; `clasp push -f` (16 files) then `clasp deploy` published **@289** on the live URL.

## Open decision

- Whether plain Admins should get edit back. This build follows the ask literally: Super Admins and Org Admins only.
