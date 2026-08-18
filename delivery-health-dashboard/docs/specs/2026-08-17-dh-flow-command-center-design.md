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
with `.pulseAlert` — **⚡ Nh recoverable this week → open the roster** — clickable and
keyboard-reachable, amber not red (idle capacity is an opportunity, not a failure).
Gates unchanged: finished windows only (`norm !== null`), and only when `opp >= 1`; a
measured 0h keeps a quiet inline mention in the counts row, because a measured zero is
still a measurement and an 0h banner would be furniture.

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
