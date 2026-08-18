# All Rocketeers Tab — Design Spec
**Date:** 2026-07-02 (2026.W27)  **Files:** `goalCompliance.js` + `GDash.html`

## Background
The existing Goals Compliance Dashboard (`gdash/docs/specs/2026-06-25-goals-compliance-dashboard-design.md`)
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

## Intern Exclusion Refinement: Check Both Sources Independently

`stripInterns_` originally preferred the Roster Job Title and only fell back
to the map's own (RD-aggregated) Job Title when Roster had no match/blank
title. That's wrong: a title can show as Intern in one source before the
other has synced. Both sources must be checked independently:

```js
function stripInterns_(map, jobTitleMap) {
  Object.keys(map).forEach(function(norm) {
    var rosterJobTitle = jobTitleMap[norm] ? jobTitleMap[norm].jobTitle : '';
    var ownJobTitle     = map[norm].jobTitle;
    if (isIntern_(rosterJobTitle) || isIntern_(ownJobTitle)) delete map[norm];
  });
}
```
This lands directly in `stripInterns_` as originally planned (not implemented
yet) — no separate task, just the correct version from the start. Both
`buildComplianceData_` and `aggregateAllRocketeers_` call this same function,
so the fix applies everywhere automatically.

## Attrition Isolation: Excluded from Compliance Rate / Risk Math, Visible Separately

Terminated ("attrition") rocketeers currently flow all the way through
`buildComplianceData_` into the same `employees` array as everyone else —
they're tagged `terminated: true` but fully counted in every aggregate
(compliance rate, RPI/STF eligibility, engagement risk stats). A departure
mid-quarter shouldn't drag down the org's numbers, so they need the same
kind of removal interns get, with one difference: they still need to be
*visible* somewhere for HR reference.

**In `buildComplianceData_`**, immediately after `stripInterns_(rockMap, rosterMap)`:
```js
var attritionList = [];
Object.keys(rockMap).forEach(function(norm) {
  if (terminatedSet[norm]) { attritionList.push(rockMap[norm]); delete rockMap[norm]; }
});
```
- `rockMap` (and therefore the final `employees` array) becomes attrition-free
  in addition to intern-free — `computeSummary_` (compliance rate, RPI/STF
  counts, byDept/byLocation/byJobFamily/bySupervisor breakdowns) and
  `computeEngagementData_` (silent/below-pace counts, engagingPct, team rates,
  manager scorecard, engager list) all compute with zero attrition influence.
- **Tradeoff, stated explicitly rather than silently decided:** because
  `rockMap` feeds `computeCommentTrend_` too, attrition rocketeers' historical
  comments also drop out of the weekly comment-trend chart, not just the rate
  math. This keeps one exclusion boundary (matching how interns already work)
  instead of maintaining two different in/out rules for the same person. If
  the trend chart should keep their historical volume, that's a follow-up
  change to make `computeCommentTrend_` take an additional "trend-only"
  employee list — not built now, since it wasn't asked for.
- `attritionList` runs through the same per-employee finalize step as
  `employees` (job family, compliance tier via `computeStatus_`, RPI/STF
  flags) — computed and shown for informational context, never summed into
  `computeSummary_`'s org-wide totals. Only terminated rocketeers who *have*
  RD activity this quarter appear here — the existing decision not to
  zero-goal-inject terminated Roster rows is unchanged.
- `buildComplianceData_`'s return object gains an `attrition` field
  (finalized array, same shape as an `employees` entry).

**In `GDash.html`**, the At Risk pane (`pane-atrisk`) gets a new collapsed
section below the existing table: "Attrition (excluded from metrics above)",
rendering `S.data.attrition` in the same row shape as the main At Risk table,
visually distinguished (muted header) so it can't be mistaken for part of the
live count.

## Individual Engagement List Tab (new)

**Purpose:** an auditor tool — pick one rocketeer and see every goal they
logged this quarter with its full comment thread, split by IC (self) vs
Manager, instead of the summary counts every other tab shows.

**Backend — new `getRocketeerGoalDetail(quarter, normName)` in `goalCompliance.js`:**
- `checkDashboardAccess()` gated like every other endpoint; if the caller is
  a Manager, reject (return `{ok:false, denied:true}`-shaped response) when
  `normName` isn't in their `resolveGDManagerScope_` set.
- Reads the full RD sheet, filters to rows where `normName_(Rocketeer) === normName`
  (a small subset — no need to scan/derive quarters for the other ~thousands
  of rows), then derives that quarter locally using the same Start-Date rule
  as `buildComplianceData_` (goal-quarter-map built from just this person's
  rows, then filtered to the requested `quarter`).
- Groups the filtered rows by Goal ID. Each goal returns `{id, name, status,
  startDate, mood, comments: [...]}` where each comment is
  `{date, commentator, text, type}` sorted chronologically by date;
  `type` is `'self'` when `normName_(Commentator) === normName`, `'manager'`
  when it matches the rocketeer's Supervisor (normalized), else `'other'`.
- Not cached — this is a small, on-demand, per-person read (unlike the bulk
  company-wide endpoints), so a script lock/chunked cache isn't warranted.

**Frontend — new tab in `GDash.html`:**
- Tab button "Individual Engagement List", pane with a text input that
  filters a combined, already-loaded list — `S.data.employees.concat(S.data.attrition || [])`
  (interns never appear in either array, so they're excluded here too,
  automatically) — as the user types, matching names appear as a
  clickable list.
- Selecting a name calls `getRocketeerGoalDetail(S.data.quarter, normName)`
  and renders one card per goal (name/status/dates) with its comment thread
  underneath, each comment tagged IC or Manager (color/label distinguishes
  them), chronological.
- Scope: current quarter only (matches every tab except All Rocketeers);
  manager-role users can only search/select within their own org tree
  (enforced server-side in `getRocketeerGoalDetail`, not just hidden client-side).

## Out of scope
- No changes to `buildComplianceData_`'s quarter-derivation or name-matching
  logic — investigation confirmed there's nothing to fix there.
- No Roster-based enrichment (Location) on the All Rocketeers tab's rows —
  RD-only by design, per the "mirror the test script" goal. (Its intern
  exclusion still uses `fullRosterMap` for the Job Title check only, same as
  everywhere else.)
- No change to the zero-goal Roster-injection rule for terminated employees
  (still not injected) — only where already-present terminated records end up
  (isolated `attrition` list vs. the main array) changes.
- No caching for `getRocketeerGoalDetail` — small on-demand per-person reads
  don't need it.
- No export/CSV for the All Rocketeers or Individual Engagement List tabs in
  this iteration.
