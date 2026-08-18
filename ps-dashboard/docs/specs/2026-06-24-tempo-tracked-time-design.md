# Design: TempoTrackedTime.js — Tempo Logged Time Exporter

**Date:** 2026-06-24  
**Status:** Approved  
**Branch:** feature/portfolio-live-demos (local)

---

## Problem

`TempoPlanExport.js` exports **planned** time from Tempo. There is no equivalent export
for **logged** (actual) time. The team needs a weekly breakdown of hours Rocketeers
actually logged against Jira issues, grouped by user and project, written to a separate
sheet tab in the same Google Spreadsheet.

---

## Solution overview

A new GAS file `TempoTrackedTime.js` added to the same Apps Script project. It calls
the Tempo worklogs API (`GET /4/worklogs/user/{accountId}`) instead of the plans API,
and writes output to a sheet tab named `"Logged Time Tempo"`. All infrastructure
globals (`MERGE_MAP`, `EXCLUDE_IDS`, credentials, team discovery, date helpers) are
inherited from `TempoPlanExport.js` via GAS shared scope — no changes to that file.

---

## File boundary

`TempoTrackedTime.js` declares **one top-level constant** and **nine functions**.
Everything else it needs comes from `TempoPlanExport.js`.

### Shared from TempoPlanExport.js (no changes)

| Symbol | Type |
|---|---|
| `MERGE_MAP` | Duplicate account ID → primary ID map |
| `EXCLUDE_IDS` | Accounts to skip entirely |
| `getCredentials_()` | Retrieves stored Tempo + Jira tokens |
| `fetchAllTeamMembers_(token)` | Discovers all worker account IDs from Tempo Teams |
| `fetchUserNames_(userIds, email, token)` | Batched Jira display name lookup |
| `buildWeekRanges_(fromDate, toDate)` | Builds ISO week column array |
| `fmtDate_(d)` | Date → `"YYYY-MM-DD"` |
| `isoWeekLabel_(date)` | Date → `"2026.W14"` |
| `formatWeekLabel_(start, end)` | Date range → `"Mar 30 - Apr 05 2026"` |
| `parseDateLocal_(dateStr)` | `"YYYY-MM-DD"` → local midnight Date |
| `maxDate_(a, b)` / `minDate_(a, b)` | Date comparison helpers |
| `round2_(n)` | Round to 2 decimal places (used at output only) |

> **Note on `fetchUserNames_`:** it internally references `CONFIGPlan.JIRA_BASE` and
> `CONFIGPlan.API_BATCH_SIZE`. Those values are identical in `CONFIGLogged`, so calling
> it from `TempoTrackedTime.js` works without modification.

---

## Configuration

```js
const CONFIGLogged = {
  SCRIPT_LABEL:     "Tempo Logged Time Reports",
  SHEET_NAME:       "Logged Time Tempo",
  JIRA_BASE:        "https://servicerocket-coe.atlassian.net",
  FROM_DATE:        "2026-03-30",          // fixed: FY26 Q4 start (Monday)
  TO_DATE:          fmtDate_(new Date()),  // dynamic: today at runtime
  DIAG_PER_WORKLOG: true,                 // log a line per worklog when true
  API_BATCH_SIZE:   50,
  TEMPO_PAGE_LIMIT: 500,
  HEADER_BG:        "#4472C4",
  HEADER_FONT:      "#FFFFFF",
  TOTAL_ROW_BG:     "#D6E4F0",
};
```

`TO_DATE` is evaluated at script load time, so every run automatically ends at today.
The current week column will be partial (only days logged so far) — correct behavior
for real-time data. `FROM_DATE` must remain a Monday so ISO week labels align.

---

## Function inventory

| Function | Role |
|---|---|
| `fetchTempoLoggedTime()` | Main entry point |
| `prepareLoggedSheet_(weeks)` | Create/clear sheet; write 2-row stacked header |
| `fetchAllWorklogs_(token, workerIds, userMap)` | Loop all workers; paginate worklogs; dedup; collect issueIds |
| `fetchUserWorklogs_(token, userId)` | Per-user paginated `GET /4/worklogs/user/{id}` |
| `resolveWorklogIssues_(issueIds, email, token)` | JQL batch → project name/key; per-ID fallback |
| `groupWorklogsByUserProjectWeek_(worklogs, weeks, userMap, issueMap)` | Bucket each worklog into its ISO week by `startDate` |
| `buildLoggedSortedRows_(grouped, weeks)` | Sort user → project; `round2_()` at output only |
| `writeLoggedRows_(sheet, rows, weeks)` | Write rows + TOTAL footer; log per-user totals |
| `createLoggedWeeklyTrigger()` | Install Monday 8 AM time-based trigger |

---

## Main flow (`fetchTempoLoggedTime`)

```
1. getCredentials_()                     → tempoToken, jiraEmail, jiraToken
2. parseDateLocal_(CONFIGLogged.FROM/TO) → fromDate, toDate
3. buildWeekRanges_(fromDate, toDate)    → weeks[]
4. prepareLoggedSheet_(weeks)            → sheet
5. fetchAllTeamMembers_(tempoToken)      → workerIds[]
6. fetchUserNames_(workerIds, …)         → userMap { accountId → displayName }
7. fetchAllWorklogs_(token, workerIds, userMap)
                                         → { allWorklogs[], issueIds[], skippedCount }
8. Guard: allWorklogs.length === 0 → write warning cell, return early
9. resolveWorklogIssues_(issueIds, …)    → issueMap { issueId → { name, key, … } }
10. groupWorklogsByUserProjectWeek_(…)   → grouped { groupKey → { worker, project, weeklyHours[], total } }
11. buildLoggedSortedRows_(grouped, weeks) → sortedRows[][]
12. writeLoggedRows_(sheet, sortedRows, weeks)
```

---

## Key design decisions

### Worklog dedup fingerprint
Each worklog is deduplicated per effective user by:
```
effectiveId | tempoWorklogId | issueId | startDate | timeSpentSeconds | description
```
Worklogs have stable IDs (`tempoWorklogId`), so the fingerprint includes it directly.
Duplicates arise when a Rocketeer has two Jira/Tempo accounts (covered by `MERGE_MAP`).

### Week bucketing
Each worklog carries an authoritative `startDate`. Bucketing is a simple range check:
```
worklogDate >= weeks[wi].start && worklogDate <= weeks[wi].calcEnd
```
No working-day distribution math, no scale factor, no weekend rescue — none of the
planned-time complexity applies here.

### Issue → project resolution
`resolveWorklogIssues_` uses the same JQL batch + per-ID fallback pattern as
`resolveIssues_` in `TempoPlanExport.js`. Captures `name`, `key`, `issueKey`,
`summary`, `issueType` per issue. The sheet writes only `name` (Space column) and
`key` (Key column). Extra fields (`issueKey`, `summary`) surface in `DIAG_PER_WORKLOG`
log lines for diagnostics.

### Sheet layout
Identical column structure to the planned-time sheet:

| Col | Header | Value |
|---|---|---|
| A | User | Rocketeer display name |
| B | Space | Jira project name |
| C | Key | Jira project key |
| D | Logged (hrs) | Total logged hours (repeated in last col) |
| E… | [ISO week date ranges] | Per-week logged hours |
| Last | Total (hrs) | Row total |

Row 1: ISO week labels (`2026.W14` etc.) above week columns, blank over fixed cols.  
Row 2: column headers.  
Frozen: 2 header rows, 4 columns. TOTAL footer row with bold + `TOTAL_ROW_BG`.

### Trigger naming
`createLoggedWeeklyTrigger()` — distinct from `createWeeklyTrigger()` in
`TempoPlanExport.js` to prevent a GAS duplicate function declaration error.

### No low-hours threshold
`writeLoggedRows_` logs per-user totals without flagging a minimum. Logged time
patterns vary (PTO, burst logging) and a floor threshold would generate noise.

---

## What does NOT change

- `TempoPlanExport.js` — zero modifications
- `MERGE_MAP` / `EXCLUDE_IDS` — defined once in `TempoPlanExport.js`, shared
- Credential storage — same `storeCredentials()` / `getCredentials_()` flow
- Worker discovery — same Tempo Teams endpoint, same dedup logic

---

## Pitfalls to verify during implementation

| Pitfall | Check |
|---|---|
| Worklog response shape | Confirm `wl.issue.id`, `wl.timeSpentSeconds`, `wl.startDate` exist in live API response |
| Tempo pagination | Offset-based assumed; if Tempo returns `metadata.next` URL, follow that instead |
| API token scope | Token must have cross-user worklog read permission, not just self-access |
| `fmtDate_` availability | Confirm GAS load order puts `TempoPlanExport.js` before `TempoTrackedTime.js`, or that GAS hoists function declarations correctly (it does) |
