# CPR Pace & Consistency v1 (Goals Compliance Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PTO-adjusted Comment Pace Ratio (CPR) + Activity Ratio signal to the Goals Compliance Dashboard, classified against an empirical peer band, surfaced in the individual drill-down.

**Architecture:** Backend-only computation in `goalCompliance.js` (new pure helpers + one new sheet reader), wired into the existing `buildComplianceData_` finalize pass; the payload gains `emp.paceMetrics` per employee and a top-level `paceBand`. The client (`GDash.html`) adds one small pace strip to the individual drill — no new tabs, no roster columns (a roster "Pace & Status" column was previously removed at the user's request; do not resurrect it).

**Tech Stack:** Google Apps Script (V8, but this file is written ES5-style: `var`, `function` expressions, trailing-underscore privates — match it). Tests are `_test_*` functions inside `goalCompliance.js`, runnable in Node via `eval`.

---

## Background you need (zero-context primer)

- `goalCompliance.js` is the GAS backend for `GDash.html` (Goals Compliance Dashboard). It reads an `RD` sheet of goal/comment rows and a company-wide HRIS roster (`Data` tab), aggregates per-employee metrics in `aggregateByRocketeer_`, then enriches every employee in `buildComplianceData_`'s `finalizeEmployeeRecord_` (RPI score, STF, new-hire flag). The finished payload is chunk-cached in `CacheService` under keys prefixed by `CONFIG_GD.CACHE_VER`.
- **This feature's data decisions (settled with the user, do not re-litigate):**
  - PTO source = the "Accumulation Cost" sheet (spreadsheet id `1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo`), the same ledger the separate PS project reads — but **with NO department filter**. The Goals dashboard is company-wide; departments are a UI-filter concern.
  - Join path: PTO is keyed by Employee Number → bridge through the roster `Data` tab (which carries an `Employee Number` column) → `normName`.
  - `EligibleWeeks = max(0, (weekOfQuarter − 4) − AbsenceWeeks)`, absence fractional (`Σ min(PTO hours that week, 40)/40`). Lag is **4** here (the goal-setting window). RPI's cadence keeps its own LAG 6 (4 + 2 flat flex weeks) — RPI is the policy scorecard and is NOT touched; never stack both adjustments.
  - Person CPR = median of per-goal `self / max(1, EligibleWeeks)` across the **top 6 non-canceled goals by CPR** (mirrors the "6 tracked goals" policy frame; stragglers beyond 6 don't drag the median).
  - Activity Ratio = distinct eligible-window ISO weeks with ≥1 self-comment ÷ `max(1, EligibleWeeks)`, capped at 1.
  - Band = cross-sectional peer percentiles for the CURRENT quarter, over the decontaminated reference population (has computable CPR, not new-hire, not already goal-count `'At Risk'`; interns and attrition never reach the `employees` array). CPR < P10 → `behind`; > P90 → `high`; else `on`. Activity Ratio < AR-P10 → `bursty`, else `steady`. Fewer than `PACE_MIN_REF_N` reference people → everything classifies `na` (band untrustworthy).
  - The PTO sheet is **AI-blocked** — nobody could inspect it. The reader must be grain-defensive (a 40 h lump dated Monday and five 8 h daily rows must produce the same weekly buckets) and must log first-deploy diagnostics (row counts, department spread, median tx hours).
- **Out of scope for v1** (phase 2, do not build): 3-quarter trajectory classification, Gini coefficient, cohort-anomaly "BlockedWeeks" proxy, CSV columns, any roster-table column.

## How to run tests

```bash
cd D:/Contribution
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_percentile_()"
```

Replace the trailing call with the test you're running. Every test throws on failure and logs `✅ …` on success.

## File map

| File | Change |
|---|---|
| `goalCompliance.js` | CONFIG keys, `percentile_`/`median_`, `normEmpNum_`, `spreadUsageHours_`/`buildPtoWeeklyByEmp_`/`deriveUsageTx_`/`numOrNaN_`, `readPTOWeeklyHours_`, `computePaceMetrics_`, `computePaceBand_`/`classifyPaceMetrics_`, wiring in `buildComplianceData_` + `getFullRosterMap_`, 4 new `_test_*` fns, version/cache bump |
| `GDash.html` | `paceStripHtml_` + one insertion in `renderIndividualDrillContent_` |

---

### Task 1: CONFIG keys + percentile/median helpers

**Files:**
- Modify: `goalCompliance.js:29-69` (CONFIG_GD), `goalCompliance.js:20-22` (version header)
- Modify: `goalCompliance.js` — add helpers after `fmtDate_` (ends line 85), tests at end of file

- [ ] **Step 1: Add CONFIG keys and bump version/cache**

In the `CONFIG_GD` object, insert after the `RPI_CADENCE_MAX_CMTS:  8,` line (line 63):

```js
  // CPR pace & consistency (v2.7.0) — PTO-adjusted comments-per-eligible-week.
  // Company-wide PTO ledger (same "Accumulation Cost" sheet the PS project
  // reads, deliberately WITHOUT its Services filter — this dashboard covers
  // every department; departments are a UI filter concern).
  PTO_SS_ID:           '1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo',
  SHEET_PTO:           'Accumulation Cost',
  PACE_LAG_WEEKS:        4,  // goal-setting window — weeks 1-4 are never chargeable
  PACE_HOURS_PER_WEEK:  40,  // full working week, for fractional absence (hours/40)
  PACE_BAND_LO_PCT:     10,  // CPR below this peer percentile → Behind Pace
  PACE_BAND_HI_PCT:     90,  // CPR above this peer percentile → informational "high"
  PACE_MIN_REF_N:       20,  // below this reference-population size, classify 'na'
```

In the same object change `CACHE_VER: 'gd_v18_',` → `CACHE_VER: 'gd_v19_',` and update its trailing comment to `// bumped: paceMetrics/paceBand + roster employeeNumber (v18 added Contractors merge/quarterState)`. (A concurrent session took v18 on 2026-07-08; all "gd_v18_" mentions elsewhere in this plan mean v19.)

**Concurrent-session constraints (2026-07-08, binding for every task):** another session is actively committing to this repo (frontend tasks on `GDash.html`). Line numbers in this plan are stale — locate every edit by the quoted anchor code, never by line number. Pin every commit to named files (`git add goalCompliance.js` for backend tasks) — the working tree contains the other session's uncommitted WIP which must never be swept into a commit.

In the header comment block (lines 20-22), add below the v2.6.0 line and update VERSION:

```
//              v2.7.0: CPR pace & consistency — PTO-adjusted EligibleWeeks
//                      (company-wide Accumulation Cost, no dept filter),
//                      paceMetrics per employee + paceBand percentiles.
// VERSION:     2.7.0
```

- [ ] **Step 2: Write the failing test** — append at the end of `goalCompliance.js` (after the last existing `_test_` function):

```js
// ── CPR pace tests (v2.7.0) ────────────────────────────────────
function _test_percentile_() {
  var t = function(cond, msg) { if (!cond) throw new Error('percentile: ' + msg); };
  t(percentile_([], 50) === null, 'empty → null');
  t(percentile_([7], 10) === 7, 'single value');
  t(percentile_([1, 2, 3, 4, 5], 50) === 3, 'odd-count median');
  t(median_([1, 2, 3, 4]) === 2.5, 'even-count median interpolates');
  t(percentile_([10, 20], 25) === 12.5, 'linear interpolation');
  t(percentile_([5, 1, 3], 100) === 5, 'unsorted input handled, P100 = max');
  t(percentile_([5, 1, 3], 0) === 1, 'P0 = min');
  Logger.log('✅ _test_percentile_: all assertions passed');
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_percentile_()"`
Expected: FAIL with `percentile_ is not defined`

- [ ] **Step 4: Implement** — insert after `fmtDate_` (after line 85):

```js
// Linear-interpolation percentile over an unsorted numeric array.
// p in [0,100]. Returns null for an empty array. 4-dp rounding keeps
// payload values stable across float noise.
function percentile_(values, p) {
  var v = (values || []).slice().sort(function(a, b) { return a - b; });
  if (!v.length) return null;
  var idx = (p / 100) * (v.length - 1);
  var lo  = Math.floor(idx), hi = Math.ceil(idx);
  return +(v[lo] + (v[hi] - v[lo]) * (idx - lo)).toFixed(4);
}

function median_(values) { return percentile_(values, 50); }
```

- [ ] **Step 5: Run to verify it passes**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_percentile_()"`
Expected: `✅ _test_percentile_: all assertions passed`

- [ ] **Step 6: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): v2.7.0 CONFIG pace keys + percentile/median helpers"
```

---

### Task 2: Employee Number bridge in the roster reader

**Files:**
- Modify: `goalCompliance.js:1402-1472` (`getFullRosterMap_`), helper next to `normName_` (line 75-78), test at end of file

- [ ] **Step 1: Write the failing test** — append after `_test_percentile_`:

```js
function _test_normEmpNum_() {
  var t = function(cond, msg) { if (!cond) throw new Error('normEmpNum: ' + msg); };
  t(normEmpNum_(1042) === '1042', 'number → string');
  t(normEmpNum_(1042.0) === '1042', 'float-typed sheet number');
  t(normEmpNum_(' 1,042 ') === '1042', 'comma + whitespace stripped');
  t(normEmpNum_('') === '' && normEmpNum_(null) === '' && normEmpNum_(undefined) === '', 'empty-ish → ""');
  Logger.log('✅ _test_normEmpNum_: all assertions passed');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_normEmpNum_()"`
Expected: FAIL with `normEmpNum_ is not defined`

- [ ] **Step 3: Implement the helper** — insert directly after `normName_` (after line 78):

```js
// Employee Numbers arrive from Sheets as numbers (sometimes float-typed) or
// comma-grouped strings — normalize both sides of the PTO↔roster join the
// same way so '1,042' and 1042 always match.
function normEmpNum_(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  return String(typeof raw === 'number' ? Math.round(raw) : raw).replace(/,/g, '').trim();
}
```

- [ ] **Step 4: Run to verify it passes** (same command as Step 2). Expected: `✅ _test_normEmpNum_: all assertions passed`

- [ ] **Step 5: Capture Employee Number in `getFullRosterMap_`**

In the `map[norm] = {` object (lines 1431-1441), add after the `name:` line:

```js
        // PTO↔roster bridge (v2.7.0): the Accumulation Cost ledger is keyed by
        // Employee Number, not name. Defensive header chain, same pattern as
        // the hire-date read above.
        employeeNumber: normEmpNum_(row['Employee Number'] !== undefined ? row['Employee Number']
                          : (row['Employee ID'] !== undefined ? row['Employee ID'] : row['Employee #'])),
```

And extend the summary log (lines 1460-1465): after the `hireCount` var add

```js
    var empNumCount = Object.keys(map).filter(function(n) { return map[n].employeeNumber; }).length;
```

and include `+ empNumCount + ' with employee number, '` in the logged string (place it right after the `hireCount + ' with hire date'` fragment, e.g. `… hireCount + ' with hire date, ' + empNumCount + ' with employee number) from ' …`). Then add below the existing no-hire-dates warning block (after line 1469):

```js
    if (Object.keys(map).length && !empNumCount) {
      Logger.log('⚠️ getFullRosterMap_: no employee numbers matched — check the Employee Number column header on "' +
                 CONFIG_GD.SHEET_ROSTER + '" (pace metrics stay PTO-unadjusted until fixed)');
    }
```

Note: the roster map is chunk-cached under `CONFIG_GD.CACHE_VER + 'rostermap'` (`getFullRosterMapCached_`, line 1482-1487) — the Task 1 `gd_v18_` bump already invalidates the old cached shape; nothing else to do.

- [ ] **Step 6: Sanity parse** — run the full-file eval again (any test). Expected: no syntax error.

- [ ] **Step 7: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): roster Employee Number bridge for PTO join"
```

---

### Task 3: PTO spreading + bucketing + usage derivation (pure helpers)

**Files:**
- Modify: `goalCompliance.js` — helpers directly above `getFullRosterMap_` (line 1402), test at end of file

- [ ] **Step 1: Write the failing test** — append after `_test_normEmpNum_`:

```js
function _test_ptoSpread_() {
  var t = function(cond, msg) { if (!cond) throw new Error('ptoSpread: ' + msg); };
  var monday = '2026-04-06';  // a Monday
  // 40h lump dated Monday spreads 8h × Mon–Fri, all in ONE ISO week —
  // this is what makes the reader grain-agnostic (per-request exports).
  var s = spreadUsageHours_(monday, 40);
  t(s.length === 5, '40h Monday → 5 chunks, got ' + s.length);
  t(s.every(function(c) { return c.hours === 8; }), 'all chunks 8h');
  var wkMon = dateToISOWeek_(new Date(2026, 3, 6));  // local-safe Date (string parse is UTC and can shift a day)
  t(s.every(function(c) { return c.week === wkMon; }), 'all chunks in ' + wkMon);
  // 16h dated Friday crosses the ISO week boundary: 8h Fri + 8h next Monday
  var s2 = spreadUsageHours_('2026-04-10', 16);
  t(s2.length === 2, '16h Friday → 2 chunks, got ' + s2.length);
  t(s2[0].week === dateToISOWeek_(new Date(2026, 3, 10)), 'first chunk stays on Friday week');
  t(s2[1].week === dateToISOWeek_(new Date(2026, 3, 13)), 'second chunk lands the following Monday week');
  // 8h single day = per-day-grain export → no-op spreading
  var s3 = spreadUsageHours_('2026-04-07', 8);
  t(s3.length === 1 && s3[0].hours === 8, '8h single-day chunk');
  // weekend-dated tx rolls forward to Monday
  var s4 = spreadUsageHours_('2026-04-11', 8);  // Saturday
  t(s4.length === 1 && s4[0].week === dateToISOWeek_(new Date(2026, 3, 13)), 'weekend date rolls to Monday');
  t(spreadUsageHours_(monday, 0).length === 0 && spreadUsageHours_(monday, -4).length === 0, 'non-positive hours → []');
  var s5 = spreadUsageHours_(monday, 12);
  t(s5.length === 2 && s5[1].hours === 4, '12h → 8h + 4h');

  // bucketing merges chunks per employee per ISO week
  var weekly = buildPtoWeeklyByEmp_({ '1042': [{ date: monday, hours: 12 }, { date: '2026-04-07', hours: 8 }] });
  t(weekly['1042'][wkMon] === 20, 'merged weekly hours = 20, got ' + JSON.stringify(weekly));

  // usage derivation: explicit amount wins; else negative balance delta; accruals/positive deltas skipped
  var tx = deriveUsageTx_([
    { date: '2026-04-01', balance: 100, isUsage: false, explicitAmt: null },
    { date: '2026-04-06', balance: 92,  isUsage: true,  explicitAmt: 8 },
    { date: '2026-04-07', balance: 76,  isUsage: true,  explicitAmt: null },
    { date: '2026-04-08', balance: 80,  isUsage: true,  explicitAmt: null },
  ]);
  t(tx.length === 2 && tx[0].hours === 8 && tx[1].hours === 16, 'usage derivation, got ' + JSON.stringify(tx));
  Logger.log('✅ _test_ptoSpread_: all assertions passed');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_ptoSpread_()"`
Expected: FAIL with `spreadUsageHours_ is not defined`

- [ ] **Step 3: Implement the three helpers** — insert directly above the `getFullRosterMap_` doc comment (line 1395), as a new section:

```js
// ── PTO ingestion (v2.7.0) ──────────────────────────────────────
// The Accumulation Cost export's grain is unknown (sheet is AI-blocked): it
// may post one row per day taken (8h) or one row per request (e.g. 40h dated
// the first day). Spreading every usage transaction 8h-per-weekday from its
// date makes both grains produce identical weekly buckets.

// → [{ week: 'YYYY.WNN', hours: n }] chunks. Weekends are skipped (a Saturday-
// dated tx rolls forward to Monday). Guard caps runaway amounts at ~600h.
function spreadUsageHours_(dateIso, hours) {
  var out = [];
  var remaining = Number(hours) || 0;
  if (remaining <= 0) return out;
  // Parse as LOCAL date — new Date('YYYY-MM-DD') is UTC midnight and shifts a
  // day in negative-offset timezones, which would misplace week boundaries.
  var m = String(dateIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dateIso);
  if (isNaN(d)) return out;
  var guard = 0;
  while (remaining > 0 && guard < 120) {
    guard++;
    var day = d.getDay();
    if (day !== 0 && day !== 6) {
      var chunk = Math.min(CONFIG_GD.PACE_HOURS_PER_WEEK / 5, remaining);
      var wk = dateToISOWeek_(new Date(d.getTime()));
      if (wk) out.push({ week: wk, hours: chunk });
      remaining -= chunk;
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// { empNum: [{date, hours}] } → { empNum: { 'YYYY.WNN': totalHours } }
function buildPtoWeeklyByEmp_(usageTxByEmp) {
  var out = {};
  Object.keys(usageTxByEmp || {}).forEach(function(emp) {
    var weekly = {};
    usageTxByEmp[emp].forEach(function(tx) {
      spreadUsageHours_(tx.date, tx.hours).forEach(function(c) {
        weekly[c.week] = (weekly[c.week] || 0) + c.hours;
      });
    });
    out[emp] = weekly;
  });
  return out;
}

// One employee's date-sorted ledger entries → usage transactions with hour
// amounts. Explicit amount column wins; otherwise the negative balance delta
// from the previous entry (same derivation the PS project uses). Positive
// deltas on a usage row (corrections/refunds) are skipped.
function deriveUsageTx_(entries) {
  var txs = [];
  (entries || []).forEach(function(e, i) {
    if (!e.isUsage) return;
    var amount = null;
    if (e.explicitAmt !== null && isFinite(e.explicitAmt) && e.explicitAmt > 0) {
      amount = e.explicitAmt;
    } else if (i > 0 && isFinite(e.balance) && isFinite(entries[i - 1].balance)) {
      var delta = e.balance - entries[i - 1].balance;
      if (delta < 0) amount = -delta;
    }
    if (amount !== null && amount > 0) txs.push({ date: e.date, hours: amount });
  });
  return txs;
}
```

- [ ] **Step 4: Run to verify it passes** (same command as Step 2). Expected: `✅ _test_ptoSpread_: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): PTO weekday spreading + weekly bucketing + usage derivation (pure, tested)"
```

---

### Task 4: `readPTOWeeklyHours_()` — the sheet reader

**Files:**
- Modify: `goalCompliance.js` — insert directly after `deriveUsageTx_` (from Task 3)

No Node test possible (`SpreadsheetApp`); correctness is delegated to the Task 3 pure helpers plus first-deploy log inspection.

- [ ] **Step 1: Implement**

```js
// Company-wide PTO usage by ISO week: { empNum: { 'YYYY.WNN': hours } }.
// NO department filter — deliberately different from the PS project's reader
// (this dashboard evaluates goals globally; departments are a UI filter).
// Any failure returns {} so pace metrics degrade to PTO-unadjusted weeks
// rather than breaking the payload build.
function readPTOWeeklyHours_() {
  try {
    var rows = readSheet_(CONFIG_GD.PTO_SS_ID, CONFIG_GD.SHEET_PTO);
    if (!rows.length) { Logger.log('⚠️ readPTOWeeklyHours_: 0 rows from "' + CONFIG_GD.SHEET_PTO + '"'); return {}; }

    var byEmp = {}, depts = {}, usageRows = 0;
    rows.forEach(function(row) {
      var empNum = normEmpNum_(row['Employee Number']);
      var date   = row['Date'] ? fmtDate_(row['Date']) : '';
      if (!empNum || date.length !== 10) return;
      var dept = String(row['Department: Name'] || '').trim();
      if (dept) depts[dept] = true;   // diagnostics only — never a filter
      var adjType = String(row['Adjustment Type'] || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      var isUsage = adjType.indexOf('usage') !== -1 || adjType.indexOf('timeoff') !== -1 ||
                    adjType.indexOf('sick') !== -1;
      if (isUsage) usageRows++;
      var amtRaw = null;
      ['Amount', 'Hours', 'AdjustmentAmount', 'AdjustmentHours'].some(function(col) {
        if (row[col] !== undefined && row[col] !== '') { amtRaw = row[col]; return true; }
        return false;
      });
      var amt = amtRaw === null ? NaN : numOrNaN_(amtRaw);
      if (!byEmp[empNum]) byEmp[empNum] = [];
      byEmp[empNum].push({
        date: date,
        balance: numOrNaN_(row['Balance']),
        isUsage: isUsage,
        explicitAmt: isFinite(amt) ? Math.abs(amt) : null,
      });
    });

    var usageByEmp = {}, txCount = 0, txHours = [];
    Object.keys(byEmp).forEach(function(emp) {
      var entries = byEmp[emp].sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var txs = deriveUsageTx_(entries);
      if (txs.length) {
        usageByEmp[emp] = txs;
        txCount += txs.length;
        txs.forEach(function(tx) { txHours.push(tx.hours); });
      }
    });

    // Grain diagnostic — the sheet is AI-blocked, so the first deploy's log is
    // how we learn what the export looks like: median tx ≈8h means one-row-per-
    // day grain, ≈40h means one-row-per-request. Spreading handles both.
    txHours.sort(function(a, b) { return a - b; });
    var medianTx = txHours.length ? txHours[Math.floor(txHours.length / 2)] : 0;
    Logger.log('✅ readPTOWeeklyHours_: ' + Object.keys(usageByEmp).length + ' employees with usage · ' +
               txCount + ' usage tx (median ' + medianTx + 'h) from ' + usageRows + ' usage rows · ' +
               Object.keys(depts).length + ' departments seen (no filter applied)');
    return buildPtoWeeklyByEmp_(usageByEmp);
  } catch (e) {
    Logger.log('⚠️ readPTOWeeklyHours_: ' + e.message + ' — pace metrics fall back to unadjusted weeks');
    return {};
  }
}
```

And insert `numOrNaN_` directly after `normEmpNum_` (Task 2's helper):

```js
// parseFloat with comma-grouping tolerance; NaN (never null/0) on junk so
// isFinite() checks stay honest.
function numOrNaN_(v) {
  var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : NaN;
}
```

- [ ] **Step 2: Parse check** — run any existing test to confirm the file still evals:

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_ptoSpread_()"`
Expected: `✅ _test_ptoSpread_: all assertions passed`

- [ ] **Step 3: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): company-wide PTO reader (Accumulation Cost, no dept filter)"
```

---

### Task 5: `computePaceMetrics_` (pure) + worked-example tests

**Files:**
- Modify: `goalCompliance.js` — insert after `computeRpiScore_`'s closing brace (the function starting line 1262; place the new section after it and before the next function), test at end of file

- [ ] **Step 1: Write the failing test** — append after `_test_ptoSpread_`. Fixtures A/B/C are the user's worked examples (week 9, raw ceiling 5); B's CPR is 0.2 (the original table's 1.0 was an arithmetic slip, confirmed with the user):

```js
function _test_computePaceMetrics_() {
  var t = function(cond, msg) { if (!cond) throw new Error('paceMetrics: ' + msg); };
  var calWeeks = ['2026.W15','2026.W16','2026.W17','2026.W18','2026.W19','2026.W20','2026.W21',
                  '2026.W22','2026.W23','2026.W24','2026.W25','2026.W26','2026.W27','2026.W28'];
  var mk = function(selfCounts, cmtWeeks) {
    return {
      goalsList: selfCounts.map(function(s, i) { return { id: 'g' + i, status: 'In Progress', self: s }; }),
      commentWeekList: cmtWeeks,
    };
  };
  // A — steady on-pace: eligible 5, CPR 0.9, AR 1.0
  var a = computePaceMetrics_(mk([5,4,5,3,5,4], ['2026.W19','2026.W20','2026.W21','2026.W22','2026.W23']), 9, null, calWeeks);
  t(a.eligibleWeeks === 5, 'A eligible 5, got ' + a.eligibleWeeks);
  t(a.cpr === 0.9, 'A CPR 0.9, got ' + a.cpr);
  t(a.activityRatio === 1, 'A AR 1.0, got ' + a.activityRatio);
  // B — one comment per goal, all posted the same week: CPR 0.2, AR 0.2
  var b = computePaceMetrics_(mk([1,1,1,1,1,1], ['2026.W20']), 9, null, calWeeks);
  t(b.cpr === 0.2, 'B CPR 0.2, got ' + b.cpr);
  t(b.activityRatio === 0.2, 'B AR 0.2, got ' + b.activityRatio);
  // C — two full PTO weeks inside the window: eligible 3, CPR 1.0, AR 1.0
  var pto = {}; pto['2026.W19'] = 40; pto['2026.W20'] = 40;
  var c = computePaceMetrics_(mk([3,3,3,2,3,3], ['2026.W21','2026.W22','2026.W23']), 9, pto, calWeeks);
  t(c.absenceWeeks === 2, 'C absence 2, got ' + c.absenceWeeks);
  t(c.eligibleWeeks === 3, 'C eligible 3, got ' + c.eligibleWeeks);
  t(c.cpr === 1, 'C CPR 1.0, got ' + c.cpr);
  t(c.activityRatio === 1, 'C AR 1.0, got ' + c.activityRatio);
  // top-6 selection: zero-comment stragglers beyond the best 6 must not drag the median
  var d = computePaceMetrics_(mk([5,5,5,5,5,5,0,0,0,0], ['2026.W19','2026.W20','2026.W21','2026.W22','2026.W23']), 9, null, calWeeks);
  t(d.cpr === 1, 'top-6 by CPR ignores stragglers, got ' + d.cpr);
  // PTO hours cap at 40/week (bad data can't make absence exceed the week)
  var over = {}; over['2026.W19'] = 90;
  var o = computePaceMetrics_(mk([1,1,1,1,1,1], []), 9, over, calWeeks);
  t(o.absenceWeeks === 1, 'weekly absence caps at 1.0, got ' + o.absenceWeeks);
  // early quarter (week ≤ lag) → null metrics, cls stays na
  var e = computePaceMetrics_(mk([1,1,1,1,1,1], []), 3, null, calWeeks);
  t(e.eligibleWeeks === 0 && e.cpr === null && e.activityRatio === null && e.cls === 'na', 'week 3 → no eligible weeks');
  // canceled-only goal set → null CPR
  var f = computePaceMetrics_({ goalsList: [{ id: 'g0', status: 'Canceled', self: 9 }], commentWeekList: [] }, 9, null, calWeeks);
  t(f.cpr === null, 'canceled-only → null CPR');
  // fully absent the whole window → null
  var allPto = {}; calWeeks.forEach(function(w) { allPto[w] = 40; });
  var g = computePaceMetrics_(mk([2,2,2,2,2,2], []), 9, allPto, calWeeks);
  t(g.cpr === null, 'fully absent → null CPR');
  // fractional eligible < 1 uses divisor 1 (matches CPR spec: max(1, EligibleWeeks))
  var frac = {}; frac['2026.W19'] = 40; frac['2026.W20'] = 40; frac['2026.W21'] = 40; frac['2026.W22'] = 20;
  var h = computePaceMetrics_(mk([2,2,2,2,2,2], ['2026.W23']), 9, frac, calWeeks);
  t(h.eligibleWeeks === 1.5 && h.cpr === 1.33, 'fractional eligible: 2/1.5 → 1.33, got ' + JSON.stringify(h));
  Logger.log('✅ _test_computePaceMetrics_: all assertions passed');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_computePaceMetrics_()"`
Expected: FAIL with `computePaceMetrics_ is not defined`

- [ ] **Step 3: Implement** — insert after `computeRpiScore_`:

```js
// ── CPR pace & consistency (v2.7.0) ────────────────────────────
// Comments-per-eligible-week, PTO-adjusted, so leave never reads as
// disengagement. EligibleWeeks = weeks since the 4-week goal-setting window
// closed, minus fractional PTO absence (hours/40, capped at 1/week).
// DISTINCT FROM RPI C2: RPI keeps its flat 2-week flex (LAG 6) and stays the
// policy scorecard; this is the analytical layer with the true 4-week lag.
// Never stack the two adjustments.
//   cpr           — per non-canceled goal: self / max(1, eligibleWeeks);
//                   person = median of the top-6 goals by CPR (mirrors the
//                   "6 tracked goals" policy frame).
//   activityRatio — distinct eligible-window weeks with ≥1 self-comment ÷
//                   max(1, eligibleWeeks), capped at 1 (early-quarter
//                   commenting is never penalized).
// cls/consistency are placeholders ('na') until classifyPaceMetrics_ runs —
// classification needs the full population's percentiles.
// Pure function of aggregated per-employee data → Node-testable.
function computePaceMetrics_(emp, weekOfQuarter, ptoWeekHours, calWeeks) {
  var lag         = CONFIG_GD.PACE_LAG_WEEKS;
  var rawWeeks    = Math.max(0, (weekOfQuarter || 0) - lag);
  var windowWeeks = (calWeeks || []).slice(lag, weekOfQuarter || 0);

  var absence = 0;
  windowWeeks.forEach(function(wk) {
    var h = (ptoWeekHours && ptoWeekHours[wk]) || 0;
    absence += Math.min(h, CONFIG_GD.PACE_HOURS_PER_WEEK) / CONFIG_GD.PACE_HOURS_PER_WEEK;
  });
  absence = +absence.toFixed(2);
  var eligible = +Math.max(0, rawWeeks - absence).toFixed(2);

  var out = { rawWeeks: rawWeeks, absenceWeeks: absence, eligibleWeeks: eligible,
              cpr: null, activityRatio: null, cls: 'na', consistency: 'na' };
  if (eligible <= 0) return out;

  var active = (emp.goalsList || []).filter(function(g) { return !/cancel/i.test(g.status); });
  if (!active.length) return out;

  var divisor = Math.max(1, eligible);
  var perGoal = active
    .map(function(g) { return (g.self || 0) / divisor; })
    .sort(function(a, b) { return b - a; })
    .slice(0, CONFIG_GD.RPI_CMT_GOALS);
  out.cpr = +median_(perGoal).toFixed(2);

  var windowSet = {};
  windowWeeks.forEach(function(wk) { windowSet[wk] = true; });
  var activeWks = (emp.commentWeekList || []).filter(function(wk) { return windowSet[wk]; }).length;
  out.activityRatio = +Math.min(1, activeWks / divisor).toFixed(2);
  return out;
}
```

- [ ] **Step 4: Run to verify it passes** (same command as Step 2). Expected: `✅ _test_computePaceMetrics_: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): computePaceMetrics_ — PTO-adjusted CPR + Activity Ratio (worked-example tested)"
```

---

### Task 6: Band, classification, and wiring into `buildComplianceData_`

**Files:**
- Modify: `goalCompliance.js` — band helpers after `computePaceMetrics_`; wiring at lines ~880 (PTO load), ~924 (finalize), ~933 (band pass), ~1016 (payload); test at end of file

- [ ] **Step 1: Write the failing test** — append after `_test_computePaceMetrics_`:

```js
function _test_paceBand_() {
  var t = function(cond, msg) { if (!cond) throw new Error('paceBand: ' + msg); };
  // 21 clean reference people (CPRs 0.5..2.5), one new hire and one At Risk that must be excluded
  var employees = [];
  for (var i = 0; i < 21; i++) {
    employees.push({ isNewHire: false, complianceStatus: 'On Target',
                     paceMetrics: { cpr: +(0.5 + i * 0.1).toFixed(2), activityRatio: +(0.5 + i * 0.025).toFixed(2),
                                    cls: 'na', consistency: 'na' } });
  }
  employees.push({ isNewHire: true,  complianceStatus: 'On Target',
                   paceMetrics: { cpr: 99, activityRatio: 1, cls: 'na', consistency: 'na' } });
  employees.push({ isNewHire: false, complianceStatus: 'At Risk',
                   paceMetrics: { cpr: 0.01, activityRatio: 0.01, cls: 'na', consistency: 'na' } });
  var band = computePaceBand_(employees);
  t(band.refN === 21, 'new hire + At Risk excluded from reference, got ' + band.refN);
  t(band.p10 !== null && band.p90 !== null && band.p10 < band.p90, 'band ordered');
  t(band.p90 < 99, 'contaminant CPR 99 not in band');

  // classification against the band
  var mkP = function(cpr, ar) { return { paceMetrics: { cpr: cpr, activityRatio: ar, cls: 'na', consistency: 'na' } }; };
  var low = mkP(band.p10 - 0.1, 1);   classifyPaceMetrics_(low, band);
  t(low.paceMetrics.cls === 'behind', 'below P10 → behind');
  var mid = mkP(band.p50, 1);         classifyPaceMetrics_(mid, band);
  t(mid.paceMetrics.cls === 'on' && mid.paceMetrics.consistency === 'steady', 'mid → on/steady');
  var hi  = mkP(band.p90 + 1, band.arP10 - 0.05); classifyPaceMetrics_(hi, band);
  t(hi.paceMetrics.cls === 'high' && hi.paceMetrics.consistency === 'bursty', 'above P90 + low AR → high/bursty');
  var nul = mkP(null, null);          classifyPaceMetrics_(nul, band);
  t(nul.paceMetrics.cls === 'na', 'null CPR stays na');
  // tiny population → everything na
  var tiny = computePaceBand_(employees.slice(0, 5));
  var x = mkP(1, 1); classifyPaceMetrics_(x, tiny);
  t(x.paceMetrics.cls === 'na', 'refN < PACE_MIN_REF_N → na');
  Logger.log('✅ _test_paceBand_: all assertions passed');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_paceBand_()"`
Expected: FAIL with `computePaceBand_ is not defined`

- [ ] **Step 3: Implement band + classifier** — insert directly after `computePaceMetrics_`:

```js
// Peer band over the decontaminated reference population: computable CPR,
// not a new hire, not already At Risk on goal count (per the methodology:
// the baseline must not be contaminated by already-known problem cases).
// Interns and attrition never reach the employees array, so no check needed.
function computePaceBand_(employees) {
  var cprs = [], ars = [];
  (employees || []).forEach(function(e) {
    var p = e.paceMetrics;
    if (!p || p.cpr === null) return;
    if (e.isNewHire) return;
    if (e.complianceStatus === 'At Risk') return;
    cprs.push(p.cpr);
    ars.push(p.activityRatio);
  });
  return {
    p10:   percentile_(cprs, CONFIG_GD.PACE_BAND_LO_PCT),
    p50:   percentile_(cprs, 50),
    p90:   percentile_(cprs, CONFIG_GD.PACE_BAND_HI_PCT),
    arP10: percentile_(ars,  CONFIG_GD.PACE_BAND_LO_PCT),
    refN:  cprs.length,
  };
}

// Fills paceMetrics.cls ('behind'|'on'|'high') and .consistency
// ('bursty'|'steady') in place. Anything unclassifiable stays 'na':
// null CPR, or a reference population too small to trust.
function classifyPaceMetrics_(emp, band) {
  var p = emp.paceMetrics;
  if (!p) return;
  if (p.cpr === null || !band || band.refN < CONFIG_GD.PACE_MIN_REF_N) {
    p.cls = 'na'; p.consistency = 'na';
    return;
  }
  p.cls         = p.cpr < band.p10 ? 'behind' : p.cpr > band.p90 ? 'high' : 'on';
  p.consistency = p.activityRatio < band.arP10 ? 'bursty' : 'steady';
}
```

- [ ] **Step 4: Run to verify it passes** (same command as Step 2). Expected: `✅ _test_paceBand_: all assertions passed`

- [ ] **Step 5: Wire into `buildComplianceData_`**

(a) After the `weeksElapsedSinceStart` computation block (ends line 891), add:

```js
  // CPR pace (v2.7.0): company-wide PTO usage by ISO week, joined via the
  // roster's Employee Number. Loaded once per payload build; {} on any
  // failure (pace metrics then use unadjusted weeks).
  var ptoWeekly = readPTOWeeklyHours_();
```

(b) Inside `finalizeEmployeeRecord_`, after the `emp.stfEligible = …` statement (line 923-924), add:

```js
    // CPR pace metrics (v2.7.0) — PTO-adjusted comments-per-eligible-week +
    // activity spread. Classification (cls/consistency) happens after the
    // full population exists; see the paceBand pass below.
    var empNum = rosterRec && rosterRec.employeeNumber;
    emp.paceMetrics = computePaceMetrics_(emp, weeksElapsedSinceStart,
                                          (empNum && ptoWeekly[empNum]) || null, calWeeks);
```

(c) After the `attrition.sort(…)` line (line 933), add:

```js
  // Peer band over employees only; attrition is classified against the same
  // band but never contributes to it.
  var paceBand = computePaceBand_(employees);
  employees.forEach(function(e) { classifyPaceMetrics_(e, paceBand); });
  attrition.forEach(function(e) { classifyPaceMetrics_(e, paceBand); });
```

(d) In the returned payload object, after `attrition: attrition,` (line 1016), add:

```js
    paceBand:               paceBand,
```

- [ ] **Step 6: Full parse + regression run**

Run: `node -e "global.Logger={log:console.log}; var src=require('fs').readFileSync('goalCompliance.js','utf8'); eval(src); (src.match(/function (_test_\w+)/g)||[]).forEach(function(m){ var fn=m.replace('function ',''); eval(fn+'()'); });"`
Expected: every `_test_*` in the file logs `✅ … passed` (new AND pre-existing), no throw.

- [ ] **Step 7: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): wire paceMetrics + paceBand into payload (CACHE_VER gd_v19_)"
```

---

### Task 7: Drill-down pace strip (GDash.html)

**Files:**
- Modify: `GDash.html` — new `paceStripHtml_` immediately above `renderIndividualDrillContent_` (line 3147); one insertion inside it (after line 3164)

- [ ] **Step 1: Add the helper** — insert directly above `function renderIndividualDrillContent_(container, data) {`:

```js
// CPR Pace & Consistency strip (v2.7.0) — shown inside the individual drill
// only for the currently loaded quarter (paceMetrics/paceBand are computed
// against that quarter's peer population; ALL-time drills have no band).
// Returns '' whenever there is nothing classifiable — small reference
// population, early quarter, zero-goal employee — so the drill never shows
// a half-empty strip.
function paceStripHtml_(normName, drillQuarter) {
  if (!S.data || drillQuarter !== S.data.quarter) return '';
  var band = S.data.paceBand;
  var e = null;
  [S.data.employees || [], S.data.attrition || []].forEach(function(arr) {
    if (e) return;
    for (var i = 0; i < arr.length; i++) if (arr[i].normName === normName) { e = arr[i]; break; }
  });
  var p = e && e.paceMetrics;
  if (!p || p.cpr === null || p.cls === 'na' || !band) return '';

  var QUAD = {
    'behind|bursty': ['#B71C1C', '\u{1F534} Behind & Bursty — behind the peer band AND concentrated into few sittings'],
    'behind|steady': ['#B45309', '\u{1F7E0} Behind but steady — consistent effort, low volume: support conversation'],
    'on|bursty':     ['#B45309', '\u{1F7E1} On pace but bursty — meets the letter, not the habit'],
    'on|steady':     ['#166534', '\u{1F7E2} On pace & steady'],
    'high|bursty':   ['#B45309', '\u{1F7E1} High volume but bursty'],
    'high|steady':   ['#166534', '\u{1F7E2} Above the peer band & steady'],
  };
  var q = QUAD[p.cls + '|' + p.consistency] || ['#64748B', p.cls + ' / ' + p.consistency];
  var tip = 'CPR = median self-comments per eligible week across the top-6 goals. ' +
    'Eligible weeks = ' + p.rawWeeks + ' weeks since the goal-setting window closed, minus ' +
    p.absenceWeeks + ' PTO week(s). Peer band P10–P90: ' + band.p10 + '–' + band.p90 +
    ' (n=' + band.refN + '). Activity = share of eligible weeks with at least one self-comment.';
  return '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px" title="' + esc(tip) + '">' +
    '<span style="font-size:10px;font-weight:800;color:' + q[0] + '">' + q[1] + '</span>' +
    '<span style="font-size:10px;color:var(--muted)">CPR ' + p.cpr +
    ' · Activity ' + Math.round((p.activityRatio || 0) * 100) + '%' +
    ' · ' + p.eligibleWeeks + ' eligible wks' +
    (p.absenceWeeks > 0 ? ' (PTO-adjusted −' + p.absenceWeeks + ')' : '') + '</span>' +
    '</div>';
}
```

- [ ] **Step 2: Insert the strip into the drill** — in `renderIndividualDrillContent_`, immediately after the `html += '<p class="section-sub" …reports to…</p>';` statement (line 3163-3164), add:

```js
  html += paceStripHtml_(r.normName, data.quarter);
```

- [ ] **Step 3: Parse-check the script block**

Run: `node -e "var m=require('fs').readFileSync('GDash.html','utf8').match(/<script>([\s\S]*?)<\/script>/g)||[]; m.forEach(function(s,i){ try{ new Function(s.replace(/<\/?script[^>]*>/g,'')); }catch(e){ console.error('script block '+i+': '+e.message); process.exit(1);} }); console.log('parse OK: '+m.length+' block(s)')"`
Expected: `parse OK: 1 block(s)` (only bare `<script>` blocks match; CDN tags carry attributes)

- [ ] **Step 4: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): CPR pace & consistency strip in individual drill"
```

---

### Task 8: Full regression + GAS-side deploy checklist

- [ ] **Step 1: Run the entire test suite one last time**

Run: `node -e "global.Logger={log:console.log}; var src=require('fs').readFileSync('goalCompliance.js','utf8'); eval(src); (src.match(/function (_test_\w+)/g)||[]).forEach(function(m){ var fn=m.replace('function ',''); eval(fn+'()'); });"`
Expected: all tests pass.

- [ ] **Step 2: Commit anything outstanding** (should be nothing; verify `git status` is clean for the two files).

- [ ] **Step 3: Manual GAS verification (needs deploy — record results, don't skip)**

0. **Sharing check (final-review finding I1):** the web app executes as the accessing user — verify the Accumulation Cost spreadsheet is shared (read) with the full dashboard audience, not just the owner. If a viewer can't read it, that build classifies nothing ('na', strip hidden) by design — deterministic, but PTO adjustment only works for users with access.
1. Copy `goalCompliance.js` + `GDash.html` into the Apps Script project; run `buildComplianceData_` once (or load the dashboard with Refresh) and read the execution log:
   - `getFullRosterMap_: … N with employee number …` — N should be ≈ the roster size. If 0, fix the Employee Number header chain (Task 2 warning will say so).
   - `✅ readPTOWeeklyHours_: … median Xh …` — record the grain (≈8h = per-day rows, ≈40h = per-request rows; both are handled, this is informational) and the departments-seen count (should be > 1, proving company-wide coverage). If sick leave doesn't appear, the Adjustment Type regex (`usage|timeoff|sick`) needs the sheet's real type strings.
2. In the dashboard: drill into someone known to have taken PTO this quarter → the strip should show `PTO-adjusted −n`. Drill into a heavy steady commenter → `🟢 On pace & steady`.
3. Confirm the All-Time roster drill shows NO pace strip (quarter mismatch guard).
4. New deployment version (Deploy → Manage deployments → edit → New version).

---

## Self-review notes (already applied)

- Rocketeer B's CPR in the source methodology tabulated as 1.0; under the stated formula it is 0.2 — the test encodes 0.2 and the discrepancy was flagged to the user before this plan.
- `emp.paceMetrics` (not `emp.pace`) — `paceThreshold`/`paceStatus` already exist in the engagement code path with different semantics.
- Names cross-checked across tasks: `percentile_`, `median_`, `normEmpNum_`, `numOrNaN_`, `spreadUsageHours_`, `buildPtoWeeklyByEmp_`, `deriveUsageTx_`, `readPTOWeeklyHours_`, `computePaceMetrics_`, `computePaceBand_`, `classifyPaceMetrics_`, `paceStripHtml_`, payload key `paceBand`, CONFIG keys `PTO_SS_ID/SHEET_PTO/PACE_LAG_WEEKS/PACE_HOURS_PER_WEEK/PACE_BAND_LO_PCT/PACE_BAND_HI_PCT/PACE_MIN_REF_N`.
