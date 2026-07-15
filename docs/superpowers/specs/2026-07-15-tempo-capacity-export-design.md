# Tempo Capacity Export — Design

**Date:** 2026-07-15 (2026.W29)
**File to build:** `TempoCapacityTime.js` (new, standalone GAS file in the same project as `TempoPlanExport.js`)
**Output:** `Capacity Tempo` sheet tab in the active spreadsheet
**Purpose:** Persistent per-rocketeer, per-ISO-week capacity hours from Tempo work schedules, enabling **utilization = Tracked ÷ Capacity** joined on (User, Week) against `Tempo Tracked Time`.

---

## 1. Goals & constraints

- Capacity comes from each person's **Tempo work schedule** (`requiredSeconds` per day) — respects part-time schedules, regional holidays, Sun–Thu weeks. Never a flat 40 h assumption.
- **Past weeks are immutable.** Once a week column falls behind the refresh window it is never rewritten.
- **Future weeks are refreshed weekly** (Friday trigger): the next `FUTURE_WEEKS` (4) full ISO weeks are re-fetched and overwritten each run.
- New rocketeers appear mid-stream as new rows (blank past cells); leavers keep frozen history.
- Reuse `TempoPlanExport.js` infrastructure — no changes to that file.

### Decisions locked with the user (2026-07-15)

| Decision | Choice |
|---|---|
| Storage shape | **Wide sheet, merge-in-place** — one sheet, User rows × ISO-week columns, merged each run |
| Refresh window | **Future weeks only** — next Monday onward; the current week freezes with what last Friday's run captured |
| Row identity | **Account ID column (hidden, col A) + User display name (col B)** — merge keys on MERGE_MAP-effective accountId; name refreshed each run |
| First-run bootstrap | **Attempt historical backfill** from `BACKFILL_FROM` when the sheet is empty; blanks if the API refuses |

---

## 2. Tempo endpoint

**Primary:** `GET https://api.tempo.io/4/user-schedule/{accountId}?from=YYYY-MM-DD&to=YYYY-MM-DD`
Response: `results: [{ date: "YYYY-MM-DD", requiredSeconds: 28800, type: "WORKING_DAY" | ... }]`.

Notes:
- The originally proposed `/4/capacity/users/{accountId}` is **not** a documented Tempo v4 endpoint. Implementation order: try `user-schedule`; on 403/404 for a probe user, fall back to the `/4/capacity/users/` path; if both fail, **abort loudly without touching the sheet**. No silent 40 h placeholder.
- `_probeCapacityEndpoint_()` diagnostic: fetches one worker's schedule for one week and logs status + first result, for one-time verification from the GAS editor.
- `user-schedule` generally returns **past dates** (the future-only restriction applies to *plans*, not schedules) — this is what makes first-run backfill and gap self-heal possible. If a workspace refuses past dates, those cells simply stay blank.

**Request strategy:** one request per worker covering the **whole fetch window** (not per worker × week). Daily `requiredSeconds` are bucketed into ISO weeks locally via `isoWeekLabel_()`. Requests are batched through `UrlFetchApp.fetchAll` in `CONFIGPlan.API_BATCH_SIZE` chunks. ~1 request/worker/run (~60 total) instead of ~300.

---

## 3. Fetch window

Let `nextMonday` = the Monday strictly after the run date (a Friday run in 2026.W29 → Monday of 2026.W30).

| Situation | `from` | `to` |
|---|---|---|
| Normal run (sheet has data) | `min(nextMonday, Monday after last stored week)` | Sunday of week `(nextMonday's week + FUTURE_WEEKS − 1)` |
| First run (no data rows) | `parseDateLocal_(CONFIGCap.BACKFILL_FROM)` | same as above |

- Normal case: last stored week is ahead of today (it was a future week last Friday), so `from = nextMonday` → next 4 future weeks.
- **Gap self-heal:** if Fridays were missed and stored data ends early, `Monday after last stored week < nextMonday`, so the window extends back to cover the gap. Gap weeks have no stored data, so filling them never violates the freeze rule.

**Freeze rule (precise):** for any week column, *stored value wins if the week starts before `from`; fetched value wins if the week starts on/after `from`*.

Weeks are enumerated with the existing `buildWeekRanges_(from, to)` (Monday-aligned; `from` is always a Monday by construction except backfill, where `BACKFILL_FROM` must be set to a Monday — same convention as `CONFIGPlan.FROM_DATE`).

---

## 4. Sheet layout

```
        A (hidden)      B         C ...                     last
Row 1:  ""              ""        2026.W14 ... 2026.W33     ""
Row 2:  Account ID      User      Mar 30 - Apr 05 2026 ...  Total (hrs)
Row 3+: 712020:abc...   Alice     40  40  32 ...            412.5
Footer: ""              TOTAL     (column sums)             (grand total)
```

- Row 1 = ISO labels (`YYYY.WNN`), row 2 = date-range labels — same two-row header pattern as `Planned Time Tempo`, extended by the Account ID column.
- Column A hidden via `sheet.hideColumns(1)`; frozen rows = 2, frozen columns = 2.
- Header/footer styling reuses `CONFIGPlan.HEADER_BG / HEADER_FONT / TOTAL_ROW_BG`.
- Rows sorted by User display name. Week columns sorted by ISO label (zero-padded `YYYY.WNN` sorts correctly lexically).
- `Total (hrs)` = sum of **all** week cells in the row, recomputed every run. Values rounded with `round2_()` at write time only.
- Cell semantics: **blank = unknown** (not fetched / person not present), **0 = scheduled zero hours**. The distinction matters for utilization denominators — consumers must skip blanks, not treat them as 0.

---

## 5. Run algorithm (`fetchTempoCapacity`)

1. **Read back** the existing sheet (if present) into `{ accountId → { name, weeks: {iso → hrs} } }` plus the ordered stored ISO-column list. Malformed/legacy sheet (missing Account ID header) → treat as empty (backfill mode) and log ⚠️.
2. **Compute window** per §3.
3. **Workers:** `fetchAllTeamMembers_(tempoToken)` (same `EXCLUDE_IDS` + injected `MERGE_MAP` secondaries), `fetchUserNames_()` for display names. MERGE_MAP secondaries accumulate into the primary's row.
4. **Fetch** each worker's schedule for the window (batched); bucket daily seconds → `iso → hours`.
5. **Merge in memory** — `mergeCapacityGrid_(existingRows, fetchedByUser, windowWeeks)`, a **pure function** (no Sheets/UrlFetch):
   - Column set = stored weeks ∪ window weeks, ISO-sorted.
   - Per freeze rule: stored values for pre-window weeks, fetched values for window weeks.
   - Users in fetch but not sheet → appended (blank past). Users in sheet but not fetch (leavers) → row kept, window cells blank.
   - Display name: fetched name wins; keep stored name if lookup failed.
6. **Write once:** full grid in a single `setValues()` after all fetching succeeds, then footer, formatting, hide column A. The sheet is never cleared before the merged grid is ready — a failed run cannot corrupt stored history.

**Error handling:**
- Per-user non-200 → ⚠️ log + counter; that user's window cells stay blank (do not zero them).
- All requests failed, or teams/credentials fetch failed → ❌ log + `throw`; sheet untouched.
- `getCredentials_()` reused — same Script Properties, no new secrets.

---

## 6. New vs reused code

**Reused as-is** (GAS global scope, from `TempoPlanExport.js`): `getCredentials_`, `fetchAllTeamMembers_`, `fetchUserNames_`, `buildWeekRanges_`, `isoWeekLabel_`, `formatWeekLabel_`, `parseDateLocal_`, `fmtDate_`, `minDate_`, `round2_`, `MERGE_MAP`, `EXCLUDE_IDS`, `CONFIGPlan.API_BATCH_SIZE` + color constants.

**New in `TempoCapacityTime.js`:**

| Unit | Purpose |
|---|---|
| `CONFIGCap` | `SHEET_NAME: "Capacity Tempo"`, `FUTURE_WEEKS: 4`, `BACKFILL_FROM: "2026-03-30"` (a Monday), `TRIGGER_HOUR: 8` |
| `fetchTempoCapacity()` | Entry point (§5) |
| `computeCapacityWindow_(existingIsoWeeks, today)` | Window math incl. gap self-heal (pure) |
| `readCapacitySheet_()` | Sheet → in-memory model |
| `fetchSchedulesForWindow_()` | Batched user-schedule fetch + weekly bucketing |
| `mergeCapacityGrid_()` | Pure merge (§5.5) |
| `writeCapacitySheet_()` | Grid + footer + formatting + hide col A |
| `createCapacityWeeklyTrigger()` | One-time setup: delete prior `fetchTempoCapacity` triggers, install **Friday @ `TRIGGER_HOUR`** |
| `_probeCapacityEndpoint_()` | One-off endpoint verification diagnostic |
| `_test_capacityMerge_()`, `_test_capacityWindow_()` | Node-runnable unit tests (stubbed `Logger`), covering: freeze boundary, new-hire append, leaver row retention, gap self-heal, empty-sheet backfill, name refresh, blank-vs-zero semantics |

---

## 7. Failure / edge cases

| Case | Behavior |
|---|---|
| Same-day manual re-run | Idempotent — same window, same overwrite |
| 1–3 missed Fridays | Gap self-heal backfills missing weeks on next run |
| Endpoint not available in workspace | Fallback path tried, then loud abort; sheet untouched |
| Jira display-name change | Same row (accountId key), label updates |
| Duplicate accounts | `MERGE_MAP` merges secondary into primary row |
| Person leaves all Tempo teams | Row + history kept; future cells blank |
| Partial API failures | Affected users' window cells blank; run completes with ⚠️ count |

---

## 8. Out of scope (later phases)

- The utilization computation/join itself (PS dashboard or a `Utilization` sheet) — consumers join `Tempo Tracked Time` ÷ `Capacity Tempo` on (User, ISO week), skipping blank capacity cells.
- Any changes to `TempoPlanExport.js` or `TempoTrackedTime.js`.
- Holiday-source cross-checks (Tempo schedules already embed holiday calendars).
