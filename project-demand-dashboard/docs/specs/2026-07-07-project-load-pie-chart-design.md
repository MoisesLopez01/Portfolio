# Project Load Distribution — Side-by-Side Pie Chart

**Date:** 2026-07-07 (2026.W28)
**File touched:** `project-demand-dashboard/Dashboard.html` (only)
**Feature:** Add a pie chart to the right of the existing "Project load distribution
(whole quarter)" bar list, showing each tier's share (%) of people. Slices are
clickable filters, identical in behavior to the bar rows.

---

## Context

`blendDistChart_(allPeople, personQtdUniqueProjectCount)` (Dashboard.html ~line 1080)
renders a `.blend-chart` card containing four clickable rows — 1 / 2 / 3 / 4+ projects —
each with a horizontal fill bar and a person count. Clicking a row toggles the
`AVAIL_BLEND` tier filter and re-renders via `renderAvailability()`. Colors come from
the shared `SPARK_COLORS` palette so the chart reads as one system with the per-person
sparklines above it.

The dashboard already hand-rolls inline SVG for its other charts (no chart library);
the pie follows the same pattern.

## Decisions made

- **Approach:** hand-rolled inline SVG pie inside the existing card (no library,
  no `conic-gradient`).
- **Interactivity:** slices are clickable and toggle the same filter as bar rows.
- **Labels:** percentage printed inside each slice when it fits; thin slices rely on
  hover tooltip. Tier names/counts are NOT repeated on the pie — they already sit on
  the bar rows to the left.

## Layout

Inside `blendDistChart_()`:

```
.blend-chart
  .blend-chart-title            (unchanged text)
  .blend-body                   (NEW: display:flex; align-items:center; gap:16px; flex-wrap:wrap)
    .blend-bars   flex:1        (existing rows, unchanged)
    .blend-pie    flex:none     (NEW: fixed-size SVG pie, ~110–130px square)
```

- Pie sits on the right, vertically centered next to the bars (matches user's mock).
- On narrow widths the pie wraps below the bars (`flex-wrap:wrap`).

## Pie rendering

A new private helper (e.g. `blendPieSvg_(counts, total)`) returns the SVG string:

- For each tier 1–4 with `n > 0`, compute `pct = n / total` and draw a `<path>` arc
  slice from cumulative angles, filled with `SPARK_COLORS[tier-1]`.
- **Edge cases:**
  - A tier at 100% (single non-zero tier): arc math degenerates at 360° — draw a
    `<circle>` instead of a path.
  - Zero-count tiers: no slice, no label.
  - `total` is already guarded (`allPeople.length || 1`) upstream.
- Percent label: `Math.round(pct*100) + '%'` as `<text>` at the slice's mid-angle
  centroid (~60% of radius). Text color chosen per slice fill for contrast — light
  tiers (`#bfdbfe`, `#60a5fa`) get dark text, dark tiers (`#2864e6`, `#0f1941`) get
  white text.
- Slices under ~7% omit the printed label (too thin) — the tooltip carries the info.
- Every slice gets `<title>` hover text: `"{tier label} — {n} people · {pct}%"`.

## Interactivity

- Each slice carries the **identical** onclick as its bar row:
  `AVAIL_BLEND = (isActive ? 0 : tier); AVAIL_OPEN = null; renderAvailability()`,
  plus `cursor:pointer`.
- Active-filter treatment (when `AVAIL_BLEND === tier`):
  - Active slice: stroke in `var(--orbe)` (matching `.blend-bar-row.active` outline)
    plus a slight radial "pull-out" offset along its mid-angle.
  - Non-active slices: slightly dimmed (e.g. `opacity:.45`).
- No extra state management: `renderAvailability()` re-renders the whole card, so pie
  and bars stay consistent automatically.

## CSS additions (~15 lines)

- `.blend-body` — flex row wrapper.
- `.blend-pie` — fixed sizing, `flex:none`.
- Slice hover affordance (e.g. `opacity` nudge) and `%` label typography
  (`font-size` scaled with `var(--scale)` like neighboring elements).

## Out of scope

- No backend / `Code.js` changes; data source is the same `counts` object.
- No change to the card title text or the bar rows themselves.
- No chart library, no changes to other charts.

## Testing

Manual, in the served dashboard (and `_preview.html` if applicable):

1. Pie renders right of bars, colors match sparkline key and bar rows.
2. Percentages across visible slices sum to ~100% (rounding tolerance).
3. Click each slice → same filtering result as clicking the corresponding bar row;
   clicking the active slice clears the filter.
4. Active slice shows orbe outline + pull-out; others dim; bar row `.active` state
   agrees.
5. Edge cases: all people in one tier (full circle renders, still clickable);
   a tier with 0 people (no slice, no gap artifact); thin slice <7% (no printed
   label, tooltip works).
6. Narrow viewport: pie wraps below bars without horizontal overflow.
