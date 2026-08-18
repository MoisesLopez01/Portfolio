# PTO-Aware Planning, Tracking & Goals Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Planned-hours scoring, the Team Radar, and Goals compliance PTO-aware — a rocketeer who took PTO isn't scored as "under-planned/under-tracked" or "non-compliant," and managers get an aggregate PTO-impact note in the Team Executive Brief.

**Architecture:** One new backend field (`ptoAdjustedTargetHrs`, computed once per employee-week) feeds a fixed-target scoring calc in `buildTopPerformers_` (server) and its manual mirror `computeRkScore` (client). A separate, unrelated fix excludes PTO-impacted employees from the binary compliance denominators in Team Radar's `computeGroupMetrics` (client) and from the Goals self-comment pacing rule in `readGoalsEngagement_` (server). A new aggregate note in `generateTeamBrief` (client) surfaces PTO impact to managers.

**Tech Stack:** Google Apps Script (server: `PS Contribution Report.js`), vanilla client JS in `PS Dashboard.html` (HtmlService). Server-side pure functions are tested in a Node `vm` sandbox with GAS globals stubbed (this project's existing convention — see `.superpowers/sdd/task-4-report.md`). `PS Dashboard.html` has no existing test harness; its tasks are verified by manual trace against a temporary DATA fixture plus a live-dashboard check in Task 9.

**Spec:** `ps-dashboard/docs/specs/2026-07-03-pto-planned-tracked-goals-override-design.md`

**Note on scope:** the spec's third named consumer of the PTO-adjusted target — the Trends
"Team Delivery Rate" chart (`renderTimeMomentum`) — needs **no code change**. It already sums
already-PTO-net planned/tracked totals and already returns `null` (renders as a gap, not a
misleading 0%/spike) whenever a week's team planned hours is 0. No task below touches it;
Task 9 doesn't re-verify it for the same reason.

---

### Task 1: Add PTO CONFIG_PS constants

**Files:**
- Modify: `PS Contribution Report.js:20-26`

- [ ] **Step 1: Add the three new constants**

In `PS Contribution Report.js`, find:
```js
  // PTO Planning Health — external accumulation spreadsheet
  PTO_ACCUM_SS_ID:            "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
  PTO_ACCUM_SHEET:            "Accumulation Cost",
  PTO_BALANCE_THRESHOLD:      100,   // hours — at or below = automatically Good
  PTO_PLANNING_HORIZON_MONTHS: 6,    // look-ahead window for a Usage planning signal
  PTO_TEAM_TARGET_PCT:        80,    // celebrate at this team-level score
  SHEET_TEMPO_TRACKED:   "Tempo Tracked Time",
```
Replace with:
```js
  // PTO Planning Health — external accumulation spreadsheet
  PTO_ACCUM_SS_ID:            "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
  PTO_ACCUM_SHEET:            "Accumulation Cost",
  PTO_BALANCE_THRESHOLD:      100,   // hours — at or below = automatically Good
  PTO_PLANNING_HORIZON_MONTHS: 6,    // look-ahead window for a Usage planning signal
  PTO_TEAM_TARGET_PCT:        80,    // celebrate at this team-level score
  PTO_IMPACT_THRESHOLD_HRS:   8,     // >= this much weekly PTO triggers the Exec Brief note
                                      // and excludes the employee from Radar's tracked/planned
                                      // compliance denominators for that week
  PTO_FULL_WEEK_HRS:          40,    // >= this much weekly PTO exempts Goals rule 3 (self-comment
                                      // pacing) for that week only
  PTO_MIN_TARGET_HRS:         0,     // floor for ptoAdjustedTargetHrs — never negative
  SHEET_TEMPO_TRACKED:   "Tempo Tracked Time",
```

- [ ] **Step 2: Verify the file still parses**

Run:
```
node -e "require('fs').readFileSync('PS Contribution Report.js','utf8'); new (require('vm').Script)(require('fs').readFileSync('PS Contribution Report.js','utf8'), {filename:'PS Contribution Report.js'}); console.log('PARSE OK');"
```
Expected: `PARSE OK`

- [ ] **Step 3: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "Add PTO_IMPACT_THRESHOLD_HRS, PTO_FULL_WEEK_HRS, PTO_MIN_TARGET_HRS constants"
```

---

### Task 2: Compute `ptoAdjustedTargetHrs` per employee-week

**Files:**
- Modify: `PS Contribution Report.js:2438-2461` (`buildEmployeeRows_`)
- Test: appended to `PS Contribution Report.js` as `_test_ptoAdjustedTargetHrs_`

- [ ] **Step 1: Write the failing test**

Append this function to the end of `PS Contribution Report.js` (after the last existing `_test_...` function):

```js
// Unit test for the PTO-adjusted weekly target. Run in the GAS editor, or in Node
// (stub Logger — see .superpowers/sdd/task-4-report.md for the sandbox pattern).
function _test_ptoAdjustedTargetHrs_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_ptoAdjustedTargetHrs_: " + msg); }

  const roster = new Map([
    [normPS_("Ana Smith"), { name: "Ana Smith", keyLocation: "Remote", supervisor: "Mgr", jobTitle: "Consultant", dept: "Services", isRampUp: false, isCrewMember: false }],
    [normPS_("Ben Lee"),   { name: "Ben Lee",   keyLocation: "Remote", supervisor: "Mgr", jobTitle: "Consultant", dept: "Services", isRampUp: false, isCrewMember: false }],
  ]);
  const weeks  = [{ label: "2026.W20", isFuture: false }];
  const normAna = normPS_("Ana Smith"), normBen = normPS_("Ben Lee");

  const planned = { "2026.W20": {
    byEmployee:    { [normAna]: 32, [normBen]: 0 },
    ptoByEmployee: { [normAna]: 8,  [normBen]: 40 },
    byEmployeeProjects: {},
  }};
  const emptyByWeek = { "2026.W20": { byEmployee: {} } };

  const employees = buildEmployeeRows_(roster, weeks, { byEmployee: {} }, { byEmployee: {} },
    emptyByWeek, emptyByWeek, emptyByWeek, planned, emptyByWeek);

  const ana = employees.find(e => e.normName === normAna);
  const ben = employees.find(e => e.normName === normBen);

  assert_(ana.weeks["2026.W20"].ptoAdjustedTargetHrs === 32, "Ana (8h PTO): expected target 32, got " + ana.weeks["2026.W20"].ptoAdjustedTargetHrs);
  assert_(ben.weeks["2026.W20"].ptoAdjustedTargetHrs === 0,  "Ben (40h PTO): expected target floored at 0, got " + ben.weeks["2026.W20"].ptoAdjustedTargetHrs);

  Logger.log("✅ _test_ptoAdjustedTargetHrs_ passed");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Create `run-test.js` in your scratchpad directory:
```js
global.Logger = { log: console.log };
global.SpreadsheetApp = {};
global.PropertiesService = {};
global.CacheService = {};
global.UrlFetchApp = {};
global.Session = {};
global.Utilities = {};
global.HtmlService = {};

const fs = require('fs');
const path = 'D:/Contribution/PS Contribution Report.js';
const src = fs.readFileSync(path, 'utf8');

const vm = require('vm');
const script = new vm.Script(src, { filename: path });
const context = vm.createContext(global);
script.runInContext(context);

context._test_ptoAdjustedTargetHrs_();
console.log('NODE TEST RUN: SUCCESS');
```
Run: `node "<scratchpad>/run-test.js"`
Expected: throws `❌ _test_ptoAdjustedTargetHrs_: Ana (8h PTO): expected target 32, got undefined` (the field doesn't exist yet).

- [ ] **Step 3: Implement `ptoAdjustedTargetHrs`**

In `PS Contribution Report.js`, find (inside `buildEmployeeRows_`):
```js
    weeks.forEach(w => {
      const l = w.label;
      empWeeks[l] = {
        trackedHrs:  w.isFuture  ? null : (tracked[l]  && tracked[l].byEmployee[norm]  != null ? tracked[l].byEmployee[norm]  : null),
        plannedHrs:     planned[l] && planned[l].byEmployee[norm] != null ? planned[l].byEmployee[norm] : null,
        ptoPlannedHrs:  planned[l] && planned[l].ptoByEmployee  && planned[l].ptoByEmployee[norm]  != null ? planned[l].ptoByEmployee[norm]  : null,
        ptoHealth:   pto[l]     && pto[l].byEmployee[norm]     ? pto[l].byEmployee[norm]     : null,
```
Replace with:
```js
    weeks.forEach(w => {
      const l = w.label;
      const ptoHrsForWeek = (planned[l] && planned[l].ptoByEmployee && planned[l].ptoByEmployee[norm] != null)
        ? planned[l].ptoByEmployee[norm] : 0;
      empWeeks[l] = {
        trackedHrs:  w.isFuture  ? null : (tracked[l]  && tracked[l].byEmployee[norm]  != null ? tracked[l].byEmployee[norm]  : null),
        plannedHrs:     planned[l] && planned[l].byEmployee[norm] != null ? planned[l].byEmployee[norm] : null,
        ptoPlannedHrs:  planned[l] && planned[l].ptoByEmployee  && planned[l].ptoByEmployee[norm]  != null ? planned[l].ptoByEmployee[norm]  : null,
        // PTO-adjusted weekly capacity for scoring — shrinks the 40h planning target by
        // however many PTO hours this employee logged that week, floored at PTO_MIN_TARGET_HRS.
        // Consumed by buildTopPerformers_ (server) and computeRkScore (client mirror) instead
        // of the flat SCORE_PLANNED_CAP_HRS, so a PTO week isn't scored as under-planned.
        ptoAdjustedTargetHrs: Math.max(CONFIG_PS.PTO_MIN_TARGET_HRS, CONFIG_PS.SCORE_PLANNED_CAP_HRS - ptoHrsForWeek),
        ptoHealth:   pto[l]     && pto[l].byEmployee[norm]     ? pto[l].byEmployee[norm]     : null,
```
(The remaining lines of the object literal — `kudos`, `goalsDetail`, `projects` — are unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node "<scratchpad>/run-test.js"`
Expected: `NODE TEST RUN: SUCCESS`

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "Add ptoAdjustedTargetHrs per employee-week for PTO-aware scoring"
```

---

### Task 3: PTO-aware Planned/Tracked scoring in Top Rocketeers

**Files:**
- Modify: `PS Contribution Report.js:2553-2555` (`buildTopPerformers_`)
- Test: appended to `PS Contribution Report.js` as `_test_ptoAdjustedScoring_`

- [ ] **Step 1: Write the failing test**

Append to `PS Contribution Report.js`:

```js
// Unit test for PTO-adjusted plannedNorm/trackedNorm in buildTopPerformers_.
function _test_ptoAdjustedScoring_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_ptoAdjustedScoring_: " + msg); }

  const weeks = [{ label: "2026.W20", isPast: true, dateRange: "May 11-17 2026" }];

  function emp(name, plannedHrs, ptoAdjustedTargetHrs, trackedHrs) {
    return {
      name: name, normName: normPS_(name), keyLocation: "Remote", supervisor: "Mgr",
      jobTitle: "Consultant", isRampUp: false, isCrewMember: false, rcr: null, si: null,
      weeks: { "2026.W20": {
        plannedHrs: plannedHrs, ptoAdjustedTargetHrs: ptoAdjustedTargetHrs, trackedHrs: trackedHrs,
        ptoPlannedHrs: null, ptoHealth: null, kudos: null, goalsDetail: null,
      }},
    };
  }

  // Normal week, no PTO: target stays 40h — unchanged from before this feature.
  const noPto      = emp("Ana Smith", 20, 40, 20);
  // Partial PTO week: 8h PTO -> target 32h. 32h planned now reads as fully planned
  // (was 32/40 = 80% before this fix).
  const partialPto = emp("Ben Lee",  32, 32, 32);
  // Full PTO week: target floors at 0h. 0 planned/0 tracked must read as fully
  // credited (1), not zeroed out or NaN.
  const fullPto     = emp("Cara Diaz", 0,  0,  0);

  const cfg    = { matrix: {}, catalog: new Map(), base: DEFAULT_WEIGHTS_, audit: [] };
  const result = buildTopPerformers_([noPto, partialPto, fullPto], weeks, cfg);
  const byName = {};
  result.performers.forEach(p => { byName[p.name] = p.metrics; });

  assert_(byName["Ana Smith"].plannedNorm === 0.5, "no-PTO week: expected plannedNorm 0.5, got " + byName["Ana Smith"].plannedNorm);
  assert_(byName["Ben Lee"].plannedNorm === 1,     "partial-PTO week: expected plannedNorm 1 (32/32), got " + byName["Ben Lee"].plannedNorm);
  assert_(byName["Cara Diaz"].plannedNorm === 1,   "full-PTO week: expected plannedNorm 1 (target floor), got " + byName["Cara Diaz"].plannedNorm);
  assert_(byName["Cara Diaz"].trackedNorm === 1,   "full-PTO week: expected trackedNorm 1 (target floor), got " + byName["Cara Diaz"].trackedNorm);

  Logger.log("✅ _test_ptoAdjustedScoring_ passed");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Reuse the `run-test.js` harness from Task 2 (same stub globals), changing the last two lines to:
```js
context._test_ptoAdjustedScoring_();
console.log('NODE TEST RUN: SUCCESS');
```
Run: `node "<scratchpad>/run-test.js"`
Expected: throws `❌ _test_ptoAdjustedScoring_: partial-PTO week: expected plannedNorm 1 (32/32), got 0.8`

- [ ] **Step 3: Implement the fix**

In `PS Contribution Report.js`, find (inside `buildTopPerformers_`):
```js
      const trackedTarget = (wd.plannedHrs !== null && wd.plannedHrs > 0) ? wd.plannedHrs * CONFIG_PS.SCORE_TRACKED_RATIO : CONFIG_PS.DEFAULT_TARGET_WEEKLY_HRS;
      const trackedNorm = wd.trackedHrs !== null ? Math.min(1, wd.trackedHrs / trackedTarget) : 0;
      const plannedNorm = wd.plannedHrs !== null ? Math.min(1, wd.plannedHrs / CONFIG_PS.SCORE_PLANNED_CAP_HRS) : 0;
```
Replace with:
```js
      const plannedTargetHrs = wd.ptoAdjustedTargetHrs != null ? wd.ptoAdjustedTargetHrs : CONFIG_PS.SCORE_PLANNED_CAP_HRS;
      // Fallback (no planned hours that week) used to be a flat DEFAULT_TARGET_WEEKLY_HRS
      // (36h) — that zeroed out tracked score on a full-PTO week, since plannedHrs is
      // already net-of-PTO by this point. Scaling the fallback off plannedTargetHrs keeps
      // it consistent with the same PTO adjustment.
      const trackedTarget = (wd.plannedHrs !== null && wd.plannedHrs > 0)
        ? wd.plannedHrs * CONFIG_PS.SCORE_TRACKED_RATIO
        : plannedTargetHrs * CONFIG_PS.SCORE_TRACKED_RATIO;
      const trackedNorm = wd.trackedHrs === null ? 0 : (trackedTarget    <= 0 ? 1 : Math.min(1, wd.trackedHrs / trackedTarget));
      const plannedNorm = wd.plannedHrs === null ? 0 : (plannedTargetHrs <= 0 ? 1 : Math.min(1, wd.plannedHrs / plannedTargetHrs));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node "<scratchpad>/run-test.js"`
Expected: `NODE TEST RUN: SUCCESS`

- [ ] **Step 5: Also re-run Task 2's test to confirm no regression**

Restore the last two lines of `run-test.js` to call `_test_ptoAdjustedTargetHrs_()` and re-run.
Expected: `NODE TEST RUN: SUCCESS`

- [ ] **Step 6: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "PTO-adjust plannedNorm/trackedNorm targets in Top Rocketeers scoring"
```

---

### Task 4: Goals compliance PTO exemption (server)

**Files:**
- Modify: `PS Contribution Report.js:1969` (signature), `:2098-2162` (per-week loop), `:2901-2922` and `:2959` and `:3008-3012` (`computePSReport_` wiring)
- Test: appended to `PS Contribution Report.js` as `_test_goalsPtoExemption_`

- [ ] **Step 1: Write the failing test**

Append to `PS Contribution Report.js`:

```js
// Unit test for the full-week-PTO exemption on Goals compliance Rule 3 (self-comment
// pacing). Stubs the Goals sheet read so no real spreadsheet access is needed.
function _test_goalsPtoExemption_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_goalsPtoExemption_: " + msg); }

  const week = { label: "2026.W20", monday: "2026-05-11", sunday: "2026-05-17", year: 2026, isoWeek: 20, isFuture: false };
  const ctx  = { goalsQuarter: "TESTQ", qStartIsoYear: 2026, qStartIsoWeek: 14, inGracePeriod: false };

  function goalRows(name, quarter) {
    const rows = [];
    for (let i = 1; i <= 8; i++) {
      rows.push([name, "Goal " + i, "In Progress", "", "", quarter]);
    }
    return rows;
  }
  const header = ["Rocketeer", "Goal Name", "Goal Status", "Comment Date", "Commentator", "Fiscal Quarter"];
  const data = [header]
    .concat(goalRows("Ana Smith", "TESTQ"))   // 40h PTO this week -> exempt
    .concat(goalRows("Ben Lee",   "TESTQ"))   // 0h PTO -> not exempt, fails rule 3
    .concat(goalRows("Cara Diaz", "TESTQ"));  // 39h PTO (just under 40) -> not exempt

  global.SpreadsheetApp = {
    openById: function() {
      return { getSheetByName: function() {
        return { getDataRange: function() { return { getValues: function() { return data; } }; } };
      }};
    }
  };
  global.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

  const normAna = normPS_("Ana Smith"), normBen = normPS_("Ben Lee"), normCara = normPS_("Cara Diaz");
  const psNames = new Map([
    [normAna,  { name: "Ana Smith" }],
    [normBen,  { name: "Ben Lee" }],
    [normCara, { name: "Cara Diaz" }],
  ]);

  const ptoProfiles = {
    "1001": { transactions: [{ date: new Date("2026-05-12"), isUsage: true, amount: 40 }] },
    "1002": { transactions: [] },
    "1003": { transactions: [{ date: new Date("2026-05-13"), isUsage: true, amount: 39 }] },
  };
  const empNumToNorm = new Map([["1001", normAna], ["1002", normBen], ["1003", normCara]]);

  const result = readGoalsEngagement_(psNames, [week], [], ctx, ptoProfiles, empNumToNorm);

  const ana  = result["2026.W20"].byEmployee[normAna];
  const ben  = result["2026.W20"].byEmployee[normBen];
  const cara = result["2026.W20"].byEmployee[normCara];

  assert_(ana.compliant === true,  "Ana (40h PTO) should be exempted (compliant), got " + JSON.stringify(ana));
  assert_(ana.ptoExempt === true,  "Ana should be flagged ptoExempt, got " + JSON.stringify(ana));
  assert_(ben.compliant === false, "Ben (0h PTO) should still fail rule 3, got " + JSON.stringify(ben));
  assert_(ben.ptoExempt === false, "Ben should not be flagged ptoExempt, got " + JSON.stringify(ben));
  assert_(cara.compliant === false, "Cara (39h PTO, just under 40) should still fail rule 3, got " + JSON.stringify(cara));

  Logger.log("✅ _test_goalsPtoExemption_ passed");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Update `run-test.js`'s last two lines to call `_test_goalsPtoExemption_()`, and run.
Expected: throws a `TypeError` (`readGoalsEngagement_` doesn't accept `ptoProfiles`/`empNumToNorm` yet, and the sheet-row loop panics on the 4th/5th args being `undefined`) — or an assertion failure on `ana.compliant`. Either failure mode confirms the exemption doesn't exist yet.

- [ ] **Step 3: Implement the exemption inside `readGoalsEngagement_`**

In `PS Contribution Report.js`, find:
```js
function readGoalsEngagement_(psNames, weeks, histWeeks, ctx) {
  const goalsSS = SpreadsheetApp.openById(getExternalSSIds_().goals);
  const data    = loadSheet_PS_(goalsSS, CONFIG_PS.SHEET_GOALS);
  const result  = {};
```
Replace with:
```js
function readGoalsEngagement_(psNames, weeks, histWeeks, ctx, ptoProfiles, empNumToNorm) {
  const goalsSS = SpreadsheetApp.openById(getExternalSSIds_().goals);
  const data    = loadSheet_PS_(goalsSS, CONFIG_PS.SHEET_GOALS);
  const result  = {};
  // Per-week PTO usage hours, keyed by normName — used to exempt a full-week-PTO
  // rocketeer from the self-comment pacing rule (Rule 3) for that specific week only.
  const ptoUsageByWeek = (ptoProfiles && empNumToNorm) ? buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, weeks) : {};
```

Then find, inside the per-week evaluation loop:
```js
  weeks.filter(w => !w.isFuture).forEach(week => {
    const weekEnd  = new Date(week.sunday + "T23:59:59.999Z");
    // qWeek = 1-based week number within the current quarter.
    // Use Monday-date arithmetic so the result is correct across calendar-year
    // boundaries (e.g. Q1 Jul 2026 → Jan 2027 would break if using raw ISO week numbers).
    const weekMon   = mondayOfIsoWeek_PS_(week.year, week.isoWeek);
    const qStartMon = mondayOfIsoWeek_PS_(ctx.qStartIsoYear, ctx.qStartIsoWeek);
    const qWeek    = Math.max(1, Math.floor((weekMon - qStartMon) / (7 * 86400000)) + 1);
    const reqCmt   = Math.max(1, qWeek - 4);
    // Writing ramp: no goal-count penalty for first 4 weeks of any quarter
    const goalsRequired = qWeek <= 4 ? 0 : CONFIG_PS.GOALS_MIN_COUNT;

    let compliant = 0, total = 0;
```
Replace with:
```js
  weeks.filter(w => !w.isFuture).forEach(week => {
    const weekEnd  = new Date(week.sunday + "T23:59:59.999Z");
    // qWeek = 1-based week number within the current quarter.
    // Use Monday-date arithmetic so the result is correct across calendar-year
    // boundaries (e.g. Q1 Jul 2026 → Jan 2027 would break if using raw ISO week numbers).
    const weekMon   = mondayOfIsoWeek_PS_(week.year, week.isoWeek);
    const qStartMon = mondayOfIsoWeek_PS_(ctx.qStartIsoYear, ctx.qStartIsoWeek);
    const qWeek    = Math.max(1, Math.floor((weekMon - qStartMon) / (7 * 86400000)) + 1);
    const reqCmt   = Math.max(1, qWeek - 4);
    // Writing ramp: no goal-count penalty for first 4 weeks of any quarter
    const goalsRequired = qWeek <= 4 ? 0 : CONFIG_PS.GOALS_MIN_COUNT;
    const weekPTO  = (ptoUsageByWeek[week.label] && ptoUsageByWeek[week.label].byEmployee) || {};

    let compliant = 0, total = 0;
```

Then find:
```js
      // Rule 3: at least GOALS_ACTIVE_COMMENT_COUNT goals must have >= reqCmt cumulative self-comments by week end
      const threshold  = CONFIG_PS.GOALS_ACTIVE_COMMENT_COUNT;
      const qualifying = goalIds.filter(id => {
        const goal = empGoals.get(id);
        const cnt  = goal.selfComments.filter(d => d <= weekEnd).length;
        // Completed goals exempt from ramping threshold — ≥1 self-comment suffices
        if (goal.completed && cnt >= 1) return true;
        return cnt >= reqCmt;
      }).length;

      const ok = qualifying >= threshold;
      if (ok) compliant++;
      result[week.label].byEmployee[norm] = {
        compliant: ok, rule: ok ? null : 3,
        totalGoals, inProgressCount, inProgressNeeded, qualifying, threshold, reqCmt, qWeek,
      };
```
Replace with:
```js
      // Rule 3: at least GOALS_ACTIVE_COMMENT_COUNT goals must have >= reqCmt cumulative self-comments by week end
      const threshold  = CONFIG_PS.GOALS_ACTIVE_COMMENT_COUNT;
      const fullWeekPTO = (weekPTO[norm] || 0) >= CONFIG_PS.PTO_FULL_WEEK_HRS;
      const qualifying = goalIds.filter(id => {
        const goal = empGoals.get(id);
        const cnt  = goal.selfComments.filter(d => d <= weekEnd).length;
        // Completed goals exempt from ramping threshold — ≥1 self-comment suffices
        if (goal.completed && cnt >= 1) return true;
        return cnt >= reqCmt;
      }).length;

      // A full-week-PTO rocketeer physically couldn't comment that week — exempt Rule 3
      // only (per-week snapshot; does not shift reqCmt/qWeek for other weeks). Rules 1
      // and 2 above are unaffected.
      const ok = fullWeekPTO || (qualifying >= threshold);
      if (ok) compliant++;
      result[week.label].byEmployee[norm] = {
        compliant: ok, rule: ok ? null : 3,
        totalGoals, inProgressCount, inProgressNeeded, qualifying, threshold, reqCmt, qWeek,
        ptoExempt: fullWeekPTO,
      };
```

- [ ] **Step 4: Wire `ptoProfiles`/`empNumToNorm` through `computePSReport_`**

Find:
```js
  const ptoProfiles = readPTOAccumulationProfiles_();   // shared (loaded once)
  const currentQWeeks = buildCurrentQWeeks_PS_(ctx);
```
Replace with:
```js
  const ptoProfiles = readPTOAccumulationProfiles_();   // shared (loaded once)
  // Hoisted here (rather than down near subtractPTOFromPlanned_) so both
  // readGoalsEngagement_ calls below can exempt full-week-PTO rocketeers from the
  // self-comment pacing rule using the same empNum→normName bridge.
  const empNumToNorm  = rosterIdMap_(roster, 'employeeNumber');
  const currentQWeeks = buildCurrentQWeeks_PS_(ctx);
```

Find:
```js
    goalsPrevResult  = readGoalsEngagement_(active, prevQWeeks, [], prevCtx);
```
Replace with:
```js
    goalsPrevResult  = readGoalsEngagement_(active, prevQWeeks, [], prevCtx, ptoProfiles, empNumToNorm);
```

Find:
```js
  const goalsCurrentResult = readGoalsEngagement_(active, currentQWeeks, extPastWeeks, ctx);
```
Replace with:
```js
  const goalsCurrentResult = readGoalsEngagement_(active, currentQWeeks, extPastWeeks, ctx, ptoProfiles, empNumToNorm);
```

Find:
```js
  // Subtract PTO usage hours from Tempo planned time to get net project-planned hours.
  // ptoProfiles has transactions keyed by empNum; rosterIdMap_ bridges to normName.
  const empNumToNorm  = rosterIdMap_(roster, 'employeeNumber');
  const ptoUsageByWk  = buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, extWeeks);
  const plannedAdjAll = subtractPTOFromPlanned_(plannedAll, ptoUsageByWk);
```
Replace with:
```js
  // Subtract PTO usage hours from Tempo planned time to get net project-planned hours.
  // empNumToNorm was hoisted above (shared with the Goals PTO exemption).
  const ptoUsageByWk  = buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, extWeeks);
  const plannedAdjAll = subtractPTOFromPlanned_(plannedAll, ptoUsageByWk);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node "<scratchpad>/run-test.js"` (still calling `_test_goalsPtoExemption_()`)
Expected: `NODE TEST RUN: SUCCESS`

- [ ] **Step 6: Re-run Tasks 2 and 3's tests to confirm no regression**

Swap the last two lines of `run-test.js` back to `_test_ptoAdjustedTargetHrs_()`, run; then to `_test_ptoAdjustedScoring_()`, run.
Expected: both print `NODE TEST RUN: SUCCESS`.

- [ ] **Step 7: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "Exempt full-week-PTO rocketeers from Goals self-comment pacing rule"
```

---

### Task 5: Exclude PTO-impacted employees from Team Radar compliance denominators

**Files:**
- Modify: `PS Dashboard.html:2507` (new constant), `:5458-5487` (`computeGroupMetrics`), `:5510-5528` (return object)

`PS Dashboard.html` has no existing test harness (confirmed: zero `_test_` functions in this file, unlike the `.js` backend). This task and Tasks 6–8 are verified by manual trace against the exact numbers below, then confirmed live in Task 9.

- [ ] **Step 1: Add the client-side PTO threshold constant**

Find:
```js
// ── LEADING BEHAVIOURS ────────────────────────────────────────
var SCORE_W = { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 };
```
Replace with:
```js
// ── LEADING BEHAVIOURS ────────────────────────────────────────
var SCORE_W = { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 };
var PTO_IMPACT_THRESHOLD_HRS = 8; // mirrors CONFIG_PS.PTO_IMPACT_THRESHOLD_HRS (server)
```

- [ ] **Step 2: Exclude PTO-impacted employees from Tracked/Planned compliance**

Find (inside `computeGroupMetrics`):
```js
  // Tracked compliance: count of people who logged any hours in the reference week
  var trackedCompliant = 0;
  if (refWeek) {
    group.forEach(function(e) {
      var wd = e.weeks && e.weeks[refWeek.label];
      if (wd && wd.trackedHrs != null && wd.trackedHrs > 0) trackedCompliant++;
    });
  }
  var trackedCompliancePct = n > 0 ? trackedCompliant / n * 100 : 0;
```
Replace with:
```js
  // Tracked compliance: count of people who logged any hours in the reference week.
  // Anyone with >= PTO_IMPACT_THRESHOLD_HRS PTO that week is excluded from both the
  // numerator and denominator — 0 tracked hours during a PTO day isn't a failure to
  // track, so it shouldn't drag the group's compliance % down (same idea as Goals).
  var trackedCompliant = 0, trackedEligible = 0;
  if (refWeek) {
    group.forEach(function(e) {
      var wd = e.weeks && e.weeks[refWeek.label];
      if (!wd || (wd.ptoPlannedHrs || 0) >= PTO_IMPACT_THRESHOLD_HRS) return;
      trackedEligible++;
      if (wd.trackedHrs != null && wd.trackedHrs > 0) trackedCompliant++;
    });
  }
  var trackedCompliancePct = trackedEligible > 0 ? trackedCompliant / trackedEligible * 100 : 0;
```

Find:
```js
  // Planned compliance: count of people who planned any hours in the reference week
  var plannedCompliant = 0;
  if (refWeek) {
    group.forEach(function(e) {
      var wd = e.weeks && e.weeks[refWeek.label];
      if (wd && wd.plannedHrs != null && wd.plannedHrs > 0) plannedCompliant++;
    });
  }
  var plannedCompliancePct = n > 0 ? plannedCompliant / n * 100 : 0;
```
Replace with:
```js
  // Planned compliance: count of people who planned any hours in the reference week.
  // Same PTO exclusion as Tracked above.
  var plannedCompliant = 0, plannedEligible = 0;
  if (refWeek) {
    group.forEach(function(e) {
      var wd = e.weeks && e.weeks[refWeek.label];
      if (!wd || (wd.ptoPlannedHrs || 0) >= PTO_IMPACT_THRESHOLD_HRS) return;
      plannedEligible++;
      if (wd.plannedHrs != null && wd.plannedHrs > 0) plannedCompliant++;
    });
  }
  var plannedCompliancePct = plannedEligible > 0 ? plannedCompliant / plannedEligible * 100 : 0;
```

- [ ] **Step 3: Return the new eligible counts**

Find:
```js
  return {
    headcount:      n,
    rcrAvg:         rcrAvg,
    siAvg:          siAvg,
    goalsPct:            gt > 0 ? gc / gt * 100 : 0,
    goalsCompliant:      gc,
    goalsTotal:          gt,
    avgTracked:          avgTracked,
    trackedCompliant:    trackedCompliant,
    trackedCompliancePct: trackedCompliancePct,
    avgPlanned:          avgPlanned,
    plannedCompliant:    plannedCompliant,
    plannedCompliancePct: plannedCompliancePct,
    kudosCount:          kudosTotal,
    kudosPerPerson:      kudosPerPerson,
    ptoHealthScore:      ptoHealthScore,
    ptoHealthGood:       ptoHealthGood,
    ptoHealthTotal:      ptoHealthTotal,
  };
```
Replace with:
```js
  return {
    headcount:      n,
    rcrAvg:         rcrAvg,
    siAvg:          siAvg,
    goalsPct:            gt > 0 ? gc / gt * 100 : 0,
    goalsCompliant:      gc,
    goalsTotal:          gt,
    avgTracked:          avgTracked,
    trackedCompliant:    trackedCompliant,
    trackedEligible:     trackedEligible,
    trackedCompliancePct: trackedCompliancePct,
    avgPlanned:          avgPlanned,
    plannedCompliant:    plannedCompliant,
    plannedEligible:     plannedEligible,
    plannedCompliancePct: plannedCompliancePct,
    kudosCount:          kudosTotal,
    kudosPerPerson:      kudosPerPerson,
    ptoHealthScore:      ptoHealthScore,
    ptoHealthGood:       ptoHealthGood,
    ptoHealthTotal:      ptoHealthTotal,
  };
```

- [ ] **Step 4: Manual trace verification**

Trace by hand with a 3-person group for the reference week: Person A (trackedHrs 20, ptoPlannedHrs 0), Person B (trackedHrs 0, ptoPlannedHrs 40), Person C (trackedHrs 15, ptoPlannedHrs 0).
- Before this fix: `trackedCompliant=2` (A, C), `n=3` → 67%.
- After this fix: B is excluded (ptoPlannedHrs 40 ≥ 8) → `trackedEligible=2`, `trackedCompliant=2` → 100%.
Confirm the code above produces 100%, not 67%, for this scenario before moving on.

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "Exclude PTO-impacted employees from Radar tracked/planned compliance"
```

---

### Task 6: Update Radar display labels to show eligible counts

**Files:**
- Modify: `PS Dashboard.html:5548-5550` (`rawAxisLabel`), `:5564-5565` (`buildAxisSublabel`), `:5746-5747` (`cellVal`)

Without this task, the axis tooltip/sublabel/comparison-table would show `m.trackedCompliant + '/' + m.headcount` — e.g. "2/3" — which no longer matches the percentage computed in Task 5 (which is now `2/2 = 100%`, not `2/3 = 67%`). This mirrors the existing `goalsTotal` convention (Goals already shows `goalsCompliant/goalsTotal`, not `goalsCompliant/headcount`).

- [ ] **Step 1: Fix `rawAxisLabel`**

Find:
```js
    case 'tracked': return m.trackedCompliant + '/' + m.headcount + ' logging (' + Math.round(m.trackedCompliancePct) + '% · ' + m.avgTracked.toFixed(1) + 'h avg)';
    case 'planned': return m.plannedCompliant + '/' + m.headcount + ' planned (' + Math.round(m.plannedCompliancePct) + '% · ' + m.avgPlanned.toFixed(1) + 'h avg)';
```
Replace with:
```js
    case 'tracked': return m.trackedCompliant + '/' + m.trackedEligible + ' logging (' + Math.round(m.trackedCompliancePct) + '% · ' + m.avgTracked.toFixed(1) + 'h avg)';
    case 'planned': return m.plannedCompliant + '/' + m.plannedEligible + ' planned (' + Math.round(m.plannedCompliancePct) + '% · ' + m.avgPlanned.toFixed(1) + 'h avg)';
```
(This is inside `rawAxisLabel` — leave the `goals`, `kudos`, `pto`, `rcr`, `si` cases untouched.)

- [ ] **Step 2: Fix `buildAxisSublabel`**

Find:
```js
    case 'tracked': return m.trackedCompliant + '/' + m.headcount + ' people';
    case 'planned': return m.plannedCompliant + '/' + m.headcount + ' people';
```
Replace with:
```js
    case 'tracked': return m.trackedCompliant + '/' + m.trackedEligible + ' people';
    case 'planned': return m.plannedCompliant + '/' + m.plannedEligible + ' people';
```

- [ ] **Step 3: Fix `cellVal`**

Find:
```js
      case 'tracked': return m.trackedCompliant + '/' + m.headcount + ' <span style="color:var(--muted);font-size:10px">(' + Math.round(m.trackedCompliancePct) + '% · ' + m.avgTracked.toFixed(1) + 'h avg)</span>';
      case 'planned': return m.plannedCompliant + '/' + m.headcount + ' <span style="color:var(--muted);font-size:10px">(' + Math.round(m.plannedCompliancePct) + '% · ' + m.avgPlanned.toFixed(1) + 'h avg)</span>';
```
Replace with:
```js
      case 'tracked': return m.trackedCompliant + '/' + m.trackedEligible + ' <span style="color:var(--muted);font-size:10px">(' + Math.round(m.trackedCompliancePct) + '% · ' + m.avgTracked.toFixed(1) + 'h avg)</span>';
      case 'planned': return m.plannedCompliant + '/' + m.plannedEligible + ' <span style="color:var(--muted);font-size:10px">(' + Math.round(m.plannedCompliancePct) + '% · ' + m.avgPlanned.toFixed(1) + 'h avg)</span>';
```

- [ ] **Step 4: Manual trace verification**

Using the same 3-person scenario from Task 5 Step 4 (A, B, C; B excluded), confirm the Tracked axis tooltip now reads `2/2 people` / `2/2 logging (100% · ...)`, not `2/3`.

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "Show PTO-eligible denominators in Radar tracked/planned labels"
```

---

### Task 7: PTO-aware Planned/Tracked norms in `computeRkScore`

**Files:**
- Modify: `PS Dashboard.html:2560-2562`

This is the client-side mirror of Task 3's server fix — same formula, same reasoning, kept in sync per this project's existing SI/PTO-denominator precedent (see `CLAUDE.md` → "SI/PTO denominator fix").

- [ ] **Step 1: Implement the fix**

Find (inside `computeRkScore`):
```js
  var trackedTarget = (plannedHrs !== null && plannedHrs > 0) ? plannedHrs * 0.90 : 36;
  var tracked = trackedHrs !== null ? Math.min(1, trackedHrs / trackedTarget) : 0;
  var planned = plannedHrs !== null ? Math.min(1, plannedHrs / 40) : 0;
```
Replace with:
```js
  var plannedTarget = (wd.ptoAdjustedTargetHrs != null && !isNaN(+wd.ptoAdjustedTargetHrs)) ? +wd.ptoAdjustedTargetHrs : 40;
  var trackedTarget = (plannedHrs !== null && plannedHrs > 0) ? plannedHrs * 0.90 : plannedTarget * 0.90;
  var tracked = trackedHrs === null ? 0 : (trackedTarget <= 0 ? 1 : Math.min(1, trackedHrs / trackedTarget));
  var planned = plannedHrs === null ? 0 : (plannedTarget <= 0 ? 1 : Math.min(1, plannedHrs / plannedTarget));
```

- [ ] **Step 2: Manual trace verification**

Using the same three synthetic weeks from Task 3's test (no-PTO: plannedHrs 20/target 40 → planned 0.5; partial-PTO: plannedHrs 32/target 32 → planned 1; full-PTO: plannedHrs 0/target 0 → planned 1, tracked 1), trace this code by hand and confirm it produces the identical `planned`/`tracked` values as `_test_ptoAdjustedScoring_` did for `plannedNorm`/`trackedNorm` server-side. They must match exactly — this is the whole point of keeping the two mirrors in sync.

- [ ] **Step 3: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "Mirror PTO-adjusted planned/tracked norms in computeRkScore"
```

---

### Task 8: Executive Brief PTO-impact note

**Files:**
- Modify: `PS Dashboard.html:2879` (insert after the existing PTO health block, before the `── RCR` section)

- [ ] **Step 1: Add the note**

Find (inside `generateTeamBrief`):
```js
    } else {
      concerns.push('PTO compliance at ' + ptoPct + '%' +
        (arN !== null ? ' — ' + arN + ' rocketeer' + (arN > 1 ? 's' : '') + ' need a recovery plan' : '') +
        ' (Build Process to Drive Outcomes — sustainable pace at risk)');
    }
  }

  // ── RCR ───────────────────────────────────────────────────────────────────
```
Replace with:
```js
    } else {
      concerns.push('PTO compliance at ' + ptoPct + '%' +
        (arN !== null ? ' — ' + arN + ' rocketeer' + (arN > 1 ? 's' : '') + ' need a recovery plan' : '') +
        ' (Build Process to Drive Outcomes — sustainable pace at risk)');
    }
  }

  // ── PTO impact on this week's planning/tracking (aggregate, no names) ──────
  if (!isCrewMode) {
    var ptoImpacted = allEmps.filter(function(e) {
      var wd = e.weeks && e.weeks[weekLabel];
      return wd && (wd.ptoPlannedHrs || 0) >= PTO_IMPACT_THRESHOLD_HRS;
    });
    if (ptoImpacted.length > 0) {
      var ptoImpactHrs = ptoImpacted.reduce(function(sum, e) {
        return sum + e.weeks[weekLabel].ptoPlannedHrs;
      }, 0);
      notes.push(ptoImpacted.length + ' rocketeer' + (ptoImpacted.length > 1 ? 's' : '') +
        ' had a full PTO day this week — ~' + Math.round(ptoImpactHrs) +
        'h of planning/tracking capacity excluded from this week\'s numbers.');
    }
  }

  // ── RCR ───────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Manual trace verification**

`allEmps` (from `getFilteredEmployees()`, already in scope at the top of `generateTeamBrief`) with 2 employees having `ptoPlannedHrs: 8` and `ptoPlannedHrs: 16` for `weekLabel`, and one with `ptoPlannedHrs: null` — confirm `notes` gains exactly one entry: `"2 rocketeers had a full PTO day this week — ~24h of planning/tracking capacity excluded from this week's numbers."` Confirm the note is absent when no employee meets the 8h threshold (e.g. all `null` or `< 8`).

- [ ] **Step 3: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "Add PTO-impact note to Team Executive Brief"
```

---

### Task 9: End-to-end verification on live data

**Files:** none (verification only)

- [ ] **Step 1: Re-run all three server-side Node tests together**

Update `run-test.js` to call all three in sequence:
```js
context._test_ptoAdjustedTargetHrs_();
context._test_ptoAdjustedScoring_();
context._test_goalsPtoExemption_();
console.log('ALL PTO TESTS: SUCCESS');
```
Run: `node "<scratchpad>/run-test.js"`
Expected: `ALL PTO TESTS: SUCCESS`

- [ ] **Step 2: Open the live dashboard and find a known PTO week**

In the deployed PS Dashboard, pick a rocketeer and week known to have logged ≥8h PTO (check the existing PTO pill in that employee's expanded weekly row — `ptoPlannedHrs` is already displayed there today, unchanged by this plan).

- [ ] **Step 3: Confirm Top Rocketeers scoring**

Switch to the Leading Behaviours tab for that week. Confirm the affected rocketeer's Planned/Tracked metric bars are not zeroed out or showing a red "under-target" state purely because of PTO (compare their `plannedHrs`/`trackedHrs` against what a similar non-PTO week for the same person looks like).

- [ ] **Step 4: Confirm Team Radar**

Switch to Team Radar, select that week as the reference week. Confirm the Tracked/Planned axis tooltip for a group containing the PTO-affected rocketeer shows the PTO-affected person excluded from the denominator (per Task 5/6's manual trace), not counted as a "0 hours" failure.

- [ ] **Step 5: Confirm Goals compliance**

If that rocketeer had ≥40h PTO in a week, open their expanded row and confirm that week's Goals status is not marked non-compliant solely for missing self-comments (rule 3) — rules 1/2 should still apply normally.

- [ ] **Step 6: Confirm the Executive Brief note**

Switch to 📋 Team Executive Brief (admin only), select the same week. Confirm a note appears in the "Notes" section along the lines of "N rocketeers had a full PTO day this week — ~Xh of planning/tracking capacity excluded from this week's numbers," with the count/hours matching what you'd expect from the roster's PTO pills for that week.

- [ ] **Step 7: Confirm no regression on a normal (non-PTO) week**

Repeat steps 3–6 for a week with no PTO for any rocketeer in view. Confirm all four surfaces render identically to how they did before this plan (no unexpected 100%s, no phantom notes, no score changes).
