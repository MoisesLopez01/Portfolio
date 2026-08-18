# Report Load Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One cold execution builds and caches every in-scope team (sheet reads memoized per execution), and the client prefetches the other teams in the background — making the team toggle instant.

**Architecture:** Server: an execution-scoped memo inside `loadSheet_PS_` (plus two direct-read sites) turns extra-team builds into pure in-memory assembly; `getPSReportData` gains a budget-gated team-warm loop after its primary compute; the warmer collapses to a single call. Frontend: a sequential background prefetch chain fills `STATE.teamData`; `switchTeam` waits on an in-flight prefetch instead of duplicating the fetch.

**Tech Stack:** Google Apps Script (V8) server .js + HtmlService SPA. Node used for syntax checks and the memo unit test (whole-file eval pattern with stubbed `Logger`).

**Spec:** `ps-dashboard/docs/specs/2026-07-09-report-load-performance-design.md`

**Global constraints:**
- Pin `git add` to NAMED FILES only (dirty tree has unrelated WIP); NEVER push.
- Locate edits by exact anchor code, not line numbers (they drift; concurrent sessions touch these files).
- The primary payload's shape, scope security ordering (scope before team), and the empty-team fallback behavior must not change.
- Line refs below are as of commit `1950aaf`.

---

## File Structure

| File | Change |
|---|---|
| `PS Contribution Report.js` | `SHEET_MEMO_` + memoized `loadSheet_PS_` + `memoSheetData_`; PTO-accum + PH reads memoized; `reportCacheKey_`; team-warm loop in `getPSReportData`; single-call `warmReportCache`; `_test_sheetMemo` |
| `PS Dashboard.html` | Prefetch module (`schedulePrefetch_`/`prefetchNext_`); `loadData`/`onDataLoaded`/`switchTeam` wiring |

---

### Task 1: Server — execution-scoped sheet memo

**Files:**
- Modify: `PS Contribution Report.js` (`loadSheet_PS_` ~line 1198, `readPTOAccumulationProfiles_` ~1706, `readPHData_` ~2954, new `_test_sheetMemo` near the end of the file)

- [ ] **Step 1: Replace `loadSheet_PS_` with the memoized version**

Find (exact):

```js
function loadSheet_PS_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { headers: (data[0] || []).map(h => String(h).trim()), rows: [] };
  return { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
}
```

Replace with:

```js
// Execution-scoped sheet cache: GAS resets globals per execution, so entries
// live exactly one web-app call / trigger run. Computing several teams in one
// execution (getPSReportData's team-warm loop) then costs ONE fetch per sheet
// instead of one per team. Masters are never handed out — every access gets
// row-copied views, so a caller mutating rows in place can never leak into
// another team's build.
const SHEET_MEMO_ = {};

// Generic memo access for raw sheet reads that bypass loadSheet_PS_
// (PTO accumulation, PH). 2D-array results are returned as row copies.
function memoSheetData_(key, producer) {
  if (!(key in SHEET_MEMO_)) SHEET_MEMO_[key] = producer();
  const hit = SHEET_MEMO_[key];
  return Array.isArray(hit) ? hit.map(r => Array.isArray(r) ? r.slice() : r) : hit;
}

function loadSheet_PS_(ss, sheetName) {
  const key = ss.getId() + "::" + sheetName;
  if (!(key in SHEET_MEMO_)) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) { SHEET_MEMO_[key] = null; }
    else {
      const data = sh.getDataRange().getValues();
      SHEET_MEMO_[key] = (data.length < 2)
        ? { headers: (data[0] || []).map(h => String(h).trim()), rows: [] }
        : { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
    }
  }
  const hit = SHEET_MEMO_[key];
  if (!hit) return null;
  return { headers: hit.headers.slice(), rows: hit.rows.map(r => r.slice()) };
}
```

- [ ] **Step 2: Memoize the PTO accumulation raw read**

In `readPTOAccumulationProfiles_`, find (exact):

```js
    Logger.log(`🕐 readPTOAccumulationProfiles_: opening ${CONFIG_PS.PTO_ACCUM_SS_ID}`);
    const ss = SpreadsheetApp.openById(getExternalSSIds_().ptoAccum);
    const sh = ss.getSheetByName(CONFIG_PS.PTO_ACCUM_SHEET);
    if (!sh) {
      Logger.log(`❌ readPTOAccumulationProfiles_: sheet "${CONFIG_PS.PTO_ACCUM_SHEET}" not found.`);
      return {};
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) { Logger.log(`⚠️ readPTOAccumulationProfiles_: no data rows.`); return {}; }

    const rawData  = sh.getRange(1, 1, lastRow, lastCol).getValues();
```

Replace with:

```js
    // Raw values memoized per execution — this reader runs once per TEAM (the
    // deptSet differs), but the sheet itself is identical; filtering stays per-call.
    const rawData = memoSheetData_("ptoAccum::" + CONFIG_PS.PTO_ACCUM_SHEET, () => {
      Logger.log(`🕐 readPTOAccumulationProfiles_: opening ${CONFIG_PS.PTO_ACCUM_SS_ID}`);
      const ss = SpreadsheetApp.openById(getExternalSSIds_().ptoAccum);
      const sh = ss.getSheetByName(CONFIG_PS.PTO_ACCUM_SHEET);
      if (!sh) {
        Logger.log(`❌ readPTOAccumulationProfiles_: sheet "${CONFIG_PS.PTO_ACCUM_SHEET}" not found.`);
        return null;
      }
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow < 2) { Logger.log(`⚠️ readPTOAccumulationProfiles_: no data rows.`); return null; }
      return sh.getRange(1, 1, lastRow, lastCol).getValues();
    });
    if (!rawData) return {};
```

(The next existing line, `const headers  = rawData[0].map(h => String(h).trim());`, stays unchanged and now reads from the memoized copy.)

- [ ] **Step 3: Memoize the PH read**

In `readPHData_`, find (exact):

```js
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const sh  = ss.getSheetByName(CONFIG_PS.SHEET_PH);
    if (!sh) return [];
    const rows = sh.getDataRange().getValues();
```

Replace with:

```js
    const rows = memoSheetData_("bound::" + CONFIG_PS.SHEET_PH, () => {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(CONFIG_PS.SHEET_PH);
      return sh ? sh.getDataRange().getValues() : null;
    });
    if (!rows) return [];
```

- [ ] **Step 4: Add `_test_sheetMemo` (Node-runnable)**

Insert immediately BEFORE the existing `function _test_weightsResolver` (search for that name; if absent, place at end of file):

```js
// Node test for the execution-scoped sheet memo (no GAS APIs).
// Run: node -e "const fs=require('fs');const src=fs.readFileSync('PS Teams.js','utf8')+'\n'+fs.readFileSync('PS Contribution Report.js','utf8');global.Logger={log:()=>{}};eval(src+'\n_test_sheetMemo();');"
function _test_sheetMemo() {
  let fetches = 0;
  const fakeSS = (id) => ({
    getId: () => id,
    getSheetByName: (name) => name === "missing" ? null : ({
      getDataRange: () => ({ getValues: () => { fetches++; return [["H1", "H2"], ["a", 1], ["b", 2]]; } }),
    }),
  });
  const results = [];
  const check = (label, cond) => { results.push(`${cond ? "✅" : "❌"} ${label}`); if (!cond) throw new Error(`_test_sheetMemo FAILED: ${label}\n${results.join("\n")}`); };

  const ss = fakeSS("memoTestA");
  const first = loadSheet_PS_(ss, "Tab1");
  check("first read fetches", fetches === 1 && first.rows.length === 2);
  const second = loadSheet_PS_(ss, "Tab1");
  check("second read memoized (no new fetch)", fetches === 1);
  first.rows[0][0] = "MUTATED";
  first.headers[0] = "MUTATED";
  const third = loadSheet_PS_(ss, "Tab1");
  check("mutation does not leak across accesses", third.rows[0][0] === "a" && third.headers[0] === "H1");
  loadSheet_PS_(ss, "Tab2");
  check("different sheet fetches separately", fetches === 2);
  check("missing sheet memoizes null", loadSheet_PS_(ss, "missing") === null && loadSheet_PS_(ss, "missing") === null);

  let produced = 0;
  const raw1 = memoSheetData_("memoTestB", () => { produced++; return [["X"], ["y"]]; });
  raw1[1][0] = "MUTATED";
  const raw2 = memoSheetData_("memoTestB", () => { produced++; return [["X"], ["y"]]; });
  check("memoSheetData_ produces once + row copies", produced === 1 && raw2[1][0] === "y");

  Logger.log(results.join("\n"));
  Logger.log("✅ _test_sheetMemo: all checks passed");
  return true;
}
```

- [ ] **Step 5: Run the test and the syntax check**

```bash
node -e "const fs=require('fs');const src=fs.readFileSync('PS Teams.js','utf8')+'\n'+fs.readFileSync('PS Contribution Report.js','utf8');global.Logger={log:()=>{}};eval(src+'\n_test_sheetMemo();');console.log('MEMO TEST OK')"
node --check "PS Contribution Report.js" && echo "SYNTAX OK"
```

Expected: `MEMO TEST OK` and `SYNTAX OK`. Also re-run the existing resolver suite to prove no regression:

```bash
node -e "const fs=require('fs');const src=fs.readFileSync('PS Teams.js','utf8')+'\n'+fs.readFileSync('PS Contribution Report.js','utf8');global.Logger={log:()=>{}};eval(src+'\n_test_weightsResolver();_test_teamForProfile();');console.log('SUITES OK')"
```

Expected: `SUITES OK` (both existing suites print their pass lines through the stubbed Logger — the final OK is the assertion-free signal; any thrown check aborts the command).

- [ ] **Step 6: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "perf(report): execution-scoped sheet memo — one fetch per sheet per execution"
```

---

### Task 2: Server — team-warm loop + single-call warmer

**Files:**
- Modify: `PS Contribution Report.js` (`warmReportCache` ~line 205, `getPSReportData` ~3084)

- [ ] **Step 1: Add `reportCacheKey_` and `execT0`; use the helper for the primary key**

Find (exact):

```js
function getPSReportData(bustCache, teamKey) {
  try {
    const access = checkDashboardAccess();
```

Replace with:

```js
// Cache key for one (team × user scope) report entry — admins/viewers share
// one entry per team; managers get per-email entries (scoped payloads differ).
function reportCacheKey_(ver, teamKey, access) {
  return (access.role === "admin" || access.role === "viewer")
    ? "ps_v" + ver + "_" + teamKey + "_admin"
    : "ps_v" + ver + "_" + teamKey + "_" + access.email;
}

function getPSReportData(bustCache, teamKey) {
  try {
    const execT0 = Date.now();   // team-warm loop budgets against the ~6-min execution cap
    const access = checkDashboardAccess();
```

Then find (exact):

```js
    const _cacheKey = (access.role === "admin" || access.role === "viewer")
      ? "ps_v" + _cacheVer + "_" + team.key + "_admin"
      : "ps_v" + _cacheVer + "_" + team.key + "_" + access.email;
```

Replace with:

```js
    const _cacheKey = reportCacheKey_(_cacheVer, team.key, access);
```

- [ ] **Step 2: Add the team-warm loop after the primary compute**

Find (exact):

```js
    const result = computePSReport_(access, teamScoped, managerScopeName, weeks, weights, servedTeam, jobCatalog, teamsInScope);
    cachePutLarge_(_sCache, _cacheKey, JSON.stringify(result), CONFIG_PS.CACHE_TTL_SEC);
    return result;
```

Replace with:

```js
    const result = computePSReport_(access, teamScoped, managerScopeName, weeks, weights, servedTeam, jobCatalog, teamsInScope);
    cachePutLarge_(_sCache, _cacheKey, JSON.stringify(result), CONFIG_PS.CACHE_TTL_SEC);

    // ── Team-warm: build the caller's OTHER teams in this same execution ────
    // The sheet memo (loadSheet_PS_ / memoSheetData_) makes each extra team
    // pure in-memory assembly — no repeat sheet I/O — so one cold compute
    // leaves every in-scope team cached for this user's scope and the team
    // toggle serves from cache instead of a fresh multi-minute execution.
    // Budget-gated against the ~6-min execution cap; failures log and never
    // risk the primary response. Scope security is inherited: `roster` is
    // already scope-filtered, so a manager's warm entries stay org-tree-only.
    const TEAM_WARM_BUDGET_MS = 4.5 * 60 * 1000;
    teamsInScope.forEach(t => {
      if (t.key === servedTeam.key) return;
      if (Date.now() - execT0 > TEAM_WARM_BUDGET_MS) { Logger.log(`⚠️ team-warm: budget spent — skipped "${t.key}"`); return; }
      try {
        const tTeam   = teamByKey_(t.key);
        const tScoped = teamRoster_(roster, tTeam.key);
        if (tScoped.size === 0) return;
        const tCacheKey = reportCacheKey_(_cacheVer, tTeam.key, access);
        if (!bustCache && cacheGetLarge_(_sCache, tCacheKey)) return;   // already warm
        const s0 = Date.now();
        const tRes = computePSReport_(access, tScoped, managerScopeName, weeks, weights, tTeam, jobCatalog, teamsInScope);
        cachePutLarge_(_sCache, tCacheKey, JSON.stringify(tRes), CONFIG_PS.CACHE_TTL_SEC);
        Logger.log(`✅ team-warm[${tTeam.key}]: built in ${Math.round((Date.now() - s0) / 1000)}s`);
      } catch (te) {
        Logger.log(`❌ team-warm[${t.key}]: ${te.message}`);
      }
    });

    return result;
```

- [ ] **Step 3: Collapse the warmer to a single call**

Find (exact):

```js
function warmReportCache() {
  const t0 = Date.now();
  // Services first (heaviest + most-visited). GAS trigger runs are capped at
  // ~6 minutes — stop starting new teams past the safety threshold; the next
  // 30-min run picks the skipped ones up.
  const TIME_BUDGET_MS = 4.5 * 60 * 1000;
  TEAMS_.forEach(t => {
    if (Date.now() - t0 > TIME_BUDGET_MS) { Logger.log(`⚠️ warmReportCache: time budget spent — skipped "${t.key}"`); return; }
    const s0 = Date.now();
    const res = getPSReportData(true, t.key);
    const secs = Math.round((Date.now() - s0) / 1000);
    if (res && res.ok) Logger.log(`✅ warmReportCache[${t.key}]: rebuilt in ${secs}s`);
    else Logger.log(`❌ warmReportCache[${t.key}] after ${secs}s: ${(res && res.error) || "denied/unknown"}`);
  });
}
```

Replace with:

```js
function warmReportCache() {
  // One call rebuilds EVERY admin-scope team entry: getPSReportData's
  // team-warm loop (with the execution-scoped sheet memo) builds the other
  // teams in the same execution at in-memory cost. Per-team timing arrives
  // via the ✅ team-warm[...] log lines.
  const s0 = Date.now();
  const res = getPSReportData(true, "services");
  const secs = Math.round((Date.now() - s0) / 1000);
  if (res && res.ok) Logger.log(`✅ warmReportCache: all admin team entries rebuilt in ${secs}s`);
  else Logger.log(`❌ warmReportCache after ${secs}s: ${(res && res.error) || "denied/unknown"}`);
}
```

- [ ] **Step 4: Verify**

```bash
node --check "PS Contribution Report.js" && echo "SYNTAX OK"
```

Grep checks (Grep tool): `reportCacheKey_` → 3 matches (definition + 2 call sites); `team-warm` → ≥4 matches; `TIME_BUDGET_MS` → 0 matches (old warmer loop gone).

Re-run both Node suites from Task 1 Step 5 — expected `SUITES OK`.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "perf(report): one execution warms every in-scope team; warmer collapses to a single call"
```

---

### Task 3: Frontend — background team prefetch

**Files:**
- Modify: `PS Dashboard.html` (`loadData` ~2447, `onDataLoaded` ~2468/2583, `switchTeam` ~2645; new prefetch module between `loadData` and `onDataLoaded`)

- [ ] **Step 1: Add the prefetch module**

Find (exact — the end of `loadData` and start of `onDataLoaded`):

```js
    .getPSReportData(forceRefresh, STATE.activeTeam);
}

function onDataLoaded(payload) {
```

Replace with:

```js
    .getPSReportData(forceRefresh, STATE.activeTeam);
}

// ── BACKGROUND TEAM PREFETCH ──────────────────────────────
// After the active team renders, quietly pull the user's other teams into
// STATE.teamData so the toggle is instant. Sequential (one request at a
// time), starts after a short delay so first paint wins, and never touches
// loadData's concurrency guards (_loadingInFlight/_loadSeq) — separate channel.
var _prefetchInFlight = {};   // teamKey → true while its background fetch runs
var _prefetchWanted   = null; // team the user toggled to while its prefetch was in flight
var _prefetchTimer    = null;

function schedulePrefetch_() {
  clearTimeout(_prefetchTimer);
  _prefetchTimer = setTimeout(prefetchNext_, 4000);
}

function prefetchNext_() {
  if (!DATA || !DATA.meta) return;
  var teams = DATA.meta.availableTeams || [];
  var next = null;
  for (var i = 0; i < teams.length; i++) {
    var k = teams[i].key;
    if (!STATE.teamData[k] && !_prefetchInFlight[k]) { next = k; break; }
  }
  if (!next) return;                       // everything cached — chain ends
  var reqKey = next;
  _prefetchInFlight[reqKey] = true;
  google.script.run
    .withSuccessHandler(function(p) {
      delete _prefetchInFlight[reqKey];
      if (p && p.denied) return;           // access revoked — stop the chain
      if (p && p.ok && p.meta && p.meta.team) {
        var servedKey = p.meta.team.key;
        if (!STATE.teamData[servedKey]) STATE.teamData[servedKey] = p;
        if (_prefetchWanted === reqKey && STATE.activeTeam === reqKey) {
          // User is waiting on this request. onDataLoaded is payload-is-truth:
          // even a fallback team (servedKey !== reqKey) renders and snaps the
          // toggle, so the loading screen can never strand.
          _prefetchWanted = null;
          onDataLoaded(p);
        }
      } else if (_prefetchWanted === reqKey && STATE.activeTeam === reqKey) {
        _prefetchWanted = null;
        loadData(false);                   // bad payload while the user waits — fetch in the foreground
        return;
      }
      prefetchNext_();
    })
    .withFailureHandler(function(e) {
      delete _prefetchInFlight[reqKey];
      if (_prefetchWanted === reqKey && STATE.activeTeam === reqKey) {
        _prefetchWanted = null;
        loadData(false);                   // user is waiting — fetch in the foreground
      } else {
        console.warn("Team prefetch failed for " + reqKey + ": " + e);
        prefetchNext_();
      }
    })
    .getPSReportData(false, reqKey);
}

function onDataLoaded(payload) {
```

- [ ] **Step 2: `loadData` — clear the prefetch wait and tag refresh responses**

Find (exact):

```js
  _loadingInFlight = true;
  _loadingTeam = STATE.activeTeam;
  var seq = ++_loadSeq;
```

Replace with:

```js
  _loadingInFlight = true;
  _loadingTeam = STATE.activeTeam;
  _prefetchWanted = null;                  // a user-driven load supersedes any wait-on-prefetch
  var seq = ++_loadSeq;
```

Then find (exact):

```js
    .withSuccessHandler(function(p) { _loadingInFlight = false; if (seq !== _loadSeq) return; onDataLoaded(p); })
```

Replace with:

```js
    .withSuccessHandler(function(p) { _loadingInFlight = false; if (seq !== _loadSeq) return; onDataLoaded(p, forceRefresh); })
```

- [ ] **Step 3: `onDataLoaded` — refresh invalidation + prefetch kick-off**

Change the signature. Find (exact — this is now the line after the prefetch module inserted in Step 1):

```js
function onDataLoaded(payload) {
```

Replace with:

```js
function onDataLoaded(payload, wasRefresh) {
```

Find (exact):

```js
  STATE.teamData[servedTeam] = payload;
  renderTeamToggle_();
```

Replace with:

```js
  STATE.teamData[servedTeam] = payload;
  if (wasRefresh) {
    // The server just force-rebuilt every in-scope team — other teams' client
    // copies are stale. Drop them; the prefetch chain re-pulls fresh entries.
    Object.keys(STATE.teamData).forEach(function(k) {
      if (k !== servedTeam) delete STATE.teamData[k];
    });
  }
  renderTeamToggle_();
```

Find (exact — the end of `onDataLoaded`):

```js
  buildFilterBar();
  populateRkWeekSelect();
  populateRadarWeekSelect();
  populateEbWeekSelect();
  renderGranCtls_();
  updatePeriodPickerLabels_();
  switchTab(STATE.activeTab);
}
```

Replace with:

```js
  buildFilterBar();
  populateRkWeekSelect();
  populateRadarWeekSelect();
  populateEbWeekSelect();
  renderGranCtls_();
  updatePeriodPickerLabels_();
  switchTab(STATE.activeTab);

  schedulePrefetch_();   // background-fill the other teams (no-op when all cached)
}
```

- [ ] **Step 4: `switchTeam` — wait on an in-flight prefetch instead of double-fetching**

Find (exact):

```js
  var cached = STATE.teamData[key];
  if (cached) {
    // Disqualify any in-flight response for another team — rendering from
    // cache makes this click the source of truth (seq mismatch discards it).
    _loadSeq++;
    _loadingInFlight = false;
    _loadingTeam = null;
    onDataLoaded(cached);             // instant re-render from client cache
  }
  else loadData(false);               // cold team — fetch (shows loading screen)
```

Replace with:

```js
  var cached = STATE.teamData[key];
  if (cached) {
    // Disqualify any in-flight response for another team — rendering from
    // cache makes this click the source of truth (seq mismatch discards it).
    _loadSeq++;
    _loadingInFlight = false;
    _loadingTeam = null;
    _prefetchWanted = null;           // no longer waiting on any prefetch
    onDataLoaded(cached);             // instant re-render from client cache
  }
  else if (_prefetchInFlight[key]) {
    // This team's background prefetch is already in flight — show the loading
    // screen and let its response render via onDataLoaded (no duplicate fetch).
    _prefetchWanted = key;
    document.getElementById("loadingState").style.display = "flex";
    document.getElementById("tabNav").classList.remove("visible");
    VIEWS.forEach(function(v) {
      var pane = document.getElementById(v.paneId);
      if (pane) pane.classList.remove("active");
    });
  }
  else loadData(false);               // cold team — fetch (shows loading screen)
```

- [ ] **Step 5: Verify**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('PS Dashboard.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
blocks.forEach((b, i) => { new Function(b); });
console.log('OK — ' + blocks.length + ' script block(s) parsed');
"
```

Expected: `OK — 1 script block(s) parsed`.

Grep checks: `_prefetchInFlight` → 6 matches; `_prefetchWanted` → 10 matches; `schedulePrefetch_` → 2 matches (definition + onDataLoaded call); `wasRefresh` → 2 matches.

- [ ] **Step 6: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "perf(report): background team prefetch — toggle serves from client cache"
```

---

### Task 4: Verification sweep + live QA handoff

**Files:**
- Read: both changed files

- [ ] **Step 1: Full static sweep**

```bash
node --check "PS Contribution Report.js" && echo "JS OK"
node -e "const fs=require('fs');const src=fs.readFileSync('PS Teams.js','utf8')+'\n'+fs.readFileSync('PS Contribution Report.js','utf8');global.Logger={log:()=>{}};eval(src+'\n_test_sheetMemo();_test_weightsResolver();_test_teamForProfile();');console.log('ALL SUITES OK')"
node -e "
const fs = require('fs');
const html = fs.readFileSync('PS Dashboard.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
blocks.forEach(b => new Function(b));
console.log('HTML OK');
"
git status --short
```

Expected: `JS OK`, `ALL SUITES OK`, `HTML OK`, clean tree for both changed files.

- [ ] **Step 2: Record the live QA checklist (owner's next GAS deploy — push BOTH files; no `PS_CACHE_VER` bump needed)**

1. Editor: run `warmReportCache` manually → log shows one Services build then `✅ team-warm[rnd]` / `✅ team-warm[sales]`, total well under 6 min, no `⚠️ team-warm: budget spent`.
2. Admin: open dashboard (warm), toggle to R&D shortly after load → instant (prefetch) or a short cache read — never a cold compute.
3. Toggle all three teams twice — second pass all instant.
4. Refresh button → full rebuild; toggles instant again after ~one prefetch delay; data freshness note updates.
5. Manager account: first open cold (expected — one compute), subsequent toggles instant.
6. `_test_sheetMemo` also runs in the GAS editor (uses only stubs + Logger).
