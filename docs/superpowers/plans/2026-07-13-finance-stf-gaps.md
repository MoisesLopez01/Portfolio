# Finance STF-Gaps View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "💰 STF Gaps (Finance)" tab to GDash that lists every STF-ineligible Rocketeer, grouped by manager, with a per-person reason signal and a 0–7 completed-goals threshold, so Finance can pinpoint and route follow-ups.

**Architecture:** Frontend-only change in `GDash.html`. A small DOM-free "pure" block (`classifyStfReason_`, `buildFinanceGaps_`, `groupByMgrSorted_`) does all classification/grouping and is unit-tested from Node by eval-ing a marked source region (the repo's existing test convention — see `tests/period-buckets.test.js`). The render layer (tab wiring, stacked-bar chart, two grouped tables, slider, CSV export) sits outside the pure block and reuses existing GDash idioms (`esc`, `STATUS_C`, `data-normname` drill-down, the CSV-export pattern).

**Tech Stack:** Vanilla ES5-style JS embedded in a GAS `HtmlService` HTML file; Node (`v24`) for the pure-logic unit test. No backend (`goalCompliance.js`) change, no cache/version bump.

**Spec:** `docs/superpowers/specs/2026-07-13-finance-stf-gaps-design.md`

---

## File Structure

- **Modify `GDash.html`** — all production code:
  - New `// ── FINANCE-PURE-BEGIN ──` … `// ── FINANCE-PURE-END ──` block (inserted just before the `// ── VIEWS` comment, ~line 918): `STF_COMPLETED_BAR_`, `STF_CMT_GOALS_BAR_`, `classifyStfReason_`, `groupByMgrSorted_`, `buildFinanceGaps_`.
  - `VIEWS` array (~line 930): new `finance` entry.
  - Tab-bar markup (~line 422): new tab button.
  - `renderTab` dispatch (~line 1208): new case.
  - New `<div id="pane-finance">` pane (after the `pane-hrtracker` close, ~line 736).
  - Render layer near the other renderers: `FIN_REASONS_`, `renderFinance`, `renderFinanceChart_`, `renderFinanceSection_`, `finBadges_`, `finStat_`, `setFinanceThreshold_`, `exportFinanceCsv_`.
  - One delegated click handler for chart-bar → group scroll (added beside the existing delegated listeners, ~line 961).
- **Create `tests/finance-stf-gaps.test.js`** — Node unit test for the pure block.

---

### Task 1: Pure classification + grouping logic (TDD)

**Files:**
- Create: `tests/finance-stf-gaps.test.js`
- Modify: `GDash.html` (insert the FINANCE-PURE block just before `// ── VIEWS — single source of truth for navigation ──`, currently line 918)

- [ ] **Step 1: Write the failing test**

Create `tests/finance-stf-gaps.test.js`:

```javascript
// Unit tests for the FINANCE-PURE block in GDash.html.
// Run: node tests/finance-stf-gaps.test.js   (exit 0 = all pass)
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'GDash.html'), 'utf8');
const m = src.match(/\/\/ ── FINANCE-PURE-BEGIN ──([\s\S]*?)\/\/ ── FINANCE-PURE-END ──/);
if (!m) { console.error('FAIL: FINANCE-PURE block not found in GDash.html'); process.exit(1); }
eval(m[1]);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (ok ? '' : ' — got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
}

// Helper to build an employee fixture with sensible zero defaults.
function emp(o) {
  return Object.assign({
    name: 'X', normName: 'x', supervisor: 'Mgr', department: 'Dept',
    stfGoalsCompleted: 0, stfGoalsWithSufficientComments: 0,
    goalsInProgress: 0, goalsPlanned: 0, goalsCanceled: 0, goalsNotCompleted: 0,
    totalGoals: 0, isNewHire: false, onLeave: false,
  }, o);
}

// ── classifyStfReason_: eligibility gate ──
check('eligible → null',
  classifyStfReason_(emp({ stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6 })),
  null);

// ── classifyStfReason_: primary reason precedence ──
check('comments primary (8+ completed, under comment bar)',
  classifyStfReason_(emp({ stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 })).primary,
  'comments');
check('pending primary (open goals can still reach 8)',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 4 })).primary,
  'pending');
check('canceled primary (pending cannot close gap, something lost)',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 1, goalsCanceled: 3 })).primary,
  'canceled');
check('toofew primary (no pipeline at all)',
  classifyStfReason_(emp({ stfGoalsCompleted: 3, totalGoals: 3 })).primary,
  'toofew');
check('toofew primary (orphan: pending<gap, nothing lost)',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 1, totalGoals: 6 })).primary,
  'toofew');

// ── classifyStfReason_: badges are factual + multi ──
check('under-bar with both open and lost → both badge kinds',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 2, goalsCanceled: 1 }))
    .badges.map(b => b.kind).sort(),
  ['canceled', 'pending']);
check('comment-shortfall badge kind present',
  classifyStfReason_(emp({ stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 }))
    .badges.map(b => b.kind),
  ['comments']);

// ── buildFinanceGaps_: threshold boundary ──
const boundaryEmps = [emp({ name: 'A', normName: 'a', stfGoalsCompleted: 7, goalsInProgress: 1 })];
check('completed 7 shown at threshold 7',
  buildFinanceGaps_(boundaryEmps, 7).underBar.length, 1);
check('completed 7 hidden at threshold 6 (counted as hidden)',
  buildFinanceGaps_(boundaryEmps, 6).totals.hidden, 1);
check('completed 7 not in list at threshold 6',
  buildFinanceGaps_(boundaryEmps, 6).underBar.length, 0);

// ── buildFinanceGaps_: comments section is threshold-independent ──
const cmtEmps = [emp({ name: 'C', normName: 'c', stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 })];
check('comment-shortfall shows even at threshold 0',
  buildFinanceGaps_(cmtEmps, 0).commentsShortfall.length, 1);

// ── buildFinanceGaps_: exclusions + totals ──
const mixed = [
  emp({ name: 'NewHire', normName: 'nh', stfGoalsCompleted: 2, isNewHire: true }),
  emp({ name: 'OnLeave', normName: 'ol', stfGoalsCompleted: 2, onLeave: true }),
  emp({ name: 'Elig',    normName: 'el', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6 }),
  emp({ name: 'Under',   normName: 'un', stfGoalsCompleted: 3, goalsInProgress: 6 }),
];
const mm = buildFinanceGaps_(mixed, 7);
check('new-hire & on-leave excluded from evaluated', mm.totals.evaluated, 2); // Elig + Under only
check('one ineligible shown', mm.totals.ineligible, 1);
check('pending total = 1', mm.totals.pending, 1);

// ── buildFinanceGaps_: manager grouping sorted worst-first ──
const twoMgrs = [
  emp({ name: 'a1', normName: 'a1', supervisor: 'Alice', stfGoalsCompleted: 1, goalsInProgress: 9 }),
  emp({ name: 'a2', normName: 'a2', supervisor: 'Alice', stfGoalsCompleted: 2, goalsInProgress: 9 }),
  emp({ name: 'b1', normName: 'b1', supervisor: 'Bob',   stfGoalsCompleted: 1, goalsInProgress: 9 }),
];
const g = buildFinanceGaps_(twoMgrs, 7).underBar;
check('worst manager first (Alice has 2)', g[0].supervisor, 'Alice');
check('within-group sorted by completed asc', g[0].rocketeers.map(r => r.completed), [1, 2]);
check('chartRows worst-first by total', buildFinanceGaps_(twoMgrs, 7).chartRows.map(r => r.supervisor), ['Alice', 'Bob']);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/finance-stf-gaps.test.js`
Expected: FAIL — prints `FAIL: FINANCE-PURE block not found in GDash.html` and exits 1 (the marked block doesn't exist yet).

- [ ] **Step 3: Add the FINANCE-PURE block to `GDash.html`**

Insert this block immediately **before** the line `// ── VIEWS — single source of truth for navigation ─────────────────` (currently line 918):

```javascript
// ── FINANCE-PURE-BEGIN ──
// Pure, DOM-free STF-gap classification + grouping. Unit-tested by
// tests/finance-stf-gaps.test.js (eval'd out of this marked region in Node).
// STF bars mirror goalCompliance.js CONFIG_GD (STF_MIN_COMPLETED / STF_MIN_CMT_GOALS);
// duplicated here as local consts so the block evals standalone. If the server
// thresholds change, update these two to match.
var STF_COMPLETED_BAR_ = 8;
var STF_CMT_GOALS_BAR_  = 6;

// Classify WHY a Rocketeer is STF-ineligible. Reads only numeric goal fields.
// Returns null when the person IS eligible (caller filters those out).
// Primary reason precedence (first match wins; exhaustive over completed<8):
//   comments → completed >= bar, so only the comment bar fails
//   pending  → completed < bar and open goals (in-progress+planned) can still reach the bar
//   canceled → completed < bar, pending can't close the gap, and goals were canceled/not-completed
//   toofew   → catch-all: completed < bar, pending can't close the gap, nothing was lost
function classifyStfReason_(e) {
  var completed     = +e.stfGoalsCompleted || 0;
  var wellCommented = +e.stfGoalsWithSufficientComments || 0;
  var pending       = (+e.goalsInProgress || 0) + (+e.goalsPlanned || 0);
  var lost          = (+e.goalsCanceled || 0) + (+e.goalsNotCompleted || 0);
  var totalGoals    = +e.totalGoals || 0;
  var gap           = STF_COMPLETED_BAR_ - completed;

  var eligible = completed >= STF_COMPLETED_BAR_ && wellCommented >= STF_CMT_GOALS_BAR_;
  if (eligible) return null;

  var primary;
  if (completed >= STF_COMPLETED_BAR_) primary = 'comments';
  else if (pending >= gap)             primary = 'pending';
  else if (lost > 0)                   primary = 'canceled';
  else                                 primary = 'toofew';

  var badges = [];
  if (pending > 0) badges.push({ kind: 'pending',  text: '⏳ ' + pending + ' pending' });
  if (lost > 0)    badges.push({ kind: 'canceled', text: '✖ ' + lost + ' canceled/not-completed' });
  if (completed >= STF_COMPLETED_BAR_ && wellCommented < STF_CMT_GOALS_BAR_) {
    badges.push({ kind: 'comments', text: '🗨 needs comments (' + wellCommented + '/' + STF_CMT_GOALS_BAR_ + ')' });
  }
  if (primary === 'toofew') {
    badges.push({ kind: 'toofew', text: '▽ only ' + totalGoals + ' goals logged' });
  }

  return {
    primary: primary, badges: badges,
    completed: completed, wellCommented: wellCommented,
    pending: pending, lost: lost, gap: gap, totalGoals: totalGoals,
  };
}

// Sort a {supervisor: [rows]} map into [{supervisor, rocketeers, count}], managers
// worst-first (most ineligible), rocketeers within a group furthest-from-bar first.
function groupByMgrSorted_(byMgr) {
  return Object.keys(byMgr).map(function(sup) {
    var rocks = byMgr[sup].slice().sort(function(a, b) {
      return (a.completed - b.completed) || a.name.localeCompare(b.name);
    });
    return { supervisor: sup, rocketeers: rocks, count: rocks.length };
  }).sort(function(a, b) {
    return (b.count - a.count) || a.supervisor.localeCompare(b.supervisor);
  });
}

// Build the Finance view model from already-filtered employees.
// threshold = max completed goals to include in the "under-bar" list (0..7);
// null defaults to bar-1 (7). New hires / on-leave are excluded (already outside
// STF math upstream). The comments-shortfall section ignores the threshold.
function buildFinanceGaps_(emps, threshold) {
  var t = (threshold == null) ? (STF_COMPLETED_BAR_ - 1) : +threshold;
  var totals = { pending: 0, canceled: 0, comments: 0, toofew: 0, ineligible: 0, evaluated: 0, hidden: 0 };
  var underByMgr = {}, commentByMgr = {}, mgrTally = {};

  (emps || []).forEach(function(e) {
    if (e.isNewHire || e.onLeave) return;
    totals.evaluated++;
    var c = classifyStfReason_(e);
    if (!c) return; // eligible
    var sup = e.supervisor || '(No Supervisor)';
    var row = {
      name: e.name, normName: e.normName, supervisor: sup, department: e.department || '',
      completed: c.completed, wellCommented: c.wellCommented, pending: c.pending,
      lost: c.lost, totalGoals: c.totalGoals, primary: c.primary, badges: c.badges,
    };

    var displayed = false;
    if (c.primary === 'comments') {
      (commentByMgr[sup] = commentByMgr[sup] || []).push(row);
      displayed = true;
    } else if (c.completed <= t) {
      (underByMgr[sup] = underByMgr[sup] || []).push(row);
      displayed = true;
    } else {
      totals.hidden++; // below the bar but above the threshold → hidden from the list
    }

    if (displayed) {
      totals[c.primary]++;
      totals.ineligible++;
      var mt = mgrTally[sup] || (mgrTally[sup] = { supervisor: sup, pending: 0, canceled: 0, comments: 0, toofew: 0, total: 0 });
      mt[c.primary]++;
      mt.total++;
    }
  });

  var chartRows = Object.keys(mgrTally).map(function(s) { return mgrTally[s]; })
    .sort(function(a, b) { return (b.total - a.total) || a.supervisor.localeCompare(b.supervisor); });

  return {
    underBar: groupByMgrSorted_(underByMgr),
    commentsShortfall: groupByMgrSorted_(commentByMgr),
    chartRows: chartRows,
    totals: totals,
    threshold: t,
  };
}
// ── FINANCE-PURE-END ──
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/finance-stf-gaps.test.js`
Expected: PASS — final line `18 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add "GDash.html" "tests/finance-stf-gaps.test.js"
git commit -m "feat(gdash): STF-gap classification + grouping (pure, tested)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Tab wiring + pane markup

**Files:**
- Modify: `GDash.html` — `VIEWS` (~line 930), tab-bar buttons (~line 422), `renderTab` (~line 1208), new pane after `pane-hrtracker` (~line 736)

- [ ] **Step 1: Add the `finance` entry to `VIEWS`**

In the `VIEWS` array, add this line immediately after the `hrtracker` entry:

```javascript
  { id: 'finance',   label: '💰 STF Gaps (Finance)',  location: 'tabbar', roles: ['admin'] },
```

- [ ] **Step 2: Add the tab-bar button**

After the REX Tracker button (currently line 422, `data-tab="hrtracker"`), add:

```html
    <button class="tab-btn"        onclick="switchTab('finance')"   data-tab="finance">💰 STF Gaps</button>
```

- [ ] **Step 3: Add the `renderTab` dispatch case**

In `renderTab(tabId)`, add this branch (e.g. after the `hrtracker` case):

```javascript
  else if (tabId === 'finance')   renderFinance();
```

- [ ] **Step 4: Add the pane markup**

Immediately after the `pane-hrtracker` closing `</div>` (currently line 736, before the Data Reference comment on line 738), insert:

```html
    <!-- ── STF GAPS (Finance; admin-only via VIEWS roles) ──
         Spec: docs/superpowers/specs/2026-07-13-finance-stf-gaps-design.md -->
    <div id="pane-finance" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>💰 STF Gaps (Finance)</h2>
            <p class="section-sub">STF-ineligible Rocketeers · new hires &amp; on-leave excluded · respects the filter bar · click a row for goal detail</p></div>
          <div class="section-actions">
            <button class="btn" onclick="exportFinanceCsv_()">⬇ CSV</button>
          </div>
        </div>
        <div class="section-body">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <label for="finance-threshold" style="font-size:12px;font-weight:700;color:var(--text)">Max completed goals to show:</label>
            <input type="range" min="0" max="7" step="1" value="7" id="finance-threshold" oninput="setFinanceThreshold_(this.value)" style="vertical-align:middle">
            <span id="finance-threshold-val" style="font-size:12px;font-weight:800;color:var(--orbe);min-width:14px">7</span>
          </div>
          <div id="finance-summary" style="display:flex;align-items:center;flex-wrap:wrap;margin-bottom:16px"></div>
          <div id="finance-chart"></div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>Under the completion bar</h2>
            <p class="section-sub">Completed ≤ threshold · grouped by manager (worst first)</p></div>
        </div>
        <div class="section-body" id="finance-under"></div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>Comments shortfall</h2>
            <p class="section-sub">8+ completed but fewer than 6 carry 8+ comments · independent of the threshold</p></div>
        </div>
        <div class="section-body" id="finance-comments"></div>
      </div>
    </div>
```

- [ ] **Step 5: Verify wiring loads without JS errors**

This step has no automated test (markup + dispatch). Verification happens in Task 5's manual QA once the renderers exist. For now, confirm the JSON/JS is syntactically intact:

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('GDash.html','utf8');const m=s.match(/var VIEWS = \[([\s\S]*?)\];/);if(!m){console.error('VIEWS not found');process.exit(1)};if(!/id: 'finance'/.test(m[1])){console.error('finance VIEWS entry missing');process.exit(1)};console.log('OK: finance in VIEWS')"`
Expected: `OK: finance in VIEWS`

- [ ] **Step 6: Commit**

```bash
git add "GDash.html"
git commit -m "feat(gdash): Finance STF-Gaps tab wiring + pane markup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Render layer — summary, chart, tables, threshold

**Files:**
- Modify: `GDash.html` — add renderers near the other `render*` functions (e.g. after `renderManagerScorecard_`/`exportEngagementCSV_`, ~line 1925); add one delegated click handler beside the existing delegated listeners (~line 961).

- [ ] **Step 1: Add the render functions**

Insert this block after `exportEngagementCSV_` (ends ~line 1925), before the `// ── BREAKDOWN ──` comment:

```javascript
// ── STF GAPS (Finance; admin-only) ────────────────────────────────
// Reason → colour/label map, single source for the chart, summary strip, and
// row badges so all three always agree. Colours are STATUS_C hexes.
var FIN_REASONS_ = [
  { key: 'pending',  label: 'Pending closure',          color: STATUS_C.watch },   // amber
  { key: 'canceled', label: 'Canceled / Not-completed', color: STATUS_C.risk },    // red
  { key: 'comments', label: 'Comments shortfall',       color: STATUS_C.info },    // blue
  { key: 'toofew',   label: 'Too few goals',            color: STATUS_C.planned }, // slate
];

function renderFinance() {
  var emps  = getFiltered();
  var thr   = (S.financeThreshold == null) ? (STF_COMPLETED_BAR_ - 1) : S.financeThreshold;
  var model = buildFinanceGaps_(emps, thr);
  S._financeModel = model; // consumed by exportFinanceCsv_

  var t    = model.totals;
  var strip = document.getElementById('finance-summary');
  if (strip) {
    strip.innerHTML =
      finStat_('⏳ Pending', t.pending, STATUS_C.watch) +
      finStat_('✖ Canceled/NC', t.canceled, STATUS_C.risk) +
      finStat_('🗨 Comments', t.comments, STATUS_C.info) +
      finStat_('▽ Too few', t.toofew, STATUS_C.planned) +
      '<span style="margin-left:auto;font-size:12px;color:var(--muted);align-self:center">' +
        t.ineligible + ' ineligible shown of ' + t.evaluated + ' evaluated' +
        (t.hidden > 0 ? ' · ' + t.hidden + ' more below the bar hidden by threshold' : '') +
      '</span>';
  }

  renderFinanceChart_(model.chartRows);
  renderFinanceSection_(document.getElementById('finance-under'), model.underBar, 'under');
  renderFinanceSection_(document.getElementById('finance-comments'), model.commentsShortfall, 'comments');
}

function finStat_(label, n, color) {
  return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text);margin-right:16px">' +
    '<span style="width:10px;height:10px;border-radius:2px;background:' + color + ';display:inline-block"></span>' +
    esc(label) + ' <span style="color:' + color + '">' + n + '</span></span>';
}

// One horizontal stacked bar per manager, absolute-scaled to the worst manager so
// the longest bar = most ineligible. Click a bar → scrolls to that manager's group.
function renderFinanceChart_(chartRows) {
  var el = document.getElementById('finance-chart');
  if (!el) return;
  if (!chartRows || !chartRows.length) {
    el.innerHTML = '<div class="empty-state">🎉 <p>No STF-ineligible Rocketeers in the current selection.</p></div>';
    return;
  }
  var maxTotal = chartRows.reduce(function(mx, r) { return Math.max(mx, r.total); }, 0) || 1;
  var html = '<div style="display:flex;flex-direction:column;gap:8px">';
  chartRows.forEach(function(r) {
    html += '<div style="display:flex;align-items:center;gap:8px;cursor:pointer" data-fin-mgr="' + esc(r.supervisor) + '" title="Jump to ' + esc(r.supervisor) + '&#8217;s group">';
    html += '<span style="flex:0 0 150px;font-size:11px;font-weight:700;color:var(--text);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.supervisor) + '</span>';
    html += '<span style="flex:1;display:flex;height:16px;border-radius:4px;overflow:hidden;background:var(--border)">';
    FIN_REASONS_.forEach(function(seg) {
      var n = r[seg.key] || 0;
      if (n <= 0) return;
      var w = (n / maxTotal * 100).toFixed(2);
      html += '<span style="width:' + w + '%;background:' + seg.color + '" title="' + esc(seg.label) + ': ' + n + '"></span>';
    });
    html += '</span>';
    html += '<span style="flex:0 0 24px;font-size:11px;font-weight:800;color:var(--text)">' + r.total + '</span>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;font-size:10px;color:var(--muted)">';
  FIN_REASONS_.forEach(function(seg) {
    html += '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:' + seg.color + ';display:inline-block"></span>' + esc(seg.label) + '</span>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// Render a manager-grouped section. mode 'under' shows Completed/Pending/Canceled;
// mode 'comments' shows Completed/Well-commented. Rows carry data-normname so the
// shared delegated tr[data-normname] listener opens the individual drill-down.
function renderFinanceSection_(container, groups, mode) {
  if (!container) return;
  if (!groups || !groups.length) {
    container.innerHTML = '<div class="empty-state">✓ <p>None in the current selection.</p></div>';
    return;
  }
  var html = '';
  groups.forEach(function(g) {
    html += '<div class="fin-mgr-group" data-fin-group="' + esc(g.supervisor) + '" style="margin-bottom:16px">';
    html += '<div style="font-size:12px;font-weight:800;color:var(--text);margin:6px 0">' + esc(g.supervisor) +
            ' <span style="color:var(--muted);font-weight:600">(' + g.count + ')</span></div>';
    html += '<div class="tbl-wrap"><table class="data-table" style="font-size:12px"><thead><tr>';
    if (mode === 'under') {
      html += '<th>Rocketeer</th><th style="text-align:center">Completed</th><th style="text-align:center">Pending</th><th style="text-align:center">Canceled/NC</th><th>Reason signal(s)</th>';
    } else {
      html += '<th>Rocketeer</th><th style="text-align:center">Completed</th><th style="text-align:center">Well-commented</th><th>Reason signal</th>';
    }
    html += '</tr></thead><tbody>';
    g.rocketeers.forEach(function(r) {
      html += '<tr style="cursor:pointer" data-normname="' + esc(r.normName || '') + '" title="View ' + esc(r.name) + '&#8217;s goals →">';
      html += '<td style="font-weight:600;white-space:nowrap">' + esc(r.name) + '</td>';
      if (mode === 'under') {
        html += '<td style="text-align:center">' + r.completed + ' / ' + STF_COMPLETED_BAR_ + '</td>';
        html += '<td style="text-align:center">' + r.pending + '</td>';
        html += '<td style="text-align:center">' + r.lost + '</td>';
      } else {
        html += '<td style="text-align:center">' + r.completed + ' / ' + STF_COMPLETED_BAR_ + '</td>';
        html += '<td style="text-align:center">' + r.wellCommented + ' / ' + STF_CMT_GOALS_BAR_ + '</td>';
      }
      html += '<td>' + finBadges_(r.badges) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  });
  container.innerHTML = html;
}

function finBadges_(badges) {
  if (!badges || !badges.length) return '&mdash;';
  return badges.map(function(b) {
    var seg = FIN_REASONS_.filter(function(x) { return x.key === b.kind; })[0];
    var c = (seg && seg.color) || 'var(--slate)';
    return '<span style="display:inline-block;background:#fff;color:' + c + ';border:1px solid ' + c +
      ';border-radius:3px;padding:1px 6px;font-size:10px;font-weight:700;margin-right:4px;white-space:nowrap">' + esc(b.text) + '</span>';
  }).join('');
}

function setFinanceThreshold_(v) {
  S.financeThreshold = +v;
  var lbl = document.getElementById('finance-threshold-val');
  if (lbl) lbl.textContent = S.financeThreshold;
  renderFinance();
}
```

- [ ] **Step 2: Add the delegated chart-bar click handler**

Inside `document.addEventListener('DOMContentLoaded', ...)`, beside the existing delegated listeners (the block around line 961 that adds `document.addEventListener('click', ...)` for `tr[data-normname]`), add another delegated listener:

```javascript
  // Finance chart: click a manager's bar → scroll to that manager's group below.
  document.addEventListener('click', function(e) {
    var bar = e.target.closest('[data-fin-mgr]');
    if (!bar) return;
    var name = bar.getAttribute('data-fin-mgr') || '';
    var sel = '.fin-mgr-group[data-fin-group="' + ((window.CSS && CSS.escape) ? CSS.escape(name) : name) + '"]';
    var grp = document.querySelector(sel);
    if (grp) grp.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
```

- [ ] **Step 3: Re-run the pure test (guard against accidental block edits)**

Run: `node tests/finance-stf-gaps.test.js`
Expected: PASS — `18 passed, 0 failed` (the render code lives outside the pure block, so the test must still pass unchanged).

- [ ] **Step 4: Commit**

```bash
git add "GDash.html"
git commit -m "feat(gdash): Finance STF-Gaps renderers — chart, tables, threshold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: CSV export

**Files:**
- Modify: `GDash.html` — add `exportFinanceCsv_` beside the other renderers (after `setFinanceThreshold_`)

- [ ] **Step 1: Add the export function**

Insert after `setFinanceThreshold_`:

```javascript
// Export the currently-displayed STF gaps (respects filter + threshold) to CSV.
// Mirrors the exportEngagementCSV_ pattern (BOM + quoted fields).
function exportFinanceCsv_() {
  var model = S._financeModel;
  if (!model) return;
  var REASON_LABEL = {
    pending: 'Pending closure', canceled: 'Canceled/Not-completed',
    comments: 'Comments shortfall', toofew: 'Too few goals',
  };
  var rows = [['Manager', 'Rocketeer', 'Department', 'Completed', 'Pending',
               'Canceled/NotCompleted', 'Well-commented', 'Primary reason', 'All reasons']];
  function emit(groups) {
    (groups || []).forEach(function(gr) {
      gr.rocketeers.forEach(function(r) {
        rows.push([gr.supervisor, r.name, r.department, r.completed, r.pending, r.lost,
          r.wellCommented, REASON_LABEL[r.primary] || r.primary,
          r.badges.map(function(b) { return b.text; }).join('; ')]);
      });
    });
  }
  emit(model.underBar);
  emit(model.commentsShortfall);

  var csv = rows.map(function(r) {
    return r.map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csv);
  a.download = 'stf-gaps-' + ((S.data && S.data.quarter) || 'export') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

- [ ] **Step 2: Re-run the pure test**

Run: `node tests/finance-stf-gaps.test.js`
Expected: PASS — `18 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add "GDash.html"
git commit -m "feat(gdash): Finance STF-Gaps CSV export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Manual QA + self-review

**Files:** none (verification only). GDash is a GAS web app; render behaviour can only be exercised in a deployed/preview context.

- [ ] **Step 1: Static sanity checks**

Run all three and confirm each prints OK / passes:
```bash
node tests/finance-stf-gaps.test.js
node -e "const fs=require('fs');const s=fs.readFileSync('GDash.html','utf8');['id=\"pane-finance\"','renderFinance()','exportFinanceCsv_','data-fin-mgr','FINANCE-PURE-BEGIN','FINANCE-PURE-END'].forEach(k=>{if(s.indexOf(k)<0){console.error('MISSING: '+k);process.exit(1)}});console.log('OK: all finance anchors present')"
```
Expected: pure test `18 passed, 0 failed`; second command `OK: all finance anchors present`.

- [ ] **Step 2: Manual QA checklist (in a GAS preview/deploy as an admin)**

Verify:
1. The **💰 STF Gaps** tab is visible when logged in as an admin, and **hidden** for a viewer/manager account (role gating).
2. Slider default is **7**; the label mirrors the slider value as you drag.
3. Lowering the threshold shrinks the "Under the completion bar" list and shows the "N more below the bar hidden by threshold" note; the **Comments shortfall** section is unaffected.
4. Chart bar counts == summary-strip counts == sum of table rows (excluding threshold-hidden).
5. Clicking a manager's chart bar scrolls to that manager's group.
6. Clicking any Rocketeer row opens the existing individual goal drill-down.
7. **⬇ CSV** downloads a file whose rows match the on-screen tables (respecting filter + threshold).
8. Changing the top filter bar re-scopes the view (switch tabs and back, or confirm it reflects the active filter).
9. Empty state shows when the filter yields no ineligible Rocketeers.

- [ ] **Step 3: Spec self-review**

Re-read `docs/superpowers/specs/2026-07-13-finance-stf-gaps-design.md` and confirm each section maps to shipped behaviour: reason taxonomy (4 reasons, precedence), layout order, threshold semantics, worst-first sorting, drill reuse, CSV columns, exclusions. Note any deviations in the commit message or a follow-up.

- [ ] **Step 4: Deploy note (owner action, not code)**

Record in the PR/commit body: **Deploy = `GDash.html` only. No `goalCompliance.js` change, no cache/`gd_v` bump.** The tab appears immediately for admins on next load (frontend-only). Update the memory index entry per project convention after live QA.

---

## Self-Review (plan vs spec)

- **Spec coverage:** admin-only tab (T2 VIEWS `roles:['admin']`); frontend-only/no cache bump (noted in T5.4, no `goalCompliance.js` in any task); 4-reason taxonomy + precedence + factual badges (T1 `classifyStfReason_`); population/exclusions (T1 `buildFinanceGaps_`); slider 0–7 default 7 filtering only under-bar (T2 markup + T3 `setFinanceThreshold_`/`renderFinance`); comments-shortfall threshold-independent (T1 branch order); stacked bar per manager worst-first (T3 `renderFinanceChart_` + T1 `chartRows`); within-group furthest-behind first (T1 `groupByMgrSorted_`); drill reuse via `data-normname` (T3 rows); CSV columns exactly as spec (T4); summary=chart=table single-source (T1 totals only count displayed rows + `hidden`); testing fixtures incl. fixed orphan case (T1 test). All covered.
- **Placeholder scan:** none — every code step contains full code; every run step has an exact command + expected output.
- **Type/name consistency:** `STF_COMPLETED_BAR_`/`STF_CMT_GOALS_BAR_`, `classifyStfReason_`, `groupByMgrSorted_`, `buildFinanceGaps_` (returns `underBar`/`commentsShortfall`/`chartRows`/`totals`/`threshold`), `FIN_REASONS_`, `renderFinance`, `renderFinanceChart_`, `renderFinanceSection_`, `finBadges_`, `finStat_`, `setFinanceThreshold_`, `exportFinanceCsv_`, `S.financeThreshold`, `S._financeModel`, `data-fin-mgr`/`data-fin-group` — all used consistently across tasks and match the test's expectations (`primary`, `badges[].kind`, `underBar.length`, `totals.hidden`, `chartRows[].supervisor`).
