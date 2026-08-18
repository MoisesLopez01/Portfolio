# CompDash V3 — Exec Feedback Absorption (Design)

**Date:** 2026-07-27 (2026.W31)
**Target:** `CompDash/Code.js`, `CompDash/ViewDash.html`, `CompDash/tests/` — plus one roadmap markdown doc.
**Status:** Approved design, pre-implementation.

## Context

Exec feedback (Rob/Forest) was written against the WorkforceReport ("Global Compensation Health Report"), a linear text report. Decision: **CompDash absorbs the feedback** and becomes the exec-facing visual comp health dashboard (V2 → V3). WorkforceReport remains a separate written report, untouched by this effort.

Data check resolved during design: termination-analysis (`C:\Users\moise\gas-projects\termination-analysis`) writes into the **same spreadsheet** CompDash reads as roster (`1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0`, tab `Data`), and that tab carries a `Supervisor` column plus `Termination Category` / `Termination Reason`. The manager field the feedback asked to verify **exists**; CompDash's reader just doesn't consume it yet.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Target artifact | CompDash absorbs feedback (WorkforceReport untouched) |
| Structure | **Additive V3** — current tabs kept, one new 👤 Managers tab; no themed restructure (execs parked it) |
| Callouts | **Rule-based deterministic verdict engine** — no AI/LLM anywhere in CompDash (unchanged posture) |
| Scope | Adapted "Actioning Now" list + two quick wins from termination-analysis (financial impact, attrition forecast) |
| Managers view layout | Table-first: verdict line (counts only, never names) + sortable RAG table |
| Overview exec strip | Verdict paragraph + click-through RAG chip row |
| Thresholds/benchmarks | Config-driven (`CONFIG_CD` + `CD_*` property overrides), seeded from cited research (below) |
| Confluence roadmap | **Draft only** — markdown in repo; user publishes to Confluence |

## 1. Data layer (Code.js)

All new computation is server-side, on rows already loaded by the existing roster reader. No new spreadsheets, no cross-project calls — termination-analysis logic is **reimplemented** as pure functions, not imported.

### 1.1 Supervisor read
Roster reader resolves a `Supervisor` header on the `Data` tab (same header-resolution pattern as `TCC USD`). Missing column → `managers: { available: false }` on the payload; nothing throws.

### 1.2 New payload blocks
- **`managers`** — `{ available, rows[], pooledSmallTeams, spanOfControl }`.
  - `rows[]`: one per supervisor with **≥ 3 active reports**: `{ name, teamSize, exitsFY, voluntaryExits, attritionRate, dept }`. Rate = FY exits ÷ average team headcount over the FY window (same FY framing as the existing attrition block). Worst-first server sort.
  - `pooledSmallTeams`: single aggregate row for all supervisors with < 3 reports (sample-size rule), same fields.
  - `spanOfControl`: `{ managers, ics, ratio, target }` — manager = anyone appearing as an active employee's Supervisor; target from config.
- **`attrition.byExitLocation[]`** — leavers grouped by Key Location: `{ location, exits, voluntary, rate, band }` — mirrors existing dept/level cut shapes.
- **`attrition.financialImpact`** — `{ annualPayrollReleasedUsd, regrettedPortionUsd, coverage: {counted, total} }`. Method: leaver TCC USD ÷ 12 × months remaining in FY at exit; rows without TCC USD are skipped and reported via `coverage`, never zero-filled (coverage-counter pattern from ServicesFinancial).
- **`attrition.forecast`** — `{ months[], annualizedRate, method }` — trend + seasonal-factor projection to fiscal year-end, port of termination-analysis `applyForecasting` reduced to attrition counts. **Guard: requires ≥ 6 actual FY months, else block omitted.**
- **`verdicts[]`** — see §2.
- **`meta` additions** — `ragCfg` (all thresholds below), `benchmarks` (peer bands + source citation strings), `glossary` (term → definition entries).

Cache: payload shape changes ⇒ deploy requires `bustCompCache_()` (`CD_CACHE_VER` bump).

## 2. Verdict engine (rule-based callouts)

`buildVerdicts_(model, cfg)` — pure, deterministic, server-side, full-population only (client filters never recompute verdicts, matching the existing rule that anchors/equity medians don't move under filters).

- **Rule registry**: each rule = `{ id, view, severity(fn), condition(fn over aggregates), fact, soWhat, action, caveats }`. Templates are string builders over aggregate numbers — same data in, same words out.
- **Output**: `{ id, view, severity: FACT|NOTE|RISK, text: {fact, soWhat, action}, caveat? }`. Every verdict must at minimum answer the "so what"; `action` is present where a recommended action exists (the feedback's completion test).
- **Sample-size guard** (applies to every rate-based rule): denominator below floor (default: < 10 heads or < 3 exits) ⇒ severity capped at NOTE + "too few to read" caveat appended. This is what keeps FY27's 2-exit 0.9% from rendering as a green success story.
- **No-names rule**: verdict lines carry counts only ("2 of 14 managers above 30%"), never individual names — names live in tables/rows.
- **Initial rule set** (~12 rules): headcount stability; total attrition vs RAG + peer band; voluntary attrition vs peer band; regretted share band; department exit concentration (top-2 dept share of exits); manager hotspots (count above red line); span of control vs target; inversion flags (existing compa data) with HRBP-review action; equity outlier count (existing equity block); trends & drivers (dominant exit reasons → comp / role-design / labor-market classification via reason-category map in config); financial impact framing; small-sample caveat rules for FY-in-progress.
- Missing input block (e.g., forecast omitted, managers unavailable) ⇒ dependent rules emit nothing — never a wrong sentence.

## 3. Views (ViewDash.html)

### 3.1 Overview — exec TL;DR strip
Top of pane, above the existing 6 KPI cards. (a) **Verdict paragraph**: top-severity verdicts assembled in fixed order — headcount → attrition vs benchmark → regretted → inversions → equity → data caveats. (b) **RAG chip row**: one chip per headline metric (status dot + value + trend arrow — direction vs the same period of the prior FY; no arrow when the prior-FY basis is under the sample-size floor), each a `switchTab()` click-through to its home view. Reuses existing chip styling; status colors stay semantic (green/yellow/red, non-brand), theme untouched.

### 3.2 👤 Managers — new tab
New `VIEWS` entry (admin + viewer, like other tabs). Layout: verdict line on top, then sortable table — Manager | Team size | FY exits | Voluntary | Team attrition (RAG dot + %) | Department — worst-first default. "Small teams" pooled row pinned at bottom with caveat chip. Span-of-control line under the table ("1:X vs 1:6 target"). Row click opens the existing employee drill filtered to that supervisor's team. **No TCC columns** — retention lens, not a pay lens.

### 3.3 📉 Attrition — enriched
In render order:
1. Department-concentration verdict as the **first line** of the view.
2. Existing FY SVG chart gains: dashed **forecast extension** to FY end; subtle horizontal **peer-band zone** (voluntary peer band, §5, drawn against the voluntary series only — like-for-like); benchmark text beside the headline rates compares **voluntary vs voluntary band** and **total vs total thresholds**, never across bases (e.g., "FY26 voluntary 14.2% vs peers 11–15%; total 20.5% vs healthy ≤13%").
3. **Financial impact** line with method footnote and coverage note.
4. **Exit-by-location** table with RAG dots (mirrors existing dept/level tables).
5. **Trends & drivers** verdict: 3–5 sentences naming dominant exit reasons and classifying the pattern (comp / role-design / labor-market).

### 3.4 RAG everywhere + caveats
Attrition rate, regretted share, and inversion flags render with RAG status in every view they appear (Overview cards, Attrition, Managers, Priority tooltips). Thresholds always read from `meta.ragCfg` — never hardcoded client-side. Under-floor denominators render an inline ⚠ caveat chip.

### 3.5 📊 Data Reference — glossary + threshold provenance
New sections: I-level/M-level definitions; JF job-family code key; metric glossary (regretted, TCC, compa-ratio, anchor tiers, span of control); RAG threshold table showing live config values **with source citations** (§5).

## 4. Ports from termination-analysis (reimplemented)

| Port | Source concept | CompDash form |
|---|---|---|
| Manager aggregation | `calculateDriverMetrics(terms, 'Supervisor', …)` | Pure fn over roster rows, FY-framed, ≥3-report threshold + pooled row |
| Financial impact | Monthly payroll / attrition-cost-saved | TCC USD proration of leavers, coverage-counted |
| Forecast | `applyForecasting` + seasonal factors | Trend+seasonality on monthly FY attrition counts, ≥6-month guard |

## 5. Config: thresholds & benchmarks (research-seeded)

All in `CONFIG_CD`, each overridable via `CD_*` Script Properties; echoed in `meta`; displayed with sources in Data Reference. Research pass (2026-07-27) **refined** the feedback's example values:

| Config | Green | Yellow | Red | Note vs feedback example |
|---|---|---|---|---|
| Total attrition rate | ≤ 13% | 13–18% | > 18% | Feedback said 10/20; Mercer 2025 + SPI 2024–26 center total at ~11–14% |
| Voluntary attrition rate | ≤ 10% | 10–18% | > 18% | Matches SHRM 2025 median (9%) at green bound |
| Regretted share (of voluntary exits) | < 25% | 25–40% | > 40% | Feedback's 40/60 too lenient — typical firms run 15–35% (Umbrex) |
| Peer voluntary band (chart zone + benchmark line) | 11–15% | — | — | Feedback's 13–18% overstates PS norms (SPI total PS attrition is 11–13%) |
| Span of control target | 1:6 (healthy 5–8) | <4 narrow | >10 overload | Confirmed (McKinsey archetypes, Visier 2024, Gartner) |
| Sample-size floors | <10 heads or <3 exits ⇒ caveat + NOTE cap | | | New (feedback's data-quality item) |

Citations shipped in `meta.benchmarks.sources`: Mercer US Turnover Survey 2025; SHRM Benchmarking Report 2025; SPI Professional Services Maturity Benchmark 2025/2026; Umbrex Regretted Attrition guide; LinkedIn Talent turnover-by-industry; McKinsey span archetypes; Visier Span of Control 2024; Gartner CHRO surveys 2023–24. Services/BPO-adjacent roles run several points above pure-software norms — noted as a caveat string in Data Reference.

## 6. Roadmap draft (separate deliverable)

`CompDash/docs/specs/2026-07-27-comp-health-roadmap.md` — full feedback list resorted for CompDash: **✅ already existed in V2** (color-coded compa bands, attrition view w/ vol/invol/regretted + dept/level/location cuts, pay equity, market gap) / **🔨 V3 (this build)** / **📋 backlog** (STF metrics, pay equity by protected class, external market positioning, pay-for-performance via SI, internal promotion rate, workforce distribution chart, TCC mix upgrades, revenue per FTE, total workforce cost, forward-looking board view, themed 4-section restructure) — one-line rationale each, Confluence-paste-friendly formatting. User publishes it (draft-only decision).

## 7. Error handling

- Supervisor column missing ⇒ Managers tab renders "manager data unavailable in roster extract" notice; span/manager verdicts silent.
- Forecast < 6 actual months ⇒ block omitted; chart shows actuals only; forecast verdict silent.
- Financial impact: no-TCC rows skipped + coverage reported ("based on N of M leavers").
- Verdict engine: absent input block ⇒ dependent rules emit nothing.
- Sample-size floors as §2.
- Cache/deploy failure modes unchanged from V2 (gzip chunked, clean-miss on missing chunk).

## 8. Testing

Extend the existing Node harness in `CompDash/tests/`:
- **Verdict engine**: every rule — fires / doesn't fire / boundary values / caveat application / missing-block silence; determinism (same input ⇒ same strings).
- **Manager aggregation**: ≥3 threshold, pooled row, rate math vs hand-computed fixture, missing-Supervisor path, span ratio.
- **Forecast**: known synthetic series ⇒ expected projection; <6-month guard.
- **Financial impact**: proration + coverage counting fixtures.
- No new client-side mirrors planned (verdicts are full-population, filters don't recompute them); if one is ever added it must be byte-identical per house rule.

## 9. Deploy (PROCESS.md addendum)

1. Paste `Code.js` + `ViewDash.html` into the GAS project.
2. Run `bustCompCache_()` — **required** (payload shape change).
3. Publish a **new deployment version** (file save alone keeps serving old code).
4. Optional: set any `CD_*` threshold overrides.
5. Grant Rob/Forest viewer access via 🔒 Access Control when ready — no code change.

## Out of scope (this iteration)

WorkforceReport changes; AI/LLM anything; themed 4-section restructure; all backlog items in §6; Confluence publishing (draft only); new spreadsheets or columns beyond reading the existing Supervisor field.
