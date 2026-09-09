# Items, not people · the roster follows the week · due-date pushes — design

**Date:** 2026-09-09 (2026.W37) · **Requested by:** the user (Services delivery lead) · **Status:** built, tests green, **not deployed**
**Code state:** schema **v49**, registry **4.4**, exporter **Jira Backlog.js v3.20.0**, node-tests green, render-smoke 1,798 checks
**Touches:** `Code.js`, `Dashboard.html`, `tests/delivery-health/*`, and the exporter `ps-dashboard/Jira Backlog.js` (hourly; the dashboard's only Jira feed)

---

## 1 · What was asked, in the user's words

1. *"Evaluate the performance on the overview based on **items not people** for the rate shown in On-Time Delivery and Forecast Accuracy."*
2. *"Forecast accuracy at epic level is **not doable** — epics take 2 or 3 quarters — show it based on **tasks or milestones scheduled for the week**."*
3. *"When week or month is selected we need to show the **current** month or week, so they get what is happening now."* On the current week the Actions tab shows **Open backlog**; on a past week it shows **Resolved · that week**, and each person's row lists the work they closed.
4. *"The Reset button should be next to More filters."*
5. PM signals: rename **unlinked** → **Without tasks**.
6. Add a PM signal for **work pushed during the evaluated week**, borrowing the slip engine from the `jira-1-signal` dashboard.

## 2 · Decisions

### 2.1 Items, not people (Overview cards)

The two outcome cards used to be attributed through people: an issue counted only if its assignee joined the roster *and* passed every filter. That is the roster's job. The Overview's job is "did the work land", so both cards now read **ITEMS**:

| | People read (roster, drill charts) | Items read (Overview cards) |
|---|---|---|
| Item with no roster assignee | dropped, counted as "excluded" | **counted** (person `""` bucket) |
| Population / Role / Job family / search | narrow | **do not narrow** — they describe people |
| Region / Team / PM (and the drill states) | narrow | narrow through the assignee; items that cannot be placed are **counted and disclosed**, never silently dropped |
| Interns' items | excluded (user rule 2026-08-04) | **still excluded** — that rule is about the published number, not the attribution |

Mechanics: `onTimeBuckets_(…, {keepUnattributed:true})` keeps the unattributed issues under `person: ""`; the client's `bucketsFor_(…, {items:true})` counts them unless a WHERE filter is active (`whereNarrowed_`), in which case `nUnplaced` carries the count and the card says so. Cards wear a new **ITEMS** scope tag. The people read is byte-for-byte what it was.

### 2.2 Forecast Accuracy at task grain (registry 4.4)

**Definition:** share of the non-epic items *scheduled* (due) in the period that finished by the **end of their committed week**.

- Week grain, not day grain — the managers' 2026-08-10 rule: a date is late only once its week has ended. A Tuesday date met on Thursday kept its week. (On-Time keeps its calendar-day read and its Dictionary scope; they are different questions.)
- Per week, keyed by **due week**: `nSched · nHit · nMiss · nLate · nPending`. `nPending` = the week has not ended and the item is not done — published on the current week, **never** a miss. Keyed by **resolved week**: `nRes · nResDated` = coverage (how much of the period's finished work ever carried a schedule).
- Epics excluded by definition. The old closed-epic estimate-variance buckets still ship (`forecastBuckets`) for audit; **no surface renders them**.
- Deviations recorded in the registry: mutable due date (a push before the week ends leaves the denominator — that is what §2.5 is for), open items ageing out of the export, the definition break at 2026-09-09.

### 2.3 Default window = the in-flight period; the roster follows it

`DEFAULT_WINDOW_ = "now"`: with no picker selection the analysis window is the current week / month / quarter *so far* (falls back to the last complete period when the payload has none). The picker's default entry names it ("◐ Current week — so far"); the separate "In progress" group is gone because it was the same window under a second name.

`syncTypePop_()` sets the roster's population from the window's phase — **Open backlog** on a current/planning window, **Resolved · &lt;week&gt;** on a complete one — on load, unit change, picker change and Reset. The chips still override for the current window.

**Resolved drill-down:** `resolvedByPerson_` (server) ships each person's resolved items by ISO week for the trailing `RESOLVED_ITEMS_WEEKS` (13), capped per person-week at `BACKLOG_MAX_ITEMS_ALL` with `listed` vs `count` stated. `resolvedDetailHtml_` (client) lists them misses-first with key · summary · belongs-to · type · resolved · due · on-time verdict · logged hours, one-click "open in Jira", and says plainly when the window is older than the horizon or the payload predates the field.

### 2.4 Reset beside More filters

Same id, same handler; moved from the title row (page controls) to the filter row (slice controls). The tooltip now also names the period selection it clears.

### 2.5 Due-date pushes — exporter v3.20.0 + PM tab

The `jira-1-signal` dashboard mines Jira changelogs live; this dashboard reads only the hourly export, so the export carries the facts:

- **Exporter:** new column 34 **"Due Push Log"** — every Due Date edit as `YYYY-MM-DD:from>to` joined by `;` ("" = changelog not fetched, `none` = never edited). A second narrow fetch, `fetchOpenEpicChangelog_`, expands changelog on **open epics** updated in the last `OPEN_EPIC_CHANGELOG_WEEKS` (13) and merges by key onto the "Open" rows. Facts, not verdicts: the export does not decide what a push is.
- **Server:** `parseDuePushLog_` (tristate) → `dhDuePushes_` keeps moves to a **later** date with their ISO week and days moved; each PM epic entry carries `pushes` (null = unmeasured); `pmOwned.pushCoverage` = {epics, measured}.
- **Client:** the PM tab's one **windowed** signal — pill "⏩ N pushed in 2026.W36", a Needs-action row, and "⏩ pushed +14d in 2026.W36" on the epic row — counted over the analysis window (`PM_WINDOW_`). Coverage is stated: nothing measured → "needs exporter ≥ 3.20.0"; partial → "measured on M of N epics"; a pre-v49 payload prints nothing.

### 2.6 Rename

`unlinked` → **without tasks** on the PM pill, the Needs-action row, the epic row and the caption. The finding is an epic with nothing broken down under it. The backlog-health panel's per-ticket "Not linked to a parent" is a different fact and is unchanged.

### 2.7 ✎ Changes tab (admins only)

A change register, `DH_CHANGES_` in `Code.js`, shipped impersonally as `meta.changes` and rendered by
`renderChanges_` on a new admin-gated view (`VIEWS` id `changes`, before Access). One row per
**impactful** change — one that moves a published number, changes what a number means, or changes
what a reader does on a tab — written as "Change #001 — Title", the request as made, the solution,
what it still needs, and a status in the request's own three words: **solved · under review · to do**.
Grouped To do → Under review → Solved so the open items lead. Numbered in request order, never reused;
the register starts at #001 with the 2026.W37 batch. Status changes are a code edit by design: the
register is the dev-side record, not a ticket queue.

### 2.8 Resolved drill-down: needs-action first, with status

The user's rule: *"if the cell says 3/10 we show everything, sorted by the 3 that need action, with
the actual status."* Each resolved item now carries `gaps` — the same four fields the roster cells
grade on the resolved half (due date · estimate · time logged · epic link) plus *late* — and the row
lists **every** item with a Needs-action column and its Jira status, most reasons first, then the
biggest logged effort. The summary line states "N of M listed need action (sorted first)". Every
person in the filtered Region / Team / PM is listed, as before.

### 2.9 Planning windows removed from the picker (user, same day)

`PLAN_WEEKS_AHEAD_` is 0: the "Planning · next 2 weeks" group, and with it the planned-coverage
grammar on the outcome cards, no longer render. The code stays behind that one number (the render
harness turns it back to 2 for the blocks that exercise the grammar), so the windows can return if
weekly planning becomes a practice.

## 3 · Deploy order and what moves on deploy

1. **Exporter first or together** (`ps-dashboard/Jira Backlog.js` v3.20.0). The header change makes the first light run do one **full rewrite** of Jira Raw (schema-drift guard), then hourly merges resume. Until it runs, the PM tab says pushes are not measured.
2. Dashboard `Code.js` + `Dashboard.html`, then bump the cache (schema v49 strands v48 entries).
3. **Numbers that move:** On-Time may move either way (unattributed items now count). Forecast Accuracy changes meaning entirely — the trend carries a definition-changed marker at 2026-09-09. The default window becomes the current period, so the first screen shows "so far" numbers with the ◐ chip.

## 4 · Open follow-ups (not done, on purpose)

- Forecast Accuracy stays **margin-gated** (`canSeeMargin_`). The new definition carries no financial data, so opening it to every role is reasonable — a visibility change the user should call.
- The Tier-3 drill charts and comparison bars still attribute both metrics through people (`METRICS_` accessors), so a per-person bar can differ from the ITEMS card by exactly the unattributed items. Stated here; a person-less breakdown would need an issue-side Region/Team, which the export still leaves blank (PR-01).
- Pushes are recorded for **epics** only. Task-level pushes would need the open-backlog fetch to carry changelog for every open issue — a cost decision for the exporter owner.
