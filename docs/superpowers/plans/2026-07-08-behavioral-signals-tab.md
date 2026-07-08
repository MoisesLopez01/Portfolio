# Behavioral Signals / Leadership Behaviors Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager/admin-only "Behaviors" tab to GDash that reads existing goal-compliance signals as evidence of the Rocketeer Leadership Behaviors, plus the three backend rollups it needs.

**Architecture:** Backend (`goalCompliance.js`) gains per-goal feedback-loop date tracking inside the existing `aggregateByRocketeer_` loop and three per-employee rollups; the payload passes whole employee objects so no serialization changes. Frontend (`GDash.html`) adds a `VIEWS` entry (role-gated by existing `canSeeView_`), a pane of five `section-card`s, and a `renderBehaviors(emps)` that computes every meter client-side from the filtered employee list (reusing `computeEngagementClient_`).

**Tech Stack:** Google Apps Script (V8, ES5-style), vanilla JS/HTML in HtmlService, Node for backend tests (`eval` the file with a stubbed `Logger`).

**Spec:** `docs/superpowers/specs/2026-07-08-behavioral-signals-leadership-behaviors-design.md`

---

### Task 1: Backend — feedback-loop tracking + closed-no-note rollup (TDD)

**Files:**
- Modify: `goalCompliance.js` (goal init ~L1073, comment loop ~L1098, finalize ~L1150, zero-goal injection ~L815, CACHE_VER L63, header L7-20)

**Key subtlety:** RD rows are in sheet order, not date order — a reply row can precede the manager-comment row. So track per-goal `firstMgrCmtDate` (min) and `lastSelfCmtDate` (max), and decide "loop closed" in the finalize pass (`lastSelf >= firstMgr` ⇔ "some self-comment on/after the first manager comment"). Undated comments never set either date.

- [ ] **Step 1: Write the failing test** — append after `_test_isNewHire_` (~L2037):

```js
function _test_feedbackLoop_() {
  var t = function(cond, msg) { if (!cond) throw new Error('❌ _test_feedbackLoop_: ' + msg); };
  // Rows deliberately OUT of date order — the sheet gives no ordering guarantee.
  var row_ = function(goalId, status, commentator, date, extra) {
    var r = {
      'Rocketeer': 'Ana Reyes', 'Supervisor': 'Max Boss', 'Department': 'Services',
      'Class': 'FTE', 'Job Title': 'Consultant', 'Fiscal Quarter': 'FY27Q1',
      'Goal ID': goalId, 'Goal Name': 'G' + goalId, 'Goal Status': status,
      'Start Date': '2026-07-02', 'Mood': '',
      'Comment Text': commentator ? 'note' : '', 'Commentator': commentator || '',
      'Comment Date': date || '',
    };
    for (var k in (extra || {})) r[k] = extra[k];
    return r;
  };
  var rows = [
    // g1: reply row appears BEFORE the manager row → still closed
    row_('g1', 'In Progress', 'Ana Reyes', '2026-07-10'),
    row_('g1', 'In Progress', 'Max Boss',  '2026-07-08'),
    // g2: same-day reply counts as closed
    row_('g2', 'In Progress', 'Max Boss',  '2026-07-09'),
    row_('g2', 'In Progress', 'Ana Reyes', '2026-07-09'),
    // g3: self-comment only BEFORE the manager comment → open loop
    row_('g3', 'In Progress', 'Ana Reyes', '2026-07-05'),
    row_('g3', 'In Progress', 'Max Boss',  '2026-07-07'),
    // g4: UNDATED manager comment → excluded from the feedback denominator
    row_('g4', 'In Progress', 'Max Boss',  ''),
    // g5: no manager comments at all → not in denominator
    row_('g5', 'In Progress', 'Ana Reyes', '2026-07-06'),
    // g6: Canceled with zero comments → closed-no-note
    row_('g6', 'Canceled', ''),
    // g7: Not Completed WITH a note → NOT closed-no-note
    row_('g7', 'Not Completed', 'Ana Reyes', '2026-07-11'),
  ];
  var emp = aggregateByRocketeer_(rows, null, 'FY27Q1')[normName_('Ana Reyes')];
  t(emp.goalsWithMgrFeedback === 3, 'g1,g2,g3 have dated mgr feedback, got ' + emp.goalsWithMgrFeedback);
  t(emp.goalsFeedbackClosed === 2,  'g1 (out-of-order) + g2 (same-day) closed, got ' + emp.goalsFeedbackClosed);
  t(emp.goalsClosedNoNote === 1,    'only g6 is closed-no-note, got ' + emp.goalsClosedNoNote);
  Logger.log('✅ _test_feedbackLoop_ passed');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_feedbackLoop_()"`
Expected: FAIL — `goalsWithMgrFeedback` is `undefined`.

- [ ] **Step 3: Implement.** Four edits:

(a) Goal init (~L1073) — add two date trackers:

```js
        selfComments:    0,
        managerComments: 0,
        totalComments:   0,
        lastCommentDate: '',
        firstMgrCmtDate: '',   // earliest DATED manager comment (feedback-loop anchor)
        lastSelfCmtDate: '',   // latest DATED self comment (loop closes when >= firstMgrCmtDate)
```

(b) Comment loop — inside `if (cNorm === norm)` after the `_weeklySelf` update:

```js
        if (cDate) {
          var sds = fmtDate_(cDate);
          if (sds && (!g.lastSelfCmtDate || sds > g.lastSelfCmtDate)) g.lastSelfCmtDate = sds;
        }
```

and inside `else if (sup && cNorm === sup)` after the `_weeklyMgr` update:

```js
        if (cDate) {
          var mds = fmtDate_(cDate);
          if (mds && (!g.firstMgrCmtDate || mds < g.firstMgrCmtDate)) g.firstMgrCmtDate = mds;
        }
```

(c) Finalize (after the `goalsStuckInPlanned` block, ~L1153):

```js
    // Think Team feedback loop — goals with a dated manager comment, and whether a
    // self-comment landed on/after the FIRST one. max(self) >= min(mgr) is the
    // order-independent form: sheet rows carry no date ordering guarantee.
    var mgrFbGoals = goalArr.filter(function(g) { return !!g.firstMgrCmtDate; });
    emp.goalsWithMgrFeedback = mgrFbGoals.length;
    emp.goalsFeedbackClosed  = mgrFbGoals.filter(function(g) {
      return g.lastSelfCmtDate && g.lastSelfCmtDate >= g.firstMgrCmtDate;
    }).length;
    // Build Process — Not Completed / Canceled goals that carry no note at all
    emp.goalsClosedNoNote = goalArr.filter(function(g) {
      return (/not.?complet/i.test(g.status) || /cancel/i.test(g.status)) && g.totalComments === 0;
    }).length;
```

(d) Zero-goal roster injection (~L824) — add defaults alongside `goalsStuckInPlanned: 0`:

```js
      goalsStuckInPlanned: 0, hasEngagementConcern: false,
      goalsWithMgrFeedback: 0, goalsFeedbackClosed: 0, goalsClosedNoNote: 0,
```

- [ ] **Step 4: Version bumps.** Header comment: add `v2.6.0: Behaviors tab payload — per-goal feedback-loop dates → goalsWithMgrFeedback/goalsFeedbackClosed + goalsClosedNoNote rollups.` and set `VERSION: 2.6.0`. Change L63 to `CACHE_VER: 'gd_v17_',  // bumped: employee records add feedback-loop + closed-no-note rollups (Behaviors tab)`.

- [ ] **Step 5: Run new test + full backend suite**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_feedbackLoop_(); _test_isNewHire_(); _test_computeRpiScore_(); _test_prevQuarterLabel_(); _test_quarterWeekList_(); _test_weeklySeries_(); _test_managerExceptions_(); _test_aggregateAllRocketeers_(); _test_isIntern_(); _test_stripInterns_(); _test_resolveGDManagerScope_()"`
Expected: all ✅ lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): v2.6.0 backend — feedback-loop + closed-no-note rollups for Behaviors tab"
```

---

### Task 2: Frontend — VIEWS entry, tab button, pane markup, dispatch, CSS

**Files:**
- Modify: `GDash.html` (VIEWS ~L668, tab bar ~L358, pane insert before `pane-hrtracker` comment ~L551, `renderTab` ~L913, CSS before `/* Individual drill-down` ~L194)

- [ ] **Step 1: VIEWS entry** — insert between `trends` and `hrtracker`:

```js
  { id: 'behaviors', label: 'Behaviors',             location: 'tabbar', roles: ['admin','manager'] },
```

- [ ] **Step 2: Tab button** — insert between the Trends and REX Tracker buttons:

```html
    <button class="tab-btn"        onclick="switchTab('behaviors')" data-tab="behaviors">Behaviors</button>
```

- [ ] **Step 3: CSS** — add before the `/* Individual drill-down` comment block:

```css
/* ── Behaviors tab — meter cards. Growth framing: Orbe fill (progress), never
   the at-risk red; verdict lines are counts-only, names live in <details>. */
.bh-quote{font-style:italic;color:var(--slate);font-size:12px;margin:2px 0 10px}
.bh-meter{height:14px;border-radius:7px;background:var(--surface);border:1px solid var(--border);overflow:hidden;margin:4px 0 6px}
.bh-fill{height:100%;border-radius:7px;background:var(--orbe);transition:width .4s}
.bh-verdict{font-size:12px;font-weight:600;color:var(--void)}
.bh-secondary{font-size:11px;color:var(--slate);margin-top:2px}
.bh-detail{margin-top:10px}
.bh-detail summary{cursor:pointer;font-size:11px;font-weight:700;color:var(--orbe)}
.bh-v2note{font-size:11px;color:var(--slate);background:var(--surface);border:1px dashed var(--border);border-radius:6px;padding:8px 10px;margin-top:8px}
```

- [ ] **Step 4: Pane markup** — insert immediately before the `<!-- ── REX TRACKER` comment. Card headers are static (behavior name linked to its source post + verbatim mindset quote); `section-body` divs are filled by `renderBehaviors`:

```html
    <!-- ── BEHAVIORS (Leadership Behaviors signals; admin+manager only via VIEWS roles) ──
         Spec: docs/superpowers/specs/2026-07-08-behavioral-signals-leadership-behaviors-design.md
         Framing rules: verdict lines show counts only; names only inside <details> rows;
         growth-oriented labels — never "failing"/"non-compliant" on this tab. -->
    <div id="pane-behaviors" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>🧠 <a href="https://leadershipbehaviors.org/p/rocketeer-leadership-behavior-1-team" target="_blank" rel="noopener" style="color:inherit">Share the Knowledge</a></h2>
            <p class="section-sub">Self-comment cadence on own goals · new hires excluded · respects the filter bar</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'behavior-share-knowledge.png')">⬇ PNG</button>
        </div>
        <div class="section-body">
          <p class="bh-quote">“I ask questions first and actively share experiences and lessons learned”</p>
          <div id="behavior-share"></div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>🌱 <a href="https://leadershipbehaviors.org/p/rocketeer-leadership-behavior-2-develops" target="_blank" rel="noopener" style="color:inherit">Develops Rocketeers</a> · <a href="https://leadershipbehaviors.org/p/rocketeer-leadership-behavior-9-proactive" target="_blank" rel="noopener" style="color:inherit">Proactive &amp; Responsive</a></h2>
            <p class="section-sub">Manager comments on team goals · excepted managers excluded · respects the filter bar</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'behavior-develops-rocketeers.png')">⬇ PNG</button>
        </div>
        <div class="section-body">
          <p class="bh-quote">“Provides appropriate feedback focused on professional growth” · “Master of cadence and repeatability”</p>
          <div id="behavior-develops"></div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>⚙️ <a href="https://leadershipbehaviors.org/p/rocketeer-leadership-behaviors-welcome" target="_blank" rel="noopener" style="color:inherit">Build Process to Drive Outcomes</a></h2>
            <p class="section-sub">Goals moving through status — not parked in Planned, closed goals carry a note · respects the filter bar</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'behavior-build-process.png')">⬇ PNG</button>
        </div>
        <div class="section-body">
          <p class="bh-quote">“I reflect, iterate and continually improve processes through documentation that is shareable and easily accessible”</p>
          <div id="behavior-process"></div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>🤝 <a href="https://leadershipbehaviors.org/p/rocketeer-leadership-behavior-1-team" target="_blank" rel="noopener" style="color:inherit">Think Team</a></h2>
            <p class="section-sub">Feedback loops closed after manager comments + thresholds met · respects the filter bar</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'behavior-think-team.png')">⬇ PNG</button>
        </div>
        <div class="section-body">
          <p class="bh-quote">“I hold myself accountable and am open to delivering and receiving feedback”</p>
          <div id="behavior-thinkteam"></div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>🗣️ <a href="https://leadershipbehaviors.org/p/rocketeer-leadership-behaviors-welcome" target="_blank" rel="noopener" style="color:inherit">Talk Straight</a></h2>
            <p class="section-sub">Clarity and quality of the goals set</p></div>
        </div>
        <div class="section-body">
          <p class="bh-quote">“I set clear expectations with transparency and always walk the talk”</p>
          <div id="behavior-talkstraight"></div>
        </div>
      </div>
    </div>

```

- [ ] **Step 5: Dispatch** — in `renderTab`, after the `support` line:

```js
  else if (tabId === 'behaviors') renderBehaviors(emps);
```

- [ ] **Step 6: Parse-check the script block** (frontend has no harness):

Run: `node -e "var h=require('fs').readFileSync('GDash.html','utf8');var m=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';');new Function(m);console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 7: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Behaviors tab shell — VIEWS role gate, pane markup, meter CSS"
```

---

### Task 3: Frontend — renderBehaviors()

**Files:**
- Modify: `GDash.html` — new function after `renderSupport`'s helpers (place it just before the `// ── ENGAGEMENT COMPUTATION HELPERS` comment, after `computeEngagementClient_`)

Definitions locked by the spec:
- **Eligible pool:** `totalGoals > 0 && !isNewHire` (new hires get the 🌱 treatment everywhere else; behaviors need a full quarter).
- **Share the Knowledge:** at pace = `commentWeeks >= required`, `required = Math.max(1, Math.floor(weeksElapsed/2))` (comment-WEEKS form of the existing pace threshold, per spec).
- **Develops Rocketeers:** active manager = non-excepted scorecard row with `covered > 0`; secondary = % of eligible rocketeers with any manager comment.
- **Build Process:** moving = `1 - (Σstuck + ΣclosedNoNote) / Σgoals`.
- **Think Team:** primary = `ΣgoalsFeedbackClosed / ΣgoalsWithMgrFeedback`; secondary = % On Target.
- Person rows carry `data-normname` so the existing delegated click handler gives the individual drill for free.

- [ ] **Step 1: Implement**

```js
// ── BEHAVIORS TAB ─────────────────────────────────────────────────
// Leadership Behaviors read of existing signals (spec 2026-07-08). Framing
// rules: verdict lines are counts-only; names appear only inside <details>;
// labels stay growth-oriented ("building this habit", never "failing").
function bhMeter_(pct, verdict, secondary) {
  var w = Math.max(0, Math.min(100, pct || 0));
  return '<div class="bh-meter"><div class="bh-fill" style="width:' + w.toFixed(1) + '%"></div></div>' +
         '<div class="bh-verdict">' + verdict + '</div>' +
         (secondary ? '<div class="bh-secondary">' + secondary + '</div>' : '');
}

function bhDetail_(summary, rows) {
  if (!rows.length) return '';
  var html = '<details class="bh-detail"><summary>' + summary + '</summary>' +
             '<table class="data-table" style="margin-top:8px"><tbody>';
  rows.forEach(function(r) {
    html += '<tr data-normname="' + esc(r.normName || '') + '"><td>' + esc(r.name) + '</td>' +
            '<td style="color:var(--slate)">' + r.note + '</td></tr>';
  });
  return html + '</tbody></table></details>';
}

function renderBehaviors(emps) {
  var eng      = computeEngagementClient_(emps);
  var eligible = emps.filter(function(e) { return e.totalGoals > 0 && !e.isNewHire; });
  var n        = eligible.length || 1;

  // 1 — Share the Knowledge: self-comment cadence (comment-weeks vs pace)
  var required = Math.max(1, Math.floor((eng.weeksElapsed || 1) / 2));
  var atPace   = eligible.filter(function(e) { return (e.commentWeeks || 0) >= required; });
  var building = eligible.filter(function(e) { return (e.commentWeeks || 0) <  required; })
    .sort(function(a, b) { return (a.commentWeeks || 0) - (b.commentWeeks || 0); });
  document.getElementById('behavior-share').innerHTML =
    bhMeter_(atPace.length / n * 100,
      atPace.length + ' of ' + eligible.length + ' rocketeers commenting on their goals at pace (' + required + '+ weeks with a self-comment)',
      'Pace = self-comments in at least half the ' + (eng.weeksElapsed || 1) + ' weeks elapsed this quarter') +
    bhDetail_(building.length + ' rocketeer' + (building.length === 1 ? '' : 's') + ' building this habit',
      building.map(function(e) {
        return { name: e.name, normName: e.normName,
                 note: (e.commentWeeks || 0) + ' of ' + required + ' comment-weeks so far' };
      }));

  // 2 — Develops Rocketeers · Proactive & Responsive: manager feedback coverage
  var mgrs       = eng.managerScorecard.filter(function(m) { return !m.isExcepted; });
  var activeMgrs = mgrs.filter(function(m) { return m.covered > 0; });
  var reached    = eligible.filter(function(e) { return (e.totalManagerComments || 0) > 0; }).length;
  document.getElementById('behavior-develops').innerHTML =
    bhMeter_(mgrs.length ? activeMgrs.length / mgrs.length * 100 : 0,
      activeMgrs.length + ' of ' + mgrs.length + ' managers commented on at least one direct’s goal this quarter',
      reached + ' of ' + eligible.length + ' rocketeers (' + (reached / n * 100).toFixed(0) + '%) received manager feedback') +
    bhDetail_(mgrs.length + ' manager' + (mgrs.length === 1 ? '' : 's') + ' — feedback coverage',
      mgrs.map(function(m) {
        return { name: m.name, normName: m.normName,
                 note: m.covered + ' of ' + m.teamSize + ' directs reached · avg ' + m.avgCmts + ' comments' };
      }));

  // 3 — Build Process: goals moving through status
  var tGoals = 0, tStuck = 0, tNoNote = 0;
  eligible.forEach(function(e) {
    tGoals  += e.totalGoals || 0;
    tStuck  += e.goalsStuckInPlanned || 0;
    tNoNote += e.goalsClosedNoNote || 0;
  });
  var moving  = Math.max(0, tGoals - tStuck - tNoNote);
  var revisit = eligible.filter(function(e) {
    return (e.goalsStuckInPlanned || 0) > 0 || (e.goalsClosedNoNote || 0) > 0;
  }).sort(function(a, b) {
    return ((b.goalsStuckInPlanned||0) + (b.goalsClosedNoNote||0)) - ((a.goalsStuckInPlanned||0) + (a.goalsClosedNoNote||0));
  });
  document.getElementById('behavior-process').innerHTML =
    bhMeter_(tGoals ? moving / tGoals * 100 : 0,
      moving + ' of ' + tGoals + ' goals moving — started (or discussed) and closed with a note',
      tStuck + ' parked in Planned with no comments · ' + tNoNote + ' Not Completed/Canceled without a note') +
    bhDetail_(revisit.length + ' rocketeer' + (revisit.length === 1 ? '' : 's') + ' with goals to revisit',
      revisit.map(function(e) {
        var bits = [];
        if (e.goalsStuckInPlanned) bits.push(e.goalsStuckInPlanned + ' parked in Planned');
        if (e.goalsClosedNoNote)   bits.push(e.goalsClosedNoNote + ' closed without a note');
        return { name: e.name, normName: e.normName, note: bits.join(' · ') };
      }));

  // 4 — Think Team: feedback loops closed + thresholds
  var tFb = 0, tClosed = 0;
  eligible.forEach(function(e) {
    tFb     += e.goalsWithMgrFeedback || 0;
    tClosed += e.goalsFeedbackClosed  || 0;
  });
  var onTarget = eligible.filter(function(e) { return e.complianceStatus === 'On Target'; }).length;
  var awaiting = eligible.filter(function(e) {
    return (e.goalsWithMgrFeedback || 0) > (e.goalsFeedbackClosed || 0);
  }).sort(function(a, b) {
    return ((b.goalsWithMgrFeedback||0) - (b.goalsFeedbackClosed||0)) - ((a.goalsWithMgrFeedback||0) - (a.goalsFeedbackClosed||0));
  });
  document.getElementById('behavior-thinkteam').innerHTML =
    (tFb === 0
      ? '<div class="bh-verdict">No manager feedback yet this quarter — loops start once managers comment.</div>'
      : bhMeter_(tClosed / tFb * 100,
          tClosed + ' of ' + tFb + ' manager-feedback loops closed — the rocketeer replied on that goal',
          onTarget + ' of ' + eligible.length + ' rocketeers (' + (onTarget / n * 100).toFixed(0) + '%) On Target for goal thresholds')) +
    bhDetail_(awaiting.length + ' rocketeer' + (awaiting.length === 1 ? '' : 's') + ' with feedback waiting for a reply',
      awaiting.map(function(e) {
        var open = (e.goalsWithMgrFeedback || 0) - (e.goalsFeedbackClosed || 0);
        return { name: e.name, normName: e.normName,
                 note: open + ' goal' + (open === 1 ? '' : 's') + ' with unanswered manager feedback' };
      }));

  // 5 — Talk Straight: defined, measured in v2 (only Goal Name text exists today)
  document.getElementById('behavior-talkstraight').innerHTML =
    '<div class="bh-v2note">Measurement arrives with goal-quality data (v2). Clarity is never a put-down — ' +
    'when this meter lands it will read goal quality, not judge people.</div>';
}
```

- [ ] **Step 2: Parse-check** — same command as Task 2 Step 6. Expected: `parse OK`.

- [ ] **Step 3: Logic smoke test in Node** — exercise `renderBehaviors` against stubbed DOM/state:

```bash
node -e "
var h=require('fs').readFileSync('GDash.html','utf8');
var js=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';\n');
// stub browser/env
global.document={addEventListener:function(){},getElementById:function(id){var el={innerHTML:'',style:{},textContent:''};(global._els=global._els||{})[id]=el;return el;},querySelectorAll:function(){return[]}};
global.window=global; global.Chart=function(){}; Chart.register=function(){}; global.ChartDataLabels={}; global.html2canvas=function(){};
eval(js);
S.data={weeksElapsedSinceStart:8,managerExceptions:[],employees:[]};
var emp=function(o){var b={name:'',normName:'',department:'D',supervisor:'Max Boss',jobTitle:'C',location:'X',jobFamily:'F',complianceStatus:'At Risk',totalGoals:10,totalSelfComments:5,totalManagerComments:2,commentWeeks:5,goalsStuckInPlanned:0,goalsClosedNoNote:0,goalsWithMgrFeedback:2,goalsFeedbackClosed:1,isNewHire:false};for(var k in o)b[k]=o[k];return b;};
S.data.employees=[emp({name:'Ana Reyes',normName:'ana reyes',complianceStatus:'On Target'}),emp({name:'Bo Li',normName:'bo li',commentWeeks:1,goalsStuckInPlanned:2}),emp({name:'New Kid',normName:'new kid',isNewHire:true})];
renderBehaviors(S.data.employees);
['behavior-share','behavior-develops','behavior-process','behavior-thinkteam','behavior-talkstraight'].forEach(function(id){if(!global._els[id]||!global._els[id].innerHTML)throw new Error(id+' empty');});
if(!/1 of 2 rocketeers commenting/.test(global._els['behavior-share'].innerHTML))throw new Error('share meter wrong: '+global._els['behavior-share'].innerHTML.slice(0,200));
if(/New Kid/.test(JSON.stringify(global._els)))throw new Error('new hire leaked into behaviors');
console.log('renderBehaviors smoke OK');
"
```

Expected: `renderBehaviors smoke OK` (required = max(1, floor(8/2)) = 4; Ana 5 weeks at pace, Bo 1 week building, New Kid excluded).

- [ ] **Step 4: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): renderBehaviors — five Leadership Behaviors meter cards"
```

---

### Task 4: Verification sweep + docs

- [ ] **Step 1: Full backend suite** (Task 1 Step 5 command) — all ✅.
- [ ] **Step 2: Parse check** (Task 2 Step 6 command) — `parse OK`.
- [ ] **Step 3: Role-gate check** — confirm `switchTab('behaviors')` falls back to `overview` for viewers: covered by existing `canSeeView_` (roles array present); verify by reading the VIEWS entry, no new code path.
- [ ] **Step 4: Update memory + note deployment steps** — live QA needs: copy both files into the GAS project, new deployment, verify tab hidden for a viewer account, PNG export of each card.

**Deliberately out of scope (per spec):** Talk Straight measurement, CSV export, Trends history for behavior meters, any RPI/STF change.
