# GD Security Layer — Design Spec
**Date:** 2026-07-01 (2026.W27)
**Files:** New `GD Security.js` + changes to `goalCompliance.js` + `GDash.html`
**Project:** Goals Compliance Dashboard (independent GAS project, own spreadsheet — not the PS Contribution Report project)
**Precedes:** Auditor Tab design (separate spec, depends on this scoping model)

---

## Summary

`goalCompliance.js`/`GDash.html` currently has **no access control at all** — `doGet()` serves the dashboard to anyone with the link, and every rocketeer's goals/comments are visible to everyone. This spec ports the proven role model from `PS Security.js` (admin / viewer / manager / denied) into a new, fully independent `GD Security.js` file, and wires manager auto-scoping into `buildComplianceData_` so managers only see their own org tree while admins/viewers keep seeing everything. This lands ahead of the upcoming Auditor Tab feature, which needs a caller-scope check to avoid letting a manager pull comments for people outside their team.

---

## Why a new, independent file

`goalCompliance.js` is a separate GAS project (own spreadsheet ID, own `doGet()`) from `PS Contribution Report.js`. Even though both are mirrored in this git repo, they run as separate Apps Script deployments with no shared runtime. `GD Security.js` therefore duplicates the *pattern* from `PS Security.js` but not the code or constants — own `SEC_GD_` object, own Script Property keys, own bootstrap admin, own Roster read logic. This keeps the two projects fully decoupled, consistent with how `CONFIG_GD` already parallels `CONFIG_PS` without sharing state.

---

## `GD Security.js`

### Constants

```js
const SEC_GD_ = {
  PROP_ADMINS:      "GD_DASH_ADMINS",
  PROP_VIEWERS:     "GD_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "GD_DASH_OPEN_ACCESS",
  PROP_DELEGATES:   "GD_DASH_DELEGATES",

  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",  // always admin, cannot be removed via UI

  DEFAULT_ADMINS:   [],   // permanent admins, survive a Script Properties reset
  DEFAULT_VIEWERS:  [],   // permanent read-only access
  DEFAULT_DELEGATES: [],  // [{ email, scopeName }] — manager access for non-roster-supervisors

  OPEN_ACCESS_DEFAULT: true,  // preserves today's "anyone can view" behavior
};
```

### `_resolveRosterSupervisor_GD_(email)`

Reads the Roster sheet (`PropertiesService.getScriptProperties().getProperty("ROSTER_SS_ID") || CONFIG_GD.ROSTER_SS_ID`, same override pattern as `CONFIG_GD`). Finds the roster row matching `email`, then checks whether any other active row lists that person's Name as `Supervisor`.

**Difference from `PS Security.js`:** no `Class === "Professional Services"` / `Department === "Services"` restriction — any active roster row with ≥1 active direct report qualifies, matching this dashboard's company-wide scope.

Active-row detection reuses the same status/termination-column auto-detect logic already present in `goalCompliance.js`'s `getFullRosterMap_()` (case-insensitive header matching for `employeestatus`/`status`/etc., plus a termination-date column), re-implemented locally in this file to keep it self-contained — no cross-file calls, matching `PS Security.js`'s independence from `PS Contribution Report.js`.

### `checkDashboardAccess()`

Identical resolution order to `PS Security.js`:

```
1. email in admins?              → role: "admin"
2. email in viewers?             → role: "viewer"
3. explicit delegate?            → role: "manager", delegateScopeName: <scopeName>
4. active roster supervisor?     → role: "manager", delegateScopeName: <own name>
5. openAccess (default true)?    → role: "viewer"
6. else                          → role: "denied"
```

### `getAccessSettings()` / `saveAccessSettings()`

Same shape as `PS Security.js` — admin-only, read/write the `GD_DASH_*` Script Properties, return/accept `{ admins, viewers, delegates, openAccess }`.

### `buildAccessDeniedPage_GD_(email)`

Same minimal lock-screen HTML as `PS Security.js`'s `buildAccessDeniedPage_`, goalCompliance-branded copy.

---

## Manager org-tree scoping

### `resolveGDManagerScope_(fullRosterMap, managerNorm)`

Ported from `resolveManagerScope_` in `PS Contribution Report.js` — BFS over the `Supervisor` field:

```js
function resolveGDManagerScope_(fullRosterMap, managerNorm) {
  var scope = new Set([managerNorm]);
  var queue = [managerNorm];
  while (queue.length > 0) {
    var supNorm = queue.shift();
    Object.keys(fullRosterMap).forEach(function(norm) {
      if (!scope.has(norm) && normName_(fullRosterMap[norm].supervisor) === supNorm) {
        scope.add(norm);
        queue.push(norm);
      }
    });
  }
  return scope;
}
```

Operates on the `fullRosterMap` already built in `buildComplianceData_` (line ~233) — no extra Roster read.

---

## Wiring into `goalCompliance.js`

### `doGet()`
Gate on `checkDashboardAccess()`; if denied, return `HtmlService.createHtmlOutput(buildAccessDeniedPage_GD_(access.email))`. With `OPEN_ACCESS_DEFAULT = true` this branch only fires once an admin turns Open Access off.

### `getGoalsComplianceData(quarter)`
```js
function getGoalsComplianceData(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  var qtr = String(quarter || CONFIG_GD.DEFAULT_QUARTER).trim();
  var scopeKey = (access.role === 'admin' || access.role === 'viewer') ? 'admin' : access.email;
  var cacheKey = CONFIG_GD.CACHE_VER + qtr + '_' + scopeKey;
  // ...cache read unchanged, then:
  var result = buildComplianceData_(qtr, access);
  // ...cache write unchanged
}
```

**Cache-key fix:** today's cache key is `CACHE_VER + qtr` only — a real bug once scoping exists, since one manager's filtered payload would otherwise be served to a different manager or to an admin requesting the same quarter. Fixed to mirror `PS Contribution Report.js`'s `ps_v<VER>_admin` / `ps_v<VER>_<email>` split.

### `buildComplianceData_(quarter, access)`
After `fullRosterMap` is built (~line 233): if `access.role === 'manager'`, compute `var scope = resolveGDManagerScope_(fullRosterMap, normName_(access.delegateScopeName))` and intersect `activeSet` with `scope` before it's used to filter `aggregateByRocketeer_` and the zero-goal-employee injection. Every downstream consumer (`computeCommentTrend_`, `computeEngagementData_`, `computeSummary_`) derives from the already-scoped `employees` array, so Overview, Engagement, Breakdown, and At Risk are automatically scoped with no per-tab changes.

Return payload gains three fields:
```js
{
  userRole:         access.role,
  userEmail:        access.email,
  managerScopeName: access.role === 'manager' ? access.delegateScopeName : null,
  // ...existing fields unchanged
}
```

### `getHRNotes(quarter)`
Gate with `checkDashboardAccess()`. When `role === 'manager'`, additionally filter rows to `normName` values inside `resolveGDManagerScope_(getFullRosterMap_(), normName_(access.delegateScopeName))` — a manager should not see HR follow-up notes about people outside their team.

### `saveHRNote(data)` / `bustCache(quarter)`
Both start with `var access = checkDashboardAccess(); if (!access.allowed) return { ok: false, error: 'Access denied' };` — every RPC entry point is gated independently, not just `doGet` (GAS `google.script.run` calls bypass `doGet` entirely).

### Cache version bump
`CONFIG_GD.CACHE_VER` bumped (e.g. `'gd_v8_'`) since the payload shape changes (new `userRole`/`userEmail`/`managerScopeName` fields) and the cache-key scheme changes.

---

## Frontend (`GDash.html`)

### ☰ menu (new)
GDash.html's nav today is a flat row of tab buttons only. Add a small ☰ button in the header. Its one item: **🔒 Access Control**. Rendered only when `S.data.userRole === 'admin'` — hidden entirely for viewers and managers, not just disabled.

### Access Control page
New pane, opened via the ☰ menu, closable back to the last regular tab (same open/close pattern as `PS Dashboard.html`'s menu tabs). Contents, adapted from `PS Dashboard.html`'s existing Access Control page:
- Admins list (textarea or tag list, one email per line)
- Viewers list (same)
- Delegates list (`email:Supervisor Full Name` pairs, one per line)
- Open Access checkbox
- Save button → `google.script.run.saveAccessSettings(settings)`

Loaded via `google.script.run.getAccessSettings()` when opened (admin-only server call — throws for non-admins, matching `PS Security.js`).

### Manager scope indicator
When `S.data.userRole === 'manager'`, show a small badge/label near the header (e.g. "Scoped to: `<managerScopeName>`'s team") so managers understand they're seeing a filtered view, not the full company.

---

## Out of Scope

- The Auditor Tab itself (separate spec, next brainstorming pass) — this spec only delivers the role model and scoping primitives it will call into.
- No changes to `PS Security.js` or `PS Contribution Report.js` — fully independent projects.
- No changes to `INACTIVE_STATUSES` / intern-exclusion logic already in `goalCompliance.js`.
