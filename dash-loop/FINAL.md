# Delivery Health — Director view · loop result

5 iterations, 17:20–18:45. Stopped on the 90-minute budget. Tests green throughout
(node-tests all suites, render-smoke 195 → 228 checks).

| # | Row | Before | After | |
|---|---|---|---|---|
| R1 | Region scopes all four, provenance stated | 1 | 1 | **blocked** — PR-01 |
| R2 | Team, same control as Region | 1 | 1 | **blocked** — PR-01 (+F5 not reached) |
| R3 | Six-period trend on all four | 2 | 2 | |
| R4 | Registry formulas, invertTarget, floors | 1 | **2** | iter 2 |
| R5 | One definition per metric | 0 | **2** | iter 1 |
| R6 | Card grammar, aligned baselines | 1 | **2** | iter 4 |
| R7 | Four answers in one viewport | 1 | **2** | iter 4 |
| R8 | Margin detail hidden for non-directors | 0 | **2** | iter 3 |
| R9 | AA, dark parity, table twin | 2 | 2 | |
| R10 | Coverage chips, no dead code, perf | 1 | **2** | iter 5 |

**Total 10 → 18/30.** Target 24 not reached; R1/R2 are blocked (below) and iteration 6
was not started — the clock ran out mid-budget rather than the work running out.

## What changed, in your language

**The comparison bars were disagreeing with the cards above them.** On three of the four
metrics, a Region or Team bar was computed by different arithmetic than the tile it sat
under — and worst, "Quality/Rework" bars were showing Forecast numbers under a
Quality label. Each pair was internally consistent, so nothing looked wrong. Now a bar
and its card are the same calculation by construction, and a test fails if they ever
diverge again. **This is the one that mattered.**

**Quality/Rework was the healthiest-looking card on the screen, and it was lying.** It
showed 0% in green while its own small print said reopens are not being counted. With
that signal switched off in the export, 0% means *nothing was detected*, not *nothing
happened*. It now carries no red/amber/green at all and reads "at least 0% — lower
bound, not a measurement". Colour comes back the moment reopens are actually measured.

**Utilization and forecast variance were visible to anyone during a demo.** Open access
handed every unidentified visitor the same role as a named director. Those two cards are
now absent from the page for guests — not greyed out, absent — and the metrics disappear
from the filters and comparison chart with them, so they cannot be read off a bar instead.

**The four cards now read as a set.** Quality carried eight lines of small print and
Forecast seven, which pushed their trend lines to different heights and made the row
look like four unrelated blocks. All four are three lines now, so the trends line up and
your eye can run across them. The period is stated once at the top instead of four times.
Nothing was deleted — median variance, miss direction, unattributed counts and the CSAT
note are on the ⓘ beside each card's context line.

**Housekeeping:** the tab labelled "Trends" holds no trend chart; it is now "Headroom".
Its metric buttons did nothing (the table only measures utilization) and are gone.

## Blocked, and on what

**R1 and R2 cannot pass until PR-01 lands (owner: Gon).** Measured 2026.W32: the Jira
Region field is 0% populated (129 of 129 Unassigned), Team 28%, assignee 52%. So
"On-Time · APAC" today means *issues assigned to people whose roster location is APAC*,
not *issues tagged Region = APAC*. That substitution is real and is labelled in the UI and
tracked in Data Hygiene; it is not fabricated, but it is not the Dictionary's definition
either. Two rubric points are waiting on a Jira admin change, not on code.

Not reached in the budget: making Team a chip strip like Region (F5), so the two peer
dimensions still have different-looking controls.

## Look at this first

**The Quality/Rework card.** It is the only one of the four whose number you could not
previously trust, and the reason is a one-line switch in the export
(`CONFIGJ.FETCH_CHANGELOG`), currently off because fetching Jira changelogs is slow. Until
it is on, that rate is a floor. Decide whether you want the true number badly enough to
pay the export runtime — and until you do, read it as "at least".

## Deploy is a human step

`clasp push` and the cache bust are **not** run by this loop. Nothing here reaches the
live dashboard until someone does:

1. push `Code.js`, `Dashboard.html`, `Security.js`
2. run `bustDeliveryCache_()` — schema is v10, and a v9 cache entry renders empty cards
3. re-run the Jira export first if columns 33–35 are not yet in `Jira Raw`

Branch `dash-loop/20260803`, five commits, each revertable on its own.

⚠ The working tree holds 94 uncommitted files across CompDash, GDash, PS and the Tempo
exporters, and a second session was editing these same files throughout. `git checkout .`
was never run and must not be — every revert in this loop was scoped to a single file.
