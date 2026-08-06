# Delivery Health — Executive tab, newspaper restructure

**Date:** 2026-08-06 (2026.W32)
**Status:** design agreed, not yet implemented
**Surface:** `docs/superpowers/delivery-health-dashboard/` — `Dashboard.html` (Executive pane),
`Code.js` (server), `Jira Backlog.js` (exporter)
**Audience:** C-suite. This is the first tab every executive opens and the one that gets
screenshotted into board packs.
**Supersedes for the Executive pane only:** the KPI-strip layout agreed in
`2026-08-05-*-design.md`. The three-tab navigation, the Actions tab and the Access tab are
untouched.

---

## 1. Why

Two goals, in the user's words: **full transparency on the work done**, and **easy indicators of
where we are failing**.

The current Executive tab is a scorecard — four cards graded against FY27 targets, a comparison
chart, a people pulse, a trust strip. It answers *are we on target*. It does not answer *how much
work is standing in front of us and who owns it*, and it has no plain-language statement of the
week anywhere on it. A reader has to assemble the verdict themselves from four sparklines.

The restructure adopts a **newspaper spine**: a masthead carrying the verdict in a sentence, then
progressively more specific bands beneath it.

### 1.1 What the probes changed

Live JQL against `servicerocket-coe`, 2026-08-06, over the exporter's own scope
(`EXEC_ISSUE_TYPES`, `project NOT IN (TEMPLATE)`, `summary !~ "to delete"`):

| Measure | JQL | Count |
|---|---|---|
| Open **assigned** (what the dashboard sees today) | `statusCategory != Done AND assignee is not EMPTY AND updated >= -26w` | **1,440** |
| Open **unassigned** (invisible today) | `statusCategory != Done AND assignee is EMPTY AND updated >= -26w` | **1,839** |
| **True open inventory** | — | **3,279** — 56% unowned |
| 2026.W31 created / resolved | `created`/`resolutiondate` in `2026-07-27 .. 2026-08-02` | 224 / 204 → net **+20** |
| 2026.W24–W31 created / resolved | same, `2026-06-08 .. 2026-08-02` | 2,487 / 2,375 → **+14/wk**, clearing **~297/wk** |

The 1,440 matches the README's independently-measured 1,444 assigned open issues for the same
date, which calibrates the probe.

**Caveats on these figures.** JQL cannot reproduce `getSpaceForIssue_`, so R&D projects are
included and the exported numbers will land slightly lower. 297/wk is the eight-week *mean*
(window sums were all that was available); the shipped metric uses the *median*.

Three findings follow, and each one changes a design decision:

1. **`fetchOpenIssues_()` line 1162 carries `'assignee is not EMPTY'`.** Unassigned open work is
   not in the export at all, so no dashboard-side code can count it. Assigned-only, weeks-to-clear
   reads `1,440 ÷ 297` = **4.9 weeks — essentially at the ≤4w target**. The true queue is
   `3,279 ÷ 297` = **11.0 weeks, 2.75× over**. Today's instrument would report a queue at target
   while it is three times deep. This is the single most consequential gap on the surface.
2. **Net flow is not the story.** The prototype's lede asserted *"it grew by 39 items last week"*.
   Real net flow is **+20 in W31 and +14/wk over eight weeks** — the queue is roughly *stable*. The
   finding is **3,279 items of standing inventory, more than half of it owned by nobody**, not
   runaway intake.
3. **A one-week denominator would have put a five-week error in the headline.** W31 resolved 204
   against an eight-week mean of 297 — it genuinely was a slow week. Weeks-to-clear reads **16.1w**
   on W31 alone versus **11.0w** on a trailing basis.

---

## 2. Decisions

Each row was an explicit user decision during design. Recorded here because most of them are
reversals or refinements of what the prototype proposed.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Newspaper spine** — masthead verdict, then specifics | User direction. One sentence a reader can quote before they read a single chart |
| D2 | **ORG hero triplet, filterable assigned sub-row** | The literal "assigned band + companion" reading puts `1,440 / 4.9w` in the headline, which is *at target* and is the exact misread §1.1 exposed. The hero must be true; the sub-row keeps the filters meaningful |
| D3 | **Weeks-to-clear divides by the 8-week trailing median**, with "at last week's rate" as a companion | Same median-and-MAD reasoning `standardRate_` already applies to every operating norm. Fixed 8-week basis regardless of the period picker, so flipping to Quarter never silently changes what the lede means |
| D4 | **Net flow counted org-wide on both halves** | Person-keyed arrivals carry an assignment-lag bias that worsens the more recent the week, so a growing queue could read as flat exactly when it matters. Precedent already in the file: `parseBugRows_` — *"bugs are routinely unassigned at creation, so a person join would silently drop most of the population"* |
| D5 | **New org-level sample floor (5 measurable records); coverage-gate policy unchanged** | The prototype shelved Forecast (n=1) while publishing On-Time (n=19) — both are below their coverage gate, so *sample size* is what separates them, not coverage. Treating it as a floor means the 2026-08-03 decision to publish below gate is not reopened |
| D6 | **Approach A: count-only export additions.** `Jira Raw` untouched | The only option that delivers the full lede without moving numbers on a page the C-suite already reads |
| D7 | **Dropping the assignee clause (approach B) is deferred** | Held as a follow-up decision, gated on what the counts show once live. §1.1 makes it considerably more attractive than it looked at the outset |
| D8 | **`OPEN_BACKLOG_UPDATED_WEEKS: 26` applies to the unassigned count too** | Consistent with the assigned leg. Consequence: 1,839 excludes anything untouched in six months, so it is a **floor** on dead inventory, not the whole of it |
| D9 | **The shelf names no owner** | Same reasoning as the gaps queue's no-Owner-column decision (2026-08-03): a standing table of names against failures in a widely-read view reads as a blame board, and that is not what gets Jira tagging fixed |
| D10 | **The verdict is assembled from ranked findings, not a sentence template** | A template hardcoding "it grew by N items" renders a false clause on the real data. Only findings that are true may render |

### 2.1 Human-facing guardrails carried forward unchanged

The Executive tab is read by people about people, so the existing rules stay:

- **No individual is ever named on this tab.** Counts on the pulse and the comparison bars, names
  only on the Actions roster. Unchanged.
- **Small samples are never graded.** Group rows under 10 people show their value and carry a grey
  dot, never red or green — a region moves on one person, and a red badge on six people reads as a
  systemic failure that isn't there.
- **The margin gate holds.** Utilisation and recoverable hours are out-of-tier for open-access
  viewers and are **omitted from the DOM entirely**, not dimmed. A dimmed number is still a number
  on a projector.

---

## 3. Page structure

Eight bands, masthead down.

### §1 Masthead — the lede

Week label · "last complete week" · headcount · verdict sentence · evidence chip.

**Headcount is the filtered population**, matching the scope chip directly above the panes — the
masthead states who is on screen. It is the one number in this band that is not `ORG`.

**The verdict is composed, not templated.** Not every candidate finding has a target, so ranking is
by a **fixed severity order with a materiality threshold per finding**, not by a computed
distance-from-target. A finding whose threshold is not met does not render at all.

| Rank | Finding | Renders when |
|---|---|---|
| 1 | queue depth vs the 4w target | `queueCover > target` |
| 2 | unowned share of inventory | unowned share ≥ 20% |
| 3 | net-flow direction | \|netFlow\| ≥ 5% of the median clear rate — below that the queue is stable and saying "growing" would be noise |
| 4 | gates failing | any gate below its own gate value |
| 5 | metrics shelved | any metric under the sample floor |

On today's numbers this reads approximately: *"3,279 items in the queue and clearing about 297 a
week — roughly 11 weeks of work, and 56% of it has no owner."* When intake genuinely does outrun
supply, that clause appears; when it does not, it does not.

Evidence chip, right-aligned: gates failing, plus the count of metrics on the shelf.

**Contract fix.** The prototype collided `people` as both a number and an object, producing
`[object Object]` in the masthead, the people caveat, the leave line and the trust list — one cause,
four symptoms. The contract splits **`headcount`** (number) from **`signals`** (object).

### §2 Backlog band — the hero

**Hero triplet, `ORG`-tagged, ignores filters:**

Values below are **illustrative, from the §1.1 probes**, and are approximate for the reason stated
there: the probe returned window sums, so 297/wk is a mean where the shipped metric uses the median.

| Slot | Value today | Notes |
|---|---|---|
| Inventory | ≈ 3,279 items | assigned + unassigned; the split is stated immediately beneath |
| Net flow | ≈ +14/wk | 8-week basis, following D3 — the same reason a one-week read is unsafe for weeks-to-clear applies to net flow. W31's +20 rides as the companion |
| Weeks to clear | ≈ 11.0w | `inventory ÷ median(resolved, last 8 complete weeks)`; "at last week's rate: ≈16.1w" as companion |

**Filterable assigned sub-row, `SNAP`-tagged**, responding to Region / Team / PM / Job family as
every other surface does: assigned inventory (≈1,440) and assigned weeks-to-clear (≈4.9w),
explicitly labelled as *the work that has an owner*.

The sub-row divides by the **assigned** clear rate, not the ORG one — the median of the last 8
complete weeks of `throughputBuckets_` cleared counts under the active filters. Dividing a filtered
numerator by an org-wide denominator would produce a number that belongs to neither population.

The two scopes are never summed on screen and never summed server-side. `queueSnapshot_()` returns
the halves separately for exactly this reason.

**Queue ruler**, three segments, scaled in weeks at the median clear rate, with the 4w target rule:

| Segment | Source | Fill |
|---|---|---|
| In progress | assigned WIP (`flowOpenBuckets_.wipN`) | solid |
| Queued | assigned To Do (`flowOpenBuckets_.todoN`) | filled |
| Unowned | 1,839, `ORG` | hatched |

At 11 weeks against a 12-week axis the ruler is nearly full. That is the point.

### §3 Evidence gates — "Can we publish these numbers?"

Mechanics unchanged from the current data-trust strip; the prototype's heading is better copy and is
adopted. Still picked **by key** from the same `gapsRows_()` definitions that back the Actions gaps
queue, so the two can never describe one gap differently. Still `ORG`-tagged and deliberately
unfiltered. **Still self-retiring at 100%** — Roster join disappears while it is clean, and returns
by itself the moment one record fails.

### §4 Flow band

`Cleared` (assigned, `PERIOD`, filterable) · `Arrived` (`ORG`) · `Lead time p85` (`PERIOD`,
target ≤30d) · `On-Time` (`PERIOD`, target ≥85%).

Mixed scopes in one row, which is what the `PERIOD` / `ORG` tags exist to disambiguate. The
assigned-only `Cleared` count is the *existing* `throughputBuckets_` figure, unchanged, and will
legitimately differ from the ORG `Arrived`/net-flow denominators — the tags say why.

### §5 Capacity band

`Recoverable hours` (`oppRows_` total) · `Utilisation` · `People signals`.

Three behaviours the prototype dropped are preserved:

- the `canSeeMargin_()` gate (§2.1);
- the **planning-window phase switch** — `planTile_` replaces utilisation, outcome cards render
  `notYetTile_`;
- the **mid-period floor grammar** — `opts.floor`, "at least N%", no RAG colour, because capacity is
  booked for a whole window while hours have accrued for part of it.

The prototype's `[object Object]` people caveat becomes a real reconciliation count.

### §6 Where it's concentrated

Grid (rows = groups, columns = metrics) → click a column → bullet chart. Dimensions: Region, Team,
PM, Job family. Two fixes:

1. **`Cleared` becomes `clearedPerHead`** — items per person per week. The prototype graded absolute
   throughput against a flat target of 40, so ANZ scored ✗ for clearing 12 items with 8 people while
   AMER scored ✓ for clearing 61 with 63. That column ranked regions by size, not by performance.
   Graded against the operating norm from `standardRate_`, **no invented target**, neutral colour —
   the `target: null` convention the existing flow tiles already use.
2. **The existing row cap and coverage sentence are retained** — `HBAR_MAX_ROWS_` (12) with
   `Show all N`, rows chosen by distance below target rather than list position, and the mandatory
   coverage sentence (*"all 42 people represented"* / *"38 of 42 — 4 missing"*). At 52 PMs an
   uncapped grid is unreadable, and a team missing from a chart reads as a team missing from the feed.

Group rows under 10 people: value shown, grey dot, ungraded (§2.1).

On a planning window, `liveMetrics_()` collapses to `planCov` and the grid re-points itself, as
today.

### §7 Not measured this week

Fully **data-driven** — no hand-written list. Populated from:

- registry entries with `status: "absent"` (Cycle Time, Flow Efficiency, CSAT, rework capture);
- any metric under the new sample floor;
- any metric whose feed is unavailable.

Each row states **what it is, why it is not measured, and what would clear it.** No owner (D9).
Below-floor *and* below-gate produces one entry naming both reasons, not two entries.

### §8 Data trust detail

`<details>`, collapsed. **Computed, not prose:** Little's Law check, people-signals reconciliation,
and the registry's `deviations` rendered from source. The prototype's hardcoded editorial lines
(*"1 person on leave is not credible"*) are dropped — they will be wrong next month and nothing
would notice.

### §9 One technical removal

The prototype opens with `@import url('https://fonts.googleapis.com/…')`. This dashboard's entire
chart philosophy is that a blocked external request inside the HtmlService iframe means an empty
executive page — it is why every chart is hand-rolled SVG. **No `@import`.** The existing
`'Roboto', -apple-system, "Segoe UI"` stack with system fallbacks stays.

---

## 4. Data layer

### 4.1 Exporter — `Jira Backlog.js` v3.11.0

Two additions, both **count-only**.

**New tab `Jira Arrivals`** — one row per ISO week, full rewrite per run:

| Column | Meaning |
|---|---|
| `ISO Week` | `YYYY.WN` |
| `Created` | issues created in the week, **no assignee clause** |
| `Resolved` | issues resolved in the week, same scope |
| `Created Unassigned` | of `Created`, those still unassigned at export time — the signal for whether the *unowned* half of the queue is growing, which is a different question from whether the queue is growing, and feeds verdict finding #2 |

Built from one `created >= <window start>` fetch plus a resolved-date tally over the same scope,
with the same `getSpaceForIssue_` and `isNoiseIssue_` filtering as the existing `Jira Bugs` weekly
tally — a pattern already in the file (`fetchCreatedIssues_` already exists with no assignee filter;
it currently feeds only `Exec Q&A`).

**`Flow Snapshots` gains two columns**, from a count-only unassigned-open fetch bounded by
`OPEN_BACKLOG_UPDATED_WEEKS` (D8):

| Column | Meaning |
|---|---|
| `Unassigned Items` | open, unassigned, updated within the bound |
| `Unassigned Hrs` | Σ max(0, est − spent) over those |

Append-only contract preserved; readers index by header name, so existing rows stay readable and
simply carry no value for the new columns.

**`Jira Raw` is not touched.** No new per-issue rows. Therefore `typeHygieneBuckets_`,
`personHygieneBuckets_`, the gaps queue, the 🧬 matrix, the signals roster and all four KPI cards
produce **byte-identical numbers after deploy**. This is the property that makes the change safe to
ship onto a live C-suite page, and step 7 of the deploy checklist verifies it.

### 4.2 Server — `Code.js`, schema `DH_SCHEMA_VER_` 25 → 26

Four new pure functions, all unit-testable without GAS:

| Function | Contract |
|---|---|
| `readArrivals_()` / `parseArrivalRows_()` | the new tab → `[{iso, created, resolved, createdUnassigned}]`. **Missing column → `null`, never `0`** — same tristate discipline as `parseBugRows_` and `reopened` |
| `queueSnapshot_()` | assigned inventory from the unchanged, still person-keyed `flowOpenBuckets_`, **plus** ORG unassigned counts off `Flow Snapshots`. Returns both halves separately and **never a sum** |
| `clearRateMedian_(weeks)` | median of the last 8 complete weeks' `resolved`, via the existing `medianOf_`. **Returns `null` under 5 weeks of history**, matching `standardRate_`'s existing refusal-to-publish rule rather than inventing a second one. Called twice with two series: the ORG `resolved` series from `Jira Arrivals` for the hero, and the filtered `throughputBuckets_` cleared series for the assigned sub-row (§3 §2) |
| `sampleFloorFor_(metricId, n)` | the new org-level floor; reads `SAMPLE_FLOOR` per registry entry so the Services Director can tune it per metric the way `coverageGate` already is |

### 4.3 Registry additions

| Metric id | Target | Dir | Sample floor | Owner | Ratified |
|---|---|---|---|---|---|
| `queueCover` — weeks to clear | ≤ 4w | down | 5 | Services Director | **`false`** |
| `netFlow` — items/wk | ≤ 0 | down | *n/a (count)* | Services Director | **`false`** |
| `clearedPerHead` — items/person/wk | *none* | up | 5 | Services Director | n/a |

`ratified: false` is load-bearing: nobody has signed the 4w bar or the net-flow target, the registry
records that, and the tile's ⓘ surfaces it. A target invented at design time must not read as a
target the business agreed to.

`deviations` entries to record: the R&D-inclusion in the probe figures, the median basis, the 26-week
bound on the unassigned count (D8), and both limits of the walk-back reconstruction (§4.5).

### 4.4 The sample floor applies to rates, never to counts

A mean over one epic is not a mean, so Forecast shelves at n=1. But three items cleared *is* three
items cleared — flooring a count would hide real work.

- **Floored:** `onTime`, `forecast`, `rework`, `leadTime`, `util`, `queueCover`, `clearedPerHead`
- **Never floored:** `inventory`, `arrived`, `cleared`, `netFlow`

`SAMPLE_FLOOR: 5` by default, per registry entry.

### 4.5 Reconstructed inventory history

As specced so far the hero would ship with **no trend at all**, because `Flow Snapshots` appends only
and starts 2026.W32 — a headline with no context. The prototype's own shelf proposed recovering it
"from the Jira changelog", which is unnecessary: `Created` and `Resolution Date` are already on every
row.

Cumulative-created minus cumulative-resolved undercounts (anything created before the window is
missing), so **anchor on the measured present and walk backwards**:

```
inventory(W−1) = inventory(W) − created(W) + resolved(W)
```

With `inventory(now)` measured, this reconstructs a real weekly inventory series — and therefore a
real weeks-to-clear trend and operating norm — **from day one**.

Two limits, both recorded as registry `deviations`:

1. the walk-back assumes nothing was deleted or moved out of scope;
2. the anchor carries the `updated >= -26w` bound while the weekly deltas do not, so drift grows with
   distance from today.

Therefore: the reconstruction is **capped at 26 weeks**, where that bound is coherent, and the
sparkline **draws reconstructed points differently from measured ones**, reusing the
`✎ definition changed` marker mechanism that already exists for exactly this "the basis changes here"
job. As `Flow Snapshots` accumulates genuine measurements they overwrite reconstructed points week by
week, so the series improves on its own and the chart shows it happening.

### 4.6 Unchanged grading

Coverage gates, `metricConfidence_`, `applyGatePolicy_`, `CONFIG_DH.SUPPRESS_BELOW_GATE = false`,
`stdFor_`'s refusal rules, the weekly fallback on the Quarter view, and the `PERIOD` / `SNAP` / `ORG`
tag vocabulary all stay exactly as they are. **No existing metric's colour changes on deploy.**

---

## 5. Degraded states

The rule throughout: **an absent measurement never renders as a zero.**

| Condition | Behaviour |
|---|---|
| `Jira Arrivals` tab missing (`Code.js` deployed before the export re-ran) | `readArrivals_()` → `available: false`. No arrived, no net flow, no median rate, therefore **no weeks-to-clear**. Band degrades to inventory-only with a named reason; the verdict **drops its queue-depth clause** rather than printing `undefined weeks` |
| `Flow Snapshots` without the two new columns | unassigned = `null`, tristate. **Never `0`** — "0 unowned" is the most dangerous false read on this page. Hero falls back to assigned-only and says so |
| Fewer than 5 complete weeks of arrivals | `clearRateMedian_` → `null`; the card states how many more weeks it needs, same grammar as `standardRate_` |
| Planning window (`phase === "plan"`) | Inventory and unassigned are `SNAP`, so they still read. Arrived / cleared / net flow are period-shaped → `notYetTile_`. Weeks-to-clear survives: snapshot ÷ historical median |
| `Jira Raw` unavailable | existing behaviour — the whole Jira half reports unavailable |
| Filter slice selects nobody | assigned sub-row says so; **ORG hero unchanged**, correctly, because it ignores filters |
| Below sample floor **and** below coverage gate | one shelf entry naming both reasons |

---

## 6. Tests

### 6.1 New `_test_*` in `Code.js` (run by `node node-tests.js`)

| Test | Asserts |
|---|---|
| `_test_arrivalParse_` | missing column → tristate `null`, not zero; malformed week label skipped, not crashed |
| `_test_clearRateMedian_` | one holiday week cannot move the median; fewer than 5 weeks → `null` |
| `_test_queueSnapshot_` | halves returned separately and never summed; `null` unassigned stays `null` |
| `_test_inventoryWalkback_` | anchor + deltas reproduces a known series; capped at 26 weeks |
| `_test_sampleFloor_` | rates floored, counts never |

### 6.2 New `render-smoke.js` checks

- verdict renders **no growth clause** at net flow ≈ 0;
- verdict **drops the queue clause** when arrivals are unavailable;
- `null` unassigned **never prints "0 unowned"**;
- each scope tag rides with **its own** tile, band by band — not merely somewhere in the markup;
- grid dims sub-10-person rows **while still printing the value**;
- `clearedPerHead` draws **no target rule**;
- the shelf lists a below-floor metric and **does not** list a below-gate one;
- the margin gate **omits the capacity band from the DOM entirely** for a non-margin role;
- planning phase drops the period-shaped queue tiles;
- reconstructed sparkline points are marked distinctly from measured ones.

### 6.3 Existing suite

A number of the current 488 `render-smoke.js` checks are pinned to the present Executive markup and
**will need rewriting**. This is a planned task in the implementation plan, not incidental breakage.

---

## 7. Deploy

Order is not flexible.

1. `Jira Backlog.js` → v3.11.0, save
2. **Run the export** — creates `Jira Arrivals`, adds the two `Flow Snapshots` columns
3. **Verify:** `Jira Arrivals` holds ~52 weekly rows; the newest `Flow Snapshots` row carries
   unassigned counts
4. `Code.js` (schema 25 → 26) + `Dashboard.html` → paste into the GAS project
5. **`bustDeliveryCache_()`** — the schema bump strands prior entries anyway, but the bust makes it
   immediate for every scope at once (CacheService cannot enumerate keys)
6. New deployment version
7. **Spot-check:** ORG hero ≈ 3,279 items / ~11w · assigned sub-row ≈ 1,440 / ~4.9w ·
   **the four KPI cards read exactly what they read before deploy**

Step 7's last clause is the proof that leaving `Jira Raw` alone actually held. If any of the four
moved, something touched the shared population and the change is not what this spec describes.

---

## 8. Out of scope

Named so the implementation plan cannot drift into them:

- **Dropping `'assignee is not EMPTY'` from `fetchOpenIssues_`** (approach B) — deferred (D7),
  pending what the live counts show
- Jira `Region` / `Team` custom fields — still blocked on Gon
- Cycle Time and Flow Efficiency — need `FETCH_CHANGELOG`, which is off
- The rework capture path and CSAT — no feed exists
- Immutable baselined due date / estimate (PR-02, PR-03)
- The **Actions** and **Access** tabs — untouched by this work

---

## 9. Open decisions carried forward

| # | Decision | Owner |
|---|---|---|
| O1 | Ratify or replace the **≤4w weeks-to-clear target**. Shipping with `ratified: false` | Services Director |
| O2 | Ratify or replace the **≤0 net-flow target** | Services Director |
| O3 | Whether to drop the assignee clause (D7) once the counts are live | Services Director + Delivery leadership |
| O4 | Whether the 26-week bound on the unassigned count is the right one, now that it is known to be a floor rather than a total (D8) | Services Director |
