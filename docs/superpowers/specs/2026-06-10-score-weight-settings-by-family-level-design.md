# Score Weight Settings by Family × Level — Design Spec

**Date:** 2026-06-10 (2026.W24)
**Author:** Moises Lopez (PS analytics lead)
**Status:** Approved for planning
**Affects:** `PS Contribution Report.js`, `PS Dashboard.html`, two new Google Sheets

---

## 1. Goal

Replace the single global scoring-weight set with **per-job-family, per-level** weights, so each
team is evaluated on the metrics that matter to it — fairly, across the whole company. HR or
admins maintain it as a clean table. For now every family is seeded to today's default weights,
so behavior does not change until someone deliberately tunes a family.

The PS dashboard scores only PS employees today, but the configuration is built **company-wide**
so other dashboards can adopt it later.

---

## 2. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Weight granularity | **Family × Level** (`I1–I8`, `M4–M10` per job family) |
| 2 | Employee → level mapping | Roster `Job Title` → **Job Catalog lookup** → `(family, track, level)`; normalized match; unmapped → default weights + diagnostics |
| 3 | Storage / editing | **Google Sheet of record** (HR-editable) + **Admin-only matrix editor** in the dashboard ⚙ Settings tab |
| 4 | Missing-data behavior | **Keep dynamic `availW` renormalization**; 100%/column is a **soft warning**, not a hard gate |
| 5 | Relationship to existing weights | **Inherit-with-override** — person's weights = their family×level cell, else `DEFAULT_WEIGHTS_`; seed full company catalog to today's defaults |
| 6 | Metrics | **The existing 7** (`goals, tracked, planned, rcr, kudos, si, pto`); no new metrics, no new normalization |
| 7 | Roles vs weight keys | **Groups are display-only.** Weights are Family×Level; role groups only organize the read-only "who's at each level" reference |

---

## 3. Architecture & data flow

```
┌─ Job Catalog sheet ─┐      ┌─ PS Scoring Matrix sheet ─┐
│ title → family,     │      │ family × level × metric    │
│ track, level, code, │      │ weights (seeded=defaults)  │
│ role group          │      │                            │
└─────────┬───────────┘      └──────────────┬─────────────┘
          │ readJobCatalog_()               │ readScoringMatrix_()
          ▼                                  ▼
   resolveRoleKey_(jobTitle) ─► {family, levelKey}     DEFAULT_WEIGHTS_ (base fallback)
          │                                  │                 │
          └──────────────┬───────────────────┴────────┬────────┘
                         ▼                             ▼
              weightsForEmployee_(emp, matrix, catalog) ─► { goals, tracked, … }  (per person)
                         │
                         ▼
              buildTopPerformers_  (per-person weights replace one global W)
```

- **Resolution order per employee:** `Job Title` → catalog → `(family, levelKey)` → matrix cell
  (blank metric inherits from `matrix.DEFAULT`) → else `matrix.DEFAULT` → else `DEFAULT_WEIGHTS_`.
  Any miss at any step falls back to defaults, so the dashboard never regresses below today.
- Both sheets are read once per report build (alongside roster/RCR/etc.) and ride the existing
  5-minute report cache.
- The Settings-tab editor reads via `getScoringConfig()` and writes via `saveScoringMatrix()`,
  mirroring the existing `readWeightSettings_` / `saveWeightSettings` pattern.

---

## 4. Sheet schemas

### 4.1 `Job Catalog` (HR-maintained title → level lookup; seeded from the company ROLES list)

| Job Title | Code | Family | Family Name | Track | Level | Role Group |
|---|---|---|---|---|---|---|
| Senior Consultant I, Service Delivery | 09.I4.1 | JF009 | Service Delivery | I | 4 | Technical Consulting |
| Senior Engineer I, Service Delivery | 09.I4.3 | JF009 | Service Delivery | I | 4 | Service Delivery |
| Associate, Solution Architecture | 18.I2.1 | JF018 | Solution Architecture | I | 2 | Solution Architecture |

- **Match key** = `normPS_(Job Title)` (lowercase, collapse whitespace, trim) — the normalization
  already used everywhere for name joins.
- `Code` is informational/auditable. Functional fields for scoring: **Family + Track + Level**.
- `Role Group` is **display-only** (Section 6.2); it does not affect weight selection.
- Archived families (JF006/010/011/012) are **never written**.

### 4.2 `PS Scoring Matrix` (the weights — mockup orientation, per-family blocks)

| Family | Metric | I1 | I2 | I3 | I4 | I5 | I6 | I7 | I8 | M4 | M5 | M6 | M7 | M8 | M9 | M10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEFAULT | goals | 30 | 30 | … | | | | | | | | | | | | |
| DEFAULT | tracked | 30 | … | | | | | | | | | | | | | |
| … (7 metric rows) | | | | | | | | | | | | | | | | |
| JF009 | goals | 30 | 30 | 30 | 30 | … | | | | | | 25 | | | | |
| JF009 | tracked | 30 | … | | | | | | | | | | | | | |
| … (7 metric rows per family) | | | | | | | | | | | | | | | | |

- Level columns use the combined `track+level` key (`I4`, `M6`) so IC and Manager at the same
  number stay distinct.
- **`DEFAULT`** is a reserved family block holding the editable company base weights — it replaces
  the role of the current global sliders.
- A **blank cell** = "inherit from `DEFAULT`" for that metric. Seeding fills every cell so the grid
  is fully populated day one (the "all roles = defaults" requirement), but the resolver still treats
  blank as inherit for robustness.

---

## 5. Active families & role-group model

Active set = **13 families**. Archived and ignored entirely: **JF006, JF010, JF011, JF012**.
IC vs Manager separation is preserved on every family.

| Family | Name | Role Groups (display-only) |
|---|---|---|
| JF001 | Marketing | Marketing |
| JF003 | Analytics | Analytics |
| JF004 | Sales and Success | Account Management |
| JF005 | Partner Success | Partner Success |
| JF007 | Managed Services & Support | **Customer Support**, **Delivery** |
| JF008 | Training & Customer Education | Training & Customer Education |
| JF009 | Service Delivery | **Technical Consulting**, **Service Delivery** |
| JF013 | Finance | Finance |
| JF014 | Legal & Compliance | Legal & Compliance |
| JF015 | Operations | Operations & Strategy |
| JF016 | People | **People**, **Talent Acquisition**, **Administration** (any other group → People) |
| JF017 | Information Technology | IT Operations |
| JF018 | Solution Architecture | Solution Architecture |

### 5.1 Role-group assignment rules (applied at catalog seeding)

- Default: Role Group = the family's single name (above).
- **JF009**: use the source `group` field — `Technical Consulting` vs `Service Delivery`.
- **JF016**: use the source `group` — `People`, `Talent Acquisition`, `Administration`; anything
  else collapses to `People`.
- **JF007**: source data groups everything as "Managed Services & Support", so split by title
  keyword — `/support/i` → **Customer Support**; `/delivery/i` → **Delivery**; otherwise (e.g.
  "Intern, Managed Services", "Executive Director, Managed Services") → **Customer Support**
  (default bucket). Because groups are display-only, edge bucketing has no scoring impact.

---

## 6. Components

### 6.1 Resolver (backend, pure & testable)

- `readJobCatalog_()` → `Map<normTitle, {family, track, level, levelKey, group}>` where
  `levelKey = track + level` (e.g. `"I4"`).
- `readScoringMatrix_()` → `{ JF009: { I4: {goals,…,pto}, … }, …, DEFAULT: {…} }`.
- `weightsForEmployee_(emp, matrix, catalog)`:
  1. `hit = catalog.get(normPS_(emp.jobTitle))`
  2. if no hit → push to `_weightAudit` (reason `unmapped-title`), return `DEFAULT_WEIGHTS_`.
  3. `cell = matrix[hit.family]?.[hit.levelKey]`; if family/level missing → audit
     (`family-missing` / `level-missing`), return `matrix.DEFAULT ?? DEFAULT_WEIGHTS_`.
  4. return `cell` with any blank metric filled from `matrix.DEFAULT` (then `DEFAULT_WEIGHTS_`).

### 6.2 Scoring-engine integration (`buildTopPerformers_`)

Today the function closes over one global `W`. Change:

- `computePSReport_` reads `matrix` + `catalog` and passes them to `buildTopPerformers_`
  (instead of the single `weights` object).
- Inside the `.map(e => …)`, compute `const W = weightsForEmployee_(e, matrix, catalog)` per
  employee. **The `availW` renormalization math is untouched** — the missing-data fairness rule
  (Decision 4) still holds, now with per-person weights.
- Surface `_weightAudit` in the report payload like the existing `goalsAudit`.

`readWeightSettings_()` / `saveWeightSettings()` remain only as the reader/writer for the
`DEFAULT` block (back-compat); the legacy flat `PS Settings` sheet is migrated into the
`DEFAULT` block of `PS Scoring Matrix` on first seed.

### 6.3 Settings-tab editor (Admin-only, organized by family)

A vertical list of **collapsible family sections**, driven by the Job Catalog so it always reflects
live roles:

```
▼ JF009 · Service Delivery               (32 roles · 2 role groups)
   Roles at each level  (read-only, from catalog)
            I2          I3            I4                     …  M6
   Roles    Associate,  Consultant,   Sr Consultant I,          Director,
   (TC)     Technical…  Technical…    Sr Consultant I (Trainer) Service…
   Roles    Associate   Engineer,     Sr Engineer I,
   (SvcDel) Engineer…   Designer…     Sr Designer I…
   ───────────────────────────────────────────────────────────────
   Scoring weights  (editable, metric rows × level columns)
   Goals     30          30            30                    …  25
   Tracked   30          30            30                       15
   …
   Σ / level 100%        100%          100%                     100%   (soft-warn if ≠100)

▼ JF018 · Solution Architecture          (12 roles · 1 role group)
   … only levels JF018 actually uses (I2–I8, M4–M8) are shown …
```

- Only levels a family **actually has roles at** are shown (e.g. JF014 shows just its 2 columns).
- Role groups (Section 5) sub-label the read-only reference rows.
- Each family section has its own "Reset to default" and a live Σ/level row (soft warn ≠ 100%).
- The `DEFAULT` block is editable at the top as "Company default weights".
- Save writes the full matrix via `saveScoringMatrix()`; an unmapped-titles audit panel lists
  roster titles not found in the catalog (HR fix-it queue).

### 6.4 Seeding

- `seedScoringMatrix_()` — one-time/idempotent. Compute `base = readWeightSettings_()` (the live
  current weights, or `DEFAULT_WEIGHTS_` if none). Write the `DEFAULT` block = `base`, and every
  active family × its actual levels = the **same** `base`, so on day one every cell equals today's
  effective weights and scores are provably unchanged (Section 8 parity test). Never writes
  archived families.
- `seedJobCatalog_()` — writes the active-family ROLES list with computed Role Group (Section 5.1).

---

## 7. Edge cases & fallback

| Situation | Behavior |
|---|---|
| Roster Job Title not in catalog | Default weights · listed in `_weightAudit` (`unmapped-title`) |
| Family in catalog, absent from matrix | Default weights · audited (`family-missing`) |
| Level present in roster, missing from family block | Default weights · audited (`level-missing`) |
| Blank metric cell | Inherits from `DEFAULT` block, then `DEFAULT_WEIGHTS_` |
| Column sums ≠ 100% | Allowed (soft warn); `availW` still renormalizes |
| All-zero column | Person scores 0 on those metrics; soft-warned in editor |
| Crew members | Already excluded from scoring (unaffected) |
| Ramp-up employees | Already excluded from Top Performers (unaffected) |

---

## 8. Testing

- **Unit (pure functions):**
  - `resolveRoleKey_` — exact title, whitespace/case variants, unmapped title.
  - `weightsForEmployee_` — override hit, family-missing, level-missing, blank-cell inherit.
- **Parity (no-regression):** with an all-defaults matrix, every Top-Performer score must equal
  today's output **exactly** — proves the refactor is behavior-preserving until a family is tuned.
- **Editor:** Σ/level recalculation, soft-warn rendering, save round-trip, unmapped-titles panel.

---

## 9. Out of scope (future)

- Group × Level weighting (finer than Family × Level).
- Adding brand-new metrics (would require new normalization functions).
- Adopting the config in non-PS dashboards (catalog/matrix are built company-wide to enable this,
  but wiring other dashboards is separate work).
- Adding a `Job Code` column to the roster (cleaner long-term join key than title matching) — a
  worthwhile later hardening, but this design intentionally relies on title→catalog matching.

---

## 10. File-by-file change summary

**`PS Contribution Report.js`**
- New: `readJobCatalog_()`, `readScoringMatrix_()`, `resolveRoleKey_()`, `weightsForEmployee_()`,
  `seedScoringMatrix_()`, `seedJobCatalog_()`, `getScoringConfig()`, `saveScoringMatrix()`.
- Change: `buildTopPerformers_(employees, weeks, matrix, catalog)` computes per-employee weights;
  `computePSReport_` reads + passes matrix/catalog; payload gains `weightAudit`.
- Keep: `DEFAULT_WEIGHTS_`, `readWeightSettings_`/`saveWeightSettings` (now scoped to `DEFAULT`).

**`PS Dashboard.html`**
- New family-organized matrix editor in the ⚙ Settings tab (reuses `WEIGHT_DEFS` for metric rows).
- Unmapped-titles audit panel.
- Reads `getScoringConfig()`, writes `saveScoringMatrix()`.

**New sheets:** `Job Catalog`, `PS Scoring Matrix` (created by the seed functions).
