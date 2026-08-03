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
