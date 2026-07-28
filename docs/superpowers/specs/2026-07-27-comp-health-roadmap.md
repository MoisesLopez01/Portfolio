# Comp Health Dashboard — Roadmap & Idea Backlog

*Living backlog for the Rocketeer Global Comp Health Report (CompDash). Sorted from the 2026.W30 exec feedback on the Global Compensation Health Report. Execs with dashboard access: add ideas and comments here.*

## ✅ Already shipped (V2, 2026.W30)

| Item | Where it lives |
|---|---|
| Color-coded internal position bands (red/yellow/green/violet) | ⚖️ Internal Position |
| Attrition view: voluntary/involuntary/regretted, dept/level/location cuts, FY-vs-FY chart | 📉 Attrition |
| Pay equity lenses (gender gap, outliers, long-tenure-low-pay) | 🧭 Pay Equity |
| External market positioning (TCC vs P25/Mean/P75, raise suggestions) | 🌍 Market Gap |
| Priority ranking (perf × tenure × compa-gap composite) | 🎯 Priority Ranking |

## 🔨 Shipping now (V3 — this iteration)

| Item | Note |
|---|---|
| Action-oriented callouts (fact → so-what → recommended action) | Rule-based, deterministic — no AI |
| Executive TL;DR paragraph + RAG chip row on Overview | The "reader who won't get past page one" fix |
| Manager-level attrition view (3+ reports, pooled small teams) | Supervisor field confirmed in roster |
| Span of control vs target | 1:6 target, knowledge-work norm 5–8 |
| Exit-location cut RAG-colored | Already computed; now judged, not just listed |
| External benchmark line (peer voluntary band 11–15%) | Sources cited in Data Reference |
| Attrition financial impact ($ payroll released, regretted portion) | Ported from termination-analysis |
| FY attrition forecast (trend × seasonality) | Needs ≥6 actual months |
| Sample-size caveats everywhere | Kills the "0.9% on 2 exits looks great" trap |
| Glossary (levels, JF codes, metric terms) + threshold provenance | 📊 Data Reference |

## 📋 Backlog (V-next — needs data, decision, or a bigger lift)

| Item | Blocker / note |
|---|---|
| Share the Fruit (STF) bonus metrics: participation, payout by year/location/level, % of TCC | STF data not in current sources |
| Pay equity by protected class (banding by demographic group) | Most-scrutinized cut; needs careful method + demographic data quality |
| External market positioning vs updated bands (percentile-vs-market) | Bands not refreshed yet |
| Pay-for-performance linkage (raises vs SI ratings) | Ratings already joined — needs an adjustment-event × rating cut |
| Internal promotion rate (promotions ÷ positions filled) | Needs external-hire counts |
| Workforce distribution chart (Regular/EOR/Part-Time/interns) | Data exists in roster scope notes |
| TCC mix + YoY TCC growth (base/variable/STF) once STF lands | Depends on STF item |
| Revenue per FTE | Needs finance revenue data |
| Total workforce cost incl. crew/contractors summary line | Board-view item; crew correctly excluded from comp-health math |
| Forward-looking comp-cycle spend / budget-vs-actual | Board-view item |
| Manager-team drill (click a manager → scoped views) | Payload doesn't carry supervisor per employee yet |
| Themed 4-section restructure (Headcount / Movement / Reward / Equity) | Parked by exec feedback; revisit at V4 |

## Parking lot

- One-page printable board scorecard export.
- Multi-quarter trend lines beyond the FY-vs-FY pair (attrition, TCC growth over 4–6 quarters).
