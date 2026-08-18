# CompDash V4 — Comp Decision-Maker Upgrade (design)

**Date:** 2026-07-28 (2026.W31) · **Files:** `CompDash/Code.js`, `CompDash/ViewDash.html`, `CompDash/Security.js`
**Driver:** make the dashboard a first-class helper for managers / directors / CEO making salary-adjustment
and promotion decisions — no duplicated work for the equity decision maker. Market compa ratio stays the
backbone; everything below is additive and deterministic (no AI). Leadership-behaviors principle carried
from PROCESS §7: signals **surface people for a human conversation, never re-score them automatically**.

## Phase 1 — Decision signals (data already in the payload)

New config (CONFIG_CD):

```js
SIGNALS: {
  perfWindowQuarters: 4,      // SI ratings window: last N COMPLETED fiscal quarters
  promoStaleYears: 3,         // no promotion/title-change event in ≥ N years = stale
  earlyCareerRe: /^I[123]$/,  // early-career lens (levels 2–3 emphasis per exec ask)
  coreLevelRe: /^I[34]$/,     // core mature cohort at comp-driven flight risk
  recogMinRating: 4.5,        // "excellent performer" floor — latest completed-quarter rating
  recogMaxTtm: 0.05,          // TTM TCC growth under 5% + excellent rating = recognition risk
  riskFactorMin: 2,           // retention flag needs ≥ N concurrent factors
}
```
All echoed to the client via `meta.signalsCfg` (threshold-echo rule — UI never hardcodes).

1. **SI window = last 4 completed fiscal quarters.** `lastCompletedQuarters_(ctx, n)` derives labels
   (e.g. today FY27Q1 → `["FY26Q1","FY26Q2","FY26Q3","FY26Q4"]`). `buildPerfForEmp_(rows, windowFqs)`
   keeps full `history` but computes `avg`/`count` over the window only (`totalCount` preserved).
   Priority Score consumes the windowed avg; no ratings in-window → component drops out (partial °),
   never a stale all-time average and never a fake zero.
2. **Promotion staleness.** Per employee: `everPromoted` (any PROMO_RE event) and
   `promoStale` = `tenureProfileYears ≥ promoStaleYears` (in-role clock already falls back to hire date).
   `earlyCareer` flag from `earlyCareerRe`.
3. **Recognition risk.** `perfWindowLatest ≥ recogMinRating` AND `ttmGrowthPct != null` AND
   `ttmGrowthPct < recogMaxTtm` → dissatisfaction signal ("excellent quarter, <5% increase").
4. **Retention-risk cohort (core levels).** For `coreLevelRe` actives, count factors:
   below-target internal position (`ratio < compaBands.target`), below market (`marketRatio < MARKET_LOW`),
   `promoStale`, `recognitionRisk`. `retentionRisk` = factors ≥ `riskFactorMin`; `riskFactors[]` carried
   for chips. Deterministic and explainable — every flag lists its factors.

Payload: `emp.signals = { everPromoted, promoStale, earlyCareer, coreLevel, recognitionRisk,
retentionRisk, riskFactors }`. Verdicts added: `promo-stale`, `recognition-risk`, `retention-core`
(view `signals`, counts only). Exec strip gains a "N retention risks" chip.

UI: new tab **🚨 Risk Signals** (admin+viewer) with verdict lines and three drill-through tables —
promotion staleness (early-career rows badged), recognition risk, core-level retention cohort with
factor chips. Drill panel gains signal chips. Ranking tooltip documents the 4-quarter window.

## Phase 2 — Restricted profiles + part-time/EOR

1. **Restricted cohort** (CEO/chiefs/VPs/directors — "top records"):
   `RESTRICTED: { titleRe: /\b(chief|ceo|cfo|coo|cto|president|vice president|vp|director)\b/i,
   minMLevel: 9 }` + Script Properties `CD_RESTRICTED_EXTRA` (comma emp numbers) and
   `CD_RESTRICTED_VIEWERS` (emails allowed to see restricted rows besides admins).
   Security returns `canSeeRestricted`; **stripping is server-side** in `getCompReportData` —
   `stripRestricted_(payload)` (pure, Node-tested) removes restricted people from `employees`,
   `people`, `compaGroups[].members`, `equity` flag rows, `qtaInterim`, `attrition.detail`, `history`.
   Aggregates/anchors/verdicts stay full-population (counts, never names). `meta.restricted =
   { hidden: n }` renders a one-line notice so a viewer knows the payload is deliberately partial.
   Cache stores the FULL payload once; stripping happens per serve after role echo.
2. **Employment type** (optional roster column, header-resolved `Employment Type` / worker-type regex):
   - **EOR → regular** in every engine (explicit rule, documented in Data Reference).
   - **Part-time → discrete non-comparability**: excluded from anchor evidence (medians), from being
     ratio-scored, from equity lenses and market suggestions (suggestion status `part-time`); stays in
     headcount/attrition/QTA. UI shows a muted `PT` chip where a band would render — no red badge a
     part-timer hasn't earned. `meta.employmentTypeAvailable` degrades gracefully when the column is absent.

## Phase 3 — Contribution snapshot join (PROCESS §7 resolution)

Snapshot-sheet plumbing (frozen evidence, per §7.4): tab `Contribution Snapshot` in the contribution
data file (`CD_CONTRIB_SNAP_SS_ID` override; default = ratings file). Schema (header-resolved, one row
per employee × quarter): `Quarter | Employee Number | Name | Team | Contribution Score | Goal Compliance |
Goals Met | PTO Compliance | Tracked Coverage | RCR | Kudos | Snapshot Date`.

- **Writer:** `exportContributionSnapshot()` (PS side) appends the just-closed quarter rows from the PS
  contribution model — run at cycle open; existing quarter rows are replaced, never duplicated.
- **Reader:** `readContribSnapshot_()` in CompDash joins the latest quarter by Employee Number;
  `meta.sources.contribution` + quarter label surfaced.
- **Drawer evidence block** "Contribution — <quarter> snapshot": goal compliance, PTO compliance,
  tracked coverage, RCR (Services only — blank never renders as zero), kudos w/ program-underuse caveat.
- **Check L — invisible contributor flag:** contribution score present & high (≥ configurable pct of
  team scale) AND comp-visible inputs weak (windowed SI < 4 or unrated) → `signals.invisibleContributor`,
  listed on 🚨 Risk Signals as a verification trigger (Check K spirit: absence of evidence ≠ absence of
  contribution). Not a Priority Score input until GTT-35 standardizes points.

## Phase 4 — Theme + Data Reference

1. **Light/dark toggle.** Semantic vars already exist; add `:root[data-theme="light"]` overrides built
   from COMPANY_COLORS (cream bg, void-blue text, white panels, ivory borders; status colors re-tuned
   for contrast on light). Banner colors move to vars. ☀/🌙 header toggle persists to
   `localStorage.cd_theme`; default stays dark. SVGs inherit via `var(--…)` automatically.
2. **Data Reference modernization.** One monolith card → sectioned modern layout: source cards with
   status dots, formula accordion (`details`), glossary grid, thresholds table with provenance +
   in-page section chips. Content unchanged (all still interpolated from meta echoes).

## Deploy (single deploy at the end)

Paste `Code.js` + `ViewDash.html` + `Security.js` → run `debugCompPipeline()` (new log lines: employment
type, restricted count, signals counts, snapshot join) → `bustCompCache_()` (payload shape changes) →
**new deployment version**. Optional properties: `CD_RESTRICTED_EXTRA`, `CD_RESTRICTED_VIEWERS`,
`CD_CONTRIB_SNAP_SS_ID`, `CD_SIGNALS_CFG` (JSON override, ragCfg_-style).

## Deferred (roadmap)

Services acceleration simulator (3-year, 6/9/6/9/6/9-month horizons, user-input rate — client-side
what-if view) and base/STF distribution per job level (blocked on STF data) go to the roadmap backlog.
