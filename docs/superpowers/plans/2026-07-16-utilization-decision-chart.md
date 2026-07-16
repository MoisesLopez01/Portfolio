# Utilization Decision-Grade Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the demand dashboard's Utilization panel into a decision-grade chart: tracking-required population by default, Coverage × Fidelity identity header, control band + 70% target, honest provisional/projected week rendering, population toggle chips with live deltas, an exact week-over-week contribution drill, and a `Group` column in the CSV.

**Architecture:** Client-only change to `docs/superpowers/project-demand-dashboard/Dashboard.html` — no Code.js edit, no cache bump. All new math goes in the `UTIL-PURE` block (pure functions, no DOM/globals) which `node-tests.js` extracts and evals; rendering stays in the Utilization panel section (`renderUtilization()` etc.). Spec: `docs/superpowers/specs/2026-07-16-utilization-decision-chart-design.md`.

**Tech Stack:** Vanilla ES5 JavaScript inside a GAS `HtmlService` page, inline SVG charts, Node (plain `node node-tests.js`) for unit tests.

---

## Orientation for the implementer

- **The one file you edit:** `docs/superpowers/project-demand-dashboard/Dashboard.html`. Tests: `docs/superpowers/project-demand-dashboard/node-tests.js`.
- **Run tests:** `cd docs/superpowers/project-demand-dashboard && node node-tests.js`. Success ends with `✅ node-tests: all suites passed`. The harness evals `Code.js`, then extracts the text between `/* ==UTIL-PURE-START== */` and `/* ==UTIL-PURE-END== */` in Dashboard.html and evals it — so every function you add between those markers is directly callable in tests, and **must not touch the DOM, `DATA`, or any global**.
- **Code style:** ES5 only (`var`, `function`, no arrow functions, no template literals — the GAS HTML page targets old parsers and the whole file is written that way). Private helpers end in `_`. Match the surrounding comment density.
- **Key existing pieces you'll reuse (do not rewrite):**
  - `utilWeekTotals_(isos, capMap, trkMap, npList)` — weekly totals with the coverage rule (only people with a numeric capacity cell that week contribute capacity AND tracked; others counted in `trackedOnly`). Lives in UTIL-PURE.
  - `utilNpList_()` — people in scope: the People-filtered set when a filter is active, else everyone with capacity or tracked data.
  - `DATA.personMeta[np]` — `{ location, jobFamily, manager, isManager, isCrew, excluded }`.
  - `DATA.personWeekCapacity` / `DATA.personWeekTracked` / `DATA.personWeekPlan` — `np → iso → hrs`.
  - `personWeekCap_(np)` — a person's standard week (38 ANZ / 40 US).
  - `capChartWeeks_()`, `isoOrd(iso)`, `CURRENT_ISO`, `SEL_ISO`, `esc()`, `fmt()`, `css()`, `hexVar()`, `showTip()/hideTip()`, `capChartNav_()`.
- **Week-state vocabulary used throughout:** cw entries have `status: 'done' | 'now' | 'plan'`. The NEW model refines this: the `'done'` week with the highest `isoOrd` is **provisional** (still settling); older `'done'` weeks are **settled**; `'now'` is **projected**; `'plan'` is future capacity.
- **Commit after every task.** All commits stay local (never push).

---

### Task 1: CONFIG constants + population split (pure)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` (constants above the UTIL-PURE block ~line 815; new function inside the block before `round1_`)
- Test: `docs/superpowers/project-demand-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test** — in `node-tests.js`, after `_test_utilizationCsv_` (~line 124), add:

```js
function _test_utilSplitPopulation_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilSplitPopulation_: " + msg); }
  var meta = {
    "ana":  { jobFamily: "Service Delivery", isManager: false },
    "ben":  { jobFamily: "Managed Services & Support", isManager: false },
    "carl": { jobFamily: "Service Delivery", isManager: true },   // manager carve-out wins over family
    "dana": { jobFamily: "Finance", isManager: false },           // known non-tracking family
    "eli":  { jobFamily: "", isManager: false }                   // roster row, blank family → Delivery
    // "fay" has no meta entry at all (capacity/tracked-only person) → Delivery
  };
  var fams = ["Managed Services & Support", "Service Delivery", "Professional Services"];
  var s = utilSplitPopulation_(["ana", "ben", "carl", "dana", "eli", "fay"], meta, fams);
  assert_(s.delivery.join("|") === "ana|ben|eli|fay", "delivery = allowlist + blank/unknown family");
  assert_(s.managers.join("|") === "carl", "managers carved out before family check");
  assert_(s.nonTracking.join("|") === "dana", "known non-allowlist family → nonTracking");
  // Case-insensitive family match
  var s2 = utilSplitPopulation_(["ana"], { "ana": { jobFamily: "service delivery", isManager: false } }, fams);
  assert_(s2.delivery.length === 1, "family match is case-insensitive");
  Logger.log("✅ _test_utilSplitPopulation_ passed");
}
```

And add `_test_utilSplitPopulation_();` next to the other two util test invocations (before the final `console.log`).

- [ ] **Step 2: Run tests to verify failure**

Run: `cd docs/superpowers/project-demand-dashboard && node node-tests.js`
Expected: FAIL with `utilSplitPopulation_ is not defined`

- [ ] **Step 3: Add the CONFIG constants** — in Dashboard.html, directly ABOVE the `/* ==UTIL-PURE-START== */` line, add:

```js
/* ---------------- Utilization population & target policy ----------------
   The utilization headline measures only the roles it is FAIR to hold to a
   tracking standard — the delivery families below. Managers and non-tracking
   families are carved out by default and reachable via panel-local chips that
   disclose their effect (+N people, ±pp) instead of baking the bias in.
   "Professional Services" matches nothing in today's catalog — it is defensive,
   auto-including that family if the roster's Job Family column ever carries it. */
var UTIL_TRACKING_FAMILIES = [
  "Managed Services & Support",   // JF007
  "Service Delivery",             // JF009
  "Professional Services",        // defensive — see note above
];
var UTIL_TARGET     = 70;  // % — proven level for the delivery families, not aspirational
var UTIL_BAND_WEEKS = 8;   // trailing settled weeks for the control band (needs ≥4 to draw)
```

- [ ] **Step 4: Implement `utilSplitPopulation_`** — inside the UTIL-PURE block, after `utilWeekTotals_` and before `round1_`:

```js
// Population split for the utilization denominator — first match wins:
// manager carve-out → allowlist family → blank/unknown family (a person in the
// Services capacity/tracked scope with no resolvable roster family is treated
// as tracking-required; a Tempo schedule implies a tracking expectation) →
// known non-allowlist family. Family match is case-insensitive.
function utilSplitPopulation_(npList, metaMap, families){
  var famSet = {};
  (families || []).forEach(function(f){ famSet[String(f).toLowerCase()] = true; });
  var out = { delivery: [], managers: [], nonTracking: [] };
  npList.forEach(function(np){
    var m = metaMap[np];
    if (m && m.isManager) { out.managers.push(np); return; }
    var fam = (m && m.jobFamily) ? String(m.jobFamily).toLowerCase() : '';
    if (!fam || famSet[fam]) { out.delivery.push(np); return; }
    out.nonTracking.push(np);
  });
  return out;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node node-tests.js`
Expected: `✅ _test_utilSplitPopulation_ passed` and `✅ node-tests: all suites passed`

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "feat(utilization): population policy constants + tracking-required split"
```

---

### Task 2: Control-band statistics (pure)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` (UTIL-PURE block)
- Test: `docs/superpowers/project-demand-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test** — add after `_test_utilSplitPopulation_`:

```js
function _test_utilControlStats_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilControlStats_: " + msg); }
  var u = { "W1": 60, "W2": 64, "W3": null, "W4": 62, "W5": 66 };  // W3: no capacity that week
  // Only 4 numeric settled values → stats over [60,64,62,66]: mean 63, σ = sqrt(20/4)=2.236
  var s = utilControlStats_(u, ["W1", "W2", "W3", "W4", "W5"], 8);
  assert_(s && Math.round(s.mean) === 63, "mean over numeric settled weeks");
  assert_(Math.abs(s.sigma - 2.2360679) < 1e-4, "population sigma");
  assert_(Math.abs(s.lo - (63 - 2 * s.sigma)) < 1e-9 && Math.abs(s.hi - (63 + 2 * s.sigma)) < 1e-9, "lo/hi = mean ± 2σ");
  assert_(s.n === 4, "n reports the values used");
  // bandWeeks window: only the trailing 4 of 6 values are used
  var u2 = { "A": 10, "B": 90, "C": 60, "D": 60, "E": 60, "F": 60 };
  var s2 = utilControlStats_(u2, ["A", "B", "C", "D", "E", "F"], 4);
  assert_(s2.mean === 60 && s2.sigma === 0, "trailing bandWeeks window only");
  // Under 4 numeric values → null (band hidden)
  assert_(utilControlStats_({ "W1": 60, "W2": 61, "W3": 62 }, ["W1", "W2", "W3"], 8) === null, "needs ≥4 settled values");
  // lo clamps at 0
  var s3 = utilControlStats_({ a: 1, b: 30, c: 1, d: 30 }, ["a", "b", "c", "d"], 8);
  assert_(s3.lo === 0, "lo clamped at 0");
  Logger.log("✅ _test_utilControlStats_ passed");
}
```

Add `_test_utilControlStats_();` to the invocation list.

- [ ] **Step 2: Run tests to verify failure**

Run: `node node-tests.js` — Expected: FAIL with `utilControlStats_ is not defined`

- [ ] **Step 3: Implement** — in UTIL-PURE, after `utilSplitPopulation_`:

```js
// Control-band statistics: mean ± 2σ (population σ) over the trailing bandWeeks
// SETTLED weeks that have a numeric utilization. Provisional and in-progress
// weeks must not be in settledIsos — late logging would drag the band down.
// Returns null when fewer than 4 numeric values exist (band hidden).
function utilControlStats_(utilByIso, settledIsos, bandWeeks){
  var vals = [];
  settledIsos.forEach(function(iso){ if (utilByIso[iso] != null) vals.push(utilByIso[iso]); });
  vals = vals.slice(-bandWeeks);
  if (vals.length < 4) return null;
  var mean = 0;
  vals.forEach(function(v){ mean += v; });
  mean /= vals.length;
  var varSum = 0;
  vals.forEach(function(v){ varSum += (v - mean) * (v - mean); });
  var sigma = Math.sqrt(varSum / vals.length);
  return { mean: mean, sigma: sigma, lo: Math.max(0, mean - 2 * sigma), hi: mean + 2 * sigma, n: vals.length };
}
```

- [ ] **Step 4: Run tests to verify pass** — `node node-tests.js` → all suites pass.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "feat(utilization): control-band statistics over trailing settled weeks"
```

---

### Task 3: Live-week projection (pure)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` (UTIL-PURE block)
- Test: `docs/superpowers/project-demand-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test**:

```js
function _test_utilProjection_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilProjection_: " + msg); }
  // Thu (4 elapsed workdays), 20h logged, 40h capacity → 20/(4/5)=25h pace → 62.5%
  var p = utilProjection_(20, 40, 4, 3);
  assert_(Math.abs(p.pct - 62.5) < 1e-9, "linear scale-up: 20h by Thu on 40h → 62.5%");
  assert_(Math.abs(p.lo - 56.5) < 1e-9 && Math.abs(p.hi - 68.5) < 1e-9, "band = pct ± 2σ");
  // Monday clamps to 1 elapsed day, weekend passes 5 straight through
  assert_(Math.abs(utilProjection_(8, 40, 0, 0).pct - 100) < 1e-9, "elapsed clamped to ≥1 (8h ÷ 1/5 of 40h)");
  assert_(Math.abs(utilProjection_(30, 40, 7, 0).pct - 75) < 1e-9, "elapsed clamped to ≤5");
  // No sigma yet (young band) → point only, no range
  var p2 = utilProjection_(20, 40, 4, null);
  assert_(p2.lo === null && p2.hi === null, "no sigma → no band");
  // lo clamps at 0; no capacity → null
  assert_(utilProjection_(0.4, 40, 5, 5).lo === 0, "lo clamped at 0");
  assert_(utilProjection_(10, 0, 3, 2) === null, "zero capacity → null");
  Logger.log("✅ _test_utilProjection_ passed");
}
```

Add `_test_utilProjection_();` to the invocation list.

- [ ] **Step 2: Run tests to verify failure** — `node node-tests.js` → `utilProjection_ is not defined`

- [ ] **Step 3: Implement** — in UTIL-PURE, after `utilControlStats_`:

```js
// Linear elapsed-workday projection for the in-progress week: assume the pace
// so far (trackedSoFar over elapsed/5 of the week) holds through Friday.
// elapsedWorkdays counts Mon..today INCLUSIVE (today's hours are already in the
// numerator), clamped to [1,5] — callers pass 5 on weekends. The band reuses
// the control band's σ; null σ (band too young) → point estimate only.
function utilProjection_(trackedSoFar, capacity, elapsedWorkdays, sigma){
  if (!(capacity > 0)) return null;
  var d = Math.min(5, Math.max(1, elapsedWorkdays));
  var pct = (trackedSoFar / (d / 5)) / capacity * 100;
  return {
    pct: pct,
    lo: sigma != null ? Math.max(0, pct - 2 * sigma) : null,
    hi: sigma != null ? pct + 2 * sigma : null
  };
}
```

- [ ] **Step 4: Run tests to verify pass** — `node node-tests.js` → all suites pass.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "feat(utilization): elapsed-workday linear projection with sigma band"
```

---

### Task 4: Week-over-week decomposition (pure)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` (UTIL-PURE block)
- Test: `docs/superpowers/project-demand-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test**:

```js
function _test_utilDecompose_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilDecompose_: " + msg); }
  var cap = { "a": { W1: 40, W2: 40 }, "b": { W1: 40, W2: 40 }, "c": { W1: 40, W2: 20 } };
  var trk = { "a": { W1: 30, W2: 24 }, "b": { W1: 35, W2: 36 }, "c": { W1: 20, W2: 18 } };
  var groups = { "Service Delivery": ["a", "b"], "Managed Services & Support": ["c"] };
  var d = utilDecompose_("W2", "W1", groups, cap, trk);
  // util W1 = 85/120 = 70.833%, util W2 = 78/100 = 78% → Δ = +7.1667 pp
  var total = 0;
  d.forEach(function(g){ total += g.pp; });
  assert_(Math.abs(total - (78 - 85 / 120 * 100)) < 1e-9, "contributions sum exactly to Δutil (denominator changed too)");
  // SD group: 60/100 − 65/120 = 60 − 54.1667 = +5.833 pp; MS group: 18/100 − 20/120 = +1.333 pp
  var sd = d.filter(function(g){ return g.key === "Service Delivery"; })[0];
  assert_(Math.abs(sd.pp - (60 - 65 / 120 * 100)) < 1e-9, "per-group pp uses each week's own denominator");
  assert_(d[0].key === "Service Delivery", "sorted by |pp| descending");
  // Coverage rule respected: a tracked-only member contributes no pp
  var d2 = utilDecompose_("W2", "W1", { g1: ["a"], g2: ["nocap"] }, cap, { "a": { W1: 30, W2: 24 }, "nocap": { W1: 99, W2: 99 } });
  assert_(d2.filter(function(g){ return g.key === "g2"; })[0].pp === 0, "uncovered member contributes 0");
  // Missing capacity on either week → null (nothing to decompose)
  assert_(utilDecompose_("W9", "W1", groups, cap, trk) === null, "week without capacity → null");
  Logger.log("✅ _test_utilDecompose_ passed");
}
```

Add `_test_utilDecompose_();` to the invocation list.

- [ ] **Step 2: Run tests to verify failure** — `node node-tests.js` → `utilDecompose_ is not defined`

- [ ] **Step 3: Implement** — in UTIL-PURE, after `utilProjection_`:

```js
// Exact WoW decomposition for the "why did this week move?" drill. Per group g:
//   pp_g = trk_g(isoW)/capTotal(isoW) − trk_g(isoPrev)/capTotal(isoPrev)   (×100)
// where capTotal is the WHOLE population's covered capacity and trk_g sums only
// capacity-covered members (same coverage rule as utilWeekTotals_). Because the
// denominators are shared, Σ pp_g equals the headline's util(isoW) − util(isoPrev)
// exactly — the bars always account for the full move. Sorted by |pp| desc.
// Returns null when either week has no covered capacity.
function utilDecompose_(isoW, isoPrev, groups, capMap, trkMap){
  var all = [];
  Object.keys(groups).forEach(function(k){ all = all.concat(groups[k]); });
  var tot = utilWeekTotals_([isoW, isoPrev], capMap, trkMap, all);
  if (!(tot.cap[isoW] > 0) || !(tot.cap[isoPrev] > 0)) return null;
  var out = Object.keys(groups).map(function(k){
    var g = utilWeekTotals_([isoW, isoPrev], capMap, trkMap, groups[k]);
    return { key: k, pp: (g.tracked[isoW] / tot.cap[isoW] - g.tracked[isoPrev] / tot.cap[isoPrev]) * 100 };
  });
  out.sort(function(a, b){ return Math.abs(b.pp) - Math.abs(a.pp); });
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass** — `node node-tests.js` → all suites pass.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "feat(utilization): exact week-over-week contribution decomposition"
```

---

### Task 5: Coverage × Fidelity identity (pure)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` (UTIL-PURE block)
- Test: `docs/superpowers/project-demand-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test**:

```js
function _test_utilIdentity_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilIdentity_: " + msg); }
  var cap  = { "a": { W1: 40 }, "b": { W1: 40 }, "c": {} };
  var trk  = { "a": { W1: 30 }, "b": { W1: 34 }, "c": { W1: 10 } };
  var plan = { "a": { W1: 36 }, "b": { W1: 55 }, "c": { W1: 40 } };   // b over-planned → capped at 40
  var hrs  = { "a": 40, "b": 40, "c": 40 };
  var id = utilIdentity_("W1", ["a", "b", "c"], cap, trk, plan, hrs);
  // Covered: a+b. cap 80, tracked 64, planned 36+min(55,40)=76.
  assert_(id.cap === 80 && id.tracked === 64 && id.planned === 76, "sums respect coverage rule + plan cap");
  assert_(Math.abs(id.util - 80) < 1e-9, "util = 64/80");
  assert_(Math.abs(id.coverage - 95) < 1e-9, "coverage = 76/80");
  assert_(Math.abs(id.fidelity - (64 / 76 * 100)) < 1e-9, "fidelity = 64/76");
  // The identity reconciles: coverage × fidelity = utilization
  assert_(Math.abs(id.coverage * id.fidelity / 100 - id.util) < 1e-9, "coverage × fidelity = util");
  // No plan data that week → coverage/fidelity null, util still real
  var id2 = utilIdentity_("W1", ["a"], cap, trk, {}, hrs);
  assert_(id2.coverage === null && id2.fidelity === null && id2.util !== null, "plan-less week degrades to util-only");
  Logger.log("✅ _test_utilIdentity_ passed");
}
```

Add `_test_utilIdentity_();` to the invocation list.

- [ ] **Step 2: Run tests to verify failure** — `node node-tests.js` → `utilIdentity_ is not defined`

- [ ] **Step 3: Implement** — in UTIL-PURE, after `utilDecompose_`:

```js
// Coverage × Fidelity identity for one week over the covered population:
//   utilization = tracked/cap,  coverage = planned/cap,  fidelity = tracked/planned
// so coverage × fidelity = utilization by construction (planned cancels) — the
// header can show all three and they always reconcile. Planned hours are capped
// per person at their standard week (capHrsByNp), the SAME Math.min the Planned
// vs Tracked panel applies, so the two panels quote identical planned figures.
// Weeks with no plan data return null coverage/fidelity (header degrades).
function utilIdentity_(iso, npList, capMap, trkMap, planMap, capHrsByNp){
  var capSum = 0, trkSum = 0, planSum = 0, hasPlan = false;
  npList.forEach(function(np){
    var cw = capMap[np];
    if (!(cw && (iso in cw))) return;                       // coverage rule
    capSum += cw[iso];
    trkSum += (trkMap[np] && trkMap[np][iso]) || 0;
    var pw = planMap[np];
    if (pw && (iso in pw)) { hasPlan = true; planSum += Math.min(pw[iso] || 0, capHrsByNp[np] || 40); }
  });
  return {
    cap: capSum, tracked: trkSum, planned: planSum,
    util:     capSum > 0 ? trkSum / capSum * 100 : null,
    coverage: (capSum > 0 && hasPlan) ? planSum / capSum * 100 : null,
    fidelity: (hasPlan && planSum > 0) ? trkSum / planSum * 100 : null
  };
}
```

- [ ] **Step 4: Run tests to verify pass** — `node node-tests.js` → all suites pass.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "feat(utilization): coverage × fidelity identity math"
```

---

### Task 6: CSV `Group` column

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` (UTIL-PURE `buildUtilCsvRows_` + `downloadUtilCsv_` ~line 1569)
- Test: `docs/superpowers/project-demand-dashboard/node-tests.js` (`_test_utilizationCsv_`)

- [ ] **Step 1: Extend the existing test** — in `_test_utilizationCsv_`, change the `buildUtilCsvRows_` call to pass a group map as the new last argument, and update the header/row assertions:

```js
  var rows = buildUtilCsvRows_(["2026.W14", "2026.W15", "2026.W16"], cap, trk, names,
                               ["eve", "alice"], { "2026.W16": true },
                               { "alice": "Delivery", "eve": "Non-tracking" });

  assert_(JSON.stringify(rows[0]) === JSON.stringify(["User", "Week", "Capacity hrs", "Tracked hrs", "Utilization %", "Group"]), "header row gains Group");
```

And add two new assertions right after the existing `eveW14` assertion:

```js
  assert_(aliceW14[5] === "Delivery" && eveW14[5] === "Non-tracking", "Group column carries the population split");
  // Missing map entry defaults to Delivery (unknowns are tracking-required by policy)
  var rowsD = buildUtilCsvRows_(["2026.W14"], cap, trk, names, ["alice"], {}, {});
  assert_(rowsD[1][5] === "Delivery", "missing group entry defaults to Delivery");
```

(The `aliceW14`/`aliceW16`/`eveW14` index assertions on columns 2–4 are unchanged — `Group` is appended at the END of each row.)

- [ ] **Step 2: Run tests to verify failure** — `node node-tests.js` → FAIL on the header assertion.

- [ ] **Step 3: Implement** — in `buildUtilCsvRows_`: add trailing parameter `groupByNp`, extend the header, and append the group to each row:

```js
function buildUtilCsvRows_(isoList, capMap, trkMap, nameMap, npList, futureIsoSet, groupByNp){
  var rows=[["User","Week","Capacity hrs","Tracked hrs","Utilization %","Group"]];
```

and change the row push to:

```js
      rows.push([nameMap[np]||np, iso, capCell, trkCell, utilCell, (groupByNp&&groupByNp[np])||"Delivery"]);
```

Update the function's doc comment: add a line `// groupByNp: np → "Delivery"|"Manager"|"Non-tracking" — appended as the last column; missing entries default to Delivery.`

- [ ] **Step 4: Wire the caller** — in `downloadUtilCsv_`, build the group map from the population split and pass it through. Replace the `var rows=...` line with:

```js
  var split=utilSplitPopulation_(npList, DATA.personMeta||{}, UTIL_TRACKING_FAMILIES);
  var groupByNp={};
  split.delivery.forEach(function(np){ groupByNp[np]='Delivery'; });
  split.managers.forEach(function(np){ groupByNp[np]='Manager'; });
  split.nonTracking.forEach(function(np){ groupByNp[np]='Non-tracking'; });
  // CSV is the audit artifact: ALWAYS the full population (all three groups),
  // regardless of the panel's chip state. People filters still apply via npList.
  var rows=buildUtilCsvRows_(capIsos, DATA.personWeekCapacity||{}, DATA.personWeekTracked||{}, nameMap, npList, fut, groupByNp);
```

- [ ] **Step 5: Run tests to verify pass** — `node node-tests.js` → all suites pass.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "feat(utilization): Group column in person-week CSV export"
```

---

### Task 7: Panel HTML, CSS, and population state

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` — panel markup (~lines 553–565), CSS block (near `.sowhat` / `.cap-legend` styles), state vars near `UTIL_WT` (~line 1382)

No node-testable logic here; verify by loading the page (Step 4).

- [ ] **Step 1: Update the panel markup.** Replace the current `#utilPanel` block with:

```html
    <!-- 1c. Utilization — decision-grade: tracking-required population, coverage × fidelity, control band -->
    <div class="panel" id="utilPanel" data-view="overview">
      <div class="panel-head">
        <h2>Utilization — Delivery</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="hint">Tracked ÷ Tempo schedule capacity for tracking-required roles (delivery job families) · Coverage = planned ÷ capacity, Fidelity = tracked ÷ planned · shaded band = normal week-to-week variation · hollow points = still settling / projected · % counts only people with capacity data that week · billing chips do not apply · reflects People filters above</div>
          <button class="uchip" id="utilChipNt" onclick="utilToggleNt_()" title="Add people whose job family has planned capacity but no tracking mandate — off by default so a scope decision doesn't read as a performance problem">＋ non-tracking roles</button>
          <button class="uchip" id="utilChipMgr" onclick="utilToggleMgr_()" title="Add managers — they legitimately log little delivery time, so they're excluded from the default denominator">＋ managers</button>
          <button class="btn" id="utilCsvBtn" style="font-size:11px;padding:5px 10px" title="Person × week capacity report — full range and FULL population (Delivery + Manager + Non-tracking, with a Group column), regardless of the chips; respects the People filters">⇣ CSV</button>
          <button class="png-btn" data-png="utilization">⬇ Save PNG</button>
        </div>
      </div>
      <div class="util-head" id="utilHead"></div>
      <div id="utilChart"></div>
      <div class="cap-legend" id="utilLegend"></div>
      <div class="sowhat" id="utilSoWhat"></div>
      <div class="util-drill" id="utilDrill"></div>
    </div>
```

- [ ] **Step 2: Add CSS** — in the `<style>` block, after the `.sowhat` rules (search `.sowhat`):

```css
/* Utilization panel: population chips, identity header, contribution drill */
.uchip{border:1px solid var(--border);border-radius:12px;background:transparent;color:var(--muted);
  font-size:calc(11px*var(--scale));padding:4px 10px;cursor:pointer;white-space:nowrap}
.uchip.on{background:var(--void);border-color:var(--void);color:#fff}
[data-theme="dark"] .uchip.on{background:var(--orbe);border-color:var(--orbe)}
.util-head{margin:4px 0 8px}
.util-head .uh-big{font-family:'Roboto Condensed','Franklin Gothic Medium Cond',sans-serif;
  font-size:calc(26px*var(--scale));font-weight:700}
.util-head .uh-big .uh-when{font-size:calc(12px*var(--scale));font-weight:400;color:var(--muted)}
.util-head .uh-identity{font-size:calc(13px*var(--scale));margin-top:2px}
.util-head .uh-pop{font-size:calc(11px*var(--scale));color:var(--muted);margin-top:2px}
.util-drill{margin-top:8px;border-top:1px dashed var(--border);padding-top:6px;font-size:calc(12px*var(--scale))}
.util-drill .ud-toggle{cursor:pointer;font-weight:700}
.util-drill .ud-dim{margin-left:10px}
.util-drill .ud-dim button{border:none;background:transparent;color:var(--muted);cursor:pointer;
  font-size:calc(11px*var(--scale));padding:2px 6px;border-radius:6px}
.util-drill .ud-dim button.on{background:var(--surface-2);color:var(--text);font-weight:700}
.util-drill .ud-rows{margin-top:6px}
.util-drill .ud-row{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:calc(11px*var(--scale))}
.util-drill .ud-name{flex:0 0 220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.util-drill .ud-barwrap{flex:1;display:flex;align-items:center}
.util-drill .ud-bar{height:9px;border-radius:4px}
.util-drill .ud-pp{flex:0 0 70px;text-align:right;font-weight:700}
```

- [ ] **Step 3: Add state vars** — replace the line `var UTIL_WT=null, UTIL_CW=null;` (~1382) with:

```js
var UTIL_WT=null, UTIL_CW=null;                 // last-render totals + week list (tooltips)
var UTIL_INC_NT=false, UTIL_INC_MGR=false;      // population chips (panel-local, not persisted)
var UTIL_DRILL_OPEN=false, UTIL_DRILL_DIM='family'; // contribution drill state
var UTIL_EXTRA=null;                            // last-render {stats,proj,provisionalIso,projIso} for tooltips

function utilToggleNt_(){ UTIL_INC_NT=!UTIL_INC_NT; renderUtilization(); }
function utilToggleMgr_(){ UTIL_INC_MGR=!UTIL_INC_MGR; renderUtilization(); }
// Mon..today inclusive as elapsed workdays; Sat/Sun count the week as fully elapsed.
function utilElapsedWorkdays_(){ var d=new Date().getDay(); return (d===0||d===6)?5:d; }
```

- [ ] **Step 4: Verify** — run `node node-tests.js` (must still pass — markup/CSS changes can't break it, this catches accidental UTIL-PURE edits). Then open the deployed dev web app (or paste the HTML body into a browser with a stubbed `DATA` if available) and confirm: panel renders, chips visible (unstyled behavior — they do nothing meaningful until Task 8's render rewrite), no console errors.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html"
git commit -m "feat(utilization): panel markup, chips, drill container + CSS"
```

---

### Task 8: Render rewrite — header, chart with band/target/projection, legend, tooltips

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` — `renderUtilization()`, `renderUtilLegend_()`, `utilChartHover_()`, `renderUtilChart_()` (~lines 1395–1567)

This is the core render change. The chart moves from hours-space to **%-space** (left axis = utilization %): utilization line + control band + target line are the stars; capacity hours remain as a faint background area on their own hidden scale (solid → dashed into future weeks) so future capacity stays visible, and exact hours live in the tooltip.

- [ ] **Step 1: Replace `renderUtilization()`** with:

```js
function renderUtilization(){
  var panel=$('utilPanel'); if(!panel) return;
  if(SOURCE!=='live'){ panel.style.display='none'; return; }   // capacity isn't in the offline CSV
  panel.style.display='';
  var capIsos=(DATA&&DATA.capacityIsoList)||[];
  var csvBtn=$('utilCsvBtn');
  if(!capIsos.length){
    $('utilHead').innerHTML='';
    $('utilChart').innerHTML='';
    $('utilLegend').innerHTML='';
    $('utilDrill').innerHTML='';
    $('utilSoWhat').className='sowhat';
    $('utilSoWhat').innerHTML='<b>Capacity data unavailable</b>'
      +(DATA&&DATA.capacityError?' — '+esc(DATA.capacityError):'')
      +' Run fetchTempoCapacity() in the Tempo export project, then ↻ Refresh.';
    if(csvBtn) csvBtn.style.display='none';
    return;
  }
  if(csvBtn) csvBtn.style.display='';

  // Week range: PvT's QTD window ∪ every capacity week (incl. future) — unchanged.
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

  // Population: People filters first (utilNpList_), then the tracking-required
  // split; chips add the carved-out groups back and disclose their effect.
  var baseList=utilNpList_();
  var split=utilSplitPopulation_(baseList, DATA.personMeta||{}, UTIL_TRACKING_FAMILIES);
  var npList=split.delivery.slice();
  if(UTIL_INC_NT)  npList=npList.concat(split.nonTracking);
  if(UTIL_INC_MGR) npList=npList.concat(split.managers);

  var capMap=DATA.personWeekCapacity||{}, trkMap=DATA.personWeekTracked||{};
  var isos=cw.map(function(w){return w.iso;});
  var ut=utilWeekTotals_(isos, capMap, trkMap, npList);
  UTIL_WT=ut; UTIL_CW=cw;

  // Week states: latest 'done' week is PROVISIONAL (late logging still arriving);
  // older 'done' weeks are SETTLED; the 'now' week is PROJECTED.
  var provisionalIso=null;
  for(var i=cw.length-1;i>=0;i--){ if(cw[i].status==='done'){ provisionalIso=cw[i].iso; break; } }
  var settledIsos=cw.filter(function(w){ return w.status==='done' && w.iso!==provisionalIso; })
                    .map(function(w){ return w.iso; });
  var stats=utilControlStats_(ut.util, settledIsos, UTIL_BAND_WEEKS);
  var proj=null, projIso=null;
  cw.forEach(function(w){
    if(w.status!=='now') return;
    projIso=w.iso;
    proj=utilProjection_(ut.tracked[w.iso]||0, ut.cap[w.iso]||0, utilElapsedWorkdays_(), stats?stats.sigma:null);
  });
  UTIL_EXTRA={stats:stats, proj:proj, provisionalIso:provisionalIso, projIso:projIso};

  // Anchor: the selected week when it has data (labelled if not settled),
  // else the latest settled week — the headline never quotes a live week as final.
  var anchor=null, anchorState='settled';
  if(ut.util[SEL_ISO]!=null && cw.some(function(w){return w.iso===SEL_ISO && w.status!=='plan';})){
    anchor=SEL_ISO;
    anchorState = SEL_ISO===projIso?'projected':(SEL_ISO===provisionalIso?'provisional':'settled');
  } else {
    for(var j=settledIsos.length-1;j>=0;j--){
      if(ut.util[settledIsos[j]]!=null){ anchor=settledIsos[j]; break; }
    }
    if(anchor==null && provisionalIso && ut.util[provisionalIso]!=null){ anchor=provisionalIso; anchorState='provisional'; }
  }

  renderUtilHeader_(anchor, anchorState, npList, capMap, trkMap, split);
  renderUtilChips_(anchor, split, capMap, trkMap);
  renderUtilLegend_(stats!=null, proj!=null);
  renderUtilChart_(ut, cw, stats, proj, provisionalIso);
  renderUtilSoWhat_(anchor, anchorState, ut, stats);
  renderUtilDrill_(anchor, split, settledIsos, capMap, trkMap);
}
```

- [ ] **Step 2: Add `renderUtilHeader_` and `renderUtilChips_`** (new functions, place directly after `renderUtilization`):

```js
// Option B header: big number + the Coverage × Fidelity = Utilization identity
// inline, with the target gap in HOURS (billing is project-level — no $ rate
// exists, so the gap is never dollarised).
function renderUtilHeader_(anchor, anchorState, npList, capMap, trkMap, split){
  var el=$('utilHead'); if(!el) return;
  if(anchor==null){ el.innerHTML=''; return; }
  var id=utilIdentity_(anchor, npList, capMap, trkMap, DATA.personWeekPlan||{}, utilCapHrsMap_(npList));
  var stateLbl = anchorState==='projected' ? ' (in progress — projected)'
               : anchorState==='provisional' ? ' (still settling)' : '';
  var h='<div class="uh-big">'+(id.util!=null?Math.round(id.util)+'%':'—')
    +' <span class="uh-when">utilization · '+esc(anchor)+esc(stateLbl)+'</span></div>';
  var parts=[];
  if(id.coverage!=null && id.fidelity!=null){
    parts.push('Coverage <b>'+Math.round(id.coverage)+'%</b> × Fidelity <b>'+Math.round(id.fidelity)+'%</b> = '+Math.round(id.util)+'%');
  } else if(id.util!=null){
    parts.push('<span class="hint">no plan data this week — coverage × fidelity unavailable</span>');
  }
  if(id.util!=null && anchorState==='settled'){
    if(id.util < UTIL_TARGET){
      var gapHrs=(UTIL_TARGET-id.util)/100*id.cap;
      parts.push('<span style="color:'+hexVar('--warn')+'">'+Math.round(UTIL_TARGET-id.util)
        +' pp below the '+UTIL_TARGET+'% target ≈ <b>'+fmt(gapHrs)+' hrs</b> of capacity</span>');
    } else {
      parts.push('<span style="color:'+hexVar('--pos')+'">meets the '+UTIL_TARGET+'% target</span>');
    }
  }
  h+='<div class="uh-identity">'+parts.join(' · ')+'</div>';
  var extra=[];
  if(!UTIL_INC_NT && split.nonTracking.length) extra.push(split.nonTracking.length+' non-tracking excluded');
  if(!UTIL_INC_MGR && split.managers.length)   extra.push(split.managers.length+' managers excluded');
  h+='<div class="uh-pop">'+npList.length+' tracking-required people'
    +(filteredPersonSet_()?' (filtered)':'')
    +(extra.length?' · '+extra.join(' · '):'')+'</div>';
  el.innerHTML=h;
}

// np → standard week hours, for utilIdentity_'s plan cap (pure fn can't call personWeekCap_).
function utilCapHrsMap_(npList){
  var m={};
  npList.forEach(function(np){ m[np]=personWeekCap_(np); });
  return m;
}

// Chip labels disclose each group's live effect on the anchor week: +N people, ±pp.
function renderUtilChips_(anchor, split, capMap, trkMap){
  function delta(group, on){
    if(anchor==null || !group.length) return '';
    // Effect of the group = util(current population) − util(current population minus/plus group)
    var withList, withoutList;
    var base=split.delivery.slice();
    if(UTIL_INC_NT && group!==split.nonTracking)   base=base.concat(split.nonTracking);
    if(UTIL_INC_MGR && group!==split.managers)     base=base.concat(split.managers);
    withoutList=base; withList=base.concat(group);
    var uw=utilWeekTotals_([anchor], capMap, trkMap, withList).util[anchor];
    var uo=utilWeekTotals_([anchor], capMap, trkMap, withoutList).util[anchor];
    if(uw==null || uo==null) return ' (+'+group.length+' people)';
    var pp=uw-uo;
    return ' (+'+group.length+' people, '+(pp>=0?'+':'')+Math.round(pp*10)/10+' pp)';
  }
  var nt=$('utilChipNt'), mg=$('utilChipMgr');
  if(nt){
    nt.className='uchip'+(UTIL_INC_NT?' on':'');
    nt.textContent=(UTIL_INC_NT?'− ':'＋ ')+'non-tracking roles'+(UTIL_INC_NT?delta(split.nonTracking,true):'');
    nt.style.display=split.nonTracking.length?'':'none';
  }
  if(mg){
    mg.className='uchip'+(UTIL_INC_MGR?' on':'');
    mg.textContent=(UTIL_INC_MGR?'− ':'＋ ')+'managers'+(UTIL_INC_MGR?delta(split.managers,true):'');
    mg.style.display=split.managers.length?'':'none';
  }
}
```

- [ ] **Step 3: Replace `renderUtilLegend_` and add `renderUtilSoWhat_`; extend `utilChartHover_`:**

```js
function renderUtilLegend_(hasBand, hasProj){
  var el=$('utilLegend'); if(!el) return;
  var h='<span><i style="background:'+hexVar('--void')+'"></i>Utilization %</span>';
  if(hasBand) h+='<span><i style="background:'+hexVar('--orbe')+';opacity:.25"></i>Normal range (±2σ)</span>';
  h+='<span><i style="background:'+hexVar('--pos')+'"></i>Target '+UTIL_TARGET+'%</span>'
    +'<span><i style="border:2px solid '+hexVar('--amber')+';background:transparent;border-radius:50%"></i>Still settling</span>';
  if(hasProj) h+='<span><i class="dashed"></i>Projected (current week)</span>';
  h+='<span><i style="background:'+hexVar('--slate')+';opacity:.35"></i>Capacity backdrop (hrs)</span>';
  el.innerHTML=h;
}

// Signal-vs-noise verdict line. Counts only, never names.
function renderUtilSoWhat_(anchor, anchorState, ut, stats){
  var el=$('utilSoWhat'); if(!el) return;
  var sw, cls='';
  if(anchor==null){
    sw='<b>No completed week has both capacity and tracked data yet.</b> Future capacity is charted (dashed) as it loads from the Friday export.';
  } else {
    var u=ut.util[anchor], uPct=Math.round(u);
    var inBand = stats && u>=stats.lo && u<=stats.hi;
    cls = u<UTIL_TARGET-10?'warn':(u>=UTIL_TARGET?'ok':'');
    sw='<b>'+esc(anchor)+' at '+uPct+'%</b> — '+fmt(ut.tracked[anchor])+' hrs tracked against '
      +fmt(ut.cap[anchor])+' hrs of scheduled capacity across '+ut.covered[anchor]+' people.';
    if(stats){
      sw+=inBand
        ? ' <span class="hint">Inside the normal band ('+Math.round(stats.lo)+'–'+Math.round(stats.hi)+'%) — normal variation, not a signal.</span>'
        : ' <b>Outside the normal band ('+Math.round(stats.lo)+'–'+Math.round(stats.hi)+'%)</b> — expand "Why did this week move?" below.';
    }
    if(ut.trackedOnly[anchor]>0){
      sw+=' <span class="hint">'+ut.trackedOnly[anchor]+' tracked '
        +(ut.trackedOnly[anchor]===1?'person has':'people have')+' no capacity data this week — excluded from the %.</span>';
    }
    if(anchorState!=='settled') sw+=' <span class="hint">'
      +(anchorState==='projected'?'Week in progress — value is a projection.':'Late logging may still move this week.')+'</span>';
  }
  el.className='sowhat '+cls;
  el.innerHTML=sw;
}
```

In `utilChartHover_`, after the `var utxt=...` line, replace the current-week text using `UTIL_EXTRA`:

```js
  var ex=UTIL_EXTRA||{};
  if(u!=null && iso===ex.projIso && ex.proj){
    utxt='projected '+Math.round(ex.proj.pct)+'%'
      +(ex.proj.lo!=null?' ('+Math.round(ex.proj.lo)+'–'+Math.round(ex.proj.hi)+'%)':'')
      +' · '+Math.round(u)+'% logged so far';
  } else if(u!=null && iso===ex.provisionalIso){
    utxt=Math.round(u)+'% utilization (still settling)';
  }
```

(Keep the rest of the tooltip body — hours, coverage, holidays — unchanged.)

- [ ] **Step 4: Replace `renderUtilChart_`** with the %-space chart:

```js
function renderUtilChart_(ut, cw, stats, proj, provisionalIso){
  var n=cw.length;
  var w=620,h=190,pad={l:44,r:14,t:20,b:24},iw=w-pad.l-pad.r,ih=h-pad.t-pad.b;
  // % scale (left axis). Cap the domain so one outlier week can't flatten the chart.
  var maxPct=Math.max(100, UTIL_TARGET+10, stats?stats.hi+5:0, proj&&proj.hi!=null?proj.hi+5:0);
  cw.forEach(function(wk){ var u=ut.util[wk.iso]; if(u!=null) maxPct=Math.max(maxPct,Math.min(u,160)+5); });
  var x=function(i){return pad.l+(n===1?0:i/(n-1)*iw);};
  var yp=function(v){return pad.t+ih-Math.min(Math.max(v,0),maxPct)/maxPct*ih;};
  var curIdx=-1; cw.forEach(function(wk,i){ if(wk.status==='now') curIdx=i; });
  var g='<svg viewBox="0 0 '+w+' '+h+'" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="utilization % per week with control band, target and current-week projection">';

  // future tint
  var firstPlan=-1; cw.forEach(function(wk,i){if(firstPlan<0&&wk.status==='plan')firstPlan=i;});
  if(firstPlan>=0){var x0=x(Math.max(0,firstPlan-0.5));g+='<rect x="'+x0+'" y="'+pad.t+'" width="'+(w-pad.r-x0)+'" height="'+ih+'" fill="'+hexVar('--slate')+'" opacity="0.05"/>';}

  // capacity backdrop (hrs, own hidden scale): context + future-capacity visibility.
  var capMax=1; cw.forEach(function(wk){ capMax=Math.max(capMax, ut.cap[wk.iso]||0); });
  var yc=function(v){return pad.t+ih-Math.min(v,capMax)/capMax*ih*0.9;};
  var capPts=[];
  cw.forEach(function(wk,i){
    var hasCapData=ut.util[wk.iso]!=null||((ut.cap[wk.iso]||0)>0)||((ut.covered[wk.iso]||0)>0);
    if(hasCapData) capPts.push({x:x(i),y:yc(ut.cap[wk.iso]||0),wk:wk});
  });
  if(capPts.length>1){
    var aPts=capPts.map(function(p){return p.x+','+p.y;});
    g+='<path d="M'+capPts[0].x+','+(pad.t+ih)+' L'+aPts.join(' L')+' L'+capPts[capPts.length-1].x+','+(pad.t+ih)+' Z" fill="'+hexVar('--slate')+'" opacity="0.08"/>';
    for(var ci=1;ci<capPts.length;ci++){
      var dash=capPts[ci].wk.status==='plan'?' stroke-dasharray="4 3"':'';
      g+='<line x1="'+capPts[ci-1].x+'" y1="'+capPts[ci-1].y+'" x2="'+capPts[ci].x+'" y2="'+capPts[ci].y+'" stroke="'+hexVar('--slate')+'" stroke-width="1.6" opacity="0.4"'+dash+'/>';
    }
  }

  // control band + mean (under the line)
  if(stats){
    g+='<rect x="'+pad.l+'" y="'+yp(stats.hi)+'" width="'+iw+'" height="'+(yp(stats.lo)-yp(stats.hi))+'" fill="'+hexVar('--orbe')+'" opacity="0.10"/>';
    g+='<line x1="'+pad.l+'" y1="'+yp(stats.mean)+'" x2="'+(w-pad.r)+'" y2="'+yp(stats.mean)+'" stroke="'+hexVar('--orbe')+'" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>';
  }
  // target line
  g+='<line x1="'+pad.l+'" y1="'+yp(UTIL_TARGET)+'" x2="'+(w-pad.r)+'" y2="'+yp(UTIL_TARGET)+'" stroke="'+hexVar('--pos')+'" stroke-width="1.5" stroke-dasharray="6 4"/>';
  g+='<text x="'+(w-pad.r)+'" y="'+(yp(UTIL_TARGET)-4)+'" text-anchor="end" font-size="9" fill="'+hexVar('--pos')+'" font-weight="700">Target '+UTIL_TARGET+'%</text>';

  // % gridlines + axis
  [0,50,100].forEach(function(v){
    if(v>maxPct) return;
    g+='<line x1="'+pad.l+'" y1="'+yp(v)+'" x2="'+(w-pad.r)+'" y2="'+yp(v)+'" stroke="'+css('--border')+'" stroke-width="1" opacity=".5"/>';
    g+='<text x="'+(pad.l-6)+'" y="'+(yp(v)+3)+'" text-anchor="end" font-size="9" fill="'+css('--muted')+'">'+v+'%</text>';
  });

  // utilization line: settled solid → provisional dashed inbound → projection dashed gray.
  var uPts=[];
  cw.forEach(function(wk,i){
    if(wk.status==='plan') return;
    var u=ut.util[wk.iso]; if(u==null) return;
    var state = wk.status==='now'?'proj':(wk.iso===provisionalIso?'prov':'settled');
    // the 'now' point plots the PROJECTED value when available, else logged-so-far
    var v=(state==='proj'&&proj)?proj.pct:u;
    uPts.push({i:i,x:x(i),y:yp(v),v:v,state:state,iso:wk.iso});
  });
  for(var ui=1;ui<uPts.length;ui++){
    var a=uPts[ui-1],b=uPts[ui];
    var seg = b.state==='proj' ? ' stroke="'+hexVar('--slate')+'" stroke-dasharray="3 4"'
            : b.state==='prov' ? ' stroke="'+hexVar('--void')+'" stroke-dasharray="4 3"'
            : ' stroke="'+hexVar('--void')+'"';
    g+='<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"'+seg+' stroke-width="2.4"/>';
  }
  // projection range whisker (before the points so points sit on top)
  if(proj && proj.lo!=null && curIdx>=0){
    var px=x(curIdx);
    g+='<line x1="'+px+'" y1="'+yp(proj.hi)+'" x2="'+px+'" y2="'+yp(proj.lo)+'" stroke="'+hexVar('--slate')+'" stroke-width="1"/>'
      +'<line x1="'+(px-5)+'" y1="'+yp(proj.hi)+'" x2="'+(px+5)+'" y2="'+yp(proj.hi)+'" stroke="'+hexVar('--slate')+'" stroke-width="1"/>'
      +'<line x1="'+(px-5)+'" y1="'+yp(proj.lo)+'" x2="'+(px+5)+'" y2="'+yp(proj.lo)+'" stroke="'+hexVar('--slate')+'" stroke-width="1"/>';
  }
  uPts.forEach(function(p){
    if(p.state==='settled'){
      g+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3" fill="'+hexVar('--void')+'"/>';
    } else if(p.state==='prov'){
      g+='<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="'+hexVar('--surface')+'" stroke="'+hexVar('--amber')+'" stroke-width="2"/>';
    } else {
      g+='<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="'+hexVar('--surface')+'" stroke="'+hexVar('--slate')+'" stroke-width="2"/>';
    }
  });
  // % labels: settled weeks plain; provisional and projected annotated
  uPts.forEach(function(p){
    var lbl=Math.round(p.v)+'%';
    if(p.state==='prov') lbl+='˜';
    if(p.state==='proj') lbl+='*';
    g+='<text x="'+p.x+'" y="'+(p.y-8)+'" text-anchor="middle" font-size="8" fill="'+(p.state==='settled'?hexVar('--void'):css('--muted'))+'" font-weight="700">'+lbl+'</text>';
  });

  // hit-columns + thinned week labels (same interaction as before)
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
```

Also DELETE the now-unused `utilColor_` function (its red/green thresholds belong to the old hours chart; the so-what line owns color now). Search the file for other `utilColor_` callers first — there are none outside the old chart/labels.

- [ ] **Step 5: Verify** — `node node-tests.js` still passes (render code is outside UTIL-PURE). Deploy to the dev GAS project (or run the local preview flow used for this dashboard) and check: band + target + % line render; current week shows hollow gray point with whisker and `*` label; latest completed week hollow amber with `˜`; chips toggle and re-render with deltas; tooltips show projected range; dark theme legible; PNG export captures the new chart.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html"
git commit -m "feat(utilization): %-space chart with control band, target, projection + identity header"
```

---

### Task 9: "Why did this week move?" contribution drill

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` — new `renderUtilDrill_` after `renderUtilSoWhat_`

- [ ] **Step 1: Implement `renderUtilDrill_`** (called from `renderUtilization` — already wired in Task 8):

```js
// Contribution drill: decomposes the anchor week's move vs the prior settled week
// into signed per-group bars. GROUPS AND COUNTS ONLY — never individual names
// (standing rule); person detail lives in the CSV. Dimension: family (default),
// manager, or location. Uses the ACTIVE population (chips included) so the bars
// always explain the number the header is showing.
function renderUtilDrill_(anchor, split, settledIsos, capMap, trkMap){
  var el=$('utilDrill'); if(!el) return;
  // Need a settled anchor and a prior settled week to compare against.
  var prev=null;
  if(anchor!=null){
    for(var i=settledIsos.length-1;i>=0;i--){
      if(isoOrd(settledIsos[i])<isoOrd(anchor)){ prev=settledIsos[i]; break; }
    }
  }
  if(anchor==null || prev==null){ el.innerHTML=''; return; }

  var head='<span class="ud-toggle" onclick="UTIL_DRILL_OPEN=!UTIL_DRILL_OPEN;renderUtilization()">'
    +(UTIL_DRILL_OPEN?'▾':'▸')+' Why did '+esc(anchor)+' move vs '+esc(prev)+'?</span>';
  if(!UTIL_DRILL_OPEN){ el.innerHTML=head; return; }

  head+='<span class="ud-dim">'
    +['family','manager','location'].map(function(d){
      return '<button class="'+(UTIL_DRILL_DIM===d?'on':'')+'" onclick="UTIL_DRILL_DIM=\''+d+'\';renderUtilization()">'
        +(d==='family'?'Job family':d==='manager'?'Manager':'Location')+'</button>';
    }).join('')+'</span>';

  // Group the ACTIVE population by the chosen dimension.
  var npList=split.delivery.slice();
  if(UTIL_INC_NT)  npList=npList.concat(split.nonTracking);
  if(UTIL_INC_MGR) npList=npList.concat(split.managers);
  var meta=DATA.personMeta||{};
  var groups={};
  npList.forEach(function(np){
    var m=meta[np]||{};
    var k = UTIL_DRILL_DIM==='family'  ? (m.jobFamily||'(no roster match)')
          : UTIL_DRILL_DIM==='manager' ? (m.manager||'(no manager)')
          :                              (m.location||'(no location)');
    (groups[k]=groups[k]||[]).push(np);
  });

  var d=utilDecompose_(anchor, prev, groups, capMap, trkMap);
  if(!d){ el.innerHTML=head+'<div class="hint" style="margin-top:6px">Not enough capacity data on both weeks to decompose.</div>'; return; }
  var maxAbs=0.001;
  d.forEach(function(g){ maxAbs=Math.max(maxAbs, Math.abs(g.pp)); });
  var rows=d.filter(function(g){ return Math.abs(g.pp)>=0.05; }).map(function(g){
    var wpx=Math.max(2, Math.abs(g.pp)/maxAbs*160);
    var col=g.pp>=0?hexVar('--pos'):hexVar('--warn');
    return '<div class="ud-row"><span class="ud-name" title="'+esc(g.key)+' — '+groups[g.key].length+' people">'
      +esc(g.key)+' <span class="hint">('+groups[g.key].length+')</span></span>'
      +'<span class="ud-barwrap"><span class="ud-bar" style="width:'+wpx+'px;background:'+col+'"></span></span>'
      +'<span class="ud-pp" style="color:'+col+'">'+(g.pp>=0?'+':'')+Math.round(g.pp*10)/10+' pp</span></div>';
  });
  var total=0; d.forEach(function(g){ total+=g.pp; });
  el.innerHTML=head
    +'<div class="ud-rows">'+(rows.length?rows.join(''):'<div class="hint">No group moved more than 0.1 pp.</div>')+'</div>'
    +'<div class="hint" style="margin-top:4px">Bars sum to the total move: '+(total>=0?'+':'')+Math.round(total*10)/10+' pp. Groups only — person detail is in the CSV.</div>';
}
```

- [ ] **Step 2: Verify** — `node node-tests.js` passes; in the live/dev dashboard: drill header appears under the so-what line, expands with signed bars, dimension switcher works, bar total matches the header's week-over-week change (cross-check against two hover tooltips), collapses cleanly, no names anywhere in the drill.

- [ ] **Step 3: Commit**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html"
git commit -m "feat(utilization): week-over-week contribution drill (family/manager/location)"
```

---

### Task 10: Full-suite run, manual QA sweep, wrap-up

**Files:** none new — verification only.

- [ ] **Step 1: Run the full test suite** — `cd docs/superpowers/project-demand-dashboard && node node-tests.js` → `✅ node-tests: all suites passed` including the five new/extended util suites.

- [ ] **Step 2: Manual QA checklist** (dev GAS deployment or local preview):
  - Default load: headline anchors the latest SETTLED week; chips OFF; population line shows exclusion counts.
  - Toggle each chip on/off: header %, band, chart, and drill all move together; chip shows `(+N people, ±X pp)`; toggling back restores exactly.
  - People filters (location/family/manager/role) still narrow the panel; `(filtered)` appears in the population line.
  - Select the current week in the filter bar: header labels it "(in progress — projected)".
  - CSV: downloads with `Group` as the last column; contents identical with chips on and off.
  - Fewer than 4 settled weeks (simulate by narrowing filters to a person with little history): band absent, legend omits "Normal range", projection point drawn without whisker.
  - `capacityError` path (temporarily blank `capacityIsoList` in a debugger): recovery message intact, no console errors.
  - Dark theme + PNG export.

- [ ] **Step 3: Update memory/project notes** — record CODE COMPLETE status and the deploy requirement (Dashboard.html only, **no** Code.js deploy, **no** `bustDemandCache_` needed) in the project memory file per the user's memory conventions.

- [ ] **Step 4: Final commit (if QA produced fixes)**

```bash
git add "docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/project-demand-dashboard/node-tests.js"
git commit -m "fix(utilization): QA polish on decision-grade utilization panel"
```

---

## Deployment note (owner action, after all tasks)

Copy the updated `Dashboard.html` into the demand-dashboard GAS project and create a new deployment version. No `Code.js` change, no cache bump — the panel recomputes entirely client-side from fields the server already ships.
