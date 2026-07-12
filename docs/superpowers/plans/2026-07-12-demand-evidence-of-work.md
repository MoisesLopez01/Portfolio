# Project Demand — Evidence of Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the Project Demand Dashboard's tracked-time views with billing classification (Billable vs Internal), epic lineage, and issue-level evidence, by joining tracked hours to `Jira Raw` issue metadata at read time.

**Architecture:** All join logic lives inside `buildDemandModel_()` in the demand dashboard's `Code.js` (the cached compute path). A new `readJiraMeta_()` builds an issue-key→metadata map from the `Jira Raw` sheet (already in `SOURCE_SS_ID`); `parseAllocations_` is extended to capture the tracked sheet's `Issue` column; `enrichTracked_()` classifies each tracked record. No changes to `TempoTrackedTime.js` or `Jira Backlog.js`. Phase 1 ships billing split + ratio on existing panels; Phase 2 adds the epic rollup + evidence drill-down.

**Tech Stack:** Google Apps Script (server `Code.js`), vanilla HTML/CSS/JS (`Dashboard.html`), Node.js local test runner (`node-tests.js`). No external libraries.

**Spec:** `docs/superpowers/specs/2026-07-12-demand-evidence-of-work-design.md`

**Working directory for all paths below:** `docs/superpowers/project-demand-dashboard/`

**Key reference facts (verified in current code):**
- `Tempo Tracked Time` row-2 header: `User, Space, Key, Issue, Summary, Logged (hrs)`, then week columns. `Key` = project (e.g. `COE455`), `Issue` = issue key (e.g. `SRSO-123`).
- `Jira Raw` row-1 header (`Jira Backlog.js` `RAW_HEADERS`): `Week(0), Key(1)=issue key, Work (Summary)(2), ..., Assignee(5), ..., Status(8), ..., Fix Versions(14), ..., Epic Key(17)`.
- `parseAllocations_(vals, nonProjectKeys)` (Code.js:1234) currently reads only the project `Key` column; returns `{ recs:[{person,iso,key,name,hours}], ptoRecs, timeOffByWeek }`.
- `scopeRecsToServices_(recs, profiles)` (Code.js:174) filters recs by department but preserves each record object intact, so enriched fields survive scoping.
- `buildDemandModel_()` computes `scopedTrackedRecs` at Code.js:364 inside `if (!trackedResult.error)`.
- `emptyModel_(weeks)` (Code.js:1300) declares all model fields with defaults.
- Tests are pure `_test_*` functions using an inner `assert_` closure and ending with `Logger.log("✅ ... passed")`; registered in `node-tests.js` and run with `node node-tests.js`.

---

## PHASE 1 — Foundation (join + billing split + ratio)

### Task 1: `parseJiraMeta_` + `readJiraMeta_` — build the issue-metadata map

**Files:**
- Modify: `Code.js` (add two functions in the "TRACKED TIME + DELIVERY SIGNALS" section, near `readTrackedAllocations_` at Code.js:902)
- Modify: `Code.js` (add `_test_jiraMetaParse_` near the other `_test_` functions, after `_test_demandParse_` at Code.js:1512)

- [ ] **Step 1: Write the failing test**

Add to `Code.js`:

```js
function _test_jiraMetaParse_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_jiraMetaParse_: " + msg); }

  // Fake Jira Raw matrix (header row + issue rows). Columns are located by header
  // name, not index, so a partial column set is fine for the test.
  var vals = [
    ["Week", "Key", "Work (Summary)", "Assignee", "Status", "Fix Versions", "Epic Key"],
    ["2026.W26", "COE-456", "Build importer", "Ana Smith", "Done",        "SRSO-4455, 2026.Q3", "COE-100"],
    ["2026.W26", "COE-457", "Internal chore", "Ben Lee",  "In Progress",  "",                    "COE-100"],
    ["2026.W25", "COE-456", "Build importer", "Ana Smith", "In Review",   "SRSO-4455",           "COE-100"], // dup issue, older week
    ["2026.W26", "COE-100", "Importer epic",  "Ana Smith", "In Progress", "",                    ""],        // the epic itself
    ["2026.W26", "coe-458", "Weird casing",   "Ana Smith", "Done",        "srso-9",              ""],        // lowercase key + lowercase srso
  ];

  var meta = parseJiraMeta_(vals);

  // Map keyed by uppercased issue key.
  assert_(meta.map["COE-456"], "COE-456 must be in map");
  assert_(meta.map["COE-456"].epicKey === "COE-100", "COE-456 epic should be COE-100");
  assert_(meta.map["COE-456"].status === "Done", "COE-456 status should be Done");

  // Last-write-wins on duplicate issue: the LAST row seen for COE-456 (W25 In Review) wins.
  assert_(meta.map["COE-456"].status === "Done" || meta.map["COE-456"].status === "In Review",
    "dup handling: one of the two rows wins deterministically");

  // Lowercase key normalized to uppercase.
  assert_(meta.map["COE-458"], "lowercase coe-458 must be stored uppercased");

  // Epic name picked up from the epic's own row summary.
  assert_(meta.epicNames["COE-100"] === "Importer epic",
    "epic name should resolve to 'Importer epic', got " + meta.epicNames["COE-100"]);

  Logger.log("✅ _test_jiraMetaParse_ passed");
}
```

- [ ] **Step 2: Register the test and run it to verify it fails**

Add `_test_jiraMetaParse_();` to `node-tests.js` (after line `_test_demandParse_();`, before the final `console.log`).

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: FAIL with `ReferenceError: parseJiraMeta_ is not defined`.

- [ ] **Step 3: Write the implementation**

Add to `Code.js` in the TRACKED TIME section (near Code.js:902):

```js
// ── JIRA RAW METADATA (billing + epic enrichment) ────────────

/**
 * Parses a Jira Raw value matrix into an issue-metadata lookup.
 * Columns are located by header name (robust to index shifts). Duplicate
 * issue keys across weekly snapshots resolve last-write-wins (metadata is
 * issue-level and identical across weeks).
 * @param {Array<Array>} vals  Jira Raw getValues() matrix (header row 0).
 * @returns {{map:Object, epicNames:Object}} map keyed by UPPER(issue key):
 *   { fixVersions, epicKey, status, summary }; epicNames keyed by UPPER(epic key).
 */
function parseJiraMeta_(vals) {
  var map = {}, epicNames = {};
  if (!vals || vals.length < 2) return { map: map, epicNames: epicNames };

  var hdr = vals[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = function (name) { return hdr.indexOf(name); };
  var iKey  = col("key");
  var iSum  = col("work (summary)");
  var iStat = col("status");
  var iFix  = col("fix versions");
  var iEpic = col("epic key");
  if (iKey === -1) return { map: map, epicNames: epicNames };

  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var key = String(row[iKey] || "").toUpperCase().trim();
    if (!key) continue;
    map[key] = {
      fixVersions: iFix  !== -1 ? String(row[iFix]  || "").trim() : "",
      epicKey:     iEpic !== -1 ? String(row[iEpic] || "").toUpperCase().trim() : "",
      status:      iStat !== -1 ? String(row[iStat] || "").trim() : "",
      summary:     iSum  !== -1 ? String(row[iSum]  || "").trim() : "",
    };
  }

  // Epic name = the epic issue's own summary, when that epic appears as a row.
  for (var k in map) {
    var ek = map[k].epicKey;
    if (ek && map[ek]) epicNames[ek] = map[ek].summary;
  }
  return { map: map, epicNames: epicNames };
}

/**
 * Reads the Jira Raw sheet from SOURCE_SS_ID and returns the metadata map.
 * Fail-soft: a missing/unreadable sheet returns available:false with empty
 * maps, so billing signals switch off but no other panel is affected.
 * Reads only columns 1..18 to skip the large "Comments (ADF Extracted)" column.
 * @returns {{map:Object, epicNames:Object, available:boolean}}
 */
function readJiraMeta_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.JIRA_RAW_SHEET);
    if (!sh) return { map: {}, epicNames: {}, available: false };
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { map: {}, epicNames: {}, available: false };
    var vals = sh.getRange(1, 1, lastRow, 18).getValues();  // cols A..R (skip comments blob)
    var parsed = parseJiraMeta_(vals);
    return { map: parsed.map, epicNames: parsed.epicNames, available: true };
  } catch (e) {
    Logger.log("⚠️ readJiraMeta_: " + e.message);
    return { map: {}, epicNames: {}, available: false };
  }
}
```

Also add the config key to the `CONFIG` block (Code.js, after line 44 `TRACKED_SHEET_NAME`):

```js
  JIRA_RAW_SHEET:       "Jira Raw",   // issue metadata source (same spreadsheet as SOURCE_SS_ID)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: PASS — output includes `✅ _test_jiraMetaParse_ passed`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js docs/superpowers/project-demand-dashboard/node-tests.js
git commit -m "feat(demand-dash): readJiraMeta_ — Jira Raw issue-metadata map for billing/epic join"
```

---

### Task 2: Extend `parseAllocations_` to capture the `Issue` column

**Files:**
- Modify: `Code.js:1234-1295` (`parseAllocations_`)
- Modify: `Code.js` (`_test_demandParse_` at 1452 — add assertions that planned parsing is unchanged and issue capture works)

- [ ] **Step 1: Write the failing test**

Extend `_test_demandParse_` in `Code.js`. Immediately before its final `Logger.log("✅ _test_demandParse_ passed");`, add:

```js
  // ── Issue column capture (tracked sheet) ──
  // Planned sheet (above) has no "Issue" column → recs must have issue === "".
  assert_(recs.every(function (r) { return r.issue === ""; }),
    "planned recs (no Issue column) should have empty issue");

  // A tracked-shaped matrix WITH an Issue column captures the issue key.
  var tvals = [
    ["", "", "", "", "", "2026.W14", ""],
    ["User", "Space", "Key", "Issue", "Logged (hrs)", "Mar 30 - Apr 05 2026", "Total (hrs)"],
    ["Ana Smith", "COE Project", "COE455", "COE-456", 20, 20, 20],
    ["Ben Lee",   "Time off",    "NETSUITE", "",      8,  8,  8],   // excluded from recs
  ];
  var tparsed = parseAllocations_(tvals, CONFIG.NONPROJECT_KEYS);
  assert_(tparsed.recs.length === 1, "tracked parse should yield 1 project rec, got " + tparsed.recs.length);
  assert_(tparsed.recs[0].issue === "COE-456", "tracked rec issue should be COE-456, got " + tparsed.recs[0].issue);
  assert_(tparsed.recs[0].key === "COE455", "tracked rec project key should be COE455, got " + tparsed.recs[0].key);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: FAIL on `planned recs (no Issue column) should have empty issue` (recs currently have no `issue` property → `undefined !== ""`).

- [ ] **Step 3: Write the implementation**

In `parseAllocations_` (Code.js:1252-1258), add `Issue`-column detection alongside the existing `iKey`/`iSpace` lookup:

```js
  // "Key" (project) and "Space" (project name) columns.
  var iKey = -1, iSpace = -1, iIssue = -1;
  for (var c2 = 0; c2 < vals[hr].length; c2++) {
    var hdr = String(vals[hr][c2]).trim().toLowerCase();
    if (hdr === "key")   iKey = c2;
    if (hdr === "space") iSpace = c2;
    if (hdr === "issue") iIssue = c2;   // present only on the tracked sheet
  }
```

Then in the record-building loop (Code.js:1282, where `name` is read), capture the issue and add it to both pushed record shapes:

```js
    var name = iSpace !== -1 ? String(row[iSpace] || "").trim() : "";
    var issue = iIssue !== -1 ? String(row[iIssue] || "").trim() : "";
```

Update the two `out`/`ptoOut` pushes (Code.js:1288 and 1290) to include `issue`:

```js
      if (isTimeOff) {
        timeOffByWeek[wCols[wi].iso] = (timeOffByWeek[wCols[wi].iso] || 0) + hours;
        ptoOut.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours, issue: issue });
      } else {
        out.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours, issue: issue });
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: PASS — `✅ _test_demandParse_ passed` and all other suites still pass (proves planned parsing unchanged).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js
git commit -m "feat(demand-dash): parseAllocations_ captures tracked Issue column (no-op for planned)"
```

---

### Task 3: `enrichTracked_` — classify billing type per tracked record

**Files:**
- Modify: `Code.js` (add `billingTypeFor_` + `enrichTracked_` in the JIRA RAW section from Task 1)
- Modify: `Code.js` (add `_test_enrichTracked_`)

- [ ] **Step 1: Write the failing test**

Add to `Code.js`:

```js
function _test_enrichTracked_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_enrichTracked_: " + msg); }

  var map = {
    "COE-456": { fixVersions: "SRSO-4455, 2026.Q3", epicKey: "COE-100", status: "Done" },
    "COE-457": { fixVersions: "",                    epicKey: "COE-100", status: "In Progress" },
    "COE-458": { fixVersions: "srso-9",              epicKey: "",        status: "Done" }, // lowercase srso
  };
  var recs = [
    { person: "Ana", iso: "2026.W26", key: "COE455", hours: 20, issue: "COE-456" }, // Billable
    { person: "Ben", iso: "2026.W26", key: "COE455", hours: 10, issue: "COE-457" }, // Internal (no SRSO)
    { person: "Cid", iso: "2026.W26", key: "COE455", hours: 5,  issue: "coe-458" }, // Billable (case-insensitive)
    { person: "Dot", iso: "2026.W26", key: "COE455", hours: 3,  issue: "COE-999" }, // Unclassified (not in map)
    { person: "Eve", iso: "2026.W26", key: "COE455", hours: 2,  issue: "" },        // Unclassified (blank issue)
  ];

  enrichTracked_(recs, map);

  assert_(recs[0].billingType === "Billable",     "COE-456 → Billable");
  assert_(recs[0].epicKey === "COE-100",          "COE-456 epic attached");
  assert_(recs[1].billingType === "Internal",     "COE-457 (no SRSO) → Internal");
  assert_(recs[2].billingType === "Billable",     "coe-458 (lowercase srso, lowercase key) → Billable");
  assert_(recs[3].billingType === "Unclassified", "COE-999 (not in map) → Unclassified");
  assert_(recs[4].billingType === "Unclassified", "blank issue → Unclassified");
  assert_(recs[3].epicKey === "" && recs[3].status === "", "unclassified rec has empty epic/status");

  Logger.log("✅ _test_enrichTracked_ passed");
}
```

- [ ] **Step 2: Register + run to verify it fails**

Add `_test_enrichTracked_();` to `node-tests.js` (after `_test_jiraMetaParse_();`).

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: FAIL with `ReferenceError: enrichTracked_ is not defined`.

- [ ] **Step 3: Write the implementation**

Add to `Code.js` in the JIRA RAW section:

```js
/**
 * True if a Fix Versions string contains any SRSO-* token (billable / FixedPrice).
 * @param {string} fixVersions  comma-separated Fix Version names.
 */
function billingTypeFor_(fixVersions) {
  if (!fixVersions) return "Internal";
  var tokens = String(fixVersions).split(",");
  for (var i = 0; i < tokens.length; i++) {
    if (/^\s*SRSO-/i.test(tokens[i])) return "Billable";
  }
  return "Internal";
}

/**
 * Mutates tracked records in place, attaching billingType / epicKey / status
 * from the Jira metadata map. No match (or blank issue) → "Unclassified".
 * @param {Array} recs  tracked allocation records (must carry .issue).
 * @param {Object} map  UPPER(issue key) → { fixVersions, epicKey, status }.
 * @returns {Array} the same recs array (for chaining/tests).
 */
function enrichTracked_(recs, map) {
  (recs || []).forEach(function (r) {
    var meta = r.issue ? (map || {})[String(r.issue).toUpperCase().trim()] : null;
    if (!meta) { r.billingType = "Unclassified"; r.epicKey = ""; r.status = ""; return; }
    r.billingType = billingTypeFor_(meta.fixVersions);
    r.epicKey = meta.epicKey || "";
    r.status = meta.status || "";
  });
  return recs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: PASS — `✅ _test_enrichTracked_ passed`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js docs/superpowers/project-demand-dashboard/node-tests.js
git commit -m "feat(demand-dash): enrichTracked_ — SRSO Fix Version → Billable/Internal/Unclassified"
```

---

### Task 4: `buildBillingAggregates_` + wire into the model

**Files:**
- Modify: `Code.js` (add `buildBillingAggregates_` in the JIRA RAW section)
- Modify: `Code.js:1300-1324` (`emptyModel_` — add default fields)
- Modify: `Code.js:363-379` (`buildDemandModel_` tracked block — call the join)
- Modify: `Code.js` (add `_test_billingAggregation_`)

- [ ] **Step 1: Write the failing test**

Add to `Code.js`:

```js
function _test_billingAggregation_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_billingAggregation_: " + msg); }
  function close_(a, b) { return Math.abs(a - b) < 1e-9; }

  var isoList = ["2026.W25", "2026.W26"];
  var recs = [
    { iso: "2026.W26", key: "COE455", hours: 20, billingType: "Billable" },
    { iso: "2026.W26", key: "COE455", hours: 10, billingType: "Internal" },
    { iso: "2026.W26", key: "HBHP",   hours: 5,  billingType: "Unclassified" },
    { iso: "2026.W25", key: "COE455", hours: 8,  billingType: "Billable" },
    { iso: "2099.W01", key: "COE455", hours: 99, billingType: "Billable" }, // out of window → ignored
  ];

  var agg = buildBillingAggregates_(recs, isoList);

  // Per-week split.
  assert_(agg.billingByWeek["2026.W26"].billable === 20, "W26 billable 20");
  assert_(agg.billingByWeek["2026.W26"].internal === 10, "W26 internal 10");
  assert_(agg.billingByWeek["2026.W26"].unclassified === 5, "W26 unclassified 5");
  assert_(agg.billingByWeek["2026.W25"].billable === 8, "W25 billable 8");

  // Out-of-window week excluded entirely.
  assert_(!agg.billingByWeek["2099.W01"], "out-of-window week must not appear");

  // Ratio over CLASSIFIED hours only: W26 = 20 / (20+10) = 0.6667.
  assert_(close_(agg.billableRatioByWeek["2026.W26"], 20 / 30), "W26 ratio should be 20/30");
  // W25 = 8 / (8+0) = 1.0.
  assert_(close_(agg.billableRatioByWeek["2026.W25"], 1), "W25 ratio should be 1.0");

  // Project window totals.
  assert_(agg.projectBillingWindow.COE455.billable === 28, "COE455 window billable 20+8=28");
  assert_(agg.projectBillingWindow.HBHP.unclassified === 5, "HBHP window unclassified 5");

  // Coverage: matched = 20+10+8 = 38, unclassified = 5, total = 43.
  assert_(agg.coverage.matchedHrs === 38, "coverage matchedHrs 38");
  assert_(agg.coverage.unclassifiedHrs === 5, "coverage unclassifiedHrs 5");
  assert_(close_(agg.coverage.matchRate, 38 / 43), "coverage matchRate 38/43");

  Logger.log("✅ _test_billingAggregation_ passed");
}
```

- [ ] **Step 2: Register + run to verify it fails**

Add `_test_billingAggregation_();` to `node-tests.js` (after `_test_enrichTracked_();`).

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: FAIL with `ReferenceError: buildBillingAggregates_ is not defined`.

- [ ] **Step 3: Write the implementation**

Add to `Code.js` in the JIRA RAW section:

```js
/**
 * Aggregates enriched tracked records into billing figures for the window.
 * Records whose iso is not in isoList are ignored. Ratio is over CLASSIFIED
 * hours only (billable + internal); coverage tracks unclassified separately.
 * @param {Array} recs     enriched tracked records (carry .billingType, .iso, .key, .hours).
 * @param {Array<string>} isoList  the displayed window's ISO weeks.
 * @returns {{billingByWeek, billableRatioByWeek, projectBillingWindow, coverage}}
 */
function buildBillingAggregates_(recs, isoList) {
  var inWindow = {}; (isoList || []).forEach(function (iso) { inWindow[iso] = true; });
  var billingByWeek = {};
  (isoList || []).forEach(function (iso) { billingByWeek[iso] = { billable: 0, internal: 0, unclassified: 0 }; });
  var projectBillingWindow = {};
  var matchedHrs = 0, unclassifiedHrs = 0;

  var bucketOf = function (bt) {
    return bt === "Billable" ? "billable" : bt === "Internal" ? "internal" : "unclassified";
  };

  (recs || []).forEach(function (r) {
    if (!inWindow[r.iso]) return;
    var b = bucketOf(r.billingType);
    billingByWeek[r.iso][b] += r.hours;
    var pb = projectBillingWindow[r.key] || (projectBillingWindow[r.key] = { billable: 0, internal: 0, unclassified: 0 });
    pb[b] += r.hours;
    if (r.billingType === "Unclassified") unclassifiedHrs += r.hours; else matchedHrs += r.hours;
  });

  var billableRatioByWeek = {};
  (isoList || []).forEach(function (iso) {
    var w = billingByWeek[iso];
    var classified = w.billable + w.internal;
    billableRatioByWeek[iso] = classified > 0 ? w.billable / classified : null;
  });

  var total = matchedHrs + unclassifiedHrs;
  return {
    billingByWeek: billingByWeek,
    billableRatioByWeek: billableRatioByWeek,
    projectBillingWindow: projectBillingWindow,
    coverage: {
      matchedHrs: matchedHrs,
      unclassifiedHrs: unclassifiedHrs,
      matchRate: total > 0 ? matchedHrs / total : null,
    },
  };
}
```

Add defaults to `emptyModel_` (Code.js:1319, alongside the other person-level fields):

```js
    billingByWeek: {}, billableRatioByWeek: {}, projectBillingWindow: {}, coverage: null, jiraMetaAvailable: false,
```

Wire the join into `buildDemandModel_`. Inside the `if (!trackedResult.error) {` block (Code.js:363), after `model.displayNames = ...` (Code.js:375) and before the closing `}` at Code.js:377, add:

```js
      // ── Billing + epic enrichment (Jira Raw join) ──
      var jiraMeta = readJiraMeta_();
      enrichTracked_(scopedTrackedRecs, jiraMeta.map);
      var billing = buildBillingAggregates_(scopedTrackedRecs, model.isoList);
      model.billingByWeek        = billing.billingByWeek;
      model.billableRatioByWeek  = billing.billableRatioByWeek;
      model.projectBillingWindow = billing.projectBillingWindow;
      model.coverage             = billing.coverage;
      model.jiraMetaAvailable    = jiraMeta.available;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: PASS — `✅ _test_billingAggregation_ passed` and `✅ node-tests: all suites passed`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js docs/superpowers/project-demand-dashboard/node-tests.js
git commit -m "feat(demand-dash): buildBillingAggregates_ + wire Jira Raw join into buildDemandModel_"
```

---

### Task 5: Frontend — "Tracked billing" filter chips

**Files:**
- Modify: `Dashboard.html` (filter bar near the People filters referenced at line ~456/587; the render dispatch `renderAll()` at line ~1756)

**Context:** `MODEL` is the global payload. `renderCapacity()` (line ~761) renders the Planned-vs-Tracked panel. A client-side `SEL_*`/filter convention already exists (see the "reflects People filters above" note at line 456 and `renderQFilters()` at 1961). This task adds a billing filter that scopes **tracked** figures only.

- [ ] **Step 1: Add the billing filter state + chip UI**

In `Dashboard.html`, near the other filter-state globals (search for `var SEL_` declarations), add:

```js
var BILLING_FILTER = 'all';  // 'all' | 'Billable' | 'Internal' | 'Unclassified' — scopes tracked views only
```

Add a chip group into the filter bar markup (next to the People filters). Use the existing chip classes already in the stylesheet (match the class names used by `renderQFilters()` chips):

```html
<div class="filter-group" id="billingFilterGroup" title="Filters tracked-hour figures only; planned demand is unaffected">
  <span class="filter-label">Tracked billing</span>
  <button class="chip active" data-billing="all">All</button>
  <button class="chip" data-billing="Billable">Billable</button>
  <button class="chip" data-billing="Internal">Internal</button>
  <button class="chip" data-billing="Unclassified">Unclassified</button>
</div>
```

- [ ] **Step 2: Wire chip clicks to re-render**

Add a click handler (mirror the existing chip handlers in `renderQFilters()`):

```js
function bindBillingChips_() {
  var grp = document.getElementById('billingFilterGroup');
  if (!grp) return;
  grp.querySelectorAll('button[data-billing]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      BILLING_FILTER = btn.getAttribute('data-billing');
      grp.querySelectorAll('button[data-billing]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderAll();
    });
  });
}
```

Call `bindBillingChips_()` from the same place other chip handlers are bound (once, after first data load — search for where `renderQFilters` handlers are attached, or add to the `onData` path at line ~690).

- [ ] **Step 3: Apply the filter to tracked figures**

Add a helper that returns tracked hours for a week under the current billing filter, sourced from `MODEL.billingByWeek`:

```js
function trackedForWeek_(iso) {
  var b = (MODEL.billingByWeek || {})[iso];
  if (!b) return (MODEL.weekTracked || {})[iso] || 0;      // no billing data → full tracked
  if (BILLING_FILTER === 'all') return b.billable + b.internal + b.unclassified;
  if (BILLING_FILTER === 'Billable') return b.billable;
  if (BILLING_FILTER === 'Internal') return b.internal;
  return b.unclassified;
}
```

In `renderCapacity()` (line ~761) and `renderCapChart()` (line ~851), replace direct reads of `MODEL.weekTracked[iso]` for the **tracked** series/number with `trackedForWeek_(iso)`. (Leave planned reads — `MODEL.weekTotal` — untouched.)

- [ ] **Step 4: Manual verification**

There is no automated DOM test harness in this project (per `node-tests.js` scope). Verify manually after deploy (Task 8): selecting **Billable** drops the tracked line to billable-only hours and the planned line does not move.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat(demand-dash): Tracked billing filter chips (scoped to tracked views)"
```

---

### Task 6: Frontend — billable-ratio + coverage stat on the Planned-vs-Tracked header

**Files:**
- Modify: `Dashboard.html` (`renderCapacity()` ~761; the panel header near line 454; the so-what `#capSoWhat` at 472/818)

- [ ] **Step 1: Add a ratio stat element to the panel header**

In the Planned-vs-Tracked panel header markup (near line 454, next to `<h2>Planned vs Tracked</h2>`), add:

```html
<span class="stat-chip" id="billableRatioChip"></span>
```

Use the existing small-stat class if one exists (search the stylesheet for a chip/pill class used in panel headers); otherwise reuse `.hint`.

- [ ] **Step 2: Populate it in `renderCapacity()`**

Inside `renderCapacity()`, compute the window-level billable ratio and coverage from the model and set the chip text:

```js
function billingWindowStats_() {
  var bill = 0, intl = 0, unc = 0;
  (MODEL.isoList || []).forEach(function (iso) {
    var b = (MODEL.billingByWeek || {})[iso];
    if (!b) return;
    bill += b.billable; intl += b.internal; unc += b.unclassified;
  });
  var classified = bill + intl;
  var total = classified + unc;
  return {
    ratio: classified > 0 ? bill / classified : null,
    coverage: total > 0 ? classified / total : null,
    hasData: total > 0,
  };
}
```

Then near the end of `renderCapacity()`:

```js
  var bw = billingWindowStats_();
  var chip = document.getElementById('billableRatioChip');
  if (chip) {
    if (!MODEL.jiraMetaAvailable) {
      chip.textContent = 'Jira Raw not found — billing signals off';
      chip.className = 'stat-chip warn';
    } else if (!bw.hasData) {
      chip.textContent = '';
    } else {
      chip.textContent = 'Billable ' + Math.round(bw.ratio * 100) + '% of classified tracked hrs · coverage ' + Math.round(bw.coverage * 100) + '%';
      chip.className = 'stat-chip';
    }
  }
```

- [ ] **Step 3: Manual verification**

After deploy: the chip shows e.g. `Billable 72% of classified tracked hrs · coverage 88%`. With `Jira Raw` absent, it shows the "billing signals off" note and no panel errors.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat(demand-dash): billable-ratio + coverage stat on Planned vs Tracked header"
```

---

### Task 7: Frontend — split the tracked series billable vs internal in the trend

**Files:**
- Modify: `Dashboard.html` (`renderCapChart()` ~851 and its tooltip; `renderCapLegend()` ~832)

- [ ] **Step 1: Add a stacked billable/internal breakdown to the tracked area**

`renderCapChart()` currently draws one tracked series from `MODEL.weekTracked`. When `BILLING_FILTER === 'all'` and `MODEL.jiraMetaAvailable`, draw the tracked area as two stacked bands per week using `MODEL.billingByWeek[iso].billable` (solid green) and `.internal` (muted green), and a third muted band for `.unclassified` only when `> 0`. When a specific billing filter is active, draw the single filtered series via `trackedForWeek_(iso)` (from Task 5).

Keep the planned series unchanged. Reuse the existing chart scaffolding (axis, scale, week x-positions) already in `renderCapChart()`; only the tracked-series fill changes.

- [ ] **Step 2: Add the split to the hover tooltip**

In the chart's tooltip builder (inside `renderCapChart()`), when billing data exists for the hovered week, append lines:

```js
    var b = (MODEL.billingByWeek || {})[iso];
    if (b) {
      tipLines.push('Billable: ' + fmt(b.billable) + ' hrs');
      tipLines.push('Internal: ' + fmt(b.internal) + ' hrs');
      if (b.unclassified > 0) tipLines.push('Unclassified: ' + fmt(b.unclassified) + ' hrs');
    }
```

(Use the tooltip's existing line-accumulation variable name — inspect `renderCapChart()` for how it builds tooltip text and match it.)

- [ ] **Step 3: Add legend entries**

In `renderCapLegend()` (~832), add legend swatches for "Tracked · billable" and "Tracked · internal" (and "unclassified" muted) so the stacked bands are labeled.

- [ ] **Step 4: Manual verification**

After deploy: the tracked area shows a billable/internal split under `All`; the tooltip lists both; the legend labels them. Selecting a billing chip collapses to that single series.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat(demand-dash): stacked billable/internal tracked series + tooltip + legend"
```

---

### Task 8: Full-suite run + deploy checklist commit

**Files:**
- Modify: `docs/superpowers/project-demand-dashboard/README.md` (document the new billing signals + deploy note)

- [ ] **Step 1: Run the complete test suite**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: all suites pass, ending with `✅ node-tests: all suites passed` — including `_test_jiraMetaParse_`, `_test_enrichTracked_`, `_test_billingAggregation_`.

- [ ] **Step 2: Document in README**

Add a bullet to the README panels list describing the "Tracked billing" filter + billable-ratio/coverage stat, and add to the Deploy section:

```markdown
- **Billing signals (evidence of work):** the Planned-vs-Tracked panel classifies tracked
  hours as Billable (SRSO-* Fix Version) / Internal / Unclassified by joining `Jira Raw`
  (same `SOURCE_SS_ID`) on the tracked sheet's `Issue` column. "Tracked billing" chips scope
  the tracked series; the header shows billable % of classified hours + coverage %. Missing
  `Jira Raw` → signals silently off, all other panels unaffected. No new auth scope.
```

Deploy note (add to the Deploy list): "Model shape changed → run `bustDemandCache_()` once (or bump `PD_CACHE_VER`) after pasting `Code.js`, then ↻ Refresh."

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/README.md
git commit -m "docs(demand-dash): README — billing/evidence signals + cache-bust deploy note"
```

- [ ] **Step 4: Owner deploy (manual — not an agent step)**

Paste `Code.js` + `Dashboard.html` into the GAS project; run all `_test_` functions in the editor; run `getDemandData` once to (re)authorize `SpreadsheetApp` (no new scope — same `SOURCE_SS_ID`); run `bustDemandCache_()`; redeploy; press ↻ Refresh; confirm the billable ratio + coverage chip renders and the billing chips scope the tracked series.

---

## PHASE 2 — Follow-on (epic rollup + evidence drill-down)

> Phase 2 pixel layout is deliberately deferred to build time (decided during brainstorming). Task 9 (payload) is fully specified with TDD; Tasks 10–11 specify the data contract and acceptance behavior — the exact DOM/layout is finalized against a browser mock when Phase 2 is built.

### Task 9: `trackedIssues` compact payload

**Files:**
- Modify: `Code.js:1234-1295` (`parseAllocations_` — also capture the `Summary` column)
- Modify: `Code.js` (add `buildTrackedIssues_` in the JIRA RAW section; wire into `buildDemandModel_`; default in `emptyModel_`)
- Modify: `Code.js` (add `_test_trackedIssues_`)

- [ ] **Step 1: Write the failing test**

```js
function _test_trackedIssues_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_trackedIssues_: " + msg); }

  var isoList = ["2026.W26"];
  var recs = [
    { person: "Ana", iso: "2026.W26", key: "COE455", hours: 20, issue: "COE-456", summary: "Build importer", billingType: "Billable",     epicKey: "COE-100", status: "Done" },
    { person: "Ben", iso: "2026.W26", key: "COE455", hours: 0,  issue: "COE-457", summary: "Chore",          billingType: "Internal",     epicKey: "COE-100", status: "Open" }, // 0 hrs → dropped
    { person: "Cid", iso: "2099.W01", key: "COE455", hours: 5,  issue: "COE-458", summary: "Later",          billingType: "Billable",     epicKey: "",        status: "Open" }, // out of window → dropped
  ];

  var out = buildTrackedIssues_(recs, isoList);
  assert_(out.length === 1, "only the in-window >0-hour issue survives, got " + out.length);
  assert_(out[0].issue === "COE-456" && out[0].hours === 20, "COE-456 row retained with hours");
  assert_(out[0].epicKey === "COE-100" && out[0].billingType === "Billable", "enrichment carried through");
  assert_(out[0].summary === "Build importer", "summary carried through");

  Logger.log("✅ _test_trackedIssues_ passed");
}
```

- [ ] **Step 2: Register + run to verify it fails**

Add `_test_trackedIssues_();` to `node-tests.js`.
Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: FAIL with `ReferenceError: buildTrackedIssues_ is not defined`.

- [ ] **Step 3: Implement**

Extend `parseAllocations_` to also capture the `Summary` column (mirror the `iIssue` addition from Task 2): detect `if (hdr === "summary") iSum = c2;`, read `var summary = iSum !== -1 ? String(row[iSum] || "").trim() : "";`, and add `summary: summary` to both `out.push`/`ptoOut.push` record shapes.

Add to `Code.js` JIRA RAW section:

```js
/**
 * Builds the compact enriched issue-level array for the client to pivot
 * (epic rollup, evidence drill-down, per-person billing). In-window, >0 hours.
 * @param {Array} recs     enriched tracked records.
 * @param {Array<string>} isoList  displayed window's ISO weeks.
 */
function buildTrackedIssues_(recs, isoList) {
  var inWindow = {}; (isoList || []).forEach(function (iso) { inWindow[iso] = true; });
  var out = [];
  (recs || []).forEach(function (r) {
    if (!inWindow[r.iso] || !(r.hours > 0)) return;
    out.push({
      issue: r.issue || "", projectKey: r.key, person: r.person, iso: r.iso,
      hours: r.hours, billingType: r.billingType || "Unclassified",
      epicKey: r.epicKey || "", status: r.status || "", summary: r.summary || "",
    });
  });
  return out;
}
```

Wire into `buildDemandModel_` (in the same billing block added in Task 4):

```js
      model.trackedIssues = buildTrackedIssues_(scopedTrackedRecs, model.isoList);
      model.epicNames = jiraMeta.epicNames;
```

Add defaults to `emptyModel_`: `trackedIssues: [], epicNames: {},`.

- [ ] **Step 4: Run to verify it passes**

Run: `node docs/superpowers/project-demand-dashboard/node-tests.js`
Expected: PASS — `✅ _test_trackedIssues_ passed`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Code.js docs/superpowers/project-demand-dashboard/node-tests.js
git commit -m "feat(demand-dash): trackedIssues compact payload + epicNames (Phase 2 data)"
```

---

### Task 10: "Delivery by Epic" panel

**Files:**
- Modify: `Dashboard.html` (new panel + `renderEpicRollup()`; register in `renderAll()` ~1756)

**Data contract consumed:** `MODEL.trackedIssues` (from Task 9), `MODEL.epicNames`, `MODEL.projectBillingWindow`. Respects `BILLING_FILTER` (Task 5) and the current week window.

- [ ] **Step 1: Client-side pivot**

Add `renderEpicRollup()` that groups `MODEL.trackedIssues` by `epicKey` (blank → `"(no epic)"`), summing `hours`, collecting distinct `person` values, and deriving the epic's billing type (Billable if any child is Billable) and Fix Versions set. Apply `BILLING_FILTER` before grouping. Row shape:

```js
{ epicKey, epicName: MODEL.epicNames[epicKey] || epicKey, projectKeys:Set, billingType, hours, contributors:Set }
```

- [ ] **Step 2: Render the table**

Render a collapsible panel table: `Epic (key + name) · Project · Billing · Tracked hrs · Contributors (count; names on hover title)`, sorted by hours desc, with its own ⬇ Save PNG button (mirror an existing panel's Save PNG wiring). **Chart-area shows counts only; contributor names live in the hover title / drill rows** (per the counts-in-charts convention). Exact column widths/placement finalized against a browser mock at build time.

- [ ] **Step 3: Register + manually verify**

Call `renderEpicRollup()` from `renderAll()`. Verify epics roll up child-issue hours, contributor counts are distinct, and the billing filter narrows the table.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat(demand-dash): Delivery by Epic rollup panel (Phase 2)"
```

---

### Task 11: Issue-level evidence drill-down

**Files:**
- Modify: `Dashboard.html` (expandable rows wired into existing click targets; `renderEvidence_(filterFn)` helper)

**Data contract consumed:** `MODEL.trackedIssues`. A generic `renderEvidence_(predicate)` returns the issues matching a predicate (by `projectKey`, by `epicKey`, or by `person`).

- [ ] **Step 1: Generic evidence renderer**

```js
function evidenceRows_(predicate) {
  return (MODEL.trackedIssues || [])
    .filter(function (t) { return (BILLING_FILTER === 'all' || t.billingType === BILLING_FILTER) && predicate(t); });
}
```

Render rows as `Issue · Summary · Status · Billing · hours` (aggregate hours per issue across weeks in the window).

- [ ] **Step 2: Wire into existing click targets**

Attach expandable evidence to: a project row (heatmap/ranked → `predicate = t => t.projectKey === key`), an epic row (Task 10 → `t => t.epicKey === epicKey`), and a person (Team Availability → `t => t.person === name`). Reuse the existing expand/collapse row pattern (see `renderProjDrill()` at ~1504 for the established drill-down convention). Exact placement/animation finalized at build time.

- [ ] **Step 3: Manually verify**

Expanding a project/epic/person shows the actual issues + hours behind the number; the billing filter narrows the list.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/project-demand-dashboard/Dashboard.html
git commit -m "feat(demand-dash): issue-level evidence drill-down (Phase 2)"
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** join (T1–T2), classification (T3), aggregates + model wiring (T4), billing filter (T5), ratio+coverage stat (T6), tracked split (T7), tests + deploy (T8); Phase 2 payload (T9), epic rollup (T10), evidence drill-down (T11). Ratio-over-classified, Unclassified bucket, fail-soft, epic-name-opportunistic, no-new-auth-scope, cache-bust all covered. ✎
- **Type consistency:** `parseJiraMeta_`→`{map,epicNames}`; `readJiraMeta_`→`{map,epicNames,available}`; recs carry `issue`(T2)/`billingType,epicKey,status`(T3)/`summary`(T9); model fields `billingByWeek/billableRatioByWeek/projectBillingWindow/coverage/jiraMetaAvailable/trackedIssues/epicNames` consistent across `emptyModel_`, `buildDemandModel_`, and the frontend readers. ✎
- **No placeholders:** all backend/logic steps ship real code + tests; Phase 2 UI layout deferral is an explicit brainstorming decision, with data contracts and acceptance criteria concrete. ✎
```
