# Planned vs Tracked + Team Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Project Demand Dashboard with a relabeled chart, a heatmap People headcount mode, and a new Team Availability panel showing per-person past execution and future planning signals.

**Architecture:** Two files only — `Code.js` (new `buildPersonAvailability_()` function + 4 payload fields) and `Dashboard.html` (heading rename, threshold line, 4th heatmap chip, new CSS/HTML/JS for Team Availability). Features are independent and can be committed separately.

**Tech Stack:** Google Apps Script (ES5 `var`/`function`), plain SVG charts, CSS custom properties from the company palette (`--void`, `--orbe`, `--royal`, `--june`, `--pos`, `--warn`, `--amber`).

---

## Task 1 — Planned vs Tracked chart: rename + soWhat copy + threshold line

**Files:**
- Modify: `project-demand-dashboard/Dashboard.html:236,490,507-511,555-576`

- [ ] **Step 1.1 — Rename the panel heading (line 236)**

  Change:
  ```html
  <h2>Planned vs Delivered</h2>
  ```
  To:
  ```html
  <h2>Planned vs Tracked</h2>
  ```

- [ ] **Step 1.2 — Update the function comment (line 490)**

  Change:
  ```js
  /* ---------------- Render: Planned vs Delivered ---------------- */
  ```
  To:
  ```js
  /* ---------------- Render: Planned vs Tracked ---------------- */
  ```

- [ ] **Step 1.3 — Fix "delivered" language in soWhat strings (lines 508–510)**

  Change:
  ```js
  else if(fid>=0.8){cls='ok';sw='<b>'+esc(iso)+' delivered '+Math.round(fid*100)+'% of planned work</b> ('+fmt(tracked)+' of '+fmt(planned)+' hrs tracked) — strong execution fidelity.';}
  else if(fid>=0.5){cls='';sw='<b>'+esc(iso)+' delivered '+Math.round(fid*100)+'% of planned work</b> ('+fmt(tracked)+' of '+fmt(planned)+' hrs tracked) — partial delivery; check People Signals for who planned but didn\'t track.';}
  else if(planned>0){cls='warn';sw='<b>'+esc(iso)+' delivery gap: '+Math.round(fid*100)+'% fidelity</b> ('+fmt(tracked)+' tracked vs '+fmt(planned)+' planned) — significant under-delivery; review People Signals below.';}
  ```
  To:
  ```js
  else if(fid>=0.8){cls='ok';sw='<b>'+esc(iso)+' tracked '+Math.round(fid*100)+'% of planned work</b> ('+fmt(tracked)+' of '+fmt(planned)+' hrs) — strong execution fidelity.';}
  else if(fid>=0.5){cls='';sw='<b>'+esc(iso)+' tracked '+Math.round(fid*100)+'% of planned work</b> ('+fmt(tracked)+' of '+fmt(planned)+' hrs) — partial delivery; check People Signals for who planned but didn\'t track.';}
  else if(planned>0){cls='warn';sw='<b>'+esc(iso)+' execution gap: '+Math.round(fid*100)+'% fidelity</b> ('+fmt(tracked)+' tracked vs '+fmt(planned)+' planned) — review People Signals below.';}
  ```

- [ ] **Step 1.4 — Add target execution rate line to `renderCapChart()` (after line 563, before the legend at line 565)**

  The fidelity annotation block ends with `}` at line 563. Insert after it, before `// legend (top-left inside chart)`:

  ```js
  // target execution rate line: planTarget × planned per week (amber dashed)
  if(DATA.planTarget){
    var tgt=DATA.planTarget;
    var tLinePts=WEEKS.map(function(wk,i){return x(i)+','+y((DATA.weekTotal[wk.iso]||0)*tgt);});
    g+='<polyline points="'+tLinePts.join(' ')+'" fill="none" stroke="'+css('--amber')+'" stroke-width="1.2" stroke-dasharray="4 3" opacity=".75"/>';
    var tgtLastY=y((DATA.weekTotal[WEEKS[NWEEKS-1].iso]||0)*tgt);
    g+='<text x="'+(w-pad.r)+'" y="'+(tgtLastY-4)+'" text-anchor="end" font-size="7.5" fill="'+css('--amber')+'" font-weight="600">'+Math.round(tgt*100)+'% target</text>';
  }
  ```

- [ ] **Step 1.5 — Verify manually**

  Open `Dashboard.html` in a browser (file:// works for visual check, live GAS URL for data).
  - Panel heading reads "Planned vs Tracked" ✓
  - Amber dashed line appears on the chart below the planned line ✓
  - "90% target" label visible at right edge ✓
  - soWhat bar no longer says "delivered" ✓

- [ ] **Step 1.6 — Commit**

  ```bash
  cd "D:\Contribution"
  git add project-demand-dashboard/Dashboard.html
  git commit -m "feat(dashboard): rename chart to Planned vs Tracked, add 90% target line"
  ```

---

## Task 2 — Heatmap People chip (4th mode)

**Files:**
- Modify: `project-demand-dashboard/Dashboard.html:282-286,390,393,733-746,769-775`

- [ ] **Step 2.1 — Add `HEAT_MAX_HEAD` state variable (line 393, after `COLOR_MODE`)**

  Change:
  ```js
  var COLOR_MODE = "hours", TREND_MODE = "movers", QFILTER = "all", BLEND_OPEN = false;
  ```
  To:
  ```js
  var COLOR_MODE = "hours", TREND_MODE = "movers", QFILTER = "all", BLEND_OPEN = false;
  var HEAT_MAX_HEAD = 0;
  ```

- [ ] **Step 2.2 — Add 4th chip button to `#colorMode` toggle (line 285)**

  Change:
  ```html
  <div class="chip-toggle" id="colorMode">
    <button data-m="change">Change</button>
    <button data-m="risk">Risk</button>
    <button data-m="hours" class="on">Hours</button>
  </div>
  ```
  To:
  ```html
  <div class="chip-toggle" id="colorMode">
    <button data-m="change">Change</button>
    <button data-m="risk">Risk</button>
    <button data-m="hours" class="on">Hours</button>
    <button data-m="people">&#x1F465; People</button>
  </div>
  ```

  Note: `&#x1F465;` is the 👥 emoji — avoids encoding issues in GAS HTML files.

- [ ] **Step 2.3 — Compute `HEAT_MAX_HEAD` at start of `renderHeat()` (line 749, before `var order`)**

  Change:
  ```js
  function renderHeat(){
    var order=visibleOrder();
  ```
  To:
  ```js
  function renderHeat(){
    HEAT_MAX_HEAD=0;
    DATA.order.forEach(function(k){WEEKS.forEach(function(w){var h=(DATA.head[k]&&DATA.head[k][w.iso])||0;if(h>HEAT_MAX_HEAD)HEAT_MAX_HEAD=h;});});
    var order=visibleOrder();
  ```

- [ ] **Step 2.4 — Add `'people'` branch to `cellColor()` (before the `// risk` implicit-else, after the `COLOR_MODE==='change'` block, around line 740)**

  The `change` block ends with `}` and is immediately followed by `// risk`. Insert before `// risk`:

  Change:
  ```js
  // risk
  var dr=wowDrop(k,iso); var toZero=(capAt(k,iso)<=0.001 && pr_pos(k,iso));
  ```
  To:
  ```js
  if(COLOR_MODE==='people'){
    var hd=(DATA.head[k]&&DATA.head[k][iso])||0;
    var t=HEAT_MAX_HEAD>0?hd/HEAT_MAX_HEAD:0;
    var bg=t<0.5?mix(hexVar('--surface-2'),'#2864E6',t/0.5):mix('#2864E6',hexVar('--void'),(t-0.5)/0.5);
    return {bg:bg,fg:t>0.4?'#fff':css('--text'),txt:hd>0?hd+'p':''};
  }
  // risk
  var dr=wowDrop(k,iso); var toZero=(capAt(k,iso)<=0.001 && pr_pos(k,iso));
  ```

- [ ] **Step 2.5 — Update legend block in `renderHeat()` for people mode (lines 769–775)**

  Change:
  ```js
  var bar=$('legBar'); bar.className='legbar '+COLOR_MODE;
  $('legLo').textContent = COLOR_MODE==='hours'?'Lower':COLOR_MODE==='risk'?'Steady':'Falling';
  $('legHi').textContent = COLOR_MODE==='hours'?'Higher planned hrs':COLOR_MODE==='risk'?'Dropping / to zero':'Rising';
  ```
  To:
  ```js
  var bar=$('legBar');
  if(COLOR_MODE==='people'){
    bar.className='legbar';
    bar.style.background='linear-gradient(90deg,'+hexVar('--surface-2')+',#2864E6,'+hexVar('--void')+')';
    bar.style.border='1px solid var(--border)';
    $('legLo').textContent='0 people';
    $('legHi').textContent=HEAT_MAX_HEAD+' people';
  } else {
    bar.className='legbar '+COLOR_MODE;
    bar.style.background=''; bar.style.border='';
    $('legLo').textContent = COLOR_MODE==='hours'?'Lower':COLOR_MODE==='risk'?'Steady':'Falling';
    $('legHi').textContent = COLOR_MODE==='hours'?'Higher planned hrs':COLOR_MODE==='risk'?'Dropping / to zero':'Rising';
  }
  ```

- [ ] **Step 2.6 — Verify manually**

  - Click "👥 People" chip — heatmap cells switch from hours to `"Np"` headcount values ✓
  - Color scale is surface-2 → royal (#2864E6) → void (#0F1941) ✓
  - Legend reads "0 people → N people" with matching gradient ✓
  - Clicking other chips (Change/Risk/Hours) restores original behaviour ✓

- [ ] **Step 2.7 — Commit**

  ```bash
  git add project-demand-dashboard/Dashboard.html
  git commit -m "feat(dashboard): add People headcount mode to heatmap (4th chip)"
  ```

---

## Task 3 — Backend: `buildPersonAvailability_()` + payload fields

**Files:**
- Modify: `project-demand-dashboard/Code.js:456-477,129-181`

- [ ] **Step 3.1 — Add 4 fields to `emptyModel_()` (after `trackedError: null,` at line ~475)**

  Change:
  ```js
    trackedError: null,
    fragMin: CONFIG.FRAG_MIN,
  ```
  To:
  ```js
    trackedError: null,
    personWeekPlan: {}, personWeekTracked: {}, personProjectPlan: {}, personMeta: {},
    fragMin: CONFIG.FRAG_MIN,
  ```

- [ ] **Step 3.2 — Add `buildPersonAvailability_()` function (after `buildDisplayNames_()` at line ~334)**

  Insert after the closing `}` of `buildDisplayNames_()`:

  ```js
  function buildPersonAvailability_(plannedRecs, trackedRecs, rosterProfiles) {
    var norm = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
    var personWeekPlan = {}, personWeekTracked = {}, personProjectPlan = {}, displayNames = {};

    // Build display names: first occurrence of a normalised name wins.
    (plannedRecs || []).concat(trackedRecs || []).forEach(function(rec) {
      var np = norm(rec.person);
      if (!displayNames[np]) displayNames[np] = rec.person;
    });

    (plannedRecs || []).forEach(function(rec) {
      var np = norm(rec.person);
      if (!((rosterProfiles || {})[np])) return;
      personWeekPlan[np] = personWeekPlan[np] || {};
      personWeekPlan[np][rec.iso] = (personWeekPlan[np][rec.iso] || 0) + rec.hours;
      personProjectPlan[np] = personProjectPlan[np] || {};
      personProjectPlan[np][rec.key] = personProjectPlan[np][rec.key] || {};
      personProjectPlan[np][rec.key][rec.iso] = (personProjectPlan[np][rec.key][rec.iso] || 0) + rec.hours;
    });

    (trackedRecs || []).forEach(function(rec) {
      var np = norm(rec.person);
      if (!((rosterProfiles || {})[np])) return;
      personWeekTracked[np] = personWeekTracked[np] || {};
      personWeekTracked[np][rec.iso] = (personWeekTracked[np][rec.iso] || 0) + rec.hours;
    });

    var personMeta = {};
    var allNorms = {};
    Object.keys(personWeekPlan).forEach(function(np) { allNorms[np] = true; });
    Object.keys(personWeekTracked).forEach(function(np) { allNorms[np] = true; });
    Object.keys(allNorms).forEach(function(np) {
      var prof = (rosterProfiles || {})[np] || {};
      personMeta[np] = {
        displayName: displayNames[np] || np,
        jobFamily:   prof.jobFamily  || '',
        manager:     prof.manager    || '',
        location:    prof.location   || ''
      };
    });

    return { personWeekPlan: personWeekPlan, personWeekTracked: personWeekTracked,
             personProjectPlan: personProjectPlan, personMeta: personMeta };
  }
  ```

- [ ] **Step 3.3 — Call `buildPersonAvailability_()` in `getDemandData()` (after the tracked-time block, before `return model;`)**

  The tracked time block ends before `return model;` at line ~175. Insert before `return model;`:

  ```js
    // ── Person availability (planned + tracked per person per week) ──
    var availResult = buildPersonAvailability_(
      parsed.recs,
      (!trackedResult.error && trackedResult.recs) ? trackedResult.recs : [],
      roster.profiles
    );
    model.personWeekPlan    = availResult.personWeekPlan;
    model.personWeekTracked = availResult.personWeekTracked;
    model.personProjectPlan = availResult.personProjectPlan;
    model.personMeta        = availResult.personMeta;

    return model;
  ```

  Remove the bare `return model;` that was there before.

- [ ] **Step 3.4 — Add unit test function (after `_test_headcount_()` at end of file)**

  ```js
  function _test_buildPersonAvailability_() {
    function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_buildPersonAvailability_: " + msg); }

    var plannedRecs = [
      { person: "Ana Smith", iso: "2026.W24", key: "ACME", name: "Acme", hours: 20 },
      { person: "Ana Smith", iso: "2026.W24", key: "BETA", name: "Beta", hours: 10 },
      { person: "Ben Lee",   iso: "2026.W24", key: "ACME", name: "Acme", hours: 16 },
      { person: "External",  iso: "2026.W24", key: "ACME", name: "Acme", hours: 8 },  // not in roster → excluded
    ];
    var trackedRecs = [
      { person: "Ana Smith", iso: "2026.W24", key: "ACME", name: "Acme", hours: 16 },
      { person: "Ana Smith", iso: "2026.W24", key: "BETA", name: "Beta", hours: 6 },
    ];
    var roster = {
      "ana smith": { jobFamily: "Consulting", manager: "Mgr A", location: "US" },
      "ben lee":   { jobFamily: "Delivery",   manager: "Mgr B", location: "ANZ" }
      // "external" deliberately absent
    };

    var result = buildPersonAvailability_(plannedRecs, trackedRecs, roster);

    // personWeekPlan
    assert_(result.personWeekPlan["ana smith"]["2026.W24"] === 30, "Ana planned should be 30h");
    assert_(result.personWeekPlan["ben lee"]["2026.W24"]   === 16, "Ben planned should be 16h");
    assert_(!result.personWeekPlan["external"], "External (not in roster) must be excluded");

    // personWeekTracked
    assert_(result.personWeekTracked["ana smith"]["2026.W24"] === 22, "Ana tracked should be 22h");
    assert_(!result.personWeekTracked["ben lee"], "Ben has no tracked — key must be absent");

    // personProjectPlan
    assert_(result.personProjectPlan["ana smith"]["ACME"]["2026.W24"] === 20, "Ana ACME plan should be 20h");
    assert_(result.personProjectPlan["ana smith"]["BETA"]["2026.W24"] === 10, "Ana BETA plan should be 10h");

    // personMeta
    assert_(result.personMeta["ana smith"].displayName === "Ana Smith", "displayName should be title-case from rec");
    assert_(result.personMeta["ana smith"].jobFamily   === "Consulting", "jobFamily from roster");
    assert_(result.personMeta["ben lee"].location      === "ANZ", "location from roster");
    assert_(!result.personMeta["external"], "External must not appear in personMeta");

    Logger.log("✅ _test_buildPersonAvailability_ passed");
  }
  ```

- [ ] **Step 3.5 — Run the test**

  In the GAS editor, select `_test_buildPersonAvailability_` from the function dropdown and click Run.

  Expected in Execution Log:
  ```
  ✅ _test_buildPersonAvailability_ passed
  ```

- [ ] **Step 3.6 — Commit**

  ```bash
  git add project-demand-dashboard/Code.js
  git commit -m "feat(backend): add buildPersonAvailability_ with per-person week + project payload"
  ```

---

## Task 4 — Frontend: Team Availability panel

**Files:**
- Modify: `project-demand-dashboard/Dashboard.html` (CSS ~line 205, HTML ~line 275, JS state ~line 394, JS functions, `applyModel`, `renderAll`, weekbar onclick)

- [ ] **Step 4.1 — Add CSS (after `.projdrill-legend` block, around line 205)**

  Insert after:
  ```css
  .projdrill-legend i{width:16px;height:3px;border-radius:2px;display:inline-block}
  ```

  Add:
  ```css
  /* Team Availability */
  .avail-grid{display:grid;gap:2px;align-items:center}
  .avail-cell{height:26px;border-radius:4px;position:relative;overflow:hidden;border:1px solid var(--border);display:flex;align-items:center;justify-content:center}
  .avail-cell .fill{position:absolute;left:0;top:0;height:100%;border-radius:3px}
  .avail-cell .lbl{position:relative;font-size:9px;font-weight:700;font-family:'Roboto Condensed';color:inherit}
  .avail-cell.noplan{border:1px dashed var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--surface-2))}
  .avail-cell.future-plan{border:1px dashed var(--orbe);background:color-mix(in srgb,var(--orbe) 8%,var(--surface-2))}
  .avail-cell.current{background:color-mix(in srgb,var(--amber) 10%,var(--surface-2))}
  .avail-cell.blank{background:var(--surface-2);border-color:transparent}
  .avail-name{font-size:11.5px;font-weight:600;cursor:pointer;padding:4px 6px;border-radius:6px}
  .avail-name:hover{background:var(--surface-2)}
  .avail-name .sub{display:block;font-size:10px;color:var(--muted);font-weight:400}
  .avail-drill{grid-column:1/-1;background:var(--surface-2);border-radius:8px;padding:8px 12px;display:none;font-size:11.5px;margin-top:2px}
  .avail-drill.open{display:block}
  ```

- [ ] **Step 4.2 — Add HTML panel (after closing `</div>` of `#sigPanel` at line 275, before the heatmap comment at line 277)**

  Insert between `</div>` (end of `#sigPanel`) and `<!-- 2. Project key heatmap`:

  ```html
    <!-- 1c. Team Availability -->
    <div class="panel" id="availPanel" style="display:none">
      <div class="panel-h">
        <h2>Team Availability</h2>
        <div class="panel-tools">
          <select class="sigfilter" id="availLoc"><option value="">All locations</option></select>
          <select class="sigfilter" id="availFam"><option value="">All job families</option></select>
          <select class="sigfilter" id="availMgr"><option value="">All managers</option></select>
        </div>
      </div>
      <div id="avail"></div>
    </div>
  ```

- [ ] **Step 4.3 — Add state variables (line 394, after the `SIG_LOC/FAM/MGR` line)**

  Change:
  ```js
  var SIG_LOC = "", SIG_FAM = "", SIG_MGR = "";
  ```
  To:
  ```js
  var SIG_LOC = "", SIG_FAM = "", SIG_MGR = "";
  var AVAIL_LOC = "", AVAIL_FAM = "", AVAIL_MGR = "", AVAIL_OPEN = null;
  ```

- [ ] **Step 4.4 — Add `populateAvailFilters()` (after `populateSigFilters()` closing `}` around line 631)**

  ```js
  function populateAvailFilters(){
    var dims=DATA.rosterDimensions||{locations:[],jobFamilies:[],managers:[]};
    function fill(id,items,cur,lbl){
      var sel=$(id);if(!sel)return;
      sel.innerHTML='<option value="">'+lbl+'</option>'+items.map(function(v){return '<option value="'+esc(v)+'"'+(v===cur?' selected':'')+'>'+esc(v)+'</option>';}).join('');
    }
    fill('availLoc',dims.locations,AVAIL_LOC,'All locations');
    fill('availFam',dims.jobFamilies,AVAIL_FAM,'All job families');
    fill('availMgr',dims.managers,AVAIL_MGR,'All managers');
    ['availLoc','availFam','availMgr'].forEach(function(id){
      var el=$(id);if(!el)return;
      el.onchange=function(){
        if(id==='availLoc')AVAIL_LOC=this.value;
        if(id==='availFam')AVAIL_FAM=this.value;
        if(id==='availMgr')AVAIL_MGR=this.value;
        renderAvailability();
      };
    });
  }
  ```

- [ ] **Step 4.5 — Add `renderAvailability()` and `toggleAvailDrill()` (after `populateAvailFilters()`, before `renderProjDrill()`)**

  ```js
  /* ---------------- Render: Team Availability ---------------- */
  function renderAvailability(){
    var panel=$('availPanel'), container=$('avail');
    if(!DATA||!DATA.personMeta||!Object.keys(DATA.personMeta).length){if(panel)panel.style.display='none';return;}
    if(panel)panel.style.display='';

    var tgt=DATA.planTarget||0.9;
    var perPersonCap=DATA.baseCapacity>0&&DATA.headcount>0?(DATA.baseCapacity/DATA.headcount):40;
    var futurWeeks=WEEKS.filter(function(w){return w.status==='plan';});
    var pastWeeks=WEEKS.filter(function(w){return w.status==='done';});

    // Filter
    var people=Object.keys(DATA.personMeta).filter(function(np){
      var m=DATA.personMeta[np];
      if(AVAIL_LOC&&m.location!==AVAIL_LOC)return false;
      if(AVAIL_FAM&&m.jobFamily!==AVAIL_FAM)return false;
      if(AVAIL_MGR&&m.manager!==AVAIL_MGR)return false;
      return true;
    });

    // Sort: most no-plan future weeks first, then lowest mean past execution
    people.sort(function(a,b){
      var aNoP=futurWeeks.filter(function(w){return !((DATA.personWeekPlan[a]||{})[w.iso]);}).length;
      var bNoP=futurWeeks.filter(function(w){return !((DATA.personWeekPlan[b]||{})[w.iso]);}).length;
      if(bNoP!==aNoP) return bNoP-aNoP;
      function meanExec(np){
        var sum=0,cnt=0;
        pastWeeks.forEach(function(w){var pl=(DATA.personWeekPlan[np]||{})[w.iso]||0;if(pl>0){sum+=(DATA.personWeekTracked[np]||{})[w.iso]||0;cnt+=pl;}});
        return cnt>0?sum/cnt:1;
      }
      return meanExec(a)-meanExec(b);
    });

    var N=NWEEKS;
    var html='<div class="avail-grid" style="grid-template-columns:140px repeat('+N+',1fr)">';

    // Header row
    html+='<div></div>';
    WEEKS.forEach(function(w){
      var isPast=w.status==='done',isCur=w.status==='now';
      var col=isPast?'var(--orbe)':isCur?'var(--amber)':'var(--muted)';
      var bg=isCur?'background:color-mix(in srgb,var(--amber) 8%,var(--surface-2));border-radius:4px;':'';
      html+='<div style="text-align:center;padding:2px 1px;'+bg+'">'
        +'<div style="font-family:\'Roboto Condensed\';font-weight:700;font-size:11px;color:'+col+'">W'+w.wk+'</div>'
        +'<div style="font-size:8.5px;color:var(--muted)">'+(isPast?'past':isCur?'now':'future')+'</div>'
        +'</div>';
    });

    people.forEach(function(np){
      var meta=DATA.personMeta[np];
      var pwp=DATA.personWeekPlan[np]||{};
      var pwt=DATA.personWeekTracked[np]||{};
      var ppp=DATA.personProjectPlan[np]||{};
      var isOpen=AVAIL_OPEN===np;

      html+='<div class="avail-name" data-np="'+esc(np)+'">'
        +esc(meta.displayName||np)
        +'<span class="sub">'+esc(meta.jobFamily||'')+'</span>'
        +'</div>';

      WEEKS.forEach(function(w){
        var iso=w.iso;
        var ph=pwp[iso]||0, th=pwt[iso]||0;
        if(w.status==='done'){
          if(ph===0){
            html+='<div class="avail-cell blank"><span class="lbl" style="color:var(--muted);font-size:8px">—</span></div>';
            return;
          }
          var ratio=th/ph;
          var over=th>ph*1.05;
          var pctLbl=Math.round((over?th/ph:ratio)*100)+'%';
          var fillClr=over?'var(--june)':ratio>=tgt?'var(--pos)':ratio>=0.6?'var(--amber)':'var(--warn)';
          var fillW=Math.min(100,over?100:ratio*100);
          var darkTxt=fillW>55;
          html+='<div class="avail-cell" title="'+esc(meta.displayName)+' · '+iso+' · '+fmt(ph)+'h planned, '+fmt(th)+'h tracked">'
            +'<div class="fill" style="width:'+fillW+'%;background:'+fillClr+';opacity:0.8"></div>'
            +'<span class="lbl" style="color:'+(darkTxt?'#fff':'var(--text)')+'">'+pctLbl+'</span>'
            +'</div>';
        } else if(w.status==='now'){
          var partW=ph>0?Math.min(100,th/ph*100):0;
          html+='<div class="avail-cell current" title="'+esc(meta.displayName)+' · '+iso+' · in progress">'
            +(ph>0?'<div class="fill" style="width:'+partW+'%;background:var(--amber);opacity:0.6"></div>':'')
            +'<span class="lbl" style="color:var(--amber);font-size:8px">now</span>'
            +'</div>';
        } else {
          if(ph===0){
            html+='<div class="avail-cell noplan" title="'+esc(meta.displayName)+' · '+iso+' · no plan">'
              +'<span class="lbl" style="color:var(--warn)">!</span></div>';
          } else {
            var planW=Math.min(100,ph/perPersonCap*100);
            html+='<div class="avail-cell future-plan" title="'+esc(meta.displayName)+' · '+iso+' · '+fmt(ph)+'h planned">'
              +'<div class="fill" style="width:'+planW+'%;background:var(--orbe);opacity:0.4"></div>'
              +'<span class="lbl" style="color:var(--orbe)">'+fmt(ph)+'h</span>'
              +'</div>';
          }
        }
      });

      // Drill row — shown when AVAIL_OPEN === np
      var drillKeys=Object.keys(ppp).filter(function(k){return (ppp[k][SEL_ISO]||0)>0.5;});
      drillKeys.sort(function(a,b){return (ppp[b][SEL_ISO]||0)-(ppp[a][SEL_ISO]||0);});
      var drillContent=drillKeys.length
        ?'<b style="font-size:10px;color:var(--muted);font-family:\'Roboto Condensed\';text-transform:uppercase;letter-spacing:.04em">Projects · '+SEL_ISO+'</b>'
          +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">'
          +drillKeys.map(function(k){return chip(k)+'<span style="font-size:11px;color:var(--muted)"> '+fmt(ppp[k][SEL_ISO])+'h</span>';}).join('')
          +'</div>'
        :'<span style="color:var(--muted);font-size:11px">No planned projects for '+esc(SEL_ISO)+'</span>';
      html+='<div class="avail-drill'+(isOpen?' open':'')+'">'+drillContent+'</div>';
    });

    html+='</div>';

    // Legend
    html+='<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:11px;color:var(--muted);align-items:center">'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--pos);display:inline-block"></span>≥'+Math.round(tgt*100)+'% execution</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--amber);display:inline-block"></span>60–'+Math.round(tgt*100)+'%</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--warn);display:inline-block"></span>&lt;60% needs help</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--june);display:inline-block"></span>over-tracked</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;border:1px dashed var(--orbe);background:color-mix(in srgb,var(--orbe) 8%,var(--surface-2));display:inline-block"></span>future: planned</span>'
      +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;border:1px dashed var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--surface-2));display:inline-block"></span>future: no plan</span>'
      +'</div>';

    container.innerHTML=html;

    Array.prototype.forEach.call(container.querySelectorAll('.avail-name'),function(el){
      el.onclick=function(){ toggleAvailDrill(el.dataset.np); };
    });
  }

  function toggleAvailDrill(np){
    AVAIL_OPEN = AVAIL_OPEN===np ? null : np;
    renderAvailability();
  }
  ```

- [ ] **Step 4.6 — Update `applyModel()` to populate availability filters (line 444)**

  Change:
  ```js
  if(DATA.rosterDimensions) populateSigFilters();
  ```
  To:
  ```js
  if(DATA.rosterDimensions){ populateSigFilters(); populateAvailFilters(); }
  ```

- [ ] **Step 4.7 — Update `renderAll()` to call `renderAvailability()` (line 924)**

  Change:
  ```js
  function renderAll(){
    renderRange(); renderWeekbar(); renderCapacity(); renderSignals(); renderMovers();
    renderBars(); renderBlend(); renderTrend(); renderHeat(); renderFoot();
  }
  ```
  To:
  ```js
  function renderAll(){
    renderRange(); renderWeekbar(); renderCapacity(); renderSignals(); renderAvailability(); renderMovers();
    renderBars(); renderBlend(); renderTrend(); renderHeat(); renderFoot();
  }
  ```

- [ ] **Step 4.8 — Reset `AVAIL_OPEN` on week change (line 487)**

  Change:
  ```js
  b.onclick=function(){ SEL_ISO=b.dataset.iso; BLEND_OPEN=false; renderAll(); };
  ```
  To:
  ```js
  b.onclick=function(){ SEL_ISO=b.dataset.iso; BLEND_OPEN=false; AVAIL_OPEN=null; renderAll(); };
  ```

- [ ] **Step 4.9 — Verify manually (live GAS URL)**

  - Team Availability panel appears below People Signals ✓
  - Past weeks show color-coded bars: green ≥90%, amber 60–90%, red <60% ✓
  - Current week shows amber "now" bar ✓
  - Future weeks with no plan show red `!` cell ✓
  - Future weeks with plan show dashed blue bar with hour count ✓
  - Clicking a person row opens a drill-down showing their project keychips + hours for `SEL_ISO` ✓
  - Clicking again collapses the drill ✓
  - Location/Job Family/Manager filters narrow the list ✓
  - Switching week (weekbar) resets any open drill and re-renders project breakdown for new week ✓
  - People sorted with most "no plan" future weeks at top ✓
  - Theme toggle (light/dark) rerenders correctly ✓

- [ ] **Step 4.10 — Commit**

  ```bash
  git add project-demand-dashboard/Dashboard.html
  git commit -m "feat(dashboard): Team Availability panel — per-person past execution + future planning signals"
  ```

---

## Self-Review

**Spec coverage check:**
- ✅ Feature 1: heading renamed (Step 1.1), soWhat copy (1.3), threshold line (1.4)
- ✅ Feature 2: 4th chip (2.2), people branch in `cellColor()` (2.4), legend (2.5), `HEAT_MAX_HEAD` computed once per render (2.3)
- ✅ Feature 3 backend: `buildPersonAvailability_()` (3.2), `emptyModel_()` fields (3.1), `getDemandData()` call (3.3), unit test (3.4)
- ✅ Feature 3 frontend: CSS (4.1), HTML (4.2), state vars (4.3), `populateAvailFilters()` (4.4), `renderAvailability()` + `toggleAvailDrill()` (4.5), `applyModel()` hook (4.6), `renderAll()` (4.7), week-change reset (4.8)

**Type consistency:**
- `DATA.personWeekPlan`, `DATA.personWeekTracked`, `DATA.personProjectPlan`, `DATA.personMeta` — named identically in `emptyModel_()`, `buildPersonAvailability_()` return, `getDemandData()` assignment, and `renderAvailability()` reads ✓
- `AVAIL_OPEN` used in `renderAvailability()` and `toggleAvailDrill()` and reset in weekbar onclick ✓
- `HEAT_MAX_HEAD` set in `renderHeat()` before `cellColor()` is called ✓

**No placeholders:** All steps contain complete code. ✓
