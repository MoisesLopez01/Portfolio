# Demand Dashboard — Public Holiday Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weeks with public holidays get an honest capacity denominator (per-person shortfall deduction, de-duped against booked NETSUITE time-off) and visible 🏖 badges/tooltips so managers read planned/tracked dips as holidays, not demand drops.

**Architecture:** Backend (`Code.js`): read the `PH` tab from the same source spreadsheet, join to roster `Key Location` for capacity-counted people only, compute per-week `holidaysByWeek` + `holidayShortfallByWeek`, and subtract the shortfall in `attachCapacity_`. Frontend (`Dashboard.html`): 🏖 markers on the Planned-vs-Tracked chart weeks, holiday lines in the hover tooltip and so-what, 🏖 chips on heatmap week headers. All pure logic is unit-tested via `_test_holidayCapacity_` (GAS editor + `node node-tests.js`).

**Tech Stack:** Google Apps Script (ES5-style JS), vanilla-JS single-file HTML client, Node for local tests (`eval`s Code.js with stubs).

**Spec:** `docs/superpowers/specs/2026-07-10-demand-holiday-signals-design.md`

**Context for the implementer (read first):**
- The demand dashboard lives in `docs/superpowers/project-demand-dashboard/` — `Code.js` (server), `Dashboard.html` (client), `node-tests.js` (local test runner). It is a **standalone** GAS project; code from the PS report is *copied*, never imported.
- `CONFIG.SOURCE_SS_ID` is the contribution dataset spreadsheet — it already contains the `PH` tab (`Date | Location | Holiday`), maintained for the PS report. No new access needed.
- `parseAllocations_` returns `ptoRecs` = per-person NETSUITE time-off records `{person, iso, key, name, hours}`. `buildDemandModel_` scopes them to Services as `scopedPtoRecs`.
- `readRosterFull_().profiles` is keyed by normalized name (`lowercase`, collapsed spaces) with `{location, jobFamily, manager, department, isManager, isCrew}`.
- The client does **not** currently render `capByWeek` — the headline panel is Planned-vs-Tracked fidelity. The capacity fix is still made in the model (spec §Capacity math); the visible signal work is badges/tooltips/so-what.
- Week objects from `buildWindow_()` are `{iso:"2026.W38", wk:38, year:2026, status}` — **no dates**, hence the new `isoWeekBounds_` helper.
- All tests follow the local pattern: a `_test_x_()` function in `Code.js` with an inner `assert_`, `Logger.log("✅ … passed")` on success, plus a call line in `node-tests.js`.
- Commit style: `feat(demand-dash): …` / `test(demand-dash): …` / `docs(demand-dash): …`. **Never push** — this repo stays local.

---

### Task 1: CONFIG keys + `isoWeekBounds_` + `phLocMatchesEmp_` (with failing test)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js` (CONFIG block ~line 12-47; ISO helpers section ~line 66; tests section at end ~line 1560+)
- Modify: `docs/superpowers/project-demand-dashboard/node-tests.js` (test call list, ~line 46)

- [ ] **Step 1: Write the failing test**

Append to the tests section at the bottom of `Code.js` (after `_test_familyFromTitle_` / the last existing test):

```js
/**
 * Public-holiday capacity signals — matcher, week bounds, weekly rollup,
 * NETSUITE shortfall de-dup, ANZ 7.6h day, capacity-population scoping,
 * and the attachCapacity_ deduction. Pure — runs in GAS editor and Node.
 */
function _test_holidayCapacity_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_holidayCapacity_: " + msg); }

  // ── isoWeekBounds_: 2026.W38 = Mon 2026-09-14 → Sun 2026-09-20 ──
  var b = isoWeekBounds_(2026, 38);
  assert_(b.monday === "2026-09-14", "W38 monday should be 2026-09-14, got " + b.monday);
  assert_(b.sunday === "2026-09-20", "W38 sunday should be 2026-09-20, got " + b.sunday);
  // Year boundary: 2026.W1 starts Mon 2025-12-29
  var b1 = isoWeekBounds_(2026, 1);
  assert_(b1.monday === "2025-12-29", "W1 monday should be 2025-12-29, got " + b1.monday);

  // ── phLocMatchesEmp_: exact, compound, and negative ──
  assert_(phLocMatchesEmp_("Chile", "Chile"), "exact location should match");
  assert_(phLocMatchesEmp_("Australia & New Zealand", "New Zealand"), "compound & should match a part");
  assert_(phLocMatchesEmp_("Malaysia and Singapore", "Singapore"), "'and' compound should match");
  assert_(!phLocMatchesEmp_("Chile", "Peru"), "different location must not match");
  assert_(!phLocMatchesEmp_("Chile", ""), "blank employee location must not match");
  assert_(!phLocMatchesEmp_("Chile", "Unknown"), "'Unknown' employee location must not match");

  Logger.log("✅ _test_holidayCapacity_ passed");
}
```

- [ ] **Step 2: Add the test to the Node runner and verify it fails**

In `node-tests.js`, after the `_test_familyFromTitle_();` line, add:

```js
_test_holidayCapacity_();
```

Run:
```bash
cd "D:\Contribution\docs\superpowers\project-demand-dashboard" && node node-tests.js
```
Expected: FAIL with `ReferenceError: isoWeekBounds_ is not defined` (after the earlier suites print ✅).

- [ ] **Step 3: Implement CONFIG keys and the two helpers**

In `Code.js`, add three keys to `CONFIG` directly under the `ANZ_CAPACITY_HRS` line (~line 21):

```js
  // ── Public holidays (PH tab in SOURCE_SS_ID; feeds week badges + capacity shortfall) ──
  PH_SHEET:                "PH",   // Date | Location | Holiday — same tab the PS report reads
  HOLIDAY_HRS_PER_DAY:     8,      // one holiday day removes 8h of capacity (default region)
  ANZ_HOLIDAY_HRS_PER_DAY: 7.6,    // 38-hr week ÷ 5 — consistent with ANZ_CAPACITY_HRS
```

In the ISO week helpers section (directly after `priorWeekIso_`, ~line 115), add:

```js
/**
 * Monday/Sunday date strings (yyyy-MM-dd, UTC) for an ISO year+week — buildWindow_
 * weeks carry no dates, and PH rows are matched to weeks by date range.
 * @param {number} year ISO week-year   @param {number} wk ISO week number
 * @returns {{monday:string, sunday:string}}
 */
function isoWeekBounds_(year, wk) {
  var jan4 = new Date(Date.UTC(year, 0, 4));               // Jan 4 is always in ISO W1
  var mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (wk - 1) * 7);
  var sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  var f = function (d) { return d.toISOString().slice(0, 10); };
  return { monday: f(mon), sunday: f(sun) };
}

/**
 * Fuzzy PH-location → roster Key Location matcher (ported verbatim from the PS
 * report's phLocMatchesEmp_): compound PH locations split on "&" / "and" / "/",
 * case-insensitive substring match either direction. Blank/Unknown never matches.
 * @param {string} phLoc  PH tab Location cell   @param {string} empLoc roster Key Location
 * @returns {boolean}
 */
function phLocMatchesEmp_(phLoc, empLoc) {
  var emp = (empLoc || "").toLowerCase().trim();
  if (!emp || emp === "unknown") return false;
  var parts = String(phLoc).split(/\s*[&\/]\s*|\s+and\s+/i)
                           .map(function (s) { return s.toLowerCase().trim(); })
                           .filter(Boolean);
  return parts.some(function (p) { return p === emp || p.indexOf(emp) !== -1 || emp.indexOf(p) !== -1; });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node node-tests.js
```
Expected: all suites ✅ including `✅ _test_holidayCapacity_ passed`, then `✅ node-tests: all suites passed`.

- [ ] **Step 5: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/Code.js" "docs/superpowers/project-demand-dashboard/node-tests.js" && git commit -m "feat(demand-dash): PH config keys, isoWeekBounds_, phLocMatchesEmp_ matcher"
```

---

### Task 2: `countsForCapacity` flag on roster profiles

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js` — `readRosterFull_()` (~lines 624-663)

The capacity loop currently `continue`s past non-capacity rows *after* the profile is written. Restructure so a boolean is computed once and stamped on the profile — the holiday affected-count and shortfall must use exactly the capacity population (spec §readRosterFull_ change).

- [ ] **Step 1: Restructure the row loop**

In `readRosterFull_()`, replace the block from `profiles[norm(name)] = { location: loc, ...` down to the end of the loop body (`count++;` `}`) — currently:

```js
      profiles[norm(name)] = { location: loc, jobFamily: fam, manager: mgr, department: dept, isManager: !!(lvlM && lvlM[1].charAt(0) === 'M'), isCrew: isCrew };
      // Filter dropdown option lists (Location / Job Family / Manager) are scoped to
      // Department = ROSTER_DEPT too, same as the person-level data — otherwise a
      // Sales/Finance-only location or manager would show up as a pickable filter value
      // even though selecting it can never match anyone in the dashboard.
      if (dept === CONFIG.ROSTER_DEPT) {
        if (loc) locs[loc] = true;
        if (fam) families[fam] = true;
        if (mgr) managers[mgr] = true;
      }

      // Capacity: only active Services members
      if (iClass !== -1 && String(row[iClass] || "").trim() !== CONFIG.ROSTER_CLASS) continue;
      if (dept && dept !== CONFIG.ROSTER_DEPT) continue;
      var status = iStatus !== -1 ? String(row[iStatus] || "").trim() : "";
      var term   = iTerm   !== -1 ? String(row[iTerm]   || "").trim() : "";
      if (INACTIVE.test(status) || term) continue;

      var isANZ = loc.toLowerCase() === anzLoc;
      base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
      if (isANZ) anz++;
      count++;
```

with:

```js
      // Capacity predicate: only active Services members (same filter as before,
      // computed as a flag so holiday signals can scope to the SAME population
      // as the capacity denominator — see buildHolidaysByWeek_).
      var status = iStatus !== -1 ? String(row[iStatus] || "").trim() : "";
      var term   = iTerm   !== -1 ? String(row[iTerm]   || "").trim() : "";
      var countsForCapacity =
        (iClass === -1 || String(row[iClass] || "").trim() === CONFIG.ROSTER_CLASS) &&
        (!dept || dept === CONFIG.ROSTER_DEPT) &&
        !INACTIVE.test(status) && !term;

      profiles[norm(name)] = { location: loc, jobFamily: fam, manager: mgr, department: dept, isManager: !!(lvlM && lvlM[1].charAt(0) === 'M'), isCrew: isCrew, countsForCapacity: countsForCapacity };
      // Filter dropdown option lists (Location / Job Family / Manager) are scoped to
      // Department = ROSTER_DEPT too, same as the person-level data — otherwise a
      // Sales/Finance-only location or manager would show up as a pickable filter value
      // even though selecting it can never match anyone in the dashboard.
      if (dept === CONFIG.ROSTER_DEPT) {
        if (loc) locs[loc] = true;
        if (fam) families[fam] = true;
        if (mgr) managers[mgr] = true;
      }

      if (!countsForCapacity) continue;
      var isANZ = loc.toLowerCase() === anzLoc;
      base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
      if (isANZ) anz++;
      count++;
```

(Behavior is identical for headcount/base — the predicate is the same three checks, now evaluated before the early-exit instead of via `continue`s.)

- [ ] **Step 2: Run the full suite to verify nothing regressed**

```bash
node node-tests.js
```
Expected: all suites ✅ (in particular `_test_headcount_`, `_test_buildPersonAvailability_`, `_test_scopeRecsToServices_`).

- [ ] **Step 3: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/Code.js" && git commit -m "feat(demand-dash): countsForCapacity flag on roster profiles"
```

---

### Task 3: `buildHolidaysByWeek_` + `netsuiteByPersonWeek_` (TDD)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js` — new helpers in a `── PUBLIC HOLIDAYS ──` section placed directly before the `── TRACKED TIME + DELIVERY SIGNALS ──` section (~line 712); extend `_test_holidayCapacity_`

- [ ] **Step 1: Extend the failing test**

Inside `_test_holidayCapacity_`, before the final `Logger.log`, append:

```js
  // ── buildHolidaysByWeek_: rollup, shortfall de-dup, ANZ day, population scoping ──
  var weeks = [
    { iso: "2026.W38", wk: 38, year: 2026, status: "plan" },
    { iso: "2026.W39", wk: 39, year: 2026, status: "plan" },
  ];
  var phData = [
    { date: "2026-09-17", location: "Chile", holiday: "Fiestas Patrias" },   // Thu, W38
    { date: "2026-09-18", location: "Chile", holiday: "Fiestas Patrias" },   // Fri, W38 (2-day holiday)
    { date: "2026-09-14", location: "Australia & New Zealand", holiday: "King's Birthday" }, // Mon, W38
    { date: "2026-01-01", location: "Chile", holiday: "New Year" },          // outside window → ignored
  ];
  var rosterFull = {
    ok: true,
    profiles: {
      "ana chile":  { location: "Chile", department: "Services", countsForCapacity: true },  // books nothing → 16h shortfall
      "ben chile":  { location: "Chile", department: "Services", countsForCapacity: true },  // booked 16h → 0 shortfall
      "cara chile": { location: "Chile", department: "Services", countsForCapacity: true },  // booked 8h → 8h shortfall
      "dana anz":   { location: "Australia & New Zealand", department: "Services", countsForCapacity: true }, // 1 ANZ day → 7.6h
      "eve chile":  { location: "Chile", department: "Sales",    countsForCapacity: false }, // not capacity → excluded
      "fay us":     { location: "United States", department: "Services", countsForCapacity: true }, // no matching holiday
    },
  };
  var netsuite = {
    "ben chile":  { "2026.W38": 16 },
    "cara chile": { "2026.W38": 8 },
  };
  var hol = buildHolidaysByWeek_(phData, weeks, rosterFull, netsuite);

  var w38 = hol.byWeek["2026.W38"];
  assert_(!!w38, "W38 should carry holiday data");
  assert_(w38.entries.length === 2, "W38 should have 2 grouped entries (Chile 2-day + ANZ 1-day), got " + w38.entries.length);
  var chile = w38.entries.filter(function (e) { return e.location === "Chile"; })[0];
  assert_(chile.days === 2, "Fiestas Patrias should group to 2 days, got " + chile.days);
  assert_(chile.affectedCount === 3, "3 capacity-counted Chile people (eve excluded), got " + chile.affectedCount);
  var anzE = w38.entries.filter(function (e) { return e.location !== "Chile"; })[0];
  assert_(anzE.affectedCount === 1, "1 ANZ person affected, got " + anzE.affectedCount);
  assert_(w38.totalAffected === 4, "4 distinct people affected in W38, got " + w38.totalAffected);
  // shortfall: ana 16 + ben max(0,16−16)=0 + cara max(0,16−8)=8 + dana 7.6 = 31.6
  assert_(Math.abs(hol.shortfallByWeek["2026.W38"] - 31.6) < 0.001,
          "W38 shortfall should be 31.6h, got " + hol.shortfallByWeek["2026.W38"]);
  assert_(!hol.byWeek["2026.W39"], "W39 has no holidays — key must be absent");

  // ── Roster fallback mode: badges without counts, zero shortfall ──
  var holNoRoster = buildHolidaysByWeek_(phData, weeks, { ok: false, profiles: {} }, {});
  var nr38 = holNoRoster.byWeek["2026.W38"];
  assert_(!!nr38 && nr38.entries.length === 2, "fallback mode keeps entries");
  assert_(nr38.entries[0].affectedCount === null && nr38.totalAffected === null,
          "fallback mode has null counts");
  assert_(Object.keys(holNoRoster.shortfallByWeek).length === 0, "fallback mode has no shortfall");

  // ── Empty PH data → empty result ──
  var holEmpty = buildHolidaysByWeek_([], weeks, rosterFull, netsuite);
  assert_(Object.keys(holEmpty.byWeek).length === 0, "no PH data → empty byWeek");

  // ── netsuiteByPersonWeek_ ──
  var ns = netsuiteByPersonWeek_([
    { person: "Ben Chile", iso: "2026.W38", key: "NETSUITE", hours: 8 },
    { person: "Ben  Chile", iso: "2026.W38", key: "NETSUITE", hours: 8 },  // double space → same person
  ]);
  assert_(ns["ben chile"]["2026.W38"] === 16, "netsuite hours should sum per normalized person, got " + JSON.stringify(ns));
```

- [ ] **Step 2: Run to verify it fails**

```bash
node node-tests.js
```
Expected: FAIL with `ReferenceError: buildHolidaysByWeek_ is not defined`.

- [ ] **Step 3: Implement the helpers**

In `Code.js`, insert a new section directly before `// ── TRACKED TIME + DELIVERY SIGNALS ──`:

```js
// ── PUBLIC HOLIDAYS (PH tab → week badges + capacity shortfall) ──

/**
 * Sums NETSUITE time-off hours per normalized person per ISO week — the
 * "already booked" side of the holiday shortfall de-dup.
 * @param {Array<{person:string, iso:string, hours:number}>} ptoRecs scopedPtoRecs (planned sheet)
 * @returns {Object} { normName: { iso: hours } }
 */
function netsuiteByPersonWeek_(ptoRecs) {
  var norm = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var out = {};
  (ptoRecs || []).forEach(function (r) {
    var p = norm(r.person);
    if (!out[p]) out[p] = {};
    out[p][r.iso] = (out[p][r.iso] || 0) + r.hours;
  });
  return out;
}

/**
 * Reads the PH tab (Date | Location | Holiday) from the source spreadsheet.
 * Any failure (missing tab, empty, bad rows) degrades to [] — the dashboard
 * then renders exactly as before this feature. Same contract as the PS
 * report's readPHData_.
 * @returns {Array<{date:string, location:string, holiday:string}>} date = "yyyy-MM-dd"
 */
function readPHData_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.PH_SHEET);
    if (!sh) { Logger.log("⚠️ readPHData_: sheet '" + CONFIG.PH_SHEET + "' not found — holiday signals off."); return []; }
    var rows = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var rawDate = rows[i][0], location = rows[i][1], holiday = rows[i][2];
      if (!rawDate || !location || !holiday) continue;
      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d)) continue;
      out.push({
        date:     Utilities.formatDate(d, "UTC", "yyyy-MM-dd"),
        location: String(location).trim(),
        holiday:  String(holiday).trim(),
      });
    }
    return out;
  } catch (e) {
    Logger.log("⚠️ readPHData_: " + e.message);
    return [];
  }
}

/**
 * Rolls PH rows up to the displayed ISO weeks and computes the capacity
 * shortfall — holiday hours NOT already covered by booked NETSUITE time-off,
 * per person, so nobody is double-counted (equivalent to
 * max(booked, holidayHours) per person-week).
 *
 * Population = roster profiles with countsForCapacity (same people as the
 * capacity denominator). ANZ people cost ANZ_HOLIDAY_HRS_PER_DAY (7.6),
 * everyone else HOLIDAY_HRS_PER_DAY (8).
 *
 * Roster fallback (rosterFull.ok false): entries keep rendering but with
 * affectedCount/totalAffected = null and zero shortfall — badges without
 * counts, capacity untouched (spec §Errors & degradation).
 *
 * @param {Array} phData        readPHData_() rows
 * @param {Array} weeks         buildWindow_() weeks ({iso, wk, year, status})
 * @param {Object} rosterFull   readRosterFull_() result ({ok, profiles})
 * @param {Object} netsuiteByPW netsuiteByPersonWeek_(scopedPtoRecs)
 * @returns {{byWeek:Object, shortfallByWeek:Object}}
 *          byWeek[iso] = { entries:[{date, location, holiday, days, affectedCount}],
 *                          totalAffected, shortfallHours }
 */
function buildHolidaysByWeek_(phData, weeks, rosterFull, netsuiteByPW) {
  var result = { byWeek: {}, shortfallByWeek: {} };
  if (!phData || !phData.length) return result;
  var rosterOk = !!(rosterFull && rosterFull.ok);
  var profiles = (rosterFull && rosterFull.profiles) || {};
  var anzLoc   = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();

  weeks.forEach(function (w) {
    var b = isoWeekBounds_(w.year, w.wk);
    var hits = phData.filter(function (ph) { return ph.date >= b.monday && ph.date <= b.sunday; });
    if (!hits.length) return;

    // Group by location+holiday — a multi-day holiday (Fiestas Patrias) becomes
    // ONE entry with a days count, matching how an exec reads the week.
    var grouped = {};
    hits.forEach(function (ph) {
      var key = ph.location + "||" + ph.holiday;
      if (!grouped[key]) grouped[key] = { date: ph.date, location: ph.location, holiday: ph.holiday, days: 0, affected: 0 };
      grouped[key].days++;
    });

    var shortfall = 0;
    var affectedAll = {};
    if (rosterOk) {
      Object.keys(profiles).forEach(function (np) {
        var prof = profiles[np];
        if (!prof.countsForCapacity) return;
        var days = 0;
        Object.keys(grouped).forEach(function (k) {
          var g = grouped[k];
          if (phLocMatchesEmp_(g.location, prof.location)) {
            g.affected++;
            days += g.days;
            affectedAll[np] = true;
          }
        });
        if (!days) return;
        var perDay  = String(prof.location || "").trim().toLowerCase() === anzLoc
          ? CONFIG.ANZ_HOLIDAY_HRS_PER_DAY : CONFIG.HOLIDAY_HRS_PER_DAY;
        var phHours = days * perDay;
        var booked  = (netsuiteByPW && netsuiteByPW[np] && netsuiteByPW[np][w.iso]) || 0;
        shortfall  += Math.max(0, phHours - booked);
      });
    }

    var entries = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      return { date: g.date, location: g.location, holiday: g.holiday, days: g.days,
               affectedCount: rosterOk ? g.affected : null };
    }).filter(function (e) { return !rosterOk || e.affectedCount > 0; });
    if (!entries.length) return;

    shortfall = Math.round(shortfall * 10) / 10;
    result.byWeek[w.iso] = {
      entries: entries,
      totalAffected: rosterOk ? Object.keys(affectedAll).length : null,
      shortfallHours: shortfall,
    };
    if (shortfall > 0) result.shortfallByWeek[w.iso] = shortfall;
  });
  return result;
}
```

(`readPHData_` touches `SpreadsheetApp` so it is intentionally thin and untested locally — the same policy as `readRosterFull_`.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
node node-tests.js
```
Expected: all suites ✅.

- [ ] **Step 5: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/Code.js" && git commit -m "feat(demand-dash): PH reader + buildHolidaysByWeek_ with NETSUITE shortfall de-dup"
```

---

### Task 4: Capacity deduction in `attachCapacity_` + model wiring (TDD)

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Code.js` — `attachCapacity_` (~lines 684-710), `buildDemandModel_` (~lines 311-315), `emptyModel_` (~line 1121); extend `_test_holidayCapacity_`

- [ ] **Step 1: Extend the failing test**

Inside `_test_holidayCapacity_`, before the final `Logger.log`, append:

```js
  // ── attachCapacity_ subtracts the holiday shortfall (roster mode) ──
  var model = {
    isoList: ["2026.W38", "2026.W39"],
    timeOffByWeek: { "2026.W38": 40 },            // booked NETSUITE (ben 16 + cara 8 + other PTO 16)
    holidayShortfallByWeek: { "2026.W38": 31.6 }, // from the rollup above
    activePeople: {},
  };
  attachCapacity_(model, { ok: true, headcount: 6, baseCapacity: 238, anzCount: 1 });
  assert_(model.grossCapByWeek["2026.W38"] === 238, "gross stays base capacity");
  assert_(Math.abs(model.capByWeek["2026.W38"] - (238 - 40 - 31.6)) < 0.001,
          "W38 net = gross − timeOff − holiday shortfall, got " + model.capByWeek["2026.W38"]);
  assert_(model.capByWeek["2026.W39"] === 238, "W39 (no time off, no holidays) stays gross");

  // ── planned fallback mode also honors the shortfall map (empty in real fallback) ──
  var model2 = {
    isoList: ["2026.W38"],
    timeOffByWeek: {},
    holidayShortfallByWeek: {},
    activePeople: { "2026.W38": 5 },
  };
  attachCapacity_(model2, { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0 });
  assert_(model2.capByWeek["2026.W38"] === 200, "fallback 5×40 with no deductions, got " + model2.capByWeek["2026.W38"]);
```

- [ ] **Step 2: Run to verify it fails**

```bash
node node-tests.js
```
Expected: FAIL on the `W38 net = gross − timeOff − holiday shortfall` assertion (capByWeek is 198, not 166.4 — the shortfall isn't subtracted yet).

- [ ] **Step 3: Implement**

**(a)** In `attachCapacity_`, add a shortfall lookup and subtract it in both branches. Replace the function body's first lines and the two `capByWeek` assignments:

```js
function attachCapacity_(model, rosterFull) {
  var cap = CONFIG.WEEKLY_CAPACITY_HRS;
  var hc  = rosterFull || { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0 };
  var timeOff  = model.timeOffByWeek || {};
  var holShort = model.holidayShortfallByWeek || {};   // unbooked public-holiday hours (see buildHolidaysByWeek_)
  model.capByWeek = {};
  model.grossCapByWeek = {};
  if (hc.ok && hc.headcount > 0) {
    model.capacityMode = "roster";
    model.headcount    = hc.headcount;
    model.anzCount     = hc.anzCount;
    model.baseCapacity = hc.baseCapacity;
    model.isoList.forEach(function (iso) {
      model.grossCapByWeek[iso] = hc.baseCapacity;
      model.capByWeek[iso] = Math.max(0, hc.baseCapacity - (timeOff[iso] || 0) - (holShort[iso] || 0));
    });
  } else {
    model.capacityMode = "planned";
    model.headcount    = null;
    model.anzCount     = 0;
    model.capacityNote = hc.capError || "Roster unavailable.";
    model.isoList.forEach(function (iso) {
      var gross = (model.activePeople[iso] || 0) * cap;
      model.grossCapByWeek[iso] = gross;
      model.capByWeek[iso] = Math.max(0, gross - (timeOff[iso] || 0) - (holShort[iso] || 0));
    });
  }
}
```

Also update the JSDoc above it: capacity is net of PTO **and unbooked public holidays** (`model.holidayShortfallByWeek`).

**(b)** In `buildDemandModel_`, between `model.timeOffByWeek = sumHoursByIso_(scopedPtoRecs);` and `attachCapacity_(model, roster);`, insert:

```js
    // ── Public holidays: badges + capacity shortfall (PH tab; [] on any failure) ──
    var phData = readPHData_();
    var hol = buildHolidaysByWeek_(phData, weeks, roster, netsuiteByPersonWeek_(scopedPtoRecs));
    model.holidaysByWeek = hol.byWeek;
    model.holidayShortfallByWeek = hol.shortfallByWeek;
```

**(c)** In `emptyModel_`, extend the line `capByWeek: capByWeek, grossCapByWeek: {}, timeOffByWeek: {},` to:

```js
    capByWeek: capByWeek, grossCapByWeek: {}, timeOffByWeek: {}, holidaysByWeek: {}, holidayShortfallByWeek: {},
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node node-tests.js
```
Expected: all suites ✅.

- [ ] **Step 5: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/Code.js" && git commit -m "feat(demand-dash): capacity net of unbooked public holidays; model holidaysByWeek"
```

---

### Task 5: Frontend — holiday globals, tooltip lines, chart markers, so-what

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` — globals (~line 549), `capChartHover_` (~line 650), `applyModel` (~line 681), `renderCapacity` so-what (~line 785), `renderCapChart` week-label loop (~line 913)

No unit harness exists for the client — verification is visual (Task 7 QA) plus the offline-file boot path.

- [ ] **Step 1: Add globals and helpers**

After the line `var PTO_FULL_THRESHOLD = 0.75; …` (~line 548), add:

```js
var HOLIDAYS = {};   // model.holidaysByWeek — iso → {entries, totalAffected, shortfallHours}
```

Next to `capChartHover_` (directly above it), add two helpers:

```js
/* Holiday lines for the shared tooltip (HTML). Counts only — never person names. */
function holidayTipHtml_(iso){
  var h=HOLIDAYS[iso]; if(!h) return '';
  var lines=h.entries.map(function(en){
    return '🏖 '+esc(en.holiday)+' · '+esc(en.location)+' · '+esc(en.date)
      +(en.days>1?' ('+en.days+' days)':'')
      +(en.affectedCount!=null?' · '+en.affectedCount+' people':'');
  });
  if(h.shortfallHours) lines.push('capacity −'+fmt(h.shortfallHours)+' h');
  return lines.join('<br>');
}
/* Plain-text variant for title="" attributes (heatmap header chips). */
function holidayTitle_(iso){
  var h=HOLIDAYS[iso]; if(!h) return '';
  return h.entries.map(function(en){
    return en.holiday+' · '+en.location+(en.days>1?' ('+en.days+' days)':'')
      +(en.affectedCount!=null?' · '+en.affectedCount+' people':'');
  }).join('\n');
}
```

- [ ] **Step 2: Populate the globals in `applyModel`**

In `applyModel(model)`, after `KEYINDEX = {};` block, add:

```js
  HOLIDAYS = model.holidaysByWeek || {};
```

- [ ] **Step 3: Append holiday lines to the chart hover tooltip**

Replace `capChartHover_`:

```js
function capChartHover_(e, iso){
  var wt = CAP_CHART_WT || { planned:{}, tracked:{} };
  var pv = wt.planned[iso]||0, tv = wt.tracked[iso]||0;
  var fidTxt = pv>0 ? (Math.round((tv/pv)*100)+'% fidelity') : 'no plan';
  var ht = holidayTipHtml_(iso);
  showTip(e, '<b>'+esc(iso)+'</b><br>'+fmt(pv)+' hrs planned<br>'+fmt(tv)+' hrs tracked<br>'+esc(fidTxt)+(ht?'<br>'+ht:''));
}
```

- [ ] **Step 4: 🏖 marker on holiday weeks in `renderCapChart`**

In the week-label loop (the `cw.forEach(function(wk,i){ var lx=x(i); …` block that draws hit-columns and labels), directly after the `if(isSel||isCur||isEdge||i%labelStep===0){ … }` block, add:

```js
    if(HOLIDAYS[wk.iso]){
      g+='<text x="'+lx+'" y="'+(pad.t+10)+'" text-anchor="middle" font-size="9" style="pointer-events:none">🏖</text>';
    }
```

(Top of the plot area, not the axis row — axis labels are thinned on wide windows and the marker must survive thinning. The existing full-height hover hit-column already shows the holiday tooltip from Step 3.)

- [ ] **Step 5: Holiday line in the so-what**

In `renderCapacity()`, replace the line `var swFull=trendLine+sw;` with:

```js
  var swFull=trendLine+sw;
  var hol=HOLIDAYS[iso];
  if(hol){
    var locs={}; hol.entries.forEach(function(en){locs[en.location]=true;});
    var nDays=hol.entries.reduce(function(s,en){return s+(en.days||1);},0);
    swFull+='<div>🏖 <b>'+nDays+' public holiday day'+(nDays>1?'s':'')+'</b> this week ('
      +esc(Object.keys(locs).join(', '))
      +(hol.totalAffected!=null?' · '+hol.totalAffected+' people':'')
      +(hol.shortfallHours?' · capacity −'+fmt(hol.shortfallHours)+' h':'')
      +') — expect lower planned/tracked hours; a dip here is not a demand drop.</div>';
  }
```

- [ ] **Step 6: Offline smoke check**

Open the file directly in a browser (offline/demo mode boots a static model without holiday data):

```powershell
Start-Process "D:\Contribution\docs\superpowers\project-demand-dashboard\Dashboard.html"
```
Expected: page boots to the offline state with no console errors — `HOLIDAYS` stays `{}` and every panel renders exactly as before (regression guard: weeks without holidays are pixel-identical).

- [ ] **Step 7: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/Dashboard.html" && git commit -m "feat(demand-dash): holiday badges + tooltip + so-what on planned-vs-tracked panel"
```

---

### Task 6: Frontend — heatmap week-header chips

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/Dashboard.html` — `renderHeat()` header row (~line 1656)

- [ ] **Step 1: Add the chip to the header cells**

In `renderHeat()`, replace the `<thead>` week-header map:

```js
  var html='<table class="hgrid"><thead><tr><th class="rowhdr">Project</th>'+WEEKS.map(function(w){
    return '<th>'+esc(w.iso)+'<div style="font-weight:400;color:var(--muted);font-size:calc(9.5px*var(--scale))">'+STATUS_LABEL[w.status]+'</div></th>';
  }).join('')+'</tr></thead><tbody>';
```

with:

```js
  var html='<table class="hgrid"><thead><tr><th class="rowhdr">Project</th>'+WEEKS.map(function(w){
    var holChip=HOLIDAYS[w.iso]?' <span title="'+esc(holidayTitle_(w.iso))+'" style="cursor:help">🏖</span>':'';
    return '<th>'+esc(w.iso)+holChip+'<div style="font-weight:400;color:var(--muted);font-size:calc(9.5px*var(--scale))">'+STATUS_LABEL[w.status]+'</div></th>';
  }).join('')+'</tr></thead><tbody>';
```

- [ ] **Step 2: Offline smoke check**

Reload the file in the browser: heatmap renders unchanged (no holidays in offline model), no console errors.

- [ ] **Step 3: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/Dashboard.html" && git commit -m "feat(demand-dash): heatmap week-header holiday chips"
```

---

### Task 7: Docs + deploy notes

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/README.md` (Panels bullet list; Data sources; Deploy steps)

- [ ] **Step 1: Document the feature in the README**

In the **Panels** section, extend the Demand-vs-capacity/Planned-vs-Tracked bullet with:

```markdown
  Weeks containing public holidays carry a 🏖 marker (chart + heatmap headers); the hover
  tooltip and so-what name the holiday, location, and affected-people count, and net
  capacity additionally subtracts **unbooked** holiday hours — per person,
  `max(0, holiday hrs − booked NETSUITE hrs)`, so booked holidays are never double-counted
  (ANZ holiday day = 7.6 h, others 8 h).
```

In **Data sources**, add:

```markdown
- **Public holidays:** same spreadsheet as Demand (`SOURCE_SS_ID`), tab `PH`
  (`Date | Location | Holiday` — the tab the PS report already maintains). Missing tab or
  bad rows → holiday signals silently off, everything else unaffected. Config:
  `PH_SHEET`, `HOLIDAY_HRS_PER_DAY` (8), `ANZ_HOLIDAY_HRS_PER_DAY` (7.6).
```

In **Deploy**, extend step 3's test list to include `_test_holidayCapacity_`, and add to the redeploy note: model shape changed → run `bustDemandCache_()` once (or press ↻ Refresh) after pasting.

- [ ] **Step 2: Commit**

```bash
cd "D:\Contribution" && git add "docs/superpowers/project-demand-dashboard/README.md" && git commit -m "docs(demand-dash): public holiday signals — README panels/data/deploy"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full local suite**

```bash
cd "D:\Contribution\docs\superpowers\project-demand-dashboard" && node node-tests.js
```
Expected: every suite ✅ ending `✅ node-tests: all suites passed`.

- [ ] **Step 2: Working-tree check**

```bash
cd "D:\Contribution" && git status --short -- docs/superpowers/project-demand-dashboard docs/superpowers/plans docs/superpowers/specs
```
Expected: clean (all work committed). Do **not** push.

- [ ] **Step 3: Hand off deploy checklist to the owner (manual, GAS editor)**

1. Paste updated `Code.js` and `Dashboard.html` into the GAS project (Security.js unchanged).
2. Run `_test_holidayCapacity_` + `_test_demandParse_` + `_test_headcount_` + `_test_cacheRoundtrip_` — all ✅.
3. Run `bustDemandCache_()` once (model shape changed), then load the dashboard and press ↻ Refresh.
4. Live QA: pick a week with a known PH entry (check the PH tab) — 🏖 appears on the chart + heatmap header, tooltip lists holiday/location/count, so-what includes the holiday line; weeks without holidays look unchanged.
