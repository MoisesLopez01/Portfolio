# Source Status ledger — design

- **Date:** 2026-11-09 (2026.W46)
- **Project:** `ps-dashboard` (container-bound Apps Script, timezone America/Guatemala)
- **Status:** implemented on branch docs/source-status-ledger (2026.W46); pending deploy and live validation

## 1. Problem

The PS Dashboard reads its data sources from four workbooks but cannot say how fresh any of them is.

- The Data Reference "Data Sources" table (`PS Dashboard.html:1976-1989`) is static text. It labels Planned as "daily" (its trigger runs Mondays) and omits Compensation.
- The header pill (`#dataFreshnessNote`, filled at `PS Dashboard.html:3381-3409`) shows the Drive `getLastUpdated()` of the bound spreadsheet only, and borrows the Tracked "Last Export:" stamp for Planned.
- Roster, Goals and PTO live in other workbooks and have no stamp at all.
- Only `TempoTrackedTime.js` writes a stamp. `TempoPlanExport.js` stamps only "Tempo Users"; `TempoCapacityTime.js` and `Kudos.js` stamp nothing.
- No code sends email. The Capacity trigger stopped silently for seven weeks around 2026.W39 and nobody was told.

## 2. Goal

Each data source produces its own freshness record, in one visible place that people and other projects can use as a reference. The dashboard renders those records. When Goals or any Tempo export fails or goes stale, the owner gets an email on Monday.

### Non-goals

- Changing how any source's data is read or computed (for example, adding the FY27 "New RCR" tab — noted as a separate gap).
- Writing anything into the Roster, Goals, PTO or Compensation workbooks. They stay read-only.
- Backfilling history. The ledger holds the current state per source, not a log.

## 3. The `Source Status` ledger

A tab named `Source Status` in the bound dashboard spreadsheet. One row per source, overwritten in place.

| Column | Meaning |
|---|---|
| `Source` | stable key: `tempo_tracked`, `tempo_plan`, `tempo_capacity`, `goals`, `pto`, `roster`, `kudos`, `si`, `rcr`, `digest` |
| `Label` | display name, e.g. "Tempo Capacity" |
| `Covers period` | what the data covers, e.g. `FY27Q2`, `Oct 26`, `2026.W46` |
| `Last updated` | timestamp of the last real update (successful run or qualifying edit) |
| `Last checked` | timestamp of the last time anything evaluated this row |
| `Status` | `ok` · `pending` · `stale` · `failed` |
| `Detail` | row count, error message, or reason for the status |
| `Next expected` | date the next update is due, if known |

Rules:

- Columns are found by header name; rows by `Source` key. If the tab is missing, the helper recreates it with headers. The tab is created with one pending row per source.
- On first install every row is `pending` with detail `awaiting first update`. No row is seeded from older stamps.
- `Status` is stored at write time **and** recomputed at read time from `Last updated` and the thresholds in §4, so a source that stops updating becomes `stale` without anything running.
- Thresholds and the digest recipient list live in a `SOURCE_STATUS` config object, each value overridable by a Script Property (see "Script Properties" below).
- Rule-row freshness (`checkStaleHours`): Roster, Small Improvements and RCR rows are stale after 50 h without a check, and the digest row after 192 h (not overridable). A rule row that `checkSourcesDaily` stops refreshing therefore turns stale by itself.

## 4. Per-source rules

| Source | Writer | Stamped when | Status rule | In Monday email |
|---|---|---|---|---|
| Tempo Tracked | `fetchTempoLoggedTime` (daily 06:00) wrapped by `withSourceStatus_` | each successful run | `failed` if the run throws; `stale` after 26 h without success | yes |
| Tempo Plan | `fetchTempoPlannedTime` (daily; the live trigger was added by hand on the Triggers page) wrapped | each successful run | `failed` if it throws; `stale` after 26 h without success | yes |
| Tempo Capacity | `fetchTempoCapacity` (Fri 08:00) wrapped | each successful run | `failed` if it throws; `stale` after 8 days | yes |
| Goals | installable on-edit trigger on the Goals workbook (`1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ`), tab `RD` | a user edit touches rows whose `Fiscal Quarter` is the evaluated quarter | `stale` after 7 days without a qualifying edit; `failed` if the tab or `Fiscal Quarter` column cannot be read | yes |
| PTO | installable on-edit trigger on the PTO workbook (`1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo`), tab `2023 RD` | a user edit intersects `A2:N` | `ok` while the last edit is ≤ 15 days old; `stale` after 15 days; `failed` if the tab cannot be read | no |
| Roster | `checkSourcesDaily` | the fingerprint (row count + hash of all values) of `Data` in the Roster workbook changes | informational: `ok` once stamped; `failed` if unreadable | no |
| Kudos | `runKudosNormalizer` wrapped | each successful run | informational: `ok` once stamped; `failed` if it throws | no |
| Small Improvements | `checkSourcesDaily` (rule) | n/a — fixed date | `ok` from quarter end + 14 days (FY27Q1 → 2026-10-14, 2026.W42; FY27Q2 → 2027-01-14, 2027.W02); `pending` before | no |
| RCR | `checkSourcesDaily` (rule + read of `3. RCR`) | the newest month column gains values | covers through the month end; `pending` until Finance fills the month's column; never `stale` on data age (only the 50 h check-freshness rule applies). Month headers must be "Mon YY" (same as `readRCR_PS_`); months after the last closed month and all-zero columns are ignored | no |
| Digest | `sendSourceHealthDigest` | each send or deliberate silence | `failed` if `MailApp` throws | n/a |

### Evaluated quarter for Goals

Use `computeFiscalContext_` (`PS Contribution Report.js:1551-1645`): `goalsQuarter` (e.g. `FY27Q2`). During the 21-day grace window (`GOALS_GRACE_DAYS`) the previous quarter also qualifies, matching how the dashboard already reads goals.

## 5. Components

| Unit | File | Responsibility |
|---|---|---|
| `SOURCE_STATUS` config + `recordSourceStatus_(key, fields)` | new `SourceStatus.js` | find or create the row, write fields (no script lock) |
| `withSourceStatus_(key, fn)` | `SourceStatus.js` | run `fn`; on success write `ok` + time + run duration (not row count); on throw write `failed` + message, then rethrow |
| `evaluateSourceStatus_(def, row, now)` | `SourceStatus.js` | pure: apply §4 thresholds, return status + next expected |
| `onWatchedEdit(e)` | `SourceStatus.js` | shared edit handler for Goals and PTO, configured per workbook as tab + range + key (+ quarter test for Goals). It is public because installable triggers cannot call private (trailing-underscore) functions; it acts only on a live `Range` and is allow-listed in `tests/callable-surface-checks.js` |
| `checkSourcesDaily()` | `SourceStatus.js` | runs `runSourceChecks_`: trigger check, Goals/PTO probes, Roster fingerprint, SI, RCR. Each step is isolated, so one failing step does not stop the others. The digest and the preview re-run `runSourceChecks_` and still send if checks partly fail, adding "Checks that could not run: …" |
| `readSourceStatus_()` | `SourceStatus.js` | read the ledger once, recompute status, return `meta.sources` |
| `sendSourceHealthDigest()` / `previewSourceHealthDigest()` | new `SourceDigest.js` | build and send the Monday email; preview sends to the owner regardless of state |
| `installSourceStatusTriggers()` | `SourceStatus.js` | create the four triggers in §7; idempotent (removes duplicates by handler name) |
| Wrapping the producers | `TempoTrackedTime.js`, `TempoPlanExport.js`, `TempoCapacityTime.js`, `Kudos.js` | each trigger entry calls the existing body through `withSourceStatus_` |
| Dashboard rendering | `PS Contribution Report.js` (payload), `PS Dashboard.html` (Data Reference table, header pill) | consume `meta.sources` |

## 6. Dashboard changes

- The payload build calls `readSourceStatus_()` once and caches `meta.sources` with the report.
- Data Reference: the static Metric / Source / Cadence table becomes a live table — source · period covered · last updated · status lozenge · next expected. Compensation is shown through the RCR label "RCR · revenue ÷ compensation (TCC)"; Planned shows its real weekly cadence.
- Header pill: "All sources current" (or "↻ Data freshness: pending" when nothing has been stamped yet, i.e. every shown source is pending), or the names of the sources that are not, e.g. "Capacity stale · Goals stale". It no longer borrows the Tracked stamp for Planned.
- Dates are shown with ISO weeks: `2026-11-02 (2026.W45)`.
- Status lozenges follow the brand skill: `ok` success, `pending` neutral, `stale` warning, `failed` danger.

## 7. Triggers

| Handler | Type | Schedule |
|---|---|---|
| `onWatchedEdit` | installable on-edit, Goals workbook | on user edit |
| `onWatchedEdit` | installable on-edit, PTO workbook | on user edit |
| `checkSourcesDaily` | time-based | daily 05:00 |
| `sendSourceHealthDigest` | time-based | Monday 10:00 |

The existing Tempo triggers are unchanged; only their entry functions are wrapped. The owner who runs `installSourceStatusTriggers` must have **edit** access to the Goals and PTO workbooks — Apps Script requires it to install an edit trigger on a spreadsheet. Installable edit triggers fire only for edits a person makes in the Sheets UI; both workbooks are updated by manual paste, so this fits.

## 8. Monday email

- Sends only when Goals or any Tempo row is `failed` or `stale` after re-evaluation at send time. A clean week sends nothing and stamps the `digest` row `ok · nothing to report`.
- Recipients: the script owner by default; Script Property `SOURCE_DIGEST_RECIPIENTS` (comma-separated) overrides.
- Subject: `PS Dashboard sources: <n> need attention (<ISO week>)`.
- Body: one line per problem source — status, last good update with ISO week, detail, and the action (e.g. "Run `fetchTempoCapacity` from the editor"; "Goals RD has no FY27Q2 edits since 2026-10-30 (2026.W44)"), then a link to the dashboard: Script Property `SOURCE_DASHBOARD_URL`, else the web-app URL (no deep link to the Data Reference tab).

## 9. Failure handling

- A ledger write never breaks a producer: errors writing `Source Status` are logged and swallowed. Producer errors are recorded and rethrown, so Apps Script's own failure notice still fires.
- No script lock: the project's script lock is held for minutes by the hourly Jira tracker. The tab is seeded with one row per source at creation, so each writer overwrites only its own row; a rare duplicate from a concurrent first write is resolved last-row-wins.
- The edit handler exits immediately when the edit is outside the watched tab or range. For Goals it reads `Fiscal Quarter` only for the edited rows. A full-tab paste is one edit event.
- The daily check compares `ScriptApp.getProjectTriggers()` against the expected handlers. A missing trigger marks its source `failed` with detail "Trigger missing: run <installer>", where the installer is `createLoggedDailyTrigger`, `createCapacityWeeklyTrigger` or `installSourceStatusTriggers`; Tempo Plan instead says "add a daily fetchTempoPlannedTime trigger on the Triggers page", because its daily trigger was made by hand and `createWeeklyTrigger` would make it weekly — this catches the 2026.W39 silent-stop pattern at its cause. `getProjectTriggers()` only sees the current user's triggers, so the check runs only for the account stored in `SOURCE_TRIGGER_OWNER`; the installer sets it and refuses to run under another account.
- A digest send failure is written to the `digest` row so it is visible on the dashboard.

## Script Properties

- `SOURCE_LEDGER_SS_ID` — spreadsheet holding the `Source Status` tab, when it is not the bound workbook.
- `SOURCE_TRIGGER_OWNER` — account whose triggers the missing-trigger check can see; set by the installer.
- `SOURCE_ROSTER_FP` — last Roster fingerprint (row count + hash).
- `SOURCE_DIGEST_RECIPIENTS` — comma-separated digest recipients.
- `SOURCE_DASHBOARD_URL` — link used in the digest.
- `SOURCE_STALE_HOURS_<KEY>` — per-source stale threshold override; used only when > 0.

## 10. Validation

### Unit tests (Node, `tests/`)

- Status thresholds: 26 h, 8 days, 7 days, 15 days — at, just under, just over.
- SI availability date: quarter end + 14 days across a fiscal-year rollover.
- RCR stays `pending` until the newest month column has values; never `stale`.
- Goals edit qualification, including the grace window and a paste spanning several quarters.
- PTO edit qualification: inside and outside `A2:N`, header row excluded.
- ISO week labels, including a 53-week year.
- Digest rule: sends only for Goals/Tempo problems; silent when only Roster, PTO, Kudos, SI or RCR are off.
- `withSourceStatus_` records `failed` and rethrows; a throwing ledger write does not fail the producer.

### Proof by real updates (definition of done)

Every row starts `pending · awaiting first update` and counts as validated only when a real event stamps it.

| Source | Validating event | Expected by |
|---|---|---|
| Tempo Tracked | daily 06:00 run | 2026-11-10 (2026.W46) |
| Tempo Capacity | Friday 08:00 run | 2026-11-13 (2026.W46) |
| Tempo Plan | daily run | 2026-11-10 (2026.W46) |
| Goals | next manual paste into `RD` touching FY27Q2 rows | next paste |
| PTO | next manual paste into `2023 RD`!A2:N | next paste |
| Roster | next HRIS export that changes `Data` | next export |
| Kudos | next `runKudosNormalizer` run | next run |
| SI / RCR | `checkSourcesDaily` 05:00 | 2026-11-10 (2026.W46) |
| Digest | first scheduled send, or correct silence | 2026-11-16 (2026.W47) |

`previewSourceHealthDigest()` lets the owner see the email format on day one.

## Known follow-ups

- (a) A broken ledger (missing column) renders the same as "not installed".
- (b) A Tempo run that returns zero rows is stamped ok.
- (c) The dashboard's `readRCR_PS_` still counts an all-zero month column as populated, unlike the ledger.

## 11. Open items for planning

- Confirm the trigger owner has edit access to the Goals and PTO workbooks.
- Confirm the `2023 RD` tab name and `A2:N` range at install time (headers read once and logged).
- Decide whether the FY27 "New RCR" tab gap (`Contribution.js:22, 561-617` reads it; the dashboard does not) gets its own spec.
