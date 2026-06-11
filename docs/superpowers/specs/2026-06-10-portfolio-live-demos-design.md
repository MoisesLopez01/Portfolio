# Portfolio Live Demos — Design

**Date:** 2026-06-10 (2026.W24)
**Project:** `docs/superpowers/gas-portfolio` (Alex López portfolio GAS webapp)
**Status:** Approved by user

## Goal

Make the portfolio LinkedIn-ready by turning it into proof-of-skill: every domain
gets one polished, interactive demo built from real work logic, running on synthetic
data. The demos themselves are the "test for interested people" — recruiters and
hiring managers interact with realistic scenarios instead of reading claims.

## Decisions (user-approved)

1. **Scope:** one flagship demo per domain — 4 total. AI already has the Deal Risk
   Simulator; add Finance, HR, and Ops. Non-flagship projects keep their existing
   code snippet + before/after treatment.
2. **Test concept:** no separate quiz/challenge section. The live demos are the test.
3. **Placement:** both a new "Try it live" page section AND injection into each
   flagship project's modal. One demo codebase, two entry points.
4. **Engine:** pure client-side simulators with synthetic JS datasets. Optional AI
   buttons reuse the existing `proxyGroqChat` server proxy. No new server functions.

## Flagship mapping

| Domain | Flagship project (id) | Demo |
|---|---|---|
| ⚡ AI | AI Sales Analytics Ecosystem (`ai-sales`) | Deal Risk Simulator — **exists**, refactor only |
| 📊 Finance | TCC Financial Forecasting (`tcc-forecast`) | **TCC Impact Simulator** — new |
| 👥 HR | Global Compensation Reporting (`comp-reporting`) | **Global Comp Normalizer** — new |
| ⚙️ Ops | PS Contribution Dashboard (`ps-dashboard`) | **Contribution Scoring Engine** — new |

## Demo specifications

Common rules for all demos:

- Self-contained: synthetic dataset shipped as a JS constant, clearly labeled
  "Synthetic data — runs entirely in your browser. No real company data."
- First meaningful interaction within ~30 seconds, no instructions needed.
- At most one optional ✨ AI button per demo, reusing `proxyGroqChat`; hidden or
  disabled gracefully when no Groq key is configured (same behavior as Deal Risk).
- All numbers update live on input — no "Run" button for the core math.

### 1. TCC Impact Simulator (Finance)

Proves: cost-driver forecasting, attrition proration, department variance analysis
(the story told by the `tcc-forecast` modal and its SuiteQL proration snippet).

- **Synthetic data:** ~8 departments, each with headcount and average annual TCC
  (total org ≈ 200 employees). Plausible SaaS department names (Engineering, Sales,
  Customer Success, PS, Marketing, G&A, Product, Support).
- **Inputs (sliders):**
  - Merit increase % (0–10, default 3)
  - Annualized attrition rate % (0–30, default 12)
  - New hires (0–40, default 10)
  - Promotion rate % (0–15, default 5)
- **Model:**
  - `baseline = Σ(headcount × avgTcc)` per department
  - Merit cost = `baseline × merit%`
  - Promotion cost = `headcount × promoRate% × avgTcc × PROMO_LIFT` (lift constant ≈ 10%)
  - Attrition credit = `−(headcount × attrition% × avgTcc × 0.5)` — the 0.5 factor
    represents average mid-year departure proration (mirrors the partial-month
    proration concept from the real system)
  - New-hire cost = `newHires × org avgTcc × 0.5` (mid-year start proration)
- **Outputs:**
  - KPI row: baseline TCC, forecast TCC, net delta ($ and %)
  - Cost-driver waterfall: Baseline → +Merit → +Promotions → −Attrition → +New hires → Forecast
    (CSS bar segments, no chart library)
  - "Top department variance" list — departments ranked by absolute delta
- **AI button:** none. The waterfall is the payoff; keep this demo AI-free.

### 2. Global Comp Normalizer (HR)

Proves: multi-currency normalization, COL adjustment, band positioning / compa-ratio
(the `normalize_to_usd` snippet made touchable; also echoes the Total Rewards project).

- **Synthetic data:** ~10 countries, each with currency code, FX rate to USD, and a
  COL index (US = 1.00). One synthetic band table per level L1–L5: min/mid/max in
  COL-adjusted USD. FX/COL values are plausible but explicitly synthetic (footnote).
- **Inputs:** country select, level select (L1–L5), annual salary in local currency
  (number input with currency code suffix).
- **Model:**
  - `nominalUsd = salary / fxRate`
  - `colAdjusted = nominalUsd / colIndex`
  - `compaRatio = colAdjusted / band[level].mid`
  - Quartile: position of `colAdjusted` within band min→max mapped to Q1–Q4
    (below min = "Below band", above max = "Above band")
- **Outputs:**
  - Result cards: nominal USD, COL-adjusted USD, compa-ratio
  - Visual band strip: horizontal bar with Q1–Q4 zones and a marker showing where
    the entered salary lands; color shifts by zone
- **AI button:** none.

### 3. Contribution Scoring Engine (Ops) — the flagship of flagships

Proves: weighted composite scoring and team-vs-individual comparison — the core of
the PS Contribution Dashboard (user's proudest work).

- **Synthetic data:** 8 team members (synthetic names) with one week of metrics each:
  goals completion %, tracked hours, planned hours, RCR value, kudos count.
- **Inputs:** five weight sliders — Goals / Tracked / Planned / RCR / Kudos —
  defaulting to the real production weights **30 / 30 / 20 / 15 / 5**. Weights need
  not sum to 100; the composite normalizes by the weight total.
- **Model (mirrors production normalization):**
  - `goalsNorm = goalsPct / 100`
  - `trackedNorm = min((tracked / planned) / 0.9, 1)` — 0.9 ratio threshold for full credit
  - `plannedNorm = min(planned / 40, 1)` — 40 h cap
  - `rcrNorm = min(rcr / 2.5, 1)`
  - `kudosNorm = min(kudos / 3, 1)` — 3 kudos = full credit (demo constant)
  - `score = 100 × Σ(wᵢ × normᵢ) / Σwᵢ`
- **Outputs:**
  - Leaderboard: ranked rows with name, score bar, and score — re-ranks live with
    an animated reorder as sliders move
  - Click a person → detail panel with per-metric bars comparing the individual
    against the team average (the "team level vs individual level" story)
- **AI button:** ✨ "Generate executive brief" — sends the current synthetic team
  stats + weights to `proxyGroqChat` and renders a short narrative summary, echoing
  the real Confluence executive brief feature.

### 4. Deal Risk Simulator (AI) — existing, refactor only

No functional changes. Refactored to fit the registry + container-scoped pattern
below so it can render in both the demos section and the project modal.

## Page placement

- New `<section id="demos">` titled **"Try it live"** inserted between `#projects`
  and `#chat-section`.
- Subtitle includes the disclaimer: *"Four working simulators built from real
  projects. Synthetic data — everything runs in your browser."*
- **Tabbed panel:** 4 tabs labeled with domain icon + short demo name, colored with
  the existing domain colors (teal/blue/purple/amber). One demo visible at a time;
  first tab (Ops — Contribution Scoring Engine) active by default since it is the
  signature piece.
- Nav gets a "Live Demos" link (desktop + hamburger).
- Flagship project cards get a `▶ Live demo` badge.
- Hero gets a "Try the live demos →" secondary CTA scrolling to `#demos`.
- Chat suggestion chips: one chip updated to reference the demos
  (e.g. "What do the live demos show?").

## Architecture

- **Registry:** `var DEMOS = { 'ai-sales': DealRiskDemo, 'tcc-forecast': TccDemo,
  'comp-reporting': CompNormalizerDemo, 'ps-dashboard': ContribScoreDemo }` in
  JavaScript.html. The modal injection hook at the current
  `if (p.id === 'ai-sales') DealRiskDemo.inject()` special case becomes a registry
  lookup: `if (DEMOS[p.id]) DEMOS[p.id].inject(container)`.
- **Per-demo structure:** one `<template id="<demo>-tpl">` in index.html + one IIFE
  module in JavaScript.html exposing `inject(containerEl)`.
- **Container scoping (key refactor):** demos may be mounted in two places at once
  (demos section + an open modal). Modules must NOT use document-level `getElementById`
  for their internals. Each `inject(containerEl)` clones its template into the
  container and binds events via `containerEl.querySelector(...)`, keeping per-instance
  state in a closure object. DealRiskDemo's current `pl-*` global ids are refactored
  to this pattern.
- **Lifecycle:** demos-section instances mount once on page load (lazily on first
  tab activation is acceptable); modal instances mount on modal open and are removed
  with the modal body (existing behavior).
- **No new server code.** The only server interaction is the existing
  `proxyGroqChat` call from the Contribution demo's AI button.

## Error handling

- AI button: same degradation path as Deal Risk — if no key configured, show the
  existing "not configured" notice; on fetch failure, inline error text, demo math
  unaffected.
- Numeric inputs clamp to slider/input ranges; division guards where planned hours
  or FX could be zero (synthetic data never ships zeros, but guards stay).

## Testing

- Manual verification per demo: defaults render sensible numbers; each input visibly
  changes output; modal + section instances work simultaneously without id collisions.
- Sanity assertions in a `_test_demoMath()` dev function (plain JS, runnable in
  browser console): composite score with default weights for a known synthetic row,
  TCC waterfall sums to forecast, comp quartile boundaries (min → Q1, mid → ~1.0
  compa-ratio, max → Q4).
- Cross-check the GAS iframe constraint: everything stays vanilla JS/CSS (no
  external libraries), matching the existing page.

## Out of scope

- Demos for the other 7 projects.
- Any real datasets, exports of company data, or live ERP connections.
- Link-preview/OG metadata for LinkedIn (GAS-hosted pages don't control the
  script.google.com share card; not worth the effort now).
- Changes to admin panel, chat engine, or custom-projects feature.
