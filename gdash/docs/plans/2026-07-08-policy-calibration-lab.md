# Policy Calibration Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin-only "Policy Lab" in GDash to interactively calibrate the comment-cadence policy against full-fiscal-year history, with cohort heatmap, behavior flags (back-loaded, bare-minimum), and standard deviation.

**Architecture:** Backend (`goalCompliance.js`) adds a compact per-goal self-comment array to the history lite blocks, **admin-scope only**, so the client can recompute compliance at any candidate policy across prior quarters. Frontend (`GDash.html`) adds a ☰-menu tab whose `renderPolicyLab()` computes everything client-side from `S.data.history` + the current-quarter records (which already carry `goalsList`/`weeklySelf`).

**Tech Stack:** Google Apps Script (V8, ES5-style), vanilla JS/HTML in HtmlService, Chart.js (already loaded), Node for pure-helper tests (`eval` with stubbed `Logger`/DOM).

**Spec:** `gdash/docs/specs/2026-07-08-policy-calibration-lab-design.md`

---

### Task 1: Backend — per-goal self-comment array on admin history blocks (TDD)

**Files:**
- Modify: `goalCompliance.js` — new helper `goalSelfArray_` (near `computeRpiScore_`), `liteEmp_` (~L1076), history build call (~L1090), `CACHE_VER` (L84), header (L7-20)

**Why a helper:** `liteEmp_` is a closure and hard to unit-test directly. Extract the pure transform (`emp → array of self-comment counts on non-canceled goals`) into `goalSelfArray_(emp)` and test that.

- [ ] **Step 1: Write the failing test** — append after `_test_feedbackLoop_`:

```js
function _test_goalSelfArray_() {
  var t = function(cond, msg) { if (!cond) throw new Error('❌ _test_goalSelfArray_: ' + msg); };
  var emp = { goalsList: [
    { id:'g1', status:'In Progress',  self: 3 },
    { id:'g2', status:'Completed',    self: 0 },
    { id:'g3', status:'Canceled',     self: 5 },   // excluded (canceled)
    { id:'g4', status:'Not Completed',self: 1 },
  ]};
  var arr = goalSelfArray_(emp);
  t(arr.length === 3, 'canceled goal excluded → 3 entries, got ' + arr.length);
  t(arr.join(',') === '3,0,1', 'self counts in order, canceled dropped, got ' + arr.join(','));
  t(goalSelfArray_({}).length === 0, 'no goalsList → empty array');
  Logger.log('✅ _test_goalSelfArray_ passed');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); _test_goalSelfArray_()"`
Expected: FAIL — `goalSelfArray_ is not defined`.

- [ ] **Step 3: Implement the helper** — add just above `function computeRpiScore_(`:

```js
// Compact per-goal self-comment counts on non-canceled goals — the minimum the
// Policy Lab client needs to recompute cadence compliance at any candidate
// threshold. Canceled goals are excluded, matching computeRpiScore_'s cadence rule.
function goalSelfArray_(emp) {
  return (emp.goalsList || [])
    .filter(function(g) { return !/cancel/i.test(g.status); })
    .map(function(g) { return g.self || 0; });
}
```

- [ ] **Step 4: Attach it to admin history blocks.** Change `liteEmp_` to accept an `isAdmin` flag and conditionally include `goalSelf`. Replace the `liteEmp_` definition (~L1076-1088):

```js
  var isAdmin_ = !!(access && access.role === 'admin');
  var liteEmp_ = function(emp) {
    var lite = {
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
    // Admin-only: the Policy Lab needs per-goal self counts to recompute cadence
    // compliance historically. Kept off non-admin payloads to stay lean.
    if (isAdmin_) lite.goalSelf = goalSelfArray_(emp);
    return lite;
  };
```

(The history `.map(liteEmp_)` call at ~L1101 is unchanged — it already passes each emp.)

- [ ] **Step 5: Version bumps.** Header: add `//              v2.8.0: admin-only per-goal self-comment array on history blocks (Policy Lab).` and set `VERSION` to `2.8.0`. Change `CACHE_VER` (L84) to:

```js
  CACHE_VER:           'gd_v20_',  // bumped: admin history blocks add per-goal goalSelf[] (Policy Lab); v19 added paceMetrics/paceBand
```

- [ ] **Step 6: Run new test + full backend suite**

Run:
```bash
node -e "global.Logger={log:console.log}; eval(require('fs').readFileSync('goalCompliance.js','utf8')); ['_test_goalSelfArray_','_test_feedbackLoop_','_test_isNewHire_','_test_computeRpiScore_','_test_computePaceMetrics_','_test_paceBand_','_test_percentile_','_test_quarterCalendarWeeks_','_test_contractorRecord_','_test_prevQuarterLabel_','_test_quarterWeekList_','_test_weeklySeries_','_test_managerExceptions_','_test_aggregateAllRocketeers_','_test_isIntern_','_test_stripInterns_','_test_resolveGDManagerScope_','_test_normEmpNum_','_test_numOrNaN_','_test_computeQuarterFlags_','_test_ptoSpread_'].forEach(function(t){ if(global[t]) eval(t+'()'); })"
```
Expected: every present test prints ✅, exit 0.

- [ ] **Step 7: Commit**

```bash
git add goalCompliance.js
git commit -m "feat(gdash): v2.8.0 — admin-only per-goal goalSelf[] on history blocks (Policy Lab); CACHE_VER gd_v20_"
```

---

### Task 2: Frontend — Policy Lab pure helpers (TDD via Node extract)

**Files:**
- Modify: `GDash.html` — add helpers just above `// ── ENGAGEMENT COMPUTATION HELPERS`

All five helpers are pure (no DOM/state) so they can be extracted and tested in Node.

- [ ] **Step 1: Implement the helpers**

```js
// ── POLICY LAB — pure helpers (unit-tested in Node) ────────────────
// Bucket edges — client constants, easily retuned (spec §2D heatmap).
var BC_GOALS = [ {lab:'0',max:0}, {lab:'1–4',max:4}, {lab:'5–7',max:7}, {lab:'8–9',max:9}, {lab:'10+',max:Infinity} ];
var BC_CMTS  = [ {lab:'0',max:0}, {lab:'1–9',max:9}, {lab:'10–29',max:29}, {lab:'30+',max:Infinity} ];

function bucketOf_(value, edges) {
  for (var i = 0; i < edges.length; i++) if (value <= edges[i].max) return edges[i].lab;
  return edges[edges.length - 1].lab;
}

// Population standard deviation of a numeric array (0 for <2 values).
function stdDev_(vals) {
  if (!vals || vals.length < 2) return 0;
  var m = vals.reduce(function(s, v) { return s + v; }, 0) / vals.length;
  var v = vals.reduce(function(s, x) { return s + (x - m) * (x - m); }, 0) / vals.length;
  return Math.sqrt(v);
}

// Does this person meet the candidate cadence policy?
// goalSelf = per-goal self-comment counts (canceled already excluded).
// required = clamp(weekOfQuarter − lag, minCmts, cap); need `needGoals` goals at/above it.
function compliesAtPolicy_(goalSelf, weekOfQuarter, lag, minCmts, cap, needGoals) {
  if (!goalSelf || !goalSelf.length) return false;
  var required = Math.min(Math.max(minCmts, (weekOfQuarter || 1) - lag), cap);
  var qualifying = goalSelf.filter(function(s) { return s >= required; }).length;
  return qualifying >= needGoals;
}

// Back-loaded: >= pct of total self-comments fall in the final `tailWeeks` of the
// quarter. weeklySelf = {ISO week -> count}; weeks = ordered quarter week labels.
function isBackloaded_(weeklySelf, weeks, tailWeeks, pct) {
  if (!weeks || !weeks.length) return false;
  var total = 0, tail = 0;
  var tailSet = {};
  weeks.slice(Math.max(0, weeks.length - tailWeeks)).forEach(function(w) { tailSet[w] = true; });
  weeks.forEach(function(w) {
    var c = (weeklySelf && weeklySelf[w]) || 0;
    total += c; if (tailSet[w]) tail += c;
  });
  if (total === 0) return false;              // no comments → not "crammed", just absent
  return (tail / total) >= pct;
}

// Bare-minimum: of goals that got ANY self-comment, share with exactly 1.
function bareMinShare_(goalSelf) {
  var commented = (goalSelf || []).filter(function(s) { return s > 0; });
  if (!commented.length) return 0;
  var ones = commented.filter(function(s) { return s === 1; }).length;
  return ones / commented.length;
}
```

- [ ] **Step 2: Write + run the Node test harness**

```bash
node -e "
var h=require('fs').readFileSync('GDash.html','utf8');
var js=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';\n');
global.document={addEventListener:function(){},getElementById:function(){return{innerHTML:'',style:{},textContent:''}},querySelectorAll:function(){return[]}};
global.window=global; global.Chart=function(){}; Chart.register=function(){}; global.ChartDataLabels={}; global.html2canvas=function(){};
eval(js);
var t=function(c,m){if(!c)throw new Error('FAIL: '+m)};
// bucketOf_
t(bucketOf_(0,BC_GOALS)==='0','goals 0'); t(bucketOf_(4,BC_GOALS)==='1–4','goals 4');
t(bucketOf_(9,BC_GOALS)==='8–9','goals 9'); t(bucketOf_(10,BC_GOALS)==='10+','goals 10');
t(bucketOf_(30,BC_CMTS)==='30+','cmts 30');
// stdDev_
t(stdDev_([2,4,4,4,5,5,7,9]).toFixed(1)==='2.0','stdDev known set');
t(stdDev_([5])===0,'stdDev single=0');
// compliesAtPolicy_: week 10, lag 4 → required=min(max(1,6),8)=6; need 2 goals >=6
t(compliesAtPolicy_([6,7,1],10,4,1,8,2)===true,'complies: 2 goals >=6');
t(compliesAtPolicy_([6,1,1],10,4,1,8,2)===false,'not: only 1 goal >=6');
t(compliesAtPolicy_([1,1],3,4,1,8,1)===true,'early quarter floor=1');
// isBackloaded_: all in last 3 of 12 weeks
var wk=[]; for(var i=1;i<=12;i++)wk.push('W'+i);
t(isBackloaded_({'W11':3,'W12':2},wk,3,0.5)===true,'all-late backloaded');
t(isBackloaded_({'W1':3,'W2':2},wk,3,0.5)===false,'all-early not backloaded');
t(isBackloaded_({},wk,3,0.5)===false,'no comments not backloaded');
// bareMinShare_
t(bareMinShare_([1,1,3,0])===(2/3),'2 of 3 commented goals have exactly 1');
t(bareMinShare_([0,0])===0,'no commented goals → 0');
console.log('policy-lab helpers OK');
"
```
Expected: `policy-lab helpers OK`.

- [ ] **Step 3: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Policy Lab pure helpers — bucketOf_/stdDev_/compliesAtPolicy_/isBackloaded_/bareMinShare_"
```

---

### Task 3: Frontend — tab shell (VIEWS entry, pane, dispatch, CSS)

**Files:**
- Modify: `GDash.html` — VIEWS (~L793), pane markup (after `pane-access`), `renderTab` (~L1087), CSS (near `.bh-*` block)

- [ ] **Step 1: VIEWS entry** — add after the `access` entry:

```js
  { id: 'policylab', label: '🧪 Policy Lab',        location: 'menu',   roles: ['admin'] },
```

- [ ] **Step 2: Pane markup** — insert after the `pane-access` closing `</div>` (before REX/next pane). Controls + result containers only; JS fills them:

```html
    <!-- ── POLICY LAB (super-admin only, ☰ menu) — spec 2026-07-08-policy-calibration-lab ── -->
    <div id="pane-policylab" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>🧪 Policy Calibration Lab</h2><p class="section-sub">Tune the comment-cadence policy against full-fiscal-year history · admin only</p></div>
          <button class="btn" onclick="switchTab(S.lastRegularTab || 'overview')">← Back to Dashboard</button>
        </div>
        <div class="section-body">
          <div class="pl-controls" id="pl-controls">
            <label>Cadence LAG (week−N) <input type="range" id="pl-lag" min="0" max="10" value="4" oninput="onPolicyChange_()"><span id="pl-lag-v">4</span></label>
            <label>Goals needing cadence <input type="range" id="pl-need" min="1" max="10" value="6" oninput="onPolicyChange_()"><span id="pl-need-v">6</span> of 10</label>
            <label>Min comments/goal <input type="range" id="pl-min" min="1" max="4" value="1" oninput="onPolicyChange_()"><span id="pl-min-v">1</span></label>
            <label>Back-load threshold <input type="range" id="pl-bl" min="30" max="80" step="5" value="50" oninput="onPolicyChange_()"><span id="pl-bl-v">50</span>% in final 3 wks</label>
          </div>
        </div>
      </div>
      <div class="section-card">
        <div class="section-head"><div><h2>Compliance across the fiscal year</h2><p class="section-sub">% meeting the tuned policy · completed quarters + current (in progress)</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'policy-fy-compliance.png')">⬇ PNG</button></div>
        <div class="section-body" id="pl-headline"></div>
      </div>
      <div class="section-card">
        <div class="section-head">
          <div><h2>Cohort heatmap</h2><p class="section-sub">Goals × comments · cell color = % compliant · click a cell for the people</p></div>
          <div class="section-actions">
            <select id="pl-scope" onchange="onPolicyChange_()"></select>
            <select id="pl-dim" onchange="onPolicyChange_()"><option value="rocketeer">By Rocketeer</option><option value="manager">By Manager</option></select>
            <button class="btn" onclick="exportPNG(this.closest('.section-card'),'policy-cohorts.png')">⬇ PNG</button>
          </div>
        </div>
        <div class="section-body"><div id="pl-heatmap"></div><div id="pl-drill"></div></div>
      </div>
      <div class="section-card">
        <div class="section-head"><div><h2>Behaviors &amp; spread</h2><p class="section-sub">Of those compliant on count: back-loaded and bare-minimum · σ of comments per goal</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'policy-behaviors.png')">⬇ PNG</button></div>
        <div class="section-body" id="pl-behaviors"></div>
      </div>
    </div>
```

- [ ] **Step 3: Dispatch** — in `renderTab`, after the `access` line:

```js
  else if (tabId === 'policylab') renderPolicyLab();
```

- [ ] **Step 4: CSS** — add near the `.bh-*` block:

```css
/* ── Policy Lab ── */
.pl-controls{display:flex;flex-wrap:wrap;gap:18px;align-items:center}
.pl-controls label{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:var(--void)}
.pl-controls input[type=range]{accent-color:var(--orbe)}
.pl-hm{border-collapse:collapse;font-size:11px}
.pl-hm th{padding:6px 9px;font-weight:800;color:var(--slate);text-transform:uppercase;font-size:9px}
.pl-hm td{padding:0;text-align:center}
.pl-cell{display:block;padding:9px 12px;border:1px solid var(--border);cursor:pointer;color:var(--void);font-weight:700}
.pl-cell small{display:block;font-weight:600;color:var(--slate);font-size:9px}
.pl-fy-row{display:flex;gap:10px;flex-wrap:wrap}
.pl-fy-chip{border:1px solid var(--border);border-radius:8px;padding:10px 14px;min-width:120px}
.pl-fy-chip b{font-size:20px;color:var(--orbe)} .pl-fy-chip.inprog b{color:var(--slate)}
```

- [ ] **Step 5: Parse-check + commit**

```bash
node -e "var h=require('fs').readFileSync('GDash.html','utf8');var m=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';');new Function(m);console.log('parse OK')"
git add GDash.html
git commit -m "feat(gdash): Policy Lab tab shell — VIEWS menu entry, controls + result panes, CSS"
```
Expected: `parse OK`.

---

### Task 4: Frontend — renderPolicyLab() and its render helpers

**Files:**
- Modify: `GDash.html` — add after the pure helpers from Task 2

Data model: each quarter contributes a list of `{normName, name, supervisor, goalSelf, weeklySelf, weeks, weekOfQuarter, totalGoals}`. Current quarter is built from `S.data.employees` (`goalsList`→goalSelf via the same filter, `weeklySelf`, `trendWeeks`, `weeksElapsedSinceStart`); prior quarters come from `S.data.history` blocks (which now carry `goalSelf` for admins).

- [ ] **Step 1: Implement**

```js
// Build the unified per-quarter record set from history (prior) + current quarter.
function policyQuarters_() {
  var out = [];
  (S.data.history || []).forEach(function(h) {
    out.push({
      quarter: h.quarter, weeks: h.weeks || [], inProgress: false,
      weekOfQuarter: (h.weeks || []).length,   // completed → full length
      people: (h.employees || []).map(function(e) {
        return { normName:e.normName, name:e.name, supervisor:e.supervisor||'',
                 goalSelf:e.goalSelf||[], weeklySelf:e.weeklySelf||{}, totalGoals:e.totalGoals||0 };
      }),
    });
  });
  // Current quarter from full records
  var curWeeks = (S.data.trendWeeks || []);
  out.push({
    quarter: S.data.quarter, weeks: curWeeks, inProgress: true,
    weekOfQuarter: S.data.weeksElapsedSinceStart || curWeeks.length,
    people: (S.data.employees || []).map(function(e) {
      return { normName:e.normName, name:e.name, supervisor:e.supervisor||'',
               goalSelf:(e.goalsList||[]).filter(function(g){return !/cancel/i.test(g.status)}).map(function(g){return g.self||0}),
               weeklySelf:e.weeklySelf||{}, totalGoals:e.totalGoals||0 };
    }),
  });
  return out;
}

function policySettings_() {
  return {
    lag:      +document.getElementById('pl-lag').value,
    need:     +document.getElementById('pl-need').value,
    min:      +document.getElementById('pl-min').value,
    blPct:    (+document.getElementById('pl-bl').value) / 100,
    cap:      8,           // mirrors CONFIG_GD.RPI_CADENCE_MAX_CMTS
    tailWeeks:3,
  };
}

// Per-person evaluation at the current settings for one quarter record.
function evalPerson_(p, q, s) {
  var complies = compliesAtPolicy_(p.goalSelf, q.weekOfQuarter, s.lag, s.min, s.cap, s.need);
  return {
    normName:p.normName, name:p.name, supervisor:p.supervisor,
    goals:p.totalGoals, cmts:p.goalSelf.reduce(function(a,b){return a+b;},0),
    complies:complies,
    backloaded: complies && isBackloaded_(p.weeklySelf, q.weeks, s.tailWeeks, s.blPct),
    bareShare:  bareMinShare_(p.goalSelf),
    avgPerGoal: p.goalSelf.length ? p.goalSelf.reduce(function(a,b){return a+b;},0)/p.goalSelf.length : 0,
  };
}

function onPolicyChange_() {
  ['lag','need','min','bl'].forEach(function(k){ var v=document.getElementById('pl-'+k); if(v) document.getElementById('pl-'+k+'-v').textContent=v.value; });
  renderPolicyLab();
}

function renderPolicyLab() {
  if (!S.data) return;
  var qs = policyQuarters_(), s = policySettings_();

  // Scope selector: completed quarters + pooled + current
  var scopeSel = document.getElementById('pl-scope');
  if (scopeSel && !scopeSel.dataset.built) {
    var opts = qs.filter(function(q){return !q.inProgress;}).map(function(q){return '<option value="'+q.quarter+'">'+q.quarter+'</option>';});
    opts.unshift('<option value="__pooled">Full FY (pooled)</option>');
    // default to most recent completed quarter if present, else pooled
    scopeSel.innerHTML = opts.join('');
    var completed = qs.filter(function(q){return !q.inProgress;});
    scopeSel.value = completed.length ? completed[completed.length-1].quarter : '__pooled';
    scopeSel.dataset.built = '1';
  }

  // 1 — FY headline (all quarters, always)
  var headline = qs.map(function(q) {
    var evals = q.people.map(function(p){ return evalPerson_(p, q, s); });
    var elig  = evals.filter(function(e){ return e.goals > 0; });
    var comp  = elig.filter(function(e){ return e.complies; }).length;
    return { quarter:q.quarter, inProgress:q.inProgress, n:elig.length, comp:comp,
             pct: elig.length ? Math.round(comp/elig.length*100) : 0 };
  });
  document.getElementById('pl-headline').innerHTML = '<div class="pl-fy-row">' + headline.map(function(r){
    return '<div class="pl-fy-chip'+(r.inProgress?' inprog':'')+'"><div style="font-size:10px;font-weight:800;color:var(--slate)">'+esc(r.quarter)+(r.inProgress?' · in progress':'')+'</div><b>'+r.pct+'%</b><div style="font-size:10px;color:var(--slate)">'+r.comp+' / '+r.n+' compliant</div></div>';
  }).join('') + '</div>';

  // Selected scope → the evaluated population for heatmap/behaviors
  var scope = scopeSel ? scopeSel.value : '__pooled';
  var pool = [];
  qs.filter(function(q){return !q.inProgress;}).forEach(function(q){
    if (scope === '__pooled' || scope === q.quarter) q.people.forEach(function(p){ pool.push(evalPerson_(p,q,s)); });
  });
  var dim = document.getElementById('pl-dim').value;

  renderPolicyHeatmap_(pool, dim, s);
  renderPolicyBehaviors_(pool, dim);
}

// Build the goals×comments grid. In manager mode, aggregate to one row per
// supervisor (median compliance) before bucketing by team-size / team-comments.
function renderPolicyHeatmap_(pool, dim, s) {
  var units;
  if (dim === 'manager') {
    var byMgr = {};
    pool.forEach(function(e){ var k=e.supervisor||'(none)'; (byMgr[k]=byMgr[k]||[]).push(e); });
    units = Object.keys(byMgr).map(function(k){
      var team=byMgr[k]; var comp=team.filter(function(e){return e.complies;}).length;
      return { name:k, normName:'', goals:team.length,
               cmts:team.reduce(function(a,e){return a+e.cmts;},0),
               complies:(comp/team.length)>=0.5, _team:team };
    });
  } else {
    units = pool.filter(function(e){ return e.goals > 0; });
  }
  var grid = {};
  units.forEach(function(u){
    var gk=bucketOf_(u.goals,BC_GOALS), ck=bucketOf_(u.cmts,BC_CMTS), key=gk+'|'+ck;
    (grid[key]=grid[key]||{n:0,comp:0,units:[]}); grid[key].n++; if(u.complies)grid[key].comp++; grid[key].units.push(u);
  });
  var html='<div class="tbl-wrap"><table class="pl-hm"><thead><tr><th></th>'+BC_CMTS.map(function(c){return '<th>'+c.lab+'</th>';}).join('')+'</tr></thead><tbody>';
  // top-heavy: 10+ first
  BC_GOALS.slice().reverse().forEach(function(gb){
    html+='<tr><th>'+gb.lab+'</th>';
    BC_CMTS.forEach(function(cb){
      var cell=grid[gb.lab+'|'+cb.lab];
      if(!cell){ html+='<td><span class="pl-cell" style="background:var(--surface);color:var(--muted)">—</span></td>'; return; }
      var pct=Math.round(cell.comp/cell.n*100);
      var bg='rgba(5,140,220,'+(0.12+0.6*pct/100).toFixed(2)+')';  // Orbe intensity ramp
      html+='<td><span class="pl-cell" style="background:'+bg+'" data-pl-cell="'+esc(gb.lab+'|'+cb.lab)+'">'+cell.n+'<small>'+pct+'% ok</small></span></td>';
    });
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  document.getElementById('pl-heatmap').innerHTML=html;
  document.getElementById('pl-drill').innerHTML='';
  PL_GRID_=grid; PL_DIM_=dim;   // module refs for the click handler
}

var PL_GRID_=null, PL_DIM_='rocketeer';
function renderPolicyDrill_(key) {
  var cell=PL_GRID_&&PL_GRID_[key]; if(!cell)return;
  var rows=cell.units.slice().sort(function(a,b){return b.cmts-a.cmts;}).map(function(u){
    return '<tr><td>'+esc(u.name)+'</td><td style="text-align:center">'+u.goals+'</td><td style="text-align:center">'+u.cmts+'</td><td style="text-align:center">'+(u.complies?'✓':'—')+'</td></tr>';
  }).join('');
  document.getElementById('pl-drill').innerHTML='<table class="data-table" style="margin-top:10px"><thead><tr><th>'+(PL_DIM_==='manager'?'Manager (team)':'Rocketeer')+'</th><th>'+(PL_DIM_==='manager'?'Team size':'Goals')+'</th><th>Comments</th><th>OK</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function renderPolicyBehaviors_(pool, dim) {
  var elig = pool.filter(function(e){ return e.goals > 0; });
  var compliant = elig.filter(function(e){ return e.complies; });
  var bl = compliant.filter(function(e){ return e.backloaded; }).length;
  var bm = compliant.filter(function(e){ return e.bareShare >= 0.5; }).length;
  var sd = stdDev_(elig.map(function(e){ return e.avgPerGoal; }));
  var mean = elig.length ? (elig.reduce(function(a,e){return a+e.avgPerGoal;},0)/elig.length) : 0;
  document.getElementById('pl-behaviors').innerHTML =
    '<div class="pl-fy-row">' +
    '<div class="pl-fy-chip"><div style="font-size:10px;font-weight:800;color:var(--slate)">COMPLIANT ON COUNT</div><b>'+compliant.length+'</b><div style="font-size:10px;color:var(--slate)">of '+elig.length+'</div></div>' +
    '<div class="pl-fy-chip"><div style="font-size:10px;font-weight:800;color:var(--slate)">BACK-LOADED</div><b>'+bl+'</b><div style="font-size:10px;color:var(--slate)">'+(compliant.length?Math.round(bl/compliant.length*100):0)+'% of compliant · final 3 wks</div></div>' +
    '<div class="pl-fy-chip"><div style="font-size:10px;font-weight:800;color:var(--slate)">BARE-MINIMUM</div><b>'+bm+'</b><div style="font-size:10px;color:var(--slate)">'+(compliant.length?Math.round(bm/compliant.length*100):0)+'% · mostly 1/goal</div></div>' +
    '<div class="pl-fy-chip"><div style="font-size:10px;font-weight:800;color:var(--slate)">CMTS / GOAL</div><b>'+mean.toFixed(1)+'</b><div style="font-size:10px;color:var(--slate)">σ '+sd.toFixed(1)+'</div></div>' +
    '</div>';
}
```

- [ ] **Step 2: Wire the heatmap-cell click** into the existing delegated click handler (in `DOMContentLoaded`, alongside the `data-del-ts` check). Add first:

```js
    var plCell = e.target.closest('[data-pl-cell]');
    if (plCell) { renderPolicyDrill_(plCell.dataset.plCell); return; }
```

- [ ] **Step 3: Parse-check + stubbed-DOM smoke**

```bash
node -e "var h=require('fs').readFileSync('GDash.html','utf8');var m=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';');new Function(m);console.log('parse OK')"
```

Then a render smoke test (stub `getElementById` to capture innerHTML, feed a 2-quarter `S.data`):

```bash
node -e "
var h=require('fs').readFileSync('GDash.html','utf8');
var js=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';\n');
var els={}; function el(id){return els[id]||(els[id]={innerHTML:'',style:{},dataset:{},value:(id==='pl-lag'?'4':id==='pl-need'?'6':id==='pl-min'?'1':id==='pl-bl'?'50':''),textContent:''});}
global.document={addEventListener:function(){},getElementById:el,querySelectorAll:function(){return[]}};
global.window=global; global.Chart=function(){}; Chart.register=function(){}; global.ChartDataLabels={}; global.html2canvas=function(){};
eval(js);
var wk=[]; for(var i=1;i<=12;i++)wk.push('W'+i);
S.data={quarter:'FY27Q1',trendWeeks:wk,weeksElapsedSinceStart:12,
  employees:[{normName:'a',name:'A',supervisor:'M',goalsList:[{status:'In Progress',self:6},{status:'In Progress',self:7}],weeklySelf:{'W1':6,'W2':7},totalGoals:2}],
  history:[{quarter:'FY26Q4',weeks:wk,employees:[
    {normName:'a',name:'A',supervisor:'M',goalSelf:[6,7,1],weeklySelf:{'W11':7,'W12':7},totalGoals:3},
    {normName:'b',name:'B',supervisor:'M',goalSelf:[1,1],weeklySelf:{'W2':2},totalGoals:2}]}]};
renderPolicyLab();
['pl-headline','pl-heatmap','pl-behaviors'].forEach(function(id){ if(!els[id]||!els[id].innerHTML) throw new Error(id+' empty'); });
if(!/FY26Q4/.test(els['pl-headline'].innerHTML)) throw new Error('missing prior quarter in headline');
if(!/σ/.test(els['pl-behaviors'].innerHTML)) throw new Error('missing sigma');
console.log('renderPolicyLab smoke OK');
"
```
Expected: `parse OK` then `renderPolicyLab smoke OK`.

- [ ] **Step 4: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): renderPolicyLab — FY compliance, cohort heatmap, behavior flags, sigma"
```

---

### Task 5: Verification sweep + memory

- [ ] **Step 1** — full backend suite (Task 1 Step 6 command): all ✅.
- [ ] **Step 2** — helper test (Task 2 Step 2) + render smoke (Task 4 Step 3): all pass.
- [ ] **Step 3** — parse-check `parse OK`.
- [ ] **Step 4** — update `project_goals_compliance_dashboard.md` memory: v2.8.0 / gd_v20_, admin-only goalSelf history, Policy Lab tab, pure helpers + tests. Note deploy: copy both files, new deployment version; Lab is ☰-menu, admin only.

**Deliberately out of scope (per spec):** stakeholder preset buttons, CSV export, writing CONFIG from the UI, changes to live RPI/STF or other tabs.
