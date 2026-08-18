# Delivery Health Dashboard — Structure, and why each piece exists

**Purpose of this document:** a complete structural walkthrough for expert review. Every component
is named, the pressure that created it is stated, and its connections in and out are traced. It is
written to be argued with — §12 lists the specific questions we want answered.

**Prepared:** 2026-08-17 (2026.W34) · **Code state:** schema v42, `METRIC_REGISTRY_` v4.1
(24 metrics), full server suite green · **Deployment state:** not deployed.

> ⚠ **`Dashboard.html` is being edited as this is written** (2026-08-17, +463/−134 uncommitted): a
> visual pass adding a collapsible nav, backlog hero tiles and a smart legend, and replacing the
> emoji tab labels with geometric dots. Nothing structural below changes — same five views, same
> role gates, same payload contract — but **a reviewer should pull the current file rather than
> trust a line number**, and the anchors in §13 are as of this writing.

**Related documents, so this one does not repeat them:**

| Document | Answers |
|---|---|
| `README.md` | *How do I operate it?* — deploy order, cache rules, per-release QA scripts |
| `COMPONENTS.md` | *How far can I trust each number?* — metric-by-metric quotability |
| `docs/brainstorming/dash-loop/DATA-BLOCKERS.md` | *What is missing upstream, and who owns it?* |
| `docs/specs/*` | *What was decided, and against what requirement?* |
| **this file** | *What are the parts, why do they exist, and how do they hold together?* |

---

## 1 · The problem, stated once

Delivery leadership needed one weekly read of four questions: **are we on target, where isn't it
working, who can act, and can we trust the numbers saying so?**

Every input already existed — Jira, Tempo, NetSuite, the HR roster — and none of them answered the
question, for a structural reason: each system knows one grain and none knows the join. Jira knows
issues but not capacity. Tempo knows hours but not commitments. The roster knows people but not
work. The answer only exists at the **person × week × issue** intersection, which is precisely the
thing no source system holds.

So the system's whole job is: **build that intersection, publish it with its own evidence attached,
and refuse to pretend when the evidence is not there.** That last clause is the one that shaped most
of the architecture. A delivery dashboard that publishes a confident-looking 0% is worse than no
dashboard, because it retires a question that should still be open.

Two consequences run through everything below:

1. **Nothing renders without stating its own coverage.** Every metric carries a coverage gate, a
   sample floor, and a set of declared deviations, and they travel with the number to the screen.
2. **Absent is never zero.** A missing feed, an unmeasurable cell and a genuine zero are three
   different renderings, enforced by test.

---

## 2 · The shape of the whole system

```
  SYSTEMS OF RECORD          EXPORT TIER              THIS APPLICATION
  ═════════════════          ═══════════              ════════════════

  ┌─────────────┐          ┌──────────────┐
  │ Jira Cloud  │──────────▶│ Jira Raw     │╮
  │ issues,     │  Jira     │ Jira Bugs    │╮╮        ┌──────────────────────┐
  │ epics, bugs │ Backlog.js│ Jira Arrivals│╮╮╮       │  Code.js  (server)   │
  └─────────────┘  (a       │ Flow Snapshot│╮╮╮╮      │                      │
                   separate └──────────────┘ ││││     │  CONFIG_DH  policy   │
  ┌─────────────┐  GAS      ┌──────────────┐ ││││     │  REGISTRY   meaning  │
  │ Tempo       │─project──▶│ Tracked Time │─┼┼┼┼────▶│  9 readers  ingest   │
  │ worklogs,   │           │ Planned Time │ ││││     │  join layer          │
  │ plans, caps │           │ Capacity     │ ││││     │  bucket engines      │
  └─────────────┘           └──────────────┘ ││││     │  gzip-chunked cache  │
                            ┌──────────────┐ ││││     └──────────┬───────────┘
  ┌─────────────┐           │ NS Billable  │─┘│││                │ one JSON
  │ NetSuite    │──────────▶└──────────────┘  │││                │ payload
  └─────────────┘           ┌──────────────┐  │││                ▼
                            │ Data         │──┘││     ┌──────────────────────┐
  ┌─────────────┐           │ Contractors  │───┘│     │ Dashboard.html       │
  │ HR roster   │──────────▶└──────────────┘    │     │ (browser)            │
  └─────────────┘             Google Sheets     │     │  VIEWS · STATE       │
                              (2 spreadsheets,  │     │  client re-slice     │
                               10 tabs)         │     │  renderers           │
                                                │     └──────────────────────┘
                                    Security.js ┴──── gates doGet + every endpoint
```

**Three properties of this shape are load-bearing, and all three are worth challenging:**

**The sheet is the integration contract, not the API.** Nothing here calls Jira or Tempo at read
time. A separate GAS project (`Jira Backlog.js`) writes tab-shaped snapshots on a daily trigger, and
this app reads tabs. The reason is availability, not laziness: a GAS web app has a 6-minute
execution ceiling and shares an org quota, so a live multi-page Jira fetch inside a page load would
fail unpredictably under exactly the conditions that matter (Monday morning, many readers). The cost
is real and permanent — **the dashboard is never fresher than the last export**, so the header
publishes two clocks (§6.10) rather than letting one imply the other.

**One payload, then all slicing happens in the browser.** The server builds the *deep* model — 52
weeks, every person, every bucket — once, and the client re-slices it for every filter, period and
comparison change without a round-trip. Filtering in a GAS app that takes minutes to build cold
would otherwise mean a minutes-long wait per click. The cost is a duplicated-logic seam that §8.4
addresses head-on, and it is the single biggest structural risk in the design.

**The server is authoritative about who may see what; the client only arranges it.** Role comes from
`Session.getActiveUser()` inside `Security.js`, is re-checked on every endpoint, and out-of-tier
content is *absent from the payload path*, not hidden with CSS.

---

## 3 · Deployment topology

Three files live in one standalone Apps Script project — `Code.js`, `Security.js`,
`Dashboard.html` — served from `doGet()` as a single-page app. Nothing else belongs in the project,
and the two test files carry that warning as their first line because pasting them in fails at
`require` and looks like a code bug.

There is **no clasp binding**: deployment is a human paste plus a cache action. That is a deliberate
trade for a small stakeholder set, and it is on the list in §12 as a question — the absence of a
scripted deploy is why the release notes in `README.md` have grown into a per-schema-version
runbook.

---

## 4 · Layer 1 — the sources of record, and what each is trusted for

| Source | Trusted for | Explicitly not trusted for |
|---|---|---|
| **Jira** | issue existence, dates, types, assignee, links | *baselined* commitments — Due Date and Original Estimate are mutable, so a re-baselined milestone reads as on time (declared as a registry deviation on both affected metrics) |
| **Tempo** | worklog hours, plans, scheduled capacity | classification — Tempo does not know what is billable |
| **NetSuite** | the billable / non-billable split | volume — it classifies, it does not quantify |
| **Roster** | population, hire dates, job codes, location | work — it knows people, not what they did |

**NetSuite classifies, Tempo quantifies** is a rule, not a convention: an earlier build took hours
from NetSuite directly and inflated billable utilization. The two feeds are joined so that Tempo
supplies the magnitude and NetSuite supplies only the share.

The roster is read from **two tabs** (`Data`, `Contractors Data`) and that distinction turned out to
be the most consequential data fact in the system — see §6.5.

---

## 5 · Layer 2 — the export tier

`Jira Backlog.js` runs in a **different** GAS project and writes four tabs. It is outside this
repository's test boundary, which is a stated weakness: it has **no automated tests at all**, and it
is upstream of every Jira-derived number here.

| Tab | Grain | Why it exists separately |
|---|---|---|
| `Jira Raw` | one row per issue | the substrate for every issue metric |
| `Jira Bugs` | one row per bug | deliberately population-wide, so bug counts are not filtered by the delivery population |
| `Jira Arrivals` | one row per ISO week | *is the queue growing?* — a weekly created/resolved tally over 52 weeks |
| `Flow Snapshots` | one row appended per run | **history that cannot be recomputed later**: backlog and WIP at a point in time are not derivable from today's issue list |

That last row is the interesting one architecturally. Three of the four tabs are fully rewritten
each run and are therefore idempotent; `Flow Snapshots` is append-only and a hand-edit corrupts
history permanently. The system has one irreversible store, and it is a spreadsheet tab — flagged in
§11.

The export depth (52 weeks) is a **shared dial** across all four exporters and this app's
`WEEKS_PAST_DEEP`. The constraint chain is worth stating because it is not obvious: 52 weeks of one
person's worklogs still fits inside Tempo's single 500-result page, so exports stay at one request
per person; 65 weeks tips typical users onto a second page and doubles transient-failure exposure.
The dashboard must never ask for more depth than the export carries, or the deep weeks come back
empty and read as *zero activity* rather than *no data*. **Exports first, dashboard second** is a
deploy-order rule derived from that.

---

## 6 · Layer 3 — the server (`Code.js`)

One file, ~10,900 lines, organised in seven bands. Its shape is a pipeline: **policy → definitions →
window → readers → join → engines → payload**, with cache and endpoints wrapped around the outside.

### 6.1 `CONFIG_DH` — policy that happens to live in code

Not a settings bag. It is where **ratified decisions** are parked so they are reviewable in one
place: the On-Time scope, the tracking-mandate allowlist, the suppression flag, the forecast
tolerance band, region maps, targets, cache TTLs.

Two conventions make it work as a governance surface rather than a junk drawer:

- **Every non-obvious value carries the decision, the date, the owner and the counter-argument.**
  `ONTIME_SCOPE: "dictionary"` sits under twenty lines explaining that the alternative reading would
  raise the published number from n=2 to n=146 — and that raising it would hide the blocker the
  metric exists to expose. It ends with *"Reopen it with Bill, not in this file."*
- **Values whose change alters a metric's meaning say so, and name the required ceremony**: add a
  `changeLog` entry, bump `DH_SCHEMA_VER_`, bust the cache.

Overrides land in Script Properties (`DH_SOURCE_SS_ID`, `DH_ROSTER_SS_ID`, `DH_JIRA_BASE`), so
pointing at a sandbox Jira or a copied spreadsheet needs no code edit.

### 6.2 `METRIC_REGISTRY_` — the definitional spine

**The single most important object in the codebase.** For each of 24 metrics it declares: id, name,
definition, formula, sources, grain, target, **coverage gate**, what coverage is *of*, **sample
floor**, owner, parameter owner, EBITDA linkage, and a list of **known deviations**.

It exists because of a specific failure that had already happened: the dashboard and the Metrics
Dictionary described **different metrics under the same four names**. Two people reading one tile
computed two numbers, and neither was wrong. That is worse than a bug, because nothing looks broken.

Structurally, the registry is what stops presentation code from being a second definition:

- the client renders labels, targets, RAG bands, tooltips and the suppressed state **from
  `meta.registry`**, never from its own constants;
- `invertTarget` is a registry field, which is why a 3% rework rate paints green instead of red —
  lower-is-better is a property of the metric, not of the renderer;
- `deviations` surface in-product on each metric's ⓘ, so a number cannot be quoted without them;
- `changeLog` + `version` drive the `✎ definition changed` marker on any trend line whose metric
  changed inside the visible window — **a step in a trend is never misread as a performance move**.

The registry is also the appeal mechanism. When two readers disagree about a number, the registry is
the tiebreaker, and it names who may change each parameter.

### 6.3 The window and period model

`buildDhWindow_` derives every window from today: grid weeks, trend weeks, the 52-week deep window,
and three forward weeks. `buildPeriods_` folds ISO weeks into months and quarters.

ISO weeks are the atom for a reason — Tempo, Jira and the roster all disagree about calendar
boundaries, and every join in the system is keyed `YYYY.Wn`. The helpers (`isoWeekNum_`,
`isoWeekYear_`, `isoWeekThursday_`, `weeksInYear_`, `canonicalIsoWeek_`) exist to make that key
canonical across four timezones, and they are tested across four timezones because a week label that
shifts by one at a year boundary silently mis-buckets a whole quarter.

Depth is chosen by *complete-period yield*, measured rather than assumed: 30 weeks yields 1 complete
quarter (so a quarterly tile shows a single point and no trend), 52 yields 3 quarters and 11 months,
65 would yield 4 quarters and enable year-over-year. The system sits at 52 for the Tempo paging
reason in §5 — an explicit trade between analytical depth and export reliability.

### 6.4 The readers — nine functions, one rule

`readRosterPeople_` · `readCapacitySheet_` · `readTempoGrid_` (×2, tracked and planned) ·
`readNsBillable_` · `readJiraRaw_` · `readJiraBugs_` · `readArrivals_` · `readFlowSnapshots_`.

Each opens one tab, resolves columns by **header name** (`colIdx_`, case-insensitive) rather than by
position, and returns a normalised row set plus an `available` flag.

The rule they all share: **an absent tab is an absent feature, never an error.** A missing
`Flow Snapshots` tab means the export predates v3.9.0, so the flow tiles say so; they do not throw,
and they do not render zero. This propagates all the way to the UI as `bugsAvailable`,
`flowSnapshotsAvailable`, `arrivalsAvailable`, `jiraUnknown` — each a distinct rendering.

`readJiraRaw_` additionally parses the exporter's own `Generated:` footer (`parseExportStamp_`),
which is how the app knows the *data's* age rather than its own.

### 6.5 The join layer — and the decision that changed the most numbers

Everything meets at the person. `normDH_` normalises a name, `nameAliases_` generates the
`"Last, First"` / `"First Last"` variants that Jira and Tempo respectively emit, `buildNameIndex_`
builds the lookup and `resolveName_` resolves against it.

**The structural decision: there are two indices, not one.**

| Index | Population | Feeds |
|---|---|---|
| `nameIdx` | tracking-mandated families only (JF007, JF009, blank/crew) | capacity, utilization, planned time — the *hours* metrics |
| `attribIdx` | the **whole active roster**, both tabs, before the department and class gates | On-Time, Forecast, Quality — the *issue* metrics |

The reason is a bug that was measured, not theorised. Live FY26 Q4: **173 of 351 assigned issues
(49%) were being dropped by our own join** — four times any other source of loss. Two causes, both
structural:

1. The roster reader gated every row on `Department === "Services"` and the gate is *fail-closed* —
   but the `Contractors Data` tab has no Department column at all, so **every crew row was excluded,
   always**. Their Jira work then had no person to land on and counted as "unattributed".
2. The name index was built from the tracking-mandated population, so an FTE outside those families
   — Solution Architecture, Operations, Training — also failed to resolve.

The second gate is *correct* for utilization (those people owe no tracking) and *wrong* for the
issue metrics (someone outside the tracking families who closes an epic on time still delivered it
on time). One index could not be right for both, so there are two. A contractor's closed epic now
lands on that person and counts in the delivery metrics; their capacity still counts nowhere,
because they owe none.

Two guards keep the split honest: leavers are excluded from `attribIdx` deliberately, so that if one
ever slipped past the upstream filter it lands as visibly *unattributed* rather than quietly
re-entering a rate about people who can still be coached; and people who appear only in attribution
are pushed into `people[]` as **stubs carrying `attribOnly: true`**, so a drill-down can label them
without them ever entering a capacity denominator.

Region resolution follows the same "primary signal, disclosed fallback" pattern: person-region comes
from the majority of their region-tagged tracked hours, falling back to roster location, and the UI
marks `◦` wherever the fallback was used — because the Jira Region field is 0% populated and
pretending otherwise would be the whole executive layer resting on an inference nobody was told
about.

### 6.6 The bucket engines — one per metric family

Each takes scoped rows and returns `{ buckets, unattributed, … }`, bucketed by ISO week and keyed by
person so the client can re-roll by region, team, PM or family without a round-trip.

| Engine | Produces | Design note |
|---|---|---|
| `utilRollup_` + `nsCoverage_` + `clampToCapacity_` | billable utilization | overflow clamped; NS coverage reported so a low rate reads as *poor coverage* vs *low billing* |
| `onTimeBuckets_` / `onTimeInScope_` | on-time rate | scope is a policy switch with four readings, pinned by test |
| `forecastBuckets_` | forecast accuracy | floored at zero per epic before averaging; estimate-without-worklog excluded from the denominator and counted to coverage instead |
| `reworkBuckets_` | quality/rework | numerator signal is structurally absent today, so it publishes **no RAG colour at all** and reads *"at least N% — lower bound, not a measurement"* |
| `leadTimeBuckets_` / `throughputBuckets_` / `flowOpenBuckets_` / `queueSnapshot_` | flow | queue halves (assigned / unassigned) kept separate all the way to the client |
| `clearRateMedian_` + `inventoryWalkback_` | weeks-to-clear, inventory history | **median** of 8 weeks, and history *reconstructed* from arrivals — anchored on the measured total, so it is empty rather than fabricated when the total cannot be measured |
| `hygieneBuckets_` / `personHygieneBuckets_` | field-fill at two grains | one predicate set, two grains — org and person. It was three until 2026-08-17: the issue-type grain (`typeHygieneBuckets_`, the 🧬 matrix) was removed because a per-type percentage names nobody who can fix a ticket |
| `backlogHealthBuckets_` + `BACKLOG_SIGNALS_` | ready/blocked state | `ready` = dated **and** estimated **and** linked **and** fresh |
| `epicDueAudit_` | 🚩 undated epics | audits a ratified 100% rule, deliberately fed from the same leaver-scoped set as every other hygiene surface so the counts reconcile |

The engine that best shows the house style is `reworkBuckets_`. A rate whose numerator signal is
switched off upstream renders 0% — and 0% in green was the healthiest-looking card on the page while
its own small print said reopens were not counted. The fix was not a better number; it was removing
the colour and relabelling the number as a floor. **Colour returns automatically when the signal
does.**

### 6.7 The workforce engine — five passes over one weekly map

`buildWorkforceHealth_` is the largest subsystem and the only one with its own numbered spec
sections in-code (§5.1–§5.6). It answers *which pool is out of room, and which has room to sell*.

Its governing rule: **capacity is not fungible.** One company-wide availability percentage averages
together people who cannot do each other's work, so every figure is reported per
**deployment pool × level band** — the set of people who could genuinely swap onto the same backlog
item, at a seniority that could absorb it.

```
   people ─┐
           ├─▶ buildCapacity_     §5.1  what we pay for       ─┐
   planned ┼─▶ buildCommitment_   §5.2  what we promised       ├─▶ ONE weekly map
   tracked ┼─▶ buildConsumption_  §5.3  what happened + shadow ─┤    (cell × week)
   jira ───┴─▶ buildBacklog_      §5.4  remaining obligation  ─┘
                      │
                      ▼
              dhFoldWeekly_ ──▶ reconcileWorkforce_  §5.5  the three quantities meet
                      │                    │
                      │                    ▼
                      │           dhActionState_     §5.6  a state, never an instruction
                      ▼
              disciplineSection_ §4.4  how humans navigate the same cells
```

Four design choices here are the ones most worth reviewing:

- **All four passes write into one weekly map.** A cell that exists in only one pass (capacity but
  no plan; plan but no logged time) still appears with the others at zero, rather than vanishing
  through a key mismatch — the emptiest cell on the grid is often the finding.
- **Classification keys on the job code (`family.variant`), never on title text.** `DH_SUB_TRACK_`
  maps a code to a pool and role; where the code and the title disagree, the mismatch is *counted
  and shown* rather than resolved silently. New job codes therefore surface as a rising
  `UNCLASSIFIED` count, which is a real governance signal: codes exist that Workforce Planning has
  not been told about.
- **Pools declare `consumes: true/false`.** `MS-SUPPORT` and `CREW` publish **n/a** for backlog
  cover, not zero — support is contracted and recurring, and crew capacity is scaled *to* the work
  rather than held against it. Publishing a cover figure for on-demand capacity would invite the
  reading "crew are running out of work" when the truth is "nobody booked them this week".
- **The vocabulary is descriptive, not directive.** `STEADY` · `HEADROOM` · `AT CAPACITY` ·
  `REVIEW` · `RECONCILE` · `DEMAND-DRIVEN`. The source spec proposed INTERVENE / SELL / HIRE; those
  are instructions, three of them are alarms, and on a business delivering week over week they
  misread ordinary measurement gaps as problems. **Red is reserved for the Executive cards, which
  have ratified targets to fail against** — spending it here would devalue it there.

And what it refuses to compute: `capacityTruth` (deployable ÷ gross) renders **null**, because the
only available absence proxy is Tempo-tracked time off, which measures *what people logged, not when
they were away* — using it would make the best-tracking teams look least available, inverting the
signal exactly where it matters most. Three counts (`UNCLASSIFIED`, title mismatches, `UNROUTED`)
render **even at zero**, on the principle that a field which only appears when it is broken gets
ignored when it breaks.

### 6.8 The PM engine — attribution without a roster

`pmOwnedWork_` exists because of a population hole: **PMs are structurally absent from this
dashboard's population.** Family 15 carries no tracking mandate, so a person-grained approach would
have needed a second roster.

The resolution order is *evidence before inference*: an epic belongs to its **Jira assignee** (the
ticket states who owns it) and falls back to the **Tempo project lead** (`GTT-605 → GTT → that
project's PM`) only when there is no assignee. Each PM row states how many of its epics came from
each rule, so an attribution can be challenged rather than trusted. Children follow their epic
through the parent chain (`dhEpicOfChain_`), because most sub-tasks parent to a story rather than
directly to an epic.

Three hazards this engine had to be built around, each of which produced a visible wrong answer:

- **`"⚠️ UNASSIGNED"` is a literal string the exporter writes**, never a blank. Read naively it
  invented a PM of that name and put **267 epics** under them — a fabricated owner at the top of a
  page about ownership. `dhAssigneeOf_` applies the guard.
- **Jira writes `"Lopez, Moises"`, Tempo writes `"Moises Lopez"`.** Without `dhPmKey_` the same
  person appears twice with their epics split, and both halves read as half-done — a failure that
  looks like data rather than a bug.
- **`(No PM)` is a finding, not a rounding error.** A project with no hours in the Tempo export has
  no PM and everything in it lands there; a large bucket is a statement about Tempo project
  coverage, and the correct response is upstream, not a change of attribution rule.

The verdict split is a question of **when, not by how much**: anchored on the *epic's* own committed
week, ⚠ at-risk (date still ahead — both levers open, the actionable state) versus ✖ breached (date
gone, work still scheduled beyond it — recovery). Because the anchor is the epic's week, all its
children fall on the same side, which is what lets the epic state one verdict.

### 6.9 The confidence layer — the part that decides whether to speak

`metricConfidence_` and `sampleFloorFor_` sit between the engines and the payload, and they
implement **two separate instruments that are often confused**:

- a **coverage gate** asks *how much of the population is visible?* (On-Time 80%, Forecast 70%);
- a **sample floor** asks *is this enough events to be a rate at all?* (5).

They are independent: a metric can see 95% of the population and still be computed over two closed
epics, and a mean over two things is not a mean. Both must pass.

`CONFIG_DH.SUPPRESS_BELOW_GATE` decides what happens when they do not, and it currently ships
**false** — a below-gate metric is published rather than suppressed. This is a **declared, owned
deviation** from the requirement (FR-2.2), not an oversight: gating went dark on two of four tiles
and took their history with them, and a dashboard nobody can read teaches nobody anything. The
entire suppression path stays intact behind the flag, render-smoke covers **both settings**, and the
owner is named (Services Director). Gate values themselves are admin-editable at runtime
(`readGateOverrides_` / `saveGateOverrides`) and merge over the registry via
`registryWithOverrides_`.

### 6.10 Payload assembly and `schemaVer`

`assembleModel_` is the confluence: it builds the population, both name indices, the per-person
weekly accumulators, runs every engine, and returns one JSON object:

```
{ schemaVer, meta{…}, people[], onTimeBuckets[], forecastBuckets[], reworkBuckets[],
  leadTimeBuckets[], throughputBuckets[], flowOpenBuckets[], queue{}, arrivalWeeks[],
  inventoryHistory[], bugWeekly[], hygieneBuckets{}, personHygiene{},
  backlogHealth{}, epicDueAudit{}, pmOwned{}, workforceWeeks[], workforceHealth{…} }
```

`meta` is not incidental — it is the contract that lets the client be honest. It carries the
registry (with overrides applied), the source list and refresh cadence, targets and thresholds, the
available-feed flags, per-metric `jiraUnattributed` counts, NS join telemetry, the leaver-exclusion
**count** (a policy, stated — a number that quietly got smaller is indistinguishable from a broken
feed), the Jira base URL for deep links, and the drill-down caps so one config edit moves both the
view and its honest "N of M" line.

**Two clocks ship deliberately.** `generatedAt` is when the model was assembled — the warmer resets
it every 30 minutes, so it is *always* fresh and therefore says nothing about the data. `dataAsOf`
is when the Jira export last wrote its tab, read from the exporter's own footer, and it is the
number a reader means by "how current is this?" Age is computed **server-side against the same
clock**, so two readers in different timezones with skewed laptops cannot see different staleness
verdicts. And absent ≠ stale: a missing footer renders "unknown", because a warning nobody can act
on trains people to ignore the real one.

`DH_SCHEMA_VER_` (currently **41**) is the payload's shape version, and it is the mechanism that
makes deploys safe. Each engine addition bumps it; `getDeliveryData` treats a differing `schemaVer`
as a **clean miss** and recomputes. The failure this prevents is not an empty card — it is a *wrong
card*: a cached v29 model read as v31 gives every person `pool: undefined`, collapsing the
population into one cell and silently reproducing the exact blended availability figure the release
existed to retire. **A wrong number wearing a right number's clothes.**

### 6.11 Cache — four mechanisms, four distinct failure modes

| Mechanism | Prevents |
|---|---|
| **gzip + 90 KB chunking** (`cachePutLarge_` / `cacheGetLarge_`) | `CacheService` hard-fails above 100 KB per value — a plain `put` of this payload fails *silently*, making every load a cold multi-minute build. A missing chunk on read is treated as a clean miss |
| **schema guard** | serving a stale *shape*, which renders wrong rather than empty (above) |
| **`LockService` rebuild lock** (`tryLock`, 5 min) | the thundering herd: five people opening the page during a cold window used to start five concurrent full rebuilds of the same sheets, each slower than one pass. The first caller builds, the rest queue and then read what the winner wrote. `waitLock`, not `tryLock`-and-give-up, because a caller that gave up would start the very rebuild the lock exists to prevent |
| **time-triggered warmer** (`warmDeliveryCache`, 30 min) | cold loads for everyone; the trade is that data can lag by the warm interval, which is why ↻ Refresh bypasses cache entirely |

`buildDeliveryModel_` wraps every reader in a timer and logs a sorted breakdown with row counts —
because nothing recorded where a reported **4+ minute** cold build went, and every conversation
about it was guesswork. The instrumentation ships to the client as `meta.buildMs`. **This has never
run against live sheets; the size of the win is unmeasured.**

### 6.12 Endpoints

`doGet` (access check, then serve the SPA) · `getDeliveryData(forceRefresh)` (the one data endpoint)
· `warmDeliveryCache` / `setupDeliveryCacheWarmer` (trigger) · `bustDeliveryCache_` (version bump) ·
`probeDeliverySources` / `auditJiraFillRates` (deploy-time diagnostics that print row counts, join
coverage and raw Region values, so a misconfiguration is caught before anyone reads a number).

---

## 7 · Layer 4 — `Security.js`

Three grants applied in order — bootstrap admin (code-level, indestructible), code-level default
admins/viewers (survive a Script Properties reset), runtime lists (any admin can edit from the 🔒
panel, additive) — plus an open-access flag for demos.

The design decision worth reviewing is the **`guest` role**. The Metrics Dictionary limits
utilization and forecast-variance detail to "directs and above". Open access used to hand every
unidentified visitor the `viewer` role, and with it the margin numbers, on a projector. So
open-access sessions now resolve to `guest`: allowed in, outside the margin tier. Named people are
matched **first**, so turning open access on can never demote a director.

Enforcement is layered, and hidden means hidden:

- `checkDeliveryAccess()` runs inside **both** `doGet` and `getDeliveryData`;
- out-of-tier cards are **not rendered at all** — not dimmed, because a dimmed number is still a
  number on a projector and "greyed out" invites someone to ask what it says;
- the metric is removed from every chip strip and comparison chart too, so it cannot be read off a
  bar instead;
- `dhMarginTier_()` in `Security.js` is the **server twin** of `canSeeMargin_()` in the client.

This app deliberately has **no manager org-tree scoping** (unlike the sibling PS dashboard) — the
data is delivery-wide resourcing, and a partial view of a pool would be more misleading than no
view.

---

## 8 · Layer 5 — the client (`Dashboard.html`)

One file, ~9,300 lines: markup, styles and the whole client runtime. Single-file is not a
preference — `HtmlService` serves one template, and splitting into includes buys modularity at the
cost of an extra fetch per file on a page that is already slow to start.

### 8.1 `VIEWS` — navigation as data

```js
var VIEWS = [
  { id:"exec",      label:"Executive", dot:"◆", pane:"viewExec",      roles:null,               hint:… },
  { id:"actions",   label:"Actions",   dot:"▲", pane:"viewActions",   roles:["admin","viewer"], hint:… },
  { id:"pm",        label:"PM",        dot:"■", pane:"viewPm",        roles:["admin","viewer"], hint:… },
  { id:"workforce", label:"Workforce", dot:"●", pane:"viewWorkforce", roles:["admin","viewer"], hint:… },
  { id:"access",    label:"Access",    dot:"◇", pane:"viewAccess",    roles:["admin"],          hint:… },
];
```

The `hint` is not decoration either — each view states the question it answers, in the nav, so a
reader picks a tab by their question rather than by guessing at a label.

Label, pane id and role gate are declared **once**; the tab bar, `switchView_` and `renderAll_`'s
dispatch all derive from this array, so adding a tab is never a four-file edit. The gate is enforced
**inside `switchView_`** — a forbidden id typed by hand lands on Executive — not merely by hiding a
button.

Why tabs at all: everything used to stack into one scroll, so a manager looking for *who needs me
this week* waded through executive KPIs, and an executive looking for *are we on target* waded
through a 200-row roster. **One view answers one question.** 🗓 PM sits beside 🎯 Actions on purpose
— they are the same question at different grains: *who* needs action, and *which committed work*
needs action.

### 8.2 `STATE` — what a filter actually is

`MODEL` holds the payload; `STATE` holds everything the reader has chosen: view, period index,
filters (region, team, PM, family, role, population), focus, active metric, comparison dimension,
roster sort, signal filter, expansion sets (`pmOpen`, `pmEpicOpen`), and the by-type population
toggle. Every render is a pure function of `(MODEL, STATE)`.

That is what makes client-side re-slicing possible, and it is why the payload is built over the
**deep** window rather than one period: changing period, filter or comparison re-folds existing
buckets instead of asking the server for anything. On an app whose cold build is measured in
minutes, a round-trip per click would be unusable.

Expansion state is scoped deliberately — collapsing a PM leaves its epic keys in `pmEpicOpen`, so
re-opening restores exactly the epics that reader had open, which is what people expect from a
drill-down they are working through.

### 8.3 The Executive tab — a newspaper, in eight bands

Order is the design. Most important first, evidence before the numbers it qualifies:

| # | Band | What it answers |
|---|---|---|
| 1 | Masthead | the one-sentence verdict, assembled from ranked findings — the line you quote |
| 2 | Backlog band | total queue, net flow, weeks-to-clear, three-segment ruler |
| 3 | Evidence gates | *can we publish these numbers?* — read **before** quoting anything above. Three tiles, plus a line naming any failing check with no tile of its own (the gaps queue that used to carry those in full was deleted 2026-08-17) |
| 4 | Flow band | Cleared · Arrived · Lead time · On-Time (+ Forecast, Quality when measurable) |
| 5 | Capacity band | recoverable hours · utilization · people signals |
| 6 | Comparison grid | metric × Region/Team/PM/Job-family; click a column for a bullet chart |
| 7 | Shelf | *"not measured this period"*, and why — so silence is never mistaken for success |
| 8 | Trust detail | collapsed reconciliation notes, for when a number is challenged |

Band 7 is the one that does not exist on most dashboards and is the most important. A metric that
cannot be computed **leaves a visible hole with a reason attached** rather than disappearing.

### 8.4 Client twins — the seam, and the contract that holds it

Some server logic is duplicated in the client so that filtering and period changes can re-compute
locally. The known twins:

| Server | Client | Why duplicated |
|---|---|---|
| `utilRollup_` / capacity fold | `utilFor_` / `aggWeeks_` | re-base utilization on a filtered population |
| `metricConfidence_` | `metricConfidence_` | confidence must follow the filtered slice, not the org |
| `sampleFloorFor_` | `sampleFloorClient_` | same |
| `dhOverdue_` | `dueBand_` | date banding in drill-downs |
| `dhFoldWeekly_`, `reconcileWorkforce_`, `dhActionState_`, `dhWorkforceRead_` | `wfFold_`, `wfReconcile_`, `wfActionState_`, `wfRead_` | re-slice the pool grid by period |
| `dhMarginTier_` | `canSeeMargin_` | role gating on both sides |

**Two implementations of one rule drift silently, and each looks correct alone.** The mitigation is
a contract, not discipline: every twin has a **parity suite** in `node-tests.js`
(`_test_clientParity_`, `_test_confidenceParity_` over 280 gate combinations,
`_test_sampleFloorParity_` over 144, `_test_dueBandParity_` over 121 week comparisons,
`_test_workforceParity_` over 35 cells) that walks both implementations over a generated input space
and fails on any divergence. Each twin is also marked in both files with `⚠ CLIENT TWIN … change
one, change both`.

This is the structural weak point of the design and we know it. §12 asks whether the contract is
sufficient or whether the duplication should be removed.

### 8.5 Scope tags — `PERIOD` / `SNAP` / `ORG`

Every tile, chip and roster column states which clock it follows, because a tile's own period could
silently disagree with the header's picker and nothing on screen said so.

| Tag | Follows |
|---|---|
| `PERIOD` | the Week/Month/Quarter picker **and** every filter |
| `SNAP` | every filter, but **ignores** the period picker — backlog and WIP are inventories, not time series |
| `ORG` | ignores filters **and** the picker — the data-trust strip is a pipeline health check, not a filtered read |

Placement is asserted tile-by-tile in `render-smoke.js`, not just "somewhere in the strip".

### 8.6 Rendering rules that carry policy

These live in string concatenation, which is exactly where a unit test cannot reach and a typo ships
the opposite of what was decided — hence §9.

- **A below-gate metric is still gated** even though the cards stopped narrating coverage (the
  ◆/◈/◇ chip and the caveat line were removed as noise; coverage now reads on the data-trust strip
  and ownership on Actions).
- **An empty period must not read as bad data.**
- **A stale model must not print a delta.**
- **Ungraded is grey and `—`, never 0%** — a person whose whole backlog is unstarted, or a group
  under the sample floor, is *not measured*, not *bad*.
- **Every chart has a table twin**, so no value is reachable only by hover; charts are
  direct-labelled.
- **Legends are captions, not controls.**
- **Counts, not names, in chart-area verdicts** — the detail lives in the expandable row beneath.
- **Motion respects `prefers-reduced-motion`**, and count-up fires once per page load, never on a
  filter re-render.
- **Everything sheet-derived goes through `esc_`** before it reaches `innerHTML`.

---

## 9 · Layer 6 — the tests, which are also the specification

Two local Node runners, never pasted into the GAS project.

**`node-tests.js`** evals `Code.js` with `Logger`, `Utilities` (gzip/base64 via zlib) and a fake
cache stubbed, then runs ~50 pure `_test_*` functions that live *inside* `Code.js`. Keeping them in
the same file is deliberate: they also run in the GAS editor, so a maintainer with no Node
environment can still verify behaviour where the code actually executes.

**`render-smoke.js`** is the more unusual one and the more valuable. It extracts the inline
`<script>` from `Dashboard.html`, stubs just enough DOM (including an `innerHTML` setter that wipes
children, or a rebuilt tab bar would accumulate and a role-gate assertion would pass on stale
children), evals it, drives renders against synthetic models, and asserts on the **HTML produced** —
over a thousand checks — the suite prints the exact count, which moves every release.

It exists because the rules that matter most in this build are *rendering* rules. "A below-gate
metric must still be gated", "an empty period must not read as bad data", "the scope tag rides with
its own tile" — none of those are reachable by a unit test, and all of them are one typo from
shipping inverted.

**What the tests cannot see, stated honestly:** motion (`requestAnimationFrame` and
`prefers-reduced-motion` do not exist in the stub), real layout and column collision, and anything
about the exporter, which has no tests at all. Layout in particular has bitten this codebase — a
table inherited a `table-layout:fixed` class whose first row was a full-width group header, so every
`nowrap` cell painted on top of its neighbour and every test still passed. **Rendering must be
verified with a screenshot; the suite is blind to it.**

---

## 10 · The cross-cutting invariants

Everything above is held together by seven rules. Each has at least one test, and each exists
because its absence produced a specific wrong answer.

1. **One definition per metric, and it lives in the registry.** Presentation code never carries a
   second definition. *Failure it prevents: two people, one tile, two numbers.*
2. **Absent ≠ zero ≠ unmeasurable.** Three distinct renderings, never collapsed. *Failure: a
   switched-off signal rendering as green 0%.*
3. **Every exclusion is counted and stated.** Leavers, filtered-out epics, clipped key lists,
   unattributable work. *Failure: a number that quietly got smaller is indistinguishable from a
   broken feed.*
4. **The published number carries its own evidence.** Coverage gate and sample floor are separate
   instruments and both must pass. *Failure: a mean over two epics presented as a mean.*
5. **Shape changes bump `schemaVer`, and the cache is keyed by it.** *Failure: a wrong number
   wearing a right number's clothes for a whole TTL.*
6. **Every client twin has a parity suite.** *Failure: two implementations drifting, each correct
   alone.*
7. **Role is decided server-side and out-of-tier content is absent, not dimmed.** *Failure: margin
   numbers on a projector.*

An eighth is a house rule about tone rather than data, and it governs every human-facing surface:
**the workforce and signals views describe states, never issue instructions, and never name a person
in a chart verdict.** Counts sit in the chart area; names sit inside an expandable row someone chose
to open. Red is reserved for metrics with ratified targets, so that when it appears it still means
something.

---

## 11 · Known seams — where we think the structure is under strain

Listed plainly, because a review that has to discover these first is a wasted review.

1. **Duplicated logic between server and client.** Six twin families, mitigated by parity suites.
   The mitigation is strong but the duplication is real, and it grows with every re-sliceable view.
2. **The exporter is untested and upstream of everything Jira-derived.** It is also in a different
   project, so a change there ships without any of this repo's safety net.
3. **One irreversible store, and it is a spreadsheet tab.** `Flow Snapshots` is append-only history
   that cannot be recomputed; a hand-edit corrupts it permanently.
4. **Cold-build cost is unmeasured against live data.** The lock, the hot-path fix and the
   instrumentation are sound but unquantified. If the warmer itself exceeds ~5 minutes it hits the
   GAS 6-minute ceiling, never completes, never populates the cache — and then *every* load is cold.
   The `⏱ buildDeliveryModel_` log line is the first thing to read after deploy.
5. **`Code.js` is ~10,900 lines in one file.** GAS has no module system; the file is banded and
   navigable, but it is one file.
6. **The deploy is a human paste plus a cache action**, with a per-schema-version runbook that has
   grown to hundreds of lines. Ordering mistakes are recoverable but silent.
7. **Region and Team are substitutes, disclosed but not equivalent.** The Dictionary defines every
   metric as rolling up by two Jira custom fields that are 0% and 28% populated. The dashboard
   substitutes person-region from tracked hours and Tempo team names, labels the substitution, and
   trends the gap — but *"by region"* does not yet mean what the Dictionary says it means, and the
   executive comparison layer rests on that.
8. **The client re-slice budget is a browser-side full re-render**, and the roster is ~200 rows with
   expandable detail. It has not been profiled on a low-end laptop.
9. **A coverage-gate deviation is shipped on purpose** (`SUPPRESS_BELOW_GATE = false`). It is owned
   and reversible by one flag, but it means the page can publish a number the requirement would
   suppress.

---

## 12 · What we would like expert feedback on

Ordered by how much a different answer would change the build.

1. **Is the twin-with-parity-suite contract acceptable, or should the duplication go?** The
   alternatives we see are: (a) keep it, (b) move re-slicing back to the server and accept a
   round-trip on every filter change, (c) extract the shared rules into a single string constant
   evaluated on both sides. (c) is testable but unusual in GAS. Which would you defend in a review
   two years from now?
2. **Is the two-index join (population vs. attribution) the right resolution**, or is it a symptom
   of a population model that should be one roster with per-metric predicates?
3. **Coverage gate and sample floor as independent instruments** — is that the right decomposition,
   or should confidence be a single computed score with a threshold?
4. **Publishing below-gate numbers with the evidence attached, versus suppressing them.** We ship
   the first. Both behaviours exist behind one flag and both are tested. Which is the safer default
   for a C-suite audience that will quote what it sees?
5. **`schemaVer` as the cache-correctness mechanism.** It is a hand-maintained integer whose bump is
   a human step in a per-release runbook. Is there a shape-derived alternative (a hash of the
   payload's key set) that would be self-maintaining without being unpredictable?
6. **The descriptive vocabulary on Workforce Health** (`STEADY`/`HEADROOM`/`AT CAPACITY`/…) instead
   of the source spec's directive one (INTERVENE/SELL/HIRE). We believe directive language on
   measurement gaps manufactures alarm. Does the descriptive set still drive action?
7. **Absent ≠ zero, applied to a metric whose numerator signal is switched off** — Quality/Rework
   currently publishes a number with **no RAG colour at all** and the words *"at least N% — lower
   bound"*. Is a colourless number better than no card?
8. **The sheet-as-integration-contract choice.** It costs freshness and adds an untested exporter.
   Is there a version of this that reads Jira live within the GAS execution ceiling that we have
   dismissed too early?
9. **`Flow Snapshots` as the only irreversible store**, held in a spreadsheet tab. What is the
   minimum acceptable protection here?
10. **Eight bands on one Executive page.** Does evidence-before-numbers survive contact with a
    reader who scrolls to the chart they came for?

---

## 13 · Reading order for a reviewer

Anchors are as of 2026-08-17; `Dashboard.html` is moving (see the banner at the top), so search by
symbol name if a number does not land.

1. `Code.js` 11–265 — `CONFIG_DH`. Every ratified decision, with its counter-argument.
2. `Code.js` 267–945 — `METRIC_REGISTRY_`. If you read one thing, read this.
3. `Code.js` `assembleModel_` (5946) and its return block (~6310) — the payload contract.
4. `Code.js` §5.1–§5.6 (~4446–5230) and `buildWorkforceHealth_` (5113) — the densest subsystem.
5. `Dashboard.html` 962 `STATE` · 1016 `VIEWS` · 1064 `canSeeMargin_` — the client's whole contract
   in 120 lines.
6. `tests/delivery-health/render-smoke.js` 1–95 — the harness, and what it can and cannot see.
7. `docs/brainstorming/dash-loop/DATA-BLOCKERS.md` — what the numbers are waiting on, and who owns
   each gap.
