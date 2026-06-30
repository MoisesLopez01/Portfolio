# Fiscal Year Awareness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded fiscal-year constants with a single auto-compute helper so the dashboard survives every quarter rollover without a code change.

**Architecture:** A new `computeFiscalContext_(referenceDate?)` helper in `PS Contribution Report.js` derives FY label, quarter, ISO week bounds, grace-period flags, and month columns from today's date. All five CONFIG_PS constants it replaces are removed and every reader receives `ctx` as a parameter. The frontend `Q4` object is bootstrapped from the payload's `fiscalContext` on data load.

**Tech Stack:** Google Apps Script (GAS), HtmlService, Vanilla JS frontend. No test runner — tests are GAS functions named `_test_*` that print to the GAS Execution Log.

---

## File map

| File | Changes |
|------|---------|
| `PS Contribution Report.js` | Add `computeFiscalContext_()` + `_test_computeFiscalContext()`; add `SI_COL_OVERRIDE: null` to CONFIG_PS; rename `buildQ4Weeks_PS_()` → `buildCurrentQWeeks_PS_(ctx)` + alias; thread `ctx` through `computePSReport_()`, `readRCR_PS_()`, `readSI_PS_()`, `readGoalsEngagement_()`; remove 5 CONFIG_PS constants; update payload; update `readPTOAccumulationProfiles_()` + `readPTOPlanningHealthByWeek_()` for PTO events |
| `PS Dashboard.html` | Sync `Q4` from `DATA.meta.fiscalContext` on load; add grace-period prior-quarter label in goals detail row; add PTO event badges in PTO detail row |

---

## Task 1: Add `computeFiscalContext_()` helper + test

**Files:**
- Modify: `PS Contribution Report.js` (CONFIG_PS block ~line 38, ISO week section ~line 771)

- [ ] **Step 1: Add `SI_COL_OVERRIDE: null` to CONFIG_PS**

In `PS Contribution Report.js` add one line at the end of the CONFIG_PS block (after line 80, before the closing `}`):

```js
  SI_COL_OVERRIDE: null,
  // Set to an explicit string (e.g. "Small Improvements Manager Rating FY27Q1")
  // only if the auto-generated SI column name doesn't match the sheet header.
```

- [ ] **Step 2: Add `computeFiscalContext_()` after `buildQ4Weeks_PS_()` (after line 771)**

```js
// Derives all fiscal-year and quarter constants from a reference date (defaults to today).
// Replaces hardcoded CONFIG_PS constants: GOALS_QUARTER, Q4_BASE_ISO_WEEK, Q4_BASE_YEAR,
// SI_QUARTER_COL, and MONTH_COLS — call this once per report and pass ctx to every reader.
function computeFiscalContext_(referenceDate) {
  var today = (referenceDate instanceof Date) ? referenceDate : new Date();
  var m  = today.getMonth() + 1; // 1–12
  var yr = today.getFullYear();

  // FY starts July 1. FY26 = Jul 2025 – Jun 2026.
  var fyStartCalYear = (m >= 7) ? yr : yr - 1;
  var fyNum          = fyStartCalYear + 1;
  var fyLabel        = "FY" + String(fyNum).slice(-2);  // "FY27"

  // Quarter: fixed 3-month windows
  var qNum, qStartM, qStartY, qEndM, qEndY;
  if      (m >= 7  && m <= 9)  { qNum = 1; qStartM = 7;  qStartY = fyStartCalYear;     qEndM = 9;  qEndY = fyStartCalYear;     }
  else if (m >= 10 && m <= 12) { qNum = 2; qStartM = 10; qStartY = fyStartCalYear;     qEndM = 12; qEndY = fyStartCalYear;     }
  else if (m >= 1  && m <= 3)  { qNum = 3; qStartM = 1;  qStartY = fyStartCalYear + 1; qEndM = 3;  qEndY = fyStartCalYear + 1; }
  else                         { qNum = 4; qStartM = 4;  qStartY = fyStartCalYear + 1; qEndM = 6;  qEndY = fyStartCalYear + 1; }

  var qLabel       = "Q" + qNum;
  var goalsQuarter = fyLabel + qLabel;                                     // "FY27Q1"
  var qStartDate   = new Date(qStartY, qStartM - 1, 1);
  var qEndDate     = new Date(qEndY, qEndM, 0);                            // last day of last month
  var dayOfQtr     = Math.floor((today - qStartDate) / 86400000);
  var inGracePeriod    = dayOfQtr < 14;                                    // days 0–13
  var inGoalWritingRamp = dayOfQtr < 28;                                   // days 0–27

  var qStartIsoWeek    = isoWeekNum_PS_(qStartDate);
  var qStartIsoYear    = isoWeekYear_PS_(qStartDate);
  var qEndIsoWeek      = isoWeekNum_PS_(qEndDate);
  var qEndIsoYear      = isoWeekYear_PS_(qEndDate);
  var graceEndDate     = new Date(qEndDate.getTime() + 14 * 86400000);
  var graceEndIsoWeek  = isoWeekNum_PS_(graceEndDate);
  var graceEndIsoYear  = isoWeekYear_PS_(graceEndDate);

  // Previous quarter (for grace period dual-load in readGoalsEngagement_)
  var pqNum, pqStartM, pqStartY, prevFyLabel;
  if      (qNum === 1) { pqNum = 4; pqStartM = 4;  pqStartY = fyStartCalYear;     prevFyLabel = "FY" + String(fyNum - 1).slice(-2); }
  else if (qNum === 2) { pqNum = 1; pqStartM = 7;  pqStartY = fyStartCalYear;     prevFyLabel = fyLabel; }
  else if (qNum === 3) { pqNum = 2; pqStartM = 10; pqStartY = fyStartCalYear;     prevFyLabel = fyLabel; }
  else                 { pqNum = 3; pqStartM = 1;  pqStartY = fyStartCalYear + 1; prevFyLabel = fyLabel; }

  var prevGoalsQuarter  = prevFyLabel + "Q" + pqNum;                       // "FY26Q4"
  var prevQStartDate    = new Date(pqStartY, pqStartM - 1, 1);
  var prevQStartIsoWeek = isoWeekNum_PS_(prevQStartDate);
  var prevQStartIsoYear = isoWeekYear_PS_(prevQStartDate);

  // SI column: always points to last completed quarter (one behind current)
  var siQuarterCol = CONFIG_PS.SI_COL_OVERRIDE ||
    ("Small Improvements Manager Rating " + prevGoalsQuarter);

  // MONTH_COLS: Jul–Jun labels for this FY (e.g. "Jul 26", "Jan 27")
  var ABBREVS  = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
  var monthCols = ABBREVS.map(function(a, i) {
    var y = (i < 6) ? fyStartCalYear : fyStartCalYear + 1;
    return a + " " + String(y).slice(-2);
  });

  return {
    fyLabel: fyLabel, qLabel: qLabel,
    goalsQuarter: goalsQuarter, siQuarterCol: siQuarterCol, monthCols: monthCols,
    qStartIsoWeek: qStartIsoWeek, qStartIsoYear: qStartIsoYear,
    qEndIsoWeek: qEndIsoWeek, qEndIsoYear: qEndIsoYear,
    graceEndIsoWeek: graceEndIsoWeek, graceEndIsoYear: graceEndIsoYear,
    inGracePeriod: inGracePeriod, inGoalWritingRamp: inGoalWritingRamp,
    prevGoalsQuarter: prevGoalsQuarter,
    prevQStartIsoWeek: prevQStartIsoWeek, prevQStartIsoYear: prevQStartIsoYear,
  };
}
```

- [ ] **Step 3: Add `_test_computeFiscalContext()` immediately after**

```js
function _test_computeFiscalContext() {
  var cases = [
    { date: "2026-06-30", desc: "Last day FY26Q4 — no grace, no ramp" },
    { date: "2026-07-01", desc: "FY27Q1 day 0 — grace + ramp active" },
    { date: "2026-07-07", desc: "FY27Q1 day 6 — grace + ramp active" },
    { date: "2026-07-14", desc: "FY27Q1 day 13 — last grace day" },
    { date: "2026-07-15", desc: "FY27Q1 day 14 — grace over, ramp active" },
    { date: "2026-07-28", desc: "FY27Q1 day 27 — last ramp day" },
    { date: "2026-07-29", desc: "FY27Q1 day 28 — both flags false" },
  ];
  cases.forEach(function(c) {
    var ctx = computeFiscalContext_(new Date(c.date));
    Logger.log(c.desc + " (" + c.date + ")");
    Logger.log("  fy=" + ctx.fyLabel + " q=" + ctx.qLabel +
               " goalsQ=" + ctx.goalsQuarter + " prevQ=" + ctx.prevGoalsQuarter);
    Logger.log("  siCol=" + ctx.siQuarterCol);
    Logger.log("  monthCols=[" + ctx.monthCols.join(", ") + "]");
    Logger.log("  qStart=W" + ctx.qStartIsoWeek + "/" + ctx.qStartIsoYear +
               " qEnd=W" + ctx.qEndIsoWeek + " graceEnd=W" + ctx.graceEndIsoWeek);
    Logger.log("  inGrace=" + ctx.inGracePeriod + " inRamp=" + ctx.inGoalWritingRamp);
  });
}
```

- [ ] **Step 4: Run `_test_computeFiscalContext` in the GAS editor**

In the GAS editor, select `_test_computeFiscalContext` from the function dropdown and click Run. Check the Execution Log. Expected:

| date | fyLabel | qLabel | goalsQ | prevQ | inGrace | inRamp |
|------|---------|--------|--------|-------|---------|--------|
| 2026-06-30 | FY26 | Q4 | FY26Q4 | FY26Q3 | false | false |
| 2026-07-01 | FY27 | Q1 | FY27Q1 | FY26Q4 | **true** | **true** |
| 2026-07-14 | FY27 | Q1 | FY27Q1 | FY26Q4 | **true** | **true** |
| 2026-07-15 | FY27 | Q1 | FY27Q1 | FY26Q4 | **false** | true |
| 2026-07-28 | FY27 | Q1 | FY27Q1 | FY26Q4 | false | **true** |
| 2026-07-29 | FY27 | Q1 | FY27Q1 | FY26Q4 | false | **false** |

`monthCols` for FY27 must start `["Jul 26", "Aug 26", ..., "Jun 27"]`.  
`siCol` for FY26Q4 must be `"Small Improvements Manager Rating FY26Q3"`.  
`siCol` for FY27Q1 must be `"Small Improvements Manager Rating FY26Q4"`.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat: add computeFiscalContext_() — auto-derive FY/quarter/SI col from date"
```

---

## Task 2: Thread ctx through `computePSReport_()` + rename `buildCurrentQWeeks_PS_()`

**Files:**
- Modify: `PS Contribution Report.js` (~lines 756–771, ~lines 2505–2545)

- [ ] **Step 1: Rename `buildQ4Weeks_PS_()` → `buildCurrentQWeeks_PS_(ctx)` and keep alias**

Replace the entire `buildQ4Weeks_PS_` function (lines 756–771) with:

```js
// Returns all weeks from the current quarter's start through today (oldest-first, no future).
// Pass ctx from computeFiscalContext_() to drive the start week dynamically.
function buildCurrentQWeeks_PS_(ctx) {
  var today    = new Date();
  var curW     = isoWeekNum_PS_(today);
  var curY     = isoWeekYear_PS_(today);
  var todayMon = mondayOfIsoWeek_PS_(curY, curW);
  var weeks    = [];
  var w = ctx.qStartIsoWeek, y = ctx.qStartIsoYear;
  while (y < curY || (y === curY && w <= curW)) {
    var entryMon = mondayOfIsoWeek_PS_(y, w);
    var off      = Math.round((entryMon - todayMon) / 86400000) / 7;
    weeks.push(makeWeekEntry_PS_(y, w, off));
    w++;
    if (w > weeksInYear_PS_(y)) { w = 1; y++; }
  }
  return weeks;
}

// One-release alias — remove after all callers have been updated.
function buildQ4Weeks_PS_() { return buildCurrentQWeeks_PS_(computeFiscalContext_()); }
```

- [ ] **Step 2: Add `ctx` call at the top of `computePSReport_()` and update all `q4Weeks` references**

In `computePSReport_` (around line 2505), after the existing `const active = activeRoster_(roster);` line, add:

```js
  const ctx = computeFiscalContext_();
```

Then replace the line:
```js
  const q4Weeks = buildQ4Weeks_PS_();
```
with:
```js
  const currentQWeeks = buildCurrentQWeeks_PS_(ctx);
```

Then rename every subsequent use of `q4Weeks` in `computePSReport_` to `currentQWeeks`:
- `q4Weeks.concat(weeks.filter(...))` → `currentQWeeks.concat(weeks.filter(...))`
- `q4Weeks.filter(w => !w.isFuture)` → `currentQWeeks.filter(w => !w.isFuture)`
- `readGoalsEngagement_(active, q4Weeks, extPastWeeks)` → `readGoalsEngagement_(active, currentQWeeks, extPastWeeks, ctx)`
- `futureWeeks.length ? q4Weeks.concat(futureWeeks) : q4Weeks` → `futureWeeks.length ? currentQWeeks.concat(futureWeeks) : currentQWeeks`

Also rename these local variables to match:
- `const q4PastWeeks = q4Weeks.filter(...)` → `const currentQPastWeeks = currentQWeeks.filter(...)`
- Every use of `q4PastWeeks` → `currentQPastWeeks`
- `const ptoQ4FTE = readPTOPlanningHealthByWeek_(fteRoster, q4PastWeeks, ...)` → `const ptoQ4FTE = readPTOPlanningHealthByWeek_(fteRoster, currentQPastWeeks, ...)`

The payload keys `ptoQ4History` and `goalsQ4Hist` remain **unchanged** (frontend depends on these names).

- [ ] **Step 3: Pass ctx to readRCR_PS_ and readSI_PS_ calls**

In `computePSReport_`, update the two reader calls:
```js
  const rcrAll = readRCR_PS_(active, fteActive, ctx);
  const siAll  = readSI_PS_(active, fteActive, ctx);
```

- [ ] **Step 4: Verify GAS deployment compiles without errors**

In the GAS editor, open `computePSReport_` and confirm the script saves without red underlines. If there are errors about `currentQPastWeeks` not defined, find any missed `q4PastWeeks` references and rename them.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "refactor: thread ctx through computePSReport_, rename buildCurrentQWeeks_PS_"
```

---

## Task 3: Update `readRCR_PS_()` and `readSI_PS_()` to use ctx

**Files:**
- Modify: `PS Contribution Report.js` (~lines 1039, 1055, 1066, 1154, 1191, 1195, 1207–1209)

- [ ] **Step 1: Update `readRCR_PS_` signature and MONTH_COLS usage**

Change the function signature from `readRCR_PS_(roster, teamSubset)` to `readRCR_PS_(roster, teamSubset, ctx)`:

```js
function readRCR_PS_(roster, teamSubset, ctx) {
```

Replace three uses of `CONFIG_PS.MONTH_COLS`:

Line ~1055 — change:
```js
  const rcrMonthIdxs = CONFIG_PS.MONTH_COLS.map(m => rcrHdrs.findIndex(h => h.trim() === m));
```
to:
```js
  const rcrMonthIdxs = ctx.monthCols.map(m => rcrHdrs.findIndex(h => h.trim() === m));
```

Line ~1066 — change:
```js
  const lastMonthName = CONFIG_PS.MONTH_COLS[lastMonthPos];
```
to:
```js
  const lastMonthName = ctx.monthCols[lastMonthPos];
```

Line ~1154 — change:
```js
    const monthName = CONFIG_PS.MONTH_COLS[mi];
```
to:
```js
    const monthName = ctx.monthCols[mi];
```

- [ ] **Step 2: Update `readSI_PS_` signature and SI_QUARTER_COL usage**

Change the function signature from `readSI_PS_(roster, teamSubset)` to `readSI_PS_(roster, teamSubset, ctx)`:

```js
function readSI_PS_(roster, teamSubset, ctx) {
```

Replace three uses of `CONFIG_PS.SI_QUARTER_COL`:

Line ~1195 — change:
```js
  const quarter = CONFIG_PS.SI_QUARTER_COL.match(/FY\w+/i)?.[0] || "";
```
to:
```js
  const quarter = ctx.siQuarterCol.match(/FY\w+/i)?.[0] || "";
```

Line ~1207 — change:
```js
  const iSI = hdrs.findIndex(h => h.trim() === CONFIG_PS.SI_QUARTER_COL);
```
to:
```js
  const iSI = hdrs.findIndex(h => h.trim() === ctx.siQuarterCol);
```

Line ~1209 — change:
```js
    Logger.log(`⚠️ SI column "${CONFIG_PS.SI_QUARTER_COL}" not found. Headers: ${hdrs.join(", ")}`);
```
to:
```js
    Logger.log(`⚠️ SI column "${ctx.siQuarterCol}" not found. Headers: ${hdrs.join(", ")}`);
```

- [ ] **Step 3: Run a GAS test to confirm RCR and SI still load**

Add this temporary test function (delete after confirming):

```js
function _test_rcrSiCtx() {
  const ctx = computeFiscalContext_();
  Logger.log("ctx.monthCols: " + ctx.monthCols.join(", "));
  Logger.log("ctx.siQuarterCol: " + ctx.siQuarterCol);
  const roster = readPSRoster_();
  const active = activeRoster_(roster);
  const fte = new Map([...active].filter(([, p]) => !p.isCrewMember));
  const rcr = readRCR_PS_(active, fte, ctx);
  const si  = readSI_PS_(active, fte, ctx);
  Logger.log("RCR lastMonth=" + rcr.lastMonth + " teamRCR=" + rcr.teamRCR);
  Logger.log("SI  teamAvg="   + si.teamAvg    + " quarter=" + si.quarter);
}
```

Run `_test_rcrSiCtx` in GAS editor. Expected: RCR `lastMonth` matches today's FY month, SI `quarter` matches `ctx.prevGoalsQuarter`.

- [ ] **Step 4: Remove temporary test function, commit**

```bash
git add "PS Contribution Report.js"
git commit -m "refactor: readRCR_PS_ and readSI_PS_ use ctx instead of CONFIG_PS constants"
```

---

## Task 4: Update `readGoalsEngagement_()` — grace period + writing ramp

**Files:**
- Modify: `PS Contribution Report.js` (~lines 1753–1910)

- [ ] **Step 1: Add `ctx` parameter to the function signature**

Change line ~1753:
```js
function readGoalsEngagement_(psNames, weeks, histWeeks) {
```
to:
```js
function readGoalsEngagement_(psNames, weeks, histWeeks, ctx) {
```

- [ ] **Step 2: Declare `prevGoalMap` at the top of the function, after `const goalMap = new Map();` (~line 1785)**

```js
  const prevGoalMap = new Map(); // prior-quarter counts for grace period display
```

- [ ] **Step 3: Replace the single-quarter filter (line ~1790) with dual-quarter logic**

Replace:
```js
    if (iQuarter !== -1 && String(row[iQuarter] || "").trim() !== CONFIG_PS.GOALS_QUARTER) return;
```
with:
```js
    if (iQuarter !== -1) {
      const rowQ = String(row[iQuarter] || "").trim();
      if (ctx.inGracePeriod && rowQ === ctx.prevGoalsQuarter) {
        // Prior quarter — collect counts for display only, then skip main goalMap
        const norm = normPS_(String(row[iRocketeer] || "").trim());
        if (psNames.has(norm)) {
          const rawGoalId   = iGoalId   !== -1 ? String(row[iGoalId]   || "").trim() : "";
          const rawGoalName = iGoalName !== -1 ? String(row[iGoalName] || "").trim() : "";
          let goalId = rawGoalId || rawGoalName;
          for (const { pattern, id } of CONFIG_PS.GOAL_ID_MAP) {
            if (pattern.test(rawGoalName || rawGoalId)) { goalId = id; break; }
          }
          if (!prevGoalMap.has(norm)) prevGoalMap.set(norm, { _ids: new Set(), goalCount: 0, completedCount: 0 });
          const p = prevGoalMap.get(norm);
          if (goalId && !p._ids.has(goalId)) {
            p._ids.add(goalId);
            p.goalCount++;
            const status = String(iStatus !== -1 ? row[iStatus] : "").trim();
            if (status === "Completed") p.completedCount++;
          }
        }
        return;
      }
      if (rowQ !== ctx.goalsQuarter) return;
    }
```

- [ ] **Step 4: Update the logger (line ~1829) to use `ctx.goalsQuarter`**

Replace:
```js
  Logger.log(`Goals: data loaded for ${goalMap.size} rocketeers (${CONFIG_PS.GOALS_QUARTER}).`);
```
with:
```js
  Logger.log(`Goals: data loaded for ${goalMap.size} rocketeers (${ctx.goalsQuarter}).`);
```

- [ ] **Step 5: Replace the `qWeek` calculation and add the writing-ramp guard (lines ~1835–1856)**

Replace:
```js
    const qWeek    = Math.max(1, isoW - CONFIG_PS.Q4_BASE_ISO_WEEK + 1);
    // Cumulative self-comment count required per goal — ramps 1 → 6 across Q4
    const reqCmt   = Math.max(1, qWeek - 4);
```
with:
```js
    const qWeek    = Math.max(1, isoW - ctx.qStartIsoWeek + 1);
    const reqCmt   = Math.max(1, qWeek - 4);
    // Writing ramp: no goal-count penalty for first 4 weeks of any quarter
    const goalsRequired = qWeek <= 4 ? 0 : CONFIG_PS.GOALS_MIN_COUNT;
```

Replace the early-exit for missing goals (~line 1844):
```js
      if (!empGoals || empGoals.size === 0) {
        result[week.label].byEmployee[norm] = { compliant: false, rule: 1, totalGoals: 0 };
        return;
      }
```
with:
```js
      if (!empGoals || empGoals.size === 0) {
        if (goalsRequired === 0) {
          result[week.label].byEmployee[norm] = { compliant: true, rule: null, totalGoals: 0, inWritingRamp: true };
          compliant++;
          return;
        }
        result[week.label].byEmployee[norm] = { compliant: false, rule: 1, totalGoals: 0 };
        return;
      }
```

Replace Rule 1 check (~line 1853):
```js
      // Rule 1: must have at least GOALS_MIN_COUNT goals
      if (totalGoals < CONFIG_PS.GOALS_MIN_COUNT) {
        result[week.label].byEmployee[norm] = { compliant: false, rule: 1, totalGoals };
        return;
      }
```
with:
```js
      // Rule 1: must have at least goalsRequired goals (relaxed to 0 during writing ramp)
      if (totalGoals < goalsRequired) {
        result[week.label].byEmployee[norm] = { compliant: false, rule: 1, totalGoals };
        return;
      }
```

- [ ] **Step 6: Attach prior-quarter summary during grace period (add after the compliance-override block, ~line 1910)**

After the closing `});` of the compliance override `psNames.forEach` block, add:

```js
  // Grace period: attach prior-quarter summary to all employees for frontend display
  if (ctx.inGracePeriod && prevGoalMap.size > 0) {
    weeks.filter(w => !w.isFuture).forEach(week => {
      psNames.forEach((_, norm) => {
        const pq = prevGoalMap.get(norm);
        if (!pq) return;
        if (!result[week.label].byEmployee[norm]) return;
        result[week.label].byEmployee[norm].prevQuarterGoals = {
          quarter:        ctx.prevGoalsQuarter,
          goalCount:      pq.goalCount,
          completedCount: pq.completedCount,
        };
      });
    });
  }
```

- [ ] **Step 7: Run manual smoke test in GAS**

Add a temporary function:

```js
function _test_goalsGrace() {
  const ctx = computeFiscalContext_(new Date("2026-07-07")); // simulate grace period
  const roster = readPSRoster_();
  const active = activeRoster_(roster);
  const weeks  = buildWeekWindow_PS_();
  const qWeeks = buildCurrentQWeeks_PS_(ctx);
  const result = readGoalsEngagement_(active, qWeeks, weeks, ctx);
  Logger.log("inGracePeriod=" + ctx.inGracePeriod + " prevQ=" + ctx.prevGoalsQuarter);
  const sampleWeek = Object.keys(result)[0];
  if (sampleWeek) {
    const byEmp = result[sampleWeek].byEmployee;
    const sampleNorm = Object.keys(byEmp)[0];
    if (sampleNorm) Logger.log("sampleEmp[" + sampleNorm + "] = " + JSON.stringify(byEmp[sampleNorm]));
  }
}
```

Run `_test_goalsGrace`. Check log: `inGracePeriod=true`. If any employee has prior quarter goals, their record should include `prevQuarterGoals: { quarter: "FY26Q4", ... }`.

- [ ] **Step 8: Remove temporary test function, commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat: readGoalsEngagement_ — grace period dual-load + Q1 writing ramp"
```

---

## Task 5: Remove 5 deprecated CONFIG_PS constants + update payload

**Files:**
- Modify: `PS Contribution Report.js` (CONFIG_PS ~lines 38–65, computePSReport_ payload ~line 2679)

- [ ] **Step 1: Remove the 5 deprecated constants from CONFIG_PS**

Delete these lines from the `CONFIG_PS` block:

```js
  GOALS_QUARTER:     "FY26Q4",
  SI_QUARTER_COL:    "Small Improvements Manager Rating FY26Q3",

  // FY26Q4: April 1–June 30 2026; week containing Apr 1 = ISO week 14
  Q4_BASE_ISO_WEEK:  14,
  Q4_BASE_YEAR:      2026,
```

And the `MONTH_COLS` array:

```js
  MONTH_COLS: [
    "Jul 25","Aug 25","Sep 25","Oct 25","Nov 25","Dec 25",
    "Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26"
  ],
```

- [ ] **Step 2: Update the payload assembly in `computePSReport_()` (~line 2679)**

Replace:
```js
      goalsQuarter:     CONFIG_PS.GOALS_QUARTER,
```
with:
```js
      goalsQuarter:     ctx.goalsQuarter,
      fiscalContext:    ctx,
```

- [ ] **Step 3: Verify no remaining references to removed constants**

Run this search in the GAS editor (Ctrl+F):
- `CONFIG_PS.GOALS_QUARTER` → must return 0 results
- `CONFIG_PS.Q4_BASE_ISO_WEEK` → must return 0 results
- `CONFIG_PS.Q4_BASE_YEAR` → must return 0 results
- `CONFIG_PS.SI_QUARTER_COL` → must return 0 results
- `CONFIG_PS.MONTH_COLS` → must return 0 results

- [ ] **Step 4: Run `_test_computeFiscalContext` again to confirm no breakage**

Expected: same output as Task 1 Step 4.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "refactor: remove 5 deprecated CONFIG_PS constants, add fiscalContext to payload"
```

---

## Task 6: PTO events — `readPTOAccumulationProfiles_()`

**Files:**
- Modify: `PS Contribution Report.js` (~lines 1313–1370)

- [ ] **Step 1: Detect `isYearExpiry` and `isCarryover` in the main data loop (~line 1329)**

In the main data loop of `readPTOAccumulationProfiles_`, after the existing detection lines:
```js
      const adjType   = String(row[COL.adjType] || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const isUsageTx = adjType.includes("usage") || adjType.includes("timeoff");
      const isAccrual = adjType.includes("accru");
```

Add:
```js
      const isYearExpiry = adjType.includes("yearend");
      const isCarryover  = adjType === "carryover";
```

- [ ] **Step 2: Store flags on `balanceHistory` entry (~line 1335)**

Change:
```js
      p.balanceHistory.push({
        date, balance: parseSmartFloat_PTO_(row[COL.balance]),
        isUsage: isUsageTx, isAccrual, explicitAmt,
      });
```
to:
```js
      p.balanceHistory.push({
        date, balance: parseSmartFloat_PTO_(row[COL.balance]),
        isUsage: isUsageTx, isAccrual, explicitAmt,
        isYearExpiry, isCarryover,
      });
```

- [ ] **Step 3: Initialize `p.events` array on the profile (~line 1326)**

Change:
```js
      if (!profiles[empNum]) profiles[empNum] = { balanceHistory: [], plannedUsageDates: [], transactions: [] };
```
to:
```js
      if (!profiles[empNum]) profiles[empNum] = { balanceHistory: [], plannedUsageDates: [], transactions: [], events: [] };
```

- [ ] **Step 4: Build `p.events` in the post-sort loop (~after line 1347)**

In `Object.values(profiles).forEach(p => {...})`, add the events build after `p.balanceHistory.sort(...)`:

```js
      // Build display events for Year End Expiry / Carryover transactions
      p.events = [];
      p.balanceHistory.forEach((entry, i) => {
        if (!entry.isYearExpiry && !entry.isCarryover) return;
        let hours;
        if (entry.explicitAmt !== null && entry.explicitAmt > 0) {
          hours = entry.isCarryover ? entry.explicitAmt : -entry.explicitAmt;
        } else if (i > 0) {
          const delta = entry.balance - p.balanceHistory[i - 1].balance;
          hours = Math.round(delta);
        } else {
          return;
        }
        const isoW = isoWeekNum_PS_(entry.date);
        const isoY = isoWeekYear_PS_(entry.date);
        p.events.push({
          date:      entry.date,
          weekLabel: isoY + ".W" + isoW,
          type:      entry.isYearExpiry ? "year-expiry" : "carryover",
          hours:     Math.round(hours),
        });
      });
```

- [ ] **Step 5: Run a quick log check in GAS**

Add temporary function:

```js
function _test_ptoEvents() {
  const profiles = readPTOAccumulationProfiles_();
  var found = 0;
  Object.entries(profiles).forEach(function([empNum, p]) {
    if (p.events && p.events.length > 0) {
      found++;
      Logger.log("empNum=" + empNum + " events=" + JSON.stringify(p.events));
    }
  });
  Logger.log("Total employees with PTO events: " + found);
}
```

Run `_test_ptoEvents`. If the sheet has Year End Expiry / Carryover rows, `found > 0`. If 0, the sheet may not have data yet (acceptable — additive change).

- [ ] **Step 6: Remove temporary test function, commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat: readPTOAccumulationProfiles_ detects Year End Expiry and Carryover events"
```

---

## Task 7: PTO events — `readPTOPlanningHealthByWeek_()`

**Files:**
- Modify: `PS Contribution Report.js` (~lines 1479–1488)

- [ ] **Step 1: Attach `ptoEvents` to each employee's week bucket**

In `readPTOPlanningHealthByWeek_`, find the block where `bucket.byEmployee[norm]` is assigned (~line 1479):

```js
        bucket.byEmployee[norm] = {
          status, reason,
          balance:        latestBalance,
          ...
        };
```

Add the events lookup immediately after this assignment:

```js
        // Attach any Year End Expiry / Carryover events that fall in this week
        const empEvents = accumP ? (accumP.events || []).filter(e => e.weekLabel === week.label) : [];
        if (empEvents.length > 0) {
          bucket.byEmployee[norm].ptoEvents = empEvents.map(e => ({ type: e.type, hours: e.hours }));
        }
```

- [ ] **Step 2: Run smoke test**

Add temporary function:

```js
function _test_ptoEventsInWeek() {
  const roster   = readPSRoster_();
  const profiles = readPTOAccumulationProfiles_();
  const weeks    = buildWeekWindow_PS_();
  const ctx      = computeFiscalContext_();
  const qWeeks   = buildCurrentQWeeks_PS_(ctx);
  const allWeeks = qWeeks.concat(weeks.filter(w => w.isFuture));
  const result   = readPTOPlanningHealthByWeek_(roster, allWeeks, profiles);
  var found = 0;
  Object.entries(result).forEach(function([wl, wd]) {
    Object.entries(wd.byEmployee || {}).forEach(function([norm, emp]) {
      if (emp.ptoEvents && emp.ptoEvents.length > 0) {
        found++;
        Logger.log("week=" + wl + " emp=" + norm + " events=" + JSON.stringify(emp.ptoEvents));
      }
    });
  });
  Logger.log("Total ptoEvents found across all weeks/employees: " + found);
}
```

Run `_test_ptoEventsInWeek`. Confirm no errors. `found` matches Task 6 Step 5 event count.

- [ ] **Step 3: Remove temporary test, commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat: readPTOPlanningHealthByWeek_ surfaces ptoEvents per employee per week"
```

---

## Task 8: Frontend — `Q4` from `fiscalContext` + grace period label + PTO event badges

**Files:**
- Modify: `PS Dashboard.html` (~lines 2082, 2134, 4884, 5057)

- [ ] **Step 1: Sync `Q4` from `DATA.meta.fiscalContext` on data load (~line 2134)**

After the line `DATA = payload;` (~line 2134), add:

```js
  // Sync Q4 constants from server so renders stay correct at every quarter rollover
  if (payload.meta && payload.meta.fiscalContext) {
    var fc = payload.meta.fiscalContext;
    Q4 = {
      START_W: fc.qStartIsoWeek,
      END_W:   fc.qEndIsoWeek,
      GRACE_W: fc.graceEndIsoWeek,
      YEAR:    fc.qStartIsoYear,
    };
  }
```

This overrides the hardcoded fallback at line 2082 with the server's computed values.

- [ ] **Step 2: Add prior-quarter summary label in Goals detail row (~line 4920)**

In the `det-expand-body` goals row, inside the `weeks.forEach` loop where each `gd` is rendered (around line 4921), after rendering the current-quarter goals detail, add a prior-quarter summary block.

Find the section starting at ~line 4920:
```js
  weeks.forEach(function(w) {
    var gd = (emp.weeks[w.label] || {}).goalsDetail;
    html += '<td><div class="det-expand-inner"><div class="det-expand-pad">';
    if (w.isFuture && empHasOverride) {
```

After the closing `html += '</div></div></td>';` of each week cell (before `});` closing the forEach), add inside the same `<div class="det-expand-pad">` — specifically inside the `if (ph && ph.balance !== null)` area equivalent for goals. To keep it non-breaking, inject the prior-quarter label only when `gd && gd.prevQuarterGoals`:

Find the `if (w.isFuture || !gd)` block (line ~4925). After the closing `}` of the main goals detail render (just before `html += '</div></div></td>';`), add:

```js
    // Grace period: show prior-quarter closed summary
    if (gd && gd.prevQuarterGoals) {
      var pq = gd.prevQuarterGoals;
      html += '<div style="margin-top:4px;padding:3px 5px;background:#F0F4FF;border-radius:3px;font-size:10px;color:#3B5BDB">'
            + esc(pq.quarter) + ' — Closed · '
            + pq.completedCount + '/' + pq.goalCount + ' completed'
            + '</div>';
    }
```

- [ ] **Step 3: Add PTO event badges in PTO detail expand row (~line 5063)**

In the PTO detail expand row (around line 5063), inside the `weeks.forEach` loop, after the existing `diffLine` and `status` rendering, add the ptoEvents badges.

After the `html += diffLine;` and the Good/At risk status lines (before `prevBal = bal;`), add:

```js
      // Show Year End Expiry / Carryover events as informational badges
      var ptoEvents = ph.ptoEvents || [];
      ptoEvents.forEach(function(ev) {
        var label = ev.type === 'carryover'
          ? '+' + ev.hours + 'h carried over'
          : ev.hours + 'h expired';
        var bg = ev.type === 'carryover' ? '#ECFDF5' : '#FEF3C7';
        var fg = ev.type === 'carryover' ? '#065F46' : '#92400E';
        html += '<div style="margin-top:3px;padding:2px 5px;background:' + bg
              + ';color:' + fg + ';border-radius:3px;font-size:10px">' + esc(label) + '</div>';
      });
```

- [ ] **Step 4: Verify in browser**

Deploy the updated script to GAS (or use `doGet` in a test deployment). Open the dashboard. Check:

1. In the Goals detail row for any employee — if `DATA.meta.fiscalContext.inGracePeriod` is `true`, employees with FY26Q4 goals should show the "FY26Q4 — Closed · X/Y completed" label.
2. In the PTO detail row — if any employee has `ptoEvents` in a January week, that week should show the badge (e.g., `+40h carried over`).
3. The `Q4` object in the browser console (`console.log(Q4)`) should show the server-computed values, not the hardcoded ones.

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat: frontend syncs Q4 from fiscalContext, adds grace-period label + PTO event badges"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task that covers it |
|---|---|
| `computeFiscalContext_()` helper with all return fields | Task 1 |
| Remove 5 CONFIG_PS constants | Task 5 |
| Add `SI_COL_OVERRIDE` escape hatch | Task 1 Step 1 |
| Grace period dual-load in `readGoalsEngagement_` | Task 4 |
| Q1 writing ramp (4-week no-penalty) | Task 4 Step 5 |
| `buildQ4Weeks_PS_()` → `buildCurrentQWeeks_PS_(ctx)` + alias | Task 2 Step 1 |
| `readRCR_PS_` uses ctx.monthCols | Task 3 Step 1 |
| `readSI_PS_` uses ctx.siQuarterCol | Task 3 Step 2 |
| Payload gains `fiscalContext` field | Task 5 Step 2 |
| PTO Year End Expiry / Carryover detection | Task 6 |
| `ptoEvents` per week in byEmployee | Task 7 |
| Frontend `Q4` from fiscalContext | Task 8 Step 1 |
| Grace period label in goals detail row | Task 8 Step 2 |
| PTO event badges in PTO detail row | Task 8 Step 3 |

All spec requirements covered. ✓

### Placeholder scan
No TBD / TODO / "similar to above" in any step. All code blocks are complete. ✓

### Type consistency
- `ctx` object fields (`qStartIsoWeek`, `goalsQuarter`, `prevGoalsQuarter`, etc.) defined in Task 1, used identically in Tasks 2–8. ✓
- `ptoEvents` array shape `[{ type, hours }]` defined in Task 7, consumed in Task 8. ✓
- `prevQuarterGoals` object shape `{ quarter, goalCount, completedCount }` defined in Task 4, consumed in Task 8. ✓
- `buildCurrentQWeeks_PS_(ctx)` defined in Task 2 Step 1, called in Task 2 Step 2. ✓
