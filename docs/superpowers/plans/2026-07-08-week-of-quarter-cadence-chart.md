# Week-of-Quarter Cadence Combo Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a week-of-quarter combo chart to the admin-only Policy Lab overlaying the most recent 4 fiscal quarters (% of each quarter's comments per week-of-quarter) with a 4-quarter-average bar and a shaded grace band, to expose end-of-quarter comment back-loading to non-technical managers.

**Architecture:** Pure frontend in `GDash.html`. A pure helper `weekOfQuarterPct_` converts a quarter's `weeklySelf`+`weeks` into a per-week-of-quarter percentage series; `renderCadenceChart_()` builds the Chart.js combo from the most recent 4 quarters via the existing `policyQuarters_()`. Called at the end of `renderPolicyLab()`.

**Tech Stack:** vanilla JS in HtmlService, Chart.js (loaded), Node for the pure-helper test + stubbed-DOM smoke.

**Spec:** `docs/superpowers/specs/2026-07-08-week-of-quarter-cadence-chart-design.md`

---

### Task 1: Pure helper `weekOfQuarterPct_` (TDD)

**Files:** Modify `GDash.html` — add beside the other Policy Lab pure helpers (after `bareMinShare_`).

- [ ] **Step 1: Implement**

```js
// % of a quarter's total self-comments landing in each week-of-quarter.
// weeklySelf = {ISO week -> count}; weeks = that quarter's ordered week labels.
// Returns an array of length weeks.length (0s when the quarter has no comments).
function weekOfQuarterPct_(weeklySelf, weeks) {
  var counts = (weeks || []).map(function(w) { return (weeklySelf && weeklySelf[w]) || 0; });
  var total  = counts.reduce(function(a, b) { return a + b; }, 0);
  if (total === 0) return counts.map(function() { return 0; });
  return counts.map(function(c) { return +(c / total * 100).toFixed(1); });
}
```

- [ ] **Step 2: Write + run the test harness**

```bash
node -e "
var h=require('fs').readFileSync('GDash.html','utf8');
var js=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';\n');
global.document={addEventListener:function(){},getElementById:function(){return{innerHTML:'',style:{},dataset:{},value:''}},querySelectorAll:function(){return[]}};
global.window=global; global.Chart=function(){}; Chart.register=function(){}; global.ChartDataLabels={}; global.html2canvas=function(){};
eval(js);
var t=function(c,m){if(!c)throw new Error('FAIL: '+m)};
var wk=['W1','W2','W3','W4'];
// even: 2 each → 25% each
var e=weekOfQuarterPct_({W1:2,W2:2,W3:2,W4:2},wk);
t(e.join(',')==='25,25,25,25','even → 25% each, got '+e.join(','));
// all in final week → 0,0,0,100
var l=weekOfQuarterPct_({W4:5},wk);
t(l.join(',')==='0,0,0,100','all-final → 100% wk4, got '+l.join(','));
// empty → all zeros, correct length
var z=weekOfQuarterPct_({},wk);
t(z.length===4 && z.every(function(x){return x===0;}),'empty → zeros len4');
// ISO week not in weeks list is ignored (belongs to another quarter)
var x=weekOfQuarterPct_({W1:1,W99:9},wk);
t(x[0]===100,'out-of-quarter week ignored, got '+x.join(','));
console.log('weekOfQuarterPct_ OK');
"
```
Expected: `weekOfQuarterPct_ OK`.

- [ ] **Step 3: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): weekOfQuarterPct_ helper for Policy Lab cadence chart"
```

---

### Task 2: `renderCadenceChart_()` + markup + wire-in

**Files:** Modify `GDash.html` — pane markup (after the "Behaviors & spread" section-card inside `pane-policylab`), `renderPolicyLab()` tail, and the new render function beside the other Policy Lab render helpers.

- [ ] **Step 1: Add the section-card markup** — inside `#pane-policylab`, immediately after the behaviors `section-card` closes:

```html
      <div class="section-card">
        <div class="section-head"><div><h2>Where the comments land</h2><p class="section-sub" id="pl-cadence-verdict">Self-comments by week-of-quarter · last 4 quarters overlaid · grace period shaded</p></div>
          <button class="btn" onclick="exportPNG(this.closest('.section-card'),'policy-cadence.png')">⬇ PNG</button></div>
        <div class="section-body"><canvas id="chart-pl-cadence" height="90"></canvas></div>
      </div>
```

- [ ] **Step 2: Wire into `renderPolicyLab()`** — add as the last line before the closing brace of `renderPolicyLab`:

```js
  renderCadenceChart_(qs);
```

(`qs` is already computed at the top of `renderPolicyLab` from `policyQuarters_()`.)

- [ ] **Step 3: Implement `renderCadenceChart_`** — add after `renderPolicyBehaviors_`:

```js
// Combo chart: last 4 quarters overlaid on a week-of-quarter axis. Lines = each
// quarter's % of comments per week; bars = the 4-quarter average (the "weight").
// Grace = last 2 week-of-quarter columns, shaded.
function renderCadenceChart_(qs) {
  destroyChart('chart-pl-cadence');
  var canvas = document.getElementById('chart-pl-cadence');
  if (!canvas) return;

  var quarters = qs.slice(-4);                          // most recent 4 (newest last)
  var maxLen   = quarters.reduce(function(m, q){ return Math.max(m, (q.weeks||[]).length); }, 0);
  if (!maxLen) { document.getElementById('pl-cadence-verdict').textContent = 'No week-of-quarter data available yet.'; return; }
  var labels   = []; for (var i = 1; i <= maxLen; i++) labels.push('Wk ' + i);

  // Per-quarter % series (aggregate weeklySelf across the quarter's people first).
  var series = quarters.map(function(q, qi) {
    var agg = {};
    (q.people || []).forEach(function(p) {
      var ws = p.weeklySelf || {};
      Object.keys(ws).forEach(function(w){ agg[w] = (agg[w] || 0) + ws[w]; });
    });
    var pct = weekOfQuarterPct_(agg, q.weeks || []);
    while (pct.length < maxLen) pct.push(null);         // shorter/older quarters: no phantom zeros past their end
    var color = DEPT_COLORS[qi % DEPT_COLORS.length];
    return {
      type: 'line', label: q.quarter + (q.inProgress ? ' (in progress)' : ''),
      data: pct, borderColor: color, backgroundColor: color, tension: 0.3,
      borderDash: q.inProgress ? [5,4] : [], pointRadius: 2, order: 1, spanGaps: false,
    };
  });

  // Bar = unweighted average across quarters per week-of-quarter (ignore nulls).
  var avg = labels.map(function(_, wi) {
    var vals = series.map(function(s){ return s.data[wi]; }).filter(function(v){ return v != null; });
    return vals.length ? +(vals.reduce(function(a,b){return a+b;},0) / vals.length).toFixed(1) : 0;
  });
  var bar = { type:'bar', label:'4-quarter average', data:avg,
    backgroundColor: BRAND.IVORY_SOFT, borderColor: BRAND.IVORY, borderWidth:1, order: 2 };

  // Grace band = last 2 week columns (shared axis approximation of each quarter's final 2).
  var graceStart = maxLen - 2;   // 0-based index where grace begins (weeks maxLen-1, maxLen)
  var gracePlugin = {
    id: 'plGrace',
    beforeDraw: function(chart) {
      var xa = chart.scales.x, ya = chart.scales.y, ctx = chart.ctx;
      if (!xa || !ya || graceStart < 0) return;
      var x0 = xa.getPixelForValue(graceStart >= 0 ? graceStart : 0);
      var xR = xa.right;
      ctx.save(); ctx.fillStyle = BRAND.JUNE_SOFT;
      ctx.fillRect(x0, ya.top, xR - x0, ya.bottom - ya.top);
      ctx.fillStyle = BRAND.JUNE_TEXT; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('grace · goals close', xR - 6, ya.top + 12);
      ctx.restore();
    },
  };

  S.charts['chart-pl-cadence'] = new Chart(canvas, {
    data: { labels: labels, datasets: [bar].concat(series) },
    plugins: [gracePlugin],
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: { y: { beginAtZero: true, title:{display:true,text:'% of quarter’s comments'} },
                x: { title:{display:true,text:'Week of quarter'} } },
      plugins: { legend: { position:'bottom', labels:{ boxWidth:12, font:{size:10} } } },
    },
  });

  // Verdict: average share of comments in the final 2 weeks across quarters.
  var finalPct = Math.round((avg[maxLen-1] || 0) + (avg[maxLen-2] || 0));
  document.getElementById('pl-cadence-verdict').textContent =
    'On average, ' + finalPct + '% of a quarter’s comments land in the final 2 weeks (grace period) · last ' + quarters.length + ' quarters overlaid';
}
```

- [ ] **Step 4: Parse-check + stubbed-DOM smoke (1-quarter and 4-quarter)**

```bash
node -e "var h=require('fs').readFileSync('GDash.html','utf8');var m=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';');new Function(m);console.log('parse OK')"
```

```bash
node -e "
var h=require('fs').readFileSync('GDash.html','utf8');
var js=h.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g).map(function(s){return s.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')}).join(';\n');
var els={}; function el(id){return els[id]||(els[id]={innerHTML:'',style:{},dataset:{},value:(id==='pl-lag'?'4':id==='pl-need'?'6':id==='pl-min'?'1':id==='pl-bl'?'50':(id==='pl-dim'?'rocketeer':'')),textContent:'',getContext:function(){return{}}});}
var captured=null;
global.document={addEventListener:function(){},getElementById:el,querySelectorAll:function(){return[]}};
global.window=global; global.Chart=function(c,cfg){captured=cfg;return{destroy:function(){}};}; Chart.register=function(){}; global.ChartDataLabels={}; global.html2canvas=function(){};
eval(js);
var wk=[]; for(var i=1;i<=13;i++)wk.push('W'+i);
S.data={quarter:'FY26Q4',trendWeeks:wk,weeksElapsedSinceStart:13,
  history:[
    {quarter:'FY26Q1',weeks:wk,employees:[{normName:'a',name:'A',weeklySelf:{W12:5,W13:5},totalGoals:3,goalSelf:[2,2,2]}]},
    {quarter:'FY26Q2',weeks:wk,employees:[{normName:'a',name:'A',weeklySelf:{W1:1,W12:4,W13:5},totalGoals:3,goalSelf:[3,3,3]}]},
    {quarter:'FY26Q3',weeks:wk,employees:[{normName:'a',name:'A',weeklySelf:{W12:6,W13:4},totalGoals:3,goalSelf:[3,3,3]}]}],
  employees:[{normName:'a',name:'A',supervisor:'M',goalsList:[{status:'In Progress',self:2}],weeklySelf:{W13:2},totalGoals:1}]};
renderPolicyLab();
if(!captured) throw new Error('no chart built');
if(captured.data.datasets[0].label!=='4-quarter average') throw new Error('bar dataset missing/first');
if(captured.data.datasets.length!==5) throw new Error('expected bar + 4 lines, got '+captured.data.datasets.length);
if(!/final 2 weeks/.test(els['pl-cadence-verdict'].textContent)) throw new Error('verdict missing');
// single-quarter fixture
S.data.history=[]; renderPolicyLab();
if(captured.data.datasets.length!==2) throw new Error('single quarter → bar + 1 line, got '+captured.data.datasets.length);
console.log('renderCadenceChart_ smoke OK');
"
```
Expected: `parse OK` then `renderCadenceChart_ smoke OK`.

- [ ] **Step 5: Commit**

```bash
git add GDash.html
git commit -m "feat(gdash): Policy Lab week-of-quarter cadence combo chart — 4 quarters overlaid, grace band, avg weight"
```

---

### Task 3: Verification + memory

- [ ] **Step 1** — run Task 1 + Task 2 tests + parse-check: all pass.
- [ ] **Step 2** — update `project_goals_compliance_dashboard.md`: cadence chart added to Policy Lab (frontend-only, no cache bump), `weekOfQuarterPct_`, deploy = copy GDash.html + new deployment version.

**Out of scope:** manager/rocketeer toggle, chart drill, any backend change.
