# PS Contribution Report — Performance Record and filter bar (2026.W41)

**Status:** built and tested locally on 2026-10-10 (2026.W41). Not pushed and not deployed.
Push, deploy and the GTT ticket are scheduled for 2026.W42 (Oct 12–18); see "Pending" at the end.
**Branch:** `worktree-perf-record-merge-filterbar` (local worktree `D:\Development\.claude\worktrees\perf-record-merge-filterbar`).
**Approved mock:** https://claude.ai/artifact/8kRY1KSxaaJV8R9yDa5D2r (approved 2026-10-10).

## Summary

- **Leading Behaviours and Performance Record are now one tab, Performance Record.** It is the third item in the menu, after Team Radar. The Leading Behaviours tab is gone from the menu; old links to it open Performance Record.
- **The ranking is always on screen.** Managers pick a person from the ranked list on the left and read that person's card on the right, without leaving the list.
- **Each person's card explains performance in plain English.** It covers the evaluated week, the last closed month and the last closed quarter, the full history by week, month or quarter, and the facts worth raising in a 1:1.
- **The filter bar takes far less space and stays usable on every screen.** On a laptop it now takes 111 px (was 228 px) and 50 px while scrolling. On a phone it takes 104 px (was 575 px, most of the screen).

## Why

Two problems were reported:

1. **The filter bar.** It used two labelled rows on a laptop and stacked every filter on a phone, so on a 390 px phone the pinned bar covered 575 of 844 px. It did not get smaller when scrolling. On ultra-wide screens the filters ran along the far left while the data sat centred, so the two did not line up.
2. **Two tabs for one question.** Leading Behaviours showed the ranking for one week as cards. Clicking a person sent the manager to the Overview tab. Performance Record had the history but no ranking. A manager who wanted to know "how is this person doing, week to week, month to month, quarter to quarter" had to move between tabs and read signal grids.

## What changed

### 1. One tab: Performance Record

The menu now reads: Overview, Team Radar, **Performance Record**, Trends, Team Executive Brief.

At the top of the tab:

- **People / Team grid.** "People" is the new default layout, with the list and the card. "Team grid" is the existing signal grid, unchanged, for anyone who wants every person and every measure on one table.
- **Evaluated week / Weekly / Monthly / Quarterly** decides what the list ranks by:
  - Evaluated week: one week, chosen in the drop-down. The last closed week is the default.
  - Weekly: the average of the last 8 closed weeks.
  - Monthly: the last closed month.
  - Quarterly: the last closed quarter.
- **Four counters:** ranked, Strong (75+), On track (50–74), Needs a look (under 50). Clicking a counter filters the list to that band.

The list shows each person's rank, score, change against the previous period and a 13-week trend line. It follows the Leading Behaviours rule that people in ramp-up (first 3 months) and on extended leave are not ranked; they are listed separately at the bottom. On a laptop the list stays pinned beside the card while the card scrolls.

### 2. The person card

The card is written to be read top to bottom in under a minute.

| Part | What it says |
|---|---|
| **The short version** | One plain sentence on whether the person is steady, improving or slipping over the last 13 closed weeks. Under it: what they do most consistently, their biggest recurring gap (and the month it clustered in), and RCR against its bar. |
| **Week / Month / Quarter tiles** | The score for the evaluated week, the last closed month and the last closed quarter, each with the change against the period before and one sentence of what happened (hours logged against planned, goals, kudos, RCR, rank in the current view). Clicking a tile switches the view to that grain. |
| **Worth asking about** | Facts from the last 4 weeks that repeat, for example "Logged time was under target in 3 of the last 4 weeks (W37, W38, W40)." They are observations for a 1:1; the manager draws the conclusions. |
| **Context** | What changes how to read the numbers: PTO weeks (targets were reduced to match), ramp-up, crew, no time-tracking mandate, weeks with no data. |
| **History** | A score chart and a table of every measure for every week, month or quarter. Green = met, blue = close, orange = missed, grey = no data or not evaluated. |
| **Full evidence** | The existing detailed record (exception report, week-by-week table, hours charts, PTO strip, kudos feed), folded by default. |

**Copy summary** copies the whole card as plain text for a 1:1 note or Confluence. On a phone, tapping a name opens the card full screen, and "All people" returns to the list.

Example of a card's opening, from the sample data used for testing:

> Chloe's score has dropped over the last month: the last 4 weeks averaged 74, down from 83 the 4 weeks before. Still on track overall; the direction is what stands out.
> - Most consistent: Chloe kept goals up to date in 11 of 13 weeks.
> - Biggest gap: logged time was under target in 8 of 13 weeks, mostly in September.

### 3. Top bar and filters

This builds on the one-row header and filter bar approved earlier on 2026-10-10 (branch `ps-dash/compact-topbar`). That branch puts search, member type and supervisor inline; location, job title, family and level sit behind **More filters**, whose number shows how many of those are active. On top of that:

- **When scrolling,** the title row folds away and only the filter row stays pinned. Scrolling back to the top brings it back.
- **On wide and ultra-wide screens,** the header and filters line up with the data column instead of running edge to edge.
- **On phones (720 px and narrower):**
  - The menu rail no longer takes a permanent column; it opens from a ☰ button.
  - The bar shows only search and one **Filters** button. Its number counts every active filter.
  - Filters open as a sheet from the bottom of the screen, with a "Show N Rocketeers" button.
- Esc closes the sheet and the menu.

| Screen | Pinned top bar before | After, at the top | After, while scrolling |
|---|---|---|---|
| Laptop, 1440 × 900 | 228 px | 111 px | 50 px |
| Ultra-wide, 2560 × 1080 | — | 131 px, aligned with the data | — |
| Phone, 390 × 844 | 575 px | 104 px | 57 px |

No screen width scrolls sideways.

## Screenshots

Taken with sample data (made-up names and numbers), in `img/2026-W41/`:

| Before | After |
|---|---|
| `before-leading-behaviours-1440.png` | `after-performance-record-1440.png` |
| `before-performance-record-1440.png` | `after-monthly-lens-1440.png` (full page, Monthly view) |
| `before-phone-390.png` | `after-phone-list-390.png`, `after-phone-filters-390.png`, `after-phone-menu-390.png`, `after-phone-card-390.png` |
| — | `after-scrolled-1440.png`, `after-ultrawide-2560.png` |

## Decisions taken while building

- **Score bands are 75 / 50, not 75 / 45.** Leading Behaviours coloured scores at 75 and 45; Performance Record already judged scores at 75 and 50. One tab cannot carry two rules, so the merged tab uses Performance Record's 75 / 50. The old 45 cut-off disappears with the Leading Behaviours tab.
- **The signal grid stays, as "Team grid".** Nothing it offered is lost; "People" is the new default.
- **Active filters show as a count on the button, not as removable chips.** The mock showed chips. The one-row bar approved the same day marks active filters with a count and a colour change. That costs no extra row, so it was kept.
- **Built on the approved compact top bar** instead of a second implementation. That branch was merged in, and the phone, scroll and alignment behaviour was added on top.
- **The ranking population is unchanged.** As before, ramp-up and extended leave are listed but not ranked.

## What did not change

- **No server code changed.** The tab reads the same report data as before. Who sees whom (org tree, pinned team, self-exclusion) is still decided on the server, so no one gains access to anyone new.
- Scoring weights, metric definitions and the Team Executive Brief, Radar, Trends and Overview tabs are unchanged.
- The in-app Documentation tab gained a section, "Performance Record — how to read it". The Access Control page's description of the Admin role was corrected: Admins have had Performance Record since 2026.W36.

## How it was checked

- **Automated checks:** 10 test suites, all passing. The Performance Record suite grew to 186 checks, including 48 new ones for the merged tab and its plain-English text. Examples: a slipping person reads as "Slipping"; a single missed week is not raised as a 1:1 topic; PTO weeks and ramp-up appear under Context; crew are never judged on goals. The layout suite has 52 checks, including new ones for the scroll fold, the phone sheet, the phone menu and the wide-screen alignment.
- **Rendered in a browser** with sample data at 390, 1440 and 2560 px wide. This covered the list, the card, every view, the filter sheet, the phone menu and scrolling, and caught and fixed four layout bugs on the way:
  - the list sat one top-bar-height too low
  - the phone filter sheet sat behind its own backdrop
  - the newest weeks of the history table were off screen
  - on a phone, when the team selector (Services / R&D / Sales) is visible, the header overflowed sideways and hid the title; the selector now takes its own line. Found by rendering a synthetic demo with three teams
- **Not yet checked:** the real payload with real names, the live Google Apps Script environment, and dark mode. These are part of next week's steps.

## Pending for 2026.W42

1. Create the GTT ticket for this enhancement and attach this report.
2. Review the branch and screenshots. Decide whether to keep the 75 / 50 bands (see Decisions).
3. Push the branch.
4. Before `clasp push`, run `clasp pull` into a scratch folder and compare it with the branch, because files are sometimes edited in the Apps Script editor. Then push and publish with `clasp deploy -i <deploymentId>`.
5. Check the live dashboard with real data at laptop and phone widths, in light and dark mode, as an admin and as a manager.
6. Tell managers that Leading Behaviours now lives inside Performance Record.

## Commits (local)

| Commit | What |
|---|---|
| `cb3da20` | Baseline: snapshot of the deployed working copy (W37 sidebar, Radar, Contribution Intelligence) |
| `ca13608` | Leading Behaviours folded into Performance Record; Performance Record third after Team Radar |
| `278b0ab` | People layout: ranked list and plain-English card |
| `34500d2` | Merge of the approved one-row header and filter bar (`ps-dash/compact-topbar`) |
| `a9f72d9` | Top bar: folds on scroll, aligns on wide screens, phone menu and filter sheet |
| `ca87184` | This report, the design spec, the in-app Documentation section, the render harness |
| `439571f` | Phone header: team selector on its own line (no sideways overflow) |
