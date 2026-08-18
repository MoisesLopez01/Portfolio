# Period Toggle (Week/Month/Quarter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Week/Month/Quarter period toggle to the Executive Brief, Team Radar, and Trends tabs so managers and the CEO can evaluate a closed month or fiscal quarter, backed by a two-quarter history window.

**Architecture:** Backend (`PS Contribution Report.js`) only widens history windows to two fiscal quarters — the prior-quarter Goals read reuses the existing grace-period machinery, and `ptoQ4History`/`goalsQ4Hist`/`employees[].weeks` widen automatically because they all derive from `continuityQWeeks`. All aggregation happens client-side in `PS Dashboard.html` in a pure, Node-testable bucket module applied **after** `getFilteredEmployees()`. Weekly-mode views are explicitly re-bounded to the current quarter so nothing widens silently.

**Tech Stack:** Google Apps Script (server), single-file HtmlService SPA with Chart.js (client), Node for pure-function tests.

**Spec:** `ps-dashboard/docs/specs/2026-07-07-period-toggle-monthly-quarterly-design.md`

---

## Context for a zero-context engineer

- `PS Contribution Report.js` (3,487 lines) is the GAS backend. `computePSReport_` (line ~2911) assembles the JSON payload. `PS Dashboard.html` (8,690 lines) is the whole frontend; globals `DATA` (payload), `STATE` (UI state, line ~1970), `Q4` (current-quarter gate consts, line ~2085).
- Week labels are `"2026.W27"` (ISO). Week entry objects (built by `makeWeekEntry_PS_`, backend line ~708) carry `{label, isoWeek, year, monday, sunday, isCurrentWeek, isFuture, isPast, dateRange}`.
- `DATA.trackedHistory` = one entry per past/current week (~29 weeks after this plan) with tracked/planned/kudos/comment aggregates (backend lines 3082–3113). `DATA.ptoQ4History` and `DATA.goalsQ4Hist` are keyed by week label and currently quarter-bounded. `DATA.q4Weeks` = `continuityQWeeks` (week entry objects). `DATA.employees[].weeks[label]` = per-employee week data (`trackedHrs`, `plannedHrs`, `goalsDetail`, `kudos`, `ptoHealth`, `projects`, `ptoPlannedHrs`, …).
- Fiscal year starts July 1 (FY26 = Jul 2025–Jun 2026). Fiscal context from `computeFiscalContext_` (backend line ~804) ships as `DATA.meta.fiscalContext`.
- The client gates several Trends cards to the current quarter via `weekInQ4Range_(year, week)` (client line ~2091); `Q4` is synced from `meta.fiscalContext` in `onDataLoaded` (client lines 2163–2172).
- There is no build step. Deployment = paste/push into the GAS editor. Testing = `node tests/…` for pure functions, `_test_*()` functions run in the GAS editor, and manual browser QA.
- **Commit convention:** conventional commits, e.g. `feat(psdash): …`. NEVER `git push` (repo is local-only).
- Line numbers below were verified on the current working tree; treat them as anchors, not gospel — always locate by the quoted code.

### Period semantics (from the spec — implement exactly)

- A week belongs to the **calendar month containing its Thursday** (ISO 8601 majority rule). A week belongs to the **fiscal quarter containing its Thursday's month** (same rule applied to quarters; a quarter-boundary week goes to the quarter owning Mon–Thu).
- Period labels: `Jun 2026 · 2026.W23–W27`, `FY26Q4 · 2026.W14–W26`; in-progress periods suffixed `(in progress)` and computed from closed weeks only.
- Flow metrics (tracked/planned/comments) = average per closed week; kudos = sum; standings (Goals compliance, PTO health) = last closed week in the period; RCR quarter value = mean of monthly values flagged approx; SI passes through natively.

---

### Task 1: Backend — two-quarter history window

**Files:**
- Modify: `D:\Contribution\PS Contribution Report.js` (CONFIG line ~55, `computePSReport_` lines ~2945–2995)

- [ ] **Step 1.1: Bump the tracked-history window**

At line ~55 replace:
```js
  TRACKED_HIST_WEEKS: 24,  // extra completed weeks before W-2 included in trackedHistory (~6 months)
```
with:
```js
  TRACKED_HIST_WEEKS: 27,  // extra completed weeks before W-2 in trackedHistory — sized so the
                           // window always spans two full fiscal quarters (26 weeks + boundary
                           // slack) for the Month/Quarter period views.
```

- [ ] **Step 1.2: Always merge the prior quarter's Goals + widen the continuity window**

In `computePSReport_`, replace the block at lines ~2945–2971 (starts `let continuityQWeeks   = currentQWeeks;`, ends `graceEndMonday = mondayOfIsoWeek_PS_(ctx.graceEndIsoYear, ctx.graceEndIsoWeek);\n  }`) with:

```js
  // Two-quarter continuity window: the prior quarter's weeks are ALWAYS merged (not
  // only during the grace period) so Goals/PTO history and per-employee weeks span two
  // fiscal quarters for the Month/Quarter period views (spec 2026-07-07). The prior
  // quarter's compliance is evaluated against its OWN goal set via prevCtx.
  // A quarter boundary can fall mid-week, so the last previous-quarter week and the
  // first current-quarter week can share the same ISO week label — dedupe, keeping the
  // current-quarter copy so it wins the same way goalsAll's merge does below.
  const prevQWeeks = buildPrevQWeeks_PS_(ctx);
  const prevCtx = {
    goalsQuarter:  ctx.prevGoalsQuarter,
    qStartIsoYear: ctx.prevQStartIsoYear,
    qStartIsoWeek: ctx.prevQStartIsoWeek,
    inGracePeriod: false,
  };
  const goalsPrevResult = readGoalsEngagement_(active, prevQWeeks, [], prevCtx, ptoProfiles, empNumToNorm);
  const currentQLabels  = new Set(currentQWeeks.map(w => w.label));
  const continuityQWeeks = prevQWeeks.filter(w => !currentQLabels.has(w.label)).concat(currentQWeeks);

  // Goals-only grace period (CONFIG_PS.GOALS_GRACE_DAYS): freeze the outgoing quarter's
  // final week as the carried-forward snapshot. Only the snapshot behavior is gated on
  // the grace period now — the window widening above is unconditional.
  let goalsFrozenSnapshot = null;
  let graceEndMonday      = null;
  if (ctx.inGracePeriod) {
    const lastPrevWeek = prevQWeeks[prevQWeeks.length - 1];
    goalsFrozenSnapshot = lastPrevWeek ? goalsPrevResult[lastPrevWeek.label] : null;
    graceEndMonday = mondayOfIsoWeek_PS_(ctx.graceEndIsoYear, ctx.graceEndIsoWeek);
  }
```

- [ ] **Step 1.3: Make the goals merge unconditional**

At line ~2995 replace:
```js
  const goalsAll = goalsPrevResult ? mergeGoalsResults_(goalsPrevResult, goalsCurrentResult) : goalsCurrentResult;
```
with:
```js
  const goalsAll = mergeGoalsResults_(goalsPrevResult, goalsCurrentResult);
```

- [ ] **Step 1.4: Update stale comments**

At lines ~2984–2987 (`// PTO Trend (Trends tab) is quarter-bounded like Goals — only current-quarter-to-date`), reword to say the PTO trend history now covers the current **and prior** fiscal quarter (the two-quarter continuity window), still not the long TRACKED_HIST_WEEKS window. At line ~3115 (`// Bounded to the current quarter-to-date (plus the outgoing quarter's grace-period tail)` above `ptoQ4History`), reword to "Bounded to the two-quarter continuity window (current + prior fiscal quarter)".

- [ ] **Step 1.5: Verify by inspection + GAS test note**

No new backend unit test is possible for `computePSReport_` (it reads live sheets). Verify:
1. `grep -n "goalsPrevResult\|continuityQWeeks" "PS Contribution Report.js"` — no remaining `let goalsPrevResult` and no `ctx.inGracePeriod` guard around the window construction.
2. Run: `node -e "new (require('vm').Script)(require('fs').readFileSync('PS Contribution Report.js','utf8'))"` — expect no output (syntax valid; GAS files are plain JS).

Record in the final QA task: run `_test_computeFiscalContext()` in the GAS editor (must still pass — it is untouched) and check `Logger` output of one `getPSReportData()` run for `history months=` / no `⚠️`/`❌` lines.

- [ ] **Step 1.6: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(psdash): two-quarter history window — always merge prior-quarter goals, widen PTO/employee weeks"
```

**Known payload effects (accepted by spec):** `employees[].weeks`, `goalsQ4Hist`, `ptoQ4History`, `q4Weeks` now span ~26 weeks. If the JSON exceeds 100 KB, `_sCache.put` (line ~2901) already try/catches and skips caching — slower loads, no breakage. Client week-mode views are re-bounded in Tasks 3, 6, 8.

---

### Task 2: Client — pure period-bucket module + Node test (TDD)

**Files:**
- Create: `D:\Contribution\tests\period-buckets.test.js`
- Modify: `D:\Contribution\PS Dashboard.html` (add a `<script>`-level block near the `Q4` helpers, after `weekInQ4Range_` ends at line ~2097)

- [ ] **Step 2.1: Write the failing test**

Create `tests/period-buckets.test.js`:

```js
// Unit tests for the PERIOD-PURE block in PS Dashboard.html.
// Run: node tests/period-buckets.test.js   (exit 0 = all pass)
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');
const m = src.match(/\/\/ ── PERIOD-PURE-BEGIN ──([\s\S]*?)\/\/ ── PERIOD-PURE-END ──/);
if (!m) { console.error('FAIL: PERIOD-PURE block not found in PS Dashboard.html'); process.exit(1); }
eval(m[1]);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (ok ? '' : ' — got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
}

// ── Thursday rule: week → calendar month ──
check('2026.W27 → Jul (Thu Jul 2)',      pMonthKey('2026.W27'), '2026-07');
check('2026.W23 → Jun (Thu Jun 4)',      pMonthKey('2026.W23'), '2026-06');
check('2026.W22 → May (Thu May 28)',     pMonthKey('2026.W22'), '2026-05');
check('2026.W1 → Jan (Thu Jan 1)',       pMonthKey('2026.W1'),  '2026-01');
check('2020.W53 → Dec (Thu Dec 31)',     pMonthKey('2020.W53'), '2020-12');
check('bad label → null',                pMonthKey('W27'),      null);

// ── Month display label ──
check('2026-06 → "Jun 2026"', pMonthLabel('2026-06'), 'Jun 2026');

// ── Thursday rule: week → fiscal quarter (FY starts July) ──
check('2026.W27 → FY27Q1 (Jul)', pFiscalQuarterKey('2026.W27'), 'FY27Q1');
check('2026.W14 → FY26Q4 (Thu Apr 2)', pFiscalQuarterKey('2026.W14'), 'FY26Q4');
check('2026.W13 → FY26Q3 (Thu Mar 26)', pFiscalQuarterKey('2026.W13'), 'FY26Q3');
check('2026.W1 → FY26Q3 (Jan)', pFiscalQuarterKey('2026.W1'), 'FY26Q3');
check('2025.W49 → FY26Q2 (Dec)', pFiscalQuarterKey('2025.W49'), 'FY26Q2');

// ── Week-range label ──
check('same-year range',  pShortRange(['2026.W23', '2026.W24', '2026.W27']), '2026.W23–W27');
check('cross-year range', pShortRange(['2025.W49', '2026.W5']), '2025.W49–2026.W5');
check('single week',      pShortRange(['2026.W23']), '2026.W23');

// ── buildPeriodBuckets: months over a 2026 window, W28 current ──
const labels = [];
for (let w = 14; w <= 28; w++) labels.push('2026.W' + w);
const mb = buildPeriodBuckets(labels, 'month', '2026.W28');
check('month bucket keys', mb.map(b => b.key), ['2026-04', '2026-05', '2026-06', '2026-07']);
// June 2026 by Thursday rule: W23(Thu Jun 4) W24(Jun 11) W25(Jun 18) W26(Jun 25); W27(Thu Jul 2) → July
check('Jun weeks exact', mb[2].weekLabels, ['2026.W23', '2026.W24', '2026.W25', '2026.W26']);
check('Jul weeks exact', mb[3].weekLabels, ['2026.W27', '2026.W28']);
check('Jul contains current → containsCurrent', mb[3].containsCurrent, true);
check('Jul isPartial', mb[3].isPartial, true);
check('Jun is closed', { c: mb[2].containsCurrent, p: mb[2].isPartial }, { c: false, p: false });
check('Apr truncated → isPartial (starts W14, Apr starts W14 Thu Apr 2 = first 7 days → NOT truncated)', mb[0].isPartial, false);
check('range label on Jun', mb[2].weekRangeLabel, '2026.W23–W26');
check('display labels', mb.map(b => b.label), ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026']);

// Truncated oldest bucket: window starting mid-May
const mb2 = buildPeriodBuckets(['2026.W21', '2026.W22', '2026.W23'], 'month', null);
check('truncated May isPartial', mb2[0].isPartial, true);
check('no current week → no containsCurrent', mb2.map(b => b.containsCurrent), [false, false]);

// ── buildPeriodBuckets: quarters ──
const qb = buildPeriodBuckets(labels, 'quarter', '2026.W28');
check('quarter keys', qb.map(b => b.key), ['FY26Q4', 'FY27Q1']);
check('FY26Q4 weeks W14–W26', qb[0].weekLabels[0] + '..' + qb[0].weekLabels[qb[0].weekLabels.length - 1], '2026.W14..2026.W26');
check('FY27Q1 partial', qb[1].isPartial, true);
check('quarter label passthrough', qb[0].label, 'FY26Q4');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `node tests/period-buckets.test.js`
Expected: `FAIL: PERIOD-PURE block not found in PS Dashboard.html`, exit 1.

- [ ] **Step 2.3: Implement the PERIOD-PURE block**

In `PS Dashboard.html`, immediately after the `weekInQ4Range_` function (ends line ~2097), insert:

```js
// ═══════════════════════════════════════════════════════════════════════════
// PERIOD BUCKETS — pure week→month / week→fiscal-quarter mapping for the
// Week/Month/Quarter toggle (spec 2026-07-07). A week belongs to the calendar
// month (and fiscal quarter) containing its THURSDAY — ISO 8601 majority rule,
// so no week is ever split across two periods. FY starts July 1.
// Everything between the BEGIN/END markers is extracted and unit-tested by
// tests/period-buckets.test.js — keep it pure: no DATA/STATE/DOM access.
// ── PERIOD-PURE-BEGIN ──
function pIsoWeekMonday(year, week) {
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var dow  = jan4.getUTCDay() || 7;
  var w1mon = new Date(jan4);
  w1mon.setUTCDate(jan4.getUTCDate() - dow + 1);
  var mon = new Date(w1mon);
  mon.setUTCDate(w1mon.getUTCDate() + (week - 1) * 7);
  return mon;
}
function pWeekParts(label) {
  var m = /^(\d{4})\.W(\d{1,2})$/.exec(String(label || ''));
  return m ? { year: +m[1], week: +m[2] } : null;
}
function pThursday(label) {
  var p = pWeekParts(label);
  if (!p) return null;
  var thu = pIsoWeekMonday(p.year, p.week);
  thu.setUTCDate(thu.getUTCDate() + 3);
  return thu;
}
function pMonthKey(label) {
  var t = pThursday(label);
  if (!t) return null;
  var mm = t.getUTCMonth() + 1;
  return t.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm;
}
var P_MONTH_ABBREV = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pMonthLabel(key) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  return m ? P_MONTH_ABBREV[+m[2] - 1] + ' ' + m[1] : String(key || '');
}
function pFiscalQuarterKey(label) {
  var t = pThursday(label);
  if (!t) return null;
  var m = t.getUTCMonth() + 1, y = t.getUTCFullYear();
  var fyStartYear = (m >= 7) ? y : y - 1;
  var q = (m >= 7 && m <= 9) ? 1 : (m >= 10) ? 2 : (m <= 3) ? 3 : 4;
  return 'FY' + String(fyStartYear + 1).slice(-2) + 'Q' + q;
}
function pShortRange(weekLabels) {
  if (!weekLabels || !weekLabels.length) return '';
  var a = weekLabels[0], b = weekLabels[weekLabels.length - 1];
  if (a === b) return a;
  var pa = pWeekParts(a), pb = pWeekParts(b);
  if (pa && pb && pa.year === pb.year) return a + '–W' + pb.week;
  return a + '–' + b;
}
// True when `label` is the natural FIRST week of its own period — i.e. its
// Thursday falls within the first 7 days of the month (or of the fiscal
// quarter's first month). Used to detect history-window truncation.
function pIsFirstWeekOfPeriod(label, granularity) {
  var t = pThursday(label);
  if (!t) return false;
  var day = t.getUTCDate(), m = t.getUTCMonth() + 1;
  if (granularity === 'month') return day <= 7;
  var qFirstMonth = (m >= 7 && m <= 9) ? 7 : (m >= 10) ? 10 : (m <= 3) ? 1 : 4;
  return m === qFirstMonth && day <= 7;
}
// weekLabels: oldest→newest labels of the available past+current weeks.
// Returns ordered buckets: [{key, label, weekRangeLabel, weekLabels,
//   containsCurrent, isPartial}]. isPartial = in-progress (contains the
//   current week) OR truncated (oldest bucket missing its natural start).
function buildPeriodBuckets(weekLabels, granularity, currentWeekLabel) {
  var keyFn = granularity === 'month' ? pMonthKey : pFiscalQuarterKey;
  var labFn = granularity === 'month' ? pMonthLabel : function(k) { return k; };
  var buckets = [], byKey = {};
  (weekLabels || []).forEach(function(lbl) {
    var k = keyFn(lbl);
    if (!k) return;
    if (!byKey[k]) { byKey[k] = { key: k, label: labFn(k), weekLabels: [] }; buckets.push(byKey[k]); }
    byKey[k].weekLabels.push(lbl);
  });
  buckets.forEach(function(b, i) {
    b.weekRangeLabel  = pShortRange(b.weekLabels);
    b.containsCurrent = !!(currentWeekLabel && b.weekLabels.indexOf(currentWeekLabel) !== -1);
    var truncated     = i === 0 && !pIsFirstWeekOfPeriod(b.weekLabels[0], granularity);
    b.isPartial       = b.containsCurrent || truncated;
  });
  return buckets;
}
// ── PERIOD-PURE-END ──
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `node tests/period-buckets.test.js`
Expected: all PASS, `… passed, 0 failed`, exit 0. If a Thursday-rule assertion fails, re-derive the expected value by hand (ISO W1 Monday of 2026 is 2025-12-29) before touching the implementation.

- [ ] **Step 2.5: Commit**

```bash
git add "PS Dashboard.html" tests/period-buckets.test.js
git commit -m "feat(psdash): pure period-bucket module (Thursday rule) + Node tests"
```

---

### Task 3: Client — STATE, segmented controls, period-aware pickers

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — STATE (line ~1970), CSS block (append near the Trends CSS ~line 396), Exec Brief header (lines ~1873–1886), Radar controls (lines ~1414–1431), Trends pane top (line ~1689), `populateWeekSelect_` (lines 2532–2551), `onDataLoaded` init block (lines ~2234–2238)

- [ ] **Step 3.1: STATE additions**

In the `STATE` literal (lines 1970–1983), after `lastRegularTab:   "overview",` add:
```js
  periodGranularity: "week",   // 'week' | 'month' | 'quarter' — shared across Brief/Radar/Trends
  selectedPeriod:    null,     // selected bucket key ('2026-06' / 'FY26Q4') or week label; null = default (last closed)
```

- [ ] **Step 3.2: Segmented-control CSS**

Append to the stylesheet (e.g. right after the `.verdict` rules that end near line ~420):
```css
/* ── Week/Month/Quarter segmented control (period toggle, spec 2026-07-07) ── */
.seg-ctl { display:inline-flex; border:1px solid var(--line, #CBD5E1); border-radius:8px; overflow:hidden; flex-shrink:0 }
.seg-ctl button { border:0; background:transparent; padding:4px 12px; font-size:11px; font-weight:700; cursor:pointer; color:var(--muted); letter-spacing:.02em }
.seg-ctl button + button { border-left:1px solid var(--line, #CBD5E1) }
.seg-ctl button.active { background:var(--orbe, #058CDC); color:#fff }
```
(Check `--line` exists in `:root`; if not, the `#CBD5E1` fallback covers it.)

- [ ] **Step 3.3: Control markup — three placements**

1. **Exec Brief** (inside the `section-head` div, lines ~1880–1884): before the `Evaluate Week` label div, insert `<div class="seg-ctl" data-gran-ctl></div>` and give the label an id:
```html
<div class="seg-ctl" data-gran-ctl></div>
<label id="ebPickerLabel" style="…same style…">Evaluate Week</label>
```
2. **Team Radar** (lines ~1414–1418): same — insert `<div class="seg-ctl" data-gran-ctl></div>` before the `Evaluate Week` label; give that label `id="radarPickerLabel"`.
3. **Trends** (just inside `<div id="tabTrends" class="tab-pane">`, line ~1689): add a control strip (Trends has no specific-period picker — charts show every bucket):
```html
<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
  <div class="seg-ctl" data-gran-ctl></div>
</div>
```

- [ ] **Step 3.4: Control renderer + granularity switch**

Insert after the PERIOD-PURE block (Task 2):
```js
// ── Period toggle wiring (shared STATE.periodGranularity across Brief/Radar/Trends) ──
var PERIOD_GRANS = [ { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'quarter', label: 'Quarter' } ];
function renderGranCtls_() {
  document.querySelectorAll('[data-gran-ctl]').forEach(function(el) {
    el.innerHTML = PERIOD_GRANS.map(function(g) {
      return '<button type="button" class="' + (STATE.periodGranularity === g.id ? 'active' : '') +
        '" onclick="setPeriodGranularity(\'' + g.id + '\')">' + g.label + '</button>';
    }).join('');
  });
}
function updatePeriodPickerLabels_() {
  var word = STATE.periodGranularity === 'month' ? 'Month' : STATE.periodGranularity === 'quarter' ? 'Quarter' : 'Week';
  ['ebPickerLabel', 'radarPickerLabel'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = 'Evaluate ' + word;
  });
}
function setPeriodGranularity(g) {
  if (STATE.periodGranularity === g) return;
  STATE.periodGranularity = g;
  STATE.selectedPeriod = null;                // reset to "most recent closed" default
  renderGranCtls_();
  updatePeriodPickerLabels_();
  populateRadarWeekSelect();
  populateEbWeekSelect();
  renderAll();
}
// Week universe for bucketing = every past/current week the payload ships.
function periodWeekUniverse_() {
  return (DATA && DATA.trackedHistory || []).map(function(h) { return h.label; });
}
function periodBucketsFor_(granularity) {
  return buildPeriodBuckets(periodWeekUniverse_(), granularity, DATA && DATA.meta && DATA.meta.currentWeekLabel);
}
// Display label incl. in-progress marker — single source for subtitles/options.
function periodDisplayLabel_(b) {
  return b.label + (b.containsCurrent ? ' (in progress)' : '');
}
```

- [ ] **Step 3.5: Period-aware `populateWeekSelect_`**

Replace the whole function (lines 2532–2547) with (note the new `forceWeek` param and the current-quarter bound, needed because `q4Weeks` now spans two quarters):
```js
function populateWeekSelect_(selId, forceWeek) {
  var sel = document.getElementById(selId);
  if (!sel || !DATA) return;
  sel.innerHTML = "";
  var g = forceWeek ? 'week' : STATE.periodGranularity;
  if (g === 'week') {
    // q4Weeks now spans TWO quarters (period views need it) — keep the week picker
    // bounded to the current quarter window exactly as before the widening.
    var allQ4      = (DATA.q4Weeks || DATA.weeks).filter(function(w) { return weekInQ4Range_(w.year, w.isoWeek); });
    var candidates = allQ4.filter(function(w) { return !w.isFuture; });
    var pastW      = candidates.filter(function(w) { return w.isPast; });
    var defaultLabel = STATE.selectedPeriod && candidates.some(function(w) { return w.label === STATE.selectedPeriod; })
      ? STATE.selectedPeriod
      : (pastW.length > 0 ? pastW[pastW.length - 1].label : DATA.meta.currentWeekLabel);
    candidates.forEach(function(w) {
      var opt = document.createElement("option");
      opt.value = w.label;
      opt.textContent = w.label + " (" + w.dateRange + ")" + (w.isPast ? " — completed" : " — in progress");
      if (w.label === defaultLabel) opt.selected = true;
      sel.appendChild(opt);
    });
    return;
  }
  var buckets = periodBucketsFor_(g);
  var closed  = buckets.filter(function(b) { return !b.containsCurrent; });
  var defaultKey = STATE.selectedPeriod && buckets.some(function(b) { return b.key === STATE.selectedPeriod; })
    ? STATE.selectedPeriod
    : (closed.length ? closed[closed.length - 1].key : (buckets.length ? buckets[buckets.length - 1].key : null));
  buckets.forEach(function(b) {
    var opt = document.createElement("option");
    opt.value = b.key;
    opt.textContent = b.label + " · " + b.weekRangeLabel + (b.containsCurrent ? " — in progress" : " — completed");
    if (b.key === defaultKey) opt.selected = true;
    sel.appendChild(opt);
  });
}
```
And update the three wrappers (lines 2549–2551) — `rkWeekSelect` (Leading Behaviours) stays week-only:
```js
function populateRkWeekSelect()    { populateWeekSelect_("rkWeekSelect", true); }
function populateRadarWeekSelect() { populateWeekSelect_("radarWeekSelect"); }
function populateEbWeekSelect()    { populateWeekSelect_("ebWeekSelect"); }
```

- [ ] **Step 3.6: Persist picker choice + init**

The two pickers must record their choice so tab-switches keep the evaluated period. Change their `onchange` in the HTML:
- `ebWeekSelect` (line ~1882): `onchange="STATE.selectedPeriod=this.value; renderExecBriefTab_()"`
- `radarWeekSelect` (line ~1417): `onchange="STATE.selectedPeriod=this.value; renderRadarTab(getFilteredEmployees())"`

In the init sequence (lines 2234–2238), after `populateEbWeekSelect();` add:
```js
  renderGranCtls_();
  updatePeriodPickerLabels_();
```

- [ ] **Step 3.7: Sanity-run the pure tests + syntax check, then commit**

Run: `node tests/period-buckets.test.js` — expect PASS (block markers untouched).
```bash
git add "PS Dashboard.html"
git commit -m "feat(psdash): Week/Month/Quarter segmented control + period-aware pickers, shared STATE"
```

---

### Task 4: Client — period aggregation adapters

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — insert directly after the Task 3 wiring block

These adapters shape bucket data like existing weekly entries so renderers can consume either. Per-metric semantics from the spec: averages for flow, sums for counts, period-end for standings.

- [ ] **Step 4.1: Add the adapters**

```js
// ── Period aggregation adapters (spec 2026-07-07 §3) ─────────────────────────
// Bucketed trackedHistory: same field names as DATA.trackedHistory entries so the
// Trends renderers can consume either. Flow metrics = avg per CLOSED week; counts
// (kudos, totalHrs, totalComments, plannedHrs) = sums; isCurrentWeek marks the
// in-progress bucket so existing "closed week" filters (!h.isCurrentWeek) work.
function periodTrackedHistory_(granularity) {
  var hist = (DATA && DATA.trackedHistory) || [];
  var byLabel = {};
  hist.forEach(function(h) { byLabel[h.label] = h; });
  return periodBucketsFor_(granularity).map(function(b) {
    var entries = b.weekLabels.map(function(l) { return byLabel[l]; }).filter(Boolean);
    var closed  = entries.filter(function(h) { return !h.isCurrentWeek; });
    var use     = closed.length ? closed : entries;   // in-progress bucket with no closed week yet
    function avg(f) {
      var v = use.map(f).filter(function(x) { return x !== null && x !== undefined && !isNaN(x); });
      return v.length ? v.reduce(function(a, c) { return a + c; }, 0) / v.length : null;
    }
    function sum(f) { return entries.reduce(function(a, h) { return a + (+f(h) || 0); }, 0); }
    function r1(x)  { return x === null ? null : Math.round(x * 10) / 10; }
    function r0(x)  { return x === null ? null : Math.round(x); }
    return {
      label:          periodDisplayLabel_(b),
      periodKey:      b.key,
      weekLabels:     b.weekLabels,
      closedWeekLabels: closed.map(function(h) { return h.label; }),
      weekRangeLabel: b.weekRangeLabel,
      dateRange:      b.weekRangeLabel,
      isCurrentWeek:  b.containsCurrent,
      isFuture:       false,
      isPartial:      b.isPartial,
      totalHrs:       sum(function(h) { return h.totalHrs; }),
      headcount:      Math.max.apply(null, [0].concat(use.map(function(h) { return h.headcount || 0; }))),
      avgHrs:                r1(avg(function(h) { return h.avgHrs; })),
      trackedPct:            r0(avg(function(h) { return h.trackedPct; })),
      plannedHrs:     sum(function(h) { return h.plannedHrs; }),
      plannedHC:      Math.max.apply(null, [0].concat(use.map(function(h) { return h.plannedHC || 0; }))),
      avgPlannedHrs:         r1(avg(function(h) { return h.avgPlannedHrs; })),
      plannedPct:            r0(avg(function(h) { return h.plannedPct; })),
      kudosCount:     sum(function(h) { return h.kudosCount; }),
      totalComments:  sum(function(h) { return h.totalComments; }),
      avgCommentsPerPerson:  r1(avg(function(h) { return h.avgCommentsPerPerson; })),
      commentedPct:          r0(avg(function(h) { return h.commentedPct; })),
      commentedHC:           r0(avg(function(h) { return h.commentedHC; })),
      g03CommentedPct:       r0(avg(function(h) { return h.g03CommentedPct; })),
      g01CommentedPct:       r0(avg(function(h) { return h.g01CommentedPct; })),
    };
  });
}
// Bucketed PTO history: PTO health is a point-in-time STANDING, so each bucket
// reports its LAST CLOSED week's entry (fallback: last entry when the bucket has
// no closed week yet). Same field names as DATA.ptoQ4History entries.
function periodPtoHistory_(granularity) {
  var hist = (DATA && DATA.ptoQ4History) || [];
  var byLabel = {};
  hist.forEach(function(h) { byLabel[h.label] = h; });
  return periodBucketsFor_(granularity).map(function(b) {
    var entries = b.weekLabels.map(function(l) { return byLabel[l]; }).filter(Boolean);
    if (!entries.length) return null;
    var closed = entries.filter(function(h) { return !h.isCurrent; });
    var end    = closed.length ? closed[closed.length - 1] : entries[entries.length - 1];
    return {
      label:     periodDisplayLabel_(b),
      periodKey: b.key,
      good:      end.good, atRisk: end.atRisk, total: end.total, pct: end.pct,
      byEmp:     end.byEmp || {},
      isCurrent: b.containsCurrent,
      isPartial: b.isPartial,
      endWeekLabel: end.label,
      weekRangeLabel: b.weekRangeLabel,
    };
  }).filter(Boolean);
}
// Filter-aware per-bucket stats from per-employee week data — powers the period
// Exec Brief and the period Radar. Standings (goals/pto) read the bucket's last
// closed week; flow metrics average over closed weeks; kudos sums.
// PTO_IMPACT_THRESHOLD_HRS exclusion matches computeGroupMetrics (radar parity).
function computePeriodStats_(emps, bucket) {
  if (!emps || !emps.length || !bucket) return null;
  var closed = bucket.closedWeekLabels && bucket.closedWeekLabels.length
    ? bucket.closedWeekLabels
    : bucket.weekLabels.filter(function(l) { return l !== (DATA.meta && DATA.meta.currentWeekLabel); });
  if (!closed.length) closed = bucket.weekLabels.slice();
  var endLabel = closed[closed.length - 1];
  var n = emps.length;
  var weekly = closed.map(function(lbl) {
    var tracked = 0, trackedHC = 0, trackedCompliant = 0, trackedEligible = 0;
    var plannedHrs = 0, plannedCompliant = 0, plannedEligible = 0, kudos = 0;
    emps.forEach(function(e) {
      var wd = e.weeks && e.weeks[lbl];
      if (!wd) return;
      var ptoExcluded = (wd.ptoPlannedHrs || 0) >= PTO_IMPACT_THRESHOLD_HRS;
      if (wd.trackedHrs != null && !isNaN(+wd.trackedHrs)) { tracked += +wd.trackedHrs; trackedHC++; }
      if (!ptoExcluded) { trackedEligible++; if (+wd.trackedHrs > 0) trackedCompliant++; }
      if (wd.plannedHrs != null && +wd.plannedHrs > 0) plannedHrs += +wd.plannedHrs;
      if (!ptoExcluded) { plannedEligible++; if (+wd.plannedHrs > 0) plannedCompliant++; }
      if (wd.kudos) kudos += (wd.kudos.count || 0);
    });
    return {
      label: lbl,
      avgTracked: trackedHC > 0 ? tracked / trackedHC : null,
      totalTracked: tracked, trackedHC: trackedHC,
      trackedPct: trackedEligible > 0 ? trackedCompliant / trackedEligible * 100 : null,
      plannedPct: plannedEligible > 0 ? plannedCompliant / plannedEligible * 100 : null,
      plannedHrs: plannedHrs, kudos: kudos,
    };
  });
  function avg(f) {
    var v = weekly.map(f).filter(function(x) { return x !== null && !isNaN(x); });
    return v.length ? v.reduce(function(a, c) { return a + c; }, 0) / v.length : null;
  }
  var endStats = getWeekStats(emps, endLabel);  // goals gc/gt/goalsPct + pto standings at period end
  return {
    headcount: n,
    weeks: weekly,
    closedWeekCount: closed.length,
    endWeekLabel: endLabel,
    avgTrackedPerPerson: avg(function(w) { return w.avgTracked; }),
    totalTrackedHrs:     weekly.reduce(function(a, w) { return a + w.totalTracked; }, 0),
    trackedCompliancePct: avg(function(w) { return w.trackedPct; }),
    plannedCompliancePct: avg(function(w) { return w.plannedPct; }),
    totalPlannedHrs:     weekly.reduce(function(a, w) { return a + w.plannedHrs; }, 0),
    kudosTotal:          weekly.reduce(function(a, w) { return a + w.kudos; }, 0),
    goalsPct: endStats.gt > 0 ? Math.round(endStats.goalsPct) : null,
    goalsCompliant: endStats.gc, goalsTotal: endStats.gt,
    ptoScore: endStats.ptoScore, ptoGood: endStats.ptoGood, ptoAtRisk: endStats.ptoAtRisk, ptoTotal: endStats.ptoTotal,
  };
}
// RCR for a bucket: month → native monthly value; quarter → mean of the quarter's
// monthly team values, flagged approx (true RCR is SUM(RC)/SUM(TCC), never an
// average of averages — see feedback_ps_report memory / Data Reference).
function periodRcr_(bucket, granularity) {
  var hist = (DATA.meta && DATA.meta.rcrHistory) || [];   // [{month:"Jun 26", rcr, exact}]
  function monthEntryKey(mo) {  // "Jun 26" → "2026-06"
    var m = /^(\w{3}) (\d{2})$/.exec(mo || '');
    if (!m) return null;
    var idx = P_MONTH_ABBREV.indexOf(m[1]);
    return idx === -1 ? null : ('20' + m[2] + '-' + (idx < 9 ? '0' : '') + (idx + 1));
  }
  if (granularity === 'month') {
    var hit = hist.find(function(r) { return monthEntryKey(r.month) === bucket.periodKey || monthEntryKey(r.month) === bucket.key; });
    return hit ? { value: hit.rcr, approx: !hit.exact, months: [hit.month] } : null;
  }
  var months = hist.filter(function(r) {
    var k = monthEntryKey(r.month);
    if (!k) return false;
    // reuse the fiscal mapping: fake a week label whose Thursday lands mid-month
    var fq = pFiscalQuarterKey ? (function() {
      var y = +k.slice(0, 4), mo = +k.slice(5, 7);
      var fyStartYear = (mo >= 7) ? y : y - 1;
      var q = (mo >= 7 && mo <= 9) ? 1 : (mo >= 10) ? 2 : (mo <= 3) ? 3 : 4;
      return 'FY' + String(fyStartYear + 1).slice(-2) + 'Q' + q;
    })() : null;
    return fq === (bucket.periodKey || bucket.key);
  });
  if (!months.length) return null;
  var mean = months.reduce(function(a, r) { return a + r.rcr; }, 0) / months.length;
  return { value: Math.round(mean * 100) / 100, approx: true, months: months.map(function(r) { return r.month; }) };
}
```
Refactor note while editing: extract the quarter-derivation in `periodRcr_` into a tiny shared helper `pFiscalQuarterOfMonth_(year, month1to12)` placed OUTSIDE the PERIOD-PURE block (it's fine as a sibling) and call it from both places rather than duplicating the ternary chain, if the executor prefers — either form passes review as long as there is exactly one copy of the month→quarter rule outside the pure block.

- [ ] **Step 4.2: Syntax check + commit**

Open the file in a browser (or run `node -e "…vm Script…"` is NOT possible for HTML) — minimum bar: `node tests/period-buckets.test.js` still passes (proves the file still parses far enough for the regex) and a quick manual paren-balance review of the inserted block.
```bash
git add "PS Dashboard.html"
git commit -m "feat(psdash): period aggregation adapters (tracked/PTO/per-employee/RCR)"
```

---

### Task 5: Exec Brief — period mode

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — `renderExecBriefTab_` (lines 3574–3599), `buildTeamBriefHTML` (lines 3011–3081), new `generatePeriodBrief` inserted right before `buildTeamBriefHTML`

- [ ] **Step 5.1: Generalize `buildTeamBriefHTML` labels**

The function signature stays `buildTeamBriefHTML(weekLabel, prevWeekLabel, brief)` but gains an optional 4th arg. Change the signature line (3011) to:
```js
function buildTeamBriefHTML(weekLabel, prevWeekLabel, brief, opts) {
```
Then at lines ~3013–3014 replace:
```js
  var selWeek   = DATA.weeks.find(function(w) { return w.label === weekLabel; });
  var dateRange = selWeek ? selWeek.dateRange : '';
```
with:
```js
  var selWeek   = DATA.weeks.find(function(w) { return w.label === weekLabel; });
  var dateRange = (opts && opts.dateRange) || (selWeek ? selWeek.dateRange : '');
```
Nothing else changes — the `<h3>Team Executive Brief — ' + esc(weekLabel)` title and `_teamBriefStore.weekLabel` already render whatever label string is passed, so period labels ("Jun 2026") flow through the Copy and Gemini pipelines untouched.

- [ ] **Step 5.2: Add `generatePeriodBrief`**

Insert immediately above `function buildTeamBriefHTML` (line ~3011):

```js
// Period-mode Exec Brief (spec 2026-07-07 §4): same Facts/Highlights/Notes/Concerns/
// Trends sections as the weekly brief, computed over the selected bucket and compared
// with the prior bucket. Filter-aware via getFilteredEmployees(). Weekly path untouched.
function generatePeriodBrief(bucket, prevBucket, allBuckets) {
  var facts = [], highlights = [], notes = [], concerns = [], trends = [];
  if (!DATA || !bucket) return { facts: ['Data loading…'], highlights: [], notes: [], concerns: [], trends: [] };
  var emps  = getFilteredEmployees();
  var g     = STATE.periodGranularity;
  var cur   = computePeriodStats_(emps, bucket);
  var prev  = prevBucket ? computePeriodStats_(emps, prevBucket) : null;
  var unit  = g === 'month' ? 'month' : 'quarter';
  if (!cur) return { facts: ['No data for ' + periodDisplayLabel_(bucket)], highlights: [], notes: [], concerns: [], trends: [] };

  function f1(x) { return x === null || x === undefined ? '—' : (Math.round(x * 10) / 10).toFixed(1); }
  function pct(x) { return x === null || x === undefined ? '—' : Math.round(x) + '%'; }
  function vs(curV, prevV, unitSuffix, goodHigh) {
    if (prevV === null || prevV === undefined || curV === null || curV === undefined || !prevBucket) return '';
    var d = curV - prevV;
    if (Math.abs(d) < 0.05) return ', level with ' + prevBucket.label;
    var dir = d > 0 ? 'up' : 'down';
    return ', ' + dir + ' from ' + (unitSuffix === '%' ? Math.round(prevV) + '%' : f1(prevV) + unitSuffix) + ' in ' + prevBucket.label;
  }

  // Coverage — explicit when the period is in progress or truncated (spec §5)
  if (bucket.isPartial) {
    facts.push('Coverage: ' + cur.closedWeekCount + ' closed week' + (cur.closedWeekCount !== 1 ? 's' : '') +
      ' (' + bucket.weekRangeLabel + ')' + (bucket.containsCurrent ? ' — ' + unit + ' in progress' : ' — start of window truncated by available history'));
  }

  // Tracked time — avg h/person/week, same 36/28 thresholds as the weekly brief
  var t = cur.avgTrackedPerPerson;
  facts.push('Tracked time: ' + f1(t) + 'h avg/person/week · ' + Math.round(cur.totalTrackedHrs) + 'h total across ' + cur.closedWeekCount + ' week' + (cur.closedWeekCount !== 1 ? 's' : ''));
  if (t !== null) {
    var tCmp = vs(t, prev && prev.avgTrackedPerPerson, 'h', true);
    if (t >= 36)      highlights.push('Tracked time averaged ' + f1(t) + 'h/person/week in ' + bucket.label + tCmp + ' — strong delivery engagement');
    else if (t >= 28) notes.push('Tracked time averaged ' + f1(t) + 'h/person/week in ' + bucket.label + tCmp + ' — above the 28h floor, below the 36h target');
    else              concerns.push('Tracked time averaged ' + f1(t) + 'h/person/week in ' + bucket.label + tCmp + ' — below the 28h floor; review workload and logging habits');
  }

  // Planned coverage — avg weekly compliance %
  var p = cur.plannedCompliancePct;
  facts.push('Tempo planning coverage: ' + pct(p) + ' avg weekly · ' + Math.round(cur.totalPlannedHrs) + 'h planned in the period');
  if (p !== null) {
    var pCmp = vs(p, prev && prev.plannedCompliancePct, '%', true);
    if (p >= 80)      highlights.push('Planning coverage held at ' + pct(p) + ' through ' + bucket.label + pCmp + ' (Build Process to Drive Outcomes)');
    else if (p >= 50) notes.push('Planning coverage at ' + pct(p) + ' in ' + bucket.label + pCmp + ' — push toward the 80% habit');
    else              concerns.push('Planning coverage at ' + pct(p) + ' in ' + bucket.label + pCmp + ' — planning discipline needs manager attention');
  }

  // Goals — period-end standing (point-in-time, not additive)
  if (cur.goalsPct !== null) {
    var gCmp = prev && prev.goalsPct !== null ? vs(cur.goalsPct, prev.goalsPct, '%', true).replace(' in ' + (prevBucket && prevBucket.label), ' at end of ' + (prevBucket && prevBucket.label)) : '';
    facts.push('Goals compliance (' + (DATA.meta.goalsQuarter || '') + '): ' + cur.goalsPct + '% (' + cur.goalsCompliant + '/' + cur.goalsTotal + ') as of ' + cur.endWeekLabel + ' — period-end standing');
    if (cur.goalsPct >= 80)      highlights.push('Goals compliance closed ' + bucket.label + ' at ' + cur.goalsPct + '%' + gCmp);
    else if (cur.goalsPct >= 60) notes.push('Goals compliance closed ' + bucket.label + ' at ' + cur.goalsPct + '%' + gCmp + ' — keep the documentation cadence');
    else                         concerns.push('Goals compliance closed ' + bucket.label + ' at ' + cur.goalsPct + '%' + gCmp + ' — structured follow-up needed');
  }

  // Kudos — summed over the period
  var kCmp = prev ? vs(cur.kudosTotal, prev.kudosTotal, '', true) : '';
  facts.push('Kudos: ' + cur.kudosTotal + ' given across ' + bucket.label);
  if (cur.kudosTotal > 0) highlights.push(cur.kudosTotal + ' kudos given in ' + bucket.label + kCmp + ' — Think Team in practice');
  else                    concerns.push('No kudos given in ' + bucket.label + ' — prompt the team to recognize each other\'s contributions (Think Team)');

  // PTO — period-end standing
  if (cur.ptoScore !== null) {
    facts.push('PTO planning health: ' + cur.ptoScore + '% (' + cur.ptoAtRisk + ' at risk) as of ' + cur.endWeekLabel);
    if (cur.ptoScore >= 80)      highlights.push(cur.ptoScore + '% of the team closed ' + bucket.label + ' with PTO under control — sustainable pace maintained');
    else if (cur.ptoScore >= 60) notes.push('PTO planning health ended ' + bucket.label + ' at ' + cur.ptoScore + '% — ' + cur.ptoAtRisk + ' rocketeer' + (cur.ptoAtRisk !== 1 ? 's' : '') + ' need a recovery plan');
    else                         concerns.push('PTO planning health ended ' + bucket.label + ' at ' + cur.ptoScore + '% (Build Process to Drive Outcomes — sustainable pace at risk)');
  }

  // RCR — native monthly / approx quarterly mean
  var rcr = periodRcr_(bucket, g);
  if (rcr) {
    facts.push('RCR: ' + rcr.value.toFixed(2) + '×' + (rcr.approx ? ' (approx — mean of ' + rcr.months.join(', ') + '; true RCR is SUM(RC)/SUM(TCC))' : ' (' + rcr.months[0] + ')') + ' · review with manager');
    notes.push('RCR context: ' + rcr.value.toFixed(2) + '× for ' + bucket.label + ' · represents project mix & billing rates · not a per-rocketeer blame signal');
  }

  // SI — quarterly native; month shows owning quarter as context
  if (DATA.meta.siTeamRounded != null) {
    facts.push('Small Improvements (SI): ' + DATA.meta.siTeamRounded + '/5 (' + (DATA.meta.siQuarter || '') + ') · quarterly metric' + (g === 'month' ? ' shown as context for the month' : ''));
  }

  // Trends section: week-by-week inside a month, sub-period-by-sub-period inside a quarter
  var innerG   = g === 'quarter' ? 'month' : null;
  if (innerG) {
    var inner = periodTrackedHistory_(innerG).filter(function(h) {
      return h.weekLabels.some(function(l) { return bucket.weekLabels.indexOf(l) !== -1; });
    });
    if (inner.length >= 2) trends.push('Tracked avg/person/week by month: ' + inner.map(function(h) { return h.label + ' ' + f1(h.avgHrs) + 'h'; }).join(' → '));
    if (inner.length >= 2) trends.push('Kudos by month: ' + inner.map(function(h) { return h.label + ' ' + h.kudosCount; }).join(' → '));
  } else {
    trends.push('Tracked avg/person by week: ' + cur.weeks.map(function(w) { return w.label + ' ' + f1(w.avgTracked) + 'h'; }).join(' → '));
    trends.push('Planning coverage by week: ' + cur.weeks.map(function(w) { return w.label + ' ' + pct(w.plannedPct); }).join(' → '));
    trends.push('Kudos by week: ' + cur.weeks.map(function(w) { return w.label + ' ' + w.kudos; }).join(' → '));
  }
  if (prevBucket && (!prev || prev.closedWeekCount === 0)) {
    notes.push('No prior-period data available for ' + prevBucket.label + ' — comparisons omitted rather than shown as zero');
  }

  if (!facts.length)      facts.push('Metric data unavailable for ' + periodDisplayLabel_(bucket));
  if (!highlights.length) highlights.push('Team operational metrics stable across ' + bucket.label + ' — no exceptional positive signals');
  if (!notes.length)      notes.push('No watch items this ' + unit + ' — all metrics within expected range');
  if (!concerns.length)   concerns.push('No critical concerns — maintain current trajectory across all dimensions');

  return { facts: facts, highlights: highlights, notes: notes, concerns: concerns, trends: trends };
}
```

- [ ] **Step 5.3: Dispatch in `renderExecBriefTab_`**

Replace the function body (lines 3574–3599) with a granularity dispatch that leaves the weekly path byte-identical:
```js
function renderExecBriefTab_() {
  var el = document.getElementById("execBriefBody");
  if (!el || !DATA) return;
  var g = STATE.periodGranularity;

  if (g !== 'week') {
    var buckets = periodBucketsFor_(g);
    if (!buckets.length) { el.innerHTML = '<p style="color:var(--muted);font-size:12px;padding:12px">No period data available yet.</p>'; return; }
    var sel    = document.getElementById("ebWeekSelect");
    var selKey = sel && sel.value ? sel.value : null;
    var bIdx   = Math.max(0, buckets.findIndex(function(b) { return b.key === selKey; }));
    if (selKey === null) {  // default: most recent closed bucket
      for (var i = buckets.length - 1; i >= 0; i--) { if (!buckets[i].containsCurrent) { bIdx = i; break; } }
    }
    var bucket = buckets[bIdx];
    var prevB  = bIdx > 0 ? buckets[bIdx - 1] : null;
    var dispLabel = periodDisplayLabel_(bucket);

    var sub = document.getElementById("execBriefSub");
    if (sub) {
      sub.textContent = (g === 'month' ? 'Monthly' : 'Quarterly') + ' leadership summary · ' +
        dispLabel + ' · ' + bucket.weekRangeLabel + (prevB ? '  ·  vs ' + prevB.label : '');
    }
    var brief = generatePeriodBrief(bucket, prevB, buckets);
    el.innerHTML = buildTeamBriefHTML(dispLabel, prevB ? prevB.label : null, brief, { dateRange: bucket.weekRangeLabel });
    return;
  }

  // ── weekly path — unchanged from before this feature ──
  var sel      = document.getElementById("ebWeekSelect");
  var selLabel = sel && sel.value ? sel.value : null;
  var q4w      = DATA.q4Weeks || DATA.weeks;
  if (!selLabel) {
    var pastW = q4w.filter(function(w) { return w.isPast; });
    selLabel  = pastW.length > 0 ? pastW[pastW.length - 1].label : DATA.meta.currentWeekLabel;
  }
  var selWeek  = q4w.find(function(w) { return w.label === selLabel; });
  var selIdx   = q4w.indexOf(selWeek);
  var prevWeek = (selIdx > 0 && !q4w[selIdx - 1].isFuture) ? q4w[selIdx - 1] : null;

  var sub = document.getElementById("execBriefSub");
  if (sub && selWeek) {
    var inProgress = !selWeek.isPast ? " (in progress)" : "";
    sub.textContent = "Weekly leadership summary · " + selLabel + " (" + selWeek.dateRange + ")" + inProgress
      + (prevWeek ? "  ·  vs " + prevWeek.label : "");
  }

  var brief = generateTeamBrief(selLabel, prevWeek ? prevWeek.label : null);
  el.innerHTML = buildTeamBriefHTML(selLabel, prevWeek ? prevWeek.label : null, brief);
}
```
Note: in week mode the picker is quarter-bounded (Task 3), so `selLabel` from the picker is always inside `q4Weeks` — the `prevWeek` lookup against the wider `q4Weeks` still resolves the week before the quarter's first week, which is fine (it has real data now).

- [ ] **Step 5.4: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(psdash): Exec Brief monthly/quarterly mode — period narrative vs prior bucket"
```

---

### Task 6: Team Radar — period mode + week-mode bounding

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — `renderRadarTab` (lines 5903–5991), new `computeGroupMetricsPeriod` inserted after `computeGroupMetrics` (ends line ~5559)

- [ ] **Step 6.1: Add `computeGroupMetricsPeriod`**

Insert after `computeGroupMetrics`'s closing brace (~line 5559). It returns the exact same 19-property shape so `normalizeAxisValue`, `rawAxisLabel`, `buildAxisSublabel`, `getActiveAxes`, `buildRadarTable`, and `buildRadarActionCards` work unchanged:

```js
// Period-mode twin of computeGroupMetrics (spec 2026-07-07 §4): standings (goals,
// pto) evaluate at the bucket's last closed week; flow axes (tracked/planned
// compliance, kudos) average/sum across the bucket's closed weeks. kudosPerPerson
// stays PER WEEK so the "2/person = 100" normalization keeps its meaning.
// Returns the same property shape as computeGroupMetrics.
function computeGroupMetricsPeriod(group, bucket) {
  if (!group || group.length === 0 || !bucket) return null;
  var s = computePeriodStats_(group, bucket);
  if (!s) return null;
  var n = group.length;
  var rcrVals = group.filter(function(e) { return e.rcr && e.rcr.value !== null; }).map(function(e) { return e.rcr.value; });
  var rcrAvg  = rcrVals.length ? rcrVals.reduce(function(a, b) { return a + b; }, 0) / rcrVals.length : null;
  var siVals  = group.filter(function(e) { return e.si && e.si.value !== null && e.si.value > 0; }).map(function(e) { return e.si.value; });
  var siAvg   = siVals.length ? siVals.reduce(function(a, b) { return a + b; }, 0) / siVals.length : null;
  var kudosPerWeek = s.closedWeekCount > 0 ? s.kudosTotal / s.closedWeekCount : 0;
  return {
    headcount: n,
    rcrAvg: rcrAvg !== null ? Math.round(rcrAvg * 100) / 100 : null,
    siAvg:  siAvg  !== null ? Math.round(siAvg  * 10)  / 10  : null,
    goalsPct: s.goalsPct !== null ? s.goalsPct : 0,
    goalsCompliant: s.goalsCompliant, goalsTotal: s.goalsTotal,
    avgTracked: s.avgTrackedPerPerson !== null ? Math.round(s.avgTrackedPerPerson * 10) / 10 : 0,
    trackedCompliant: null, trackedEligible: null,   // per-week counts don't aggregate; sublabels handle null
    trackedCompliancePct: s.trackedCompliancePct !== null ? Math.round(s.trackedCompliancePct) : 0,
    avgPlanned: s.closedWeekCount > 0 ? Math.round(s.totalPlannedHrs / n / s.closedWeekCount * 10) / 10 : 0,
    plannedCompliant: null, plannedEligible: null,
    plannedCompliancePct: s.plannedCompliancePct !== null ? Math.round(s.plannedCompliancePct) : 0,
    kudosCount: s.kudosTotal,
    kudosPerPerson: n > 0 ? Math.round(kudosPerWeek / n * 100) / 100 : 0,
    ptoHealthScore: s.ptoScore !== null ? s.ptoScore : 0,
    ptoHealthGood: s.ptoGood, ptoHealthTotal: s.ptoTotal,
  };
}
```
Before finalizing, read `rawAxisLabel` (5575–5587) and `buildAxisSublabel` (5590–5602): if either renders `trackedCompliant + "/" + trackedEligible`, guard nulls there with a `x != null ? … : ''` so period mode shows just the percentage. Make that guard part of this step.

- [ ] **Step 6.2: Period dispatch in `renderRadarTab`**

Replace lines 5911–5952 (from `var weeks        = DATA.q4Weeks || DATA.weeks;` through the `refDataset` block's closing `}`) with:

```js
  var g          = STATE.periodGranularity;
  // q4Weeks now spans two quarters — bound WEEK mode to the current quarter window
  // (pre-widening behavior); period modes use the full two-quarter span via buckets.
  var weeks      = (DATA.q4Weeks || DATA.weeks).filter(function(w) { return weekInQ4Range_(w.year, w.isoWeek); });
  var selValue   = (document.getElementById("radarWeekSelect") || {}).value || null;
  var groupBy    = (document.getElementById("radarGroupBy")    || {}).value || "all";
  var isCrewMode = ((document.getElementById("fbMemberType")   || {}).value || "fte") === "crew";

  var bucket = null, prevBucket = null, buckets = null, refWeekLabel = selValue;
  if (g !== 'week') {
    buckets = periodBucketsFor_(g);
    var bIdx = buckets.findIndex(function(b) { return b.key === selValue; });
    if (bIdx === -1) { for (var i = buckets.length - 1; i >= 0; i--) { if (!buckets[i].containsCurrent) { bIdx = i; break; } } }
    if (bIdx === -1) bIdx = buckets.length - 1;
    bucket     = buckets[bIdx] || null;
    prevBucket = bIdx > 0 ? buckets[bIdx - 1] : null;
    refWeekLabel = bucket && bucket.weekLabels.length
      ? (bucket.weekLabels.filter(function(l) { return l !== DATA.meta.currentWeekLabel; }).pop() || bucket.weekLabels[bucket.weekLabels.length - 1])
      : null;   // period-end closed week — drives the kudos-callout highlight only
  }
  var metricsFor = function(empGroup) {
    return g === 'week' ? computeGroupMetrics(empGroup, weeks, refWeekLabel)
                        : computeGroupMetricsPeriod(empGroup, bucket);
  };

  // Build groups
  var groups;
  if (groupBy === "all") {
    var m = metricsFor(filtered);
    groups = m ? [{ name: "Whole Team", metrics: m }] : [];
  } else {
    var keyMap = {};
    filtered.forEach(function(e) {
      var key = groupBy === "location"   ? (e.keyLocation || "Unknown")
              : groupBy === "supervisor" ? (e.supervisor  || "Unknown")
              :                            (e.jobTitle    || "Unknown");
      if (!keyMap[key]) keyMap[key] = [];
      keyMap[key].push(e);
    });
    groups = Object.keys(keyMap).sort().map(function(k) {
      return { name: k, metrics: metricsFor(keyMap[k]) };
    }).filter(function(g2) { return g2.metrics && g2.metrics.headcount > 0; });
  }

  // Determine active axes for this grouping level + variance threshold.
  // Crew/contractor view drops Goals, PTO, and SI (no data for those metrics).
  var axisResult = getActiveAxes(groupBy, groups, isCrewMode);
  var activeAxes = axisResult.axes;

  // Prior-period reference polygon — Whole Team view only
  var refDataset = null;
  if (groupBy === "all" && groups.length === 1) {
    if (g === 'week') {
      var pastLabels = weeks.filter(function(w) { return !w.isFuture; }).map(function(w) { return w.label; });
      var ri = pastLabels.indexOf(refWeekLabel);
      if (ri > 0) {
        var priorM = computeGroupMetrics(filtered, weeks, pastLabels[ri - 1]);
        if (priorM) refDataset = {
          label: "Prior Week (" + pastLabels[ri - 1].replace(/\d{4}\./, "") + ")",
          data:  activeAxes.map(function(a) { return normalizeAxisValue(a.id, priorM); })
        };
      }
    } else if (prevBucket) {
      var priorPM = computeGroupMetricsPeriod(filtered, prevBucket);
      if (priorPM) refDataset = {
        label: "Prior " + (g === 'month' ? 'Month' : 'Quarter') + " (" + prevBucket.label + ")",
        data:  activeAxes.map(function(a) { return normalizeAxisValue(a.id, priorPM); })
      };
    }
  }
```

- [ ] **Step 6.3: Period-aware labels further down `renderRadarTab`**

Three spots after the replaced block:
1. **Insight title** (line ~5959): replace `buildRadarInsightTitle(groups, activeAxes, refWeekLabel)` with `buildRadarInsightTitle(groups, activeAxes, g === 'week' ? refWeekLabel : (bucket && bucket.label))`. (`buildRadarInsightTitle` line 5812 only strips a `YYYY.` prefix from the string — "Jun 2026"/"FY26Q4" pass through unchanged.)
2. **Kudos callout** (line ~5962): keep `renderKudosCallout(filtered, weeks, refWeekLabel)` — in period mode `refWeekLabel` is the period-end closed week, which the weekly sparkline highlights correctly.
3. **Subtitle** (lines ~5985–5987): replace `(refWeekLabel || "—")` with `(g === 'week' ? (refWeekLabel || "—") : (bucket ? periodDisplayLabel_(bucket) + ' · ' + bucket.weekRangeLabel : "—"))`.

- [ ] **Step 6.4: Verify + commit**

`node tests/period-buckets.test.js` still passes. Manual QA deferred to Task 10.
```bash
git add "PS Dashboard.html"
git commit -m "feat(psdash): Team Radar period mode — bucket metrics, prior-period polygon, week-mode quarter bound"
```

---

### Task 7: Trends — Time Momentum, Correlation, Goals Standing chart

All three consume `DATA.trackedHistory` and gate on `weekInQ4Range_`. Pattern: in period mode substitute `periodTrackedHistory_(g)` and skip the Q4 week-gate (buckets legitimately span two quarters). Where a renderer loops per-employee `e.weeks[h.label]`, aggregate across `h.weekLabels` instead via the helper below.

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — `renderTimeMomentum` (7811–8010), `renderCorrelationCharts` (3869–4144), `renderGoalsStanding` (7031–7341); shared helper next to the Task 4 adapters

- [ ] **Step 7.1: Shared helper**

Add next to the Task 4 adapters:
```js
// A weekly entry's own label, or a period entry's member weeks — lets per-employee
// loops (e.weeks[lbl]) work for both weekly and bucketed history entries.
function pdWeekLabels_(h) { return h && h.weekLabels ? h.weekLabels : [h && h.label]; }
```

- [ ] **Step 7.2: renderTimeMomentum period branch**

Read lines 7811–8010 in full first. Then:
1. After `var meta = DATA.meta || {};` (7817) insert `var g = STATE.periodGranularity;`.
2. The Q4 gate at ~7824 (`if (!weekInQ4Range_(curYear, curW)) { card.style.display="none"; return; }`) becomes `if (g === 'week' && !weekInQ4Range_(curYear, curW)) { … }`.
3. The `fullHist` construction (~7826–7829, `(DATA.trackedHistory || []).filter(…weekInQ4Range_…)`) becomes:
```js
  var fullHist = g === 'week'
    ? (DATA.trackedHistory || []).filter(function(h) {
        var p = pWeekParts(h.label);
        return p && weekInQ4Range_(p.year, p.week);
      })
    : periodTrackedHistory_(g);
```
(Preserve the existing filter body if it differs from this sketch — the change is only *wrapping it in the week-mode branch*.)
4. In the per-employee series builders (~7838–7860): wherever the code does `var wd = e.weeks[h.label]`, replace with a sum across the entry's weeks:
```js
  var _hrs = 0, _has = false;
  pdWeekLabels_(h).forEach(function(lbl) {
    var wd = e.weeks && e.weeks[lbl];
    if (wd && wd.plannedHrs != null) { _hrs += +wd.plannedHrs; _has = true; }   // or trackedHrs in the tracked builder
  });
```
and keep the downstream math identical (`_has ? _hrs : null` where the old code used `wd.plannedHrs`). In week mode `pdWeekLabels_(h)` is `[h.label]`, so behavior is unchanged.
5. Closed-week trend calc (~7866, `!h.isCurrentWeek && !h.isFuture`) works as-is — period entries set `isCurrentWeek` for the in-progress bucket.
6. Verdict (~7886–7893): no change — it derives from the series above.

- [ ] **Step 7.3: renderCorrelationCharts period branch**

Read lines 3869–4144 first. Then:
1. `var g = STATE.periodGranularity;` after line 3870 (`var fullHist = DATA && DATA.trackedHistory;`).
2. Current-week Q4 gate at ~3885: wrap in `g === 'week' &&`.
3. History filter at ~3887–3890: week mode keeps the existing `weekInQ4Range_` filter; period mode `var hist = periodTrackedHistory_(g);`.
4. `computeDocPct_` / `computeDocHC_` / `computeActivityPct_` (~4083–4110) take a week label: change their call sites to average across the entry's weeks:
```js
  function _avgOver(h, fn) {
    var vals = pdWeekLabels_(h).map(fn).filter(function(v) { return v !== null && !isNaN(v); });
    return vals.length ? Math.round(vals.reduce(function(a, c) { return a + c; }, 0) / vals.length) : null;
  }
  // call sites: _avgOver(h, function(lbl) { return computeDocPct_(lbl); }) etc.
```
5. Filter-narrowing block at ~4060–4066 compares against `e.weeks` keys per label — in period mode compare against `h.weekLabels.some(...)`.
6. Labels (3898/4065) already map `h.label` — period labels render as "Jun 2026".

- [ ] **Step 7.4: renderGoalsStanding — chart only**

The Goals Standing card has two halves: the standing list/ref-week logic (period-agnostic — it always shows "as of the latest closed week"; leave it untouched) and the comment-pace bar chart. Read lines 7031–7341 first, then modify only the chart series:
1. `var g = STATE.periodGranularity;` near the top (~7038).
2. Q4 gate at ~7050: wrap in `g === 'week' &&`.
3. The `q4Hist` build at ~7083–7086: week mode unchanged; period mode `q4Hist = periodTrackedHistory_(g);` (fields `avgCommentsPerPerson`, `totalComments`, `commentedPct` exist on period entries — Task 4). The `slice(-9)` fallback at ~7240 stays week-mode-only: wrap it in `if (g === 'week' && …)`.
4. Chart labels/values (7242–7244) work unchanged.
5. The verdict (~7186–7206) computes pace direction from the two most recent closed entries of the same series — works for buckets as-is.

- [ ] **Step 7.5: Verify + commit**

`node tests/period-buckets.test.js` passes.
```bash
git add "PS Dashboard.html"
git commit -m "feat(psdash): Trends period re-bucketing — Time Momentum, Correlation, Goals pace chart"
```

---

### Task 8: Trends — PTO trend, RCR quarter grouping, project heatmap

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — `renderPTOTrend` (7579–7809), `renderTrendsTab` RCR card block (8023–8175), `pkhBuildModel` (8372–8412) + `pkhRenderGrid` header bit (~8448)

- [ ] **Step 8.1: renderPTOTrend — period mode + week-mode bound**

Read 7579–7809 first. Two changes:
1. **Week-mode regression guard**: `DATA.ptoQ4History` now spans two quarters. Where `q4Hist` is read (line 7583), bound week mode to the current quarter:
```js
  var g = STATE.periodGranularity;
  var q4Hist = g === 'week'
    ? (DATA.ptoQ4History || []).filter(function(h) {
        var p = pWeekParts(h.label);
        return p && weekInQ4Range_(p.year, p.week);
      })
    : periodPtoHistory_(g);
```
2. Downstream code uses `d.label/.good/.atRisk/.total/.pct/.isCurrent/.byEmp` — all present on period entries (Task 4). The at-risk list ref-week logic (~7742–7752) stays weekly (it names people "as of now") — leave untouched.

- [ ] **Step 8.2: RCR card — quarter grouping**

In `renderTrendsTab` (8023–8175): after `rcrHist` is resolved (lines 8032–8043), insert:
```js
  // Quarter mode: group monthly RCR into fiscal quarters (mean of monthly team
  // values — approx; true RCR is SUM(RC)/SUM(TCC)). Month mode = native monthly.
  if (STATE.periodGranularity === 'quarter' && rcrHist.length) {
    var qMap = {}, qOrder = [];
    rcrHist.forEach(function(r) {
      var m = /^(\w{3}) (\d{2})$/.exec(r.month || '');
      if (!m) return;
      var mi = P_MONTH_ABBREV.indexOf(m[1]) + 1, yy = 2000 + +m[2];
      var fyStartYear = (mi >= 7) ? yy : yy - 1;
      var q = (mi >= 7 && mi <= 9) ? 1 : (mi >= 10) ? 2 : (mi <= 3) ? 3 : 4;
      var k = 'FY' + String(fyStartYear + 1).slice(-2) + 'Q' + q;
      if (!qMap[k]) { qMap[k] = []; qOrder.push(k); }
      qMap[k].push(r.rcr);
    });
    rcrHist = qOrder.map(function(k) {
      var v = qMap[k];
      return { month: k, rcr: Math.round(v.reduce(function(a, c) { return a + c; }, 0) / v.length * 100) / 100, exact: false };
    });
  }
```
The chart, colors, tooltip ("(approx)" via `exact: false`), and benchmark line all consume `rcrHist` generically — no other edits. The `"Dec 25"` holiday annotation (line 8115) simply won't match a quarter label; fine.

- [ ] **Step 8.3: Project heatmap — period columns**

In `pkhBuildModel` (8372–8412): replace the week-column source (line 8373, `var weeks = (DATA && DATA.weeks) || [];`) with:
```js
  var g = STATE.periodGranularity;
  var weeks;
  if (g === 'week') {
    weeks = (DATA && DATA.weeks) || [];
  } else {
    // Period columns: buckets over the two-quarter span; per-project hours summed
    // across each bucket's member weeks. Future rolling weeks are out of scope here.
    weeks = periodBucketsFor_(g).map(function(b) {
      return { label: b.key, displayLabel: periodDisplayLabel_(b), weekLabels: b.weekLabels,
               isCurrentWeek: b.containsCurrent, isFuture: false };
    });
  }
```
Then in the per-employee loop (~8377, `e.weeks[w.label].projects`), iterate `w.weekLabels || [w.label]` and accumulate `hrs` per project key across those labels (keep the existing headcount-set logic keyed by the column, not the week). In `pkhRenderGrid` (~8448) the header label `String(w.label).split('.')[1] || w.label` — change to `w.displayLabel || (String(w.label).split('.')[1] || w.label)` so period columns show "Jun 2026" while weekly columns keep "W27".

- [ ] **Step 8.4: Verify + commit**

`node tests/period-buckets.test.js` passes.
```bash
git add "PS Dashboard.html"
git commit -m "feat(psdash): Trends period re-bucketing — PTO standing, RCR fiscal quarters, project heatmap columns"
```

---

### Task 9: Data Reference copy

**Files:**
- Modify: `D:\Contribution\PS Dashboard.html` — Radar axis-definitions intro (line ~1625), Week Range section (~1678–1681)

- [ ] **Step 9.1: Radar axis definitions**

Extend the `dr-p` paragraph at line 1625: after the existing sentence about the "Evaluate Week" selector, append:
```
In Month or Quarter mode (the Week | Month | Quarter toggle), single-week axes evaluate at the period's last closed week for standings (Goals, PTO Health) while flow axes (Tracked, Planned, Kudos) average across the period's closed weeks; the reference polygon compares against the prior month or quarter.
```

- [ ] **Step 9.2: Week Range section**

In the Week Range `dr-section` (~1678–1681), append a sentence:
```
Months and fiscal quarters group weeks by the ISO 8601 majority rule — a week belongs to the month (or quarter) containing its Thursday, so no week is ever split. Fiscal quarters follow the FY calendar (FY starts July 1). Quarterly RCR is the mean of monthly values and is marked approximate.
```

- [ ] **Step 9.3: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "docs(psdash): Data Reference — period-mode semantics (Thursday rule, standings vs flow, approx RCR)"
```

---

### Task 10: QA + deployment notes

**Files:**
- No code. Manual verification checklist; record results in the final report.

- [ ] **Step 10.1: Automated checks**

1. `node tests/period-buckets.test.js` → all PASS.
2. `node -e "new (require('vm').Script)(require('fs').readFileSync('PS Contribution Report.js','utf8'))"` → silent.
3. `git log --oneline` shows one commit per task.

- [ ] **Step 10.2: GAS-side verification (requires the user or GAS editor access)**

1. Push both files to the GAS project; run `_test_computeFiscalContext()` — PASS lines only.
2. Run `getPSReportData()` once from the editor; in the log confirm: prior-quarter goals read (`Goals cols —` appears twice), `trackedHistory` length ≈ 32, no `⚠️`/`❌`.
3. Bump `PS_CACHE_VER` in Script Properties (or run any settings-save that calls `bustReportCache_()`) so all users get the widened payload immediately.

- [ ] **Step 10.3: Browser QA matrix (in the deployed dashboard)**

For each of {Exec Brief, Team Radar, Trends} × {Week, Month, Quarter}:
- Week mode is pixel-identical to pre-change behavior (pickers quarter-bounded; radar averages unchanged; PTO trend quarter-bounded).
- Month mode: labels read "Jun 2026 · 2026.W23–W26"-style; current month marked "(in progress)"; Brief coverage line appears for partial periods; prior-month comparisons phrased "up/down from … in May 2026".
- Quarter mode: RCR card shows FY quarters flagged approx; Brief compares vs prior quarter; Radar polygon label "Prior Quarter (FY26Q3)".
- Repeat one spot-check of each tab with: a team filter active, FTE/Crew toggled, and (if a delegate account is available) a manager-scoped login — numbers must reflect the filtered population.
- Exec Brief: Copy for Confluence and one Gemini "Enhance" run in Month mode — output references the period label, not a week.
- Confirm cross-tab persistence: pick "Jun 2026" on the Brief, switch to Radar — still evaluating Jun 2026.

- [ ] **Step 10.4: Final commit (if QA produced fixes) and report**

Summarize: what shipped, payload-size observation from the GAS log, any cache-skip (`payload >100 KB`) occurrences, and leftover follow-ups.

---

## Self-review notes (already applied)

- **Spec coverage:** §1 → Tasks 2–3; §2 → Task 1; §3 → Tasks 2, 4; §4 Brief → Task 5, Radar → Task 6, Trends → Tasks 7–8; §5 edge handling → isPartial/coverage/no-prior-data in Tasks 2, 4, 5; §6 testing → Tasks 2, 10; Data Reference copy → Task 9.
- **Week-mode regression guards** (needed because Task 1 widens `q4Weeks`/`ptoQ4History`/`goalsQ4Hist`/`employees[].weeks`): pickers (Task 3.5), Radar week universe (Task 6.2), PTO trend (Task 8.1). The rocketeer-drawer "full charts" (line ~4903) and Brief `ensureSynthWeeks` intentionally gain the wider span — richer per-person history is desired, not a regression.
- **Type consistency:** `periodTrackedHistory_` entries carry every field the three trackedHistory-consuming renderers read (`label, isCurrentWeek, isFuture, totalHrs, headcount, avgHrs, trackedPct, plannedHrs, plannedHC, avgPlannedHrs, plannedPct, kudosCount, totalComments, avgCommentsPerPerson, commentedPct, commentedHC, g03CommentedPct, g01CommentedPct`) plus `weekLabels/closedWeekLabels/isPartial/periodKey/weekRangeLabel`. `computeGroupMetricsPeriod` returns all 19 `computeGroupMetrics` properties (two compliance count pairs deliberately null — guarded in Step 6.1).
