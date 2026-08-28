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
`What's missing →` link) was removed as noise: *who* can close each gap reads on the **Actions**
signals roster, which grades the same coverage gates per person (the org-wide **Data trust strip**
carried the coverage-vs-gate read until it was removed on 2026-08-28; the gaps queue went
2026-08-17). A metric below its gate is still published (accepted deviation from FR-2.2, owned by the
Services Director, reversible with `CONFIG_DH.SUPPRESS_BELOW_GATE`); the compact flow tiles keep
their chips. See [Data confidence](#data-confidence-and-suppression).

Spec: [`delivery-health-dashboard/docs/specs/2026-07-31-delivery-health-dashboard-design.md`](../specs/2026-07-31-delivery-health-dashboard-design.md).

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
The gap is still measured in `gapsRows_()` with Gon named against it, but since the gaps queue
(2026-08-17) and the data-trust strip (2026-08-28) were deleted, no surface renders it — read it
off `gapsRows_()` directly if challenged.

## Open-backlog population widened — hygiene numbers move by design (2026-08-06)

`Jira Backlog.js` v3.11.0 drops `'assignee is not EMPTY'` from `fetchOpenIssues_()`
(spec [`2026-08-06-dh-executive-newspaper-design.md`](../specs/2026-08-06-dh-executive-newspaper-design.md),
decision D7). Until this release the open-backlog export silently excluded every unassigned issue
— not filtered by the dashboard, **never exported at all** — so no amount of dashboard-side care
could have counted it. **Measured live against `servicerocket-coe`, 2026-08-06:**

| Measure | Count |
|---|---|
| Open **assigned** (what the dashboard saw before this release) | **1,440** |
| Open **unassigned** (invisible until now) | **1,839** |
| **True open inventory** | **3,279** — 56% unowned |
| Weeks-to-clear, assigned-only | **4.9w** — reads as essentially at target |
| Weeks-to-clear, true queue | **11.0w** — 2.25× the assigned-only reading |

The 1,440 independently matches this README's own separately-measured **1,444** assigned open
issues for the same date (see "Logged time is only expected on work that has STARTED" under
Signals roster, below) — two different probes landing within rounding of each other calibrates
both rather than disagreeing.

**Provably unaffected — verified by reading each guard, not assumed:**

- `onTimeBuckets_`, `throughputBuckets_`, `forecastBuckets_`, `leadTimeBuckets_`, `reworkBuckets_`
  all skip unresolved records outright (`if (!it.resolved …) return;`), and this release adds only
  *open* rows. **The four KPI cards do not move.**
- `personHygieneBuckets_` is person-keyed, and an unassigned row resolves to no person. **The
  signals roster does not move.**
- `openIssues` (the per-person backlog drill-down population, inside `readJiraRaw_`) keeps its own
  assignee filter — unaffected.

**Legitimately worse, and that is the finding.** `typeHygOpen_` (the 🧬 by-type matrix's open-half
gate) does **not** require an assignee, so unassigned rows now enter it and the gaps queue. Unowned
tickets are the worst-tagged population on the site, so the open half's `assigned`, `due`, `est`,
`region` and `team` fill rates **drop on deploy**, materially. This is previously-hidden hygiene
debt becoming visible, not tagging getting worse — the fix for a falling number here is tagging the
newly-visible tickets, not reverting the export.

**Roster join stays retired at 100%, and must.** *(Historical — this check was DELETED outright on
2026-08-17; see "…and then the roster-join check was DELETED" below. The reasoning below is why it
survived this release, not a description of the code today.)* `attr` — the roster-join check retired from the
gaps queue, the data-trust strip and the 🧬 matrix earlier the same day (see "A solved check
retires itself" below) — gained its **own** denominator, `attrN`, in this release: it is measured
only over records that *have* an assignee, so an absent assignee is "nothing to grade," never a
failed join. Without that fix, this widening would have dropped the just-retired check to roughly
`1,440 / 3,279` ≈ 44% on all three surfaces at once — a false failure resurrecting a check the org
already solved, on the strength of a number that was never true.

**If the drop reads as unacceptable rather than as the finding it is, the lever is
`OPEN_BACKLOG_UPDATED_WEEKS`** (the 26-week export bound on the open-backlog fetch — narrowing it
excludes more of the unassigned tail as abandoned rather than owed) — **not re-hiding the work** by
restoring the assignee clause. This is an open decision (spec §5, O4) owned by Delivery leadership,
not a bug for the next reader to silently patch.

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
| 📊 **Executive** | "Are we on target, and where aren't we?" | Two in-page sub-tabs (2026-08-17). **Health & Actions:** Tier-1 KPI cards (On-Time · Forecast · Availability Rate · Quality) → the **drill-down grid** (Region/Team/PM/Job family — rows and cells are controls). **Backlog & Flow:** **people-signals pulse** (margin-gated) → **backlog band** (counts only — the masthead callouts and Runway cards were removed 2026-08-28) → **flow strip** (Flow · Quality clusters) → super-admin **trust detail**. The 30-second read. |
| 🎯 **Actions** | "Who and what needs action?" | **Signals roster** (every person, job-title tag, Backlog of the week ⚑, Due/Estimate/Logged/Epic-link RAG columns, Available hours, drill-downs) → 🌊 **Backlog health** → 🚩 **Epics without a due date** → ⚙ **Coverage gates** (admin). Admin + viewer only. The 🧬 field-fill matrix and the gaps queue were deleted on 2026-08-17; the data-trust strip on 2026-08-28. |
| 🧭 **Workforce** | "Which pool is out of room, and which has room to sell?" | **Scope banner** → **pool grid** (one row per pool × band — simplified 2026-08-28 to Head · Capacity · Committed · Available, people rows open by default) → **consumers-only summary** → **shadow breakdown by reason** → **unrouted backlog** → **discipline section**. Admin + viewer only. Added 2026-08-10. |
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
- 👥 **People** tab → the triage grid, stacked workload bars, per-person accordions and the attention
  strip are retired as UI (the underlying `STATE.flag` filter predicate survives with no UI entry
  point — pinned in `render-smoke.js`). The **Focus lens** outlived the grid it drove as a chip strip
  that changed nothing but its own highlight, and was **deleted on 2026-08-17**. Their question — *who needs me this week* —
  is answered instead by the Actions **signals roster**: one row per person, RAG-coded on
  Due/Estimate/Logged/Epic-link fill plus an Available column (the billable-share Hours bar until
  2026-08-28), expandable into a drill-down row that
  carries the same per-person numbers the old workload bars drew (see "Signals roster" below).
- 🧪 **Data Hygiene** tab → the ⚙ Coverage gates editor moved onto **Actions** and is the only part
  of that tab still rendering. Its gaps table and the 🧬 by-type matrix moved with it and were both
  deleted on 2026-08-17; the org-wide fill-vs-gate headline they carried survived as the
  **data-trust strip** at the top of Actions until that strip was itself removed on 2026-08-28 —
  the signals roster grades the same gates per person now (see "Data-trust strip" below).

## Workforce Health — capacity is not fungible (2026-08-10)

Spec: `delivery-health-dashboard/docs/specs/2026-08-10-dh-workforce-health-design.md`.
Business source: *Workforce Health — Implementation Spec v1.1* (Workforce Planning, 2026.W32).

**The problem this fixes.** Every capacity figure this dashboard published — utilisation, planned
coverage, weeks-to-clear, recoverable hours — was computed as **one number** across a population
that mixes JF007 *Managed Services & Support* with JF009 *Service Delivery*. Managed Services
capacity is contracted and recurring; it is never drawn from the project backlog. Blending the two
made the org read as substantially more available than it is **and mathematically guaranteed that
the pool actually out of room could not be seen** — it was always averaged against the pool that
was fine.

**The reporting grain is `pool × band`.** Not person, not department, not company. A support
engineer cannot absorb a consulting epic at any level, and an I3 cannot absorb an I5's epic.

### Classification keys on the job code, never on the title text

```
09.I4.3  -  Senior Engineer I,  Service Delivery
│  │ │ │                        └── label ────┘  ← display only
│  │ │ └── VARIANT  ← THE KEY (with family)
│  │ └──── LEVEL    ← level band
│  └────── TRACK    ← the management override
└───────── FAMILY
```

`dhParseTitle_` → `dhClassify_` resolve every person to a **backlog role**, a **deployment pool**
and a **level band**. The registries (`DH_SUB_TRACK_`, `DH_BY_DISCIPLINE_`, `DH_ENABLER_FAMILIES_`,
`DH_MGMT_GOVERNS_`) are the only thing to edit when a job code appears or an org changes.

**Bands** are `JUNIOR` (I1–I2) · `CORE` (I3–I4) · `SENIOR` (I5+) · `MGMT` (M-track) · `UNKNOWN`
(no level token). These labels are **this model's, not the company's ladder** — the job architecture
speaks in level tokens — so the grid prints the level range beside every band. The band is in the
grain because an I3 cannot absorb an I5's epic: it is a capability boundary, not a status label.

**Crew are classified by employment type, not job code** (2026-08-10). Contractors hold no
job-architecture code, so the parser correctly fails on them; `isCrew` is checked first and they
land in the `CREW` pool. `CREW` is demand-driven — capacity is scaled *to* the work rather than held
against it, so cover renders `n/a` and unbooked crew is not counted as sellable headroom.

Three reasons the *discipline string* cannot be the key, all measured on the live catalogue: it
**splits** (`09|Service Delivery` is 21 `.3` engineers plus 15 `.1` consultants — two pools that
cannot substitute), it **collides** (`Delivery` means CONSUMER in family 07 and GOVERNOR in family
15), and it **fragments** (family 07 spends three strings on what `.1` captures as one sub-track).
It is also free text, so an HRIS rename would silently break the join.

The parser is **deliberately tolerant** — optional separator, case-insensitive track letter,
trailing parentheticals stripped. A strict regex drops real rows, and a dropped row surfaces as an
UNCLASSIFIED person, which reads as a governance failure rather than the parser bug it is.
`dhStemWarning` cross-checks the title stem against the pool and **warns without reclassifying**.

### Nothing new had to be exported

Three columns were already being written and simply never read: `Issue`, `Epic Key` and
`Parent Key` on Tempo Tracked Time, and the *values* of `Epic Key` / `Parent Key` on Jira Raw
(previously collapsed into the `linked` boolean and discarded). Reading them is what makes the
shadow split and historical pool-routing possible. Same shape as the SRSO Components discovery.

### Two decisions that deviate, on purpose

- **PTO is not subtracted and `capacityTruth` is not measured.** There is no absence feed; the only
  proxy is Tempo-tracked time off, which measures what people *logged*, not when they were away —
  so subtracting it would make the best-tracking teams look least available. Capacity is gross
  scheduled hours and `capacityTruth` renders **null**, never a forced 100%.
- **Managers left the pools** (`DH_MGMT_GOVERNS_`, families 07/09/18). They govern backlog rather
  than consume it. **This moved every published capacity rate** — registry `4.0`, schema v31, and
  every affected trend line carries the `✎ definition changed` marker at 2026-08-10.

### Who has the hours — the pool grid drill-down (2026-08-10)

Asked for directly: *"show capacity by role level so I can see exactly **who** has available hours,
not just the total available hours."* Clicking any band row expands a person list —
name + job title, then the person's period as a **stacked bar** (planned hours fill first,
available hours follow, the row ends in their own availability rate; reformat 2026-08-18,
`wfPersonBarHtml_()`), plus an Available column — most-available first.
`wfCellPeopleRow_()` / `wfPersonHours_()` in `Dashboard.html`. An Availability cell click on the
Executive drill grid lands here with the free cells already expanded (`wfExpandAvailCells_()`).

Two changes on 2026-08-28 (user decision):

- **The grid is simplified to five columns** — Person/cell · **Head · Capacity · Committed ·
  Available**. Plan-vs-logged, Outside plan, Cover, Relative cover, State and Cell size left the
  canvas: the working question this tab answers is *who is available, at which level, for how many
  hours*, and the eleven-column diagnostic table buried it.
- **People rows are OPEN BY DEFAULT** — the list of names with their available time is the tab's
  deliverable, not a drill-down. `STATE.wfOpenCell` therefore stores the *exceptions* (`false` =
  a reader collapsed the row); a fresh load shows every Services employee with their available
  time.

- **Client-side, no payload change and no round-trip.** The rows come from the same person-week
  grain the roster's Plan column uses (`planFor1_`), and membership is an exact match on the cell's
  own `pool|band` key — the same key the payload uses, so a person can never appear under a band
  they are not in.
- **Planned hours are capped at each person's own capacity.** A 60h plan on a 40h week is an
  over-plan, not extra hours to sell.
- **No capacity scheduled renders "—", never "0h available".** Nobody is free for work in a week
  they are not scheduled to work.
- **🌱 ramping and 🏖 on-leave people are listed with their hours but held out of the sellable
  subtotal** — the same carve the recoverable-hours pulse applies. Hiding them would make a team
  look smaller than it is; counting their spare capacity as sellable would send Sales after hours
  that are not there. The panel says so, because it is why the subtotal can be smaller than the
  cell's headroom.
- The cell row above stays the authority for the totals; the subtotal is printed so the two can be
  compared rather than assumed equal.

### Rules the view enforces

- **Never a single blended availability number.** The consumers-only figure is the honest one and
  it always ships with its denominator — *"32% available (of 63 consumers)"* is a fact,
  *"32% available"* is a rumour. The panel refuses a company-wide equivalent explicitly.
- **`null` renders `n/a`, never `0`.** For a demand-driven pool a zero would read as "no work
  left" for something that has no backlog *by design*.
- **Unclassified and unrouted counts render at zero.** A field that only appears when it is broken
  gets ignored when it breaks.
- **Measurability is separated from the verdict.** Hours nobody could classify are `unmeasured`,
  not shadow, and leave the shadow denominator entirely — otherwise an export missing a column
  reads as ~100% shadow and sends the delivery org chasing an artefact. The same rule makes
  `commitmentFidelity` null rather than 0% when nothing in a cell was classifiable.
- **Signals, not verdicts** (user decision 2026-08-10). The source spec's states are
  *instructions* — INTERVENE / SELL / HIRE / REASSESS / EXECUTE — and three of them are alarms.
  On a business delivering week over week with a healthy backlog, an INTERVENE chip is simply
  wrong: it asserts a problem from a signal with ordinary explanations, and a surface that cries
  wolf on a good week is ignored on a bad one. The states here describe **where a cell sits** —
  `STEADY` · `HEADROOM` · `AT CAPACITY` · `REVIEW` · `RECONCILE` · `DEMAND-DRIVEN` — and the Read
  sentence states **what was measured against what denominator**, never a cause. Nothing on this
  tab is painted red; amber means "worth a look". Red stays on the Executive cards, which have
  ratified targets to fail against.
- Concretely: a plan-versus-logged gap is reported as *"1,399h planned, 700h logged against planned
  epics (50%) — plans and worklogs are different grains and rarely tie exactly"*, not as
  *"allocations are ahead of reality — find the blocker"*. Plans are coarser than worklogs,
  logging lags, the window can include planned future weeks, and only issue-level plans resolve to
  an epic at all. `render-smoke.js` pins the absence of the alarm vocabulary, because the
  regression is invisible on review — a confident sentence reads like a good one.
- **A null signal never fires a state.** The source spec's own `safeDiv` returns 0 on a zero
  denominator, which would put `RECONCILE` on every pool that simply has no plan.

### Client/server twins

The payload ships **per-cell-per-week** buckets (`workforce.weekly`) so the period picker re-slices
without a round-trip. `dhFoldWeekly_`/`reconcileWorkforce_`/`dhActionState_`/`dhWorkforceRead_` have
client copies (`wfFold_`/`wfReconcile_`/`wfActionState_`/`wfRead_`); `_test_workforceParity_` walks
both over seven window shapes and asserts the config tables are identical. The two fields that must
never diverge are the **state chip** and the **Read** — a split there means the grid says HEADROOM
while the payload says RECONCILE.

## Scope tags: PERIOD / SNAP / ORG

Every tile, chip and roster column now carries a scope tag (`scopeTag_(kind)`) stating which clock
it follows — added 2026-08-05 because a tile's own period could silently disagree with the header's
period picker and nothing on screen said so.

| Tag | Meaning | Follows |
|---|---|---|
| `PERIOD` | Analysis period | the header's Week/Month/Quarter picker **and** every filter |
| `SNAP` | Snapshot at the last export | every filter, but **ignores** the period picker — Backlog, WIP and the roster's "Open backlog" population are inventories, not a time series |
| `ORG` | Whole org | **ignores** filters and the period picker — an org-wide read (the backlog bar, the super-admin trust detail) is a pipeline health check, not a filtered read |

Placement is pinned, not incidental: on the compact flow tier, Lead Time/Throughput/Bug Count each
carry `PERIOD` and Backlog/WIP each carry `SNAP` — `render-smoke.js` asserts the tag rides with its
own tile, tile by tile, not just anywhere in the strip's markup. On the signals roster, the
Due/Estimate/Logged columns follow the roster's own Open/Resolved population toggle (`SNAP` under
Open, `PERIOD` under Resolved), while the Available column (the Hours bar until 2026-08-28) always
reads `PERIOD` — worklogs are
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
- `plan`, surfaces that need resolved work — they **fall back to the last complete period and say
  so** (the rule shipped on the gaps view and the data-trust strip, both since removed — the
  roster's Resolved cells keep it); the pulse drops recoverable hours (measured on hours already
  delivered) and states planned coverage instead.

### The in-flight week had no Jira data at all until 2026-08-24

The grammar above shipped on 2026-08-06 and was correct. It was also, for every Jira-derived number,
describing an empty set — reported by the user on 2026-08-24: *"if I want to select current week to
check progress and team health I get empty records."* Closed weeks were fine. Planning weeks were
fine. Only the week people actually wanted to look at came back blank.

**It was never a dashboard bug.** `getLastNWeeks_` in `Jira Backlog.js` loops `i = 1..n` backwards
from *this* Monday, so no window it has ever built contained the current week. `bucketByWeek_` then
finds no bucket for an issue resolved on Tuesday and silently discards it, and the Jira Arrivals
tally closed at last Sunday. The dashboard rendered exactly what the export contained. That is the
worst shape this class of bug takes: an empty week and an idle week look identical on screen, and
only one of them is true.

Fixed in exporter **v3.15.0**, in three parts:

| Part | Change |
|---|---|
| **The window** | `getLastNWeeks_(n, { includeCurrent: true })` appends the in-flight week — this Monday → **now**, flagged `partial`. The DEEP feeds (Jira Raw, Jira Arrivals) take it; the Exec Q&A narrative window does **not**, because its WoW compares the last two windows and a two-day week would print a collapse every Tuesday |
| **The bound** | JQL date-only bounds are **midnight**, so the Arrivals fetches' `created <= "<Sunday>"` had been dropping everything filed *on* a Sunday, every week, in both halves of the tally. Both fetchers now take an exclusive `< nextMonday` — the bound `nextMonStr` was already being computed and had never had a caller |
| **The cadence** | A weekly Monday 03:00 run writes the in-flight bucket exactly once, three hours into the week, so the window fix alone would still show a Thursday reader an empty Monday. **The cadence is half the fix** — see below |

**Tempo was never the problem** and needs no change: tracked time exports daily with `TO_DATE` =
today, planned refreshes past + current + 5 future, and capacity writes future weeks ahead of time.
The current week always had hours; it had no delivery.

**What the dashboard changed in response.** One thing, and it is a refusal, not a feature:
`closedArrivalWeeks_` (Code.js) keeps the partial week out of `clearRateMedian_`. The trailing
median is an *operating rate* — how much this org clears in a week — and a Tuesday morning is not a
week. Left in, the newest point drags the median down by however far into the week the reader
happens to be, and since weeks-to-clear divides the queue by that median, the hero would deteriorate
every Monday and recover every Friday, describing the clock rather than the delivery.
`netFlowPerWeek_` and `orgClearRateGap_` take the same gate client-side via
`completeArrivalWeeks_()`, since both document themselves as using the server's window.

`inventoryWalkback_` deliberately **keeps** the partial week: it walks backwards from a queue
measured *now*, so the first step back needs exactly the created/resolved that have happened so far
this week. Feeding it a whole week there would be the error.

### The export went hourly (2026-08-24, exporter v3.16.0)

v3.15.0 made the current week *exportable*. Hourly is what makes it *watchable*: a manager checking
progress at 4pm sees this morning's deliveries rather than a snapshot taken at 03:00. The cadence
ladder lives in `Jira Backlog.js` — `setJiraExportTriggerHourly()` (in force),
`setJiraExportTriggerDaily()`, `setJiraExportTrigger()` (weekly, legacy). All three clear every
existing trigger first, so whichever ran last is the cadence.

Three things were only safe because runs could not previously meet, and hourly makes them meet:

| Guarantee | Why hourly broke it |
|---|---|
| **Script lock** in `runJiraEpicTracker` (`tryLock(0)` — skip, never queue) | `writeRawSheet_` opens with `clearContents()`. Two runs interleaved there leave Jira Raw truncated, and this dashboard reads an empty Jira Raw as *"the business delivered nothing"* — the same silent, plausible zero the in-flight-week bug produced, arriving from the other direction. A run that cannot start has nothing to add: the one holding the lock is fetching the same window |
| **One row per ISO week** in `writeFlowSnapshot_` | It appended per run, which was one point per week at a weekly trigger and is ~8,700 rows a year at hourly — of which `parseFlowSnapshotRows_` reads exactly one per week and discards the rest. The current week's row is now rewritten in place, keyed by the `ISO Week` header *by name*. The append-only contract is untouched: it was always about **columns** |
| **`JIRA_EXPORT_STALE_H` 30 → 3** | A 30-hour staleness bar under an hourly trigger is not lenient, it is inert — the header banner would stay green through 29 consecutive failed runs. 3h is two missed runs: enough slack for one slow export and one skipped-for-overlap run, both normal, while still catching a real outage the same morning |

`JIRA_EXPORTER_MIN` deliberately stays at **3.15.0**. v3.16.0 changes *guarantees*, not published
numbers, and the floor exists to warn about the second.

**Watch the first day.** If `⏭️ SKIPPED: another execution is still in flight` appears in the
execution log every hour, the export no longer fits the interval — step down to daily, or cut
`RAW_HISTORY_WEEKS`. The skip is logged rather than silent on purpose: a run that never happened and
a run that did nothing must not look alike.

#### What hourly actually costs — measured, 2026-08-24 18:40 run

`11m39s` end to end. **×24 = ~4.7 hours a day against an Apps Script quota of 6 h/day**, and that
quota is *per Google account, shared with every other script running as the same user* — the PS
cache warmer, the DH cache warmer, the Tempo exports. Hourly is affordable, but it is no longer free,
and it is the constraint every future change to this export lives inside.

Where the 11m39s went, and what v3.17.0 did about it:

| Stage | Cost | Verdict |
|---|---|---|
| Broad Done fetch, 52w (12,145 issues, ~122 pages) | 2m04s | irreducible — it is the export |
| Tempo worklogs for 12,604 issues (~252 batched calls) | **3m11s** | the largest single cost; unavoidable without a worklog cache |
| Arrivals **created**, deep window (13,122 issues) | 1m54s | genuinely different population — kept |
| Arrivals **resolved**, deep window (12,145 issues) | **1m37s** | ❌ **removed in v3.17.0** — see below |
| Open backlog (3,220) + changelog (3,575) + WIP + epic children + bugs | ~2m | each a distinct population |
| Sheet writes | ~50s | — |

**The duplicate.** `fetchResolvedInWindow_` over the deep window issued a clause-for-clause identical
JQL to the broad Done fetch at the top of the run and returned the same 12,145 issues — the extra
`resolutiondate < "<next Monday>"` excludes nothing, because nothing resolves in the future. Both
paths then converge on the same 9,397 rows after the space and noise filters. It was rebuilding a
list already in memory: **1m37s and ~122 Jira pages per run, ~39 minutes and ~2,900 pages a day.**
The arrivals resolved half is now `allIssues`.

The **created** half is deliberately *not* deduped the same way. Deriving the narrow Exec window from
the deep one means filtering dates in JavaScript, which moves the week boundary from Jira's timezone
to the script's — a few issues either side of every Monday, silently, in the numbers the Exec Q&A
compares week on week. Jira stays the single authority on which week an issue belongs to; seven
seconds is not worth buying a boundary bug.

#### The split cadence (exporter v3.18.0) — what actually runs now

Hour to hour the only things that can change are the in-flight week, the last few closed weeks, and
the open queue. The full run was re-fetching 52 weeks of settled history 24 times a day to discover
that. `setJiraExportTriggersSplit()` installs the pair that replaced it:

| | What it fetches | What it writes |
|---|---|---|
| **hourly** `runJiraEpicTrackerLight()` | `LIGHT_REFRESH_WEEKS` (8) completed weeks **+ the in-flight week + the whole open queue** | Jira Raw and Jira Arrivals **merged** onto the frozen history; Jira Bugs and the flow snapshot in full. Skips Exec Q&A |
| **~03:00** `runJiraEpicTracker()` | everything, 52 weeks | full rewrite of every tab |

**The nightly full run is not optional.** The light run is deliberately allowed to be approximate
about frozen history — an issue whose resolution date moves *out* of the 8-week window disappears
until a full run; a project newly in scope backfills only from the window forward. Those are
acceptable *because* the full run repairs them every night. Eight weeks rather than two is what makes
the approximation rare enough to live with in the meantime.

**Three guards, each for a failure that would otherwise be silent:**

1. **Schema.** The sheet's header must equal `RAW_HEADERS` exactly, or the light run does a full
   rewrite instead. Stitching rows across a column change shifts every value in the frozen region —
   and v3.18.0 *is* such a change, so the first run after deploy rebuilds rather than merges. Expected,
   and logged.
2. **Duplicates.** Any frozen row whose Key appears in the fresh data is dropped. An issue delivered
   in a frozen week and reopened today would otherwise sit in the frozen block as *Done* **and** in
   the fresh Open block — counted as delivered *and* queued, wrong in two directions at once.
3. **Junk.** A row is kept only if its Week cell is a real `YYYY.WN`, which excludes footers, blanks,
   and the `Open` / `Epic Child` sentinels — volatile by definition, always re-fetched, never frozen.

`writeArrivals_` takes the same merge, and needs it more than Jira Raw does: it rewrites its tab from
whatever population it is handed, so a light run without the merge flag would leave an 8-row arrivals
tab — and this dashboard needs 5 weeks for a clear rate and 26 for the walkback. The failure would
look exactly like a healthy small export.

**Cost, from 11m39s at v3.16.0:** full run ~6m51s, light run ~2 min. Hourly light plus a nightly full
is roughly **1 h/day against the 6 h/day quota**, down from ~4.7 h.

### The deep window is counted in quarters (2026-08-24, exporter v3.19.0)

`CONFIG_DH.DEEP_QUARTERS = 2` — two complete fiscal quarters plus the one in progress — replaces the
flat `WEEKS_PAST_DEEP = 52`.

**Alignment is the point, not the smaller number.** A rolling week count never lands on a quarter
boundary, so the window's oldest quarter was always truncated: it dropped out of every trend
(`renderTiles_` counts only periods that are `done` and not `partial`) while still costing a full
quarter of export. That is why 52 weeks bought *three* complete quarters rather than four, and why
the old test comment had to admit *"the count is never simply floor(weeks / 13)"*. Counting in
quarters makes the guarantee exact: ask for 2, get exactly 2, in any week of the year. The span
floats between 25 and 39 weeks because quarters differ in length — that is the mechanism, not a
defect.

**The trade, taken knowingly.** At 2 the Quarterly view holds exactly two complete quarters, so its
QoQ trend is two points rather than a trend line. The vs-prior delta is unaffected, and the Monthly
view still clears its six-complete-months bar. `DEEP_QUARTERS = 3` (with `CONFIGJ.RAW_HISTORY_QUARTERS`
moved with it) restores the old three-quarter trend at 41–52 weeks; both assertions in `_test_periods_`
follow the dial rather than pinning a number, so that change needs no test edit.

**⚠️ Deploy the dashboard first, or both together — never the export alone.** If the dashboard's
window reaches further back than the export covers, those weeks come back empty and render as *zero
delivery* rather than as absent data: the same failure the missing in-flight week caused, one
boundary over. (In practice the sheet only shrinks at the first **full** run after deploy — light
runs merge and keep the frozen rows.)

**⚠️ The fiscal rule now exists twice.** `jb_fiscalQuarterOfMonday_` in the exporter and
`periodInfoForIso_` here. Separate Apps Script projects cannot share a module, so
`tests/ps-dashboard/quarter-window-parity.js` evaluates *both* files and asserts they agree on 104
weekly anchors — depth and the underlying quarter assignment, separately, because depth parity can
hold by luck while the rule differs on a week neither window happens to touch.

That check earned its keep on the first run. It found a **pre-existing** bug here: `weeksInYear_`
constructed Dec 28 with `Date.UTC(...)` while `isoWeekNum_` reads its argument with *local* getters,
so in any behind-UTC timezone a 53-week ISO year reported 52 — and `shift()` wraps on that number,
so the deep window came back **26 weeks instead of 39** with nothing erroring. Same UTC-midnight trap
`dhCellDateLocal_` already documents for sheet cells, in the one place a date was still being
*constructed* rather than parsed.

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
returns. Implementation: `passesFilters_(p, skipDim)`, `optionsFor_(dim)`, `fillMulti_()`,
`renderFilterWarn_()`.

**Team / PM / Job family are MULTISELECT since 2026-08-28** (user request): each control is a
button that reads like the old select with a checkbox panel under it (`fillMulti_`, replacing the
single-value `fillSelect_`), `STATE.team` / `STATE.pm` / `STATE.family` hold **arrays**, and
several values are the **union** — any one membership keeps the person in (`dimMatchAny_`).
Empty = no filter. Panels are single-open (`STATE.msOpen`) and Esc closes. Region stays a single
chip. The cascading rules above are unchanged — options are still computed against every *other*
active filter, and an active selection is still always listed.

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
in v24, `dueN` in v32).

| Column | What it shows | Scope tag |
|---|---|---|
| Person | name + job-title tag (grade code stripped for reading, full roster string in the tooltip/CSV — inherited from the retired headroom table, user 2026-08-05), click to expand the drill-down row | — |
| **Backlog of the week** (Resolved view: **Resolved**) | issue count behind this row's signals — the **widest** population on the row, epics included, with a red **⚑ N overdue** flag beside it (Jira-linked) when part of that backlog is past its committed week. Renamed from **Open issues** 2026-08-28; was a bare `n` until 2026-08-10. Not a grade. The overdue counts come from the same per-person backlog-health buckets the 🌊 panel reads, so the two surfaces can never disagree. | — |
| Due date | % carrying a due date, RAG-graded against the On-Time metric's own coverage gate. **Denominator is STARTED work only** (`dueN`, schema v32) — see below | `SNAP` (Open) / `PERIOD` (Resolved) |
| Estimate | % carrying an original estimate, graded against the Forecast gate | same |
| Logged | % carrying logged time, graded against the Forecast gate. **Denominator is STARTED work only** (`loggedN`) — see below | same |
| Epic link | % linked to an epic or parent — unlinked hours cannot reach an engagement | same |
| Available | scheduled capacity not yet used in the period (capacity − tracked) — the hours a manager can actually route more work against. Most available first; ramping new hires and on-leave people sort last (their idle capacity is not assignable room). Replaced the billable-share Hours mini-bar 2026-08-28. | `PERIOD` always — worklogs are period-shaped even when Due/Estimate/Logged are reading a snapshot |

**Trimmed 2026-08-28 (user decision):** the **Overall** verdict column plus **Billable tag**,
**Start date** and **Progress** left the table — a synthetic worst-of-columns verdict beside the
columns it summarises read as noise once the per-field cells were trimmed to the actionable five.
The grade survives (`r.overall` still drives the Executive pulse, the Need action / Watch chips and
the default sort), and `SIGNAL_FIELDS_` still computes the removed fields for the CSV and the
methodology panel — they just no longer paint columns. The CSV ships "Idle h" as **Available h**
(same number, named for what it is used for) and adds **Overdue (open backlog)** beside the count
it flags on screen. The same pass deleted the *"Can we publish these numbers?"* data-trust strip
that opened this tab — the roster below it grades the same gates per person, and the super-admin
trust detail on Backlog & Flow remains the provenance surface.

- **The count column is NAMED, and it RECONCILES WITH ITS OWN DRILL-DOWN** (schema v35, user
  reports 2026-08-10: *"n = 79 but when you expand we show only 1 ticket in progress — where do the
  rest go?"* and *"we need to properly name or explain what N column means"*).
  The header now reads **Backlog of the week** (or **Resolved** on the other population; it read
  **Open issues** from 2026-08-10 until the 2026-08-28 rename), the lead paragraph
  says it is a count and not a grade, and the CSV ships it as `Issues (all incl. epics)` with its
  three parts beside it — a spreadsheet has no tooltip to rescue a bare letter. Three exclusions stood
  between that column and its list, and nothing on screen named any of them, so the only available
  reading was that the dashboard had lost 78 tickets. The drill-down now closes the arithmetic:

  ```
  n  =  listed  +  ignoredN            +  epicsN
        (shown)   (unstarted, undated)   (epics — they roll up their children)
  ```

  · **`n` is deliberately the widest population**: every open issue attributed to the person,
  **epics included**, because an open epic with no estimate is the single biggest lever the hygiene
  matrix exists to expose. The list excludes epics by design — listing an epic *and* its children
  double-counts the load.
  · Every cell beside `n` divides by something **narrower** (`dueN`, `loggedN`, `billN`), which the
  column's own tooltip now says. Three different denominators on one row is legitimate and was
  completely invisible.
  · The breakdown prints **only when the numbers disagree** — a reconciliation on a row that
  already reconciles is noise. Clauses that are zero are left out entirely.
  · **Collapsed** (`<details class="reconBox">`, v36): the summary line carries the arithmetic
  (*"12 open items behind Open issues — 2 listed · 7 ignored · 3 epics"*) and the reasoning sits
  behind the disclosure. It is also **width-capped at 96ch** — an uncapped sentence in a `colspan`
  cell sets the whole roster table's width, and a roster you have to scroll sideways is unreadable.
- **The drill-down says what each ticket BELONGS TO** (schema v36, manager request 2026-08-10:
  *"epic name along with the ticket assigned so they get a quick view on data relation"*). A
  **Belongs to** column carries the epic **name** (readable at a glance) with its **key** beside it
  (pasteable into Jira), sourced from `Epic Key` and falling back to `Parent Key` — the same either-
  link rule the Epic link column grades on. Three states, deliberately distinct: the epic's name;
  the **key alone** when that epic is outside the exported window (still a real relation — never
  claim there is no epic); and a red **"— not linked"** when there is neither, because those hours
  cannot reach an engagement and so cannot inform the next quote.
  · It also states the **clock**: on Open the list is a snapshot that follows filters but not the
  period picker; on Resolved the cells cover the selected period while the list below is still
  today's open backlog. That mismatch was the second half of the question.
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
- **The three due-date rules** (schema v33, managers' feedback 2026-08-10). Stated by the team as
  three rules, which reduce to one exclusion in `dueExpected_`:
  1. *A due date inside the current week is compliant* — see the overdue caveat above
     (`dhOverdue_`), not this predicate.
  2. *A To Do ticket with no due date is ignored entirely* — not delayed, not missing. It is not a
     commitment yet, and a date guessed onto work nobody has picked up is what makes dates
     meaningless later.
  3. *Anything that HAS a due date is tracked, whatever its status.* A date is a commitment the
     moment somebody sets one, and a commitment nobody is working is the case most worth seeing.

  So the only rows outside the ratio are the **unstarted AND undated** ones. On the Open population
  the Due date column divides by `dueN` (roster and 🧬 matrix alike) — "started, or carrying a
  date" — so the column reads *of the work that is either underway or committed to a date, how much
  carries a date*. A dated To Do ticket is a **hit**, which is also what keeps the ratio ≤ 100%.
  Resolved work is unchanged (`dueN === n`): On-Time Delivery *is* the due-date question, so a
  resolved item with no date is that metric's own coverage gap.
  · **This is deliberately NOT the shape of the logged-time rule above**, which drops every
  unstarted ticket including the ones carrying worklogs. Logged time on a To Do ticket is a
  status-hygiene problem with a different owner; a due date on a To Do ticket is a real commitment
  on real work. `_test_personHygieneBuckets_` pins the one record that separates them, so a
  refactor that "unifies" the two predicates fails a test instead of silently reverting rule 3.
  · **The rule reaches the LIST as well as the RATE** (schema v34, user report the same day: *"I
  still see tickets in the status To Do with no due date in each rocketeer"*). Those tickets left
  the percentages in v33 but were still printed in every person's drill-down with a red em-dash in
  the Due column — the same accusation the rate had just stopped making, one surface over. They now
  leave `items` entirely (`ignored`, decided in `readJiraRaw_` off the status **category**, never
  re-derived downstream from the status name). **The load is not reduced**: `count` and `remHrs`
  still cover every open ticket, with `listed` / `ignoredN` / `ignoredHrs` reported beside them, so
  a shorter list can never read as a smaller backlog. A person whose whole backlog is ignored says
  so explicitly rather than reading as "nothing attributed".
  · **Backlog health's `undated` queue follows the same rule** (v34). It now counts **started**
  work with no date; unstarted undated tickets are tallied as `undatedIgnored` and reported as a
  third excluded population in the panel's opening sentence — the same idiom as `unassigned` and
  `unattributed`, and for the same reason. It gets **no row and no key list**: nobody is meant to
  go and work them, and a key list is an invitation to. The three counters still partition the
  population (`dated + undated + undatedIgnored = n`), which is pinned by a test.
  · **Epics are exempt from rule 2** by team agreement and are audited separately — see the 🚩
  panel below. An undated To Do epic is skipped by the graded fill columns and flagged by the
  audit, on purpose; `_test_epicDueAudit_` asserts that the two surfaces disagree about exactly
  that record.
  · The Estimate column still divides by n, deliberately: an unestimated To Do ticket is the
  matrix's single biggest lever, and unstarted work is exactly when an estimate is worth having.
  · Because two of the columns no longer reconcile against the `n` beside them, the open roster
  prints that fact above the table rather than only in a tooltip — this table is usually read as a
  PNG, where hover does not exist.

## Jira deep links (schema v37, 2026-08-10)

Every key the dashboard shows is now a link, and every key list offers one link that opens the whole
queue. `jiraIssueUrl_` / `jiraKeysUrl_` / `jiraLink_` / `jiraOpenAll_` in `Dashboard.html`; the site
comes from `meta.jiraBase` (`DH_JIRA_BASE` Script Property → `CONFIG_DH.JIRA_BASE_URL`).

| Surface | Link |
|---|---|
| 👥 roster drill-down | each ticket key → `/browse/KEY`; the epic name → its epic; **↗ Open these N in Jira** over the listed keys |
| 🚩 epic audit | each offending epic key, plus **↗ Open all in Jira** per epic type |
| 🌊 backlog health | **↗ open** on every queue row (stale, unestimated, overdue bands…) |

Four rules, each of which is a bug if broken:

- **The site is CONFIG, never a literal in the renderer.** A second instance or a sandbox is a
  Script Property away, and a hardcoded host sends a manager to the wrong Jira with nothing on
  screen to say so. Trailing slashes are trimmed server-side, once.
- **Multi-key links use `key in (…)`, never `assignee = "Name"`.** Jira Cloud has not resolved
  assignees by display name since the GDPR change — it wants an accountId, which this pipeline does
  not carry. An assignee query would fail for some names and quietly return the wrong person's board
  for others. Keys are exact, already on screen, and provably the same records the dashboard showed.
- **`target="_blank" rel="noopener"` is required, not cosmetic.** The page runs inside the Apps
  Script sandbox iframe, which swallows same-tab navigation.
- **URLs are capped** at `JIRA_LINK_MAX_KEYS_` (80) and say so when they clip — a 300-key queue
  builds a ~4 KB URL that some proxies drop, and a link that silently fails to open is worse than a
  link that admits its limit.

**No site configured → plain text, never a broken link.** A pre-v37 payload has no `jiraBase`, and
the renderers fall back to unlinked keys rather than emitting `/browse/KEY` against the Apps Script
origin (a 404 that reads as "the dashboard is broken").

> **Why not `=HYPERLINK()` in the Jira Raw sheet?** It was the other candidate. Three reasons the
> dashboard won: `writeRawSheet_` rewrites the tab on every run, so a hand-added formula column is
> wiped weekly; a per-row `setFormula` loop would add minutes to an export that already runs long
> (formulas belong in the `setValues` array if that column is ever wanted); and the sheet is not
> where anyone reads these numbers. The dashboard already holds every key, so links there cost no
> export change and no payload growth. The sheet column remains a reasonable *addition* for people
> who read the raw tab directly — it is not a substitute.

## 🚩 Epics without a due date (Actions tab)

`epicDueAudit_()` in `Code.js` → `renderEpicDue_()` in `Dashboard.html`. Schema v33.

**The team agreed every epic carries a due date, "even if it is just the project end date"**
(2026-08-10). That makes it the only field rule here with a **ratified 100% target**, and the reason
it is a flag rather than another graded column: an 80% coverage gate would declare success while a
fifth of the engagements have no committed end. Owner: Gon + the PMs.

- **Open epics only, whatever their status.** A To Do epic with no date is exactly what this audits,
  so it is **not** subject to the rule-2 carve the roster and matrix columns apply. Resolved epics
  are out — a date added now moves no future number.
- **ORG scope: no person filter, no roster join, unassigned epics included.** An epic is a
  container; "nobody is assigned" is not a reason to stop asking for its end date, and a surface
  keyed on people cannot see those epics at all. The panel carries the `ORG` tag so a filtered
  reading is impossible.
- **One row per epic type** (Epic / Kick-off epic / Go-live epic), most-missing first — that
  ordering *is* the work order, and it matters here: measured 2026-08-04, Go-live epics carried due
  dates 100% of the time against 46% for Kick-off, which the pooled number hid completely.
- **Names nothing but issue keys.** Same rule as the gaps queue: a standing list of people against
  failures is a blame board; an epic key is a thing to open. ⬇ CSV exports one row per offending
  epic, because this list gets worked outside the dashboard.
- **Three distinct states, and they must never render alike**: *missing* (red, with the keys),
  *zero missing* (an explicit green all-clear — a check that disappears when it succeeds is one
  nobody trusts when it fires), and *absent from the payload* ("not in this payload", never a clean
  100% on an audit nobody ran). A capped key list says so while the count stays complete.
- **Population toggle: Open backlog / Resolved (`STATE.typePop`).** The chips sit on the roster
  itself since 2026-08-17 — they used to live on the 🧬 by-type matrix, which the roster followed,
  and deleting that matrix without moving them would have stranded this table on Open with no
  control anywhere in the client.
- **Small-n guard — `SIGNAL_MIN_N = 4` (`meta.signalMinN`, `signalMinN_()`).** A person with fewer
  than that many issues is shown but never graded red or green: a grey `●` dot, percentage still
  shown, footnoted "ungraded (small n)". One missing due date on one ticket must never render the
  same red as fifteen missing out of forty — that would put someone on a watch list over a single
  record.
- **Grading reuses each metric's own coverage gate** (`SIGNAL_FIELDS_`, the same gate the retired
  🧬 matrix and data-trust strip used) — never a separately-tuned threshold, so two surfaces can
  never disagree about one record.
- **Ramping new hires and on-leave people sort last** on the Available column regardless of sort
  direction (same exclusion as the recoverable-hours figure), and get no Available figure — their
  idle time is the explanation, not assignable room.
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

**The Focus chips themselves were deleted on 2026-08-17.** Keeping a dead predicate that no UI calls
is defensible: it costs nothing on screen and a test keeps it honest. Keeping a visible three-chip
control that reads nothing is not — it teaches the reader that filters on this page do not work,
which is expensive in a way the dead predicate is not. `STATE.focus`, `FOCUS_LABELS`, `setFocus_`
and `buildFocusChips_` are gone; the scope chip lost its Focus term with them.

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

## Data-trust strip — DELETED 2026-08-28

**Removed 2026-08-28 (user decision).** The *"Can we publish these numbers?"* strip (`renderTrust_`
— by then the first panel on **Actions**, having moved off the Executive tab on 2026-08-17) was
deleted: the signals roster beneath it grades the same gates per person and per record, and the
super-admin trust detail on Backlog & Flow remains the provenance surface. The `gapsRows_()`
definitions it read still back the roster's grading and `verdictFindings_`. The section below is
kept as the record of how it worked — including the retire-at-100% rule, which outlives the strip
as a precedent.

**Three** fill-vs-gate tiles — Estimate coverage, Due-date fill, Logged fill — picked **by key**
from the same `gapsRows_()` definitions that back the Actions gaps queue, so the strip and the
queue can never describe one gap two different ways. (A fourth, **Roster join**, was removed on
2026-08-17 — see below.) A check measuring **100%** retires from both (see below), so the strip
may render fewer than three tiles. Tagged `ORG`: deliberately unfiltered and
period-independent, because a well-tagged slice does not make the whole feed publishable, and this
strip's whole job is the org-wide health check the six-tab design's Data Hygiene tab used to own on
its own screen. Each tile states its value against its own gate and colours red/amber/green off that
comparison, never against 100%. (Until 2026-08-17 its footnote directed to the Actions tab's gaps queue for the full
list.

### A solved check retires itself (2026-08-06)

User decision: *"we do not need 'assignee resolves to a roster person' as metric, we have solved all
discrepancies so always 100%."*

A check that reads 100% everywhere teaches nothing — it costs width on three surfaces and trains the
reader to skim past the fields that do vary. So it is **hidden, not deleted**:

| Surface | Behaviour when the check is at 100% |
|---|---|
| 🔍 Data-trust strip | the tile disappears (it is picked by key from the same filtered list) and the check is named on the strip's `✔ Passing at 100%, not shown` line — `gapsRetired_`, which moved there when the queue was deleted on 2026-08-17 |

- **The measurement never stops.** Only the rendering is conditional.
- **It comes back on its own** — no deploy, no code change — the moment **one** record fails.
- **A `null` value is not a solved check.** An unconnected feed (Reopen events / CSAT) has nothing
  measured, so it never retires.
- The one row still using this rule is the **SRSO binding** check.

#### …and then the roster-join check was DELETED (2026-08-17)

Retirement is a holding pattern, not an ending, and this is the one check that came out the other
side. After a fortnight pinned at 100% the decision was to remove it outright, together with the
🧬 matrix, as part of clearing the per-parameter compliance summaries off the Actions tab.

**Keep the distinction straight when the next check hits 100%:** the default is still to *hide* it.
Deleting this one was a judgement about *this* check — the loss it watched (173 of 351 records,
49%, on the 2026-08-04 profile) was fixed **at source** by the whole-roster attribution change,
not merely papered over — and not a change to the rule.

If the name index regresses now, it surfaces on the gaps queue's *"Resolved work carries a Jira
assignee"* row and in each card's own `meta.jiraUnattributed` count, both unchanged. Restoring the
check means restoring `resAttr` and its row from git; it is not behind a flag.

## Files

| File | Role |
|---|---|
| `Code.js` | GAS server — `doGet()` (access-gated) serves the HTML; `getDeliveryData(forceRefresh)` reads Capacity/Tracked/Planned/NS Billable/PH/Jira Raw + Roster by spreadsheet ID, builds the person × week + Jira-bucket model, returns JSON. `buildDeliveryModel_()` is the full compute, shared by the cache-first endpoint and the `warmDeliveryCache()` 30-min trigger (`setupDeliveryCacheWarmer()` installs it). `probeDeliverySources()` and `auditJiraFillRates()` are one-time post-deploy diagnostics. `METRIC_REGISTRY_` is the canonical definition store every tile renders from. Also carries the **Workforce Health** layer: the job-code classifier (`dhParseTitle_`/`dhClassify_` + the `DH_SUB_TRACK_` registries) and the six-pass pool × band pipeline (`buildCapacity_`, `buildCommitment_`, `buildConsumption_`, `buildBacklog_`, `dhFoldWeekly_`, `reconcileWorkforce_`). 48 `_test_*` unit tests (the count in this line was stale at 35 before 2026-08-10; `grep -c "^function _test_" Code.js` is the source of truth, not this number). |
| `Security.js` | Email allowlist (admin / viewer / open-access) — `SEC_DH`, `checkDeliveryAccess()`, `getDeliveryAccessSettings()`, `saveDeliveryAccessSettings()`, `buildAccessDeniedPage_()`. Inherited from the demand dashboard's `Security.js` (itself inherited from `PS Security.js`). |
| `Dashboard.html` | Client — loads cache-first via `google.script.run.getDeliveryData(false)`; ↻ Refresh forces a live read. Four tabs from the `VIEWS` array (Executive / Actions / Workforce / Access — see Navigation below). Holds the inline-SVG chart kit (`hbarChart_`, `sparkHtml_`), the cascading-filter engine (`passesFilters_(p, skipDim)`, `optionsFor_`), the operating-rate model (`standardRate_`, `stdFor_`), the metric accessor table (`METRICS_`), the recoverable-hours walk (`oppRows_`), and the signals roster (`personSignalRows_`, `ROSTER_COLS_`). Per-panel ⬇ Save PNG + roster CSV export. |
| `node-tests.js` | Local Node runner for the pure `_test_` functions in `Code.js` (stubs `Logger`/`Utilities`/cache) — `node node-tests.js`. Also holds the four cross-layer parity suites (`_test_clientParity_`, `_test_confidenceParity_`, `_test_sampleFloorParity_`, `_test_workforceParity_`) that diff the client's copies of `utilFor_` / `metricConfidence_`+`medianOf_` / `sampleFloorClient_` / `wfFold_`+`wfReconcile_` against the server's — two implementations of one publish/withhold rule are only safe if they are provably identical, not merely eyeballed. The workforce walk additionally pins the **action state** and the **Read**, because a divergence there means the grid shows HEADROOM while the payload says RECONCILE and nobody can tell which is real. Not pasted into the GAS project. |
| `render-smoke.js` | Renders `Dashboard.html`'s client code against synthetic models and asserts on the HTML — `node render-smoke.js` prints the exact count on every run (1,094 the last time this line was updated; **the command's own output is the source of truth, this number is not** — it only ever GROWS, because a check pinned to retired markup gets rewritten against its replacement, never deleted). Covers the rules that live in string concatenation and no unit test can reach: the gate policy both ways, stale models print no delta, an empty period isn't shown as a coverage failure, no individual appears in the gaps queue, the 🧬 matrix or the signals pulse — plus cascading option lists (never silently dropping an active selection), the operating-rate maths including its weekly fallback on the Quarter view, chart labelling and gap handling, tab routing and its role gate, the recoverable-hours exclusions (`oppRows_`), the signals roster's small-n guard and job-title tag, the reconstructed-vs-measured inventory-history sparkline on the hero band, the re-homed colour key, the tab-set invariants (exactly `exec,actions,workforce,access`, no live render into a retired pane), and the 🧭 Workforce panels — that both pools appear separately, that a demand-driven pool renders `n/a` rather than `0`, that the consumers-only figure carries its denominator, that shadow splits into three owned reasons, and that a pre-v31 payload asks for a refresh instead of rendering a silently blended grid. Not pasted into the GAS project. |

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
| **Low** ◇ | coverage more than 10 pts below the gate | published clean (or **suppressed** when `SUPPRESS_BELOW_GATE` is on) — the KPI cards no longer print a below-gate caveat (user 2026-08-05); the per-person gate read is on the Actions signals roster (the Data trust strip carried it until 2026-08-28) |
| *(none)* | nothing in scope | `—` with the reason ("no epics closed in this period") |

The last row matters as much as the third: a quiet week with no closed epics is **not** a data-quality
failure, and rendering it as one teaches people to ignore the gate.

**Suppression is OFF (user decision 2026-08-03, `CONFIG_DH.SUPPRESS_BELOW_GATE = false`).** This is
an accepted deviation from FR-2.2, which calls publishing a low-confidence number a defect. Gating
darkened two of four tiles — On-Time at ~64% attributed against an 80% gate, Forecast at ~23%
against 70% — and took their historical series with them, and a dashboard nobody can read teaches
nobody anything. What protects the reader now (since the cards dropped their coverage narration,
user 2026-08-05): the **Actions** signals roster grades the same gates per person and names who
and what closes each gap (until 2026-08-28 an org-wide **Data trust strip** also graded each feed
against its gate). The reader judges the number
instead of the tool refusing to show it. The entire suppression path is intact behind the flag — set
it to `true` and FR-2.2 behaviour returns with no other change; render-smoke covers both settings.

Two consequences worth knowing before a demo:

- **Forecast Accuracy is built on ~15 measurable epics.** It publishes with no on-card caveat —
  treat it as directional until the org's estimate and worklog fill rates rise (read them off the
  signals roster since the trust strip's removal).
- **On-Time sits ~16 points under its gate** at roughly 64% due-date fill. Closing ~90 due dates a
  month would clear it honestly.
- **With no NetSuite billable feed the utilization tile relabels itself** to *Capacity Utilization
  (tracked)*. `tracked ÷ capacity` is a different metric from billable utilization and is never
  published under a billable heading.

Coverage is recomputed **under the active filters** — a well-tagged region can be publishable while
the whole population isn't — which is why the gate runs client-side as well as server-side.

## Coverage gates are admin-editable

Admins get a **⚙ Coverage gates** panel at the bottom of the **Actions** tab. (It sat below the
gaps queue until that table was deleted on 2026-08-17; it is now the panel's only content besides
the leaver-exclusion note, and the panel renders nothing at all for a viewer.) "How much
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

## Actions tab: the gaps queue — DELETED 2026-08-17

The **gaps queue** was a ~10-row table on the Actions tab, below the signals roster
(`renderHygPanel_()` → `#hygPanel`). Each row named one gap, its coverage, its gate and what it
blocked, under the caption *"Whole-population view — the dashboard filters deliberately do not
apply. A well-tagged region does not make the feed publishable."* It was **deleted on 2026-08-17**
(user), along with that caption, the coverage-colour key, the window banner and the
`✔ Solved and retired` line.

**What survived, and where it went.** The three gaps that gate a published metric — estimate
coverage, due-date fill, logged fill — were already on the **data-trust strip** at the top of the
same tab, which reads from the same `gapsRows_()` definitions. Nothing was lost there.

**What did not survive intact, stated plainly.** The queue's other rows had no tile: region tagging,
team tagging, the billable classification, the capacity source, the SRSO binding, reopen/CSAT and
the engagement key. Their **coverage figures, gates and explanatory notes are no longer rendered
anywhere.** Their *names* are, because the Executive masthead still counts them — *"N of M evidence
gates are below their bar"* — and a verdict that counts what nothing can name is a dead end for the
reader. `renderTrust_` therefore prints one line beneath the tiles:

> ⚠ **Also below bar, with no tile above:** Region tagged on delivery work · Team tagged on delivery
> work · …

with each name carrying its old note and *blocks* text in the tooltip, and a second line naming any
check passing at 100%. That is a pointer, not the table returning: if you need the coverage numbers
themselves, they are still on `gapsRows_()` and one `console.log` away.

**The definitions stay.** `gapsRows_` / `gapsRowsAll_` / `gapRetired_` / `gapsRetired_` are read by
the trust strip, the masthead's gates finding and the shelf. Deleting a view must never delete the
model behind it — only `hygieneRow_` (the row renderer) and `gapsSolvedHtml_` (the retired line)
went, because both drew the deleted table and nothing else.

**Update 2026-08-28:** the data-trust strip (`renderTrust_`) was itself removed (see "Data-trust
strip — DELETED 2026-08-28"), and the "Also below bar, with no tile above" pointer line died with
it — so the untiled checks' names are now **not rendered anywhere** either. The `gapsRows_()`
definitions still stand (the signals roster's grading and `verdictFindings_`'s gates finding read
them), and the coverage numbers remain one `console.log` away.

**What is left on `#hygPanel`:** the ⚙ **Coverage gates** editor (admin-only) and the
leaver-exclusion note. The panel now renders **nothing at all** — `display:none`, not an empty
bordered card — for a role with neither, and it **no longer states a window**, because neither the
gate editor nor the leaver note follows the period picker. A period label over content that does not
move with the period is a lie that costs nothing to tell and everything to discover.

**No Owner column, and no Prereq / Target-week columns** (user decisions 2026-08-03 and
2026-08-04). That rule outlived the table it was written for and still governs the strip:
accountability and scheduling live in the requirements doc, and a standing table of names against
failures in a widely-read view reads as a blame board rather than a work queue. The registry still
records `owner` and `paramOwner` per metric — it just isn't rendered.

> The 🔬 Data Profile funnels, the 📄 Brief and the 🧪 WHAT-IF simulation were removed 2026-08-05,
> the 🧬 by-type matrix and the Roster join check on 2026-08-17, and the gaps queue with them. The
> Actions tab is now four panels: data trust, signals roster, backlog health, epics without a due
> date — plus the gates editor for admins.

The **"% of delivery work fully attributed" KPI tile was deleted** (user decision 2026-08-04): the
composite — pinned by the org-wide-empty Region field (PR-01) — mostly restated its own binding
constraint. Its two composites (`resFull` = due **and** roster assignee **and** region; `resReady` =
the same without region) are still summed on the server and shipped, but nothing has rendered them
since; they are the next candidates for removal if the payload is ever trimmed.

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

- **🗓 PM tab shows epics in progress or due this month — not everything open** (schema v39, user
  feedback 2026-08-11). The list is epic-first: **PM ▸ epic ▸ children**, each level collapsed until
  you open it. An epic that is neither started nor dated is **not listed** — it is not work in
  flight — but it still counts in the Owns bar and is named in that bar's 🚩 key list, so it is
  never hidden from the number.
- **Unstarted tickets with no due date are counted, never listed.** The managers' 2026-08-10 rule:
  a To Do ticket with no date is not a commitment yet, and queuing them produces a list nobody can
  work. The count is stated at the top of the tab and again on each epic, because a silent drop and
  a considered exclusion look identical on screen.
- **A child past its epic is *at risk* or *breached*, never one red.** The split is on whether the
  **epic's** week has passed: still ahead → ⚠ at risk (the plan cannot land, but both levers are
  open); already gone → ✖ breached (recovery). A red that fires on future, fixable work is a red
  people learn to skip.
- **Children are graded against their EPIC's deadline, not their own.** *within* = lands on or
  before the epic's week · *at risk / breached* = committed past the epic it belongs to, with the
  gap in weeks ·
  *no date of its own* = started but uncommitted, which is a gap in its own right and is **never**
  counted as within · *ungraded* = the epic has no due date, so there is nothing to measure
  against. Sub-tasks reach their epic through the **parent chain** (sub-task → story → epic), not a
  single-level `epicKey` lookup — roughly 1,023 sub-tasks parent to a story rather than an epic, and
  a one-level lookup loses all of them.
- **🗓 PM tab — an epic belongs to its ASSIGNEE, then to the project lead** (schema v40,
  2026-08-11). The assignee is direct evidence of ownership; the Tempo project lead
  (`GTT-605 → GTT → that project's PM`) is an inference from who logs hours where, used only when
  the epic carries no assignee. **Each row states which rule placed it.** Children follow their
  epic whoever they are assigned to. Work satisfying neither rule lands in **(No PM)**: a coverage
  gap with a name, not a tidy-up. Where a project changed PM inside the export window the **most
  recent** owner is shown and the count of handovers is stated on the tab.
- **An empty Jira assignee is the string `"⚠️ UNASSIGNED"`, not a blank.** The exporter writes it
  (`assigneeName || "⚠️ UNASSIGNED"`), so any truthiness check on the Assignee column invents a
  person of that name. Every consumer must go through `dhAssigneeOf_` / `/unassigned/i`.
- **The four opportunity counts are never summed.** Undated epics · children past their epic's date
  · epics nothing rolls up to · epics untouched 30+ days. Each is a different conversation and a
  blended "PM health %" would average four unrelated problems and point at none of them. "Nothing
  linked" counts children of **any status** — an epic whose work is delivered is linked, not empty.
- **The two PM bars are different claims and must not be combined.** *Owns* (epic due-date fill) is
  the PM's own field, graded against the team's 100% bar. *In project* (task readiness) is what
  their project contains, filled by other people. Averaging them grades a PM on fields they do not
  control and cannot say which half is the problem.
- **Neither PM bar is windowed by the month filter, and that is load-bearing.** An undated epic has
  no date and so cannot fall inside a date window — windowing the *Owns* bar would leave a
  denominator of only dated epics and pin every PM at 100%, i.e. a bar that can never report the
  gap it exists to report. The month window scopes the **item lists** only.
- **"Worked with PM" (the filter) ≠ "🗓 PM" (the tab).** The filter above the tabs selects PEOPLE
  who logged or planned hours on a PM's projects; the tab reports the TICKETS a PM owns. They are
  named apart on purpose — the filter row stays visible while the tab is open.
- **Due-date bands are week-grained, and undated is coloured per surface.** 🔴 red = the committed
  week has ended · 🟠 amber = due this week (compliant) · 🟢 green = later. Undated reads **red** in
  the People drill-down, where `openIssues` has already dropped unstarted work so anything undated
  is a started commitment with no date — and **grey** on the 🗓 PM tab, which does show unstarted
  work. That inconsistency is the decision, not a bug.
- **"Overdue" means the committed WEEK has ended, not that a timestamp has passed** (schema v32,
  managers' feedback 2026-08-10). `dhOverdue_` compares the due date against `dhWeekStart_(now)` —
  Monday 00:00 of the current ISO week — so a ticket due Monday and read on Wednesday is a **live
  commitment**, not a miss. Every reporting surface here is weekly (`YYYY.WN` labels, weekly
  exports, a weekly managers' review), and the old timestamp rule also meant the same ticket could
  read on-time at 9am and overdue at 10am with nobody having touched it, because the cache warmer
  rebuilds the model on a 30-minute trigger.
  · `futureDated` ("Dated, due this week or later") is the exact complement of `overdue`, so
  `dated === futureDated + overdue` always holds — pinned by `_test_backlogOverdueWeekGrain_`.
  · The three ageing bands are gated on the same predicate **before** being aged in days, or "≤7
  days" would re-admit the current week's dates and the bands would stop summing to the total.
  · **The overdue counts drop when this deploys.** That is a definition change, not a delivery
  improvement, and the panel's own wording says which Monday it judged against
  (`backlogHealth.weekStart`).
  · `shouldHaveStarted` still uses a timestamp, deliberately left alone: it is a start-date signal,
  not a commitment-date one, and nobody has asked for it to move.

- **Workforce Change is capacity, not delivered work — and it is the only number here that
  describes people who are gone.** Added 2026-08-07 (schema v28). Every other figure on this
  dashboard describes the people who are here now: `readRosterPeople_` drops inactive rows, so a
  departure takes that person's capacity out of the denominators along with them and the utilization
  rate holds steady while the team's actual ability to deliver falls. This card is the supply side —
  scheduled capacity gained from joiners minus scheduled capacity lost to leavers, in hours per week,
  set against the queue growth printed beside it.

  Read it with four things in mind:
  - **It measures what we can no longer staff, not what stopped being delivered.** A leaver's final
    weeks are usually low-tracking (notice period, handover), so a delivered-hours reading would
    understate every departure. Capacity was the deliberate choice (user decision 2026-08-07).
  - **"Typical" capacity is the median of that person's non-zero scheduled weeks** in the 8 weeks
    after joining or before leaving — never the last week, which is nearly always partial.
  - **A movement whose capacity is unknown is counted as a person, never as 0 hours,** and the card
    says how many. This is the one failure direction that flatters us: an unknown silently worth zero
    reports a smaller loss than actually happened.
  - **Counts and hours only — who joined or left is never published.** Turnover is a fact about a
    team's capacity; naming the people inside it turns a planning number into a notice board, and
    this view is read company-wide.

  Attrition is one-sided, as everywhere else here: a person counts as gone only when the roster
  proves it (an inactive row and no active row anywhere), so a boomerang rehire is never a departure
  and a termination date on someone still listed active is a future exit, not a loss yet. Ramp-up is
  stated beside the gain rather than discounted from it — the discount would be a guess. No target,
  and none is meaningful: net zero is not automatically good.
- **Two SRSO bindings exist and they disagree — and if the gaps row is red, the fix is ours.**
  Added 2026-08-07 (schema v29). The services runbook (*HOWTO — Customer Projects in Jira*, BL02
  step B2.6) instructs the PM to bind delivery work to the money by creating a Jira **Component**
  named for the sales order — `SRSO-0xxxxx`, NetSuite URL in the description. `Jira Backlog.js`
  derives its `Billing Type` column from **Fix Versions** alone (`fixVersion ~ "SRSO*"`). An
  engagement bound exactly as the runbook instructs, with no SRSO fix version, therefore exports as
  `Untagged` — which by this dashboard's own reckoning is delivered work that cannot be recognised
  against a milestone.

  The Components column has been exported since the beginning (column 21) and was never read. It is
  now, and the gaps queue carries **"Sales-order binding our billing reader can see"**: the share of
  sales-order-bound delivered work that `Billing Type` actually sees. Both sides use the *same* SRSO
  token rule (`DH_SRSO_TOKEN_`, character-for-character the exporter's), so a mismatch is evidence
  about the **field**, never about two regexes disagreeing.

  Read the row's three blank states as three different findings, not one:
  - **Components column absent** → we did not look. Renders "not connected"; never a clean 100%.
  - **Column present, nothing bound either way** → we looked, and no delivered work in the window is
    tied to a sales order at all. That is itself the finding, and it deliberately does *not* borrow
    the wording above, which would send someone hunting for a column that is present.
  - **Otherwise** → the ratio, and the count of component-only items.

  **If this row is red, do not start a campaign to make PMs tag differently** — they followed the
  documented process. The fix is a reader change in the exporter. The row's own note says so, and a
  render-smoke check pins that wording, because an owner routed to the wrong team is worse than no
  owner at all.
- **"N named assignees match no roster row" is NOT attrition.** The gaps-queue row measures names
  that join no roster record under any alias — contractor/vendor accounts, automation accounts,
  display names spelled differently from the roster. Former employees are removed from the whole feed
  before that row is counted (and held out of the attribution index besides), and their count is
  reported separately on the same view. One attrition case can still hide there: a leaver whose Jira
  display name never matched their roster row, which the attrition test cannot see either, because it
  resolves names through the same index that is failing. The row's note said "leavers" until
  2026-08-07 and was read as exactly the opposite of the policy — see the render-smoke section that
  pins the wording.

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
  AMER / EMEA / SEA / ANZ / **Global** / **Other** / **Unassigned** (issue tokens). `Other` is a value
  we haven't mapped — extend `JIRA_REGION_TO_DH_`.
  **The filter chips are the geographic four only, since 2026-08-17** (user: *"delete Other, we have
  everyone in an assigned region already"*). The chip is not hard-coded away, it is **data-driven**
  (`dhRegionChips_`): "Other" reappears by itself the moment one person resolves to it. That matters
  because the chip is what makes a person *reachable* — every region filter matches on `p.region`, so
  a bucket with no chip is counted in every org-wide total and selectable by no filter. Deleting the
  chip outright would have made those people invisible in exactly the view someone would use to find
  them. Its return is also the alarm worth having: it means `LOCATION_REGION_MAP` has met a country it
  does not know, which is a one-line fix. `Unassigned` is a tagging gap (PR-01), counted and trended
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

### 🧬 Field fill by issue type — REMOVED 2026-08-17

The by-type matrix and the **Roster join** check are gone (user decision, schema 42). Both
summarised compliance *per evaluated parameter*; the 👥 signals roster reads the same parameters
**per rocketeer**, and a person can be asked to fix their tickets where an issue type cannot.

What went: `typeHygiene` from the payload · `typeHygieneBuckets_` / `TYPE_HYG_FIELDS_` /
`TYPE_HYG_MAX_KEYS_` on the server · `hygieneBuckets[].resAttr` · the gaps queue's *"…and that
assignee resolves to a roster person"* row · the data-trust strip's **Roster join** tile (leaving
three) · ~180 render-smoke assertions, replaced by a regression guard that fails if any of it
comes back.

What stayed, deliberately: the shared work-state predicates (`typeHygOpen_`, `dhStarted_`,
`dueExpected_`, `timeExpected_`, `dhHasDue_`) — five other surfaces read them, and re-deriving
"open" per surface is how two panels on one tab come to disagree about the same ticket;
`typeFieldGate_`, which the roster uses to resolve a gate from the metric registry; and the
Open ↔ Resolved population toggle, whose chips **moved onto the roster** — the matrix was the
only place they lived, so deleting it without moving them would have stranded the roster on
Open with no way back.

The join itself is unchanged and still gates every card. What stopped is the published
*measurement* of it, which had read 100% since the 2026-08-04 attribution fix. A name-index
regression now shows up on the gaps queue's *"Resolved work carries a Jira assignee"* row and in
each card's own `meta.jiraUnattributed` count. Restoring the matrix means restoring the builder
from git — it is not behind a flag.

Spec (historical): `delivery-health-dashboard/docs/specs/2026-08-04-hygiene-by-issue-type-design.md`.

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
pipe-joined (`"Team A | Team B"`); `splitTeams_()` splits, trims, and dedupes into the control's
individual options (a multiselect checkbox panel since 2026-08-28 — several teams combine as a
union). A person matches a team filter by **membership**: someone on
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

### 👁 Confidential view — blur names (2026-08-17)

An eye in the header **blurs every person's name and job title**. Nothing else changes: every KPI,
chart, tab and number stays exactly where it was. The dashboard is built to be shown — in an
all-hands, on a call, over a shoulder — and the thing that cannot be shown is not the delivery
rate, it is which named person is behind the red cell.

Blurred today: the 👥 signals roster (name **and** job title), the 🧭 Workforce cell
drill-down (same pair), the PM name on each 🗓 Project Managers group row, and the epic
assignee beside it.

**The first cut of this got it backwards**, and the mistake is recorded in the code because it is an
easy one to make again: it hid the margin metrics and every role-gated tab, which removed the
analysis and kept the names. That is the opposite trade. A presenter needs the numbers on screen —
they are what the meeting is about — and needs the individuals off it.

**It is presentation only.** It does not read or change a role, does not gate a view, and removes
nothing from the payload. `canSeeMargin_` and `canSeeSuper_` are untouched and keep reading role
alone, because they are the client twins of `dhMarginTier_` / `dhSuperAdmin_` in `Security.js`. This
switch is a lens over what is *drawn*; those are the gate over what is *sent*. A render-smoke check
pins that turning it on removes no tab and no metric.

**What it cannot do, stated on screen.** The names are still in the DOM, in the page source and in a
CSV export — anyone with devtools can read them. That is the correct scope: the threat it answers
is a projector, not an attacker with the page open. The banner says so rather than implying a
protection it does not provide.

Two details that are easy to get wrong and are both pinned by tests:

- **The blur must not reflow the page.** It keeps the glyphs and blurs them, so column widths,
  truncation and row heights are identical either way — a mode that reflowed would make the
  presenter lose their place mid-sentence. `user-select:none` rides along, because a blurred name is
  still selectable text and a stray drag would paste it into the chat being shared.
- **A `title` tooltip is not covered by a CSS blur.** The roster truncates job titles to fit a
  column, so the full string lives in a hover — and hovering a row is exactly what a presenter does
  while talking over it. `piiTitleAttr_` therefore returns the attribute normally and an empty
  string while blurred: the affordance survives outside the mode instead of being paid for every day
  to cover an occasional need.

**Carets, badges and state markers stay legible.** They are controls and states (▸ expand,
🎓 intern, 🌱 new hire), not personal detail — blurring them would leave a row nobody
can tell is expandable.

**Persisted, and deliberately loud about it.** It survives a reload, because presenting is a session
rather than a click. `confLoad_` applies the body class **at boot**, not on the first toggle —
without that, a reload with the mode saved restores the flag and leaves the names legible, which is
the one moment the feature exists for. The button reads `Names blurred` in amber and the Executive
tab carries a banner while it is on, because a page that silently blurs half its roster on Monday
morning is a support ticket.

**Offered only to a viewer who reaches a tab that names anybody** (`confEligible_`) — a guest gets
no eye, since an eye that blurs nothing is a promise the page cannot keep.

### The panel, rebuilt as a list (2026-08-17)

It was two text inputs holding comma-separated addresses, with the bootstrap admin mentioned in a
sentence above them. Three things were wrong with that, and only one was that it looked bad:

- **A joined string is not a list.** You could not count it, scan it, or remove one person without
  editing text — and a stray comma silently created an entry nobody noticed until somebody could
  not get in.
- **"Who has access" was split across a sentence and two strings**, so nothing on screen answered
  the one question the page exists for.
- **Open access had exactly the weight of everything else** — a checkbox, beside two inputs.

Now every person with access is a **row**, the bootstrap admin included: he holds access, and a list
claiming to be everyone who does has to contain him. His row carries `🔒 owner` and no Remove,
because the server would put him back on the next check anyway.

**The one type move:** every address ends in the same domain, so the domain is noise repeated on
every row while the local part is the only thing identifying anybody. Rows render the local part at
full weight and `@domain` dimmed — the list reads as names without a character being hidden, and the
full address stays in the row's `title`.

**Nothing round-trips until Save.** Adding four people and removing one is one decision with one
write, not five that can half-apply. The working copy diffs against the payload the server sent, so
the page states what is about to happen — *"Pending: +1 viewer, open access ON"* — and Save is
**disabled** until there is something to do. Saving re-baselines in place; it does not re-fetch.

**Validation happens in the order a person would ask it:** is it an address at all, is it already
somewhere (and the refusal names where — *"already a viewer"*), and is it one of ours. A foreign
domain is a **warning, not a refusal** — contractors and partners are real, and a rule that silently
blocked them would send an admin to edit Script Properties by hand, which is the thing this page
exists to replace. The email check is deliberately looser than an RFC pattern: the server's
allowlist decides what *works*, and being stricter than the mail system would reject real addresses.

**Removing your own account asks first**, and says what will happen rather than "are you sure?" —
it is the one action here that can lock the person doing it out of this page.

**Open access is the only control that gets colour, and only when it is on.** It is also the only
one that lets in people who are on no list, so the block states the real consequence — guests get in
without being listed, and utilization, forecast variance and the Actions / Project Managers /
Workforce tabs are not theirs to see — rather than the old label, "(demo only)".

`accessPanelHtml_(state)` is a pure function of the working copy, extracted so the panel is testable
without a `google.script.run` round-trip the DOM stub never resolves — the same reason
`rosterCsvLines_` is a builder rather than part of the download path. 46 render-smoke checks cover
it, including that no comma-joined string survives anywhere in the markup: a revert to
`admins.join(", ")` would otherwise pass every other assertion, since all the addresses would still
be on the page.

**The server contract is unchanged** — same `getDeliveryAccessSettings()` /
`saveDeliveryAccessSettings({admins, viewers, openAccess})`, so `Security.js` needed no edit and
Script Properties keep their existing comma-separated storage format. This is a client-only change:
`Dashboard.html`, no schema bump, no cache action.

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

Second, independent guard: every payload is stamped with `DH_SCHEMA_VER_` (**currently 37** — the
constant in `Code.js` is the source of truth, not this line) and
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
| 17 | **Field fill by issue type (2026-08-04).** `typeHygiene = { resolved[], open[], keyCap }` — per-type field fill over both populations, with the failing issue keys per gap. Needs `type` / `typeLabel` / `key` / `status` on the ingested record, which v16 never carried. A cached v16 model renders the matrix empty, and **an empty matrix reads as "no gaps"** — the exact opposite of the truth — so it must miss cleanly. **Retired at 42.** |
| 42 | **Removals (2026-08-17).** `typeHygiene` leaves the payload with the 🧬 matrix, and `hygieneBuckets[].resAttr` leaves with the Roster join check. The safe direction for once — a v41 entry simply carries two fields nothing reads — but worth busting anyway: `typeHygiene` carried up to 500 issue keys *per field per type*, and there is no reason to keep paying for that in every cached chunk for a whole TTL after the deploy |
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
- **The line states the cadence, not just the age** (user request 2026-08-28). Readers kept asking
  how often each feed refreshes, so a standing note — *"backlog updates hourly · Tempo hours
  daily"* — rides the freshness line whenever a stamp renders: the stamps say *when*, this says
  *how often*. A pre-v16 payload with no `dataAsOf` still renders nothing — a cadence claim over
  data whose age cannot be stated would be the exact overstatement this strip exists to prevent.

Staleness threshold: `CONFIG_DH.JIRA_EXPORT_STALE_H` (30h). Deliberately above 24 — the export
runs on a daily ~03:00 trigger, so warning at 24h sharp would paint the header amber every
afternoon. Past 30h a scheduled run was genuinely **missed**. If the trigger cadence changes,
change this with it.

The NFR-7 model-staleness warning (>48h since rebuild, which also suppresses trend comparisons)
is a **separate** condition and renders alongside the data age rather than replacing it — the two
fail independently, and one hiding the other is how a reader ends up trusting a stale number.

### … and a third signal, which is not a clock (2026-08-17)

Both clocks answer **when**. Neither can answer **under which rules** — and once the sandbox
exclusion shipped in `Jira Backlog.js` v3.14.0, that became a state a reader can be wrong about
while every clock on screen reads green:

> The export ran five hours ago. It was written by the *previous* exporter, so it still contains
> `TEST2`, `TEST5`, `AUTOT` and friends. The open backlog, the weeks-to-clear figure and the
> unrouted-epics alert are all inflated — and the header says "Data as of 5h ago".

So the exporter stamps a third footer row, `Exporter: 3.14.0`, on **both** the `Jira Raw` and
`Jira Bugs` tabs, and the dashboard reads it:

| Field | What it is |
|---|---|
| `CONFIGJ.VERSION` (exporter) | the version this run stamps into every footer — bump it with the header comment, they are one fact |
| `meta.jiraExporter.version` | what the sheet says built it; `""` when the export predates stamping |
| `meta.jiraExporter.min` | `CONFIG_DH.JIRA_EXPORTER_MIN` — the floor the published figures assume |
| `meta.jiraExporter.stale` | version **below** that floor |

Four decisions worth keeping:

- **Blank counts as OLD, not unknown.** No `Exporter:` line means the export predates stamping,
  which is precisely the case the floor is looking for. This is the opposite of the `Generated:`
  rule above (absent ≠ stale), deliberately: there, absence tells you nothing about age; here,
  absence *is* the age. `dhVersionLt_("", "3.14.0") === true`.
- **Versions compare numerically, per segment.** A string compare puts `3.9.0` *after* `3.14.0`
  and would clear a stale export as current — the exact failure this check exists to catch,
  passed off as a pass. Pinned in `_test_exporterVersion_`.
- **It is silent when current.** A version number in the header every day is noise, and noise in
  the freshness strip is what teaches people to skip the real alarm. Only `stale` renders.
- **The warning names the consequence, and bounds it.** Not "3.11.0 < 3.14.0" — which numbers are
  overstated (backlog, weeks-to-clear, unrouted), what fixes it (re-run the export), and what is
  **unaffected** (delivery, quality, utilization — none of them read the backlog). A warning that
  does not say what is still trustworthy invalidates the whole screen.

⚠ **The footer guard widened with it, and that is why schema 46 is a hard bump.** `readJiraRaw_`
used to skip footer rows by an allowlist — `/^(GENERATED|TOTAL ROWS):/`. A **v45 model reading a
v3.14.0 export** would take the new footer row as an issue keyed `EXPORTER: 3.14.0`: one phantom
epic, unassigned and undated, landing in exactly the unrouted queue this release set out to clean.
The guard is now `/^[A-Z][A-Z ]*:/` — a real Jira key is `PROJ-123` and can never contain a colon,
so the generic rule is both safer and needs no edit the next time a footer line is added. Old
model + new export is the one combination that misses **unsafely**.

## Deploy

> ### ✂ The runway read retired + action-first tables + multiselect filters (2026-08-28) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action** — client-side only,
> `Code.js` untouched. User decisions, six items:
>
> **1 · The pipeline masthead and the Runway cluster are gone (misleading runway read).** On
> Backlog & Flow, the three stat callouts (Delivery pace · Total runway · Groomed pipeline), the
> week/headcount lede (`pipelineStatsHtml_`, `renderMasthead_`, `unownedNoteHtml_` — deleted, not
> parked) and the Runway KPI cards (Inventory · Net flow · Weeks to clear · Assigned inventory ·
> Assigned weeks to clear; `backlogHeroParts_` / `backlogHeroTilesHtml_` / `assignedRunwayParts_`)
> all left the page: a whole-queue runway figure reads as a delivery forecast, and pace over a
> queue that is mostly unowned pipeline is not a promise anyone made. The backlog band keeps the
> bar + legend — counts only, no runway arithmetic, its ⓘ says why — and now opens with the
> confidential banner the masthead carried. `verdictFindings_` survives fully tested and
> unrendered, as before. The flow strip is down to two clusters: **Flow** (Throughput · Cleared ·
> Arrived · Lead Time) · **Quality** (Bug Count).
>
> **2 · Actions is roster-first.** The *"Can we publish these numbers?"* data-trust strip
> (`renderTrust_`) is deleted — the roster grades the same gates per person, and the super-admin
> trust detail on Backlog & Flow remains the provenance surface. On the roster, **Overall,
> Billable tag, Start date and Progress no longer paint columns** (the grade still drives the
> chips, the pulse and the default sort; `SIGNAL_FIELDS_` still computes the fields for the CSV
> and methodology). **"Open issues" is renamed "Backlog of the week"** and flags its overdue share
> red beside the count — **⚑ N overdue**, Jira-linked, fed by the same per-person backlog-health
> buckets the 🌊 panel reads. **Hours became "Available"** (capacity − tracked): assignable room,
> most available first, ramping/on-leave people last with no figure. CSV: "Idle h" → "Available h",
> plus an "Overdue (open backlog)" column.
>
> **3 · Each PM carries their own actionable queue.** A **"Needs action — fix these and next
> period moves"** table (`pmNeedsActionHtml_`) renders **inside each PM's collapsible section**
> (user correction, same day — a tab-level rollup made every PM read everyone's problems): No due
> date · Overdue >30d · Overdue 8–30d · Overdue ≤7d · Not linked to a parent — each row a
> one-click Jira queue over **that PM's** filtered epics — the WHOLE ROW is the click and the
> action is a plain-words **Fix in Jira ↗** button (the tab is worked by the PM themselves,
> not only reviewed by their manager). Only signals with items render, and a clean PM gets no
> table at all — the ✔ pill on their row is the standing verdict.
>
> **4 · The Workforce pool grid is simplified to five columns** — Person/cell · Head · Capacity ·
> Committed · Available. Plan-vs-logged, Outside plan, Cover, Relative cover, State and Cell size
> left the canvas, and **people rows are open by default** (`STATE.wfOpenCell` now stores the
> collapsed exceptions): the list of names with their available time is the tab's deliverable,
> not a drill-down.
>
> **5 · Team / PM / Job family filters are multiselect.** `STATE.team`/`pm`/`family` are arrays,
> several values are a union (`dimMatchAny_`); `fillMulti_` replaces `fillSelect_` with a button +
> checkbox panel, single-open (`STATE.msOpen`), Esc closes. Region stays a single chip.
>
> **6 · The freshness line states the cadence** — a standing *"backlog updates hourly · Tempo
> hours daily"* note rides it whenever a stamp renders; nothing renders on a payload whose data
> age is unknown.
>
> **Live smoke:** Executive → Backlog & Flow reads pulse → backlog bar → two card clusters, with
> no stat callouts and no runway/weeks-to-clear figure anywhere. Actions opens on the roster
> (no trust strip) with Backlog of the week ⚑ flags and an Available column. PM opens on the
> Needs-action table. Workforce shows five columns with every person row expanded. Team/PM/family
> filters open checkbox panels; picking two teams shows the union.

> ### 🖱 Cells navigate + dot-only Overall + stacked person bars (2026-08-18) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action** — presentation and
> client-side interaction only.
> Spec: `docs/specs/2026-08-18-dh-drill-through-and-overall-fix-design.md`.
>
> **One-click drill-through.** Every value cell in the Executive drill grid is now a control:
> click = the row's slice + the clicked metric + the metric's own tab, in one step (`drillGo_`,
> `DRILL_DEST_`). Availability lands on **Workforce** with the pool × band cells holding free
> sellable hours already expanded (`wfExpandAvailCells_`); On-Time / Forecast / Quality land on
> **Actions** with the signals roster's **Need action** chip pre-set; Planned Coverage lands on
> Actions with no chip — its acting surface is the roster's own Plan column. A "—" cell stays
> click-inert. The row click and the two header buttons keep their 2026-08-17 semantics.
>
> **Overall column is dot-only.** Its "· N missing" summed per-field misses — one ticket missing
> two fields counted twice — so managers read "67 missing" as 67 tickets. The sum still drives
> the opportunity sort and the CSV; the per-field cells keep their own counts, where the column
> header supplies the noun.
>
> **Per-rocketeer stacked bar.** The Workforce drill-down's Capacity/Planned columns became one
> bar per person: planned fills first, available follows, the row ends in that person's own
> availability rate (`wfPersonBarHtml_`). Bar length scales to the longest capacity in the list,
> so hours compare across people. Held-back rows (🏖 🌱 bench) draw muted with no rate; zero
> capacity keeps the "—" rule. The Available column and sellable subtotal still reconcile.
>
> **Sellable headroom, modern view.** Same bar language at the org and band zoom levels: the
> headline is now a hero row — the rate beside one full-width two-tone capacity bar (committed
> fills first, free follows, segments labelled in hours) — and the Level-band table became
> aligned bar rows (`wfBandRowsHtml_` rewrite): bar length ∝ each band's own scheduled hours
> against the largest band, free hours bold first, rate as the qualifier, head count riding
> along, Over-allocated pill instead of a minus-rate. Four paragraphs of prose compressed to
> two lines; every load-bearing fact survives on screen — the one-definition guarantee, the
> "of N backlog consumers" denominator, the role-gates/level-blind statement, and the refusal
> of a company-wide blend.
>
> **Live smoke:** Executive → Drill-down, hover any value cell (pointer + ring + tooltip naming
> the destination), click EMEA × Forecast Accuracy → Actions opens on EMEA's Need-action people.
> Back on Executive, click a region's Availability Rate → Workforce opens with that region's
> cells expanded and a two-tone bar + rate per person. Actions → signals roster: the Overall
> column shows dots only.

> ### ⚠ Long leave leaves the capacity pipeline (2026-08-18) — both dashboard files, **numbers move**
>
> Paste `Code.js` + `Dashboard.html` → deploy → run `bustDeliveryCache_()` (schema **47**).
>
> **Availability Rate and Sellable Headroom FALL on this deploy**, along with commitment
> fidelity, cover and the constraint index. Brief it before anyone sees the step. The registry
> entry (4.3) populates `affects`, so every touched trend line carries the "✎ definition
> changed" marker — the step people see is the definition moving, not delivery moving.
>
> **The defect.** `buildCapacity_`, `dhHeadByCell_` and `buildCommitment_` carved `p.onBench`
> but never `p.onLeave`. `utilRollup_` — which powers Executive utilization — has excluded
> `onLeave` since the feature shipped, on the stated reasoning that *"Tempo schedules lag HR
> for leave"*. This pipeline simply never consulted the flag. A person on sabbatical or
> parental leave therefore contributed full gross scheduled hours and almost no plan, so very
> nearly their entire schedule landed in **sellable headroom**: the dashboard was offering
> Sales the availability of people who are not at work, while the panel caption promised the
> two tabs could not disagree.
>
> **Not the same thing as the PTO deviation, which stands.** PTO is unmeasured because there
> is no absence feed and the only proxy (Tempo NETSUITE time-off) would penalise the teams
> with the best time-tracking discipline. Long leave is a roster STATUS already parsed into
> `p.onLeave` / `p.leaveStatus` and already trusted on the other surface — an omission, not a
> judgement. Heads carve with hours deliberately: a head left in a cell whose hours are gone
> makes every per-head figure divide by the wrong number of people.
>
> **Also in this deploy — the level question, answered on the panel.** "Is that 19% from people
> who can consume backlog based on role *and level* logic?" (user, 2026-08-18). Role: yes.
> Level: no — the headline sums gross and committed across every consumer cell and divides
> once, and backlog routes by `backlog[pool]`, never by band. The panel now says
> **"Role gates this number; level does not"** and renders `wfHeadroomByBand_()` underneath:
> headroom per level band, sorted by free HOURS (a three-person band posting 80% on 9h must
> not outrank a band with 600h on the table), each band dividing by its own scheduled hours.
> The headline arithmetic is untouched — it is published on two surfaces and `wfAvailability_`
> stays the single definition.
>
> Why the split rather than a smarter headline: ServiceRocket's own Availability definition
> (Confluence, *ServiceRocket Definitions* v5) heads its criteria **"Effectiveness, Not
> Occupancy"**, lists *wrong-fit assignment* as failure mode one, and says plainly *"free up the
> smartest people; don't have seniors stuck on work juniors can do"* and *"junior staff at 95%
> utilization is a system failure"*. A single blended percentage cannot show either condition.
> The same page's playbook reads **high availability + high backlog → skill/capability
> mismatch** — which is the pair this dashboard already displays.
>
> **Known and deliberately NOT changed:** `utilRollup_` also excludes interns (`p.isIntern`);
> this pipeline does not. Aligning them would move the published number again, and whether an
> intern's free hours are sellable is a business call — the same definition argues juniors need
> protective slack rather than exclusion. Left as-is, stated here so it is a decision and not
> an oversight.
>
> Tests: `node-tests` all suites (`_test_leaveCarve_` pins all three builders plus parity with
> `utilRollup_`); `render-smoke` **1679 checks**.

> ### 🏷 The export stamps its own version, and the dashboard reads it (2026-08-17) — `Jira Backlog.js` **+** both dashboard files
>
> **Order matters, and it is not the usual "exporter first".** Deploy the dashboard files and
> bust the cache **before** the export re-run — see the footer-guard note above. If the export
> runs first and someone loads a warm v45 entry, they get a phantom `EXPORTER: 3.14.0` epic in
> the unrouted queue.
>
> 1. Paste `Code.js` + `Dashboard.html` → deploy → run `bustDeliveryCache_()` (schema **46**).
> 2. Paste `Jira Backlog.js` (v3.14.0) → re-run the export.
> 3. Reload. The header should show **no** exporter line. If it reads *"⚠ built by an older
>    exporter"*, step 2 did not take — check the exporter's execution log.
>
> **Between step 1 and step 2 the header will warn**, correctly: at that moment the sheet really
> was built by the old exporter and the backlog figures really are inflated. That window is the
> feature working, not a regression.
>
> **What moves on this deploy** (brief it before anyone sees it): the sandbox exclusion removes
> `TEST2` / `TEST3` / `TEST3ZED` / `TEST5` / `TESTEIG01` / `TESTACLAW` / `AUTOT` from every Jira
> figure. `TSBA` ("Test Space - by Alfie") is a genuine test project miscategorised as **COE** in
> Jira — no code rule can know that, so `logProjectScope_` reports it and it stays in the export
> until an admin recategorises it as **Internal**.
>
> Tests: `node-tests` all suites; `render-smoke` **1666 checks**.


> ### 🧮 Idle hours priced per level band, never blended (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action.**
>
> **The complaint (user):** "307h left on the table" was mostly meetings, breaks, coaching, and
> intern time — managers carry more consulting/meeting/coaching load than tracked work.
>
> **What the sources say** (Rovo, 2026-08-17): the RevOps reference *Delivery Utilization: How We
> Measure It* defines net utilization as **all logged hours ÷ net capacity** and shows FTE ran
> ~85% across FY26 — the achieved rate already carries structural overhead. *POL - Time Logging*
> classes meetings, 1:1s, coaching, admin and ramp-up as loggable internal time; the *Manager
> Playbook* makes coaching and calendar load part of the manager's job. The Metrics Dictionary
> reads utilization "to find where the system is getting in a Rocketeer's way, not to rank
> individuals."
>
> **The fix:** the idle-hours figure is now priced against **each level band's OWN achieved
> operating rate** (`bandNorms_`: MGMT / SENIOR / CORE / JUNIOR, scoped series per band) — the
> same "never blended" doctrine the Workforce tab applies to capacity. A manager's ordinary
> meeting/coaching load sits inside the MGMT band's rate instead of being priced as idle against
> a consultant-dominated median. Bands without a publishable rate of their own are **excluded and
> disclosed** ("N people sit in a band without enough history to price — left out, not guessed
> at"), never priced against the blend. Interns (the ~50% helpers), ramping new hires, leave and
> bench stay excluded as before. Also fixed: the alert's grain word follows the period picker —
> "before this **month** repeats it" on a month window, not "week" under a "Jul 2026" label.
>
> **Live smoke:** hover the ⚡ alert — the tooltip states the per-band method and any unpriced
> count. The figure should drop versus the blended version wherever managers were being priced.

> ### 🚨 Non-delivery projects were being exported (2026-08-17) — `Jira Backlog.js` v3.14.0
>
> **v3.14.0 supersedes the v3.13.0 note below — read this one.** Rovo was asked what Jira already
> knows, and it knows more than our pattern did: projects carry a **`projectCategory`**, and one of
> them is **"Internal"**, described in Jira as *"For internal or test projects"*. Every reported
> sandbox carries it — `TEST2`, `TEST3`, `TEST3ZED`, `TEST5`, `TESTEIG01`, `TESTACLAW`, **`AUTOT`**.
>
> **The key pattern missed `AUTOT`** ("AUTO02 (Testing)") — its key does not start with TEST. The
> category catches it, and needs no edit when the next sandbox appears.
>
> Resolution order in `getSpaceForIssue_`:
>
> | Step | Rule | Effect |
> |---|---|---|
> | 1 | `CUSTOMER_PROJECT_MAP` | rescue — a named client always survives |
> | 2 | `projectCategory` in `NON_DELIVERY_CATEGORIES` | **excluded** (authoritative, self-maintaining) |
> | 3 | `EXCLUDE_PROJECT_RE` on the key | excluded — backstop for the uncategorised |
> | 4 | name looks like a sandbox but category says otherwise | **reported, never excluded** |
>
> **Step 4 is the important one.** A name is never a reason to drop work: `ADT02` is "COE-63
> Advant**est**" and `ISUATTEST` is real COE delivery. But **`TSBA` = "Test Space - by Alfie" is a
> genuine sandbox sitting in the COE category** — no code rule can tell it from a client, so the run
> logs it for a human to recategorise in Jira. **That one is still being exported until somebody
> fixes its category.**
>
> **Fails open, loudly.** If `/rest/api/3/project/search` fails, the run falls back to the key
> pattern alone and says so. Failing closed would empty the export on a transient 500, and an empty
> `Jira Raw` reads downstream as "the business delivered nothing this week" — far worse than
> re-admitting a few sandboxes for one run. Cost: one paged GET per run, cached for the run.
>
> **Verified** against the live category data for 15 projects (all 7 sandboxes excluded; Adobe, ANZ
> Bank, NVIDIA, Advantest, ISUATTEST and an uncategorised new client all kept) with a local harness,
> since this exporter has no test suite.
>
> **Read the three new log lines after the run:**
> - `🚫 Excluded N non-delivery project(s)` — what went.
> - `ℹ N project(s) excluded by KEY PATTERN with no Jira category to back it` — ask an admin to set
>   their category, after which the pattern is redundant for them.
> - `❓ N project(s) NAMED like a sandbox but categorised as delivery work` — the `TSBA` list.
>
> ### 📜 Superseded: v3.13.0 (pattern-only)
>
> **EXPORTER CHANGE. Deploy it FIRST, re-run the export, then the dashboard.** Nothing in
> `Code.js` / `Dashboard.html` changes for this.
>
> **What was wrong.** This exporter is documented as exporting services work. It was exporting
> **every project on the Jira site** except `TEMPLATE`, a disabled R&D, and noise statuses.
> `getSpaceForIssue_` ends in `return clientName || projKey` — an unmapped project resolves to
> *itself*, never to `null`, and every caller filters on `!== null`. So a sandbox passed the scope
> filter as if it were a client.
>
> Reported live: **57 epics** across `TEST2`, `TEST3`, `TEST3ZED`, `TEST5`, `TESTEIG01` sitting in
> the open backlog and the unrouted alert. They can never route — nobody logs services time to a
> sandbox — so they sat there permanently, inflating the queue and the unrouted count.
>
> **The fix.** `CONFIGJ.EXCLUDE_PROJECT_RE` (`^(TEST|SANDBOX|DEMO|TRAINING|PLAYGROUND|SCRATCH)`),
> applied inside `getSpaceForIssue_` so it reaches **every** fetch — open, done and created — rather
> than one JQL. Anything named in `CUSTOMER_PROJECT_MAP` is checked first and always survives.
>
> A pattern rather than a list, because the list is what goes stale: the next sandbox is `TEST6` and
> nobody will remember this file.
>
> **⚠ THE OPEN BACKLOG AND WEEKS-TO-CLEAR WILL FALL AGAIN.** This is now the *third* movement in
> that number — 4.9w (assignee-scoped) → 11.0w (2026-08-06, assignee clause dropped) → lower again
> once the sandboxes leave. The 3,279 / 11.0w figures in this README include the noise. Brief it, or
> a third unexplained number destroys confidence in all of them.
>
> **Run the export and read the log.** Two new lines:
> - `🚫 Excluded N non-delivery project(s): TEST2 (33), TEST5 (14)…` — what was dropped, so the
>   exclusion is never silent.
> - `ℹ N project(s) exported as customer work but NOT in CUSTOMER_PROJECT_MAP: …` — **read this
>   one.** It names every project still riding the fallback path. A local check already flags `GTT`
>   and `SRSO`, which are internal tracking projects, not clients — GTT is where this dashboard's own
>   status tickets live.
>
> **The real fix is an allowlist**, which this is not. `CUSTOMER_PROJECT_MAP` holds three entries
> against a client list that is plainly longer, so inverting the rule today would delete most genuine
> work. That second log line exists to build the real list; once it is complete, invert
> `getSpaceForIssue_` and delete the denylist.
>
> ⚠ **This exporter has no automated tests** — it never has. The resolver was verified against the
> 57 reported keys plus COE / NVIDIA / Cultivate / Mostly / RND with a local harness before shipping,
> but the first real run is the first real test.

> ### ✂ Unrouted split + the delivered carve (2026-08-17) — schema v44 → v45
>
> `Code.js` + `Dashboard.html`, then **`bustDeliveryCache_()`**.
>
> **⚠ THE BACKLOG NUMBER DROPS, ON PURPOSE. Brief it before anyone sees it.**
>
> **What prompted this.** A live epic with **every child Done and 22h45m logged** was sitting in the
> unrouted alert as though nobody had touched it. Not a display bug — it exposed two real defects:
>
> 1. **A grain mismatch.** `buildBacklog_` takes every open epic with **no window at all**, but the
>    only routing signal is a **52-week** Tempo export (`EXPORT_HISTORY_WEEKS`; `TempoTrackedTime.js`
>    queries Tempo *"in this range only"*). An epic whose work finished over a year ago can never be
>    routed — its hours are not in the file. Jira shows them because Jira counts forever.
> 2. **Finished work counted as backlog.** An OPEN epic whose children are all Done is not an
>    obligation. It was inflating both the hours and the unrouted count.
>
> **Three changes:**
>
> - **Unrouted splits into three states**, because they have three different answers:
>
>   | State | Meaning | Action |
>   |---|---|---|
>   | `stale` | untouched for over 30 days | **the only one that raises an alert** |
>   | `hasHours` | somebody DID work on it — logger outside the counted pools, or hours predate the export window | our routing gap, not a queue |
>   | `fresh` | untouched and recent | newly sold work — normal, no action |
>
>   The three **partition** unrouted, in both count and hours (asserted server-side).
> - **The alert covers `stale` only**, is headed *"Needs a decision"* rather than *"Action
>   required"*, and its button links **only the stale keys**. The other two states are stated beside
>   it, so the headline is never read as the queue.
> - **Already-delivered epics leave the backlog** (`deliveredEpics/Hrs/Keys`). Carved only when an
>   epic has **≥ 1 known child and all of them are finished** — an epic whose children are not in
>   the export is *unknown*, never *done*, or the carve would silently delete real work as children
>   age out of the resolved window.
>
> **Live smoke:** Workforce → the top card reads *"Needs a decision · unrouted for over 30 days"*
> with a **Review N epics ↗** button, and names the other two states beneath it. The backlog table
> states how many delivered epics were excluded and their hours. Compare the headline backlog figure
> against the last deploy — it should be **lower**, by roughly the delivered hours the table names.
>
> **Still open upstream** (DATA-BLOCKERS #7): none of this fixes routing itself. While there is no
> `requiredPool` field, an epic only reveals its pool once somebody logs to it — the wrong way round
> for planning. The split makes the size of that gap visible; it does not close it.

> ### ⚡ Backlog & Flow as a command center (2026-08-17) — `Dashboard.html` only
>
> **📜 Items 1–2 superseded 2026-08-28** (user decision: misleading runway read) — the masthead's
> stat callouts and the whole Runway cluster, Assigned twins included, were removed outright; see
> the 2026-08-28 note above. Items 3–4 stand.
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action** — presentation and
> layout only. Director feedback, four items:
>
> **1 · The verdict paragraph and the beige note are gone.** The masthead now carries only the
> three stat callouts (Delivery pace · Total runway · Groomed pipeline) plus the scope/gates
> line. The "We are holding N items…" ranked-verdict paragraph restated the callouts; deleted.
> The "Note on unassigned work" block survives as a **data-gated ⓘ tooltip beside Groomed
> pipeline** — the figure it explains — same sentence, no beige block. `verdictFindings_` (the
> ranked-verdict engine) survives fully tested but renders nowhere: its thresholds are doctrine
> and a later surface (digest email, Slack post) can pick it up without rebuilding it.
>
> **2 · The Assigned pair joined the Runway family.** ASSIGNED INVENTORY and ASSIGNED WEEKS TO
> CLEAR left their floating spot under the backlog bar and now render in the **Runway cluster,
> each beside its ORG twin**: Inventory · Assigned inventory · Weeks to clear · Assigned weeks
> to clear. The scope tags (ORG vs SNAP) say which pair follows the filters; the backlog band's
> ⓘ line explains the two-denominator design. Builder: `assignedRunwayParts_()`.
>
> **3 · Idle hours lead the tab.** The People-signals band moved up to sit **directly under
> the stat callouts**, and when a finished window prices idle capacity, the panel opens with an
> amber alert — **⚡ 307h left on the table in 2026.W33 → open the roster before this week
> repeats it** — clickable (and keyboard-reachable) straight to the roster, biggest gap first.
> ⚠ Wording fixed same day (user): the figure is priced on the last COMPLETE week, whose hours
> are gone — the alert names that week and never claims they are "recoverable this week".
> Same gates as before: finished windows only, and a measured 0h stays a quiet inline mention,
> never a banner.
>
> **4 · The colour key is deleted.** `#flowKey` is out of the markup and `ragKeyHtml_` went with
> its last caller. This tab is mostly ungraded volume metrics; every graded card carries its own
> ✔/▲/✖ glyph and value label (FR-4.4), so status never rested on the legend.
>
> **Live smoke:** Executive → Backlog & Flow. Reading order: three big figures → amber
> recoverable alert → backlog bar → clustered cards. No paragraph under the callouts, no beige
> note (hover ⓘ on Groomed pipeline instead), Assigned cards sit inside Runway beside their ORG
> twins, and no colour-key text anywhere on the tab.

> ### 🗓 PM tab decluttered — pills, ⓘ methodology, sharper tooltips (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action** — presentation and
> client-side interaction only. Director feedback, five items:
>
> **1 · The 8-line methodology paragraph is off the page.** The attribution/windowing prose under
> the heading now lives in a collapsed `<details class="pmMethod">` labelled **ⓘ How PM ownership
> is calculated** — one quiet line, expandable, state survives re-renders (same decision as the
> key grid). Every sentence is unchanged inside it, including the backlog-carve and the
> "why Actions shows a higher 🚩 number" reconciliation.
>
> **2 · Signal pills, not a text log.** Each PM's gaps render as horizontal colour-coded pills
> (`.pmPill`): `🚩 8 no due date` `✖ 2 past due date` `⚠ 4 at risk` `🔗 7 unlinked`
> `🕒 3 untouched 30d+`, biggest first, zero-count signals absent, `✔ No open gaps` in green when
> clean. A director scans down the PM list and sees who carries the most red.
>
> **3 · Attribution jargon behind ⓘ.** "Attributed: N by Jira assignee · M by Tempo project lead"
> is no longer a row — the split lives in a ⓘ tooltip beside each PM's **Owns** figure, for the
> moment a PM disputes a row.
>
> **4 · Tooltips punched up.** The no-due tooltip is now *"Work started without a deadline. This
> bypasses On-Time Delivery tracking and requires immediate scoping."* — same treatment on the
> at-risk / breached / stale / unlinked tips at both PM and epic/child grain.
>
> **5 · Every pill acts.** The no-due pill opens its keys directly in the Jira issue navigator
> (the payload names them). The counts-only pills open the PM's epic list — their counts cover the
> PM's FULL epic set, wider than the month window drawn below, so a key link could not match the
> pill's own number; routing to the on-screen evidence is the honest click. "Open all/these in
> Jira" links are unchanged.
>
> **Live smoke:** open 🗓 Project Managers. One collapsed ⓘ line under the heading, no wall of
> text. Pills under each PM name; hovering ⓘ beside Owns shows the attribution split; clicking a
> red no-due pill lands in Jira on exactly those epics; clicking an amber pill opens that PM's
> epic list. No row anywhere reads "Attributed:".

> ### 🖱 Drill-down rows are controls + no more "no reference" + Over-allocated (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action** — presentation and
> client-side interaction only.
>
> **1 · Rows select.** Clicking a drill-down row (or pressing Enter/Space on it — rows are
> `role="button"` and keyboard-reachable) sets that category's own universal filter, exactly as
> `drillPick_` always did for the deleted chips. The row highlights (`.rowActive`, blue left bar +
> tint, `aria-pressed`), and the **Who is available →** / **What needs action →** buttons in the
> header inherit the slice by name before they are clicked. Clicking the active row again clears
> it. Row keys travel by index through `DRILL_ROW_KEYS_`, never inlined into the onclick, so a
> category name with a quote in it cannot break the handler.
>
> **The bug this surfaced (fixed here):** `renderCompare_` claimed the compare dimension's own
> filter was "switched off while the bars are built" — true for row MEMBERSHIP (`passesFilters_`'s
> skip argument) but not for the metric accessors inside `scopedMetric_`, which apply the raw
> filters. Selecting AMER therefore blanked every other row's values and reshuffled the ranking
> under the click. The filter is now **parked** for the duration of the fold (rows AND the
> per-column operating bands, restored in a `finally`), so selecting a row narrows the page while
> the table keeps showing the whole comparison.
>
> **2 · "no reference" is gone.** The caption on target-less cells (live again since the
> Availability column joined the grid — it has no ratified target) forced the reader to guess what
> the system meant. The cell now prints the raw value with its neutral grey bar alone; the fact
> moved into the tooltip: *"No organizational target has been set for this metric…"*. The absent
> RAG glyph already reads as "not graded" in the scan.
>
> **3 · Over-allocated, never a negative rate.** Availability = (scheduled − planned) ÷ scheduled,
> and planned CAN exceed scheduled — the fold does not cap. A negative percentage is a burnout
> signal wearing a math costume, so every surface publishing the rate now translates it the same
> way: value clamps to **0%**, a red **`Over-allocated`** pill appears, and the overrun is stated
> in hours (the unit a leader can reassign) — on the drill-down cell (tooltip carries the
> magnitude), the Availability Rate card, and the Workforce tab's "one honest number".
>
> **Live smoke:** Executive → Drill-down. Click the ANZ row: it highlights, the header buttons
> read "… → · ANZ", EMEA's cells keep their values, and clicking **Who is available →** opens
> Workforce already narrowed to ANZ. No cell anywhere reads "no reference". If any slice is booked
> past capacity, its availability shows `0% Over-allocated` in red, never a minus sign.

> ### 📊 Drill-down cells: graded at every size, with the counts (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action.**
>
> **The rule that changed.** A drill-down cell for a category under 10 people used to render
> `● 50% ungraded (small n)` — grey, uncoloured, with a caveat. That greyed the cell failing
> hardest, broke the scan, and left the reader to judge severity from fine print on the row least
> likely to get that effort. **Small groups are now graded exactly like large ones**: if ANZ is at
> 50% against an 85% target it is red, the same as AMER.
>
> **The caveat is answered, not repeated.** The question it was really asking — is this 50 of 100 or
> 1 of 2 — is now printed:
>
> | Before | After |
> |---|---|
> | `● 50% ungraded (small n)` | `✖ 50% (1/2 items)` |
> | `● 50% ungraded (small n)` | `✖ 50% (3/6 items)` |
>
> The counts come from the metric's OWN denominator, scoped to the same population as the rate
> (`scopedMetricN_`), so the fraction and the percentage can never describe different sets. The
> numerator is derived from the **unrounded** value, so 66.67% of 3 prints 2/3 rather than the 2 a
> rounded 67% would give back at other ratios.
>
> **Only where the count is a count.** `onTime` → items, `forecast` → epics, `quality` → items.
> Utilization and Planned Coverage measure HOURS, so they carry no noun and print the rate alone —
> `(1400/2000 items)` under a utilization cell would be a unit nobody measured.
>
> **The row mark follows the cell.** The ▸ offender mark on a row name no longer requires 10+ people
> either; a red cell beside an unmarked row was the two halves of one table disagreeing.
>
> **Live smoke:** Executive → Drill-down, compare by Region or Team. Every cell carries a RAG glyph
> and its counts; no cell reads "ungraded (small n)" and no grey ● remains. A small region below
> target must be RED, and one above target GREEN — if everything small went red, the grading is
> ignoring the target rather than applying it.
>
> ⚠ This changes **only** the drill-down grid. The KPI tiles keep their own `⚠ small sample` note
> (`smallN_`, under 15 records) and the signals roster keeps `SIGNAL_MIN_N` — those are different
> surfaces with different questions, and neither was in scope.

> ### 👁 Confidential view — blur names (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action, `Security.js` unchanged.**
>
> **Live smoke, as an admin:**
> 1. The header carries an eye reading **Blur names**. Click it → it turns amber and reads
>    **Names blurred**, and the Executive tab shows a banner.
> 2. Open 👥 Actions: names and job titles are illegible; the caret, the 🎓/🌱
>    badges and **every number in the row** are unchanged. Column widths must not move when you
>    toggle — if the table reflows, the blur has become a redaction.
> 3. Hover a blurred job title → **no tooltip**. Toggle off, hover again → the full title is back.
> 4. Check 🗓 Project Managers and 🧭 Workforce: PM names, epic assignees and the pool
>    drill-down names are blurred too.
> 5. **Nothing disappears.** Every tab an admin had is still there and every metric still charts.
>    If a tab or a KPI vanishes, that is the first cut of this feature coming back — revert it.
> 6. Reload with it on → it comes back on, blurred **from the first paint**, with the banner saying
>    why.

> ### 🔒 Access panel rebuilt as a list (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no cache action, and `Security.js` is
> unchanged** — same RPCs, same comma-separated Script Properties storage. Client only.
>
> **Live smoke (admin account, 🔒 Access tab):**
> 1. Every person is a row. The bootstrap admin is IN the Admins list with `🔒 owner` and no
>    Remove; your own row is tagged `you`.
> 2. The card headers count people — Admins includes the owner, Viewers does not.
> 3. Add a malformed address → refused inline, not saved. Add one that is already listed →
>    refused with WHERE it already is. Add one on another domain → accepted, with an amber warning.
> 4. Save is **disabled** until you change something, then reads the change set
>    (`Pending: +1 viewer`). Save, and it returns to "No changes to save" without a reload.
> 5. Toggle Open access → the block turns amber and states what a guest can actually see. Toggle
>    it back before you leave the page.
> 6. Remove your own row → it asks first, and says you will lose this page after saving.
>
> ⚠ **Check it as a VIEWER too**: the tab is admin-gated in `VIEWS` and the RPC throws for anyone
> else, so a viewer should never reach this panel at all.

> ### 📉 Drill-down narrowed to the rates with agreed bars (2026-08-17) — `Dashboard.html` only
>
> Paste `Dashboard.html` and deploy. **No schema bump, no `bustDeliveryCache_()`** — two constants
> changed, nothing about the payload moved.
>
> **Out of the Drill-down (Tier 3), from BOTH halves — the metric chips and the grid columns under
> the chart:** Lead Time · Throughput · Cleared per Person · Assigned wks to clear.
>
> **In:** On-Time Delivery · Forecast Accuracy · Quality / Rework. (Billable Utilization stays in the
> list and stays switched off behind `SHOW_UTILIZATION_`; Planned Coverage is the planning-window
> member and still swaps in on a forward window.)
>
> **Why these four went.** None of them has a ratified target — they were graded against the
> operating band instead — and a bar chart of a target-less metric invites a comparison the numbers
> cannot settle: *"EMEA clears fewer per person than AMER"* moves with team size, work mix and
> ticket granularity, none of which is visible on the bar.
>
> **Lead Time and Throughput keep their compact tiles in Tier 2** — they left the drill-down, not the
> dashboard. **Cleared per Person and Assigned wks to clear now render nowhere.** Their `METRICS_`
> accessors deliberately survive: `shelfRows_` walks the *server* registry, which still defines both,
> and calls `metricSampleN_` / `metricCoverageNow_`, which look the id up in `METRICS_`. Delete the
> entries and the shelf silently loses its sample-size read for metrics it still lists.
>
> **⚠ One rendering path lost its live subject.** Every surviving grid metric has a ratified target,
> so `gridCellHtml_`'s *"no reference"* branch (no target **and** no publishable norm) is no longer
> reachable from the UI. It is still tested directly, but if the last target-less metric ever leaves
> the registry too, delete the branch rather than leaving a path nothing can enter.
>
> **Live smoke:** open Executive → Drill-down. The metric chips read On-Time Delivery · Forecast
> Accuracy · Quality / Rework, and the table beneath the chart has the same columns — the two halves
> agreed on nothing before this change and must agree now. Lead Time and Throughput still have tiles
> in Tier 2. Post the GTT-605 dated status comment.

> ### 🧹 Gaps queue deleted (2026-08-17) — `Dashboard.html` only, NO schema change
>
> Paste `Dashboard.html` and deploy. **No `bustDeliveryCache_()` and no schema bump** — this is
> presentation only: `gapsRows_()` still computes exactly as before, and the trust strip, the
> masthead's gates finding and the shelf all read it unchanged. Nothing about the payload moved.
>
> **What must be GONE:** the *"Whole-population view — the dashboard filters deliberately do not
> apply"* caption and the table under it, its Gap / Coverage / Gate / Blocks header, the
> coverage-colour key, the window banner above it, and the `✔ Solved and retired from the queue`
> line.
>
> **What must still WORK — and this is the half worth checking:**
> 1. Data-trust strip → its three tiles are unchanged, and a new line beneath them reads
>    **⚠ Also below bar, with no tile above: …** naming the checks that lost their only home
>    (region tagging, team tagging, the billable classification, capacity source, SRSO binding,
>    reopen/CSAT, engagement key). If that line is missing while the Executive masthead says *"N of M
>    evidence gates are below their bar"*, the masthead is counting things nothing on the dashboard
>    can name — stop and fix that before showing anyone.
> 2. The strip's footer no longer points *"further down this tab"* at a queue that isn't there.
> 3. ⚙ **Coverage gates** still opens for an admin, at the bottom of Actions. For a **viewer** the
>    whole panel is now absent (`display:none`), not an empty bordered card.
> 4. Nothing on the panel claims a period any more. Change the header period picker — the gates
>    panel must not move, because nothing on it follows a window.
> 5. Post the GTT-605 dated status comment.

> ### 🗓 Project Managers — the To Do carve, plus two filter deletions (2026-08-17) — schema v42 → v43
>
> `Code.js` + `Dashboard.html`, then **`bustDeliveryCache_()` — REQUIRED, and this one is the
> dangerous direction.** A v42 entry carries the OLD, wider `epicN`, so every PM's Owns bar reads
> **lower** than the new rule says it should — a stale model quietly accusing named people of missing
> commitments they were just excused from — and it has no `epicBacklogN`, so the "N in backlog, not
> graded" note renders as nothing and the exclusion the bar now depends on is invisible.
>
> No exporter change and no export re-run.
>
> 1. **Undated To Do epics no longer count against a PM.** *"Project managers cannot be punished for
>    Epics available with no due date if they have the status TO DO, since it is part of the assigned
>    backlog."* An epic that is neither started nor dated leaves the **Owns** denominator; it joins
>    the bar the moment somebody starts it **or** dates it. A **started** epic with no date still
>    fails the bar — that is the case the bar exists for.
>    The carve is narrow on purpose: a **dated** To Do epic stays in, because a date is a commitment
>    whatever the status column says (the managers' 2026-08-10 rule, unchanged).
> 2. **The exclusion is counted, never silent.** `epicBacklogN` prints beside the bar as
>    *"N in backlog, not graded"*, the keys are listed under **○ In backlog** when a row is opened,
>    and a PM whose every epic is undated backlog reads **"no committed epics"** rather than a clean
>    100% over an empty denominator.
> 3. **⚠ The 🚩 audit on Actions will now show a HIGHER number than this tab, on purpose.** It is an
>    org-wide ticket queue with nobody's name on it and takes no carve. The PM tab states the
>    difference on screen so the two are not read as a contradiction. If you would rather the audit
>    took the same carve, that is a one-line change in `epicDueAudit_` — but it changes a rule the
>    managers ratified at 100% on 2026-08-10, so it is a decision, not a tidy-up.
> 4. **The tab is now "Project Managers".** The `id` is still `pm`, so bookmarks and deep links are
>    unaffected. The **"Worked with PM"** filter above the tabs keeps its name — it selects *people*
>    who worked for a PM, which is a different thing, and the two are deliberately named apart.
> 5. **The "Focus" filter is gone.** Plan / Billable / Non-bill drove the People grid, which was
>    removed on 2026-08-05; from then until now the chips changed nothing but their own highlight.
> 6. **The "Other" region chip is gone** — data-driven, not hard-coded: it returns by itself if any
>    person ever resolves to it, which is the signal that `LOCATION_REGION_MAP` has met a new country.
>
> **Live smoke:** open a PM with backlog epics → the bar states *"N in backlog, not graded"* and the
> opened row lists them under **○ In backlog**; the 🚩 line now reads *"Started, with no due date"*.
> Check the region chips are the geographic four. Check the scope chip no longer carries a Focus term.
> Post the GTT-605 dated status comment.

> ### 🧹 Removals — the 🧬 matrix and the Roster join check (2026-08-17) — schema v41 → v42
>
> `Code.js` + `Dashboard.html` (Security.js unchanged), then **`bustDeliveryCache_()`**.
>
> **This is the one deploy in this file where a stale cache is not dangerous** — a v41 entry simply
> carries two fields (`typeHygiene`, `hygieneBuckets[].resAttr`) that nothing reads any more, so
> nothing renders wrong while it expires. Bust it anyway: `typeHygiene` carried up to 500 issue keys
> *per field per type*, and there is no reason to keep paying for that in every cached chunk.
>
> No exporter change and **no export re-run**.
>
> **Live smoke — what must be GONE:**
> 1. 🎯 Actions → no "Field fill by issue type" table. The **Gaps queue** below where it sat is
>    unchanged, legend and all.
> 2. Gaps queue → no *"…and that assignee resolves to a roster person"* row. The row above it,
>    *"Resolved work carries a Jira assignee"*, **must still be there** — that is the Jira-discipline
>    half of the 2026-08-03 split and it was not removed.
> 3. Data-trust strip → **three** tiles (Estimate coverage · Due-date fill · Logged fill). No
>    "Roster join", and no blank fourth slot where it was.
>
> **What must still WORK:**
> 4. 👥 Signals roster → the **Open backlog / Resolved** chips now sit on the roster itself. Click
>    both. If they are missing, `STATE.typePop` has no control anywhere in the client and the roster
>    is stuck on Open — that is the one way this deploy can fail silently.
> 5. The four KPI cards, the 🚩 epic audit, 🌊 Backlog health and the 🗓 PM tab must not move at all.
>    Every one of them reads the shared predicates (`typeHygOpen_` and friends) that were kept
>    precisely so this deletion could not reach them.
> 6. Post the GTT-605 dated status comment.
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

   **2026-08-10 — Workforce Health, schema v29 → v31. Same requirement, sharper failure mode.**
   Both files (`Code.js` + `Dashboard.html`), then `bustDeliveryCache_()`. No exporter change and
   no export re-run. A cached v29/v30 model read as v31 gives every person `pool: undefined`, which
   collapses the whole population into a single cell and **silently reproduces the exact blended
   availability figure this release exists to retire** — a wrong number wearing a right number's
   clothes, not a blank panel. `getDeliveryData` treats a differing `schemaVer` as a clean miss,
   which is what makes the bust sufficient; running it is what makes it take effect immediately for
   everyone rather than at TTL expiry.

   **Expect per-pool capacity figures to drop.** Two definition changes ship together — support is
   no longer blended with consulting, and delivery managers have left the pool denominators. That
   is the intended outcome, recorded at registry `4.0`, and the pool grid carries a footnote
   explaining it on screen. The four KPI cards, the signals roster and the queue hero must **not**
   move: Workforce Health is an additional read of the same hours, not a redefinition of the
   existing metrics.
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

> ### 🗓 PM tab — at-risk vs breached, and the filters reach it (2026-08-11) — schema v40 → v41
>
> `Code.js` + `Dashboard.html`, then **`bustDeliveryCache_()`**. A v40 entry has no
> `atRisk`/`breached` and no `epics[].owners`, so the verdict cell renders blank and the filters
> cannot scope the tab.
>
> 1. **"Against epic date" no longer paints one red.** A child scheduled past its epic used to read
>    `over by 3w` whether the epic's date was in October or last July. Now split on whether the
>    **epic's own week has passed**:
>    - **⚠ at risk** — epic's date still ahead. Nothing has failed; the plan simply cannot land as
>      written, and both levers (move the child, move the epic) are still available. **This is the
>      actionable one.**
>    - **✖ breached** — the epic's date has gone and work is still scheduled beyond it. Recovery.
>    The epic's week is the anchor because it is the commitment being protected; the child's own
>    lateness is already banded in the Due column beside it. Reuses `dhOverdue_`, so *late* keeps
>    meaning one thing.
>    *Invariant:* the split is decided by the epic's week, so all its children fall on the same
>    side — an epic is never both.
> 2. **The epic row states its own verdict** — `⚠ cannot land as planned` / `✖ past its date, work
>    still beyond` — because that sentence, not the ticket tally, is what a PM acts on.
> 3. **Opportunity counts are per EPIC**, split into `oppEpicsAtRisk` / `oppEpicsBreached` and never
>    summed: one badly-planned epic is one decision, not nine problems.
> 4. **The universal filters now scope this tab.** Filters speak *person*; this tab's unit is an
>    *epic* whose owner isn't on the roster — so an epic is scoped by the people **doing** it
>    (`epics[].owners`, the roster names its children are assigned to). What the filter hides is
>    **counted and stated**, with the unattributable epics named apart: they have no roster-assigned
>    child at all, no filter can ever select them, and they are exactly the unowned work the tab
>    exists to surface. `resetFilters_` was extracted from the ⟲ button so the inline "Clear
>    filters" link runs the same reset rather than a second drifting copy.

> ### 🗓 PM tab — three fixes from the first screenshot (2026-08-11)
>
> `Code.js` + `Dashboard.html`. **No schema bump** — but if v40 was already deployed, run
> `bustDeliveryCache_()`: fix 1 changes the attribution of every unassigned epic, so a cached model
> keeps showing the wrong owner until its TTL expires.
>
> 1. **`"⚠️ UNASSIGNED"` was being treated as a person.** `Jira Backlog.js` writes that literal
>    string where an issue has no assignee, so the column is never blank. On the live feed that put
>    **267 epics under a fabricated PM named UNASSIGNED** instead of falling back to the project
>    lead — a made-up owner at the top of a page about ownership. `dhAssigneeOf_` now applies the
>    same `/unassigned/i` guard the rest of the file already used.
> 2. **The undated-epic key list drew every key.** 134 epics meant 134 inline links running across
>    the page and burying every other signal on the row. `keyListHtml_` gained a `showMax`; the PM
>    row draws `PM_KEYS_SHOWN_` (8) plus "+ N more", and **"Open all in Jira" still covers all of
>    them** — bounded drawing, not lost data. The 🚩 audit panel is unchanged; it wants the full list.
> 3. **Columns overlapped.** The table inherited `.tmx`, which is `table-layout:fixed` +
>    `white-space:nowrap` and sizes columns from the first row — and this table's first row is a
>    full-width PM group header, so there was nothing to size from and every nowrap cell painted on
>    top of its neighbour. The table now declares an explicit `<colgroup>` from `PM_COLS_[].w` and
>    wraps its text columns; only the Due week stays nowrap.

> ### 🗓 PM tab — moved beside Actions, rebuilt as a table (2026-08-11) — `Dashboard.html` only
>
> **No schema change and no cache action** — presentation only, on top of the v40 payload.
>
> 1. **Tab order is now Executive · Actions · 🗓 PM · Workforce · Access.** PM sits beside Actions
>    because they answer the same question at different grains: Actions is *who* needs action, PM is
>    *which committed work* needs action.
> 2. **One table with six defined columns** — Epic / ticket · Status · Due · Against epic date ·
>    Gaps · Assignee — driven by a single `PM_COLS_` registry so the header can never drift from the
>    cells beneath it. Three row levels in **one** table rather than nested tables: PM group rows
>    span the full width, epic rows fill the columns, child rows sit one indent in. Every column line
>    runs unbroken down the page, which is what makes a table scannable and what a nested table
>    destroys.
> 3. `Against epic date` reads at two grains on the same axis: for an epic, the tally of its
>    children (`1 over · 1 undated · 1 within`); for a child, its own verdict (`over by 3w`).
>
> Live smoke: the header shows six columns; a PM group row carries both bars and the ranked gaps;
> expanding an epic inserts `↳` child rows that stay inside the same columns.

> ### 🗓 PM tab — assignee-first + opportunity line (2026-08-11) — schema v39 → v40
>
> Supersedes both earlier PM-tab deploys. `Code.js` + `Dashboard.html`, then
> **`bustDeliveryCache_()`**. A v39 entry attributes every epic by the Tempo project lead and
> carries no opportunity counts, so the tab would be **wrong rather than merely empty** — which is
> the case a schema bump exists for.
>
> 1. **An epic belongs to its Jira assignee**, falling back to the Tempo project lead only when the
>    epic has no assignee. Direct evidence beats inference, and each PM row states how many of its
>    epics came from each rule, so a PM can challenge an attribution rather than having to trust it.
>    Children follow the epic above them whoever they are assigned to — an engineer's sub-task still
>    belongs to the PM accountable for the epic.
> 2. **Names are normalised across sources.** Jira writes `"Lopez, Moises"`, Tempo writes
>    `"Moises Lopez"`. Without `dhPmKey_` the same person appears twice, their epics split between
>    the two rows, and both halves read as half-done — a failure that looks like data, not a bug.
> 3. **Areas of opportunity, visible without expanding:** epics with no due date · children
>    committed past their epic's date · epics nothing rolls up to · epics untouched for 30+ days.
>    Ranked biggest-first, **never summed into a score** — they are four different conversations,
>    and one blended number would point at none of them. A PM with no gaps says so explicitly.
> 4. **Every key is a Jira link**, on both the epic line and its children, plus "Open these N in
>    Jira" per epic.
>
> Live smoke: a PM row shows its gaps while collapsed; expanding names the attribution split; an
> epic line carries 👤 its assignee, and 🔗 / 🕒 where those gaps apply.

> ### 🗓 PM tab — epic-first rework (2026-08-11) — schema v38 → v39
>
> Follows the first cut straight away on user feedback; if you have not deployed v38 yet, deploy
> this instead — it supersedes it. `Code.js` + `Dashboard.html`, then **`bustDeliveryCache_()`**
> (a v38 entry carries `pmOwned.items`, not `epics`, so the tab would list no epics at all).
>
> What changed and why:
> 1. **The tab was full of To Do tickets with no due date.** They are not commitments yet by the
>    managers' 2026-08-10 rule, and the first cut showed them because I made undated items *always*
>    visible. Now counted and stated, never listed.
> 2. **Three-level collapse** — PM ▸ epic ▸ children — matching the Actions tab's drill-down, so the
>    page opens short. The collapsed lines carry the numbers worth scanning (epics dated, 🚩 count,
>    children past the epic date) so you know whether expanding is worth it.
> 3. **Epic-first scope:** in progress **or** due this month, including anything already overdue.
> 4. **Children graded against their epic's deadline**, resolved through the parent chain.
>
> Live smoke: expand a PM, then an epic — children show `within` / `over by Nw` / `no date of its
> own`. An epic with no due date shows 🚩 on its own row and its children read `ungraded`.

> ### 🗓 PM tab + due-date bands (2026-08-11) — schema v37 → v38
>
> **Two independent units. F1 ships alone; F2 does not** — `renderPm_` calls `dueBand_` and
> `currentIso_`, both added by F1, so deploy F1 first or the tab throws on first render.
>
> **F1 — due-date urgency bands.** `Dashboard.html` only. **No schema bump, no cache action.**
> The People drill-down's Due cell gains a band: 🔴 red before this week, 🟠 amber this week,
> 🟢 green later. Week precision, because the managers' 2026-08-10 rule is that the current week
> is compliant. Undated stays **red** there — that table is fed by `openIssues`, which already
> drops unstarted-undated, so an undated row is started work with no committed date.
>
> **F2 — 🗓 PM tab.** `Code.js` + `Dashboard.html`, then **`bustDeliveryCache_()` — REQUIRED.**
> A cached v37 model has no `pmOwned` and the tab renders its "Not in this payload" empty state
> until the entry expires.
>
> No exporter change and **no export re-run**: every column read here is already exported and
> already parsed (`readTempoGrid_` has carried the project key beside the PM since the reader was
> written).
>
> Live smoke:
> 1. 🗓 PM tab appears for admin **and** viewer, and is the 4th of 5 tabs (🔒 Access stays last).
> 2. Each PM row shows **two** bars and **no** blended percentage. If you see one number per PM,
>    something averaged the PM's own field with their team's hygiene — that is a defect.
> 3. Check the size of the **(No PM)** bucket. If it dominates, that is a finding about Tempo
>    project coverage to take upstream — **not** a reason to change the attribution.
> 4. The filter above the tabs now reads **"Worked with PM: all"**. Confirm it still filters
>    PEOPLE (the tiles and roster move) — only its label changed.
> 5. Open a People row: due dates are banded, and a week like `2026.W9` reads **red**, not green.
> 6. Post the GTT-605 dated status comment.

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
- [ ] Expanding a roster row **accounts for every issue in `n`**: "N open items behind the n column:
      X listed · Y unstarted with no due date (ignored by rule) · Z epics (roll up)". The three add
      up to `n` exactly. Nothing is printed when the list already shows everything.
- [ ] No **To Do ticket with no due date** appears in any person's drill-down list. If a person has
      some, the row says how many are not listed ("ignored by rule, not a gap") and the hours line
      still counts them. A person whose entire backlog is those tickets says exactly that, never
      "no open backlog items attributed".
- [ ] The drill-down opens on **8 items** (`meta.backlogItemsShown`) and, when the person has more,
      offers **▾ Show all N** — an in-place re-render, no round-trip, because the payload carries up
      to `BACKLOG_MAX_ITEMS_ALL` (60). ▴ Show top 8 goes back, and **collapsing the person resets it**
      so reopening is always the short read. Beyond 60 the line says the payload carries the 60
      largest while the counts and hours cover all of them.
- [ ] Open roster: the **Due date** and **Logged** cells divide by less than the `n` column beside
      them, and the paragraph above the table says why. **Logged** = started work only; **Due date**
      = started *or already dated*. A person whose entire backlog is undated To Do shows
      **grey/ungraded** on both, never 0% — while a dated To Do ticket counts as a hit.
- [ ] 🚩 **Epics without a due date** (Actions, below backlog health): red count + share, one row
      per epic type, the offending **keys** listed (never names), `ORG` tag, ⬇ CSV. With nothing
      missing it shows a green **all-clear**, not an empty panel; on a pre-v33 payload it says
      "not in this payload" rather than reporting a clean 100%.
- [ ] 🧭 Pool grid: clicking a band row expands **who** holds the hours (capacity / planned /
      available per person, most-available first) with a **sellable subtotal** that excludes 🌱 and
      🏖 people. An unscheduled person reads "—", not 0h. Clicking again collapses it and the names
      leave the grid.
- [ ] Roster **Hours** column: a billable/non-billable/idle mini-bar per person; ramping/on-leave
      people sort last regardless of sort direction and carry **no idle segment** in their bar.
- [ ] The signals roster and the 🧬 matrix **share the Open/Resolved population toggle** — switching
      it on one changes the other, and both carry the matching `SNAP`/`PERIOD` scope tag.
- [ ] Executive **people-signals pulse** (admin/viewer only): one line, counts only —
      `● N on track · ● N watch · ● N need action`, plus an ungraded count when small-n applies. No
      individual is ever named on it. Clicking it opens Actions with the roster pre-sorted by
      opportunity.
- [ ] **Data-trust strip**: **three** tiles (Estimate / Due-date / Logged coverage) — no fourth
      "Roster join" tile, removed 2026-08-17 — each tagged `ORG`, each graded against its own gate. Changing any filter or the period picker
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
      (removed 2026-08-05) — only the signals roster, the gaps queue and the
      ⚙ Coverage gates editor. No 🧬 by-type matrix: removed 2026-08-17.
- [ ] The Actions gaps queue **names the window it covers** and follows the header period
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
