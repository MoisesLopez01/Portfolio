# dash-loop — Delivery Health, Director view

START 2026-08-03 17:20 local · budget 90 min · max 6 iterations · branch dash-loop/20260803

Environment notes recorded once:
- Skills `servicerocket-design-guidelines` and `frontend-design` DO NOT EXIST here; the
  ServiceRocket Skills MCP session is expired. Using `dataviz` (loaded; its palette validator
  set the chart tokens) + the prompt's allowed-vocabulary list.
- SHARED WORKING TREE: 94 files dirty across CompDash / GDash / PS / Tempo / portfolio, and a
  second Claude session is live in these same files. `git checkout .` is BANNED for this loop —
  it would destroy weeks of other projects' uncommitted work. Reverts are `git checkout -- <file>`.
  Commits stage only delivery-health paths.

| iter | row | before→after | total | elapsed | note |
|---|---|---|---|---|---|
| 1 | R5 (F1) | 0→2 | 10→12 | 17:20–17:37 | scopedMetric_ was a second, divergent definition of every metric. Routed through the METRICS_ accessors over a scoped population. |
| 2 | R4 (F2) | 1→2 | 12→13 | 17:37–17:46 | 0% rework rendered positive green while its own body said reopens are not counted. A rate whose numerator signal is structurally absent now renders with NO RAG colour and says "at least N% — lower bound, not a measurement". |
| 3 | R8 (F4) | 0→2 | 13→15 | 17:46–18:00 | Open access granted "viewer" and with it the margin numbers. Split to "guest": utilization + forecast tiles omitted from the DOM (not dimmed), removed from every chip strip and comparison chart, headroom tab role-gated in VIEWS. Server twin dhMarginTier_ in Security.js. |
| 4 | R6+R7 (F6) | 1→2, 1→2 | 15→17 | 18:00–18:26 | Card bodies collapsed to a fixed grammar: label → hero → coverage chip → delta-vs-target → ONE context line → sparkline. Quality was 8 visual lines and Forecast 7; all four are now 3, so the sparkline baselines align and the row reads as a set. Period stated once globally on the scope chip instead of repeating in four card headers. Demoted detail (median variance, miss direction, unattributed, signals, CSAT) moved to the context line's ⓘ tooltip — reachable, not gone. |
| 5 | R10 (F8+F3) | 1→2 | 17→18 | 18:26–18:42 | Removed genuinely dead code (ragClass_, deltaStr_, .spark/.stats CSS, --heat-*/--heatf-* tokens — all definition-only, zero call sites; 1184 chars). Tab renamed "📈 Trends" → "🎯 Headroom" for what it holds. Dropped the metric chips from that tab: the table computes recoverable HOURS, which only exist for utilization, so the chips changed themselves and nothing else (F3). |

STOP 18:45 — 90-minute budget elapsed. 5 of 6 iterations used; iteration 6 not started
rather than begun and abandoned mid-edit. Total 10 → 18/30. R1/R2 blocked on PR-01.
Acceptance: Q1 Q2 Q3 pass; Q4 now honest (was misleading); Q5 passes at 1440x900.

POST-LOOP 2026-08-03 — real-export profiling + blocker report.
Profiled the actual Jira Raw output (218 rows, 2026.W32 sample; resolution dates 2025-08-04→18,
~350 days old — percentages indicative, structure conclusive). Findings drove:
- schema v10→v11: hygieneBuckets gain resAssigned. Registry v2.1, changeLog affects: [] (a
  measurement change, no metric's value moves).
- Data Hygiene: the assignee gap SPLIT into "carries a Jira assignee" (94%, Jira discipline) and
  "that assignee joins the roster" (~54% of those, OUR name index). One number had been routing a
  name-matching problem to the Jira admin queue.
- Due-date row renamed to name the population it measures — under the Dictionary scope it counts
  epics (11% fill), not "delivery work" (73%).
- ONTIME_SCOPE stays "dictionary". Reverting to "delivery" would raise the number by hiding the
  blocker, which is the opposite of what this report is for.
- dash-loop/DATA-BLOCKERS.md written for the Services Director.
2026-08-03 — ONTIME_SCOPE="dictionary" RATIFIED by the user after seeing the measured n=2, with
the revert option explicitly on the table. Rationale recorded in CONFIG_DH beside the value and in
DATA-BLOCKERS.md item 1. _test_onTimeRate_ pins it, so a future change is a decision, not a drive-by.
