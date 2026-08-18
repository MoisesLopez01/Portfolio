# Demand Dashboard Utilization Panel + Capacity CSV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Utilization panel (Tracked ÷ Tempo-schedule-capacity per week) and a person×week capacity CSV export to the project demand dashboard, fed by the "Capacity Tempo" sheet.

**Architecture:** Server (`Code.js`) reads + parses the Capacity Tempo tab into `personWeekCapacity` (normalized-name keyed, Services-scoped) inside the cached demand compute. Client (`Dashboard.html`) gets a new panel mirroring the Planned vs Tracked chart; its math and CSV builders are pure functions inside a marker-delimited script block that `node-tests.js` extracts and unit-tests. The existing Demand-vs-Capacity headline heuristic is untouched.

**Tech Stack:** Google Apps Script (ES5-style, `var` + `function`), hand-rolled SVG charts, Node test harness (`node node-tests.js` evals Code.js + extracts the Dashboard pure block).

**Spec:** `project-demand-dashboard/docs/specs/2026-07-15-demand-utilization-panel-design.md` — read it first.

---

## Global constraints (bind every task)

- **Blank ≠ 0**: a missing capacity cell means "unknown" and must never become 0 anywhere (sums, %, CSV). An explicit numeric 0 means "scheduled zero hours" and IS counted.
- **Coverage rule**: a week's utilization % divides ONLY over people with a numeric capacity cell that week — their capacity AND their tracked. Tracked-but-capacity-blank people are excluded from both sums and surfaced as a coverage count.
- **Services scope**: capacity is filtered server-side to roster profiles with `department === CONFIG.ROSTER_DEPT`, exactly like `scopeRecsToServices_`.
- **No individual names in chart-area text** (verdict/summary/tooltip lines show counts only). Names appear only in the CSV.
- **The existing headline capacity heuristic (`attachCapacity_`, `capByWeek`, etc.) is not modified.**
- **ES5 style** in both files (`var`, `function`, no arrow functions/template literals/const in Code.js or Dashboard.html — matches the existing code and GAS's older-syntax client pages).
- Billing chips (`BILLING_FILTER`) do NOT affect the Utilization panel.
- Code.js and Dashboard.html carry many unrelated uncommitted changes from other sessions — **stage only your own hunks is impossible with whole-file adds, so verify `git status`/`git diff` first**: if either file shows pre-existing uncommitted modifications, commit ONLY the plan's files via `git add <file>` after confirming with `git diff --stat` that the file's other changes are yours alone; if foreign changes are present, STOP and report DONE_WITH_CONCERNS naming the overlap (see feedback memory: concurrent executor sessions exist in this repo).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `project-demand-dashboard/Code.js` | Modify | `CONFIG.CAPACITY_SHEET_NAME`, `parseCapacityGrid_` (pure), `scopeCapacityToServices_` (pure), `readTempoCapacity_` (I/O), model wiring in `buildDemandModel_`, `_test_capacityParse_`, `_test_capacityScope_` |
| `project-demand-dashboard/Dashboard.html` | Modify | `#utilPanel` markup, UTIL-PURE script block (`utilWeekTotals_`, `buildUtilCsvRows_`, `csvEscape_`, `utilCsvString_`, `round1_`), `renderUtilization()`, `utilChartHover_`, `downloadUtilCsv_`, wiring into `renderAll`/`reRenderAll_` |
| `project-demand-dashboard/node-tests.js` | Modify | Register the two Code.js suites; extract + eval the UTIL-PURE block; `_test_utilizationMath_`, `_test_utilizationCsv_` |

All commands run from `project-demand-dashboard/` unless stated otherwise. The Node gate for every task is:

```bash
cd project-demand-dashboard && node node-tests.js
```

---

### Task 1: `parseCapacityGrid_` — Capacity Tempo sheet values → grid model

**Files:**
- Modify: `project-demand-dashboard/Code.js` (new SECTION after `_test_holidayCapacity_`, and the pure function near the other readers)
- Modify: `project-demand-dashboard/node-tests.js` (register suite)

- [ ] **Step 1: Write the failing test**

In `Code.js`, add after the existing `_test_holidayCapacity_()` function:

```js
/**
 * parseCapacityGrid_: Capacity Tempo 2-D values → { byName, names, isoList }.
 * Pure — runs in GAS editor and Node.
 */
function _test_capacityParse_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_capacityParse_: " + msg); }

  var vals = [
    ["", "",           "2026.W15", "2026.W14", "junk", ""],
    ["Account ID", "User", "Apr 06 - Apr 12 2026", "Mar 30 - Apr 05 2026", "x", "Total (hrs)"],
    ["712020:aaa", "Alice Doe", 40, 38.5, "n/a", 78.5],
    ["712020:bbb", "Bob  Ray",  0,  "",   5,    0],
    ["",           "TOTAL",     40, 38.5, "",   78.5]
  ];
  var g = parseCapacityGrid_(vals);

  assert_(JSON.stringify(g.isoList) === JSON.stringify(["2026.W14", "2026.W15"]),
          "isoList = valid ISO labels only, sorted (got " + JSON.stringify(g.isoList) + ")");
  assert_(g.byName["alice doe"] && g.byName["alice doe"]["2026.W15"] === 40, "Alice W15 = 40");
  assert_(g.byName["alice doe"]["2026.W14"] === 38.5, "Alice W14 = 38.5");
  assert_(g.byName["bob ray"]["2026.W15"] === 0, "explicit 0 kept (scheduled zero)");
  assert_(!("2026.W14" in g.byName["bob ray"]), "blank cell stays absent (unknown != 0)");
  assert_(g.names["bob ray"] === "Bob  Ray", "display name preserved raw, key normalized");
  assert_(!g.byName["total"], "TOTAL footer skipped (blank Account ID)");

  // junk column (non-ISO header) never becomes a week
  assert_(!("junk" in (g.byName["bob ray"] || {})), "non-ISO column ignored");

  // Unrecognized header → empty model
  var bad = parseCapacityGrid_([["", "", "2026.W14"], ["Wrong", "User", "x"], ["id", "A", 1]]);
  assert_(bad.isoList.length === 0, "wrong header row -> empty");
  // Too small → empty model
  assert_(parseCapacityGrid_([["", ""], ["Account ID", "User"]]).isoList.length === 0, "no data rows -> empty");

  Logger.log("✅ _test_capacityParse_ passed");
}
```

In `node-tests.js`, add after the `_test_holidayCapacity_();` line:

```js
_test_capacityParse_();
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd project-demand-dashboard && node node-tests.js`
Expected: FAIL with `parseCapacityGrid_ is not defined`.

- [ ] **Step 3: Implement `parseCapacityGrid_`**

In `Code.js`, add a new section right BEFORE the `buildPersonAvailability_` function (near the other person-keyed builders):

```js
// ── TEMPO SCHEDULE CAPACITY (Capacity Tempo tab → Utilization panel) ──

/**
 * Parses the Capacity Tempo sheet (built by TempoCapacityTime.js in the Tempo
 * export project) into a person-week capacity grid.
 *
 * Sheet layout: row 1 = ISO labels ("2026.W14") over week columns; row 2 =
 * "Account ID" | "User" | date-range labels | "Total (hrs)"; data rows 3+;
 * footer row has a blank Account ID and User = "TOTAL".
 *
 * Rules: numeric cells only (blank = unknown, NEVER coerced to 0; explicit 0 =
 * scheduled zero hours and IS kept); people keyed by the same normalization as
 * planned/tracked names; the Total column and non-ISO columns are ignored.
 * Pure — runs in GAS editor and Node.
 *
 * @param {Array[]} values - sheet.getDataRange().getValues()
 * @returns {{ byName: Object, names: Object, isoList: string[] }}
 *          byName: normName → { iso → hrs }; names: normName → raw display name
 */
function parseCapacityGrid_(values) {
  var norm = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var empty = { byName: {}, names: {}, isoList: [] };
  if (!values || values.length < 3) return empty;

  var isoRow = values[0], hdrRow = values[1];
  if (String(hdrRow[0]).trim() !== 'Account ID' || String(hdrRow[1]).trim() !== 'User') return empty;

  var isoList = [], colByIso = {};
  for (var c = 2; c < hdrRow.length - 1; c++) {   // last column is "Total (hrs)"
    var iso = String(isoRow[c] || '').trim();
    if (/^\d{4}\.W\d{2}$/.test(iso)) { isoList.push(iso); colByIso[iso] = c; }
  }
  isoList.sort();   // zero-padded YYYY.WNN sorts chronologically

  var byName = {}, names = {};
  for (var r = 2; r < values.length; r++) {
    var acct = String(values[r][0] || '').trim();
    if (!acct) continue;                           // TOTAL footer / stray rows
    var disp = String(values[r][1] || '').trim();
    if (!disp) continue;
    var np = norm(disp);
    var weeks = byName[np] || {};
    for (var i = 0; i < isoList.length; i++) {
      var v = values[r][colByIso[isoList[i]]];
      if (typeof v === 'number') weeks[isoList[i]] = v;
    }
    byName[np] = weeks;
    if (!names[np]) names[np] = disp;
  }
  return { byName: byName, names: names, isoList: isoList };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node node-tests.js` — expect all suites incl. `✅ _test_capacityParse_ passed` and the final `✅ node-tests: all suites passed`.

- [ ] **Step 5: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(utilization): parse Capacity Tempo grid into person-week capacity (pure + tested)"
```

(Repo root prefix the paths if committing from `D:\Contribution`: `project-demand-dashboard/Code.js` etc. Append the standard trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` to every commit in this plan.)

---

### Task 2: Services scoping + sheet read + model wiring

**Files:**
- Modify: `project-demand-dashboard/Code.js` (CONFIG key; two functions after `parseCapacityGrid_`; wiring in `buildDemandModel_`; test after `_test_capacityParse_`)
- Modify: `project-demand-dashboard/node-tests.js` (register suite)

- [ ] **Step 1: Write the failing test**

In `Code.js`, after `_test_capacityParse_`:

```js
/** scopeCapacityToServices_: Services-department filter, same predicate as scopeRecsToServices_. */
function _test_capacityScope_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_capacityScope_: " + msg); }
  var grid = {
    byName: { "alice doe": { "2026.W14": 40 }, "sam sales": { "2026.W14": 40 }, "gus ghost": { "2026.W14": 40 } },
    names:  { "alice doe": "Alice Doe", "sam sales": "Sam Sales", "gus ghost": "Gus Ghost" },
    isoList: ["2026.W14"]
  };
  var profiles = {
    "alice doe": { department: "Services" },
    "sam sales": { department: "Sales" }
    // gus ghost: not in roster at all
  };
  var out = scopeCapacityToServices_(grid, profiles);
  assert_(out.byName["alice doe"] && out.byName["alice doe"]["2026.W14"] === 40, "Services person kept");
  assert_(!out.byName["sam sales"], "non-Services dropped");
  assert_(!out.byName["gus ghost"], "no roster profile dropped");
  assert_(out.names["alice doe"] === "Alice Doe" && !out.names["sam sales"], "names map scoped too");
  Logger.log("✅ _test_capacityScope_ passed");
}
```

In `node-tests.js`, after `_test_capacityParse_();` add:

```js
_test_capacityScope_();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node node-tests.js` — FAIL with `scopeCapacityToServices_ is not defined`.

- [ ] **Step 3: Implement scoping + reader + CONFIG + wiring**

(a) In `CONFIG` (Code.js top), directly under the `TRACKED_SHEET_NAME` line, add:

```js
  CAPACITY_SHEET_NAME:  "Capacity Tempo",   // Tempo work-schedule capacity (Utilization panel)
```

(b) After `parseCapacityGrid_`, add:

```js
/**
 * Keeps only people whose roster profile department is CONFIG.ROSTER_DEPT —
 * the same predicate scopeRecsToServices_ applies to planned/tracked records,
 * so the Utilization panel's population matches every other dashboard figure.
 * Pure — runs in GAS editor and Node.
 * @param {{byName:Object, names:Object}} grid - from parseCapacityGrid_
 * @param {Object} profiles - roster profiles keyed by normalized name
 * @returns {{ byName: Object, names: Object }}
 */
function scopeCapacityToServices_(grid, profiles) {
  var out = { byName: {}, names: {} };
  Object.keys((grid && grid.byName) || {}).forEach(function (np) {
    var prof = (profiles || {})[np];
    if (prof && prof.department === CONFIG.ROSTER_DEPT) {
      out.byName[np] = grid.byName[np];
      out.names[np] = (grid.names || {})[np] || np;
    }
  });
  return out;
}

/**
 * Reads the Capacity Tempo tab from the source spreadsheet. Any failure —
 * missing tab, unrecognized layout, read error — returns { grid: null, error }
 * so the dashboard renders normally with the Utilization panel in its
 * degraded "no capacity data" state. Never throws.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - SOURCE_SS handle
 * @returns {{ grid: ?Object, error: ?string }}
 */
function readTempoCapacity_(ss) {
  try {
    var sh = ss.getSheetByName(CONFIG.CAPACITY_SHEET_NAME);
    if (!sh) return { grid: null, error: "Sheet '" + CONFIG.CAPACITY_SHEET_NAME + "' not found." };
    var grid = parseCapacityGrid_(sh.getDataRange().getValues());
    if (!grid.isoList.length) {
      return { grid: null, error: "Sheet '" + CONFIG.CAPACITY_SHEET_NAME + "' has an unrecognized layout." };
    }
    return { grid: grid, error: null };
  } catch (e) {
    return { grid: null, error: "Capacity read failed: " + e.message };
  }
}
```

(c) In `buildDemandModel_`, directly AFTER the `model.behaviorSignals = buildPersonBehaviorSignals_( … );` call (the multi-line call ending `weeks\n    );`) and BEFORE `model.anzLocation = …`, insert:

```js
    // ── Tempo schedule capacity (Capacity Tempo tab) — feeds the Utilization
    // panel only; the Demand-vs-Capacity headline heuristic above is untouched. ──
    var capResult = readTempoCapacity_(ss);
    if (capResult.grid) {
      var scopedCap = scopeCapacityToServices_(capResult.grid, roster.profiles);
      model.personWeekCapacity = scopedCap.byName;
      model.capacityNames      = scopedCap.names;
      model.capacityIsoList    = capResult.grid.isoList;
      model.capacityError      = null;
    } else {
      model.personWeekCapacity = {};
      model.capacityNames      = {};
      model.capacityIsoList    = [];
      model.capacityError      = capResult.error;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node node-tests.js` — all suites green (`_test_capacityScope_` included; the eval also syntax-checks the wiring).

- [ ] **Step 5: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(utilization): read Capacity Tempo into the demand model, Services-scoped"
```

---

### Task 3: Client pure block — utilization math + CSV builders (tested via extraction)

**Files:**
- Modify: `project-demand-dashboard/Dashboard.html` (new marker-delimited script block, placed immediately after the `filteredWeekTotals_` function)
- Modify: `project-demand-dashboard/node-tests.js` (extraction + two suites)

- [ ] **Step 1: Write the failing tests + extraction harness**

In `node-tests.js`, add BEFORE the final `console.log("✅ node-tests: all suites passed");` line:

```js
// ── Utilization pure block (extracted from Dashboard.html) ───────────────
// The client-side utilization math/CSV builders live in Dashboard.html inside
// UTIL-PURE markers so this harness can eval exactly that block (no DOM).
var dashSrc = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
var utilBlock = dashSrc.match(/\/\* ==UTIL-PURE-START== \*\/([\s\S]*?)\/\* ==UTIL-PURE-END== \*\//);
if (!utilBlock) throw new Error("❌ UTIL-PURE block not found in Dashboard.html");
eval(utilBlock[1]);

function _test_utilizationMath_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilizationMath_: " + msg); }
  var cap = {
    "alice": { "2026.W14": 40, "2026.W15": 40 },
    "bob":   { "2026.W14": 0 },                 // scheduled zero (e.g. on leave)
    "cara":  {}                                  // no capacity data at all
  };
  var trk = {
    "alice": { "2026.W14": 38, "2026.W15": 44 },
    "bob":   { "2026.W14": 5 },
    "cara":  { "2026.W14": 10 }
  };
  var t = utilWeekTotals_(["2026.W14", "2026.W15", "2026.W16"], cap, trk, ["alice", "bob", "cara"]);

  // W14: covered = alice(40) + bob(0) = 40 cap; tracked of covered = 38+5 = 43; cara excluded
  assert_(t.cap["2026.W14"] === 40, "W14 capSum = covered people only");
  assert_(t.tracked["2026.W14"] === 43, "W14 trkSum = covered people's tracked only");
  assert_(t.covered["2026.W14"] === 2 && t.trackedOnly["2026.W14"] === 1, "W14 coverage counts");
  assert_(Math.round(t.util["2026.W14"]) === 108, "W14 util >100% passes through (43/40)");
  // W15: only alice covered; 44/40 = 110%
  assert_(Math.round(t.util["2026.W15"]) === 110, "W15 util = 110");
  assert_(t.trackedOnly["2026.W15"] === 0, "W15 no tracked-only people");
  // W16: nobody has capacity → util null, sums 0
  assert_(t.util["2026.W16"] === null && t.cap["2026.W16"] === 0, "no-capacity week -> util null");
  Logger.log("✅ _test_utilizationMath_ passed");
}

function _test_utilizationCsv_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilizationCsv_: " + msg); }
  var cap = { "alice": { "2026.W14": 40, "2026.W16": 40 }, "eve": {} };
  var trk = { "alice": { "2026.W14": 38.55 }, "eve": { "2026.W14": 12 } };
  var names = { "alice": "Alice Doe", "eve": "=Evil()" };
  var rows = buildUtilCsvRows_(["2026.W14", "2026.W15", "2026.W16"], cap, trk, names,
                               ["eve", "alice"], { "2026.W16": true });

  assert_(JSON.stringify(rows[0]) === JSON.stringify(["User", "Week", "Capacity hrs", "Tracked hrs", "Utilization %"]), "header row");
  // Sorted by display name: Alice first, then =Evil()… actually "=Evil()" < "Alice Doe" lexically — verify deterministic sort:
  var users = rows.slice(1).map(function (r) { return r[0]; });
  assert_(users.join("|").indexOf("Alice Doe") !== -1 && users.join("|").indexOf("=Evil()") !== -1, "both people present");
  // Alice W14: cap 40, tracked 38.6 (round1), util 96.4
  var aliceW14 = rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W14"; })[0];
  assert_(aliceW14 && aliceW14[2] === 40 && aliceW14[3] === 38.6 && aliceW14[4] === 96.4, "alice W14 row (round1)");
  // Alice W15: no cap, no tracked → row skipped
  assert_(rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W15"; }).length === 0, "empty person-week skipped");
  // Alice W16 (future): capacity only, blank tracked + util
  var aliceW16 = rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W16"; })[0];
  assert_(aliceW16 && aliceW16[2] === 40 && aliceW16[3] === "" && aliceW16[4] === "", "future week = capacity only");
  // Eve W14: tracked without capacity → blank capacity/util, tracked shown
  var eveW14 = rows.filter(function (r) { return r[1] === "2026.W14" && r[0] === "=Evil()"; })[0];
  assert_(eveW14 && eveW14[2] === "" && eveW14[3] === 12 && eveW14[4] === "", "tracked-no-capacity row blanks");

  // CSV string: formula injection guarded, numbers untouched, CRLF lines
  var csv = utilCsvString_(rows);
  assert_(csv.indexOf("'=Evil()") !== -1, "leading = guarded with apostrophe");
  assert_(csv.indexOf("\r\n") !== -1, "CRLF line endings");
  assert_(csvEscape_(-5) === "-5", "negative number not formula-guarded");
  assert_(csvEscape_('He said "hi", ok') === '"He said ""hi"", ok"', "quotes+comma escaping");
  Logger.log("✅ _test_utilizationCsv_ passed");
}

_test_utilizationMath_();
_test_utilizationCsv_();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node node-tests.js` — FAIL with `❌ UTIL-PURE block not found in Dashboard.html`.

- [ ] **Step 3: Add the UTIL-PURE block to Dashboard.html**

Insert immediately AFTER the closing brace of `filteredWeekTotals_` (the line `return { planned: planned, tracked: tracked };` + `}`) and before the `peopleFilterActive_` comment block:

```js
/* ==UTIL-PURE-START== */
/* Pure utilization math + CSV builders — NO DOM/global access. node-tests.js
   extracts exactly this block (between the markers) and unit-tests it, so keep
   it dependency-free: everything these functions need arrives as arguments. */

// Weekly team totals for the Utilization panel. COVERAGE RULE: for each week,
// only people with a numeric capacity cell contribute — their capacity AND
// their tracked hours. Tracked-but-capacity-blank people are excluded from
// both sums (they'd inflate the rate) and counted in trackedOnly so the
// tooltip can state coverage. util is null when the week has no capacity.
// Blank ≠ 0: `iso in capMap[np]` detects real cells; explicit 0 counts.
function utilWeekTotals_(isos, capMap, trkMap, npList){
  var out = { cap:{}, tracked:{}, covered:{}, trackedOnly:{}, util:{} };
  isos.forEach(function(iso){
    var capSum=0, trkSum=0, covered=0, trackedOnly=0;
    npList.forEach(function(np){
      var cw=capMap[np], tw=trkMap[np];
      var t=(tw&&tw[iso])||0;
      if (cw && (iso in cw)) { capSum+=cw[iso]; trkSum+=t; covered++; }
      else if (t>0) trackedOnly++;
    });
    out.cap[iso]=capSum; out.tracked[iso]=trkSum;
    out.covered[iso]=covered; out.trackedOnly[iso]=trackedOnly;
    out.util[iso]=capSum>0?(trkSum/capSum*100):null;
  });
  return out;
}

function round1_(n){ return Math.round(n*10)/10; }

// CSV rows (header first), person-major, people sorted by display name.
// futureIsoSet marks weeks after the current one: those rows carry capacity
// only (blank tracked/util — nothing to divide yet). Blank capacity stays
// blank, never 0. A person-week with neither a capacity cell nor tracked
// hours emits no row.
function buildUtilCsvRows_(isoList, capMap, trkMap, nameMap, npList, futureIsoSet){
  var rows=[["User","Week","Capacity hrs","Tracked hrs","Utilization %"]];
  var sorted=npList.slice().sort(function(a,b){
    var an=nameMap[a]||a, bn=nameMap[b]||b;
    return an<bn?-1:(an>bn?1:0);
  });
  sorted.forEach(function(np){
    var cw=capMap[np]||{}, tw=trkMap[np]||{};
    isoList.forEach(function(iso){
      var hasCap=(iso in cw);
      var isFut=!!futureIsoSet[iso];
      var trkVal=tw[iso]||0;
      if(!hasCap && !(trkVal>0)) return;
      var capCell = hasCap ? round1_(cw[iso]) : "";
      var trkCell = isFut ? "" : round1_(trkVal);
      var utilCell = (!isFut && hasCap && cw[iso]>0) ? round1_(trkVal/cw[iso]*100) : "";
      rows.push([nameMap[np]||np, iso, capCell, trkCell, utilCell]);
    });
  });
  return rows;
}

// Formula-injection-safe CSV field: numbers pass through verbatim (a negative
// number is not a formula); strings get an apostrophe guard on leading
// = + - @ and standard quote-wrapping when they contain , " or newlines.
function csvEscape_(v){
  if (typeof v === 'number') return String(v);
  var s = String(v==null?'':v);
  if (/^[=+\-@]/.test(s)) s = "'"+s;
  if (/[",\r\n]/.test(s)) s = '"'+s.replace(/"/g,'""')+'"';
  return s;
}

function utilCsvString_(rows){
  return rows.map(function(r){ return r.map(csvEscape_).join(","); }).join("\r\n");
}
/* ==UTIL-PURE-END== */
```

- [ ] **Step 4: Run to verify it passes**

Run: `node node-tests.js` — expect `✅ _test_utilizationMath_ passed`, `✅ _test_utilizationCsv_ passed`, final all-suites line.

- [ ] **Step 5: Commit**

```bash
git add Dashboard.html node-tests.js
git commit -m "feat(utilization): pure client math + CSV builders, node-tested via UTIL-PURE extraction"
```

---

### Task 4: Utilization panel — markup, renderer, tooltip, CSV download, wiring

**Files:**
- Modify: `project-demand-dashboard/Dashboard.html` (markup after the PvT panel; renderer + handlers after `renderCapChart`; wiring in `renderAll` and `reRenderAll_`)

No new Node tests (DOM/SVG code), but `node node-tests.js` remains the syntax/regression gate — the UTIL-PURE extraction still evals, and a malformed edit that breaks the markers fails loudly.

- [ ] **Step 1: Add the panel markup**

Insert AFTER the closing `</div>` of the Planned vs Tracked panel (the `<div class="sowhat" id="capSoWhat"></div>` line followed by `</div>`, i.e. right before `<!-- 1b. Team Availability -->`):

```html
    <!-- 1c. Utilization — tracked hours ÷ Tempo work-schedule capacity -->
    <div class="panel" id="utilPanel" data-view="overview">
      <div class="panel-h">
        <h2>Utilization</h2>
        <div class="panel-tools">
          <div class="hint">Tracked hours (green) ÷ Tempo work-schedule capacity (gray) · utilization % per week · capacity comes from the weekly "Capacity Tempo" export (part-time schedules, holidays &amp; Sun–Thu weeks respected) · dashed = future capacity · ghosted + hollow point = current week still logging · % counts only people with capacity data that week · billing chips do not apply (utilization is whole-tracked) · reflects People filters above</div>
          <button class="btn" id="utilCsvBtn" style="font-size:11px;padding:5px 10px" title="Person × week capacity report — full range (past, current &amp; future weeks), respects the People filters">⇣ CSV</button>
          <button class="png-btn" data-png="utilization">⬇ Save PNG</button>
        </div>
      </div>
      <div id="utilChart"></div>
      <div class="cap-legend" id="utilLegend"></div>
      <div class="sowhat" id="utilSoWhat"></div>
    </div>
```

- [ ] **Step 2: Add the renderer, tooltip and CSV handler**

Insert AFTER the closing brace of `renderCapChart` (the `$('capChart').innerHTML=g;` line + `}`), before `populateAvailFilters`:

```js
/* ---------------- Utilization panel (Tracked ÷ Tempo schedule capacity) ---------------- */
// Server fields: DATA.personWeekCapacity (np → iso → hrs, Services-scoped),
// DATA.capacityIsoList (every sheet week incl. future), DATA.capacityNames,
// DATA.capacityError. Math/CSV builders live in the UTIL-PURE block above.
var UTIL_WT=null, UTIL_CW=null;

// People in scope for utilization: the filtered set when a People filter is
// active, else everyone with capacity or tracked data (all Services-scoped).
function utilNpList_(){
  var pset=filteredPersonSet_();
  if(pset) return Object.keys(pset);
  var u={};
  Object.keys(DATA.personWeekCapacity||{}).forEach(function(np){u[np]=1;});
  Object.keys(DATA.personWeekTracked||{}).forEach(function(np){u[np]=1;});
  return Object.keys(u);
}

function renderUtilization(){
  var panel=$('utilPanel'); if(!panel) return;
  if(SOURCE!=='live'){ panel.style.display='none'; return; }   // capacity isn't in the offline CSV
  panel.style.display='';
  var capIsos=(DATA&&DATA.capacityIsoList)||[];
  var csvBtn=$('utilCsvBtn');
  if(!capIsos.length){
    $('utilChart').innerHTML='';
    $('utilLegend').innerHTML='';
    $('utilSoWhat').className='sowhat';
    $('utilSoWhat').innerHTML='<b>Capacity data unavailable</b>'
      +(DATA&&DATA.capacityError?' — '+esc(DATA.capacityError):'')
      +' Run fetchTempoCapacity() in the Tempo export project, then ↻ Refresh.';
    if(csvBtn) csvBtn.style.display='none';
    return;
  }
  if(csvBtn) csvBtn.style.display='';

  // Week range: PvT's QTD window ∪ every capacity week (incl. future).
  var cw=capChartWeeks_().slice();
  var seen={}; cw.forEach(function(w){seen[w.iso]=true;});
  var curOrd=isoOrd(CURRENT_ISO);
  capIsos.forEach(function(iso){
    if(!seen[iso]){
      seen[iso]=true;
      cw.push({ iso:iso, status: isoOrd(iso)>curOrd?'plan':(isoOrd(iso)===curOrd?'now':'done') });
    }
  });
  cw.sort(function(a,b){ return isoOrd(a.iso)-isoOrd(b.iso); });

  var npList=utilNpList_();
  var isos=cw.map(function(w){return w.iso;});
  var ut=utilWeekTotals_(isos, DATA.personWeekCapacity||{}, DATA.personWeekTracked||{}, npList);
  UTIL_WT=ut; UTIL_CW=cw;

  renderUtilLegend_();
  renderUtilChart_(ut, cw);

  // Summary line — counts/percentages only, never names. Anchor on the selected
  // week when it has data, else the latest completed week with capacity.
  var isFiltered=!!filteredPersonSet_();
  var anchor=null;
  if(ut.util[SEL_ISO]!=null && cw.some(function(w){return w.iso===SEL_ISO && w.status!=='plan';})) anchor=SEL_ISO;
  else{
    for(var i=cw.length-1;i>=0;i--){
      if(cw[i].status==='done' && ut.util[cw[i].iso]!=null){ anchor=cw[i].iso; break; }
    }
  }
  var sw, cls='';
  if(anchor==null){
    sw='<b>No completed week has both capacity and tracked data yet.</b> Future capacity is charted (dashed) as it loads from the Friday export.';
  } else {
    var u=ut.util[anchor], isNow=anchor===CURRENT_ISO;
    var uPct=Math.round(u);
    cls = (u>110||u<60)?'warn':(u>=85?'ok':'');
    sw='<b>'+esc(anchor)+(isNow?' (in progress)':'')+' utilization '+uPct+'%</b> — '
      +fmt(ut.tracked[anchor])+' hrs tracked against '+fmt(ut.cap[anchor])+' hrs of scheduled capacity across '
      +ut.covered[anchor]+' people'+(isFiltered?' (filtered)':'')+'.';
    if(ut.trackedOnly[anchor]>0){
      sw+=' <span class="hint">'+ut.trackedOnly[anchor]+' additional tracked '
        +(ut.trackedOnly[anchor]===1?'person has':'people have')+' no capacity data this week — excluded from the %.</span>';
    }
    if(isNow) sw+=' <span class="hint">Week still logging — the % will keep rising.</span>';
  }
  $('utilSoWhat').className='sowhat '+cls;
  $('utilSoWhat').innerHTML=sw;
}

function renderUtilLegend_(){
  var el=$('utilLegend'); if(!el) return;
  el.innerHTML='<span><i style="background:'+hexVar('--slate')+'"></i>Capacity</span>'
    +'<span><i style="background:#00A86B"></i>Tracked</span>'
    +'<span><i class="dashed"></i>Future capacity</span>';
}

function utilColor_(u){
  if(u==null) return css('--muted');
  if(u>110||u<60) return '#B71C1C';
  if(u>=85) return '#00A86B';
  return '#B45309';
}

function utilChartHover_(e, iso){
  var ut=UTIL_WT||{cap:{},tracked:{},covered:{},trackedOnly:{},util:{}};
  var cv=ut.cap[iso]||0, tv=ut.tracked[iso]||0, u=ut.util[iso];
  var utxt=u!=null?(Math.round(u)+'% utilization'+(iso===CURRENT_ISO?' (partial)':'')):'no capacity data';
  var covTxt='';
  if((ut.trackedOnly[iso]||0)>0){
    var covered=ut.covered[iso]||0;
    covTxt='<br>capacity data for '+covered+' of '+(covered+ut.trackedOnly[iso])+' people';
  }
  var ht=holidayTipHtml_(iso);
  showTip(e, '<b>'+esc(iso)+'</b><br>'+fmt(cv)+' hrs capacity<br>'+fmt(tv)+' hrs tracked<br>'+esc(utxt)+covTxt+(ht?'<br>'+ht:''));
}

function renderUtilChart_(ut, cw){
  var n=cw.length;
  var w=620,h=170,pad={l:44,r:14,t:22,b:24},iw=w-pad.l-pad.r,ih=h-pad.t-pad.b;
  var rawMax=1;
  cw.forEach(function(wk){
    rawMax=Math.max(rawMax, ut.cap[wk.iso]||0, ut.tracked[wk.iso]||0);
  });
  var maxv=niceRound(rawMax);
  var x=function(i){return pad.l+(n===1?0:i/(n-1)*iw);};
  var y=function(v){return pad.t+ih-Math.min(v,maxv)/maxv*ih;};
  var curIdx=-1; cw.forEach(function(wk,i){ if(wk.status==='now') curIdx=i; });
  var g='<svg viewBox="0 0 '+w+' '+h+'" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="utilization: tracked vs schedule capacity per week">';
  // future tint + gridlines + axis label (same conventions as the PvT chart)
  var firstPlan=-1; cw.forEach(function(wk,i){if(firstPlan<0&&wk.status==='plan')firstPlan=i;});
  if(firstPlan>=0){var x0=x(Math.max(0,firstPlan-0.5));g+='<rect x="'+x0+'" y="'+pad.t+'" width="'+(w-pad.r-x0)+'" height="'+ih+'" fill="'+hexVar('--slate')+'" opacity="0.05"/>';}
  for(var gl=0;gl<=2;gl++){var yy=pad.t+ih*gl/2;g+='<line x1="'+pad.l+'" y1="'+yy+'" x2="'+(w-pad.r)+'" y2="'+yy+'" stroke="'+css('--border')+'" stroke-width="1" opacity=".5"/>';g+='<text x="'+(pad.l-6)+'" y="'+(yy+3)+'" text-anchor="end" font-size="9" fill="'+css('--muted')+'">'+fmt(maxv*(1-gl/2))+'</text>';}
  g+='<text x="12" y="'+(pad.t+ih/2)+'" text-anchor="middle" font-size="9" fill="'+css('--muted')+'" transform="rotate(-90 12 '+(pad.t+ih/2)+')">hrs</text>';
  if(curIdx>=0){
    var cx=x(curIdx);
    g+='<line x1="'+cx+'" y1="'+pad.t+'" x2="'+cx+'" y2="'+(pad.t+ih)+'" stroke="'+css('--muted')+'" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>';
  }
  // capacity area + line: solid through current, dashed into future weeks.
  // Weeks with NO capacity data (cap 0 AND util null) draw no capacity point.
  var capPts=[];
  cw.forEach(function(wk,i){
    var hasCapData=ut.util[wk.iso]!=null||((ut.cap[wk.iso]||0)>0)||((ut.covered[wk.iso]||0)>0);
    if(hasCapData) capPts.push({i:i,x:x(i),y:y(ut.cap[wk.iso]||0),wk:wk});
  });
  if(capPts.length>1){
    var aPts=capPts.map(function(p){return p.x+','+p.y;});
    g+='<path d="M'+capPts[0].x+','+y(0)+' L'+aPts.join(' L')+' L'+capPts[capPts.length-1].x+','+y(0)+' Z" fill="'+hexVar('--slate')+'" opacity="0.12"/>';
    for(var ci=1;ci<capPts.length;ci++){
      var dash=capPts[ci].wk.status==='plan'?' stroke-dasharray="4 3"':'';
      g+='<line x1="'+capPts[ci-1].x+'" y1="'+capPts[ci-1].y+'" x2="'+capPts[ci].x+'" y2="'+capPts[ci].y+'" stroke="'+hexVar('--slate')+'" stroke-width="2.4"'+dash+'/>';
    }
  }
  // tracked line — past/current weeks only; segment into the current week ghosted.
  var tPts=[];
  cw.forEach(function(wk,i){
    if(wk.status==='plan') return;
    tPts.push({x:x(i),y:y(ut.tracked[wk.iso]||0),h:ut.tracked[wk.iso]||0,wk:wk});
  });
  if(tPts.some(function(p){return p.h>0;})){
    for(var ti=1;ti<tPts.length;ti++){
      var ghost=tPts[ti].wk.status==='now'||tPts[ti-1].wk.status==='now';
      g+='<line x1="'+tPts[ti-1].x+'" y1="'+tPts[ti-1].y+'" x2="'+tPts[ti].x+'" y2="'+tPts[ti].y+'" stroke="#00A86B" stroke-width="2.4"'+(ghost?' stroke-dasharray="3 4" opacity="0.45"':'')+'/>';
    }
    tPts.forEach(function(p){
      if(!p.h) return;
      var partial=p.wk.status==='now';
      g+='<circle cx="'+p.x+'" cy="'+p.y+'" r="'+(partial?3.4:2.8)+'" fill="'+(partial?hexVar('--surface'):'#00A86B')+'" stroke="#00A86B" stroke-width="'+(partial?2:0)+'"'+(partial?' opacity="0.75"':'')+'/>';
    });
  }
  // utilization % labels above the capacity line — past + current (asterisked) weeks
  cw.forEach(function(wk,i){
    if(wk.status==='plan') return;
    var u=ut.util[wk.iso];
    if(u==null) return;
    var lbl=Math.round(u)+'%'+(wk.status==='now'?'*':'');
    g+='<text x="'+x(i)+'" y="'+(y(ut.cap[wk.iso]||0)-7)+'" text-anchor="middle" font-size="8" fill="'+utilColor_(u)+'" font-weight="700">'+lbl+'</text>';
  });
  // hit-columns + thinned week labels (same interaction as the PvT chart)
  var spacing=n>1?iw/(n-1):iw;
  var labelStep=Math.max(1,Math.ceil(26/spacing));
  var rectW=Math.max(10,Math.min(36,spacing));
  cw.forEach(function(wk,i){
    var lx=x(i);
    var isSel=wk.iso===SEL_ISO, isCur=i===curIdx, isEdge=(i===0||i===n-1);
    g+='<rect x="'+(lx-rectW/2)+'" y="'+pad.t+'" width="'+rectW+'" height="'+(h-pad.t)+'" fill="transparent" style="cursor:pointer" '
      +'onmouseenter="utilChartHover_(event,\''+wk.iso+'\')" onmouseleave="hideTip()" onclick="capChartNav_(\''+wk.iso+'\')"/>';
    if(isSel||isCur||isEdge||i%labelStep===0){
      var shortLbl=wk.iso.replace(/^\d{4}\./,'');
      g+='<text x="'+lx+'" y="'+(h-7)+'" text-anchor="middle" font-size="9" fill="'+(isSel?hexVar('--orbe'):css('--muted'))+'" font-weight="'+(isSel?'700':'400')+'" style="pointer-events:none">'+shortLbl+'</text>';
    }
  });
  g+='</svg>';
  $('utilChart').innerHTML=g;
}

function downloadUtilCsv_(){
  var capIsos=(DATA&&DATA.capacityIsoList)||[]; if(!capIsos.length) return;
  var npList=utilNpList_();
  // capacityNames wins (raw Tempo/Jira display names); displayNames fills tracked-only people.
  var nameMap=Object.assign({}, DATA.displayNames||{}, DATA.capacityNames||{});
  var curOrd=isoOrd(CURRENT_ISO);
  var fut={}; capIsos.forEach(function(iso){ if(isoOrd(iso)>curOrd) fut[iso]=true; });
  var rows=buildUtilCsvRows_(capIsos, DATA.personWeekCapacity||{}, DATA.personWeekTracked||{}, nameMap, npList, fut);
  var blob=new Blob([utilCsvString_(rows)], {type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='utilization-'+(CURRENT_ISO||'export')+'.csv';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}
```

- [ ] **Step 3: Wire it in**

(a) In `renderAll()` change:

```js
function renderAll(){
  renderRange(); renderCapacity(); renderUtilization(); renderAvailability();
  renderHeat(); renderEpicRollup(); renderPmRollup(); renderFoot();
}
```

(b) In `reRenderAll_()`, after the `if(typeof renderCapacity==='function')renderCapacity();` line add:

```js
  if(typeof renderUtilization==='function')renderUtilization();
```

(c) Bind the CSV button — in the same boot-time wiring area where the billing chips are bound (`syncBillingChips_` / the `$('billingFilter')` handler block ends), add:

```js
  var ucb=$('utilCsvBtn'); if(ucb) ucb.onclick=downloadUtilCsv_;
```

Place it inside the existing DOM-ready/init function that binds the other buttons (locate the block that assigns `onclick` handlers near boot; if buttons are bound inline elsewhere, `onclick="downloadUtilCsv_()"` on the button tag is the acceptable fallback — pick ONE, not both).

(d) Confirm the PNG button works: the existing PNG wiring binds every `.png-btn` via its `data-png` attribute (querySelectorAll at boot). The new button is in the initial DOM so it is picked up with zero extra code — verify by searching for `png-btn` binding and confirming it's a `querySelectorAll` over the document, not a hardcoded id list. If it IS a hardcoded list, add `'utilization'` following the existing pattern.

- [ ] **Step 4: Run the Node gate**

Run: `node node-tests.js` — all suites still green (extraction markers intact).

- [ ] **Step 5: Commit**

```bash
git add Dashboard.html
git commit -m "feat(utilization): Utilization panel — schedule-capacity vs tracked chart + person-week CSV export"
```

---

### Task 5: Review gates + deploy QA (owner-run)

- [ ] **Step 1: Final review** — whole-branch review of the four commits against the spec (freeze on blank≠0, coverage rule, Services scope, headline untouched, no names in chart text, ES5 syntax, no regression to existing renderers).
- [ ] **Step 2: Deploy** — copy `Code.js` + `Dashboard.html` into the demand-dashboard GAS project, then run **`bustDemandCache_()`** in the GAS editor (REQUIRED — the cached model gains new fields; the warmer would otherwise serve the old shape for up to 65 min).
- [ ] **Step 3: Live QA checklist** (owner, in the deployed web app):
  1. Overview tab shows the new Utilization panel below Planned vs Tracked; capacity line covers W14 → last future week; % labels on past weeks; current week ghosted with `*`; future weeks dashed, no %.
  2. Hover a week → tooltip shows capacity hrs, tracked hrs, utilization %, and a coverage line when some tracked people lack capacity data.
  3. Apply a Manager filter → panel recomputes; numbers shrink consistently with the PvT panel above.
  4. Click ⇣ CSV → file `utilization-2026.W29.csv` downloads; spot-check one person: capacity matches the Capacity Tempo sheet, tracked matches Tempo, future weeks have blank tracked/util; open in Sheets → no cell executes as a formula.
  5. Billing chips: click "Billable" → PvT tracked line changes, Utilization panel does NOT.
  6. Temporarily rename the Capacity Tempo tab → ↻ Refresh → panel shows the "Capacity data unavailable" hint, everything else renders; rename back, ↻ Refresh.
  7. Headline Demand-vs-Capacity numbers are identical to pre-deploy values (heuristic untouched).

---

## Self-review notes (already applied)

- **Spec coverage:** §1 reader/model → Tasks 1–2; §2 panel/math/ghosting/coverage → Tasks 3–4; §2 CSV incl. injection guard → Tasks 3–4; §2 degraded modes → Task 4 (`SOURCE!=='live'` hide, capacityError hint); §3 tests → Tasks 1–3; §4 deploy/cache-bump → Task 5.
- **Type consistency:** `parseCapacityGrid_ → {byName, names, isoList}` consumed by `scopeCapacityToServices_` and `readTempoCapacity_`; model fields `personWeekCapacity/capacityNames/capacityIsoList/capacityError` are the exact names the client reads; `utilWeekTotals_ → {cap, tracked, covered, trackedOnly, util}` is what `renderUtilization`/`utilChartHover_`/`renderUtilChart_` consume; `buildUtilCsvRows_` header matches the CSV test verbatim.
- **Known judgment calls:** the capacity line uses `--slate` (defined only in the light `:root`; acceptable — it resolves in dark mode too since dark theme doesn't override it, and `hexVar` falls back to `#888888` if ever missing). A person scheduled 0 hrs but tracking hours counts toward the week's tracked sum (real overtime signal, covered by `_test_utilizationMath_` W14 case).
