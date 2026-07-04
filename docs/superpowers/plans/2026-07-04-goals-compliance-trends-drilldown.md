# Goals Compliance — Drill Redesign, Trends Tab & QoQ Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the per-goal comment drill-down as a pattern-spotting conversation timeline, move the weekly trend to a new filter-aware Trends tab, and add quarter-over-quarter engagement panels with a manager exception list.

**Architecture:** The backend (`goalCompliance.js`) attaches sparse per-employee weekly comment series (`weeklySelf`/`weeklyMgr`) plus a lite previous-quarter employee block to the cached payload; every chart then recomputes client-side in `GDash.html` from the filtered employee set — no server round-trips on filter changes. Spec: `docs/superpowers/specs/2026-07-04-goals-compliance-trends-drilldown-design.md`.

**Tech Stack:** Google Apps Script (V8, ES5-style code), `GDash.html` served via HtmlService, Chart.js 4 + chartjs-plugin-datalabels (CDN). Backend tests are `_test_*` functions runnable in the GAS editor **and** in Node with a stubbed `Logger`.

**Test command (backend, from `D:\Contribution`):**

```bash
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_prevQuarterLabel_();"
```

(Swap the trailing call per task. `goalCompliance.js` has no top-level GAS calls, so `eval` loads clean.)

**Frontend verification:** `GDash.html` has no automated harness. Each frontend task ends with a concrete browser checklist. Full end-to-end QA happens once in Task 9 after deploying via the Apps Script editor.

---

### Task 1: Backend — `prevQuarterLabel_` + CONFIG additions

**Files:**
- Modify: `goalCompliance.js` (CONFIG_GD block ~line 14; helpers after `dateToFiscalQuarter_` ~line 102; tests at end of file)

- [ ] **Step 1: Write the failing test** (append at end of file, after `_test_aggregateAllRocketeers_`)

```js
function _test_prevQuarterLabel_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_prevQuarterLabel_: " + msg); }

  assert_(prevQuarterLabel_('FY26Q4') === 'FY26Q3', "FY26Q4 → FY26Q3, got " + prevQuarterLabel_('FY26Q4'));
  assert_(prevQuarterLabel_('FY26Q2') === 'FY26Q1', "FY26Q2 → FY26Q1");
  assert_(prevQuarterLabel_('FY26Q1') === 'FY25Q4', "FY boundary: FY26Q1 → FY25Q4, got " + prevQuarterLabel_('FY26Q1'));
  assert_(prevQuarterLabel_('garbage') === null,     "unparseable → null");
  assert_(prevQuarterLabel_('') === null,            "blank → null");

  Logger.log("✅ _test_prevQuarterLabel_ passed");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_prevQuarterLabel_();"`
Expected: FAIL with `prevQuarterLabel_ is not defined`

- [ ] **Step 3: Implement.** Add two CONFIG keys and the helper.

In `CONFIG_GD`, change `CACHE_VER` and add the exception list directly below `DEFAULT_QUARTER`:

```js
  DEFAULT_QUARTER:     'FY26Q4',
  // Managers fully excluded from manager-engagement metrics (QoQ manager panel,
  // engagement aggregates). Shown in the Manager Scorecard with an "Excepted"
  // tag, never hidden. Full names as they appear in RD's Supervisor column —
  // matched via normName_. Deliberately a code constant (git-versioned), not a
  // Script Property: see 2026-07-04 design spec.
  MANAGER_ENGAGEMENT_EXCEPTIONS: [],
```

```js
  CACHE_VER:           'gd_v14_',  // bumped: payload adds per-employee weeklySelf/weeklyMgr series, trendWeeks, prevQuarter block, managerExceptions
```

(Keep the old v13 comment text out — replace the whole `CACHE_VER` line and its comment.)

Add after `dateToFiscalQuarter_` (~line 102):

```js
/**
 * Quarter label immediately before the given one — "FY26Q3" → "FY26Q2",
 * "FY26Q1" → "FY25Q4". Computed by decrementing the parsed label, NOT by
 * scanning the quarters-with-data list: a data-gap quarter must not silently
 * make the QoQ shadow jump two quarters back.
 */
function prevQuarterLabel_(quarter) {
  var m = String(quarter || '').match(/FY(\d{2,4})Q([1-4])/i);
  if (!m) return null;
  var fy = parseInt(m[1], 10);
  if (fy < 100) fy += 2000;
  var q = parseInt(m[2], 10);
  if (q === 1) { fy -= 1; q = 4; } else { q -= 1; }
  return 'FY' + String(fy).slice(-2) + 'Q' + q;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command again. Expected: `✅ _test_prevQuarterLabel_ passed`

- [ ] **Step 5: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): add prevQuarterLabel_ helper, manager exception config, cache v14"
```

---

### Task 2: Backend — `quarterWeekList_` (full ISO-week axis)

**Files:**
- Modify: `goalCompliance.js` (helper after `dateToISOWeek_` ~line 119; test at end of file)

- [ ] **Step 1: Write the failing test**

```js
function _test_quarterWeekList_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_quarterWeekList_: " + msg); }

  // FY26Q3 = Jan–Mar 2026, fully in the past — no today-clamping variance.
  var w = quarterWeekList_('FY26Q3', false);
  assert_(w.length >= 12 && w.length <= 14, "a quarter spans ~13 ISO weeks, got " + w.length);
  assert_(w[0] === '2026.W01', "Q3 2026 starts in 2026.W01, got " + w[0]);
  assert_(w.indexOf('2026.W09') !== -1, "mid-quarter week must be present even with no comment data");

  var seen = {};
  w.forEach(function(x) { assert_(!seen[x], "duplicate week " + x); seen[x] = true; });
  for (var i = 1; i < w.length; i++) {
    assert_(w[i] > w[i - 1], "weeks must ascend: " + w[i - 1] + " → " + w[i]);
  }

  assert_(quarterWeekList_('garbage', false).length === 0, "unparseable quarter → empty list");

  // Clamped mode never returns MORE weeks than unclamped.
  var clamped = quarterWeekList_('FY26Q3', true);
  assert_(clamped.length <= w.length, "clamping must not add weeks");

  Logger.log("✅ _test_quarterWeekList_ passed");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_quarterWeekList_();"`
Expected: FAIL with `quarterWeekList_ is not defined`

- [ ] **Step 3: Implement.** Add after `dateToISOWeek_`:

```js
/**
 * Full ISO-week label list for a quarter, start → end, optionally clamped to
 * today (for the in-progress quarter, so charts stop at the current week).
 * Unlike deriving the axis from comment data, this includes fully silent
 * weeks — a zero on the chart is the signal HR needs, not a gap to hide.
 */
function quarterWeekList_(quarter, clampToToday) {
  var qd = parseQuarterDates_(quarter);
  if (!qd) return [];
  var parse_ = function(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };

  var endStr = qd.end;
  if (clampToToday) {
    var todayStr = new Date().toISOString().slice(0, 10);
    if (todayStr < endStr) endStr = todayStr;
  }

  var weeks = [], seen = {};
  var cursor = parse_(qd.start);
  var endD   = parse_(endStr);
  while (cursor <= endD) {  // 7-day steps visit consecutive ISO weeks, never skipping one
    var wk = dateToISOWeek_(cursor);
    if (wk && !seen[wk]) { seen[wk] = true; weeks.push(wk); }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }
  var lastWk = dateToISOWeek_(endD);  // a final partial week can sit past the last 7-day step
  if (lastWk && !seen[lastWk]) weeks.push(lastWk);
  return weeks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command. Expected: `✅ _test_quarterWeekList_ passed`

- [ ] **Step 5: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): quarterWeekList_ — full ISO-week axis incl. silent weeks"
```

---

### Task 3: Backend — per-employee weekly series in `aggregateByRocketeer_`

**Files:**
- Modify: `goalCompliance.js:796-917` (`aggregateByRocketeer_`), `goalCompliance.js:634-651` (zero-goal injection in `buildComplianceData_`); test at end of file

- [ ] **Step 1: Write the failing test**

```js
function _test_weeklySeries_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_weeklySeries_: " + msg); }

  // 2026-04-06 is the Monday of 2026.W15; 2026-04-20 is the Monday of 2026.W17.
  var base = { 'Rocketeer':'Alice Smith', 'Supervisor':'Jane Doe', 'Department':'Ops',
               'Job Title':'Analyst', 'Goal ID':'G1', 'Goal Name':'Playbook',
               'Goal Status':'In Progress', 'Start Date': new Date(2026, 3, 6) };
  function row(commentator, date, text) {
    var r = {}; Object.keys(base).forEach(function(k) { r[k] = base[k]; });
    r['Commentator'] = commentator; r['Comment Date'] = date; r['Comment Text'] = text;
    return r;
  }
  var rows = [
    row('Alice Smith', new Date(2026, 3, 6),  'kickoff'),    // W15 self
    row('Alice Smith', new Date(2026, 3, 8),  'progress'),   // W15 self
    row('Jane Doe',    new Date(2026, 3, 9),  'nice'),       // W15 manager
    row('Alice Smith', new Date(2026, 3, 20), 'later'),      // W17 self
    row('Sam Peer',    new Date(2026, 3, 7),  'peer note'),  // W15 other — must NOT hit weekly maps
  ];

  var map = aggregateByRocketeer_(rows, null, 'FY26Q4');
  var a = map['alice smith'];
  assert_(!!a, "alice must aggregate");
  assert_(a.weeklySelf['2026.W15'] === 2, "two self comments in W15, got " + JSON.stringify(a.weeklySelf));
  assert_(a.weeklySelf['2026.W17'] === 1, "one self comment in W17");
  assert_(Object.keys(a.weeklySelf).length === 2, "weeklySelf must be sparse (2 weeks)");
  assert_(a.weeklyMgr['2026.W15'] === 1, "one manager comment in W15, got " + JSON.stringify(a.weeklyMgr));
  assert_(Object.keys(a.weeklyMgr).length === 1, "peer comments must not appear in weeklyMgr");
  assert_(a.totalSelfComments === 3 && a.totalManagerComments === 1, "existing totals must be unchanged");
  assert_(a._weeklySelf === undefined && a._weeklySelfWeeks === undefined, "no leftover private accumulators");

  Logger.log("✅ _test_weeklySeries_ passed");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_weeklySeries_();"`
Expected: FAIL — `a.weeklySelf` is `undefined`

- [ ] **Step 3: Implement.** Three edits inside `aggregateByRocketeer_`:

**(a)** In the `if (!map[norm])` initializer, extend the private accumulators line:

```js
        _goals:     {},
        _selfCmtWeeks: {},  // ISO weeks in which rocketeer self-commented
        _weeklySelf: {},    // ISO week → self-comment count (sparse; QoQ/trend raw material)
        _weeklyMgr:  {},    // ISO week → manager-comment count (sparse)
```

**(b)** Replace the comment-processing block (currently computes `wk` only inside the self branch) with:

```js
    if (cText && cBy) {
      var g      = map[norm]._goals[goalId];
      var sup    = normName_(map[norm].supervisor);
      var cNorm  = normName_(cBy);
      var wk     = cDate ? dateToISOWeek_(cDate) : null;

      g.totalComments++;

      if (cNorm === norm) {
        g.selfComments++;
        if (wk) {
          map[norm]._selfCmtWeeks[wk] = true;  // RPI: weeks with any self-comment
          map[norm]._weeklySelf[wk]   = (map[norm]._weeklySelf[wk] || 0) + 1;
        }
      } else if (sup && cNorm === sup) {
        g.managerComments++;
        if (wk) map[norm]._weeklyMgr[wk] = (map[norm]._weeklyMgr[wk] || 0) + 1;
      }

      if (cDate) {
        var ds = fmtDate_(cDate);
        if (!g.lastCommentDate || ds > g.lastCommentDate) g.lastCommentDate = ds;
      }
    }
```

**(c)** In the finalize loop (`Object.keys(map).forEach`), just before `delete emp._goals;`:

```js
    // Sparse weekly series — the raw material every filter-aware chart
    // (Trends combo, QoQ panels) recomputes from client-side.
    emp.weeklySelf = emp._weeklySelf;
    emp.weeklyMgr  = emp._weeklyMgr;

    delete emp._goals;
    delete emp._selfCmtWeeks;
    delete emp._weeklySelf;
    delete emp._weeklyMgr;
```

**(d)** In `buildComplianceData_`'s zero-goal injection block (step 3b, the object with `// All goal and comment metrics zeroed`), add to the zeroed fields:

```js
      commentWeeks: 0, commentWeekList: [],
      weeklySelf: {}, weeklyMgr: {},
```

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command. Expected: `✅ _test_weeklySeries_ passed`
Also re-run the existing suite to catch regressions:

```bash
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_resolveGDManagerScope_(); _test_isIntern_(); _test_stripInterns_(); _test_aggregateAllRocketeers_(); _test_prevQuarterLabel_(); _test_quarterWeekList_();"
```

Expected: six ✅ lines.

- [ ] **Step 5: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): per-employee sparse weeklySelf/weeklyMgr comment series"
```

---

### Task 4: Backend — payload wiring (`trendWeeks`, `prevQuarter`, `managerExceptions`) + scorecard `isExcepted`

**Files:**
- Modify: `goalCompliance.js:530-749` (`buildComplianceData_`), `goalCompliance.js:1215-1325` (`computeEngagementData_`); test at end of file

- [ ] **Step 1: Write the failing test** (exercises `computeEngagementData_`'s new 4th param)

```js
function _test_managerExceptions_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_managerExceptions_: " + msg); }

  var employees = [
    { normName:'a1', name:'A One', department:'Ops', supervisor:'Jane Doe', jobTitle:'Analyst',
      totalGoals:5, totalSelfComments:3, totalManagerComments:2, complianceStatus:'At Risk' },
    { normName:'b1', name:'B One', department:'Ops', supervisor:'Sam Lead', jobTitle:'Analyst',
      totalGoals:4, totalSelfComments:1, totalManagerComments:0, complianceStatus:'At Risk' },
  ];

  var eng  = computeEngagementData_(employees, 4, {}, ['jane doe']);
  var jane = eng.managerScorecard.filter(function(m) { return m.normName === 'jane doe'; })[0];
  var sam  = eng.managerScorecard.filter(function(m) { return m.normName === 'sam lead'; })[0];

  assert_(jane && jane.isExcepted === true,  "Jane must carry isExcepted:true");
  assert_(sam  && sam.isExcepted  === false, "Sam must carry isExcepted:false");
  assert_(eng.managerScorecard[eng.managerScorecard.length - 1].normName === 'jane doe',
    "excepted managers must sort to the bottom");

  // Omitting the param must behave like no exceptions (back-compat).
  var eng2 = computeEngagementData_(employees, 4, {});
  assert_(eng2.managerScorecard.every(function(m) { return m.isExcepted === false; }),
    "no exceptions passed → nobody excepted");

  Logger.log("✅ _test_managerExceptions_ passed");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_managerExceptions_();"`
Expected: FAIL — `isExcepted` is `undefined`

- [ ] **Step 3: Implement `computeEngagementData_` changes.**

Change the signature and add the set:

```js
function computeEngagementData_(employees, weeksElapsed, supervisorTitleMap, exceptionNorms) {
  var paceThreshold = Math.floor(weeksElapsed / 2);

  var exceptSet = {};
  (exceptionNorms || []).forEach(function(n) { exceptSet[n] = true; });
```

In the `mgrMap[normSup] = {` initializer add:

```js
            isSeniorLeader: isSeniorLeader_(supTitle),
            isExcepted:     !!exceptSet[normSup],
```

In the `managerScorecard` mapping add the field and change the sort (excepted last, then avg desc):

```js
  var managerScorecard = Object.keys(mgrMap).map(function(k) {
    var m = mgrMap[k];
    return {
      name:           m.name,
      normName:       m.normName,
      isSeniorLeader: m.isSeniorLeader,
      isExcepted:     m.isExcepted,
      avgCmts:        m.teamSize > 0 ? +(m.totalMgrCmts / m.teamSize).toFixed(1) : 0,
      covered:        m.covered,
      teamSize:       m.teamSize,
    };
  }).sort(function(a, b) {
    if (a.isExcepted !== b.isExcepted) return a.isExcepted ? 1 : -1;
    return b.avgCmts - a.avgCmts;
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command. Expected: `✅ _test_managerExceptions_ passed`

- [ ] **Step 5: Implement `buildComplianceData_` payload wiring.**

**(a)** After step 7 (`var commentTrend = …`), insert:

```js
  // 7b. Full quarter week axis (start → today) — silent weeks render as zeros
  // on the Trends charts instead of disappearing. commentTrend/totalQtrWeeks
  // keep their data-derived semantics (RPI depends on totalQtrWeeks).
  var trendWeeks = quarterWeekList_(quarter, true);

  // 7c. Manager engagement exceptions — normalized once, shipped to the client
  // so the Scorecard tag and the QoQ manager panel apply the same set.
  var managerExceptions = (CONFIG_GD.MANAGER_ENGAGEMENT_EXCEPTIONS || []).map(normName_);

  // 7d. Previous-quarter lite block for the QoQ shadow — derived from the SAME
  // allRd array already in memory (no extra sheet read). Terminated employees
  // are kept (they were active then; dropping them would understate the
  // shadow); interns are stripped exactly like the main list. Null when the
  // preceding quarter has no RD rows at all.
  var prevQuarter = null;
  var prevLabel   = prevQuarterLabel_(quarter);
  if (prevLabel) {
    var prevRows = allRd.filter(function(r) { return deriveRowQuarter_(r) === prevLabel; });
    if (prevRows.length) {
      var prevMap = aggregateByRocketeer_(prevRows, scopeSet, prevLabel);
      stripInterns_(prevMap, rosterMap);
      prevQuarter = {
        quarter: prevLabel,
        weeks:   quarterWeekList_(prevLabel, false),
        employees: Object.values(prevMap).map(function(emp) {
          return {
            normName:   emp.normName,
            name:       emp.name,
            department: emp.department,
            supervisor: emp.supervisor,
            location:   locMap[emp.normName] || 'Unknown',
            jobFamily:  deriveJobFamily_(emp.jobTitle),
            totalGoals: emp.totalGoals,
            weeklySelf: emp.weeklySelf,
            weeklyMgr:  emp.weeklyMgr,
          };
        }),
      };
    }
  }
```

**(b)** Update the `computeEngagementData_` call (step 10):

```js
  var engagementData = computeEngagementData_(employees, weeksElapsedSinceStart, supTitleMap, managerExceptions);
```

**(c)** Add to the return object, after `commentTrend:`:

```js
    commentTrend:           commentTrend,
    trendWeeks:             trendWeeks,
    prevQuarter:            prevQuarter,
    managerExceptions:      managerExceptions,
```

- [ ] **Step 6: Run the full backend suite**

```bash
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_resolveGDManagerScope_(); _test_isIntern_(); _test_stripInterns_(); _test_aggregateAllRocketeers_(); _test_prevQuarterLabel_(); _test_quarterWeekList_(); _test_weeklySeries_(); _test_managerExceptions_();"
```

Expected: eight ✅ lines.

- [ ] **Step 7: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): payload ships trendWeeks, prevQuarter block, manager exceptions"
```

---

### Task 5: Frontend — Trends tab scaffolding + filter-aware weekly combo chart

**Files:**
- Modify: `GDash.html` — tab nav (~line 329), Overview pane (~lines 367-380 removed), new pane after Overview (~line 422), `S` state (~line 546), `VIEWS` (~line 569), `renderTab` (~line 809), `renderOverview` (~lines 852-856 removed), chart builders (`buildCommentTrendChart` ~line 1553 replaced, `buildTrendDeptChips_` ~line 1078 removed), `.trend-dept-chip` CSS rule (search in `<style>`)

- [ ] **Step 1: Add the tab button.** In the tab nav, insert between Overview and Team:

```html
    <button class="tab-btn"        onclick="switchTab('trends')"    data-tab="trends">Trends</button>
```

- [ ] **Step 2: Remove the trend section from the Overview pane.** Delete the whole `<!-- Comments Volume Trend (moved from the old standalone Engagement tab) -->` `section-card` (the block containing `id="overview-trend-panel"`, `id="trend-dept-selector"`, and `<canvas id="chart-trend">`).

- [ ] **Step 3: Add the Trends pane** immediately after `</div>` closing `pane-overview` and before the `<!-- ── TEAM & INDIVIDUALS ──` comment:

```html
    <!-- ── TRENDS ──
         Weekly combo trend (moved from Overview, now recomputed from the globally
         filtered employee set) + QoQ engagement twin panels. All series are
         client-computed from per-employee weeklySelf/weeklyMgr maps — see the
         2026-07-04 design spec. -->
    <div id="pane-trends" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>Comments &amp; Participation Week Over Week</h2>
            <p class="section-sub" id="trend-denominator-sub">Self vs manager comment volume + rocketeers engaging · respects the filter bar</p></div>
          <div class="section-actions">
            <div style="display:inline-flex;gap:6px">
              <button class="btn btn-primary" id="btn-trendline-count" aria-pressed="true" onclick="setTrendLineMode_('count')">Count</button>
              <button class="btn" id="btn-trendline-pct" aria-pressed="false" onclick="setTrendLineMode_('pct')">%</button>
            </div>
            <button class="btn" onclick="exportPNG('trends-combo-panel','comments-trend.png')">⬇ PNG</button>
          </div>
        </div>
        <div class="section-body" id="trends-combo-panel">
          <div style="height:320px;position:relative"><canvas id="chart-trend"></canvas></div>
        </div>
      </div>

      <div class="col-row">
        <div class="section-card">
          <div class="section-head">
            <div><h2>🧑 Rocketeer Engagement — QoQ</h2>
              <p class="section-sub">% of filtered rocketeers (with goals) self-commenting each week · previous quarter as shadow</p></div>
            <button class="btn" onclick="exportPNG('qoq-rock-panel','qoq-rocketeers.png')">⬇ PNG</button>
          </div>
          <div class="section-body" id="qoq-rock-panel">
            <div style="height:220px;position:relative"><canvas id="chart-qoq-rock"></canvas></div>
            <div style="height:70px;position:relative;margin-top:4px"><canvas id="chart-qoq-rock-delta"></canvas></div>
            <p class="section-sub" id="qoq-rock-note" style="margin-top:6px"></p>
          </div>
        </div>
        <div class="section-card">
          <div class="section-head">
            <div><h2>👤 Manager Engagement — QoQ</h2>
              <p class="section-sub">% of managers commenting on ≥1 team goal each week · excepted managers excluded</p></div>
            <button class="btn" onclick="exportPNG('qoq-mgr-panel','qoq-managers.png')">⬇ PNG</button>
          </div>
          <div class="section-body" id="qoq-mgr-panel">
            <div style="height:220px;position:relative"><canvas id="chart-qoq-mgr"></canvas></div>
            <div style="height:70px;position:relative;margin-top:4px"><canvas id="chart-qoq-mgr-delta"></canvas></div>
            <p class="section-sub" id="qoq-mgr-note" style="margin-top:6px"></p>
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: State + VIEWS + dispatch.**

In `S`, replace `trendDepts: [],  // department lines shown on trend chart` with:

```js
  trendLineMode:  'count',  // 'count' | 'pct' — Trends combo chart line mode
```

In `VIEWS`, insert after the overview entry:

```js
  { id: 'trends',    label: 'Trends',                location: 'tabbar', roles: null },
```

In `renderTab`, add after the overview branch:

```js
  else if (tabId === 'trends')    renderTrends(emps);
```

- [ ] **Step 5: Remove the old chart code.**
  - In `renderOverview`, delete the `// Comments Volume Trend (moved from the old Engagement tab)` block (the `if (S.data && S.data.commentTrend) { … }` calling `buildTrendDeptChips_`/`buildCommentTrendChart`).
  - Delete `buildTrendDeptChips_` entirely.
  - Delete `buildCommentTrendChart` entirely (replaced below).
  - In the `<style>` section, delete the `.trend-dept-chip` rule block (search `trend-dept-chip`).

- [ ] **Step 6: Add the new renderer + helpers.** Where `buildCommentTrendChart` used to be (chart-builders section):

```js
// ── TRENDS TAB ─────────────────────────────────────────────────────
function renderTrends(emps) {
  buildWeeklyComboChart_(emps);
  renderQoQPanels_(emps);
}

// Sums a sparse weekly map field across employees into an array aligned to `weeks`.
function sumWeekly_(emps, field, weeks) {
  return weeks.map(function(w) {
    return emps.reduce(function(s, e) { return s + ((e[field] && e[field][w]) || 0); }, 0);
  });
}

// Employees with any self-comment in each week.
function countEngaging_(emps, weeks) {
  return weeks.map(function(w) {
    return emps.filter(function(e) { return e.weeklySelf && e.weeklySelf[w] > 0; }).length;
  });
}

function setTrendLineMode_(mode) {
  S.trendLineMode = mode;
  var cBtn = document.getElementById('btn-trendline-count');
  var pBtn = document.getElementById('btn-trendline-pct');
  if (cBtn) { cBtn.classList.toggle('btn-primary', mode === 'count'); cBtn.setAttribute('aria-pressed', String(mode === 'count')); }
  if (pBtn) { pBtn.classList.toggle('btn-primary', mode === 'pct');   pBtn.setAttribute('aria-pressed', String(mode === 'pct')); }
  buildWeeklyComboChart_(getFiltered());
}

// Filter-aware combo: stacked self/mgr comment bars + rocketeers-engaging line
// (count or % of filtered rocketeers with goals) with a datalabel on every point.
function buildWeeklyComboChart_(emps) {
  destroyChart('chart-trend');
  var canvas = document.getElementById('chart-trend');
  var weeks  = (S.data && S.data.trendWeeks) || [];
  if (!canvas || !weeks.length) return;

  var eligibleN = emps.filter(function(e) { return e.totalGoals > 0; }).length;
  var sub = document.getElementById('trend-denominator-sub');
  if (sub) sub.textContent = 'Self vs manager comment volume + rocketeers engaging · of ' +
    eligibleN + ' filtered rocketeer' + (eligibleN === 1 ? '' : 's') + ' with goals';

  var selfSeries = sumWeekly_(emps, 'weeklySelf', weeks);
  var mgrSeries  = sumWeekly_(emps, 'weeklyMgr',  weeks);
  var engaging   = countEngaging_(emps, weeks);
  var pctMode    = S.trendLineMode === 'pct';
  var lineData   = pctMode
    ? engaging.map(function(n) { return eligibleN ? +(n / eligibleN * 100).toFixed(1) : 0; })
    : engaging;

  var shortWeeks = weeks.map(function(w) { return w.split('.')[1] || w; });

  S.charts['chart-trend'] = new Chart(canvas, {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: shortWeeks,
      datasets: [
        { type: 'line', label: pctMode ? '% Engaging' : 'Rocketeers Engaging',
          data: lineData, borderColor: '#00A86B', backgroundColor: 'transparent',
          borderWidth: 2, borderDash: [5, 3], tension: .3, pointRadius: 3, yAxisID: 'y1', order: 0,
          datalabels: { display: true, align: 'top', anchor: 'end', color: '#00A86B',
            font: { size: 10, weight: '800' },
            formatter: function(v) { return pctMode ? v + '%' : v; } } },
        { label: 'Self Comments', data: selfSeries, backgroundColor: '#2864E6',
          stack: 'cmts', yAxisID: 'y', order: 1, datalabels: { display: false } },
        { label: 'Manager Comments', data: mgrSeries, backgroundColor: '#F59E0B',
          stack: 'cmts', yAxisID: 'y', order: 1, datalabels: { display: false } },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x:  { stacked: true, ticks: { font: { size: 11 } } },
        y:  { stacked: true, position: 'left',
              title: { display: true, text: 'Comments', font: { size: 11 } },
              grid: { color: '#E2E8F0' }, ticks: { font: { size: 11 } } },
        y1: { position: 'right',
              title: { display: true, text: pctMode ? '% Engaging' : 'Rocketeers', font: { size: 11 } },
              grid: { drawOnChartArea: false }, ticks: { font: { size: 11 } },
              min: 0, max: pctMode ? 100 : undefined }
      },
      plugins: {
        legend:  { position: 'top', labels: { font: { size: 11 }, padding: 12 } },
        tooltip: { callbacks: { title: function(ctx) { return 'Week ' + weeks[ctx[0].dataIndex]; } } }
      }
    }
  });
}

// Placeholder until Task 6 — keeps the Trends tab renderable after this task alone.
function renderQoQPanels_(emps) {
  var note = document.getElementById('qoq-rock-note');
  if (note) note.textContent = 'QoQ panels land in the next change.';
}
```

- [ ] **Step 7: Verify in browser.** Deploy (Apps Script editor → paste both files → refresh web app) and check:
  - A **Trends** tab appears between Overview and Team & Individuals; Overview no longer shows the trend chart or department chips.
  - Trends shows stacked blue/amber bars for **every** week since quarter start (silent weeks = empty slots, still labeled) with green count labels above.
  - Applying a Department filter chip changes the bars/labels immediately; the subtitle shows the filtered denominator.
  - Clicking **%** re-draws the line as percentages on a 0–100 axis; **Count** switches back.

- [ ] **Step 8: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Trends tab with filter-aware weekly combo chart (count/% toggle)"
```

---

### Task 6: Frontend — QoQ twin panels with shadow, threshold band & delta strips

**Files:**
- Modify: `GDash.html` — replace the Task 5 `renderQoQPanels_` placeholder; add helpers next to it

- [ ] **Step 1: Add the pure series helpers** (above `renderQoQPanels_`):

```js
// Rocketeer engagement % per week: engaged = weeklySelf[w] > 0; denominator =
// employees with goals in the (already filtered) set.
function rocketeerPctSeries_(emps, weeks) {
  var eligible = emps.filter(function(e) { return e.totalGoals > 0; });
  return weeks.map(function(w) {
    if (!eligible.length) return 0;
    var n = eligible.filter(function(e) { return e.weeklySelf && e.weeklySelf[w] > 0; }).length;
    return +(n / eligible.length * 100).toFixed(1);
  });
}

// Manager engagement % per week. Managers = distinct supervisors of employees
// with goals, minus the exception list. Engaged in week w if ANY report
// received a manager comment that week (weeklyMgr already counts only true
// supervisor comments — see aggregateByRocketeer_ server-side).
function managerPctSeries_(emps, weeks, exceptionNorms) {
  var exceptSet = {};
  (exceptionNorms || []).forEach(function(n) { exceptSet[n] = true; });
  var byMgr = {};
  emps.forEach(function(e) {
    if (!(e.totalGoals > 0)) return;
    var normSup = (e.supervisor || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normSup || exceptSet[normSup]) return;
    (byMgr[normSup] = byMgr[normSup] || []).push(e);
  });
  var mgrs = Object.keys(byMgr);
  return weeks.map(function(w) {
    if (!mgrs.length) return 0;
    var engaged = mgrs.filter(function(m) {
      return byMgr[m].some(function(e) { return e.weeklyMgr && e.weeklyMgr[w] > 0; });
    }).length;
    return +(engaged / mgrs.length * 100).toFixed(1);
  });
}

function median_(arr) {
  if (!arr || !arr.length) return 0;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(1);
}

// Re-applies the active filter chips to previous-quarter lite records. The
// status chip is deliberately skipped — compliance status is quarter-specific.
function filterPrevEmployees_(prevEmps) {
  return (prevEmps || []).filter(function(e) {
    if (S.filters.location.length   && S.filters.location.indexOf(e.location)     === -1) return false;
    if (S.filters.department.length && S.filters.department.indexOf(e.department) === -1) return false;
    if (S.filters.jobFamily.length  && S.filters.jobFamily.indexOf(e.jobFamily)   === -1) return false;
    if (S.filters.supervisor.length && S.filters.supervisor.indexOf(e.supervisor) === -1) return false;
    return true;
  });
}
```

- [ ] **Step 2: Replace the placeholder `renderQoQPanels_` and add `buildQoQPanel_`:**

```js
function renderQoQPanels_(emps) {
  var weeks      = (S.data && S.data.trendWeeks) || [];
  var prev       = (S.data && S.data.prevQuarter) || null;
  var exceptions = (S.data && S.data.managerExceptions) || [];
  var prevEmps   = prev ? filterPrevEmployees_(prev.employees) : [];

  buildQoQPanel_('chart-qoq-rock', 'chart-qoq-rock-delta', 'qoq-rock-note',
    rocketeerPctSeries_(emps, weeks),
    prev ? rocketeerPctSeries_(prevEmps, prev.weeks) : null,
    weeks, prev, '#2864E6');

  buildQoQPanel_('chart-qoq-mgr', 'chart-qoq-mgr-delta', 'qoq-mgr-note',
    managerPctSeries_(emps, weeks, exceptions),
    prev ? managerPctSeries_(prevEmps, prev.weeks, exceptions) : null,
    weeks, prev, '#F59E0B');
}

/**
 * One QoQ panel: current-quarter bold line over the previous quarter's gray
 * shadow area, aligned by week-of-quarter index, with a red band up to the
 * shadow's median (the behavioral threshold) and a green/red delta bar strip
 * underneath. shadowSeries === null → current line only + explanatory note.
 */
function buildQoQPanel_(canvasId, deltaId, noteId, curSeries, shadowSeries, curWeeks, prev, color) {
  destroyChart(canvasId);
  destroyChart(deltaId);
  var canvas = document.getElementById(canvasId);
  var note   = document.getElementById(noteId);
  if (!canvas) return;
  if (!curWeeks.length) { if (note) note.textContent = 'No week data for this quarter yet.'; return; }

  var n = Math.max(curWeeks.length, shadowSeries ? shadowSeries.length : 0);
  var labels = [];
  for (var i = 0; i < n; i++) labels.push('Wk ' + (i + 1));
  var pad_ = function(arr) { var a = (arr || []).slice(); while (a.length < n) a.push(null); return a; };

  var threshold = shadowSeries ? median_(shadowSeries) : null;

  // Chart.js has no built-in horizontal band; a tiny inline plugin shades
  // 0 → threshold before datasets draw.
  var bandPlugin = {
    id: 'qoqBand_' + canvasId,
    beforeDatasetsDraw: function(chart) {
      if (threshold == null) return;
      var yS = chart.scales.y, area = chart.chartArea, ctx = chart.ctx;
      var yPix = yS.getPixelForValue(threshold);
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,.08)';
      ctx.fillRect(area.left, yPix, area.right - area.left, area.bottom - yPix);
      ctx.strokeStyle = 'rgba(239,68,68,.45)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(area.left, yPix); ctx.lineTo(area.right, yPix); ctx.stroke();
      ctx.restore();
    }
  };

  var datasets = [];
  if (shadowSeries) {
    datasets.push({ label: prev.quarter + ' (shadow)', data: pad_(shadowSeries),
      borderColor: '#CBD5E1', backgroundColor: 'rgba(203,213,225,.35)',
      borderWidth: 1.5, tension: .3, fill: true, pointRadius: 0,
      datalabels: { display: false } });
  }
  datasets.push({ label: S.data.quarter + ' (current)', data: pad_(curSeries),
    borderColor: color, backgroundColor: 'transparent',
    borderWidth: 2.5, tension: .3, pointRadius: 3,
    datalabels: { display: true, align: 'top', anchor: 'end', color: color,
      font: { size: 9, weight: '800' },
      formatter: function(v) { return v == null ? '' : v + '%'; } } });

  S.charts[canvasId] = new Chart(canvas, {
    type: 'line',
    plugins: [ChartDataLabels, bandPlugin],
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, ticks: { font: { size: 10 }, callback: function(v) { return v + '%'; } } },
        x: { ticks: { font: { size: 10 } } }
      },
      plugins: {
        legend:  { position: 'top', labels: { font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { title: function(ctx) {
          var i = ctx[0].dataIndex;
          var curW  = curWeeks[i] ? S.data.quarter + ' ' + curWeeks[i] : null;
          var prevW = (prev && prev.weeks && prev.weeks[i]) ? prev.quarter + ' ' + prev.weeks[i] : null;
          return 'Wk ' + (i + 1) + (curW ? ' — ' + curW : '') + (prevW ? ' vs ' + prevW : '');
        } } }
      }
    }
  });

  var deltaCanvas = document.getElementById(deltaId);
  if (deltaCanvas && shadowSeries) {
    var span = Math.min(curSeries.length, shadowSeries.length);
    var deltas = [], dColors = [];
    for (var j = 0; j < n; j++) {
      if (j < span) {
        var d = +(curSeries[j] - shadowSeries[j]).toFixed(1);
        deltas.push(d); dColors.push(d >= 0 ? '#00A86B' : '#EF4444');
      } else { deltas.push(null); dColors.push('#CBD5E1'); }
    }
    S.charts[deltaId] = new Chart(deltaCanvas, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: deltas, backgroundColor: dColors }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { display: false },
                  y: { ticks: { font: { size: 8 }, callback: function(v) { return v + '%'; } } } },
        plugins: { legend: { display: false },
                   tooltip: { callbacks: { title: function(ctx) { return 'Wk ' + (ctx[0].dataIndex + 1) + ' — Δ vs ' + prev.quarter; } } } }
      }
    });
  }

  if (note) {
    note.textContent = shadowSeries
      ? 'Red band = ' + prev.quarter + ' median (' + threshold + '%) under current filters · delta bars = current vs same week last quarter'
      : 'No previous quarter data — shadow and threshold unavailable.';
  }
}
```

- [ ] **Step 3: Verify in browser.** Deploy and check on the Trends tab:
  - Both panels draw: gray shadow area (previous quarter), bold colored current line with % labels, red band from 0 to the shadow median, delta strip with green/red bars.
  - Tooltip on Wk 3 shows both real ISO weeks ("Wk 3 — FY26Q4 2026.W16 vs FY26Q3 2026.W03").
  - Filtering to a single Department updates both panels **and** the threshold note's median value.
  - Select the earliest quarter in the quarter dropdown: panels show the current line only and the "No previous quarter data" note (no shadow, no band, no delta bars).

- [ ] **Step 4: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): QoQ engagement twin panels — shadow, median threshold band, delta strips"
```

---

### Task 7: Frontend — "Excepted" tag in the Manager Scorecard

**Files:**
- Modify: `GDash.html` — `computeEngagementClient_` (~line 895), `renderManagerScorecard_` (~line 1020)

- [ ] **Step 1: Tag excepted managers in the client engagement computation.**

In `computeEngagementClient_`, after the `paceThreshold` line add:

```js
  var exceptSet = {};
  ((S.data && S.data.managerExceptions) || []).forEach(function(n) { exceptSet[n] = true; });
```

In the `mgrMap[normSup] = {` initializer add:

```js
            isSeniorLeader: isSeniorLeader_(supTitle),
            isExcepted:     !!exceptSet[normSup],
```

In the `managerScorecard` mapping include the field and sort excepted last:

```js
  var managerScorecard = Object.keys(mgrMap).map(function(k) {
    var m = mgrMap[k];
    return {
      name: m.name, normName: m.normName, isSeniorLeader: m.isSeniorLeader,
      isExcepted: m.isExcepted,
      avgCmts:  m.teamSize > 0 ? +(m.totalMgrCmts / m.teamSize).toFixed(1) : 0,
      covered:  m.covered, teamSize: m.teamSize,
    };
  }).sort(function(a, b) {
    if (a.isExcepted !== b.isExcepted) return a.isExcepted ? 1 : -1;
    return b.avgCmts - a.avgCmts;
  });
```

- [ ] **Step 2: Render the pill.** In `renderManagerScorecard_`, after the Senior Leader pill block add:

```js
    if (m.isExcepted) {
      html += ' <span style="background:#F1F5F9;color:#64748B;border:1px solid #CBD5E1;border-radius:3px;padding:1px 5px;font-size:8px;font-weight:700;vertical-align:middle" title="Excluded from engagement metrics by configuration">Excepted</span>';
    }
```

And extend the legend line at the bottom of the function:

```js
  html += '<div style="font-size:9px;color:var(--muted);margin-top:8px">&#x1F7E2; &ge;2 avg cmts &nbsp;&middot;&nbsp; &#x1F7E1; 1&ndash;2 &nbsp;&middot;&nbsp; &#x1F534; &lt;1 &nbsp;&middot;&nbsp; Coverage: % of team with &ge;1 manager comment &nbsp;&middot;&nbsp; Excepted: excluded from engagement metrics by configuration</div>';
```

- [ ] **Step 3: Verify in browser.** Temporarily add one real supervisor name to `MANAGER_ENGAGEMENT_EXCEPTIONS` in `goalCompliance.js`, deploy, Refresh (cache-bust), and check:
  - That manager shows the gray "Excepted" pill and sits at the bottom of the scorecard.
  - The QoQ Manager panel's percentages change (their team no longer counts).
  - Revert the temporary name afterwards (or keep it if it is a real exception the user wants).

- [ ] **Step 4: Commit**

```bash
git add GDash.html goalCompliance.js
git commit -m "feat(gdash): Excepted tag on manager scorecard, excluded from engagement math"
```

---

### Task 8: Frontend — conversation-timeline comment drill with cadence strip & gap callouts

**Files:**
- Modify: `GDash.html` — CSS (after the `.drill-row` rules ~line 186), `renderIndividualDrillContent_` (~line 2003), new helpers next to `goalStatusBucket_` (~line 1985)

- [ ] **Step 1: Add the timeline CSS** after the `.data-table tr.drill-row:hover td` rule:

```css
/* Conversation timeline inside the goal drill-down (2026-07-04 spec) */
.cv-thread{display:flex;flex-direction:column;gap:4px;padding:4px 0}
.cv-bubble{max-width:78%;border-radius:10px;padding:7px 10px;font-size:12px;color:var(--text)}
.cv-self{background:#EEF4FF;border:1px solid #C7DEFF;align-self:flex-start}
.cv-mgr{background:#FEF3E7;border:1px solid #FDE0B0;align-self:flex-end}
.cv-other{background:#F1F5F9;border:1px solid #CBD5E1;align-self:center}
.cv-meta{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--slate);margin-bottom:3px}
.cv-week{display:flex;align-items:center;gap:8px;margin:8px 0 2px;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.cv-week::before,.cv-week::after{content:"";flex:1;border-top:1px dashed var(--border)}
.cv-gap{align-self:center;text-align:center;font-size:10px;font-weight:700;color:#B45309;background:#FFF7ED;border:1px dashed #FDBA74;border-radius:6px;padding:4px 10px;margin:6px 0}
.cv-cadence{display:flex;flex-wrap:wrap;gap:3px;align-items:center;margin:2px 0 10px}
.cv-dot{width:16px;height:16px;border-radius:3px;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;color:#fff}
```

- [ ] **Step 2: Add date helpers** (below `goalStatusBucket_`):

```js
// Client twin of the server's dateToISOWeek_ — same "YYYY.WNN" labels.
function isoWeekOf_(dateStr) {
  if (!dateStr) return null;
  var p = String(dateStr).split('-');
  var dt = new Date(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(dt)) return null;
  dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
  var ys = new Date(dt.getFullYear(), 0, 1);
  var w  = Math.ceil(((dt - ys) / 86400000 + 1) / 7);
  return dt.getFullYear() + '.W' + (w < 10 ? '0' : '') + w;
}

// Client twin of the server's dateToFiscalQuarter_ (Jul 1 → Jun 30 FY).
function fiscalQuarterOf_(dateStr) {
  if (!dateStr) return null;
  var p = String(dateStr).split('-');
  var y = +p[0], m = +p[1];  // month 1-based
  if (m >= 7 && m <= 9)  return 'FY' + String(y + 1).slice(-2) + 'Q1';
  if (m >= 10)           return 'FY' + String(y + 1).slice(-2) + 'Q2';
  if (m <= 3)            return 'FY' + String(y).slice(-2) + 'Q3';
  return 'FY' + String(y).slice(-2) + 'Q4';
}
```

- [ ] **Step 3: Add the cadence strip + thread builders** (below the helpers from Step 2):

```js
// Weekly cadence strip for one goal: one square per elapsed quarter week —
// blue = self-commented (count shown), amber = manager only, red = silent.
// Single-quarter drills only: All-Time mixes quarters, so week alignment is
// meaningless there.
function buildCadenceStrip_(g, isAllTime) {
  var weeks = (S.data && S.data.trendWeeks) || [];
  if (isAllTime || !weeks.length) return '';
  var selfByWk = {}, mgrByWk = {};
  g.comments.forEach(function(c) {
    var wk = isoWeekOf_(c.date);
    if (!wk) return;
    if (c.type === 'self')         selfByWk[wk] = (selfByWk[wk] || 0) + 1;
    else if (c.type === 'manager') mgrByWk[wk]  = (mgrByWk[wk]  || 0) + 1;
  });
  var html = '<div class="cv-cadence"><span style="font-size:9px;font-weight:800;color:var(--slate)">Cadence:</span>';
  weeks.forEach(function(w) {
    if (selfByWk[w]) {
      html += '<span class="cv-dot" style="background:#2864E6" title="' + esc(w) + ': ' + selfByWk[w] + ' self comment' + (selfByWk[w] === 1 ? '' : 's') + '">' + selfByWk[w] + '</span>';
    } else if (mgrByWk[w]) {
      html += '<span class="cv-dot" style="background:#F59E0B" title="' + esc(w) + ': manager only">M</span>';
    } else {
      html += '<span class="cv-dot" style="background:#FEE2E2;color:#B91C1C" title="' + esc(w) + ': silent">·</span>';
    }
  });
  html += '<span style="font-size:9px;color:var(--muted)">&#x1F7E6; self &nbsp;&middot;&nbsp; &#x1F7E7; mgr only &nbsp;&middot;&nbsp; &#x1F7E5; silent</span></div>';
  return html;
}

// Conversation timeline for one goal's comments (already date-ascending from
// the server): IC left / Manager right / Other center, week separators, and an
// amber callout when ≥2 full silent weeks pass between consecutive comments.
// In All-Time mode, gaps spanning a fiscal-quarter boundary are suppressed —
// a new quarter legitimately restarts the conversation.
function renderGoalThread_(g, isAllTime) {
  if (!g.comments.length) {
    return '<div class="section-body"><div class="empty-state" style="padding:10px">No comments recorded on this goal.</div></div>';
  }
  var html = '<div class="section-body">';
  html += buildCadenceStrip_(g, isAllTime);
  html += '<div class="cv-thread">';
  var prevWeek = null, prevDate = null;
  g.comments.forEach(function(c) {
    if (prevDate && c.date) {
      var silentWeeks = Math.floor((new Date(c.date) - new Date(prevDate)) / (7 * 86400000));
      var crossesQuarter = isAllTime && fiscalQuarterOf_(prevDate) !== fiscalQuarterOf_(c.date);
      if (silentWeeks >= 2 && !crossesQuarter) {
        html += '<div class="cv-gap">&#9888; ' + silentWeeks + '-week silence — no comments from anyone</div>';
      }
    }
    var wk = isoWeekOf_(c.date);
    if (wk && wk !== prevWeek) { html += '<div class="cv-week">' + esc(wk) + '</div>'; prevWeek = wk; }
    var cls = c.type === 'self' ? 'cv-self' : c.type === 'manager' ? 'cv-mgr' : 'cv-other';
    var who = c.type === 'self' ? 'IC'      : c.type === 'manager' ? 'Manager' : 'Other';
    html += '<div class="cv-bubble ' + cls + '">' +
      '<div class="cv-meta">' + who + ' · ' + esc(c.commentator) + (c.date ? ' · ' + esc(c.date) : '') + '</div>' +
      '<div>' + esc(c.text) + '</div></div>';
    if (c.date) prevDate = c.date;
  });
  html += '</div></div>';
  return html;
}
```

- [ ] **Step 4: Rewire `renderIndividualDrillContent_`.** Inside the `data.goals.forEach(function(g, gi) {` loop:

**(a)** Replace the two count spans in the card header

```js
      '<span style="font-size:10px;color:#2864E6;font-weight:700">Self ' + selfCount + '</span>' +
      '<span style="font-size:10px;color:#B45309;font-weight:700">Mgr ' + mgrCount + '</span>' +
```

with the more prominent per-side counts (design decision "A with B's per-side counts in the header"):

```js
      '<span style="font-size:10px;font-weight:800;color:#2864E6">&#x1F9D1; Self ' + selfCount + '</span>' +
      '<span style="font-size:10px;font-weight:800;color:#B45309">&#x1F464; Mgr ' + mgrCount + '</span>' +
```

**(b)** Replace the goal-body block — everything from `html += '<div id="' + bodyId + '" style="display:none">';` down to (and including) its matching `html += '</div>'; // bodyId` — with:

```js
    html += '<div id="' + bodyId + '" style="display:none">';
    html += renderGoalThread_(g, isAllTime);
    html += '</div>'; // bodyId
```

(The old flat comment loop with the per-comment IC/status tags is fully replaced by `renderGoalThread_`.)

- [ ] **Step 5: Verify in browser.** Deploy and check:
  - Open a rocketeer drill from Needs Support and from the Team roster; expand a goal with comments from both the IC and their manager.
  - IC bubbles sit left (blue), manager bubbles right (amber), any other commentator centered (gray); week separators appear when the ISO week changes.
  - A goal with a ≥2-week quiet stretch shows the amber "N-week silence" callout.
  - The cadence strip renders one square per elapsed quarter week with correct colors and tooltips; it does **not** render when drilling from the All-Time roster.
  - A name containing an apostrophe still opens correctly (delegated `data-normname` handler untouched).

- [ ] **Step 6: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): conversation-timeline goal drill with cadence strip and silence gaps"
```

---

### Task 9: Version bumps, full test run & end-to-end QA

**Files:**
- Modify: `goalCompliance.js` (header VERSION), `GDash.html` (header comment if it carries a version)

- [ ] **Step 1: Bump the file header** in `goalCompliance.js`: `VERSION: 2.0.0` → `VERSION: 2.1.0`, and append a line to the header purpose block: `//              v2.1.0: weekly series payload, Trends tab data, QoQ prevQuarter block, manager exceptions.`

- [ ] **Step 2: Run the complete backend suite**

```bash
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_resolveGDManagerScope_(); _test_isIntern_(); _test_stripInterns_(); _test_aggregateAllRocketeers_(); _test_prevQuarterLabel_(); _test_quarterWeekList_(); _test_weeklySeries_(); _test_managerExceptions_();"
```

Expected: eight ✅ lines, no throws.

- [ ] **Step 3: End-to-end QA in the deployed web app** (paste both files into the Apps Script editor, deploy, hard-refresh):

| # | Check | Expected |
|---|---|---|
| 1 | Overview tab | No trend chart/dept chips; KPI cards, scorecard, Needs Support intact |
| 2 | Trends tab, no filters | Bars+line span every week since quarter start; labels on line points |
| 3 | Trends tab, Department filter | Bars, labels, QoQ panels and threshold note all change |
| 4 | % toggle | Line switches to 0–100% axis and back |
| 5 | QoQ panels | Shadow area, red median band, delta strips render; tooltips show both ISO weeks |
| 6 | Earliest quarter selected | "No previous quarter data" note; no shadow/band/delta |
| 7 | Manager-role account (delegate) | Trends tab shows only their org tree; drill of out-of-scope name still denied |
| 8 | Drill-down | Timeline bubbles, week separators, gap callouts, cadence strip; header shows 🧑 Self N · 👤 Mgr N |
| 9 | All-Time roster drill | No cadence strip; quarter-boundary gaps suppressed |
| 10 | Refresh button | Cache-busts and reloads with the same features (v14 keys) |

- [ ] **Step 4: Commit**

```bash
git add goalCompliance.js GDash.html
git commit -m "chore(gdash): v2.1.0 — Trends tab, QoQ engagement, timeline drill (spec 2026-07-04)"
```

---

## Self-review notes (already applied)

- **Spec coverage:** §1.1–1.6 → Tasks 1–4; §2 → Task 8; §3.1–3.3 → Tasks 5–6; §3.4 → Task 7; §4 edge cases → Task 6 Step 3 / Task 8 Step 5 / Task 9 QA table; §5 tests → Tasks 1–4 + Node runner.
- **Type consistency:** `weeklySelf`/`weeklyMgr` (emp fields), `trendWeeks`/`prevQuarter`/`managerExceptions` (payload), `isExcepted` (scorecard) used identically across backend and frontend tasks.
- **Ordering:** Tasks 1–4 are pure backend and testable without deployment; Tasks 5–8 each leave the UI in a working state; Task 5 ships a `renderQoQPanels_` placeholder that Task 6 replaces, so the Trends tab never references undefined functions.
