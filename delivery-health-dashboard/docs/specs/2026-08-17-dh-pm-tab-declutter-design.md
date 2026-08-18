# PM tab declutter — pills, collapsed methodology, sharper tooltips — design

**Date:** 2026-08-17 (2026.W34) · **Status:** implemented · **Files:** `Dashboard.html`,
`tests/delivery-health/render-smoke.js` · **No schema change, no cache action.**

Requirements arrived fully specified from director feedback (five numbered items with
developer actions); this spec records the decisions and constraints, not a re-derivation.

## 1 · Methodology off the page

The 8-line attribution/windowing paragraph under "Project Managers — owned work" moved
into `<details class="pmMethod">` with the summary **ⓘ How PM ownership is calculated**.
`<details>`, not a modal: it survives re-renders with its open state intact and needs no
script — the same decision `keyGridHtml_` took. Every sentence is preserved verbatim
inside it (one edit: "each row says which rule placed it" now points at the ⓘ beside
Owns), including the dynamic backlog/ignored counts and the "why the 🚩 audit on Actions
shows a higher number" reconciliation. Keeping the wording also keeps the existing
render-smoke wording assertions honest — the text is still in the DOM.

The filter note ("N epics hidden by the current filter") stays open-page: it is
action-relevant state, not methodology.

## 2 · Signal pills

`pmOppHtml_` renders horizontal colour-coded pills instead of a vertical text list.
`PM_OPPS_` entries gained a `short` label (`no due date`, `past due date`, `at risk`,
`unlinked`, `untouched 30d+`); `one`/`many` long forms were removed with the prose.
Pills keep the existing doctrine: ranked biggest-first with declaration order as the
tie-break, never summed into one score, zero-count signals absent, and a clean PM shows
a green `✔ No open gaps` pill (absence must mean something). Colours reuse the sig
vocabulary (`.pmPill.sigBad/.sigWarn/.sigGood`) over `--c-bad/--c-warn/--c-good` tints.

## 3 · Attribution behind ⓘ

`pmViaHtml_` now returns plain text ("How ownership was attributed: 10 by Jira assignee
(direct evidence…) · 2 by Tempo project lead (an inference…)") rendered as a ⓘ tooltip
beside each PM's **Owns** figure. The open-row "Attributed: …" line is deleted. The
information survives for the dispute case; it just stopped costing a row.

## 4 · Sharper tooltips

Condensed at every grain, anchored on the director's own rewrite for the no-due case:
*"Work started without a deadline. This bypasses On-Time Delivery tracking and requires
immediate scoping."* Applied to `PM_OPPS_` tips, the epic Due cell, the epic-level gap
chips, the child verdict chips, and the backlog-carve note. Load-bearing phrases pinned
by tests ("no date of its own") were kept.

## 5 · Every pill acts

- **No-due pill** → direct link into the Jira issue navigator over `epicMissingKeys`
  (`jiraKeysUrl_`), the same keys the 🚩 row draws. Degrades to the route below when no
  Jira base is configured (no dead anchors — existing rule).
- **Counts-only pills** (at risk / breached / unlinked / stale) → `pmPillOpen_(pm)`,
  which OPENS the PM's epic list (never toggles — a pill must not close the evidence it
  points at). **Why not Jira links:** these ship as counts computed over the PM's FULL
  epic set, wider than the "in progress or due this month" window the client draws, and
  the payload carries no per-signal key lists — a key link could not match the pill's
  own number. Routing to the on-screen evidence, where every flagged epic is marked on
  its row with its own "Open these N in Jira" exit, is the honest click.
- Pills are keyboard-reachable (`role="button"`, `tabindex`, Enter/Space) like the KPI
  drill cards and grid rows.

## Testing

`node tests/delivery-health/render-smoke.js` — 1599 checks. New/updated coverage:
methodology collapsed by default and labelled; pills counted, ranked, never summed,
zero-count absent; no-due pill is a JQL anchor; counts-only pill routes through
`pmPillOpen_` and is idempotent; "Attributed:" absent as open-page text while the split
survives in the ⓘ tooltip. Layout verified by headless-Chrome screenshot of the real
CSS over representative rows (tests are blind to layout).
