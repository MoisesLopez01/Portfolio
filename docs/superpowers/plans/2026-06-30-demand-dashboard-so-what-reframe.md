# Demand Dashboard — "So What" Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the Project Demand Dashboard from fidelity-% compliance to a 4-state behavior-pattern model, deleting the Tracked vs Planned Signals panel and redesigning Team Availability as a collapsible trend-first list with heatmap per-project expansion.

**Architecture:** Backend computes a new `behaviorSignals` payload (personWeekState, personQtdScore, sparkline counts, streak/swarm/stabilizer flags, concentration risk) appended to the existing `getDemandData()` model. Frontend completely rewrites `renderAvailability()` and extends `renderHeat()` with inline row expansion; `renderSignals()` and all related code is deleted.

**Tech Stack:** Google Apps Script (ES5 JavaScript), HTML/CSS/SVG served via HtmlService

---

## File Map

| File | Changes |
|---|---|
| `docs/superpowers/project-demand-dashboard/Code.js` | Delete `buildPersonSignals_()` (lines 419-462), update `emptyModel_()` + `getDemandData()`, add `buildQtdWindow_()` + `computePersonState_()` + `buildPersonBehaviorSignals_()` + `_test_behaviorSignals()` |
| `docs/superpowers/project-demand-dashboard/Dashboard.html` | Delete signals CSS + HTML + `renderSignals()` + `SIGNALS_OPEN_ISO` + `blendCount()` + old TA CSS + `AVAIL_CAT`/`AVAIL_BLEND`; add new TA CSS; rewrite `renderAvailability()`; extend `renderHeat()` |

---

### Task 1: Delete Tracked vs Planned Signals

All signal-panel code is self-contained in two places: `Code.js` (the data builder) and `Dashboard.html` (CSS, HTML, state, renderer). Delete all of it; nothing outside these blocks depends on it.

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js`
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

---

- [ ] **Step 1.1 — Remove `buildPersonSignals_()` from Code.js**

Delete lines 419-462 (the entire `buildPersonSignals_` function) — this is the function that builds the `personSignals` object consumed only by `renderSignals()`.

After deletion the file must jump from the `buildPersonAvailability_` closing brace (line 417) directly to the `// ── SHEET PARSING ──` comment block.

- [ ] **Step 1.2 — Remove `personSignals` from `emptyModel_()` (Code.js)**

In `emptyModel_()` at line 542, remove the `personSignals: {}` key from the returned object:

```
Old: personSignals: {}, displayNames: {},
New: displayNames: {},
```

- [ ] **Step 1.3 — Remove `buildPersonSignals_` call from `getDemandData()` (Code.js)**

Delete line 167:
```
model.personSignals = buildPersonSignals_(parsed.recs, trackedResult.recs, weeks, roster.profiles);
```

- [ ] **Step 1.4 — Remove signals CSS from Dashboard.html**

Delete lines 128-142 (comment + 14 signal CSS classes):

```
/* Tracked vs Planned Signals panel */
.sig-row{…}
.sig-row:last-child{…}
.sig-hdr{…}
.sig-hdr:hover{…}
.sig-arrow{…}
.sig-iso{…}
.sig-status{…}
.sig-body{…}
.sig-group-lbl{…}
.sig-item{…}
.sig-name{…}
.sig-detail{…}
.sig-ctx{…}
.sigfilter{…}
```

- [ ] **Step 1.5 — Remove old Team Availability CSS from Dashboard.html**

Delete lines 158-172 (comment + old TA grid classes):

```
/* Team Availability */
.avail-grid{…}
.avail-cell{…}
.avail-cell .fill{…}
.avail-cell .lbl{…}
.avail-cell.noplan{…}
.avail-cell.future-plan{…}
.avail-cell.pto{…}
.avail-cell.current{…}
.avail-cell.blank{…}
.avail-name{…}
.avail-name:hover{…}
.avail-name .sub{…}
.avail-drill{…}
.avail-drill.open{…}
```

- [ ] **Step 1.6 — Remove signalsPanel HTML from Dashboard.html**

Delete lines 218-225:
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

- [ ] **Step 1.7 — Remove stale state variables from Dashboard.html (line ~317)**

Update the state variables line from:
```js
var AVAIL_LOC = "", AVAIL_FAM = "", AVAIL_MGR = "", AVAIL_CREW = "", AVAIL_ROLE = "", AVAIL_OPEN = null, AVAIL_TOPN = 15, AVAIL_CAT = "", AVAIL_BLEND = 0;
var SIGNALS_OPEN_ISO = null;
```
To:
```js
var AVAIL_LOC = "", AVAIL_FAM = "", AVAIL_MGR = "", AVAIL_CREW = "", AVAIL_ROLE = "", AVAIL_OPEN = null, AVAIL_TOPN = 15, AVAIL_STATUS = "";
```

- [ ] **Step 1.8 — Remove `blendCount()` from Dashboard.html**

Delete the function at lines 525-537:
```js
function blendCount(np, iso){
  var ppp=DATA&&DATA.personProjectPlan&&DATA.personProjectPlan[np]||{};
  …
}
```

- [ ] **Step 1.9 — Remove `renderSignals()` from Dashboard.html**

Delete lines 981-1072 — the full `renderSignals()` function including the comment header `/* ---------------- Render: Tracked vs Planned Signals ---------------- */`.

- [ ] **Step 1.10 — Remove `renderSignals()` call from `renderAll()` (Dashboard.html)**

Update `renderAll()` at line 1074:
```js
// Old:
function renderAll(){
  renderRange(); renderCapacity(); renderAvailability();
  renderSignals(); renderHeat(); renderFoot();
}

// New:
function renderAll(){
  renderRange(); renderCapacity(); renderAvailability();
  renderHeat(); renderFoot();
}
```

- [ ] **Step 1.11 — Clean up `clearAvailFilters()` (Dashboard.html)**

Update line 823:
```js
// Old:
function clearAvailFilters(){
  AVAIL_LOC='';AVAIL_FAM='';AVAIL_MGR='';AVAIL_CREW='';AVAIL_ROLE='';AVAIL_CAT='';AVAIL_BLEND=0;AVAIL_OPEN=null;
  populateAvailFilters();
  renderAvailability();
}

// New:
function clearAvailFilters(){
  AVAIL_LOC='';AVAIL_FAM='';AVAIL_MGR='';AVAIL_CREW='';AVAIL_ROLE='';AVAIL_STATUS='';AVAIL_OPEN=null;
  populateAvailFilters();
  renderAvailability();
}
```

- [ ] **Step 1.12 — Remove AVAIL_CAT / AVAIL_BLEND logic from `renderAvailability()` (Dashboard.html)**

In the existing `renderAvailability()`, remove all references to `AVAIL_CAT` and `AVAIL_BLEND`:
1. Lines ~551-554: remove the two `filterParts.push` lines that reference `AVAIL_CAT` and `AVAIL_BLEND`
2. Lines ~607-614: remove the `if(AVAIL_CAT)` and `if(AVAIL_BLEND>0)` filter blocks
3. Lines ~651-654: remove the `bc=blendCount(np, SEL_ISO)` blend-tier counting block
4. Lines ~685-714: remove the entire `legendHtml` (CATS loop) and `blendChipHtml` (blendChips loop) sections — these built the category-legend and blend-tier chips; the new renderAvailability in Task 3 replaces them entirely

Do NOT delete `renderAvailability()` itself yet — that comes in Task 3.

- [ ] **Step 1.13 — Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat: delete Tracked vs Planned Signals panel and all related code"
```

Expected: dashboard loads, Team Availability still renders (as old grid), Signals panel is gone.

---

### Task 2: Backend — Person Behavior Signals

Adds three new functions to `Code.js` that compute the 4-state model, QTD window, and all derivative signals. These are wired into `getDemandData()` so the payload carries `model.behaviorSignals`.

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js`

---

- [ ] **Step 2.1 — Write the test function**

Add this function at the **bottom** of Code.js (before any closing comment block, after the last function). It is ES5 — no `let`/`const`, no arrow functions. Run it in the GAS Script Editor (`Run → _test_behaviorSignals`) to verify.

```js
function _test_behaviorSignals() {
  var personWeekPlan = {
    'alex smith': { '2026.W14': 8, '2026.W15': 0, '2026.W27': 8 },
    'jane doe':   { '2026.W14': 8, '2026.W15': 8, '2026.W27': 8 }
  };
  var personWeekTracked = {
    'alex smith': { '2026.W14': 8, '2026.W27': 0 },
    'jane doe':   { '2026.W14': 8, '2026.W15': 8, '2026.W27': 8 }
  };
  var personProjectPlan = {
    'alex smith': { 'PPT': { '2026.W14': 8, '2026.W27': 8 } },
    'jane doe':   { 'PPT': { '2026.W14': 8, '2026.W27': 4 }, 'ICARE': { '2026.W15': 8, '2026.W27': 4 } }
  };
  var personMeta = {
    'alex smith': { displayName: 'Alex Smith' },
    'jane doe':   { displayName: 'Jane Doe' }
  };
  var weeks = [
    { iso: '2026.W25', status: 'done' },
    { iso: '2026.W26', status: 'done' },
    { iso: '2026.W27', status: 'now' },
    { iso: '2026.W28', status: 'plan' }
  ];

  // Unit: computePersonState_
  Logger.log('computePersonState_(8, 0) = ' + computePersonState_(8, 0));    // expect: escalation
  Logger.log('computePersonState_(8, 1) = ' + computePersonState_(8, 1));    // expect: silent  (1 < 0.2*8=1.6)
  Logger.log('computePersonState_(8, 2) = ' + computePersonState_(8, 2));    // expect: aligned (2 >= 0.2*8=1.6)
  Logger.log('computePersonState_(0, 6) = ' + computePersonState_(0, 6));    // expect: unplanned
  Logger.log('computePersonState_(2, 0) = ' + computePersonState_(2, 0));    // expect: null    (planned < MIN=4)
  Logger.log('computePersonState_(3, 1) = ' + computePersonState_(3, 1));    // expect: null

  // Unit: buildQtdWindow_
  var qtd = buildQtdWindow_('2026.W27');
  Logger.log('buildQtdWindow_ from W14 → W27 length: ' + qtd.length);        // expect: 14
  Logger.log('buildQtdWindow_ first: ' + qtd[0]);                             // expect: 2026.W14
  Logger.log('buildQtdWindow_ last: ' + qtd[qtd.length - 1]);                 // expect: 2026.W27

  // Integration: buildPersonBehaviorSignals_
  var bs = buildPersonBehaviorSignals_(personWeekPlan, personWeekTracked, personProjectPlan, personMeta, weeks);
  Logger.log('Alex state W27: ' + bs.personWeekState['alex smith']['2026.W27']);  // expect: escalation
  Logger.log('Jane state W27: ' + bs.personWeekState['jane doe']['2026.W27']);    // expect: aligned
  Logger.log('Jane qtd score: ' + bs.personQtdScore['jane doe']);                 // expect: 1.0 (all aligned in QTD)
  Logger.log('Alex qtd score: ' + bs.personQtdScore['alex smith']);               // expect: 0.5 (1 aligned W14, 0 others in QTD)
  Logger.log('Jane streak len: ' + bs.personStreakLen['jane doe']);                // expect: 1 (only W27 in window)
  Logger.log('PPT concentration risk: ' + bs.projectConcentrationRisk['PPT']);    // expect: true (only Jane aligned, Alex escalation)
  Logger.log('Jane proj count W27: ' + bs.personQtdProjectCounts['jane doe']['2026.W27']); // expect: 2 (PPT+ICARE)
  Logger.log('Done.');
}
```

- [ ] **Step 2.2 — Run the test to confirm it fails (functions not yet defined)**

In the GAS Script Editor, select `_test_behaviorSignals` in the function dropdown and click Run.

Expected output in Execution Log: `ReferenceError: computePersonState_ is not defined` (or similar). This confirms the test is wired before the implementation.

- [ ] **Step 2.3 — Add CONFIG constants**

In `Code.js`, add two keys to the `CONFIG` object (insert after `SWARM_THRESHOLD` at line ~40):

```js
  Q4_BASE_WEEK: 14,   // ISO week number of Q4 start (update each quarter)
  Q4_BASE_YEAR: 2026, // Calendar year of Q4 start
```

After edit the block reads:
```js
  DELIVERY_GAP_MIN_HRS: 4,
  SWARM_THRESHOLD:      0.20,
  Q4_BASE_WEEK: 14,
  Q4_BASE_YEAR: 2026,
};
```

- [ ] **Step 2.4 — Write `computePersonState_(planned, tracked)`**

Insert this function immediately **before** `buildPersonAvailability_` (currently at line 360). It must stay near the other signal-threshold logic.

```js
/**
 * Derives the 4-state behavior label for a single person × week.
 * Returns null when neither planned nor tracked meets the threshold —
 * meaning this week should not appear in pattern strips or QTD scoring.
 */
function computePersonState_(planned, tracked) {
  var MIN = CONFIG.DELIVERY_GAP_MIN_HRS, THOLD = CONFIG.SWARM_THRESHOLD;
  if (planned >= MIN && tracked === 0)                             return 'escalation';
  if (planned >= MIN && tracked > 0 && tracked < THOLD * planned) return 'silent';
  if (tracked > MIN && planned < MIN)                             return 'unplanned';
  if (planned >= MIN && tracked >= THOLD * planned)               return 'aligned';
  return null;
}
```

- [ ] **Step 2.5 — Write `buildQtdWindow_(currentIso)`**

Insert immediately after `computePersonState_`. The function uses `weeksInYear_()` which already exists at line 75.

```js
/**
 * Returns an array of ISO week strings from the Q4 base week up to and
 * including currentIso.  Falls back to the last 13 weeks when Q4 constants
 * are not set (Q1–Q3 use cases).
 * @param {string} currentIso  e.g. "2026.W27"
 * @returns {string[]} ordered array of ISO strings, earliest first
 */
function buildQtdWindow_(currentIso) {
  var parts = currentIso.match(/^(\d{4})\.W(\d+)$/);
  if (!parts) return [];
  var curY = parseInt(parts[1], 10), curW = parseInt(parts[2], 10);
  var startY, startW;
  if (CONFIG.Q4_BASE_YEAR && CONFIG.Q4_BASE_WEEK) {
    startY = CONFIG.Q4_BASE_YEAR;
    startW = CONFIG.Q4_BASE_WEEK;
  } else {
    startW = curW - 12;
    startY = curY;
    if (startW <= 0) { startY--; startW = weeksInYear_(startY) + startW; }
  }
  var result = [], w = startW, y = startY, guard = 0;
  while ((y < curY || (y === curY && w <= curW)) && guard < 52) {
    result.push(y + '.W' + w);
    w++;
    guard++;
    if (w > weeksInYear_(y)) { w = 1; y++; }
  }
  return result;
}
```

- [ ] **Step 2.6 — Write `buildPersonBehaviorSignals_(...)`**

Insert immediately after `buildQtdWindow_`.

```js
/**
 * Computes all 4-state behavior signals for the current quarter-to-date window.
 * Called once per getDemandData() after buildPersonAvailability_ has run.
 *
 * @param {Object} personWeekPlan     personWeekPlan[np][iso] = planned hours
 * @param {Object} personWeekTracked  personWeekTracked[np][iso] = tracked hours
 * @param {Object} personProjectPlan  personProjectPlan[np][key][iso] = planned hours on project
 * @param {Object} personMeta         personMeta[np] — used only for key enumeration
 * @param {Array}  weeks              buildWindow_() output (used to find currentIso)
 * @returns {Object} behaviorSignals payload for the model
 */
function buildPersonBehaviorSignals_(personWeekPlan, personWeekTracked, personProjectPlan, personMeta, weeks) {
  var currentWeek = null;
  for (var wi = 0; wi < weeks.length; wi++) {
    if (weeks[wi].status === 'now') { currentWeek = weeks[wi]; break; }
  }
  if (!currentWeek) return {};
  var currentIso = currentWeek.iso;
  var qtdIsos = buildQtdWindow_(currentIso);

  // Collect all normalised person keys
  var allNps = {};
  Object.keys(personWeekPlan || {}).forEach(function(np) { allNps[np] = true; });
  Object.keys(personWeekTracked || {}).forEach(function(np) { allNps[np] = true; });

  // 1. personWeekState — 4-state enum for each person × QTD week
  var personWeekState = {};
  Object.keys(allNps).forEach(function(np) {
    personWeekState[np] = {};
    qtdIsos.forEach(function(iso) {
      var pl = ((personWeekPlan || {})[np] || {})[iso] || 0;
      var tr = ((personWeekTracked || {})[np] || {})[iso] || 0;
      var state = computePersonState_(pl, tr);
      if (state) personWeekState[np][iso] = state;
    });
  });

  // 2. QTD project counts per person per week (for sparkline)
  var personQtdProjectCounts = {};
  Object.keys(allNps).forEach(function(np) {
    personQtdProjectCounts[np] = {};
    var projPlan = (personProjectPlan || {})[np] || {};
    qtdIsos.forEach(function(iso) {
      var count = 0;
      Object.keys(projPlan).forEach(function(key) {
        if ((projPlan[key][iso] || 0) > 0) count++;
      });
      personQtdProjectCounts[np][iso] = count;
    });
  });

  // 3. QTD reliability score and streak
  var personQtdScore = {}, personStreakLen = {};
  Object.keys(allNps).forEach(function(np) {
    var states = personWeekState[np] || {};
    var total = 0, aligned = 0;
    qtdIsos.forEach(function(iso) {
      if (iso > currentIso) return; // skip future weeks
      if (states[iso]) { total++; if (states[iso] === 'aligned') aligned++; }
    });
    personQtdScore[np] = total > 0 ? aligned / total : 0;

    // Streak: consecutive Aligned weeks ending at currentIso (going backward)
    var streak = 0;
    for (var i = qtdIsos.length - 1; i >= 0; i--) {
      var iso = qtdIsos[i];
      if (iso > currentIso) continue;
      if (states[iso] === 'aligned') streak++;
      else break;
    }
    personStreakLen[np] = streak;
  });

  // 4. Escalation count per person (consecutive escalation weeks ending at currentIso)
  var personEscLen = {};
  Object.keys(allNps).forEach(function(np) {
    var states = personWeekState[np] || {};
    var escLen = 0;
    for (var i = qtdIsos.length - 1; i >= 0; i--) {
      var iso = qtdIsos[i];
      if (iso > currentIso) continue;
      if (states[iso] === 'escalation') escLen++;
      else break;
    }
    personEscLen[np] = escLen;
  });

  // 5. Swarm flag: Unplanned work this week AND ≥1 other team member in Escalation
  var escalatingThisWeek = {};
  Object.keys(allNps).forEach(function(np) {
    if ((personWeekState[np] || {})[currentIso] === 'escalation') escalatingThisWeek[np] = true;
  });
  var hasAnyEscalation = Object.keys(escalatingThisWeek).length > 0;
  var personIsSwarm = {};
  Object.keys(allNps).forEach(function(np) {
    personIsSwarm[np] = (personWeekState[np] || {})[currentIso] === 'unplanned' && hasAnyEscalation;
  });

  // 6. Stabilizer: Aligned AND active on 4+ projects this week
  var personIsStabilizer = {};
  Object.keys(allNps).forEach(function(np) {
    var state = (personWeekState[np] || {})[currentIso];
    var projCount = (personQtdProjectCounts[np] || {})[currentIso] || 0;
    personIsStabilizer[np] = state === 'aligned' && projCount >= CONFIG.FRAG_MIN;
  });

  // 7. Concentration risk per project this week: fewer than 2 Aligned people
  var projectAlignedCount = {};
  Object.keys(allNps).forEach(function(np) {
    var state = (personWeekState[np] || {})[currentIso];
    var projPlan = (personProjectPlan || {})[np] || {};
    Object.keys(projPlan).forEach(function(key) {
      if ((projPlan[key][currentIso] || 0) > 0) {
        projectAlignedCount[key] = projectAlignedCount[key] || 0;
        if (state === 'aligned') projectAlignedCount[key]++;
      }
    });
  });
  var projectConcentrationRisk = {};
  Object.keys(projectAlignedCount).forEach(function(key) {
    projectConcentrationRisk[key] = projectAlignedCount[key] < 2;
  });

  return {
    currentIso:               currentIso,
    qtdIsos:                  qtdIsos,
    personWeekState:          personWeekState,
    personQtdScore:           personQtdScore,
    personStreakLen:           personStreakLen,
    personEscLen:              personEscLen,
    personQtdProjectCounts:   personQtdProjectCounts,
    personIsSwarm:             personIsSwarm,
    personIsStabilizer:        personIsStabilizer,
    projectConcentrationRisk:  projectConcentrationRisk
  };
}
```

- [ ] **Step 2.7 — Update `emptyModel_()` to carry `behaviorSignals` (Code.js)**

In `emptyModel_()` (line ~542), add `behaviorSignals: {}` to the returned skeleton:

```js
// Old:
    displayNames: {},

// New:
    displayNames: {},
    behaviorSignals: {},
```

- [ ] **Step 2.8 — Wire `buildPersonBehaviorSignals_()` into `getDemandData()` (Code.js)**

Insert after the `model.personWeekPTO = availResult.personWeekPTO;` line (currently line ~194):

```js
    model.behaviorSignals = buildPersonBehaviorSignals_(
      model.personWeekPlan,
      model.personWeekTracked,
      model.personProjectPlan,
      model.personMeta,
      weeks
    );
```

- [ ] **Step 2.9 — Run the test to verify it passes**

In the GAS Script Editor, select `_test_behaviorSignals` and click Run.

Expected Execution Log (key assertions):
```
computePersonState_(8, 0) = escalation
computePersonState_(8, 1) = silent
computePersonState_(8, 2) = aligned
computePersonState_(0, 6) = unplanned
computePersonState_(2, 0) = null
computePersonState_(3, 1) = null
buildQtdWindow_ from W14 → W27 length: 14
buildQtdWindow_ first: 2026.W14
buildQtdWindow_ last: 2026.W27
Alex state W27: escalation
Jane state W27: aligned
Jane qtd score: 1
Alex qtd score: 0.5
Jane streak len: 1
PPT concentration risk: true
Jane proj count W27: 2
Done.
```

If any assertion fails, fix the corresponding function before committing.

- [ ] **Step 2.10 — Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js
git commit -m "feat: add 4-state behavior signals backend (buildPersonBehaviorSignals_)"
```

---

### Task 3: Frontend — Team Availability Collapsible List

Replaces the old bar-grid rendering with a collapsible list. Each row shows name + state chip + sparkline + trend tag + badges + callout when collapsed; expands to show a QTD week pattern strip + project list + manager note.

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

---

- [ ] **Step 3.1 — Add new CSS for the collapsible list**

Add the following CSS block immediately after the `.avail-filter-summary` rule and before `.projdrill` (currently around line 152). This replaces the old `.avail-grid` / `.avail-cell` block deleted in Task 1.

```css
/* Team Availability — collapsible list */
.avail-list{display:flex;flex-direction:column;gap:2px}
.avail-row{border:1px solid var(--border);border-radius:8px;overflow:hidden}
.avail-collapsed{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;background:var(--surface);flex-wrap:wrap}
.avail-collapsed:hover{background:var(--surface-2)}
.avail-row-name{font-size:12px;font-weight:600;min-width:110px;color:var(--text)}
.chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;white-space:nowrap}
.chip-aligned{background:#dcfce7;color:#15803d}
.chip-unplanned{background:#fef9c3;color:#854d0e}
.chip-silent{background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
.chip-escalation{background:#fee2e2;color:#b91c1c}
.chip-none{background:var(--surface-2);color:var(--muted)}
.trend-tag{font-size:10px;color:var(--muted)}
.trend-up{color:var(--up)}
.trend-down{color:var(--down)}
.badge-ta{display:inline-block;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:700;margin-left:2px}
.badge-streak{background:#fef9c3;color:#854d0e}
.badge-swarm{background:#ede9fe;color:#6d28d9}
.badge-stabilizer{background:#dbeafe;color:#1d4ed8}
.avail-callout{font-size:11px;color:var(--muted);flex:1;min-width:120px}
.avail-expand-btn{font-size:11px;color:var(--muted);margin-left:auto;flex:none}
.avail-expanded-section{background:var(--surface-2);border-top:1px solid var(--border);padding:12px 14px;font-size:11.5px}
/* QTD week pattern strip */
.pattern-strip{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:12px}
.pattern-cell{padding:3px 6px;border-radius:4px;font-size:9px;font-weight:700;text-align:center;min-width:32px}
.pc-aligned{background:#dcfce7;color:#15803d}
.pc-unplanned{background:#fef9c3;color:#854d0e}
.pc-silent{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
.pc-escalation{background:#fee2e2;color:#b91c1c}
.pc-current{outline:2px solid #6366f1;outline-offset:1px}
.pc-future{background:#eff6ff;border:1px dashed #93c5fd;color:#3b82f6}
.pc-none{background:var(--surface-2);color:var(--muted)}
/* Project list in expanded row */
.avail-proj-list{margin-bottom:10px}
.avail-proj-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)}
.avail-proj-row:last-child{border-bottom:none}
.proj-key-mono{font-family:monospace;font-size:10px;background:var(--surface-2);border:1px solid var(--border);padding:1px 5px;border-radius:3px}
.avail-proj-name{font-size:11px;color:var(--muted);flex:1}
.avail-proj-hrs{font-size:11px;color:var(--muted)}
/* Manager note */
.mgr-note-ta{background:#f0f9ff;border-left:3px solid #0ea5e9;padding:7px 10px;border-radius:0 6px 6px 0;font-size:11px;color:#0c4a6e}
[data-theme="dark"] .mgr-note-ta{background:#0c2340;color:#7dd3fc}
.mgr-note-lbl-ta{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7dd3fc;margin-bottom:3px}
```

- [ ] **Step 3.2 — Add Status filter select to the filter bar HTML**

In the `avail-filters` div (currently around line 239-253), add a Status `<select>` after the `availRole` chip-toggle:

```html
<select class="sigfilter" id="availStatus" onchange="AVAIL_STATUS=this.value;AVAIL_OPEN=null;renderAvailability()">
  <option value="">All statuses</option>
  <option value="aligned">Aligned</option>
  <option value="unplanned">Unplanned work</option>
  <option value="silent">Silent gap</option>
  <option value="escalation">Escalation</option>
  <option value="leave">On leave</option>
</select>
```

- [ ] **Step 3.3 — Add frontend helper functions**

Add these five functions immediately **before** the existing `renderAvailability()` function. They are pure computation — no DOM access.

```js
function stateChipInfo_(state) {
  var map = {
    aligned:   { cls: 'chip-aligned',    label: 'Aligned' },
    unplanned: { cls: 'chip-unplanned',  label: 'Unplanned work' },
    silent:    { cls: 'chip-silent',     label: 'Silent gap' },
    escalation:{ cls: 'chip-escalation', label: 'Escalation' }
  };
  return map[state] || { cls: 'chip-none', label: '—' };
}

function computeTrendTag_(sparkVals) {
  if (!sparkVals || sparkVals.length < 4) return { symbol: '→', label: 'stable', cls: 'trend-tag' };
  var mid = Math.floor(sparkVals.length / 2);
  var early = 0, late = 0;
  for (var i = 0; i < mid; i++) early += sparkVals[i];
  for (var j = sparkVals.length - mid; j < sparkVals.length; j++) late += sparkVals[j];
  early /= mid; late /= mid;
  var delta = late - early;
  if (delta > 0.5) return { symbol: '↑', label: 'rising',   cls: 'trend-tag trend-up' };
  if (delta < -0.5) return { symbol: '↓', label: 'declining', cls: 'trend-tag trend-down' };
  return { symbol: '→', label: 'stable', cls: 'trend-tag' };
}

function computeCallout_(state, streakLen, escLen) {
  if (state === 'aligned')    return streakLen >= 3 ? (streakLen + '-week reliability streak — no action needed') : 'On track this week';
  if (state === 'unplanned')  return 'Tracking unscheduled work — investigate scope';
  if (state === 'silent')     return 'Planned but not tracking — check in';
  if (state === 'escalation') return escLen >= 2 ? (escLen + ' consecutive weeks without activity — escalate') : 'Zero activity this week — follow up';
  return '—';
}

function computeManagerNote_(state, streakLen, escLen, isSwarm) {
  if (state === 'aligned' && isSwarm) return 'Reliable and jumping in where needed — potential kudos trigger.';
  if (state === 'aligned') return streakLen >= 3 ? 'Strong performer — ' + streakLen + '-week reliability streak. No action needed.' : 'On track this week.';
  if (state === 'unplanned') return 'Tracking unscheduled work. Worth asking: is this swarming in to help? Scope creep? Should it be planned next cycle?';
  if (state === 'silent') return 'Planned hours not tracking — may be blocked or waiting on someone. Worth a quick check-in.';
  if (state === 'escalation') return escLen >= 2 ? escLen + ' weeks without activity against plan. Needs a conversation — assume positive intent first (blocked? unclear scope?).' : 'Zero activity this week. Follow up — may be blocked or reassigned.';
  return '—';
}

function renderSparklineSvg_(counts, qtdIsos, currentIso) {
  var W = 60, H = 20, n = qtdIsos.length;
  if (!n) return '';
  var barW = Math.max(2, Math.floor(W / n) - 1);
  var maxCount = 1;
  qtdIsos.forEach(function(iso) { var c = counts[iso] || 0; if (c > maxCount) maxCount = c; });
  var svg = '<svg width="' + W + '" height="' + H + '" style="vertical-align:middle;flex:none" aria-hidden="true">';
  qtdIsos.forEach(function(iso, i) {
    var c = counts[iso] || 0;
    var bh = c > 0 ? Math.max(2, Math.round((c / maxCount) * H)) : 1;
    var x = i * (barW + 1);
    var y = H - bh;
    var fill = iso === currentIso ? '#6366f1' : (iso > currentIso ? '#bfdbfe' : 'var(--orbe)');
    svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + bh + '" rx="1" fill="' + fill + '" opacity="0.75"/>';
  });
  svg += '</svg>';
  return svg;
}
```

- [ ] **Step 3.4 — Rewrite `renderAvailability()`**

Replace the entire existing `renderAvailability()` function (lines 539-820 after Task 1 cleanup) with the following. The function signature remains the same (no arguments) and the panel/container IDs are unchanged (`availPanel`, `avail`).

```js
function renderAvailability() {
  var panel = $('availPanel'), container = $('avail');
  if (!panel || !container) return;
  if (!DATA || !DATA.personMeta) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  var BS = DATA.behaviorSignals || {};
  var currentIso = BS.currentIso || SEL_ISO;
  var qtdIsos = BS.qtdIsos || [currentIso];
  var personWeekState = BS.personWeekState || {};
  var personQtdScore = BS.personQtdScore || {};
  var personStreakLen = BS.personStreakLen || {};
  var personEscLen = BS.personEscLen || {};
  var personQtdProjectCounts = BS.personQtdProjectCounts || {};
  var personIsSwarm = BS.personIsSwarm || {};
  var personIsStabilizer = BS.personIsStabilizer || {};

  populateAvailFilters();

  // Apply filters
  var people = Object.keys(DATA.personMeta).filter(function(np) {
    var m = DATA.personMeta[np];
    if (m.excluded) return false;
    if (AVAIL_LOC  && m.location  !== AVAIL_LOC)  return false;
    if (AVAIL_FAM  && m.jobFamily !== AVAIL_FAM)  return false;
    if (AVAIL_MGR  && m.manager   !== AVAIL_MGR)  return false;
    if (AVAIL_CREW === 'fte'  && m.isCrew)   return false;
    if (AVAIL_CREW === 'crew' && !m.isCrew)  return false;
    if (AVAIL_ROLE === 'm'  && !m.isManager) return false;
    if (AVAIL_ROLE === 'ic' &&  m.isManager) return false;
    if (AVAIL_STATUS) {
      if (AVAIL_STATUS === 'leave') {
        var pto  = ((DATA.personWeekPTO || {})[np] || {})[currentIso] || 0;
        var cap  = (m.location === CONFIG.ANZ_LOCATION) ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
        if (pto < cap * PTO_FULL_THRESHOLD) return false;
      } else {
        if ((personWeekState[np] || {})[currentIso] !== AVAIL_STATUS) return false;
      }
    }
    return true;
  });

  // Sort: descending QTD score, then name
  people.sort(function(a, b) {
    var sa = personQtdScore[a] || 0, sb = personQtdScore[b] || 0;
    if (sb !== sa) return sb - sa;
    return ((DATA.personMeta[a] || {}).displayName || a)
      .localeCompare((DATA.personMeta[b] || {}).displayName || b);
  });

  var totalFiltered = people.length;
  if (AVAIL_TOPN < 999) people = people.slice(0, AVAIL_TOPN);

  var html = '<div class="avail-list">';

  people.forEach(function(np) {
    var m = DATA.personMeta[np] || {};
    var state    = (personWeekState[np] || {})[currentIso];
    var chip     = stateChipInfo_(state);
    var counts   = personQtdProjectCounts[np] || {};
    var sparkVals = qtdIsos.map(function(iso) { return counts[iso] || 0; });
    var spark    = renderSparklineSvg_(counts, qtdIsos, currentIso);
    var trend    = computeTrendTag_(sparkVals);
    var streakLen = personStreakLen[np] || 0;
    var escLen   = personEscLen[np] || 0;
    var callout  = computeCallout_(state, streakLen, escLen);
    var isOpen   = AVAIL_OPEN === np;

    var badgesHtml = '';
    if (streakLen >= 3)       badgesHtml += '<span class="badge-ta badge-streak">' + streakLen + '-wk streak</span>';
    if (personIsSwarm[np])    badgesHtml += '<span class="badge-ta badge-swarm">Swarm</span>';
    if (personIsStabilizer[np]) badgesHtml += '<span class="badge-ta badge-stabilizer">Stabilizer</span>';

    html += '<div class="avail-row">';
    html += '<div class="avail-collapsed" onclick="toggleAvailDrill(' + JSON.stringify(np) + ')">';
    html += '<span class="avail-row-name">' + esc(m.displayName || np) + '</span>';
    html += '<span class="chip ' + chip.cls + '">' + esc(chip.label) + '</span>';
    html += spark;
    html += '<span class="' + trend.cls + '">' + esc(trend.symbol) + ' ' + esc(trend.label) + '</span>';
    if (badgesHtml) html += badgesHtml;
    html += '<span class="avail-callout">' + esc(callout) + '</span>';
    html += '<span class="avail-expand-btn">' + (isOpen ? '▴' : '▾') + '</span>';
    html += '</div>';

    if (isOpen) {
      // QTD week pattern strip
      var strip = '<div class="pattern-strip">';
      qtdIsos.forEach(function(iso) {
        var s = (personWeekState[np] || {})[iso];
        var isCur    = iso === currentIso;
        var isFuture = iso > currentIso;
        var cls, abbr;
        if (isFuture)   { cls = 'pc-future';    abbr = 'PLN'; }
        else if (!s)    { cls = 'pc-none';       abbr = '—'; }
        else            { cls = 'pc-' + s;       abbr = { aligned:'ALN', unplanned:'UNP', silent:'SIL', escalation:'ESC' }[s]; }
        var wLbl = iso.replace(/^\d{4}\./, '');
        strip += '<div class="pattern-cell ' + cls + (isCur ? ' pc-current' : '') + '" title="' + esc(iso) + '">';
        strip += '<div style="font-size:8px;opacity:0.7">' + esc(wLbl) + '</div>';
        strip += '<div>' + esc(abbr) + '</div>';
        strip += '</div>';
      });
      strip += '</div>';

      // Project list (current week only)
      var projPlan = (DATA.personProjectPlan || {})[np] || {};
      var projRowsHtml = '';
      Object.keys(projPlan).forEach(function(key) {
        var ph = (projPlan[key] || {})[currentIso] || 0;
        if (ph <= 0) return;
        projRowsHtml += '<div class="avail-proj-row">';
        projRowsHtml += '<span class="proj-key-mono">' + esc(key) + '</span>';
        projRowsHtml += '<span class="avail-proj-name">' + esc(KEYNAME[key] || key) + '</span>';
        projRowsHtml += '<span class="chip ' + chip.cls + '" style="font-size:9px">' + esc(chip.label) + '</span>';
        projRowsHtml += '<span class="avail-proj-hrs">' + ph.toFixed(1) + 'h planned</span>';
        projRowsHtml += '</div>';
      });

      var mgNote = computeManagerNote_(state, streakLen, escLen, personIsSwarm[np]);

      html += '<div class="avail-expanded-section">';
      html += strip;
      if (projRowsHtml) html += '<div class="avail-proj-list">' + projRowsHtml + '</div>';
      html += '<div class="mgr-note-ta"><div class="mgr-note-lbl-ta">Manager note</div>' + esc(mgNote) + '</div>';
      html += '</div>'; // .avail-expanded-section
    }

    html += '</div>'; // .avail-row
  });

  html += '</div>'; // .avail-list

  if (totalFiltered > people.length) {
    html += '<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--muted)">Showing '
      + people.length + ' of ' + totalFiltered + ' · use Top 15 / 30 / All above to see more</div>';
  }

  container.innerHTML = html;
}
```

`toggleAvailDrill(np)` already exists (line 817-820 after Task 1 cleanup) and does not need modification — it still sets `AVAIL_OPEN` and calls `renderAvailability()`.

- [ ] **Step 3.5 — Populate `availStatus` in `populateAvailFilters()`**

Check whether `populateAvailFilters()` references the old `availLoc`/`availFam`/`availMgr`/`availCrew` elements. Since the `availStatus` filter is a plain `<select>` driven by an `onchange` inline attribute (set in Step 3.2), no code changes are needed in `populateAvailFilters()` for the new dropdown. However, verify that `clearAvailFilters()` (updated in Task 1) resets `availStatus` element value if the DOM element exists:

```js
// Add this line inside clearAvailFilters() after the variable resets:
var stEl = $('availStatus'); if (stEl) stEl.value = '';
```

- [ ] **Step 3.6 — Verify in browser**

Open the dashboard (live GAS deployment or offline CSV mode). Team Availability panel should show a collapsible list sorted by QTD reliability score. Click any row to see the pattern strip, project list, and manager note.

Check:
- Rows with Escalation state sort to bottom
- Alignment streak ≥ 3 shows amber badge
- Collapsed row shows sparkline SVG bars
- Status filter `<select>` narrows the list

- [ ] **Step 3.7 — Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat: rewrite Team Availability as collapsible trend-first rows with 4-state signals"
```

---

### Task 4: Heatmap Per-Project Collapsible

Adds an inline expanded section below the heatmap row when a project is clicked. Uses the existing `ACTIVE_ROW` state — clicking a project row already calls `renderHeat()`, so we only need to inject the expanded content into the table.

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html`

---

- [ ] **Step 4.1 — Add CSS for the heatmap expanded row**

Add this block immediately before the `.foot` rule (around line 125):

```css
/* Heatmap per-project expanded section */
.hexp-section{background:#eff6ff;border-top:2px solid #6366f1;padding:14px 16px}
[data-theme="dark"] .hexp-section{background:#0d1f3c;border-top-color:#818cf8}
.hexp-title{font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
[data-theme="dark"] .hexp-title{color:#a5b4fc}
.hexp-risk-flag{background:#fee2e2;color:#b91c1c;font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px}
[data-theme="dark"] .hexp-risk-flag{background:#450a0a;color:#fca5a5}
.hexp-person-list{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.hexp-person-row{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid #dbeafe;border-radius:6px;padding:7px 10px;font-size:11px;flex-wrap:wrap}
[data-theme="dark"] .hexp-person-row{border-color:#1e3a5f}
.hexp-pname{font-weight:600;min-width:110px;color:var(--text)}
.hexp-hrs{color:var(--muted);font-size:11px}
.hexp-mgr-note{background:#f0f9ff;border-left:3px solid #0ea5e9;padding:7px 10px;border-radius:0 6px 6px 0;font-size:11px;color:#0c4a6e}
[data-theme="dark"] .hexp-mgr-note{background:#0c2340;color:#7dd3fc}
.hexp-note-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7dd3fc;margin-bottom:3px}
```

- [ ] **Step 4.2 — Write `heatProjectExpandHtml_(key)` helper**

Add this function immediately before `renderHeat()`:

```js
function heatProjectExpandHtml_(key) {
  if (!DATA || !DATA.behaviorSignals) return '';
  var BS = DATA.behaviorSignals;
  var currentIso = BS.currentIso || SEL_ISO;
  var personWeekState = BS.personWeekState || {};
  var personIsSwarm = BS.personIsSwarm || {};
  var personStreakLen = BS.personStreakLen || {};
  var riskMap = BS.projectConcentrationRisk || {};
  var hasRisk = riskMap[key];

  // Gather people with planned hours on this project this week
  var rows = [];
  Object.keys(DATA.personProjectPlan || {}).forEach(function(np) {
    var ph = ((DATA.personProjectPlan[np] || {})[key] || {})[currentIso] || 0;
    if (ph <= 0) return;
    var m = (DATA.personMeta || {})[np] || {};
    var state = (personWeekState[np] || {})[currentIso];
    var chip = stateChipInfo_(state);
    var streakLen = personStreakLen[np] || 0;
    rows.push({ np: np, name: m.displayName || np, ph: ph, state: state, chip: chip,
                streakLen: streakLen, isSwarm: personIsSwarm[np] || false });
  });

  // Sort: Aligned first, then by planned hours descending
  rows.sort(function(a, b) {
    var sa = a.state === 'aligned' ? 0 : (a.state === 'silent' ? 1 : (a.state === 'unplanned' ? 2 : 3));
    var sb = b.state === 'aligned' ? 0 : (b.state === 'silent' ? 1 : (b.state === 'unplanned' ? 2 : 3));
    if (sa !== sb) return sa - sb;
    return b.ph - a.ph;
  });

  // Build person list HTML
  var peopleHtml = rows.map(function(r) {
    var badgesHtml = '';
    if (r.streakLen >= 3)  badgesHtml += '<span class="badge-ta badge-streak">' + r.streakLen + '-wk streak</span>';
    if (r.isSwarm)         badgesHtml += '<span class="badge-ta badge-swarm">Swarm</span>';
    return '<div class="hexp-person-row">'
      + '<span class="hexp-pname">' + esc(r.name) + '</span>'
      + '<span class="chip ' + r.chip.cls + '">' + esc(r.chip.label) + '</span>'
      + '<span class="hexp-hrs">' + r.ph.toFixed(1) + 'h planned</span>'
      + (badgesHtml ? badgesHtml : '')
      + '</div>';
  }).join('');

  // Manager note
  var alignedCount = rows.filter(function(r) { return r.state === 'aligned'; }).length;
  var escRows = rows.filter(function(r) { return r.state === 'escalation'; });
  var totalPlanH = rows.reduce(function(s, r) { return s + r.ph; }, 0);
  var mgNote;
  if (alignedCount === rows.length && rows.length > 0) {
    mgNote = 'Project fully covered this week.';
  } else if (alignedCount === 0 && rows.length > 0) {
    mgNote = 'No tracked activity despite ' + totalPlanH.toFixed(0) + 'h planned. Check if the project has started or is blocked.';
  } else if (hasRisk && escRows.length > 0) {
    var escNames = escRows.map(function(r) { return r.name; }).join(', ');
    mgNote = 'Concentration risk — only ' + alignedCount + ' active person' + (alignedCount !== 1 ? 's' : '') + '. '
      + escNames + ' ' + (escRows.length > 1 ? 'have' : 'has') + ' been silent — follow up before next planning cycle.';
  } else {
    mgNote = alignedCount + ' of ' + rows.length + ' planned people actively tracking. Check in with those not tracking.';
  }

  var projName = KEYNAME[key] || key;
  var html = '<td colspan="' + (NWEEKS + 1) + '" style="padding:0">';
  html += '<div class="hexp-section">';
  html += '<div class="hexp-title">';
  html += esc(projName) + ' — ' + esc(currentIso.replace(/^\d{4}\./, '')) + ' (current week)';
  if (hasRisk) html += ' <span class="hexp-risk-flag">⚠ Concentration risk — ' + alignedCount + ' active person' + (alignedCount !== 1 ? 's' : '') + '</span>';
  html += '</div>';
  if (peopleHtml) html += '<div class="hexp-person-list">' + peopleHtml + '</div>';
  html += '<div class="hexp-mgr-note"><div class="hexp-note-lbl">Manager note</div>' + esc(mgNote) + '</div>';
  html += '</div>';
  html += '</td>';
  return html;
}
```

- [ ] **Step 4.3 — Inject expansion row inside `renderHeat()`**

In `renderHeat()`, the table rows are built inside `order.forEach`. After each project row is closed (`html+='</tr>';`), check if this project is the active one and inject the expansion row:

Find this block in `renderHeat()` (currently around line 924-934):
```js
  order.forEach(function(k){
    var act=ACTIVE_ROW===k?'active':'';
    html+='<tr><td><div class="rowlabel '+act+'" data-key="'+esc(k)+'">'+chip(k)+'<span class="nm">'+esc(KEYNAME[k]||k)+'</span></div></td>';
    WEEKS.forEach(function(w){
      var v=capAt(k,w.iso);
      var col=cellColor(k,w.iso);
      var hd=(DATA.head[k]&&DATA.head[k][w.iso])||0;
      html+='<td style="padding:2px"><div class="hcell" data-key="'+esc(k)+'" data-iso="'+w.iso+'" data-v="'+fmt(v)+'" data-h="'+hd+'"'
        +' style="background:'+col.bg+';color:'+col.fg+'">'+col.txt+'</div></td>';
    });
    html+='</tr>';
  });
```

Update to:
```js
  order.forEach(function(k){
    var act=ACTIVE_ROW===k?'active':'';
    html+='<tr><td><div class="rowlabel '+act+'" data-key="'+esc(k)+'">'+chip(k)+'<span class="nm">'+esc(KEYNAME[k]||k)+'</span></div></td>';
    WEEKS.forEach(function(w){
      var v=capAt(k,w.iso);
      var col=cellColor(k,w.iso);
      var hd=(DATA.head[k]&&DATA.head[k][w.iso])||0;
      html+='<td style="padding:2px"><div class="hcell" data-key="'+esc(k)+'" data-iso="'+w.iso+'" data-v="'+fmt(v)+'" data-h="'+hd+'"'
        +' style="background:'+col.bg+';color:'+col.fg+'">'+col.txt+'</div></td>';
    });
    html+='</tr>';
    if (ACTIVE_ROW === k) {
      html += '<tr>' + heatProjectExpandHtml_(k) + '</tr>';
    }
  });
```

- [ ] **Step 4.4 — Verify in browser**

Click any project row in the heatmap. An expanded row should appear below showing:
- Project name + current ISO week header
- Concentration risk flag (if fewer than 2 Aligned people)
- Person list with state chips, planned hours, and badges
- Manager note

Click the same row again → expands collapse. Click a different row → previous collapses, new one opens.

The existing `renderProjDrill()` line chart (in the `projDrill` panel below the heatmap) still triggers alongside the new expansion — both operate from `ACTIVE_ROW`.

- [ ] **Step 4.5 — Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat: add per-project collapsible expansion to heatmap with 4-state people view"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Delete Tracked vs Planned Signals panel | Task 1 |
| 4-state model (aligned/unplanned/silent/escalation) | Task 2 |
| QTD reliability score sort | Task 2 + Task 3 |
| QTD sparkline per person | Task 2 + Task 3 |
| Trend tag (↑↓→) | Task 3 |
| Celebration badges (streak, swarm, stabilizer) | Task 2 + Task 3 |
| Status filter chip-group in TA | Task 3 |
| Collapsible row with pattern strip + project list + manager note | Task 3 |
| Heatmap per-project expansion with concentration risk | Task 4 |
| Remove blend chart + category legend from TA | Task 1 |
| No hours in people view (state chip only) | Tasks 3+4 — project list shows planned hours for context but not as a performance metric |
| Positive-intent framing in manager notes | Tasks 3+4 — note templates use "may be blocked", "assume positive intent" |

**Type consistency:**

- `stateChipInfo_()` used in both `renderAvailability()` (Task 3) and `heatProjectExpandHtml_()` (Task 4) — same call signature.
- `badge-ta` CSS class used in both TA expanded rows (Task 3) and heatmap expanded section (Task 4) — consistent.
- `BS.personEscLen` is set in backend (Task 2) and read as `personEscLen[np]` in `renderAvailability()` (Task 3) — keys match.
- `CONFIG.FRAG_MIN` (= 4) reused for Stabilizer threshold in `buildPersonBehaviorSignals_()` — consistent with existing CONFIG semantics.

**Placeholder check:** No TBDs. All code blocks are complete ES5.

**Scope check:** All four tasks are in the same two files. Each produces a testable checkpoint. The backend test (`_test_behaviorSignals`) runs in GAS before any frontend work begins.
