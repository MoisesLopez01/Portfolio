# 👁 View as — Super-admin impersonation of the report view — Design

**Date:** 2026-09-01 (2026.W36)
**Status:** Approved design, implemented in the same session
**Audience:** super admins (WFP) answering "what does this manager / director actually see?"
**Decision trail:** approach = server-side impersonation of the report payload only ·
entry point = ☰ menu picker · banner under the header + amber role badge ·
settings pages hidden while previewing · no URL form (can be added later).

---

## 1. Purpose

Access questions today are answered by reading `diagnosePSAccess()` logs or borrowing
someone's browser. A super admin should be able to pick a manager or director and see the
dashboard **exactly** as the server would build it for them: their role, org tree, team pin,
self-exclusion, and — when the roster would turn them away — the denial page with its real
reason.

The preview is **read-only by construction**: only `getPSReportData` honours the target.
Every settings endpoint keeps resolving the real caller, so nothing can be written as
someone else.

## 2. Backend

### 2.1 `resolveViewAsAccess_(callerAccess, viewAsEmail)` — PS Security.js

- Empty `viewAsEmail` → returns `callerAccess` unchanged (every existing caller is a no-op).
- Caller is not a super admin → **throws**. A plain Admin posting `viewAs` is an attempted
  privilege probe and must be loud in the log, never quietly ignored.
- Target equals the caller → returns `callerAccess` unchanged.
- Otherwise resolves the target through `_resolveAccessFor_(email)` — the same path the
  target's own login takes — and returns that verdict stamped with
  `viewAs: { email, name, role, allowed, reason, byEmail }`.

The caller's own `_SEC_ACCESS_MEMO_` is untouched; the roster memo is shared and email-agnostic.

### 2.2 `listViewAsTargets()` — PS Security.js, public endpoint

Super admin only (`checkDashboardAccess()` + `isSuperAdmin_`, throws otherwise).

Candidates = every active roster row with an email and ≥1 active direct report, plus every
email on the super / admin / org-admin / viewer / delegate lists, minus the caller. Each is
resolved once and returned as
`{ email, name, jobTitle, directReports, role, allowed, reason, scopeName, teamPin, source }`,
sorted by role rank (orgadmin, manager, admin, viewer, superadmin, denied) then name.

### 2.3 `getPSReportData(bustCache, teamKey, viewAs)` — PS Contribution Report.js

```
caller = checkDashboardAccess()          // real identity, gate as before
access = resolveViewAsAccess_(caller, viewAs)
```

Everything downstream (team pin, cache key, manager scope, self-exclusion) already keys off
`access`, so a manager target reads or builds the very cache entry that manager would.
Every denial return carries `viewAs: access.viewAs || null` so the frontend can render
"this person would be denied" inline instead of kicking the super admin to the denied page.

`applySelfExclusion_` stamps `meta.viewAs` on both the cache-hit and fresh-compute paths —
it is per-caller personalisation, which is exactly what that function exists for. The shared
cache entry stays impersonal.

## 3. Frontend — PS Dashboard.html

- `STATE.viewAs` (`null | { email, name }`) and `STATE.realRole` (the signed-in user's own
  role; `superadmin` whenever the payload carries `meta.viewAs`, since nobody else can get one).
  `isRealSuperAdmin_()` is the only test on it.
- Every `getPSReportData` call (`loadData`, background prefetch) passes `STATE.viewAs.email`.
- ☰ menu gains **👁 View as…** (real super admins only). It opens a modal picker fed by
  `listViewAsTargets()`, with a search box and rows grouped by resolved role.
- Entering/exiting view-as clears `STATE.teamData`, bumps the prefetch generation, restores
  the loading markup and reloads.
- A banner under the header names the target, their resolved role and scope, and offers
  **Exit preview**. The role badge switches to an amber "👁 Viewing as …" style.
- `VIEWS` entries for Scoring Weights and Access Control carry `hideInPreview: true`;
  `canSeeView_` hides them while previewing because they read settings as the real caller
  and would misrepresent what an org admin sees.
- `showAccessDenied_` in view-as mode shows a preview note plus Exit button above the copy
  the target would see.

## 4. Tests

`tests/access-tier-checks.js` §8: a plain admin's `viewAs` throws; a super admin viewing a
manager gets the manager's verdict with the `viewAs` stamp; viewing yourself is a no-op;
`applySelfExclusion_` stamps `meta.viewAs` and strips the target's own row.
Source invariants: `getPSReportData` routes through `resolveViewAsAccess_`; both frontend
call sites pass `STATE.viewAs`; weights/access carry `hideInPreview`.
`listViewAsTargets` is gated, so the callable-surface sweep passes without an allow-list entry.
