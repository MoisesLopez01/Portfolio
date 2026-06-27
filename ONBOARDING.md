# PS Contribution Report — PTO Data Reference

## Source sheet

| Setting | Value |
|---|---|
| Spreadsheet | `1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo` |
| Sheet name | `Accumulation Cost` |
| Team filter | Rows where **Department: Name** = `Services` |

---

## Required columns

| Column | Purpose |
|---|---|
| `Employee Number` | Join key — matches the `Employee Number` on the Roster |
| `Department: Name` | Department filter (only `Services` rows are loaded) |
| `Date` | Transaction date |
| `Balance` | Running PTO balance **after** this transaction (hours) |
| `Adjustment Type` | Transaction type — determines whether the row is usage or accrual |

### Adjustment Type classification

| Contains | Treated as |
|---|---|
| `usage` or `timeoff` | **PTO taken** (past) or **planned** (future) |
| `accru` | **Accrual** — hours earned |
| anything else | Balance-only snapshot; ignored in amount calculations |

> The report uses the **last record of each month** as the authoritative balance for that period.

---

## Transaction amount derivation

There is no separate Amount column. The hours for each transaction are derived from the **delta between consecutive sorted balance entries**:

```
usage amount  = balance[i-1] − balance[i]   (balance dropped → PTO taken)
accrual amount = balance[i] − balance[i-1]   (balance rose   → hours earned)
```

Rows are sorted by `Date` before delta computation, so sheet order does not matter.  
A delta that conflicts with the declared `Adjustment Type` (e.g., a "usage" row whose balance went *up*) is discarded.

If an explicit `Amount` or `Hours` column is present it takes precedence over the delta.

---

## PTO compliance rules

Evaluated per rocketeer per week. Rules are checked in order — first match wins.

### 1 · Negative balance → **Total compliance** ✅
Balance < 0 means the rocketeer has used more PTO than accrued.  
No further checks are performed.

### 2 · Balance < 100 h → **Good** ✅
Outstanding balance is under the threshold — PTO is under control.

### 3 · Balance ≥ 100 h — planning-quality check
Both conditions must be true for **Good**:

| Condition | Threshold |
|---|---|
| (Past 6 months taken) + (Next 6 months planned) ÷ Annual accrual | **≥ 80 %** |
| Past 6 months taken ÷ Annual accrual | **≥ 50 %** |

*Annual accrual* = sum of all accrual-type transactions in the past 12 months.  
*Past 6 months taken* = sum of usage transactions between `weekEnd − 6 months` and `weekEnd`.  
*Next 6 months planned* = sum of usage transactions between `weekEnd` and `weekEnd + 6 months`.

If either condition is not met → **At Risk**, with the specific gap shown in the reason string  
(e.g., `Balance 130h ≥ 100h · 12mo taken/planned 62% < 80%`).

### Fallback (no transaction amount data)
When delta amounts cannot be determined, the report falls back to the original signal:  
planned PTO booked within the next 6 months → **Good**; otherwise → **At Risk**.

---

## CONFIG constants (PS Contribution Report.js)

| Constant | Default | Meaning |
|---|---|---|
| `PTO_BALANCE_THRESHOLD` | `100` | Hours below which balance is automatically Good |
| `PTO_PLANNING_HORIZON_MONTHS` | `6` | Look-ahead window for planned PTO and 12-mo rule |

The 80 % / 50 % thresholds are hardcoded in `readPTOPlanningHealthByWeek_`.

---

## byEmployee output fields

Each week's `ptoHealth.byEmployee[norm]` object exposes these fields to the dashboard:

| Field | Type | Notes |
|---|---|---|
| `status` | `"Good"` \| `"At Risk"` | Compliance result |
| `reason` | string | Human-readable explanation |
| `balance` | number \| null | Latest balance on or before week end |
| `balanceAsOf` | YYYY-MM-DD \| null | Date of the balance snapshot |
| `annualAccrual` | number \| null | Sum of accruals in past 12 months (null if no data) |
| `pastSixTaken` | number \| null | Hours taken in past 6 months |
| `nextSixPlanned` | number \| null | Hours planned in next 6 months |
| `pct12mo` | number \| null | `(pastSixTaken + nextSixPlanned) / annualAccrual × 100` |
| `pctPast6` | number \| null | `pastSixTaken / annualAccrual × 100` |
