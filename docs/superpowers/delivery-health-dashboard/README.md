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
   Companion: the same numerator over net-of-absence capacity, with the gap between them labelled as
   the cost of approved absence.
3. **Forecast Accuracy** — **mean of `1 − |actual − estimate| / estimate`** across epics closed in
   the period, floored at zero per epic. Companions: share inside the ±10% band, and the median
   absolute variance.
4. **Quality / Rework Rate** — **(reopened OR Rework-linked) ÷ delivered in period**. Live since
   2026-08-03; **lower is better**, so its target is a ceiling (≤5%) and its RAG is inverted. CSAT
   remains a declared-absent companion (PR-09).

**Every tile carries its confidence.** Each metric has a registry coverage gate, and each tile shows
its confidence level (◆ high / ◈ medium / ◇ low) with the attribution % it was measured on. A metric
below its gate is still published — flagged `below gate — directional only` with a link into the
Data Hygiene view — because the reader judging a weak number beats the tool refusing to show it.
That is an accepted deviation from FR-2.2, owned by the Services Director and reversible with one
flag (`CONFIG_DH.SUPPRESS_BELOW_GATE`). See [Data confidence](#data-confidence-and-suppression).

Spec: [`docs/superpowers/specs/2026-07-31-delivery-health-dashboard-design.md`](../specs/2026-07-31-delivery-health-dashboard-design.md).

## Dictionary conformance (2026-08-03)

Before this pass the dashboard and the Metrics Dictionary described **different metrics under the
same four names**. That is worse than either definition being wrong: two people reading one tile
computed two numbers. Registry **v2.0** aligns all four. Every value moves on deploy — the step you
will see in W32 is the definition moving, not delivery moving, and the in-product
`✎ definition changed` marker says so on each trend line.

| Metric | Was | Now (Dictionary) | Effect |
|---|---|---|---|
| **On-Time** | Stories/Tasks, epics *excluded* | Epic **or** Milestone **or** `Client Commitment` label | Rate **and** coverage move sharply — epics have a much lower due-date fill rate, so expect the confidence chip to drop |
| **Utilization** | ÷ net available (PTO/holidays removed) | ÷ **scheduled capacity** (headcount × standard hours) | Headline falls by the absence share; the net rate stays on the card as a companion |
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
region-tagged tracked hours (roster location as fallback, marked ◦ in the UI) and Tempo team names.
The numbers are real; *"by Region and Team"* does not yet mean what the Dictionary says it means.
🧪 Data Hygiene tracks and trends the gap with Gon named against it.

## Navigation — one view per question (2026-08-03)

Everything used to stack into a single scroll, so an executive looking for *are we on target* waded
through a 200-row roster and a manager looking for *who needs me this week* waded through executive
KPIs. There are now five tabs, generated from the **`VIEWS` array in `Dashboard.html`** — label, pane
id and role gate are declared once, and `buildTabs_()` / `switchView_()` / `renderAll_()`'s dispatch
all derive from it. The role gate is enforced inside `switchView_()`, not just by hiding a tab.

| Tab | Answers | Contents |
|---|---|---|
| 📊 **Executive** | "Are we on target, and where aren't we?" | The four KPI cards + one **comparison chart**: the active metric broken down by Region / Team / PM / Job family on a common 0–100 axis, with the target rule and the operating band drawn in. The bars are **read-only** — scope changes belong to the header filters. |
| 📈 **Trends** | "Who moves it?" | The **opportunity table** and nothing else: one row per person, ranked by the hours between them and the cohort's operating rate, with its own metric selector. The history line chart was removed — the tiles already carry a sparkline and a vs-target read. |
| 👥 **People** | "Who needs me this period?" | The triage-ordered people × period grid, expandable into stacked workload bars with per-person drill-downs. |
| 🧪 **Data Hygiene** | "What's missing, and who owns it?" | The attribution work queue. Deliberately **unfiltered** — a well-tagged region does not make the feed publishable. |
| 🔒 **Access** | — | Admin only. |

The filter row sits **above** the tabs and scopes every view — there are no per-chart filters.

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
references are shown — on every KPI card, on the trend chart as a shaded band, and as the benchmark
the opportunity table ranks against.

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

## Opportunity table (Trends tab)

"Areas of opportunity" made arithmetic. Per person, for the last complete period:

```
opportunity_hours = max(0, operating_rate% × their available hours − their billable hours)
```

Hours, not percentage points, because a point is not something anyone can reassign. Floored at zero —
someone above the norm is carrying it, not owed negative work. Excluded by construction, because a
gap there is not an opportunity: people on long leave, periods before someone's hire date, anyone
fully out on PTO. Ramping new hires are **shown and flagged 🌱 but left out of the headline total** —
ramping is the explanation, and the total is a call to act. The norm re-bases on whatever the filters
select, so an AMER consultant is compared with how AMER consultants normally run.

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

## Legends are controls

If a label states a count, clicking it shows you that count:

- the attention strip (`⚠ 4 overloaded · ▽ 6 under-planned · ○ 2 zero-tracked`) filters the whole
  dashboard — cards, charts and grid — to those people, and always offers `clear ✕`. Counts are
  computed over the population passing every filter *except* the flag, so the other totals stay
  visible and the filter can be swapped rather than only cleared;
- the workload-bar legend's `billable` / `non-billable` / `▼ planned` entries set the Focus lens.

Comparison-chart bars are the deliberate exception (user 2026-08-03): they report, they don't filter.
Two ways to change scope — a header control and a chart click — meant the same question had two
answers depending on which one you last touched.

Entries that act carry a dotted underline; entries with no lens of their own stay inert and explain
themselves in their tooltip instead.

## Files

| File | Role |
|---|---|
| `Code.js` | GAS server — `doGet()` (access-gated) serves the HTML; `getDeliveryData(forceRefresh)` reads Capacity/Tracked/Planned/NS Billable/PH/Jira Raw + Roster by spreadsheet ID, builds the person × week + Jira-bucket model, returns JSON. `buildDeliveryModel_()` is the full compute, shared by the cache-first endpoint and the `warmDeliveryCache()` 30-min trigger (`setupDeliveryCacheWarmer()` installs it). `probeDeliverySources()` and `auditJiraFillRates()` are one-time post-deploy diagnostics. `METRIC_REGISTRY_` is the canonical definition store every tile renders from. 24 `_test_*` unit tests. |
| `Security.js` | Email allowlist (admin / viewer / open-access) — `SEC_DH`, `checkDeliveryAccess()`, `getDeliveryAccessSettings()`, `saveDeliveryAccessSettings()`, `buildAccessDeniedPage_()`. Inherited from the demand dashboard's `Security.js` (itself inherited from `PS Security.js`). |
| `Dashboard.html` | Client — loads cache-first via `google.script.run.getDeliveryData(false)`; ↻ Refresh forces a live read. Five tabs from the `VIEWS` array (Executive / Trends / People / Data Hygiene / Access). Holds the inline-SVG chart kit (`hbarChart_`, `sparkHtml_`), the cascading-filter engine (`passesFilters_(p, skipDim)`, `optionsFor_`), the operating-rate model (`standardRate_`, `stdFor_`), the metric accessor table (`METRICS_`) and the opportunity table. Per-panel ⬇ Save PNG + two CSV exports. |
| `node-tests.js` | Local Node runner for the pure `_test_` functions in `Code.js` (stubs `Logger`/`Utilities`/cache) — `node node-tests.js`. Also holds the two cross-layer parity suites (`_test_clientParity_`, `_test_confidenceParity_`) that diff the client's copies of `utilFor_` / `metricConfidence_` against the server's. Not pasted into the GAS project. |
| `render-smoke.js` | Renders `Dashboard.html`'s client code against synthetic models and asserts on the HTML — `node render-smoke.js` (168 checks). Covers the rules that live in string concatenation and no unit test can reach: the gate policy both ways, stale models print no delta, an empty period isn't shown as a coverage failure, no individual appears in the hygiene view — plus cascading option lists, the operating-rate maths, chart labelling and gap handling, tab routing and its role gate, and the opportunity table's exclusions. Not pasted into the GAS project. |

## Data sources

Seven tabs across two spreadsheets. All IDs live in the `CONFIG_DH` block in `Code.js` and can be
overridden via Script Properties without touching code.

| Source | Spreadsheet | Tab | Used for |
|---|---|---|---|
| Capacity | Tempo hours SS (`SOURCE_SS_ID`) | `Capacity Tempo` | Per-person scheduled hours per ISO week; fallback 38h (ANZ) / 40h (else) when a person/week cell is missing |
| Tracked | same | `Tempo Tracked Time` | Tracked hours per person-week (NETSUITE keys excluded); `Team` cell; `Key` for the Jira Region join |
| Planned | same | `Planned Time Tempo` | Planned hours per person-week (NETSUITE excluded); NETSUITE rows = PTO **fallback** only |
| PTO | PTO accumulation workbook (`DH_PTO_SS_ID` override; same source as the PS Dashboard's PTO metric) | `Accumulation Cost` | **Primary PTO source**: dated Usage/Time Off transactions per Employee Number → weekly hours (`CONFIG_DH.PTO_UNIT` — verify hours-vs-days via `probeDeliverySources()`); unreadable → NETSUITE-row fallback, labeled in `meta.ptoSource` |
| Billable | same | `NS Billable` | Daily rows (`Employee`, `Total Billable Hours`, `Non-Billable Hours`, `Date`, …) bucketed to ISO weeks. Supplies the billable **mix** only — hour counts come from Tempo |
| Holidays | same | `PH` | `Date \| Location \| Holiday` → per-person holiday hours by fuzzy location match |
| Jira | same | `Jira Raw` | `Region` and `Team` per issue (restored by `Jira Backlog.js` v3.4.0, still exporting blank until PR-01 — read by header name, not index, and normalised through `mapRegionToDh_`), dedup'd on `Key` (the tab holds one row per issue *per week bucket* and `Jira Backlog.js` rewrites it whole on every export, so duplicates differ only in the week label — any row is equivalent); On-Time Delivery (`Due Date`, `Resolution Date`, non-epics only) and Forecast Accuracy (`Original Estimate (sec)`, `Time Spent (sec)`, epic type) |
| Roster | Roster SS (`ROSTER_SS_ID`) | `Data` + `Contractors Data` | Population gate — active, Class = Professional Services (Class check skipped for crew) / Department = Services; `Key Location` drives the ANZ capacity fallback and the person-region fallback |

Both spreadsheet IDs are overridable via Script Properties:

```
DH_SOURCE_SS_ID   → overrides CONFIG_DH.SOURCE_SS_ID (Tempo hours + NS Billable + PH + Jira Raw)
DH_ROSTER_SS_ID   → overrides CONFIG_DH.ROSTER_SS_ID (Data + Contractors Data)
```

## Metric formulas

```
capacity   = Capacity Tempo hours; fallback 38h (ANZ) / 40h (else) if the cell is missing
pto        = Accumulation Cost usage hours that week (Employee Number join;
             NETSUITE rows from Planned Time Tempo as fallback)
holiday    = per-person PH hours (8h/day, 7.6h ANZ) minus already-booked NETSUITE hours
             that week, floored at 0 (a booked holiday is never double-counted)
available  = max(0, capacity − pto − holiday)
planned    = planned hours (non-NETSUITE)
tracked    = tracked hours (non-NETSUITE)
nsBillRaw  = NS Billable "Total Billable Hours" summed over the ISO week   (raw, diagnostic only)
nsNonBillRaw = NS Billable "Non-Billable Hours" summed over the ISO week   (raw, diagnostic only)
billShare  = nsBillRaw / (nsBillRaw + nsNonBillRaw)      — null when NS has no rows that week
nsCov      = NS classified this person-week (billShare exists)
billable   = tracked × billShare        — NS classifies, Tempo quantifies
nonBillable= tracked × (1 − billShare)
unclassified = tracked − trackedCov     — tracked hours in NS-uncovered weeks
availCov   = available, but only for NS-classified person-weeks

billableUtil = billable / availCov      (Utilization tile headline)
trackedUtil  = tracked / available      (Utilization tile companion)
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
| **Medium** ◈ | coverage within 10 pts of the gate, or <2 periods | published with a "coverage approaching threshold" read |
| **Low** ◇ | coverage more than 10 pts below the gate | published, flagged `below gate — directional only` with a hygiene link (or **suppressed** when `SUPPRESS_BELOW_GATE` is on) |
| *(none)* | nothing in scope | `—` with the reason ("no epics closed in this period") |

The last row matters as much as the third: a quiet week with no closed epics is **not** a data-quality
failure, and rendering it as one teaches people to ignore the gate.

**Suppression is OFF (user decision 2026-08-03, `CONFIG_DH.SUPPRESS_BELOW_GATE = false`).** This is
an accepted deviation from FR-2.2, which calls publishing a low-confidence number a defect. Gating
darkened two of four tiles — On-Time at ~64% attributed against an 80% gate, Forecast at ~23%
against 70% — and took their historical series with them, and a dashboard nobody can read teaches
nobody anything. What replaced it: the confidence chip on every card, a `below gate — directional
only` line on weak ones, and the hygiene route one click away. The reader judges the number instead
of the tool refusing to show it. The entire suppression path is intact behind the flag — set it to
`true` and FR-2.2 behaviour returns with no other change; render-smoke covers both settings.

Two consequences worth knowing before a demo:

- **Forecast Accuracy is built on ~15 measurable epics.** It publishes, with a ◇ low chip. Treat it
  as directional until estimate and worklog fill rates rise.
- **On-Time sits ~16 points under its gate** at roughly 64% due-date fill. Closing ~90 due dates a
  month would clear it honestly.
- **With no NetSuite billable feed the utilization tile relabels itself** to *Capacity Utilization
  (tracked)*. `tracked ÷ capacity` is a different metric from billable utilization and is never
  published under a billable heading.

Coverage is recomputed **under the active filters** — a well-tagged region can be publishable while
the whole population isn't — which is why the gate runs client-side as well as server-side.

## Coverage gates are admin-editable

Admins get a **⚙ Coverage gates** panel inside 🧪 Hygiene. "How much attribution is enough" is a
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

## Data Hygiene view (🧪 Hygiene)

The attribution counts that used to sit on the cards as grey caveat text now have their own view:
one **"% of delivery work fully attributed"** tile with a 6-period trend, plus a table of every gap
with its coverage, gate, **named owner**, prerequisite ID and committed ISO week.

Deliberately **unfiltered** — hygiene is a whole-population question, and a well-tagged region slice
doesn't make the feed publishable. Every below-gate tile links straight into it.

**No owner column** (user decision 2026-08-03). The prerequisite ID points at who owns each gap in
the requirements doc, where accountability is tracked and reviewed. A standing table of names
against failures in a widely-read view reads as a blame board rather than a work queue, and that is
not what gets Jira tagging fixed. The registry still records `owner` and `paramOwner` per metric —
it just isn't rendered onto a card.

**Which window it covers.** The **last complete period** of whatever unit the header's
Week / Month / Quarter chips are set to — never an in-flight period, which would read as a hygiene
collapse when it's really a period that hasn't finished. The view states its window in the header
strip and again in the footnote, and **◀ ▶ walk the history** one period at a time. **Σ All history**
sums every complete period in the export window (52 weeks) for the whole-picture number. Switching
the header unit resets the position to the latest period, because "3 back" means a different window
in weeks than in quarters.

**Two composites, on purpose.** The headline (`resFull`) is the strict definition — due date **and**
roster assignee **and** region. With the Jira Region field unpopulated org-wide, that figure is
pinned at 0% and stays there however much the other two improve, so the card also names the binding
constraint ("Held down by region at 0%") and shows `resReady` — due date **and** roster assignee,
region excluded — as *"Excluding region: N% are measurable today"*. The strict number keeps the
target honest; the second one is the one that moves while PR-01 is open.

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
  AMER / EMEA / APAC / ANZ / **Other** / **Unassigned**. `Other` is a value we haven't mapped —
  extend `JIRA_REGION_TO_DH_`. `Unassigned` is a tagging gap owned by Gon (PR-01), counted and
  trended in the Data Hygiene view rather than folded into a real region's total. Today the field is
  unpopulated, so *everything* is Unassigned and person region still resolves from the roster.
- **Utilization divides by AVAILABLE hours, not gross capacity.** PTO and public holidays come out of
  the denominator, so approved absence never dilutes the rate — but a high % can sit on a much
  smaller base. The card states the base (`Xh available of Yh capacity — Zh PTO/holiday removed`).
- **Backlog "est. remaining" is Jira-sourced.** `Original Estimate − Time Spent`, both from
  `Jira Raw`. Tempo is the authoritative time source, so an issue whose hours went into Tempo but
  never mirrored into Jira reads as more remaining work than there is. Planning signal, not a
  committed number.
- **NetSuite classifies, Tempo quantifies — the split is a ratio, not a pair of hour counts.**
  Tempo tracks every hour worked but cannot say which are billable; NetSuite knows the
  billable/non-billable mix. So the NS mix is applied as a **proportion of the Tempo tracked total**:
  `billable = tracked × billShare`. Two consequences worth knowing:
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
  that is pure coverage. These hours get their own hatched bar segment and their own legend entry.
- **Check `meta.nsCoverage` before quoting the utilization number.** It reports classified
  person-weeks, `classifiedPct` of tracked hours, the `gapHours` reconciliation total between the two
  feeds, and any NS employee names no roster alias resolved (`unmatchedRows` / `unmatchedNames`) —
  an unresolved name classifies nothing, which used to look exactly like a person who billed nothing.
  The Utilization card shows a `⚠ classification covers N% of tracked hours` line below 99%.

`NS Billable` unreadable → the Utilization tile falls back to `tracked/capacity` with a "billable
data unavailable" chip; the grid still renders. `Jira Raw` unreadable → On-Time Delivery and
Forecast Accuracy show "Jira data unavailable"; Utilization and the grid are unaffected. Roster
unreadable is the one **fatal** error (population and Region can't be derived without it).

### 🔬 Data Profile + WHAT-IF (admin-only)

Above the gaps table, admins get per-metric **evaluability funnels** (resolved → assignee →
roster join → due date; epics → estimate → logged time; utilization's two coverage bars —
Quality states it cannot be profiled until export v3.6.0). One button — **🧪 WHAT-IF: valid
records only** — flips the whole dashboard to the measurable populations: coverage reads 100%,
gate flags clear, exclusions are restated on each card, and a metric left with under 5 valid
records says *"publishable, not meaningful"* instead of wearing a confidence chip. The mode is
session-only, admin-only (force-reset in `renderAll_` for anyone else), and unmistakable: a
banner on every tab, a dashed watermark frame, and a `WHATIF-` stamp on PNG filenames.

Underneath, a **deterministic CEO brief** (top 3 Facts / 3 Highlights / 3 Notes / top
Concerns) is derived by fixed rules from the same profile — concerns ranked by
records-dropped × cards-blocked, each ending in change / owner / target week, with the
WHAT-IF consequence leading concern #1 so "filter the garbage" never reads as the fix.
Owners are named here (admin-only) even though the public gaps table stays owner-free.
Spec: `docs/superpowers/specs/2026-08-03-hygiene-whatif-profiling-design.md`.

## Region lens

The standard region for every tile is the **issue-level Jira `Region` field** (`Jira Raw` col 32,
decided 2026-07-31, superseding an earlier Roster-Key-Location-only design):

- **Jira tiles** (On-Time Delivery, Forecast Accuracy) group directly by each issue's `Region`.
- **Person-level Region** (Utilization tile + grid) = the region receiving the **majority of that
  person's tracked hours** in the trend window — tracked rows carry an issue `Key`, joined to
  `Jira Raw`'s `Region` for that `Key`. Ties break alphabetically (deterministic).
- **Roster fallback:** a person with no region-tagged tracked hours falls back to their Roster
  `Key Location` bucket (`CONFIG_DH.LOCATION_REGION_MAP`, unmapped locations → `Other`). Their row
  in the grid carries a **◦ marker** next to the name (tooltip: "region from roster location (no
  region-tagged work)") so a roster-derived region is never silently presented as Jira-sourced.

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
| 9 | `hygieneBuckets` gain `resReady` (due date + roster assignee, region excluded). Without it the Data Hygiene headline is pinned at 0% for as long as the Jira Region field is unpopulated, so no amount of due-date or assignee progress would ever show |
| 8 | Forecast Accuracy re-formulated to the ±10% band: buckets lose `sumAcc` / `nOver` / `nUnder` / `lossOver` / `lossUnder` and gain `nWithin` / `absVars` / `nMissOver` / `nMissUnder`. Adds `hygieneBuckets` + `meta.registry` / `meta.sources` / `meta.forecastBand` / `meta.refreshEveryMin`, and normalises Jira Region at ingestion. **Must** force a rebuild — a cached v7 model has no `nWithin` anywhere, so the forecast tile would render 0% |

**Warmer:** `warmDeliveryCache()` runs on a time trigger (install once with
`setupDeliveryCacheWarmer()` in the GAS editor as the owner; interval =
`CONFIG_DH.CACHE_WARM_EVERY_MIN`, 30 min), so loads are warm most of the time. Data can lag sheet
edits by up to the warm interval — the ↻ Refresh button (`loadData(true)`) always bypasses cache
for a live read. Error models are never cached.

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
   `JIRA_REGION_TO_DH_` (§4.3) and take the list to Gon (open decision #1). While the field is
   unpopulated the probe says so explicitly instead of printing a hollow "✅ all match".
5. Run `auditJiraFillRates()` — record Due Date / Original Estimate / Region / Team fill rates
   (spec §10.5). Low fill ⇒ adjust tile so-what wording, not the design.
6. Run `getDeliveryData` once → grant scopes (account must open BOTH spreadsheets).
7. Deploy → New deployment → Web app → Execute as Me → "Anyone within ServiceRocket with the link".
8. Run `setupDeliveryCacheWarmer()` once as the owner.
9. After any model-shape change: run `bustDeliveryCache_()` then ↻ Refresh.
   **This deploy is a schema v7 → v9 change — `bustDeliveryCache_()` is REQUIRED**, not optional.
   A v7 entry carries no `nWithin`, so the Forecast tile would read 0% instead of suppressing.
10. On first load every tile shows a number plus a confidence chip; the weak ones carry
    `below gate — directional only`. Open 🧪 Hygiene, confirm each gap's prerequisite and target
    week, and take that view to the next steering review.

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

## Manual QA (after deploy)

### Dictionary conformance (2026-08-03)
- [ ] Utilization headline says **"of scheduled capacity"** and carries a **"N% of net available"**
      companion. In a period with PTO the two differ and the card names the gap as `N pts absence`.
- [ ] Forecast headline says **"mean accuracy over N measurable epics"**, with `N of M inside ±10%`
      and `median variance N%` beneath it. The headline is NOT the band percentage.
- [ ] On-Time coverage is **visibly lower than before** and the card names its scope — that is the
      epic due-date fill rate, not a regression. If it now sits below its gate it shows the
      `below gate — directional only` line rather than going dark.
- [ ] **Quality / Rework shows a number**, not "data pending". Its target reads `≤5%` (a ceiling) and
      a *low* rate is GREEN. If a low rate paints red, `invertTarget` is not reaching the client.
- [ ] The rework card states both signals: `N rework-linked · N reopened (of M checked)`, or
      `reopens NOT measured` plus the "this rate is a floor" warning when the changelog is off.
- [ ] Every trend line carries `✎ definition changed 2026-08-03` — that marker is the point.
- [ ] 🧪 Data Hygiene still reports Region tagging against a 100% gate (the unmet prerequisite).

### Executive rebuild (2026-08-03)
- [ ] Five tabs render: 📊 Executive · 📈 Trends · 👥 People · 🧪 Data Hygiene · 🔒 Access.
      A **viewer** account sees four — no Access tab.
- [ ] Pick Region `AMER`: the Team, PM and Job-family dropdowns shrink to AMER's values, each with a
      headcount. Clear it — the full lists come back.
- [ ] Pick a Team from one region, then a *different* region: the team stays listed and selectable
      (marked `(0)`), and the filter row says `⚠ No one matches — clear region to see N people`.
      Clicking that link restores the view.
- [ ] Executive: every comparison bar carries a value **and** a ✔/▲/✖ glyph; the target rule is
      labelled. Bars are read-only — clicking one does nothing; scope changes via the header filters.
- [ ] Trends shows **only** "Where the headroom is" — no history chart, no values table — and its
      metric chips switch the metric for the Executive comparison too.
- [ ] Opportunity table: headline is **hours**; ramping 🌱 new hires appear but the footnote says they
      are excluded from the total; nobody on long leave appears at all.
- [ ] People: click `⚠ N overloaded` in the attention strip → everything narrows to those people and
      a `clear ✕` appears. The other counts are still shown.
- [ ] Expand a period column, then click `billable` in the bar legend → the Focus lens switches.
- [ ] Toggle 🌙 Dark: workload bars stay readable (billable is the light blue segment, not a
      near-black one) and green/amber/red bars remain distinguishable.
- [ ] Tiles show numbers for the last completed week; Rework tile is muted "data pending".
- [ ] Region chips + Team dropdown + search all filter tiles AND grid together.
- [ ] Collapsed past/current cells tinted; future cells neutral; capacity hours correct (32/38/40).
- [ ] Click a week header → stacked bars; ⚠ appears when planned or tracked > capacity.
- [ ] Click a bar → accordion with 4 stats + bullet lines; multiple accordions can be open.
- [ ] A known PTO week shows OOO hatch and reduced available hours.
- [ ] **Billable Utilization is ≤ the tracked/capacity companion on every filter combination.**
      Billable above tracked is now arithmetically impossible — if you see it, the payload is a
      stale pre-v7 cache: run `bustDeliveryCache_()` then ↻ Refresh.
- [ ] In an accordion, `TRACKED Xh — b … / nb … / unclassified …` adds up to X.
- [ ] A person-week with no NetSuite rows shows **no tint**, an `unclassified` hatched bar segment,
      and a `tracked/capacity · unclassified` header — never `0% billable util`.
- [ ] Where the NS and Tempo totals differ, the accordion shows the `ⓘ NS totals Xh vs tracked Yh`
      line naming the applied share (this is the extrapolation being disclosed, not a bug).
- [ ] The Utilization card shows `⚠ classification covers N% of tracked hours` whenever N < 99.
- [ ] CSV export: `Billable h + Non-billable h + Unclassified h == Tracked h` on every row.
- [ ] 🔒 Access panel loads/saves for admins; a non-listed account gets the denied page.
- [ ] ↻ Refresh forces a live read (check generatedAt changes).
- [ ] On-Time coverage reads lower than before schema 5 (epics no longer in the denominator) and the
      rate moves — expected, not a regression. Sanity-check the new `n` against a Jira JQL count of
      resolved non-epic issues in that week.
- [ ] Forecast card headline reads `N of M measurable epics inside ±10%`, with a `median variance N%`
      line and an `of N misses, X% over-run` split — **not** an averaged accuracy score.
- [ ] **A metric below its gate still publishes**, carrying a `◇ low confidence · N% attributed`
      chip, a `below gate — directional only` line, and a hygiene link. Then set
      `CONFIG_DH.SUPPRESS_BELOW_GATE = true` once and confirm the same tile flips to
      `Not yet measurable` with no number anywhere on it — the reversal has to stay one flag away.
- [ ] Every published tile carries a confidence chip (`◆ high` / `◈ medium`) with its coverage %.
- [ ] With suppression on, suppressed tiles still name their period
      (`On-Time Delivery · last complete month (Jul 2026)`) and carry an `attribution trend`
      sparkline of *coverage* — a card with no window and no trend describes nothing.
- [ ] The `✎ definition changed` marker appears **only** on metrics listed in that changeLog entry's
      `affects`. It fired on Billable Utilization once, whose formula never changed — a false marker
      is worse than none, because it teaches people to ignore the real one.
- [ ] ⬇ PNG filenames match the period on screen (`…-Jul-2026.png` in Month mode, `…-FY27-Q1.png` in
      Quarter mode) — not the model's ISO week.
- [ ] Filter to a slice with no closed epics — the Forecast card reads `no epics closed in this
      period`, **not** `Not yet measurable`. Absent data and bad data must never look the same.
- [ ] 🧪 Hygiene opens as its own view, its % matches `resFull ÷ res`, and every gap row carries a
      prerequisite ID and an ISO target week. **No owner column and no individual's name** appears
      anywhere in it — accountability is tracked in the requirements doc via the prereq ID.
- [ ] The hygiene view **names the window it covers** and ◀ ▶ step through complete periods; Σ All
      history sums the whole export window. Switching the header Week/Month/Quarter chips re-renders
      it and resets to the latest period — the toggle must never look inert while that view is open.
- [ ] The hygiene headline shows both figures: the strict composite **and** *"Excluding region: N%
      measurable today"*, plus the binding constraint ("Held down by region at 0%"). A headline stuck
      at 0% with no explanation is the failure mode this replaced.
- [ ] Kill the NS feed (or filter to a period it doesn't cover): the third tile relabels to
      **Capacity Utilization (tracked)** — no billable claim without a billable feed.
- [ ] The `as of` line shows the refresh cadence, and its tooltip lists the source systems.
- [ ] Utilization card shows the base line (`Xh available of Yh capacity — Zh PTO/holiday removed`)
      in any period containing PTO or a public holiday.
- [ ] The PM filter lists only current employees; its tooltip states how many former ones were
      excluded. An external/unknown PM name is still listed — only proven leavers are dropped.
- [ ] Compare by PM or Team: at most 12 bars by default, the chart no taller than about a screen,
      a "N nearer target not shown" note, and **Show all N** restores every category. The bars shown
      by default are the WORST performers, not the best.
- [ ] Trends tab is **only** "Where the headroom is" — no history chart, no values table — and its
      metric chips switch the metric (shared with the Executive comparison).
- [ ] No `✎ definition changed` note on any KPI tile. It appears only under the Trends line chart,
      where there is a visible step for it to explain.
- [ ] Admin: 🧪 Hygiene → ⚙ Coverage gates edits a gate, saves, reloads, and the affected tile's
      confidence changes. The agreed default still shows beside it and Restore puts it back.
      A viewer account sees no gate editor at all.
- [ ] ⬇ CSV downloads and opens in Excel with the BOM intact (blob path); no console error.

## Save PNG

Both the tiles row and the grid panel have their own **⬇ PNG** button — each exports just that
element as `delivery-health-<tiles|grid>-<headlineIso>.png`. The first click lazy-loads
`html2canvas` from a pinned CDN (`H2C_URL`); if the GAS sandbox blocks the script, an alert fires
("PNG export unavailable (script blocked)") and the dashboard is otherwise unaffected.

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
