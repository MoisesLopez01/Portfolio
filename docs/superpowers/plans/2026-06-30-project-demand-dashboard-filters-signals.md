# Project Demand Dashboard — FTE/Crew Filter + Signals Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FTE/Crew member-type filter to Team Availability, remove the week selector and Ranked Demand chart, and add a signal-first "Tracked vs Planned Signals" collapsible panel for CEO/manager consumption.

**Architecture:** One backend change (add `isCrew` flag to roster profiles in `Code.js`) and three frontend passes on `Dashboard.html`: (1) remove two elements, (2) add the crew filter select, (3) add the new signals panel with its render function. Each task is independently committable.

**Tech Stack:** Google Apps Script (GAS), vanilla JavaScript, HTML/CSS served via `HtmlService`. No build step — deploy by pasting files into the GAS editor.

**Spec:** `docs/superpowers/specs/2026-06-30-project-demand-dashboard-filters-signals-design.md`

---

## File Map

| File | What changes |
|---|---|
| `docs/superpowers/project-demand-dashboard/Code.js` | Add `isCrew` to `readRosterFull_()` profiles + `buildPersonAvailability_()` personMeta + new `_test_isCrew_()` |
| `docs/superpowers/project-demand-dashboard/Dashboard.html` | Remove weekbar HTML + `renderWeekbar()` + Ranked Demand HTML + `renderBars()`; add crew `<select>`; add Signals panel HTML + CSS + `renderSignals()` + extract `blendCount()` to module scope |

---

## Task 1: Backend — add `isCrew` to roster profiles (`Code.js`)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js:260-261` (profile object)
- Modify: `docs/superpowers/project-demand-dashboard/Code.js:402-409` (personMeta object)
- Modify: `docs/superpowers/project-demand-dashboard/Code.js` (add test function after `_test_personWeekPTO_`)

- [ ] **Step 1: Add the isCrew test function**

Open `Code.js`. After the closing brace of `_test_personWeekPTO_()` (end of file, around line 873), append:

```js
function _test_isCrew_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_isCrew_: " + msg); }

  var cases = [
    { title: "60.IC3. Software Engineer",  expect: false },
    { title: "60.M4. Engineering Manager", expect: false },
    { title: "Crew Member",                expect: true  },
    { title: "Senior Crew Member",         expect: true  },
    { title: "Contractor",                 expect: true  },
    { title: "Senior Contractor",          expect: true  },
    { title: "",                           expect: false },
  ];
  cases.forEach(function(c) {
    var result = /crew member|contractor/i.test(c.title);
    assert_(result === c.expect, "title '" + c.title + "' → expected " + c.expect + " got " + result);
  });
  Logger.log("✅ _test_isCrew_ passed");
}
```

- [ ] **Step 2: Run the test — verify it passes (regex is correct before any model changes)**

In the GAS editor: select `_test_isCrew_` from the function dropdown → Run → check Execution log.  
Expected: `✅ _test_isCrew_ passed`

- [ ] **Step 3: Add `isCrew` to profile objects in `readRosterFull_()`**

In `Code.js` at line 260-261, replace:

```js
      var lvlM  = title.match(/^\d{2,3}\.([A-Z]\d+)\./);
      profiles[norm(name)] = { location: loc, jobFamily: fam, manager: mgr, isManager: !!(lvlM && lvlM[1].charAt(0) === 'M') };
```

With:

```js
      var isCrew = /crew member|contractor/i.test(title);
      var lvlM   = title.match(/^\d{2,3}\.([A-Z]\d+)\./);
      profiles[norm(name)] = { location: loc, jobFamily: fam, manager: mgr, isManager: !!(lvlM && lvlM[1].charAt(0) === 'M'), isCrew: isCrew };
```

- [ ] **Step 4: Add `isCrew` to `personMeta` in `buildPersonAvailability_()`**

In `Code.js` at lines 402-409, replace:

```js
    personMeta[np] = {
      displayName: displayNames[np] || np,
      jobFamily:   prof.jobFamily  || '',
      manager:     prof.manager    || '',
      location:    prof.location   || '',
      isManager:   prof.isManager  || false,
      excluded:    excludedSet[np] || false
    };
```

With:

```js
    personMeta[np] = {
      displayName: displayNames[np] || np,
      jobFamily:   prof.jobFamily  || '',
      manager:     prof.manager    || '',
      location:    prof.location   || '',
      isManager:   prof.isManager  || false,
      isCrew:      prof.isCrew     || false,
      excluded:    excludedSet[np] || false
    };
```

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Code.js"
git commit -m "feat: add isCrew flag to roster profiles and personMeta (demand dashboard)"
```

---

## Task 2: Remove week selector and Ranked Demand chart (`Dashboard.html`)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 1: Remove the weekbar HTML element**

In `Dashboard.html` at line 205, delete this line entirely:

```html
    <div class="weekbar" id="weekbar"></div>
```

- [ ] **Step 2: Remove the Ranked Demand HTML panel**

Delete the entire `<!-- 4. Ranked demand -->` block (lines 293–306):

```html
    <!-- 4. Ranked demand + People & blending -->
    <div class="cols">
      <div class="panel">
        <div class="panel-h">
          <h2 id="rankTitle">Ranked demand</h2>
          <div class="panel-tools">
            <div class="hint">Top 12 · selected week</div>
            <button class="png-btn" data-png="ranked-demand">⬇ Save PNG</button>
          </div>
        </div>
        <div class="bars" id="bars"></div>
      </div>

    </div>
```

- [ ] **Step 3: Delete `renderWeekbar()` function**

In `Dashboard.html`, delete the `renderWeekbar` function (currently after `renderRange`):

```js
function renderWeekbar(){
  $('weekbar').innerHTML = WEEKS.map(function(w){
    var sel=w.iso===SEL_ISO?'sel':''; var cur=w.status==='now'?'current':'';
    return '<button class="weekbtn '+sel+' '+cur+'" data-iso="'+w.iso+'">'
      +'<div class="wk">'+esc(w.iso)+'</div>'
      +'<div class="st">'+STATUS_LABEL[w.status]+'</div>'
      +'</button>';
  }).join('');
  Array.prototype.forEach.call($('weekbar').children,function(b){ b.onclick=function(){ SEL_ISO=b.dataset.iso; AVAIL_OPEN=null; renderAll(); }; });
}
```

- [ ] **Step 4: Delete `renderBars()` function**

Delete:

```js
/* ---------------- Render: ranked bars ---------------- */
function renderBars(){
  var iso=SEL_ISO;
  var win=(DATA.winners[iso]&&DATA.winners[iso].key)||null;
  var arr=DATA.order.map(function(k){return {k:k,v:capAt(k,iso)};}).filter(function(x){return x.v>0.001;}).sort(function(a,b){return b.v-a.v;}).slice(0,12);
  var max=arr.length?arr[0].v:1;
  $('rankTitle').textContent='Ranked demand · '+iso;
  $('bars').innerHTML=arr.length?arr.map(function(x){
    return '<div class="bar"><div>'+chip(x.k)+'</div>'
      +'<div class="track"><div class="fill '+(x.k===win?'win':'')+'" style="width:'+Math.max(3,x.v/max*100)+'%"></div></div>'
      +'<div class="v">'+fmt(x.v)+' h</div></div>';
  }).join(''):'<div class="hint">No demand recorded for '+esc(iso)+'.</div>';
}
```

- [ ] **Step 5: Remove `renderWeekbar()` and `renderBars()` from `renderAll()`**

Replace:

```js
function renderAll(){
  renderRange(); renderWeekbar(); renderCapacity(); renderAvailability();
  renderBars(); renderHeat(); renderFoot();
}
```

With:

```js
function renderAll(){
  renderRange(); renderCapacity(); renderAvailability();
  renderSignals(); renderHeat(); renderFoot();
}
```

Note: `renderSignals` is added here now but implemented in Task 4. Leave it — the function will be defined before `renderAll` is called.

- [ ] **Step 6: Remove unused CSS classes**

In the `<style>` block, delete the weekbar-related rules (no longer referenced):

```css
/* Week selector */
.weekbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.weekbtn{position:relative;min-width:96px;text-align:left;padding:10px 12px;border-radius:11px;border:1px solid var(--border);background:var(--surface)}
.weekbtn .wk{font-family:'Roboto Condensed';font-weight:700;font-size:15px}
.weekbtn .st{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;color:var(--muted)}
.weekbtn.sel{border-color:var(--orbe);box-shadow:0 0 0 2px color-mix(in srgb,var(--orbe) 30%,transparent)}
.weekbtn.current{background:linear-gradient(180deg,color-mix(in srgb,var(--orbe) 10%,var(--surface)),var(--surface))}
```

Also delete the bar/ranked-demand rules:

```css
/* bars */
.bars{display:flex;flex-direction:column;gap:7px}
.bar{display:grid;grid-template-columns:64px 1fr 56px;align-items:center;gap:10px}
.bar .track{height:18px;background:var(--surface-2);border-radius:5px;overflow:hidden}
.bar .fill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--orbe),var(--royal))}
.bar .fill.win{background:linear-gradient(90deg,var(--june),var(--royal))}
.bar .v{text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted)}
```

Also delete the `.cols` and `@media` rule for it:

```css
/* two-col */
.cols{display:grid;grid-template-columns:1.25fr 1fr;gap:20px}
@media(max-width:900px){.cols{grid-template-columns:1fr}}
```

- [ ] **Step 7: Verify in browser**

Load the deployed GAS web-app URL. Verify:
- No week selector bar below the header
- No "Ranked demand" panel below the heatmap
- All other panels render (Planned vs Tracked, Team Availability, Heatmap)
- Console shows no JS errors

- [ ] **Step 8: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html"
git commit -m "feat: remove week selector and Ranked Demand chart from demand dashboard"
```

---

## Task 3: FTE/Crew filter in Team Availability (`Dashboard.html`)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 1: Add `AVAIL_CREW` state variable**

In the state block (around line 327), find:

```js
var AVAIL_LOC = "", AVAIL_FAM = "", AVAIL_MGR = "", AVAIL_ROLE = "", AVAIL_OPEN = null, AVAIL_TOPN = 15, AVAIL_CAT = "", AVAIL_BLEND = 0;
```

Replace with:

```js
var AVAIL_LOC = "", AVAIL_FAM = "", AVAIL_MGR = "", AVAIL_CREW = "", AVAIL_ROLE = "", AVAIL_OPEN = null, AVAIL_TOPN = 15, AVAIL_CAT = "", AVAIL_BLEND = 0;
```

- [ ] **Step 2: Add the crew `<select>` to the avail-filters bar**

In `Dashboard.html`, find the `avail-filters` div (around line 239). After the manager select and before the `chip-toggle` for role, insert:

```html
        <select class="sigfilter" id="availCrew">
          <option value="">All members</option>
          <option value="fte">FTE Only</option>
          <option value="crew">Crew Only</option>
        </select>
```

The full avail-filters section should read:

```html
      <div class="avail-filters">
        <select class="sigfilter" id="availLoc"><option value="">All locations</option></select>
        <select class="sigfilter" id="availFam"><option value="">All job families</option></select>
        <select class="sigfilter" id="availMgr"><option value="">All managers</option></select>
        <select class="sigfilter" id="availCrew">
          <option value="">All members</option>
          <option value="fte">FTE Only</option>
          <option value="crew">Crew Only</option>
        </select>
        <div class="chip-toggle" id="availRole">
          <button data-role="" class="on" onclick="AVAIL_ROLE='';syncRoleChip();renderAvailability()">All</button>
          <button data-role="m" onclick="AVAIL_ROLE='m';syncRoleChip();renderAvailability()">Mgrs</button>
          <button data-role="ic" onclick="AVAIL_ROLE='ic';syncRoleChip();renderAvailability()">ICs</button>
        </div>
        <div class="avail-filter-summary" id="availFilterSummary" style="display:none"></div>
      </div>
```

- [ ] **Step 3: Wire the crew select in `populateAvailFilters()`**

Find `populateAvailFilters()`. After the existing `['availLoc','availFam','availMgr'].forEach(...)` block, add:

```js
  var crewEl = $('availCrew');
  if (crewEl) {
    crewEl.value = AVAIL_CREW;
    crewEl.onchange = function() { AVAIL_CREW = this.value; renderAvailability(); };
  }
```

- [ ] **Step 4: Add crew filter predicate in `renderAvailability()`**

Find the people filter block inside `renderAvailability()`:

```js
  var people=Object.keys(DATA.personMeta).filter(function(np){
    var m=DATA.personMeta[np];
    if(m.excluded)return false;
    if(AVAIL_LOC&&m.location!==AVAIL_LOC)return false;
    if(AVAIL_MGR&&m.manager!==AVAIL_MGR)return false;
    if(AVAIL_FAM&&m.jobFamily!==AVAIL_FAM)return false;
    if(AVAIL_ROLE==='m'&&!m.isManager)return false;
    if(AVAIL_ROLE==='ic'&&m.isManager)return false;
```

Add the crew lines after `AVAIL_ROLE==='ic'`:

```js
    if(AVAIL_CREW==='fte'  && m.isCrew) return false;
    if(AVAIL_CREW==='crew' && !m.isCrew) return false;
```

- [ ] **Step 5: Add crew label to the filter summary**

Find the `filterParts` block inside `renderAvailability()`:

```js
  var filterParts=[];
  if(AVAIL_LOC)filterParts.push(esc(AVAIL_LOC));
  if(AVAIL_FAM)filterParts.push(esc(AVAIL_FAM));
  if(AVAIL_MGR)filterParts.push(esc(AVAIL_MGR));
  if(AVAIL_ROLE==='m')filterParts.push('Managers');
  if(AVAIL_ROLE==='ic')filterParts.push('ICs');
```

Add after the role lines:

```js
  if(AVAIL_CREW==='fte') filterParts.push('FTE only');
  if(AVAIL_CREW==='crew')filterParts.push('Crew only');
```

- [ ] **Step 6: Reset `AVAIL_CREW` in `clearAvailFilters()`**

Find:

```js
function clearAvailFilters(){
  AVAIL_LOC='';AVAIL_FAM='';AVAIL_MGR='';AVAIL_ROLE='';AVAIL_CAT='';AVAIL_BLEND=0;AVAIL_OPEN=null;
  populateAvailFilters();
  renderAvailability();
}
```

Replace with:

```js
function clearAvailFilters(){
  AVAIL_LOC='';AVAIL_FAM='';AVAIL_MGR='';AVAIL_CREW='';AVAIL_ROLE='';AVAIL_CAT='';AVAIL_BLEND=0;AVAIL_OPEN=null;
  populateAvailFilters();
  renderAvailability();
}
```

- [ ] **Step 7: Verify in browser**

Load the deployed GAS web app. In Team Availability:
- "All members" select is visible alongside location/family/manager dropdowns
- Selecting "FTE Only" hides all people whose job title matches `/crew member|contractor/i` on the roster
- Selecting "Crew Only" shows only those people
- "Clear all" resets the select back to "All members"
- All existing filters (location, family, manager, All/Mgrs/ICs, blend chips) still work

- [ ] **Step 8: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html"
git commit -m "feat: add FTE/Crew member-type filter to Team Availability panel"
```

---

## Task 4: Tracked vs Planned Signals panel (`Dashboard.html`)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

- [ ] **Step 1: Add CSS for the Signals panel**

In the `<style>` block, before the closing `</style>` tag, append:

```css
/* Tracked vs Planned Signals panel */
.sig-row{border-bottom:1px solid var(--border)}
.sig-row:last-child{border-bottom:none}
.sig-hdr{display:flex;align-items:center;gap:10px;padding:10px 4px;cursor:pointer;flex-wrap:wrap;border-radius:8px}
.sig-hdr:hover{background:var(--surface-2)}
.sig-arrow{font-size:10px;color:var(--muted);width:14px;flex:none}
.sig-iso{font-family:'Roboto Condensed';font-weight:700;font-size:14px;min-width:84px}
.sig-status{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;min-width:60px}
.sig-body{padding:8px 28px 14px}
.sig-group-lbl{font-family:'Roboto Condensed';font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:6px}
.sig-item{display:flex;align-items:center;gap:10px;padding:4px 0;flex-wrap:wrap}
.sig-name{font-weight:600;font-size:12.5px;min-width:120px}
.sig-detail{font-size:12px;color:var(--muted)}
.sig-ctx{font-size:11px;color:var(--slate);background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:1px 8px}
```

- [ ] **Step 2: Add the Signals panel HTML**

In `Dashboard.html`, between the closing `</div>` of the "Planned vs Tracked" panel and the opening `<div class="panel" id="availPanel"...>` of Team Availability, insert:

```html
    <!-- 1c. Tracked vs Planned Signals -->
    <div class="panel" id="signalsPanel" style="display:none">
      <div class="panel-h">
        <h2>Tracked vs Planned Signals</h2>
        <div class="hint">Per-week execution gaps with context · click a week to expand</div>
      </div>
      <div id="signals"></div>
    </div>
```

- [ ] **Step 3: Add `SIGNALS_OPEN_ISO` state variable**

In the state block, add after the `AVAIL_*` vars:

```js
var SIGNALS_OPEN_ISO = null;
```

- [ ] **Step 4: Extract `blendCount()` to module scope**

`blendCount` is currently a local function inside `renderAvailability()`. Move it to module scope, just before the `renderAvailability` function definition:

```js
function blendCount(np, iso){
  var ppp=DATA&&DATA.personProjectPlan&&DATA.personProjectPlan[np]||{};
  var n=0;
  Object.keys(ppp).forEach(function(k){ if((ppp[k][iso]||0)>0) n++; });
  return n;
}
```

Remove the local copy of this function from inside `renderAvailability()`.

- [ ] **Step 5: Add the `renderSignals()` function**

Insert the following function just before `renderAvailability()`:

```js
/* ---------------- Render: Tracked vs Planned Signals ---------------- */
function renderSignals(){
  var panel=$('signalsPanel'), container=$('signals');
  if(!panel||!container) return;
  if(!DATA||!DATA.personSignals||!NWEEKS){ panel.style.display='none'; return; }
  panel.style.display='';

  var tgt=DATA.planTarget||0.9;
  var html='';

  WEEKS.forEach(function(w){
    var iso=w.iso;
    var isFuture=w.status==='plan';
    var sigs=DATA.personSignals[iso]||{};
    var gaps=sigs.plannedNotTracked||[];
    var swarm=sigs.untrackedWorkers||[];
    var fid=(DATA.fidelity&&DATA.fidelity[iso]!=null)?DATA.fidelity[iso]:null;
    var planned=DATA.weekTotal[iso]||0;
    var isOpen=SIGNALS_OPEN_ISO===iso;

    // Fidelity chip (past/current only)
    var chipCls='',chipTxt='';
    if(!isFuture&&fid!==null){
      chipCls=fid>=tgt?'head':fid>=0.6?'tight':'over';
      chipTxt=Math.round(fid*100)+'% fidelity';
    }

    // Badge counts
    var badgeParts=[];
    if(!isFuture&&gaps.length)  badgeParts.push('⚠ '+gaps.length+' gap'+(gaps.length>1?'s':''));
    if(!isFuture&&swarm.length) badgeParts.push(swarm.length+' unplanned');

    html+='<div class="sig-row" data-iso="'+esc(iso)+'">';
    html+='<div class="sig-hdr">';
    html+='<span class="sig-arrow">'+(isOpen?'▼':'▶')+'</span>';
    html+='<span class="sig-iso">'+esc(iso)+'</span>';
    html+='<span class="sig-status">'+esc(STATUS_LABEL[w.status])+'</span>';
    if(chipTxt) html+='<span class="statuschip '+chipCls+'" style="font-size:10px;padding:2px 8px">'+esc(chipTxt)+'</span>';
    if(isFuture) html+='<span style="font-size:12px;color:var(--muted)">'+fmt(planned)+'h planned</span>';
    if(badgeParts.length) html+='<span style="font-size:12px;color:var(--muted)">'+esc(badgeParts.join(' · '))+'</span>';
    html+='</div>'; // .sig-hdr

    if(isOpen){
      html+='<div class="sig-body">';
      if(isFuture){
        html+='<span style="color:var(--muted);font-size:12px">'+fmt(planned)+'h planned across '+(DATA.activeProj[iso]||0)+' projects — tracking not yet available.</span>';
      } else if(gaps.length===0&&swarm.length===0){
        html+='<span style="color:var(--pos);font-size:12px">Execution on track — no gaps above threshold.</span>';
      } else {
        if(gaps.length){
          html+='<div class="sig-group-lbl">Planned but not tracking</div>';
          gaps.forEach(function(g){
            var np=String(g.name||'').toLowerCase().replace(/\s+/g,' ').trim();
            var ctx=[];
            var bc=blendCount(np,iso);
            if(bc>1) ctx.push('on '+bc+' projects');
            var ptoH=(DATA.personWeekPTO[np]||{})[iso]||0;
            if(ptoH>0) ctx.push('PTO that week');
            var dn=(DATA.personMeta[np]&&DATA.personMeta[np].displayName)||g.name;
            html+='<div class="sig-item">';
            html+='<span class="sig-name">'+esc(dn)+'</span>';
            html+='<span class="sig-detail">'+fmt(g.plannedHrs)+'h planned</span>';
            if(ctx.length) html+='<span class="sig-ctx">'+esc(ctx.join(' · '))+'</span>';
            html+='</div>';
          });
        }
        if(swarm.length){
          html+='<div class="sig-group-lbl" style="margin-top:10px">Tracking with no plan</div>';
          swarm.forEach(function(g){
            var np=String(g.name||'').toLowerCase().replace(/\s+/g,' ').trim();
            var dn=(DATA.personMeta[np]&&DATA.personMeta[np].displayName)||g.name;
            html+='<div class="sig-item">';
            html+='<span class="sig-name">'+esc(dn)+'</span>';
            html+='<span class="sig-detail">'+fmt(g.trackedHrs)+'h tracked · not in plan</span>';
            html+='</div>';
          });
        }
      }
      html+='</div>'; // .sig-body
    }
    html+='</div>'; // .sig-row
  });

  container.innerHTML=html;
  Array.prototype.forEach.call(container.querySelectorAll('.sig-hdr'),function(hdr){
    hdr.onclick=function(){
      var iso=hdr.parentElement.dataset.iso;
      SIGNALS_OPEN_ISO=SIGNALS_OPEN_ISO===iso?null:iso;
      renderSignals();
    };
  });
}
```

- [ ] **Step 6: Verify `renderSignals` is called from `renderAll()`**

Confirm the `renderAll()` call added in Task 2 Step 5 already includes `renderSignals()`:

```js
function renderAll(){
  renderRange(); renderCapacity(); renderAvailability();
  renderSignals(); renderHeat(); renderFoot();
}
```

If Task 2 was not yet done, add `renderSignals();` to `renderAll()` now.

- [ ] **Step 7: Verify in browser**

Load the deployed GAS web app. Verify:
- "Tracked vs Planned Signals" panel appears between "Planned vs Tracked" and "Team Availability"
- All 8 week rows are visible in collapsed state
- Past weeks show fidelity chip (green/amber/red) and gap/unplanned badge counts
- Future weeks show planned hours only, no fidelity chip
- Clicking a past week with gaps expands to list people, their planned hours, and context tags ("on N projects", "PTO that week")
- Clicking a healthy past week shows "Execution on track" one-liner
- Clicking a future week shows "tracking not yet available" one-liner
- Clicking the open week collapses it (accordion: only one open at a time)
- Theme toggle (light/dark) renders correctly — all colors use CSS variables

- [ ] **Step 8: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html"
git commit -m "feat: add Tracked vs Planned Signals collapsible panel to demand dashboard"
```

---

## Self-Review

**Spec coverage check:**
| Spec requirement | Task |
|---|---|
| Remove week selector bar | Task 2 Step 1 |
| Remove Ranked Demand chart | Task 2 Steps 2–4 |
| `isCrew` detection regex on job title | Task 1 Step 3 |
| `isCrew` on personMeta | Task 1 Step 4 |
| Crew `<select>` in avail-filters bar | Task 3 Steps 1–2 |
| Crew filter predicate in renderAvailability | Task 3 Steps 4–5 |
| Clear filters resets crew | Task 3 Step 6 |
| Signals panel between Planned vs Tracked and Team Availability | Task 4 Step 2 |
| Collapsed row: fidelity chip, gap count, unplanned count | Task 4 Step 5 |
| Expanded past week: gap signals with context | Task 4 Step 5 |
| Expanded healthy week: on-track one-liner | Task 4 Step 5 |
| Expanded future week: tracking not yet available | Task 4 Step 5 |
| No raw data tables | Enforced by signal-first renderSignals design |
| `blendCount` extracted to module scope | Task 4 Step 4 |

**Placeholder scan:** None found. All steps have exact code.

**Type consistency:** `isCrew` (boolean) defined in Task 1, read as `m.isCrew` in Task 3 — consistent. `SIGNALS_OPEN_ISO` (string|null) defined in Task 4 Step 3, used in Task 4 Step 5 — consistent. `blendCount(np, iso)` extracted in Task 4 Step 4, called in Task 4 Step 5 — consistent.
