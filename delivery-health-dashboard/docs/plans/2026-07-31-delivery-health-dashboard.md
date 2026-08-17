# Delivery Health Dashboard (Final 4-Tile Version) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone GAS web app with four metric tiles (Utilization live, On-Time Delivery live, Forecast Accuracy live, Quality/Rework placeholder) and a people × 6-week capacity grid with stacked bars and inline drill-downs.

**Architecture:** Server (`Code.js`) reads 7 tabs across 2 spreadsheets by ID, joins on normalized names, and builds one JSON model served through a gzip-chunked CacheService entry with a 30-min warmer. Client (`Dashboard.html`) computes all filter-scoped rollups from the payload (people records + additive Jira buckets) so Region/Team filtering never re-hits the server. Security is an email allowlist (`Security.js`), enforced in both `doGet()` and `getDeliveryData()`.

**Tech Stack:** Google Apps Script (V8), HtmlService, CacheService, plain HTML/CSS/JS client (no frameworks), Node for local test runs (`node node-tests.js`).

**Spec:** `delivery-health-dashboard/docs/specs/2026-07-31-delivery-health-dashboard-design.md` — read it before starting. Clone patterns from `project-demand-dashboard/` (Code.js / Security.js / Dashboard.html / node-tests.js).

**Working directory for all tasks:** `D:\Contribution` (git repo root). All commits go to the current branch. NEVER `git push` (repo policy).

**Testing note:** Pure functions run locally via `node node-tests.js` from `delivery-health-dashboard/`. Sheet readers and triggers only run inside the GAS editor after deployment — for those, the plan includes diagnostic functions and a manual QA checklist instead of Node tests. After every Code.js edit also run `node --check Code.js` (syntax gate; GAS V8 accepts the same syntax Node does).

---

## Data contracts (referenced by every task)

**Person-week cell** (server → client), all numbers in hours, absent key = no data:

```js
// people[i].weeks["2026.W31"] =
{ cap: 40, capEst: false, pto: 8, hol: 0, avail: 32,
  planned: 30, tracked: 28, billable: 22, nonBillable: 6 }
```

**Person record:**

```js
{ name: "Alvarez, Maria",          // roster display name used for sorting/joins
  region: "AMER",                  // resolved region bucket
  regionSource: "jira",            // "jira" (majority tracked hours) | "roster" (fallback)
  teams: ["Team A", "Team B"],     // individual Tempo teams (split from pipe-joined col)
  isCrew: false,
  weeks: { "2026.W25": {...}, ... } // ALL trend+grid weeks (6 completed + current + 3 future)
}
```

**Jira additive buckets** (client sums whatever matches the active filters):

```js
// model.onTimeBuckets[i]
{ iso: "2026.W30", region: "AMER", team: "Team A", n: 12, onTime: 9 }
// model.forecastBuckets[i]  — acc per epic = max(0, 1 − |spent−est|/est)
{ iso: "2026.W30", region: "AMER", team: "Team A", n: 3, sumAcc: 2.41 }
```

**Top-level model:**

```js
{ meta: { gridWeeks: [{iso,status}],        // status: "done"|"now"|"plan" — 6 entries
          trendWeeks: ["2026.W25", ...],    // 6 completed ISO labels, oldest first
          headlineIso: "2026.W30",          // last completed week
          generatedAt: "2026-08-03T08:00:00Z",
          thresholds: { green: 70, amber: 50 },
          regions: ["AMER","EMEA","APAC","ANZ","Other"],
          teams: ["Team A","Team B", ...],  // union: Tempo teams + Jira bucket teams, deduped
          nsAvailable: true, jiraAvailable: true },
  people: [ ... ],
  onTimeBuckets: [ ... ],   // [] when jiraAvailable=false
  forecastBuckets: [ ... ], // [] when jiraAvailable=false
  error: undefined }        // string on fatal failure (roster unreadable)
```

---

### Task 1: Project scaffold + Security.js

**Files:**
- Create: `delivery-health-dashboard/Security.js`
- Create: `delivery-health-dashboard/.gitkeep` (delete after first file lands — only if dir creation needs it)

- [ ] **Step 1: Create Security.js** — copy `project-demand-dashboard/Security.js` and apply exactly these renames (global, case-sensitive):

| From | To |
|---|---|
| `SEC_PD` | `SEC_DH` |
| `PD_DASH_ADMINS` | `DH_DASH_ADMINS` |
| `PD_DASH_VIEWERS` | `DH_DASH_VIEWERS` |
| `PD_DASH_OPEN_ACCESS` | `DH_DASH_OPEN_ACCESS` |
| `checkDemandAccess` | `checkDeliveryAccess` |
| `getDemandAccessSettings` | `getDeliveryAccessSettings` |
| `saveDemandAccessSettings` | `saveDeliveryAccessSettings` |
| `_readDemandAccessLists_` | `_readDeliveryAccessLists_` |
| `Project Demand` (strings) | `Delivery Health` |

Keep `BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com"`. Set `DEFAULT_ADMINS` to the same three emails as the demand dashboard. Leave `DEFAULT_VIEWERS: []` (directs get added at runtime via the 🔒 panel). Keep `OPEN_ACCESS_DEFAULT: false`. Keep `buildAccessDeniedPage_` (it is per-project — no rename needed) but update its title/body strings to "Delivery Health".

- [ ] **Step 2: Syntax check**

Run: `node --check "delivery-health-dashboard/Security.js"`
Expected: no output (exit 0)

- [ ] **Step 3: Commit**

```bash
git add delivery-health-dashboard/Security.js
git commit -m "feat(delivery-health): Security.js allowlist (SEC_DH clone of demand dashboard)"
```

---

### Task 2: Code.js skeleton — CONFIG_DH, ISO week helpers, window builder (TDD)

**Files:**
- Create: `delivery-health-dashboard/Code.js`
- Create: `delivery-health-dashboard/node-tests.js`

- [ ] **Step 1: Create node-tests.js** (the permanent local runner — later tasks only append `_test_...()` call lines):

```js
// node-tests.js — local runner for the pure _test_ functions in Code.js.
// Stubs: Logger→console, Utilities gzip/base64 via zlib/Buffer, FakeCache
// for _test_cacheRoundtrip_. SpreadsheetApp/CacheService/ScriptApp are NOT
// stubbed — only pure functions run here; everything also runs in GAS.
// Usage: node node-tests.js   (from this directory)
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

global.Logger = { log: function (m) { console.log(m); } };
global.Utilities = {
  newBlob: function (data) { return { _buf: Buffer.isBuffer(data) ? data : Buffer.from(data) }; },
  gzip: function (blob) { return { getBytes: function () { return zlib.gzipSync(blob._buf); } }; },
  ungzip: function (blob) { return { getDataAsString: function () { return zlib.gunzipSync(blob._buf).toString("utf8"); } }; },
  base64Encode: function (bytes) { return Buffer.from(bytes).toString("base64"); },
  base64Decode: function (b64) { return Buffer.from(b64, "base64"); },
};
function FakeCache() { this.m = {}; }
FakeCache.prototype.putAll = function (entries) { for (var k in entries) this.m[k] = entries[k]; };
FakeCache.prototype.get = function (k) { return (k in this.m) ? this.m[k] : null; };
FakeCache.prototype.getAll = function (names) {
  var out = {};
  for (var i = 0; i < names.length; i++) if (names[i] in this.m) out[names[i]] = this.m[names[i]];
  return out;
};

eval(fs.readFileSync(path.join(__dirname, "Code.js"), "utf8"));

_test_dhWindow_();

console.log("✅ node-tests: all suites passed");
```

- [ ] **Step 2: Write Code.js with CONFIG + ISO helpers + window builder + its failing-first test.** Full initial content:

```js
// ============================================================
// SCRIPT NAME: Delivery Health Dashboard (4-tile: Utilization,
//              On-Time Delivery, Forecast Accuracy, Rework-placeholder)
// PURPOSE:     Standalone GAS web app. Reads Tempo/NS/Jira tabs +
//              Roster by spreadsheet ID, builds one person×week +
//              Jira-bucket model, serves Dashboard.html.
// ACCESS:      Email allowlist — see Security.js (checkDeliveryAccess()).
// SPEC:        delivery-health-dashboard/docs/specs/2026-07-31-delivery-health-dashboard-design.md
// ============================================================

var CONFIG_DH = {
  // ── Sources (Script Properties DH_SOURCE_SS_ID / DH_ROSTER_SS_ID override) ──
  SOURCE_SS_ID:      "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // Tempo hours SS
  ROSTER_SS_ID:      "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  CAPACITY_SHEET:    "Capacity Tempo",
  TRACKED_SHEET:     "Tempo Tracked Time",
  PLANNED_SHEET:     "Planned Time Tempo",
  NS_SHEET:          "NS Billable",
  PH_SHEET:          "PH",
  JIRA_RAW_SHEET:    "Jira Raw",
  ROSTER_SHEET:      "Data",
  CONTRACTORS_SHEET: "Contractors Data",
  ROSTER_CLASS:      "Professional Services",
  ROSTER_DEPT:       "Services",
  NONPROJECT_KEYS:   ["NETSUITE"],       // time-off rows (case-insensitive)

  // ── Window ──
  WEEKS_PAST_GRID:   2,   // completed weeks shown in the grid
  WEEKS_PAST_TREND:  6,   // completed weeks aggregated for tile trends
  WEEKS_FUTURE:      3,

  // ── Capacity fallbacks (used only when Capacity Tempo has no cell) ──
  WEEKLY_CAPACITY_HRS:     40,
  ANZ_LOCATION:            "Australia & New Zealand",
  ANZ_CAPACITY_HRS:        38,
  HOLIDAY_HRS_PER_DAY:     8,
  ANZ_HOLIDAY_HRS_PER_DAY: 7.6,

  // ── Region buckets: roster "Key Location" → bucket (FALLBACK lens only;
  //    primary person-region = majority of Jira-tagged tracked hours).
  //    Extend after the W32 Key Location audit (spec §10.2). ──
  LOCATION_REGION_MAP: {
    "australia & new zealand": "ANZ",
    "malaysia": "APAC", "singapore": "APAC", "philippines": "APAC",
    "united states": "AMER", "canada": "AMER", "costa rica": "AMER",
    "chile": "AMER", "colombia": "AMER", "mexico": "AMER",
    "united kingdom": "EMEA", "spain": "EMEA", "portugal": "EMEA",
  },
  REGION_FALLBACK: "Other",

  // ── RAG tint thresholds (billable util %, spec §10.3) ──
  TINT_GREEN: 70,
  TINT_AMBER: 50,

  TITLE: "Delivery Health Dashboard",

  // ── Cache ──
  CACHE_TTL_SEC:        3900,
  CACHE_WARM_EVERY_MIN: 30,
};

// ── ISO WEEK HELPERS (Monday-start, ISO-8601 — ported from demand Code.js) ──

function isoWeekNum_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

function isoWeekYear_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function weeksInYear_(year) {
  return isoWeekNum_(new Date(Date.UTC(year, 11, 28)));
}

/** "YYYY.WN" label for any Date (used to bucket NS daily rows + Jira dates). */
function weekKeyFromDate_(date) {
  return isoWeekYear_(date) + ".W" + isoWeekNum_(date);
}

/**
 * Rolling window anchored on `today` (injectable for tests).
 * @returns {{ gridWeeks: Array<{iso:string,status:string}>,
 *             trendWeeks: string[],       // 6 completed, oldest first
 *             allWeeks: string[],         // union, oldest first
 *             headlineIso: string }}
 */
function buildDhWindow_(today) {
  var curW = isoWeekNum_(today), curY = isoWeekYear_(today);
  function shift(off) {
    var w = curW + off, y = curY;
    while (w <= 0) { y--; w += weeksInYear_(y); }
    while (w > weeksInYear_(y)) { w -= weeksInYear_(y); y++; }
    return y + ".W" + w;
  }
  var trendWeeks = [], gridWeeks = [], allWeeks = [];
  for (var t = -CONFIG_DH.WEEKS_PAST_TREND; t <= -1; t++) trendWeeks.push(shift(t));
  for (var off = -CONFIG_DH.WEEKS_PAST_GRID; off <= CONFIG_DH.WEEKS_FUTURE; off++) {
    gridWeeks.push({ iso: shift(off), status: off < 0 ? "done" : (off === 0 ? "now" : "plan") });
  }
  for (var a = -CONFIG_DH.WEEKS_PAST_TREND; a <= CONFIG_DH.WEEKS_FUTURE; a++) allWeeks.push(shift(a));
  return { gridWeeks: gridWeeks, trendWeeks: trendWeeks, allWeeks: allWeeks,
           headlineIso: shift(-1) };
}

// ── TESTS ────────────────────────────────────────────────────

function _test_dhWindow_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_dhWindow_: " + m); }
  // 2026-07-31 is a Friday in ISO 2026.W31
  var w = buildDhWindow_(new Date(2026, 6, 31));
  assert_(w.gridWeeks.length === 6, "grid = 6 weeks");
  assert_(w.gridWeeks.map(function (x) { return x.iso; }).join("|") ===
          "2026.W29|2026.W30|2026.W31|2026.W32|2026.W33|2026.W34", "grid labels");
  assert_(w.gridWeeks[2].status === "now" && w.gridWeeks[0].status === "done" &&
          w.gridWeeks[5].status === "plan", "statuses");
  assert_(w.trendWeeks.join("|") ===
          "2026.W25|2026.W26|2026.W27|2026.W28|2026.W29|2026.W30", "trend = 6 completed");
  assert_(w.headlineIso === "2026.W30", "headline = last completed");
  assert_(w.allWeeks.length === 10 && w.allWeeks[0] === "2026.W25" &&
          w.allWeeks[9] === "2026.W34", "allWeeks spans trend→future");
  // Year boundary: 2026-01-01 is Thursday of ISO 2026.W1 → past weeks wrap into 2025
  var y = buildDhWindow_(new Date(2026, 0, 1));
  assert_(y.trendWeeks[0].indexOf("2025.") === 0, "trend wraps into prior ISO year");
  assert_(weekKeyFromDate_(new Date(2026, 6, 27)) === "2026.W31", "Mon 2026-07-27 → W31");
  assert_(weekKeyFromDate_(new Date(2026, 7, 2)) === "2026.W31", "Sun 2026-08-02 → W31");
  Logger.log("✅ _test_dhWindow_ passed");
}
```

- [ ] **Step 3: Run the tests**

Run: `cd "delivery-health-dashboard" && node node-tests.js`
Expected: `✅ _test_dhWindow_ passed` then `✅ node-tests: all suites passed`
(If a `_test_dhWindow_` assertion throws, fix `buildDhWindow_` — do not weaken the test.)

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Code.js delivery-health-dashboard/node-tests.js
git commit -m "feat(delivery-health): Code.js skeleton — CONFIG_DH, ISO week helpers, window builder + tests"
```

---

### Task 3: Pure helpers — name normalization/aliases, team split, NS week bucketing

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)
- Modify: `delivery-health-dashboard/node-tests.js` (add call lines)

- [ ] **Step 1: Append the failing tests to Code.js**

```js
function _test_nameJoin_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nameJoin_: " + m); }
  assert_(normDH_("  Maria   ALVAREZ ") === "maria alvarez", "normalize whitespace+case");
  var a = nameAliases_("Alvarez, Maria");
  // "Last, First" cell → also match "First Last" and "Last First"
  assert_(a.indexOf("alvarez, maria") !== -1 && a.indexOf("maria alvarez") !== -1 &&
          a.indexOf("alvarez maria") !== -1, "comma cell yields all variants");
  var b = nameAliases_("Maria Alvarez");
  assert_(b.indexOf("maria alvarez") !== -1 && b.length === 1, "no-comma name = itself only");
  // Index build + lookup: NS "Last, First" resolves to roster "First Last"
  var idx = buildNameIndex_(["Maria Alvarez", "Tom Baker"]);
  assert_(resolveName_(idx, "ALVAREZ,  Maria") === "Maria Alvarez", "comma variant resolves");
  assert_(resolveName_(idx, "Tom Baker") === "Tom Baker", "exact resolves");
  assert_(resolveName_(idx, "Nobody Here") === null, "unknown → null");
  Logger.log("✅ _test_nameJoin_ passed");
}

function _test_teamSplit_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_teamSplit_: " + m); }
  assert_(splitTeams_("Team A | Team B").join("|") === "Team A|Team B", "split pipe-join");
  assert_(splitTeams_(" Team A ").join("|") === "Team A", "single team trimmed");
  assert_(splitTeams_("").length === 0 && splitTeams_(null).length === 0, "blank → []");
  assert_(splitTeams_("A | A | B").join("|") === "A|B", "dedup within a cell");
  Logger.log("✅ _test_teamSplit_ passed");
}

function _test_nsWeekBucketing_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nsWeekBucketing_: " + m); }
  var rows = [
    { name: "Maria Alvarez", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 }, // Mon W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 2),  billable: 4, nonBillable: 0 }, // Sun W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 3),  billable: 8, nonBillable: 0 }, // Mon W32
    { name: "Tom Baker",     date: new Date(2026, 6, 28), billable: 0, nonBillable: 8 },
  ];
  var m = aggregateNsWeeks_(rows);
  assert_(m["maria alvarez"]["2026.W31"].billable === 10, "Mon+Sun same ISO week");
  assert_(m["maria alvarez"]["2026.W31"].nonBillable === 2, "nonBillable summed");
  assert_(m["maria alvarez"]["2026.W32"].billable === 8, "Monday starts next week");
  assert_(m["tom baker"]["2026.W31"].billable === 0 && m["tom baker"]["2026.W31"].nonBillable === 8, "zero billable kept");
  Logger.log("✅ _test_nsWeekBucketing_ passed");
}
```

- [ ] **Step 2: Add the three call lines to node-tests.js** (before the final `console.log`):

```js
_test_nameJoin_();
_test_teamSplit_();
_test_nsWeekBucketing_();
```

Run: `node node-tests.js` → Expected: FAIL with `normDH_ is not defined`

- [ ] **Step 3: Append the implementations to Code.js** (above the TESTS section):

```js
// ── NAME JOINS ───────────────────────────────────────────────

/** Canonical name key — same convention as normPS_ in the PS report. */
function normDH_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * All normalized variants a source cell may appear as. "Last, First" cells
 * (NS Billable / Planned) also produce "First Last" and "Last First".
 * @returns {string[]} deduped normalized keys
 */
function nameAliases_(raw) {
  var norm = normDH_(raw);
  if (!norm) return [];
  var out = [norm];
  var m = norm.match(/^([^,]+),\s*(.+)$/);
  if (m) {
    var flipped = normDH_(m[2] + " " + m[1]);   // "first last"
    var spaced  = normDH_(m[1] + " " + m[2]);   // "last first"
    if (out.indexOf(flipped) === -1) out.push(flipped);
    if (out.indexOf(spaced) === -1) out.push(spaced);
  }
  return out;
}

/** Roster display names → lookup index: every alias key → display name. */
function buildNameIndex_(displayNames) {
  var idx = {};
  displayNames.forEach(function (dn) {
    nameAliases_(dn).forEach(function (k) { if (!(k in idx)) idx[k] = dn; });
    // Also index the "Last, First" form of a "First Last" roster name so
    // comma-form source cells resolve: "Maria Alvarez" → key "alvarez, maria".
    var parts = normDH_(dn).split(" ");
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      var first = parts.slice(0, -1).join(" ");
      var commaKey = normDH_(last + ", " + first);
      if (!(commaKey in idx)) idx[commaKey] = dn;
      var lastFirstKey = normDH_(last + " " + first);
      if (!(lastFirstKey in idx)) idx[lastFirstKey] = dn;
    }
  });
  return idx;
}

/** Resolves a raw source-cell name to the roster display name, else null. */
function resolveName_(idx, raw) {
  var aliases = nameAliases_(raw);
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i] in idx) return idx[aliases[i]];
  }
  return null;
}

// ── TEAM SPLIT (spec: filter = individual Tempo teams, membership match) ──

/** "Team A | Team B" → ["Team A","Team B"], trimmed, deduped, blanks dropped. */
function splitTeams_(cell) {
  var seen = {}, out = [];
  String(cell || "").split("|").forEach(function (t) {
    var v = t.trim();
    if (v && !(v.toLowerCase() in seen)) { seen[v.toLowerCase()] = 1; out.push(v); }
  });
  return out;
}

// ── NS BILLABLE WEEK AGGREGATION ─────────────────────────────

/**
 * Daily NS rows → { normName: { iso: {billable, nonBillable} } }.
 * @param {Array<{name:string,date:Date,billable:number,nonBillable:number}>} rows
 */
function aggregateNsWeeks_(rows) {
  var map = {};
  rows.forEach(function (r) {
    if (!r.date || isNaN(r.date.getTime())) return;
    var key = normDH_(r.name);
    if (!key) return;
    var iso = weekKeyFromDate_(r.date);
    if (!map[key]) map[key] = {};
    if (!map[key][iso]) map[key][iso] = { billable: 0, nonBillable: 0 };
    map[key][iso].billable += Number(r.billable) || 0;
    map[key][iso].nonBillable += Number(r.nonBillable) || 0;
  });
  return map;
}
```

- [ ] **Step 4: Run the tests**

Run: `node node-tests.js`
Expected: all four `✅ ... passed` lines + final `✅ node-tests: all suites passed`

- [ ] **Step 5: Commit**

```bash
git add delivery-health-dashboard/Code.js delivery-health-dashboard/node-tests.js
git commit -m "feat(delivery-health): name-join index, team split, NS weekly bucketing + tests"
```

---

### Task 4: Pure helpers — net capacity, region resolution, bar clamp

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)
- Modify: `delivery-health-dashboard/node-tests.js` (add call lines)

- [ ] **Step 1: Append failing tests**

```js
function _test_netCapacity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_netCapacity_: " + m); }
  // holiday hrs arg is the person's holiday hours that week BEFORE dedup vs booked PTO
  assert_(netCapacity_(40, 8, 0).avail === 32, "cap − pto");
  assert_(netCapacity_(40, 0, 8).avail === 32, "cap − holiday");
  // booked-holiday no-double-count: effective holiday = max(0, hol − pto)
  var n = netCapacity_(40, 8, 8);
  assert_(n.avail === 32 && n.hol === 0, "booked holiday not double-counted");
  var p = netCapacity_(40, 4, 8);
  assert_(p.hol === 4 && p.avail === 32, "partial booking subtracts remainder only");
  assert_(netCapacity_(32, 40, 0).avail === 0, "floor at 0");
  assert_(netCapacity_(0, 8, 0).avail === 0, "zero capacity stays 0");
  Logger.log("✅ _test_netCapacity_ passed");
}

function _test_regionMap_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionMap_: " + m); }
  assert_(regionBucketFromLocation_("Malaysia") === "APAC", "known location");
  assert_(regionBucketFromLocation_("  MALAYSIA ") === "APAC", "case/space insensitive");
  assert_(regionBucketFromLocation_("Atlantis") === "Other", "unknown → Other");
  assert_(regionBucketFromLocation_("") === "Other", "blank → Other");
  Logger.log("✅ _test_regionMap_ passed");
}

function _test_personRegion_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personRegion_: " + m); }
  // hoursByRegion from Key→Jira Raw join over the trend window
  var r = assignPersonRegion_({ "AMER": 60, "EMEA": 20 }, "APAC");
  assert_(r.region === "AMER" && r.source === "jira", "majority wins");
  var t = assignPersonRegion_({ "AMER": 40, "EMEA": 40 }, "APAC");
  assert_(t.region === "AMER" && t.source === "jira", "tie → alphabetical (deterministic)");
  var f = assignPersonRegion_({}, "APAC");
  assert_(f.region === "APAC" && f.source === "roster", "no tagged hours → roster fallback");
  var z = assignPersonRegion_({ "AMER": 0 }, "APAC");
  assert_(z.region === "APAC" && z.source === "roster", "zero hours = untagged");
  Logger.log("✅ _test_personRegion_ passed");
}

function _test_overflowClamp_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_overflowClamp_: " + m); }
  var ok = clampToCapacity_(30, 40);
  assert_(ok.pct === 75 && ok.over === false, "under capacity");
  var over = clampToCapacity_(44, 40);
  assert_(over.pct === 100 && over.over === true && over.realPct === 110, "clamped + flagged");
  assert_(clampToCapacity_(10, 0).pct === null, "zero capacity → null pct");
  Logger.log("✅ _test_overflowClamp_ passed");
}
```

Add calls in node-tests.js: `_test_netCapacity_(); _test_regionMap_(); _test_personRegion_(); _test_overflowClamp_();`

Run: `node node-tests.js` → Expected: FAIL with `netCapacity_ is not defined`

- [ ] **Step 2: Append implementations**

```js
// ── NET CAPACITY (spec §4) ───────────────────────────────────

/**
 * available = max(0, cap − pto − effectiveHoliday);
 * effectiveHoliday = max(0, holidayHrs − pto) so a holiday already booked as
 * NETSUITE time-off is never counted twice (demand-dashboard convention).
 * @returns {{avail:number, hol:number}} hol = effective (deduped) holiday hours
 */
function netCapacity_(cap, pto, holidayHrs) {
  var c = Number(cap) || 0, p = Number(pto) || 0, h = Number(holidayHrs) || 0;
  var effHol = Math.max(0, h - p);
  return { avail: Math.max(0, c - p - effHol), hol: effHol };
}

// ── REGION RESOLUTION (spec: issue-level standard, roster fallback) ──

function regionBucketFromLocation_(keyLocation) {
  var k = normDH_(keyLocation);
  return CONFIG_DH.LOCATION_REGION_MAP[k] || CONFIG_DH.REGION_FALLBACK;
}

/**
 * Person region = region receiving the most Jira-tagged tracked hours in the
 * trend window; ties break alphabetically (deterministic). No tagged hours
 * (> 0) → roster-location fallback, labeled source:"roster".
 */
function assignPersonRegion_(hoursByRegion, rosterBucket) {
  var best = null, bestH = 0;
  Object.keys(hoursByRegion).sort().forEach(function (r) {
    var h = Number(hoursByRegion[r]) || 0;
    if (h > bestH) { best = r; bestH = h; }
  });
  if (best !== null && bestH > 0) return { region: best, source: "jira" };
  return { region: rosterBucket || CONFIG_DH.REGION_FALLBACK, source: "roster" };
}

// ── BAR OVERFLOW CLAMP (spec §5: clamp at 100% + ⚠ flag) ──────

function clampToCapacity_(hours, capacity) {
  var c = Number(capacity) || 0, h = Number(hours) || 0;
  if (c <= 0) return { pct: null, over: false, realPct: null };
  var real = h / c * 100;
  return { pct: Math.min(100, real), over: real > 100, realPct: real };
}
```

- [ ] **Step 3: Run tests** — `node node-tests.js` → Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Code.js delivery-health-dashboard/node-tests.js
git commit -m "feat(delivery-health): net capacity, region resolution, overflow clamp + tests"
```

---

### Task 5: Pure metric math — utilization rollup, on-time buckets, forecast buckets

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)
- Modify: `delivery-health-dashboard/node-tests.js` (add call lines)

- [ ] **Step 1: Append failing tests**

```js
function _test_utilizationRollup_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_utilizationRollup_: " + m); }
  var people = [
    { name: "A", region: "AMER", teams: ["T1", "T2"],
      weeks: { W1: { avail: 32, billable: 24, tracked: 28, planned: 30 } } },
    { name: "B", region: "EMEA", teams: ["T2"],
      weeks: { W1: { avail: 40, billable: 10, tracked: 20, planned: 40 } } },
    { name: "C", region: "AMER", teams: [],
      weeks: { W1: { avail: 0, billable: 0, tracked: 0, planned: 0 } } }, // full-PTO week
  ];
  var all = utilRollup_(people, "W1", null, null);
  // avail 72, billable 34 → 47.2%
  assert_(Math.abs(all.billablePct - 34 / 72 * 100) < 1e-9, "billable util all");
  assert_(Math.abs(all.trackedPct - 48 / 72 * 100) < 1e-9, "tracked util all");
  var amer = utilRollup_(people, "W1", "AMER", null);
  assert_(amer.avail === 32 && amer.billable === 24, "region filter");
  var t2 = utilRollup_(people, "W1", null, "T2");
  assert_(t2.avail === 72, "team membership filter (A on T1|T2 counts in T2)");
  var t1 = utilRollup_(people, "W1", null, "T1");
  assert_(t1.avail === 32, "single-team filter");
  assert_(utilRollup_(people, "W9", null, null).billablePct === null, "no data week → null");
  Logger.log("✅ _test_utilizationRollup_ passed");
}

function _test_onTimeRate_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_onTimeRate_: " + m); }
  var issues = [
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), region: "AMER", team: "T1" }, // early ✓
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // boundary day ✓
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), region: "EMEA", team: "T2" }, // late ✗
    { due: null,                  resolved: new Date(2026, 6, 30), region: "AMER", team: "T1" }, // no due — excluded
    { due: new Date(2026, 6, 20), resolved: null,                  region: "AMER", team: "T1" }, // unresolved — excluded
  ];
  var buckets = onTimeBuckets_(issues);
  // resolved dates 2026-07-28/29/30 are all ISO 2026.W31
  var a = buckets.filter(function (b) { return b.region === "AMER" && b.team === "T1"; })[0];
  assert_(a.iso === "2026.W31" && a.n === 2 && a.onTime === 2, "AMER/T1: 2 with due, both on time");
  var e = buckets.filter(function (b) { return b.region === "EMEA"; })[0];
  assert_(e.n === 1 && e.onTime === 0, "late issue counted, not on time");
  assert_(buckets.length === 2, "no-due and unresolved rows excluded");
  Logger.log("✅ _test_onTimeRate_ passed");
}

function _test_forecastAccuracy_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_forecastAccuracy_: " + m); }
  var epics = [
    { estSec: 36000, spentSec: 36000, resolved: new Date(2026, 6, 28), region: "AMER", team: "T1" }, // perfect: acc 1
    { estSec: 36000, spentSec: 54000, resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // 50% over: acc .5
    { estSec: 36000, spentSec: 90000, resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // 150% over: acc floored 0
    { estSec: 0,     spentSec: 36000, resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // no estimate — excluded
    { estSec: 36000, spentSec: 36000, resolved: null,                  region: "AMER", team: "T1" }, // unresolved — excluded
  ];
  var buckets = forecastBuckets_(epics);
  assert_(buckets.length === 1, "one bucket");
  var b = buckets[0];
  assert_(b.iso === "2026.W31" && b.n === 3, "3 estimated resolved epics");
  assert_(Math.abs(b.sumAcc - 1.5) < 1e-9, "acc: 1 + 0.5 + 0 (negative floored)");
  Logger.log("✅ _test_forecastAccuracy_ passed");
}
```

Add calls: `_test_utilizationRollup_(); _test_onTimeRate_(); _test_forecastAccuracy_();`

Run: `node node-tests.js` → Expected: FAIL with `utilRollup_ is not defined`

- [ ] **Step 2: Append implementations**

```js
// ── UTILIZATION ROLLUP (also mirrored client-side for filtering) ──

/**
 * Filter-scoped weekly sums. region/team null = All. Team matching is by
 * MEMBERSHIP (multi-team person counts in each of their teams — per-team
 * rates honest; team numbers do not sum to All by design, spec §4).
 * @returns {{avail,billable,tracked,planned,billablePct,trackedPct}}
 */
function utilRollup_(people, iso, region, team) {
  var s = { avail: 0, billable: 0, tracked: 0, planned: 0 };
  people.forEach(function (p) {
    if (region && p.region !== region) return;
    if (team && (p.teams || []).indexOf(team) === -1) return;
    var w = p.weeks && p.weeks[iso];
    if (!w) return;
    s.avail += Number(w.avail) || 0;
    s.billable += Number(w.billable) || 0;
    s.tracked += Number(w.tracked) || 0;
    s.planned += Number(w.planned) || 0;
  });
  s.billablePct = s.avail > 0 ? s.billable / s.avail * 100 : null;
  s.trackedPct = s.avail > 0 ? s.tracked / s.avail * 100 : null;
  return s;
}

// ── JIRA TILE BUCKETS (additive per iso×region×team, spec §11) ──

/** Issues with a Due Date, resolved → per-week on-time buckets. */
function onTimeBuckets_(issues) {
  var map = {};
  issues.forEach(function (it) {
    if (!it.due || !it.resolved || isNaN(it.due.getTime()) || isNaN(it.resolved.getTime())) return;
    var iso = weekKeyFromDate_(it.resolved);
    var region = it.region || "Other", team = it.team || "";
    var k = iso + "\u0001" + region + "\u0001" + team;
    if (!map[k]) map[k] = { iso: iso, region: region, team: team, n: 0, onTime: 0 };
    map[k].n++;
    // On time = resolved on or before the due CALENDAR DAY (time-of-day ignored)
    var d = new Date(it.due.getFullYear(), it.due.getMonth(), it.due.getDate());
    var r = new Date(it.resolved.getFullYear(), it.resolved.getMonth(), it.resolved.getDate());
    if (r <= d) map[k].onTime++;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

/** Estimated, resolved epics → per-week forecast-accuracy buckets. */
function forecastBuckets_(epics) {
  var map = {};
  epics.forEach(function (ep) {
    var est = Number(ep.estSec) || 0;
    if (est <= 0 || !ep.resolved || isNaN(ep.resolved.getTime())) return;
    var spent = Number(ep.spentSec) || 0;
    var acc = Math.max(0, 1 - Math.abs(spent - est) / est);
    var iso = weekKeyFromDate_(ep.resolved);
    var region = ep.region || "Other", team = ep.team || "";
    var k = iso + "\u0001" + region + "\u0001" + team;
    if (!map[k]) map[k] = { iso: iso, region: region, team: team, n: 0, sumAcc: 0 };
    map[k].n++;
    map[k].sumAcc += acc;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}
```

- [ ] **Step 3: Run tests** — `node node-tests.js` → all pass.

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Code.js delivery-health-dashboard/node-tests.js
git commit -m "feat(delivery-health): utilization rollup + on-time/forecast bucket math + tests"
```

---

### Task 6: Cache block (gzip chunked) + roundtrip test

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)
- Modify: `delivery-health-dashboard/node-tests.js` (add call line)

- [ ] **Step 1: Append the cache block** — port verbatim from `project-demand-dashboard/Code.js` lines 254–323 with renames `PD_CACHE_VER→DH_CACHE_VER`, `demandCacheVer_→deliveryCacheVer_`, `bustDemandCache_→bustDeliveryCache_`, `demandCacheKey_→deliveryCacheKey_` (key prefix `"dh_v"`). Keep `cachePutLarge_`/`cacheGetLarge_` names and add above them:

```js
var CACHE_CHUNK_BYTES_ = 90 * 1024; // CacheService hard-fails >100KB per value
```

Then append the test:

```js
function _test_cacheRoundtrip_(cache) {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_cacheRoundtrip_: " + m); }
  var big = JSON.stringify({ people: new Array(4000).fill({ name: "Maria Alvarez", weeks: { "2026.W31": { cap: 40, avail: 32 } } }) });
  assert_(cachePutLarge_(cache, "dh_test", big, 60) === true, "put ok");
  assert_(cacheGetLarge_(cache, "dh_test") === big, "roundtrip identical");
  assert_(cacheGetLarge_(cache, "dh_missing") === null, "missing key → null");
  // Simulate an evicted chunk → whole entry misses cleanly
  var meta = parseInt(cache.get("dh_test_meta"), 10);
  if (meta > 1) { cache.m["dh_test_1"] = null; delete cache.m["dh_test_1"]; }
  else { delete cache.m["dh_test_0"]; }
  assert_(cacheGetLarge_(cache, "dh_test") === null, "missing chunk → clean miss");
  Logger.log("✅ _test_cacheRoundtrip_ passed");
}
```

Add call in node-tests.js: `_test_cacheRoundtrip_(new FakeCache());`

- [ ] **Step 2: Run tests** — `node node-tests.js` → all pass (the `deliveryCacheVer_` function references `PropertiesService`, which is undefined in Node — its `try/catch` returns 1, which is fine; do NOT call it from tests).

- [ ] **Step 3: Commit**

```bash
git add delivery-health-dashboard/Code.js delivery-health-dashboard/node-tests.js
git commit -m "feat(delivery-health): gzip-chunked cache block + roundtrip test"
```

---

### Task 7: Sheet readers — roster, capacity

GAS-only code (SpreadsheetApp) — no Node tests; verified via the `probeDeliverySources()` diagnostic in Task 9's QA. Column lookups are header-name based (never fixed indices).

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)

- [ ] **Step 1: Append shared reader helpers + roster reader**

```js
// ── SHEET READERS (GAS-only; header-name column lookups) ─────

function dhSourceIds_() {
  var p = PropertiesService.getScriptProperties();
  return {
    source: p.getProperty("DH_SOURCE_SS_ID") || CONFIG_DH.SOURCE_SS_ID,
    roster: p.getProperty("DH_ROSTER_SS_ID") || CONFIG_DH.ROSTER_SS_ID,
  };
}

/** Case-insensitive header index lookup; -1 when absent. */
function colIdx_(headers, names) {
  var low = headers.map(function (h) { return normDH_(h); });
  for (var i = 0; i < names.length; i++) {
    var at = low.indexOf(normDH_(names[i]));
    if (at !== -1) return at;
  }
  return -1;
}

function parseDhDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    var d = new Date(v.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Population: active Class=Professional Services / Department=Services from
 * Data + Contractors Data (crew: the Class gate is skipped — their Class is
 * "Contractors"; Department must still be Services).
 * @returns {{ people: Array<{name, keyLocation, rosterBucket, isCrew}>, error?:string }}
 */
function readRosterPeople_() {
  try {
    var ss = SpreadsheetApp.openById(dhSourceIds_().roster);
    var out = [];
    [{ tab: CONFIG_DH.ROSTER_SHEET, crew: false },
     { tab: CONFIG_DH.CONTRACTORS_SHEET, crew: true }].forEach(function (src) {
      var sh = ss.getSheetByName(src.tab);
      if (!sh) { if (!src.crew) throw new Error('Tab "' + src.tab + '" not found'); return; }
      var raw = sh.getDataRange().getValues();
      if (raw.length < 2) return;
      var h = raw[0].map(String);
      var iName = colIdx_(h, ["Full Name", "Employee Name", "Name"]);
      var iStatus = colIdx_(h, ["Status", "Employment Status"]);
      var iClass = colIdx_(h, ["Class"]);
      var iDept = colIdx_(h, ["Department"]);
      var iLoc = colIdx_(h, ["Key Location", "Location"]);
      if (iName === -1) throw new Error('No name column in "' + src.tab + '"');
      for (var r = 1; r < raw.length; r++) {
        var name = String(raw[r][iName] || "").trim();
        if (!name) continue;
        var status = iStatus === -1 ? "active" : normDH_(raw[r][iStatus]);
        if (status && /termin|inactive/.test(status)) continue;
        if (!src.crew && iClass !== -1 &&
            normDH_(raw[r][iClass]) !== normDH_(CONFIG_DH.ROSTER_CLASS)) continue;
        if (iDept !== -1 && normDH_(raw[r][iDept]) !== normDH_(CONFIG_DH.ROSTER_DEPT)) continue;
        var loc = iLoc === -1 ? "" : String(raw[r][iLoc] || "").trim();
        out.push({ name: name, keyLocation: loc,
                   rosterBucket: regionBucketFromLocation_(loc), isCrew: src.crew });
      }
    });
    return { people: out };
  } catch (e) {
    return { people: [], error: "Roster read failed: " + e.message };
  }
}
```

- [ ] **Step 2: Append the capacity reader** (Capacity Tempo: col A = accountId merge key, col B = User, then one column per ISO week label like `2026.W31` in row 1 or 2 — read the header row that contains `.W` labels):

```js
/**
 * Capacity Tempo grid → { normName: { iso: hours } }.
 * Sheet shape (TempoCapacityTime.js): header row carries "YYYY.WN" labels;
 * fixed cols before the week columns include the User column.
 * @returns {{ byName: Object, error?: string }}
 */
function readCapacitySheet_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
      .getSheetByName(CONFIG_DH.CAPACITY_SHEET);
    if (!sh) return { byName: {}, error: 'Tab "' + CONFIG_DH.CAPACITY_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { byName: {} };
    // Find the header row: first row containing a ".W" week label
    var hRow = -1;
    for (var r = 0; r < Math.min(3, raw.length); r++) {
      if (raw[r].some(function (c) { return /^\d{4}\.W\d{1,2}$/.test(String(c).trim()); })) { hRow = r; break; }
    }
    if (hRow === -1) return { byName: {}, error: "No week columns found in Capacity Tempo" };
    var headers = raw[hRow].map(function (c) { return String(c).trim(); });
    var iUser = colIdx_(headers, ["User"]);
    if (iUser === -1) iUser = 1; // TempoCapacityTime.js: User is column B
    var weekCols = [];
    headers.forEach(function (hh, i) { if (/^\d{4}\.W\d{1,2}$/.test(hh)) weekCols.push({ col: i, iso: hh }); });
    var byName = {};
    for (var r2 = hRow + 1; r2 < raw.length; r2++) {
      var user = String(raw[r2][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var key = normDH_(user);
      if (!byName[key]) byName[key] = {};
      weekCols.forEach(function (wc) {
        var v = raw[r2][wc.col];
        if (v !== "" && v !== null && !isNaN(Number(v))) byName[key][wc.iso] = Number(v);
      });
    }
    return { byName: byName };
  } catch (e) {
    return { byName: {}, error: "Capacity read failed: " + e.message };
  }
}
```

- [ ] **Step 3: Syntax gate + full test suite still green**

Run: `node --check Code.js && node node-tests.js`
Expected: exit 0 + all suites pass (readers are not invoked by tests).

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Code.js
git commit -m "feat(delivery-health): roster + capacity sheet readers"
```

---

### Task 8: Sheet readers — tracked (+teams +per-key hours), planned (+PTO), NS Billable, PH, Jira Raw

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)

- [ ] **Step 1: Append tracked + planned readers.** Both Tempo sheets are two-row stacked headers: row 1 = ISO week labels over the week columns, row 2 = fixed col names (`User`, `Team`, `Space`, `Key`, ..., `Logged (hrs)` / planned equivalent) then per-week date labels. Rows repeat per person×issue.

```js
/**
 * Shared Tempo grid reader for Tracked/Planned. Detects the week-label row
 * and the fixed-header row, then aggregates.
 * @returns {{ rows: Array<{user,teamCell,key,weekHours:Object}>, weekIsos:string[], error?:string }}
 */
function readTempoGrid_(sheetName) {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(sheetName);
    if (!sh) return { rows: [], weekIsos: [], error: 'Tab "' + sheetName + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 3) return { rows: [], weekIsos: [] };
    var wkRow = raw[0].map(function (c) { return String(c).trim(); });
    var hdRow = raw[1].map(function (c) { return String(c).trim(); });
    var iUser = colIdx_(hdRow, ["User"]);
    var iTeam = colIdx_(hdRow, ["Team"]);
    var iKey = colIdx_(hdRow, ["Key"]);
    if (iUser === -1) return { rows: [], weekIsos: [], error: 'No "User" column in ' + sheetName };
    var weekCols = [];
    wkRow.forEach(function (w, i) { if (/^\d{4}\.W\d{1,2}$/.test(w)) weekCols.push({ col: i, iso: w }); });
    var rows = [];
    for (var r = 2; r < raw.length; r++) {
      var user = String(raw[r][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var weekHours = {};
      weekCols.forEach(function (wc) {
        var v = Number(raw[r][wc.col]);
        if (v) weekHours[wc.iso] = (weekHours[wc.iso] || 0) + v;
      });
      rows.push({ user: user,
                  teamCell: iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim(),
                  key: iKey === -1 ? "" : String(raw[r][iKey] || "").trim().toUpperCase(),
                  weekHours: weekHours });
    }
    return { rows: rows, weekIsos: weekCols.map(function (w) { return w.iso; }) };
  } catch (e) {
    return { rows: [], weekIsos: [], error: sheetName + " read failed: " + e.message };
  }
}

/** True when a Tempo Key is a NETSUITE/time-off row. */
function isTimeOffKey_(key) {
  return CONFIG_DH.NONPROJECT_KEYS.some(function (k) {
    return String(key || "").toUpperCase().indexOf(k.toUpperCase()) === 0;
  });
}
```

- [ ] **Step 2: Append NS Billable, PH, and Jira Raw readers**

```js
/**
 * NS Billable daily rows → aggregateNsWeeks_ input.
 * Headers: Employee, Employee Type Category, Billable Hours Billed,
 * Billable Hours Unbilled, Total Billable Hours, Non-Billable Hours,
 * Total Hours (B+NB), Date.
 */
function readNsBillable_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.NS_SHEET);
    if (!sh) return { rows: [], error: 'Tab "' + CONFIG_DH.NS_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { rows: [] };
    var h = raw[0].map(String);
    var iEmp = colIdx_(h, ["Employee", "Resource"]);
    var iBill = colIdx_(h, ["Total Billable Hours", "Total Billable"]);
    var iNon = colIdx_(h, ["Non-Billable Hours", "Non-Billable"]);
    var iDate = colIdx_(h, ["Date"]);
    if (iEmp === -1 || iDate === -1 || iBill === -1) {
      return { rows: [], error: "NS Billable: required columns missing" };
    }
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var emp = String(raw[r][iEmp] || "").trim();
      var d = parseDhDate_(raw[r][iDate]);
      if (!emp || !d) continue;
      rows.push({ name: emp, date: d,
                  billable: Number(raw[r][iBill]) || 0,
                  nonBillable: iNon === -1 ? 0 : Number(raw[r][iNon]) || 0 });
    }
    return { rows: rows };
  } catch (e) {
    return { rows: [], error: "NS Billable read failed: " + e.message };
  }
}

/** PH tab (Date | Location | Holiday) → [{date, location}]. */
function readHolidays_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.PH_SHEET);
    if (!sh) return { rows: [] };  // silently off per spec §7
    var raw = sh.getDataRange().getValues();
    var h = raw[0].map(String);
    var iDate = colIdx_(h, ["Date"]), iLoc = colIdx_(h, ["Location"]);
    if (iDate === -1 || iLoc === -1) return { rows: [] };
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var d = parseDhDate_(raw[r][iDate]);
      var loc = String(raw[r][iLoc] || "").trim();
      if (d && loc) rows.push({ date: d, location: loc });
    }
    return { rows: rows };
  } catch (e) { return { rows: [] }; }
}

/**
 * Fuzzy PH-location ↔ roster Key Location matcher — ported verbatim from the
 * demand dashboard's phLocMatchesEmp_ (compound locations split on "&"/"and"/"/",
 * case-insensitive substring both directions, blank never matches).
 */
function phLocMatchesEmp_(phLoc, empLoc) {
  var a = normDH_(phLoc), b = normDH_(empLoc);
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  var parts = a.split(/\s*(?:&|\band\b|\/)\s*/).filter(Boolean);
  return parts.some(function (p) {
    return p.indexOf(b) !== -1 || b.indexOf(p) !== -1;
  });
}

/**
 * Jira Raw → issues + epics for the tile buckets, keyRegion for person-region.
 * Columns by header name: Key(1), Workstream (Issue Type)(3), Resolution Date(11),
 * Due Date(12), Epic Key(17), Original Estimate (sec)(23), Time Spent (sec)(24),
 * Region(32), Team(33). Rows repeat per weekly snapshot — dedupe on Key keeping
 * the LAST occurrence (latest snapshot wins).
 * @returns {{ issues:[], epics:[], keyRegion:Object, available:boolean, error?:string }}
 */
function readJiraRaw_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
    if (!sh) return { issues: [], epics: [], keyRegion: {}, available: false };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { issues: [], epics: [], keyRegion: {}, available: false };
    var h = raw[0].map(String);
    var iKey = colIdx_(h, ["Key"]);
    var iType = colIdx_(h, ["Workstream (Issue Type)", "Issue Type"]);
    var iRes = colIdx_(h, ["Resolution Date", "Resolved"]);
    var iDue = colIdx_(h, ["Due Date"]);
    var iEst = colIdx_(h, ["Original Estimate (sec)"]);
    var iSpent = colIdx_(h, ["Time Spent (sec)"]);
    var iRegion = colIdx_(h, ["Region"]);
    var iTeam = colIdx_(h, ["Team"]);
    if (iKey === -1) return { issues: [], epics: [], keyRegion: {}, available: false };
    var byKey = {};
    for (var r = 1; r < raw.length; r++) {
      var key = String(raw[r][iKey] || "").trim().toUpperCase();
      if (!key) continue;
      byKey[key] = r; // last snapshot wins
    }
    var issues = [], epics = [], keyRegion = {};
    Object.keys(byKey).forEach(function (key) {
      var r = byKey[key];
      var region = iRegion === -1 ? "" : String(raw[r][iRegion] || "").trim();
      var team = iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim();
      if (region) keyRegion[key] = region;
      var rec = {
        due: iDue === -1 ? null : parseDhDate_(raw[r][iDue]),
        resolved: iRes === -1 ? null : parseDhDate_(raw[r][iRes]),
        estSec: iEst === -1 ? 0 : Number(raw[r][iEst]) || 0,
        spentSec: iSpent === -1 ? 0 : Number(raw[r][iSpent]) || 0,
        region: region || "Other", team: team,
      };
      issues.push(rec);
      var type = iType === -1 ? "" : normDH_(raw[r][iType]);
      if (type.indexOf("epic") !== -1) epics.push(rec);
    });
    return { issues: issues, epics: epics, keyRegion: keyRegion, available: true };
  } catch (e) {
    return { issues: [], epics: [], keyRegion: {}, available: false, error: e.message };
  }
}
```

- [ ] **Step 3: Syntax gate + tests still green** — `node --check Code.js && node node-tests.js`

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Code.js
git commit -m "feat(delivery-health): tempo grid, NS billable, PH, Jira Raw readers"
```

---

### Task 9: Model assembly + endpoints + warmer + diagnostics (with pure assembly test)

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (append)
- Modify: `delivery-health-dashboard/node-tests.js` (add call line)

- [ ] **Step 1: Append the failing assembly test** — `assembleModel_` is pure (all reader outputs injected), so the full join logic is Node-testable:

```js
function _test_modelAssembly_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_modelAssembly_: " + m); }
  var win = buildDhWindow_(new Date(2026, 6, 31)); // grid W29–W34, trend W25–W30
  var inputs = {
    roster: { people: [
      { name: "Maria Alvarez", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false },
      { name: "Tom Baker", keyLocation: "Australia & New Zealand", rosterBucket: "ANZ", isCrew: false },
    ] },
    capacity: { byName: { "maria alvarez": { "2026.W31": 40, "2026.W30": 40 } } }, // Tom missing → fallback
    tracked: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1",
        weekHours: { "2026.W30": 20, "2026.W31": 8 } },
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "NETSUITE-TIMEOFF",
        weekHours: { "2026.W31": 8 } },  // tracked time-off excluded from `tracked`
    ] },
    planned: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1",
        weekHours: { "2026.W31": 30 } },
      { user: "Maria Alvarez", teamCell: "", key: "NETSUITE-TIMEOFF",
        weekHours: { "2026.W31": 8 } },  // → PTO 8h in W31
    ] },
    ns: { rows: [
      { name: "Alvarez, Maria", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 },
    ] },
    holidays: { rows: [ { date: new Date(2026, 6, 29), location: "Malaysia" } ] }, // Wed W31, 8h
    jira: { available: true, keyRegion: { "ACME-1": "AMER" },
      issues: [ { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
                  region: "AMER", team: "Squad X", estSec: 0, spentSec: 0 } ],
      epics: [ { estSec: 36000, spentSec: 18000, resolved: new Date(2026, 6, 28),
                 region: "AMER", team: "Squad X" } ] },
  };
  var m = assembleModel_(inputs, win);
  assert_(!m.error, "no fatal error");
  assert_(m.people.length === 2 && m.people[0].name === "Maria Alvarez", "alphabetical people");
  var maria = m.people[0], w31 = maria.weeks["2026.W31"];
  // cap 40, pto 8 (planned NETSUITE), holiday 8h but fully booked → effHol 0, avail 32
  assert_(w31.cap === 40 && w31.pto === 8 && w31.hol === 0 && w31.avail === 32, "net capacity chain");
  assert_(w31.tracked === 8 && w31.planned === 30, "NETSUITE excluded from tracked/planned");
  assert_(w31.billable === 6 && w31.nonBillable === 2, "NS joined via comma-name alias");
  assert_(maria.teams.join("|") === "Team A|Team B", "teams split");
  assert_(maria.region === "AMER" && maria.regionSource === "jira", "region from tracked ACME-1 hours");
  var tom = m.people[1], t31 = tom.weeks["2026.W31"];
  assert_(t31.cap === 38 && t31.capEst === true, "ANZ fallback capacity flagged estimated");
  assert_(tom.region === "ANZ" && tom.regionSource === "roster", "no tracked → roster fallback");
  assert_(m.onTimeBuckets.length === 1 && m.onTimeBuckets[0].onTime === 1, "onTime buckets");
  assert_(m.forecastBuckets.length === 1 && Math.abs(m.forecastBuckets[0].sumAcc - 0.5) < 1e-9, "forecast buckets");
  assert_(m.meta.teams.indexOf("Team A") !== -1 && m.meta.teams.indexOf("Squad X") !== -1, "team dropdown = union");
  assert_(m.meta.headlineIso === "2026.W30" && m.meta.nsAvailable === true && m.meta.jiraAvailable === true, "meta");
  // Degradation: NS missing → nsAvailable false, people still built
  var m2 = assembleModel_(Object.assign({}, inputs, { ns: { rows: [], error: "missing" } }), win);
  assert_(m2.meta.nsAvailable === false && m2.people.length === 2, "NS-off degradation");
  // Fatal: roster error → model.error set
  var m3 = assembleModel_(Object.assign({}, inputs, { roster: { people: [], error: "boom" } }), win);
  assert_(!!m3.error, "roster failure is fatal");
  Logger.log("✅ _test_modelAssembly_ passed");
}
```

Add call: `_test_modelAssembly_();` → Run `node node-tests.js` → FAIL (`assembleModel_ is not defined`).

- [ ] **Step 2: Append `assembleModel_` (pure) + `buildDeliveryModel_` (I/O wrapper):**

```js
// ── MODEL ASSEMBLY (pure — all reader outputs injected) ──────

function assembleModel_(inputs, win) {
  if (inputs.roster.error) {
    return { meta: {}, people: [], onTimeBuckets: [], forecastBuckets: [],
             error: inputs.roster.error };
  }
  var displayNames = inputs.roster.people.map(function (p) { return p.name; });
  var nameIdx = buildNameIndex_(displayNames);
  var byPerson = {}; // display name → accumulator
  inputs.roster.people.forEach(function (p) {
    byPerson[p.name] = { roster: p, teams: [], weeks: {}, regionHours: {} };
  });

  // Tempo tracked/planned rows → per-person weekly sums, team collection,
  // PTO (NETSUITE planned rows), region-tagged hours (tracked keys × Jira Region)
  function eachTempoRow_(row, kind) {
    var dn = resolveName_(nameIdx, row.user);
    if (!dn) return; // not in population — excluded per spec §7
    var acc = byPerson[dn];
    splitTeams_(row.teamCell).forEach(function (t) {
      if (acc.teams.indexOf(t) === -1) acc.teams.push(t);
    });
    var timeOff = isTimeOffKey_(row.key);
    Object.keys(row.weekHours).forEach(function (iso) {
      if (win.allWeeks.indexOf(iso) === -1) return;
      if (!acc.weeks[iso]) acc.weeks[iso] = { pto: 0, planned: 0, tracked: 0 };
      var h = row.weekHours[iso];
      if (kind === "planned") {
        if (timeOff) acc.weeks[iso].pto += h;
        else acc.weeks[iso].planned += h;
      } else if (!timeOff) {
        acc.weeks[iso].tracked += h;
        var region = inputs.jira.keyRegion[row.key];
        if (region) acc.regionHours[region] = (acc.regionHours[region] || 0) + h;
      }
    });
  }
  inputs.planned.rows.forEach(function (r) { eachTempoRow_(r, "planned"); });
  inputs.tracked.rows.forEach(function (r) { eachTempoRow_(r, "tracked"); });

  // NS billable weekly aggregation, joined through the alias index
  var nsAvailable = !inputs.ns.error;
  var nsWeekly = aggregateNsWeeks_(inputs.ns.rows.map(function (r) {
    var dn = resolveName_(nameIdx, r.name);
    return dn ? { name: dn, date: r.date, billable: r.billable, nonBillable: r.nonBillable } : null;
  }).filter(Boolean));

  // Holiday hours per person-week (fuzzy location match, per-day hours by region)
  var holByPersonWeek = {}; // dn → iso → hrs
  inputs.holidays.rows.forEach(function (hrow) {
    var iso = weekKeyFromDate_(hrow.date);
    if (win.allWeeks.indexOf(iso) === -1) return;
    inputs.roster.people.forEach(function (p) {
      if (!phLocMatchesEmp_(hrow.location, p.keyLocation)) return;
      var perDay = normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
        ? CONFIG_DH.ANZ_HOLIDAY_HRS_PER_DAY : CONFIG_DH.HOLIDAY_HRS_PER_DAY;
      if (!holByPersonWeek[p.name]) holByPersonWeek[p.name] = {};
      holByPersonWeek[p.name][iso] = (holByPersonWeek[p.name][iso] || 0) + perDay;
    });
  });

  // Assemble people records
  var capMap = inputs.capacity.byName || {};
  var teamSet = {};
  var people = displayNames.slice().sort(function (a, b) {
    return a.localeCompare(b);
  }).map(function (dn) {
    var acc = byPerson[dn], p = acc.roster;
    var reg = assignPersonRegion_(acc.regionHours, p.rosterBucket);
    acc.teams.forEach(function (t) { teamSet[t] = 1; });
    var weeks = {};
    win.allWeeks.forEach(function (iso) {
      var w = acc.weeks[iso] || { pto: 0, planned: 0, tracked: 0 };
      var capCell = capMap[normDH_(dn)] ? capMap[normDH_(dn)][iso] : undefined;
      var capEst = capCell === undefined;
      var cap = capEst
        ? (normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
            ? CONFIG_DH.ANZ_CAPACITY_HRS : CONFIG_DH.WEEKLY_CAPACITY_HRS)
        : capCell;
      var holHrs = (holByPersonWeek[dn] && holByPersonWeek[dn][iso]) || 0;
      var net = netCapacity_(cap, w.pto, holHrs);
      var ns = (nsWeekly[normDH_(dn)] && nsWeekly[normDH_(dn)][iso]) || { billable: 0, nonBillable: 0 };
      weeks[iso] = { cap: cap, capEst: capEst, pto: w.pto, hol: net.hol, avail: net.avail,
                     planned: w.planned, tracked: w.tracked,
                     billable: nsAvailable ? ns.billable : 0,
                     nonBillable: nsAvailable ? ns.nonBillable : 0 };
    });
    return { name: dn, region: reg.region, regionSource: reg.source,
             teams: acc.teams.slice().sort(), isCrew: p.isCrew, weeks: weeks };
  });

  // Jira buckets (already deduped issues/epics)
  var onTime = inputs.jira.available ? onTimeBuckets_(inputs.jira.issues) : [];
  var forecast = inputs.jira.available ? forecastBuckets_(inputs.jira.epics) : [];
  onTime.concat(forecast).forEach(function (b) { if (b.team) teamSet[b.team] = 1; });

  return {
    meta: {
      gridWeeks: win.gridWeeks, trendWeeks: win.trendWeeks, headlineIso: win.headlineIso,
      generatedAt: new Date().toISOString(),
      thresholds: { green: CONFIG_DH.TINT_GREEN, amber: CONFIG_DH.TINT_AMBER },
      regions: ["AMER", "EMEA", "APAC", "ANZ", "Other"],
      teams: Object.keys(teamSet).sort(),
      nsAvailable: nsAvailable, jiraAvailable: !!inputs.jira.available,
      capacityError: inputs.capacity.error || null,
    },
    people: people, onTimeBuckets: onTime, forecastBuckets: forecast,
  };
}

/** Full I/O compute — shared by getDeliveryData and warmDeliveryCache. */
function buildDeliveryModel_() {
  var win = buildDhWindow_(new Date());
  return assembleModel_({
    roster: readRosterPeople_(),
    capacity: readCapacitySheet_(),
    tracked: readTempoGrid_(CONFIG_DH.TRACKED_SHEET),
    planned: readTempoGrid_(CONFIG_DH.PLANNED_SHEET),
    ns: readNsBillable_(),
    holidays: readHolidays_(),
    jira: readJiraRaw_(),
  }, win);
}
```

- [ ] **Step 3: Append endpoints, warmer, diagnostics** (clone shape from demand Code.js):

```js
// ── ENTRY POINT + DATA ENDPOINT ──────────────────────────────

function doGet() {
  var access = checkDeliveryAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle(CONFIG_DH.TITLE + " — Access Restricted");
  }
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle(CONFIG_DH.TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getDeliveryData(forceRefresh) {
  var access = checkDeliveryAccess();
  if (!access.allowed) {
    return { error: "Access restricted to authorized users.", meta: {}, people: [] };
  }
  var cache = CacheService.getScriptCache();
  var key = deliveryCacheKey_();
  if (!forceRefresh) {
    var hit = cacheGetLarge_(cache, key);
    if (hit) {
      try {
        var cached = JSON.parse(hit);
        cached.viewerRole = access.role;
        cached.viewerEmail = access.email;
        return cached;
      } catch (e) { Logger.log("⚠️ getDeliveryData: bad cache entry — recomputing"); }
    }
  }
  var model = buildDeliveryModel_();
  if (!model.error) cachePutLarge_(cache, key, JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
  model.viewerRole = access.role;
  model.viewerEmail = access.email;
  return model;
}

// ── CACHE WARMER ─────────────────────────────────────────────

function warmDeliveryCache() {
  var s0 = Date.now();
  var model = buildDeliveryModel_();
  var secs = Math.round((Date.now() - s0) / 1000);
  if (model.error) { Logger.log("❌ warmDeliveryCache after " + secs + "s: " + model.error); return; }
  var ok = cachePutLarge_(CacheService.getScriptCache(), deliveryCacheKey_(),
                          JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
  Logger.log(ok ? "✅ warmDeliveryCache: rebuilt in " + secs + "s"
                : "❌ warmDeliveryCache: compute ok but cache write failed");
}

function setupDeliveryCacheWarmer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "warmDeliveryCache"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("warmDeliveryCache").timeBased()
    .everyMinutes(CONFIG_DH.CACHE_WARM_EVERY_MIN).create();
  Logger.log("✅ Delivery cache warmer installed — every " + CONFIG_DH.CACHE_WARM_EVERY_MIN + " min");
}

// ── DIAGNOSTICS (run once in the GAS editor after deploy) ────

/** Verifies every source is reachable and logs shape + join coverage. */
function probeDeliverySources() {
  var r = readRosterPeople_();
  Logger.log("Roster: " + r.people.length + " people" + (r.error ? " — ❌ " + r.error : ""));
  var c = readCapacitySheet_();
  Logger.log("Capacity: " + Object.keys(c.byName).length + " users" + (c.error ? " — ⚠️ " + c.error : ""));
  var t = readTempoGrid_(CONFIG_DH.TRACKED_SHEET);
  Logger.log("Tracked: " + t.rows.length + " rows / weeks " + t.weekIsos.join(",")); 
  var p = readTempoGrid_(CONFIG_DH.PLANNED_SHEET);
  Logger.log("Planned: " + p.rows.length + " rows");
  var ns = readNsBillable_();
  Logger.log("NS Billable: " + ns.rows.length + " rows" + (ns.error ? " — ⚠️ " + ns.error : ""));
  if (ns.rows.length) Logger.log("NS sample Employee: \"" + ns.rows[0].name + "\" (verify name format — spec §10.1)");
  var j = readJiraRaw_();
  Logger.log("Jira Raw: available=" + j.available + ", issues=" + j.issues.length + ", epics=" + j.epics.length);
  var idx = buildNameIndex_(r.people.map(function (x) { return x.name; }));
  var nsMatched = ns.rows.filter(function (row) { return resolveName_(idx, row.name); }).length;
  Logger.log("NS→roster join: " + nsMatched + "/" + ns.rows.length + " rows matched");
}

/** Spec §10.5 — Jira Raw fill-rate audit. Run once before trusting the tiles. */
function auditJiraFillRates() {
  var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
  if (!sh) { Logger.log("❌ Jira Raw tab not found"); return; }
  var raw = sh.getDataRange().getValues();
  var h = raw[0].map(String);
  ["Due Date", "Original Estimate (sec)", "Region", "Team"].forEach(function (col) {
    var i = colIdx_(h, [col]);
    if (i === -1) { Logger.log("❌ column missing: " + col); return; }
    var filled = 0;
    for (var r = 1; r < raw.length; r++) if (String(raw[r][i] || "").trim()) filled++;
    Logger.log(col + ": " + filled + "/" + (raw.length - 1) + " filled (" +
               Math.round(filled / (raw.length - 1) * 100) + "%)");
  });
}
```

- [ ] **Step 4: Run tests** — `node node-tests.js` → all pass including `_test_modelAssembly_`.

- [ ] **Step 5: Commit**

```bash
git add delivery-health-dashboard/Code.js delivery-health-dashboard/node-tests.js
git commit -m "feat(delivery-health): model assembly + endpoints + warmer + diagnostics, assembly test"
```

---

### Task 10: Dashboard.html — skeleton, theme, data load, filters

**Files:**
- Create: `delivery-health-dashboard/Dashboard.html`

- [ ] **Step 1: Create the HTML skeleton.** Copy the `:root`/`[data-theme="dark"]`/`--scale` CSS custom-property block verbatim from `project-demand-dashboard/Dashboard.html` (lines 9–37) — same palette, same responsive scale tokens. Then this structure (complete file skeleton; later tasks fill the marked sections):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
/* [PASTE the :root / dark-theme / --scale block from demand Dashboard.html here] */
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Roboto',-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);padding:calc(16px*var(--scale))}
.hdr{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.hdr h1{font-size:calc(19px*var(--scale));font-weight:800}
.hdr .sub{color:var(--muted);font-size:calc(12px*var(--scale))}
.btn{background:var(--surface);border:1px solid var(--border);border-radius:8px;
     padding:6px 12px;font-size:calc(12px*var(--scale));cursor:pointer;color:var(--text)}
.btn:hover{filter:brightness(.97)}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chip{border:1px solid var(--border);border-radius:999px;padding:4px 12px;cursor:pointer;
      font-size:calc(11px*var(--scale));background:var(--surface)}
.chip.on{background:var(--orbe);border-color:var(--orbe);color:#fff}
select,input[type=search]{background:var(--surface);border:1px solid var(--border);
      border-radius:8px;padding:6px 10px;font-size:calc(12px*var(--scale));color:var(--text)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:16px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;
       padding:14px;box-shadow:var(--shadow)}
.loading{padding:60px;text-align:center;color:var(--muted)}
/* grid + tile CSS appended in Tasks 11–13 */
</style>
</head>
<body>
<div class="hdr">
  <h1>Delivery Health</h1>
  <span class="sub" id="asOf"></span>
  <span style="flex:1"></span>
  <div class="chips" id="regionChips"></div>
  <select id="teamSel"><option value="">All teams</option></select>
  <input type="search" id="personSearch" placeholder="Find person…">
  <button class="btn" id="btnRefresh">↻ Refresh</button>
  <button class="btn" id="btnAccess" style="display:none">🔒 Access</button>
  <button class="btn" id="btnTheme">🌓</button>
</div>

<div id="loading" class="loading">Loading delivery health…</div>
<div id="app" style="display:none">
  <div class="tiles" id="tiles"></div>
  <div class="panel" id="gridPanel"></div>
</div>
<div id="accessPanel" class="panel" style="display:none;margin-top:14px"></div>

<script>
var MODEL = null;
var STATE = { region: "", team: "", search: "", expandedWeeks: {}, openDetail: {} };

function loadData(force) {
  document.getElementById("loading").style.display = "";
  document.getElementById("app").style.display = "none";
  google.script.run
    .withSuccessHandler(function (m) {
      if (m.error) { document.getElementById("loading").textContent = "⚠️ " + m.error; return; }
      MODEL = m;
      document.getElementById("loading").style.display = "none";
      document.getElementById("app").style.display = "";
      document.getElementById("asOf").textContent =
        "Data as of " + new Date(m.meta.generatedAt).toLocaleTimeString();
      if (m.viewerRole === "admin") document.getElementById("btnAccess").style.display = "";
      buildFilters_();
      renderAll_();
    })
    .withFailureHandler(function (e) {
      document.getElementById("loading").textContent = "⚠️ Load failed: " + e.message;
    })
    .getDeliveryData(!!force);
}

function buildFilters_() {
  var rc = document.getElementById("regionChips");
  rc.innerHTML = "";
  ["", ].concat(MODEL.meta.regions).forEach(function (r) {
    var b = document.createElement("span");
    b.className = "chip" + ((STATE.region === r) ? " on" : "");
    b.textContent = r === "" ? "All regions" : r;
    b.onclick = function () { STATE.region = r; buildFilters_(); renderAll_(); };
    rc.appendChild(b);
  });
  var sel = document.getElementById("teamSel");
  if (sel.options.length <= 1) {
    MODEL.meta.teams.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t; o.textContent = t; sel.appendChild(o);
    });
  }
}

/** People passing the active Region/Team/search filters. */
function filteredPeople_() {
  return MODEL.people.filter(function (p) {
    if (STATE.region && p.region !== STATE.region) return false;
    if (STATE.team && p.teams.indexOf(STATE.team) === -1) return false;
    if (STATE.search && p.name.toLowerCase().indexOf(STATE.search.toLowerCase()) === -1) return false;
    return true;
  });
}

function renderAll_() {
  renderTiles_();   // Task 11
  renderGrid_();    // Tasks 12–13
}

document.getElementById("btnRefresh").onclick = function () { loadData(true); };
document.getElementById("teamSel").onchange = function () { STATE.team = this.value; renderAll_(); };
document.getElementById("personSearch").oninput = function () { STATE.search = this.value; renderGrid_(); };
document.getElementById("btnTheme").onclick = function () {
  var root = document.documentElement;
  root.setAttribute("data-theme", root.getAttribute("data-theme") === "dark" ? "" : "dark");
};
document.getElementById("btnAccess").onclick = function () { toggleAccessPanel_(); }; // Task 14

function renderTiles_() {} // replaced in Task 11
function renderGrid_() {}  // replaced in Task 12
function toggleAccessPanel_() {} // replaced in Task 14

loadData(false);
</script>
</body>
</html>
```

- [ ] **Step 2: Visual smoke check** — open the file raw in a browser (`start Dashboard.html` on Windows). `google.script` is undefined outside GAS, so expect the loading line to stay — the check is that the header, chips, and controls render styled with no console syntax errors (open DevTools; only the `google is not defined` error is acceptable).

- [ ] **Step 3: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html
git commit -m "feat(delivery-health): Dashboard.html skeleton — theme, load, region/team/search filters"
```

---

### Task 11: Tile row — 4 tiles with trend sparklines + placeholder

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html`

- [ ] **Step 1: Add tile CSS** (append inside the `<style>` block):

```css
.tile{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.tile .lbl{font-size:calc(10px*var(--scale));color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.tile .big{font-size:calc(26px*var(--scale));font-weight:800;margin:2px 0}
.tile .big.g{color:var(--pos)} .tile .big.a{color:var(--amber)} .tile .big.r{color:var(--warn)}
.tile .cmp{font-size:calc(11px*var(--scale));color:var(--muted)}
.tile.ph{opacity:.55;border-style:dashed}
.spark{display:flex;align-items:flex-end;gap:2px;height:26px;margin-top:6px}
.spark i{flex:1;background:var(--orbe);border-radius:2px 2px 0 0;min-height:2px}
```

- [ ] **Step 2: Replace the `renderTiles_` stub with the real renderer.** All rollups are client-side so filters apply instantly:

```js
function ragClass_(pct) {
  if (pct === null || pct === undefined) return "";
  var t = MODEL.meta.thresholds;
  return pct >= t.green ? "g" : (pct >= t.amber ? "a" : "r");
}

/** Utilization rollup over the filtered people for one week (mirrors server utilRollup_). */
function utilFor_(iso) {
  var s = { avail: 0, billable: 0, tracked: 0 };
  filteredPeople_().forEach(function (p) {
    var w = p.weeks[iso];
    if (!w) return;
    s.avail += w.avail; s.billable += w.billable; s.tracked += w.tracked;
  });
  s.billablePct = s.avail > 0 ? s.billable / s.avail * 100 : null;
  s.trackedPct = s.avail > 0 ? s.tracked / s.avail * 100 : null;
  return s;
}

/** Filter-scoped sums over additive Jira buckets for one week. */
function bucketsFor_(buckets, iso) {
  var out = { n: 0, onTime: 0, sumAcc: 0 };
  buckets.forEach(function (b) {
    if (b.iso !== iso) return;
    if (STATE.region && b.region !== STATE.region) return;
    if (STATE.team && b.team !== STATE.team) return;
    out.n += b.n; out.onTime += (b.onTime || 0); out.sumAcc += (b.sumAcc || 0);
  });
  return out;
}

function sparkHtml_(vals) {
  var max = Math.max.apply(null, vals.map(function (v) { return v === null ? 0 : v; }).concat([1]));
  return '<div class="spark">' + vals.map(function (v) {
    var h = v === null ? 2 : Math.max(2, Math.round(v / max * 26));
    return '<i style="height:' + h + 'px" title="' + (v === null ? "–" : Math.round(v) + "%") + '"></i>';
  }).join("") + "</div>";
}

function tileHtml_(label, headlinePct, cmpText, trendVals, opts) {
  opts = opts || {};
  if (opts.placeholder) {
    return '<div class="tile ph"><div class="lbl">' + label + '</div>' +
      '<div class="big">—</div><div class="cmp">data pending — reopen/CSAT feed not yet connected</div></div>';
  }
  if (opts.unavailable) {
    return '<div class="tile ph"><div class="lbl">' + label + '</div>' +
      '<div class="big">—</div><div class="cmp">' + opts.unavailable + '</div></div>';
  }
  var big = headlinePct === null ? "—" : Math.round(headlinePct) + "%";
  return '<div class="tile"><div class="lbl">' + label + " · " + MODEL.meta.headlineIso + '</div>' +
    '<div class="big ' + ragClass_(headlinePct) + '">' + big + '</div>' +
    '<div class="cmp">' + cmpText + '</div>' + sparkHtml_(trendVals) + '</div>';
}

function renderTiles_() {
  var tw = MODEL.meta.trendWeeks, hi = MODEL.meta.headlineIso;
  var u = utilFor_(hi);
  var utilTrend = tw.map(function (w) { return utilFor_(w).billablePct; });
  var utilCmp = MODEL.meta.nsAvailable
    ? "tracked/capacity " + (u.trackedPct === null ? "—" : Math.round(u.trackedPct) + "%")
    : "billable data unavailable — showing tracked/capacity";
  var utilHeadline = MODEL.meta.nsAvailable ? u.billablePct : u.trackedPct;
  var utilTrendShown = MODEL.meta.nsAvailable ? utilTrend
    : tw.map(function (w) { return utilFor_(w).trackedPct; });

  var ot = bucketsFor_(MODEL.onTimeBuckets, hi);
  var otTrend = tw.map(function (w) {
    var b = bucketsFor_(MODEL.onTimeBuckets, w);
    return b.n > 0 ? b.onTime / b.n * 100 : null;
  });
  var fc = bucketsFor_(MODEL.forecastBuckets, hi);
  var fcTrend = tw.map(function (w) {
    var b = bucketsFor_(MODEL.forecastBuckets, w);
    return b.n > 0 ? b.sumAcc / b.n * 100 : null;
  });

  document.getElementById("tiles").innerHTML =
    tileHtml_("Billable Utilization", utilHeadline, utilCmp, utilTrendShown) +
    (MODEL.meta.jiraAvailable
      ? tileHtml_("On-Time Delivery", ot.n > 0 ? ot.onTime / ot.n * 100 : null,
                  ot.n + " resolved with due date", otTrend) +
        tileHtml_("Forecast Accuracy", fc.n > 0 ? fc.sumAcc / fc.n * 100 : null,
                  fc.n + " estimated epics closed", fcTrend)
      : tileHtml_("On-Time Delivery", null, "", [], { unavailable: "Jira data unavailable" }) +
        tileHtml_("Forecast Accuracy", null, "", [], { unavailable: "Jira data unavailable" })) +
    tileHtml_("Quality / Rework", null, "", [], { placeholder: true });
}
```

- [ ] **Step 2b: Add the multi-team rollup note** — append to `renderTiles_` before closing, an ⓘ line under the tiles container (spec §4): create once in HTML below `#tiles`:

```html
<div class="sub" style="margin:-10px 0 14px;color:var(--muted);font-size:11px">
  ⓘ Team rates are membership-based — multi-team people count in each of their teams, so team figures don't sum to All.
</div>
```

- [ ] **Step 3: Browser smoke** — same raw-file check as Task 10 (tiles won't render without data; verify no console syntax errors).

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html
git commit -m "feat(delivery-health): 4-tile row — utilization/on-time/forecast + rework placeholder"
```

---

### Task 12: People grid — collapsed cells with RAG tint + week expansion

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html`

- [ ] **Step 1: Add grid CSS**

```css
.gwrap{overflow-x:auto}
table.grid{width:100%;border-collapse:collapse;font-size:calc(12px*var(--scale))}
.grid th{font-size:calc(10px*var(--scale));color:var(--muted);text-transform:uppercase;
  letter-spacing:.04em;padding:8px;text-align:center;cursor:pointer;user-select:none;white-space:nowrap}
.grid th.now{border-bottom:2px solid var(--orbe);color:var(--orbe)}
.grid th.plan,.grid td.plan{opacity:.75}
.grid td{padding:6px 8px;border-top:1px solid var(--border);text-align:center;white-space:nowrap}
.grid td.name{text-align:left;font-weight:600;min-width:150px}
.grid td.tG{background:rgba(31,138,87,.14)} .grid td.tA{background:rgba(180,83,9,.14)}
.grid td.tR{background:rgba(194,65,12,.16)}
.grid th.exp{background:var(--surface-2)}
.bar{position:relative;height:16px;min-width:160px;border:1px solid var(--border);
     border-radius:4px;overflow:hidden;display:flex;cursor:pointer}
.bar .sB{background:var(--void)} .bar .sN{background:var(--slate)}
.bar .sI{background:var(--neutral)}
.bar .sO{background:repeating-linear-gradient(45deg,var(--june),var(--june) 4px,rgba(255,155,135,.35) 4px,rgba(255,155,135,.35) 8px)}
.planTick{position:absolute;top:-6px;font-size:9px;color:var(--royal);transform:translateX(-50%)}
.warnFlag{color:var(--warn);font-weight:700;margin-left:4px}
.cellSub{font-size:9px;color:var(--muted)}
```

- [ ] **Step 2: Replace the `renderGrid_` stub.** Collapsed cell = capacity hours + billable-util tint (done/now weeks only); clicking a week **header** toggles that column into stacked-bar mode; clicking a **bar** toggles the accordion (Task 13):

```js
function tintClass_(w, status) {
  if (status === "plan" || !MODEL.meta.nsAvailable || !w || w.avail <= 0) return "";
  var pct = w.billable / w.avail * 100;
  var t = MODEL.meta.thresholds;
  return pct >= t.green ? "tG" : (pct >= t.amber ? "tA" : "tR");
}

/** Stacked-bar HTML for one person-week (spec §5): segments over capacity width. */
function barHtml_(pName, iso, w, status) {
  if (!w || w.cap <= 0) return '<span class="cellSub">no schedule</span>';
  var cap = w.cap;
  var ooo = Math.min(cap, w.pto + w.hol);
  var isFuture = status === "plan";
  var billable = isFuture ? 0 : Math.min(w.billable, cap);
  var nonBill = isFuture ? 0 : Math.min(Math.max(0, w.tracked - w.billable), cap - billable);
  var idle = Math.max(0, cap - billable - nonBill - ooo);
  function pc(h) { return (h / cap * 100).toFixed(1) + "%"; }
  var plan = clampPct_(w.planned, cap);
  var trackedOver = !isFuture && w.tracked > cap;
  return '<div style="position:relative;padding-top:8px">' +
    (w.planned > 0 ? '<span class="planTick" style="left:' + plan.pct + '%">▼</span>' : "") +
    '<div class="bar" data-p="' + encodeURIComponent(pName) + '" data-w="' + iso + '" onclick="toggleDetail_(this)">' +
      '<div class="sB" style="width:' + pc(billable) + '"></div>' +
      '<div class="sN" style="width:' + pc(nonBill) + '"></div>' +
      '<div class="sI" style="width:' + pc(idle) + '"></div>' +
      '<div class="sO" style="width:' + pc(ooo) + '"></div>' +
    '</div>' +
    ((plan.over || trackedOver) ? '<span class="warnFlag" title="' +
      (plan.over ? "planned " + Math.round(plan.realPct) + "% of capacity " : "") +
      (trackedOver ? "tracked " + Math.round(w.tracked / cap * 100) + "% of capacity" : "") +
      '">⚠</span>' : "") +
    '</div>';
}

/** Client-side twin of the server clampToCapacity_. */
function clampPct_(hours, capacity) {
  if (!capacity || capacity <= 0) return { pct: 0, over: false, realPct: 0 };
  var real = hours / capacity * 100;
  return { pct: Math.min(100, real), over: real > 100, realPct: real };
}

function renderGrid_() {
  var weeks = MODEL.meta.gridWeeks;
  var html = '<div class="gwrap"><table class="grid"><tr><th style="text-align:left">Person</th>';
  weeks.forEach(function (wk) {
    var exp = STATE.expandedWeeks[wk.iso];
    html += '<th class="' + wk.status + (exp ? " exp" : "") + '" onclick="toggleWeek_(\'' + wk.iso + '\')" ' +
      'title="Click to ' + (exp ? "collapse" : "expand") + '">' + wk.iso + (exp ? " ▾" : " ▸") + "</th>";
  });
  html += "</tr>";
  filteredPeople_().forEach(function (p) {
    html += '<tr><td class="name">' + p.name +
      (p.regionSource === "roster" ? ' <span class="cellSub" title="region from roster location (no region-tagged work)">◦</span>' : "") +
      "</td>";
    weeks.forEach(function (wk) {
      var w = p.weeks[wk.iso];
      if (STATE.expandedWeeks[wk.iso]) {
        html += '<td class="' + wk.status + '">' + barHtml_(p.name, wk.iso, w, wk.status) + "</td>";
      } else {
        html += '<td class="' + wk.status + " " + tintClass_(w, wk.status) + '">' +
          (w ? Math.round(w.cap) : "—") + "</td>";
      }
    });
    html += "</tr>";
    var key = p.name + "\u0001";
    weeks.forEach(function (wk) {
      if (STATE.openDetail[key + wk.iso]) html += detailRowHtml_(p, wk.iso, weeks.length);
    });
  });
  html += "</table></div>";
  document.getElementById("gridPanel").innerHTML = html;
}

function toggleWeek_(iso) {
  STATE.expandedWeeks[iso] = !STATE.expandedWeeks[iso];
  renderGrid_();
}

function toggleDetail_(el) {
  var key = decodeURIComponent(el.getAttribute("data-p")) + "\u0001" + el.getAttribute("data-w");
  STATE.openDetail[key] = !STATE.openDetail[key];
  renderGrid_();
}

function detailRowHtml_(p, iso, nWeeks) { return ""; } // replaced in Task 13
```

- [ ] **Step 3: Browser smoke** — raw-file check: no console syntax errors.

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html
git commit -m "feat(delivery-health): people grid — tinted collapsed cells, expandable week columns, stacked bars"
```

---

### Task 13: Inline accordion detail (bullet lines + 4 stats)

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html`

- [ ] **Step 1: Add accordion CSS**

```css
tr.detail td{background:var(--surface-2);padding:12px 16px 14px;text-align:left}
.stats{display:flex;gap:18px;flex-wrap:wrap;font-size:calc(12px*var(--scale));margin-bottom:10px}
.stats b{font-size:calc(14px*var(--scale))}
.blbl{font-size:calc(9px*var(--scale));color:var(--muted);text-transform:uppercase;margin:6px 0 2px}
.btrack{position:relative;height:10px;background:var(--orbe);border-radius:3px;max-width:360px}
.btrack .ooo{position:absolute;right:0;top:0;height:100%;border-radius:0 3px 3px 0;
  background:repeating-linear-gradient(45deg,var(--june),var(--june) 4px,rgba(255,155,135,.35) 4px,rgba(255,155,135,.35) 8px)}
.bline{height:8px;border-radius:3px;max-width:360px;display:flex;overflow:hidden}
.bline .b{background:var(--void)} .bline .n{background:var(--slate)}
.bplanned{height:8px;background:var(--royal);border-radius:3px;max-width:360px;opacity:.85}
```

- [ ] **Step 2: Replace the `detailRowHtml_` stub:**

```js
function pctStr_(num, den) {
  return den > 0 ? Math.round(num / den * 100) + "%" : "—";
}

function detailRowHtml_(p, iso, nWeeks) {
  var w = p.weeks[iso];
  if (!w) return "";
  var isFuture = MODEL.meta.gridWeeks.some(function (g) { return g.iso === iso && g.status === "plan"; });
  var maxW = 360; // px at 100% = capacity
  function px(h) { return w.cap > 0 ? Math.min(maxW, h / w.cap * maxW) : 0; }
  var oooH = w.pto + w.hol;
  var stats =
    '<div class="stats">' +
    '<span><b>' + (MODEL.meta.nsAvailable && !isFuture ? pctStr_(w.billable, w.avail) : "—") +
      '</b> <span class="cellSub">billable util (' + r1_(w.billable) + "/" + r1_(w.avail) + ')</span></span>' +
    '<span><b>' + (isFuture ? "—" : pctStr_(w.tracked, w.avail)) +
      '</b> <span class="cellSub">tracked/capacity (' + r1_(w.tracked) + "/" + r1_(w.avail) + ')</span></span>' +
    '<span><b>' + (isFuture ? "—" : pctStr_(w.tracked, w.planned)) +
      '</b> <span class="cellSub">tracked/planned (' + r1_(w.tracked) + "/" + r1_(w.planned) + ')</span></span>' +
    '<span><b>' + r1_(oooH) + "h</b> <span class=\"cellSub\">OOO (PTO " + r1_(w.pto) +
      " · Hol " + r1_(w.hol) + ")</span></span>" +
    (w.capEst ? '<span class="cellSub">⚠ capacity estimated (no Tempo schedule row)</span>' : "") +
    "</div>";
  var bullets =
    '<div class="blbl">CAPACITY ' + r1_(w.cap) + "h − OOO " + r1_(oooH) + "h = " + r1_(w.avail) + "h available</div>" +
    '<div class="btrack"><div class="ooo" style="width:' + (w.cap > 0 ? Math.min(100, oooH / w.cap * 100) : 0) + '%"></div></div>' +
    '<div class="blbl">PLANNED ' + r1_(w.planned) + "h</div>" +
    '<div class="bplanned" style="width:' + px(w.planned) + 'px"></div>' +
    (isFuture ? "" :
      '<div class="blbl">TRACKED ' + r1_(w.tracked) + "h — billable " + r1_(w.billable) +
      " / non-bill " + r1_(w.nonBillable) + "</div>" +
      '<div class="bline" style="width:' + px(w.tracked) + 'px">' +
        '<div class="b" style="width:' + (w.tracked > 0 ? w.billable / w.tracked * 100 : 0) + '%"></div>' +
        '<div class="n" style="flex:1"></div></div>');
  return '<tr class="detail"><td colspan="' + (nWeeks + 1) + '">' +
    "<b>" + p.name + " — " + iso + "</b> <span class=\"cellSub\">" +
    p.region + (p.regionSource === "roster" ? " (roster)" : "") +
    (p.teams.length ? " · " + p.teams.join(", ") : "") + "</span>" +
    stats + bullets + "</td></tr>";
}

function r1_(v) { return Math.round((Number(v) || 0) * 10) / 10; }
```

- [ ] **Step 3: Browser smoke** — raw-file check: no console syntax errors.

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html
git commit -m "feat(delivery-health): inline accordion detail — 4 stats + bullet-line comparisons"
```

---

### Task 14: Access panel + README + deploy runbook

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html`
- Create: `delivery-health-dashboard/README.md`

- [ ] **Step 1: Replace the `toggleAccessPanel_` stub** (same UX as the demand dashboard's 🔒 panel):

```js
function toggleAccessPanel_() {
  var panel = document.getElementById("accessPanel");
  if (panel.style.display !== "none") { panel.style.display = "none"; return; }
  panel.style.display = "";
  panel.innerHTML = "Loading access settings…";
  google.script.run.withSuccessHandler(function (s) {
    panel.innerHTML =
      "<h3>🔒 Access Control</h3>" +
      '<p class="cellSub">Bootstrap admin: ' + s.bootstrapAdmin + " (not removable)</p>" +
      '<div class="blbl">ADMINS (comma-separated)</div>' +
      '<input id="accAdmins" style="width:100%" value="' + s.admins.join(", ") + '">' +
      '<div class="blbl">VIEWERS (directs and above — comma-separated)</div>' +
      '<input id="accViewers" style="width:100%" value="' + s.viewers.join(", ") + '">' +
      '<label style="display:block;margin:10px 0"><input type="checkbox" id="accOpen"' +
        (s.openAccess ? " checked" : "") + "> Open access (demo only)</label>" +
      '<button class="btn" onclick="saveAccess_()">Save</button> <span id="accMsg"></span>';
  }).withFailureHandler(function (e) { panel.innerHTML = "⚠️ " + e.message; })
    .getDeliveryAccessSettings();
}

function saveAccess_() {
  var msg = document.getElementById("accMsg");
  msg.textContent = "Saving…";
  google.script.run.withSuccessHandler(function () { msg.textContent = "✅ Saved"; })
    .withFailureHandler(function (e) { msg.textContent = "⚠️ " + e.message; })
    .saveDeliveryAccessSettings({
      admins: document.getElementById("accAdmins").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      viewers: document.getElementById("accViewers").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      openAccess: document.getElementById("accOpen").checked,
    });
}
```

- [ ] **Step 1b: Add per-panel ⬇ Save PNG** (spec §5 — same lazy-html2canvas approach as the demand dashboard). Add a `⬇ PNG` button beside the tiles container and the grid panel header, wired to:

```js
var H2C_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
function savePng_(elId, name) {
  function shoot() {
    var el = document.getElementById(elId);
    html2canvas(el, { backgroundColor: getComputedStyle(document.body).backgroundColor })
      .then(function (canvas) {
        var a = document.createElement("a");
        a.download = "delivery-health-" + name + "-" + MODEL.meta.headlineIso + ".png";
        a.href = canvas.toDataURL("image/png");
        a.click();
      });
  }
  if (window.html2canvas) return shoot();
  var s = document.createElement("script");
  s.src = H2C_URL;
  s.onload = shoot;
  s.onerror = function () { alert("PNG export unavailable (script blocked)"); };
  document.head.appendChild(s);
}
```

Buttons: `<button class="btn" onclick="savePng_('tiles','tiles')">⬇ PNG</button>` next to the tiles, and `savePng_('gridPanel','grid')` on the grid panel. If the GAS sandbox blocks the CDN, the alert fires and the dashboard is otherwise unaffected.

- [ ] **Step 2: Write README.md** — cover, in this order (follow the demand dashboard README's structure): what it is (4 tiles + grid, spec link), data sources table (7 tabs, both SS IDs, Script Property overrides `DH_SOURCE_SS_ID`/`DH_ROSTER_SS_ID`), the metric formulas (billable ÷ available; on-time; forecast accuracy; rework placeholder), Region lens (issue-level standard + majority-of-tracked-hours person assignment + roster fallback + ◦ marker), Team filter semantics (individual teams, membership matching, rates-don't-sum note), access control (SEC_DH), cache (`dh_v<DH_CACHE_VER>`, `bustDeliveryCache_()`), and this deploy runbook:

```markdown
## Deploy
1. script.google.com → New project (separate from all existing dashboards).
2. Add files: `Code` (Code.js), `Security` (Security.js), HTML file named `Dashboard` (Dashboard.html — name must match doGet).
3. Run `node node-tests.js` locally — all suites must pass before pasting.
4. In the GAS editor run `probeDeliverySources()` — verify every source logs a row count,
   the NS sample Employee name format, and NS→roster join coverage >90%.
5. Run `auditJiraFillRates()` — record Due Date / Original Estimate / Region / Team fill rates
   (spec §10.5). Low fill ⇒ adjust tile so-what wording, not the design.
6. Run `getDeliveryData` once → grant scopes (account must open BOTH spreadsheets).
7. Deploy → New deployment → Web app → Execute as Me → "Anyone within ServiceRocket with the link".
8. Run `setupDeliveryCacheWarmer()` once as the owner.
9. After any model-shape change: run `bustDeliveryCache_()` then ↻ Refresh.

## Manual QA (after deploy)
- [ ] Tiles show numbers for the last completed week; Rework tile is muted "data pending".
- [ ] Region chips + Team dropdown + search all filter tiles AND grid together.
- [ ] Collapsed past/current cells tinted; future cells neutral; capacity hours correct (32/38/40).
- [ ] Click a week header → stacked bars; ⚠ appears when planned or tracked > capacity.
- [ ] Click a bar → accordion with 4 stats + bullet lines; multiple accordions can be open.
- [ ] A known PTO week shows OOO hatch and reduced available hours.
- [ ] 🔒 Access panel loads/saves for admins; a non-listed account gets the denied page.
- [ ] ↻ Refresh forces a live read (check generatedAt changes).
```

- [ ] **Step 3: Full local gate** — `node --check Code.js && node node-tests.js` → all pass.

- [ ] **Step 4: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html delivery-health-dashboard/README.md
git commit -m "feat(delivery-health): access panel + README with deploy runbook and QA checklist"
```

---

### Task 15: Final review pass — spec coverage + cross-file consistency

**Files:**
- Modify (as needed): all files in `delivery-health-dashboard/`

- [ ] **Step 1: Run the full suite one final time** — `node node-tests.js` → every `✅ ... passed` line present:
`_test_dhWindow_`, `_test_nameJoin_`, `_test_teamSplit_`, `_test_nsWeekBucketing_`, `_test_netCapacity_`, `_test_regionMap_`, `_test_personRegion_`, `_test_overflowClamp_`, `_test_utilizationRollup_`, `_test_onTimeRate_`, `_test_forecastAccuracy_`, `_test_cacheRoundtrip_`, `_test_modelAssembly_`.

- [ ] **Step 2: Spec checklist** — verify each maps to shipped code (fix anything missing):
- §2 every decision-log row → CONFIG_DH / renderer behavior
- §4 person-week record fields = data contract above
- §5 tile anatomy, filters, grid, bars, clamp+⚠, accordion, ◦ roster-region marker
- §6 checkDeliveryAccess in BOTH doGet and getDeliveryData
- §7 all six degradation rows behave as specced (trace each through the code)
- §11 buckets additive; Rework tile placeholder; "Jira data unavailable" state
- Dispatch a subagent to re-verify naming consistency across files: `clampToCapacity_`/`clampPct_`, `STATE.expandedWeeks`, `data-p`/`data-w`, cache key prefix `dh_v`, Security function names used in Code.js/Dashboard.html match Security.js.

- [ ] **Step 3: Commit any fixes**

```bash
git add delivery-health-dashboard
git commit -m "chore(delivery-health): final spec-coverage and consistency pass"
```

---

## Out of plan (deployment-day, owner-run, GAS editor)

These cannot run locally and are executed by the owner following README steps 4–9: `probeDeliverySources()`, `auditJiraFillRates()`, scope grants, web-app deployment, `setupDeliveryCacheWarmer()`. The NS Employee-name-format finding (spec §10.1) and the Tempo-vs-Atlassian team-name comparison (spec §10.5) are read off the probe/audit logs; if NS names don't resolve >90%, extend `nameAliases_` with the observed format and add a regression case to `_test_nameJoin_`.
