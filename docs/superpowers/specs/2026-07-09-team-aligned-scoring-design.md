# Team-Aligned Scoring — Services / R&D / Sales & Success

**Date:** 2026-07-09 (2026.W28)
**Status:** Approved design, pending implementation plan
**Files touched:** `PS Contribution Report.js`, `PS Dashboard.html` (matrix editor), `PS Teams.js` (read-only dependency)
**Supersedes:** the "R&D / Sales scoring" and "Per-team editable base weights (rejected)"
decisions in `2026-07-08-org-team-toggle-design.md`, and the family-category model
(Services Team / COE / Non-Contributors) in
`2026-06-10-score-weight-settings-by-family-level-design.md` §contributor-model.

## Problem

The org team toggle (`TEAMS_` in `PS Teams.js`) groups the company by **Class**
(Services / R&D / Sales & Success), each team declaring its own metric set. Scoring,
however, still groups by **job family** (PS families → flat base, JF004 → COE `ALL`
cell, everything else → NONCONTRIB policy). Concretely misaligned:

1. **Sales & Success members inherit the flat base through the COE cell** — 65 points
   of tracked/planned/RCR weight for metrics their team never collects.
2. A PS-family title outside the PS class (R&D team) would inherit flat-base weights
   and score on only ~35 reachable points.
3. The matrix editor's categories (Services Team / COE / Non-Contributors) don't match
   the toggle's groups, and a family that spans two teams cannot be tuned per team.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Resolution model | **Team gates, family tunes** — the employee's resolved team decides which metrics can carry weight (hard mask) and which fill-defaults apply; the family × level matrix cell still tunes within that |
| Sales & Success defaults | Own constant `SALES_DEFAULT_W_`, seeded with the R&D values (Goals 40 / Kudos 20 / SI 20 / PTO 20) so it can diverge and absorb HubSpot metrics later |
| Editor layout | Team separators (no weights on the separator itself) in toggle order; each team's family blocks listed below it, grouped by where **active roster members** sit, showing roles and levels |
| Split families | **Per-team blocks** — the sheet gains a Team column; a family with members in two teams gets independent blocks under each |
| Embedded ops day-one weights | Services-team blocks for non-PS families are **seeded with the non-contributor policy** (Goals 40 / Kudos 20 / SI 20 / PTO 20, tracked/planned/RCR 0); blanks in those blocks inherit the policy, never the flat base |
| Migration | **Evolve in place** — dual-schema reader maps legacy rows on read; first save rewrites the new schema |

## 1. Sheet schema — `PS Scoring Matrix`

New column layout: `Team | Family | Metric | I1…I8 | M4…M10 | ALL`.

- Blocks exist per **(team, family)** pair wherever the family has ≥ 1 active roster
  member in that team. The same family may appear under multiple teams with
  independent weights.
- A block only stores **the team's metric rows**: Services blocks carry all 7
  (`WEIGHT_METRICS_`); R&D and Sales blocks carry `si / goals / kudos / pto`.
  (The reader tolerates extra rows; the resolution mask makes them inert.)
- The `ALL` column is now valid on **any** family block as a block-wide value for
  every level. A specific level cell beats the family `ALL` cell. This generalizes —
  and losslessly migrates — the legacy JF004 "COE" one-cell model.
- Each team gets one **catch-all block** with `Family = ALL` for uncatalogued titles,
  replacing the legacy `SERVICES` and `NONCONTRIB` pseudo-family blocks.
- `lastSaved` footer row unchanged.

## 2. Defaults per team

| Team | Fill-defaults for blank cells |
|---|---|
| `services` | Flat base weights (`readWeightSettings_()`), as today |
| `rnd` | `RND_DEFAULT_W_` — **rename of `NONCONTRIB_DEFAULT_W_`**, same values: Goals 40 / Kudos 20 / SI 20 / PTO 20, rest 0 |
| `sales` | `SALES_DEFAULT_W_` — new constant, seeded with the same four values; extended in the HubSpot phase |

**Services-section nuance (non-contributor guarantee preserved):** within the
`services` team, the fill base depends on the family:

- Native PS families (`JF007/JF008/JF009/JF018`), `JF004`, and the `ALL` catch-all
  fill blanks from the **flat base** (today's behavior — a JF004 seller inside the
  PS class keeps inheriting the flat base unless the `(services, JF004)` block is
  tuned).
- Every other family (embedded ops: Finance, People, Operations, IT, …) fills blanks
  from `RND_DEFAULT_W_` (the policy), **never the flat base** — a reset must never
  re-enable tracked/planned/RCR for these roles. Their `(services, family)` blocks
  are seeded with explicit policy values at migration, so day-one scores are
  unchanged.

A helper `blockFillBase_(teamKey, familyCode, base)` encodes this table and is the
single place the rule lives.

## 3. Resolution — `weightsForEmployee_` v2

```
teamKey = emp.team              // legacy fallback: dept ≠ CONFIG_PS.PS_DEPT → "rnd",
                                // missing both → "services" (unchanged from today)
hit     = Job Catalog lookup (normTitleKey_) → titleCodeInfo_ fallback
cell    = matrix[teamKey][hit.family][hit.levelKey]
        → matrix[teamKey][hit.family]["ALL"]            // block-wide value
        → (uncatalogued) matrix[teamKey]["ALL"]["ALL"]  // team catch-all
weights = fillWeights_(cell, blockFillBase_(teamKey, family, base))
        → maskToTeamMetrics_(weights, teamByKey_(teamKey).metrics)
```

- **Hard mask:** `maskToTeamMetrics_` zeroes any metric outside the team's set, even
  if a hand-edited sheet row carries a weight there. R&D / Sales members can never
  score on tracked/planned/RCR.
- **Reference-check preserved:** a pure-inherit Services-native path returns the
  `base` object itself (no copy), so `computePSReport_`'s
  `if (w !== weights) e.scoreWeights = w` attach and the client's live weight-preview
  behavior (`computeRkScore` using `emp.scoreWeights || SCORE_W`) are untouched.
- **Audit:** `weightAudit` still collects Services-team uncatalogued titles only
  (unchanged scope); R&D / Sales uncatalogued titles are expected and route to their
  team catch-all silently.
- Retirements: `familyCategory_()`, the COE branch, and the NONCONTRIB branch are
  replaced by the flow above. `PS_TEAM_FAMILIES_` and `COE_FAMILY_CODE_` remain
  (used by `blockFillBase_` and `teamForProfile_`). `NONCONTRIB_CODE_` and
  `SERVICES_TEAM_CODE_` survive only in the legacy-migration mapping.

## 4. Migration — evolve in place

`readScoringMatrix_` detects the Team column by header. Return shape becomes
`{ [teamKey]: { [family|"ALL"]: { [levelKey|"ALL"]: { metric: weight } } } }`.

**Legacy sheet (no Team column) maps on read** — scoring is correct immediately,
before any admin opens the editor:

| Legacy block | Becomes |
|---|---|
| `JF007/JF008/JF009/JF018` rows | `(services, family)` |
| `JF004` rows (`ALL` cell) | `(sales, JF004)` **and** `(services, JF004)` |
| Any other family's rows | `(services, family)` **and** `(rnd, family)` — legacy cells applied company-wide, so both copies preserve behavior |
| `SERVICES` / `ALL` | `(services, ALL)` |
| `NONCONTRIB` / `ALL` | `(rnd, ALL)`; also used as the **seed source** for embedded-ops `(services, family)` blocks (fallback: `RND_DEFAULT_W_`) |

**Write path** (`saveScoringMatrix` / `seedScoringMatrix_`) always writes the new
schema. Save **merges the editor payload over the stored matrix**: `(team, family)`
blocks absent from the payload (family currently has no active members in that team,
so the editor didn't render it) are preserved, not dropped. Validation: team key must
exist in `TEAMS_`; family must be an active family code or `ALL`; metric must be in
the team's metric set (rows outside it are dropped on save with a log line).

## 5. Editor — ⚖️ Scoring Weights matrix section (`PS Dashboard.html`)

- Three **separator headers** in toggle order — Services, R&D, Sales & Success —
  showing the team label, active-member count, and its metric set. Separators carry
  no weight cells.
- Under each separator: that team's family blocks — collapsed by default,
  Custom/Inheriting badge, read-only roles & levels reference rows, exactly today's
  block UI — plus the team's "Uncatalogued titles" catch-all block (`ALL` column
  only). Metric rows per block are limited to the team's metric set.
- Families listed under a team = families of **active members** of that team
  (roster-driven, computed server-side). A family spanning two teams renders under
  both, editing independent blocks.
- `getScoringConfig()` payload changes: adds
  `sections: [{ team: {key,label,metrics}, families: [{code,name,count}], catchAll,
  fillDefaults }]` built from the tagged roster + catalog; the `families`(flat),
  `coeFamily`, and `nonContrib` fields retire. `rolesByFamily`, `baseWeights`,
  `unmappedTitles` (Services-only), `levelCols`, `metrics` stay.
- `saveScoringMatrix` payload mirrors the read shape (`matrix[team][family][level]`).

## 6. Error handling

| Condition | Behavior |
|---|---|
| Legacy sheet, no Team column | Mapped on read per §4; no admin action required |
| Unknown team value in a sheet row | Row ignored with a ⚠️ log naming the value |
| Weight on a metric outside the team's set | Zeroed by the mask at resolution; dropped on next save with a log line |
| Family with no active members in a team | Block hidden in the editor but preserved through save (merge) |
| Missing catch-all / defaults | `blockFillBase_` always returns a complete weight object; behavior never regresses below team defaults |

## 7. Testing

- `_test_weightsResolver()` rewritten team-first (Node-runnable, stubbed `Logger`):
  1. Services native, no cell → returns `base` **by reference**.
  2. Services native, partial cell → explicit values win, blanks fill from base.
  3. Family `ALL` cell applies to every level; level cell beats it.
  4. Embedded ops family under `services` → policy fill, tracked/planned/RCR stay 0
     even with a partial cell.
  5. `(services, JF004)` blank-inherits flat base; `(sales, JF004)` fills from
     `SALES_DEFAULT_W_`.
  6. Split family: independent `(services, JF013)` and `(rnd, JF013)` cells resolve
     per member team.
  7. Hard mask: tracked weight hand-set on an `(rnd, family)` row → zeroed.
  8. Uncatalogued per team → team catch-all → team defaults; audit only for services.
  9. Legacy-schema read mapping (each row of the §4 table).
- `_test_teamForProfile()` unchanged.
- Manual QA: matrix editor renders three separators with correct family placement and
  metric rows; save → reload round-trips; Top Rocketeers on R&D/Sales shows no
  tracked/planned/RCR contribution; Services scores byte-identical for native
  families and embedded ops.

## 8. Cache & deploy

- `saveScoringMatrix()` keeps calling `bustReportCache_()` (unchanged).
- Ship with a manual `PS_CACHE_VER` bump: attached `emp.scoreWeights` change for
  R&D / Sales populations and for embedded-ops seeding.

## Out of scope (later phases)

- HubSpot metrics for Sales & Success — will extend the `sales` entry in `TEAMS_`
  and add rows to Sales blocks; `SALES_DEFAULT_W_` gets re-weighted then.
- Per-team **base** weight pages (the flat Scoring Weights section stays global and
  Services-only in meaning).
- Renormalizing masked weights — masking only bites on hand-edited out-of-set rows,
  which are also dropped at save; no renormalization needed.
