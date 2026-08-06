# Delivery Health Dashboard

A standalone Google Apps Script (GAS) web app for delivery leadership (directs and above). It
answers *what percentage of available delivery hours is logged as billable client work?* —
delivery labor is mostly fixed cost, so each utilization point moves gross margin directly.

Four tiles, one per metrics-dictionary metric, each with a 6-period trend and RAG colour. **As of
2026-08-03 all four compute the Metrics Dictionary formula verbatim** (registry v2.0 — see
[Dictionary conformance](#dictionary-conformance-2026-08-03) for what changed and why every number
moved):

1. **On-Time Delivery Rate** — milestones resolved on or before their due date ÷ milestones resolved
   with a due date. Scope is the Dictionary's: **Epic or Milestone, OR any issue labelled
   `Client Commitment`**.
2. **Utilization Rate** — billable hours ÷ **scheduled capacity (headcount × standard hours)**.
   Tracked time classifies **two ways only: billable and non-billable** — time off tracked in Tempo
   is non-billable by rule (it cannot be charged to a customer project). **No absenteeism is
   modelled** (2026-08-04): capacity is always gross; there is no PTO/holiday deduction and no
   net-of-absence companion rate.
3. **Forecast Accuracy** — **mean of `1 − |actual − estimate| / estimate`** across epics closed in
   the period, floored at zero per epic. Companions: share inside the ±10% band, and the median
   absolute variance.
4. **Quality / Rework Rate** — **(reopened OR Rework-linked) ÷ delivered in period**. Live since
   2026-08-03; **lower is better**, so its target is a ceiling (≤5%) and its RAG is inverted. CSAT
   remains a declared-absent companion (PR-09).

**Confidence still gates, but the cards stopped narrating it (2026-08-05).** Each metric has a
registry coverage gate and `metricConfidence_` still decides publish/suppress exactly as before — but
the per-card chatter (the ◆/◈/◇ confidence chip, the `below gate — directional only` caveat, the
`What's missing →` link) was removed as noise: coverage-vs-gate reads on the **Data trust strip** on
the same Executive view, and *who* can close each gap reads on the **Actions** tab (signals roster +
gaps queue). A metric below its gate is still published (accepted deviation from FR-2.2, owned by the
Services Director, reversible with `CONFIG_DH.SUPPRESS_BELOW_GATE`); the compact flow tiles keep
their chips. See [Data confidence](#data-confidence-and-suppression).

Spec: [`docs/superpowers/specs/2026-07-31-delivery-health-dashboard-design.md`](../specs/2026-07-31-delivery-health-dashboard-design.md).

## Dictionary conformance (2026-08-03)

Before this pass the dashboard and the Metrics Dictionary described **different metrics under the
same four names**. That is worse than either definition being wrong: two people reading one tile
computed two numbers. Registry **v2.0** aligns all four. Every value moves on deploy — the step you
will see in W32 is the definition moving, not delivery moving, and the in-product
`✎ definition changed` marker says so on each trend line.

| Metric | Was | Now (Dictionary) | Effect |
|---|---|---|---|
| **On-Time** | Stories/Tasks, epics *excluded* | Epic **or** Milestone **or** `Client Commitment` label | Rate **and** coverage move sharply — epics have a much lower due-date fill rate, so expect the Data trust strip's due-date tile to drop |
| **Utilization** | ÷ net available (PTO/holidays removed) | ÷ **scheduled capacity** (headcount × standard hours) | Headline falls by the absence share. Since 2026-08-04 the gross rate is the ONLY rate — absence is not modelled at all, and tracked time off counts as non-billable time |
| **Forecast** | share inside the ±10% band | **mean of `1 − |A−E|/E`**, floored at 0 | A different, generally higher number; the band survives as a companion |
| **Quality / Rework** | placeholder tile | `(reopened OR Rework-linked) ÷ delivered` | A tile that has never shown a number starts showing one |

**Nothing was deleted.** Every previous reading survives as a companion figure or a config switch
(`CONFIG_DH.ONTIME_SCOPE` still accepts `delivery` / `epic` / `all`), so the two can be compared
rather than argued about.

### Three deliberate departures from the literal formula

Each is recorded in `METRIC_REGISTRY_.deviations` and surfaces on the tile's ⓘ:

1. **Forecast accuracy is floored at zero per epic.** The raw expression goes negative past a 2×
   over-run (`1 − 2.0 = −100%`), which is not a share of anything — and worse, one runaway
   engagement would drag an otherwise good period below zero. The floor is applied *before*
   averaging.
2. **Epics with an estimate but zero logged time are excluded from the Forecast denominator.** The
   literal formula scores them 0% accuracy, which reports a *worklog* gap as a *forecasting* miss.
   They count toward coverage instead, and the card states how many.
3. **Utilization capacity is summed from each person's scheduled Tempo hours** (40h, 38h ANZ) rather
   than a flat `headcount × 40`. Identical for a full-timer, more accurate for a part-timer, and it
   avoids the manual Capacity sheet in `FIELD_REFERENCE.md` drifting from the roster.

### Still not conformant: Region and Team

The Dictionary's stated prerequisite — *"Every metric rolls up by two custom fields on the Jira
issue: Region and Team… standing them up is the prerequisite step"* — **is not met.** Both fields
export blank, so the dashboard groups by substitutes: person-region from the majority of
region-tagged tracked hours (roster location as fallback — see the Region lens section for the
current gap in disclosing which is which) and Tempo team names.
The numbers are real; *"by Region and Team"* does not yet mean what the Dictionary says it means.
The Executive data-trust strip and the Actions gaps queue both track and trend the gap, with Gon
named against it.

## Navigation — one view per question (2026-08-05)

Everything used to stack into a single scroll, then fanned out into six tabs (2026-08-03) — and an
executive looking for *are we on target* still had to check Flow, People and Hygiene separately to
be sure nothing there changed the answer, while a manager looking for *who needs me this week*
waded through executive KPIs to reach the grid. The **two-tab consolidation** (spec
`2026-08-05-*-design.md`, commits `bcc51c3`…`d05a310`) collapses that into **three tabs**, generated
from the **`VIEWS` array in `Dashboard.html`** — label, pane id and role gate are declared once, and
`buildTabs_()` / `switchView_()` / `renderAll_()`'s dispatch all derive from it. The role gate is
enforced inside `switchView_()`, not just by hiding a tab.

| Tab | Answers | Contents |
|---|---|---|
| 📊 **Executive** | "Are we on target, and where aren't we?" | Tiered KPI strip — 4 hero cards + 5 compact flow tiles — → one **comparison chart** (Region/Team/PM/Job family, now including Lead Time and Throughput chips) → **people-signals pulse** (margin-gated, counts only) → **data-trust strip** (org-wide). The 30-second read. |
| 🎯 **Actions** | "Who and what needs action?" | **Signals roster** (every person, job-title tag, Due/Estimate/Logged/Hours RAG columns, drill-downs) → 🧬 **field-fill matrix** (by issue type) → **gaps queue**. Admin + viewer only. |
| 🔒 **Access** | — | Admin only. |

The filter row sits **above** the tabs and scopes every view — there are no per-chart filters.

**What retired, and where its content moved** — nothing here was deleted outright; each retired tab's
job is answered by something on Executive or Actions:

- 🎯 **Headroom** tab → its opportunity table first moved onto **Actions**, then **retired outright
  (user 2026-08-05)**: the signals roster covers the same people with the same exclusions (and
  inherited the visible job-title tag), and the recoverable-hours figure lives on the Executive
  **people-signals pulse** (see "Recoverable hours" below).
- 🌊 **Flow** tab → its five live cards (Lead Time, Throughput, Backlog, WIP, Bug Count — non-epic
  grain, Backlog/WIP from the exporter's `Flow Snapshots` append log) became the **compact flow
  tier** inside the Executive KPI strip, tagged `SNAP` or `PERIOD` per tile (see "Scope tags" below).
  Its two declared-absent placeholders (Cycle Time, Flow Efficiency — the changelog feed isn't
  exported, `FETCH_CHANGELOG` off) no longer render at all; the registry keeps their record for when
  that feed exists.
- 👥 **People** tab → the triage grid, stacked workload bars, per-person accordions, the attention
  strip and the Focus lens are retired as UI (the underlying `STATE.flag` filter predicate survives
  with no UI entry point — pinned in `render-smoke.js`). Their question — *who needs me this week* —
  is answered instead by the Actions **signals roster**: one row per person, RAG-coded on
  Due/Estimate/Logged fill plus a billable-share Hours column, expandable into a drill-down row that
  carries the same per-person numbers the old workload bars drew (see "Signals roster" below).
- 🧪 **Data Hygiene** tab → its gaps table, the 🧬 by-type matrix and the ⚙ Coverage gates editor all
  moved onto **Actions** unchanged (see "Actions tab: 🧬 field-fill matrix and gaps queue" below).
  Its org-wide fill-vs-gate headline survives as the Executive **data-trust strip** instead of a
  fifth tab (see "Data-trust strip" below).

## Scope tags: PERIOD / SNAP / ORG

Every tile, chip and roster column now carries a scope tag (`scopeTag_(kind)`) stating which clock
it follows — added 2026-08-05 because a tile's own period could silently disagree with the header's
period picker and nothing on screen said so.

| Tag | Meaning | Follows |
|---|---|---|
| `PERIOD` | Analysis period | the header's Week/Month/Quarter picker **and** every filter |
| `SNAP` | Snapshot at the last export | every filter, but **ignores** the period picker — Backlog, WIP and the roster's "Open backlog" population are inventories, not a time series |
| `ORG` | Whole org | **ignores** filters and the period picker — the data-trust strip is a pipeline health check, not a filtered read |

Placement is pinned, not incidental: on the compact flow tier, Lead Time/Throughput/Bug Count each
carry `PERIOD` and Backlog/WIP each carry `SNAP` — `render-smoke.js` asserts the tag rides with its
own tile, tile by tile, not just anywhere in the strip's markup. On the signals roster, the
Due/Estimate/Logged columns follow the roster's own Open/Resolved population toggle (`SNAP` under
Open, `PERIOD` under Resolved), while the Hours column always reads `PERIOD` — worklogs are
period-shaped even when the rest of the row is looking at a snapshot.

## Forward windows: the current period and the next two weeks (2026-08-06)

The analysis-period picker offered **complete periods only** until 2026-08-06. That is right for a
scorecard — an unfinished month graded against a full-month target reads as a collapse on the 1st —
but it left the two questions coaching actually starts from unanswerable: *what is the team on right
now*, and *is the next fortnight planned?* (user request). The picker now has three groups:

| Group | What it offers | Grammar |
|---|---|---|
| **Complete** | every closed period of the active unit. `Latest complete` is still the default | graded exactly as before |
| **In progress** | the current week / month / quarter | published, but **never compared to the period before it** |
| **Planning · next N weeks** | the next ≤2 ISO weeks (`PLAN_WEEKS_AHEAD_`), and only those the payload actually reaches | outcome metrics say so and stay blank; **plan** is what is measured |

**The invariant that makes this safe.** `donePeriods_()` is unchanged and is still the *only* input
to any trend, sparkline or operating rate. `analysisPeriods_()` = `donePeriods_()` + the in-flight
period + the planning weeks, and it keeps **index parity** — for `i < done.length`, `all[i]` *is*
`done[i]` — so the trend anchor is `min(idx, done.length−1)`. A forward window trends the complete
history behind it; it can never trend itself. `analysisHead_()` returns `{head, hi, phase}` and is
the single resolution of "which window is on screen"; the old `headPeriodIdx_(done)` is gone,
because the selected window and the trend anchor stopped being the same thing.

**What each phase changes.**

- `now` — every card wears a `◐ in progress` chip on its hero, and the **vs-prior delta is dropped**:
  two weeks of a month against a whole prior month is a length difference wearing an arrow. The
  target gap *survives* — it judges the number that is actually on the card.
- `now`, utilization only — the rate becomes a **floor** (`opts.floor`, the same grammar the
  link-only rework rate uses): capacity is booked for the whole window while hours have accrued for
  part of it, so it reads "at least N%" and carries no RAG colour. The other three are shares of
  what has *closed*, and a share of a smaller set is still a real share.
- `plan` — On-Time, Forecast and Quality render `—` with "has not happened yet". They are never
  computed over an empty set: 100% on-time for next week would be quoted. The capacity slot becomes
  **Planned Coverage**, `liveMetrics_()` collapses to `planCov` so the comparison chart re-points
  itself, and the roster gains a **Plan** column.
- `plan`, surfaces that need resolved work — the gaps view and the data-trust strip **fall back to
  the last complete period and say so**; the pulse drops recoverable hours (measured on hours already
  delivered) and states planned coverage instead.

### Planned Coverage

`planFor_(isos)` — planned hours ÷ scheduled capacity, over the same population as the utilization
rate (long leave and interns out: neither owes a plan). Planned is **capped at capacity per week
before summing**, because Tempo records a weekly plan *per project assignment* and someone on two
projects otherwise reads as twice their week.

**No target, therefore no RAG colour.** No planned-coverage bar has been agreed, and inventing one
would put a verdict on screen no owner stands behind. What the card carries instead is the
actionable count — `▽ N of M under 50% planned · K with no plan` — because the fix is a conversation
with a person, and 58% does not tell you whether nine people are half planned or four have nothing.
`PLAN_CLIFF_` (0.5) is *not* a new threshold: it is the coverage cliff `personExceptions_` has
flagged people on since 2026-07-31, named once so the tile, the roster column and the triage flag
cannot drift apart.

The roster's Plan column is **conditional on purpose** — over a closed period it would show a plan
nobody can change any more, which is history dressed as an action. `Planned h` / `Capacity h` ship
in the CSV on *every* export regardless, because a header that moves with a dropdown cannot be
appended to.

## Every person is in a bar (2026-08-03)

Team and PM are **membership lists**, and an empty list belongs to no bucket. That silently broke the
Executive comparison chart: someone on no team contributed to no bar and vanished, with nothing on
screen saying the chart described a subset. Ten untagged people out of forty is a chart that is 25%
wrong and looks complete.

An empty list now resolves to an explicit **`(No team)` / `(No PM)`** bucket, and it is a real
selectable value everywhere — filter, dropdown, bar, drill-through — because *"who has no PM?"* is a
question worth asking. It always sorts **last**, however large: it is a data-hygiene bucket, not a
team. Region and Job family are single-valued and already fall back server-side (`Unassigned`,
`Uncatalogued`), so they gain no extra bucket.

Membership matching now goes through one function, `dimMatch_(p, dim, val)`, shared by the filter
predicate, the option counts and the chart's row members — before, each had its own inline
`p.teams.indexOf(...)`, which is exactly how a bucket could exist in a list while matching nobody.

Every comparison chart **states its coverage in words** (`all 42 people represented`, or
`38 of 42 people represented — 4 missing`), counting distinct people because Team and PM membership
overlaps and per-bar counts sum past the headcount. The day a dimension stops covering everyone, the
sentence changes by itself.

## Cascading filters

Region / Team / PM / Job family options are computed from the people who pass every **other** active
filter, so picking `AMER` collapses the Team, PM and Family lists to what exists in AMER, and each
option carries its headcount (`Atlas (12)`). Clearing the filter restores the full lists. Two rules
stop this being annoying rather than helpful:

1. **An active selection is always listed, even at zero** — and stays *enabled*, so it can be cleared
   from the same control that set it. A selection may never silently vanish.
2. **Values with nobody in the current slice are shown disabled** under a `— none in this slice —`
   group, never deleted. A list that changes length under you is how people stop trusting a filter.

A combination that selects nobody is reported **in the filter row** — not discovered three panels
down — naming the single filter whose removal reopens the widest view and how many people that
returns. Implementation: `passesFilters_(p, skipDim)`, `optionsFor_(dim)`, `fillSelect_()`,
`renderFilterWarn_()`.

## Standard rate (the operating norm)

A target says what someone decided; the **operating rate** says what the organisation has
demonstrably done, period after period. A month at 64% against a 70% target is a miss; the same month
against an observed norm of 63% is an ordinary month. Those are different conversations, so both
references are shown — on every KPI card, on the comparison chart as a shaded band, and as the
benchmark the recoverable-hours figure is measured against.

`standardRate_(vals)` in `Dashboard.html`:

- **baseline** = median of every complete period in the window; **band** = ±1 MAD-derived σ
  (`MAD × 1.4826`), floored at ±2 pts. Median and MAD rather than mean and standard deviation so one
  broken export week or one holiday-shortened month cannot move the norm everything else is judged
  against.
- **run length** — consecutive latest periods on one side of the baseline. Four in a row is a *shift
  in the operating rate*, which needs a different response from one bad period, and is detectable
  while every individual point is still inside the band.
- **slope** — least-squares pts per period across the window.
- **Refuses to publish** when: fewer than `STD_MIN_PERIODS` (5) complete periods — it says how many
  more it needs rather than inventing a benchmark; the model is stale (NFR-7); or suppression is on
  and the metric is below its gate (`stdFor_`).
- **Weekly fallback.** The window holds 52 weeks ≈ 11 complete months but only **3** complete fiscal
  quarters, so on the Quarter view a norm built from the displayed unit could never reach the
  5-period minimum. It falls back to the weekly series (always ≥ 40 complete weeks) and **says so on
  screen** — the metric is a rate, so the two are comparable, but an unlabelled change of basis would
  be worse than no rate.

## Recoverable hours (Executive pulse)

"Areas of opportunity" made arithmetic — `oppRows_` in `Dashboard.html`. Per person, for the
analysis period:

```
opportunity_hours = max(0, operating_rate% × their available hours − their billable hours)
```

Hours, not percentage points, because a point is not something anyone can reassign. Floored at zero —
someone above the norm is carrying it, not owed negative work. Excluded by construction, because a
gap there is not an opportunity: people on long leave (roster Employee Status), interns, periods
before someone's hire date, and anyone with no measurable capacity. Ramping new hires come back
flagged and are **left out of the total** — ramping is the explanation, and the total is a call to
act. The norm re-bases on whatever the filters select, so an AMER consultant is compared with how
AMER consultants normally run.

The standalone **"Where the headroom is" table that used to render this per person was retired
(user 2026-08-05)** — the signals roster is the per-person surface now, and the summed figure
survives as the `N h recoverable` clause on the Executive people-signals pulse.

## Signals roster (Actions tab)

One row per person in the filtered population — the roster that replaced the retired People grid.
`renderRoster_()` / `ROSTER_COLS_` in `Dashboard.html`, graded by `gradeSignal_()` off
`personSignalRows_()`, backed server-side by `personHygieneBuckets_()` (schema v22; `loggedN` added
in v24).

| Column | What it shows | Scope tag |
|---|---|---|
| Person | name + job-title tag (grade code stripped for reading, full roster string in the tooltip/CSV — inherited from the retired headroom table, user 2026-08-05), click to expand the drill-down row | — |
| n | issue count behind this row's signals | — |
| Due date | % of this person's issues carrying a due date, RAG-graded against the On-Time metric's own coverage gate | `SNAP` (Open) / `PERIOD` (Resolved) |
| Estimate | % carrying an original estimate, graded against the Forecast gate | same |
| Logged | % carrying logged time, graded against the Forecast gate. **Denominator is STARTED work only** (`loggedN`) — see below | same |
| Hours | billable-share mini-bar (billable / non-billable / idle) for the analysis period, most-billable first | `PERIOD` always — worklogs are period-shaped even when Due/Estimate/Logged are reading a snapshot |

- **Logged time is only expected on work that has STARTED** (schema v24, 2026-08-06). Time is
  logged as work is done, so a ticket nobody has picked up is expected to carry no worklog. On the
  Open population the Logged column divides by the records whose Jira **status category is
  In Progress** (`loggedN` on the roster, `timeN` on the 🧬 matrix — the same tristate idiom as
  `billN`); To Do issues are in neither half and never enter the work queue. Resolved work is
  unchanged: finished work is always expected to carry its cost.
  Measured live on the 26-week open backlog the exporter feeds (1,444 assigned open issues,
  2026-08-06): **782 of the 1,116 flagged rows — 70% — were tickets nobody had started**, and open
  Logged fill read 23% where the honest figure against the started population is 45%. The queue was
  seven times larger than the work in it, which is why none of the 334 real gaps were being cleared.
  · The In Progress **category** is used, not the status name: it holds `In Progress`, `Review`,
  `Blocked` and `Ready`, all of which are work somebody has picked up (`dhStarted_()`, shared with
  the Flow tab's `wip` metric so the two can never disagree).
  · The counterpart gap is **not** measured here: 57 To Do tickets do carry logged time, which is a
  status-hygiene problem (work started, board never moved) with a different owner. Those are
  excluded from both halves rather than scored as logging credit.
- **Shared population with the 🧬 matrix.** The roster and the by-type matrix both follow
  `STATE.typePop` (Open backlog / Resolved), so a reader comparing "who" against "which issue type"
  is comparing the same slice of work, never two independently filtered ones.
- **Small-n guard — `SIGNAL_MIN_N = 4` (`meta.signalMinN`, `signalMinN_()`).** A person with fewer
  than that many issues is shown but never graded red or green: a grey `●` dot, percentage still
  shown, footnoted "ungraded (small n)". One missing due date on one ticket must never render the
  same red as fifteen missing out of forty — that would put someone on a watch list over a single
  record.
- **Grading reuses each metric's own coverage gate** (`SIGNAL_FIELDS_`, same gate the 🧬 matrix and
  the data-trust strip use) — never a separately-tuned threshold, so all three surfaces can never
  disagree about one record.
- **Ramping new hires and on-leave people sort last** on the Hours column regardless of sort
  direction (same exclusion as the recoverable-hours figure), and their mini-bar carries no idle
  segment — their idle time is the explanation, not a coaching signal.
- **Drill-down rows** (click a name, `toggleRosterDetail_`) expand into that person's open backlog
  items by remaining hours (Open population) and the hours line — the People grid's per-person
  detail, reattached where the signal now lives, not deleted.
- **`⬇ CSV`** (`rosterCsvLines_`) exports the same rows — signal values, offending counts, hours
  split — for a deck or a 1:1. **`⬇ PNG`** captures the whole Actions view, matrix and gaps queue
  included.

## Charts

Inline SVG, no library — a blocked CDN request inside the HtmlService iframe would mean an executive
dashboard with no charts in it. The rules, after "charts with no labels tells nothing"
(user feedback 2026-08-03):

- every chart states its units, its axis and its period range;
- values are direct-labelled **selectively** — endpoint, min and max — never on every point;
- reference lines (target, operating norm) are drawn **and labelled inline**, so a number never has
  to be recalled;
- a category with nothing measurable says `no measurable data` and draws no bar — an absent
  measurement is never rendered as a zero;
- marks carry colour, text never does; status always ships a ✔ / ▲ / ✖ glyph beside the value so the
  read survives a monochrome board pack (FR-4.4).

**Chart colours are their own tokens** (`--c-good/--c-warn/--c-bad`, `--seg-*`), separate from the
text colours. Two reasons, both found by measurement rather than eye: the text amber `#B45309` and
text red `#C2410C` are only ΔE 4.1 apart in normal vision and ΔE 0.1 under deuteranopia — fine as
words, identical as two fills side by side; and the bars' billable segment was `--void` (`#0F1941`)
on a `#141C3D` dark surface, i.e. invisible, which is how a manager reads a full bar as an empty one.

## Legends are captions, not controls (2026-08-05)

Every colour swatch across the dashboard is now an inert key (`keySwatch_`) — a caption explaining
what a colour means, never a button that changes what's on screen (user request 2026-08-04: readers
learn colours from legends, not tooltips). That is a **reversal** from the 2026-08-03 design, where
some legends acted: the attention strip's `⚠ N overloaded` filtered the whole People grid — cards,
charts and grid together — and the workload-bar legend's `billable` / `non-billable` / `▼ planned`
entries set a Focus lens. Both the attention strip and the Focus lens it drove **retired with the
People grid** on 2026-08-05. The underlying filter predicate (`STATE.flag`, `toggleFlag_`) still
exists and is still exercised by `render-smoke.js` — the mechanism stays live so it can't silently
rot — but nothing in the current UI calls it; there is no attention-strip button left to click.

Comparison-chart bars keep the rule they were the deliberate exception to under the retired design:
they **report, they don't filter** — clicking one does nothing; scope changes only via the header
filters. Two ways to change scope meant the same question could get two answers depending on which
one was touched last, and that reasoning still holds even though the bars are no longer an exception
among clickable legends — there are no other clickable legends left.

The one legend that still acts is the **people-signals pulse** line (Executive tab): clicking it
opens the Actions tab with the roster pre-sorted by opportunity (`openRoster_()`). It changes which
tab is open, not what scope is on screen, so it is not a filter either.

## People-signals pulse (Executive tab)

One line, counts only, no names — `renderPulse_()`. Visible only when `canSeeMargin_()` (admin or
viewer role) — there is no manager-scoped role on this dashboard today, but the gate exists so a
role added later can't accidentally expose per-person status on the page every audience opens first.

- **Grading comes from `personSignalRows_`** — the exact same field-fill computation behind the
  Actions signals roster, never a second copy. `signalSummary_()` buckets each row into good / warn
  / bad / **small (ungraded)**, and the pulse totals those: `● N on track · ● N watch · ● N need
  action`, plus `● N ungraded (small n)` whenever anyone falls under the small-n guard.
- **Recoverable hours travels with it** — the `oppRows_` total (the retired headroom table's old
  headline), computed over the latest complete period, ramping new hires excluded.
- **Scope tag** follows the roster's own Open/Resolved toggle (`SNAP` under Open, `PERIOD` under
  Resolved) — the pulse and the roster describe the same population by construction, never two
  independently-scoped reads of "how are people doing".
- Clicking the line opens the **Actions** tab with the roster pre-sorted by opportunity
  (`openRoster_()`) — see "Legends are captions, not controls" above.
- **No individual is ever named on this line.** Counts on the pulse, names on the roster — the same
  rule the comparison chart and the gaps queue both follow.

## Data-trust strip (Executive tab, org-wide)

Four fill-vs-gate tiles — Estimate coverage, Due-date fill, Logged fill, Roster join — picked **by
key** from the same `gapsRows_()` definitions that back the Actions gaps queue, so the strip and the
queue can never describe one gap two different ways. A check measuring **100%** retires from both
(see below), so the strip may render fewer than four tiles. Tagged `ORG`: deliberately unfiltered and
period-independent, because a well-tagged slice does not make the whole feed publishable, and this
strip's whole job is the org-wide health check the six-tab design's Data Hygiene tab used to own on
its own screen. Each tile states its value against its own gate and colours red/amber/green off that
comparison, never against 100%; its footnote directs to the Actions tab's gaps queue for the full
list.

### A solved check retires itself (2026-08-06)

User decision: *"we do not need 'assignee resolves to a roster person' as metric, we have solved all
discrepancies so always 100%."*

A check that reads 100% everywhere teaches nothing — it costs width on three surfaces and trains the
reader to skim past the fields that do vary. So it is **hidden, not deleted**:

| Surface | Behaviour when the check is at 100% |
|---|---|
| 🧪 Gaps queue | row drops out (`gapRetired_`), and a `✔ Solved and retired from the queue: …` line names it (`gapsSolvedHtml_`) |
| 🔍 Data-trust strip | tile disappears — it is picked by key from the same filtered list |
| 🧬 Field-fill matrix | the `→ roster` column is removed (`typeFieldRetired_` / `typeFieldsShown_`) and a footnote names it |

- **The measurement never stops.** `Code.js` still counts `attr` (per issue type) and
  `resAttr` (per week) on every rebuild. Only the rendering is conditional.
- **It comes back on its own** — no deploy, no code change — the moment **one** record fails, in all
  three places. Same data-driven idiom as `typeColUniform_` directly above it in `Dashboard.html`.
- **Why hidden rather than deleted.** The roster join is this dashboard's historically dominant data
  loss: 173 of 351 records (49%) on the 2026-08-04 profile. If it regressed with the instrument
  deleted, it would surface as four quietly wrong cards, not as a missing column.
- **A `null` value is not a solved check.** An unconnected feed (Reopen events / CSAT) has nothing
  measured, so it never retires.
- To delete the check outright instead, drop `retireWhenFull` from the `attr` entries in
  `TYPE_FIELDS_` and `gapsRowsAll_()` along with the field itself — but then nothing is watching.

## Files

| File | Role |
|---|---|
| `Code.js` | GAS server — `doGet()` (access-gated) serves the HTML; `getDeliveryData(forceRefresh)` reads Capacity/Tracked/Planned/NS Billable/PH/Jira Raw + Roster by spreadsheet ID, builds the person × week + Jira-bucket model, returns JSON. `buildDeliveryModel_()` is the full compute, shared by the cache-first endpoint and the `warmDeliveryCache()` 30-min trigger (`setupDeliveryCacheWarmer()` installs it). `probeDeliverySources()` and `auditJiraFillRates()` are one-time post-deploy diagnostics. `METRIC_REGISTRY_` is the canonical definition store every tile renders from. 35 `_test_*` unit tests. |
| `Security.js` | Email allowlist (admin / viewer / open-access) — `SEC_DH`, `checkDeliveryAccess()`, `getDeliveryAccessSettings()`, `saveDeliveryAccessSettings()`, `buildAccessDeniedPage_()`. Inherited from the demand dashboard's `Security.js` (itself inherited from `PS Security.js`). |
| `Dashboard.html` | Client — loads cache-first via `google.script.run.getDeliveryData(false)`; ↻ Refresh forces a live read. Three tabs from the `VIEWS` array (Executive / Actions / Access — see Navigation below). Holds the inline-SVG chart kit (`hbarChart_`, `sparkHtml_`), the cascading-filter engine (`passesFilters_(p, skipDim)`, `optionsFor_`), the operating-rate model (`standardRate_`, `stdFor_`), the metric accessor table (`METRICS_`), the recoverable-hours walk (`oppRows_`), the signals roster (`personSignalRows_`, `ROSTER_COLS_`) and the by-type matrix. Per-panel ⬇ Save PNG + roster CSV export. |
| `node-tests.js` | Local Node runner for the pure `_test_` functions in `Code.js` (stubs `Logger`/`Utilities`/cache) — `node node-tests.js`. Also holds the two cross-layer parity suites (`_test_clientParity_`, `_test_confidenceParity_`) that diff the client's copies of `utilFor_` / `metricConfidence_` against the server's. Not pasted into the GAS project. |
| `render-smoke.js` | Renders `Dashboard.html`'s client code against synthetic models and asserts on the HTML — `node render-smoke.js` (488 checks). Covers the rules that live in string concatenation and no unit test can reach: the gate policy both ways, stale models print no delta, an empty period isn't shown as a coverage failure, no individual appears in the gaps queue or the signals pulse — plus cascading option lists, the operating-rate maths, chart labelling and gap handling, tab routing and its role gate, the recoverable-hours exclusions (`oppRows_`), the signals roster's small-n guard and job-title tag, and the three-tab consolidation invariants (exactly `exec,actions,access`, no live render into a retired pane). Not pasted into the GAS project. |

## Data sources

Nine tabs across two spreadsheets. All IDs live in the `CONFIG_DH` block in `Code.js` and can be
overridden via Script Properties without touching code.

| Source | Spreadsheet | Tab | Used for |
|---|---|---|---|
| Capacity | Tempo hours SS (`SOURCE_SS_ID`) | `Capacity Tempo` | Per-person scheduled hours per ISO week; fallback 38h (ANZ) / 40h (else) when a person/week cell is missing |
| Tracked | same | `Tempo Tracked Time` | Tracked hours per person-week. NETSUITE (time-off) keys count **in** tracked and classify as **non-billable by rule** (2026-08-04); `Team` cell; `Key` for the Jira Region join |
| Planned | same | `Planned Time Tempo` | Planned hours per person-week (NETSUITE rows dropped — they plan no project work) |
| Billable | same | `NS Billable` | Daily rows (`Employee`, `Total Billable Hours`, `Non-Billable Hours`, `Date`, …) bucketed to ISO weeks. Supplies the billable **mix** only — hour counts come from Tempo |
| Jira | same | `Jira Raw` | `Region` and `Team` per issue (restored by `Jira Backlog.js` v3.4.0, still exporting blank until PR-01 — read by header name, not index, and normalised through `mapRegionToDh_`), dedup'd on `Key` (the tab holds one row per issue *per week bucket* and `Jira Backlog.js` rewrites it whole on every export, so duplicates differ only in the week label — any row is equivalent); On-Time Delivery (`Due Date`, `Resolution Date`, non-epics only) and Forecast Accuracy (`Original Estimate (sec)`, `Time Spent (sec)`, epic type) |
| Jira Bugs | same | `Jira Bugs` | Bug Count (created/resolved per week) — Jira Backlog.js v3.9.0, noise-filtered |
| Flow Snapshots | same | `Flow Snapshots` | WIP/Backlog trend — one appended row per export run, 52-week retention |
| Roster | Roster SS (`ROSTER_SS_ID`) | `Data` + `Contractors Data` | Population gate — active, Class = Professional Services (Class check skipped for crew) / Department = Services; `Key Location` drives the ANZ capacity fallback and the person-region fallback |

Both spreadsheet IDs are overridable via Script Properties:

```
DH_SOURCE_SS_ID   → overrides CONFIG_DH.SOURCE_SS_ID (Tempo hours + NS Billable + Jira Raw)
DH_ROSTER_SS_ID   → overrides CONFIG_DH.ROSTER_SS_ID (Data + Contractors Data)
```

## Metric formulas

```
capacity   = Capacity Tempo hours; fallback 38h (ANZ) / 40h (else) if the cell is missing
available  = capacity                   — GROSS. No absenteeism is modelled (2026-08-04):
                                          nothing is deducted for PTO, holidays or leave
planned    = planned hours (NETSUITE rows dropped — they plan no project work)
tracked    = ALL tracked hours, time off included
trackedOff = tracked NETSUITE/time-off hours — non-billable BY RULE (no customer project)
projTracked= tracked − trackedOff       — the portion the NetSuite mix classifies
nsBillRaw  = NS Billable "Total Billable Hours" summed over the ISO week   (raw, diagnostic only)
nsNonBillRaw = NS Billable "Non-Billable Hours" summed over the ISO week   (raw, diagnostic only)
billShare  = nsBillRaw / (nsBillRaw + nsNonBillRaw)      — null when NS has no rows that week
nsCov      = NS classified this person-week (billShare exists)
billable   = projTracked × billShare    — NS classifies, Tempo quantifies
nonBillable= projTracked × (1 − billShare) + trackedOff
unclassified = tracked − trackedCov     — project-tracked hours in NS-uncovered weeks
capCov     = capacity, but only for NS-classified person-weeks

billableUtil = billable / capCov        (Utilization tile headline — the Dictionary's gross rate)
trackedUtil  = tracked / capacity       (Utilization tile fallback when NS classifies nothing)
onTime       = resolved ≤ Due Date ÷ resolved-with-Due-Date, per week          (On-Time Delivery tile)
               over NON-EPIC issues only
forecastAcc  = nWithin / n                                                     (Forecast Accuracy tile)
               n       = resolved epics with a non-zero estimate AND non-zero logged time
               nWithin = those where |Time Spent − Original Estimate| / Original Estimate ≤ 0.10
medianVar    = median of |Time Spent − Original Estimate| / Original Estimate  (secondary form)
rework       = placeholder — no formula yet (reopen/CSAT feeds don't exist)
```

## Data confidence and suppression

Every metric is defined once, in `METRIC_REGISTRY_` (`Code.js`) — name, definition, formula, source
fields, grain, target, coverage gate, owner, parameter owner, EBITDA translation method and its
known deviations. The registry ships in `meta.registry` and the client renders labels, targets, RAG
bands, tooltips and the suppressed state from it. **No metric definition lives in presentation
code**; two people reading one tile must be able to compute the same number.

| Metric | Coverage gate | Measured over | Owner | Parameter owner |
|---|---|---|---|---|
| On-Time Delivery | 80% | resolved issues carrying a due date | Delivery leadership | Services Director (target), Delivery leadership (scope) |
| Forecast Accuracy | 70% | closed epics with an estimate **and** logged time | Delivery leadership | Services Director (±10% band) |
| Billable Utilization | 90% | tracked hours carrying a NetSuite classification | WFP | Services Director (target), Delivery + Tempo admin (flag discipline) |
| Quality / Rework | 100% | both feeds live | Delivery + CX | Services Director |
| Delivery Data Attributed | — (it *is* the coverage metric) | n/a | WFP + Gon | Services Director |

Confidence bands (`metricConfidence_`, duplicated verbatim client-side and diffed by
`_test_confidenceParity_`):

| Level | Condition | Behaviour |
|---|---|---|
| **High** ◆ | coverage ≥ gate **and** ≥2 complete periods | published |
| **Medium** ◈ | coverage within 10 pts of the gate, or <2 periods | published |
| **Low** ◇ | coverage more than 10 pts below the gate | published clean (or **suppressed** when `SUPPRESS_BELOW_GATE` is on) — the KPI cards no longer print a below-gate caveat (user 2026-08-05); the Data trust strip carries the gate read |
| *(none)* | nothing in scope | `—` with the reason ("no epics closed in this period") |

The last row matters as much as the third: a quiet week with no closed epics is **not** a data-quality
failure, and rendering it as one teaches people to ignore the gate.

**Suppression is OFF (user decision 2026-08-03, `CONFIG_DH.SUPPRESS_BELOW_GATE = false`).** This is
an accepted deviation from FR-2.2, which calls publishing a low-confidence number a defect. Gating
darkened two of four tiles — On-Time at ~64% attributed against an 80% gate, Forecast at ~23%
against 70% — and took their historical series with them, and a dashboard nobody can read teaches
nobody anything. What protects the reader now (since the cards dropped their coverage narration,
user 2026-08-05): the **Data trust strip** on the same Executive view grades each feed against its
gate, and the **Actions** tab names who and what closes each gap. The reader judges the number
instead of the tool refusing to show it. The entire suppression path is intact behind the flag — set
it to `true` and FR-2.2 behaviour returns with no other change; render-smoke covers both settings.

Two consequences worth knowing before a demo:

- **Forecast Accuracy is built on ~15 measurable epics.** It publishes with no on-card caveat —
  treat it as directional until the estimate and worklog fill rates on the Data trust strip rise.
- **On-Time sits ~16 points under its gate** at roughly 64% due-date fill. Closing ~90 due dates a
  month would clear it honestly.
- **With no NetSuite billable feed the utilization tile relabels itself** to *Capacity Utilization
  (tracked)*. `tracked ÷ capacity` is a different metric from billable utilization and is never
  published under a billable heading.

Coverage is recomputed **under the active filters** — a well-tagged region can be publishable while
the whole population isn't — which is why the gate runs client-side as well as server-side.

## Coverage gates are admin-editable

Admins get a **⚙ Coverage gates** panel on the **Actions** tab, below the gaps queue. "How much
attribution is enough" is a
Services-Director judgement revisited at fiscal period close, and keeping it in code meant it could
only move in a deploy window rather than in the review where the decision is made.

Overrides live in the `DH_GATE_OVERRIDES` Script Property (`{metricId: {gate, by, at}}`) and are
applied over the registry by `registryWithOverrides_()` when the model is built — `METRIC_REGISTRY_`
itself is never mutated, so **Restore** puts the agreed value back exactly. Each row shows the
current gate, the agreed registry default beside it, and a `✎ changed {date}` stamp naming who set
it. `saveGateOverrides()` is admin-gated server-side, busts the cache and forces a reload, because
every tile's confidence state is computed against these numbers.

Lowering a gate is a legitimate decision and a quiet way to make a problem look solved — which is
why the agreed default stays on screen next to whatever it was changed to.

## Vocabulary hygiene: former employees

Tempo stamps each project with whoever led it **at the time**, so the raw PM list keeps people who
have left — 52 of them in the W32 data, several long gone. `filterActiveNames_()` gates the PM
vocabulary against the roster before it reaches `meta.pms`.

The rule is deliberately one-sided: a name is dropped only when the roster shows it **inactive and
has no active row for it**. Anything the roster doesn't know — an external PM, a contractor never
listed, a spelling the join can't resolve — is kept. Guessing that an unknown name is a leaver would
silently delete live work from the filters, which is invisible; a stale chip is merely untidy. A
boomerang rehire has both rows, and active wins.

`readRosterPeople_` records active/inactive status for **every** roster row before the
Department/Class gates, so a PM who sits in Sales or R&D is still recognised as a live person.
`meta.pmsDropped` carries the count (not the names) and surfaces in the PM filter's tooltip.

## Chart sizing

Horizontal comparison charts grow downward with the category count, and `height:auto` on a
100%-wide SVG multiplies that growth by the container width. At 52 PMs the chart ran several screens
deep with one row legible at a time. Two independent caps:

- `.chart.hbar { max-width: calc(760px * var(--scale)) }` bounds the scale factor, so a row is
  always ~30px however many there are.
- `HBAR_MAX_ROWS_` (12) bounds the row count **by default**. **Which** rows survive is chosen by
  distance below target, not list position — taking the head of a best-first list would have shown
  the healthiest categories and hidden every problem. The chart states what it left out and offers
  **Show all N** (`STATE.compareAll`), because a cap that can't be lifted turns "too long to read"
  into "the data isn't there" — a team missing from a chart reads as a team missing from the feed.

The history **line chart was removed entirely** (user 2026-08-03). Each tile already carries a
sparkline plus a vs-target and vs-prior read, so a second, larger telling of the same series was page
weight rather than a second answer. `lineChart_`, `valuesTable_`, `stdSentence_`, `defChangeNote_`
and their CSS went with it.

## Actions tab: 🧬 field-fill matrix and gaps queue

The attribution counts that used to sit on the cards as grey caveat text, then had their own
six-tab-era 🧪 Data Hygiene tab, now live on the **Actions** tab, below the signals roster
(`renderHygPanel_()` → `#hygPanel`): the 🧬 **field fill by issue type** matrix (`typeMatrixHtml_`,
reading order deliberately matrix-first — which type to go fix), the 🧪 **gaps queue** below it (a
table of every gap with its coverage, gate and what it blocks, with a **"Coverage colour —"** legend
so a reader learns the grading from the key, not a tooltip), and the ⚙ **Coverage gates** editor for
admins. The Executive **data-trust strip** carries this panel's org-wide headline forward onto the
30-second read (see "Data-trust strip" above) so the fill-vs-gate
question no longer needs a fourth/fifth tab of its own to be seen at all.

> The 🔬 Data Profile funnels, the 📄 Brief and the 🧪 WHAT-IF simulation were removed 2026-08-05
> (user decision): the gaps table and the 🧬 by-type matrix carry the what-to-improve story on
> their own.

The **"% of delivery work fully attributed" KPI tile was deleted** (user decision 2026-08-04): the
composite — pinned by the org-wide-empty Region field (PR-01) — mostly restated its own binding
constraint, and the gaps table below remains the per-component read.

Deliberately **unfiltered** — hygiene is a whole-population question, and a well-tagged region slice
doesn't make the feed publishable. Every below-gate tile links straight into it.

**No Owner column** (user decision 2026-08-03) **and no Prereq / Target-week columns** (user
decision 2026-08-04). Accountability and scheduling are tracked in the requirements doc. A standing
table of names against failures in a widely-read view reads as a blame board rather than a work
queue, and that is not what gets Jira tagging fixed. The registry still records `owner` and
`paramOwner` per metric — it just isn't rendered onto a card.

**Which window it covers.** The **last complete period** of whatever unit the header's
Week / Month / Quarter chips are set to — never an in-flight period, which would read as a hygiene
collapse when it's really a period that hasn't finished. The view states its window in the header
strip and again in the footnote, and **◀ ▶ walk the history** one period at a time. **Σ All history**
sums every complete period in the export window (52 weeks) for the whole-picture number. Switching
the header unit resets the position to the latest period, because "3 back" means a different window
in weeks than in quarters.

**Two composites, on purpose.** The headline (`resFull`) is the strict definition — due date **and**
roster assignee **and** region. It also shows `resReady` — due date **and** roster assignee, region
excluded — as *"Excluding region: N% are measurable today"*. The strict number keeps the target
honest; the second is the bar today's published metrics actually clear.

> **⚠️ Correction, 2026-08-04.** This section used to say the Region field was "unpopulated
> org-wide", pinning `resFull` at 0%. **That was wrong.** Jira's `Resource region`
> (`customfield_10047`) is a **multi-select**, and the Jira Raw exporter read `.value` off the
> returned *array* — always `undefined` — so every tagged issue exported blank. **34% of the
> resolved delivery work in this dashboard's 52-week window carried a region all along**
> (4,158 of 12,082). Fixed in `Jira Backlog.js` **v3.7.0**; `resFull` can now move.
>
> Scope any figure you quote — tagging is **declining**, so the window decides the answer:
> **34%** across the 52-week window, **17%** in the last 90 days, **10%** on open backlog rows.
> The open backlog is the worst-tagged half and the only half where fixing a tag moves a future
> number. The wrong diagnosis survived two releases
> because `probeRegionTeamFields()` called the same broken reader and dutifully reported 0% — a
> probe that shares a bug with the code it checks confirms the bug, not the data.

Server side, `hygieneBuckets_` counts over the **raw** Jira feed rather than the metric buckets: the
metrics drop issues whose assignee doesn't join the roster, so coverage measured after the join would
flatter itself by excluding the very records that are the problem.

### Metric caveats (read before quoting a number)

- **On-Time scope is a policy switch — `CONFIG_DH.ONTIME_SCOPE`.** Before 2026-08-03 the rate mixed
  every resolved issue type together, which is the one reading nobody wants: an epic's Due Date is a
  programme milestone set by the PM and its resolution trails its last child, so epics and
  Stories/Tasks measure different lifecycles — and epics' much lower Due-Date fill rate also inflated
  the coverage denominator, making hygiene look like a delivery miss.

  | Value | Covers | Use when |
  |---|---|---|
  | `"delivery"` *(shipped default)* | non-epic issues — Stories/Tasks | the rate should mean "did the team hit its own commitments" |
  | `"epic"` | epics only | the Metrics Dictionary reading — milestone-level client commitments |
  | `"all"` | every resolved issue | comparison with the pre-2026-08-03 number only |

  **Known deviation from the dictionary (user decision 2026-08-03).** The Metrics Dictionary
  (owner: Bill) asks for Epic/Milestone or Client-Commitment-labelled items — i.e. `"epic"`. We ship
  `"delivery"` deliberately: it's the rate a delivery manager can act on. Raise it with Bill as a
  *dictionary* question rather than switching silently. The tile names its own scope (`N of M
  resolved issues had a due date ⓘ`) so the number can't be misread either way. Changing the switch
  changes the metric's meaning: bump `DH_SCHEMA_VER_` and run `bustDeliveryCache_()`.
- **On-Time ≠ SLA compliance.** "On time" means *resolved on or before the Jira Due Date*, which the
  PM sets. For Managed Services engagements the contractual SLA date can differ. Contractual SLA
  compliance is a separate metric and is **not** measured here.
- **Forecast Accuracy skips zero-worklog epics.** A closed epic with an estimate but no logged time
  used to score 0% — the worst possible accuracy — so Jira time-tracking hygiene (time logged on the
  children only) was being reported as a forecasting failure. Nothing is measurable there, so it now
  counts toward coverage only and the card states the count.
- **Forecast Accuracy is a ±10% band, not an accuracy score.** Until 2026-08-03 it averaged
  `1 − |actual − estimate| ÷ estimate`. That form was retired: it is symmetric in score but asymmetric
  in meaning (a 50% over-run and a 50% early finish lost identical points, and those need opposite
  conversations), it floors at 0 so a 3× and a 10× over-run read the same, and averaged over ~28 epics
  it produced a decimal nobody could act on. The published number is now the share of closed epics
  landing **within ±10%** of estimate, with the **median absolute variance** as the secondary form —
  the band answers "are we hitting estimates?", the median answers "by how much are we off?".
  The band width is a registry parameter owned by the Services Director (open decision #9: is ±10%
  right at 40h-week granularity, and should it vary by engagement type?). Changing it changes the
  metric's meaning — add a `METRIC_REGISTRY_.changeLog` entry and bump `DH_SCHEMA_VER_`.
- **Forecast variance has a direction.** The same accuracy reads identically whether a team over-runs
  or closes early — over-runs burn margin, under-runs mean capacity was held that could have been
  sold. The card splits the **misses** into over-run vs under-run ("of 12 misses, 67% over-run").
  Epics inside the band are on target, so which side of centre they sat is noise.
- **Estimates and due dates are both mutable.** On-Time measures against the Jira `Due Date` and
  Forecast against `Original Estimate`, either of which can be edited mid-flight. A re-baselined
  milestone reads as on time; an estimate revised toward the actual reads as accurate. The immutable
  baselined fields (PR-02, PR-03) do not exist yet — both gaps are recorded in the registry's
  `deviations` and surfaced on the tiles' ⓘ.
- **Blank region ≠ "Other".** Jira `Region` values are normalised at ingestion (`mapRegionToDh_`) to
  AMER / EMEA / SEA / ANZ / **Global** / **Other** / **Unassigned** (issue tokens — the filter chips
  are the geographic four plus Other). `Other` is a value we haven't
  mapped — extend `JIRA_REGION_TO_DH_`. `Unassigned` is a tagging gap (PR-01), counted and trended
  on the Actions tab's gaps queue rather than folded into a real region's total. About **two thirds is
  still Unassigned** over the 52-week window (worse on recent and open work — see the correction
  above), and person region continues to resolve from the roster for anyone with no tagged
  hours. Two things worth knowing about the vocabulary (both verified against live Jira 2026-08-04,
  which closed open decision #1):
  - **`Global` is a real token, not a mapping failure — but NOT a filter chip (removed 2026-08-05).**
    Jira's `RR07 Global` is the single most common tag. At issue level it is neither folded into a
    geography (that would invent delivery presence) nor blanked (that would file a deliberate choice
    as "nobody tagged this") — it counts as *tagged* in the Actions gaps queue. The region filter, however,
    filters **people** (every metric bucket is keyed by person, and a person's region is geographic
    only), so a Global chip could never match anyone and sat at 0 across the whole dataset.
    Global-tagged work rolls up under its assignee's geographic region.
  - **The RRnn labels are not what anyone guessed.** `RR02` is Latin America (not EMEA), `RR03` is
    Europe (not APAC), `RR04` is Australia. The full live list is RR01 North America, RR02 Latin
    America, RR03 Europe, RR04 Australia, RR05 South East Asia, RR07 Global, RR08 Asia, RR09 Africa.
    A label mapped to the wrong continent is invisible — the chip still looks like data.
  - **There is no APAC bucket (retired 2026-08-05, reviewer feedback).** APAC is a superset of ANZ
    and SEA, so an APAC chip next to an ANZ chip contradicted itself. `RR05 South East Asia` maps to
    **SEA**, and `RR08 Asia` (4 issues site-wide) folds into SEA because this org's Asia delivery hub
    is the SEA hub. Legacy `APAC` tokens from a pre-v3.8.0 export sheet are read as SEA.
  - **~3% of tagged issues carry two or three regions** and export as a compound token
    (`"AMER | SEA"`), which lands in `Other` on purpose: charging shared work to one region would
    misstate both.
- **Utilization divides by GROSS scheduled capacity — no absence deduction, ever.** No absenteeism
  is modelled (2026-08-04): the data carries no absence signal in planned time, tracked time, PTO or
  leave feeds, so nothing is netted out of the denominator. Time off someone tracks in Tempo counts
  as non-billable time.
- **Interns (job-title level I1) never move a published rate** (user decision 2026-08-04): they are
  in training, not delivery capacity, and a metric must never read as a verdict on an intern. They
  are excluded from utilization (both sides), the issue rates (their buckets leave n AND nAll),
  triage flags, recoverable-hours rows and RAG cell tints — but their profile and hours stay fully
  visible on the signals roster, marked **🎓 intern**, and the Utilization card states "N interns
  excluded".
- **Backlog "est. remaining" is Jira-sourced.** `Original Estimate − Time Spent`, both from
  `Jira Raw`. Tempo is the authoritative time source, so an issue whose hours went into Tempo but
  never mirrored into Jira reads as more remaining work than there is. Planning signal, not a
  committed number.
- **NetSuite classifies, Tempo quantifies — the split is a ratio, not a pair of hour counts.**
  Tempo tracks every hour worked but cannot say which are billable; NetSuite knows the
  billable/non-billable mix. So the NS mix is applied as a **proportion of the Tempo
  project-tracked total** (`billable = projTracked × billShare`); tracked time off skips the mix and
  lands directly in non-billable. Two consequences worth knowing:
  - `billable + nonBillable === tracked` **by construction**, so `billableUtil` can never exceed
    `trackedUtil`. Before 2026-08-03 the dashboard carried NS *absolute* hours over a Tempo
    denominator, and because the feeds are independent nothing bounded the numerator — a person with
    20h tracked and 32h NS-billable reported 80% utilization on 20h of logged work. That inflation
    reached the hero tile, the trend sparkline, the ▲/▼ delta, every rollup, and the grid tint.
  - The mix is **extrapolated** over the whole tracked total. Where NS captured only part of a
    tracked week, the classified portion's mix is assumed to represent the rest. That is the intended
    model, but it *is* an assumption, so the drill-down states the two feed totals side by side
    whenever they differ by more than 0.5h and names the share being applied.
- **A person-week NetSuite never classified is `unclassified`, not 0% billable.** It keeps its tracked
  hours (so `trackedUtil` is unaffected) but leaves **both** sides of the billable rate — its
  availability is excluded from the denominator via `availCov`. Otherwise an export that lags or
  covers a shorter window than the trend would paint real zeros, and the sparkline would show a ramp
  that is pure coverage. Before the People-grid retirement (2026-08-05) these hours got their own
  hatched bar segment and legend entry on the grid; today the disclosure is the Actions gaps queue's
  "Billable / non-billable classification on tracked hours" row (`N h of M h unclassified`) — the
  number survives, the dedicated visual segment does not.
- **Check `meta.nsCoverage` before quoting the utilization number.** It reports classified
  person-weeks, `classifiedPct` of tracked hours, the `gapHours` reconciliation total between the two
  feeds, and any NS employee names no roster alias resolved (`unmatchedRows` / `unmatchedNames`) —
  an unresolved name classifies nothing, which used to look exactly like a person who billed nothing.
  (The Utilization card's own `⚠ classification covers N%` line was removed with the rest of the
  card's data-quality narration, user 2026-08-05 — the gaps queue row above is the disclosure.)

`NS Billable` unreadable → the Utilization tile falls back to `tracked/capacity` and relabels
itself *Capacity Utilization (tracked)*; the signals roster still renders. `Jira Raw` unreadable → On-Time Delivery
and Forecast Accuracy show "Jira data unavailable"; Utilization and the roster are unaffected.
Roster unreadable is the one **fatal** error (population and Region can't be derived without it).

### 🧬 Field fill by issue type (all roles)

The gaps table says *how much* is missing. This says **which issue type to go and fix**, which
is a different question with a different reader — the gaps table belongs to whoever owns the
metric, this belongs to whoever owns the tickets. Hence all-roles.

**Two populations, one toggle, and Open is the default.** A due date added to an open ticket
moves next period's number; one added to a closed ticket is archaeology.

| Population | What it answers | Period picker |
|---|---|---|
| **Open backlog** (default) | where to spend effort now | ignored — a backlog is a snapshot, not a time series |
| **Resolved** | why today's cards read the way they do | follows it, like every other surface |

Rows are ordered by **recoverable impact** — records missing the field, counted only where that
field gates a published metric for that type. Not by worst percentage: 270 missing due dates on
Sub-tasks score **zero**, because under the dictionary On-Time scope a Sub-task's due date gates
nothing, while 4 missing on Go-live epics are the whole On-Time gap. Non-gating cells render `—`
rather than red for the same reason — grading them sends someone to fix records that move no
number.

Two rules that keep the table honest:

- **`gatesOnTime` comes from `onTimeInScope_`**, the same predicate the metric uses, never a
  second copy. Change `ONTIME_SCOPE` and this table re-marks itself.
- **A column identical across every type is shown ungraded**, footnoted as one org-wide field
  gap. Region and Team are blank everywhere (PR-01), so grading them painted two red cells on
  every row and drowned the real findings. This is computed from the data (`typeColUniform_`),
  not hardcoded — the day Region starts varying by type it grades itself again with no code
  change.

Layout rules, all of them load-bearing:

- **Every column right of the type name is right-aligned, header included.** The first cut left
  headers default-left over right-aligned values, which put each label over the gap between two
  columns instead of over its own data — it looked misaligned because it was.
- **Each cell carries a fill bar** under the percentage. Nine columns of bare numbers have to be
  read digit by digit; the bars make a row's shape readable at a glance. Same labelled-bar idiom
  as the gaps table.
- **The bars use the chart tokens (`--c-good`/`--c-warn`/`--c-bad`), never the text ones.** In
  dark mode `--warn` and `--amber` are the same hex — survivable for words, where `✔ ▲ ✖` still
  separate them, and fatal for a bar, where colour is the only channel. Pinned by a render-smoke
  assertion on the CSS itself.
- The type column is **sticky**, so a horizontal scroll never leaves a row of numbers with
  nothing naming it, and epic-family rows carry an **`EPIC` tag** — being pooled into the
  epic-grain metrics is the finding, so it is on the row, not just in a tooltip.

Failing issue keys still travel in the payload (`keys` per field per type, capped at
`TYPE_HYG_MAX_KEYS_` = 500 with `keysCapped` flagged) and back the per-cell miss tooltips.
The CSV export was removed 2026-08-04 at the user's request; `⬇ PNG` saves the table for a deck,
with the population chips inside the capture — Open and Resolved look alike, so a matrix with no
population label is unreadable out of context.

> **Why this table exists at all.** `readJiraRaw_` sets `isEpic` with a substring match on
> `"epic"`, so **`Kick-off epic` and `Go-live epic` already sit inside the On-Time dictionary
> scope and the Forecast denominator**, pooled invisibly with plain `Epic`. Every epic-grain
> number the dashboard publishes is an average across three semantically different work objects,
> and until this table nothing said so. Run `probeDeliverySources()` to see the real type
> vocabulary — it logs which types the substring rule sweeps up and whether a `Milestone` type
> exists at all (DATA-BLOCKERS #5).

Spec: `docs/superpowers/specs/2026-08-04-hygiene-by-issue-type-design.md`.

## Region lens

The standard region for every tile is the **issue-level Jira `Region` field** (`Jira Raw` col 32,
decided 2026-07-31, superseding an earlier Roster-Key-Location-only design):

- **Jira tiles** (On-Time Delivery, Forecast Accuracy) group directly by each issue's `Region`.
- **Person-level Region** (Utilization tile + the signals roster/comparison chart) = the region
  receiving the **majority of that person's tracked hours** in the trend window — tracked rows carry
  an issue `Key`, joined to `Jira Raw`'s `Region` for that `Key`. Ties break alphabetically
  (deterministic).
- **Roster fallback:** a person with no region-tagged tracked hours falls back to their Roster
  `Key Location` bucket (`CONFIG_DH.LOCATION_REGION_MAP`, unmapped locations → `Other`) —
  server-side, `region.source`/`regionSource` is stamped `"roster"` on that person and covered by
  `_test_regionMap_`/`_test_personRegion_`. **⚠ No client-side marker surfaces this today.** Before
  the People-grid retirement (2026-08-05) a **◦** next to the name disclosed a roster-derived region
  so it was never silently presented as Jira-sourced; the grid retired with the consolidation and no
  equivalent marker was added to the signals roster or the comparison chart. The data is correct and
  tested — the disclosure UI is a gap, not yet re-attached anywhere.
- **Empty-region rocketeers → EMEA** (user decision 2026-08-04,
  `CONFIG_DH.PERSON_REGION_DEFAULT`): a person with **no** region signal at all — no Jira-tagged
  hours and a **blank** roster location — lands in EMEA, never in `Other`. `Other` stays reserved
  for a real location the map doesn't know yet, so that discomfort remains visible.

## Team filter semantics

Filter values are the **individual Tempo teams** — the `Team` column on Tracked/Planned rows is
pipe-joined (`"Team A | Team B"`); `splitTeams_()` splits, trims, and dedupes into the dropdown's
individual options (plus "All"). A person matches a team filter by **membership**: someone on
`Team A | Team B` appears under either selection, contributing their **full** hours to each.
Consequently **team rates do not sum to the All total** — this is by design (utilization is a
rate, not an additive count) and is called out in the dashboard's ⓘ note under the tiles.

## Access control (`Security.js`)

Same three-layer model as the other GAS dashboards in this repo (`SEC_DH`), scoped to delivery
leadership — no manager org-tree scoping:

- **Bootstrap admin** (`SEC_DH.BOOTSTRAP_ADMIN`) — always Admin, not removable via the UI.
- **Default admins / viewers** (`SEC_DH.DEFAULT_ADMINS` / `DEFAULT_VIEWERS`) — code-level, always
  active. Edit these for permanent leadership stakeholders.
- **Runtime admins / viewers** — Script Properties `DH_DASH_ADMINS` / `DH_DASH_VIEWERS`
  (comma-separated), additive on top of the defaults. Managed from the dashboard's **🔒 Access**
  button (admins only) → add/remove emails, toggle Open Access, Save. Backed by
  `getDeliveryAccessSettings()` / `saveDeliveryAccessSettings()`.
- **Open access** — `SEC_DH.OPEN_ACCESS_DEFAULT` (default `false`) or `DH_DASH_OPEN_ACCESS`. Set
  `true` only for an all-hands/demo, then flip back — a stored property overrides the code
  default, so check the 🔒 panel if access ever seems too open.

Enforced **server-side** in both `doGet()` (denied users get a minimal "access restricted" page)
and `getDeliveryData()` (returns an error model) — defense in depth, never client-only.

## Export window (why the period views have the depth they do)

Every period view is capped by the export behind it, so the four exporters and this
dashboard share **one dial**: `EXPORT_HISTORY_WEEKS` in `TempoPlanExport.js` (**52**), mirrored by
`CONFIG_DH.WEEKS_PAST_DEEP`. Before 2026-08-03 each exporter had its own fixed anchor date, which
meant three separate problems: the windows grew by a week every week (so trigger runtime crept up
until an export would eventually time out), `TempoPlanExport`'s `TO_DATE` was a hard `2026-12-31`
stop that would have exported nothing from 2027, and the depth on offer (10–18 weeks) was well short
of what Monthly and Quarterly need. All four are now **rolling** — derived from today, bounded, and
Monday-aligned by construction.

A period only counts toward a trend when it is **complete**, and a window's oldest period is always
truncated — so usable depth is *not* `weeks / 13`. Measured worst case (running in the last week of
a quarter, `_test_periods_` guards this):

| `WEEKS_PAST_DEEP` | Complete quarters | Complete months | |
|---|---|---|---|
| 30 | **1** | 6 | Quarterly unusable — one data point, no trend, no vs-prior delta |
| **52** | **3** | 11 | **current** — every period view has a real trend |
| 65 | 4 | 14 | Full-year / quarter-vs-same-quarter-last-year |

Stopped at 52 rather than 65 deliberately: 52 weeks of one person's worklogs still fits inside
Tempo's single 500-result page, so the Tempo exports stay at **one request per person**. 65 tips
typical users onto a second page, doubling request count and with it the transient-500 exposure
those exports already retry around.

**Cost is flat in weeks for three of the four**, which is why the jump from 30 was affordable there:
`TempoTrackedTime` and `TempoCapacityTime` paginate *per user* over the whole range, and
`Jira Backlog.js` does **one** broad JQL and buckets by resolution date client-side (each issue
resolves once, so it lands in exactly one week bucket — rows track issue count, never weeks × issues).

⚠️ **`TempoPlanExport.js` was the exception** — its pass 2 (`groupPlansByWeekScoped_`) needs per-week
accuracy and so issues one request per **(week × user)**, O(weeks × users). Pointing its *fetch*
window at 52 weeks produced **10,532 requests and an ~18-minute run** (66 weeks × 228 users), against
~7,300 at the old 32-week window.

**Fixed with freeze-and-merge (2026-08-03), the same pattern `TempoCapacityTime.js` uses.** A
completed week's plan is *history and never changes*, so the sheet is the system of record for it and
each run only week-scope-fetches a small refresh window:

```
fetch window  = REFRESH_PAST_WEEKS (2) + current + FUTURE_WEEKS (5) = 8 weeks
sheet window  = RETAIN_HISTORY_WEEKS = the shared dial (52 weeks)
```

| | requests | est. run | planned history |
|---|---|---|---|
| 52-wk full rebuild (the 18-min run) | 10,532 | ~18 min | 4 quarters |
| 18-wk full rebuild (interim) | ~3,830 | ~6.5 min | ~1 quarter |
| **8-wk refresh + merge (now)** | **~1,277** | **~2 min** | **3 quarters** |

So it is **3× cheaper than the interim fix and 8× cheaper than the run that started this**, while
finally carrying the same depth as the other three. History depth is now free, so
`RETAIN_HISTORY_WEEKS` tracks the shared dial like everything else.

- **Freeze rule:** weeks outside the refresh window keep their stored value untouched. Weeks inside
  it are *fully replaced* — absent from the fetch means **0**, so a plan deleted in Tempo actually
  disappears instead of lingering. Rows missing from the fetch keep their frozen history.
- **`backfillPlanHistory()`** is the one-time manual fill for a new sheet, or after the dial is
  raised. It widens the fetch window to the full retention depth for a single run (~16 min) and is
  deliberately **not** on a trigger. Normal runs never pay that cost again. The run logs a reminder
  when it finds no stored history.
- All existing integrity checks (pass-1/pass-2 parity, the person-parity repair) still operate on the
  one fetch window, so they compare like with like exactly as before; frozen history sits outside
  their scope.
- A pre-flight projection logs the worst-case request count *before* fetching, with a
  `WEEK_SCOPED_WARN_REQUESTS` guard — 10,532 requests should be visible in the first seconds of a
  run, not inferred from a log line minutes in.

Two Jira-side details worth knowing:
- `Jira Backlog.js` keeps **two** windows. `RAW_HISTORY_WEEKS` (52) drives `Jira Raw`, which the
  dashboards read; `WEEKS_BACK` (4) still drives the `Exec Q&A` WoW sheet, which is one column per
  week and has no reader for deep history. Both are cut from the same single fetch.
- `EPIC_EXPAND_WEEKS` (13) bounds epic expansion, the one part of that export whose cost *does*
  multiply (each epic fans out to its child tree). Children of programmes closed 10 months ago
  added rows nobody reads. **This is a behaviour change** — expansion previously followed the whole
  window. Raise it if a consumer needs older trees, and watch the row count.

### Changing the depth
Order matters — **exports first, dashboard second.** If the dashboard asks for weeks the exports
don't carry, those weeks come back empty and render as *zero activity*, not as missing data.
1. Raise `EXPORT_HISTORY_WEEKS` in `TempoPlanExport.js`.
2. Re-run the exports once by hand: `fetchTempoLoggedTime`, `fetchTempoCapacity`,
   `runJiraEpicTracker`, then **`backfillPlanHistory()`** (not `fetchTempoPlannedTime` — the normal
   run only refreshes 8 weeks and would leave the newly-requested older columns empty). Capacity is
   merge-based too, so a deepened floor triggers one deep re-fetch and then converges back to the
   cheap forward-only path. Budget ~16 min for the plan backfill; the rest are minutes.
3. Raise `CONFIG_DH.WEEKS_PAST_DEEP` to match, bump `DH_SCHEMA_VER_`, redeploy, `warmDeliveryCache()`.
4. Check `previewWeekWindows()` (Jira) and `probeDeliverySources()` agree on the span.

## Cache

`getDeliveryData()` caches its JSON response in `CacheService.getScriptCache()` via
`cachePutLarge_()` / `cacheGetLarge_()`: the JSON is gzipped and split into 90 KB chunks
(`<key>_0..n` + `<key>_meta`), because CacheService rejects any single value over 100 KB. A
missing chunk on read is a clean cache miss (recompute), never an error. TTL is
`CONFIG_DH.CACHE_TTL_SEC` (65 min).

Cache key: `dh_v<DH_CACHE_VER>` — `DH_CACHE_VER` is a Script Property (default `1`).
`bustDeliveryCache_()` bumps it, stranding the prior-version entry (CacheService can't enumerate
keys, so versioning is how a model-shape change takes effect immediately). Run it manually from
the GAS editor after any change to the model's shape.

Second, independent guard: every payload is stamped with `DH_SCHEMA_VER_` (**currently 9**) and
`getDeliveryData()` treats a cached model with a different stamp as a clean miss. **Bump
`DH_SCHEMA_VER_` on any payload-shape change** — a new/renamed field, a re-keyed bucket — so a
deploy can never serve a stale-shaped entry even if nobody remembers to bust the cache.

| Schema | Change |
|---|---|
| 4 | PTO read from Accumulation Cost (`meta.ptoSource`) |
| 5 | On-Time excludes epics; forecast buckets gain `nNoTime` / `nOver` / `nUnder` / `lossOver` / `lossUnder` and skip zero-worklog epics |
| 6 | `WEEKS_PAST_DEEP` 30 → 52. Shape unchanged, but a cached v5 model holds only 34 weeks of `people[].weeks`, so the Quarterly view would render its older quarters empty — which reads as zero activity, not missing data |
| 7 | `billable` / `nonBillable` are the NS mix applied as a **ratio** to Tempo tracked hours, not NS absolute hours. Adds `nsCov` / `availCov` / `trackedCov` / `billShare` / `nsBillRaw` / `nsNonBillRaw` per week + `meta.nsCoverage`. **Must** force a rebuild — a cached v6 model would keep serving the inflated absolutes against the wrong denominator |
| 9 | `hygieneBuckets` gain `resReady` (due date + roster assignee, region excluded). Added because the headline was pinned at 0% — believed then to be an unpopulated Region field, actually the exporter's multi-select bug (fixed 2026-08-04, `Jira Backlog.js` v3.7.0). Both composites stay: strict vs published-metrics |
| 8 | Forecast Accuracy re-formulated to the ±10% band: buckets lose `sumAcc` / `nOver` / `nUnder` / `lossOver` / `lossUnder` and gain `nWithin` / `absVars` / `nMissOver` / `nMissUnder`. Adds `hygieneBuckets` + `meta.registry` / `meta.sources` / `meta.forecastBand` / `meta.refreshEveryMin`, and normalises Jira Region at ingestion. **Must** force a rebuild — a cached v7 model has no `nWithin` anywhere, so the forecast tile would render 0% |
| 14 | **No-absenteeism model (2026-08-04).** `weeks[]` lose `pto` / `hol` (`avail === cap`, gross); tracked NETSUITE/time-off hours count IN `tracked` and classify directly as non-billable (`trackedOff` added); planned time-off rows dropped; `meta.ptoSource` gone. A cached v13 model still nets absence out of the denominator, so it must miss cleanly |
| 16 | **Export freshness (2026-08-04).** `meta.dataAsOf` = `{ jira, jiraAgeH, jiraStale, jiraUnknown }` + `meta.jiraExportStaleH`, read from the Jira Raw `"Generated:"` footer. Also stops the two export footer rows being ingested as pseudo-issues. A cached v15 model has no `dataAsOf`, so the header would report "unknown" on an export that has a perfectly good stamp |
| 18 | **Attrition excluded from every rate (2026-08-04).** A former employee's issues are filtered out before any bucket is built; adds `meta.leaverExcluded`. **Supersedes v13**, which counted that work so it would stop reading as "unattributed". Every issue-based number moves, so a cached v17 model must miss cleanly |
| 17 | **Field fill by issue type (2026-08-04).** `typeHygiene = { resolved[], open[], keyCap }` — per-type field fill over both populations, with the failing issue keys per gap. Needs `type` / `typeLabel` / `key` / `status` on the ingested record, which v16 never carried. A cached v16 model renders the matrix empty, and **an empty matrix reads as "no gaps"** — the exact opposite of the truth — so it must miss cleanly |
| 19 | **APAC retired (reviewer feedback 2026-08-05).** Region vocabulary is now AMER/EMEA/SEA/ANZ/Global/Other: `RR05 South East Asia` and `RR08 Asia` map to SEA (APAC is a superset of ANZ+SEA, so an APAC chip and an ANZ chip contradicted each other), and the Malaysia/Singapore/Philippines roster locations follow. `assignPersonRegion_` also stops letting Global/Other hours vote, so Global-heavy rocketeers keep a geographic home ("ANZ has no members"). A cached v18 model carries APAC people/buckets and an APAC chip, so it must miss cleanly |
| 20 | **Global chip removed (user report 2026-08-05: "Global shows 0 for the whole data").** Region chips filter PEOPLE — every metric bucket is keyed by person — and once Global/Other stopped voting in `assignPersonRegion_` (v19) no person can ever be "Global", so the chip was structurally pinned at 0. `meta.regions` drops it; `Global` remains an ISSUE token for hygiene fill counts. A cached v19 model still ships the dead chip |
| 21 | **🌊 Flow metrics.** Adds `leadTimeBuckets` / `throughputBuckets` / `flowOpenBuckets` / `bugWeekly` + `meta.flowSnapshots` / `bugsAvailable` / `flowSnapshotsAvailable`. A cached older model has none of these; the (then-live) Flow tab would render every tile as absent, so it forces one clean rebuild |
| 22 | **Two/three-tab consolidation (2026-08-05, current).** Adds per-person `personHygiene` (field fill, resolved person×week + open snapshot) and `meta.signalMinN` behind the Actions signals roster. A cached v21 model has neither; the roster would render its "Not in this payload" empty state for a whole cache TTL, so it must miss cleanly. `bustDeliveryCache_()` is **required** on this deploy — see the deploy checklist below |

**Warmer:** `warmDeliveryCache()` runs on a time trigger (install once with
`setupDeliveryCacheWarmer()` in the GAS editor as the owner; interval =
`CONFIG_DH.CACHE_WARM_EVERY_MIN`, 30 min), so loads are warm most of the time. Data can lag sheet
edits by up to the warm interval — the ↻ Refresh button (`loadData(true)`) always bypasses cache
for a live read. Error models are never cached.

## Attrition is out of scope, not a data gap

> *"Attrition cannot be acted on, while active we can coach employees."* — user decision
> 2026-08-04. This **supersedes v13**, taken earlier the same day.

A former employee's issues are removed from **every** rate — numerator and denominator both —
before any bucket is built. On-Time, Forecast, Quality and the whole hygiene surface therefore
describe only the people a manager can still do something about.

Three buckets, not two, and the distinction is the whole design:

| Assignee resolves to | Treatment |
|---|---|
| **Active** roster person | counted |
| **Known leaver** — an inactive row with **no active row anywhere** | excluded from every rate, counted in `meta.leaverExcluded`, **never** a hygiene gap |
| **Nobody** | the genuine gap — unassigned, external, or a real name problem. Still `unattributed` |

- **The leaver rule is one-sided** (`leaverTest_`, the same rule as `filterActiveNames_`): a name
  counts as gone only when the roster *proves* it. **Boomerang rehires keep counting** — the
  active row wins. A name the roster has never heard of is **not** a leaver; calling it attrition
  would let this policy quietly absorb real data problems.
- **Matching uses the same alias machinery as attribution**, so a leaver written `Alvarez, Maria`
  cannot walk back in through a spelling variant.
- **Filtered in one place** — `assembleModel_`, before bucketing — not threaded through the five
  bucket functions. A metric added later inherits the policy instead of having to remember it.
- **Leavers are also dropped from `attribIdx`.** Belt-and-braces: if one ever slipped past the
  filter it lands as `unattributed` — visible and obviously wrong — rather than quietly
  re-entering a rate that is supposed to exclude it.
- **The exclusion is stated on screen** (`leaverNoteHtml_`, top of the Actions gaps panel): a number that
  quietly got smaller is indistinguishable from a broken feed. It is styled as information and is
  **not** a gap row — put it in the gaps table and the next reader opens a ticket to chase
  leavers' due dates. Silent when nothing was excluded.

Utilization is untouched by this: leavers never had capacity in the first place.

## Two clocks: model rebuild vs data freshness

The header states **when the data was refreshed**, which is not the same question as when this
dashboard last rebuilt. Conflating them is a live deception risk, so they are separate fields:

| Field | What it is | How it behaves |
|---|---|---|
| `meta.generatedAt` | when `assembleModel_` ran | reset by the warmer every `CACHE_WARM_EVERY_MIN` (30 min) — **always fresh, therefore uninformative** |
| `meta.dataAsOf.jira` | when the Jira export last wrote the `Jira Raw` tab | moves once a day — **this is the age of the data** |

`Jira Backlog.js` `writeRawSheet_()` writes two italic footer rows in column A, two rows below the
last data row: `Generated: M/D/YYYY HH:MM` and `Total rows: N`. `readJiraRaw_` scans the last few
rows of column A for the first, parses it with `parseExportStamp_()`, and returns `exportedAt`.

Three things worth knowing:

- **The stamp is parsed explicitly, never via `new Date(str)`.** `"8/4/2026"` is US M/D; a
  locale-driven D/M reading would report April 8th and present a four-month-old export as fresh.
  `parseExportStamp_` rejects anything ambiguous or impossible (month 13, Feb 30, hour 25) and
  returns `null` — "unknown" is the only safe failure for a freshness indicator.
- **Age is computed server-side** (`jiraAgeH`), so two people in one review can't read different
  staleness verdicts off the same payload because one laptop's clock drifts. Only the wall-clock
  rendering is localised, and it always carries its timezone name.
- **Absent ≠ stale.** No readable footer → `jiraUnknown: true`, rendered muted as "Data refresh
  time unknown", *not* as a warning. A warning nobody can act on teaches readers to ignore the
  real one. `probeDeliverySources()` logs the diagnosis.

Staleness threshold: `CONFIG_DH.JIRA_EXPORT_STALE_H` (30h). Deliberately above 24 — the export
runs on a daily ~03:00 trigger, so warning at 24h sharp would paint the header amber every
afternoon. Past 30h a scheduled run was genuinely **missed**. If the trigger cadence changes,
change this with it.

The NFR-7 model-staleness warning (>48h since rebuild, which also suppresses trend comparisons)
is a **separate** condition and renders alongside the data age rather than replacing it — the two
fail independently, and one hiding the other is how a reader ends up trusting a stale number.

## Deploy
1. script.google.com → New project (separate from all existing dashboards).
2. Add **exactly three** files: `Code` (Code.js), `Security` (Security.js), HTML file named
   `Dashboard` (Dashboard.html — name must match doGet).
   **`node-tests.js` and `render-smoke.js` do NOT go into the GAS project.** They are local Node
   scripts; Apps Script has no `require`, so pasting either one fails with
   `ReferenceError: require is not defined`. If you've already added one, delete it from the editor —
   nothing else needs changing.
3. Run `node node-tests.js` **and** `node render-smoke.js` locally — both must pass before pasting.
   The smoke suite is what proves a below-gate metric renders no number; a green unit run alone
   doesn't cover that.
4. In the GAS editor run `probeDeliverySources()` — verify every source logs a row count,
   the NS sample Employee name format, and NS→roster join coverage >90%. Then check
   `meta.nsCoverage` on a built model: `unmatchedRows` should be ~0 (each unresolved NS employee
   classifies nothing), and `classifiedPct` is the share of tracked hours the billable rate
   actually describes — if it is low, fix the NS export window or the name join before
   quoting utilization at all. Also check the **"Jira Region raw values"** line: it prints each raw
   option value and what it maps to. A ⚠️ means a value fell through to `Other` — add it to
   `JIRA_REGION_TO_DH_` (§4.3). Open decision #1 is **closed** (2026-08-04 — the option list was
   read off live Jira), so this line now exists to catch a *newly added* option before it silently
   becomes `Other`. An **ALL BLANK** result is a ⚠️, not the expected state: it means the deployed
   export predates `Jira Backlog.js` v3.7.0 or has not been re-run since.
5. Run `auditJiraFillRates()` — record Due Date / Original Estimate / Region / Team fill rates
   (spec §10.5). Low fill ⇒ adjust tile so-what wording, not the design.
6. Run `getDeliveryData` once → grant scopes (account must open BOTH spreadsheets).
7. Deploy → New deployment → Web app → Execute as Me → "Anyone within ServiceRocket with the link".
8. Run `setupDeliveryCacheWarmer()` once as the owner.
9. After any model-shape change: run `bustDeliveryCache_()` then ↻ Refresh.
   **This deploy is a schema v7 → v9 change — `bustDeliveryCache_()` is REQUIRED**, not optional.
   A v7 entry carries no `nWithin`, so the Forecast tile would read 0% instead of suppressing.
10. On first load every tile shows its number clean (no confidence chip, no below-gate caveat —
    user 2026-08-05); the Data trust strip beneath grades each feed against its gate. Open the
    **Actions** tab, review each gap's coverage against its gate on the gaps queue, and take that
    view to the next steering review.

> ### ⚠️ Dictionary-conformance deploy (2026-08-03) — schema v9 → v10, ORDER MATTERS
>
> 1. **Deploy `Jira Backlog.js` v3.6.0 and re-run the export FIRST.** It appends three columns
>    (`Status Category`, `Rework Link`, `Reopened`). Until they exist, Quality / Rework reports on
>    nothing — the tile says the feed is missing rather than inventing a 0%.
> 2. Deploy `Code.js` + `Dashboard.html`, then **`bustDeliveryCache_()` is REQUIRED** — a v9 entry
>    has no `capCov` and no `reworkBuckets`, so Utilization would fall back to null and the Quality
>    tile would stay dark for the rest of the cache TTL.
> 3. Expect **all four numbers to move.** Brief the audience before they see it: this is registry
>    v2.0 aligning the metrics to the Dictionary, not a delivery event.
> 4. **Confirm the Rework link-type name** with `getIssueLinkTypes` and set `CONFIGJ.REWORK_LINK_RE`
>    to match. If no such link type exists, the numerator is reopens alone.
> 5. **Reopen detection is OFF.** `CONFIGJ.FETCH_CHANGELOG = false` because `expand=changelog` is
>    expensive on an export that already shrink-and-retries. Until it is on, the Rework Rate is
>    link-only and the card labels it a floor. Turn it on once one real run has been timed.
>
> **The 2026-08-03 executive rebuild is `Dashboard.html` only.** Tabs, cascading filters, the
> operating rate, the chart kit and the opportunity table are all computed client-side from the
> existing payload — including the full 52-week weekly axis, which is recovered by flattening
> `meta.periods.month` rather than adding a field. **No schema bump and no `bustDeliveryCache_()`
> for that change.** (Step 9 still applies if you are also deploying the v7 → v9 model change.)

> ### ⚠️ Three-tab consolidation deploy (2026-08-05) — schema v21 → v22
>
> 1. Paste Code.js + Dashboard.html into the GAS project (Security.js unchanged) and deploy.
> 2. In the GAS editor, run bustDeliveryCache_ (schema v22 also invalidates old entries; the bust
>    makes it immediate).
> 3. Live smoke: hero numbers move, compact flow tier renders, roster populates with RAG cells,
>    matrix + gaps queue intact on Actions, guest sees no Utilization/Forecast/pulse/Actions.
> 4. Post the GTT-605 dated status comment.
> No exporter change; no export re-run.
>
> **Motion QA — needs a real browser, render-smoke cannot see this** (carried from the motion-layer
> review; the headless DOM stub has no `requestAnimationFrame` and always reports
> `prefers-reduced-motion: no-preference`, so these four are unverifiable outside a browser):
> - `paneIn` cross-fade: switching tabs animates. Known cosmetic gap — refreshing data while
>   staying on the same pane may not replay it; that's fine, not a regression to chase.
> - The stagger-reveal fires **once** on load; changing a filter or a sort does **not** re-animate,
>   and the hero numbers count up exactly once, never again on a later re-render.
> - DevTools → Rendering → emulate `prefers-reduced-motion: reduce` → **all** motion gone (no
>   cross-fade, no stagger, no count-up) — this is the accessibility escape hatch, not optional.
> - The compact flow tier's stagger looks right next to the hero tier — it shares the same `.tile`
>   reveal by design, so it should stagger in lock-step with the hero cards, not as a separate wave.

> ### ⚠️ Logged-time carve-out deploy (2026-08-06) — schema v23 → v24
>
> 1. Paste Code.js + Dashboard.html into the GAS project (Security.js unchanged) and deploy.
> 2. The schema bump invalidates every cached entry on its own — `bustDeliveryCache_` is optional,
>    and only makes it immediate rather than at the next warm.
> 3. No exporter change and **no export re-run**: `Status Category` has been in Jira Raw since
>    Jira Backlog.js v3.6.0 and the Flow tab already reads it.
> 4. Live smoke, on the **Open backlog** population:
>    - 🧬 matrix → the **Logged** column's percentage rises and its miss-counts drop; every other
>      column is unchanged. Hover the header — it names the started-work scope.
>    - Each row's **"n fixable"** figure falls by the number of unstarted tickets it was counting.
>    - 👥 roster → anyone whose whole backlog is unstarted reads **ungraded** on Logged (grey, `—`),
>      not 0%. Anyone with started work reads a higher percentage than before.
>    - Switch to **Resolved** — nothing about the Logged column moves. That is the control.
>    - 📖 Methodology → change log leads with **3.2**, dated 2026-08-06.
> 5. **Roster-join retirement** (same deploy, `Dashboard.html` only — no schema dependency):
>    - 🧪 Gaps queue → the "…and that assignee resolves to a roster person" row is **gone**, and a
>      `✔ Solved and retired from the queue` line names it below the table.
>    - 🔍 Data-trust strip → **three** tiles, no "Roster join".
>    - 🧬 matrix → no `→ roster` column; the footnote names it as retired.
>    - ⚠️ If any of these are still showing, the join is **not** at 100% in the current export — the
>      row itself states how many assignees do not match. That is the signal, not a bug.
> 6. Post the GTT-605 dated status comment.

## Manual QA (after deploy)

### Dictionary conformance (2026-08-03)
- [ ] Utilization headline says **"of scheduled capacity"** and the card states
      **"billable vs non-billable only"** — no net-available companion, no `pts absence` line
      anywhere (no-absenteeism model, 2026-08-04).
- [ ] Forecast headline says **"mean accuracy over N measurable epics"**, with `N of M inside ±10%`
      and `median variance N%` beneath it. The headline is NOT the band percentage.
- [ ] On-Time coverage is **visibly lower than before** and the card names its scope — that is the
      epic due-date fill rate, not a regression. If it now sits below its gate it still publishes
      clean (no on-card caveat since 2026-08-05); the Data trust strip carries the gate read.
- [ ] **Quality / Rework shows a number**, not "data pending". Its target reads `≤5%` (a ceiling) and
      a *low* rate is GREEN. If a low rate paints red, `invertTarget` is not reaching the client.
- [ ] The rework card states both signals: `N rework-linked · N reopened (of M checked)`, or
      `reopens NOT measured` plus the "this rate is a floor" warning when the changelog is off.
- [ ] Every trend line carries `✎ definition changed 2026-08-03` — that marker is the point.
- [ ] The Actions gaps queue still reports Region tagging against a 100% gate (the unmet prerequisite).
- [ ] **Region is no longer 0%** after the `Jira Backlog.js` v3.7.0 export re-run — expect roughly
      **34%** on the 52-week window (~10% if you filter to the open backlog), chips for
      AMER / EMEA / SEA / ANZ (SEA replaced APAC in v3.8.0; the Global chip was removed —
      chips filter people, and no person is "Global"), and `resFull` able to move. A still-flat
      0% means the export was not redeployed or not re-run, not that Jira is untagged.

### Three-tab consolidation (2026-08-05)
- [ ] **Three tabs render: 📊 Executive · 🎯 Actions · 🔒 Access.** A **viewer** account sees two —
      Executive and Actions, no Access tab. There is no Headroom, Flow, People or Data Hygiene tab
      anywhere in the tab bar or the ☰-equivalent — this dashboard has no hamburger menu, so "no
      stray tab" is the whole check.
- [ ] Pick Region `AMER`: the Team, PM and Job-family dropdowns shrink to AMER's values, each with a
      headcount. Clear it — the full lists come back.
- [ ] Pick a Team from one region, then a *different* region: the team stays listed and selectable
      (marked `(0)`), and the filter row says `⚠ No one matches — clear region to see N people`.
      Clicking that link restores the view.
- [ ] Executive: every comparison bar carries a value **and** a ✔/▲/✖ glyph; the target rule is
      labelled. Bars are read-only — clicking one does nothing; scope changes via the header filters.
      The comparison chips now include **Lead Time** and **Throughput** alongside the four Dictionary
      metrics — pick each and confirm its axis and units relabel to match.
- [ ] Executive: the **compact flow tier** renders five smaller tiles beside the four hero cards
      (Lead Time, Throughput, Backlog, WIP, Bug Count) — no Cycle Time or Flow Efficiency tile
      anywhere (declared absent, registry-only).
- [ ] Actions: there is **no "Where the headroom is" table** (retired 2026-08-05) — the tab opens
      straight onto the signals roster. The recoverable-hours figure appears only as the
      `N h recoverable` clause on the Executive pulse.
- [ ] Actions: the **signals roster** lists every filtered person once, with a **job-title tag**
      under each name (grade code stripped; full roster string on hover). Due/Estimate/Logged cells
      are RAG-graded against each metric's own coverage gate (never a flat threshold) — colour
      matches the same gate the 🧬 matrix and the Executive data-trust strip use.
- [ ] A person with fewer than `SIGNAL_MIN_N` (4, `meta.signalMinN`) issues shows a **grey `●`** on
      the roster and the pulse, labelled "ungraded (small n)" — never a red or green cell, however low
      their percentage reads.
- [ ] Click a roster name → a drill-down row expands with the hours line and (Open population) the
      person's open backlog items by remaining hours. Click again to collapse; multiple rows can be
      open at once.
- [ ] Roster **Hours** column: a billable/non-billable/idle mini-bar per person; ramping/on-leave
      people sort last regardless of sort direction and carry **no idle segment** in their bar.
- [ ] The signals roster and the 🧬 matrix **share the Open/Resolved population toggle** — switching
      it on one changes the other, and both carry the matching `SNAP`/`PERIOD` scope tag.
- [ ] Executive **people-signals pulse** (admin/viewer only): one line, counts only —
      `● N on track · ● N watch · ● N need action`, plus an ungraded count when small-n applies. No
      individual is ever named on it. Clicking it opens Actions with the roster pre-sorted by
      opportunity.
- [ ] Executive **data-trust strip**: four tiles (Estimate / Due-date / Logged coverage, Roster join),
      each tagged `ORG`, each graded against its own gate. Changing any filter or the period picker
      does **not** move this strip — it is deliberately whole-population.
- [ ] Toggle 🌙 Dark: hero tiles, the compact flow tier, comparison bars and every roster RAG cell
      stay readable — no red/amber pair collapses to the same hex in dark mode.
- [ ] Tiles show numbers for the last completed week; Rework tile is muted "data pending".
- [ ] Region chips + Team dropdown + search all filter the tiles, the comparison chart, the signals
      pulse **and** the Actions signals roster together.
- [ ] **Billable Utilization is ≤ the tracked/capacity companion on every filter combination.**
      Billable above tracked is now arithmetically impossible — if you see it, the payload is a
      stale pre-v7 cache: run `bustDeliveryCache_()` then ↻ Refresh.
- [ ] The Utilization card carries **no** `⚠ classification covers …` line at any coverage (removed
      2026-08-05) — the gaps queue's classification row is the disclosure.
- [ ] `⬇ CSV` on Actions downloads `delivery-people-signals.csv` — Person/Job title/Region/n plus
      Due/Estimate/Logged % and miss-counts, Overall, and Billable h/Non-billable h/Idle h (blank for
      ramping/on-leave rows). Opens in Excel with the BOM intact (blob path); no console error.
- [ ] `⬇ PNG` on the KPI strip and on the whole Actions tab each save
      `delivery-health-tiles-<period>.png` / `delivery-health-actions-<period>.png`, stamped with the
      period **on screen**, not the model's ISO week — check Month and Quarter mode both.
- [ ] 🔒 Access panel loads/saves for admins; a non-listed account gets the denied page.
- [ ] ↻ Refresh forces a live read (check `generatedAt` changes).
- [ ] On-Time coverage reads lower than before schema 5 (epics no longer in the denominator) and the
      rate moves — expected, not a regression. Sanity-check the new `n` against a Jira JQL count of
      resolved non-epic issues in that week.
- [ ] Forecast card headline reads `N of M measurable epics inside ±10%`, with a `median variance N%`
      line and an `of N misses, X% over-run` split — **not** an averaged accuracy score.
- [ ] **A metric below its gate still publishes — clean.** No confidence chip, no
      `below gate — directional only` line, no `What's missing →` link anywhere on the four KPI
      cards (all removed 2026-08-05; the flow tiles keep their chips). Then set
      `CONFIG_DH.SUPPRESS_BELOW_GATE = true` once and confirm the same tile flips to
      `Not yet measurable` with no number anywhere on it — the reversal has to stay one flag away.
- [ ] With suppression on, suppressed tiles still name their period
      (`On-Time Delivery · last complete month (Jul 2026)`) and carry an `attribution trend`
      sparkline of *coverage* — a card with no window and no trend describes nothing.
- [ ] The `✎ definition changed` marker appears **only** on metrics listed in that changeLog entry's
      `affects`. It fired on Billable Utilization once, whose formula never changed — a false marker
      is worse than none, because it teaches people to ignore the real one.
- [ ] Filter to a slice with no closed epics — the Forecast card reads `no epics closed in this
      period`, **not** `Not yet measurable`. Absent data and bad data must never look the same.
- [ ] Actions: the gaps table has exactly four columns — Gap, Coverage, Gate, Blocks (**no Owner, no
      Prereq, no Target-week — removed 2026-08-03 / 2026-08-04**) and **no individual's name** appears
      anywhere in it or in the 🧬 matrix or the signals roster.
- [ ] There is **no "Delivery work fully attributed" KPI tile** (deleted 2026-08-04) — the
      gaps table below it carries the per-component good-of-total read.
- [ ] There is **no 🔬 Data Profile panel, no 📄 Brief and no 🧪 WHAT-IF button** anywhere on Actions
      (removed 2026-08-05) — only the signals roster, the 🧬 by-type matrix, the gaps queue and the
      ⚙ Coverage gates editor.
- [ ] The Actions gaps queue and 🧬 matrix **name the window they cover** and follow the header period
      picker. Switching the header Week/Month/Quarter chips re-renders them — the toggle must never
      look inert while Actions is open.
- [ ] Kill the NS feed (or filter to a period it doesn't cover): the third tile relabels to
      **Capacity Utilization (tracked)** — no billable claim without a billable feed.
- [ ] The `as of` line shows the refresh cadence, and its tooltip lists the source systems.
- [ ] Utilization card never shows an absence base line — capacity is gross in every period
      (no-absenteeism model, 2026-08-04).
- [ ] An I1-titled person shows on the signals roster with a 🎓 intern note and visible hours, but no
      RAG tint and no contribution to the pulse's recoverable hours — and no rate moves when they
      are filtered in or out.
- [ ] The PM filter lists only current employees; its tooltip states how many former ones were
      excluded. An external/unknown PM name is still listed — only proven leavers are dropped.
- [ ] Compare by PM or Team: at most 12 bars by default, the chart no taller than about a screen,
      a "N nearer target not shown" note, and **Show all N** restores every category. The bars shown
      by default are the WORST performers, not the best.
- [ ] No `✎ definition changed` note on any KPI tile — it appears only next to the metric it actually
      changed, never as a blanket marker across the strip.
- [ ] Admin: Actions → ⚙ Coverage gates edits a gate, saves, reloads, and the affected tile's
      confidence changes. The agreed default still shows beside it and Restore puts it back.
      A viewer account sees no gate editor at all.
- [ ] See the **motion QA** block under the deploy checklist above (paneIn cross-fade, one-shot
      stagger/count-up, `prefers-reduced-motion`) — those four need a real browser and are not
      re-listed here.

### Forward windows (2026-08-06)
- [ ] The period picker opens with three groups — **Planning · next 2 weeks**, **In progress**,
      **Complete** — and `Latest complete` is still what loads by default. On a fresh load, no card
      wears a `◐ in progress` or `planning` chip.
- [ ] Pick the **In progress** entry: every card gains `◐ in progress`, the scope chip reads
      `Current <unit> so far · <label>`, and **no card says "vs prior"**. The target gap line is
      still there.
- [ ] …and the utilization card reads **"at least N%"** with no red/amber/green colour on the
      number. If it shows a plain graded percentage instead, the floor rule is not firing.
- [ ] Pick a **Planning** week: On-Time, Forecast and Quality show `—` with "has not happened yet";
      the third card becomes **Planned Coverage** with `Nh planned of Mh scheduled capacity` and a
      `▽ N of M under 50% planned` line. Backlog and WIP (SNAP) still show real numbers — they are
      snapshots and ignore the picker.
- [ ] On that same planning week the comparison chart switches to **Planned Coverage** on its own
      (one metric chip, no reader action), and its bars carry **no target rule** — there is no
      agreed planned-coverage target.
- [ ] Actions on a planning week: the roster shows a **Plan** column with `Nh / Mh` per person and a
      dot legend; sorting by it puts the least-covered people first. Switch back to a complete
      period — the column **disappears**, and no row's values shift a column sideways.
- [ ] On a planning week the gaps view banner says "planning window selected — … last complete
      \<unit\>", the data-trust strip names the period it fell back to, and the pulse shows
      `planned N%` instead of `N h recoverable`.
- [ ] Download the CSV from a **complete** window: it still carries `Planned h` and `Capacity h`
      columns (fixed header), even though the on-screen Plan column is off.
- [ ] If the Tempo plan export has not reached next week, that week is simply **absent** from the
      Planning group — it must never appear as a window showing 0% coverage.

## Save PNG

The Executive KPI strip and the whole Actions tab each have their own **⬇ PNG** button
(`savePng_(elId, name)`) — every export is stamped with the period actually **shown**, not the
model's ISO week: `delivery-health-tiles-<periodStamp>.png` and
`delivery-health-actions-<periodStamp>.png`. The first click lazy-loads `html2canvas` from a pinned
CDN (`H2C_URL`); if the GAS sandbox blocks the script, an alert fires ("PNG export unavailable
(script blocked)") and the dashboard is otherwise unaffected.

## Notes

- **Security deviation from the original brief:** the 🔒 Access panel's `s.admins`, `s.viewers`,
  and `s.bootstrapAdmin` values are interpolated into HTML `value=`/text attributes. Since these
  are attacker-influenceable strings (admins can paste arbitrary email-like text into the
  allowlist), every interpolation is wrapped in the existing `esc_()` HTML-escaping helper rather
  than concatenated raw, closing a stored-XSS path an admin (or a compromised admin account) could
  otherwise open against every other admin who opens the panel.
- Ramp-up exclusion and FTE-vs-crew toggle are **not** implemented here — population is Roster
  active FTE + crew together (spec §12, backlog item).
- No manager org-tree scoping — this is delivery leadership data with an explicit allowlist.
