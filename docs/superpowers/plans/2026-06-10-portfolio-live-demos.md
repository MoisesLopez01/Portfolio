# Portfolio Live Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new client-side interactive demos (TCC Impact Simulator, Global Comp Normalizer, Contribution Scoring Engine) plus a tabbed "Try it live" section, a demo registry serving both the section and project modals, and LinkedIn-readiness polish — per the approved spec `docs/superpowers/specs/2026-06-10-portfolio-live-demos-design.md`.

**Architecture:** All work is in `docs/superpowers/gas-portfolio/` — `index.html` (markup, templates, CSS) and `JavaScript.html` (demo modules, registry, boot). Zero server changes; the only server call is the existing `proxyGroqChat`. Demos are container-scoped IIFE modules: `inject(containerEl)` clones a `<template>` into the container and binds events via `containerEl.querySelector`, so the same demo can live in the demos section and an open modal simultaneously. Template internals use **classes, not ids** (cloning duplicates ids).

**Tech Stack:** Vanilla JS + CSS inside GAS HtmlService (no libraries).

---

## Execution status (paused 2026-06-11, 2026.W24)

Executed via subagent-driven development on branch `feature/portfolio-live-demos`.

| Task | Status | Commits |
|---|---|---|
| 1 — DealRiskDemo refactor | ✅ Done | `6a8af3f`, `810c1ab`, `ebbfec9` |
| 2 — Demo registry + badge | ❌ **Not started** (despite Task-3 commit order — verified: no `DEMOS` map, no badge in code) | — |
| 3 — TCC Impact Simulator | ✅ Done | `784a64b` |
| 4 — Global Comp Normalizer | ✅ Implemented + spec review passed; **code-quality review still pending** | `e980a4b`, `6a82e5e` |
| 5 — Contribution Scoring Engine | ❌ Not started | — |
| 6 — Try-it-live section/nav/CTA/pill | ❌ Not started | — |
| 7 — Tests + final verification | ❌ Not started | — |

**Revised execution order** (Task 2's `DEMOS` map references all four demo modules, so it runs after them): 4 → 5 → 2 → 6 → 7. **Resume point: code-quality review of `784a64b..6a82e5e`, then Task 5.**

Task 4 spec-review fixes already applied in `6a82e5e`: zero salary shows "Below band" (not "—"), level change re-derives default salary, dead `fmtLocal` removed.

Reference pattern for new demos: `TccDemo` module in `JavaScript.html` (constants → format helpers → `createInstance(mount)` closure with `refs` via `mount.querySelector` → `inject(containerEl)` capturing `.pm-demo-mount` from the fragment pre-append) + `#tcc-demo-tpl` template in `index.html` (classes only, no ids, no inline handlers, synthetic-data footnote). Commit only the two portfolio files per task — the repo has unrelated dirty files (`Code.gs` JSDoc additions, untracked `projects/`) that are not part of this plan.

---

### Task 1: Refactor DealRiskDemo to container-scoped pattern

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (template `#deal-risk-demo-tpl`, ~line 1568)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (`DealRiskDemo`, ~line 464; `ProjectModal.open` ~line 154; `ProjectModal.close` ~line 160)

- [x] **Step 1: De-id the template.** In `#deal-risk-demo-tpl`, convert all internal `id="pl-*"` / `id="pm-demo-section"` attributes to classes (`class="pl-forecast"`, etc.). Keep the outer wrapper's class `demo-section` and add class `pm-demo-mount`. Replace the inline `onclick="DealRiskDemo.scoreAll()"` on the AI button with nothing (bound in JS).
- [x] **Step 2: Scope the module.** Change `inject()` → `inject(containerEl)`: clone the template into `containerEl`, capture a `refs` object via `containerEl.querySelector('.pl-…')` for every element the module touches, bind the slider `input` and the AI button `click` inside `inject`, and route `renderTable` / `renderSummary` / `update` / `scoreAll` through `refs` instead of `document.getElementById`. Multiple `inject` calls must produce independent instances (move per-instance state like `_aiScores` into the closure created per inject).
- [x] **Step 3: Update modal hooks.** In `ProjectModal.open`, replace `if (p.id === 'ai-sales') DealRiskDemo.inject();` with the registry lookup (Task 2 introduces `DEMOS`; for now keep behavior identical). In `ProjectModal.close`, replace the `#pm-demo-section` removal with removing every `.pm-demo-mount` node inside the modal body.
- [x] **Step 4: Verify.** Open the AI Sales modal — slider and AI button work exactly as before; closing and reopening the modal does not duplicate the demo.

---

### Task 2: Demo registry + modal injection

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html`

- [ ] **Step 1: Registry.** Below the demo modules, define `var DEMOS = { 'ai-sales': DealRiskDemo, 'tcc-forecast': TccDemo, 'comp-reporting': CompNormalizerDemo, 'ps-dashboard': ContribScoreDemo };` (modules from Tasks 3–5; declare the map after all of them).
- [ ] **Step 2: Modal lookup.** In `ProjectModal.open`: `if (DEMOS[p.id]) DEMOS[p.id].inject(document.getElementById('pmodal').querySelector('.pmodal-body'));`
- [ ] **Step 3: Live-demo badge.** In `DomainGrid.renderTile`, when `DEMOS[p.id]` exists append `<span class="tile-demo-badge">▶ Live demo</span>` inside `tile-row1`. Add `.tile-demo-badge` CSS (small pill, domain-agnostic accent) in `index.html`.

---

### Task 3: TCC Impact Simulator (Finance demo)

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (new `<template id="tcc-demo-tpl">` + CSS)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (new `TccDemo` module)

- [x] **Step 1: Template.** Wrapper `.demo-section.pm-demo-mount`, header "💰 TCC Impact Simulator — Cost-Driver Forecast", synthetic-data footnote. Four labeled range sliders (classes `tcc-merit` 0–10 step .5 default 3, `tcc-attr` 0–30 default 12, `tcc-hires` 0–40 default 10, `tcc-promo` 0–15 default 5) each with a live value span. KPI row: baseline TCC, forecast TCC, net delta ($ + %). Waterfall area (`.tcc-waterfall`) and "Top department variance" list (`.tcc-var-rows`).
- [x] **Step 2: Module.** `TccDemo` IIFE with `DEPTS` constant — 8 departments `{ name, hc, avgTcc }` totaling ≈200 heads (Engineering 52/165K, Sales 30/150K, Customer Success 25/110K, Professional Services 28/120K, Marketing 15/125K, Product 18/155K, Support 22/85K, G&A 10/130K). Model per spec: merit = base×m%; promo = hc×p%×avgTcc×0.10; attrition = −hc×a%×avgTcc×0.5; newHire = hires×orgAvgTcc×0.5. Render KPIs, five-segment CSS waterfall (Baseline → +Merit → +Promo → −Attrition → +Hires → Forecast) with labeled bars scaled to the max value, and departments sorted by |delta| (delta excludes new hires, which are org-level). All sliders re-render on `input`.
- [x] **Step 3: CSS.** Waterfall bars (positive teal/negative red), variance rows; reuse existing `demo-*` and `pl-kpi*` styles where they fit.
- [x] **Step 4: Verify.** Defaults produce plausible numbers (baseline ≈ $25M); each slider visibly moves the waterfall; attrition slider can push net delta negative.

---

### Task 4: Global Comp Normalizer (HR demo)

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (new `<template id="comp-demo-tpl">` + CSS)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (new `CompNormalizerDemo` module)

- [x] **Step 1: Template.** Wrapper `.demo-section.pm-demo-mount`, header "🌍 Global Comp Normalizer — Multi-Currency Band Positioning", synthetic-data footnote (FX/COL values are illustrative). Inputs: country `<select>` (`.cn-country`), level `<select>` L1–L5 (`.cn-level`), salary `<input type="number">` (`.cn-salary`) with currency suffix span. Result cards: nominal USD, COL-adjusted USD, compa-ratio. Band strip `.cn-band` with four quartile zones and a position marker `.cn-marker`.
- [x] **Step 2: Module.** `COUNTRIES` constant (~10 entries `{ name, ccy, fx, col }`: US 1/1.00, Canada 1.36/0.92, Mexico 17.1/0.55, Colombia 3900/0.45, UK 0.79/0.98, Germany 0.92/0.90, Poland 4.0/0.60, India 83/0.35, Philippines 56/0.40, Australia 1.52/0.95). `BANDS` per level in COL-adjusted USD (L1 45–65K mid 55K … L5 150–210K mid 180K, monotonically increasing). Math per spec: `nominalUsd = salary / fx`; `colAdjusted = nominalUsd / col`; `compaRatio = colAdjusted / band.mid`; quartile from position in min→max, with "Below band"/"Above band" outside. On country change, set a sensible default salary (≈ band-mid for selected level converted back to local currency) so first render always shows a meaningful result. Marker position clamps to the strip; zone color shifts (below = amber, Q1–Q4 gradient, above = red).
- [x] **Step 3: CSS.** Band strip with quartile segments, marker, result cards.
- [x] **Step 4: Verify.** US + L3 + band mid salary → hand-verified (compa 1.00 @ 48.6% of strip; Colombia COL round-trip OK; zero-salary guard OK) — → compa-ratio ≈ 1.00 in Q2/Q3 boundary; Colombia entry at local mid-band equivalent lands mid-band (COL math works); zero/empty salary input guards (treat as 0, "Below band").

---

### Task 5: Contribution Scoring Engine (Ops demo, flagship)

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (new `<template id="contrib-demo-tpl">` + CSS)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (new `ContribScoreDemo` module)

- [ ] **Step 1: Template.** Wrapper `.demo-section.pm-demo-mount`, header "🏆 Contribution Scoring Engine — Weighted Team Scoring", synthetic-data footnote. Five weight sliders (classes `cs-w-goals` etc., 0–50, defaults **30/30/20/15/5**) with live value spans and a "weights total" readout. Leaderboard `.cs-board` (ranked rows: rank, name, score bar, score). Detail panel `.cs-detail` (hidden until a row is clicked): per-metric bars comparing person vs team average. AI strip: button `.cs-ai-btn` "✨ Generate executive brief" + note span + results div.
- [ ] **Step 2: Module.** `TEAM` constant — 8 synthetic members `{ name, goalsPct, tracked, planned, rcr, kudos }` with varied profiles (a goals star with low hours, an hours grinder with weak goals, a balanced lead, a low performer, etc. — so weight changes visibly re-rank). Normalization per spec: `goalsNorm = goalsPct/100`; `trackedNorm = min((tracked/planned)/0.9, 1)`; `plannedNorm = min(planned/40, 1)`; `rcrNorm = min(rcr/2.5, 1)`; `kudosNorm = min(kudos/3, 1)`; `score = 100 × Σ(wᵢnormᵢ)/Σwᵢ` (guard Σw = 0 → all scores 0). Leaderboard re-renders on slider input with a brief CSS transition for reorder; clicking a row fills the detail panel (individual vs team-average bars for the 5 metrics).
- [ ] **Step 3: AI brief.** `.cs-ai-btn` builds a prompt summarizing the synthetic team's current scores + weights and calls `runServer('proxyGroqChat', [prompt, [], window.SESSION_ID || 'anon'], …)`, rendering the reply as a brief card; error path mirrors DealRiskDemo (amber "key not set" vs red error, demo math unaffected).
- [ ] **Step 4: CSS.** Leaderboard rows + score bars (amber/ops accent), detail comparison bars, AI card.
- [ ] **Step 5: Verify.** Default weights produce a stable ranking; dragging Goals to 0 / Tracked to 50 visibly re-ranks; detail panel matches the clicked person; AI button degrades gracefully without a key.

---

### Task 6: "Try it live" section, nav, hero CTA, chat pill

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html`
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html`

- [ ] **Step 1: Section markup.** Insert `<section id="demos">` between `#projects` (ends ~line 1285) and the project modal/chat. Eyebrow "Try it live", title "Don't take my word for it. Touch the work.", desc with disclaimer: "Four working simulators built from real projects. Synthetic data — everything runs in your browser." Tab bar `.demo-tabs` with 4 buttons (`data-demo` = `ps-dashboard`, `tcc-forecast`, `comp-reporting`, `ai-sales`; Ops first/active) using domain colors amber/blue/purple/teal, and a single mount panel `.demo-tab-panel` (`#demo-panel`).
- [ ] **Step 2: DemosSection module.** New IIFE in `JavaScript.html`: on tab click, clear `#demo-panel` and `DEMOS[key].inject(panel)`; lazily mounts the active (Ops) tab on first scroll into view or on DOMContentLoaded (simplest: mount on DOMContentLoaded). Add `DemosSection.init()` to the boot block (~line 816).
- [ ] **Step 3: Nav.** Add `<li><a href="#demos" class="nav-link"><span class="nav-dot"></span>Live Demos</a></li>` after Projects in `#nav-links` (~line 1207). Confirm `initMobileNav` / `initNavHighlight` pick it up automatically (they iterate `.nav-link`s).
- [ ] **Step 4: Hero CTA.** In `.hero-actions` (~line 1254), add `<a href="#demos" class="btn-ghost">Try the live demos →</a>` after the primary button (keep mailto last).
- [ ] **Step 5: Chat pill.** Replace the "How did you use SuiteQL?" pill (~line 1337) with `What do the live demos show?`.
- [ ] **Step 6: CSS.** `.demo-tabs` / `.demo-tab` (domain-colored active state) / `#demo-panel` spacing, consistent with existing section styling.

---

### Task 7: Dev sanity tests + final verification

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html`

- [ ] **Step 1: `_test_demoMath()`.** Console-runnable function asserting: (a) contribution score for a known synthetic row at default weights matches hand-computed value; (b) TCC waterfall segments sum exactly to forecast − baseline; (c) comp normalizer: salary at band min → Q1, at mid → compa-ratio 1.00, at max → Q4. Log PASS/FAIL per assertion.
- [ ] **Step 2: Cross-instance check.** With the demos section mounted, open each flagship modal — both instances respond independently; close modal — section instance unaffected.
- [ ] **Step 3: Full manual pass.** Each demo: defaults sensible, every input changes output, no console errors; nav link + hero CTA scroll correctly; badges render on exactly 4 tiles; mobile hamburger shows Live Demos.

---

### Out of scope (per spec)

Demos for the other 7 projects; real data; OG/link-preview metadata; admin panel, chat engine, custom-project changes.
