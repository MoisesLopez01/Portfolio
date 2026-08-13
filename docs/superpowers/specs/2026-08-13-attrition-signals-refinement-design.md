# Attrition Intelligence — Signals Refinement (v1.4.0)

**Date:** 2026-08-13 (2026.W33)
**App:** Attrition Intelligence GAS web app, scriptId `1_FCF366GsHljMS7N5_sUCtpkFeUodbP_OqjlDOnbtsxDDL0EsvXMTqcg`
(`Attritionintel.js` · `AttritionView.html` · `security.js`), current build 1.3.1.
**Objective:** Communicate clear attrition signals — trends and facts — so the CEO and C-suite
can self-serve a brief of company situation by cohorts and aim retention effort. Remove
duplicated signals and signals with no valid input; add performance records, growth rate,
compensation baseline, and a fact-based attrition forecast.

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Consumption | **Self-serve dashboard** — C-suite open it themselves; signals must be self-explanatory and contradiction-free |
| Data sources | **Full wiring** — Small Improvements ratings + Compilation (PayScale) benchmark; port CompDash's 3-tier anchor ladder |
| Forecast meaning | **Structural signals + empirical hazard curve** (four factor families below); hazard curve doubles as the forecast engine |
| PayScale source | **Compilation sheet as-is** (Location, Job Title, Local Currency, P25/Mean/P75, Source); show coverage honestly |
| Peer-equity key | **Parsed from Job Title**: job family (numeric prefix) × level token (e.g. JF009 × I4) × geo — no new roster columns |
| Identity | **Counts on signals, names on drill** — cohort headlines are counts only; a deliberate click opens the named list; names never in PNG exports |
| Cadence | **Monthly snapshot, live drill** — signals stamped at month-close in a snapshot store; live values only inside drill-downs |
| Cohort lens | **Two lenses, clearly split** — outcomes (exits) stay dept × region; risk (structural signals, forecast) leads job family × geo; the brief bridges them |
| Approach | **A — refine in place**: keep shell/security/cache/readers; surgical dedup + new engine layer + new Risk tab |

## 1. Product shape

Five tabs, one job and one lens each:

| Tab | Job | Lens |
|---|---|---|
| Overview | Executive brief: what happened, what it costs, what to do first | dept × region |
| ⚠ Risk *(new)* | Where the next wave comes from: structural signals + hazard forecast | job family × geo |
| Trends | Analyst workspace: cuts, comp hypothesis, growth levers | all 7 cuts |
| Leavers | Evidence: named leaver rows | row-level |
| 🔒 Access | unchanged | — |

Overview ends with one bridge line: *"Exits concentrated in ⟨dept × region⟩; the risk stack
says the next wave is ⟨family × geo⟩ — N people carrying ≥2 structural factors."*

Roles unchanged: C-suite members added as `admin`; `superadmin` remains bootstrap-only.
Fail-closed model as-is.

## 2. Deduplication — "one headline, one owner"

Rule: every fact has one owning surface. It may appear as a headline number once on
Overview and be decomposed in its owning tab — never two headlines.

- **Hero tiles keep numbers; the executive brief keeps only judgments** (RISK/ACTION/NOTE:
  so-what + action, no restated figures). Removes duplicate pairs O1≡O7 (exits-to-date),
  O2≡O8 (pace), O3≡O9 (regretted), O5≡O16 (forecast) from the current inventory.
- **One "hot group" definition, server-side only.** A group *fires* when its focus-FY rate is
  above the company rate **and** above its own FY25–26 mean (dual gate), with floors
  n ≥ 3 exits and Δ ≥ 5pp. Replaces both `aiSignalStatus_` (company-only compare) and the
  client `benchAndNow`/`signalStatus` (history-only compare). The six client engine
  re-implementations (`fyStats`, `signalStatus`, `benchAndNow`, `hcOpenOn`/`hcCloseOn`,
  `medianOf`, `levelSort`) are deleted; the server ships finished numbers.
- Regretted share, comp-linked share, backfill cost: one Overview headline each + one owning
  decomposition (exit-trend/Leavers, comp-hypothesis card, cost panel respectively).
- Filters that do not reach a panel render visibly disabled on that panel (today they are
  silently ignored by `cohortStats` and the growth cards).
- The client renders every threshold and reason-name from `meta.rules` — no view literals
  (fixes the broken contract at AttritionView.html:2299-2301 and the hardcoded 0.4/0.2,
  ±2pp, 0.5 cut-points).
- Dead code removed: `REGULAR_RE`/`EOR_RE`, `aiLog_`, `LOGO_URL`, unused shipped fields
  (`exitQuarter`, `pendingStart`, `track`) — except `lastRaiseIso`, which becomes rendered
  (Leavers recognition cell).

## 3. Signals engine — new `Signals.js` (pure functions)

Four structural factor families per active person, recalculated at month-close.
All thresholds live in `CONFIG_AI.SIGNALS`, overridable via Script Properties, echoed to the
client in `meta.rules`.

| # | Factor | Definition | Fires when |
|---|---|---|---|
| 1 | Market position | TCC ÷ PayScale mean (Compilation), keyed location × job title, fallback family × geo mean | ratio < **0.85** |
| 2 | Peer equity | TCC ÷ median of same family × level × geo peers, excluding the person (≥ 3 peers) | ratio < **0.90** |
| 3 | Recognition staleness | months since last RD comp event; months since last promotion-class event | > **18 mo** flat comp OR > **36 mo** no promotion |
| 4 | Tenure cliff | person entering a hazard bucket whose fitted hazard is above the all-bucket median | in-bucket now or within next 3 months |

- **At-risk = ≥ 2 factors firing.**
- **SI amplifier, not a factor:** latest completed-quarter SI ≥ 4.5 marks a high performer;
  high performer + at-risk sorts first and is labelled distinctly (mirrors CompDash
  `recognitionRisk`).
- **Coverage is a first-class output:** each factor ships "measurable for X of Y" per cohort;
  unmeasurable is never counted as safe.
- **Anchor ladder (ported from CompDash Position.js):** T1 title-peer median (≥3) →
  T2 PayScale benchmark → T3 level-cohort median → unresolved. Applies to the existing
  comp-driven classifier too, and the **leavers'** unresolved count is surfaced next to the
  comp-hypothesis verdict (fixes the invisible under-count of comp-driven attrition).

## 4. Hazard curve + forecast

- Fitted from the 3-FY exit history, **voluntary exits only** (involuntary is company action).
- Hazard per tenure bucket = voluntary exits in bucket ÷ person-months at risk in bucket.
- Buckets (months): 0–6, 6–12, 12–18, 18–24, 24–36, 36–60, 60+ — fine enough to reveal
  12/24/36-month cliffs empirically. Buckets under the exit floor (3) are pooled with their
  neighbour and the pooling is printed. Exit counts always shown next to rates.
- **Forecast:** each active's expected exit probability over the next 12 months walking their
  own tenure path through the fitted buckets; summed per cohort. Replaces the run-rate
  multiplier as the "if the trend holds" headline; decomposes by both lenses on the Risk tab.
- The curve itself is charted on the Risk tab with bucket counts.

## 5. Monthly snapshot store

- Dedicated spreadsheet (never the HR source sheets), ID in Script Property
  `AI_SNAPSHOT_SS_ID`; tab `Snapshots`.
- One row per active person per month-close: `month, empNo, f1..f4 fired, atRisk,
  highPerformer, marketBand, peerBand, monthsSinceRaise, monthsSincePromo, tenureBucket`.
  Banded/boolean values plus month counters — raw pay ratios stay out of the store.
- Trigger: 1st of each month (installed once by `aiSetupSnapshotTrigger()`, owner-run).
  Manual `aiWriteMonthlySnapshot()` backfills the current month on demand.
- Risk tab stamp: "as of ⟨YYYY-MM⟩ close · next recalc ⟨date⟩ (⟨YYYY.Www⟩)".
- Month-over-month deltas ("12 at risk, was 9") read frozen rows; live values appear only in
  the evidence drill. If the store is empty (first run), the tab renders live values labelled
  "no snapshot yet — live view" rather than failing.

## 6. Data wiring

| Reader | Source | Columns | Config |
|---|---|---|---|
| `aiReadBenchmarks_` *(new)* | Compilation sheet | Location, Job Title, Local Currency, 25th/Mean/75th Percentile TCC, Source | `AI_BENCH_SS_ID`, `AI_BENCH_TAB` |
| `aiReadRatings_` *(new)* | Small Improvements RD | ID (=Employee Number), Fiscal Quarter, Rate | `AI_SI_SS_ID`, `AI_SI_TAB` (fills the existing `CONFIG_AI.PERF` stub) |

Both follow the existing `aiFetchTab_` + header-name resolution pattern. Missing sheets
degrade to "source unavailable" cards, never throw. "Performance mix" prose switches from the
regretted proxy to real SI data wherever SI coverage exists, with the proxy retained (and
labelled) for people without ratings.

## 7. Frontend changes

- **Overview:** tiles = numbers, brief = verdicts (§2); matrix, pace cards, quarterly trend,
  cost panel stay; forecast tile switches to the hazard-based number; bridge line added;
  "How to read these numbers" updated.
- **⚠ Risk tab (new):** summary strip (at-risk count, MoM delta, high-performer-at-risk
  count, forecast next-12-mo) → family × geo risk table (counts, factor mix, MoM delta,
  coverage) → hazard curve chart → forecast decomposition (both lenses) → per-cohort evidence
  drawer (named list + factor chips; drawer content excluded from PNG export).
- **Trends:** per-panel filter disabling; comp-hypothesis card gains leavers' unresolved
  count; growth cards unchanged otherwise.
- **Leavers:** render `lastRaiseIso` and latest SI rating in the recognition cell.
- PNG/CSV export tools stay on every card; export caption fix includes region filter.

## 8. Error handling & honesty rules

- Every rate carries its denominator; under-floor groups show counts, no bars, no verdicts.
- Coverage lines on every new signal ("measurable for X of Y"); unresolved ≠ safe.
- Backfill-cost placeholder badge stays until real coefficients are configured; the
  "Act on these first" ranking notes that ordering uses estimated cost.
- Snapshot-store absence, benchmark absence, SI absence each degrade to labelled fallbacks.

## 9. Testing & delivery

- Extend `aiRunSelfTests` with fixtures: hazard fit (known synthetic history → known rates),
  bucket pooling, forecast walk, each factor's fire/no-fire boundary, ≥2-factor stack,
  anchor-ladder tier fallback, coverage counting, dual-gate group signal.
- Version 1.4.0; BUILD stamp discipline kept; `clasp push` to the shared script from a
  persistent local clone at `C:\Users\moise\gas-projects\attrition-intel`; cache bust on
  deploy; one-time `aiSetupSnapshotTrigger()` run by the owner.
- Out of scope this round: exit-interview/eNPS sources (no data), market Remote-pull tab
  (unpopulated), replacing placeholder backfill coefficients (config-only change),
  hire-cohort/vintage survival views.
