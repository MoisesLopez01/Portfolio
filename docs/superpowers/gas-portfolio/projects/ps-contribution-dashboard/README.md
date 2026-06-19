# PS Contribution Dashboard

> Role-based GAS web app · Bitbucket CI/CD · Goals audit + Confluence executive brief

A full-stack Google Apps Script web app that gives the Professional Services org
automated, role-scoped visibility into team contribution quality and health metrics —
replacing ad hoc manual reports with a versioned, gated, exec-ready pipeline.

---

## Problem

The Professional Services team had no systematic way to track contribution quality or
team health metrics. Managers relied on **ad hoc manual reports** compiled from Jira
tickets and Tempo timesheets — time-consuming, with no standardized scoring, **no
role-based access control**, and no historical trend visibility.

## Approach

- Built a full-stack web app in **Google Apps Script** with a **3-layer RBAC** model and
  **Jira + Tempo** data aggregation.
- Engineered a **weighted composite scoring engine** plus a goals-compliance override that
  backfills Q4 comment thresholds across all weeks.
- Automated **Confluence executive briefs** via REST API and set up **Bitbucket Pipelines +
  clasp** for staged GAS deployments.

## Tech

- Google Apps Script
- Bitbucket Pipelines
- Google Clasp
- Confluence REST API
- Jira API
- Tempo API
- Role-based Access Control

## Results

Delivered automated team-health visibility for the **Professional Services** org. Weekly
reports and **executive Confluence briefs** run with **zero manual intervention**, and a
**GitOps pipeline** validates every change before it reaches production.

| Metric | Value |
|---|---|
| Auto-reports | Weekly |
| CI/CD | Bitbucket |
| Exec briefs | Confluence |

**Before:** Ad hoc manual reports from Jira + Tempo — no scoring, no RBAC, no version
control. Manager bottleneck, no deployment pipeline.

**After:** RBAC webapp + Bitbucket CI/CD + automated Confluence executive briefs. Zero
manual effort, gated releases, exec-ready weekly.

---

## How to run

**Full production source is present** in [`src/`](./src/) — these are the real Google Apps
Script files behind the live deployment (provenance: copied from the author's production GAS
project):

- `PS_Contribution_Report.js` — main GAS script: data readers, assembly, `doGet`,
  `getPSReportData`, scoring engine
- `PS_Security.js` — 3-layer email-based access control and role resolution
- `PS_Post.js` — Confluence executive-brief publishing layer

### Deploy with clasp

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "PS Contribution Dashboard"
# add the src/*.js files plus the HTML frontend to the GAS project, then:
clasp push
clasp deploy --description "v$(date +%Y-%m-%d)"
```

### Or paste into the Apps Script editor

1. Create a new Apps Script project at [script.google.com](https://script.google.com).
2. Paste each `src/*.js` file into a corresponding script file.
3. Add the HTML frontend file(s) (served via `HtmlService`).
4. Configure Script Properties: spreadsheet IDs (`ROSTER_SS_ID`, `GOALS_SS_ID`,
   `PTO_ACCUM_SS_ID`), the Gemini/Confluence API keys, and access-control lists.
5. Deploy as a web app (**Execute as: Me**, appropriate access).

> Note: the HTML frontend (`PS Dashboard.html`) is not bundled in this repo; the `src/`
> files are the server-side logic. Spreadsheet IDs and API keys must be supplied via Script
> Properties — none are committed here.

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
