# Delivery Health Dashboard — Components and Best Use

**Audience:** anyone who has to read, quote, operate or maintain this dashboard.
**Status as of 2026-08-06 (2026.W32):** code complete, **not yet deployed**. See §7.

---

## 1. What this application is, in one paragraph

A standalone Google Apps Script web app that answers one question for delivery leadership: **how much
work is in front of us, is it growing, and can we trust the numbers saying so?** It reads Jira and
Tempo data out of Google Sheets, joins it to the staff roster, and renders a single-page dashboard.
It is *not* a project tracker and *not* a replacement for Jira — it is a weekly read of the queue and
the evidence behind it.

---

## 2. How the data flows

```
   Jira Cloud                Google Sheets                 GAS Web App
   ──────────                ─────────────                 ───────────

  ┌──────────┐   export    ┌───────────────┐   read     ┌────────────┐
  │  Issues  │────────────▶│  Jira Raw     │───────────▶│            │
  │  Bugs    │  (weekly,   │  Jira Bugs    │            │  Code.js   │
  │  Epics   │   manual)   │  Jira Arrivals│            │  (server)  │
  └──────────┘             │ Flow Snapshots│            │            │
                           └───────────────┘            │  builds a  │
  ┌──────────┐             ┌───────────────┐            │  person ×  │
  │  Tempo   │────────────▶│ Capacity      │───────────▶│  week model│
  │  hours   │             │ Tracked/Plan  │            │            │
  └──────────┘             │ NS Billable   │            └─────┬──────┘
                           └───────────────┘                  │ JSON
  ┌──────────┐             ┌───────────────┐                  ▼
  │  Roster  │────────────▶│ Data +        │───────────▶┌────────────┐
  │  (HR)    │             │ Contractors   │            │Dashboard   │
  └──────────┘             └───────────────┘            │.html       │
                                                        │(browser)   │
                                                        └────────────┘
```

**The critical property:** the export is **manual and periodic**. The dashboard is only ever as fresh
as the last export run. Nothing here is live.

---

## 3. Components

### 3.1 `Jira Backlog.js` — the exporter (v3.11.0)

Runs *inside a different GAS project* and writes the Jira-derived sheets.

| Writes | Shape | Best use |
|---|---|---|
| `Jira Raw` | one row per issue | the source for every Jira metric |
| `Jira Bugs` | one row per bug | bug counts, deliberately population-wide |
| `Jira Arrivals` | one row per ISO week | *"is the queue growing?"* — 52-week window |
| `Flow Snapshots` | one row appended per run | backlog/WIP history that cannot be recomputed later |

**Best use:** run it weekly, before looking at the dashboard. **Never** edit its output sheets by
hand — `Jira Raw`, `Jira Bugs` and `Jira Arrivals` are fully rewritten each run and your edits vanish;
`Flow Snapshots` is append-only and a hand-edit corrupts history permanently.

**Watch for:** it has **no automated tests**. Syntax is checked, behaviour is not. Every change to it
is verified by reading and by the next export's output.

### 3.2 `Code.js` — the server (schema v40)

Reads all nine sheets, joins them to the roster, computes every metric, caches the result.

**Best use:** treat it as the single source of metric definitions. `METRIC_REGISTRY_` (v4.0, 23
metrics) defines every number's name, formula, target, coverage gate, sample floor and known
deviations. If two people compute a metric differently, the registry is the tiebreaker.

It also carries the **workforce classification registries** — `DH_SUB_TRACK_` maps a job code's
`family.variant` to a backlog role and deployment pool, and is the one place to edit when a new job
code appears. Nothing else changes: the engine does not model the org chart, so a reorganisation
just re-points pools.

**Watch for:** results are cached (~65 min TTL) and a warmer rebuilds them every 30 minutes, so the
dashboard can lag the sheets. The **↻ Refresh** button bypasses cache. **Schema v40 must be
deployed with a `bustDeliveryCache_()`** — and every schema bump before it for its own reason: a
cached v39 model attributes every epic by the project lead and carries no opportunity counts, so the
🗓 PM tab is **wrong rather than merely empty**; a v38 model carries `pmOwned.items` instead of
`epics` and lists no epics at all; a v37 model has no `pmOwned`; a cached v29/v30 read as v31 gave
every person no pool, collapsing the population into one cell and silently reproducing the blended
figure the Workforce tab exists to retire.

### 3.3 `Dashboard.html` — the client

Five tabs, gated by role — the gate is enforced **inside `switchView_`**, not just by hiding a
button, so a forbidden id typed by hand still lands on Executive.

| Tab | Answers | Who sees it |
|---|---|---|
| 📊 **Executive** | *Are we on target, and where aren't we?* | everyone with access |
| 🎯 **Actions** | *Who and what needs action?* | admin + viewer |
| 🗓 **PM** | *Which epics are in flight, and is their own work scheduled past them?* | admin + viewer |
| 🧭 **Workforce** | *Which pool is out of room, and which has room to sell?* | admin + viewer |
| 🔒 **Access** | — | admin only |

🗓 PM sits beside 🎯 Actions on purpose: they answer the same question at different grains — *who*
needs action, and *which committed work* needs action.

**The Executive tab is the "newspaper"** — eight bands, most important first:

| # | Band | What it tells you | Best use |
|---|---|---|---|
| 1 | Masthead | one-sentence verdict, assembled from ranked findings | the line you quote in a meeting |
| 2 | Backlog band | total queue, net flow, weeks-to-clear + a three-segment ruler | the headline: how deep is the queue |
| 3 | Evidence gates | *"Can we publish these numbers?"* | check **before** quoting anything above |
| 4 | Flow band | Cleared · Arrived · Lead time · On-Time (+ Forecast, Quality when measurable) | are we keeping up |
| 5 | Capacity band | recoverable hours · utilisation · people signals | what you can throw at it |
| 6 | Comparison grid | metric × Region/Team/PM/Job-family, click a column for a bullet chart | where the problem is concentrated |
| 7 | Shelf | *"Not measured this period"* + why | so silence is never mistaken for success |
| 8 | Trust detail | collapsed reconciliation notes | when a number is challenged |

### 3.4 `Security.js`

Email allowlist — admin / viewer / open-access. **Best use:** add stakeholders here rather than
turning on open access.

### 3.5 `node-tests.js` and `render-smoke.js`

Local Node test runners. **Not** pasted into the GAS project.

- `node node-tests.js` — the server's pure functions, plus cross-layer parity suites that prove the
  client's copies of shared rules match the server's
- `node render-smoke.js` — **1,173 checks** rendering the client against synthetic models

**Best use:** run both before any deploy. They are the only mechanical safety net this app has.

---

## 4. The metrics, and how far to trust each

### Trust and quote freely

| Metric | Why it's solid |
|---|---|
| **Inventory** (total open items) | a count, no join, no estimate |
| **Arrived / Cleared / Net flow** | counts over dates, org-wide, no assignee join |
| **Lead time** | measured from real created/resolved dates |
| **Utilisation** | hours ÷ scheduled capacity, both measured |

### Quote with the stated caveat

| Metric | Caveat |
|---|---|
| **Weeks to clear** | inventory ÷ **median** of the last 8 weeks' clearing. Robust to one holiday week, but it assumes the future looks like the recent past |
| **On-Time delivery** | measured against the Jira **Due Date, which anyone can move after the fact**. A re-baselined milestone reads as on time |
| **Cleared per person** | normalises for team size — the honest comparison — but small groups still swing on one person, so any group under 10 people is shown ungraded |

### Do not quote yet

| Metric | Why |
|---|---|
| **Forecast accuracy** | rests on roughly **one** measurable epic. A mean over one thing is not a mean. It shelves itself |
| **Quality / rework** | there is **no capture path** for rework. Zero flagged items means nobody is recording it, not that nothing was reworked |
| **Region / Team breakdowns** | the Jira fields are still largely unpopulated; the dashboard substitutes person-region from tracked hours. Real numbers, but *"by region"* does not yet mean what the Metrics Dictionary says |

### 🗓 PM-owned work (added 2026-08-11)

**Shape:** one table, six defined columns — *Epic / ticket · Status · Due · Against epic date ·
Gaps · Assignee* — driven by a single `PM_COLS_` registry so a header can never drift from the cell
below it. Three row levels live in that one table: PM group rows span the full width, epic rows fill
the columns, children sit one indent in behind a `↳`. Nested tables were deliberately avoided — they
break the column lines, which is the thing that makes a table scannable.

PM ▸ epic ▸ children, each level collapsed until opened. The epic list is scoped to work in flight —
**in progress or due this month** (overdue included). An epic that is neither started nor dated is
counted in the bar and named in its 🚩 list, but not listed as work to do.

**Unstarted tickets with no due date are counted, never listed** — the managers' 2026-08-10 rule.
The count appears at the top of the tab and on each epic, so an exclusion never looks like an
absence.

**Children are graded against their epic's deadline**, not their own: *within* · *over by N weeks* ·
*no date of its own* (started but uncommitted — never silently counted as within) · *ungraded* (the
epic has no date to measure against). Sub-tasks reach their epic through the parent chain, because
most parent to a story rather than directly to an epic.

Two claims per PM, deliberately never combined into one score.

| Bar | How far to trust it |
|---|---|
| **Owns — epic due-date fill** | Quotable. A count over open epics with no join and no estimate, graded against a bar the team itself set at **100%** — "every epic carries a date, even if it is only the project end date". The only caveat is the attribution below |
| **In project — task readiness** | Context, not a verdict on the PM. It reuses `BACKLOG_SIGNALS_.ready` (dated **and** estimated **and** linked **and** fresh) and inherits every caveat that signal carries. These fields are filled by assignees, not by the PM |

**The attribution is the thing to check first.** An epic belongs to its **Jira assignee** — the
ticket states who owns it. Only when an epic has no assignee does it fall back to the **Tempo
project lead** (`GTT-605 → GTT → that project's PM`), which is an inference from who logs hours
where. Each PM row states how many of its epics came from each rule, so an attribution can be
challenged rather than taken on trust. Children follow their epic whoever they are assigned to.

Neither rule touches the roster, and that is what lets this tab exist at all: PMs are structurally
absent from this dashboard's population — family 15 is not a tracking family and a live assertion
*requires* `PMO` to be in `absentPools` — so a person-grained roster approach would have needed a
second roster.

**Names are normalised across the two sources.** Jira writes `"Lopez, Moises"`, Tempo writes
`"Moises Lopez"`; without `dhPmKey_` the same PM appears twice with their epics split between the
rows, and both halves read as half-done.

**An empty Jira assignee is the literal string `"⚠️ UNASSIGNED"`, never a blank** — the exporter
writes it. Anything reading the Assignee column must go through `dhAssigneeOf_`, or it invents a
person of that name: on the live feed 267 epics were briefly attributed to a PM called UNASSIGNED
instead of falling back to their project lead.

**Areas of opportunity** — undated epics · children past their epic's date · epics nothing rolls up
to · epics untouched 30+ days — are ranked biggest-first and **never summed**. Four different
conversations; one blended score would point at none of them.

**Read the `(No PM)` bucket before quoting any per-PM number.** A project with no hours in the Tempo
export has no PM, and everything in it lands there. A large bucket is a finding about Tempo project
coverage, not a rounding error.

**Nothing here rolls into a published delivery rate.** PMs are a separate population on their own
bar, by design.

### Numbers with no agreed target

**Weeks-to-clear, net flow and cleared-per-person deliberately have no target line.** Nobody has
signed a "≤4 weeks" bar, and an unratified target on a C-suite page reads as agreed the moment it
appears. They are graded against what the organisation *demonstrably does* (its operating band)
instead. Agreeing real targets is an open decision for the Services Director.

The five **Workforce Health** metrics below ship the same way, for the same reason: the pool
envelopes in `DH_POOLS_` are Workforce Planning's *proposal*, not ratified operating targets.

### 🧭 Workforce Health metrics (added 2026-08-10)

The one rule that governs this whole tab: **capacity is not fungible.** A single company-wide
availability percentage averages together people who cannot do each other's work. Everything here
is reported per **deployment pool × level band** — the set of people who could genuinely swap onto
the same backlog item, at a seniority that could actually absorb it.

| Metric | How far to trust it |
|---|---|
| **Sellable headroom** | Solid arithmetic — gross scheduled capacity minus planned hours, both measured per person per week. The *caveat is the word "gross"*: no absence is netted out (see below), so headroom is the ceiling on availability, not the expectation |
| **Cover by pool** | Quote with two caveats. Remaining is derived as `original estimate − time spent` (Jira's own remaining estimate is not exported), so an overrun epic reads 0. And it is grossed up by estimate coverage — quote the **adjusted** figure, and call the raw one a lower bound |
| **Work outside the plan** | Trust the *split*, treat the *total* as directional. This is **delivered work with a paper-trail gap**, not missing work. The three reasons have three different owners and are never summed on screen. `not-committed` is an **upper bound** — project-level plans name no issue, so some genuinely-planned work lands there |
| **Plan vs logged** | Trust it where it is a number, and read it as a reconciliation signal rather than a delivery verdict: plans are coarser than worklogs, logging lags, and the window can include planned future weeks. `n/a` means every tracked hour in that cell was unclassifiable — **not** that nothing was delivered |
| **Constraint index** | **Relative only.** Every pool can be under-covered and one will still read near 1.00. It says who is tightest, never whether the portfolio is healthy. Read it beside Cover, never instead of it |

### What this tab deliberately does *not* measure

| Not measured | Why, and what it renders as |
|---|---|
| **Capacity truth** (deployable ÷ gross) | There is no absence feed — only Tempo-tracked time off, which measures what people *logged*, not when they were away. Using it would make the best-tracking teams look least available. Renders **null**, never a forced 100% |
| **Generic / placeholder allocations** | The Planned export resolves every plan to a named user before writing a row, so a pool running on unstaffed placeholders is invisible. Reported as not-measured, never as "none" |
| **A blended company availability figure** | Refused *by design*, not omitted by accident. If asked for one, quote the consumers-only number and say what its denominator is |

### These are signals, not verdicts

Nothing on this tab is painted red and no row tells anyone what to do. The state chip says **where
a cell sits** — `STEADY` · `HEADROOM` · `AT CAPACITY` · `REVIEW` · `RECONCILE` · `DEMAND-DRIVEN` —
and the sentence beside it states what was measured against what denominator. The source spec's
vocabulary (INTERVENE / SELL / HIRE) was deliberately not adopted: those are instructions, three of
them are alarms, and on a business delivering week over week with a healthy backlog they misread
ordinary measurement gaps as problems. Red is reserved for the Executive cards, which have ratified
targets to fail against; spending it here would devalue it there.

### Pools, and what they mean

| Pool | Who | Cover |
|---|---|---|
| `PS-CONSULT` | Consulting (sub-tracks `07.2`, `09.1`) | measured — draws on project backlog |
| `PS-ENGINEER` | Service delivery engineering (`09.3`) | measured — draws on project backlog |
| `MS-SUPPORT` | Managed services & support (`07.1`) | **n/a** — contracted and recurring, never drawn from project backlog |
| `CREW` | Contractors, engaged on demand | **n/a** — capacity is scaled *to* the work, not held against it |
| `NONE` | Governing and enabling roles, incl. delivery managers | n/a — hold no delivery pool |

`ARCH`, `PMO` and `TRAINING` exist in the model but **cannot appear in this dashboard**: their job
families carry no time-tracking mandate and are outside the population entirely. The scope banner
names them so the pool list is never mistaken for the whole company's structure.

### Bands are buckets over the job ladder, not the ladder itself

`JUNIOR` / `CORE` / `SENIOR` / `MGMT` are **this model's labels**, not company vocabulary. The job
architecture's own names are the level tokens in the job code:

| Band | Levels | Meaning |
|---|---|---|
| `JUNIOR` | **I1–I2** | early career |
| `CORE` | **I3–I4** | the bulk of delivery |
| `SENIOR` | **I5 and above** | senior individual contributors |
| `MGMT` | **M track**, any level | management |
| `UNKNOWN` | no level token | common for crew, who are hired against a contract rather than a level |

The grid prints the level range beside every band label for exactly this reason — without it a
reader has to guess where their own I4 sits, and two people read "CORE" differently. The band
exists in the grain because **an I3 cannot absorb an I5's epic**; it is a capability boundary, not
a status label.

### The three counts that must be read even at zero

`UNCLASSIFIED` (a job code exists that no rule covers), **title mismatches** (the job code and the
title text disagree about the pool), and `UNROUTED` (backlog no pool can absorb). All three render
at zero on purpose — a field that only appears when it is broken gets ignored when it breaks. A
rising unclassified count is a real governance signal: new job codes exist and Workforce Planning
has not been told.

---

## 5. The single most important thing this rebuild changed

The exporter used to filter open issues with `assignee is not EMPTY`. Measured on 2026-08-06:

|  | Items |
|---|---|
| Open **assigned** — all the dashboard could see | **1,440** |
| Open **unassigned** — invisible | **1,839** |
| **True open queue** | **3,279** — 56% unowned |

Weeks-to-clear read **4.9 weeks** — essentially at target. The true figure is **11.0 weeks**. The
dashboard was describing a five-week queue as if that were the whole thing, and the largest single
block of work was the part nobody had picked up.

**That is now visible, and the unowned segment on the queue ruler is clickable.**

---

## 6. Operating notes

**Deploy order is fixed and not negotiable:**

1. `Jira Backlog.js` → save
2. **Run the export**
3. **Verify `Jira Arrivals` holds ~52 rows** — do this *before* step 4
4. `Code.js` + `Dashboard.html` → paste into the GAS project
5. Run `bustDeliveryCache_()`
6. New deployment version
7. Spot-check (below)

**Why step 3 matters:** if that tab is short, the clearing-rate median refuses to publish and the
entire headline — weeks-to-clear, the ruler, both verdict findings, the history — silently disappears,
leaving a masthead that says nothing is wrong. It fails quietly, not loudly.

**Spot-check has two halves. A number in the wrong half is a stop.**

*Must **not** move:* the four KPI cards · the signals roster · Roster join (100%, retired) · the
per-person backlog drill-down.

*Must move:* the queue hero (≈3,279 / ~11w vs ≈1,440 / ~4.9w assigned) · the 🧬 matrix's **open half**
fill rates (down) · Backlog health's unassigned count (up to ~1,839) · the unowned ruler segment
becomes clickable.

**The gaps queue will NOT move** — it computes over resolved work only. Expecting it to move would
make you fail a correct deploy.

### Cold-start load time (2026-08-10)

A **warm** load returns in about a second. A **cold** one rebuilds the whole model server-side and
has been reported at **4+ minutes**. Four changes ship for it:

1. **Honest, staged progress.** The old panel claimed "a minute or two", which is why people
   started refreshing at three. It now shows a live elapsed clock, changes its wording as the wait
   passes 45s / 2.5m / 5.5m, and leads with the one instruction that matters: **do not refresh** —
   refreshing abandons the in-flight rebuild and starts another, which is the single action that
   makes the wait longer.
2. **A rebuild lock** (`LockService` in `getDeliveryData`). Without it, five people opening the page
   during a cold window started five concurrent full rebuilds of the same sheets, each slower than
   one pass would have been. Now the first caller builds and the rest queue, then read the cache
   the winner just wrote and return in milliseconds. `forceRefresh` (↻) still bypasses.
3. **A hot-path fix.** `eachTempoRow_` tested window membership with `allWeeks.indexOf(iso)` — a
   56-element linear scan inside the innermost loop, over both issue-grained Tempo grids. Now an
   object lookup. Same answer, same order.
4. **Timing instrumentation.** Nothing recorded where the four minutes went, so every conversation
   about it was guesswork. `buildDeliveryModel_` now times each reader, logs a sorted breakdown with
   row counts, and ships it as `meta.buildMs`.

**⚠ The size of the win is not yet measured.** Items 2–4 are sound but unquantified until a real
run happens — this code has never executed against live sheets. **Run `warmDeliveryCache()` from
the GAS editor after deploying and read the `⏱ buildDeliveryModel_` log line.** That single line
says which reader dominates and how many rows it is reading, and it is what any further work should
be aimed at. The expectation is that the two Tempo grids and Jira Raw dominate, because all three
are `getDataRange().getValues()` over issue-grained sheets spanning 52 weeks — but believe the
breakdown over that expectation.

If the warmer itself is taking more than ~5 minutes it is at risk of the GAS 6-minute execution
limit, in which case it never completes, the cache is never populated, and **every** user load is a
cold one. The log line will show that too.

### Deploying Workforce Health (2026-08-10, schema v31)

**No exporter change. No export re-run.** Both files, then bust the cache:

1. `Code.js` + `Dashboard.html` → paste into the GAS project
2. Run `bustDeliveryCache_()` — **required**, schema 29 → 31
3. New deployment version

*Must move, and downward:* every per-pool capacity figure, because two definition changes ship
together — support is no longer blended with consulting, and delivery managers have left the pool
denominators (they govern backlog rather than consume it). **This is the intended outcome**, dated
in the registry changelog at 4.0, and every affected trend line carries the `✎ definition changed`
marker at 2026-08-10.

*Must not move:* the four KPI cards, the signals roster, the queue hero. Workforce Health is an
additional read of the same underlying hours, not a redefinition of the existing metrics.

**Read the pool grid's own footnote before showing this to anyone.** The source spec asks for a
dual-publish phase before cut-over precisely because the new numbers look worse; that phase was
skipped by direction, and the footnote is the mitigation — it explains on screen why the figures
dropped, so the answer is on the page rather than in the meeting.

---

## 7. Honest status

**What is proven:** 865 rendering checks and a full server suite pass; the boundary rules that decide
how dates and week labels cross between systems are enforced and tested across four timezones; the
live Jira counts were measured directly.

**What is not proven:** **no export has been run with this code, and the dashboard has never rendered
against real new data.** The exporter has no automated tests at all. The first run is the first real
test.

**Expect the exported numbers to differ slightly from the 1,839 / 1,440 above** — those came from
direct queries, which cannot reproduce the exporter's project-scoping rules. The proportions should
hold; the exact figures will not.

---

## 8. Best use, in one line each

- **Weekly:** run the export, open the Executive tab, read the masthead sentence, check the evidence
  gates before quoting anything.
- **In a review:** use the comparison grid to find where a problem concentrates, then the Actions tab
  to find who can act on it.
- **When challenged:** open the trust detail and the shelf — they exist to show what is *not* measured.
- **Never:** quote forecast accuracy or rework rate; treat "by region" as authoritative; hand-edit an
  export sheet; or read the dashboard without running the export first.
