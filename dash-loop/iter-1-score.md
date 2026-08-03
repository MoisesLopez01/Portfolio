# iter-1 score — baseline (17:20)

| # | Score | Citation | Evidence |
|---|---|---|---|
| R1 | 1 | `Dashboard.html:323,858` | Region chips scope all 4 tiles via `passesFilters_`; region source shown only as a `◦` glyph in the grid, never on a card. **Blocked by F7** (Jira Region 0% populated). |
| R2 | 1 | `Dashboard.html:325` | Team is a `<select>`, Region a chip strip — peer dimensions, unequal affordance (F5). Scoping itself works. |
| R3 | 2 | `Dashboard.html:1465` `sparkHtml_` | All 4 tiles sparkline; first/last period named, endpoint value printed, norm band drawn, nulls break the line. Target not referenced inside the spark. |
| R4 | 1 | `Dashboard.html:2030,1747` | `invertTarget` honoured for Quality. **F2: 0% rework renders `class="big g"` — greenest card on screen while its own body says the rate is a floor.** |
| R5 | 0 | `Dashboard.html:2435` vs `2150 METRICS_` | **F1: `scopedMetric_` is a second definition.** (a) quality → `forecastBuckets`; (b) forecast → band not Dictionary mean; (c) util → `availCov` not `capCov`. Region/Team bars disagree with the cards on 3 of 4. |
| R6 | 1 | `Dashboard.html:1747` `tileHtml_` | Grammar right, density wrong: Quality 8 lines / Forecast 7 between hero and sparkline → 4 baselines at 4 heights (F6). Period repeats in all 4 headers. |
| R7 | 1 | `Dashboard.html:1747` | Card stack + comparison exceeds 900px at 1440 (F6 line counts). |
| R8 | 0 | `Dashboard.html:429,3309` | `viewerRole` gates only the Access tab + gate editor. No gate on utilization / forecast-variance detail (F4). |
| R9 | 2 | `Dashboard.html:1442 valuesTable_`, `2394` | Table twin exists; dark-mode tokens validated; chart values direct-labelled not hover-only. |
| R10 | 1 | `1106 ragClass_`, `1406 deltaStr_`, `145 .spark`, `11 --heat-*` | Coverage chip on every published number; dead code + unused CSS remain (F8). Tab still "Trends", holds only headroom. |

**Total 10/30.**

Pick: **R5** — F1 is a wrong number under a correct label, which outranks every presentation row.

Skills note: `servicerocket-design-guidelines` and `frontend-design` do not exist in this environment
(ServiceRocket Skills MCP session expired). Using `dataviz` (loaded; its validator set the chart
tokens) plus the prompt's own allowed-vocabulary list.

Tree note: 94 files dirty across other projects, second session live. `git checkout .` is **banned**
for this loop — reverts are `git checkout -- <file>` only.
