# Utilization Panel — Decision-Grade Redesign

**Date:** 2026-07-16 (2026.W29)
**File:** `project-demand-dashboard/Dashboard.html` (client-only — no Code.js change, no `bustDemandCache_`)
**Replaces:** the current Utilization panel (`#utilPanel`, `renderUtilization()` and the UTIL-PURE math block)

## Problem

The old chart answered two questions with one line and mixed a live week into settled
history. The headline penalised the department for people who have capacity but no
tracking mandate, gave no way to tell a planning problem from an execution problem,
plotted the in-progress week as if it were final, and offered no way to know whether a
weekly wobble is signal or noise. Three audiences read it and none could act on it.

## Audiences and what each takes away

- **CEO:** headline utilization, gap to target in capacity hours, trend vs the normal band
  ("stable or slipping").
- **Ops managers:** the coverage × fidelity split and the segment-contribution drill —
  chase planning, tracking discipline, or real demand.
- **Project managers:** fidelity plus the provisional/projected flags — is planned work
  actually being logged, and is this week real yet.

## Decisions (settled during brainstorming)

1. **Approach A — client-only rebuild.** All inputs already ship to the browser
   (`DATA.personWeekCapacity`, `DATA.personWeekTracked`, `DATA.personWeekPlan`,
   `DATA.personMeta`). All new math lives in the node-tested `UTIL-PURE` block.
2. **Population = job-family allowlist** (CONFIG constant, not sheet- or server-driven).
3. **Header = Option B**: one big number + inline identity sentence (chosen over a KPI
   tile trio in the visual companion).
4. **No dollars.** Billing is project-level; there is no meaningful blended hourly rate.
   The target gap is expressed in capacity **hours only**. No rate constant exists.
5. **Projection = elapsed-workday linear** with a ±2σ band (no learned weekday curve —
   that would require day-grain columns in the TempoTrackedTime export).
6. **Population switches are panel-local chips**, not global filters.

## CONFIG constants (client, next to `OVER_PLAN_FACTOR`)

```js
var UTIL_TRACKING_FAMILIES = [
  "Managed Services & Support",  // JF007 display name from ACTIVE_FAMILY_NAMES_
  "Service Delivery",            // JF009
  "Professional Services",       // defensive: matches nothing today; auto-includes the
                                 // family if the roster's explicit Job Family column
                                 // ever carries this label
];
var UTIL_TARGET     = 70;  // % — proven level for the delivery families, not aspirational
var UTIL_BAND_WEEKS = 8;   // trailing settled weeks for the control band (min 4 to draw)
```

## Population model

Classification per person (`np` key), evaluated at render time from `DATA.personMeta`:

| Rule (first match wins) | Group |
|---|---|
| `personMeta[np].isManager` | **Manager** (excluded by default; "＋ managers" chip) |
| `jobFamily` in `UTIL_TRACKING_FAMILIES` | **Delivery** (default denominator) |
| has a `personWeekCapacity` row but no resolvable `personMeta` entry / blank family | **Delivery** — a Tempo schedule implies a tracking expectation |
| resolvable `jobFamily` not in the allowlist | **Non-tracking** ("＋ non-tracking roles" chip) |

- Global People filters (location / family / manager / crew / role) intersect first,
  exactly as `utilNpList_()` does today; the population split applies to the surviving set.
- The existing **coverage rule is retained**: within a week, only people with a numeric
  capacity cell contribute capacity *and* tracked hours to the %; tracked-only people are
  counted and disclosed, never divided.

## Header (Option B)

```
64%  utilization · 2026.W27
Coverage 82% × Fidelity 78% = 64% · 6 pp below the 70% target ≈ 210 hrs
34 tracking-required people
```

- **Utilization** = tracked ÷ capacity. **Coverage** = planned ÷ capacity.
  **Fidelity** = tracked ÷ planned. The identity reconciles by construction
  (planned cancels), so the three numbers are never read in isolation.
- **Planned figures are the capacity-sanitized ones** (`buildSanitizedPlan_` output) —
  the same numbers the Planned-vs-Tracked panel shows, so the two panels reconcile.
  If the anchor week has no plan data, the identity degrades to utilization-only with a
  "no plan data this week" note.
- **Gap** = `(UTIL_TARGET − util) × weekCapacity / 100`, shown in hours, only when below
  target; at/above target the sentence celebrates instead ("meets the 70% target").
- **Anchor week:** the selected week if settled or provisional; the in-progress week
  never anchors the header (selecting it falls back to the latest settled week — its
  projection stays visible on the chart point, whisker, and tooltip). A provisional
  anchor carries an explicit "(still settling)" label. *(Amended post-review: stricter
  than the original "(in progress — projected)" labelled-headline wording, per the
  final review's honest-states finding N1.)*

## Week states

| State | Definition | Rendering |
|---|---|---|
| **Settled** | completed weeks older than the most recent completed week | solid line, filled points |
| **Provisional** | the most recent completed week (tracked export refreshes weekly — late logging still arriving) | hollow point, dashed inbound segment, amber "still settling" tag |
| **Projected** | the current ISO week | gray dashed segment, hollow point, ±band whisker, value labelled "projected N% (lo–hi)" |
| **Future** | capacity-only weeks beyond current | dashed capacity only, as today |

**Projection math:** `proj = trackedSoFar ÷ (elapsedWorkdays / 5)` over capacity, where
`elapsedWorkdays` = count of weekdays from Monday through **today inclusive** (today
counts as elapsed — hours logged today are in the numerator), clamped to [1, 5]. Band =
proj ± 2σ, where σ is the control-band standard deviation, clamped at ≥ 0. The
projected and provisional weeks are **excluded** from control-band statistics and from
the headline.

## Control band and target

- Band = mean ± 2σ of utilization over the trailing `UTIL_BAND_WEEKS` settled weeks;
  drawn as a soft fill with a dashed mean line, labelled "normal range".
  Hidden when fewer than 4 settled weeks exist.
- Target = dashed line at `UTIL_TARGET` with right-aligned label. Weeks inside the band
  are noise, not signal — the so-what line says so when the anchor week is in-band.

## Population chips

- Two chips in the panel header: **＋ non-tracking roles** and **＋ managers**, default
  off, state client-local (not persisted).
- When ON, the chip shows its live delta on the anchor week: `+N people, −X pp`
  (recomputed on every render). When OFF it shows just the label.
- Toggling recomputes the whole panel client-side — header, chart, band, drill.

## "Why did this week move?" drill

- Collapsed row under the so-what line; expands on click (same pattern as existing drills).
- Decomposes the anchor week's utilization change vs the prior settled week **exactly**:
  per group *g*, `contribution_g = tracked_g,w ÷ capacity_w − tracked_g,w−1 ÷ capacity_w−1`;
  contributions sum to the total pp move.
- Rendered as signed horizontal bars (green positive / red negative), size-weighted,
  sorted by |contribution|.
- Dimension switcher: **job family** (default) / manager / location.
- **Groups and counts only — no individual names in the chart area** (standing rule);
  person-level detail lives in the CSV.

## CSV export

- Always exports the **full population** (all three groups), ignoring chip state — the
  CSV remains the audit artifact.
- New `Group` column (`Delivery` / `Manager` / `Non-tracking`) appended to the existing
  `User, Week, Capacity hrs, Tracked hrs, Utilization %` schema. Blank-vs-0 and
  future-week semantics unchanged.

## Implementation shape

- **UTIL-PURE block (pure, node-tested):**
  - `utilSplitPopulation_(npList, meta, capMap, families)` → `{delivery:[], managers:[], nonTracking:[]}`
  - `utilWeekTotals_` — unchanged, called per population variant
  - `utilControlStats_(utilByIso, settledIsos, bandWeeks)` → `{mean, sigma, lo, hi}` or `null`
  - `utilProjection_(trackedSoFar, capacity, elapsedWorkdays, sigma)` → `{pct, lo, hi}`
  - `utilDecompose_(isoW, isoPrev, groups, capMap, trkMap)` → `[{key, pp}]` (sums to Δ)
  - `buildUtilCsvRows_` — extended with the `Group` column
- **Render layer:** `renderUtilization()` rewritten (header sentence, chips, drill);
  `renderUtilChart_` extended (band rect, mean line, target line, provisional/projected
  styling, whisker); legend updated.
- Existing hover tooltips, PNG export, week-click navigation, and the
  `SOURCE !== 'live'` hide are retained.

## Error handling

- `DATA.capacityError` / no capacity weeks → same recovery message as today
  (run `fetchTempoCapacity()`, then Refresh).
- No settled week with both capacity and tracked data → explicit message; chart still
  draws future capacity.
- Fewer than 4 settled weeks → band and projection-band suppressed (projection point
  still drawn, labelled "no band yet").
- Anchor week missing plan data → identity degrades gracefully (see Header).

## Testing

Extend `node-tests.js` (UTIL-PURE eval harness) with:

1. Population split — allowlist match, manager carve-out, capacity-row-without-profile →
   Delivery, non-allowlist family → Non-tracking.
2. Decomposition — group contributions sum exactly to the week-over-week pp change,
   including changed denominators.
3. Projection — mid-week linear scale-up, min-1-workday clamp, band clamped ≥ 0.
4. Control stats — mean/σ over exactly the trailing N settled weeks; null under 4.
5. CSV — `Group` column values; toggles never affect CSV contents.
6. Identity — coverage × fidelity reproduces utilization on synthetic data.

Manual QA: chip deltas render and reverse cleanly; drill sums match the headline move;
provisional/projected styling; dark theme; PNG export includes band/target.

## Out of scope

- Dollarised gap (no per-hour rate exists — project-level billing).
- Learned weekday logging curve (needs day-grain export columns; revisit only if the
  linear projection proves misleading in practice).
- Server/model changes, cache changes, other panels.

---

# V2 — Glance / Explore layering (2026-07-16 stakeholder feedback)

The v1 build implemented the right elements but rendered them all at "glance height."
V2 splits the panel into two states. Nothing is deleted except the capacity backdrop;
the fair-scope framing is explicitly protected.

## Glance layer (always visible — header height)

- **Hero**, anchored to the **latest settled week only** (settled weeks are the only
  possible anchor in v2 — selecting the provisional or live week falls back to the
  latest settled week; those weeks live on the chart, never in the header):
  big %, "utilization · <iso>", plus a **one-word verdict chip** computed from the
  control band by a new pure `utilVerdict_(u, stats)`:
  `below` (u < lo) / `above` (u > hi) / `normal` — chip text "Below normal" (warn
  color) / "Above normal" (pos) / "Normal" (muted). No band (<4 settled weeks) → no chip.
- Identity sentence + target gap unchanged (gap stays **hours only** — the feedback's
  "and dollars" is overruled by the standing project-level-billing decision).
- **Population stated once, and it ties out** (replaces both v1 lines):
  "measures <covered> of <scope> tracking-required people · <scope−covered> without
  capacity data this week · <NT> non-tracking + <M> managers excluded" — covered =
  `ut.covered[anchor]`, scope = active npList length, so covered + without = scope.
  The old trackedOnly footnote sentence in the so-what is dropped (superseded).
- **Explore ▸ / Explore ▾ button** toggling the explore layer (`UTIL_EXPLORE_OPEN`,
  default false, not persisted). When the verdict is `below`, the button is visually
  emphasized (warn-colored border/text) — the "want to know why?" invitation.

## Explore layer (one click away — contains everything else)

Wrapped in a container hidden until `UTIL_EXPLORE_OPEN`. Contains, in order: scope
chips + CSV button, the chart, the legend, the so-what line, the contribution drill.

- **Chart declutter:**
  - The capacity-hours backdrop series is REMOVED (it plotted hours on a % axis).
    Its legend entry goes too. With it gone, capacity-only future weeks carry no ink —
    the week domain now ENDS at the current ISO week (capacity-only weeks after
    `CURRENT_ISO` are excluded from `cw`).
  - **% labels only on the anchor week and the two domain endpoints** (first week,
    and the last settled/provisional point). The live week's stacked point label is
    replaced by a single small two-line callout near the projected point:
    "projected N%" + "(lo–hi)" — drawn once, offset right/below to avoid the whisker.
  - The **anchor week** (not SEL_ISO, not the live week) gets the blue emphasized
    x-axis label; the live week renders as the faint dashed tail it already is.
  - Clicking a settled week re-anchors hero + verdict + so-what + drill together
    (existing capChartNav_ path; anchor rule above).
- **Scope chips restyled** to the file's `.chip-toggle` pattern (same design as the
  Planned vs Tracked billing chips): one `chip-toggle` group holding the two toggle
  buttons ("＋ non-tracking roles", "＋ managers") and retaining the live delta text
  when on. The bespoke `.uchip` CSS is removed. CSV button sits beside the group.
- **Drill, sentence-first:** same settled anchor as the hero. Leads with a finding
  sentence derived from the top contributor:
  "The <drop/rise> came almost entirely from <Group> (−5.6 pp)." — "almost entirely"
  when the top |pp| ≥ 60% of the total |move|, else "was driven by <G1> (−x pp) and
  <G2> (−y pp)". Then **top-3 bars** + one collapsed row "N others (±x pp net)".
  The "Bars sum to the total move: −9.9 pp" line becomes a muted hint. Dimension
  switcher unchanged.

## Unchanged / protected

- All UTIL-PURE math, CSV Group column + chip-independence, projection math, chip
  semantics and deltas, People-filter scoping, PNG export, capacityError recovery
  (which now also hides the explore toggle), no-names rule, no server/cache changes.

---

# V3 — PTO-adjusted capacity, Hours view, People detail (2026-07-16 stakeholder feedback round 3)

## 1. PTO-adjusted capacity (foundation — changes the numbers)

**Rule (user directive):** PTO reduces capacity. A 40 h schedule week with 8 h PTO is a
32 h week. Public holidays are already excluded upstream (the Tempo user-schedule that
feeds the Capacity Tempo sheet respects holiday schemes) — PTO comes from
`DATA.personWeekPTO` (np → iso → hrs, already shipped to the client).

- New pure `utilAdjustCap_(capMap, ptoMap)` → a same-shaped capacity map where every
  EXISTING capacity cell becomes `max(0, cap − pto)`. Blank cells stay blank (never
  invent a cell from PTO alone); explicit 0 stays 0.
- The adjusted map feeds EVERYTHING that consumed `personWeekCapacity`: headline
  utilization, coverage (identity), gap hours, control band, projection, chip deltas,
  decomposition, chart, tooltips. The headline value therefore changes at deploy —
  fairly (upward in PTO-heavy weeks).
- **CSV** gains two columns; new schema:
  `User, Week, Capacity hrs, PTO hrs, Adjusted hrs, Tracked hrs, Utilization %, Group`
  — Utilization % computed against Adjusted hrs; PTO cell blank when 0; Adjusted blank
  when Capacity blank.
- **Safeguard flags:** a person-week with `pto ≥ PTO_FULL_THRESHOLD × cap` (reuses the
  dashboard's 0.75 constant) is a **full-PTO week** — 🏖, never flagged low. Low
  tracking = `tracked < UTIL_LOW_RATIO × adjusted` with `adjusted > 0` and not
  full-PTO. New CONFIG `UTIL_LOW_RATIO = 0.6`.
- Pure `utilPersonWeek_(cap, pto, tracked, hasCap)` → `{adj, util, fullPto, low}`
  encapsulates the rule (node-tested); the table and CSV both use it.
- **Manager note**, shown at the people table and echoed in the panel hint:
  "Capacity is holiday- and PTO-adjusted — a 40 h week with 8 h of PTO counts as 32 h.
  People mostly on PTO in a week are never flagged."

## 2. Chart: Hours | Rate toggle (default Hours)

- A second `.chip-toggle` (`#utilChartMode`: "Hours" | "Rate") in `.util-tools`;
  state `UTIL_CHART_MODE = 'hours'` (default, not persisted).
- **Hours view (new, default):** y-axis in hours. Adjusted-capacity AREA (slate,
  soft fill + line), tracked AREA on top (pos green, softer fill + line). Utilization
  rate labelled at EVERY settled point (`Math.round%`), provisional point hollow amber
  with `˜` label, live week: capacity line continues solid, tracked segment dashed
  ghost (logged-so-far, labelled `*`). No band/target/projection here (they are
  %-space; the verdict chip still carries the band). Same hover/click hit-columns.
- **Rate view:** the existing %-space chart, unchanged (band, target, projection,
  callout).
- Legend adapts per mode. PNG captures whichever mode is on screen.

## 3. People detail — expandable table (names allowed here)

Placed in the explore layer under the drill; header row toggles it
(`UTIL_PEOPLE_OPEN`, default false): "▸ People detail — <anchor>" + the manager note.

- One row per person in the ACTIVE population (chips respected) **plus** tracked-only
  people (no capacity row → capacity cells show —): Name (displayNames fallback np),
  Group, Capacity, PTO, Adjusted, Tracked, Util %, flag chips: ⚠ low · 🏖 PTO ·
  "no capacity data". Anchor week's numbers.
- Sort: flagged-low first, then util ascending, then name. Row click expands that
  person's week-by-week history (every capacity week ≤ current): same columns per week
  with the same flags (all PTO-adjusted).
- This is the sanctioned names surface (expandable detail rows) — chart-area
  verdicts/sentences stay names-free.

## Unchanged / protected

Glance layer semantics (verdict, identity, reconciled population line), drill
behavior (now reading adjusted capacity), CSV chip-independence, fair-scope chips,
no dollars, client-only (no Code.js change, no cache bump).
