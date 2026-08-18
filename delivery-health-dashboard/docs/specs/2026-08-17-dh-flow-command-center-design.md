# Backlog & Flow as a command center — design

**Date:** 2026-08-17 (2026.W34) · **Status:** implemented · **Files:** `Dashboard.html`,
`tests/delivery-health/render-smoke.js` · **No schema change, no cache action.**

Director feedback, four numbered items; this spec records decisions and constraints.

## 1 · Verdict paragraph and unassigned note off the page

`renderMasthead_` no longer renders `mastVerdict` or the `ctxNote` block. The three stat
callouts (`pipelineStatsHtml_`) carry the same facts one figure each. The note's sentence
survives verbatim as a **data-gated ⓘ tooltip** on the Groomed pipeline callout
(`unownedNoteHtml_` now returns plain text; empty when no unowned items — same gate as
the old block). `verdictFindings_` is retained-but-unrendered, house pattern
(`workforceTileHtml_`, `hbarChart_`): its materiality thresholds are doctrine and stay
fully tested — the test suite's `masthead()` helper appends the engine's text to the
rendered HTML so every wording assertion still runs against real output.

## 2 · Assigned pair joins the Runway cluster

New `assignedRunwayParts_()` (extracted from the band's sub-row, byte-identical logic:
`flowOpenFor_` + `assignedClearRate_`, never the ORG scalars). The Runway cluster
interleaves ORG and SNAP twins: Inventory · Assigned inventory · Weeks to clear ·
Assigned weeks to clear. The band keeps the bar + smart legend and rewords its ⓘ line to
point at the Runway pairing; its sub-row and the "Assigned — the work that has an owner"
caption are gone. The flow tier now legitimately carries exactly two SNAP tags — a test
pins the count so the retired Backlog/WIP tiles cannot creep back behind them.

## 3 · Recoverable hours lead

`#pulsePanel` moved directly under `#masthead` in the pane (reading order test updated:
masthead → pulsePanel → backlogBand → flowSecondary → trustDetail). `renderPulse_` opens
with `.pulseAlert` — **⚡ Nh left on the table in <week> → open the roster before this
week repeats it** — clickable and keyboard-reachable, amber not red.

**Wording correction (user, same day):** the first cut said "recoverable this week",
which was wrong twice — the figure is priced on the **last complete week** (the only
window the operating norm publishes for), and a finished week's hours cannot be
recovered at all. The alert now names the measured week, states the hours as *left on
the table*, and frames the roster click as the act-now route for the week that can
still be steered. A test pins that "recoverable this week" never returns and that the
alert carries a `YYYY.WN` week label.

Gates unchanged: finished windows only (`norm !== null`), and only when `opp >= 1`; a
measured 0h keeps a quiet inline mention in the counts row (also reworded to "left on
the table in <week>"), because a measured zero is still a measurement and an 0h banner
would be furniture.

## 4 · Colour key deleted

`#flowKey` removed from the markup (structural, not emptied — a test pins it),
`renderFlow_`'s fill removed, and `ragKeyHtml_` deleted with its last caller.
`keySwatch_` survives — the Workforce and Actions keys still use it. Rationale: the tab
is mostly ungraded volume metrics, and every graded card carries its own ✔/▲/✖ glyph and
value label (FR-4.4), so status never rested on the legend.

## Testing

`node tests/delivery-health/render-smoke.js` — 1635 checks green. Layout verified by
headless-Chrome screenshot of the real CSS over representative markup (stat callouts +
ⓘ, pulse alert, interleaved Runway cluster). Note: the repo was CONTESTED during this
work — a concurrent session was mid-flight on the Workforce tab and the suite was red at
baseline on their block; it went green when their work landed, and all assertions here
were verified on the merged state.

## Addendum (same day) — idle hours priced per level band

**User challenge:** the alert's hours were "most likely meetings, breaks, coaching, intern
time — managers have more consulting/meeting/coaching time than tracked work time."

**Business sources (Rovo, retrieved 2026-08-17):**
- *Delivery Utilization: How We Measure It (Reference)* (REVOPS, 5496111140): net
  utilization = **all logged hours ÷ net capacity**; FY26 FTE ran mid-80s every quarter
  (~85%) — the achieved rate already contains each role's structural overhead. "An
  activity measure, not revenue."
- *POL - Time Logging* (BLUECONS, 846981168): meetings, 1:1s, admin, personal
  development, hiring/onboarding and ramp-up are loggable Internal Non-Billable time.
- *Manager Playbook* / *Career Development Guide for Managers* (MANAGERS space):
  coaching, 1:1s and calendar management are the manager's job, not slack.
- *Delivery Health Dashboard: Metrics Dictionary* (5514789017): utilization exists "to
  find where the system is getting in a Rocketeer's way, not to rank individuals."

**Decision.** The figure was already priced against the cohort's own achieved median —
never against 100% — so org-wide overhead was partially absorbed. The defect was the
BLEND: one median, dominated by consultants, priced managers' structural meeting load as
idle. New `bandNorms_(done)` computes the utilization operating rate PER LEVEL BAND
(scoped `metricSeries_` per band via `SCOPE_NAMES_`), and `oppRows_(head, norms)` prices
each person against their own band's rate — the Workforce tab's "never blended" doctrine
applied to pricing. Bands without a publishable rate are excluded and disclosed on the
tooltip, never defaulted to the blend (that would re-import the bug for exactly the band
most unlike it). Interns / ramping / leave / bench exclusions unchanged. The alert's
grain word now follows the period picker ("before this month repeats it" on a month
window).

**Proof pinned in tests:** a MGMT-band fixture person at a steady low tracked rate
prices to zero against their own band's norm, while the blended norm would have priced
their meetings as recoverable hours; the pulse figure equals the per-band walk.
