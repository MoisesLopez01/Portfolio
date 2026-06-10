# Implementation Plan — Score Weight Settings by Family × Level

**Spec:** `docs/superpowers/specs/2026-06-10-score-weight-settings-by-family-level-design.md`
**Date:** 2026-06-10 (2026.W24)
**Targets:** `PS Contribution Report.js` (GAS backend), `PS Dashboard.html` (frontend)

## Guiding principles for sequencing

1. **Parity first.** Land the backend resolver + engine refactor while the matrix is all-defaults,
   so scores are provably unchanged before any UI exists. Each phase is shippable on its own.
2. **Pure functions before I/O.** `resolveRoleKey_` / `weightsForEmployee_` are pure and unit-tested
   before they touch sheets or the engine.
3. **Fallback is the default path.** Every lookup degrades to `DEFAULT_WEIGHTS_`, so a half-built
   feature still produces today's numbers.

---

## Phase 0 — Constants & catalog source (no behavior change)

**0.1** Add `CONFIG_PS` entries:
- `SCORING_MATRIX_SHEET = "PS Scoring Matrix"`
- `JOB_CATALOG_SHEET = "Job Catalog"`
- `ACTIVE_FAMILIES` = ordered list of the 13 active families with `{code, name}` (JF001, JF003,
  JF004, JF005, JF007, JF008, JF009, JF013, JF014, JF015, JF016, JF017, JF018).
- `ARCHIVED_FAMILIES = ["JF006","JF010","JF011","JF012"]`.
- `LEVEL_COLS = ["I1".."I8","M4".."M10"]` (the matrix column order).

**0.2** Add the company ROLES seed list (from the approved mockup JSON) as a constant
`COMPANY_ROLES_` in `PS Contribution Report.js`, **filtered to active families only**. Each entry:
`{code, role, family, famName, group, track, level}`.

**0.3** Add `roleGroupFor_(roleEntry)` — pure helper implementing §5.1:
- JF009 / JF016 → use source `group` (JF016: anything not People/Talent Acquisition/Administration → People).
- JF007 → `/support/i` → "Customer Support"; `/delivery/i` → "Delivery"; else "Customer Support".
- else → family single-name from `ACTIVE_FAMILIES`.

**Verify:** `roleGroupFor_` unit cases for JF007 intern/exec-director, JF009 trainer, JF016 misc.
Nothing else changes; report output identical.

---

## Phase 1 — Resolver (pure, behind defaults)

**1.1** `readJobCatalog_()` → `Map<normTitle, {family, track, level, levelKey, group}>`
- Read `JOB_CATALOG_SHEET`; if missing, return empty Map (→ everyone falls back to defaults).
- `normTitle = normPS_(JobTitle)`; `levelKey = track + level`.

**1.2** `readScoringMatrix_()` → `{ [family]: { [levelKey]: {goals,…,pto} }, DEFAULT: {…} }`
- Read `SCORING_MATRIX_SHEET`; parse header to map level columns → keys.
- Blank cell → omit the metric (so resolver can inherit). Missing sheet → `{}`.

**1.3** `weightsForEmployee_(emp, matrix, catalog, audit)` — pure, per §6.1:
- title miss → `audit.push({name, jobTitle, reason:"unmapped-title"})`; return `DEFAULT_WEIGHTS_`.
- family/level miss → audit `family-missing`/`level-missing`; return `matrix.DEFAULT ?? DEFAULT_WEIGHTS_`.
- hit → cell with each blank metric filled from `matrix.DEFAULT`, then `DEFAULT_WEIGHTS_`.

**Verify (unit):** title exact/whitespace/case variants; unmapped; family-missing; level-missing;
blank-cell inherit; full hit. Run via a `_test_weightsResolver()` harness logging pass/fail.

---

## Phase 2 — Engine integration (parity-preserving)

**2.1** Change `buildTopPerformers_(employees, weeks, weights)` →
`buildTopPerformers_(employees, weeks, matrix, catalog, audit)`. Inside `.map(e => …)`:
`const W = weightsForEmployee_(e, matrix, catalog, audit)`. Leave the `availW`/`earned` math
**byte-for-byte** otherwise.

**2.2** In `computePSReport_`: read `const catalog = readJobCatalog_()` and
`const matrix = readScoringMatrix_()`; build `const weightAudit = []`; pass to
`buildTopPerformers_`. Add `weightAudit` to the payload (next to `goalsAudit`).

**2.3** Keep `readWeightSettings_()` / `saveWeightSettings()` — repurpose to read/write the
`DEFAULT` block (see Phase 3.3). The single-weights call site in `getPSReportData` is removed in
favor of matrix/catalog, but `weights` stays in the payload as `matrix.DEFAULT` for the existing
Composite-Score docs in the UI.

**Verify (parity):** With **no** matrix/catalog sheets present, every Top-Performer score equals
the pre-change output. Capture a before/after Top-10 list for one week and diff — must be identical.

---

## Phase 3 — Seeding & persistence

**3.1** `seedJobCatalog_()` — write `JOB_CATALOG_SHEET` header + one row per `COMPANY_ROLES_`
entry with `Role Group = roleGroupFor_(entry)`. Idempotent (clear + rewrite). Active families only.

**3.2** `seedScoringMatrix_()` — `base = readWeightSettings_()` (live current weights, else
`DEFAULT_WEIGHTS_`). Write `DEFAULT` block = `base`; for each active family, write 7 metric rows ×
its **actual** levels (levels present in catalog for that family) = `base`. Idempotent. Never writes
archived families. Guarantees day-one parity.

**3.3** `getScoringConfig()` (exported) → `{ matrix, families, levelsByFamily, rolesByFamilyLevel,
metrics: WEIGHT_DEFS-equivalent, audit }` for the editor. `levelsByFamily` lists only levels each
family actually uses; `rolesByFamilyLevel[family][levelKey] = [{group, role, code}]` for the
read-only reference.

**3.4** `saveScoringMatrix(payload)` (exported) — validate keys/metrics, clamp 0–100, write full
matrix back to `SCORING_MATRIX_SHEET`; stamp `lastSaved`; bust the report cache key(s). Returns
`{ok, savedAt}`.

**3.5** One-time bootstrap: a menu/`doGet` guard that calls both seeders if the sheets are absent
(so first deploy creates them from current settings).

**Verify:** Run seeders on a copy; confirm `Job Catalog` row count = active ROLES count, matrix has
13 families + DEFAULT, every cell = current default. Re-run → no duplication.

---

## Phase 4 — Settings-tab editor (frontend)

**4.1** Add an "Scoring Weights by Family & Level" panel in the ⚙ Settings tab (Admin-only; reuse
existing role gate). On load call `getScoringConfig()`.

**4.2** Render a collapsible **section per family** (§6.3):
- Header: `JFxxx · Name (N roles · M role groups)`.
- Read-only "roles at each level" reference rows, sub-labelled by role group; only the family's
  actual level columns shown.
- Editable weights grid: 7 metric rows (from `WEIGHT_DEFS`) × those level columns; numeric inputs.
- Live `Σ / level` row; soft-warn styling when ≠ 100% (no save block).
- Per-family "Reset to default" (copies `DEFAULT` block values into the family's columns).

**4.3** Editable `DEFAULT` ("Company default weights") block at the top.

**4.4** Unmapped-titles audit panel from `config.audit` — lists roster titles missing in the catalog.

**4.5** Save button → `saveScoringMatrix(payload)`; on success toast + reload data (bust cache).

**Verify:** Σ recalcs on input; soft-warn shows; save round-trips and persists; editing a JF009
weight changes only JF009 people's scores; unmapped panel populates for a deliberately bad title.

---

## Phase 5 — Docs & cleanup

**5.1** Update `CLAUDE.md` "Scoring weights" section: weights now Family×Level via `PS Scoring
Matrix` + `Job Catalog`; `DEFAULT` block = company base; resolution/fallback order; seeders.

**5.2** Update the dashboard Data Reference tab note on composite scoring to mention per-family weights.

**5.3** Remove any now-dead single-global-weight code paths flagged during Phase 2 (keep `DEFAULT`
reader/writer).

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Title drift → unmapped people silently default | `weightAudit` + editor panel surface every miss for HR |
| Matrix/catalog sheet hand-edited into a bad shape | Defensive parse → fall back to defaults; never throw |
| Refactor changes scores unintentionally | Phase 2 parity diff gate before any UI |
| Cache serves stale weights after a save | `saveScoringMatrix` busts the report cache keys |

## Definition of done

- All-defaults matrix produces identical Top-Performer scores to pre-change (parity test green).
- HR can edit a family's level weights in-app and in Sheets; changes affect only that family.
- Unmapped titles are visible and default cleanly.
- `CLAUDE.md` and Data Reference updated.
