# Project Demand — Evidence of Work (Billing + Epic enrichment)

**Date:** 2026-07-12 (2026.W28)
**Status:** Design approved — ready for implementation planning
**Component:** Project Demand Dashboard (`project-demand-dashboard/`)
**Author:** Alex Lopez / Moises Lopez

---

## Problem

The Project Demand Dashboard shows tracked hours per project and a Planned-vs-Tracked
overlay, but it cannot answer *what the work was* or *whether it was billable*. It knows
"person X logged 40h on project COE455 in W26" — not which issues those hours went to,
whether any carry an `SRSO-*` Fix Version (billable / FixedPrice), or which Epic they roll
up to.

The evidence needed to answer those questions already exists in the same spreadsheet, in
the `Jira Raw` sheet produced by `Jira Backlog.js` (`Key`, `Assignee`, `Fix Versions`,
`Epic Key`, `Status`). The gap is purely that nothing joins it to the tracked hours.

## Goal

Enrich the dashboard's tracked-time view with **billing classification** (Billable vs
Internal), **epic lineage**, and **issue-level evidence of work**, by joining tracked
hours to Jira issue metadata at read time — no changes to the data exporters.

## Non-goals

- No changes to `TempoTrackedTime.js` or `Jira Backlog.js`. The exporters stay as-is.
- No new spreadsheet, no new auth scope (see Data sources).
- No billing dimension on **planned** demand — planned time has no issue/Fix Version, so
  billing signals apply to **tracked**-derived views only.
- Not rebuilding the Tempo export to carry Fix Version at source (that is a separate,
  already-approved project — see "Future hook").

---

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Enrichment source | **Dashboard-side join** against `Jira Raw` at read time (not enrich-at-source) |
| Scope | All four capabilities (billing split, epic rollup, issue evidence, billable ratio) |
| Sequencing | **Foundation first** — Phase 1 = join + billing split + ratio on existing panels; Phase 2 = epic rollup + evidence drill-down |
| Join key | **Issue Key only** (Fix Version / Epic / Status are issue-level, invariant across week & assignee) |
| Ratio denominator | Billable ÷ (Billable + Internal) — **classified hours only**; coverage% shown separately |
| Epic name | Enriched **opportunistically** from the epic issue's own Jira Raw row (`Summary`) if present; bare key otherwise |
| Jira Raw location | Same spreadsheet as planned + tracked (`SOURCE_SS_ID`) — already opened by the dashboard |

---

## Data sources

All three sheets live in the **same** spreadsheet the dashboard already opens,
`SOURCE_SS_ID = 1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`:

| Sheet | Produced by | Used here for |
|---|---|---|
| `Planned Time Tempo` | `TempoPlanExport.js` | (unchanged) planned demand |
| `Tempo Tracked Time` | `TempoTrackedTime.js` | tracked hours + **`Issue`** join key |
| `Jira Raw` | `Jira Backlog.js` | issue metadata: Fix Versions, Epic Key, Status, Summary |

**`Tempo Tracked Time` columns** (row 2 header): `User, Space, Key, Issue, Summary,
Logged (hrs)`, then per-week hour columns, then `Total (hrs)`. Here **`Key` = project**
(e.g. `COE455`, `HBHP`) and **`Issue` = issue key** (e.g. `SRSO-123`, `COE-456`). The
`Issue` value is the join key.

**`Jira Raw` columns** (index-locked, per `Jira Backlog.js` `RAW_HEADERS`): the join reads
`Key` (col 1 = issue key), `Assignee` (col 5), `Status` (col 8), `Fix Versions` (col 14),
`Epic Key` (col 17). It reads only **columns 1–18** and skips `Comments (ADF Extracted)`
(col 26), which can be very large and is never needed.

**Coverage caveat:** `Jira Raw` holds completed/active issues within `Jira Backlog.js`'s
fetch window. Any issue logged against but outside that window will not match — those hours
become **Unclassified** (see Edge cases). Coverage% makes the size of that gap visible.

---

## Architecture — the join (data layer)

Everything runs inside `buildDemandModel_()` in `Code.js` (the cached compute path shared
by `getDemandData()` and `warmDemandCache()`).

### 1. `readJiraMeta_()` — new reader

Opens `SOURCE_SS_ID`, reads `Jira Raw` columns 1–18, and returns a lookup map keyed by
**uppercased, trimmed** issue key:

```js
{ "COE-456": { fixVersions: "SRSO-4455, 2026.Q3", epicKey: "COE-100", status: "Done" }, ... }
```

- If an issue appears in multiple weekly snapshots, **last-write-wins** (metadata is
  issue-level and identical across weeks).
- Also builds an epic-name side map opportunistically: if an issue's `Key` equals some
  `Epic Key` seen elsewhere, its `Summary` is that epic's name → `{ epicKey: epicName }`.
- Missing / unreadable `Jira Raw` → returns `{ map: {}, epicNames: {}, available: false }`
  (fail-soft; see Edge cases).

### 2. `parseAllocations_` — extended (shared parser, must stay safe)

Currently reads only the project `Key` column. Extend it to **also capture the `Issue`
column when a header named `issue` exists**. The planned sheet has no such column, so this
is a no-op there and planned parsing is byte-for-byte unchanged. Tracked records gain an
`issue` field:

```js
{ person, iso, key /* project */, name, hours, issue /* "" if column absent */ }
```

### 3. `enrichTracked_(recs, jiraMeta)` — new pass

For each tracked rec, look up `rec.issue` (uppercased) in the map and attach:

- `billingType`: `"Billable"` if any Fix Version token matches `/^SRSO-/i`, else
  `"Internal"`. **No match in the map** (or blank issue) → `"Unclassified"`.
- `epicKey` (or `""` → grouped under "(no epic)").
- `status`.

Classification rule mirrors the approved Tracked Time Billing Enhancement: an `SRSO-*` Fix
Version = FixedPrice / billable.

---

## Data contract (model additions)

All additive. Existing payload fields are untouched.

### Phase 1

| Field | Shape | Purpose |
|---|---|---|
| `billingByWeek` | `{ iso: { billable, internal, unclassified } }` | org tracked hours split by billing type per week |
| `billableRatioByWeek` | `{ iso: ratio }` | ratio = billable ÷ (billable + internal) — **classified only** |
| `projectBillingWindow` | `{ projectKey: { billable, internal, unclassified } }` | window totals for heatmap/ranked coloring & filter |
| `coverage` | `{ matchedHrs, unclassifiedHrs, matchRate }` | data-quality: how much tracked time matched a Jira issue |

### Phase 2

| Field | Shape | Purpose |
|---|---|---|
| `trackedIssues` | `[ { issue, projectKey, person, iso, hours, billingType, epicKey, status, summary } ]` | compact enriched issue-level array; client pivots for epic rollup, evidence drill-down, per-person billing |

`trackedIssues` is guarded to issues with `hours > 0` in the window and rides the existing
gzip-chunk cache. Client-side pivoting mirrors how the dashboard already derives views from
`emp.weeks[].projects[]`.

---

## Dashboard components

### Phase 1 — on existing panels

- **Billing filter chips** — `All · Billable · Internal · Unclassified`, labeled **"Tracked
  billing"** to make explicit they affect **tracked-derived views only** (Planned-vs-Tracked
  overlay, tracked totals, per-person tracked). Planned/capacity figures are untouched.
- **Billable-ratio stat** — small tile on the Planned-vs-Tracked panel header, e.g.
  *"Billable 72% of classified tracked hrs · coverage 88%."* Chart-area text is
  counts/percentages only; names & issues live in drill-downs.
- **Tracked series split** — the tracked area/line in the 8-week trend stacks **billable vs
  internal**, with the breakdown in the hover tooltip. Unclassified appears as a muted third
  band only when > 0.

### Phase 2 — new surfaces (capability defined here; pixel layout decided at build time)

- **"Delivery by Epic" panel** — collapsible table:
  `Epic (key + name) · Project · Fix Versions · Billing · Tracked hrs · Contributors
  (count, names on hover)`. Sorted by hours, respects billing chips + week window, own
  ⬇ Save PNG.
- **Issue-level evidence drill-down** — expandable rows on existing click targets (a project
  row in heatmap/ranked, an epic row in the rollup, a person in Team Availability): expands
  to `Issue · Summary · Status · Billing · hours`. This is the "evidence of work" — the
  correct place for individual names & issues per the counts-in-charts / detail-in-rows
  convention.

All components keep existing conventions: per-panel ⬇ Save PNG, a *so-what* line per panel,
forced light theme on PNG export.

---

## Edge cases & error handling

| Case | Behavior |
|---|---|
| `Jira Raw` missing / unreadable | Join disabled: all tracked hours → `Unclassified`, `coverage.matchRate = 0`, small "Jira Raw not found — billing signals off" note; **every other panel unaffected** (same fail-soft as the PH holiday tab) |
| Issue logged but not in Jira Raw window | `Unclassified` (expected, not an error); coverage% makes the gap visible |
| Blank / malformed Fix Versions | Treated as `Internal` (no SRSO match) |
| Blank Epic Key | Issue still appears in rollup under "(no epic)" |
| Issue key casing / whitespace | Normalized (uppercase + trim) on both sides |
| Planned sheet has no `Issue` column | Extended `parseAllocations_` skips it; planned parsing byte-for-byte unchanged |
| `trackedIssues` payload size (Phase 2) | Guarded to > 0-hour in-window issues; if it ever nears cache limits, log a cap notice — **no silent truncation** |

---

## Testing

Extend the existing Node runner `node-tests.js` (pure `_test_` functions, not pasted into
GAS):

- `_test_jiraMetaParse_` — Jira Raw rows → map: SRSO detection, epic-name pickup,
  duplicate-week last-write-wins, casing/whitespace normalization.
- `_test_enrichTracked_` — billable / internal / unclassified classification + ratio math
  (classified-only denominator).
- `_test_billingAggregation_` — `billingByWeek` / `projectBillingWindow` / `coverage`
  reconcile exactly to raw tracked totals (no hours lost or double-counted).

---

## Deploy (owner, manual)

1. Paste updated `Code.js` (+ `Dashboard.html` for Phase 1 UI).
2. Run the `_test_` suite in the editor; confirm each logs `✅ … passed`.
3. Model shape changed → run `bustDemandCache_()` once (or bump `PD_CACHE_VER`) so the stale
   cache doesn't hide the new fields until TTL.
4. **No new auth scope** — `Jira Raw` is in the already-opened `SOURCE_SS_ID`.
5. Redeploy; press ↻ Refresh once to confirm the fresh payload; check billable ratio +
   coverage render.

---

## Future hook (not in scope)

If the approved **Tracked Time Billing Enhancement** ships its Fix Version column onto the
`Tempo Tracked Time` sheet, that column becomes a natural **fallback** that closes the
Unclassified gap: the dashboard could prefer the sheet's own Fix Version and fall back to
the Jira Raw join. Design the enrichment so this is a clean later addition, but do not build
it now.

---

## Phasing summary

- **Phase 1 (foundation):** `readJiraMeta_` + `parseAllocations_` Issue capture +
  `enrichTracked_` + Phase 1 model fields + billing chips, ratio stat, tracked split on
  existing panels + the three `_test_` suites.
- **Phase 2 (fast-follow):** `trackedIssues` payload + Delivery-by-Epic panel + issue-level
  evidence drill-down.
