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

A real regression *was* found, though: `CONFIG_GD.CACHE_VER` history
(`'gd_v12_'`) shows that v12 bundled two unrelated changes together — turning
terminated-employee exclusion into a `terminated` tag (intentional), and
*removing intern exclusion entirely* (unintentional side effect). Interns
aren't required to log goals, aren't evaluated on this cadence, and don't
qualify for STF — they need to be filtered out again, everywhere in this
dashboard, and never counted toward compliance rate/STF/RPI eligibility.

## Bug Fix: Reinstate Intern Exclusion

**New helper**, `isIntern_(jobTitle)` in `goalCompliance.js`, matching the
existing convention in `PS Contribution Report.js:1751`
(`title.includes("intern")`) rather than a hardcoded title list — this covers
all 7 titles supplied (`Intern, Professional Services` / `Managed Services` /
`Operations` / `Marketing` / `Engineering` / `Technical Content` / `Product
Marketing`) plus any other `Intern, …` or `Intern <Role>, …` title already
present in the company catalog (e.g. `Intern Engineer, Service Delivery`),
without needing a manual update every time a new intern title is added:
```js
function isIntern_(jobTitle) { return /intern/i.test(jobTitle || ''); }
```

**Where it's applied, in `buildComplianceData_`:**
- Immediately after `aggregateByRocketeer_` builds `rockMap` (step 3): for
  each rocketeer, resolve `jobTitle` preferring the Roster's value
  (`rosterMap[norm].jobTitle`, authoritative — same NetSuite source, always
  populated) and falling back to the RD-aggregated `jobTitle` (fully filled in
  by that point) only when there's no Roster match. Delete the entry from
  `rockMap` if `isIntern_(jobTitle)` is true — this must happen *before* the
  zero-goal Roster injection step and *before* `computeCommentTrend_`, so
  intern comments don't leak into weekly comment-trend totals either.
- The zero-goal Roster injection loop (step 3b) also skips `isIntern_(r.jobTitle)`
  roster rows — an intern with zero goals must not get injected as a
  compliance record either.
- `CONFIG_GD.CACHE_VER` bumps to `'gd_v13_'` (per this project's own
  convention — see the `v12` comment) since this changes every cached
  payload's employee set.

**Stale comments to correct while in this code** (found during investigation,
not new behavior changes): the `getFullRosterMap_` log line says "non-intern
roster rows" even though that function never filtered interns — it's pure
enrichment, so the wording is just misleading; and the step-3 comment in
`buildComplianceData_` currently says "interns and terminated employees
included," which will no longer be true for interns.

This exclusion is orthogonal to the manager org-tree scope check — an intern
is removed regardless of role/scope, the same way a real filter behaves
elsewhere in this file.

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
- Applies the same `isIntern_(jobTitle)` exclusion as the compliance view
  (Roster jobTitle preferred, RD-aggregated jobTitle as fallback) — interns
  are excluded from every view in this dashboard, not just compliance-rate
  math.
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
- No changes to `buildComplianceData_`'s quarter-derivation, roster-inactive
  zero-goal exclusion, or name-matching logic — investigation confirmed
  there's nothing to fix there. (The only change to `buildComplianceData_` is
  the intern-exclusion bug fix above.)
- No Roster-based enrichment (Location, active/terminated tag) on the All
  Rocketeers tab's rows — RD-only by design, per the "mirror the test script"
  goal.
- No drill-down into individual goal/comment detail per rocketeer on this tab
  (that already exists in the quarter-scoped views).
