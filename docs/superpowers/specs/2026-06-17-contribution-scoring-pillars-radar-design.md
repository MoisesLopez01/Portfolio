# Contribution Scoring Engine — Four Pillars & Radar — Design

**Date:** 2026-06-17 (2026.W25)
**Project:** `docs/superpowers/gas-portfolio` (Alex López portfolio GAS webapp)
**Demo affected:** Contribution Scoring Engine (`ContribScoreDemo`, registry id `Performance-Dashboard`)
**Status:** Approved by user

## Goal

Improve the portfolio's flagship Contribution Scoring Engine demo so it reads as a
**manager's tool for controlling team performance**, using **simple, market-standard
names** for the metrics being evaluated and showing the **logical frame from company
alignment → team → individual contributor → radar**.

Today the demo is a flat leaderboard with five internal-jargon weight sliders (Goals,
Tracked Time, Planned Time, **RCR**, Kudos), a me-vs-team-average bar panel, and an AI
executive brief. A hiring manager would not recognize "RCR". This redesign renames the
evaluated metrics to four manager-facing pillars and replaces the bar panel with a radar.

## Decisions (user-approved)

1. **Scope:** rename + four pillars + per-person radar. (Not a full company→team cascade
   panel — the Company Alignment pillar carries the alignment story.)
2. **Mapping:** drop `RCR`; clean 4:1 — each pillar is fed by exactly one renamed metric.
3. **Employee Health math:** sweet-spot band (healthiest at a full-but-sustainable load;
   penalized for over- *and* under-load), not the current more-is-better rule.
4. **Composite name:** stays "Contribution Score".
5. **Radar:** overlays the team average against the individual (replaces the me-vs-avg
   bars), carrying the team-vs-individual comparison.

## Data model & naming

Drop the `rcr` field from every synthetic row. Four pillars, one metric each:

| Code key | Radar axis (pillar) | Metric label | Raw input |
|---|---|---|---|
| `alignment` | Company Alignment | Goal Attainment | goals % |
| `performance` | Performance | Utilization | tracked ÷ planned |
| `health` | Employee Health | Workload Health | planned hours |
| `recognition` | Recognition | Peer Recognition | kudos |

Slider labels combine pillar + metric, e.g. `Performance — Utilization`.

### Synthetic data

Stay at 8 synthetic members. Re-tune profiles so the stories still separate under the new
pillars and weight changes visibly re-rank. The set MUST include:

- **one over-loaded** member (e.g. ~54h planned) → low Workload Health (burnout signal),
- **one under-loaded** member (e.g. ~24h planned) → low Workload Health (under-utilized),

so the sweet-spot health axis moves visibly. Remaining members spread across goal-stars,
utilization grinders, kudos magnets, balanced leads, and a low performer. The `rcr` field
is removed from each row.

## Scoring math

Four normalizations, each producing 0–1:

- `alignmentNorm   = goalsPct / 100`
- `performanceNorm = planned > 0 ? min((tracked / planned) / 0.9, 1) : 0`  (unchanged utilization; 0.9 ratio = full credit)
- `healthNorm      = max(0, 1 − |planned − 40| / 20)`  (peaks at 40h; reaches 0 at 20h or 60h)
- `recognitionNorm = min(kudos / 3, 1)`  (3 kudos = full credit)

Composite (unchanged shape):

- `score = sumW > 0 ? (100 × Σ(wᵢ · normᵢ) / Σwᵢ) : 0`

Default weights (tunable; need not sum to 100):
**Company Alignment 30 · Performance 35 · Employee Health 20 · Recognition 15.**

Team average norm per pillar is computed once (weight-independent) and used by both the
team summary strip and the radar overlay.

## UI — manager's control view

- **Four weight sliders**, each labeled pillar + metric (e.g. "Employee Health — Workload
  Health"), with its live numeric value and the weight total.
- **Team summary strip** at the top: team-average score per pillar as a small KPI row —
  the team level the manager is tuning.
- **Leaderboard**: unchanged behavior — live animated re-rank as sliders move; each row
  shows rank, name, score bar, and composite score.
- **Individual radar panel** (replaces the current me-vs-avg bars): clicking a leaderboard
  row opens a panel with an inline **vanilla SVG 4-axis radar**. Two overlaid polygons —
  the selected individual (solid fill) and the team average (dashed outline). Raw metric
  values (goals %, tracked/planned, planned h, kudos) are listed beside the radar.
- **No chart library**: the radar is hand-drawn SVG (axis lines, ring grid, two polygons),
  consistent with the existing all-vanilla page and the GAS HtmlService iframe constraint.

## AI executive brief

Keep the ✨ "Generate executive brief" button and its `proxyGroqChat` call. Update the
prompt so the four pillar names (Company Alignment, Performance, Employee Health,
Recognition) and weights are passed, so the narrative speaks the manager's language
("at-risk on Employee Health", etc.). Same graceful degradation: "not configured" notice
when no Groq key is set; inline error on fetch failure; demo math unaffected either way.

## Architecture / non-functional

- Preserve the per-instance, container-scoped `inject(containerEl)` pattern. The demo can
  mount in both the `#demos` tab and an open project modal at once — all DOM lookups stay
  `mount.querySelector(...)`, state in the closure. No document-level ids.
- The SVG radar must also be container-scoped (no shared ids); generate its geometry from
  the four norms in JS.
- No new server functions. Only existing `proxyGroqChat` is used.
- Registry id stays `Performance-Dashboard` → `ContribScoreDemo`.

## Error handling

- Division guard where planned hours could be zero (synthetic data never ships zeros, but
  guards stay): `performanceNorm` returns 0 when `planned === 0`.
- Numeric weights clamp to slider ranges; weight total of 0 → all scores 0 (existing
  behavior, surfaced in the total label).
- AI button degradation path unchanged (see above).

## Testing

Update `_test_demoMath()` (plain JS, runnable in browser console):

- Sweet-spot health boundaries: `planned = 40 → 1.0`; `planned = 20 → 0`; `planned = 60 → 0`;
  `planned = 30 → 0.5`.
- Composite score with default weights for a known synthetic row.
- Radar polygon point math: four norms map to the expected x/y coordinates on the SVG.
- Manual: defaults render sensible numbers; each slider visibly re-ranks; clicking a row
  opens the radar with both polygons; modal + section instances run simultaneously with no
  id collisions.

## Out of scope

- A separate company→team→IC cascade panel (Company Alignment pillar covers alignment).
- Changes to the other three demos (TCC, Comp Normalizer, Deal Risk).
- Any real datasets or server-side changes beyond the existing `proxyGroqChat`.
- Reintroducing `RCR` or the SI/PTO metrics from the production scoring model.
