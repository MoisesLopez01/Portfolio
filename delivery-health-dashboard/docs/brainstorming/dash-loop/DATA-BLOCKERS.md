# Delivery Health Dashboard — data blockers

**For:** Services Director · **Prepared:** 2026-08-03 (2026.W32) · **Owner of this note:** Alex López

The four metrics are built and match the Metrics Dictionary formula for formula. Three of them
cannot yet publish a number anyone should quote — **not because the dashboard is wrong, but because
the data underneath it isn't there yet.** This is the list of what's missing, who can fix each one,
and what it unblocks.

The dashboard does not hide this. Every card carries its coverage and goes to a flagged
"directional only" state when it falls below its gate, so a weak number is never presented as a
strong one. **Nothing below is a reason to delay the review — it is the agenda for it.**

---

## Evidence base

**Updated 2026-08-04:** profiled live in-product (🧪 Data Hygiene → 🔬 Data Profile) over
**FY26 Q4 — 402 resolved epics, 2,198 person-weeks**. This supersedes the 2026-08-03 stale
sample (218 issues, ~350 days old); several numbers below changed materially, one blocker
was downgraded, and one was fixed in code. The *structural* findings (fields and issue types
that do not exist) are unchanged.

---

## Blockers, worst first

### 1 · ~~Epics do not carry due dates~~ → **DOWNGRADED 2026-08-04: 3 points from gate**
**Live FY26 Q4: 308 of 402 epics (77%) have a due date. Gate is 80%.**

The stale sample said 11% and "cannot publish" — the live number is **77%**, three points under
the gate. Due-date discipline on epics is far better than previously reported; this is now a
close-the-gap ask, not a blocker. Combined with the attribution fix below, On-Time evaluates on
**n=164** measurable epics this quarter, not n=2.

- **Decision, ratified 2026-08-03 (unchanged):** we measure the Dictionary definition
  (epics / milestones / client commitments) and let the card state its own coverage.
- **Owner:** Delivery leadership (close the last 3 points) · **Prereq:** PR-08
- **Also still needed:** PR-02, a *baselined* committed date. Today we measure the mutable Jira
  Due Date, so a re-baselined milestone silently scores as on time.
- **Unblocks:** On-Time Delivery at full confidence.

### 2 · Closed epics have no estimates → **Forecast Accuracy is the biggest upstream gap**
**Live FY26 Q4: 91 of 402 closed epics carry an estimate (23%); 49 have both an estimate and
logged time (12%). Gate is 70%.**

The live number confirms the stale sample's direction: estimation at kickoff is the one habit
that hasn't formed. The estimates that do exist skew toward placeholder values (10h defaults in
the sample), so even the measured 12% overstates real forecasting.

- **Owner:** Delivery leadership (estimate at kickoff) · **Prereq:** PR-03 (baselined estimate)
- **Unblocks:** Forecast Accuracy.

### 3 · The Region field is empty → **no Region comparison exists**
**Measured: 0 of 218 (0%) carry a Region. Team: 32%.**

Every metric in the Dictionary is defined as rolling up by two Jira custom fields, Region and Team.
Neither is populated. The dashboard currently substitutes **person-region derived from where their
tracked hours were logged, falling back to roster location** — labelled `◦` in the UI wherever the
fallback was used.

That substitution is honest and disclosed, but it means **"On-Time · APAC" today means *issues
assigned to people located in APAC*, not *issues tagged Region = APAC***.

- **Owner:** Gon · **Prereq:** PR-01 · this is the Dictionary's own stated prerequisite
- **Unblocks:** the Region × Team comparison — the executive layer's whole premise.

### 4 · Rework signals are not exported → **Quality/Rework is a floor, not a measurement**
The export in use is **v3.5.0 (33 columns)**. The three columns this metric needs — Status Category,
Rework Link, Reopened — were added in **v3.6.0 and have not been deployed**.

Even after deploying, reopen detection stays off: it needs `expand=changelog` on the Jira fetch,
which is expensive on an export that already retries on oversized responses. Until it is on, the
rework rate can only *undercount*, so the card shows no red/amber/green at all and reads
*"at least N% — lower bound, not a measurement"*.

- **Owner:** Delivery + CX · **Prereq:** PR-09 (and a decision on the changelog fetch cost)
- **Also missing:** CSAT. The Dictionary pairs this rate with a CSAT score; the survey API is not
  connected, and the card says so rather than omitting it.
- **Unblocks:** Quality / Rework, plus the CSAT companion.

### 5 · Two issue types the definition needs do not exist
There are **no `Milestone`-typed issues and no `Client Commitment` labels anywhere in the sample.**
So the Dictionary's *"Epic **or Milestone** or Client Commitment"* reduces in practice to "epics".

This one is a **definition-vs-reality question for Bill**, not a fix: either those concepts get
created in Jira, or the Dictionary should say "Epic" and mean it.

- **Owner:** Bill (Metrics Dictionary) with Gon (Jira configuration)

---

## The "unattributed" problem is OURS, and it is a bug — **FIXED IN CODE 2026-08-04, deploy pending**

**Live FY26 Q4 measured the damage: 173 of 351 assigned issues (49%) were dropped by our own
join — the single largest evaluability loss in the system, 4× any other drop.** The roster
('Data' tab + 'Contractors Data') carries the assignee names; the dashboard was refusing to
look at most of it.

**The fix (schema v12):** issue metrics now attribute against the *whole active roster* — both
tabs, before the Department/Class gates — while the utilization/capacity population keeps its
gates unchanged. A contractor's or a Solution Architect's closed epic lands on that person and
counts in On-Time / Forecast / Quality; their capacity still counts nowhere, because they owe
none. Expected effect: attribution jumps from 51% of assigned work toward the 95% gate on all
four cards, needing **nothing from Jira**.

The two bugs it closes, for the record:

**1 · Every crew member and contractor is excluded outright.**
`readRosterPeople_` gates each roster row on `Department === "Services"` and the gate is
**fail-closed**: no Department column means the row is dropped. The `Contractors Data` tab
**has no Department column** — so *every* crew row is excluded, always. Their Jira work then has no
roster person to join to and is counted as "unattributed".

The fail-closed gate was a deliberate fix (fail-open had been letting every contractor in
regardless of status), and it is waiting on a Department column that was never added. That is a
one-column change to the roster, or a targeted code change — not a Jira problem.

**2 · The name index is built from the tracking-mandated population, not the roster.**
`assembleModel_` filters to JF007/JF009 before building the name index, so an FTE outside those
families — Solution Architecture, Operations, Training — also fails to resolve. That filter is
correct for **Utilization** (those people have no tracking obligation) but wrong for **On-Time,
Forecast and Quality**, which are issue metrics: someone outside the tracking families who closes an
epic on time still delivered it on time.

**Impact:** every one of those issues is silently missing from three of the four cards, and the
Region and Team comparisons under-count by the same amount.

**Owner: us (WFP / this dashboard).** The decision — crew and non-tracking FTEs count toward the
delivery metrics while staying out of the utilization population — was **ratified 2026-08-04**
and is implemented. Remaining exposure: the handful of assignees absent from the roster
entirely (measured at 4 of 48 distinct assignees in the earlier cross-check) stay unattributed,
correctly.

---

## Workforce Health — three upstream gaps (added 2026-08-10)

The pool × band capacity model ships without any exporter change: the job code already carries the
sub-track, and the issue-level columns it needs were already being exported and simply never read.
These three are what it still **cannot** measure, and each is stated on screen as not-measured
rather than defaulted to zero.

### 7 · No `requiredPool` on epics — backlog routes on history, not intent

Backlog has to be attributed to the pool that can actually absorb it, or "weeks of cover" means
nothing. The intended resolution order starts with a declared field; neither of the first two steps
exists here:

- No `requiredPool` custom field in Jira.
- No `allocationType` field in the export (`DH_ALLOCATION_TO_POOL_` is deliberately left empty
  rather than coded against a field that does not exist).

So an epic routes to **whichever pool has logged the most hours to it in the window** — a
reasonable proxy, but backward-looking. An epic nobody has touched cannot be routed at all and
lands in `UNROUTED`, shown as its own row and **never distributed** across the pools.

**Impact:** newly sold work is unroutable until somebody starts logging to it, which is exactly
when routing it would be most useful for planning. `UNROUTED` is the direct analogue of the
Delivery Manager coverage gap — not noise, but work nobody can plan.

**Owner: Delivery leadership** (a `requiredPool` field, or an `allocationType` we can map).

### 8 · Project-level plans name no issue — `not-committed` shadow is an upper bound

The Planned Time export carries an `Issue` only for **issue-level** plans. A project-level plan has
no issue by nature, so it resolves to no epic and cannot commit one.

**Impact:** work that *was* planned, at project level, can read as `not-committed` shadow — i.e.
routed to a Resource Manager as an unstaffed allocation when it was in fact staffed. The dashboard
publishes `planIssueCoverage` beside the figure and labels the row an **upper bound** rather than
presenting it as exact.

**Owner: Tempo admin + Resource Management** (plan at issue level where the work is issue-shaped).
A related gap: the export resolves every plan to a **named user** before writing a row, so
**generic/placeholder allocations are invisible** — a pool running heavily on unstaffed
placeholders is a staffing decision nobody has made, and we currently cannot see it. Reported as
not-measured, never as "none".

### 9 · No absence feed — capacity truth cannot be computed

The model wants `capacity truth` = deployable ÷ gross, i.e. how much paid capacity survives before
work starts. That needs an absence signal. There isn't one — not in planned time, tracked time,
PTO, medical or parental leave (unchanged since the 2026-08-04 finding).

The only available proxy is Tempo-tracked NETSUITE time-off, which measures **what people logged**,
not when they were away. Using it would make the teams with the *best* time-tracking discipline
look *least* available — inverting the signal precisely where it matters most.

**Decision (2026-08-10): do not use the proxy.** Capacity is gross scheduled hours, `capacityTruth`
renders **null / not measured**, and the time-off hours are carried beside it for the drill-down so
they stay visible without entering a denominator.

**Owner: Workforce Planning / HR** (an absence feed unblocks this automatically — no code change).

---

## What is already working

- **Utilization** publishes today. Tempo hours, capacity and the NetSuite billable split are landing.
- The 52-week export depth is correct and supports the six-period trend the Dictionary asks for.
- Every card states its own coverage and refuses to present a weak number as a strong one.
- The Data Hygiene tab carries this whole list in-product, with owners and target weeks, and trends
  each gap so progress is visible between reviews.

## The ask

| # | Blocker | Owner | Target |
|---|---|---|---|
| 1 | ~~Due dates on epics~~ **downgraded 2026-08-04: 77% live, close the last 3 pts to the 80% gate** | Delivery leadership | 2026.W34 |
| 2 | Estimates at kickoff on epics — **23% live, the biggest remaining upstream gap** | Delivery leadership | 2026.W34 |
| 3 | Populate Region + Team in Jira | Gon | 2026.W34 |
| 4 | Deploy export v3.6.0; decide on changelog fetch | Delivery + CX | 2026.W35 |
| 5 | Milestone type / Client Commitment label — or amend the Dictionary | Bill + Gon | 2026.W35 |
| 6 | ~~Crew excluded + narrow name index~~ **FIXED IN CODE 2026-08-04 (schema v12) — deploy pending; was dropping 49% of assigned work** | WFP + this dashboard | ✅ done |
| 7 | `requiredPool` (or a mappable `allocationType`) on epics — backlog currently routes on 90-day history, and untouched epics are UNROUTED | Delivery leadership | 2026.W36 |
| 8 | Plan at issue level where the work is issue-shaped; surface generic/placeholder allocations in the export | Tempo admin + Resource Mgmt | 2026.W36 |
| 9 | An absence feed — unblocks capacity truth with no code change | Workforce Planning / HR | 2026.W37 |

**We are not waiting on these to ship.** The dashboard is live, honest about what it cannot yet
measure, and every one of these gaps has a trend line so the next review can see movement rather
than re-litigate the list.
