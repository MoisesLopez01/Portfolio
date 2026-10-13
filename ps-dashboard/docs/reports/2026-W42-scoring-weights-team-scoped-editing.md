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

Everything is edited in the one table; there is no separate "Advanced settings" any more (it duplicated the table and was removed the same day).

- **Super Admin:** type a new rate in the company default chips, in any role cell of any team, or in any level cell inside a role's fold, then Save once. Each edited row must add up to 100.
- **Org Admin:** the same role and level cells, for their own teams only. No company default.
- A level that matches its role row follows it, including future changes; a level typed on its own is tuned on its own; "follow role" snaps it back.
- A save is checked on the server. An Org Admin whose request names another team is refused outright and the attempt is logged.
- **Reset all to defaults** (two clicks) clears every role and level of the teams you may edit, so each role scores with its team's default by its metrics (Services roles start from the company default; R&D, Sales & Success and the operations families from their own defaults) and every level follows its role. The company default is kept. A role that still carries its own points shows a small "custom" tag.
- Unsaved cells now survive a background refresh of the dashboard, and the "Saved" note stays on screen after the table refreshes. Before this fix a background refresh silently emptied the editor, which looked like "save is not working".

## Where the rules live

- Who may edit: `canEditScoring_` and `canEditScoringBase_` in `PS Security.js`.
- Which teams: `scoringEditTeams_` in `PS Contribution Report.js`, using the same org-tree walk as the dashboard.
- Tests: `tests/scoring-weights-view-checks.js` (109 checks).
- Design: `docs/specs/2026-10-12-scoring-weights-team-scoped-editing-design.md`.

## Done in 2026.W42

- GTT-935 created (Task, component Models, Metrics, Agents (MMA)), closed as Done with 6h logged.
- `clasp pull` into a scratch dir showed no editor-only edits; `clasp push -f` (16 files) then `clasp deploy` published **@289** on the live URL.
- Follow-up the same day: the duplicated "Advanced settings" editor was removed and the table became the one place to edit; published as **@290**.
- Second follow-up: unsaved cells no longer vanish on a background refresh, the saved note survives the table refresh, and "Reset all to defaults" was added and run once for Services, R&D and Sales & Success; published as **@291**.

## Open decision

- Whether plain Admins should get edit back. This build follows the ask literally: Super Admins and Org Admins only.
