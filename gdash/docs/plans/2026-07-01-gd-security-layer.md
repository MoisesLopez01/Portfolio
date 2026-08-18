# GD Security Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Goals Compliance Dashboard (`goalCompliance.js` / `GDash.html`) the access control it has never had — admin / viewer / manager (auto-scoped to their own org tree) / denied — by porting the proven role model from `PS Security.js` into a new, fully independent `GD Security.js`, and wiring manager scoping into every data path in `goalCompliance.js`.

**Architecture:** Three files. A new `GD Security.js` owns role resolution (`checkDashboardAccess()`), the runtime access-list editor (`getAccessSettings()`/`saveAccessSettings()`), and the denied-page HTML — self-contained, no calls into `goalCompliance.js`. `goalCompliance.js` gains one pure helper (`resolveGDManagerScope_()`, a BFS over the roster's `Supervisor` field) and gates every public entry point (`doGet`, `getGoalsComplianceData`, `getHRNotes`, `saveHRNote`, `bustCache`) behind `checkDashboardAccess()`; when the caller is a manager, `buildComplianceData_()` narrows the roster to their org tree before any aggregation runs, so every existing tab is scoped for free. `GDash.html` gets a small ☰ menu (admin-only, one item: 🔒 Access Control) and a manager-scope badge, both driven by `userRole`/`managerScopeName` fields added to the existing payload.

**Tech Stack:** Google Apps Script (V8 runtime), vanilla ES5 JavaScript frontend, `PropertiesService`/`CacheService`/`SpreadsheetApp`.

---

## Spec

`gdash/docs/specs/2026-07-01-gd-security-layer-design.md`

## File Map

| File | Change |
|------|--------|
| `D:\Contribution\GD Security.js` | **New.** `SEC_GD_` constants, `_resolveRosterSupervisor_GD_()`, `checkDashboardAccess()`, `getAccessSettings()`, `saveAccessSettings()`, `buildAccessDeniedPage_GD_()` |
| `D:\Contribution\goalCompliance.js` | Add `resolveGDManagerScope_()` + test; gate `doGet`/`getGoalsComplianceData`/`getHRNotes`/`saveHRNote`/`bustCache`; scope `buildComplianceData_()`; bump `CACHE_VER` |
| `D:\Contribution\GDash.html` | New ☰ menu + Access Control pane + manager-scope badge; `sec-*`/`settings-*` CSS; `renderAccessTab_`/`populateSecuritySection_`/`saveSecuritySettings_` JS; `applyRoleToNav_()` wired into `onReady`/`onQuarterChange`; handle `data.denied` |

---

## Task 1 — `GD Security.js`: constants + roster-supervisor detection + `checkDashboardAccess()`

**Files:**
- Create: `D:\Contribution\GD Security.js`

- [ ] **Step 1: Create the file with constants and the private roster lookup**

```javascript
// ============================================================
// SCRIPT NAME: GD Security
// PURPOSE:     Email-based access control for the Goals Compliance
//              Dashboard (goalCompliance.js / GDash.html).
//
//              Independent of PS Security.js — separate GAS project,
//              own spreadsheet, own Script Properties keys. No code
//              is shared between the two projects.
//
// ── HOW ACCESS WORKS ─────────────────────────────────────────
//  1. BOOTSTRAP ADMIN (below) — always Admin, cannot be removed via UI.
//  2. DEFAULT ADMINS / VIEWERS / DELEGATES (below) — hardcoded, always
//     active regardless of Script Properties. Edit this file to add
//     permanent stakeholders.
//  3. RUNTIME ACCESS — managed via the 🔒 Access Control page (☰ menu,
//     admin only), stored in Script Properties, additive on top of
//     the defaults above.
//
//  ROLES:
//    Admin   — full dashboard + can manage the access list
//    Viewer  — read-only, full company data
//    Manager — scoped to their own roster org tree (auto-detected via
//              the Roster's Supervisor field, or granted explicitly
//              via a Delegate entry)
//
// ── OPEN ACCESS ──────────────────────────────────────────────
//  SEC_GD_.OPEN_ACCESS_DEFAULT = true by default. This preserves the
//  dashboard's original "anyone in the company can view" behavior —
//  turning this to false is what actually starts gating access.
//  Manager checks run BEFORE the Open Access fallback, so flipping
//  Open Access off never silently promotes a scoped manager into a
//  full-roster viewer.
// ============================================================

var SEC_GD_ = {
  PROP_ADMINS:      "GD_DASH_ADMINS",
  PROP_VIEWERS:     "GD_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "GD_DASH_OPEN_ACCESS",
  PROP_DELEGATES:   "GD_DASH_DELEGATES",

  // Always an Admin. Cannot be removed via the UI.
  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  // Always active — no UI step needed. Edit this file to grant
  // permanent access that survives a Script Properties reset.
  DEFAULT_ADMINS: [],
  DEFAULT_VIEWERS: [],

  // Manager-scoped access for people not in the Roster as supervisors.
  // Format: { email, scopeName } — scopeName is the full Roster name
  // of the supervisor whose org tree this person should see.
  DEFAULT_DELEGATES: [
    // { email: "peer@servicerocket.com", scopeName: "Juan Lopez" },
  ],

  // false = locked, true = anyone with the link sees the read-only dashboard.
  OPEN_ACCESS_DEFAULT: true,
};

// ── PRIVATE ──────────────────────────────────────────────────

/**
 * Reads the Roster sheet to check whether `email` belongs to an active
 * supervisor with at least one active direct report. Company-wide — no
 * Class/Department restriction (unlike PS Security's PS-only version),
 * since this dashboard covers every department.
 *
 * Self-contained: does not call into goalCompliance.js. Re-implements
 * the same status/termination-column auto-detection as getFullRosterMap_()
 * so this file has no cross-file dependency.
 *
 * @param {string} email - Lowercase, trimmed email.
 * @returns {string|null} The supervisor's canonical Name, or null.
 */
function _resolveRosterSupervisor_GD_(email) {
  try {
    var ssId = PropertiesService.getScriptProperties().getProperty("ROSTER_SS_ID")
            || (typeof CONFIG_GD !== "undefined" ? CONFIG_GD.ROSTER_SS_ID : null);
    if (!ssId) return null;

    var sheet = SpreadsheetApp.openById(ssId).getSheetByName("Roster");
    if (!sheet) return null;

    var vals = sheet.getDataRange().getValues();
    if (vals.length < 2) return null;

    var headers = vals[0].map(function(h) { return String(h).trim(); });
    var idx     = function(col) { return headers.indexOf(col); };

    var iName  = idx("Name");
    var iEmail = idx("Email");
    var iSup   = idx("Supervisor");
    if (iName === -1 || iEmail === -1) return null;

    var statusKey = null, termKey = null;
    headers.forEach(function(k) {
      var lower = k.toLowerCase().replace(/[\s._-]/g, "");
      if (!statusKey && /^(employeestatus|employmentstatus|empstatus|status|active)$/.test(lower)) statusKey = k;
      if (!termKey   && /termination|termdate|enddate|exitdate/.test(lower))                        termKey   = k;
    });
    var iStatus = statusKey ? idx(statusKey) : -1;
    var iTerm   = termKey   ? idx(termKey)   : -1;

    var INACTIVE_STATUSES = ["terminated", "terminated - mobility relocation", "job offer accepted"];
    var isActiveRow = function(row) {
      if (iStatus !== -1) {
        var s = String(row[iStatus] || "").toLowerCase().trim();
        if (INACTIVE_STATUSES.indexOf(s) !== -1) return false;
      }
      if (iTerm !== -1 && row[iTerm]) return false;
      return true;
    };

    var dataRows = vals.slice(1);
    var supRow = null;
    for (var i = 0; i < dataRows.length; i++) {
      if (String(dataRows[i][iEmail] || "").toLowerCase().trim() === email) { supRow = dataRows[i]; break; }
    }
    if (!supRow) return null;

    var supervisorName = String(supRow[iName] || "").trim();
    if (!supervisorName) return null;

    var hasReports = dataRows.some(function(row) {
      return String(row[iSup] || "").trim() === supervisorName && isActiveRow(row);
    });

    return hasReports ? supervisorName : null;
  } catch (e) {
    Logger.log("⚠️ [_resolveRosterSupervisor_GD_] " + e.message);
    return null;
  }
}

function _readAccessLists_GD_() {
  var p = PropertiesService.getScriptProperties();

  var runtimeAdmins  = (p.getProperty(SEC_GD_.PROP_ADMINS)  || "")
    .split(",").map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var runtimeViewers = (p.getProperty(SEC_GD_.PROP_VIEWERS) || "")
    .split(",").map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);

  var runtimeDelegates = (p.getProperty(SEC_GD_.PROP_DELEGATES) || "")
    .split("\n")
    .map(function(line) {
      var sep = line.indexOf(":");
      if (sep === -1) return null;
      var email     = line.slice(0, sep).trim().toLowerCase();
      var scopeName = line.slice(sep + 1).trim();
      return (email && scopeName) ? { email: email, scopeName: scopeName } : null;
    })
    .filter(Boolean);

  var adminSet = {};
  [SEC_GD_.BOOTSTRAP_ADMIN.toLowerCase()]
    .concat(SEC_GD_.DEFAULT_ADMINS.map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean))
    .concat(runtimeAdmins)
    .forEach(function(e) { adminSet[e] = true; });
  var admins = Object.keys(adminSet);

  var viewerSet = {};
  SEC_GD_.DEFAULT_VIEWERS.map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean)
    .concat(runtimeViewers)
    .forEach(function(e) { viewerSet[e] = true; });
  var viewers = Object.keys(viewerSet);

  var delegateMap = {};
  SEC_GD_.DEFAULT_DELEGATES.forEach(function(d) { if (d.email && d.scopeName) delegateMap[d.email.toLowerCase()] = d.scopeName; });
  runtimeDelegates.forEach(function(d) { delegateMap[d.email] = d.scopeName; });
  var delegates = Object.keys(delegateMap).map(function(email) { return { email: email, scopeName: delegateMap[email] }; });

  var stored = p.getProperty(SEC_GD_.PROP_OPEN_ACCESS);
  var openAccess = stored !== null ? stored === "true" : SEC_GD_.OPEN_ACCESS_DEFAULT;

  return { admins: admins, viewers: viewers, openAccess: openAccess, delegates: delegates };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Returns the access status for the current session user.
 * @returns {{ allowed: boolean, role: 'admin'|'viewer'|'manager'|'denied', email: string, delegateScopeName?: string }}
 */
function checkDashboardAccess() {
  var email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  var lists = _readAccessLists_GD_();

  if (lists.admins.indexOf(email)  !== -1) return { allowed: true, role: "admin",  email: email };
  if (lists.viewers.indexOf(email) !== -1) return { allowed: true, role: "viewer", email: email };

  var delegate = lists.delegates.filter(function(d) { return d.email === email; })[0];
  if (delegate) return { allowed: true, role: "manager", email: email, delegateScopeName: delegate.scopeName };

  var supervisorName = _resolveRosterSupervisor_GD_(email);
  if (supervisorName) {
    Logger.log("GD Security: manager access (auto-roster): " + email + " → \"" + supervisorName + "\"");
    return { allowed: true, role: "manager", email: email, delegateScopeName: supervisorName };
  }

  if (lists.openAccess) return { allowed: true, role: "viewer", email: email };

  return { allowed: false, role: "denied", email: email };
}
```

- [ ] **Step 2: Verify no syntax errors** — open the file in the Apps Script editor (or paste into [jshint.com](https://jshint.com) with ES6 options) and confirm no red underlines.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/GD Security.js"
git commit -m "feat(security): add GD Security.js with role resolution for the Goals Compliance Dashboard"
```

---

## Task 2 — `GD Security.js`: `getAccessSettings()` / `saveAccessSettings()`

**Files:**
- Modify: `D:\Contribution\GD Security.js` (append after `checkDashboardAccess()`)

- [ ] **Step 1: Append the settings read/write functions**

```javascript
/**
 * Returns the current access lists for the settings UI.
 * Admin-only — throws if the caller is not an admin.
 */
function getAccessSettings() {
  var access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  var lists = _readAccessLists_GD_();
  var editableAdmins = lists.admins.filter(function(e) { return e !== SEC_GD_.BOOTSTRAP_ADMIN.toLowerCase(); });

  return {
    admins:         editableAdmins,
    viewers:        lists.viewers,
    openAccess:     lists.openAccess,
    delegates:      lists.delegates,
    bootstrapAdmin: SEC_GD_.BOOTSTRAP_ADMIN,
    callerEmail:    access.email,
  };
}

/**
 * Saves updated access lists to Script Properties.
 * Admin-only — throws if the caller is not an admin.
 * @param {{ admins?: string[], viewers?: string[], openAccess?: boolean, delegates?: {email:string, scopeName:string}[] }} settings
 */
function saveAccessSettings(settings) {
  var access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  var p = PropertiesService.getScriptProperties();

  if (Array.isArray(settings.admins)) {
    var adminList = settings.admins
      .map(function(e) { return e.trim().toLowerCase(); })
      .filter(function(e) { return e.length > 0 && e !== SEC_GD_.BOOTSTRAP_ADMIN.toLowerCase(); });
    p.setProperty(SEC_GD_.PROP_ADMINS, adminList.join(","));
  }
  if (Array.isArray(settings.viewers)) {
    var viewerList = settings.viewers
      .map(function(e) { return e.trim().toLowerCase(); })
      .filter(function(e) { return e.length > 0; });
    p.setProperty(SEC_GD_.PROP_VIEWERS, viewerList.join(","));
  }
  if (Array.isArray(settings.delegates)) {
    var lines = settings.delegates
      .filter(function(d) { return d.email && d.scopeName; })
      .map(function(d) { return d.email.trim().toLowerCase() + ":" + d.scopeName.trim(); });
    p.setProperty(SEC_GD_.PROP_DELEGATES, lines.join("\n"));
  }
  if (typeof settings.openAccess === "boolean") {
    p.setProperty(SEC_GD_.PROP_OPEN_ACCESS, String(settings.openAccess));
  }

  Logger.log("GD Security: access settings updated by " + access.email);
  return { ok: true, savedAt: new Date().toISOString() };
}
```

- [ ] **Step 2: Verify no syntax errors** in the Apps Script editor.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/GD Security.js"
git commit -m "feat(security): add getAccessSettings/saveAccessSettings to GD Security.js"
```

---

## Task 3 — `GD Security.js`: `buildAccessDeniedPage_GD_()`

**Files:**
- Modify: `D:\Contribution\GD Security.js` (append at end of file)

- [ ] **Step 1: Append the denied-page builder**

```javascript
/**
 * Returns a minimal HTML page shown to denied users.
 * Called from doGet() in goalCompliance.js.
 */
function buildAccessDeniedPage_GD_(email) {
  var safeEmail = email
    ? email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
  return "<!DOCTYPE html>" +
"<html lang=\"en\"><head><meta charset=\"UTF-8\">" +
"<title>Goals Compliance Dashboard — Access Restricted</title>" +
"<style>" +
"  *{box-sizing:border-box;margin:0;padding:0}" +
"  body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
"       background:#F8FAFC;display:flex;align-items:center;" +
"       justify-content:center;min-height:100vh}" +
"  .card{background:#fff;border-radius:14px;padding:40px 48px;" +
"        text-align:center;max-width:420px;width:90%;" +
"        box-shadow:0 1px 4px rgba(0,0,0,.08);border:1px solid #E2E8F0}" +
"  .lock{font-size:40px;margin-bottom:16px}" +
"  h1{font-size:18px;font-weight:800;color:#0F1941;margin-bottom:8px}" +
"  p{color:#64748B;font-size:13px;line-height:1.65}" +
"  .email{display:inline-block;margin-top:14px;background:#F1F5F9;" +
"         border-radius:6px;padding:5px 12px;font-family:monospace;" +
"         font-size:12px;color:#475569}" +
"</style></head>" +
"<body><div class=\"card\">" +
"  <div class=\"lock\">🔒</div>" +
"  <h1>Access Restricted</h1>" +
"  <p>The Goals Compliance Dashboard is available to ServiceRocket employees only.<br>" +
"  Contact your manager or the dashboard owner to request access.</p>" +
"  " + (safeEmail ? "<div class=\"email\">" + safeEmail + "</div>" : "") +
"</div></body></html>";
}
```

- [ ] **Step 2: Verify no syntax errors** in the Apps Script editor.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/GD Security.js"
git commit -m "feat(security): add buildAccessDeniedPage_GD_ to GD Security.js"
```

---

## Task 4 — `goalCompliance.js`: `resolveGDManagerScope_()` + test

**Files:**
- Modify: `D:\Contribution\goalCompliance.js` (insert after `getFullRosterMap_()`, currently ending at line 557)

- [ ] **Step 1: Insert the BFS helper immediately after the closing `}` of `getFullRosterMap_()` (line 557)**

```javascript
// ── Manager org-tree scoping (used by GD Security.js's manager role) ──
// BFS over the roster's Supervisor field to build the full org tree under a
// manager. The manager's own norm name is included so their own row appears.
// fullRosterMap must be the COMPANY-WIDE map (never a pre-scoped subset) —
// scoping is applied by the caller using the returned set.
function resolveGDManagerScope_(fullRosterMap, managerNorm) {
  var scope = {};
  scope[managerNorm] = true;
  var queue = [managerNorm];
  while (queue.length > 0) {
    var supNorm = queue.shift();
    Object.keys(fullRosterMap).forEach(function(norm) {
      if (!scope[norm] && normName_(fullRosterMap[norm].supervisor) === supNorm) {
        scope[norm] = true;
        queue.push(norm);
      }
    });
  }
  return scope;
}
```

- [ ] **Step 2: Add the test function at the end of the file (after `getOrCreateTrackerSheet_`)**

```javascript
// ── Tests ─────────────────────────────────────────────────────
// Run manually in the Apps Script editor: select _test_resolveGDManagerScope_
// from the function dropdown, click Run, check the execution log.

function _test_resolveGDManagerScope_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_resolveGDManagerScope_: " + msg); }

  // Org tree: Alice manages Bob and Cara; Bob manages Dan. Eve reports elsewhere.
  var roster = {
    'alice smith': { supervisor: '' },
    'bob jones':   { supervisor: 'Alice Smith' },
    'cara lee':    { supervisor: 'Alice Smith' },
    'dan park':    { supervisor: 'Bob Jones' },
    'eve chen':    { supervisor: 'Someone Else' },
  };

  var scope = resolveGDManagerScope_(roster, 'alice smith');
  var keys = Object.keys(scope).sort();

  assert_(keys.length === 4, "expected 4 people in scope, got " + keys.length + " (" + keys.join(",") + ")");
  assert_(scope['alice smith'] === true, "manager must see their own row");
  assert_(scope['bob jones']   === true, "direct report missing");
  assert_(scope['cara lee']    === true, "direct report missing");
  assert_(scope['dan park']    === true, "second-level report (Bob's report) missing — BFS should recurse");
  assert_(!scope['eve chen'],  "Eve does not report into Alice's tree and must be excluded");

  var leafScope = resolveGDManagerScope_(roster, 'dan park');
  assert_(Object.keys(leafScope).length === 1 && leafScope['dan park'], "leaf manager should only see themselves");

  Logger.log("✅ _test_resolveGDManagerScope_ passed");
}
```

- [ ] **Step 3: Run `_test_resolveGDManagerScope_()` in the Apps Script editor**

Expected: execution log ends with `✅ _test_resolveGDManagerScope_ passed` and no thrown error.

- [ ] **Step 4: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(backend): add resolveGDManagerScope_ org-tree BFS helper + test"
```

---

## Task 5 — `goalCompliance.js`: gate `doGet()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js:121-127`

- [ ] **Step 1: Replace `doGet()`**

Current (lines 121-127):
```javascript
function doGet() {
  return HtmlService.createTemplateFromFile('GDash')
    .evaluate()
    .setTitle('Goals Compliance Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

Replace with:
```javascript
function doGet() {
  var access = checkDashboardAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_GD_(access.email))
      .setTitle('Goals Compliance Dashboard — Access Restricted')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  return HtmlService.createTemplateFromFile('GDash')
    .evaluate()
    .setTitle('Goals Compliance Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

- [ ] **Step 2: Verify no syntax errors** in the Apps Script editor. `checkDashboardAccess`/`buildAccessDeniedPage_GD_` will resolve once Tasks 1–3 are in the same project — confirm no "undefined function" warning.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(security): gate doGet() behind checkDashboardAccess"
```

---

## Task 6 — `goalCompliance.js`: gate + fix cache key in `getGoalsComplianceData()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js:131-149`

- [ ] **Step 1: Replace `getGoalsComplianceData()`**

Current (lines 131-149):
```javascript
function getGoalsComplianceData(quarter) {
  var qtr      = String(quarter || CONFIG_GD.DEFAULT_QUARTER).trim();
  var cacheKey = CONFIG_GD.CACHE_VER + qtr;
  var cache    = CacheService.getScriptCache();

  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  var result = buildComplianceData_(qtr);

  try {
    var json = JSON.stringify(result);
    if (json.length < 90000) cache.put(cacheKey, json, CONFIG_GD.CACHE_TTL);
  } catch (e) { log_('Cache put skipped: ' + e.message); }

  return result;
}
```

Replace with:
```javascript
function getGoalsComplianceData(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  var qtr      = String(quarter || CONFIG_GD.DEFAULT_QUARTER).trim();
  // Cache key includes the caller's scope — admin and viewer share one entry
  // (both see the full company), managers get their own keyed by email. Without
  // this, one manager's org-tree-filtered payload could be served to a different
  // manager (or an admin) requesting the same quarter.
  var scopeKey = (access.role === 'admin' || access.role === 'viewer') ? 'admin' : access.email;
  var cacheKey = CONFIG_GD.CACHE_VER + qtr + '_' + scopeKey;
  var cache    = CacheService.getScriptCache();

  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  var result = buildComplianceData_(qtr, access);

  try {
    var json = JSON.stringify(result);
    if (json.length < 90000) cache.put(cacheKey, json, CONFIG_GD.CACHE_TTL);
  } catch (e) { log_('Cache put skipped: ' + e.message); }

  return result;
}
```

- [ ] **Step 2: Verify no syntax errors** in the Apps Script editor.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(security): gate getGoalsComplianceData and scope its cache key by role"
```

---

## Task 7 — `goalCompliance.js`: apply manager scoping inside `buildComplianceData_()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js:14-29` (CACHE_VER bump)
- Modify: `D:\Contribution\goalCompliance.js:222-273` (signature + roster scoping + injection loop)
- Modify: `D:\Contribution\goalCompliance.js:341-355` (return payload)

- [ ] **Step 1: Bump `CACHE_VER`**

In `CONFIG_GD` (line 27), change:
```javascript
  CACHE_VER:           'gd_v7_',  // bumped: fix Employee Status detection + blocklist exclusion
```
to:
```javascript
  CACHE_VER:           'gd_v8_',  // bumped: manager org-tree scoping + cache key now includes role/email
```

- [ ] **Step 2: Change the function signature and roster-scoping block**

Current (lines 222-243):
```javascript
function buildComplianceData_(quarter) {
  log_('buildComplianceData_ | quarter: ' + quarter);

  // 1. Read full RD and filter by quarter
  var allRd  = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);
  var rdRows = allRd.filter(function(r) {
    return String(r['Fiscal Quarter'] || '').trim() === quarter;
  });
  log_('RD rows for ' + quarter + ': ' + rdRows.length);

  // 2. Read Roster once — derive activeSet, locMap, and supTitleMap from the single read
  var fullRosterMap  = getFullRosterMap_();
  var activeSet      = {};
  var locMap         = {};
  var supTitleMap    = {};
  Object.keys(fullRosterMap).forEach(function(norm) {
    var r = fullRosterMap[norm];
    activeSet[norm]   = true;
    locMap[norm]      = r.location;
    supTitleMap[norm] = r.jobTitle;
  });
  log_('Roster active: ' + Object.keys(activeSet).length + ' | locations: ' + Object.keys(locMap).length);
```

Replace with:
```javascript
function buildComplianceData_(quarter, access) {
  log_('buildComplianceData_ | quarter: ' + quarter);

  // 1. Read full RD and filter by quarter
  var allRd  = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);
  var rdRows = allRd.filter(function(r) {
    return String(r['Fiscal Quarter'] || '').trim() === quarter;
  });
  log_('RD rows for ' + quarter + ': ' + rdRows.length);

  // 2. Read Roster once — company-wide, used both to resolve a manager's org-tree
  // scope and to derive activeSet/locMap/supTitleMap below.
  var fullRosterMap = getFullRosterMap_();

  // 2b. Manager role: narrow the roster to just the caller's org tree so every
  // downstream aggregate (employees, comment trend, engagement, summary, and the
  // zero-goal-employee injection below) only reflects the manager's own team.
  // Admins and viewers keep the full company-wide roster.
  var managerScopeName = null;
  var rosterMap = fullRosterMap;
  if (access && access.role === 'manager') {
    managerScopeName = access.delegateScopeName;
    var scope = resolveGDManagerScope_(fullRosterMap, normName_(managerScopeName));
    rosterMap = {};
    Object.keys(fullRosterMap).forEach(function(norm) {
      if (scope[norm]) rosterMap[norm] = fullRosterMap[norm];
    });
    log_('Manager scope "' + managerScopeName + '": ' + Object.keys(rosterMap).length + ' employees in scope');
  }

  var activeSet      = {};
  var locMap         = {};
  var supTitleMap    = {};
  Object.keys(rosterMap).forEach(function(norm) {
    var r = rosterMap[norm];
    activeSet[norm]   = true;
    locMap[norm]      = r.location;
    supTitleMap[norm] = r.jobTitle;
  });
  log_('Roster active: ' + Object.keys(activeSet).length + ' | locations: ' + Object.keys(locMap).length);
```

- [ ] **Step 3: Point the zero-goal injection loop at `rosterMap` instead of `fullRosterMap`**

Current (lines 248-273):
```javascript
  // 3b. Inject every active Roster employee not found in the RD sheet (0 goals this quarter)
  var preInjectCount = Object.keys(rockMap).length;
  Object.keys(fullRosterMap).forEach(function(norm) {
    if (rockMap[norm]) return; // already present from RD
    var r = fullRosterMap[norm];
    rockMap[norm] = {
```

Replace the two `fullRosterMap` references in this block with `rosterMap`:
```javascript
  // 3b. Inject every active, in-scope Roster employee not found in the RD sheet (0 goals this quarter)
  var preInjectCount = Object.keys(rockMap).length;
  Object.keys(rosterMap).forEach(function(norm) {
    if (rockMap[norm]) return; // already present from RD
    var r = rosterMap[norm];
    rockMap[norm] = {
```

(The rest of that block — the zeroed-metrics object literal, lines 254–271 — is unchanged.)

- [ ] **Step 4: Add `userRole`/`userEmail`/`managerScopeName` to the return payload**

Current (lines 341-355):
```javascript
  return {
    employees:              employees,
    summary:                computeSummary_(employees),
    commentTrend:           commentTrend,
    quarter:                quarter,
    quarters:               quarters,
    totalQtrWeeks:          totalQtrWeeks,
    quarterDates:           quarterDates,
    isGoalCreationGrace:    isGoalCreationGrace,
    isCompletionGrace:      isCompletionGrace,
    weeksElapsedSinceStart: weeksElapsedSinceStart,
    engagementData:         engagementData,
    generatedAt:            new Date().toISOString(),
  };
}
```

Replace with:
```javascript
  return {
    employees:              employees,
    summary:                computeSummary_(employees),
    commentTrend:           commentTrend,
    quarter:                quarter,
    quarters:               quarters,
    totalQtrWeeks:          totalQtrWeeks,
    quarterDates:           quarterDates,
    isGoalCreationGrace:    isGoalCreationGrace,
    isCompletionGrace:      isCompletionGrace,
    weeksElapsedSinceStart: weeksElapsedSinceStart,
    engagementData:         engagementData,
    generatedAt:            new Date().toISOString(),
    userRole:               access ? access.role  : null,
    userEmail:              access ? access.email : null,
    managerScopeName:       managerScopeName,
  };
}
```

- [ ] **Step 5: Verify no syntax errors** in the Apps Script editor.

- [ ] **Step 6: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(security): scope buildComplianceData_ to a manager's org tree, bump CACHE_VER to gd_v8_"
```

---

## Task 8 — `goalCompliance.js`: gate + scope `getHRNotes()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js:179-206`

- [ ] **Step 1: Replace `getHRNotes()`**

Current (lines 179-206):
```javascript
function getHRNotes(quarter) {
  try {
    var rows = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_HR_TRACKER);
    var qtr  = quarter || null;
    return rows
      .filter(function(r) { return !qtr || String(r['Quarter'] || '') === qtr; })
      .map(function(r) {
        return {
          timestamp:        r['Timestamp']      ? new Date(r['Timestamp']).toISOString() : '',
          rocketeer:        String(r['Rocketeer']  || ''),
          normName:         String(r['NormName']   || normName_(r['Rocketeer'] || '')),
          quarter:          String(r['Quarter']    || ''),
          reviewedBy:       String(r['ReviewedBy'] || ''),
          note:             String(r['Note']       || ''),
          followUpDate:     String(r['FollowUpDate']|| ''),
          status:           String(r['Status']     || ''),
          supervisor:       String(r['Supervisor'] || ''),
          department:       String(r['Department'] || ''),
          complianceAtNote: String(r['ComplianceStatus'] || ''),
          goalsAtNote:      Number(r['TotalGoals'] || 0),
        };
      })
      .sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
  } catch (e) {
    Logger.log('⚠️ getHRNotes: ' + e.message);
    return [];
  }
}
```

Replace with:
```javascript
function getHRNotes(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return [];

  try {
    var rows = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_HR_TRACKER);
    var qtr  = quarter || null;

    // Manager role: only show HR notes about people in the caller's own org tree —
    // a manager should not see follow-up notes written about people outside their team.
    var scope = null;
    if (access.role === 'manager') {
      scope = resolveGDManagerScope_(getFullRosterMap_(), normName_(access.delegateScopeName));
    }

    return rows
      .filter(function(r) { return !qtr || String(r['Quarter'] || '') === qtr; })
      .filter(function(r) {
        if (!scope) return true;
        var norm = String(r['NormName'] || normName_(r['Rocketeer'] || ''));
        return !!scope[norm];
      })
      .map(function(r) {
        return {
          timestamp:        r['Timestamp']      ? new Date(r['Timestamp']).toISOString() : '',
          rocketeer:        String(r['Rocketeer']  || ''),
          normName:         String(r['NormName']   || normName_(r['Rocketeer'] || '')),
          quarter:          String(r['Quarter']    || ''),
          reviewedBy:       String(r['ReviewedBy'] || ''),
          note:             String(r['Note']       || ''),
          followUpDate:     String(r['FollowUpDate']|| ''),
          status:           String(r['Status']     || ''),
          supervisor:       String(r['Supervisor'] || ''),
          department:       String(r['Department'] || ''),
          complianceAtNote: String(r['ComplianceStatus'] || ''),
          goalsAtNote:      Number(r['TotalGoals'] || 0),
        };
      })
      .sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
  } catch (e) {
    Logger.log('⚠️ getHRNotes: ' + e.message);
    return [];
  }
}
```

- [ ] **Step 2: Verify no syntax errors** in the Apps Script editor.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(security): gate getHRNotes and scope results to a manager's org tree"
```

---

## Task 9 — `goalCompliance.js`: gate `saveHRNote()` and `bustCache()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js:151-177` (`saveHRNote`)
- Modify: `D:\Contribution\goalCompliance.js:208-214` (`bustCache`)

- [ ] **Step 1: Gate `saveHRNote()`**

Current (lines 151-177):
```javascript
function saveHRNote(data) {
  try {
    var email = Session.getActiveUser().getEmail() || 'unknown';
    var ss    = SpreadsheetApp.openById(CONFIG_GD.GOALS_SS_ID);
    var sh    = getOrCreateTrackerSheet_(ss);
```

Replace the opening with:
```javascript
function saveHRNote(data) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  try {
    var email = access.email || 'unknown';
    var ss    = SpreadsheetApp.openById(CONFIG_GD.GOALS_SS_ID);
    var sh    = getOrCreateTrackerSheet_(ss);
```

(Everything from `sh.appendRow([...` through the end of the function, lines 157-177, is unchanged.)

- [ ] **Step 2: Gate `bustCache()` and fix key removal for the new scoped cache keys**

Current (lines 208-214):
```javascript
function bustCache(quarter) {
  var cache = CacheService.getScriptCache();
  var toRemove = [CONFIG_GD.DEFAULT_QUARTER];
  if (quarter && quarter !== CONFIG_GD.DEFAULT_QUARTER) toRemove.push(quarter);
  toRemove.forEach(function(q) { cache.remove(CONFIG_GD.CACHE_VER + q); });
  return { ok: true };
}
```

Replace with:
```javascript
function bustCache(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  var cache = CacheService.getScriptCache();
  var toRemove = [CONFIG_GD.DEFAULT_QUARTER];
  if (quarter && quarter !== CONFIG_GD.DEFAULT_QUARTER) toRemove.push(quarter);

  // Cache keys are now scoped by role/email (see getGoalsComplianceData) — remove
  // both the shared admin/viewer entry and the calling user's own scoped entry so
  // Refresh works for whichever role clicked it.
  var scopeKeys = ['admin', access.email];
  toRemove.forEach(function(q) {
    scopeKeys.forEach(function(sk) { cache.remove(CONFIG_GD.CACHE_VER + q + '_' + sk); });
  });
  return { ok: true };
}
```

- [ ] **Step 3: Verify no syntax errors** in the Apps Script editor.

- [ ] **Step 4: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(security): gate saveHRNote and bustCache behind checkDashboardAccess"
```

---

## Task 10 — `GDash.html`: ☰ menu CSS + header markup

**Files:**
- Modify: `D:\Contribution\GDash.html:209-210` (CSS insertion, just before `</style>`)
- Modify: `D:\Contribution\GDash.html:219-229` (header HTML)

- [ ] **Step 1: Insert nav-menu and scope-badge CSS immediately before `</style>` (line 210)**

```css
/* Nav Menu (☰) — admin-only Access Control entry point */
.nav-menu-wrap{position:relative;flex-shrink:0;display:none}
.nav-menu-btn{display:flex;align-items:center;justify-content:center;width:30px;height:30px;
  border-radius:99px;font-size:14px;cursor:pointer;border:1px solid rgba(255,255,255,.25);
  background:rgba(255,255,255,.1);color:#fff;transition:background .15s}
.nav-menu-btn:hover{background:rgba(255,255,255,.2)}
.nav-menu-btn.open{background:rgba(255,255,255,.25)}
.nav-menu-panel{display:none;position:absolute;top:calc(100% + 8px);right:0;min-width:190px;
  background:#fff;border:1px solid var(--border);border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:90;padding:6px}
.nav-menu-panel.open{display:block}
.nav-menu-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;
  padding:8px 11px;border:none;background:transparent;border-radius:7px;cursor:pointer;
  font-size:11px;font-weight:700;color:var(--text);font-family:inherit}
.nav-menu-item:hover{background:var(--surface)}

/* Manager scope badge */
.scope-badge{background:#5B21B6;color:#fff;border-radius:99px;padding:3px 12px;font-size:10px;
  font-weight:700;white-space:nowrap;flex-shrink:0;display:none}
```

- [ ] **Step 2: Update the header block**

Current (lines 219-229):
```html
  <div class="header">
    <div class="header-logo">🎯</div>
    <div class="header-title">
      <h1>Goals Compliance Dashboard</h1>
      <p>Company-wide · RPI &amp; STF Eligibility · HR Follow-Up Tracker</p>
    </div>
    <select id="quarter-select" class="quarter-select" onchange="onQuarterChange(this.value)"></select>
    <span class="week-badge" id="week-badge"></span>
    <button class="header-btn" onclick="exportAllPNG()">⬇ PNG</button>
    <button class="header-btn" onclick="refreshData()">↺ Refresh</button>
  </div>
```

Replace with:
```html
  <div class="header">
    <div class="header-logo">🎯</div>
    <div class="header-title">
      <h1>Goals Compliance Dashboard</h1>
      <p>Company-wide · RPI &amp; STF Eligibility · HR Follow-Up Tracker</p>
    </div>
    <span class="scope-badge" id="scope-badge"></span>
    <select id="quarter-select" class="quarter-select" onchange="onQuarterChange(this.value)"></select>
    <span class="week-badge" id="week-badge"></span>
    <button class="header-btn" onclick="exportAllPNG()">⬇ PNG</button>
    <button class="header-btn" onclick="refreshData()">↺ Refresh</button>
    <div class="nav-menu-wrap" id="nav-menu-wrap">
      <button class="nav-menu-btn" id="nav-menu-btn" onclick="toggleNavMenu()" title="Menu" aria-haspopup="true" aria-expanded="false">☰</button>
      <div class="nav-menu-panel" id="nav-menu-panel" role="menu">
        <button class="nav-menu-item" role="menuitem" onclick="openAccessTab_()">🔒 Access Control</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: Open `GDash.html` in a browser preview (or paste the `<style>`/header block into an HTML validator) to confirm no unclosed tags.** The ☰ button will be invisible for now (`display:none` until Task 13 wires role detection) — that's expected at this point in the plan.

- [ ] **Step 4: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): add hidden nav-menu and scope-badge markup to GDash header"
```

---

## Task 11 — `GDash.html`: Access Control pane HTML + settings CSS

**Files:**
- Modify: `D:\Contribution\GDash.html` (CSS insertion, before `</style>` — now a few lines later than Task 10 due to the prior insertion)
- Modify: `D:\Contribution\GDash.html` (HTML insertion, after the `pane-hrtracker` closing `</div>`, before `</main>`)

- [ ] **Step 1: Insert settings/sec CSS immediately before `</style>`**

```css
/* Access Control settings (☰ menu → 🔒 Access Control) */
.settings-body{padding:20px;display:flex;flex-direction:column;gap:20px}
.settings-actions{display:flex;gap:10px;flex-wrap:wrap}
.settings-btn{padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;
  border:1px solid var(--border);background:#fff;color:var(--slate);transition:background .15s}
.settings-btn:disabled{opacity:.45;cursor:not-allowed}
.settings-btn-primary{background:var(--void);color:#fff;border-color:var(--void)}
.settings-btn-primary:hover:not(:disabled){background:#1a2d6b}
.settings-save-flash{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--success);margin-left:6px}
.sec-user-chip{display:inline-flex;align-items:center;gap:8px;background:var(--surface);
  border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:12px;color:var(--slate)}
.sec-user-chip strong{color:var(--void)}
.sec-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.sec-field-label{font-size:11px;font-weight:800;color:var(--void);text-transform:uppercase;
  letter-spacing:.05em;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.sec-badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:99px;font-size:9px;font-weight:800;letter-spacing:.03em}
.sec-badge-admin{background:#EEF4FF;color:#0D3B8C}
.sec-badge-viewer{background:#F1F8F4;color:#1B5E20}
.sec-badge-manager{background:#F5F3FF;color:#5B21B6}
.sec-textarea{width:100%;min-height:90px;border:1px solid var(--border);border-radius:8px;
  padding:8px 10px;font-size:12px;font-family:monospace;color:var(--text);background:#fff;
  resize:vertical;outline:none}
.sec-hint{font-size:11px;color:var(--muted);margin-top:5px}
.sec-toggle-row{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--surface);
  border-radius:8px;border:1px solid var(--border)}
.sec-toggle{position:relative;width:40px;height:22px;flex-shrink:0}
.sec-toggle input{opacity:0;width:0;height:0;position:absolute}
.sec-toggle-track{position:absolute;inset:0;background:var(--border);border-radius:99px;transition:background .2s;cursor:pointer}
.sec-toggle input:checked + .sec-toggle-track{background:var(--success)}
.sec-toggle-thumb{position:absolute;width:16px;height:16px;background:#fff;border-radius:50%;top:3px;left:3px;
  transition:transform .2s;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.sec-toggle input:checked ~ .sec-toggle-thumb{transform:translateX(18px)}
.sec-toggle-info .sec-toggle-title{font-size:12px;font-weight:700;color:var(--void)}
.sec-toggle-info .sec-toggle-desc{font-size:11px;color:var(--slate);margin-top:2px}
```

- [ ] **Step 2: Insert the `pane-access` HTML block**

Find the closing of `pane-hrtracker`:
```html
        <div class="section-body" id="tracker-body"></div>
      </div>
    </div>

  </main>
```

Insert a new pane between `pane-hrtracker`'s closing `</div>` and `</main>`:
```html
        <div class="section-body" id="tracker-body"></div>
      </div>
    </div>

    <!-- ── ACCESS CONTROL (admin only, opened from the ☰ menu) ── -->
    <div id="pane-access" class="tab-pane">
      <div class="section-card">
        <div class="section-head">
          <div><h2>Access Control</h2><p class="section-sub">Manage who can view this dashboard · Admins, viewers, and manager-scoped delegates</p></div>
          <button class="btn" onclick="switchTab(S.lastRegularTab || 'overview')">← Back to Dashboard</button>
        </div>
        <div id="access-body" class="section-body"></div>
      </div>
    </div>

  </main>
```

- [ ] **Step 3: Confirm the HTML is well-formed** — open in a browser preview; the `pane-access` div should be present but invisible (`.tab-pane` has no `.active` class yet).

- [ ] **Step 4: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): add Access Control pane markup and sec-*/settings-* CSS"
```

---

## Task 12 — `GDash.html`: Access Control JS + wire into `renderTab`/`switchTab`

**Files:**
- Modify: `D:\Contribution\GDash.html:456-465` (`S` state object)
- Modify: `D:\Contribution\GDash.html:652-670` (`switchTab`/`renderTab`)
- Modify: `D:\Contribution\GDash.html` (append new JS functions, e.g. right before the `// ── UTILITIES ──` section at line 1719)

- [ ] **Step 1: Add `lastRegularTab` to the `S` state object**

Current (lines 456-465):
```javascript
var S = {
  data:         null,
  notes:        [],
  userEmail:    '',
  filters:      { location:[], department:[], jobFamily:[], status:[], supervisor:[] },
  charts:       {},
  activeTab:    'overview',
  reviewTarget: null,
  trendDepts:   [],  // department lines shown on trend chart
};
```

Replace with:
```javascript
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

- [ ] **Step 2: Update `switchTab()` and `renderTab()`**

Current (lines 652-670):
```javascript
function switchTab(tabId) {
  S.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(function(p) {
    p.classList.toggle('active', p.id === 'pane-' + tabId);
  });
  renderTab(tabId);
}

function renderTab(tabId) {
  var emps = getFiltered();
  if      (tabId === 'overview')  renderOverview(emps);
  else if (tabId === 'trend')     renderEngagement(emps);
  else if (tabId === 'breakdown') renderBreakdown(emps);
  else if (tabId === 'atrisk')    renderAtRisk(emps);
  else if (tabId === 'hrtracker') renderHRTracker();
}
```

Replace with:
```javascript
function switchTab(tabId) {
  if (tabId !== 'access') S.lastRegularTab = tabId;
  S.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(function(p) {
    p.classList.toggle('active', p.id === 'pane-' + tabId);
  });
  renderTab(tabId);
}

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

- [ ] **Step 3: Add the nav-menu and Access Control JS functions**

Insert immediately before the `// ── UTILITIES ──────────────────────────────────────────────────────` comment (line 1719):

```javascript
// ── NAV MENU (☰) + ACCESS CONTROL ───────────────────────────────
function toggleNavMenu(forceClose) {
  var btn   = document.getElementById('nav-menu-btn');
  var panel = document.getElementById('nav-menu-panel');
  if (!btn || !panel) return;
  var open = forceClose === true ? false : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openAccessTab_() {
  toggleNavMenu(true);
  switchTab('access');
}

function renderAccessTab_() {
  var container = document.getElementById('access-body');
  if (!container) return;
  container.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:16px 0">' +
    '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>' +
    '<span style="font-size:12px;color:var(--muted)">Loading access settings…</span></div>';

  google.script.run
    .withSuccessHandler(function(s) { populateSecuritySection_(s); })
    .withFailureHandler(function(e) {
      container.innerHTML = '<p style="color:#B71C1C;font-size:12px;padding:8px 0">Failed to load access settings: ' + esc(String(e.message || e)) + '</p>';
    })
    .getAccessSettings();
}

function populateSecuritySection_(s) {
  var el = document.getElementById('access-body');
  if (!el) return;

  var adminsVal    = (s.admins    || []).join('\n');
  var viewersVal   = (s.viewers   || []).join('\n');
  var delegatesVal = (s.delegates || []).map(function(d) { return d.email + ':' + d.scopeName; }).join('\n');
  var openChecked  = s.openAccess ? 'checked' : '';

  el.innerHTML =
    '<div class="sec-user-chip">Signed in as <strong>' + esc(s.callerEmail || S.userEmail) + '</strong>' +
    '&ensp;<span class="sec-badge sec-badge-admin">Admin</span></div>' +

    '<div class="sec-toggle-row">' +
      '<label class="sec-toggle">' +
        '<input type="checkbox" id="sec-open-access" ' + openChecked + '>' +
        '<div class="sec-toggle-track"></div><div class="sec-toggle-thumb"></div>' +
      '</label>' +
      '<div class="sec-toggle-info">' +
        '<div class="sec-toggle-title">Open Access</div>' +
        '<div class="sec-toggle-desc">When ON, anyone at ServiceRocket with the link can view the dashboard. Settings remain admin-only.</div>' +
      '</div>' +
    '</div>' +

    '<div class="sec-grid">' +
      '<div>' +
        '<div class="sec-field-label"><span class="sec-badge sec-badge-admin">Admin</span> Admins — can view + edit settings</div>' +
        '<textarea class="sec-textarea" id="sec-admins" placeholder="One email per line…">' + esc(adminsVal) + '</textarea>' +
        '<div class="sec-hint">One email per line · Bootstrap admin (' + esc(s.bootstrapAdmin || '') + ') is always included</div>' +
      '</div>' +
      '<div>' +
        '<div class="sec-field-label"><span class="sec-badge sec-badge-viewer">Viewer</span> Viewers — can view only</div>' +
        '<textarea class="sec-textarea" id="sec-viewers" placeholder="One email per line…">' + esc(viewersVal) + '</textarea>' +
        '<div class="sec-hint">One email per line · Leave empty when Open Access is ON</div>' +
      '</div>' +
    '</div>' +

    '<div>' +
      '<div class="sec-field-label"><span class="sec-badge sec-badge-manager">Manager</span> Delegates — scoped manager access</div>' +
      '<textarea class="sec-textarea" id="sec-delegates" placeholder="peer@servicerocket.com:Supervisor Full Name" style="min-height:70px">' + esc(delegatesVal) + '</textarea>' +
      '<div class="sec-hint">One entry per line · Format: <code>email:Supervisor Full Name</code> · Roster supervisors are auto-detected — no entry needed for them</div>' +
    '</div>' +

    '<div class="settings-actions">' +
      '<button class="settings-btn settings-btn-primary" id="sec-save-btn" onclick="saveSecuritySettings_()">Save Access Settings</button>' +
      '<span id="sec-flash" class="settings-save-flash" style="display:none">✓ Saved</span>' +
    '</div>' +
    '<div id="sec-error" style="display:none;margin-top:8px;padding:8px 12px;background:#FEE2E2;border-radius:6px;font-size:12px;color:#B71C1C;font-weight:600"></div>' +
    '<div id="sec-timestamp" style="margin-top:6px;font-size:11px;color:var(--muted)"></div>';
}

function saveSecuritySettings_() {
  var btn   = document.getElementById('sec-save-btn');
  var flash = document.getElementById('sec-flash');
  var errEl = document.getElementById('sec-error');
  var tsEl  = document.getElementById('sec-timestamp');

  var admins     = (document.getElementById('sec-admins')     || {}).value || '';
  var viewers    = (document.getElementById('sec-viewers')    || {}).value || '';
  var delegates  = (document.getElementById('sec-delegates')  || {}).value || '';
  var openAccess = !!(document.getElementById('sec-open-access') || {}).checked;

  var adminList  = admins.split(/[\n,]+/).map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var viewerList = viewers.split(/[\n,]+/).map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var delegateList = delegates.split(/\n+/).map(function(line) {
    var sep = line.indexOf(':');
    if (sep === -1) return null;
    var email     = line.slice(0, sep).trim().toLowerCase();
    var scopeName = line.slice(sep + 1).trim();
    return (email && scopeName) ? { email: email, scopeName: scopeName } : null;
  }).filter(Boolean);

  if (btn)   { btn.disabled = true; btn.textContent = 'Saving…'; }
  if (flash) flash.style.display = 'none';
  if (errEl) errEl.style.display = 'none';

  google.script.run
    .withSuccessHandler(function(result) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Access Settings'; }
      if (result && result.ok) {
        if (flash) { flash.style.display = 'inline-flex'; setTimeout(function() { flash.style.display = 'none'; }, 4000); }
        if (tsEl && result.savedAt) tsEl.textContent = 'Last saved: ' + new Date(result.savedAt).toLocaleString();
      } else {
        var msg = (result && result.error) ? result.error : 'Save failed.';
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      }
    })
    .withFailureHandler(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Access Settings'; }
      if (errEl) { errEl.textContent = 'Save failed: ' + String(err.message || err).substring(0, 120); errEl.style.display = 'block'; }
    })
    .saveAccessSettings({ admins: adminList, viewers: viewerList, delegates: delegateList, openAccess: openAccess });
}
```

- [ ] **Step 4: Confirm no syntax errors** by opening the file in a browser preview and checking the console for JS parse errors.

- [ ] **Step 5: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): add Access Control tab JS and wire it into switchTab/renderTab"
```

---

## Task 13 — `GDash.html`: role-driven nav visibility + manager badge + denied handling

**Files:**
- Modify: `D:\Contribution\GDash.html:478-503` (`init()`, `onReady()`)
- Modify: `D:\Contribution\GDash.html:533-553` (`onQuarterChange()`)
- Modify: `D:\Contribution\GDash.html` (append `applyRoleToNav_()` near the nav-menu JS added in Task 12)

- [ ] **Step 1: Add `applyRoleToNav_()`**

Insert right after `toggleNavMenu()`/`openAccessTab_()` (added in Task 12, Step 3):

```javascript
function applyRoleToNav_() {
  var wrap  = document.getElementById('nav-menu-wrap');
  var badge = document.getElementById('scope-badge');
  var role  = S.data && S.data.userRole;

  if (wrap) wrap.style.display = (role === 'admin') ? '' : 'none';

  if (badge) {
    if (role === 'manager' && S.data.managerScopeName) {
      badge.textContent = 'Scoped: ' + S.data.managerScopeName + '’s team';
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}
```

- [ ] **Step 2: Handle `data.denied` and call `applyRoleToNav_()` in `init()`**

Current (lines 478-503):
```javascript
function init() {
  var runner = (typeof google !== 'undefined' && google.script) ? google.script.run : null;
  if (!runner) { showError('Not running inside Google Apps Script.'); return; }

  runner.withSuccessHandler(function(email) { S.userEmail = email || ''; }).getUserEmail();

  runner
    .withSuccessHandler(function(data) {
      S.data = data;
      runner
        .withSuccessHandler(function(notes) { S.notes = notes || []; onReady(); })
        .withFailureHandler(function() { S.notes = []; onReady(); })
        .getHRNotes(data.quarter);
    })
    .withFailureHandler(function(err) { showError(err.message || 'Failed to load compliance data.'); })
    .getGoalsComplianceData();
}

function onReady() {
  populateQuarterSelect();
  buildFilterDropdowns();
  updateGraceBanner_();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = '';
  renderTab(S.activeTab);
}
```

Replace with:
```javascript
function init() {
  var runner = (typeof google !== 'undefined' && google.script) ? google.script.run : null;
  if (!runner) { showError('Not running inside Google Apps Script.'); return; }

  runner.withSuccessHandler(function(email) { S.userEmail = email || ''; }).getUserEmail();

  runner
    .withSuccessHandler(function(data) {
      if (data && data.denied) {
        showError('Access denied for ' + (data.email || 'this account') + '. Contact your admin to request access.');
        return;
      }
      S.data = data;
      runner
        .withSuccessHandler(function(notes) { S.notes = notes || []; onReady(); })
        .withFailureHandler(function() { S.notes = []; onReady(); })
        .getHRNotes(data.quarter);
    })
    .withFailureHandler(function(err) { showError(err.message || 'Failed to load compliance data.'); })
    .getGoalsComplianceData();
}

function onReady() {
  populateQuarterSelect();
  buildFilterDropdowns();
  updateGraceBanner_();
  applyRoleToNav_();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = '';
  renderTab(S.activeTab);
}
```

- [ ] **Step 3: Handle `data.denied` and refresh nav role in `onQuarterChange()`**

Current (lines 533-553):
```javascript
function onQuarterChange(q) {
  document.getElementById('loading').style.display = '';
  document.getElementById('app').style.display = 'none';
  google.script.run
    .withSuccessHandler(function(data) {
      S.data = data;
      S.filters = { location:[], department:[], jobFamily:[], status:[], supervisor:[] };
      google.script.run
        .withSuccessHandler(function(notes) {
          S.notes = notes || [];
          buildFilterDropdowns();
          document.getElementById('loading').style.display = 'none';
          document.getElementById('app').style.display = '';
          renderTab(S.activeTab);
        })
        .withFailureHandler(function() { S.notes = []; renderTab(S.activeTab); })
        .getHRNotes(data.quarter);
    })
    .withFailureHandler(function(err) { showError(err.message); })
    .getGoalsComplianceData(q);
}
```

Replace with:
```javascript
function onQuarterChange(q) {
  document.getElementById('loading').style.display = '';
  document.getElementById('app').style.display = 'none';
  google.script.run
    .withSuccessHandler(function(data) {
      if (data && data.denied) {
        showError('Access denied for ' + (data.email || 'this account') + '. Contact your admin to request access.');
        return;
      }
      S.data = data;
      S.filters = { location:[], department:[], jobFamily:[], status:[], supervisor:[] };
      google.script.run
        .withSuccessHandler(function(notes) {
          S.notes = notes || [];
          buildFilterDropdowns();
          applyRoleToNav_();
          document.getElementById('loading').style.display = 'none';
          document.getElementById('app').style.display = '';
          renderTab(S.activeTab);
        })
        .withFailureHandler(function() { S.notes = []; renderTab(S.activeTab); })
        .getHRNotes(data.quarter);
    })
    .withFailureHandler(function(err) { showError(err.message); })
    .getGoalsComplianceData(q);
}
```

- [ ] **Step 4: Confirm no syntax errors** by opening the file in a browser preview.

- [ ] **Step 5: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): drive nav-menu visibility and manager-scope badge from userRole"
```

---

## Task 14 — Manual QA pass

There is no automated multi-account test harness for Apps Script `Session.getActiveUser()` — verify role resolution manually after deploying, the same way `PS Security.js` (which has no automated tests either) is validated.

**Files:** none (verification only)

- [ ] **Step 1: Deploy a test version** of the Apps Script project (Deploy → Test deployments) with the changes from Tasks 1–13.

- [ ] **Step 2: Verify default/open-access behavior** — open the web app URL as an account with no entry in `SEC_GD_.DEFAULT_ADMINS`/`DEFAULT_VIEWERS`/`DEFAULT_DELEGATES` and no direct reports in the Roster. Expected: dashboard loads normally (role = viewer via Open Access), no ☰ menu visible, no scope badge.

- [ ] **Step 3: Verify admin behavior** — temporarily add your own email to `SEC_GD_.DEFAULT_ADMINS` in `GD Security.js`, redeploy the test version, reload. Expected: ☰ menu visible in the header; clicking it shows "🔒 Access Control"; opening it loads the current admin/viewer/delegate lists and the Open Access toggle without errors.

- [ ] **Step 4: Verify manager auto-scoping** — find an email in the Roster that has ≥1 active direct report and is not an admin/viewer/delegate. Log in as that account (or run `Logger.log(JSON.stringify(checkDashboardAccess()))` in the Apps Script editor with a temporary override of `Session.getActiveUser` output, or ask that person to load the dashboard). Expected: `role: "manager"`, `delegateScopeName` equals their Roster name; the dashboard's Overview/Breakdown/At Risk/Engagement/HR Tracker tabs show only their org tree; the header shows the purple "Scoped: `<name>`'s team" badge; no ☰ menu.

- [ ] **Step 5: Verify Save Access Settings round-trips** — as an admin, add a test viewer email, click Save, confirm the "✓ Saved" flash and timestamp appear, then reload the Access Control pane and confirm the email persisted.

- [ ] **Step 6: Verify cache scoping** — as an admin, note the Overview KPI numbers. As a manager, confirm their Overview KPI numbers reflect only their team (not the admin's full-company numbers) — this confirms the `_admin` vs `_<email>` cache keys aren't cross-contaminating.

- [ ] **Step 7: Revert any temporary test entries** added to `SEC_GD_.DEFAULT_ADMINS` in Step 3 (unless you want to keep yourself as a permanent code-level admin, matching the `PS Security.js` pattern).

- [ ] **Step 8: Final commit** (only if Step 7 changed the file)

```bash
git add "D:/Contribution/GD Security.js"
git commit -m "chore(security): remove temporary QA admin entry from GD Security.js"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `2026-07-01-gd-security-layer-design.md` maps to a task — `GD Security.js` constants/role resolution (Task 1), settings editor (Task 2), denied page (Task 3), `resolveGDManagerScope_` (Task 4), `doGet`/`getGoalsComplianceData`/`buildComplianceData_`/`getHRNotes`/`saveHRNote`/`bustCache` wiring (Tasks 5–9), ☰ menu + Access Control UI + manager badge (Tasks 10–13).
- **Type/name consistency checked:** `checkDashboardAccess()` return shape (`allowed`, `role`, `email`, `delegateScopeName`) is used identically in Tasks 5–9 and matches Task 1's definition. `resolveGDManagerScope_(fullRosterMap, managerNorm)` signature and its plain-object "set" return value are used identically in Task 4's test, Task 7, and Task 8. Payload field names `userRole`/`userEmail`/`managerScopeName` (Task 7) match what Task 13's `applyRoleToNav_()` reads.
- **Out of scope (per spec):** the Auditor Tab feature itself, any changes to `PS Security.js`/`PS Contribution Report.js`.
