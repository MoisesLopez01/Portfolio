# Contribution — Workforce Planning Reports (wfp-reports)

Reorganized 2026.W33 (2026-08-13). One folder per Google Apps Script project — each self-contained with its own `docs/specs/` (design decisions), `docs/plans/` (implementation plans), and `docs/brainstorming/` (raw ideas) — plus shared `tests/` at root. Ready to push per-project commits to Bitbucket (`RocketOps / Workforce Planning / wfp-reports`).

## Repo map

| Folder | Project | Status |
|---|---|---|
| `ps-dashboard/` | **PS Weekly Contribution Report** (main) — dashboard, security, teams, Confluence publisher, plus its data exporters (Tempo Plan/Tracked/Capacity, Kudos, Change Names, Contribution Snapshot Export) | Active |
| `gdash/` | **GDash** — Goals Compliance Dashboard (`GDash.html`, `GD Security.js`, `goalCompliance.js`) | Active |
| `CompDash/` | Comp Health Dashboard | Active |
| `WorkforceReport/` | Workforce Comp Report | Active |
| `delivery-health-dashboard/` | Delivery Health Dashboard | Active |
| `project-demand-dashboard/` | Project Demand Dashboard | Active |
| `gas-portfolio/`, `gas-portfolio-demos/` | Portfolio site + demos | Side project |
| `legacy-contribution/` | Old contribution projects — Contribution Report, Dashboard, Contribution Intelligence, Employee Impact, Full HC / Hours / Backlog Analysis, Jira Backlog | Legacy |
| `tests/` | All node test suites, one subfolder per project (paths already fixed; run from repo root, e.g. `node tests/compdash/run_tests.js`) | — |
| `<project>/docs/` | Each project carries its own `specs/`, `plans/`, `brainstorming/` (ps-dashboard also has `architecture/` C4 docs) | — |
| `docs/` | Cross-project only: `tickets/` (GTT ticket summaries) | — |
| `SKILLS.md` | Manifest of Claude skills used per project | — |

## Tests

```
node tests/ps-dashboard/period-buckets.test.js
node tests/ps-dashboard/capacity-node-tests.js
node tests/gdash/finance-stf-gaps.test.js
node tests/compdash/run_tests.js          # + parse_html.js, render_smoke.js
node tests/workforce-report/run_tests.js
node tests/delivery-health/node-tests.js  # + render-smoke.js
node tests/project-demand/node-tests.js
```

`tests/ps-dashboard/_test_liveTrackedTime.js` is a GAS-side test — runs in the Apps Script editor, not node.

## Pushing to Bitbucket

Each folder can be committed and pushed independently, e.g.:

```
git checkout -b feature/ps-report-w33-improvements
git add ps-dashboard tests/ps-dashboard    # ps-dashboard/docs travels with the code
git commit -m "PS Dashboard: 2026.W33 changes"
git push origin feature/ps-report-w33-improvements
```

Suggested folder → branch mapping: `ps-dashboard` → `feature/ps-report-*`, `gdash` → `feature/ps-report-w23-goals-audit` lineage, `CompDash`/`WorkforceReport` → `gtt-660-compensation-gaps` lineage.
