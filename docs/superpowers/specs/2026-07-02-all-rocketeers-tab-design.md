# All Rocketeers Tab — Design Spec
**Date:** 2026-07-02 (2026.W27)  **Files:** `goalCompliance.js` + `GDash.html`

## Background
The existing Goals Compliance Dashboard (`docs/superpowers/specs/2026-06-25-goals-compliance-dashboard-design.md`)
is quarter-scoped: `buildComplianceData_` only aggregates RD rows whose derived
quarter matches the one selected. That's correct for "who's on track this
quarter," but there's no view of every Rocketeer who has ever logged a goal,
grouped by manager, independent of quarter — useful for a raw completeness
review of the RD dataset.

Investigation ruled out the three ways this could be a real data-loss bug:
- **Quarter derivation is solid.** `Start Date` is a required field on every
  goal, and the FY calendar (Jul 1 → Jun 30) always maps a Start Date to
  exactly one quarter via `dateToFiscalQuarter_` — there is no "unknown
  quarter" case.
- **Roster-inactive + zero-goal exclusion is intentional**, not a bug — a
  terminated person with no RD activity that quarter isn't relevant to a
  "this quarter" compliance view. Left as-is.
- **RD-to-Roster name mismatches aren't a real concern** — both sheets source
  from the same NetSuite export and names have already been cleaned to match.

So this is a pure new-feature addition, not a fix to the existing view.

## Feature: All Rocketeers Tab

**Purpose:** Show every unique Rocketeer that has ever appeared in the RD
sheet, grouped by their RD `Supervisor` column, across all quarters combined —
a completeness/review tool, separate from the quarter-scoped compliance tabs.

### Backend — `getAllRocketeersData()` (new, in `goalCompliance.js`)

- Access-gated the same way as `getGoalsComplianceData` (`checkDashboardAccess()`).
- Reads the full RD sheet (`readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD)`)
  and does a **single pass over every row, all quarters** — no
  `deriveRowQuarter_` filtering. Algorithmically the same shape as
  `aggregateByRocketeer_`, generalized to skip the quarter gate.
- Groups by RD's own `Supervisor` field directly (blank/whitespace →
  `"Unassigned"`) — one level, not a Roster org-tree BFS. Mirrors the
  reference test script's approach exactly.
- Per rocketeer, tracked from RD alone (no Roster join for display fields):
  - `name`, `normName`
  - `department`, `jobTitle` — taken from the row with the latest `Start Date`
    seen for that rocketeer (reflects their most recent assignment)
  - `totalGoals` — count of unique Goal IDs, all-time
  - `firstQuarter` / `lastQuarter` — min/max of `dateToFiscalQuarter_(Start Date)`
    across their goals (safe string min/max: `FYnnQn` sorts correctly since
    the year is always zero-padded to 2 digits)
- **Manager-role scoping** reuses the existing `resolveGDManagerScope_()` +
  `getFullRosterMap_()` — Roster is read *only* to compute which normNames a
  manager is allowed to see (same access boundary as the compliance view),
  never to enrich the displayed row data. Admins/viewers get no restriction.
- **Caching:** same chunked-cache + script-lock pattern as
  `getGoalsComplianceData`. Cache key: `CONFIG_GD.CACHE_VER + 'allrock_' + scopeKey`
  (`scopeKey` = `'admin'` for admin/viewer, caller's email for manager — same
  scoping rationale as the existing cache key). TTL: `CONFIG_GD.CACHE_TTL` (5 min).
- `bustCache(quarter)` is extended to also remove the `allrock_` cache entries
  (admin + caller scope) so the existing Refresh button invalidates both views
  in one call.

**Return shape:**
```js
{
  ok: true,
  managers: [
    {
      supervisor: "Jane Doe",
      normSupervisor: "jane doe",
      teamSize: 12,
      rocketeers: [
        { name, normName, department, jobTitle, totalGoals, firstQuarter, lastQuarter }
      ]
    },
    // ...
  ],
  totalRocketeers: N,
  generatedAt: "<iso timestamp>",
  userRole, userEmail, managerScopeName   // overlaid live, same pattern as getGoalsComplianceData
}
```
Manager groups sorted by `supervisor` name (A→Z); rocketeers within a group
sorted by `name` (A→Z).

### Frontend — new tab in `GDash.html`

- New button in the main tab bar: **"All Rocketeers"**
  (`switchTab('allrockets')`, pane `pane-allrockets`), wired into the existing
  `switchTab`/`renderTab` dispatch alongside Overview/Engagement/Breakdown/At
  Risk/HR Tracker.
- **Lazy-loaded**: not part of the initial `loadData()` call. First switch to
  this tab calls `google.script.run.getAllRocketeersData()`, result cached in
  client state (`S.allRocketeersData`). Subsequent tab switches reuse the
  cached client state; the existing Refresh action (`loadData(true)`) also
  clears `S.allRocketeersData` and re-fetches on next visit.
- **Layout:** a text filter input above the list (filters by manager or
  rocketeer name, case-insensitive; auto-expands groups with a match — with
  100+ managers a flat scroll isn't usable without this). Below it, one
  collapsible section per manager: header row "▸ {Supervisor} ({teamSize})",
  expanding to a table with columns Rocketeer, Department, Job Title, Total
  Goals, First Quarter, Last Quarter.
- No export/CSV for this tab in this iteration (not requested; can be added
  later following the same `html2canvas`/Blob pattern used elsewhere).

## Out of scope
- No changes to `buildComplianceData_`, `aggregateByRocketeer_`, or any
  quarter-scoped logic — investigation confirmed there's nothing to fix there.
- No Roster-based enrichment (Location, active/terminated tag) on this tab's
  rows — RD-only by design, per the "mirror the test script" goal.
- No drill-down into individual goal/comment detail per rocketeer on this tab
  (that already exists in the quarter-scoped views).
