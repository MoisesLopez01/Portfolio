# DH — Executive drill-through navigation + Overall column fix

**Date:** 2026-08-18 (2026.W34) · **Status:** Approved · **Surface:** `Dashboard.html` only (no payload / Code.js change)

## Problem

1. **"Overall · 67 missing" misread as total tickets.** The signals roster's Overall
   cell prints the SUM of per-field miss counts (`miss += g.miss` in
   `personSignalRows_`). A ticket missing two fields counts twice, so the number can
   exceed the person's ticket count, and it carries no noun. Managers read it as a
   ticket total — the same failure class that renamed the "n" column to "Issues"
   (2026-08-10).
2. **The Executive drill grid ends two clicks from the answer.** Clicking a row only
   selects a slice; the reader must then find the "Who is available →" / "What needs
   action →" buttons. The expectation (user 2026-08-18): touching a cell — e.g.
   ANZ × On-Time Delivery, EMEA × Forecast Accuracy, AMER × Availability Rate — goes
   straight to the people behind that number, pre-filtered.

## Decisions (user, 2026-08-18)

- Overall cell: **remove** the "· N missing" sub entirely (dot-only verdict). The
  summed miss count keeps driving the opportunity sort and stays in the CSV.
- Cell click **navigates immediately** (one click). Row-name click keeps today's
  select-toggle; the two header buttons stay as the select-first path.
- On-Time / Forecast / Quality land on **Actions with the Need-action chip pre-set**
  (`STATE.sigFilter = "bad"`), so only the slice's non-compliant people show.
- Workforce keeps the **existing collapsed per-rocketeer view** (pool × band cell
  drill-down); its three plain number columns are reformatted into a **stacked
  capacity bar** — planned first, available after, individual availability rate at
  the end.

## Design

### 1 · Overall cell (signals roster)

`renderRoster_`'s Overall cell renders `sigCellHtml_({ cls: r.overall, pct: null,
miss: 0 })` — dot only. Per-field cells are unchanged (their "· N missing" has the
column header as its noun and counts one field on one ticket once). Sort, CSV and
the Executive pulse counts are untouched. Any legend/tooltip text describing the
Overall column must not promise a count.

### 2 · Drill grid cells are one-click destinations

- New handler `drillGo_(rowIdx, metricId)` on every **value cell** (not the name
  cell): `event.stopPropagation()`; set the compare dimension's universal filter to
  the row's key (via the existing `DRILL_ROW_KEYS_` index indirection — never inline
  the category name); `STATE.metric = metricId`; apply per-metric landing state
  (below); `buildFilters_()`; `switchView_(dest)`.
- Destination map (client constant `DRILL_DEST_`):
  | metric | tab | landing state |
  |---|---|---|
  | `avail` | Workforce | auto-expand cells with sellable available hours |
  | `onTime`, `forecast`, `quality` | Actions | `STATE.sigFilter = "bad"` |
  | `planCov` | Actions | no chip — the roster's Plan column is the acting surface |
- Affordance: pointer cursor + hover highlight on the cell, tooltip naming the
  promise before the click, e.g. "See who in EMEA needs action on Forecast
  Accuracy →" / "See who in AMER is available →". A cell with no measurable value
  (—) is click-inert.
- Clicking a cell does NOT toggle the row selection; it sets the same filter the row
  select would, so returning to Executive shows the slice active (honest state, no
  surprise).

### 3 · Actions landing

Filters are universal, so the signals roster narrows to the slice for free. The
pre-set Need-action chip shows only people whose overall grade is red; the chip
strip renders on arrival so "All" is one click away. An empty result renders the
roster's existing named-filter empty state — never a blank table.

### 4 · Workforce landing + per-rocketeer stacked bar

- **Auto-expand:** `drillGo_('avail')` walks `filteredPeople_()` (after the filter is
  set) and sets `STATE.wfOpenCell[p.cell] = true` for every person with sellable
  available hours (> 0) in the head window — the names are on screen on arrival, no
  ▸ hunting. Cells stay individually collapsible afterwards.
- **Stacked bar (`wfCellPeopleRow_` reformat):** each person row replaces the three
  numeric columns with one bar + rate:
  - Bar length ∝ that person's capacity relative to the largest capacity among the
    listed people (hours comparable across rows).
  - Segment 1 = planned hours (theme fill), segment 2 = available hours (accent).
    Hour labels in/beside segments; exact numbers in the row tooltip.
  - Row ends with the individual availability rate = available ÷ capacity.
  - Non-sellable rows (🏖 on leave, 🌱 ramping, bench) draw the bar muted with no
    rate verdict — hours visible, never sellable.
  - Zero-capacity rows keep the "—" rule: nobody is free in a week they are not
    scheduled.
  - The sellable subtotal row and its caveat text are unchanged and keep reconciling
    against the pool × band cell above.

## Testing

- Render checks: Overall cell contains no "missing" text; drill value cells carry
  the handler + tooltip; name cell does not; `drillGo_` lands each metric on its
  mapped tab with the filter + chip state applied; stacked bar segments sum to the
  person's capacity; non-sellable rows carry no rate.
- Existing `_test_` suite must stay green (colspan discipline: the per-person table
  still spans the pool grid's rendered column count).

## Out of scope

Server/payload changes; per-region availability as a graded grid column beyond what
`availabilityFor_` already provides; any change to the two header drill buttons.
