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
   reads `1,440 ÷ 297` = **4.9 weeks**. The true queue is `3,279 ÷ 297` = **11.0 weeks — 2.25× the
   assigned-only reading**. Today's instrument would describe a five-week queue as if that were the
   whole of it. This is the single most consequential gap on the surface, and it is why D7 folds
   approach B into this spec rather than deferring it. *(The prototype's ≤4w bar is quoted nowhere as
   a target — D11 ships these metrics with none.)*
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
| D6 | **Approach A: count-only export additions** for arrivals and the snapshot log | Delivers the full lede without touching the resolved-work population. Note that D7 then *does* widen the open population, so "`Jira Raw` untouched" no longer holds — the safety property that survives is narrower and is stated exactly in §4.6 |
| D7 | **Approach B is in scope: `'assignee is not EMPTY'` is dropped from `fetchOpenIssues_`** | Reversed from "deferred" during design review. The decision was to be gated on what the counts showed, and §1.1 measured them: at 1,839 vs 1,440 it concerns *more than half the queue*, and a count on a card with no drill-down means nobody can open the unowned queue and see what is in it. Consequences in §4.6 |
| D11 | **`queueCover` and `netFlow` ship with no target at all** | Nobody owns a ≤4w or ≤0 bar, and an unratified target on a C-suite headline is worse than none. Graded against the operating norm only, neutral colour — the `target: null` convention the flow tiles already use. Replaces the earlier `ratified: false` plan |
| D12 | **`attr` (roster join) gets its own denominator, `attrN`** | Required by D7 and correct independently. `attr` currently divides by every record, so an *absent* assignee scores as a *failed* join. Adding 1,839 unassigned rows would drop Roster join from 100% to ~44%, un-retire a solved check on three surfaces, and report a false failure. Same tristate idiom as `timeN` and `billN` |
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
| 1 | queue depth | `queueCover` above the upper edge of its operating band (`standardRate_`). **Not vs a target** — D11 removed it. Suppressed entirely while the norm is unpublishable (<5 periods), because "deep" is meaningless without a normal to be deep against |
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
| Weeks to clear | ≈ 11.0w | `inventory ÷ median(resolved, last 8 complete weeks)`; "at last week's rate: ≈16.1w" as companion. **No target** (D11) — graded against its operating band only |

**Filterable assigned sub-row, `SNAP`-tagged**, responding to Region / Team / PM / Job family as
every other surface does: assigned inventory (≈1,440) and assigned weeks-to-clear (≈4.9w),
explicitly labelled as *the work that has an owner*.

The sub-row divides by the **assigned** clear rate, not the ORG one — the median of the last 8
complete weeks of `throughputBuckets_` cleared counts under the active filters. Dividing a filtered
numerator by an org-wide denominator would produce a number that belongs to neither population.

The two scopes are never summed on screen and never summed server-side. `queueSnapshot_()` returns
the halves separately for exactly this reason.

**Queue ruler**, three segments, scaled in weeks at the median clear rate:

| Segment | Source | Fill |
|---|---|---|
| In progress | assigned WIP (`flowOpenBuckets_.wipN`) | solid |
| Queued | assigned To Do (`flowOpenBuckets_.todoN`) | filled |
| Unowned | unassigned open, `ORG` | hatched — **click-through to the drill-down (D7)** |

**No 4w target rule on the ruler** (D11). In its place, the **operating band is shaded** — the same
±1 MAD band `standardRate_` gives every other norm on the page, and the same shading the bullet chart
already uses. While the norm is unpublishable the ruler draws no reference mark at all rather than an
invented one.

At ~11 weeks against a 12-week axis the ruler is nearly full. That is the point.

**The unowned segment is drillable** because D7 puts unassigned work into `Jira Raw` as real rows.
This is the main reader-facing gain from folding B in: the 1,839 stops being a number on a card and
becomes a queue somebody can open, filter and act on.

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
   the `target: null` convention the existing flow tiles already use. The `Wks to clear` column is
   norm-graded on the same basis (D11), so **two of the five grid columns draw no target rule**; the
   bullet chart shades their operating band instead.
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

### 4.0 Boundary format contract — binding on every crossing

Three defects in this plan were the same mistake: `W07` vs `W7` padding, lexicographic ISO ordering,
and UTC-instant date transport. Each is a value crossing a boundary where the two sides disagree
about what "the day" is, and each is **silent** — it yields a plausible sheet, a plausible dashboard
and a number that is quietly wrong.

So the rule is not "be careful": **one canonical form per crossing, loyal on both sides, enforced by
a test.** Any new I/O in this project conforms or changes this table.

| Crossing | Canonical form | Never |
|---|---|---|
| Date written to a sheet | `yyyy-mm-dd` string (`toIsoDate_`) | a `Date` object — Apps Script serializes it in the *script's* timezone |
| Date read from a sheet | explicit **local component** parse (regex on the string; local getters on a coerced `Date`) | `new Date(string)` — a date-only string is UTC-midnight per the ES spec and shifts the calendar day in any behind-UTC zone |
| ISO week key | `weekKeyFromDate_`, unpadded `2026.W7` | the exporter's padded `2026.W07` crossing a join |
| Ordering ISO week keys | numeric `(year, week)` compare | a string compare — `"2026.W10" < "2026.W6"` |
| Counts vs "nobody looked" | `null` | `0` |

**Every fixture that guards one of these must contain the case that distinguishes correct from
plausible-but-wrong** — a behind-UTC timezone, a single-digit ISO week, an absent column. A fixture
of two-digit weeks in UTC passes under both a correct and a broken implementation, which is precisely
how two of the three shipped.

**Which side gets fixed — respect the producer's output, adapt the consumer** (user decision
2026-08-06). Normalise on **read** wherever the incoming form is merely *different*, not *lossy*: the
dashboard owns the canonical vocabulary, one file changes instead of two, existing history is repaired
without a re-export, and no other consumer of that sheet is disturbed.

The one case that must still be fixed at the **write** side is where the producer has already
**destroyed** information the reader cannot recover. A `Date` object written to a cell is serialised
in the script's timezone, so a UTC-midnight instant is stored as the *previous calendar day* — by the
time the dashboard reads it, the correct day is simply gone. Padding (`W07` vs `W7`) loses nothing and
is a read-side fix; a shifted calendar day loses the value itself and is not.

### 4.1 Exporter — `Jira Backlog.js` v3.11.0

**One removal (D7) and two count-only additions.**

**Removal: `'assignee is not EMPTY'` comes out of `fetchOpenIssues_()` (line 1162).** Unassigned open
work then exports as real per-issue rows in `Jira Raw`, bounded by `OPEN_BACKLOG_UPDATED_WEEKS` (D8)
like the assigned leg. Row volume grows by ~1,839 on ~14k — immaterial for Sheets. Downstream
consequences are enumerated in §4.6 and are **not** all benign.

**New tab `Jira Arrivals`** — one row per ISO week, full rewrite per run:

| Column | Meaning |
|---|---|
| `Week Start` | the week's **Monday, as a date** — deliberately *not* an ISO week label |
| `Created` | issues created in the week, **no assignee clause** |
| `Resolved` | issues resolved in the week, same scope |
| `Created Unassigned` | of `Created`, those still unassigned at export time — the signal for whether the *unowned* half of the queue is growing, which is a different question from whether the queue is growing, and feeds verdict finding #2 |

Built from one `created >= <window start>` fetch plus a resolved-date tally over the same scope,
with the same `getSpaceForIssue_` and `isNoiseIssue_` filtering as the existing `Jira Bugs` weekly
tally — a pattern already in the file (`fetchCreatedIssues_` already exists with no assignee filter;
it currently feeds only `Exec Q&A`).

**Why a date and not a week label.** `weekKeyFromDate_` (dashboard) emits `2026.W7`;
`jb_isoWeekLabel_` (exporter) emits `2026.W07`. That padding divergence is already documented in
`Jira Backlog.js` v3.5.0, and a label written by the exporter would **silently fail to join for weeks
1–9**. Shipping the Monday date keeps **one** week-label authority — the dashboard's — and mirrors
`Jira Bugs`, which ships raw `Created` dates and lets `parseBugRows_` / `bugWeekly_` bucket them.

> **⚠️ The date must cross the boundary as a calendar day, never as a UTC instant** (Task 8 review,
> 2026-08-06). Apps Script serializes a `Date` to a cell using the *script's* timezone, so writing
> `new Date("2026-07-27T00:00:00Z")` lands on the previous calendar day in any behind-UTC zone and
> buckets **every row one ISO week early** — silently, straight into the headline denominator.
>
> A bare `yyyy-mm-dd` **string is not a fix on its own**: JS parses a date-only string as UTC midnight
> per the ES spec, so `parseDhDate_("2026-07-27")` also yields `2026.W30` in a behind-UTC zone.
> Measured across zones:
>
> | Form | UTC | UTC−6 | UTC+12 |
> |---|---|---|---|
> | `new Date("2026-07-27")` | W31 | **W30** | **W30** |
> | `new Date("2026-07-27T00:00:00")` | W31 | W31 | W31 |
> | component parse `new Date(y, m−1, d)` | W31 | W31 | W31 |
>
> So the contract is: the exporter writes `yyyy-mm-dd` (its own `toIsoDate_` convention), and
> `parseArrivalRows_` reads the calendar date from **local components** — regex-parsed from the string,
> or from a `Date`'s local getters when Sheets coerces the cell — never via `new Date(string)`.
>
> This is the third instance of one hazard family in this plan: `W07` vs `W7` padding, lexicographic
> ISO ordering, and now UTC-instant date transport. All three are the same mistake — a date or label
> crossing a boundary where the two sides disagree about what "the day" is.

**`Flow Snapshots` gains two columns**, from a count-only unassigned-open fetch bounded by
`OPEN_BACKLOG_UPDATED_WEEKS` (D8):

| Column | Meaning |
|---|---|
| `Unassigned Items` | open, unassigned, updated within the bound — every status category |
| `Unassigned Hrs` | Σ max(0, est − spent) over the **To Do** ones only |

`Unassigned Hrs` is To-Do-only to match `flowOpenBuckets_`, which contributes no hours for
In Progress work (Task 4 review, 2026-08-06). An "all open" figure here would put a different
population in the sheet than the dashboard computes from `Jira Raw`, and the two would quietly
disagree — on a page whose whole premise is one honest total.

Append-only contract preserved; readers index by header name, so existing rows stay readable and
simply carry no value for the new columns.

**Why keep the `Flow Snapshots` columns now that D7 makes unassigned work directly countable?** One
source for *now*, one log for *history* — `Jira Raw` is authoritative for the current value and the
snapshot tab records it per run so the trend is measured rather than reconstructed. That is exactly
how WIP and backlog already work (`flowOpenBuckets_` for now, `Flow Snapshots` for the trend), so it
adds no second definition.

### 4.2 Server — `Code.js`, schema `DH_SCHEMA_VER_` 25 → 26

Four new pure functions, all unit-testable without GAS:

| Function | Contract |
|---|---|
| `readArrivals_()` / `parseArrivalRows_()` | the new tab → `[{iso, created, resolved, createdUnassigned}]`. **Missing column → `null`, never `0`** — same tristate discipline as `parseBugRows_` and `reopened`. **`available` reports whether the tab is READABLE, not whether it holds data** (user decision 2026-08-06, aligning with `parseBugRows_` and `parseFlowSnapshotRows_`): no tab or a missing required column → `false`; a tab whose rows all fail to parse → `true` with `weeks.length === 0`. Collapsing those two would let an exporter date-format regression hide as "the export has not run yet" |
| `queueSnapshot_(issues, resolvePerson, flowOpen)` | assigned inventory from the unchanged, still person-keyed `flowOpenBuckets_` (**passed in**, not recomputed — `assembleModel_` already built it, and a second O(n) pass over every issue is waste on a payload that needs gzipping), **plus** unassigned counted directly off `jira.issues` (D7). Returns both halves separately and **never a sum**. `flowOpenBuckets_` **keeps its `/unassigned/i` guard** — the assigned sub-row must stay assigned-only, so the guard is load-bearing, and the unassigned loop's condition is its exact complement, which is what makes the halves provably disjoint. **Both halves carry the same shape** — `{items, wipN, todoN, todoHrs}` — so no caller can compare a To-Do-only figure against a To-Do-plus-WIP one. `assigned` additionally carries `unattributed` and `uncategorized`: records whose assignee exists but does not resolve to a roster person, and records in neither status category, fall out of **both** halves, so the total owns its own loss rather than deferring to a counter computed elsewhere in the payload (Task 4 review) |
| `clearRateMedian_(weeks)` | median of the last 8 complete weeks' `resolved`, via the existing `medianOf_`. **Returns `null` under 5 weeks of history**, matching `standardRate_`'s existing refusal-to-publish rule rather than inventing a second one. Called twice with two series: the ORG `resolved` series from `Jira Arrivals` for the hero, and the filtered `throughputBuckets_` cleared series for the assigned sub-row (§3 §2) |
| `sampleFloorFor_(metricId, n)` | the new org-level floor; reads `SAMPLE_FLOOR` per registry entry so the Services Director can tune it per metric the way `coverageGate` already is |

### 4.3 Registry additions

| Metric id | Target | Dir | Sample floor | Owner |
|---|---|---|---|---|
| `queueCover` — weeks to clear | **`null`** | down | 5 | Services Director |
| `netFlow` — items/wk | **`null`** | down | *n/a (count)* | Services Director |
| `clearedPerHead` — items/person/wk | **`null`** | up | 5 | Services Director |

**All three ship with `target: null` (D11).** Nobody owns a ≤4w or ≤0 bar, and an unratified target on
a C-suite headline is worse than no target — it reads as agreed the moment it is on screen, and it
would be the number a board pack quotes.

`target: null` is an established convention here, not a special case: the existing flow tiles use it,
and it carries defined behaviour — **neutral colour, no RAG verdict, no target rule drawn on any
chart, and grading against the operating norm from `standardRate_` only**. Deltas render with neutral
arrows and no `dUp`/`dDown` class, because colouring a direction without a target invents a verdict
(registry D6).

Consequence to hold on to: while fewer than 5 complete periods of history exist, these three have
**no reference of any kind** — no target and no publishable norm. They print their value and say so.
The walk-back reconstruction (§4.5) is what stops that lasting six months.

`deviations` entries to record: the R&D-inclusion in the probe figures, the median basis, the 26-week
bound on the unassigned count (D8), and both limits of the walk-back reconstruction (§4.5).

### 4.4 The sample floor applies to rates, never to counts

A mean over one epic is not a mean, so Forecast shelves at n=1. But three items cleared *is* three
items cleared — flooring a count would hide real work.

- **Floored:** `onTime`, `forecast`, `quality`, `leadTime`, `util`, `queueCover`, `clearedPerHead`
- **Never floored:** `inventory`, `arrived`, `cleared`, `netFlow`

`sampleFloor: 5` per registry entry. **`sampleFloor: null` (or absent) marks a COUNT** and means never
floored — so a metric that should be floored but omits the key is silently unfloorable, which is how
four of the seven above shipped unwired in the first pass (Task 6 review).

> The Quality / Rework metric's **registry id is `quality`**, not `rework`. Earlier drafts of this
> section said `rework`, which is the metric's English name, and no such id exists — a floor written
> against it would have attached to nothing.

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

### 4.6 What approach B moves, and the one thing it must not

Dropping the assignee clause widens the population `Jira Raw` describes. Three groups of
consequences.

**Unaffected — verified by reading each bucket's guard.** Every resolved-work metric skips unresolved
records, and B adds only *open* rows: `onTimeBuckets_`, `throughputBuckets_`, `forecastBuckets_`,
`leadTimeBuckets_`, `reworkBuckets_`. `personHygieneBuckets_` is person-keyed and unassigned rows
carry no person. `openIssues` (the per-person drill-down population) keeps its own assignee filter in
`readJiraRaw_`. **So the four KPI cards and the signals roster do not move.**

**Legitimately worse, and that is the finding.** `typeHygOpen_` does *not* require an assignee, so
unassigned rows enter the 🧬 matrix's open half and the gaps queue. Unowned tickets are the
worst-tagged population on the site, so `assigned`, `due`, `est`, `region` and `team` fill rates all
**drop on deploy** — on the open half, materially. This is previously-hidden hygiene debt becoming
visible, not tagging getting worse, and it needs the same treatment the v2.0 conformance pass got:

- a dated note in `README.md` stating that the population widened and the numbers moved because of it;
- a `METRIC_REGISTRY_.changeLog` entry;
- the existing **`✎ definition changed`** marker on every affected series, which is precisely the
  mechanism for "the basis changes here".

**The trap — `attr` must be fixed or B reports a false failure (D12).** In `typeHygieneBuckets_`:

```js
assigned: hasAssignee,                                    // has an assignee at all
attr:     !!(resolvePerson && resolvePerson(it.assignee)) // …and it resolves to a roster person
```

Both divide by `n`. For an unassigned row `resolvePerson("⚠️ UNASSIGNED")` → `null` → `attr: false`,
so **an absent assignee is scored as a failed roster join**. Harmless today because unassigned rows
are not in the feed. Under B, Roster join falls from 100% to roughly `1,440 / 3,279` ≈ 44%, which:

1. **un-retires a solved check on all three surfaces at once** — the gaps-queue row returns, the
   data-trust tile reappears, and the 🧬 `→ roster` column comes back;
2. reports something that is **not true**. Those records have no assignee to fail to join. The
   `assigned` column already measures that gap, correctly.

**Fix:** `attr` gets its own denominator `attrN` = records where `hasAssignee`, and is measured only
over them. Identical tristate idiom to `timeN` (logged time is only expected on started work) and
`billN` — the code's own principle, *"measure what you can grade, grade what you measured."* Applied
in `typeHygieneBuckets_`, `hygieneBuckets_`, `TYPE_FIELDS_` and `gapsRowsAll_()` together, so the
matrix, the queue and the trust strip cannot disagree.

With the fix, **Roster join correctly stays at 100% and stays retired**, and the check becomes more
correct than it is today — it would now catch a genuine join failure that an assignee-absence used to
mask.

### 4.7 Unchanged grading

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
| `_test_attrDenominator_` | **D12.** An unassigned record is in neither half of `attr` — not a hit, not a miss. A record *with* an assignee that fails to resolve is still a miss. Feeding an all-unassigned open set leaves `attr` at 100% (or `null`), never 0% |
| `_test_unassignedInventory_` | unassigned counted off `jira.issues`; `flowOpenBuckets_` still excludes them, so the two halves stay disjoint and cannot double-count |
| `_test_openPopulationUnaffected_` | adding open unassigned rows moves **no** resolved-work bucket — `onTime`, `forecast`, `leadTime`, `throughput`, `rework` all byte-identical |

### 6.2 New `render-smoke.js` checks

- verdict renders **no growth clause** at net flow ≈ 0;
- verdict **drops the queue clause** when arrivals are unavailable;
- `null` unassigned **never prints "0 unowned"**;
- each scope tag rides with **its own** tile, band by band — not merely somewhere in the markup;
- grid dims sub-10-person rows **while still printing the value**;
- `clearedPerHead` **and** `queueCover` draw **no target rule** anywhere — not on the grid, not on the
  bullet chart, not on the queue ruler (D11);
- with no target *and* no publishable norm, all three new metrics print their value and say they have
  no reference — never a bare uncoloured number that looks graded;
- the unowned ruler segment renders a click-through only when unassigned rows are present;
- the shelf lists a below-floor metric and **does not** list a below-gate one;
- the margin gate **omits the capacity band from the DOM entirely** for a non-margin role;
- planning phase drops the period-shaped queue tiles;
- reconstructed sparkline points are marked distinctly from measured ones.

### 6.3 Existing suite

Baseline measured 2026-08-06: `node node-tests.js` all suites pass; `node render-smoke.js` reports
**648 checks passed**. (The README's "488" is stale.) A number of those 648 are pinned to the present
Executive markup and **will need rewriting**. This is a planned task in the implementation plan, not
incidental breakage — and the suite must be back to green, at ≥648 checks, before deploy.

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
7. **Spot-check, in two halves** (§4.6). Record both *before* deploying:

   **Must NOT move** — every one of these is resolved-work or person-keyed, so widening the open
   population cannot reach them:
   - the four KPI cards (On-Time, Forecast, Utilisation, Rework)
   - the signals roster
   - **Roster join, still 100% and still retired from all three surfaces** — if it reappears, the
     `attrN` fix (D12) is missing or wrong, and the number on screen is false
   - the per-person backlog drill-down counts

   **MUST move** — if these are unchanged, the assignee clause did not actually come out:
   - ORG hero ≈ 3,279 items / ~11w, against ≈1,440 / ~4.9w on the assigned sub-row
   - the 🧬 matrix's open half and the gaps queue: `assigned`, `due`, `est`, `region`, `team` all
     **down**
   - the unowned ruler segment drills through to real rows

A single number in the wrong half is a stop. The first list moving means something reached the shared
population; the second list *not* moving means the export did not change.

---

## 8. Out of scope

Named so the implementation plan cannot drift into them:

- Jira `Region` / `Team` custom fields — still blocked on Gon
- Cycle Time and Flow Efficiency — need `FETCH_CHANGELOG`, which is off
- The rework capture path and CSAT — no feed exists
- Immutable baselined due date / estimate (PR-02, PR-03)
- The **Actions** and **Access** tabs — untouched by this work

---

## 9. Open decisions carried forward

| # | Decision | Owner | Note |
|---|---|---|---|
| O1 | Agree a **weeks-to-clear target**, or leave it norm-graded permanently | Services Director | Not a blocker — D11 ships with `target: null`. Until someone owns a bar, the metric is graded against what the org demonstrably does |
| O2 | Agree a **net-flow target**, or leave it norm-graded | Services Director | As O1 |
| O3 | Whether the **26-week bound** on the unassigned count is right, now that it is known to be a floor on dead inventory rather than a total (D8) | Services Director | Raising it surfaces genuinely abandoned tickets; the trade is that abandoned work then inflates weeks-to-clear |
| O4 | **How far the hygiene numbers are allowed to fall** before the open-backlog population is re-narrowed | Delivery leadership | New, from D7. §4.6 makes the open-half fill rates drop by design. If that reads as unacceptable rather than as the finding it is, the lever is `OPEN_BACKLOG_UPDATED_WEEKS`, not re-hiding the work |
