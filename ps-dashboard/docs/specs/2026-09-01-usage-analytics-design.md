# Usage Analytics — access trace + superadmin engagement tab

**Date:** 2026-09-01 (2026.W36)
**Status:** Approved design, pre-implementation
**Owner:** WFP / dashboard owner

## Purpose

Know who is actually using the dashboard, week by week, so adoption can be
driven deliberately. Two questions, both per ISO week (`2026.WNN`):

1. **Usage** — who opened the dashboard, how often, in what role?
2. **Non-usage** — which *eligible* people did NOT open it, so they can be
   nudged? Eligible = the complete potential audience: every active roster
   supervisor admitted by the current `SEC_.MANAGER_AUTO_ACCESS` policy, plus
   everyone on the five access lists (super / admin / org-admin / viewer /
   delegate).

Surfaced in a new **📶 Usage Analytics** view, ☰ menu, **superadmin only**.

## Non-goals

- No per-action instrumentation (tab switches, team toggles, refresh clicks).
  A visit = one `doGet` page load. Full activity tracing was considered and
  rejected as volume without decision value.
- No retention/archival machinery. One row per visit stays far below Sheets
  limits for years; the log tab can be trimmed by hand if ever needed.
- No notifications/emails to non-engaged users. The tab produces the nudge
  list; the nudging stays human.

## Architecture

One new server file, **`PS Usage.js`**, owning both halves:

```
doGet (PS Contribution Report.js)
  └─ logDashboardVisit_(access)        ← fire-and-forget, never throws
       └─ appendRow → "PS Access Log" tab (container spreadsheet)

📶 tab (PS Dashboard.html, lazy on first open)
  └─ google.script.run.getUsageAnalytics()
       ├─ gate: checkDashboardAccess() + isSuperAdmin_()  → throws otherwise
       ├─ read "PS Access Log" (last 13 ISO weeks)
       ├─ _readRosterForAccess_()  + _autoAccessAllows_() → auto-eligible set
       ├─ _readAccessLists_()                             → explicit-eligible set
       └─ computeUsageRollup_(logRows, eligible, currentWeek)   [pure function]
```

### 1. Capture — `logDashboardVisit_(access)`

Called from `doGet` on **every** hit, allowed and denied alike (a denied
attempt is demand — it counts as its own metric, never as engagement).

- **Sheet:** `PS Access Log` in the dashboard's own container spreadsheet
  (`SpreadsheetApp.getActiveSpreadsheet()` — the same writable file that holds
  `PS Settings`). Created with a header row on first write. The shared HRIS
  source spreadsheets are read-only by house rule and are never written.
- **Columns:** `Timestamp | Week | Email | Role | Allowed | Scope`
  - `Timestamp` — ISO datetime.
  - `Week` — `YYYY.WNN` from the existing `isoWeekYear_PS_` / `isoWeekNum_PS_`
    helpers (never a new week formatter).
  - `Email` — lowercased; may be blank for an unidentified session.
  - `Role` — the resolved role, or `denied`.
  - `Allowed` — `TRUE`/`FALSE`.
  - `Scope` — `delegateScopeName` for manager-scoped roles, else blank.
- **Failure mode:** entire body in try/catch. `Sheet.appendRow` is atomic, so
  the steady-state append never takes the project-wide script lock — only
  first-write sheet creation does, via a scoped `LockService.getScriptLock()
  .tryLock(500)` around the create-and-header step (with a re-check of
  `getSheetByName` under the lock). That keeps the append off the lock that
  `runJiraEpicTracker` holds for its entire hourly export; a lock around every
  append used to make every page load during that window wait 500 ms and then
  drop its row. Lock miss during creation, or any error, ⇒ the visit is
  dropped, a `Logger.log` line records why, and `doGet` proceeds untouched.
  Logging is best-effort **by design**: a lost log line is acceptable, a slow
  or broken page load is not.
- **What never logs:** the cache warmer and editor runs call
  `getPSReportData`, not `doGet`, so trigger executions (which run as the
  owner) cannot pollute the data. Only real page loads log.

### 2. Rollup — `getUsageAnalytics()` + `computeUsageRollup_`

`getUsageAnalytics()` is a public endpoint (no trailing underscore ⇒ callable
by anyone who can load the app), so it is gated first line:
`checkDashboardAccess()` then `isSuperAdmin_()`, throwing on failure — the
`tests/callable-surface-checks.js` sweep enforces the gate's presence.

It assembles inputs and delegates all math to the **pure** function
`computeUsageRollup_(logRows, eligible, currentWeek)` so the math is testable
in Node with fixtures. Horizon: the **13 most recent ISO weeks** (one
quarter), computed from today, not from the log.

**Eligible set** (`{ email → { name, role, source } }`):
- Every active roster supervisor with ≥1 active direct report **who passes
  `_autoAccessAllows_()`** under the current `MANAGER_AUTO_ACCESS` mode — the
  audit must never list someone as "expected but absent" whom the policy would
  actually turn away. On-leave supervisors follow `ALLOW_ONLEAVE_MANAGER`.
- Plus every email on the five access lists. List membership wins for the
  displayed role (mirrors resolution order: super → admin → orgadmin → viewer
  → delegate).

**Return shape:**

```js
{
  ok: true,
  generatedAt, currentWeek,            // "2026.W36"
  weeks: [{ week, uniqueVisitors, totalLoads, denied, byRole: {role: n} }],   // 13, oldest first
  people: [{ email, name, role, source, lastSeen, lastSeenWeek,
             visitsThisWeek, visits4Weeks, everVisited }],                     // eligible set
  coverage: { engagedThisWeek, eligibleTotal, pct },
  otherVisitors: [{ email, visitsThisWeek, lastSeen }],   // visitors outside the eligible set
}
```

Rules the rollup must hold:
- Unique = distinct non-blank emails per week; denied rows count in `denied`
  and `totalLoads`, **never** in `uniqueVisitors`, `byRole`, or any person's
  engagement.
- An eligible person's engagement counts only their **allowed** visits.
- `visitsThisWeek` covers the current ISO week; `visits4Weeks` covers the
  current ISO week plus the three before it.
- Blank-email rows aggregate into totals but never attach to a person.
- A missing or empty `PS Access Log` sheet is **not an error**: return
  `ok: true` with empty weeks and the full eligible set (everyone
  never-visited) — that is the honest day-one picture.

No caching for now: superadmin-only, one `getDataRange` read over a modest
sheet, and freshness matters more than a second of latency.

### 3. Frontend — one `VIEWS` entry

```js
{ id: "usage", btnId: "tabBtnUsage", paneId: "tabUsage",
  label: "📶 Usage Analytics", location: "menu", roles: ["superadmin"] }
```

- ☰ menu placement beside ⚖️ Scoring Weights and 🔒 Access Control — an admin
  tool, not a data view. Opens as the standard closable temp tab
  (`STATE.openMenuTabs`); role gating in `switchTab()` comes free from the
  `roles` array. Client role checks go through `isSuperAdmin_()`, never a
  bare role-string compare.
- Data loads **lazily** on first open via
  `google.script.run.getUsageAnalytics()`, cached in `STATE` for the session
  with a manual ↻ re-fetch button. Never part of the shared report payload —
  that cache entry is impersonal and shared across roles, and this data is
  superadmin-only.
- Pane contents, top to bottom:
  1. **KPI row** — unique visitors this week · coverage % (engaged/eligible) ·
     total loads this week · denied attempts this week.
  2. **13-week trend** — unique visitors per week, same chart mechanism the
     Trends tab uses.
  3. **Not engaged this week** — the nudge list: name, role, source
     (list/auto-manager), last seen, 4-week visit count. Sorted never-visited
     first, then stalest `lastSeen`. Filter box appears past 6 rows (the ACL
     card pattern). Row count in the header.
  4. **Role breakdown** table for the current week.
  5. **Other visitors** — compact note listing non-eligible visitors
     (open-access guests), if any.
- Error → the pane shows the message; empty log → "No visits recorded yet —
  logging starts with the first page load after this deploys."

### 4. Transparency

The dashboard records who opened it and when, so the people affected are told:
one footer line on the dashboard — "Page visits are logged (who and when) to
measure adoption" — and the same sentence in the Data Reference page. Ships in
the same change as the logging, not later.

### 5. Tests — `tests/usage-analytics-checks.js`

Extract-based Node suite in the style of the existing four:

- **Rollup math on fixtures:** correct uniques/loads per week; denied rows
  counted separately and never as engagement; blank-email rows in totals only;
  eligible person with zero allowed visits ⇒ `everVisited: false`; visitor
  outside the eligible set lands in `otherVisitors`; 13-week window anchored
  on `currentWeek`; weeks ordered oldest-first.
- **Eligible-set assembly:** respects `_autoAccessAllows_` (a supervisor
  outside a `"classes"` scope is not listed as expected); list members present
  with list-resolution role; de-duplication when someone is both supervisor
  and listed.
- **Week labels** match `/^\d{4}\.W\d{1,2}$/` and come from the shared ISO
  helpers.
- **Gate present:** `getUsageAnalytics` calls `checkDashboardAccess` and
  `isSuperAdmin_` before any read (source regex, same technique as the
  saveAccessSettings gate checks); `logDashboardVisit_`'s body is inside
  try/catch and `doGet` still returns normally when it throws.
- `tests/callable-surface-checks.js` picks up `getUsageAnalytics`
  automatically; `UNGATED_OK` gains nothing.

## Decisions taken (with the user, 2026.W36)

- Scope: usage **and** non-usage (coverage), not counts-only, not full traces.
- Audience for the non-usage list: **all eligible people** — the long list at
  first *is* the engagement picture.
- Storage: direct append to a container-spreadsheet log tab (Approach A);
  buffered writes and execution-log mining rejected.
- Visibility: superadmin only.
