# Workforce Health — Pool × Band Capacity — Design

**Date:** written 2026-08-10 (2026.W33) ·
**App:** Delivery Health Dashboard (`delivery-health-dashboard/`) ·
**Status:** **CODE COMPLETE, UNCOMMITTED, NOT DEPLOYED.** Schema 29 → 31, registry 3.3 → 4.0.

**Business source of truth for this spec:** *Workforce Health — Implementation Spec v1.1*
(Workforce Planning, 2026.W32), derived from the 215-row job catalogue (73 distinct job codes).
Where this page and that spec disagree, that spec wins and this page is wrong. Where **it**
disagrees with a governing document (the Metrics Dictionary, the Runbook), the governing document
wins and it is wrong.

---

## Why

**Capacity is not fungible.** A single company-wide availability percentage cannot be read as
health, because it averages together people who cannot do each other's work.

This dashboard had exactly that disease. Its population is the tracking-mandate allowlist —
JF007 *Managed Services & Support* plus JF009 *Service Delivery* plus blank/crew — and every
capacity figure it published (utilisation, planned coverage, weeks-to-clear, recoverable hours)
was computed across all of them as **one number**.

Managed Services capacity is contracted and recurring. It is never drawn from the project backlog.
Blending it with consulting capacity does two things, both bad:

1. It makes the organisation read as substantially **more available** than it is.
2. It **mathematically guarantees** you cannot see the pool that is actually out of room — the
   pool that is drowning is averaged against the pool that is fine, and the mean looks acceptable.

The fix is a reporting grain: **pool × band**. Not person, not department, not company.

### The three quantities

Every pool has three numbers that should broadly agree. **The health signal lives in the
disagreement.**

| Quantity | Meaning | Source here |
|---|---|---|
| **CAPACITY** | what we pay for | `Capacity Tempo` — scheduled hours per person per week |
| **COMMITMENT** | what we promised | `Planned Time Tempo` — planned hours per person per week |
| **CONSUMPTION** | what actually happened | `Tempo Tracked Time` — logged hours per person per week |

```
CAPACITY   − COMMITMENT  = Sellable headroom  → true availability, actionable by Sales
COMMITMENT − CONSUMPTION = Execution gap      → allocated but not delivered; corrupts the forecast
CONSUMPTION with no epic = Outside the plan   → delivered work, not yet traceable
```

A dashboard that shows only capacity can report a healthy number while the plan is fiction and
half the real work is invisible.

---

## What made this buildable without an exporter change

The v1.0 draft of the source spec keyed classification on a **discipline string** (the text after
the comma in a job title). That field does not exist anywhere in this pipeline, and the initial
assessment recorded it as a hard blocker.

**v1.1 re-keyed on `family.variant`** — the first and fourth tokens of the job code — and that
changed the answer completely. The code is already in the `Job Title` column this dashboard reads,
and the four-token `FF.Tn.v` form is the canonical HRIS convention repo-wide (CompDash's
`parseLevel_` has pinned it since it was written; `04.I3.9` proves the variant digit is not
always `1`).

Two further things turned out to be already exported and simply never read:

| Column | Sheet | Status before |
|---|---|---|
| `Issue`, `Epic Key`, `Parent Key` | Tempo Tracked Time | exported since the sheet existed; `readTempoSheet_` took only User/Team/Key/PM |
| `Epic Key`, `Parent Key` (values) | Jira Raw | read, then immediately collapsed into the `linked` **boolean** — the keys themselves discarded |

Reading them is what makes the shadow split and historical pool-routing possible. **No exporter
change was required for any part of this.** Same shape as the 2026-08-07 SRSO Components
discovery.

---

## Model

### Classification — key on the code, never on the title text

```
09.I4.3  -  Senior Engineer I,  Service Delivery
│  │ │ │     └── stem ──────┘   └── label ────┘
│  │ │ └── VARIANT   sub-track inside the family   ← THE KEY
│  │ └──── LEVEL     seniority                     ← level band
│  └────── TRACK     I = individual, M = management ← the mgmt override
└───────── FAMILY    job family                     ← scopes everything
```

The discipline string cannot be the key, for three reasons measured on the live catalogue:

1. **It splits.** `09|Service Delivery` is 36 people — 21 are `.3` engineers and 15 are `.1`
   consultants. One string, two pools that are not interchangeable on a backlog item.
2. **It collides.** `Delivery` appears in family 07 (delivery consultants, a CONSUMER) and family
   15 (SVP Delivery, a GOVERNOR). Same word, opposite meaning.
3. **It fragments.** Family 07 uses three strings — `Customer Support` (64), `Support` (2),
   `Managed Services` (1) — for what variant `.1` captures as one sub-track.

And it is free text: a rename in the HRIS silently breaks the join. The variant digit does not move
when someone retitles a discipline.

> The v1.0 discipline-keyed model would have put all 36 of `09|Service Delivery` into
> `PS-ENGINEER`, overstating that pool by roughly a fifth and moving its cover and headroom
> materially. `dhStemWarning` (below) is the cross-check that catches that class of error.

**Parser tolerance is deliberate.** The separator is optional, the track letter is
case-insensitive, and trailing parentheticals are stripped — because a strict regex silently drops
real rows, and a dropped row surfaces as an UNCLASSIFIED person, which reads as a governance
failure rather than the parser bug it is. Fixtures in this very repo carry
`03.I2.1 Data Analyst` (no dash) and `07.m4.1` (lowercase).

### Registries — `Code.js`

| Constant | What it decides |
|---|---|
| `DH_SUB_TRACK_` | `family.variant` → backlog role, pool, display label. Six rows cover every delivery sub-track. |
| `DH_BY_DISCIPLINE_` | fallback for families where the variant digit is not a boundary (15, 04). Every pool there is `NONE`, so the lost precision costs nothing. |
| `DH_ENABLER_FAMILIES_` | families with no relationship to delivery backlog, whatever the discipline says. |
| `DH_MGMT_GOVERNS_` | families where an M-track person governs rather than consumes. |
| `DH_STEM_EXPECT_` | pool → expected stem shape. **Validates only, never reclassifies.** |
| `DH_POOLS_` | per-pool cover/headroom envelope. |
| `DH_WFH_CONFIG_` | signal thresholds. |

### Bands

`JUNIOR` (I1–I2) · `CORE` (I3–I4) · `SENIOR` (I5+) · `MGMT` (M-track) · `UNKNOWN` (no level token).
An I3 cannot absorb an I5's epic, so the band is part of the grain rather than a decoration — it is
a **capability boundary**, not a status label.

**These names are this model's, not the company's ladder.** The job architecture's own vocabulary is
the level token itself (I1…I5+, M). The grid therefore prints the level range beside every band
label; without it a reader has to guess where their own I4 lands, and two people read "CORE"
differently. `render-smoke.js` pins the range's presence.

### CREW — added after the first live render (2026-08-10)

The first render reported **30 UNCLASSIFIED people**. They are crew: contractors, engaged on demand.
They hold no job-architecture code, so the parser failed on every one of them — correctly. The
registry simply had no home for them, and the result was a governance alarm raised over an ordinary,
known population.

`dhClassify_` now takes `isCrew` (from the roster's Contractors tab) and checks it **first**: a crew
member's commercial model is what makes their capacity non-interchangeable with an FTE consultant's,
and that is true whatever their title happens to say. A crew title that *does* carry a level token
still uses it for the band; otherwise the band is `UNKNOWN`, which is honest rather than guessed.

`CREW` is **demand-driven** (`consumes: false`, `coverTarget: 0`), and that is the load-bearing
choice. It is *not* a claim that crew do no project work — they plainly do. Cover asks "how many
weeks of backlog does this pool hold at its own weekly capacity", and that presumes a **fixed**
capacity the backlog is measured against. On-demand capacity is the opposite: it is scaled *to* the
backlog. Publishing cover for it would invite the reading that crew are "running out of work" when
the correct reading is that nobody has booked them this week. Their headroom is not sellable
headroom either — unbooked crew is not paid idle capacity.

### The fidelity denominator — the 1% artefact (2026-08-10)

The first render showed **PS-ENGINEER at 1% plan-vs-logged**. That is not a delivery signal; it is
the shape of that pool's planning. Fidelity divided by **all** planned hours, but a PROJECT-level
plan names no issue and therefore can never be matched to an epic no matter how well the work went.
Fidelity was structurally capped at the pool's plan-issue coverage, so a pool that plans at project
level reported as one that delivers nothing.

Fidelity now divides by `matchableCommittedHrs` — the planned hours that name an issue — recorded
per cell per week so it folds with the period picker like everything else. `planMatchable` ships
beside it so the resulting `n/a` is explainable rather than mysterious. Headroom is unchanged and
still counts **every** planned hour, because all of them consume capacity.

This also unmasked a real finding. RECONCILE (a measurement gap) was firing on PS-ENGINEER and
hiding the capacity read underneath it — thin cover against almost no headroom. With the artefact
gone, the state chip shows the capacity position instead of the measurement problem.

---

## Decisions taken, with their trade-offs

These four were put to the user on 2026-08-10 and answered explicitly. Each is a real deviation
from either the source spec or a prior ratified decision, so each is recorded here rather than
being left to be rediscovered in the code.

### 1 · Population stays narrow — the dashboard's own, not the catalogue's

**Decision: classify within DH's existing population.** The pool grid describes Class
*Professional Services* + Department *Services* + the tracking-mandate allowlist. `ARCH`, `PMO` and
`TRAINING` therefore **cannot appear**, because their job families carry no time-tracking mandate
and were excluded entirely by the 2026-07-31 / 2026-08-02 decisions.

The alternative — widening to the full 215-row catalogue — would have matched the source spec
exactly and attacked the population trap head-on, but it reverses two ratified decisions and puts
people with no tracking obligation into capacity denominators.

**Consequence, and how it is handled:** the scope banner *names the absent pools* rather than
letting the pool list read as the whole company's structure. Without that line, "PS-CONSULT,
PS-ENGINEER, MS-SUPPORT" looks like an exhaustive account of the org's deployment pools, which it
is not.

### 2 · PTO is not subtracted; capacity truth is not measured

**Decision: keep DH's current handling.** §5.1 of the source spec nets PTO and protected time out
of capacity to produce a `capacityTruth` ratio. This dashboard cannot, and the reason is not
laziness:

- There is **no absence feed**. Not in planned time, tracked time, PTO, medical or parental leave.
  (The 2026-08-04 decision that established this is unchanged.)
- The only available proxy is Tempo-tracked NETSUITE time-off, which measures **what people
  logged**, not when they were away. Subtracting it would make the teams with the *best*
  time-tracking discipline look *least* available — inverting the signal exactly where it matters.

So capacity is gross scheduled hours, and `capacityTruth` renders **null / not measured** — never
a forced `1.0`, which would assert that no paid capacity is lost before work starts, a claim
nobody has measured. `ptoHrs` is carried alongside for the drill-down, so the hours stay visible
without entering a denominator.

**Bench is also not subtracted**, but that one is structural rather than a data gap: bench is the
*result* of capacity minus commitment. Subtracting it would make headroom read ≈0 always, which is
the exact failure this model exists to avoid.

### 3 · `MGMT_GOVERNS` adopted — managers leave the pool denominators

**Decision: adopt, with a schema bump and trend markers.** M-track people in families 07/09/18
become `GOVERNOR`, pool `NONE`, and leave every pool denominator. Before this, a delivery manager's
scheduled hours sat in the pool denominator and read as consultant capacity Sales could
theoretically sell.

**This moves every published capacity rate on deploy.** It ships with `DH_SCHEMA_VER_` 29 → 30, a
registry `4.0` changelog entry, and `affects` populated so every affected trend line carries the
`✎ definition changed` marker at 2026-08-10 — the same treatment prior definition changes got. The
step people see in W33 is the definition moving, not delivery moving.

### 4 · Straight cut-over — §9's phase 2 skipped, deliberately

**Decision: ship everything, cut over immediately.** The source spec's §9 asks for a *dual-publish*
phase before cut-over, on the explicit grounds that *"the new numbers will look worse than the old
ones — that is the point, and it needs explaining before it needs defending."* It says **do not
skip phase 2**.

The user directed a straight cut-over with that trade stated. **The concern was raised once and
the direction reaffirmed**, so it was built as asked.

**Mitigation, since the phase is skipped:** the dual *read* ships without the dual *phase*. The
pool grid carries its own footnote explaining what changed and why the numbers dropped — both the
pool separation and the manager change — so the "why did this drop" answer is on the page rather
than in a meeting. That is the cheapest available substitute for phase 2; it is not equivalent to
it, and if leadership pushes back the honest response is to point at the footnote and the changelog
entry, not to re-litigate the arithmetic.

---

## The shadow split, and what it can honestly claim

A worklog counts as **committed consumption** only if it rolls up to an epic that is bound to a
sales order **and** that the person's **pool** was actually planned onto. Everything else is shadow.

| Reason | Meaning | Owner |
|---|---|---|
| `no-epic` | worklog on an issue with no epic parent | Project Manager |
| `no-srso` | epic exists but carries no `SRSO-xxxxx` component | Project Manager + Finance |
| `not-committed` | real committed work, but nobody planned this pool onto it | Resource Manager |

Three reasons, three owners, three fixes — which is why they are **never summed into one number**
on any surface. Reported as a single "shadow work" figure, the whole thing gets routed to one desk
where two thirds of it cannot be acted on. Same reasoning as the assignee/roster split.

### Measurability is separated from the verdict

If the export has no `Epic Key` column, or Jira Raw has no `Components` column, those hours land in
`unmeasuredHrs` — **not** in shadow, and they are excluded from the shadow denominator.
Collapsing "we did not look" into "there is no epic" would report a ~100% shadow ratio on an older
export and send the entire delivery org chasing a reporting artefact. This is the single named trap
in the source spec, and the same tristate discipline `srsoComponent` and `reopened` already use.

The same rule governs **fidelity**: if a cell logged hours but every one of them was
unclassifiable, `commitmentFidelity` is **null**, not 0. A raw 0% would flag a plan-vs-logged gap at a team
that may have delivered everything — it was the measurement that was missing, not the work. A cell
that logged *nothing at all* against a real plan is different: that zero **is** a measurement, and
it stands.

### What `not-committed` cannot claim

The Planned Time export carries an `Issue` only for **issue-level** plans. A project-level plan
names no issue by nature, so it resolves to no epic. The committed set is therefore a **lower
bound**, and `planIssueCoverage` reports how much of the planned volume could be resolved at all.
The shadow panel states this: `not-committed` is an **upper bound**, because some of it was planned
in a way this pipeline cannot see.

---

## `requiredPool` and UNROUTED

Backlog must be attributed to the pool that can actually absorb it, or cover is meaningless.
Resolution order, first hit wins:

1. Explicit `requiredPool` custom field — **does not exist in Jira**; upstream ask.
2. `allocationType` mapped through a lookup — **not in the export**; `DH_ALLOCATION_TO_POOL_` is
   deliberately empty rather than coded against a field that does not exist.
3. **Historical** — the pool that logged the most hours to this epic. *This is the first step that
   can actually fire in this deployment.*
4. Project-level default from a project → pool map.
5. `UNROUTED`.

**UNROUTED is never silently distributed.** It gets its own row, tinted, because spreading it would
worsen every pool's cover by an amount nobody chose and hide the routing gap entirely. It is the
direct analogue of the Delivery Manager coverage gap: not noise, but work nobody can plan.

### Backlog remaining is a proxy, twice over

The export carries `Original Estimate (sec)` and `Time Spent (sec)` but **not** Jira's remaining
estimate, so remaining is derived as `max(0, original − spent)`. An epic that overran reads 0
remaining while real work is left. On top of that, at ~78% estimate coverage the raw figure
understates the real obligation by roughly a fifth — so both the raw and the grossed-up figures
ship, and the raw one is labelled a lower bound rather than quietly replaced.

---

## Rendering — the rules that are not negotiable

Panel order is load-bearing: the first thing on screen sets what the room argues about.

1. **Scope banner** — population, consumers, unclassified, title mismatches, drift, absent pools
2. **Pool grid** — one row per pool × band, plus a Read sentence per row
3. **Consumers-only summary** — the honest backlog-cover denominator
4. **Shadow breakdown** — by reason, with owners
5. **Unrouted backlog** — by required pool
6. **Discipline section** — how humans navigate the same cells

And the four rules:

- **Never render a single blended availability number.** If leadership asks for one, give the
  consumers-only figure and label it. The panel refuses a company-wide equivalent *explicitly*
  rather than just omitting it.
- **`null` cover renders `n/a`, never `0`.** A zero implies "no work left" for a pool that has no
  backlog by design — the most dangerous false read on this surface.
- **Show the denominator on every panel.** `32% available (of 63 consumers)` is a fact.
  `32% available` is a rumour.
- **Surface unclassified and unrouted counts even when zero.** A field that only appears when it is
  broken gets ignored when it breaks.

### State chips — signals, not verdicts

**Decision 5 (user, 2026-08-10, after seeing the first render).** The source spec's states are
INTERVENE / SELL / HIRE / REASSESS / EXECUTE. Those are **instructions**, and three of them are
alarms. The first live render put

> **INTERVENE** · *Execution gap: 1399h committed but not delivered. Allocations are ahead of
> reality — find the blocker before adding work.*

on a pool inside a business that is delivering week over week and carrying a healthy backlog. That
sentence asserts a **cause** the data cannot support. A plan-versus-logged gap has several ordinary
explanations before it has an alarming one:

- plans are coarse-grained and worklogs are not, so they never tie exactly;
- logging lags the work by days, so a period boundary splits them;
- the window can include planned weeks that have not happened yet;
- only issue-level plans resolve to an epic at all, so the committed set is a lower bound by
  construction.

A surface that raises a false alarm on a good week is ignored on a bad one. So the whole verdict
layer was neutralised:

| Was | Now | Why |
|---|---|---|
| `INTERVENE` | `RECONCILE` | two numbers disagree; check them, do not assume a failure |
| `SELL` | `HEADROOM` | states that room exists; selling it is a human's call |
| `HIRE / REALLOCATE` | `AT CAPACITY` | states the position, prescribes nothing |
| `REASSESS` | `REVIEW` | worth a look, not an alarm |
| `EXECUTE` | `STEADY` | inside its own range |
| `KEY-PERSON` | `SMALL CELL` | a statement about **sample size**, not a risk grade |

The Read sentences were rewritten the same way — each states **what was measured, against what
denominator**, and where the number is easy to misread, what it does *not* mean. The
plan-versus-logged line now reads *"1,399h planned, 700h logged against planned epics (50%). Plans
and worklogs are different grains and rarely tie exactly — read this as a reconciliation signal,
not as work that did not happen."* Hours outside the plan are framed as **delivered work with a
paper-trail gap**, which is what they are.

**No red anywhere on this tab.** Every out-of-range value paints amber, labelled *"worth a look"*.
Red is the vocabulary of failure and none of these measures can establish one alone; the Executive
cards keep it, because they have ratified targets to fail against.

`render-smoke.js` pins the absence of the alarm words and of any `.vr` class on the tab, because
this regression is invisible on review: a confident sentence that asserts an unsupported cause
reads exactly like a good one.

A **null signal never fires a state.** The source spec's own `safeDiv` returns 0 on a zero
denominator, which would put `RECONCILE` on every pool that simply has no plan. `dhSafeDiv_`
returns `null` and the chain skips it.

---

## Client/server twins

`dhFoldWeekly_` / `reconcileWorkforce_` / `dhActionState_` / `dhWorkforceRead_` exist twice: the
server builds the payload, the client re-slices it when the period picker or a filter moves.

The payload therefore ships **per-cell-per-week** hour buckets (`workforce.weekly`) rather than one
period total, so the view follows the period picker without a round-trip — the same reason the
utilization grid ships all weeks. Head counts are **not** weekly: a person is one head across a
period, not one per week.

`_test_workforceParity_` walks both copies over seven window shapes and compares every derived
field, plus the two that must never differ — the **action state** and the **Read**. A divergence
there means the grid shows HEADROOM while the payload says RECONCILE, and nobody can tell
which is the real answer. It also asserts the two copies of `WF_POOLS_` / `WF_CONFIG_` /
`WF_SHADOW_OWNER_` are byte-identical to the server's.

---

## Test coverage

| Suite | What it pins |
|---|---|
| `_test_classification_` | parser tolerance (every real title shape in this company's data), the v1.0 correction (`09.1` vs `09.3`), bands, `MGMT_GOVERNS`, enablers, unclassified-with-a-reason, stem warnings |
| `_test_workforceHealth_` | all six passes, epic-chain walking incl. a cycle, the three shadow reasons, unmeasured ≠ shadow, per-pool commitment, UNROUTED, estimate grossing-up, action-state matrix, null-is-not-breached, scope facts, drift alarm |
| `_test_workforceParity_` | client/server fold + reconcile over seven windows; config-table equality |
| render-smoke | six panels, §6.3 rules, stale-payload miss, role gate, drift, unclassified detail |

`_test_workforceHealth_` also carries the §8 validation invariants inline: pool totals equal
headcount, deployable ≤ gross, tracked splits exactly, demand-driven cover is null, no NaN reaches
render.

---

## Deploy

**Order matters. Both files, then bust the cache.**

1. Paste `Code.js` into the GAS project.
2. Paste `Dashboard.html`.
3. Run `bustDeliveryCache_()` — **required**. Schema 29 → 30.

⚠ **The cache bump is not optional here, and the failure mode is not a blank panel.** A cached v29
model read as v30 gives every person `pool: undefined`, collapsing the entire population into one
cell and reproducing the exact blended figure this release retires — a wrong number wearing a right
number's clothes. `getDeliveryData` treats a differing `schemaVer` as a clean miss, which is what
makes step 3 sufficient; running it is what makes it happen immediately for everyone rather than at
TTL expiry.

No exporter change. No re-run of any export.

**After deploy, expect the capacity numbers to drop.** That is the intended outcome of two
definition changes shipping together, it is dated in the registry changelog at 4.0, and the pool
grid explains it on screen.

---

## Open items

| Item | Owner | Notes |
|---|---|---|
| `requiredPool` custom field in Jira | Delivery leadership | would replace historical routing with a declared one; step 1 of §4.6 |
| Generic (unnamed placeholder) plan allocations | Tempo admin + exporter | the Planned export resolves every plan to a named user, so a pool running on unstaffed placeholders is currently **invisible**; reported as not-measured, never as "none" |
| A real absence feed | Workforce Planning / HR | unblocks `capacityTruth`; until then it is null by design |
| Pool envelopes in `DH_POOLS_` | Services Director | Workforce Planning's **proposal**, not ratified operating targets — every metric ships `target: null` for exactly this reason |
| Ratify or reject the phase-2 skip | Services Director | §9 said not to skip it; we did, with the footnote as mitigation |
