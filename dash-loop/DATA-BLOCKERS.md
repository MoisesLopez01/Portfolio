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

Profiled from a real `Jira Raw` export: **218 resolved issues, 2026.W32 sample window**.
⚠️ That sample's resolution dates run 2025-08-04 → 2025-08-18 — roughly **350 days old** — so treat
the percentages as indicative and re-run the profile against a current 52-week export before
quoting them externally. The *structural* findings (fields and issue types that do not exist) do
not depend on how recent the sample is.

---

## Blockers, worst first

### 1 · Epics do not carry due dates → **On-Time Delivery cannot publish**
**Measured: 2 of 18 epics (11%) have a due date. Gate is 80%.**

The Metrics Dictionary defines On-Time over *"Epic/Milestone or Client Commitment"*. We implemented
exactly that. On this data it leaves **two measurable issues**.

For contrast, the Stories and Tasks we previously measured carry due dates on 146 of 200 (73%). The
discipline exists at task level and not at milestone level — which is the opposite of where a client
commitment actually lives.

- **Decision, ratified 2026-08-03:** we keep measuring the Dictionary definition and let the
  card show as below-gate. The alternative — reverting to the Stories/Tasks scope — would report
  146 of 200 at 73% instead of 2 of 18 at 11%, but only by measuring something the Dictionary
  does not define. That would make the number look healthier by hiding this blocker.
- **Owner:** Delivery leadership (due-date discipline on epics) · **Prereq:** PR-08
- **Also needed:** PR-02, a *baselined* committed date. Today we measure the mutable Jira Due Date,
  so a re-baselined milestone silently scores as on time.
- **Unblocks:** On-Time Delivery, the headline outcome metric.

### 2 · Closed epics have no estimates → **Forecast Accuracy is running on three**
**Measured: 4 of 18 closed epics carry an estimate; 3 have both an estimate and logged time (17%). Gate is 70%.**

Worse than the count: the four estimates that exist are 10h, 10h, 10h and 8h against actuals of
17.8h, 1.0h, 0h and 21.8h. Those read as placeholders, not forecasts. A "forecast accuracy" built
on them measures nothing.

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

## The "unattributed" problem is OURS, and it is a bug — not a data gap

**This supersedes an earlier version of this note that blamed roster name-matching. That was wrong.**

Cross-checked the 48 distinct Jira assignees against the live roster workbook
(`ServiceRocket || Historical Headcount`, the same file the Demand dashboard uses):
**44 of 48 (92%) are on the roster.** The names are fine. Only four are absent entirely
(Miguel Ramon, Olyviah Amwoma, Septa Cahyadiputra, Wilson Lai).

The dashboard drops them anyway, in two places, both ours:

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

**Owner: us (WFP / this dashboard).** Fixing it needs a decision — whether crew and non-tracking
FTEs should count toward the delivery metrics while staying out of the utilization population — so
it is on tomorrow's agenda rather than already changed. **Very likely the largest single improvement
available**, and it needs nothing from Jira.

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
| 1 | Due dates on epics / milestones | Delivery leadership | 2026.W34 |
| 2 | Estimates at kickoff on epics | Delivery leadership | 2026.W34 |
| 3 | Populate Region + Team in Jira | Gon | 2026.W34 |
| 4 | Deploy export v3.6.0; decide on changelog fetch | Delivery + CX | 2026.W35 |
| 5 | Milestone type / Client Commitment label — or amend the Dictionary | Bill + Gon | 2026.W35 |
| 6 | **Crew excluded by a fail-closed Department gate + name index built from the tracking population — both ours, both bugs** | WFP + this dashboard | 2026.W34 |

**We are not waiting on these to ship.** The dashboard is live, honest about what it cannot yet
measure, and every one of these gaps has a trend line so the next review can see movement rather
than re-litigate the list.
