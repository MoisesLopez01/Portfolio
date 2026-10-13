# New RCR — FY27 direct rate on the same monthly axis

**Date:** 2026-10-13 (2026.W42) · **Status:** implemented · **Tests:** `tests/rcr-source-checks.js`

## Why

From July 2026 (FY27) RCR is published as a **direct per-person rate** in a new tab
of the Contribution Dataset spreadsheet, `New RCR`, instead of the derived
SUM(Revenue Contribution) / SUM(TCC A+B) ratio the dashboard computed from
`3. RCR` + `1. Revenue Contribution` + `2. TCC A+B`. The old tabs and their maths
stay as they are for the months they cover (FY26 and earlier). The dashboard has
to show the **latest month that has a rate**, feed it into the RCR KPI, the
Team Summary row, every per-rocketeer RCR cell, Top Rocketeers scoring and the
monthly trend — without the trend restarting at the fiscal-year boundary.

## Source shape — `New RCR`

| Column | Used as |
|---|---|
| `Internal ID` | primary roster join (roster profile `internalId`) |
| `Employee` | fallback join by `normPS_(name)` when the Internal ID is unknown |
| `2026.07 RCR`, `2026.08 RCR`, … `2027.06 RCR` | one column per month, the rate |
| Class, Job Level, Supervisor, Status, … | ignored — the roster already decides who is in scope |

Rows whose Internal ID and name both miss the roster are dropped (terminated
people the roster no longer carries). A month column with **no numeric value for
any roster member** is skipped, so a pre-created, still-empty column never
becomes "the latest month".

## Design

### One month axis, two sources

`rcrMonthFromHeader_()` turns both header spellings into the `"Mon YY"` label
the frontend already parses (`periodRcr_`, `perfRcrMonthKey_`, the quarter
grouping in the monthly chart): `"Jun 26"` stays `"Jun 26"`, `"2026.07 RCR"`
becomes `"Jul 26"`, both with a numeric `sortKey = year*12 + month`. Nothing in
`PS Dashboard.html` had to change to read the new months.

`readRCR_PS_` reads `3. RCR` (source `"ratio"`) and `New RCR` (source `"rate"`)
into per-month value maps, merges them by `sortKey` and sorts. **A month both
tabs carry resolves to the New RCR rate** — the FY27 definition wins — and the
log notes it.

### Team value for the latest month

| Latest month comes from | Team RCR | `exact` | `meta.rcrMethod` |
|---|---|---|---|
| `3. RCR` | SUM(RC)/SUM(TCC) over the Employee-ID bridge, individual mean as the documented fallback | true only for the SUM/SUM figure | `"sum-ratio"` |
| `New RCR` | mean of the tracking-mandated subset's rates (`rcrActive`) | true — the rate is the metric, there is no ratio to reconcile against | `"direct-rate"` |

History points: legacy months keep "mean of individual values, approx" (unless
they are the latest month); rate months are exact by definition. Each history
entry now also carries `source`. `byEmployee` / `rcrByEmployee` cover every
active roster member as before; the team aggregate scopes to `teamSubset`.

### What the user sees

- KPI tooltip and the Team Summary tooltip say which maths produced the number,
  keyed on `meta.rcrMethod`.
- 📖 Documentation: the RCR metric card and the scoring-source row name both
  tabs and the Jul 26 switch-over.
- The PDF/brief "approx — true RCR is SUM(RC)/SUM(TCC)" wording only appears
  for legacy, non-latest months, because `exact` is true for rate months.

## Invariants

- The history window is still `CONFIG_PS.RCR_HISTORY_MONTHS` newest months,
  counted across both sources.
- `emptyRcrResult_()` carries `method: null`; R&D / Sales teams (no `rcr`
  metric) are unchanged.
- `exact: true` on a rate month is deliberate: marking it approx would make the
  frontend claim a SUM/SUM "true RCR" that does not exist for FY27.

## Not done here

- No clasp push / deploy. Deploy order stays ticket → push → `clasp deploy -i …`.
- Thresholds (`RCR_CRITICAL` 1.0 / `RCR_WATCH` 1.5 / `RCR_HEALTHY` 2.5) are
  unchanged; if the FY27 rate sits on a different scale, those constants and the
  2.5 scoring cap are the places to revisit.
