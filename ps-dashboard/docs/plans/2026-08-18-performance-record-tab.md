# Performance Record Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 📈 Performance Record tab (admin + manager) to the PS Contribution dashboard: one row per rocketeer, per-metric micro charts with R/Y/G signal dots over 2 closed fiscal quarters + QTD, deterministic signal notes, drill-down evidence panel, flagged-only filter, sorting, CSV export.

**Architecture:** Server widens the per-employee week window from two to three fiscal quarters (the only server change). Everything else is client-side in `PS Dashboard.html`: a pure, sentinel-delimited signal engine (unit-tested via node), a memoized model builder that reuses `computeRkScore` and `periodBucketsForEmp_`, and a renderer wired through the existing `VIEWS`/`renderAll` dispatch.

**Tech Stack:** Google Apps Script (server), vanilla JS single-file SPA (`PS Dashboard.html`), node for offline checks. No Chart.js for micro bars (inline divs).

**Spec:** `ps-dashboard/docs/specs/2026-08-18-performance-record-tab-design.md`

**Working directory:** `D:\Contribution` (git repo, local-only — NEVER push). All paths below relative to repo root.

**Conventions that bind every task:**
- `PS Dashboard.html` uses `var` + ES5-style functions in its `<script>` — match it. `PS Contribution Report.js` uses `const`/arrow — match it.
- Private helpers end in `_`. New client globals are prefixed `pr`/`perf` to avoid collisions.
- Signal colours: green `#00875A`, yellow `#FF991F`, red `#DE350B`, gray `#C1C7D0` (Confluence palette already used in the file).
- After every `PS Dashboard.html` edit, run the syntax check (Task 2 Step 5) before committing.

---

## File Structure

| File | Role |
|---|---|
| `ps-dashboard/PS Contribution Report.js` (modify) | fiscal context prev2 fields, 3-quarter continuity window, third goals run, `TRACKED_HIST_WEEKS` 27→41 |
| `ps-dashboard/PS Dashboard.html` (modify) | VIEWS entry, pane HTML, CSS, pure signal engine (sentinel-delimited), model builder, renderer, drill, CSV |
| `ps-dashboard/tests/fiscal-window-checks.js` (create) | node checks for the server window widening |
| `ps-dashboard/tests/perf-record-checks.js` (create) | node checks for the pure signal engine |
| `CLAUDE.md` (modify) | document the new tab in the navigation section |

---

### Task 1: Server — widen the continuity window to three fiscal quarters

**Files:**
- Modify: `ps-dashboard/PS Contribution Report.js` (anchors: `CONFIG_PS.TRACKED_HIST_WEEKS` ~line 62, `buildPrevQWeeks_PS_` ~line 1487, `computeFiscalContext_` return ~line 1572, `getPSReportData` assembly ~lines 3995–4042)
- Test: `ps-dashboard/tests/fiscal-window-checks.js`

- [ ] **Step 1: Write the failing test**

Create `ps-dashboard/tests/fiscal-window-checks.js`:

```js
// Node checks for the 3-quarter continuity window (spec 2026-08-18 §3).
// Run: node "ps-dashboard/tests/fiscal-window-checks.js"
const fs = require('fs');
const path = require('path');
global.Logger = { log: function () {} };
eval(fs.readFileSync(path.join(__dirname, '..', 'PS Contribution Report.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── prev2 quarter labels across three reference dates ────────────────────────
// FY starts July 1. 2026-08-18 sits in FY27Q1 → prev = FY26Q4, prev2 = FY26Q3.
const ctxAug = computeFiscalContext_(new Date('2026-08-18'));
ck('Aug: prevGoalsQuarter FY26Q4',   ctxAug.prevGoalsQuarter  === 'FY26Q4');
ck('Aug: prev2GoalsQuarter FY26Q3',  ctxAug.prev2GoalsQuarter === 'FY26Q3');

// 2026-01-15 sits in FY26Q3 → prev = FY26Q2 (Oct–Dec 25), prev2 = FY26Q1 (Jul–Sep 25).
const ctxJan = computeFiscalContext_(new Date('2026-01-15'));
ck('Jan: prevGoalsQuarter FY26Q2',   ctxJan.prevGoalsQuarter  === 'FY26Q2');
ck('Jan: prev2GoalsQuarter FY26Q1',  ctxJan.prev2GoalsQuarter === 'FY26Q1');

// 2025-11-01 sits in FY26Q2 → prev = FY26Q1, prev2 = FY25Q4 (crosses the FY boundary).
const ctxNov = computeFiscalContext_(new Date('2025-11-01'));
ck('Nov: prevGoalsQuarter FY26Q1',   ctxNov.prevGoalsQuarter  === 'FY26Q1');
ck('Nov: prev2GoalsQuarter FY25Q4',  ctxNov.prev2GoalsQuarter === 'FY25Q4');

// ── prev2 tiles against prev with no gap (same check style as the existing
//    rollover continuity test): last prev2 week and first prev week are either
//    the same ISO label (mid-week quarter boundary) or calendar-adjacent. ─────
[ctxAug, ctxJan, ctxNov].forEach(function (ctx, i) {
  const p2 = buildPrev2QWeeks_PS_(ctx);
  const p1 = buildPrevQWeeks_PS_(ctx);
  ck('ctx' + i + ': prev2 window non-empty (12–14 weeks)', p2.length >= 12 && p2.length <= 14);
  const lastP2 = p2[p2.length - 1], firstP1 = p1[0];
  const gapDays = Math.round((new Date(firstP1.monday) - new Date(lastP2.sunday)) / 86400000) - 1;
  ck('ctx' + i + ': prev2→prev adjacent (shared label or 0-day gap)',
     lastP2.label === firstP1.label || gapDays === 0);
});

// ── Dedupe logic: three windows concatenated the way getPSReportData does it
//    must contain each ISO label exactly once, current-most copy winning. ─────
const p2 = buildPrev2QWeeks_PS_(ctxAug);
const p1 = buildPrevQWeeks_PS_(ctxAug);
const cur = buildCurrentQWeeks_PS_(ctxAug);
const curLabels = new Set(cur.map(w => w.label));
const p1Labels  = new Set(p1.map(w => w.label));
const continuity = p2.filter(w => !p1Labels.has(w.label) && !curLabels.has(w.label))
  .concat(p1.filter(w => !curLabels.has(w.label)))
  .concat(cur);
const seen = new Set();
let dupes = 0;
continuity.forEach(w => { if (seen.has(w.label)) dupes++; seen.add(w.label); });
ck('3-quarter continuity has no duplicate labels', dupes === 0);
ck('3-quarter continuity spans ≥ 32 weeks (2 closed quarters + QTD as of Aug)', continuity.length >= 32);

// ── TRACKED_HIST_WEEKS must cover the widened window (3 quarters ≈ 40 weeks;
//    extWeeks = TRACKED_HIST_WEEKS + WEEKS_PAST rolling weeks must be ≥ it). ──
ck('TRACKED_HIST_WEEKS + WEEKS_PAST ≥ 41',
   CONFIG_PS.TRACKED_HIST_WEEKS + CONFIG_PS.WEEKS_PAST >= 41);

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node "ps-dashboard/tests/fiscal-window-checks.js"`
Expected: crash or failures — `prev2GoalsQuarter` is undefined and `buildPrev2QWeeks_PS_` is not defined.

- [ ] **Step 3: Add prev2 fields to `computeFiscalContext_`**

In `ps-dashboard/PS Contribution Report.js`, find the existing prev-quarter block (it ends at `var prevQEndIsoYear   = isoWeekYear_PS_(prevQEndDate);` ~line 1559). Insert directly AFTER that line:

```js
  // Prev-prev quarter (spec 2026-08-18 §3: the Performance Record window is two
  // completed quarters + QTD). Derived the same way prev is: start = 3 months
  // before prev start; end = the day before prev starts.
  var p2StartM = pqStartM - 3, p2StartY = pqStartY;
  if (p2StartM < 1) { p2StartM += 12; p2StartY--; }
  var p2qNum = pqNum - 1, prev2FyLabel = prevFyLabel;
  if (p2qNum < 1) { p2qNum = 4; prev2FyLabel = "FY" + String(parseInt(prevFyLabel.slice(2), 10) - 1); }
  var prev2GoalsQuarter  = prev2FyLabel + "Q" + p2qNum;                    // "FY26Q3"
  var prev2QStartDate    = new Date(p2StartY, p2StartM - 1, 1);
  var prev2QStartIsoWeek = isoWeekNum_PS_(prev2QStartDate);
  var prev2QStartIsoYear = isoWeekYear_PS_(prev2QStartDate);
  var prev2QEndDate      = new Date(pqStartY, pqStartM - 1, 0);            // day before prev starts
  var prev2QEndIsoWeek   = isoWeekNum_PS_(prev2QEndDate);
  var prev2QEndIsoYear   = isoWeekYear_PS_(prev2QEndDate);
```

Then in the same function's `return {...}` (~line 1572), after the `prevQEndIsoWeek: prevQEndIsoWeek, prevQEndIsoYear: prevQEndIsoYear,` line, add:

```js
    prev2GoalsQuarter: prev2GoalsQuarter,
    prev2QStartIsoWeek: prev2QStartIsoWeek, prev2QStartIsoYear: prev2QStartIsoYear,
    prev2QEndIsoWeek: prev2QEndIsoWeek, prev2QEndIsoYear: prev2QEndIsoYear,
```

- [ ] **Step 4: Extract the shared week-range builder and add `buildPrev2QWeeks_PS_`**

Replace the whole existing `buildPrevQWeeks_PS_` function (~lines 1483–1502, keep its doc comment) with:

```js
// Returns every week between the given ISO bounds inclusive (oldest-first).
// Shared by the prev / prev2 quarter builders so the two can never drift.
function buildWeeksRange_PS_(startIsoYear, startIsoWeek, endIsoYear, endIsoWeek) {
  var today    = new Date();
  var curW     = isoWeekNum_PS_(today);
  var curY     = isoWeekYear_PS_(today);
  var todayMon = mondayOfIsoWeek_PS_(curY, curW);
  var weeks    = [];
  var w = startIsoWeek, y = startIsoYear;
  while (y < endIsoYear || (y === endIsoYear && w <= endIsoWeek)) {
    var entryMon = mondayOfIsoWeek_PS_(y, w);
    var off      = Math.round((entryMon - todayMon) / 86400000) / 7;
    weeks.push(makeWeekEntry_PS_(y, w, off));
    w++;
    if (w > weeksInYear_PS_(y)) { w = 1; y++; }
  }
  return weeks;
}

// Returns every week in the PREVIOUS quarter (oldest-first), bounded by its own
// start/end so it never overlaps buildCurrentQWeeks_PS_'s output.
function buildPrevQWeeks_PS_(ctx) {
  return buildWeeksRange_PS_(ctx.prevQStartIsoYear, ctx.prevQStartIsoWeek,
                             ctx.prevQEndIsoYear,   ctx.prevQEndIsoWeek);
}

// Returns every week in the quarter BEFORE the previous one (oldest-first) —
// third leg of the Performance Record window (spec 2026-08-18 §3).
function buildPrev2QWeeks_PS_(ctx) {
  return buildWeeksRange_PS_(ctx.prev2QStartIsoYear, ctx.prev2QStartIsoWeek,
                             ctx.prev2QEndIsoYear,   ctx.prev2QEndIsoWeek);
}
```

- [ ] **Step 5: Widen the assembly in `getPSReportData`**

(a) Find `const prevQWeeks = buildPrevQWeeks_PS_(ctx);` (~line 3995). Directly after it add:

```js
  const prev2QWeeks = buildPrev2QWeeks_PS_(ctx);
```

(b) Find the `goalsPrevResult` block (~lines 3996–4006). Directly after `const goalsPrevResult = readGoalsEngagement_(active, prevQWeeks, [], prevCtx, ptoProfiles, empNumToNorm);` add:

```js
  // Third goals run: the prev-prev quarter, evaluated against its own goal set,
  // closed-quarter override on. If the Goals sheet no longer carries that
  // quarter's rows this returns empty weeks and the client renders gray
  // ("no goals data") — degradation, not breakage.
  const prev2Ctx = {
    goalsQuarter:  ctx.prev2GoalsQuarter,
    qStartIsoYear: ctx.prev2QStartIsoYear,
    qStartIsoWeek: ctx.prev2QStartIsoWeek,
    inGracePeriod: false,
    quarterClosed: true,
  };
  const goalsPrev2Result = readGoalsEngagement_(active, prev2QWeeks, [], prev2Ctx, ptoProfiles, empNumToNorm);
```

(c) Replace the continuity line `const continuityQWeeks = prevQWeeks.filter(w => !currentQLabels.has(w.label)).concat(currentQWeeks);` (~line 4008) with:

```js
  // Three-quarter continuity window (prev2 → prev → current), deduped by label
  // with the most-current copy winning — same rule the two-quarter window used.
  const prevQLabels = new Set(prevQWeeks.map(w => w.label));
  const continuityQWeeks = prev2QWeeks.filter(w => !prevQLabels.has(w.label) && !currentQLabels.has(w.label))
    .concat(prevQWeeks.filter(w => !currentQLabels.has(w.label)))
    .concat(currentQWeeks);
```

(d) Find `const goalsAll = mergeGoalsResults_(goalsPrevResult, goalsCurrentResult);` (~line 4042) and replace with (merge oldest-first — `mergeGoalsResults_(prev, current)` lets the newer side win per employee):

```js
  const goalsAll = mergeGoalsResults_(
    mergeGoalsResults_(goalsPrev2Result, goalsPrevResult), goalsCurrentResult);
```

(e) In `CONFIG_PS` (~line 62) change:

```js
  TRACKED_HIST_WEEKS: 27,  // extra completed weeks before W-2 in trackedHistory — sized so the
                           // window always spans two full fiscal quarters (26 weeks + boundary
                           // slack) for the Month/Quarter period views.
```

to:

```js
  TRACKED_HIST_WEEKS: 41,  // extra completed weeks before W-2 in trackedHistory — sized so the
                           // window always spans THREE full fiscal quarters (39 weeks + boundary
                           // slack): the Performance Record tab reads tracked/planned/kudos for
                           // 2 closed quarters + QTD (spec 2026-08-18 §3).
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node "ps-dashboard/tests/fiscal-window-checks.js"`
Expected: `✅ 15 passed, 0 failed`

- [ ] **Step 7: Syntax-check the server file**

Run: `node --check "ps-dashboard/PS Contribution Report.js"`
Expected: no output (exit 0).

- [ ] **Step 8: Commit**

```bash
git add "ps-dashboard/PS Contribution Report.js" "ps-dashboard/tests/fiscal-window-checks.js"
git commit -m "feat(ps): widen continuity window to 3 fiscal quarters for Performance Record

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Client — tab scaffold (VIEWS, button, pane, CSS, dispatch, STATE)

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (anchors: tab bar ~line 1386, `tabExecBrief` pane close ~line 1877, `STATE` ~line 2049, `VIEWS` ~line 2076, `renderAll` RENDERERS ~line 2880, CSS after `.cf-panel-warning` rules ~line 695)

- [ ] **Step 1: Add the tab button**

After `<button class="tab-btn" id="tabBtnExecBrief" onclick="switchTab('execbrief')">📋 Team Executive Brief</button>` (~line 1386) add:

```html
    <button class="tab-btn"        id="tabBtnPerfRecord"  onclick="switchTab('perfrecord')">📈 Performance Record</button>
```

- [ ] **Step 2: Add the pane skeleton**

After the closing `</div>` of `#tabExecBrief` (~line 1877) add:

```html
  <!-- PERFORMANCE RECORD TAB (admin + manager — spec 2026-08-18) -->
  <div id="tabPerfRecord" class="tab-pane">
    <div class="section-card">
      <div class="section-head" style="flex-wrap:wrap;gap:12px">
        <div style="flex:1;min-width:220px">
          <h2>Performance Record</h2>
          <p class="section-sub" id="prSub"></p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap">
          <div class="pr-seg" id="prGranCtl"></div>
          <span class="pr-chip" id="prFlaggedChip"
                onclick="STATE.prFlaggedOnly=!STATE.prFlaggedOnly;renderPerfRecordTab_()">⚑ Flagged only</span>
          <button class="copy-btn" id="prCsvBtn" onclick="exportPerfCsv_()">⬇ CSV</button>
        </div>
      </div>
      <div class="pr-note">Signals are reading aids, not verdicts — colours and notes surface the data; the manager judges.
        Dot = last closed period (↗ → ↘ vs the one before) · faded bars are in progress · gray = no data / not evaluated.</div>
      <div id="prBody" style="overflow-x:auto"></div>
    </div>
  </div>
```

- [ ] **Step 3: Add CSS**

After the `.cf-panel-warning .cf-panel-list li::before { color: #FF991F; }` rule (~line 695) add:

```css
/* ── 📈 Performance Record tab ── */
.pr-note { font-size: 11px; color: var(--slate); margin: 2px 0 10px; }
.pr-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.pr-seg button { border: none; background: transparent; color: var(--slate); font-size: 11px; font-weight: 700;
  padding: 4px 10px; cursor: pointer; }
.pr-seg button.on { background: var(--void); color: #fff; }
.pr-chip { font-size: 11px; font-weight: 700; border: 1px solid var(--border); border-radius: 14px;
  padding: 3px 10px; cursor: pointer; user-select: none; color: var(--slate); }
.pr-chip.on { background: #E3FCEF; color: #006644; border-color: #00875A; }
.pr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pr-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--slate); padding: 6px 8px; border-bottom: 2px solid var(--border); cursor: pointer; white-space: nowrap; }
.pr-table th.on { color: var(--void); }
.pr-table td { padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; }
.pr-table tr.pr-row { cursor: pointer; }
.pr-table tr.pr-row:hover td { background: rgba(0,0,0,.03); }
.pr-name { font-weight: 700; color: var(--void); }
.pr-sub { font-size: 10px; color: var(--slate); }
.pr-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 3px; vertical-align: middle; }
.pr-dot.g { background: #00875A; } .pr-dot.y { background: #FF991F; }
.pr-dot.r { background: #DE350B; } .pr-dot.m { background: #C1C7D0; }
.pr-trend { font-size: 10px; color: var(--slate); margin-right: 3px; }
.pr-mb { display: inline-flex; align-items: flex-end; gap: 1px; height: 22px; }
.pr-mb i { display: inline-block; width: 5px; min-height: 2px; border-radius: 1px 1px 0 0; background: #00875A; }
.pr-mb.dense i { width: 3px; }
.pr-mb i.y { background: #FF991F; } .pr-mb i.r { background: #DE350B; } .pr-mb i.m { background: #C1C7D0; }
.pr-mb i.prog { opacity: .35; }
.pr-reading { font-size: 11px; color: var(--slate); font-style: italic; white-space: normal; min-width: 160px; }
.pr-drill { background: #FAFBFC; border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 14px; margin: 4px 0 8px; font-size: 11.5px; white-space: normal; }
.pr-drill h4 { margin: 10px 0 4px; font-size: 11px; }
.pr-drill table { border-collapse: collapse; }
.pr-drill td, .pr-drill th { padding: 2px 12px 2px 0; font-size: 11px; text-align: left; border: none; }
body.dark-mode .pr-drill { background: #1E2A4A; }
body.dark-mode .pr-dot.m, body.dark-mode .pr-mb i.m { background: #44506E; }
body.dark-mode .pr-table tr.pr-row:hover td { background: rgba(255,255,255,.05); }
body.dark-mode .pr-chip.on { background: #0d3320; color: #6EE7B7; }
```

- [ ] **Step 4: Wire VIEWS, STATE, and the render dispatch**

(a) In `VIEWS` (~line 2076), after the `execbrief` entry add:

```js
  { id: "perfrecord", btnId: "tabBtnPerfRecord", paneId: "tabPerfRecord", label: "📈 Performance Record", location: "tabbar", roles: ["admin", "manager"] },
```

(b) In `STATE` (~line 2049), after `teamData: {},` add:

```js
  prGranularity: "quarter",   // Performance Record: 'week' | 'month' | 'quarter'
  prFlaggedOnly: false,       // Performance Record: show only rows with ≥1 red/yellow dot
  prSort:        { key: "flags", dir: "desc" },  // 'flags' | 'name' | a metric col id
  prExpanded:    null,        // normName of the row whose evidence panel is open
```

(c) In `renderAll`'s `RENDERERS` map (~line 2880), after the `execbrief:` line add:

```js
    perfrecord: function() { renderPerfRecordTab_(filtered); },
```

(d) Add a temporary stub next to `renderAll` (replaced in Task 5) so the file stays runnable:

```js
// Stub — replaced by the full renderer in the Performance Record build (Task 5).
function renderPerfRecordTab_(filteredOpt) {
  var el = document.getElementById('prBody');
  if (el) el.innerHTML = '<p class="pr-note">Performance Record — renderer not built yet.</p>';
}
function exportPerfCsv_() {}
```

- [ ] **Step 5: Syntax-check the HTML script block**

Run (from repo root):

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('ps-dashboard/PS Dashboard.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { try { new Function(s); } catch (e) { console.error('script block ' + i + ': ' + e.message); process.exit(1); } });
console.log('HTML_SCRIPTS_OK (' + scripts.length + ' blocks)');
"
```

Expected: `HTML_SCRIPTS_OK (1 blocks)`

- [ ] **Step 6: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): Performance Record tab scaffold — VIEWS entry, pane, CSS, dispatch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure signal engine (sentinel-delimited) + node checks

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (insert the engine directly ABOVE `function computeRkScore` ~line 3204)
- Test: `ps-dashboard/tests/perf-record-checks.js`

- [ ] **Step 1: Write the failing test**

Create `ps-dashboard/tests/perf-record-checks.js`:

```js
// Node checks for the Performance Record pure signal engine (spec 2026-08-18 §5).
// The engine lives between ⟦PERF-ENGINE-START⟧ / ⟦PERF-ENGINE-END⟧ sentinels in
// PS Dashboard.html and must stay free of DATA/STATE/DOM references.
// Run: node "ps-dashboard/tests/perf-record-checks.js"
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');
const S = '⟦PERF-ENGINE-START⟧', E = '⟦PERF-ENGINE-END⟧';
const i0 = html.indexOf(S), i1 = html.indexOf(E);
if (i0 < 0 || i1 < 0) { console.error('❌ engine sentinels not found'); process.exit(1); }
const engine = html.substring(html.indexOf('\n', i0) + 1, html.lastIndexOf('\n', i1));
['DATA', 'STATE', 'document', 'window'].forEach(g => {
  if (new RegExp('\\b' + g + '\\b').test(engine)) {
    console.error('❌ engine references forbidden global: ' + g); process.exit(1);
  }
});
eval(engine);

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── perfSignalFor_: numeric thresholds, cohort-aware ─────────────────────────
ck('tracked IC 0.85 → g',   perfSignalFor_('tracked', 0.85,  'ic')  === 'g');
ck('tracked IC 0.849 → y',  perfSignalFor_('tracked', 0.849, 'ic')  === 'y');
ck('tracked IC 0.55 → y',   perfSignalFor_('tracked', 0.55,  'ic')  === 'y');
ck('tracked IC 0.549 → r',  perfSignalFor_('tracked', 0.549, 'ic')  === 'r');
ck('tracked MGR 0.5 → g',   perfSignalFor_('tracked', 0.5,   'mgr') === 'g');
ck('tracked MGR 0.05 → y (managers never red)', perfSignalFor_('tracked', 0.05, 'mgr') === 'y');
ck('planned MGR 0.70 → g',  perfSignalFor_('planned', 0.70,  'mgr') === 'g');
ck('planned MGR 0.40 → y',  perfSignalFor_('planned', 0.40,  'mgr') === 'y');
ck('planned MGR 0.39 → r',  perfSignalFor_('planned', 0.39,  'mgr') === 'r');
ck('goals 0.80 → g',        perfSignalFor_('goals',   0.80,  'ic')  === 'g');
ck('goals 0.40 → y',        perfSignalFor_('goals',   0.40,  'ic')  === 'y');
ck('goals 0.39 → r',        perfSignalFor_('goals',   0.39,  'ic')  === 'r');
ck('score 75 → g',          perfSignalFor_('score',   75,    'ic')  === 'g');
ck('score 50 → y',          perfSignalFor_('score',   50,    'ic')  === 'y');
ck('score 49 → r',          perfSignalFor_('score',   49,    'ic')  === 'r');
ck('rcr 2.0 → g',           perfSignalFor_('rcr',     2.0,   'ic')  === 'g');
ck('rcr 1.25 → y',          perfSignalFor_('rcr',     1.25,  'ic')  === 'y');
ck('rcr 1.24 → r',          perfSignalFor_('rcr',     1.24,  'ic')  === 'r');
ck('si 4 → g',              perfSignalFor_('si',      4,     'ic')  === 'g');
ck('si 3 → y',              perfSignalFor_('si',      3,     'ic')  === 'y');
ck('si 2 → r',              perfSignalFor_('si',      2,     'ic')  === 'r');
ck('null → m',              perfSignalFor_('tracked', null,  'ic')  === 'm');
ck('undefined → m',         perfSignalFor_('goals',   undefined, 'ic') === 'm');
ck('NaN → m',               perfSignalFor_('score',   NaN,   'ic')  === 'm');

// ── categorical metrics ───────────────────────────────────────────────────────
ck('kudos both → g',        perfSignalFor_('kudos', { recv: 2, gave: 1 }, 'ic') === 'g');
ck('kudos one-sided → y',   perfSignalFor_('kudos', { recv: 2, gave: 0 }, 'ic') === 'y');
ck('kudos none → m (never red)', perfSignalFor_('kudos', { recv: 0, gave: 0 }, 'ic') === 'm');
ck('pto 1 → g',             perfSignalFor_('pto', 1, 'ic') === 'g');
ck('pto 0 → r',             perfSignalFor_('pto', 0, 'ic') === 'r');
ck('pto null → m',          perfSignalFor_('pto', null, 'ic') === 'm');

// ── perfTrend_ ────────────────────────────────────────────────────────────────
ck('score 70→76 = ↗ (eps 5)',   perfTrend_('score', 70, 76)   === '↗');
ck('score 70→74 = → (within eps)', perfTrend_('score', 70, 74) === '→');
ck('tracked 0.8→0.9 = ↗',       perfTrend_('tracked', 0.8, 0.9) === '↗');
ck('tracked 0.9→0.8 = ↘',       perfTrend_('tracked', 0.9, 0.8) === '↘');
ck('missing prev → empty',      perfTrend_('tracked', null, 0.9) === '');
ck('kudos → empty (categorical)', perfTrend_('kudos', { recv: 1, gave: 1 }, { recv: 0, gave: 0 }) === '');
ck('pto → empty (categorical)', perfTrend_('pto', 1, 0) === '');

// ── perfBucketAgg_ ────────────────────────────────────────────────────────────
function rk(o) {
  return Object.assign({
    score: 50, goalsNorm: 0, goalsOk: false, goalsHasData: false,
    trackedNorm: 0, trackedHrs: null, plannedNorm: 0, plannedHrs: null,
    rcrNorm: null, rcrVal: null, kudosNorm: 0, kudosCount: 0, kudosGivenCount: 0,
    siNorm: null, siVal: null, ptoNorm: null, ptoStatus: null,
  }, o);
}
const agg = perfBucketAgg_([
  { label: '2026.W20', rk: rk({ score: 80, goalsHasData: true, goalsOk: true,  trackedNorm: 1.0, trackedHrs: 40, plannedNorm: 1.0, plannedHrs: 40, kudosCount: 1, ptoNorm: 1, rcrVal: 2.2, siVal: 4 }) },
  { label: '2026.W21', rk: rk({ score: 60, goalsHasData: true, goalsOk: false, trackedNorm: 0.5, trackedHrs: 18, plannedNorm: 0.8, plannedHrs: 32, kudosGivenCount: 1, ptoNorm: 0 }) },
  { label: '2026.W22', rk: rk({ score: 40, goalsHasData: false,                trackedNorm: 0.7, trackedHrs: 25, plannedNorm: 0.9, plannedHrs: 36 }) },
]);
ck('agg.weeks = 3',                agg.weeks === 3);
ck('agg.score = 60 (avg 80/60/40)', agg.score === 60);
ck('agg.goals = 0.5 (1 of 2 weeks WITH data)', agg.goals === 0.5);
ck('agg.goalsWeeks = 2',           agg.goalsWeeks === 2);
ck('agg.goalsCompliant = 1',       agg.goalsCompliant === 1);
ck('agg.tracked ≈ 0.733',          Math.abs(agg.tracked - (1.0 + 0.5 + 0.7) / 3) < 1e-9);
ck('agg.trackedHrs = 83',          agg.trackedHrs === 83);
ck('agg.plannedHrs = 108',         agg.plannedHrs === 108);
ck('agg.kudos = {recv:1, gave:1}', agg.kudos.recv === 1 && agg.kudos.gave === 1);
ck('agg.pto = 0 (LAST snapshot in bucket)', agg.pto === 0);
ck('agg.rcr = 2.2 (last non-null)', agg.rcr === 2.2);
ck('agg.si = 4 (last non-null)',   agg.si === 4);

// Empty weeks (pre-hire: everything null/0, no goals data) are excluded entirely.
const agg2 = perfBucketAgg_([
  { label: '2026.W20', rk: rk({}) },  // empty week — no hours, no plan, no kudos, no goals, no pto
  { label: '2026.W21', rk: rk({ score: 90, trackedNorm: 1.0, trackedHrs: 40, plannedNorm: 1.0, plannedHrs: 40, goalsHasData: true, goalsOk: true }) },
]);
ck('empty weeks excluded: score = 90', agg2.score === 90);
ck('empty weeks excluded: weeks = 1',  agg2.weeks === 1);
const agg3 = perfBucketAgg_([{ label: '2026.W20', rk: null }]);
ck('all-null bucket → score null',     agg3.score === null);
ck('all-null bucket → kudos zeros',    agg3.kudos.recv === 0 && agg3.kudos.gave === 0);

// ── perfReadingNote_ ─────────────────────────────────────────────────────────
const noteAllGreen = perfReadingNote_([
  { id: 'goals', label: 'Goals', sig: 'g', trend: '→' },
  { id: 'tracked', label: 'Tracked', sig: 'g', trend: '↗' },
]);
ck('all-green note mentions green', noteAllGreen.indexOf('green across window') === 0);
const noteFlagged = perfReadingNote_([
  { id: 'goals', label: 'Goals', sig: 'r', trend: '↘' },
  { id: 'tracked', label: 'Tracked', sig: 'y', trend: '↘' },
  { id: 'planned', label: 'Planned', sig: 'g', trend: '→' },
]);
ck('flagged note lists worst-first', noteFlagged.indexOf('support: goals, tracked') === 0);
ck('flagged note counts declines',   noteFlagged.indexOf('2 declining') !== -1);

// ── perfCsvEncode_ ───────────────────────────────────────────────────────────
ck('csv quotes commas',  perfCsvEncode_([['a,b', 'c']]) === '"a,b",c');
ck('csv escapes quotes', perfCsvEncode_([['say "hi"']]) === '"say ""hi"""');
ck('csv joins rows with CRLF', perfCsvEncode_([['a'], ['b']]) === 'a\r\nb');

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node "ps-dashboard/tests/perf-record-checks.js"`
Expected: `❌ engine sentinels not found` (exit 1).

- [ ] **Step 3: Implement the engine**

In `ps-dashboard/PS Dashboard.html`, directly ABOVE `function computeRkScore(emp, weekLabel) {` (~line 3204), insert:

```js
// ⟦PERF-ENGINE-START⟧ ─────────────────────────────────────────────────────────
// Performance Record pure signal engine (spec 2026-08-18 §5). Everything between
// the sentinels is dependency-free — no payload, app-state, or DOM globals.
// tests/perf-record-checks.js extracts and evals this region verbatim and
// rejects it if a forbidden global token appears (so keep those words out of
// comments here too).

// R/Y/G thresholds per metric, cohort-aware ("team gates, family tunes" gates
// which METRICS exist; these bars only tune the reading). Managers are held to
// their own tracked/planned bars: their week is coaching and escalation, which
// never reaches Tempo — tracked can never flag a manager red.
var PERF_BARS = {
  score:   { ic: { g: 75,   y: 50   }, mgr: { g: 75,   y: 50   } },
  goals:   { ic: { g: 0.80, y: 0.40 }, mgr: { g: 0.80, y: 0.40 } },
  tracked: { ic: { g: 0.85, y: 0.55 }, mgr: { g: 0.50, y: -Infinity } },
  planned: { ic: { g: 0.85, y: 0.50 }, mgr: { g: 0.70, y: 0.40 } },
  rcr:     { ic: { g: 2.0,  y: 1.25 }, mgr: { g: 2.0,  y: 1.25 } },
  si:      { ic: { g: 4,    y: 3    }, mgr: { g: 4,    y: 3    } },
};

// Returns 'g' | 'y' | 'r' | 'm' (m = gray: no data / not evaluated).
// kudos takes {recv, gave} and is never red; pto is 1 (Good) / 0 (At Risk) / null.
function perfSignalFor_(metricId, bucketVal, cohort) {
  if (bucketVal === null || bucketVal === undefined) return 'm';
  if (metricId === 'kudos') {
    var sides = (bucketVal.recv > 0 ? 1 : 0) + (bucketVal.gave > 0 ? 1 : 0);
    return sides === 2 ? 'g' : sides === 1 ? 'y' : 'm';
  }
  if (typeof bucketVal === 'number' && isNaN(bucketVal)) return 'm';
  if (metricId === 'pto') return bucketVal >= 1 ? 'g' : 'r';
  var bars = PERF_BARS[metricId];
  if (!bars) return 'm';
  var b = cohort === 'mgr' ? bars.mgr : bars.ic;
  if (bucketVal >= b.g) return 'g';
  if (bucketVal >= b.y) return 'y';
  return 'r';
}

// Trend of the last closed bucket vs the one before: '↗' | '→' | '↘' | ''.
// Categorical metrics (kudos, pto) and missing values carry no trend.
function perfTrend_(metricId, prevVal, curVal) {
  if (metricId === 'kudos' || metricId === 'pto') return '';
  if (prevVal === null || prevVal === undefined || curVal === null || curVal === undefined) return '';
  var eps = metricId === 'score' ? 5 : 0.05;
  if (curVal - prevVal > eps) return '↗';
  if (prevVal - curVal > eps) return '↘';
  return '→';
}

// A week is "empty" (pre-hire / fully absent) when it carries no hours, no plan,
// no kudos, no goals data, and no PTO snapshot — excluded from every average so
// mid-window hires aren't dragged down by weeks before they existed.
function perfWeekIsEmpty_(rk) {
  return rk.trackedHrs === null && rk.plannedHrs === null && rk.ptoNorm === null &&
         !rk.goalsHasData && !(rk.kudosCount > 0) && !(rk.kudosGivenCount > 0);
}

// Aggregates one bucket of weekly computeRkScore rows into per-metric values.
// weekRows: [{ label, rk }] — rk may be null (no week data at all).
function perfBucketAgg_(weekRows) {
  var rows = weekRows.filter(function(r) { return r.rk && !perfWeekIsEmpty_(r.rk); });
  function avg(field) {
    var v = rows.map(function(r) { return r.rk[field]; })
      .filter(function(x) { return x !== null && x !== undefined && !isNaN(x); });
    return v.length ? v.reduce(function(a, c) { return a + c; }, 0) / v.length : null;
  }
  function sumOrNull(field) {
    var v = rows.map(function(r) { return r.rk[field]; })
      .filter(function(x) { return x !== null && x !== undefined && !isNaN(x); });
    return v.length ? v.reduce(function(a, c) { return a + c; }, 0) : null;
  }
  function lastNonNull(field) {
    for (var i = rows.length - 1; i >= 0; i--) {
      var x = rows[i].rk[field];
      if (x !== null && x !== undefined && !isNaN(x)) return x;
    }
    return null;
  }
  var goalsRows = rows.filter(function(r) { return r.rk.goalsHasData; });
  var goalsCompliant = goalsRows.filter(function(r) { return r.rk.goalsOk; }).length;
  return {
    weeks:          rows.length,
    score:          avg('score') === null ? null : Math.round(avg('score')),
    goals:          goalsRows.length ? goalsCompliant / goalsRows.length : null,
    goalsWeeks:     goalsRows.length,
    goalsCompliant: goalsCompliant,
    tracked:        avg('trackedNorm'),
    trackedHrs:     sumOrNull('trackedHrs'),
    planned:        avg('plannedNorm'),
    plannedHrs:     sumOrNull('plannedHrs'),
    plannedWeeks:   rows.filter(function(r) { return (r.rk.plannedHrs || 0) > 0; }).length,
    kudos:          { recv: rows.reduce(function(a, r) { return a + (r.rk.kudosCount || 0); }, 0),
                      gave: rows.reduce(function(a, r) { return a + (r.rk.kudosGivenCount || 0); }, 0) },
    pto:            lastNonNull('ptoNorm'),   // signal = state at bucket close, not the share
    ptoGoodShare:   avg('ptoNorm'),
    rcr:            lastNonNull('rcrVal'),
    si:             lastNonNull('siVal'),
  };
}

// Row-level reading: names the flagged metrics worst-first, counts declines.
// Observations only — never a recommendation (spec §5: the manager judges).
function perfReadingNote_(signals) {
  var sev = { r: 3, y: 2, g: 1, m: 0 };
  var flagged = signals.filter(function(s) { return s.sig === 'r' || s.sig === 'y'; })
    .sort(function(a, b) { return sev[b.sig] - sev[a.sig]; });
  var declining = signals.filter(function(s) { return s.trend === '↘'; }).length;
  if (!flagged.length) {
    var rising = signals.some(function(s) { return s.trend === '↗'; });
    return 'green across window · ' + (declining ? declining + ' declining — watch' : (rising ? 'steady or rising' : 'steady'));
  }
  return 'support: ' + flagged.map(function(s) { return s.label.toLowerCase(); }).join(', ') +
    (declining ? ' · ' + declining + ' declining' : '');
}

// CSV encoder (RFC 4180): quotes fields containing commas/quotes/newlines.
function perfCsvEncode_(rows) {
  return rows.map(function(row) {
    return row.map(function(cell) {
      var s = String(cell === null || cell === undefined ? '' : cell);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\r\n');
}
// ⟦PERF-ENGINE-END⟧ ───────────────────────────────────────────────────────────
```

- [ ] **Step 4: Add `goalsHasData` to `computeRkScore`'s return**

In `computeRkScore` (~line 3253), the return object currently starts:

```js
  return {
    score:      score,
    goalsNorm:  goals,   goalsOk:    goals === 1,
```

Change those lines to:

```js
  return {
    score:      score,
    goalsNorm:  goals,   goalsOk:    goals === 1,   goalsHasData: hasGoalsData,
```

(`hasGoalsData` is already computed in the function body — this only exposes it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node "ps-dashboard/tests/perf-record-checks.js"`
Expected: `✅ 59 passed, 0 failed`

Also run the syntax check from Task 2 Step 5. Expected: `HTML_SCRIPTS_OK (1 blocks)`

- [ ] **Step 6: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html" "ps-dashboard/tests/perf-record-checks.js"
git commit -m "feat(ps): Performance Record pure signal engine + node checks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Model builder (glue between payload and engine)

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (insert directly BELOW the `⟦PERF-ENGINE-END⟧` sentinel line)

- [ ] **Step 1: Implement the model builder**

Insert after the `// ⟦PERF-ENGINE-END⟧ ...` line:

```js
// ── Performance Record: model builder (DATA/STATE-aware glue) ────────────────
// Buckets the 3-quarter window at the tab's granularity and aggregates each
// employee's weekly computeRkScore rows per bucket. Memoized per payload +
// granularity — sorting/filtering/expanding never recomputes.
var _perfModelMemo = { key: null, model: null };

function perfBucketsFor_(gran) {
  if (gran === 'week') {
    // Weekly = each past continuity week is its own bucket.
    return (DATA.q4Weeks || []).filter(function(w) { return !w.isFuture; }).map(function(w) {
      return { key: w.label, label: w.label, weekLabels: [w.label],
               containsCurrent: w.label === DATA.meta.currentWeekLabel };
    });
  }
  return periodBucketsForEmp_(gran);
}

function perfModel_() {
  var gran = STATE.prGranularity;
  var memoKey = gran + '|' + STATE.activeTeam + '|' + ((DATA.meta && DATA.meta.generatedAt) || '');
  if (_perfModelMemo.key === memoKey) return _perfModelMemo.model;
  var buckets = perfBucketsFor_(gran);
  // Dot/trend read the last two CLOSED buckets (spec §5) — precompute indices.
  var closedIdx = [];
  buckets.forEach(function(b, i) { if (!b.containsCurrent) closedIdx.push(i); });
  var model = {
    buckets:  buckets,
    lastIdx:  closedIdx.length ? closedIdx[closedIdx.length - 1] : (buckets.length ? buckets.length - 1 : 0),
    prevIdx:  closedIdx.length > 1 ? closedIdx[closedIdx.length - 2] : null,
    byEmp:    {},
  };
  (DATA.employees || []).forEach(function(emp) {
    model.byEmp[emp.normName] = buckets.map(function(b) {
      return perfBucketAgg_(b.weekLabels
        .filter(function(l) { return emp.weeks && emp.weeks[l]; })
        .map(function(l) { return { label: l, rk: computeRkScore(emp, l) }; }));
    });
  });
  _perfModelMemo = { key: memoKey, model: model };
  return model;
}

// Manager cohort = existing rule (Job Catalog track M OR has reports) — the
// payload ships it as e.isManager.
function perfCohort_(emp) { return emp.isManager ? 'mgr' : 'ic'; }

// Column registry — filtered by the team gate at render time. Score is always first.
var PERF_COLS = [
  { id: 'score',   label: 'Score',   bars: false },
  { id: 'goals',   label: 'Goals',   bars: true  },
  { id: 'tracked', label: 'Tracked', bars: true  },
  { id: 'planned', label: 'Planned', bars: true  },
  { id: 'rcr',     label: 'RCR',     bars: false },
  { id: 'kudos',   label: 'Kudos',   bars: true  },
  { id: 'pto',     label: 'PTO',     bars: true  },
  { id: 'si',      label: 'SI',      bars: false },
];
function perfCols_() {
  return PERF_COLS.filter(function(c) { return c.id === 'score' || hasMetric_(c.id); });
}

// Per-employee metric exclusions (existing policy): on-leave → everything gray;
// ramp-up → Goals/Kudos/RCR/SI gray; non-tracking families → Tracked/Planned/RCR
// gray (RCR joined the carve 2026-08-05); crew → Goals/PTO/SI gray.
function perfGrayCols_(emp) {
  var gray = {};
  function g(ids) { ids.forEach(function(id) { gray[id] = true; }); }
  if (onLeave_(emp)) { g(['score', 'goals', 'tracked', 'planned', 'rcr', 'kudos', 'pto', 'si']); return gray; }
  if (emp.isRampUp)      g(['goals', 'kudos', 'rcr', 'si']);
  if (!tracksTime_(emp)) g(['tracked', 'planned', 'rcr']);
  if (isCrewEmp(emp))    g(['goals', 'pto', 'si']);
  return gray;
}

// Extracts the col's bucket value from a perfBucketAgg_ result.
function perfColVal_(agg, colId) {
  if (!agg) return null;
  return agg[colId] === undefined ? null : agg[colId];
}
```

- [ ] **Step 2: Syntax check + engine checks still green**

Run: `node "ps-dashboard/tests/perf-record-checks.js"` — expected `✅ 59 passed, 0 failed` (the sentinel region is unchanged; this step catches an accidental insert INSIDE the sentinels).
Run the Task 2 Step 5 syntax check — expected `HTML_SCRIPTS_OK (1 blocks)`.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): Performance Record model builder — bucketed computeRkScore aggregates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Table renderer, controls, sorting

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (replace the Task 2 stub `renderPerfRecordTab_` / keep `exportPerfCsv_` stub until Task 7)

- [ ] **Step 1: Replace the stub renderer with the full implementation**

Delete the Task 2 stub `renderPerfRecordTab_` (keep the `exportPerfCsv_() {}` stub) and insert:

```js
// ── Performance Record: renderer ─────────────────────────────────────────────
// Builds one reusable row model per employee (render + CSV share it), then
// renders the grid. Row click toggles the evidence panel (Task 6).

function perfRowModels_(emps) {
  var model = perfModel_();
  var cols  = perfCols_();
  return emps.map(function(emp) {
    var per   = model.byEmp[emp.normName] || [];
    var gray  = perfGrayCols_(emp);
    var coh   = perfCohort_(emp);
    var cells = cols.map(function(c) {
      var isGray  = !!gray[c.id];
      var lastVal = isGray ? null : perfColVal_(per[model.lastIdx], c.id);
      var prevVal = isGray || model.prevIdx === null ? null : perfColVal_(per[model.prevIdx], c.id);
      var sig     = isGray ? 'm' : perfSignalFor_(c.id, lastVal, coh);
      return {
        col: c, gray: isGray, sig: sig,
        trend: perfTrend_(c.id, prevVal, lastVal),
        val: lastVal,
        buckets: per.map(function(agg, i) {
          var v = isGray ? null : perfColVal_(agg, c.id);
          return { val: v, sig: isGray ? 'm' : perfSignalFor_(c.id, v, coh),
                   prog: !!model.buckets[i].containsCurrent };
        }),
      };
    });
    var reds    = cells.filter(function(x) { return x.sig === 'r'; }).length;
    var yellows = cells.filter(function(x) { return x.sig === 'y'; }).length;
    return {
      emp: emp, cells: cells, reds: reds, yellows: yellows,
      flagged: reds + yellows > 0,
      reading: perfReadingNote_(cells.map(function(x) {
        return { id: x.col.id, label: x.col.label, sig: x.sig, trend: x.trend };
      })),
    };
  });
}

function perfSortRows_(rows) {
  var s   = STATE.prSort;
  var dir = s.dir === 'asc' ? 1 : -1;
  var sev = { r: 3, y: 2, g: 1, m: 0 };
  var cols = perfCols_();
  var colIdx = -1;
  cols.forEach(function(c, i) { if (c.id === s.key) colIdx = i; });
  rows.sort(function(a, b) {
    if (s.key === 'name') return dir * a.emp.name.localeCompare(b.emp.name);
    if (s.key === 'flags' || colIdx === -1) {
      var fa = a.reds * 100 + a.yellows, fb = b.reds * 100 + b.yellows;
      return fa !== fb ? dir * (fa - fb) : a.emp.name.localeCompare(b.emp.name);
    }
    var ca = a.cells[colIdx], cb = b.cells[colIdx];
    if (sev[ca.sig] !== sev[cb.sig]) return dir * (sev[ca.sig] - sev[cb.sig]);
    var va = typeof ca.val === 'number' ? ca.val : Infinity;   // worst value first inside a colour
    var vb = typeof cb.val === 'number' ? cb.val : Infinity;
    return va !== vb ? -dir * (va - vb) : a.emp.name.localeCompare(b.emp.name);
  });
  return rows;
}

function prSortBy(key) {
  var s = STATE.prSort;
  if (s.key === key) s.dir = s.dir === 'desc' ? 'asc' : 'desc';
  else STATE.prSort = { key: key, dir: 'desc' };
  renderPerfRecordTab_();
}

// Bar height source per metric: norms/shares are 0–1; score 0–100; kudos counts.
function perfBarPct_(colId, v) {
  if (v === null || v === undefined) return 0;
  if (colId === 'score') return Math.max(8, Math.min(100, v));
  if (colId === 'kudos') return Math.max(8, Math.min(100, ((v.recv || 0) + (v.gave || 0)) / 4 * 100));
  return Math.max(8, Math.min(100, v * 100));
}

function perfBarsHtml_(cell, dense) {
  return '<span class="pr-mb' + (dense ? ' dense' : '') + '">' + cell.buckets.map(function(b) {
    var pct = b.val === null || b.val === undefined ? 0 : perfBarPct_(cell.col.id, b.val);
    var cls = (b.sig !== 'g' ? b.sig : '') + (b.prog ? ' prog' : '');
    return '<i class="' + cls.trim() + '" style="height:' + (pct || 8) + '%" ' +
           (b.val === null ? 'title="no data"' : '') + '></i>';
  }).join('') + '</span>';
}

function perfCellHtml_(cell, dense) {
  var dot   = '<span class="pr-dot ' + cell.sig + '"></span>';
  var trend = cell.trend ? '<span class="pr-trend">' + cell.trend + '</span>' : '';
  if (cell.col.id === 'score') return dot + (cell.val === null ? '—' : cell.val) + ' ' + trend;
  if (cell.col.id === 'rcr')   return dot + (cell.val === null ? '—' : (Math.round(cell.val * 10) / 10)) + ' ' + trend;
  if (cell.col.id === 'si')    return dot + (cell.val === null ? '—' : Math.round(cell.val)) + ' ' + trend;
  if (!cell.col.bars)          return dot + trend;
  return dot + trend + perfBarsHtml_(cell, dense);
}

function renderPerfRecordTab_(filteredOpt) {
  if (!DATA) return;
  var body = document.getElementById('prBody');
  if (!body) return;

  // Controls
  var granCtl = document.getElementById('prGranCtl');
  if (granCtl) {
    granCtl.innerHTML = [['week', 'Weekly'], ['month', 'Monthly'], ['quarter', 'Quarterly']]
      .map(function(o) {
        return '<button class="' + (STATE.prGranularity === o[0] ? 'on' : '') + '" ' +
          'onclick="STATE.prGranularity=\'' + o[0] + '\';renderPerfRecordTab_()">' + o[1] + '</button>';
      }).join('');
  }
  var chip = document.getElementById('prFlaggedChip');
  if (chip) chip.classList.toggle('on', STATE.prFlaggedOnly);

  var emps = (filteredOpt || getFilteredEmployees());
  var rows = perfSortRows_(perfRowModels_(emps));
  var shown = STATE.prFlaggedOnly ? rows.filter(function(r) { return r.flagged; }) : rows;

  var model = perfModel_();
  var dense = STATE.prGranularity === 'week';
  var cols  = perfCols_();

  // Subtitle: name the window explicitly so a screenshot is self-describing.
  var qBuckets = periodBucketsForEmp_('quarter');
  var sub = document.getElementById('prSub');
  if (sub) sub.textContent =
    qBuckets.map(function(b) { return periodDisplayLabel_(b); }).join(' · ') +
    ' — ' + shown.length + ' of ' + rows.length + ' rocketeers' +
    (STATE.prFlaggedOnly ? ' (flagged only)' : '') +
    ' · dot = last closed ' + STATE.prGranularity;

  function th(key, label) {
    var on = STATE.prSort.key === key;
    return '<th class="' + (on ? 'on' : '') + '" onclick="prSortBy(\'' + key + '\')">' +
      label + (on ? (STATE.prSort.dir === 'desc' ? ' ▾' : ' ▴') : '') + '</th>';
  }

  var html = '<table class="pr-table"><thead><tr>' +
    th('name', 'Rocketeer') + th('flags', '⚑') +
    cols.map(function(c) { return th(c.id, c.label); }).join('') +
    '<th>Reading</th></tr></thead><tbody>';

  shown.forEach(function(r) {
    var e = r.emp;
    var parsed  = typeof parseJobCode === 'function' ? parseJobCode(e.jobTitle) : {};
    var badges  = (e.isRampUp ? ' 🌱' : '') + (onLeave_(e) ? ' 🏖' : '');
    var subLine = [parsed.family, parsed.level, e.keyLocation, e.supervisor]
      .filter(Boolean).join(' · ');
    var open = STATE.prExpanded === e.normName;
    html += '<tr class="pr-row" onclick="togglePerfDrill_(\'' + e.normName.replace(/'/g, "\\'") + '\')">' +
      '<td>' + (open ? '▾ ' : '▸ ') + '<span class="pr-name">' + esc(e.name) + badges + '</span>' +
        '<br><span class="pr-sub">' + esc(subLine) + '</span></td>' +
      '<td>' + (r.reds ? '<span class="pr-dot r"></span>' + r.reds : '') +
               (r.yellows ? ' <span class="pr-dot y"></span>' + r.yellows : '') +
               (!r.reds && !r.yellows ? '—' : '') + '</td>' +
      r.cells.map(function(cell) { return '<td>' + perfCellHtml_(cell, dense) + '</td>'; }).join('') +
      '<td class="pr-reading">' + esc(r.reading) + '</td></tr>';
    if (open) {
      html += '<tr><td colspan="' + (cols.length + 3) + '">' + perfDrillHtml_(e, r, model) + '</td></tr>';
    }
  });

  html += '</tbody></table>';
  if (!shown.length) html = '<p class="pr-note">No rocketeers match the current filters' +
    (STATE.prFlaggedOnly ? ' and the Flagged-only chip' : '') + '.</p>';
  body.innerHTML = html;
}

// Temporary — replaced with the evidence panel in the next build step (Task 6).
function togglePerfDrill_(normName) {
  STATE.prExpanded = STATE.prExpanded === normName ? null : normName;
  renderPerfRecordTab_();
}
function perfDrillHtml_(emp, row, model) {
  return '<div class="pr-drill">Evidence panel — built in the next step.</div>';
}
```

- [ ] **Step 2: Syntax + engine checks**

Run: `node "ps-dashboard/tests/perf-record-checks.js"` — expected `✅ 59 passed, 0 failed`.
Run the Task 2 Step 5 syntax check — expected `HTML_SCRIPTS_OK (1 blocks)`.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): Performance Record grid — micro bars, signal dots, sorting, flagged-only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Drill-down evidence panel

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (replace the Task 5 `perfDrillHtml_` placeholder)

- [ ] **Step 1: Replace `perfDrillHtml_` with the full evidence panel**

```js
// Evidence panel (spec §8): per-metric real values per bucket at the current
// granularity, kudos entries with givers, link into the Overview profile.
function perfDrillHtml_(emp, row, model) {
  var buckets = model.buckets;
  var per     = model.byEmp[emp.normName] || [];
  var gray    = perfGrayCols_(emp);
  function hdrCells() {
    return buckets.map(function(b) {
      return '<th>' + esc(b.label) + (b.containsCurrent ? ' ⏳' : '') + '</th>';
    }).join('');
  }
  function evRow(label, fn) {
    return '<tr><td class="pr-sub">' + label + '</td>' +
      per.map(function(agg) { return '<td>' + fn(agg) + '</td>'; }).join('') + '</tr>';
  }
  function fmtH(v)  { return v === null || v === undefined ? '—' : Math.round(v) + 'h'; }
  function pct(v)   { return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }

  var cellByCol = {};
  row.cells.forEach(function(c) { cellByCol[c.col.id] = c; });
  function blockTitle(colId, label, noteText) {
    var c = cellByCol[colId];
    return '<h4><span class="pr-dot ' + (c ? c.sig : 'm') + '"></span>' + label +
      (c && c.trend ? ' <span class="pr-trend">' + c.trend + '</span>' : '') +
      (noteText ? ' — <span class="pr-sub">' + esc(noteText) + '</span>' : '') + '</h4>';
  }

  var h = '<div class="pr-drill">' +
    '<b>' + esc(emp.name) + '</b> <span class="pr-sub">' + esc(emp.jobTitle || '') +
    (emp.supervisor ? ' · sup: ' + esc(emp.supervisor) : '') + '</span>' +
    ' &nbsp;<button class="copy-btn" onclick="event.stopPropagation();viewRocketeerDetails(\'' +
    emp.normName.replace(/'/g, "\\'") + '\')">Open full profile in Overview →</button>';

  if (hasMetric_('tracked') && !gray.tracked) {
    var tCur = per[model.lastIdx] || {};
    h += blockTitle('tracked', 'Tracked time',
      tCur.tracked === null || tCur.tracked === undefined ? 'no data in last closed period'
        : pct(tCur.tracked) + ' of plan-based target in ' + (buckets[model.lastIdx] ? buckets[model.lastIdx].label : ''));
    h += '<table><tr><th></th>' + hdrCells() + '</tr>' +
      evRow('Tracked / planned hrs', function(a) { return fmtH(a.trackedHrs) + ' / ' + fmtH(a.plannedHrs); }) +
      '</table>';
  }
  if (hasMetric_('goals') && !gray.goals) {
    var gCur = per[model.lastIdx] || {};
    h += blockTitle('goals', 'Goals',
      gCur.goalsWeeks ? 'compliant ' + gCur.goalsCompliant + ' of ' + gCur.goalsWeeks + ' weeks' : 'no goals data');
    h += '<table><tr><th></th>' + hdrCells() + '</tr>' +
      evRow('Weeks compliant', function(a) {
        return a.goalsWeeks ? a.goalsCompliant + '/' + a.goalsWeeks : '—';
      }) + '</table>';
  }
  if (hasMetric_('planned') && !gray.planned) {
    h += blockTitle('planned', 'Tempo plans', null);
    h += '<table><tr><th></th>' + hdrCells() + '</tr>' +
      evRow('Planned hrs · weeks planned', function(a) {
        return fmtH(a.plannedHrs) + ' · ' + (a.weeks ? a.plannedWeeks + '/' + a.weeks + ' wks' : '—');
      }) + '</table>';
  }
  if (hasMetric_('pto') && !gray.pto) {
    h += blockTitle('pto', 'PTO health', null);
    h += '<table><tr><th></th>' + hdrCells() + '</tr>' +
      evRow('Status at close · weeks Good', function(a) {
        var st = a.pto === null ? '—' : (a.pto >= 1 ? 'Good' : 'At Risk');
        return st + (a.ptoGoodShare !== null && a.ptoGoodShare !== undefined ? ' · ' + pct(a.ptoGoodShare) : '');
      }) + '</table>';
  }
  if (hasMetric_('rcr') && !gray.rcr) {
    var rc = cellByCol.rcr;
    h += blockTitle('rcr', 'RCR', rc && rc.val !== null ? 'current ' + (Math.round(rc.val * 10) / 10) + ' (target 2.5)' : 'no rating');
  }
  if (hasMetric_('si') && !gray.si) {
    var sc = cellByCol.si;
    h += blockTitle('si', 'SI rating', sc && sc.val !== null ? 'last quarter ' + Math.round(sc.val) + ' / 5' : 'no rating');
  }
  if (hasMetric_('kudos') && !gray.kudos) {
    var kAgg = per[model.lastIdx] || { kudos: { recv: 0, gave: 0 } };
    h += blockTitle('kudos', 'Kudos',
      'received ' + (kAgg.kudos ? kAgg.kudos.recv : 0) + ' · gave ' + (kAgg.kudos ? kAgg.kudos.gave : 0) +
      ' in last closed period — never red');
    var entries = [];
    (DATA.q4Weeks || []).forEach(function(w) {
      var wd = emp.weeks && emp.weeks[w.label];
      if (!wd || !wd.kudos || !wd.kudos.entries) return;
      wd.kudos.entries.forEach(function(en) {
        entries.push('<tr><td class="pr-sub">' + esc(w.label) + '</td><td>★ from ' + esc(en.giver || '—') +
          (en.orgValues ? ' · ' + esc(en.orgValues) : '') + '</td></tr>');
      });
    });
    h += entries.length ? '<table>' + entries.join('') + '</table>'
                        : '<p class="pr-sub">No kudos received in the window.</p>';
  }

  return h + '</div>';
}
```

- [ ] **Step 2: Syntax + engine checks**

Run: `node "ps-dashboard/tests/perf-record-checks.js"` — expected `✅ 59 passed, 0 failed`.
Run the Task 2 Step 5 syntax check — expected `HTML_SCRIPTS_OK (1 blocks)`.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): Performance Record evidence drill — per-metric period tables + kudos roll

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: CSV export

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (replace the Task 2 `exportPerfCsv_` stub)

- [ ] **Step 1: Replace the stub with the export**

```js
// CSV of the current filtered+sorted view (spec §7) — one row per rocketeer,
// per-metric signal + value + the reading note. WFP focus-group workflow.
function exportPerfCsv_() {
  if (!DATA) return;
  var rows  = perfSortRows_(perfRowModels_(getFilteredEmployees()));
  var shown = STATE.prFlaggedOnly ? rows.filter(function(r) { return r.flagged; }) : rows;
  var cols  = perfCols_();
  var SIGW  = { g: 'Green', y: 'Yellow', r: 'Red', m: 'n/a' };
  function valW(cell) {
    var v = cell.val;
    if (v === null || v === undefined) return '';
    if (cell.col.id === 'score') return String(v);
    if (cell.col.id === 'rcr')   return String(Math.round(v * 10) / 10);
    if (cell.col.id === 'si')    return String(Math.round(v));
    if (cell.col.id === 'kudos') return 'recv ' + v.recv + ' / gave ' + v.gave;
    if (cell.col.id === 'pto')   return v >= 1 ? 'Good' : 'At Risk';
    return Math.round(v * 100) + '%';
  }
  var header = ['Rocketeer', 'Cohort', 'Job Title', 'Location', 'Supervisor', 'Flags (R/Y)'];
  cols.forEach(function(c) { header.push(c.label + ' signal', c.label + ' value', c.label + ' trend'); });
  header.push('Reading');
  var out = [header];
  shown.forEach(function(r) {
    var line = [r.emp.name, perfCohort_(r.emp) === 'mgr' ? 'Manager' : 'IC',
      r.emp.jobTitle || '', r.emp.keyLocation || '', r.emp.supervisor || '',
      r.reds + '/' + r.yellows];
    r.cells.forEach(function(cell) { line.push(SIGW[cell.sig], valW(cell), cell.trend || ''); });
    line.push(r.reading);
    out.push(line);
  });
  var blob = new Blob(['\uFEFF' + perfCsvEncode_(out)], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'performance-record-' + STATE.prGranularity + '-' +
    ((DATA.meta && DATA.meta.currentWeekLabel) || 'export') + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 5000);
}
```

- [ ] **Step 2: Syntax + engine checks**

Run: `node "ps-dashboard/tests/perf-record-checks.js"` — expected `✅ 59 passed, 0 failed`.
Run the Task 2 Step 5 syntax check — expected `HTML_SCRIPTS_OK (1 blocks)`.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): Performance Record CSV export — signals + values for WFP focus groups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, final checks, deploy checklist

**Files:**
- Modify: `CLAUDE.md` (Dashboard navigation section)

- [ ] **Step 1: Document the tab in CLAUDE.md**

In the "Dashboard navigation (PS Dashboard.html)" section, change the tab-bar line:

```markdown
- **Tab bar** (always visible): Overview, Team Radar, Leading Behaviours, Trends —
  plus 📋 Team Executive Brief for admins only.
```

to:

```markdown
- **Tab bar** (always visible): Overview, Team Radar, Leading Behaviours, Trends —
  plus 📋 Team Executive Brief (admin/viewer/manager) and 📈 Performance Record
  (admin/manager only — per-rocketeer R/Y/G signal grid over 2 closed quarters + QTD;
  spec `ps-dashboard/docs/specs/2026-08-18-performance-record-tab-design.md`).
```

- [ ] **Step 2: Run every check**

```bash
node "ps-dashboard/tests/fiscal-window-checks.js"
node "ps-dashboard/tests/perf-record-checks.js"
node --check "ps-dashboard/PS Contribution Report.js"
```

plus the Task 2 Step 5 HTML syntax check.
Expected: `✅ 15 passed`, `✅ 59 passed`, silence, `HTML_SCRIPTS_OK (1 blocks)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Performance Record tab in navigation map

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual QA + deploy (USER performs — list for the handoff message)**

Layout is invisible to node checks (table-discipline rule: render + screenshot). The deploy/QA checklist to hand the user:

1. Push `PS Contribution Report.js` + `PS Dashboard.html` to the GAS project.
2. Bump `PS_CACHE_VER` in Script Properties (or save any weight setting — `bustReportCache_()` does it).
3. Run `getPSReportData` once in the GAS editor: check the execution log for runtime (third goals read + 14 extra weeks of tracked/planned/kudos) and the gzip cache chunk count; confirm no `⚠️`/`❌` lines about the prev2 goals quarter.
4. Open the dashboard as an admin: verify the 📈 tab appears; as a viewer: verify it does NOT; as a manager: verify org-tree scoping.
5. Flip Services → R&D → Sales & Success: Tracked/Planned/RCR columns must disappear for the last two.
6. Toggle Weekly/Monthly/Quarterly: bar counts change, dot stays on the last CLOSED bucket, QTD bars faded.
7. Screenshot desktop + narrow width, light + dark mode; check micro-bar legibility at Weekly (26+ bars).
8. Spot-check one flagged rocketeer's drill against the Overview expanded row for the same weeks (numbers must match).

---

## Deferred / out of scope (from spec §11)

Admin-editable thresholds · AI narratives on this tab · RCR/SI history bars (payload has current values only) · HubSpot metrics for Sales & Success · any write-back (coaching notes, review flags).
