# Org Team Toggle (Services / R&D / Sales & Success) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header toggle to the PS Dashboard that switches between three org teams — Services (unchanged), R&D, and Sales & Success (JF004) — each served as its own payload with only the metrics that team has records for.

**Architecture:** A new `PS Teams.js` GAS code tab holds the team registry (key, label, metric set) and the hybrid membership rule (Department "Services" wins first, then JF004 → sales, else rnd). `getPSReportData(bustCache, teamKey)` serves one team per fetch with per-team cache keys; `computePSReport_` skips the RCR/Tracked/Planned readers for teams that lack them. The frontend caches payloads per team client-side and gates rendering through a single `hasMetric_()` helper.

**Tech Stack:** Google Apps Script (V8), single-file HtmlService SPA (`PS Dashboard.html`), CacheService gzip-chunked cache, Node for the standalone unit test.

**Spec:** `ps-dashboard/docs/specs/2026-07-08-org-team-toggle-design.md`

**Repo rules:** All commits stay local — NEVER `git push` (standing user rule). Work happens on the current branch.

**Deploy note:** Tasks 2–5 are interdependent — the dashboard must not be deployed to GAS between Task 2 and Task 5 (a widened roster without team filtering would report the whole company as "Services"). Local commits are fine at every step; deployment happens only in Task 9.

---

### Task 1: `PS Teams.js` — team registry + membership rule (TDD)

**Files:**
- Create: `PS Teams.js`
- Test: `_test_teamForProfile_()` inside `PS Teams.js` (Node-runnable, same pattern as `_test_weightsResolver()` in `PS Contribution Report.js`)

- [ ] **Step 1: Create `PS Teams.js` containing ONLY the test function**

```js
// ============================================================
// PS TEAMS — org team registry for the Services / R&D / Sales & Success toggle.
// Single source of truth for team keys, labels, membership rule and metric sets
// (mirrors the VIEWS pattern in PS Dashboard.html).
// Spec: ps-dashboard/docs/specs/2026-07-08-org-team-toggle-design.md
// ============================================================

// ── TESTS ────────────────────────────────────────────────────
// Run in the GAS editor, or in Node:
//   node -e "global.Logger={log:console.log}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')); eval(fs.readFileSync('PS Teams.js','utf8')); process.exit(_test_teamForProfile_() ? 0 : 1)"
function _test_teamForProfile_() {
  const cat = new Map([
    [normPS_("Account Executive"),      { family: "JF004", track: "I", level: 3, levelKey: "I3" }],
    [normPS_("Implementation Manager"), { family: "JF008", track: "M", level: 5, levelKey: "M5" }],
    [normPS_("Software Engineer"),      { family: "JF002", track: "I", level: 4, levelKey: "I4" }],
  ]);
  const cases = [
    // [dept, jobTitle, expected]
    ["Services",    "Implementation Manager", "services"],
    ["Services",    "Account Executive",      "services"], // JF004 inside Services stays Services
    ["Sales",       "Account Executive",      "sales"],
    ["Engineering", "Software Engineer",      "rnd"],
    ["Engineering", "Totally Unknown Title",  "rnd"],      // uncatalogued, non-Services
    ["",            "Account Executive",      "sales"],    // empty dept → catalog decides
    ["",            "Mystery Role",           "rnd"],
  ];
  let fail = 0;
  cases.forEach((c, i) => {
    const got = teamForProfile_({ dept: c[0], jobTitle: c[1] }, cat);
    if (got !== c[2]) { fail++; Logger.log(`❌ case ${i}: (${c[0]} | ${c[1]}) → ${got}, want ${c[2]}`); }
  });
  if (teamByKey_("bogus").key !== "services") { fail++; Logger.log(`❌ teamByKey_("bogus") should fall back to services`); }
  if (teamByKey_(null).key   !== "services") { fail++; Logger.log(`❌ teamByKey_(null) should fall back to services`); }
  const m = new Map([["a", { team: "rnd" }], ["b", { team: "services" }], ["c", { team: "rnd" }]]);
  if (teamRoster_(m, "rnd").size !== 2) { fail++; Logger.log(`❌ teamRoster_ should keep 2 rnd members`); }
  const av = availableTeams_(m);
  if (av.length !== 2 || av[0].key !== "services" || av[1].key !== "rnd") {
    fail++; Logger.log(`❌ availableTeams_ should return [services, rnd] in registry order, got ${JSON.stringify(av)}`);
  }
  Logger.log(fail === 0 ? `✅ _test_teamForProfile_: all checks passed` : `❌ _test_teamForProfile_: ${fail} failure(s)`);
  return fail === 0;
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run (PowerShell, in `D:\Contribution`):
```
node -e "global.Logger={log:console.log}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')); eval(fs.readFileSync('PS Teams.js','utf8')); process.exit(_test_teamForProfile_() ? 0 : 1)"
```
Expected: FAIL — `ReferenceError: teamForProfile_ is not defined` (exit code 1).

- [ ] **Step 3: Add the implementation above the test function in `PS Teams.js`**

```js
// Metric keys match the weight metric keys used across the report
// (goals / tracked / planned / rcr / kudos / si / pto).
const TEAMS_ = [
  { key: "services", label: "Services",
    metrics: ["rcr", "si", "goals", "tracked", "planned", "kudos", "pto"] },
  { key: "rnd",      label: "R&D",
    metrics: ["si", "goals", "kudos", "pto"] },
  { key: "sales",    label: "Sales & Success",
    metrics: ["si", "goals", "kudos", "pto"] },   // HubSpot metrics appended in a later phase
];

// Registry lookup; unknown / missing key falls back to the first entry (services),
// so legacy callers like the pre-toggle warmer keep working unmodified.
function teamByKey_(key) {
  const k = String(key || "").toLowerCase();
  for (const t of TEAMS_) if (t.key === k) return t;
  return TEAMS_[0];
}

// Hybrid membership rule (order matters):
//   1. Department = Services      → services (today's population, byte-identical)
//   2. Job Catalog family = JF004 → sales
//   3. everyone else              → rnd
// `catalog` is the readJobCatalog_() Map (normPS_(title) → { family, … }).
function teamForProfile_(profile, catalog) {
  if ((profile.dept || "").trim() === CONFIG_PS.PS_DEPT) return "services";
  const hit = catalog ? catalog.get(normPS_(profile.jobTitle || "")) : null;
  if (hit && hit.family === COE_FAMILY_CODE_) return "sales";
  return "rnd";
}

// Filters a roster Map to profiles tagged with `teamKey` (tagging happens in
// getPSReportData right after the roster read).
function teamRoster_(roster, teamKey) {
  return new Map([...roster].filter(([, p]) => p.team === teamKey));
}

function teamHasMetric_(team, key) {
  return team.metrics.indexOf(key) !== -1;
}

// Teams (in registry order) with at least one member in `roster`.
// Drives meta.availableTeams → the frontend toggle.
function availableTeams_(roster) {
  const counts = {};
  roster.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
  return TEAMS_.filter(t => counts[t.key] > 0).map(t => ({ key: t.key, label: t.label }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Same command as Step 2. Expected: `✅ _test_teamForProfile_: all checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add "PS Teams.js"
git commit -m "feat(teams): PS Teams.js registry — team keys, metric sets, hybrid membership rule"
```

---

### Task 2: Widen `readPSRoster_` to the whole company

**Files:**
- Modify: `PS Contribution Report.js:1279-1284` (dept filter) and `:1301` (roster.set) and `:1316` (log line)

- [ ] **Step 1: Remove the Department filter**

Replace (at `PS Contribution Report.js:1279-1284`):
```js
    if (!name || cls !== CONFIG_PS.PS_CLASS) return;
    // Department must be 'Services' when the column is present and non-empty
    if (iDept !== -1) {
      const dept = String(row[iDept] || "").trim();
      if (dept && dept !== CONFIG_PS.PS_DEPT) return;
    }
```
with:
```js
    if (!name || cls !== CONFIG_PS.PS_CLASS) return;
    // Company-wide roster: no Department filter here. Team membership (Services /
    // R&D / Sales & Success) is tagged in getPSReportData via teamForProfile_.
```

- [ ] **Step 2: Warn on duplicate normalized names (spec open item — name joins now span the whole company)**

Replace (at `PS Contribution Report.js:1301`):
```js
    roster.set(normPS_(name), {
```
with:
```js
    const norm = normPS_(name);
    if (roster.has(norm)) Logger.log(`⚠️ Roster: duplicate normalized name "${name}" — later row overwrites the earlier one (name-joined metrics may mix people).`);
    roster.set(norm, {
```

- [ ] **Step 3: Update the summary log line and log the distinct departments (spec open item — diagnostics only)**

Replace (at `PS Contribution Report.js:1316`):
```js
  log_(`Roster: ${roster.size} PS employees loaded.`);
```
with:
```js
  log_(`Roster: ${roster.size} employees loaded (company-wide).`);
  log_(`Roster distinct Department values: ${[...new Set([...roster.values()].map(p => p.dept).filter(Boolean))].join(" | ")}`);
```

- [ ] **Step 4: Syntax check**

Run: `node --check "PS Contribution Report.js"`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(teams): readPSRoster_ reads company-wide; duplicate-name warning"
```

---

### Task 3: Parameterize the PTO reader's department filter

**Files:**
- Modify: `PS Contribution Report.js:1623-1626` (comment + signature), `:1671` (filter)

The caller-side change (passing the team's dept set) lands in Task 4 with the other `computePSReport_` edits; until then the new parameter is optional and absent → no filtering change in behavior for a Services-only call is needed because Task 4 lands before any deploy.

- [ ] **Step 1: Change signature and header comment**

Replace (at `PS Contribution Report.js:1623-1626`):
```js
// Reads the Accumulation Cost sheet and builds a per-employee profile keyed by Employee Number:
//   { balanceHistory: [{ date, balance }],  plannedUsageDates: [Date, …] }
// Filters to Department: Name = CONFIG_PS.PS_DEPT ("Services").
function readPTOAccumulationProfiles_() {
```
with:
```js
// Reads the Accumulation Cost sheet and builds a per-employee profile keyed by Employee Number:
//   { balanceHistory: [{ date, balance }],  plannedUsageDates: [Date, …] }
// `deptSet` (Set<string>) filters rows to the requested team's departments;
// a missing/empty set keeps every department.
function readPTOAccumulationProfiles_(deptSet) {
```

- [ ] **Step 2: Change the row filter**

Replace (at `PS Contribution Report.js:1671`):
```js
      if (dept !== CONFIG_PS.PS_DEPT) { droppedDept++; continue; }
```
with:
```js
      if (deptSet && deptSet.size > 0 && !deptSet.has(dept)) { droppedDept++; continue; }
```

- [ ] **Step 3: Syntax check**

Run: `node --check "PS Contribution Report.js"`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(teams): PTO Accumulation reader filters by caller-supplied department set"
```

---

### Task 4: `computePSReport_` — metric-set gating, team meta, catalog param

**Files:**
- Modify: `PS Contribution Report.js` — `computePSReport_` (`:3075-3347`), plus two small helper functions added just above it

- [ ] **Step 1: Add empty-result stubs above `computePSReport_` (immediately before line 3075)**

These mirror exactly the fields consumers touch: `buildTeamSummary_` reads `rcr.lastMonth/.teamRCR/.tier`, `buildEmployeeRows_` reads `rcr.byEmployee[norm]`, meta reads `rcrHistory`/`rcrByEmployee`; tracked/planned week lookups are all `(obj[label] || {})`-guarded, and `trackedAll._lastExport` is read in meta.

```js
// Empty stand-ins for readers a team's metric set skips (R&D / Sales have no
// RCR, Tracked or Planned data). Shapes mirror the fields consumers touch.
function emptyRcrResult_() {
  return { lastMonth: null, teamRCR: null, tier: "No Data",
           byEmployee: {}, rcrHistory: [], rcrByEmployee: {} };
}
function emptyTrackedResult_() { return { _lastExport: null }; }
```

- [ ] **Step 2: Change `computePSReport_`'s signature and header comment**

Replace (at `PS Contribution Report.js:3075-3077`):
```js
// All data reads, FTE filtering, and result assembly for getPSReportData.
// Called after access control and scope resolution; the caller handles caching.
function computePSReport_(access, roster, managerScopeName, weeks, weights) {
```
with:
```js
// All data reads, FTE filtering, and result assembly for getPSReportData.
// Called after access control, scope resolution and team filtering; the caller
// handles caching. `team` = TEAMS_ entry served; `jobCatalog` = readJobCatalog_()
// (read once by the caller for team tagging); `availableTeams` = teams present
// in the caller's scope (drives the frontend toggle).
function computePSReport_(access, roster, managerScopeName, weeks, weights, team, jobCatalog, availableTeams) {
  const hasM = k => teamHasMetric_(team, k);
```

- [ ] **Step 3: Gate the RCR read**

Replace (at `PS Contribution Report.js:3095`):
```js
  const rcrAll = readRCR_PS_(active, fteActive);
```
with:
```js
  const rcrAll = hasM("rcr") ? readRCR_PS_(active, fteActive) : emptyRcrResult_();
```
(SI stays unconditional — every team has SI.) Then, on the line after the `const siAll = …` read (at `PS Contribution Report.js:3096`), add the per-team coverage log (spec open item):
```js
  Logger.log(`SI coverage [${team.key}]: ${Object.keys(siAll.byEmployee || {}).length} of ${active.size} active employees have an SI value`);
```

- [ ] **Step 4: Pass the team's departments to the PTO reader**

Replace (at `PS Contribution Report.js:3098`):
```js
  const ptoProfiles = readPTOAccumulationProfiles_();   // shared (loaded once)
```
with:
```js
  const teamDepts   = new Set([...roster.values()].map(p => p.dept).filter(Boolean));
  const ptoProfiles = readPTOAccumulationProfiles_(teamDepts);   // shared (loaded once)
```

- [ ] **Step 5: Gate the Tracked / Planned reads**

Replace (at `PS Contribution Report.js:3151-3152`):
```js
  const trackedAll = readTrackedTimeByWeek_(roster, extWeeks);
  const plannedAll = readPlannedTimeByWeek_(roster, extWeeks);
```
with:
```js
  const trackedAll = hasM("tracked") ? readTrackedTimeByWeek_(roster, extWeeks) : emptyTrackedResult_();
  const plannedAll = hasM("planned") ? readPlannedTimeByWeek_(roster, extWeeks) : {};
```
All downstream consumers (`subtractPTOFromPlanned_`, `filterTimeBySubset_`, `buildTeamSummary_`, `buildEmployeeRows_`, `trackedHistory`) use `(obj[label] || {})` lookups, so empty objects flow through as zeros/dashes.

- [ ] **Step 6: Use the passed-in catalog instead of re-reading it**

Replace (at `PS Contribution Report.js:3228`):
```js
  const jobCatalog    = readJobCatalog_();
  const scoringMatrix = readScoringMatrix_();
```
with:
```js
  const scoringMatrix = readScoringMatrix_();
```
(`jobCatalog` is now the function parameter; nothing else changes — `weightsForEmployee_` and `buildTopPerformers_` keep using the same variable name.)

- [ ] **Step 7: Add team fields to meta**

In the `return { … meta: { … } }` block, insert immediately after `generatedAt:      new Date().toISOString(),` (at `PS Contribution Report.js:3320`):
```js
      team:           { key: team.key, label: team.label, metrics: team.metrics },
      availableTeams: availableTeams || [],
```

- [ ] **Step 8: Syntax check**

Run: `node --check "PS Contribution Report.js"`
Expected: exit code 0.

- [ ] **Step 9: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(teams): computePSReport_ gates RCR/Tracked/Planned by team metric set, ships meta.team"
```

---

### Task 5: `getPSReportData(bustCache, teamKey)` — tagging, team scope, cache keys

**Files:**
- Modify: `PS Contribution Report.js:3003-3073` (`getPSReportData`)

- [ ] **Step 1: Replace the whole function body**

Replace `getPSReportData` (currently `PS Contribution Report.js:3003-3073`) with:

```js
function getPSReportData(bustCache, teamKey) {
  try {
    const access = checkDashboardAccess();

    if (!access.allowed) {
      return { ok: false, denied: true, email: access.email };
    }

    const team = teamByKey_(teamKey);   // unknown/missing → services (legacy callers unchanged)

    // ── CacheService — gzip-chunked cache per (team × user scope), see cachePutLarge_.
    // TTL = CONFIG_PS.CACHE_TTL_SEC; warmReportCache rewrites the admin entries
    // every CACHE_WARM_EVERY_MIN minutes so they never go cold.
    // Note: an out-of-scope team request caches its fallback payload under the
    // REQUESTED team's key — harmless, the payload self-identifies via meta.team.
    const _sCache   = CacheService.getScriptCache();
    const _cacheVer = reportCacheVer_();
    const _cacheKey = (access.role === "admin" || access.role === "viewer")
      ? "ps_v" + _cacheVer + "_" + team.key + "_admin"
      : "ps_v" + _cacheVer + "_" + team.key + "_" + access.email;

    // Skip cache if bustCache=true (refresh button clicked, or the warmer trigger)
    if (!bustCache) {
      const _hit = cacheGetLarge_(_sCache, _cacheKey);
      if (_hit) {
        try { return JSON.parse(_hit); } catch(ce) { /* corrupt entry — fall through to live read */ }
      }
    }

    const weights = readWeightSettings_();
    const weeks   = buildWeekWindow_PS_();
    const fullRoster = readPSRoster_();

    // Team tagging needs the Job Catalog (JF004 detection). Read once here and
    // pass through to computePSReport_ (which previously read it itself).
    const jobCatalog = readJobCatalog_();
    fullRoster.forEach(p => { p.team = teamForProfile_(p, jobCatalog); });

    // ── Manager scope resolution ──────────────────────────────────────────────
    // Determines whether this user should see a subset of the roster.
    // Admin and Viewer see everything; Manager sees their org tree only.
    // Scope resolves on the FULL roster first; the team filter applies after,
    // so a manager can never widen visibility by requesting another team.
    let managerNorm      = null;
    let managerScopeName = null;
    let roster           = fullRoster;

    if (access.role !== "admin" && access.role !== "viewer") {
      // All manager-role users arrive with delegateScopeName resolved by checkDashboardAccess().
      // Explicit delegates (Settings tab) and auto-detected roster supervisors both use this path.
      if (access.delegateScopeName) {
        managerNorm      = normPS_(access.delegateScopeName);
        managerScopeName = access.delegateScopeName;
        Logger.log(`Manager scope: ${access.email} → "${managerScopeName}" (norm: ${managerNorm})`);
      }

      if (managerNorm) {
        // Guard: confirm the scope anchor exists in the active roster or has direct reports.
        // Catches typo'd delegateScopeNames before they silently produce an empty dashboard.
        const scopeIsValid = fullRoster.has(managerNorm) ||
          [...fullRoster.values()].some(p => normPS_(p.supervisor) === managerNorm);
        if (!scopeIsValid) {
          Logger.log(`⚠️ Access denied — scope "${managerScopeName}" not found in active roster: ${access.email}`);
          return { ok: false, denied: true, email: access.email };
        }
        const scope = resolveManagerScope_(fullRoster, managerNorm);
        roster = new Map([...fullRoster].filter(([n]) => scope.has(n)));
        Logger.log(`Manager scope resolved: ${scope.size} employees in org tree of "${managerScopeName}"`);
      } else {
        Logger.log(`Access denied (no roster scope): ${access.email}`);
        return { ok: false, denied: true, email: access.email };
      }
    }

    // ── Team filter (after scope) ─────────────────────────────────────────────
    // Serve the requested team, or fall back to the caller's first non-empty team
    // (registry order) when the request is empty in their scope — server-side
    // gating, the frontend snaps its toggle to meta.team.
    const teamsInScope = availableTeams_(roster);
    let servedTeam = team;
    let teamScoped = teamRoster_(roster, team.key);
    if (teamScoped.size === 0) {
      const fallback = teamsInScope.length ? teamByKey_(teamsInScope[0].key) : teamByKey_("services");
      Logger.log(`Team "${team.key}" empty in scope for ${access.email} — serving "${fallback.key}"`);
      servedTeam = fallback;
      teamScoped = teamRoster_(roster, servedTeam.key);
    }
    Logger.log(`Team "${servedTeam.key}": ${teamScoped.size} of ${roster.size} in-scope employees`);

    const result = computePSReport_(access, teamScoped, managerScopeName, weeks, weights, servedTeam, jobCatalog, teamsInScope);
    cachePutLarge_(_sCache, _cacheKey, JSON.stringify(result), CONFIG_PS.CACHE_TTL_SEC);
    return result;
  } catch(e) {
    Logger.log(`❌ getPSReportData: ${e.message}\n${e.stack}`);
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 2: Syntax check + rerun the Task 1 test (regression)**

Run: `node --check "PS Contribution Report.js"` — expected exit 0.
Run the Task 1 Node test command — expected `✅ … all checks passed`.

- [ ] **Step 3: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(teams): getPSReportData serves per-team payloads with team-segmented cache keys"
```

---

### Task 6: Warm all three admin-scope cache entries

**Files:**
- Modify: `PS Contribution Report.js:205-211` (`warmReportCache`)

- [ ] **Step 1: Replace `warmReportCache`**

Replace (at `PS Contribution Report.js:205-211`):
```js
function warmReportCache() {
  const t0 = Date.now();
  const res = getPSReportData(true);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res && res.ok) Logger.log(`✅ warmReportCache: rebuilt in ${secs}s`);
  else Logger.log(`❌ warmReportCache after ${secs}s: ${(res && res.error) || "denied/unknown"}`);
}
```
with:
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
(`setupCacheWarmer()` is unchanged — same trigger, same interval.)

- [ ] **Step 2: Syntax check**

Run: `node --check "PS Contribution Report.js"` — expected exit 0.

- [ ] **Step 3: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(teams): cache warmer rebuilds all three team admin entries with a time budget"
```

---

### Task 7: Frontend — toggle UI, per-team client cache, fetch wiring

**Files:**
- Modify: `PS Dashboard.html` — header markup (`:1263-1268`), CSS block (add near existing `.week-badge` rules), `STATE` (`:1959-1974`), new functions near `switchTab` (`:2562`), `loadData` (`:2426-2443`), `onDataLoaded` (`:2445-2505`)

- [ ] **Step 1: Add the toggle element to the header**

Insert after the closing `</div>` of `header-title` (after `PS Dashboard.html:1266`), before the `weekBadge` span:
```html
  <div class="team-toggle" id="teamToggle" style="display:none" role="tablist" aria-label="Org team"></div>
```

- [ ] **Step 2: Add CSS**

Add to the `<style>` block (next to the `.week-badge` rule — Grep `.week-badge {` to locate):
```css
.team-toggle { display:flex; gap:2px; background:var(--surface); border:1px solid var(--border); border-radius:99px; padding:2px; }
.team-toggle button { border:none; background:transparent; color:var(--slate); font-size:11px; font-weight:700; padding:4px 12px; border-radius:99px; cursor:pointer; white-space:nowrap; }
.team-toggle button.active { background:var(--void); color:#fff; }
```

- [ ] **Step 3: Add state fields**

In `STATE` (at `PS Dashboard.html:1973`, after `selectedPeriod`), add:
```js
  activeTeam:        "services", // org team currently displayed (TEAMS registry key)
  teamData:          {},         // teamKey → payload — client-side cache per team
```

- [ ] **Step 4: Add the team helpers (insert directly above `function switchTab` at `PS Dashboard.html:2562`)**

```js
// ── ORG TEAM TOGGLE ───────────────────────────────────────
// True when the active team's metric set includes `k`. Legacy payloads without
// meta.team show everything (pre-toggle behavior).
function hasMetric_(k) {
  var m = DATA && DATA.meta && DATA.meta.team && DATA.meta.team.metrics;
  return !m || m.indexOf(k) !== -1;
}

// Show/hide every element carrying data-metric="a" or data-metric="a,b"
// (visible when ANY listed metric is active). Static markup gating — Trends
// cards, Data Reference rows.
function applyMetricVisibility_() {
  var els = document.querySelectorAll("[data-metric]");
  for (var i = 0; i < els.length; i++) {
    var keys = els[i].getAttribute("data-metric").split(",");
    var show = false;
    for (var j = 0; j < keys.length; j++) if (hasMetric_(keys[j].trim())) { show = true; break; }
    els[i].style.display = show ? "" : "none";
  }
}

function renderTeamToggle_() {
  var el = document.getElementById("teamToggle");
  if (!el) return;
  var teams = (DATA && DATA.meta && DATA.meta.availableTeams) || [];
  if (teams.length < 2) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.innerHTML = teams.map(function(t) {
    var active = t.key === STATE.activeTeam;
    return '<button role="tab" aria-selected="' + active + '" class="' + (active ? "active" : "") + '"' +
           ' onclick="switchTeam(\'' + esc(t.key) + '\')">' + esc(t.label) + '</button>';
  }).join("");
  el.style.display = "flex";
}

function switchTeam(key) {
  if (key === STATE.activeTeam) return;
  STATE.activeTeam = key;
  // New population — population-specific filters no longer apply
  STATE.jobTitleFilter.clear(); STATE.jfFilter.clear(); STATE.lvFilter.clear();
  var cached = STATE.teamData[key];
  if (cached) onDataLoaded(cached);   // instant re-render from client cache
  else loadData(false);               // cold team — fetch (shows loading screen)
}
```

- [ ] **Step 5: Pass the team to the server and let team switches through the in-flight guard**

Replace (at `PS Dashboard.html:2426-2442`):
```js
function loadData(forceRefresh) {
  // Prevent concurrent requests: a second click while the first is in-flight is a no-op.
  // This avoids the race where the slower (older) response overwrites fresh data.
  if (_loadingInFlight && !forceRefresh) return;
  _loadingInFlight = true;
  var seq = ++_loadSeq;
```
with:
```js
var _loadingTeam = null;
function loadData(forceRefresh) {
  // Prevent concurrent requests: a second click while the first is in-flight is a
  // no-op — UNLESS the requested team changed (team toggle during a load must win;
  // the seq guard discards the stale response).
  if (_loadingInFlight && !forceRefresh && _loadingTeam === STATE.activeTeam) return;
  _loadingInFlight = true;
  _loadingTeam = STATE.activeTeam;
  var seq = ++_loadSeq;
```
and replace (at `PS Dashboard.html:2442`):
```js
    .getPSReportData(forceRefresh);
```
with:
```js
    .getPSReportData(forceRefresh, STATE.activeTeam);
```

- [ ] **Step 6: Store / snap the team in `onDataLoaded`**

Insert immediately after `DATA = payload;` (at `PS Dashboard.html:2450`):
```js
  // Payload is truth: the server may have served a fallback team (out-of-scope
  // request). Snap state + toggle to what actually arrived, cache it per team.
  var servedTeam = (payload.meta && payload.meta.team && payload.meta.team.key) || "services";
  STATE.activeTeam = servedTeam;
  STATE.teamData[servedTeam] = payload;
  renderTeamToggle_();
  var h1El = document.querySelector(".header-title h1");
  if (h1El) {
    var teamLabel = servedTeam === "services"
      ? "Professional Services"
      : ((payload.meta && payload.meta.team && payload.meta.team.label) || "Team");
    h1El.textContent = teamLabel + " — Weekly Contribution Report";
  }
```
Then insert `applyMetricVisibility_();` on its own line immediately after the existing `applyRoleToNav_();` call (at `PS Dashboard.html:2498`).

- [ ] **Step 7: Manual smoke check (no deploy)**

Open `PS Dashboard.html` in an editor and confirm: no duplicated `var _loadingTeam` declarations, `switchTeam` is defined before any markup references it (it's called via `onclick`, so order is fine), and the file has balanced braces by loading it in a browser tab — the page will error on `google` being undefined, which is expected outside GAS; there must be no *SyntaxError* in the console.

- [ ] **Step 8: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): header team toggle, per-team client payload cache, team-aware loadData"
```

---

### Task 8: Frontend — metric gating in every renderer

**Files:**
- Modify: `PS Dashboard.html` — `getActiveAxes` (`:6154`), `renderKPIs` (`:4131`), `renderAll` (`:2592`), `renderTopRocketeers` (`:3876`), `renderTrendsTab` (`:8637`), Trends + Data Reference pane markup

- [ ] **Step 1: Radar — filter axes by team**

Radar axis ids are exactly the metric keys (`goals/tracked/planned/kudos/pto/rcr/si` — see `RADAR_AXIS_DEFS` at `PS Dashboard.html:1929-1937`). In `getActiveAxes`, replace (at `:6157`):
```js
  var baseIds = axisIdsForCrew((RADAR_AXIS_BY_GROUP[groupBy] || RADAR_AXIS_BY_GROUP.all).slice(), isCrewMode);
```
with:
```js
  var baseIds = axisIdsForCrew((RADAR_AXIS_BY_GROUP[groupBy] || RADAR_AXIS_BY_GROUP.all).slice(), isCrewMode)
    .filter(function(id) { return hasMetric_(id); });
```
Also apply the same `.filter(function(id) { return hasMetric_(id); })` to the individual-radar axis list at `PS Dashboard.html:5450`:
```js
  var indivAxes = axisIdsForCrew(RADAR_AXIS_BY_GROUP.individual || [], isCrewEmp(emp))
    .filter(function(id) { return hasMetric_(id); });
```
(The existing "keep at least 3 axes" refill loop only refills from variance-hidden axes, not team-hidden ones — team-absent axes never enter `baseIds`, so they can never come back. R&D renders a 4-axis polygon.)

- [ ] **Step 2: Overview KPI cards — tag and filter**

In `renderKPIs` (at `PS Dashboard.html:4196` onward), add a `metric:` property to every literal in the `var cards = [...]` array, matching each card's label:
- "Goal compliance" → `metric: "goals",`
- "Time planned" → `metric: "planned",`
- "Time tracked" → `metric: "tracked",`
- the PTO card → `metric: "pto",`
- the Kudos card → `metric: "kudos",`
- any RCR card → `metric: "rcr",` / any SI card → `metric: "si",`

(Read the full `cards` array to enumerate them — it continues past line 4230. Every card gets a key; a card with no obvious metric (e.g. headcount) gets no `metric` property and always shows.)

Then, immediately after the `];` closing the `cards` array, add:
```js
  cards = cards.filter(function(c) { return !c.metric || hasMetric_(c.metric); });
```

- [ ] **Step 3: Overview team summary table — filter rows by id**

Server rows carry `id: "goals" | "planned" | "tracked" | "kudos" | "rcr" | "si"` (see `buildTeamSummary_` at `PS Contribution Report.js:2549-2614`); confirm the PTO row's id with:
```
grep -n "buildPTOHealthSummaryRow_" "PS Contribution Report.js"
```
then open that function and note its `id:` value (expected `"pto"`). In `renderAll` (at `PS Dashboard.html:2601`), replace:
```js
    overview:   function() { renderKPIs(meta, filtered, filtering); renderTeamTable(summary); renderEmployeeTable(); },
```
with:
```js
    overview:   function() {
      renderKPIs(meta, filtered, filtering);
      renderTeamTable(summary.filter(function(r) { return !r.id || hasMetric_(r.id); }));
      renderEmployeeTable();
    },
```
If `buildFilteredSummary` (client) builds rows without `id`, add the same `id` values there so the filter applies to filtered views too — mirror the server's ids exactly.

- [ ] **Step 4: Leading Behaviours (Top Rocketeers) — gate the per-metric rows**

In `renderTopRocketeers` (rows built from `PS Dashboard.html:3939` onward), each `rows.push({ label: "Tracked" … })` / `"Planned"` / `"RCR"` call gets wrapped in the matching gate, exactly like the existing crew gate on Goals:
```js
    if (hasMetric_('tracked')) rows.push(
      { label:"Tracked", norm: sL.trackedNorm, val: sL.trackedHrs !== null ? Math.round(sL.trackedHrs) + "h" : "—",
        /* …existing properties unchanged… */ });
```
Apply the same one-line `if (hasMetric_('planned'))` / `if (hasMetric_('rcr'))` prefix to the Planned and RCR pushes (read the rows block to completion — Goals/Kudos/SI/PTO rows stay ungated apart from the existing crew logic). Scores themselves need no change: R&D/Sales employees ship `emp.scoreWeights` with tracked/planned/rcr at 0, so `computeRkScore` already zero-weights the absent metrics.

- [ ] **Step 5: Trends — gate sub-renderers**

Replace the body opening of `renderTrendsTab` (at `PS Dashboard.html:8637-8646`):
```js
function renderTrendsTab() {
  if (!DATA) return;
  var _tf = getFilteredEmployees();
  renderGoalsStanding(_tf);
  renderTimeMomentum(_tf);
  renderCorrelationCharts(_tf);
  renderPTOTrend(_tf);
  renderProjectDemandLink();
  renderProjectHeatmap(_tf);
  renderRcrSupport(_tf);
```
with:
```js
function renderTrendsTab() {
  if (!DATA) return;
  var _tf = getFilteredEmployees();
  renderGoalsStanding(_tf);
  if (hasMetric_('tracked') || hasMetric_('planned')) renderTimeMomentum(_tf);
  if (hasMetric_('tracked')) renderCorrelationCharts(_tf);
  renderPTOTrend(_tf);
  if (hasMetric_('planned')) { renderProjectDemandLink(); renderProjectHeatmap(_tf); }
  if (hasMetric_('rcr')) renderRcrSupport(_tf);
```
Then guard the RCR monthly chart block that follows: immediately after the gated calls, wrap the existing RCR chart code (starting at `var rcrCard = document.getElementById("trendsRcrCard");`) with:
```js
  var rcrCard = document.getElementById("trendsRcrCard");
  if (!hasMetric_('rcr')) { if (rcrCard) rcrCard.style.display = "none"; }
  else {
    /* existing RCR chart code, unchanged, through the end of that block */
  }
```
(Delete the duplicate `var rcrCard = …` line inside the moved block.)

- [ ] **Step 6: Static markup — `data-metric` attributes**

Skipped renderers leave the *previous* team's cards in the DOM, so their containers must hide via `applyMetricVisibility_()` (Task 7). Locate each container and add the attribute:

1. `#trendsRcrCard` (Grep `trendsRcrCard` in the HTML markup section) → add `data-metric="rcr"`.
2. The Time Momentum card container: open `renderTimeMomentum` (Grep `function renderTimeMomentum`), note the element id it writes into, and add `data-metric="tracked,planned"` to that card's outermost `<div class="card"…>` in the pane markup.
3. The Correlation card container: same procedure via `renderCorrelationCharts` → `data-metric="tracked"`.
4. The Project Heatmap and Project Demand link containers: same procedure via `renderProjectHeatmap` / `renderProjectDemandLink` → `data-metric="planned"`.
5. In the 📊 Data Reference pane (`tabDataRef`), add `data-metric="rcr"`, `data-metric="tracked"`, `data-metric="planned"` to the sections describing those metrics (Grep `tabDataRef` and scan its section headings).

- [ ] **Step 7: Browser syntax smoke check**

Open the file in a browser tab: expected console error about `google` being undefined only — no SyntaxError.

- [ ] **Step 8: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): metric-set gating — radar axes, KPI cards, summary rows, rocketeer rows, trends"
```

---

### Task 9: Deploy + live QA

**Files:** none (GAS editor + live dashboard)

- [ ] **Step 1: Push the three files to the GAS project**

Copy the contents of `PS Contribution Report.js`, `PS Teams.js` (new script file in the GAS editor: File → New → Script, name it `PS Teams`), and `PS Dashboard.html` into the bound GAS project, then Deploy → Manage deployments → Edit → New version.

- [ ] **Step 2: Run the unit test in the GAS editor**

Run `_test_teamForProfile_` from the editor. Expected log: `✅ _test_teamForProfile_: all checks passed`.

- [ ] **Step 3: Bump the cache version**

In the GAS editor run `bustReportCache_` once (key shape changed from `ps_v<ver>_admin` to `ps_v<ver>_<team>_admin`; the bump strands all old entries immediately).

- [ ] **Step 4: Warm the caches**

Run `warmReportCache` manually once and check the execution log for `✅ warmReportCache[services]`, `[rnd]`, `[sales]` lines (or a `⚠️ time budget` skip, which the next trigger run will cover).

- [ ] **Step 5: Manual QA checklist**

1. **Admin**: toggle shows Services / R&D / Sales & Success; each headcount is sane; the Services view is identical to pre-change (KPIs, radar, rocketeers, trends).
2. **R&D view**: radar shows exactly 4 axes (Goals, Kudos, PTO, SI); Overview has no Tracked/Planned/RCR cards or summary rows; Trends shows Goals Standing + PTO Trend only; Top Rocketeers rows show no Tracked/Planned/RCR lines and scores use Goals 40 / Kudos 20 / SI 20 / PTO 20.
3. **Manager (Services supervisor)**: no toggle rendered (single team in scope); dashboard identical to before.
4. **R&D supervisor**: loads the dashboard → manager role, sees only their org tree, R&D layout.
5. **Viewer**: full toggle, read-only, all three teams.
6. **Refresh button**: on R&D busts only R&D (check execution log cache keys `ps_v<ver>_rnd_admin`).
7. **Toggle churn**: switch teams rapidly during a load — the finally-rendered team matches the last click (seq guard).
8. **Execution log**: per-team cache keys visible; `⚠️ Roster: duplicate normalized name` warnings reviewed if any appear (spec open item — duplicate names across the company).
9. **SI coverage**: log line for SI join coverage on R&D — blanks are acceptable, but note the count.

- [ ] **Step 6: Record completion**

Update the project memory file for this feature (per the user's memory conventions) with the deploy date, commit range, and any QA findings.
