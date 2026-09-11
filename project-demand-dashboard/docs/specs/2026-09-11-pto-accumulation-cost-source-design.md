# PTO source replacement — Accumulation Cost as the single source

**Date:** 2026-09-11 (2026.W37)
**Project:** `project-demand-dashboard`
**Status:** Approved, pending implementation plan
**Portability:** Section 9 is written for reuse — another project adopting this
reader should start there.

---

## 1. Why — the Tempo export does not retract cancelled leave

The dashboard currently derives all PTO from rows in the Tempo exports whose
project key is `NETSUITE` (time off synced from NetSuite into Tempo).

**Those rows go stale.** When someone books leave and later cancels it, the
Tempo export keeps the original planned row. Nothing retracts it. The result is
*ghost PTO*: hours deducted from capacity for leave that was never taken.

This is a correctness problem, not a modelling preference. The current numbers
understate available capacity by an unknown, unbounded amount, and the error is
invisible — a ghost row looks exactly like a real one.

The **Accumulation Cost** sheet is the NetSuite leave ledger and is **refreshed
weekly in full**. A cancelled booking disappears from it. It also carries what
the dashboard needs directly: a dated `Usage` transaction with an explicit hours
amount, including **future-dated rows for approved-but-not-yet-taken leave**.

Accumulation Cost therefore replaces the `NETSUITE` rows outright. This is a
full replacement, not a blend: keeping both sources would reintroduce the stale
rows we are removing.

## 2. Scope

**In scope:** the producer of PTO records, the roster join key it needs, the
downstream simplification that falls out, the failure surface, tests, cache.

**Out of scope:** the Utilization panel's presentation, the holiday model
(`PH` tab), the capacity base-hours rules (38 ANZ / 40 else), project demand
parsing. None of these change behaviour.

## 3. Architecture — one producer swapped, every consumer untouched

There are exactly four consumers of PTO records today:

| Consumer | Location | Uses |
| --- | --- | --- |
| `model.timeOffByWeek` | `Code.js:405` | team capacity deduction |
| `personWeekPTO` | `Code.js:495` | per-person availability → `utilAdjustCap_` |
| `netsuiteByPersonWeek_` → `buildHolidaysByWeek_` | `Code.js:409` | public-holiday double-count guard |
| `parsed.ptoRecs` | `Code.js:205` | `debugDroppedPeople` person list |

The new reader emits the **same record shape** those consumers already accept —
`{ person, iso, key, hours }` — so none of their logic changes. The swap happens
at `Code.js:402`, where `scopedPtoRecs` stops coming from the Tempo parse and
starts coming from `readPTOUsage_()`.

### 3.1 What must NOT change

`CONFIG.NONPROJECT_KEYS = ["NETSUITE"]` **stays exactly as it is.** Those rows
must still be excluded from *project demand* (`Code.js:2077`) — time off is not
a project. We stop *consuming* the `ptoRecs` they produce and discard them.

Removing the exclusion instead would silently convert every hour of company-wide
time off into billable project demand. This is the single most damaging mistake
available in this change.

## 4. The reader — `readPTOUsage_(rosterProfiles, weeks)`

New CONFIG entries:

```js
PTO_ACCUM_SS_ID: "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
PTO_ACCUM_SHEET: "Accumulation Cost",
```

Both overridable by Script Property, per the `wfp-data-sources` house rule that
a moved file is a settings change, not a deploy.

### 4.1 Columns

Looked up by exact-normalized header match — port `findCol_PTO_` from
`ps-dashboard/PS Contribution Report.js:1810`, which strips non-alphanumerics so
`Department: Name` and `Employee Number` match regardless of punctuation.

| Field | Header | Required |
| --- | --- | --- |
| Employee number | `Employee Number` | yes |
| Transaction date | `Date` | yes |
| Transaction type | `Adjustment Type` | yes |
| Hours | `Amount` → `Hours` → `AdjustmentAmount` → `AdjustmentHours` (first match) | **yes** |
| Department | `Department: Name` | ignored — see 4.4 |

**A missing hours column is a hard error** that lists the headers actually
found. There is deliberately **no fallback to balance deltas**. The PS report
derives amounts from consecutive balance differences when no explicit column
exists (`PS Contribution Report.js:2495-2510`); that arithmetic is acceptable
under a *balance* display and unacceptable under a *capacity denominator*. If
the hours column ever disappears, this must fail loudly rather than silently
approximate.

### 4.2 Row filter

Keep only rows whose `Adjustment Type`, normalized by stripping non-alphanumerics
and lowercasing, matches `usage` or `timeoff` — the same test the PS reader uses
(`PS Contribution Report.js:2446`).

`Accrual`, `Carryover` and `Year End Expiry` are ignored entirely. This tool
measures absence, not balance.

Hours are parsed with a ported `parseSmartFloat_PTO_`
(`PS Contribution Report.js:1817`) and taken as an **absolute value** — usage may
be recorded signed-negative.

### 4.3 Bucketing

`Date` → `isoWeekYear_()` + `isoWeekNum_()` (both already in `Code.js:78-91`) →
a `YYYY.WN` label. Hours are summed per person per ISO week. Rows outside the
8-week window (`WEEKS_PAST: 3` + current + `WEEKS_FUTURE: 4`) are dropped before
returning.

Future-dated `Usage` rows are what make the forward half of the window work.
They are ordinary rows and need no special handling — noted only because the
forward view silently empties if a future filter is ever added.

### 4.4 The join, and why the roster is the authority

Accumulation Cost keys on **Employee Number**. Everything else in this dashboard
keys on a **normalized name** from the Tempo exports. The roster bridges them.

The roster reader (`Code.js:834`) currently captures Name, Class, Department,
Employee Status, Termination date, Key Location, Job Family, Job Title and
Supervisor — but **not** `Employee Number`. It gains `col("Employee Number")` on
each `profiles[]` record, from which an `empNum → normName` map is built.

Services scoping stays the roster's job, via the existing predicate
`prof.department === CONFIG.ROSTER_DEPT` (`scopeRecsToServices_`, `Code.js:178`).
The sheet's own `Department: Name` column is **deliberately ignored** so there is
exactly one authority for who counts as Services. Two independent department
filters would drift.

Employee numbers with no roster match are **counted and reported**, never
silently dropped (`wfp-data-sources` house rule 5).

## 5. Crew and contractors — correct by construction

Crew/contractors count toward the capacity denominator (a `Contractors Data` row
with Department = Services adds its base hours, `Code.js:878-881`), but they
**do not accrue PTO**. They are an exception to PTO entirely; they receive public
holidays only.

This needs no special case:

- **No personal leave** → no Accumulation Cost rows → nothing deducted. Correct.
- **Public holidays** → come from the `PH` tab. A crew member has no booked hours
  in `netsuiteByPersonWeek_`, so the guard at `Code.js:1082` sees `booked = 0`
  and deducts the **full** holiday. Correct.

Zero PTO records for a crew member is a correct result, not a data gap, and must
not be reported as one.

## 6. Public holidays — the de-dup guard survives

Accumulation Cost `Usage` rows cover **both** personal leave and public holidays
for FTEs. This maps 1:1 onto the behaviour of the `NETSUITE` rows they replace,
so `buildHolidaysByWeek_` and its double-count guard keep working unchanged —
only their input changes.

The two populations resolve correctly through the same mechanism:

| Population | Holiday booked in Accumulation? | Guard sees | Deduction |
| --- | --- | --- | --- |
| FTE | yes | `booked > 0` | PH shortfall only — no double count |
| Crew | no | `booked = 0` | full holiday from PH |

## 7. A simplification falls out

The planned-vs-tracked de-dup exists **only** because the same leave appeared in
two Tempo sheets (booked ahead, then logged as actual). With one source it is
dead weight and is removed:

- `Code.js:482-484` — the `source: 'planned' | 'tracked'` tagging.
- `Code.js:1963-1982` — `personWeekPTOBySource` and the `Math.max(pl, tr)`
  reconciliation, which collapses to a plain sum.

Roughly 20 lines removed, including the subtlest reconciliation in the file.

## 8. Failure mode — a dead source must look dead

Today a failed PTO read yields zero PTO everywhere: capacity reads high with no
visible symptom. That is the same class of silent error this change exists to
fix, so the replacement must not inherit it.

`readPTOUsage_` returns `{ recs, error }` and sets `model.ptoError`, surfaced in
the UI exactly like the existing `trackedError` and `capError`. A PTO source that
is unreachable must look broken — never like a week in which nobody took leave.

The reader is otherwise fail-soft in the established style: one
`getDataRange().getValues()` per tab, wrapped in try/catch, read-only.

## 9. Porting to another project

The reader is deliberately self-contained. To adopt it elsewhere, take:

1. The two CONFIG entries (4).
2. `readPTOUsage_`, plus the ported `findCol_PTO_` and `parseSmartFloat_PTO_`.
3. An `empNum → normName` map from that project's own roster read (4.4).

The contract it depends on, which is **not** yet documented in the
`wfp-data-sources` skill:

| Source | Spreadsheet ID | Tab | Grain | Key |
| --- | --- | --- | --- | --- |
| PTO accumulation | `1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo` | `Accumulation Cost` | one row **per leave transaction** | Employee Number |

Columns: `Employee Number`, `Department: Name`, `Date`, `Balance`,
`Adjustment Type`, plus an explicit hours column.

Traps worth carrying across:

- **`Adjustment Type` is the whole filter.** A reader that forgets it sums
  accruals into absence and inverts the answer.
- **Future-dated `Usage` rows are real** — approved leave lands before it is
  taken. Any date filter capped at today silently empties the forward view.
- **Contractors are absent by design** (5). Absence of rows is not a gap.
- **Refreshed weekly in full**, which is exactly why it is preferred over the
  Tempo `NETSUITE` rows (1).

**Follow-up (separate change):** add this row and these traps to the
`wfp-data-sources` skill, so the next project inherits them without reading this
spec. Not done here to keep this change reviewable.

## 10. Testing

Four existing blocks build `NETSUITE` fixtures and are rewritten against
Accumulation-shaped rows: `Code.js:2254`, `2326`, `2587`, `2766`.

`2766` is the block that matters — it covers the holiday de-dup, where a mistake
would hide rather than fail. It must retain:

- a booked FTE holiday deducting **once**, not twice;
- a crew member's holiday deducting **in full**.

New coverage:

| Case | Asserts |
| --- | --- |
| `Usage` rows only | accrual/carryover/expiry never reach capacity |
| Future-dated usage | forward weeks carry PTO |
| Signed-negative hours | absolute value taken |
| Missing hours column | hard error naming the headers found |
| Unmatched employee number | counted and reported, not dropped |
| Crew member | zero PTO, full PH holiday |
| Missing sheet | `model.ptoError` set, not a silent zero |

`2587` currently asserts the planned/tracked `Math.max` behaviour removed in (7);
it is replaced by a plain-sum assertion rather than deleted, so the aggregation
stays covered.

## 11. Cache

The payload shape changes, so `bustDemandCache_()` bumps `PD_CACHE_VER`
(`Code.js:263-271`) on deploy. Without it, warm entries serve the old shape and
the symptom is not an error — it is a panel rendering empty because an accessor
reads a field the cached payload predates.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| `NONPROJECT_KEYS` exclusion removed along with the PTO consumption | Called out in 3.1; test at `2277` already asserts `NETSUITE` never becomes a project rec — keep it |
| Hours column renamed upstream | Hard error listing found headers (4.1) |
| Roster row missing an Employee Number | Counted and reported (4.4) |
| PTO totals shift visibly on release | Expected — ghost PTO is being removed. Capacity should read *higher*, and that is the fix, not a regression |

The last one deserves a note in the release: numbers will move, and the
direction is known in advance.
