# Team Availability — PTO Awareness, Blend Filter, Sticky Filters & Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Team Availability the single, actionable people-planning panel: PTO-aware execution signals, project blend depth filter, sticky filter bar, and removal of panels that don't answer "so what?"

**Architecture:** All changes are in `Dashboard.html` (frontend) and `Code.js` (backend). The backend adds `personWeekPTO` to the existing `buildPersonAvailability_()` payload by capturing NETSUITE hours instead of discarding them. The frontend builds on the existing Team Availability panel, absorbing the People & Blending panel and upgrading filter UX.

**Tech Stack:** Google Apps Script HtmlService SPA — ES5 only (`var`/`function`, no arrow functions, no `const`/`let`). Company palette via CSS custom properties. Existing helpers: `esc()`, `fmt()`, `chip()`, `mix()`, `hexVar()`, `css()`.

---

## Global Constraints

- ES5 only — no `const`/`let`, no arrow functions, no template literals
- All color references via CSS custom properties (`var(--pos)`, `var(--warn)`, etc.) or `hexVar()`
- Week keys always `YYYY.WN` format
- `normPS_()` equivalent already in Code.js as inline `norm()`
- NETSUITE is the PTO key in Tempo — `CONFIG.NETSUITE_KEY` (check exact constant name before use)
- Never push to origin; keep changes local
- `personWeekPTO` must be added to `emptyModel_()` before `buildPersonAvailability_()` writes to it

---

## Task 1 — Backend: capture NETSUITE hours as `personWeekPTO`

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js`

The current `buildPersonAvailability_()` skips any record whose key is the NETSUITE exclusion key. Instead, route those records into a new `personWeekPTO` accumulator.

- [ ] **Step 1.1 — Add `personWeekPTO` to `emptyModel_()`**

  Find the `emptyModel_()` function and add `personWeekPTO: {}` alongside the existing `personWeekPlan`, `personWeekTracked`, `personProjectPlan`, `personMeta` fields.

  Change:
  ```js
  personWeekPlan: {}, personWeekTracked: {}, personProjectPlan: {}, personMeta: {},
  ```
  To:
  ```js
  personWeekPlan: {}, personWeekTracked: {}, personProjectPlan: {}, personMeta: {}, personWeekPTO: {},
  ```

- [ ] **Step 1.2 — Capture NETSUITE planned records as PTO**

  In `buildPersonAvailability_()`, inside the `plannedRecs.forEach` loop, find where NETSUITE records are skipped. Change from a hard skip to a PTO accumulation:

  Change (approximately):
  ```js
  (plannedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!((rosterProfiles || {})[np])) return;
    personWeekPlan[np] = personWeekPlan[np] || {};
    personWeekPlan[np][rec.iso] = (personWeekPlan[np][rec.iso] || 0) + rec.hours;
    ...
  ```
  To:
  ```js
  (plannedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!((rosterProfiles || {})[np])) return;
    if (rec.key === CONFIG.NETSUITE_KEY) {
      personWeekPTO[np] = personWeekPTO[np] || {};
      personWeekPTO[np][rec.iso] = (personWeekPTO[np][rec.iso] || 0) + rec.hours;
      return;
    }
    personWeekPlan[np] = personWeekPlan[np] || {};
    personWeekPlan[np][rec.iso] = (personWeekPlan[np][rec.iso] || 0) + rec.hours;
    ...
  ```

  Check whether there is already a NETSUITE exclusion guard upstream (before `buildPersonAvailability_()` is called). If NETSUITE records are filtered out before they reach `buildPersonAvailability_()`, move the capture logic to wherever that exclusion currently happens.

- [ ] **Step 1.3 — Capture NETSUITE tracked records as PTO**

  Apply the same pattern inside the `trackedRecs.forEach` loop:

  ```js
  (trackedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!((rosterProfiles || {})[np])) return;
    if (rec.key === CONFIG.NETSUITE_KEY) {
      personWeekPTO[np] = personWeekPTO[np] || {};
      personWeekPTO[np][rec.iso] = (personWeekPTO[np][rec.iso] || 0) + rec.hours;
      return;
    }
    personWeekTracked[np] = personWeekTracked[np] || {};
    personWeekTracked[np][rec.iso] = (personWeekTracked[np][rec.iso] || 0) + rec.hours;
  });
  ```

- [ ] **Step 1.4 — Wire `personWeekPTO` into the return value**

  In the `return` statement of `buildPersonAvailability_()`, add `personWeekPTO`:

  Change:
  ```js
  return { personWeekPlan: personWeekPlan, personWeekTracked: personWeekTracked,
           personProjectPlan: personProjectPlan, personMeta: personMeta };
  ```
  To:
  ```js
  return { personWeekPlan: personWeekPlan, personWeekTracked: personWeekTracked,
           personProjectPlan: personProjectPlan, personMeta: personMeta,
           personWeekPTO: personWeekPTO };
  ```

  And in `getDemandData()` where the result is assigned to the model:
  ```js
  model.personWeekPTO = availResult.personWeekPTO;
  ```

- [ ] **Step 1.5 — Write and run unit test**

  Add a test function `_test_personWeekPTO_()` at the end of the file:

  ```js
  function _test_personWeekPTO_() {
    function assert_(cond, msg) { if (!cond) throw new Error('❌ _test_personWeekPTO_: ' + msg); }

    var NETSUITE_KEY = CONFIG.NETSUITE_KEY; // e.g. 'NETSUITE'
    var plannedRecs = [
      { person: 'Ana Smith', iso: '2026.W27', key: 'ACME',        hours: 20 },
      { person: 'Ana Smith', iso: '2026.W27', key: NETSUITE_KEY,  hours: 16 },
      { person: 'Ben Lee',   iso: '2026.W27', key: NETSUITE_KEY,  hours: 40 },
    ];
    var trackedRecs = [
      { person: 'Ana Smith', iso: '2026.W26', key: NETSUITE_KEY,  hours: 8 },
    ];
    var roster = {
      'ana smith': { jobFamily: 'Consulting', manager: 'M', location: 'US' },
      'ben lee':   { jobFamily: 'Delivery',   manager: 'M', location: 'ANZ' }
    };

    var result = buildPersonAvailability_(plannedRecs, trackedRecs, roster);

    assert_(result.personWeekPlan['ana smith']['2026.W27'] === 20,  'Ana project plan 20h');
    assert_(!result.personWeekPlan['ana smith']['2026.W27'] || result.personWeekPlan['ana smith']['2026.W27'] === 20, 'NETSUITE not in plan');
    assert_(result.personWeekPTO['ana smith']['2026.W27']  === 16,  'Ana PTO planned 16h');
    assert_(result.personWeekPTO['ben lee']['2026.W27']    === 40,  'Ben full-PTO 40h');
    assert_(result.personWeekPTO['ana smith']['2026.W26']  === 8,   'Ana PTO tracked 8h');
    assert_(!result.personWeekPlan['ben lee'],                       'Ben has no project plan');

    Logger.log('✅ _test_personWeekPTO_ passed');
  }
  ```

  Run in GAS editor. Expected: `✅ _test_personWeekPTO_ passed`.

- [ ] **Step 1.6 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Code.js
  git commit -m "feat(backend): capture NETSUITE hours as personWeekPTO in buildPersonAvailability_"
  ```

---

## Task 2 — Frontend: PTO-aware cell rendering

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 2.1 — Add `PTO_FULL_THRESHOLD` constant**

  Near the top of the `<script>` block, alongside `AVAIL_TOPN` and `AVAIL_CAT`:

  ```js
  var PTO_FULL_THRESHOLD = 0.75; // ≥75% of weekly capacity = treat as full-PTO week
  ```

- [ ] **Step 2.2 — Add `.avail-cell.pto` CSS**

  In the `<style>` block, after the existing `.avail-cell` rules:

  ```css
  .avail-cell.pto{background:color-mix(in srgb,var(--neutral) 25%,var(--surface-2))}
  ```

- [ ] **Step 2.3 — Update future-week cell rendering in `renderAvailability()`**

  Inside the `else` branch (future week), replace the current `if(ph===0)` block:

  Change:
  ```js
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
  ```
  To:
  ```js
  } else {
    var ptoH=(DATA.personWeekPTO[np]||{})[iso]||0;
    var fullPTO=ptoH>=perPersonCap*PTO_FULL_THRESHOLD;
    if(ph===0){
      if(fullPTO){
        html+='<div class="avail-cell pto" title="'+esc(meta.displayName)+' · '+iso+' · '+fmt(ptoH)+'h PTO">'
          +'<span class="lbl" style="color:var(--muted);font-size:9px">PTO</span></div>';
      } else {
        html+='<div class="avail-cell noplan" title="'+esc(meta.displayName)+' · '+iso+' · no plan">'
          +'<span class="lbl" style="color:var(--warn)">!</span></div>';
      }
    } else {
      var effectiveCap=Math.max(1,perPersonCap-ptoH);
      var planW=Math.min(100,ph/effectiveCap*100);
      var ptoNote=ptoH>4?(' +'+fmt(ptoH)+'h PTO'):'';
      html+='<div class="avail-cell future-plan" title="'+esc(meta.displayName)+' · '+iso+' · '+fmt(ph)+'h planned'+ptoNote+'">'
        +'<div class="fill" style="width:'+planW+'%;background:var(--orbe);opacity:0.4"></div>'
        +'<span class="lbl" style="color:var(--orbe)">'+fmt(ph)+'h'+(ptoH>4?'<span style="font-size:8px;opacity:.55"> +'+fmt(ptoH)+'⛔</span>':'')+'</span>'
        +'</div>';
    }
  }
  ```

- [ ] **Step 2.4 — Add PTO context to past-week cell tooltips**

  In the `if(w.status==='done')` block, add `ptoH` to the title attribute:

  Change the `html+=` line's `title` attribute from:
  ```js
  title="'+esc(meta.displayName)+' · '+iso+' · '+fmt(ph)+'h planned, '+fmt(th)+'h tracked"'
  ```
  To:
  ```js
  var ptoH=(DATA.personWeekPTO[np]||{})[iso]||0;
  // title:
  title="'+esc(meta.displayName)+' · '+iso+' · '+fmt(ph)+'h planned, '+fmt(th)+'h tracked'+(ptoH>0?' · '+fmt(ptoH)+'h PTO':'')+'"'
  ```

- [ ] **Step 2.5 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Dashboard.html
  git commit -m "feat(frontend): PTO-aware cell rendering in Team Availability (pto cell state, adjusted capacity)"
  ```

---

## Task 3 — Frontend: PTO category logic + sort + legend chip

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 3.1 — Update `personCats()` to include `pto` category**

  In `renderAvailability()`, replace the `personCats(pwp, pwt)` function with a version that accepts `pwp_pto` (the PTO hours map for this person):

  Change:
  ```js
  function personCats(pwp,pwt){
    var c={};
    var sumH=0,cntH=0;
    pastWeeks.forEach(function(w){
      var pl=(pwp[w.iso]||0),tr=(pwt[w.iso]||0);
      if(pl>0){sumH+=tr;cntH+=pl;if(tr>pl*1.05)c.over=true;}
    });
    var exec=cntH>0?sumH/cntH:null;
    if(exec!==null){if(exec>=tgt)c.high=true;else if(exec>=0.6)c.mid=true;else c.low=true;}
    var noplanCnt=futurWeeks.filter(function(w){return !((pwp[w.iso]||0)>0);}).length;
    if(noplanCnt>0)c.noplan=true;else if(futurWeeks.length>0)c['future-plan']=true;
    return c;
  }
  ```
  To:
  ```js
  function personCats(pwp,pwt,pwpto){
    var c={};
    var sumH=0,cntH=0;
    pastWeeks.forEach(function(w){
      var pl=(pwp[w.iso]||0),tr=(pwt[w.iso]||0);
      if(pl>0){sumH+=tr;cntH+=pl;if(tr>pl*1.05)c.over=true;}
    });
    var exec=cntH>0?sumH/cntH:null;
    if(exec!==null){if(exec>=tgt)c.high=true;else if(exec>=0.6)c.mid=true;else c.low=true;}
    var noplanReal=0, ptoFull=0;
    futurWeeks.forEach(function(w){
      var ph=(pwp[w.iso]||0), ptoH=(pwpto[w.iso]||0);
      var fullPTO=ptoH>=perPersonCap*PTO_FULL_THRESHOLD;
      if(!ph){
        if(fullPTO) ptoFull++;
        else noplanReal++;
      }
    });
    if(ptoFull>0&&noplanReal===0&&futurWeeks.length>0) c.pto=true;
    else if(ptoFull>0) c.pto=true;
    if(noplanReal>0) c.noplan=true;
    if(noplanReal===0&&ptoFull===0&&futurWeeks.length>0) c['future-plan']=true;
    return c;
  }
  ```

  Update the call site (in the filter loop) to pass `DATA.personWeekPTO[np]||{}`:
  ```js
  var cats=personCats(DATA.personWeekPlan[np]||{},DATA.personWeekTracked[np]||{},DATA.personWeekPTO[np]||{});
  ```

- [ ] **Step 3.2 — Update sort to not penalize PTO weeks**

  In the sort comparator, `aNoP`/`bNoP` should count only real no-plan weeks (not PTO-covered ones):

  Change:
  ```js
  var aNoP=futurWeeks.filter(function(w){return !((DATA.personWeekPlan[a]||{})[w.iso]);}).length;
  var bNoP=futurWeeks.filter(function(w){return !((DATA.personWeekPlan[b]||{})[w.iso]);}).length;
  ```
  To:
  ```js
  var aNoP=futurWeeks.filter(function(w){
    var ptoH=(DATA.personWeekPTO[a]||{})[w.iso]||0;
    return !((DATA.personWeekPlan[a]||{})[w.iso])&&ptoH<perPersonCap*PTO_FULL_THRESHOLD;
  }).length;
  var bNoP=futurWeeks.filter(function(w){
    var ptoH=(DATA.personWeekPTO[b]||{})[w.iso]||0;
    return !((DATA.personWeekPlan[b]||{})[w.iso])&&ptoH<perPersonCap*PTO_FULL_THRESHOLD;
  }).length;
  ```

- [ ] **Step 3.3 — Add `pto` to `CATS` legend chips**

  In the `CATS` array inside `renderAvailability()`, add after `noplan`:

  ```js
  {id:'pto', label:'on leave', sw:'background:var(--neutral)'}
  ```

- [ ] **Step 3.4 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Dashboard.html
  git commit -m "feat(frontend): PTO category in personCats, sort excludes PTO weeks, on-leave legend chip"
  ```

---

## Task 4 — Remove Risers & Fallers

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 4.1 — Delete HTML panel**

  Remove the entire `<!-- 3. Risers & Fallers -->` panel block (the `<div class="panel">` containing `#risers` and `#fallers`).

- [ ] **Step 4.2 — Delete `renderMovers()` function**

  Remove the full `renderMovers()` function.

- [ ] **Step 4.3 — Remove from `renderAll()`**

  Change:
  ```js
  renderRange(); renderWeekbar(); renderCapacity(); renderAvailability(); renderMovers();
  ```
  To:
  ```js
  renderRange(); renderWeekbar(); renderCapacity(); renderAvailability();
  ```

- [ ] **Step 4.4 — Remove CSS**

  Remove `.movergrid`, `.movercol`, `.ar` CSS rules.

- [ ] **Step 4.5 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Dashboard.html
  git commit -m "refactor(dashboard): remove Risers & Fallers panel (not actionable)"
  ```

---

## Task 5 — Remove standalone People & Blending panel

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 5.1 — Delete HTML panel**

  Remove the `<div class="panel">` block containing `#blendSpark`, `#blend`, `#blendDrill`, `#blendNote` (the "People & blending" panel inside `<!-- 4. Ranked demand + People & blending -->`). Keep the "Ranked demand" panel.

- [ ] **Step 5.2 — Remove `renderBlend()` function**

  Remove the full `renderBlend()` function.

- [ ] **Step 5.3 — Remove `BLEND_OPEN` state var and from `renderAll()`**

  Remove `BLEND_OPEN = false` from state vars. Remove `renderBlend()` from `renderAll()`.

  Also remove the `BLEND_OPEN=false` reset in the weekbar button onclick.

- [ ] **Step 5.4 — Remove CSS**

  Remove `.spark`, `.blend`, `.drill`, `.note` (blend-specific rules). Check each class is not used elsewhere before deleting.

- [ ] **Step 5.5 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Dashboard.html
  git commit -m "refactor(dashboard): remove standalone People & Blending panel (absorbed into Team Availability)"
  ```

---

## Task 6 — Blend distribution chart + blend filter in Team Availability

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 6.1 — Add `AVAIL_BLEND` state var**

  Near `AVAIL_TOPN` and `AVAIL_CAT`:
  ```js
  var AVAIL_BLEND = 0; // 0=All, 1, 2, 3, 4=4+
  ```

- [ ] **Step 6.2 — Add blend count helper**

  Add `blendCount(np, iso)` inside `renderAvailability()` (near `personCats`):

  ```js
  function blendCount(np, iso){
    var ppp=DATA.personProjectPlan[np]||{};
    var n=0;
    Object.keys(ppp).forEach(function(k){ if((ppp[k][iso]||0)>0) n++; });
    return n;
  }
  ```

- [ ] **Step 6.3 — Render blend distribution chart**

  Just before the grid `html` string starts, compute blend tier counts for the filtered+sorted people (before Top N slice), then render as horizontal bars:

  ```js
  var blendTiers=[0,0,0,0]; // [1proj, 2proj, 3proj, 4+proj]
  Object.keys(DATA.personMeta).filter(function(np){
    var m=DATA.personMeta[np];
    if(AVAIL_LOC&&m.location!==AVAIL_LOC) return false;
    if(AVAIL_MGR&&m.manager!==AVAIL_MGR) return false;
    if(AVAIL_FAM&&m.jobFamily!==AVAIL_FAM) return false;
    return true;
  }).forEach(function(np){
    var bc=blendCount(np,SEL_ISO);
    if(bc>=4) blendTiers[3]++;
    else if(bc===3) blendTiers[2]++;
    else if(bc===2) blendTiers[1]++;
    else if(bc===1) blendTiers[0]++;
  });
  var blendTotal=blendTiers.reduce(function(s,v){return s+v;},0)||1;
  var blendLabels=['1 project','2 projects','3 projects','4+ projects'];
  var blendColors=['var(--pos)','var(--orbe)','var(--amber)','var(--warn)'];
  var blendChart='<div style="margin-bottom:14px">'
    +'<div style="font-family:\'Roboto Condensed\';font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px">Blend · '+esc(SEL_ISO)+'</div>';
  blendTiers.forEach(function(cnt,i){
    var w=Math.round(cnt/blendTotal*100);
    blendChart+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
      +'<div style="width:90px;font-size:11px;color:var(--muted);flex:none">'+blendLabels[i]+'</div>'
      +'<div style="flex:1;height:8px;border-radius:4px;background:var(--border)">'
        +'<div style="width:'+w+'%;height:100%;border-radius:4px;background:'+blendColors[i]+'"></div>'
      +'</div>'
      +'<div style="width:28px;font-size:11px;font-weight:700;color:var(--text);text-align:right">'+cnt+'</div>'
      +'</div>';
  });
  blendChart+='</div>';
  ```

  Prepend `blendChart` to `html` before the grid.

- [ ] **Step 6.4 — Apply blend filter in person filter loop**

  In the `.filter()` call for `people`, add after the existing location/manager/family/cat checks:

  ```js
  if(AVAIL_BLEND>0){
    var bc=blendCount(np,SEL_ISO);
    var tier=bc>=4?4:bc;
    if(tier!==AVAIL_BLEND) return false;
  }
  ```

- [ ] **Step 6.5 — Add blend filter chips to `CATS` toggle area**

  These are a separate toggle group from the execution chips — add them as a second row in the legend/filter area at the bottom of `renderAvailability()`. They use the same `.avail-cat` class and `data-cat` but a different `data-` attribute (`data-blend`):

  ```js
  var blendChips=[
    {n:1,label:'1 project',   col:'var(--pos)'},
    {n:2,label:'2 projects',  col:'var(--orbe)'},
    {n:3,label:'3 projects',  col:'var(--amber)'},
    {n:4,label:'4+ projects', col:'var(--warn)'}
  ];
  html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">';
  if(AVAIL_BLEND>0){
    html+='<button class="avail-blend qchip on" data-blend="0" style="display:flex;align-items:center;gap:4px">✕ All</button>';
  }
  blendChips.forEach(function(c){
    var isOn=AVAIL_BLEND===c.n;
    html+='<button class="avail-blend qchip'+(isOn?' on':'')+'" data-blend="'+c.n+'" style="display:flex;align-items:center;gap:4px">'
      +'<span style="width:9px;height:9px;border-radius:1px;flex:none;background:'+c.col+'"></span>'
      +esc(c.label)+'</button>';
  });
  html+='</div>';
  ```

  Wire up after `container.innerHTML=html`:
  ```js
  Array.prototype.forEach.call(container.querySelectorAll('.avail-blend'),function(btn){
    btn.onclick=function(){ AVAIL_BLEND=+btn.dataset.blend; AVAIL_OPEN=null; renderAvailability(); };
  });
  ```

- [ ] **Step 6.6 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Dashboard.html
  git commit -m "feat(frontend): blend distribution chart + blend filter chips in Team Availability"
  ```

---

## Task 7 — Sticky filter bar (location, manager, job family + all chips)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 7.1 — Re-add `AVAIL_FAM` state var**

  Change:
  ```js
  var AVAIL_LOC = "", AVAIL_MGR = "", AVAIL_OPEN = null, AVAIL_TOPN = 15, AVAIL_CAT = "";
  ```
  To:
  ```js
  var AVAIL_LOC = "", AVAIL_FAM = "", AVAIL_MGR = "", AVAIL_OPEN = null, AVAIL_TOPN = 15, AVAIL_CAT = "", AVAIL_BLEND = 0;
  ```

  (Move `AVAIL_BLEND` here from Step 6.1 if Task 6 ran first.)

- [ ] **Step 7.2 — Add `.avail-filters` CSS**

  In the `<style>` block:

  ```css
  .avail-filters{
    position:sticky;top:0;z-index:10;
    background:var(--surface);
    border-bottom:1px solid var(--border);
    padding:10px 22px;
    margin:0 -22px 14px;
    display:flex;flex-wrap:wrap;gap:8px;align-items:center;
    box-shadow:0 2px 8px rgba(15,25,65,.06);
  }
  .avail-filter-summary{font-size:11px;color:var(--muted);padding:4px 0 0;width:100%}
  ```

- [ ] **Step 7.3 — Update `availPanel` HTML — move dropdowns + add job family**

  The `availPanel` panel-tools currently has the three dropdowns and `availTopN` toggle. Replace with a minimal panel-h (title + Top N only), and add a new `.avail-filters` div below it:

  Change:
  ```html
  <div class="panel" id="availPanel" style="display:none">
    <div class="panel-h">
      <h2>Team Availability</h2>
      <div class="panel-tools">
        <select class="sigfilter" id="availLoc"><option value="">All locations</option></select>
        <select class="sigfilter" id="availMgr"><option value="">All managers</option></select>
        <div class="chip-toggle" id="availTopN">
          <button data-n="15" class="on">Top 15</button>
          <button data-n="30">Top 30</button>
          <button data-n="999">All</button>
        </div>
      </div>
    </div>
    <div id="avail"></div>
  </div>
  ```
  To:
  ```html
  <div class="panel" id="availPanel" style="display:none">
    <div class="panel-h">
      <h2>Team Availability</h2>
      <div class="panel-tools">
        <div class="chip-toggle" id="availTopN">
          <button data-n="15" class="on">Top 15</button>
          <button data-n="30">Top 30</button>
          <button data-n="999">All</button>
        </div>
      </div>
    </div>
    <div class="avail-filters">
      <select class="sigfilter" id="availLoc"><option value="">All locations</option></select>
      <select class="sigfilter" id="availFam"><option value="">All job families</option></select>
      <select class="sigfilter" id="availMgr"><option value="">All managers</option></select>
      <div class="avail-filter-summary" id="availFilterSummary" style="display:none"></div>
    </div>
    <div id="avail"></div>
  </div>
  ```

- [ ] **Step 7.4 — Update `populateAvailFilters()` to include job family**

  Change:
  ```js
  function populateAvailFilters(){
    var dims=DATA.rosterDimensions||{locations:[],jobFamilies:[],managers:[]};
    function fill(id,items,cur,lbl){ ... }
    fill('availLoc',dims.locations,AVAIL_LOC,'All locations');
    fill('availMgr',dims.managers,AVAIL_MGR,'All managers');
    ['availLoc','availMgr'].forEach(function(id){
      var el=$(id);if(!el)return;
      el.onchange=function(){
        if(id==='availLoc')AVAIL_LOC=this.value;
        if(id==='availMgr')AVAIL_MGR=this.value;
        renderAvailability();
      };
    });
  }
  ```
  To:
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

- [ ] **Step 7.5 — Re-add `AVAIL_FAM` filter check in `renderAvailability()` person filter loop**

  In the `.filter()` call, add after `AVAIL_MGR` check:
  ```js
  if(AVAIL_FAM&&m.jobFamily!==AVAIL_FAM)return false;
  ```

- [ ] **Step 7.6 — Render active filter summary line**

  At the top of `renderAvailability()`, after the panel is shown, compute and update `#availFilterSummary`:

  ```js
  var filterParts=[];
  if(AVAIL_LOC)filterParts.push(esc(AVAIL_LOC));
  if(AVAIL_FAM)filterParts.push(esc(AVAIL_FAM));
  if(AVAIL_MGR)filterParts.push(esc(AVAIL_MGR));
  if(AVAIL_CAT){var catLabels={'high':'≥90%','mid':'60–90%','low':'<60%','over':'over-tracked','future-plan':'future: planned','noplan':'future: no plan','pto':'on leave'};filterParts.push(catLabels[AVAIL_CAT]||AVAIL_CAT);}
  if(AVAIL_BLEND>0)filterParts.push(AVAIL_BLEND===4?'4+ projects':AVAIL_BLEND+' project'+(AVAIL_BLEND>1?'s':''));
  var sumEl=$('availFilterSummary');
  if(sumEl){
    if(filterParts.length){
      sumEl.style.display='';
      sumEl.innerHTML='Filtered: '+filterParts.join(' · ')
        +' <button onclick="clearAvailFilters()" style="margin-left:8px;font-size:11px;color:var(--orbe);background:none;border:none;cursor:pointer;padding:0">Clear all</button>';
    } else {
      sumEl.style.display='none';
    }
  }
  ```

  Add `clearAvailFilters()` function near `toggleAvailDrill`:
  ```js
  function clearAvailFilters(){
    AVAIL_LOC='';AVAIL_FAM='';AVAIL_MGR='';AVAIL_CAT='';AVAIL_BLEND=0;
    populateAvailFilters();
    renderAvailability();
  }
  ```

- [ ] **Step 7.7 — Commit**

  ```bash
  git add docs/superpowers/project-demand-dashboard/Dashboard.html
  git commit -m "feat(frontend): sticky filter bar with location, job family, manager + Clear all summary"
  ```

---

## Final review

- [ ] Load dashboard with real data
- [ ] Verify PTO weeks show `PTO` cell (not `!`) for people on full leave
- [ ] Verify partial PTO shows `+Xh⛔` annotation on future-plan cells
- [ ] Verify `on leave` category filter shows only PTO-covered people
- [ ] Verify blend distribution chart reflects the filtered group (loc/mgr/fam)
- [ ] Verify blend filter chips are independent of execution chips (can combine them)
- [ ] Scroll Team Availability past the grid header — confirm sticky filter bar stays visible
- [ ] Click `Clear all` — confirm all dropdowns reset and grid shows full roster
- [ ] Confirm Risers & Fallers and People & Blending panels are gone
