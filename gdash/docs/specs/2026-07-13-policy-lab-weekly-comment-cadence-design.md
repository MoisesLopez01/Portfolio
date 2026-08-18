# Policy Lab — Per-Rocketeer Weekly Comment Cadence & Silent/End-loaded/Steady Signal

**Date:** 2026-07-13 (2026.W29)
**Files:** `GDash.html` (frontend only)
**Backend / cache impact:** none — `weeklySelf` and per-goal data are already in the payload; no `goalCompliance.js` change, no `CACHE_VER` bump.
**Depends on:** existing Policy Calibration Lab (`renderPolicyLab`, `policyQuarters_`, `isBackloaded_`, `weekOfQuarterPct_`) — spec `2026-07-08-policy-calibration-lab-design.md`.

---

## Problem

The Policy Calibration Lab today shows comment cadence only in aggregate: the
"Where the comments land" chart plots the *average* % of comments per
week-of-quarter across the whole population. That answers "does the org
back-load?" but not the three operational questions a manager actually asks at
coaching time:

1. **Where do *this person's* comments land, week by week?**
2. **Who has no comments at all in their goals for the weeks so far?**
3. **Is anyone cramming all their comments into the end of the quarter?**

There is no per-individual weekly view anywhere in the dashboard. This spec adds
one, adapted from a supplied HTML sample (the "Comment behaviour" heatmap), and
folds its Silent/End-loaded/Steady taxonomy into the Lab's existing definitions
so there is a single meaning of "end-loaded".

## Goals

- A per-Rocketeer weekly grid: one row per person, one cell per week-of-quarter,
  cell shaded by that week's **self-comment** count; a zero-comment week renders
  as a dashed empty cell.
- A per-person behaviour signal — **Silent / End-loaded / Steady** — with the
  silent and end-loaded people surfaced (sorted to top, counted, outlined).
- Reuse the Lab's existing back-load definition and control; add exactly one new
  slider (max distinct comment weeks).
- Frontend-only, testable pure helper.

## Non-goals

- No manager-comment view (self-comments only, matching the rest of the Lab).
- No new backend field, payload change, or cache-version bump.
- No CSV export of the grid (v1). No historical/closed-quarter grid — the grid
  always shows the current in-progress quarter.
- No change to the existing FY chips, bucket heatmap, cadence chart, or the
  scope selector's behaviour for those sections.

---

## Design

### Placement & scope

A new card **"Who comments when — weekly cadence"** is inserted in the Policy Lab
pane immediately **after** the existing "Where the comments land" cadence chart
card and before the section's closing. It renders inside `renderPolicyLab()` via
a new `renderWeeklyCadence_()` call.

- **Quarter shown:** always the **current in-progress quarter** — the last entry
  produced by `policyQuarters_()` (`inProgress === true`). It ignores the scope
  selector (`#pl-scope`), which continues to drive the FY chips, bucket heatmap,
  and cadence chart unchanged. Rationale: a per-week grid needs one quarter's
  week list, and the coaching use-case is "who needs a 1:1 this quarter".
- **Header** states the quarter label and the elapsed window, e.g.
  `FY27Q1 · weeks 1–6 elapsed`.
- **Population:** eligible Rocketeers in the loaded payload —
  `totalGoals > 0` and not a new hire (`!isNewHire`, mirroring
  `renderPolicyBehaviors_`'s eligibility). Because the payload is already
  manager-scoped server-side, a manager sees only their team automatically.

### Weeks model (in-progress quarter)

Let `weeks` = the current quarter's ordered ISO week labels
(`S.data.trendWeeks`), and `weekOfQuarter` = `S.data.weeksElapsedSinceStart`
(clamped to `[1, weeks.length]`).

- Columns are `Wk 1 … Wk weeks.length`.
- A column at 1-based index `i` is **elapsed** when `i <= weekOfQuarter`,
  otherwise **future**.
- **Elapsed + count > 0** → shaded Orbe cell (intensity = existing ramp, scaled
  to the max cell value in the grid), tooltip `"<n> comments · <ISO week>"`.
- **Elapsed + count = 0** → dashed empty cell (`.zero`, the "no comment"
  marker).
- **Future** → neutral "not yet" cell (distinct muted style, no dashed border),
  and **excluded from all signal math**. Nobody is flagged for a week that has
  not happened.

### Per-person signal — `commentSignal_`

New pure helper (placed with the other Policy Lab pure helpers near
`isBackloaded_`):

```
commentSignal_(weeklySelf, weeks, weekOfQuarter, opts) -> { signal, total, distinct, backPct }
```

Where `opts = { maxDistinct, blPct, tailWeeks }`.

Computation, over the **elapsed** weeks only
(`elapsed = weeks.slice(0, weekOfQuarter)`):

- `total`    = Σ `weeklySelf[w]` for w in elapsed
- `distinct` = count of elapsed weeks with `weeklySelf[w] > 0`
- `backPct`  = share of `total` landing in the final `tailWeeks` **of the full
  quarter week list** — reuse the existing `isBackloaded_` tail definition
  (`weeks.slice(-tailWeeks)`), so "end-loaded" means the same thing here as in
  the bucket-behaviour section. (If none of those tail weeks are elapsed yet,
  `backPct` is 0 → no false End-loaded flags early in the quarter.)

Classification:

```
Silent     : total === 0 || distinct <= 1
End-loaded : backPct >= blPct && distinct <= maxDistinct   (evaluated only when not Silent)
Steady     : otherwise
```

`tailWeeks = 3` (existing Lab constant). `blPct` = existing back-load slider
(`#pl-bl`, as a fraction). `maxDistinct` = **new** slider `#pl-distinct`.

### Controls

Add one slider to the existing Policy Lab control row:

- **"Max distinct comment weeks"** — `#pl-distinct`, range 1–13, default 3, with
  a `#pl-distinct-v` value label. Registered in `onPolicyChange_`'s slider list
  so moving it re-renders the whole Lab (cheap; matches existing behaviour).

No other control changes. The existing back-load slider label may be left as-is;
its value now also drives the grid's End-loaded classification.

### Sorting, filtering, counts

- Rows sorted **worst-first**: Silent → End-loaded → Steady; ties broken by
  fewest `distinct`, then lowest `total`.
- **Filter chips** above the grid (same pattern as existing Lab filters):
  **All** / **Needs follow-up** (Silent + End-loaded) / **Silent only**.
  Selected chip state held in a module-level `PL_CADENCE_FILTER_` variable,
  re-rendered on click without recomputing signals.
- **Header counts:** `Silent — X` and `End-loaded — Y` shown in the card
  sub-line, computed over the full eligible pool (not the current filter).
- Flagged rows (Silent or End-loaded) get the June outline
  (`.rowflag`, ported from the sample) so they stand out at a glance.

### Drill

Clicking a row reuses the existing per-person drill path already wired in the
Lab's delegated click handler (`data-pl-cell` sibling pattern). Each row carries
`data-normname`; the delegated handler opens the standard per-goal detail for
that Rocketeer (same handler already used by other tabs — reuse, do not add a
new modal). If wiring the existing drill to a row proves to touch shared
handler code, fall back to a read-only expand showing the person's per-week
counts inline; the grid + signal is the core deliverable, the drill is
secondary.

### Styles

Port the minimal sample styles as `.plc-*`-namespaced classes co-located with
the existing Policy Lab CSS block, using brand tokens (`var(--orbe)`,
`var(--june)`, `var(--slate)`, status greens/ambers already defined) rather than
the sample's raw hexes:

- `.plc-cell` (shaded / `.zero` dashed / `.future` muted)
- `.plc-sig` chips: Silent (Void bg), End-loaded (June bg), Steady (Orbe-soft)
- `.plc-rowflag` outline
- Filter chips reuse existing Lab chip classes if present; otherwise a small
  `.plc-fbtn` set.

Grid wrapped in the existing `.tbl-wrap` (horizontal scroll) so ~13 columns +
metadata never break the page layout.

---

## Data flow

```
S.data (already loaded)
  ├─ trendWeeks .................. current quarter ISO week labels  → columns
  ├─ weeksElapsedSinceStart ..... weekOfQuarter                     → elapsed cutoff
  └─ employees[]
       ├─ weeklySelf {iso→count}  → cell values + signal input
       ├─ totalGoals, isNewHire   → eligibility
       ├─ name, normName          → row label + drill key
       └─ supervisor              → (unused in grid v1)

renderPolicyLab()
  └─ renderWeeklyCadence_()
       ├─ build elapsed weeks + maxCell
       ├─ per person: commentSignal_(weeklySelf, weeks, weekOfQuarter, opts)
       ├─ sort worst-first, apply PL_CADENCE_FILTER_
       └─ emit grid + counts + chips
```

## Testing

Pure-helper unit tests via the Lab's existing script-extract Node harness (the
one used for `bucketOf_`/`compliesAtPolicy_`), covering `commentSignal_`:

1. **Silent (no comments):** empty `weeklySelf` → `signal: 'Silent'`, `total 0`,
   `distinct 0`.
2. **Silent (one week only):** comments in a single week → `distinct 1` →
   `Silent`.
3. **Steady:** comments spread across many weeks, low back-load → `Steady`.
4. **End-loaded:** most comments in the final 3 quarter weeks, `distinct <=
   maxDistinct` → `End-loaded`.
5. **Not end-loaded when spread:** high back-load but `distinct > maxDistinct`
   → `Steady` (distinct guard works).
6. **Future weeks excluded:** comments only in not-yet-elapsed weeks are ignored
   → treated per elapsed window (early quarter → `Silent`, no false
   End-loaded).

Frontend has no harness; the `<script>` block is parse-checked with
`new Function(js)` as usual after edits.

## Rollout

Frontend-only. Copy `GDash.html` into the GAS project and publish a new
deployment version. No `goalCompliance.js` change, no `CACHE_VER` bump, no sheet
change. Browser QA: grid renders for the current quarter, dashed cells on
zero-comment weeks, future weeks muted, Silent people at top, End-loaded flags
appear only once tail weeks are elapsed, new slider re-renders, filter chips
work, PNG export of the card is legible.
