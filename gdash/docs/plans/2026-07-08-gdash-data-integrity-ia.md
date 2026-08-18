# GDash Data Integrity & IA Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GDash's numbers trustworthy (bounded grace flags, calendar-true week denominators, contractors located) and self-explanatory (scope-labeled KPI cards, Data Reference glossary page, readable Team tab default).

**Architecture:** Backend fixes in `goalCompliance.js` (pure helper functions + wiring inside `buildComplianceData_` / `getFullRosterMap_`), frontend fixes in `GDash.html` (labels, a new menu pane, filter plumbing). Backend ships behind a `CACHE_VER` bump so every cached payload rebuilds at once.

**Tech Stack:** Google Apps Script (V8, ES5-style code), single-file HTML frontend served via `HtmlService`, Chart.js. Unit tests are `_test_*` functions runnable in the GAS editor **and** locally in Node with a stubbed `Logger`.

**Spec:** `gdash/docs/specs/2026-07-08-gdash-data-integrity-ia-design.md`

---

## ⚠ Read before starting

1. **Line numbers drift.** `GDash.html` is actively edited in other sessions (it grew from 3059 to 3444 lines during design). Every edit below is anchored to **exact code text**, not line numbers. If an `old_string` fails to match, Grep for the anchor text and re-read that region — apply the *intent* to the current code, never force stale text.
2. **Run tests locally** from `D:\Contribution` (no GAS editor needed):
   ```powershell
   node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_computeQuarterFlags_()"
   ```
   Swap the trailing call per test. `goalCompliance.js` has no top-level GAS service calls, so `eval` + a `Logger` stub is enough (same trick the PS project uses).
3. **Commit after every task.** Repo stays local — **never push**.
4. Today's fiscal context: current quarter is **FY27Q1** (Jul 1–Sep 30, 2026); **FY26Q4** (Apr 1–Jun 30, 2026) just closed and is the "stale banner" repro case.

---

### Task 1: Bounded grace flags + `quarterState` (backend)

**Files:**
- Modify: `goalCompliance.js` — new `computeQuarterFlags_` after `parseQuarterDates_`; rewrite step 8 of `buildComplianceData_`; extend payload return
- Test: `_test_computeQuarterFlags_` in `goalCompliance.js` (tests live at the bottom of the file with the other `_test_*` functions)

- [ ] **Step 1: Write the failing test**

Add at the bottom of `goalCompliance.js`, next to `_test_prevQuarterLabel_`:

```js
function _test_computeQuarterFlags_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_computeQuarterFlags_: " + msg); }
  var qd = parseQuarterDates_('FY26Q4');  // ~2026-04-01 → 2026-06-30

  var f = computeQuarterFlags_(qd, '2026-07-08');
  assert_(f.quarterState === 'closed', "after end → closed, got " + f.quarterState);
  assert_(!f.isCompletionGrace, "closed quarter must not report completion grace (the historical bug)");
  assert_(!f.isGoalCreationGrace, "closed quarter must not report goal grace");

  f = computeQuarterFlags_(qd, '2026-06-25');
  assert_(f.quarterState === 'active' && f.isCompletionGrace, "final 2 weeks → active + completion grace");

  f = computeQuarterFlags_(qd, '2026-04-10');
  assert_(f.quarterState === 'active' && f.isGoalCreationGrace, "first 4 weeks → active + goal grace");
  assert_(!f.isCompletionGrace, "early quarter is not completion grace");

  f = computeQuarterFlags_(qd, '2026-05-20');
  assert_(f.quarterState === 'active' && !f.isGoalCreationGrace && !f.isCompletionGrace,
          "mid-quarter → active, no grace");

  f = computeQuarterFlags_(qd, '2026-03-15');
  assert_(f.quarterState === 'upcoming' && !f.isGoalCreationGrace && !f.isCompletionGrace,
          "before start → upcoming, no flags");

  f = computeQuarterFlags_(null, '2026-07-08');
  assert_(f.quarterState === null && !f.isGoalCreationGrace && !f.isCompletionGrace,
          "unparseable quarter → null state, no flags");

  Logger.log("✅ _test_computeQuarterFlags_ passed");
}
```

- [ ] **Step 2: Run the test — verify it fails**

```powershell
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_computeQuarterFlags_()"
```
Expected: `ReferenceError: computeQuarterFlags_ is not defined`

- [ ] **Step 3: Implement `computeQuarterFlags_`**

Insert directly after the closing `}` of `parseQuarterDates_`:

```js
// Pure quarter-state / grace-flag resolver — bounded on BOTH sides so a closed
// quarter can never report an "active" grace window (the historical bug: the
// completion flag had no upper bound, so it stayed true forever once a quarter
// entered its final two weeks). quarterDates may be null (unparseable label)
// → both flags false, state null.
function computeQuarterFlags_(quarterDates, todayIso) {
  if (!quarterDates) {
    return { isGoalCreationGrace: false, isCompletionGrace: false, quarterState: null };
  }
  var state = todayIso < quarterDates.start ? 'upcoming'
            : todayIso > quarterDates.end   ? 'closed'
            : 'active';
  return {
    isGoalCreationGrace: state === 'active' && todayIso <= quarterDates.gracePeriodGoalsEnd,
    isCompletionGrace:   state === 'active' && todayIso >= quarterDates.gracePeriodCompletionStart,
    quarterState:        state,
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Same command as Step 2. Expected: `✅ _test_computeQuarterFlags_ passed`

- [ ] **Step 5: Wire into `buildComplianceData_`**

Find this in `buildComplianceData_` (step 8 comment block):

```js
  var today                 = new Date().toISOString().slice(0, 10);
  var isGoalCreationGrace   = !!(quarterDates && today <= quarterDates.gracePeriodGoalsEnd);
  var isCompletionGrace     = !!(quarterDates && today >= quarterDates.gracePeriodCompletionStart);
```

Replace with:

```js
  var today                 = new Date().toISOString().slice(0, 10);
  var qFlags                = computeQuarterFlags_(quarterDates, today);
  var isGoalCreationGrace   = qFlags.isGoalCreationGrace;
  var isCompletionGrace     = qFlags.isCompletionGrace;
```

- [ ] **Step 6: Add `quarterState` to the payload**

In the same function's `return {` block, find:

```js
    isGoalCreationGrace:    isGoalCreationGrace,
    isCompletionGrace:      isCompletionGrace,
```

Replace with:

```js
    isGoalCreationGrace:    isGoalCreationGrace,
    isCompletionGrace:      isCompletionGrace,
    quarterState:           qFlags.quarterState,
```

- [ ] **Step 7: Run the whole existing test suite** (regression guard)

```powershell
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); ['_test_computeQuarterFlags_','_test_prevQuarterLabel_','_test_quarterWeekList_','_test_computeRpiScore_','_test_isNewHire_','_test_isIntern_'].forEach(function(t){ eval(t + '()'); })"
```
Expected: all `✅ … passed` lines, no throw.

- [ ] **Step 8: Commit**

```bash
git add goalCompliance.js
git commit -m "fix(gdash): bound grace flags to the quarter window + ship quarterState"
```

---

### Task 2: Calendar-derived `totalQtrWeeks` + clamped comment weeks (backend)

**Files:**
- Modify: `goalCompliance.js` — `buildComplianceData_` (week-count computation + `finalizeEmployeeRecord_`)
- Test: `_test_quarterCalendarWeeks_` in `goalCompliance.js`

- [ ] **Step 1: Write the failing test**

Add at the bottom of `goalCompliance.js`:

```js
function _test_quarterCalendarWeeks_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_quarterCalendarWeeks_: " + msg); }

  // Every fiscal quarter must span 13–14 ISO weeks — never the 20+ the old
  // distinct-comment-week count produced for closed quarters.
  ['FY26Q1', 'FY26Q2', 'FY26Q3', 'FY26Q4'].forEach(function(q) {
    var n = quarterWeekList_(q, false).length;
    assert_(n >= 13 && n <= 14, q + " spans 13–14 calendar weeks, got " + n);
  });

  // Unparseable labels have no calendar window — callers fall back to the
  // data-driven count (asserted here as the empty-list contract).
  assert_(quarterWeekList_('garbage', false).length === 0, "unparseable quarter → empty list");

  Logger.log("✅ _test_quarterCalendarWeeks_ passed");
}
```

- [ ] **Step 2: Run it — this passes already** (`quarterWeekList_` exists; the test pins the contract Task 2 builds on)

```powershell
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_quarterCalendarWeeks_()"
```
Expected: `✅ _test_quarterCalendarWeeks_ passed`

- [ ] **Step 3: Swap the denominator in `buildComplianceData_`**

Find (end of step 4, after the `qWeekSet` forEach):

```js
  var totalQtrWeeks = Math.max(1, Object.keys(qWeekSet).length);
```

Replace with:

```js
  // Calendar-derived quarter length (13–14 ISO weeks). The old distinct-
  // comment-week count inflated past quarter close — comments keep accruing on
  // quarter-bucketed goals, producing "0/24" Cmts/Wks denominators and an
  // over-tight RPI cadence for closed quarters. Unparseable quarter labels
  // (no calendar window) keep the data-driven count as a fallback.
  var calWeeks   = quarterWeekList_(quarter, false);
  var calWeekSet = {};
  calWeeks.forEach(function(wk) { calWeekSet[wk] = true; });
  var totalQtrWeeks = calWeeks.length || Math.max(1, Object.keys(qWeekSet).length);
```

(`qWeekSet` stays — it feeds the fallback.)

- [ ] **Step 4: Clamp each employee's comment weeks to the calendar window**

Inside `finalizeEmployeeRecord_` (same function, defined a few lines below), find:

```js
    emp.hireDate  = (rosterRec && rosterRec.hireDate) || '';
```

Insert **before** that line:

```js
    // Cmts/Wks numerator must count the same weeks as the calendar denominator —
    // self-comments dated outside the quarter window (late updates on quarter-
    // bucketed goals) don't count toward in-quarter cadence.
    if (calWeeks.length) {
      emp.commentWeekList = (emp.commentWeekList || []).filter(function(wk) { return calWeekSet[wk]; });
      emp.commentWeeks    = emp.commentWeekList.length;
    }
```

- [ ] **Step 5: Run the full suite** (Task 1 Step 7 command, adding `_test_quarterCalendarWeeks_` to the array). Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add goalCompliance.js
git commit -m "fix(gdash): calendar-true totalQtrWeeks + comment weeks clamped to quarter window"
```

---

### Task 3: Contractors Data merge (backend) + cache bump

**Files:**
- Modify: `goalCompliance.js` — `CONFIG_GD`, `getFullRosterMap_`, `finalizeEmployeeRecord_`, roster-injection loop
- Test: `_test_contractorRecord_` in `goalCompliance.js`

- [ ] **Step 1: Write the failing test**

```js
function _test_contractorRecord_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_contractorRecord_: " + msg); }
  var today = '2026-07-08';

  var r = contractorRecord_({ 'Name': 'Sofia Mardones Bustamante', 'Department': 'Services',
    'Class': 'tc', 'Supervisor': 'Jane Doe', 'Key Location': 'Chile',
    'Termination/Release Date': '' }, today);
  assert_(r.isCrew === true, "crew flag set");
  assert_(r.normName === 'sofia mardones bustamante', "normName derived");
  assert_(r.location === 'Chile', "Key Location mapped, got " + r.location);
  assert_(r.classVal === 'TC', "class uppercased");
  assert_(r.active === true, "blank release date → active");
  assert_(r.jobTitle === '' && r.hireDate === '', "crew rows carry no title/hire date");

  r = contractorRecord_({ 'Name': 'Past Release', 'Termination/Release Date': '2026-06-30' }, today);
  assert_(r.active === false, "past release date → inactive");

  r = contractorRecord_({ 'Name': 'Future Release', 'Termination/Release Date': '2026-12-31' }, today);
  assert_(r.active === true, "future-dated planned release stays active until the date");

  assert_(contractorRecord_({ 'Department': 'X' }, today) === null, "nameless row → null");

  Logger.log("✅ _test_contractorRecord_ passed");
}
```

- [ ] **Step 2: Run it — verify it fails** (`contractorRecord_ is not defined`)

- [ ] **Step 3: Add the config key**

In `CONFIG_GD`, directly after the `SHEET_ROSTER: 'Data',` line (keep its explanatory comment intact):

```js
  // Second Roster-spreadsheet tab holding crewmembers/contractors (Name,
  // Department, Termination/Release Date, Class, Supervisor, Key Location).
  // Merged into getFullRosterMap_ so crew resolve location/supervisor/
  // termination like FTEs; the Data tab wins on a name collision.
  SHEET_CONTRACTORS:   'Contractors Data',
```

- [ ] **Step 4: Implement `contractorRecord_`**

Insert directly **before** `function getFullRosterMap_()`:

```js
// Normalizes one "Contractors Data" row to the record shape getFullRosterMap_
// returns. Crew rows carry no Job Title or hire date — consumers branch on
// isCrew (job family "Crew", never intern-stripped by roster title, never
// new-hire flagged). Unlike the Data tab (any non-blank Termination = inactive),
// crew release dates can be future-dated planned releases — only a date
// on/before todayIso deactivates. Returns null for rows without a name.
function contractorRecord_(row, todayIso) {
  var name = row['Name'] || row['Rocketeer'] || row['Employee Name'] || row['Full Name'] || '';
  if (!name) return null;
  var termRaw = row['Termination/Release Date'];
  var termIso = (termRaw !== undefined && termRaw !== null && String(termRaw).trim() !== '')
              ? fmtDate_(termRaw) : '';
  return {
    name:       String(name).trim(),
    normName:   normName_(String(name)),
    department: String(row['Department'] || '').trim(),
    supervisor: String(row['Supervisor'] || row['Manager'] || '').trim(),
    jobTitle:   '',
    classVal:   String(row['Class'] || '').trim().toUpperCase(),
    location:   String(row['Key Location'] || '').trim(),
    active:     !(termIso && termIso <= todayIso),
    hireDate:   '',
    isCrew:     true,
  };
}
```

- [ ] **Step 5: Run the test — verify it passes**

- [ ] **Step 6: Merge crew rows in `getFullRosterMap_`**

6a. In the `Data`-tab record literal (the `map[norm] = {` block containing `location:   String(row['Key Location'] || '').trim(),`), add after the `hireDate:` line:

```js
        isCrew:     false,
```

6b. After the closing `});` of that `rows.forEach(...)` loop and **before** the `var activeCount = …` logging block, insert:

```js
    // Crew/contractors live on a second tab — merge them in so location,
    // supervisor, termination, and org-tree scoping work for crew exactly as
    // for FTEs. The Data tab wins on a normalized-name collision.
    var todayIso = new Date().toISOString().slice(0, 10);
    var crewAdded = 0, crewSkipped = 0;
    try {
      var crewRows = readSheet_(CONFIG_GD.ROSTER_SS_ID, CONFIG_GD.SHEET_CONTRACTORS);
      crewRows.forEach(function(row) {
        var rec = contractorRecord_(row, todayIso);
        if (!rec) return;
        if (map[rec.normName]) { crewSkipped++; return; }
        map[rec.normName] = rec;
        crewAdded++;
      });
    } catch (e) { Logger.log('⚠️ getFullRosterMap_ contractors: ' + e.message); }
    Logger.log('getFullRosterMap_: +' + crewAdded + ' crew from "' + CONFIG_GD.SHEET_CONTRACTORS +
               '" (' + crewSkipped + ' name collisions kept the Data-tab record)');
```

- [ ] **Step 7: Enrich employees with crew fields**

In `finalizeEmployeeRecord_`, find:

```js
    emp.jobFamily        = deriveJobFamily_(emp.jobTitle);
```

Replace with:

```js
    // Crew have no roster Job Title — bucket them as their own job family so
    // the Job Family filter stays meaningful instead of dumping them in "Other".
    emp.isCrew           = !!(rosterRec && rosterRec.isCrew);
    emp.crewClass        = emp.isCrew ? (rosterRec.classVal || '') : '';
    emp.jobFamily        = emp.isCrew ? 'Crew' : deriveJobFamily_(emp.jobTitle);
```

- [ ] **Step 8: Keep crew out of the zero-goal injection**

In the roster-injection loop (step 3b comment: "Inject every ACTIVE, in-scope, non-intern Roster employee not found in the RD sheet"), directly after the line `var r = rosterMap[norm];`, add:

```js
    // Crew join the dashboard through their RD goals only — goal-count policy
    // isn't asserted for contractors, so a goal-less contractor is never
    // injected as a 0-goal At Risk row (headline counts unchanged by the merge).
    if (r.isCrew) return;
```

- [ ] **Step 9: Bump the cache version**

In `CONFIG_GD`, change:

```js
  CACHE_VER:           'gd_v17_',  // bumped: employee records add feedback-loop + closed-no-note rollups (Behaviors tab; v16 added hireDate/isNewHire)
```

to:

```js
  CACHE_VER:           'gd_v18_',  // bumped: Contractors Data merged into roster map (isCrew/crewClass), quarterState, calendar totalQtrWeeks
```

- [ ] **Step 10: Run the full suite** (all `_test_*` from Tasks 1–3). Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): merge Contractors Data tab into roster map (isCrew, Key Location, release dates)"
```

---

### Task 4: Grace banner display states (frontend)

**Files:**
- Modify: `GDash.html` — CSS block + `updateGraceBanner_()`

- [ ] **Step 1: Add the neutral banner style**

Find the CSS rules:

```css
.grace-goal{background:#FFF7ED;border-bottom:1px solid #FED7AA;color:#92400E}
.grace-completion{background:#FFF0F0;border-bottom:1px solid #FECACA;color:#991B1B}
```

Add after them:

```css
.grace-neutral{background:#F1F5F9;border-bottom:1px solid #E2E8F0;color:#64748B}
```

- [ ] **Step 2: Rewrite `updateGraceBanner_`**

Replace the entire function body with:

```js
function updateGraceBanner_() {
  var bar = document.getElementById('grace-bar');
  if (!bar || !S.data) { if (bar) bar.style.display = 'none'; return; }
  var qd     = S.data.quarterDates || {};
  var state  = S.data.quarterState;
  var isGoal = S.data.isGoalCreationGrace;
  var isComp = S.data.isCompletionGrace;
  // Server bounds the grace flags to the quarter window (computeQuarterFlags_),
  // so isGoal/isComp can only be true while quarterState === 'active'. Closed
  // and upcoming quarters get a neutral historical note, never an urgency bar.
  if (state === 'closed') {
    bar.className = 'grace-bar grace-neutral';
    bar.style.display = '';
    bar.innerHTML = '&#128197; <strong>' + esc(S.data.quarter || '') + '</strong> — quarter closed ' +
      (qd.end || '') + ' &nbsp;·&nbsp; Historical view; grace periods no longer apply.';
  } else if (state === 'upcoming') {
    bar.className = 'grace-bar grace-neutral';
    bar.style.display = '';
    bar.innerHTML = '&#128197; <strong>' + esc(S.data.quarter || '') + '</strong> — starts ' + (qd.start || '');
  } else if (isGoal) {
    bar.className = 'grace-bar grace-goal';
    bar.style.display = '';
    bar.innerHTML = '&#9201; <strong>Goal Creation Grace Period</strong> — ends ' + (qd.gracePeriodGoalsEnd || '') +
      ' &nbsp;·&nbsp; Watch-tier rocketeers (8–9 goals) are visible but not yet mandatory follow-up.';
  } else if (isComp) {
    bar.className = 'grace-bar grace-completion';
    bar.style.display = '';
    bar.innerHTML = '&#9200; <strong>Completion Grace Period Active</strong> — ends ' + (qd.end || '') +
      ' &nbsp;·&nbsp; Flag rocketeers who have not moved goals to Completed status.';
  } else {
    bar.style.display = 'none';
  }
}
```

(Preserve any wording drift in the existing goal/completion branches — only the two neutral branches and the flag routing are new.)

- [ ] **Step 3: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): quarterState-aware grace banner (closed/upcoming quarters go neutral)"
```

---

### Task 5: KPI scope labels + engagement base + goal-status footnote (frontend)

**Files:**
- Modify: `GDash.html` — `renderOverview`, `renderSupport`, `buildGoalStatusTable_`

- [ ] **Step 1: Overview cards state their base**

In `renderOverview`, after the line `var avgGoals = …`, add:

```js
  var withGoals = emps.filter(function(e){ return e.totalGoals > 0; }).length;
```

Then in the `document.getElementById('kpi-overview').innerHTML =` block, replace these three `kpiCard(...)` calls:

```js
    kpiCard('Watch (8–9 goals)',   watch,                        '⏳', '#F59E0B', 'One or two goals from full compliance') +
    kpiCard('At Risk (&lt;8)',     atRisk,                       '⚠',  '#EF4444', 'Below threshold — STF and RPI at risk') +
    kpiCard('Org Engagement Rate', (eng.engagingPct || 0) + '%', '💬', '#2864E6', '≥1 self-comment this quarter') +
```

with:

```js
    kpiCard('Watch (8–9 goals)',   watch,                        '⏳', '#F59E0B', 'One or two goals from full compliance · all rocketeers, incl. new hires') +
    kpiCard('At Risk (&lt;8)',     atRisk,                       '⚠',  '#EF4444', 'Below threshold — STF and RPI at risk · all rocketeers, incl. new hires') +
    kpiCard('Org Engagement Rate', (eng.engagingPct || 0) + '%', '💬', '#2864E6', '≥1 self-comment · base: ' + (eng.activeCount || 0) + ' of ' + withGoals + ' with goals (' + (total - withGoals) + ' with none excluded)') +
```

- [ ] **Step 2: Needing Support cards state their exclusion**

In `renderSupport`, replace:

```js
    kpiCard('At Risk (&lt;8)',  atRisk,       '⚠',  '#EF4444', 'Below goal threshold — STF and RPI at risk') +
    kpiCard('Watch (8–9)',      watch,        '⏳', '#F59E0B', 'One or two goals from full compliance') +
```

with:

```js
    kpiCard('At Risk (&lt;8)',  atRisk,       '⚠',  '#EF4444', 'Below goal threshold — STF and RPI at risk · excl. ' + newHires + ' new hire' + (newHires === 1 ? '' : 's') + ' (Overview counts them)') +
    kpiCard('Watch (8–9)',      watch,        '⏳', '#F59E0B', 'One or two goals from full compliance · excl. ' + newHires + ' new hire' + (newHires === 1 ? '' : 's')) +
```

- [ ] **Step 3: Goal Status Distribution footnote**

In `buildGoalStatusTable_`, append this to the returned HTML string (concatenate after the closing `</table>`):

```js
    '<div style="font-size:9px;color:var(--muted);margin-top:8px">A rocketeer appears once per status they hold — the People column exceeds total headcount by design.</div>'
```

- [ ] **Step 4: Commit**

```bash
git add GDash.html
git commit -m "fix(gdash): KPI cards state their scope/denominator; goal-status footnote"
```

---

### Task 6: Crew badge + Employment filter (frontend)

**Files:**
- Modify: `GDash.html` — CSS, filter-bar markup, filter constants, `getFiltered`, `S.filters` literals, payload decoration, `atRiskRowHtml_`, `TEAM_COLUMNS_THIS_QUARTER`, `buildThisQuarterGroups_`

- [ ] **Step 1: CSS + badge helper**

Add to the CSS block (near `.tier-watch` / `.tier-atrisk`):

```css
.crew-badge{background:#EEF2FF;color:#3730A3;border-radius:4px;padding:2px 6px;font-size:9px;font-weight:800;margin-left:6px;vertical-align:middle}
```

Add a helper next to `terminatedTag_` (Grep `function terminatedTag_` to locate):

```js
// "Crew" badge for contractors merged from the Contractors Data tab — Class
// value surfaces in the tooltip only (keeps table cells compact).
function crewTag_(e) {
  return e.isCrew ? ' <span class="crew-badge" title="Class: ' + esc(e.crewClass || '—') + '">Crew</span>' : '';
}
```

- [ ] **Step 2: Badge in the Needing Support / Attrition tables**

In `atRiskRowHtml_`, replace:

```js
  html += '<td style="font-weight:600;white-space:nowrap">' + esc(e.name) + terminatedTag_(e) + '</td>';
```

with:

```js
  html += '<td style="font-weight:600;white-space:nowrap">' + esc(e.name) + crewTag_(e) + terminatedTag_(e) + '</td>';
```

- [ ] **Step 3: Badge in the Team roster**

In `TEAM_COLUMNS_THIS_QUARTER`, replace:

```js
  { label: 'Rocketeer',   render: function(r) { return esc(r.name) + terminatedTag_(r); } },
```

with:

```js
  { label: 'Rocketeer',   render: function(r) { return esc(r.name) + crewTag_(r) + terminatedTag_(r); } },
```

Then Grep `function buildThisQuarterGroups_` — if its row objects are built by mapping explicit fields (rather than passing employee objects through), add `isCrew: e.isCrew, crewClass: e.crewClass,` to the mapped record so `crewTag_` sees them. If rows are the raw employee objects, no change.

- [ ] **Step 4: Employment chip in the filter bar**

After the supervisor `chip-wrap` div in the filter bar markup:

```html
    <div class="chip-wrap">
      <div class="chip" id="chip-employment" onclick="toggleDrop('employment')">🧑‍🚀 <span id="chip-employment-txt">All Employment</span><span class="chip-arrow">▾</span></div>
      <div class="dropdown-panel" id="drop-employment"></div>
    </div>
```

- [ ] **Step 5: Filter plumbing**

Replace:

```js
var FILTER_KEYS = ['location','department','jobFamily','status','supervisor'];
var FILTER_FIELD = { location:'location', department:'department', jobFamily:'jobFamily', status:'complianceStatus', supervisor:'supervisor' };
var FILTER_LABELS = { location:'Locations', department:'Departments', jobFamily:'Job Families', status:'Statuses', supervisor:'Supervisors' };
```

with:

```js
var FILTER_KEYS = ['location','department','jobFamily','status','supervisor','employment'];
var FILTER_FIELD = { location:'location', department:'department', jobFamily:'jobFamily', status:'complianceStatus', supervisor:'supervisor', employment:'employment' };
var FILTER_LABELS = { location:'Locations', department:'Departments', jobFamily:'Job Families', status:'Statuses', supervisor:'Supervisors', employment:'Employment' };
```

In `getFiltered()`, add alongside the other conditions:

```js
    if (S.filters.employment.length && S.filters.employment.indexOf(e.employment)     === -1) return false;
```

Replace **every** occurrence (the `S` state initializer, `onQuarterChange`, and any other literal) of:

```js
{ location:[], department:[], jobFamily:[], status:[], supervisor:[] }
```

with:

```js
{ location:[], department:[], jobFamily:[], status:[], supervisor:[], employment:[] }
```

Also Grep `function resetFilters` — if it iterates `FILTER_KEYS` it needs nothing; if it assigns a literal, the replace above already covered it.

- [ ] **Step 6: Derive the employment field on payload receipt**

Add near `onReady()`:

```js
// The Employment filter's field is client-derived — the payload ships isCrew
// per employee; "FTE"/"Crew" labels are a display concern.
function decorateEmployees_() {
  if (!S.data || !S.data.employees) return;
  S.data.employees.forEach(function(e) { e.employment = e.isCrew ? 'Crew' : 'FTE'; });
  (S.data.attrition || []).forEach(function(e) { e.employment = e.isCrew ? 'Crew' : 'FTE'; });
}
```

Call it in **both** payload landing spots, right after `S.data = data;` — in `init()`'s success handler and in `onQuarterChange`'s success handler:

```js
      S.data = data;
      decorateEmployees_();
```

- [ ] **Step 7: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Crew badge + Employment (FTE/Crew) filter across all tabs"
```

---

### Task 7: 📖 Data Reference page (frontend)

**Files:**
- Modify: `GDash.html` — `VIEWS`, `renderTab`, pane markup, new `renderDataRef_()`

- [ ] **Step 1: Register the view**

In the `VIEWS` array, insert before the `access` entry:

```js
  { id: 'dataref',   label: '📖 Data Reference',      location: 'menu',   roles: null },
```

- [ ] **Step 2: Dispatch it**

In `renderTab`, add before the `access` line:

```js
  else if (tabId === 'dataref')   renderDataRef_();
```

- [ ] **Step 3: Pane markup**

Insert before the `<!-- ── ACCESS CONTROL … ── -->` comment in `<main>`:

```html
    <!-- ── DATA REFERENCE (everyone, opened from the ☰ menu) ── -->
    <div id="pane-dataref" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>📖 Data Reference</h2><p class="section-sub">Metric definitions, denominators, calendar rules &amp; data sources</p></div>
          <button class="btn" onclick="switchTab(S.lastRegularTab || 'overview')">← Back to Dashboard</button>
        </div>
        <div id="dataref-body" class="section-body"></div>
      </div>
    </div>
```

- [ ] **Step 4: Implement `renderDataRef_`**

Add near `renderAccessTab_`:

```js
// Static glossary/methodology page — every quarter-dependent value fills from
// the live payload at render (PS Dashboard updateQuarterLabels_ principle), so
// nothing here needs a manual edit at quarter rollover.
function renderDataRef_() {
  var body = document.getElementById('dataref-body');
  if (!body || !S.data) return;
  var qd  = S.data.quarterDates || {};
  var wks = S.data.totalQtrWeeks || '—';
  var q   = esc(S.data.quarter || '');
  function sec(title, inner) {
    return '<div style="margin-bottom:22px"><h2 style="font-size:14px;margin-bottom:8px">' + title + '</h2>' + inner + '</div>';
  }
  function dl(rows) {
    return '<table class="data-table" style="font-size:12px"><tbody>' + rows.map(function(r) {
      return '<tr><td style="font-weight:700;white-space:nowrap;width:180px;vertical-align:top">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  body.innerHTML =
    sec('Metric definitions', dl([
      ['Compliance tiers', 'On Target = 10+ goals &nbsp;·&nbsp; Watch = 8–9 &nbsp;·&nbsp; At Risk = &lt;8 (quarter goal count from the RD sheet)'],
      ['RPI (0–6)', 'Rocketeer Performance Index — 3 criteria × 2 pts: ① every goal dated inside the quarter ② 6 goals meeting the growing self-comment cadence (required = week-of-quarter − 6, min 1, capped at 8) ③ 8+ goals completed. The RPI signal shows only at a perfect 6/6.'],
      ['STF', 'Set-the-Future eligibility — 8+ completed goals AND 6 of them carrying 8+ total comments.'],
      ['REX', 'Rocketeer Experience follow-up — one HR tracker case per person; the latest note carries the case status (Needs Follow-up → Reviewed / Resolved; Escalated when raised).'],
      ['Engagement', '≥1 self-comment this quarter, among rocketeers with goals. Below Pace = fewer self-comments than half the weeks elapsed. Silent = zero self-comments.'],
      ['Cmts/Wks', 'Distinct ISO weeks with ≥1 self-comment ÷ calendar weeks in the quarter (' + wks + ' for ' + q + '). Comments dated outside the quarter window don\'t count.'],
    ])) +
    sec('Denominators &amp; scopes', dl([
      ['Total Rocketeers', 'Active employees in scope — interns and offboarded excluded; crew included.'],
      ['With goals', 'Engagement metrics divide by rocketeers with ≥1 goal, not total headcount — the engagement and headcount cards legitimately differ.'],
      ['Excl. new hires', 'Needing Support counts exclude rocketeers hired after quarter start; Overview counts include everyone. Each card\'s sub-label states its base.'],
      ['Goal Status "People"', 'A rocketeer appears once per status they hold, so the People column exceeds headcount by design.'],
    ])) +
    sec('Calendar rules', dl([
      ['Fiscal quarters', 'FY runs Jul 1 → Jun 30. ' + q + ': ' + (qd.start || '—') + ' → ' + (qd.end || '—') + ' (' + wks + ' ISO weeks).'],
      ['Goal-creation grace', 'First 4 weeks of the quarter (ends ' + (qd.gracePeriodGoalsEnd || '—') + ') — Watch-tier rocketeers are visible but not yet mandatory follow-up.'],
      ['Completion grace', 'Final 2 weeks (from ' + (qd.gracePeriodCompletionStart || '—') + ') — flag goals not yet moved to Completed.'],
      ['Closed quarters', 'Grace periods never apply to a closed quarter — the banner shows a neutral historical note instead.'],
    ])) +
    sec('Data sources', dl([
      ['Goals &amp; comments', 'RD sheet — goal + comment rows, quarter-bucketed by each goal\'s Start Date.'],
      ['Employees (FTE)', 'Roster spreadsheet · "Data" tab (HRIS export: supervisor, department, class, Key Location, hire &amp; termination dates).'],
      ['Crew / contractors', 'Roster spreadsheet · "Contractors Data" tab (class, supervisor, Key Location, release date) — rows get the Crew badge and the Employment filter.'],
      ['HR follow-ups', '"HR Follow-Up Tracker" sheet — the REX Tracker tab reads and writes here.'],
      ['Join key', 'Normalized full name (lowercase, accents stripped, whitespace collapsed) links RD ↔ Roster ↔ notes.'],
    ]));
}
```

- [ ] **Step 5: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Data Reference glossary page behind the ☰ menu"
```

---

### Task 8: Team & Individuals opens readable + REX Tracker label pass (frontend)

**Files:**
- Modify: `GDash.html` — `pane-team` markup, `renderHRTracker` KPI notes

- [ ] **Step 1: Default-expand the Org Breakdown**

In the `pane-team` markup, make three changes:

```html
<div id="team-breakdown-body" style="display:none">
```
→
```html
<div id="team-breakdown-body">
```

```html
<span id="team-breakdown-toggle" style="color:var(--muted);font-size:12px">▾</span>
```
→
```html
<span id="team-breakdown-toggle" style="color:var(--muted);font-size:12px">▴</span>
```

```html
<p class="section-sub">Compliance by Department / Location / Job Family (collapsed by default)</p>
```
→
```html
<p class="section-sub">Compliance by Department / Location / Job Family (click to collapse)</p>
```

**Chart caveat:** `toggleTeamBreakdown_`'s comment explains Chart.js can't size a canvas inside `display:none`. With the body now visible by default and `renderTeam` only running when the tab is active, the location chart builds at real size — no resize hack needed on first paint. Verify in QA (Step 3 of Task 9) that `chart-location` renders at full width on first visit; if it doesn't, call `S.charts['chart-location'].resize()` at the end of `renderBreakdown` inside a `setTimeout(…, 0)`.

- [ ] **Step 2: REX Tracker KPI scope wording**

In `renderHRTracker`, replace the four `kpiCard` notes to name their scope:

```js
    kpiCard('Notes Logged',           qNotes.length, '📝', '#058CDC', 'HR follow-ups this quarter') +
    kpiCard('Reviewed / Resolved',    reviewed,      '✅', '#00A86B', 'Rocketeers whose latest note is closed') +
    kpiCard('Needs Follow-up',        followUp,      '⏳', '#F59E0B', 'Rocketeers with a pending conversation') +
    kpiCard('Improved After Feedback',improved,      '📈', '#2864E6', 'Status improved since latest note');
```
→
```js
    kpiCard('Notes Logged',           qNotes.length, '📝', '#058CDC', 'HR follow-ups logged this quarter') +
    kpiCard('Reviewed / Resolved',    reviewed,      '✅', '#00A86B', 'This quarter\'s cases whose latest note is closed') +
    kpiCard('Needs Follow-up',        followUp,      '⏳', '#F59E0B', 'This quarter\'s cases with a pending conversation') +
    kpiCard('Improved After Feedback',improved,      '📈', '#2864E6', 'Compliance status improved since the latest note');
```

- [ ] **Step 3: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Team tab opens expanded; REX Tracker KPI notes name their scope"
```

---

### Task 9: Verification — tests, RPI audit, live QA

**Files:**
- Modify: `goalCompliance.js` (temporary audit function, later removed)

- [ ] **Step 1: Full local test run**

```powershell
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); ['_test_computeQuarterFlags_','_test_quarterCalendarWeeks_','_test_contractorRecord_','_test_prevQuarterLabel_','_test_quarterWeekList_','_test_computeRpiScore_','_test_isNewHire_','_test_isIntern_','_test_stripInterns_','_test_aggregateAllRocketeers_','_test_resolveGDManagerScope_','_test_feedbackLoop_','_test_weeklySeries_','_test_managerExceptions_'].forEach(function(t){ eval(t + '()'); })"
```
Expected: every test logs `✅ … passed`.

- [ ] **Step 2: RPI shift audit (temporary — GAS editor, run as owner)**

Add temporarily to `goalCompliance.js`:

```js
// TEMPORARY (remove after the week-cap verification) — snapshot per-person RPI
// so the calendar-week correction's score shifts can be eyeballed against the
// pre-change snapshot. Run once BEFORE deploying Task 2, once after.
function _audit_rpiSnapshot_() {
  var d = getGoalsComplianceData(CONFIG_GD.DEFAULT_QUARTER);
  var lines = (d.employees || []).map(function(e) {
    return e.name + ' | RPI ' + e.rpiScore + '/' + e.rpiMax + ' | cmtsWks ' + e.commentWeeks + '/' + d.totalQtrWeeks;
  }).sort();
  Logger.log('RPI snapshot (' + d.quarter + ', weeks=' + d.totalQtrWeeks + '):\n' + lines.join('\n'));
}
```

Run in the GAS editor before pushing the backend changes (against the old deployed code) and again after; diff the two logs. Every shifted score must trace to `commentWeeks`/`totalQtrWeeks` changing. Then **delete the function** and commit the removal.

- [ ] **Step 3: Live QA checklist** (deploy backend first, hard-refresh, then frontend)

- [ ] FY26Q4 (closed) shows the neutral "quarter closed 2026-06-30" bar — no orange/red grace bar.
- [ ] FY27Q1 (current) shows the goal-creation grace bar ending ~2026-07-29.
- [ ] Cmts/Wks renders n/13 or n/14 everywhere; numerator ≤ denominator for every row.
- [ ] Overview At Risk/Watch cards say "all rocketeers, incl. new hires"; Needing Support cards say "excl. N new hires"; the count difference is now explained on-card.
- [ ] Org Engagement Rate card names its with-goals base and the excluded count.
- [ ] Sofia Mardones Bustamante shows a real location and a Crew badge; no "Unknown" location remains for anyone present in Contractors Data.
- [ ] Total Rocketeers headcount is unchanged from before the merge (crew injection guard held).
- [ ] Employment filter (All/FTE/Crew) recomputes KPIs, donuts, and tables on every tab.
- [ ] 📖 Data Reference opens from ☰ for a viewer role and an admin role; Back to Dashboard returns to the prior tab; quarter dates on the page match the selected quarter.
- [ ] Team & Individuals first load shows the Org Breakdown expanded with the location chart at full width.
- [ ] Goal Status Distribution shows the footnote under the table.
- [ ] RPI audit diff reviewed; `_audit_rpiSnapshot_` deleted.

- [ ] **Step 4: Final commit**

```bash
git add goalCompliance.js GDash.html
git commit -m "chore(gdash): remove RPI audit scaffold after week-cap verification"
```

---

## Spec deviations (intentional)

1. **Spec 1d** said the payload adds `withGoalsCount`; the engagement card is computed client-side from the *filtered* employee set (`computeEngagementClient_`), so a static payload count would be wrong whenever filters are active. The base is derived client-side in `renderOverview` instead (Task 5 Step 1) — same outcome, filter-correct.
2. **Spec 1c** said `deriveJobFamily_` gains an `isCrew` short-circuit; the branch lives at the call site in `finalizeEmployeeRecord_` (Task 3 Step 7) because `deriveJobFamily_` receives only a title string. Equivalent behavior, no signature change.
3. **Spec addition:** crew are excluded from the zero-goal roster injection (Task 3 Step 8). Without this, merging contractors into the roster map would inject every goal-less contractor as a 0-goal At Risk row — changing headline counts, which the "metrics unchanged" decision forbids.
