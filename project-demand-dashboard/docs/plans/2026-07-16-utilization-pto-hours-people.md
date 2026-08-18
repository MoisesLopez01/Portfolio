# Utilization V3 — PTO Capacity, Hours View, People Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the V3 section of `project-demand-dashboard/docs/specs/2026-07-16-utilization-decision-chart-design.md`: PTO-adjusted capacity through all utilization math, an Hours|Rate chart toggle (Hours default: capacity + tracked areas with per-week % labels), and an expandable per-person table with PTO-safeguarded low-tracking flags.

**Architecture:** Client-only edits to `project-demand-dashboard/Dashboard.html` (+ `node-tests.js`). New pure functions in UTIL-PURE (node-tested); render work in the Utilization section. `DATA.personWeekPTO` and `PTO_FULL_THRESHOLD` already exist client-side.

**Global constraints (every task):** ES5 only. UTIL-PURE stays pure. Gates before every commit: `cd project-demand-dashboard && node node-tests.js` ends `✅ node-tests: all suites passed`, AND script-parse `node -e "var fs=require('fs');var s=fs.readFileSync('project-demand-dashboard/Dashboard.html','utf8');var m=s.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('script parses OK')"`. Commit ONLY the plan's files. **Concurrent-session rule:** the working tree of Dashboard.html may carry unrelated uncommitted hunks from another live session — before editing run `git diff HEAD -- project-demand-dashboard/Dashboard.html > /tmp/foreign.patch`; edit normally; to commit: `git apply -R /tmp/foreign.patch` (strips foreign hunks), `git add` the plan's files, commit, `git apply /tmp/foreign.patch` (restores). If either apply fails, STOP and report BLOCKED. If the diff is empty, commit normally.

---

### Task 1: Pure PTO math — `utilAdjustCap_` + `utilPersonWeek_` + CONFIG

**Files:** `Dashboard.html` (UTIL-PURE after `utilVerdict_`; CONFIG next to `UTIL_BAND_WEEKS`), `node-tests.js`.

- [ ] **Step 1: Failing tests** — after `_test_utilVerdict_` add + wire both:

```js
function _test_utilAdjustCap_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilAdjustCap_: " + msg); }
  var cap = { "a": { W1: 40, W2: 0 }, "b": { W1: 38 }, "c": {} };
  var pto = { "a": { W1: 8, W2: 4 }, "b": { W1: 45 } };   // b: PTO exceeds capacity
  var adj = utilAdjustCap_(cap, pto);
  assert_(adj.a.W1 === 32, "40 cap − 8 PTO = 32");
  assert_(adj.a.W2 === 0, "explicit 0 cap stays 0 (PTO can't go negative)");
  assert_(adj.b.W1 === 0, "PTO > cap clamps at 0");
  assert_(!("W3" in adj.a) && Object.keys(adj.c).length === 0, "no invented cells — blank stays blank");
  assert_(cap.a.W1 === 40, "input map not mutated");
  // PTO for a week with no capacity cell must NOT create one
  var adj2 = utilAdjustCap_({ "d": {} }, { "d": { W1: 8 } });
  assert_(Object.keys(adj2.d).length === 0, "PTO alone never creates a capacity cell");
  Logger.log("✅ _test_utilAdjustCap_ passed");
}

function _test_utilPersonWeek_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilPersonWeek_: " + msg); }
  // fullPto: pto >= 0.75*cap → exempt from low flag regardless of tracked
  var w = utilPersonWeek_(40, 32, 0, true, 0.75, 0.6);
  assert_(w.adj === 8 && w.fullPto === true && w.low === false, "full-PTO week never flagged low");
  // low: tracked < 0.6*adjusted
  var w2 = utilPersonWeek_(40, 8, 15, true, 0.75, 0.6);
  assert_(w2.adj === 32 && w2.fullPto === false && w2.low === true, "15 < 0.6×32 → low");
  assert_(Math.abs(w2.util - 15 / 32 * 100) < 1e-9, "util vs ADJUSTED capacity");
  var w3 = utilPersonWeek_(40, 0, 30, true, 0.75, 0.6);
  assert_(w3.low === false && Math.abs(w3.util - 75) < 1e-9, "30/40 ok, not low");
  // adjusted 0 → util null, never low
  var w4 = utilPersonWeek_(40, 40, 0, true, 0.75, 0.6);
  assert_(w4.adj === 0 && w4.util === null && w4.low === false, "zeroed capacity → util null, no flag");
  // no capacity cell → everything null/false
  var w5 = utilPersonWeek_(0, 0, 12, false, 0.75, 0.6);
  assert_(w5.adj === null && w5.util === null && w5.low === false && w5.fullPto === false, "no capacity data → null row");
  Logger.log("✅ _test_utilPersonWeek_ passed");
}
```

- [ ] **Step 2:** run → FAIL (`utilAdjustCap_ is not defined`).
- [ ] **Step 3: CONFIG** — next to `UTIL_BAND_WEEKS` add:

```js
var UTIL_LOW_RATIO  = 0.6; // person-week flagged ⚠ low when tracked < this share of PTO-adjusted capacity
```

- [ ] **Step 4: Implement** in UTIL-PURE after `utilVerdict_`:

```js
// PTO-adjusted capacity: every EXISTING capacity cell becomes max(0, cap − pto).
// Blank stays blank — PTO alone never creates a cell (the coverage rule keeps
// deciding who counts). Public holidays are already excluded upstream by the
// Tempo user-schedule, so this only subtracts personal time off. Pure; does not
// mutate its inputs.
function utilAdjustCap_(capMap, ptoMap){
  var out = {};
  Object.keys(capMap).forEach(function(np){
    out[np] = {};
    var cw = capMap[np], pw = ptoMap[np] || {};
    Object.keys(cw).forEach(function(iso){
      out[np][iso] = Math.max(0, (cw[iso] || 0) - (pw[iso] || 0));
    });
  });
  return out;
}

// One person-week under the PTO safeguard. cap/pto/tracked are hours; hasCap says
// whether a real capacity cell exists (blank ≠ 0). fullPto (pto ≥ fullPtoRatio×cap)
// exempts the week from the low flag entirely — nobody is penalised for approved
// time off. low = tracked < lowRatio × adjusted, only when adjusted > 0.
function utilPersonWeek_(cap, pto, tracked, hasCap, fullPtoRatio, lowRatio){
  if (!hasCap) return { adj: null, util: null, fullPto: false, low: false };
  var adj = Math.max(0, (cap || 0) - (pto || 0));
  var fullPto = (cap || 0) > 0 && (pto || 0) >= fullPtoRatio * cap;
  var util = adj > 0 ? tracked / adj * 100 : null;
  var low = !fullPto && adj > 0 && tracked < lowRatio * adj;
  return { adj: adj, util: util, fullPto: fullPto, low: low };
}
```

- [ ] **Step 5:** run → all suites pass. **Commit** both files: `feat(utilization): pure PTO-adjusted capacity + person-week safeguard math`

---

### Task 2: Wire adjusted capacity through everything + CSV columns

**Files:** `Dashboard.html` (renderUtilization + downloadUtilCsv_ + buildUtilCsvRows_ in UTIL-PURE), `node-tests.js` (`_test_utilizationCsv_`).

- [ ] **Step 1: renderUtilization** — right after `var capMap=DATA.personWeekCapacity||{}, trkMap=...`, insert:

```js
  // PTO-adjusted capacity feeds ALL utilization math (headline, band, projection,
  // identity, drill, chart) — a 40h week with 8h PTO is a 32h week. Raw capacity
  // is kept for the people table / CSV, which show the subtraction explicitly.
  var rawCapMap=capMap;
  capMap=utilAdjustCap_(capMap, DATA.personWeekPTO||{});
```

Everything downstream already reads the local `capMap` (verify: utilWeekTotals_, renderUtilHeader_→utilIdentity_, renderUtilChips_, renderUtilDrill_, UTIL_EXTRA/projection). Pass `rawCapMap` along wherever the people table (Task 4) will need it — store both on the panel state: `UTIL_CAPS={raw:rawCapMap, adj:capMap};` next to the `UTIL_WT=` assignment (declare `var UTIL_CAPS=null;` with the other state vars).
- [ ] **Step 2: hint copy** — in the panel markup's `.hint`, after "Tracked ÷ Tempo schedule capacity" insert " (PTO-adjusted)".
- [ ] **Step 3: CSV** — `buildUtilCsvRows_(isoList, capMap, ptoMap, trkMap, nameMap, npList, futureIsoSet, groupByNp)` (ptoMap param added after capMap):
  - header: `["User","Week","Capacity hrs","PTO hrs","Adjusted hrs","Tracked hrs","Utilization %","Group"]`
  - per row: `ptoCell = hasCap&&pto>0 ? round1_(pto) : ""`; `adjCell = hasCap ? round1_(Math.max(0,cw[iso]-pto)) : ""`; `utilCell` divides by the ADJUSTED value (`>0`), else blank. Keep existing blank/future semantics.
  - `downloadUtilCsv_` passes `DATA.personWeekPTO||{}` and RAW `DATA.personWeekCapacity||{}` (the CSV shows the subtraction; do not pass the adjusted map).
- [ ] **Step 4: tests** — update `_test_utilizationCsv_`: new call arity (ptoMap `{ "alice": { "2026.W14": 8 } }`), header assertion for the 8-column schema, alice W14 asserts `capCell 40, ptoCell 8, adjCell 32, trkCell 38.6, utilCell round1_(38.55/32*100)=120.5`, eve's tracked-no-capacity row has blank capacity/PTO/adjusted/util, future week: capacity+adjusted only. Column indexes shift — update every `r[n]` accordingly (Group now index 7).
- [ ] **Step 5:** gates → **commit** (concurrent-session rule): `feat(utilization): PTO-adjusted capacity through all math + CSV PTO columns`

---

### Task 3: Hours | Rate chart toggle

**Files:** `Dashboard.html` — markup `.util-tools`, state vars, renderUtilization call, new `renderUtilHoursChart_`, `renderUtilLegend_`.

- [ ] **Step 1: markup** — inside `.util-tools`, before the `#utilScope` group, add:

```html
          <div class="chip-toggle" id="utilChartMode">
            <button id="utilModeHours" onclick="utilSetMode_('hours')">Hours</button>
            <button id="utilModeRate" onclick="utilSetMode_('rate')">Rate</button>
          </div>
```

- [ ] **Step 2: state** — next to `UTIL_EXPLORE_OPEN`:

```js
var UTIL_CHART_MODE='hours';                     // 'hours' (capacity+tracked areas) | 'rate' (% band chart)
function utilSetMode_(m){ UTIL_CHART_MODE=m; renderUtilization(); }
```

- [ ] **Step 3: renderUtilization** — inside the explore guard, set the mode buttons' `.on` classes, then branch: `if(UTIL_CHART_MODE==='hours') renderUtilHoursChart_(ut, cw, provisionalIso, anchor); else renderUtilChart_(ut, cw, stats, proj, provisionalIso, anchor);` and pass the mode to `renderUtilLegend_(stats!=null, proj!=null, UTIL_CHART_MODE)`.
- [ ] **Step 4: `renderUtilHoursChart_(ut, cw, provisionalIso, anchor)`** — new function after `renderUtilChart_`, same frame conventions (620×190 viewBox, same pads, x() helper, hit-columns calling `utilChartHover_`/`capChartNav_`, anchor-emphasized week labels):
  - y-scale hours: `maxH = niceRound(max over cw of ut.cap/ut.tracked)`; gridlines 0/½/max labelled in hrs (reuse the PvT chart's conventions).
  - Adjusted-capacity area: path down to y(0), fill `hexVar('--slate')` opacity .12 + 2px line (solid; the live week's capacity is real schedule data — no dash needed).
  - Tracked area on top: fill `hexVar('--pos')` opacity .15 + 2.4px line, points on settled weeks; provisional point hollow amber; segment into the live week dashed + ghosted (logged-so-far), hollow gray point.
  - % labels at EVERY settled + provisional point: `Math.round(ut.util[iso])+'%'` (provisional suffixed `˜`, live week `*` on logged-so-far), font-size 8, fill `hexVar('--text')`, y = capacity line − 7 (they sit above the higher series).
  - aria-label: "capacity vs tracked hours per week with utilization rate labels".
- [ ] **Step 5: legend** — `renderUtilLegend_(hasBand, hasProj, mode)`: hours mode → Capacity (PTO-adjusted) / Tracked / Still settling / Live week; rate mode → existing entries.
- [ ] **Step 6:** gates → **commit** (concurrent-session rule): `feat(utilization): Hours|Rate chart toggle with capacity+tracked areas and per-week rates`

---

### Task 4: People detail table + manager note

**Files:** `Dashboard.html` — markup (one div), CSS, state, new `renderUtilPeople_`.

- [ ] **Step 1: markup** — after `<div class="util-drill" id="utilDrill"></div>` add `<div class="util-people" id="utilPeople"></div>`.
- [ ] **Step 2: CSS** — after the `.util-drill` rules:

```css
.util-people{margin-top:8px;border-top:1px dashed var(--border);padding-top:6px;font-size:calc(12px*var(--scale))}
.util-people .up-toggle{cursor:pointer;font-weight:700}
.util-people .up-note{font-size:calc(11px*var(--scale));color:var(--muted);margin:4px 0 6px}
.util-people table{border-collapse:collapse;width:100%;font-size:calc(11px*var(--scale))}
.util-people th{text-align:right;color:var(--muted);font-weight:400;padding:3px 8px;border-bottom:1px solid var(--border)}
.util-people th:first-child,.util-people td:first-child{text-align:left}
.util-people td{text-align:right;padding:3px 8px;border-bottom:1px solid var(--border)}
.util-people tr.up-row{cursor:pointer}
.util-people tr.up-hist td{background:var(--surface-2);font-size:calc(10.5px*var(--scale))}
.util-people .up-flag{font-weight:700;color:var(--warn)}
.util-people .up-pto{color:var(--amber)}
```

- [ ] **Step 3: state** — `var UTIL_PEOPLE_OPEN=false, UTIL_PERSON_OPEN=null;` next to `UTIL_DRILL_OPEN` (person np whose history is expanded; clicking another row switches, clicking same closes).
- [ ] **Step 4: `renderUtilPeople_(anchor, split, npList, trkMap)`** — new function after `renderUtilDrill_`, called from renderUtilization's explore guard (after the drill call) with the ACTIVE npList; reads `UTIL_CAPS.raw`, `DATA.personWeekPTO`, `UTIL_LOW_RATIO`, `PTO_FULL_THRESHOLD`:
  - Collapsed: `▸ People detail — <anchor> (<n> people, <k> flagged)`. Open: the manager note div (exact copy from the spec: "Capacity is holiday- and PTO-adjusted — a 40 h week with 8 h of PTO counts as 32 h. People mostly on PTO in a week are never flagged.") then the table.
  - Per person: name = `(DATA.displayNames||{})[np] || (DATA.capacityNames||{})[np] || np`; group from split membership (Delivery/Manager/Non-tracking); cap/pto/tracked for anchor week; `utilPersonWeek_(cap, pto, trk, hasCap, PTO_FULL_THRESHOLD, UTIL_LOW_RATIO)`. Cells: Capacity, PTO (blank if 0), Adjusted, Tracked, Util % (or —), Flags (`⚠ low` warn / `🏖 PTO` amber / `no capacity data` muted).
  - Sort: low-flagged first, then util ascending (nulls last), then name. Escape names with `esc()`.
  - Row click (`data-np`, delegated or inline onclick with escaped np) toggles `UTIL_PERSON_OPEN` → re-render; when open, insert history rows (`up-hist`) under the person: one per capacity week ≤ CURRENT_ISO (from `DATA.capacityIsoList`), same columns + same flags per week; live week annotated `(in progress)`.
  - Headline count `<k> flagged` = low-flag count for the anchor week.
- [ ] **Step 5:** gates → **commit** (concurrent-session rule): `feat(utilization): expandable people detail with PTO-safeguarded flags`

---

### Task 5: Verification + final review (controller)

- [ ] Gates green at HEAD; committed-blob parse check.
- [ ] Whole-branch V3 review (most capable model) against the spec's V3 section; fix loop to READY.
- [ ] Ledger + memory + deployment note (Dashboard.html only, no cache bump).
