# Backlog Truth, Reconciliation & Intern Inclusion — Design

**Date:** written 2026-08-07 (2026.W32), **build week 2026.W33** (Mon 2026-08-10 → Sun 2026-08-16) ·
**App:** Delivery Health Dashboard (`delivery-health-dashboard/`) ·
**Status:** **PLANNED — not started.** Three workstreams, 14 tasks.

**Business source of truth for this spec:** *The Runbook — End to End, Resell and Services*
(2026.W32), Track B (BL01–BL03) and the cross-cutting triage table. Where this spec and the
Runbook disagree, the Runbook wins and this page is wrong.

---

## Why

Three separate findings from the 2026-08-07 review of the live Jul 2026 (2026.W31) Executive
screen. They are independent, but they compound: the dashboard currently reports a **healthy
services pipeline as an alarm**, and two of its own numbers disagree on screen while it does so.

### Finding 1 — the semantics are inverted, not the arithmetic

The hero reads *"We are holding 2,524 items … roughly 12.0 weeks of work, against a normal of 8.7.
64% of it has no owner — 1,626 items nobody has picked up."*

Every number reconciles. `totalItems = queue.assigned.items + queue.unassigned.items`
(`Code.js:3730`) over `clearRateMedian_` (`Code.js:3729`); 2,524 ÷ 210 = 12.0. Both sides are
org-wide, so there is no population mismatch. It is also being **conservative**: the registry
records that a one-week denominator would have read 16.1 weeks where the 8-week median reads 11.0.

The problem is what the number is graded as. `queueCover` and `inventory` both carry
**`dir: "down"`** (`Code.js:559`, `Code.js:618`) — less is better. For a services business that is
backwards, and the Runbook states the real failure mode at **B1.6**:

> *"Skipping this is how $2.5M of booked SOW ends up with zero estimated delivery work in Jira —
> a healthy pipeline and a starving P&L."*

The danger is **too little** backlog in Jira. Sold backlog is a revenue asset; 12.0 weeks of cover
across 140 people is roughly a quarter of visible sold work, which is close to what you want.

The unowned framing has the same defect. **B2.2** makes unassigned work the *designed output* of
the Preparation stage — *"the PM is deliberately not assigned until this is reviewed and
approved"* — and **B2.3** exists to obtain **generic** resource allocations, generic meaning
deliberately not a person yet. Calling that pool *"the queue nobody has finished"* and
*"1,626 items nobody has picked up"* describes a process artifact as neglect.

### Finding 2 — two assigned counts on one screen

| On screen | Value | Source |
|---|---|---|
| Ruler caption | `306 · 592` = **898** | `queueSnapshot_`, `Code.js:1502-1509` — sums **every** flowOpen bucket. No person join, no filters, no intern rule |
| Assigned inventory card | `304 · 591` = **895** | `flowOpenFor_()`, `Dashboard.html:3506-3519` — same buckets, drops any whose person fails `MODEL._pByName`, `passesFilters_`, or `isIntern` |

The card's caption claims it *"Follows Region / Team / PM / Family like every other filterable
surface"* — but with every filter on **All** it still disagrees, so the difference is not a filter.

Root cause is upstream of both: the person-stub pass at `Code.js:3757` builds its `referenced`
set from `[onTime.buckets, forecast.buckets, rework.buckets]` only. `flowOpen`, `leadTime`,
`throughput`, `personHygiene` and `backlogHealth` are **not in that scan**, so a person with open
work but no resolved work and no utilization record ships no person record at all — and every
client surface silently drops their buckets via the `!person` guard. New hires and people back
from leave are precisely that population. `bucketsFor_` (`Dashboard.html:1804-1811`) applies the
identical drop, so Lead Time and Throughput carry the same silent loss.

### Finding 3 — interns move real work (reverses the 2026-08-04 decision)

**User decision, 2026-08-07:** *"interns move some tasks, so worth counting them in the
dashboard"* and *"remove their tag as 'Training', we are doing okay with the icon."*

The 2026-08-04 carve — *"a metric must never punish an intern"* — protected **people**, but it was
implemented as a blanket exclusion from every rate and every bucket, which corrupts **org
aggregates**: work that genuinely happened is missing from throughput, cleared, lead time and the
queue. Those two goals are separable, and W33 separates them.

---

## Decisions needed before code (Monday 2026-08-10, blocking)

| # | Decision | Recommended default |
|---|---|---|
| **D1** | Do interns enter **org/team aggregates** (throughput, cleared, lead time, queue, backlog)? | **Yes.** Their work is real work; excluding it makes org numbers wrong. |
| **D2** | Do interns enter **individual ranking / coaching surfaces** (`oppRows_`, triage flags, "biggest problem" ranking)? | **No.** This is what "never punish an intern" actually protected. Keeps the leadership intent while fixing the arithmetic. |
| **D3** | Do interns enter **utilization / availability** (`utilRollup_`, plan coverage)? | **Yes** — they consume capacity and hold allocations. Flagged separately because it moves a published rate the exec team already reads. |
| **D4** | Is weeks-to-clear renamed (**Backlog Cover**) or only re-graded? | **Rename + re-grade.** "Weeks to clear" reads as a queue to survive; "cover" reads as inventory sold. |
| **D5** | Does DH's backlog number reconcile to the ABC weekly Backlog, or get renamed to avoid the collision? | Needs Gon / COEA — see Risk R3. |

D1–D4 can be answered in the room. **D5 is external and must not block the build.**

---

## Workstream A — Backlog semantics (client-only, no export)

Highest value, lowest deploy cost. Nothing here changes the payload.

### A1 · Re-grade queue depth as cover, not debt
- `Code.js:549-572` (`queueCover`) and `Code.js:616-622` (`inventory`): `dir: "down"` → `dir: null`
  with an explicit `dirNote` explaining that depth is an asset bounded on **both** sides — too
  little starves the P&L (B1.6), too much signals unsellable or un-written-off inventory (B5.2).
- Operating band keeps grading against the norm; only the **direction of virtue** changes.
- Registry `definition` gains the Runbook citation.
- **Acceptance:** 12.0w against a 8.7w norm no longer renders in `--c-bad`. A *low* cover figure
  renders as a warning.

### A2 · Rewrite the unowned framing
- Panel title `Dashboard.html:3095` — "📥 Backlog — the queue nobody has finished" → a title that
  does not impute neglect.
- Ruler segment tooltip `Dashboard.html:2922` — "Unowned — N items nobody has picked up" →
  "Planned, not yet assigned — N items awaiting a PM (BL02)".
- Caption `Dashboard.html:2926-2929` — "Unowned" → "Unassigned (planned)".
- Hero sentence: drop "nobody has picked up".
- **Acceptance:** no user-facing string implies abandonment for a state B2.2 creates on purpose.
  Add a render-smoke assertion for the banned phrasings, same pattern as the existing
  "no bare N.Nw literal" guard.

### A3 · The B2.2 legitimacy split
> *"An epic without an estimate, an owner and a customer commitment is not backlog — it just
> looks like it."*

Three checkable conditions, and DH already carries all three fields:

| Condition | Field | Present today |
|---|---|---|
| Estimate | estimate hours | yes (78% coverage per Runbook triage) |
| Owner | assignee **or** generic allocation | assignee only |
| Customer commitment | SRSO component (B2.6) | yes |

- Split the 2,524 on **legitimacy**, not on `assignee is empty`. Assigned/unassigned separates
  nothing meaningful; this separates real backlog from noise.
- Render as a stacked cut on the existing ruler — a fourth segment, or a toggle between the
  "who owns it" and "is it real" views.
- **Acceptance:** the panel can answer "how much of the 2,524 is backlog by our own definition?"

### A4 · Surface the B4.2 status vocabulary
Fixed vocabulary from the weekly backlog meeting: Scheduled · Slowburn · Paused ·
Postpaid|Completed · **Postpaid|Non-Actionable** · Prepaid|To be Expired · Fixed Price Completed.

- `Postpaid | Non-Actionable` is **by definition** work awaiting write-off (B5.2–B5.5). It sits
  inside the 2,524 today, inflating both inventory and cover. The Runbook's own triage table
  predicts this exact symptom: *"Backlog includes work that will never happen → Write-off cycle
  not run."*
- **Data question to settle first:** is this status in the Jira export at all, or only in NetSuite
  / the weekly meeting? If it is not in Jira, A4 becomes an **upstream ask**, not a build — record
  it as such rather than faking a proxy.
- **Acceptance:** either a write-off-candidate cut ships, or the spec records exactly which system
  holds the field and who owns getting it into the export.

### A5 · ABC reconciliation note
The Runbook's rhythm table publishes Availability, **Backlog** and Contribution weekly as "the
company's instrument panel", sourced from *ABC Backlog — Schema & Data Reference* (COEA). DH
publishes a differently-computed number under the same word.

- **W33 deliverable is a written comparison, not a code change:** DH's formula vs ABC's, the delta,
  and a recommendation to reconcile or rename.
- **Acceptance:** a one-page note that can go to Gon / COEA. Blocking for any exec circulation.

---

## Workstream B — Make the two halves reconcile (server + client)

### B1 · Fix the person-stub scan
- `Code.js:3757` — add `flowOpen.buckets`, `leadTime.buckets`, `throughput.buckets`,
  `personHygiene.resolved`, `personHygiene.open` and `backlogHealth.buckets` to the `referenced`
  scan so every bucket person ships at least an attribution stub.
- Stubs already carry identity only (`weeks: {}`) and are barred from capacity/hygiene
  denominators by `attribOnly`, so this cannot move a rate — it only stops the silent drop.
- **Acceptance:** 895 and 898 converge except for whatever D1/D2 leave out deliberately. A unit
  test asserts every bucket person resolves in `MODEL.people`.

### B2 · Make the remaining difference honest
- Whatever residual the D1–D3 answers leave (e.g. filters genuinely applied), the card's context
  line must **name** it. The current "Follows Region / Team / PM / Family" is false at All/All.
- **Acceptance:** with every filter on All, the card either matches the ruler or states in words
  why it does not.

### B3 · Sweep the same class of loss
- `bucketsFor_` (`Dashboard.html:1804-1811`) drops on the identical `!person` guard. Confirm Lead
  Time, Throughput, Cleared and Quality/Rework are whole once B1 lands.
- **Acceptance:** a reconciliation line — bucket-sum vs published-n — for each, in the same style
  as the existing pulse-panel reconcile sentence.

---

## Workstream C — Intern inclusion (reverses 2026-08-04)

### ⚠️ Do not touch `"Training & Customer Education"`
JF008 is a **job family name** (`Code.js:2538`, tests at `Code.js:4622`, `Code.js:4629`), unrelated
to the intern flag. Removing the intern "Training" wording must not touch the family. Add a
render-smoke assertion so a future sweep cannot conflate them.

### C1 · Count interns in aggregates (D1, D3)
Remove the `isIntern` early-return at each aggregate site:

| Site | File | What it does today |
|---|---|---|
| `bucketsFor_` | `Dashboard.html:1811` | drops intern buckets from **every** bucket metric |
| `flowOpenFor_` | `Dashboard.html:3602` | drops intern open work from the queue |
| `utilRollup_` (client) | `Dashboard.html:1680` | intern never moves a published rate |
| `utilRollup_` (server) | `Code.js:1224` | same, server side |
| plan coverage | `Dashboard.html:1732` | intern owes no plan |
| rollup | `Dashboard.html:5693` | |
| grid cell | `Dashboard.html:1773` | renders 🎓 **instead of** the number |

- `Dashboard.html:1773` is the visible one: interns currently show 🎓 where a value belongs. Under
  D1 they show the number **and** keep 🎓 as an identity badge.
- **Acceptance:** the "N interns excluded" caption (`Dashboard.html:3509-3514`) disappears, because
  nothing is excluded. Published totals rise by the interns' real contribution — expected and
  correct; record the before/after so the jump is explainable to the exec team.

### C2 · Keep interns out of ranking and coaching (D2)
- `oppRows_` (`Dashboard.html:4780`) and triage flags (`Dashboard.html:5131-5133`) keep their
  intern guard. Rationale changes from "never in a metric" to "never in a **ranking**" — write it
  down in the registry deviation (`Code.js:336`), which currently states the blanket rule.
- The grid already lists interns in their own ungraded bucket (2026-08-06,
  `Dashboard.html:6547-6592`); that stays.

### C3 · Drop the "Training" wording, keep 🎓
Remove the visible text at every site; the icon carries it:

| Site | File | Today |
|---|---|---|
| signal chip label | `Dashboard.html:5325` | `label: "In training"` |
| pulse link | `Dashboard.html:4871` | `"🎓 " + n + " in training"` |
| headroom explanation | `Dashboard.html:5882` | `"in training"` |
| grid / CSV | `Dashboard.html:7027` | `"intern (in training, ungraded)"` |
| state badge | `Dashboard.html:5898` | title `"in training, not delivery capacity"` |
| legend | `Dashboard.html:5533` | `"🎓 intern (shown, never graded)"` |
| tooltips | `Dashboard.html:3513`, `5326`, `5403` | "in training, not delivery capacity" |

- Most of these become **factually wrong** once C1 lands ("never graded", "not delivery capacity"),
  so this is a correctness change, not cosmetics.
- Keep 🎓 everywhere it appears today. Keep the legend entry itself — just the wording changes.
- **Acceptance:** render-smoke asserts no user-facing "in training" string survives, and that 🎓
  still renders on every intern row.

### C4 · Update the tests that encode the old decision
- `Code.js:4612-4616` asserts *"intern excluded even with include flag"* — that assertion is now
  wrong and must be inverted, not deleted.
- `Code.js:6541`, `Code.js:6907-6911` (`dhIsIntern_` token parsing) stay green — the flag itself is
  unchanged, only what we do with it.
- Schema note `Code.js:4135-4138` gains the reversal with its date and rationale.

---

## Test plan

1. `node delivery-health-dashboard/render-smoke.js` — currently 488 green.
   New assertions: banned neglect phrasings (A2), no "in training" text (C3), JF008 family intact
   (C guard), 🎓 still rendered (C3).
2. Code.js node tests — B1 stub coverage, C4 inverted intern assertions.
3. **Manual, and non-negotiable:** open the live Jul 2026 screen and confirm ruler and card agree
   at All/All. This class of bug does not show up in a unit test — same lesson as the dark-mode
   invisible-bar bug (2026-08-03) and the uniform-column finding (2026-08-04).
4. Record before/after for every published rate C1 moves. An unexplained jump on an exec screen
   costs more trust than the fix earns.

## Deploy order

Workstream A is **client-only** and can ship alone. B and C touch `Code.js`.

```
1. A only:        Dashboard.html + Code.js registry → new version. No export, no cache bump.
2. B and C:       Code.js → run the export → Dashboard.html → bustDeliveryCache_  (REQUIRED)
```

⚠️ There is already a large uncommitted DH stack (two-tab consolidation, flow sparklines, colour
keys, forward windows). Confirm what is actually deployed before adding to it — see
`project_delivery_health_dashboard` memory.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | C1 moves published rates the exec team already reads | Before/after table in the deploy note; the jump is the *fix*, but it must be narrated |
| **R2** | A4's status vocabulary may not exist in the Jira export | Settle the data question **first**; if absent, A4 becomes an upstream ask, not a build |
| **R3** | DH "Backlog" collides with the ABC weekly Backlog | A5 note before any exec circulation; D5 is external and does not block |
| **R4** | A "Training" sweep hits JF008 | Explicit guard + render-smoke assertion (Workstream C preamble) |
| **R5** | B1 ships stubs for many more people, growing the payload | Stubs are identity-only; measure payload size before/after, gzip+chunk already handles it |

## Sequencing — 2026.W33

| Day | Work |
|---|---|
| **Mon 2026-08-10** | Settle D1–D4 in the room. Answer A4's data question. Start A1 + A2 |
| **Tue 2026-08-11** | Finish A1/A2, ship Workstream A (client-only) and read it live |
| **Wed 2026-08-12** | B1 + B3, with the reconciliation assertions |
| **Thu 2026-08-13** | C1 + C2 + C4, before/after rate table |
| **Fri 2026-08-14** | C3 wording sweep, full smoke, A5 note, deploy B+C with `bustDeliveryCache_` |

A3 is deliberately unscheduled — it is the most valuable item and the least well-defined. Scope it
Monday against the D1–D4 answers and pull it into W34 if it does not fit.

## Out of scope

- Skill-gated weeks-to-clear (per job family) — the Rovo job-title question from 2026-08-07. Needs
  the historical who-does-what mapping first; separate spec.
- Any change to `dhIsIntern_`'s I1 token parsing.
- The Jira exporter's changelog work (v3.12.1, separate and already complete).
