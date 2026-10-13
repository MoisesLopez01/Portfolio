---
name: ps-scoring-matrix
description: Team-aligned scoring matrix for the PS Weekly Contribution Report — the `PS Scoring Matrix` sheet schema, `weightsForEmployee_` resolution order, `blockFillBase_` fill defaults, the ⚖️ Scoring Weights editor, and its tests. Load when working on scoring weights, the scoring matrix sheet, `weightsForEmployee_`, `blockFillBase_`, `maskToTeamMetrics_`, `migrateLegacyMatrix_`, `saveScoringMatrix()`, or the Scoring Weights editor UI.
---

# Team-aligned scoring matrix (2026-07-09)

Scoring groups follow the org team toggle (`TEAMS_` in `PS Teams.js`): **team gates,
family tunes**. Spec: `ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md`.

> The **hard mask** to `team.metrics` (`maskToTeamMetrics_`) is a safety invariant and is
> also stated in the root `CLAUDE.md`: R&D / Sales members can never carry
> tracked/planned/RCR weight, even from hand-edited sheet rows.

- **Sheet of record**: `PS Scoring Matrix`, schema `Team | Family | Metric | I1–I8,
  M4–M10 | ALL`. Blocks exist per **(team, family)** pair where the family has active
  members in that team — a family spanning two teams has independent blocks. The `ALL`
  column is a block-wide value on any family (a level cell beats it); `Family = ALL`
  is the per-team uncatalogued catch-all. A legacy (pre-Team-column) sheet is mapped
  on read by `migrateLegacyMatrix_`; the first save rewrites the new schema, and saves
  **merge** over stored blocks so unrendered (team, family) pairs survive.
- **Resolution** (`weightsForEmployee_`), branching on the catalog lookup:
  catalogued title → `matrix[team][family][level]` → family `ALL` cell →
  `blockFillBase_(team, family, base)`; uncatalogued title → team catch-all
  (`ALL`/`ALL`) → `blockFillBase_`; both paths end in a **hard mask** to
  `team.metrics` (`maskToTeamMetrics_`) — R&D / Sales members can never carry
  tracked/planned/RCR weight, even from hand-edited sheet rows.
- **Fill defaults** (`blockFillBase_`): Services natives (JF007/8/9/018), JF004-in-
  Services, and catch-alls inherit the flat base; embedded ops families under Services
  inherit `RND_DEFAULT_W_` (Goals 40/Kudos 20/SI 20/PTO 20 — never re-enables
  tracked/planned/RCR); R&D → `RND_DEFAULT_W_`; Sales → `SALES_DEFAULT_W_` (own
  constant, same seed values, extended in the HubSpot phase).
- **Per-employee weights on the client**: unchanged — `emp.scoreWeights` attaches only
  when the resolved weights differ from the flat base (reference check); base-inherit
  Services natives follow live weight previews via `SCORE_W`.
- **Points by role (2026.W41)**: the page is the **company default strip** + ONE table (no
  definitions — they live in 📖 Documentation; no second table) whose rows **fold open to
  their levels**. Rows come from `familySummaryWeights_` → `resolveBlockWeights_` (level
  cell → block `ALL` cell → `blockFillBase_`, team mask, non-tracking mask — the scorer's
  rule; `metrics` = the role's input cells; `levels[]` = catalog levels with titles, resolved
  weights and an `own` flag when the level carries its own cell). Client: `buildRoleRows_`
  (a family in two teams with equal weights AND levels is one row whose save writes both
  blocks; `varies` when any level's points differ), `renderLevelFold_` (highlights differing
  cells), `swToggle_` / `swToggleAll_` (fold state in `STATE.swOpen`), `renderHowItWorks_`
  (folded four-step note). Org-scoped callers (`DATA.managerScopeName`) get
  `buildScopedRows_`: only the roles/levels their people hold (catalog title, then job-code
  prefix; uncatalogued → "Other job titles" from the team catch-all; crew excluded), with
  headcounts. Editors type rates inline — see "One place to edit" below.
- **One team at a time (2026.W42)**: the table and the Advanced editor show the team the
  dashboard toggle shows (`swTeamKey_()` = `DATA.meta.team.key`; `renderScoringSummary_`
  filters `cfg.sections` to it before `buildRoleRows_`). Services shows its roles and
  levels, R&D its own, Sales & Success its own. The config is fetched once (`MATRIX_CFG`,
  `loadScoringMatrix_(force)`); a team switch re-renders from it, a save or Refresh refetches.
- **Edit rights (2026.W42)**: `canEditScoring_` = superadmin + **orgadmin** (plain admin reads);
  `canEditScoringBase_` = superadmin only (company default). `scoringEditTeams_(access,
  loadRoster)` says WHICH teams — superadmin: all; orgadmin: the teams their org tree holds
  (`resolveManagerScope_` with bridges, own row dropped, `availableTeams_`); shipped as
  `cfg.editTeams`, used by the client's `swCanEditTeam_(cfg)`. `getScoringConfig` narrows an
  org admin's editor payload (sections, matrix, Services audit) to those teams;
  `saveScoringMatrix` refuses a payload naming any other team (whole save, logged). The
  "Other job titles" row never carries inputs (`r.targets` empty). Non-editors get the
  summary payload only (plus `levelCols`). Tests: `tests/scoring-weights-view-checks.js`.
- **One place to edit (2026.W42)** — no Advanced settings fold, no matrix editor, no
  flat-base editor: the page's cells are the inputs. Company default chips (`data-base`,
  super admins only), role cells (`data-row`), level cells inside the fold (`data-row` +
  `data-lvl`, per-level total, "follow role" reset = `swFollowRole_`). `swOnInput_`: live
  totals; a role-row edit flows down to levels that were following it (equal to the row before
  the edit), never to a level tuned on its own. `swPending_` → `saveScoringPage_`:
  `saveWeightSettings` only when the base changed, then `saveScoringMatrix` — row → `ALL` cell
  only when the row changed (inheriting families keep inheriting), level → own cell when it
  differs from the row, cell removed when it matches — then `loadScoringMatrix_(true)`.
  `saveScoringMatrix()` still validates metrics against the team's set, refuses teams outside
  `scoringEditTeams_`, and busts the cache. The team catch-all ("Other job titles") has no
  inputs (`targets` empty).
- **Stays put, resets (2026.W42)**: `renderWeightsTab_` is idempotent — it rebuilds only when
  `data-sw-key` (team · scope · viewAs · edit rights) changes or no config is loaded, because
  `renderAll()` fires on every tab switch / filter / background refresh and a rebuild empties the
  editor. `STATE.swFlash` carries the saved note across the refetch. `swResetDefaults_` (two
  clicks) posts `{}` for every family of every `editTeams` team → everything inherits
  `blockFillBase_`; company default untouched; `swRowCustom_` tags roles with an `ALL` cell.
- Tests: `_test_weightsResolver()` and `_test_matrixMigration()` — GAS editor or Node
  (eval both PS files with a stubbed `Logger`).
