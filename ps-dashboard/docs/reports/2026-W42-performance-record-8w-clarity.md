# Performance Record: the 8-week table a new manager can read (2026.W42)

**Date:** 2026-10-15 · **Where:** Contribution Report › 📈 Performance Record (the person card) and the Supervisor filter · **Builds on:** the hours and help release of 2026-10-14 (@301) and the Tempo links (@302)

## What a manager sees now

**The score is unmistakable.** The first row of "The 8 weeks up to the evaluated week" is the Score row, shaded apart from the measures. Each week shows the score in its band colour above a small bar stacked by measure — how many points Goals, Logged time, Planned time, Kudos, RCR, PTO and SI each earned. Hover a score for the exact points ("Goals 30 / 30 pts · Logged time 24.8 / 30 pts …"); click it to keep the note open. The bars line up under the same week headers as every other row, so the make-up of a score reads straight down the column.

**Goals read as a fraction.** A week shows goals meeting the rules over all goals — `6 / 8` — with *up to date* underneath, or the reason it is behind: *needs 8 goals*, *most not in progress*, *needs 6 with comments*. A month or quarter still shows weeks up to date over weeks checked. No key needed.

**Kudos read as words.** `1 given` over `1 received`, in that order, on the card, the tiles and the evidence.

**Hours are the whole week.** Logged time and Planned time now include the PTO the NetSuite record holds for the week and any public holiday for the person's location, capped at the standard week (40 h, or 38 h in Australia & New Zealand) — the same rule the Delivery Health dashboard uses. A week on leave reads `40 h · incl. 40 h PTO`, not `0 h`. Hover a cell for the make-up ("Planned 40 h = 24 h on projects + 16 h PTO · capped at the 40 h week"). If Tempo held more than the card counts, the note says so and names the two known causes: PTO cancelled in NetSuite but still booked in Tempo, and duplicated entries. The colour signals and the score are unchanged; they still judge the project hours against the PTO-adjusted target.

**PTO keeps the balance.** The PTO plan cell shows the balance in hours at period close with Good / At risk underneath, as before.

**Notes stay open.** Any help bubble on the dashboard can be kept open: move onto it to read it, press *📌 Keep open* (or click a score) to pin it, *✕ Close* or Esc to let it go. It never covers the thing you hovered.

**A manager is not in their own list.** Filtering by Supervisor now shows that person's org tree without the person: a manager's evaluation belongs on their manager's dashboard, the same rule the server already applies to a signed-in manager.

**The toggles stay.** Week · Weeks · Months · Quarters work as before on the card and the list.

## What "The short version" is

It is feedback material for a 1:1, built from the last 13 closed weeks: whether the person is steady, improving or slipping; what they do most consistently (something to celebrate); and their biggest recurring gap (something to work on). It reads across four measures — goals, logged time, planned time and kudos. PTO is deliberately not part of it (a wellbeing signal, read in Context and the history), and neither is RCR (not in the rocketeer's control). Documentation now says this in those words.

## Where it lives

- Branch `worktree-perf-record-8w-clarity` (local repo, D:\Development), on top of the @302 baseline.
- Design spec: `ps-dashboard/docs/specs/2026-10-15-perf-record-8w-clarity-design.md`.
- Tests: `tests/perf-record-8w-clarity-checks.js` (new, 104 checks); 17 suites green.
- Deploy note: bust the report cache after deploying — the goal counts and the full-week hours ride on the payload.
