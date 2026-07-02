# All Rocketeers Tab + Intern Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reinstate intern exclusion in the Goals Compliance Dashboard (a v12 regression) and add a new "All Rocketeers" tab showing every Rocketeer ever logged in RD, grouped by manager, independent of quarter.

**Architecture:** Both changes live entirely in `goalCompliance.js` (backend) and `GDash.html` (frontend) — the same two-file GAS web app described in `docs/superpowers/specs/2026-06-25-goals-compliance-dashboard-design.md`. The intern fix adds a pure `isIntern_()`/`stripInterns_()` pair used by both the existing quarter-scoped aggregation and the new tab. The new tab adds a pure `aggregateAllRocketeers_()` function (mirrors the existing `aggregateByRocketeer_` shape) wrapped by an IO orchestrator `buildAllRocketeersData_()` and a cached, access-gated entry point `getAllRocketeersData()` — the same three-layer shape `getGoalsComplianceData`/`buildComplianceData_` already use.

**Tech Stack:** Google Apps Script (server) + vanilla JS/HTML (`HtmlService` client). No test framework or clasp/CI exists in this repo — the project's own convention (see the existing `_test_resolveGDManagerScope_` in `goalCompliance.js`) is a hand-fixtured `_test_X_()` function with an `assert_()` helper that throws on failure, meant to be run manually from the Apps Script editor's function dropdown. This plan follows that same convention for every new pure function, **and** gives a Node.js one-liner harness for each test so it can be verified immediately in this repo without needing a live Apps Script deployment (Node is not otherwise part of this project's toolchain — the harness is a verification convenience only, nothing is added to `goalCompliance.js` to support it).

---

## How the Node verification harness works

Each pure-function task below includes a "Run test" step using this pattern: write a temporary file to your scratchpad directory (path given in your own system prompt) containing this harness, then run it with `node <path>`. The harness loads the **real** `goalCompliance.js` source (no duplication, no mocking of the logic under test) into a fresh JS sandbox, stubbing only `Logger` since GAS's `Logger.log` doesn't exist in Node — every function this plan tests is a pure function that never touches `SpreadsheetApp`/`CacheService`/`LockService`, so no other stub is needed.

```js
// verify-harness.js — temporary, not part of the deliverable
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('D:/Contribution/goalCompliance.js', 'utf8');
const sandbox = { Logger: { log: function(m) { console.log(m); } } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const testName = process.argv[2];
if (!sandbox[testName]) { console.error('No such test: ' + testName); process.exit(1); }
try {
  sandbox[testName]();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
```

Run any test with `node verify-harness.js _test_someName_`. Expected output on success: the test's own `✅ ...` log line and exit code 0. On failure: the `❌ ...` error message and exit code 1.

---

### Task 1: Intern-detection helpers (`isIntern_`, `stripInterns_`)

**Files:**
- Modify: `goalCompliance.js:702-706` (insert after `isSeniorLeader_`)
- Test: `goalCompliance.js` (appended `_test_isIntern_`, `_test_stripInterns_` functions, verified via the Node harness above)

- [ ] **Step 1: Write the failing tests**

Append to the end of `goalCompliance.js` (after the existing `_test_resolveGDManagerScope_` function):

```js
function _test_isIntern_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_isIntern_: " + msg); }

  assert_(isIntern_('Intern, Professional Services') === true, "exact catalog title must match");
  assert_(isIntern_('Intern Engineer, Service Delivery') === true, "non-comma intern title must match");
  assert_(isIntern_('intern, marketing') === true, "match must be case-insensitive");
  assert_(isIntern_('Consultant, Professional Services') === false, "non-intern title must not match");
  assert_(isIntern_('') === false, "blank title must not match");
  assert_(isIntern_(null) === false, "null title must not match");

  Logger.log("✅ _test_isIntern_ passed");
}

function _test_stripInterns_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_stripInterns_: " + msg); }

  var map = {
    'alice smith': { jobTitle: 'Consultant, Professional Services' },
    'bob jones':   { jobTitle: '' }, // blank on the map itself — must fall through to the roster
    'cara lee':    { jobTitle: 'Intern, Marketing' },
  };
  var rosterMap = {
    'alice smith': { jobTitle: 'Consultant, Professional Services' },
    'bob jones':   { jobTitle: 'Intern, Managed Services' }, // roster says intern even though the map's own title was blank
    // cara lee has no roster entry — falls back to her own map jobTitle
  };

  stripInterns_(map, rosterMap);

  var keys = Object.keys(map).sort();
  assert_(keys.length === 1, "expected 1 survivor, got " + keys.length + " (" + keys.join(",") + ")");
  assert_(!!map['alice smith'], "non-intern must survive");
  assert_(!map['bob jones'],  "roster-flagged intern (blank own title) must be removed");
  assert_(!map['cara lee'],   "map-flagged intern (no roster match) must be removed");

  Logger.log("✅ _test_stripInterns_ passed");
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node verify-harness.js _test_isIntern_`
Expected: `No such test: _test_isIntern_` — wait, that error means the file loaded but the function doesn't exist yet. This is the expected failure: `isIntern_` and `stripInterns_` aren't defined yet, so `_test_isIntern_()` will throw `ReferenceError: isIntern_ is not defined` when it runs (the harness prints that message and exits 1).

- [ ] **Step 3: Write the minimal implementation**

Insert after `isSeniorLeader_` in `goalCompliance.js` (currently lines 702-706):

```js
function isSeniorLeader_(jobTitle) {
  return /\b(vp|vice.?president|director|chief|c[a-z]o|ceo|cto|cfo|coo)\b/i.test(jobTitle || '');
}

// ── Intern detection ─────────────────────────────────────────
// Interns aren't required to log goals, aren't evaluated on this cadence, and
// don't qualify for STF — excluded from every view in this dashboard. Pattern
// match (not a hardcoded title list) mirrors the existing convention in
// PS Contribution Report.js (title.includes("intern")) and self-updates when
// a new "Intern, <Dept>" title is added to the company catalog.
function isIntern_(jobTitle) {
  return /intern/i.test(jobTitle || '');
}

// Removes intern entries from a normName-keyed employee map, in place.
// `jobTitleMap` resolves the authoritative Job Title per normName — pass the
// Roster map (Job Title is sourced from the same NetSuite export as RD and is
// always populated there); an entry's own `jobTitle` is used as a fallback
// only when there's no Roster match for that normName.
function stripInterns_(map, jobTitleMap) {
  Object.keys(map).forEach(function(norm) {
    var rosterJobTitle = jobTitleMap[norm] ? jobTitleMap[norm].jobTitle : '';
    var jobTitle = rosterJobTitle || map[norm].jobTitle;
    if (isIntern_(jobTitle)) delete map[norm];
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node verify-harness.js _test_isIntern_`
Expected: `✅ _test_isIntern_ passed` (exit code 0)

Run: `node verify-harness.js _test_stripInterns_`
Expected: `✅ _test_stripInterns_ passed` (exit code 0)

- [ ] **Step 5: Commit**

```bash
git add "goalCompliance.js"
git commit -m "$(cat <<'EOF'
Add isIntern_/stripInterns_ helpers to goalCompliance.js

Pure pattern-match intern detection, matching the existing
title.includes("intern") convention in PS Contribution Report.js.
Not wired in yet — that's the next task.
EOF
)"
```

---

### Task 2: Wire intern exclusion into the quarter-scoped compliance view

**Files:**
- Modify: `goalCompliance.js:437-471` (`buildComplianceData_` steps 3 and 3b)
- Modify: `goalCompliance.js:751-754` (`getFullRosterMap_` stale log wording)

No new test in this task — `buildComplianceData_` requires live `SpreadsheetApp`/`CacheService` access and isn't unit-testable in isolation; `stripInterns_` and `isIntern_` (which this task wires in) are already covered by Task 1's tests. Verification for this task happens via code review here and the end-to-end manual smoke test in Task 9.

- [ ] **Step 1: Update the step-3 comment and call `stripInterns_`**

In `buildComplianceData_`, replace:

```js
  // 3. Aggregate per rocketeer — every Rocketeer found in the RD sheet is kept
  // (interns and terminated employees included); the only exclusion left is the
  // manager's org-tree scope boundary. Termination is surfaced as a tag below,
  // never as a filter.
  var rockMap = aggregateByRocketeer_(rdRows, scopeSet, quarter);
```

with:

```js
  // 3. Aggregate per rocketeer — aggregateByRocketeer_ itself keeps every
  // Rocketeer found in the RD sheet (the only gate inside it is the manager's
  // org-tree scope boundary). Interns are stripped out immediately below,
  // before zero-goal injection or comment-trend computation, since they
  // aren't required to log goals, aren't evaluated, and don't qualify for
  // STF/RPI/compliance rate. Termination remains a tag, never a filter.
  var rockMap = aggregateByRocketeer_(rdRows, scopeSet, quarter);
  stripInterns_(rockMap, rosterMap);
```

- [ ] **Step 2: Skip interns in the zero-goal Roster injection loop**

Replace:

```js
  // 3b. Inject every ACTIVE, in-scope Roster employee not found in the RD sheet
  // (0 goals this quarter). Terminated roster people are never injected this way
  // — they only appear here if they actually have RD activity, tagged below.
  var preInjectCount = Object.keys(rockMap).length;
  Object.keys(rosterMap).forEach(function(norm) {
    if (rockMap[norm]) return; // already present from RD
    var r = rosterMap[norm];
    if (!r.active) return;
    rockMap[norm] = {
```

with:

```js
  // 3b. Inject every ACTIVE, in-scope, non-intern Roster employee not found in
  // the RD sheet (0 goals this quarter). Terminated roster people are never
  // injected this way — they only appear here if they actually have RD
  // activity, tagged below.
  var preInjectCount = Object.keys(rockMap).length;
  Object.keys(rosterMap).forEach(function(norm) {
    if (rockMap[norm]) return; // already present from RD
    var r = rosterMap[norm];
    if (!r.active) return;
    if (isIntern_(r.jobTitle)) return;
    rockMap[norm] = {
```

- [ ] **Step 3: Fix the stale "non-intern" log wording in `getFullRosterMap_`**

`getFullRosterMap_` never filtered interns (it's pure enrichment — see its own leading comment), so its log line claiming "non-intern roster rows" was already misleading before this task; now that real intern filtering exists elsewhere, leaving this wording risks someone assuming interns are already excluded by this function. Replace:

```js
    var activeCount = Object.keys(map).filter(function(n) { return map[n].active; }).length;
    Logger.log('getFullRosterMap_: ' + Object.keys(map).length + ' non-intern roster rows (' +
               activeCount + ' active, ' + (Object.keys(map).length - activeCount) +
               ' inactive) from ' + rows.length + ' "' + CONFIG_GD.SHEET_ROSTER + '" rows');
```

with:

```js
    var activeCount = Object.keys(map).filter(function(n) { return map[n].active; }).length;
    Logger.log('getFullRosterMap_: ' + Object.keys(map).length + ' roster rows (' +
               activeCount + ' active, ' + (Object.keys(map).length - activeCount) +
               ' inactive) from ' + rows.length + ' "' + CONFIG_GD.SHEET_ROSTER + '" rows');
```

- [ ] **Step 4: Commit**

```bash
git add "goalCompliance.js"
git commit -m "$(cat <<'EOF'
Reinstate intern exclusion in the quarter-scoped compliance view

v12 accidentally dropped intern exclusion as a side effect of turning
terminated-employee handling into a tag. Interns aren't required to
log goals, aren't evaluated, and don't qualify for STF/RPI/compliance
rate, so they're stripped out of both the RD aggregation and the
zero-goal Roster injection.
EOF
)"
```

---

### Task 3: Bump `CACHE_VER`

**Files:**
- Modify: `goalCompliance.js:31`

This must happen before Task 2's changes reach real users — every previously cached payload includes interns, and `CACHE_VER` is this project's only way to invalidate every scope's cache entry at once (see the `Cache` section of `CLAUDE.md`).

- [ ] **Step 1: Bump the version and update its comment**

Replace:

```js
  CACHE_VER:           'gd_v12_',  // bumped: interns and terminated employees are no longer excluded — terminated is now a `terminated` tag on the employee record instead of a filter
```

with:

```js
  CACHE_VER:           'gd_v13_',  // bumped: interns are excluded again (v12 accidentally dropped intern exclusion while fixing terminated-employee handling) — removed from compliance aggregation, zero-goal injection, and the All Rocketeers tab
```

- [ ] **Step 2: Commit**

```bash
git add "goalCompliance.js"
git commit -m "$(cat <<'EOF'
Bump CACHE_VER to gd_v13_ for the intern-exclusion fix

Every cached payload (all quarters, all scopes) included interns
before this change — bumping strands the stale cache immediately for
every user, same mechanism used for every prior aggregation change.
EOF
)"
```

---

### Task 4: Pure aggregation for the All Rocketeers tab

**Files:**
- Modify: `goalCompliance.js` (insert `aggregateAllRocketeers_` after `stripInterns_`, from Task 1)
- Test: `goalCompliance.js` (appended `_test_aggregateAllRocketeers_`, verified via the Node harness)

- [ ] **Step 1: Write the failing test**

Append to the end of `goalCompliance.js`:

```js
function _test_aggregateAllRocketeers_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_aggregateAllRocketeers_: " + msg); }

  var rows = [
    // Alice: 2 goals across two quarters, reports to Jane
    { 'Rocketeer':'Alice Smith', 'Supervisor':'Jane Doe', 'Department':'Services', 'Job Title':'Consultant, Professional Services', 'Goal ID':'G1', 'Start Date': new Date('2025-08-01') },
    { 'Rocketeer':'Alice Smith', 'Supervisor':'Jane Doe', 'Department':'Services', 'Job Title':'Consultant, Professional Services', 'Goal ID':'G2', 'Start Date': new Date('2026-05-01') },
    // Bob: intern, must be excluded entirely even though he has RD goals
    { 'Rocketeer':'Bob Jones', 'Supervisor':'Jane Doe', 'Department':'Services', 'Job Title':'Intern, Professional Services', 'Goal ID':'G3', 'Start Date': new Date('2025-08-01') },
    // Cara: blank Supervisor -> Unassigned bucket
    { 'Rocketeer':'Cara Lee', 'Supervisor':'', 'Department':'Ops', 'Job Title':'Analyst, Operations', 'Goal ID':'G4', 'Start Date': new Date('2025-09-01') },
  ];
  var fullRosterMap = {}; // no roster matches for anyone — falls back to each row's own Job Title

  var result = aggregateAllRocketeers_(rows, fullRosterMap, null);

  assert_(result.totalRocketeers === 2, "expected 2 rocketeers after intern exclusion, got " + result.totalRocketeers);

  var jane = result.managers.filter(function(m) { return m.supervisor === 'Jane Doe'; })[0];
  assert_(!!jane, "Jane Doe group missing");
  assert_(jane.teamSize === 1, "Bob (intern) must not count toward Jane's team size, got " + jane.teamSize);
  var alice = jane.rocketeers[0];
  assert_(alice.name === 'Alice Smith', "expected Alice in Jane's group, got " + (alice && alice.name));
  assert_(alice.totalGoals === 2, "expected 2 unique goals for Alice, got " + alice.totalGoals);
  assert_(alice.firstQuarter === 'FY26Q1', "expected firstQuarter FY26Q1, got " + alice.firstQuarter);
  assert_(alice.lastQuarter === 'FY26Q4', "expected lastQuarter FY26Q4, got " + alice.lastQuarter);

  var unassigned = result.managers.filter(function(m) { return m.supervisor === 'Unassigned'; })[0];
  assert_(!!unassigned && unassigned.rocketeers[0].name === 'Cara Lee', "blank Supervisor must group under Unassigned");

  // Manager scope: restricting to Cara's own scope must exclude Jane's whole team
  var scoped = aggregateAllRocketeers_(rows, fullRosterMap, { 'cara lee': true });
  assert_(scoped.totalRocketeers === 1 && scoped.managers.length === 1 && scoped.managers[0].supervisor === 'Unassigned',
    "manager scope must exclude out-of-scope rocketeers, got " + JSON.stringify(scoped));

  Logger.log("✅ _test_aggregateAllRocketeers_ passed");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node verify-harness.js _test_aggregateAllRocketeers_`
Expected: `aggregateAllRocketeers_ is not defined` (exit code 1) — the function doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Insert after `stripInterns_` (added in Task 1) in `goalCompliance.js`:

```js
// ── All Rocketeers aggregation (quarter-independent, for the All Rocketeers
//    tab) ───────────────────────────────────────────────────────────────
// Pure function: groups every RD row by its own Supervisor field (not a
// Roster org-tree — one level, same rule a reference "process 100k+ rows"
// test script used), across ALL quarters combined. `scopeSet` narrows to a
// manager's org tree when supplied (null = no restriction, admin/viewer).
// `fullRosterMap` is used only to resolve the authoritative Job Title for
// intern detection — never to enrich the returned rows (Department/Job
// Title/Supervisor come from RD alone).
function aggregateAllRocketeers_(rows, fullRosterMap, scopeSet) {
  var rockMap = {};

  rows.forEach(function(row) {
    var name = String(row['Rocketeer'] || '').trim();
    if (!name) return;
    var norm = normName_(name);
    if (scopeSet && !scopeSet[norm]) return;

    var supervisor = String(row['Supervisor'] || '').trim() || 'Unassigned';
    var department = String(row['Department'] || '').trim();
    var jobTitle   = String(row['Job Title']  || '').trim();
    var startDate  = row['Start Date'];
    var goalId     = String(row['Goal ID']    || '').trim();

    if (!rockMap[norm]) {
      rockMap[norm] = {
        name: name, normName: norm,
        department: department, jobTitle: jobTitle, supervisor: supervisor,
        _latestStart: null, _goalIds: {}, _quarters: {},
      };
    }
    var emp = rockMap[norm];

    // Department/Job Title/Supervisor reflect whichever row has the latest
    // Start Date seen so far — a rocketeer's most recent assignment.
    var sd = startDate ? new Date(startDate) : null;
    var sdValid = sd instanceof Date && !isNaN(sd);
    if (sdValid && (!emp._latestStart || sd > emp._latestStart)) {
      emp._latestStart = sd;
      if (department) emp.department = department;
      if (jobTitle)   emp.jobTitle   = jobTitle;
      if (supervisor) emp.supervisor = supervisor;
    }

    if (goalId) {
      emp._goalIds[goalId] = true;
      if (sdValid) {
        var q = dateToFiscalQuarter_(startDate);
        if (q) emp._quarters[q] = true;
      }
    }
  });

  stripInterns_(rockMap, fullRosterMap);

  var managerMap = {};
  Object.keys(rockMap).forEach(function(norm) {
    var emp = rockMap[norm];
    var quarters = Object.keys(emp._quarters).sort();
    var rec = {
      name:         emp.name,
      normName:     emp.normName,
      department:   emp.department,
      jobTitle:     emp.jobTitle,
      totalGoals:   Object.keys(emp._goalIds).length,
      firstQuarter: quarters.length ? quarters[0] : '',
      lastQuarter:  quarters.length ? quarters[quarters.length - 1] : '',
    };

    var normSup = normName_(emp.supervisor);
    if (!managerMap[normSup]) {
      managerMap[normSup] = { supervisor: emp.supervisor, normSupervisor: normSup, rocketeers: [] };
    }
    managerMap[normSup].rocketeers.push(rec);
  });

  var managers = Object.keys(managerMap).map(function(k) { return managerMap[k]; });
  managers.forEach(function(m) {
    m.rocketeers.sort(function(a, b) { return a.name.localeCompare(b.name); });
    m.teamSize = m.rocketeers.length;
  });
  managers.sort(function(a, b) { return a.supervisor.localeCompare(b.supervisor); });

  return { managers: managers, totalRocketeers: Object.keys(rockMap).length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node verify-harness.js _test_aggregateAllRocketeers_`
Expected: `✅ _test_aggregateAllRocketeers_ passed` (exit code 0)

- [ ] **Step 5: Commit**

```bash
git add "goalCompliance.js"
git commit -m "$(cat <<'EOF'
Add aggregateAllRocketeers_ pure aggregation function

Groups every RD row by its own Supervisor field across all quarters
combined, for the upcoming All Rocketeers tab. Mirrors the shape of
the existing aggregateByRocketeer_ and reuses stripInterns_ for the
same intern exclusion rule as the compliance view.
EOF
)"
```

---

### Task 5: `getAllRocketeersData()` server endpoint

**Files:**
- Modify: `goalCompliance.js:260-261` (insert `getAllRocketeersData` after `getGoalsComplianceData`)
- Modify: `goalCompliance.js:557-559` (insert `buildAllRocketeersData_` after `buildComplianceData_`)

Not unit-testable in isolation — both functions call live `SpreadsheetApp`/`CacheService`/`LockService`/`checkDashboardAccess()`. `aggregateAllRocketeers_`, the pure logic these two wrap, is already covered by Task 4. Verification is the manual smoke test in Task 9.

- [ ] **Step 1: Add `getAllRocketeersData()` after `getGoalsComplianceData`**

`getGoalsComplianceData` currently ends at line 260 (`}`) followed by a blank line and `function saveHRNote(data) {` at line 262. Insert between them:

```js
function getAllRocketeersData() {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  // Quarter-independent — one cache entry per scope (admin/viewer share one,
  // managers get their own), same scoping rationale as getGoalsComplianceData.
  var scopeKey = (access.role === 'admin' || access.role === 'viewer') ? 'admin' : access.email;
  var cacheKey = CONFIG_GD.CACHE_VER + 'allrock_' + scopeKey;
  var cache    = CacheService.getScriptCache();

  var withLiveAccess_ = function (obj) {
    obj.userRole         = access.role;
    obj.userEmail        = access.email;
    obj.managerScopeName = (access.role === 'manager') ? access.delegateScopeName : null;
    return obj;
  };

  var tryReadCache_ = function () {
    var cached = cacheGetChunked_(cache, cacheKey);
    if (!cached) return null;
    try { return withLiveAccess_(JSON.parse(cached)); } catch (e) { return null; }
  };

  var hit = tryReadCache_();
  if (hit) return hit;

  var lock    = LockService.getScriptLock();
  var gotLock = false;
  try { gotLock = lock.tryLock(CONFIG_GD.LOCK_WAIT_MS); }
  catch (e) { log_('Lock acquisition failed, proceeding unlocked: ' + e.message); }

  try {
    if (gotLock) {
      hit = tryReadCache_();
      if (hit) return hit;
    }

    var result = buildAllRocketeersData_(access);

    try { cachePutChunked_(cache, cacheKey, JSON.stringify(result), CONFIG_GD.CACHE_TTL); }
    catch (e) { log_('Cache put skipped: ' + e.message); }

    return withLiveAccess_(result);
  } finally {
    if (gotLock) lock.releaseLock();
  }
}
```

- [ ] **Step 2: Add `buildAllRocketeersData_()` after `buildComplianceData_`**

`buildComplianceData_` currently ends at line 557 (`}`) followed by a blank line and `// ── Aggregation ──` at line 559. Insert between them:

```js
function buildAllRocketeersData_(access) {
  log_('buildAllRocketeersData_ | building all-time rocketeer roster');

  var allRd         = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);
  var fullRosterMap = getFullRosterMap_();

  var managerScopeName = null;
  var scopeSet = null;
  if (access && access.role === 'manager') {
    managerScopeName = access.delegateScopeName;
    scopeSet = resolveGDManagerScope_(fullRosterMap, normName_(managerScopeName));
  }

  var agg = aggregateAllRocketeers_(allRd, fullRosterMap, scopeSet);

  log_('buildAllRocketeersData_ done | rocketeers: ' + agg.totalRocketeers +
       ' | managers: ' + agg.managers.length);

  return {
    managers:         agg.managers,
    totalRocketeers:  agg.totalRocketeers,
    generatedAt:      new Date().toISOString(),
    userRole:         access ? access.role  : null,
    userEmail:        access ? access.email : null,
    managerScopeName: managerScopeName,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add "goalCompliance.js"
git commit -m "$(cat <<'EOF'
Add getAllRocketeersData server endpoint

Same three-layer shape as getGoalsComplianceData/buildComplianceData_:
access-gated, chunked-cache + script-lock entry point wrapping the new
pure aggregateAllRocketeers_ aggregation.
EOF
)"
```

---

### Task 6: Extend `bustCache` to clear the new cache key

**Files:**
- Modify: `goalCompliance.js:338-355`

- [ ] **Step 1: Add the `allrock_` cache key removal**

Replace:

```js
function bustCache(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  var cache = CacheService.getScriptCache();
  var toRemove = [CONFIG_GD.DEFAULT_QUARTER];
  if (quarter && quarter !== CONFIG_GD.DEFAULT_QUARTER) toRemove.push(quarter);

  // Cache keys are scoped by role/email (see getGoalsComplianceData) and may be
  // chunked (see cachePutChunked_) — remove both the shared admin/viewer entry and
  // the calling user's own scoped entry, chunks included, so Refresh works for
  // whichever role clicked it.
  var scopeKeys = ['admin', access.email];
  toRemove.forEach(function(q) {
    scopeKeys.forEach(function(sk) { cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + q + '_' + sk); });
  });
  return { ok: true };
}
```

with:

```js
function bustCache(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  var cache = CacheService.getScriptCache();
  var toRemove = [CONFIG_GD.DEFAULT_QUARTER];
  if (quarter && quarter !== CONFIG_GD.DEFAULT_QUARTER) toRemove.push(quarter);

  // Cache keys are scoped by role/email (see getGoalsComplianceData) and may be
  // chunked (see cachePutChunked_) — remove both the shared admin/viewer entry and
  // the calling user's own scoped entry, chunks included, so Refresh works for
  // whichever role clicked it.
  var scopeKeys = ['admin', access.email];
  toRemove.forEach(function(q) {
    scopeKeys.forEach(function(sk) { cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + q + '_' + sk); });
  });

  // All Rocketeers tab is quarter-independent — one cache entry per scope,
  // not per quarter (see getAllRocketeersData) — clear it here too so Refresh
  // covers both views in one call.
  scopeKeys.forEach(function(sk) { cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + 'allrock_' + sk); });

  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add "goalCompliance.js"
git commit -m "feat: bust the All Rocketeers cache entry on Refresh too"
```

---

### Task 7: GDash.html — tab button, pane markup, state, wiring

**Files:**
- Modify: `GDash.html:329-330` (tab-nav button)
- Modify: `GDash.html:477-479` (new pane markup)
- Modify: `GDash.html:529-539` (state object `S`)
- Modify: `GDash.html:748-756` (`renderTab` dispatch)
- Modify: `GDash.html:605-610` (`refreshData` cache reset)

No test — this is markup/wiring with no pure logic yet (that's Task 8). Verified visually in Task 9.

- [ ] **Step 1: Add the tab button**

Replace:

```html
    <button class="tab-btn"        onclick="switchTab('hrtracker')" data-tab="hrtracker">HR Tracker</button>
  </div>
```

with:

```html
    <button class="tab-btn"        onclick="switchTab('hrtracker')" data-tab="hrtracker">HR Tracker</button>
    <button class="tab-btn"        onclick="switchTab('allrockets')" data-tab="allrockets">All Rocketeers</button>
  </div>
```

- [ ] **Step 2: Add the pane markup**

Replace:

```html
        <div class="section-body" id="tracker-body"></div>
      </div>
    </div>

    <!-- ── ACCESS CONTROL (admin only, opened from the ☰ menu) ── -->
```

with:

```html
        <div class="section-body" id="tracker-body"></div>
      </div>
    </div>

    <!-- ── ALL ROCKETEERS ── -->
    <div id="pane-allrockets" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>All Rocketeers</h2><p class="section-sub">Every Rocketeer who has ever logged a goal · grouped by manager · all quarters combined</p></div>
        </div>
        <div class="section-body">
          <input type="text" id="allrock-filter" placeholder="Filter by manager or rocketeer name…"
                 oninput="filterAllRocketeers(this.value)"
                 style="width:100%;max-width:360px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:inherit;margin-bottom:14px">
          <div id="allrock-groups"></div>
        </div>
      </div>
    </div>

    <!-- ── ACCESS CONTROL (admin only, opened from the ☰ menu) ── -->
```

- [ ] **Step 3: Add state fields**

Replace:

```js
var S = {
  data:           null,
  notes:          [],
  userEmail:      '',
  filters:        { location:[], department:[], jobFamily:[], status:[], supervisor:[] },
  charts:         {},
  activeTab:      'overview',
  lastRegularTab: 'overview',  // fallback target when leaving the Access Control pane
  reviewTarget:   null,
  trendDepts:     [],  // department lines shown on trend chart
};
```

with:

```js
var S = {
  data:           null,
  notes:          [],
  userEmail:      '',
  filters:        { location:[], department:[], jobFamily:[], status:[], supervisor:[] },
  charts:         {},
  activeTab:      'overview',
  lastRegularTab: 'overview',  // fallback target when leaving the Access Control pane
  reviewTarget:   null,
  trendDepts:     [],  // department lines shown on trend chart
  allRocketeersData:   null,  // lazy-loaded on first visit to the All Rocketeers tab
  allRocketeersFilter: '',    // current text filter on that tab
};
```

- [ ] **Step 4: Wire `renderTab` dispatch**

Replace:

```js
function renderTab(tabId) {
  var emps = getFiltered();
  if      (tabId === 'overview')  renderOverview(emps);
  else if (tabId === 'trend')     renderEngagement(emps);
  else if (tabId === 'breakdown') renderBreakdown(emps);
  else if (tabId === 'atrisk')    renderAtRisk(emps);
  else if (tabId === 'hrtracker') renderHRTracker();
  else if (tabId === 'access')    renderAccessTab_();
}
```

with:

```js
function renderTab(tabId) {
  var emps = getFiltered();
  if      (tabId === 'overview')   renderOverview(emps);
  else if (tabId === 'trend')      renderEngagement(emps);
  else if (tabId === 'breakdown')  renderBreakdown(emps);
  else if (tabId === 'atrisk')     renderAtRisk(emps);
  else if (tabId === 'hrtracker')  renderHRTracker();
  else if (tabId === 'allrockets') renderAllRocketeers();
  else if (tabId === 'access')     renderAccessTab_();
}
```

- [ ] **Step 5: Reset the client-side cache on Refresh**

Replace:

```js
function refreshData() {
  document.getElementById('loading').style.display = '';
  document.getElementById('app').style.display = 'none';
  var quarter = S.data && S.data.quarter;
  google.script.run.withSuccessHandler(function() { init(); }).withFailureHandler(function() { init(); }).bustCache(quarter);
}
```

with:

```js
function refreshData() {
  document.getElementById('loading').style.display = '';
  document.getElementById('app').style.display = 'none';
  var quarter = S.data && S.data.quarter;
  S.allRocketeersData = null;  // force a re-fetch next time that tab is opened
  google.script.run.withSuccessHandler(function() { init(); }).withFailureHandler(function() { init(); }).bustCache(quarter);
}
```

- [ ] **Step 6: Commit**

```bash
git add GDash.html
git commit -m "$(cat <<'EOF'
Wire up the All Rocketeers tab shell in GDash.html

Tab button, pane markup, client state, and renderTab/refreshData
wiring. renderAllRocketeers() itself lands in the next task.
EOF
)"
```

---

### Task 8: GDash.html — render logic for the All Rocketeers tab

**Files:**
- Modify: `GDash.html:1741-1743` (insert new render functions before `toggleSection`)

- [ ] **Step 1: Add the render functions**

Replace:

```js
function pillFor_(status) {
  var cls = { 'Reviewed':'pill-reviewed','Needs Follow-up':'pill-followup',
              'Escalated':'pill-escalated','Resolved':'pill-resolved' }[status] || 'pill-reviewed';
  return '<span class="status-pill ' + cls + '">' + esc(status) + '</span>';
}

function toggleSection(id, iconId) {
```

with:

```js
function pillFor_(status) {
  var cls = { 'Reviewed':'pill-reviewed','Needs Follow-up':'pill-followup',
              'Escalated':'pill-escalated','Resolved':'pill-resolved' }[status] || 'pill-reviewed';
  return '<span class="status-pill ' + cls + '">' + esc(status) + '</span>';
}

// ── ALL ROCKETEERS ───────────────────────────────────────────────
function renderAllRocketeers() {
  var container = document.getElementById('allrock-groups');
  if (S.allRocketeersData) { renderAllRocketeersGroups_(); return; }

  container.innerHTML = '<div class="empty-state">⏳ <p>Loading…</p></div>';
  google.script.run
    .withSuccessHandler(function(data) {
      if (data && data.denied) {
        container.innerHTML = '<div class="empty-state">🔒 <p>Access denied for ' + esc(data.email || 'this account') + '.</p></div>';
        return;
      }
      S.allRocketeersData = data;
      renderAllRocketeersGroups_();
    })
    .withFailureHandler(function(err) {
      container.innerHTML = '<div class="empty-state">⚠ <p>' + esc(err.message || 'Failed to load.') + '</p></div>';
    })
    .getAllRocketeersData();
}

function filterAllRocketeers(value) {
  S.allRocketeersFilter = String(value || '').trim().toLowerCase();
  renderAllRocketeersGroups_();
}

function renderAllRocketeersGroups_() {
  var container = document.getElementById('allrock-groups');
  var data = S.allRocketeersData;
  if (!data || !data.managers || !data.managers.length) {
    container.innerHTML = '<div class="empty-state">📋 <p>No rocketeers found.</p></div>';
    return;
  }

  var q = S.allRocketeersFilter;
  var html = '';

  data.managers.forEach(function(m, mi) {
    var supMatches  = !!q && m.supervisor.toLowerCase().indexOf(q) !== -1;
    var rocketeers  = m.rocketeers.filter(function(r) {
      return !q || supMatches || r.name.toLowerCase().indexOf(q) !== -1;
    });
    if (q && !rocketeers.length) return;

    var groupId        = 'allrock-group-' + mi;
    var toggleId        = 'allrock-toggle-' + mi;
    var openByDefault  = !!q; // auto-expand groups that match the filter

    html += '<div class="section-card" style="margin-bottom:10px">';
    html += '<div class="section-head" style="cursor:pointer;padding:10px 16px" onclick="toggleSection(\'' + groupId + '\',\'' + toggleId + '\')">';
    html += '<div><h2 style="font-size:13px">' + esc(m.supervisor) + ' <span style="color:var(--muted);font-weight:600">(' + m.teamSize + ')</span></h2></div>';
    html += '<span id="' + toggleId + '" style="color:var(--muted);font-size:12px">' + (openByDefault ? '▴' : '▾') + '</span>';
    html += '</div>';
    html += '<div id="' + groupId + '" style="display:' + (openByDefault ? '' : 'none') + '">';
    html += '<div class="tbl-wrap"><table class="data-table"><thead><tr>' +
            '<th>Rocketeer</th><th>Department</th><th>Job Title</th><th>Total Goals</th><th>First Qtr</th><th>Last Qtr</th>' +
            '</tr></thead><tbody>';
    rocketeers.forEach(function(r) {
      html += '<tr>' +
        '<td style="font-weight:600;white-space:nowrap">' + esc(r.name) + '</td>' +
        '<td style="color:var(--slate);font-size:11px">' + esc(r.department || '—') + '</td>' +
        '<td style="color:var(--slate);font-size:11px">' + esc(r.jobTitle || '—') + '</td>' +
        '<td>' + r.totalGoals + '</td>' +
        '<td style="color:var(--slate);font-size:11px">' + esc(r.firstQuarter || '—') + '</td>' +
        '<td style="color:var(--slate);font-size:11px">' + esc(r.lastQuarter || '—') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div></div>';
  });

  container.innerHTML = html || '<div class="empty-state">📋 <p>No matches for "' + esc(q) + '".</p></div>';
}

function toggleSection(id, iconId) {
```

- [ ] **Step 2: Commit**

```bash
git add GDash.html
git commit -m "$(cat <<'EOF'
Implement All Rocketeers tab rendering

Lazy-loads getAllRocketeersData() on first visit, renders one
collapsible section per manager with a name/manager text filter that
auto-expands matching groups.
EOF
)"
```

---

### Task 9: Manual smoke test (post-deploy)

**Files:** none — this is a manual verification checklist. There is no clasp/CI setup in this repo (confirmed: no `.clasp.json`), so deployment is the existing manual copy-paste-into-the-Apps-Script-editor process already used for this project. This task cannot be automated from this repo; run it once `goalCompliance.js` and `GDash.html` are pasted into the Goals Compliance Dashboard's Apps Script project.

- [ ] **Step 1: Run the GAS-side unit tests**

In the Apps Script editor, select `_test_isIntern_` from the function dropdown → Run → Execution Log shows `✅ _test_isIntern_ passed`. Repeat for `_test_stripInterns_`, `_test_aggregateAllRocketeers_`, and the pre-existing `_test_resolveGDManagerScope_` (regression check — this plan didn't touch it, confirm it still passes).

- [ ] **Step 2: Verify intern exclusion in the compliance view**

Open the dashboard as an Admin. Note the `Total Employees` count on Overview for the default quarter. Pick a known intern (one of the 7 titles from this task's origin: Professional Services / Managed Services / Operations / Marketing / Engineering / Technical Content / Product Marketing) and confirm they do **not** appear in the Overview, Breakdown, or At Risk tables, and are not counted in `Total Employees` or the compliance rate.

- [ ] **Step 3: Verify the All Rocketeers tab loads and groups correctly**

Click the "All Rocketeers" tab. Expected: a list of collapsible manager groups, each showing a team-size count in its header. Expand a group you know has both current and former members — the same known intern from Step 2 must **not** appear anywhere in this tab either. Click a manager's row to confirm it expands/collapses.

- [ ] **Step 4: Verify the filter box**

Type a manager's name into the filter input. Expected: only matching manager group(s) remain visible and auto-expand. Clear the box — all groups return, collapsed to their original state.

- [ ] **Step 5: Verify manager-role scoping**

Log in as (or impersonate, if your test setup supports it) a Manager-role account. Expected: the All Rocketeers tab shows only that manager's own org tree — no other managers' groups appear.

- [ ] **Step 6: Verify Refresh busts both caches**

Click "↺ Refresh". Expected: the loading spinner appears, both the Overview data and (on next visit to All Rocketeers) that tab's data are freshly recomputed rather than served from a stale cache — confirm by checking Apps Script Executions for a fresh `buildComplianceData_`/`buildAllRocketeersData_` log line timestamped after the click.
