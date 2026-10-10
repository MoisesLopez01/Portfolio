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
- **Points by role (2026.W41)**: the page is ONE table (no definitions — they live in
  📖 Documentation; no second table). Org-scoped callers (`DATA.managerScopeName`) get their
  team's roles by level (`buildLevelRows_`, from `emp.scoreWeights || SCORE_W`), read-only.
  Everyone else: one row per job family, the
  seven metric columns as points out of 100, plus a score-mix bar. Rows come from
  `familySummaryWeights_` (block `ALL` cell over `blockFillBase_`, team mask, non-tracking
  mask; `metrics` = the role's input cells). A family in two teams with equal weights is
  one row whose save writes both blocks. Editors type rates inline (`saveRoleWeights_`
  writes changed rows' `ALL` cells only; level cells untouched). Edit rights:
  `canEditScoring_` = superadmin + admin (org admins read only). Non-editors get the
  summary payload only. Tests: `tests/scoring-weights-view-checks.js`.
- **Advanced editor** (folded under "Advanced settings"; company default has rate inputs, no slider): ⚖️ Scoring Weights → matrix section renders three team separators
  (Services / R&D / Sales & Success) with family blocks placed by active membership
  (`getScoringConfig().sections`) plus a per-team "Uncatalogued titles" catch-all.
  `saveScoringMatrix()` validates metrics against the team's set and busts the cache.
- Tests: `_test_weightsResolver()` and `_test_matrixMigration()` — GAS editor or Node
  (eval both PS files with a stubbed `Logger`).
