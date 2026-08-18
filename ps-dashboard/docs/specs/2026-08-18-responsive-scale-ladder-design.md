# Responsive Scale Ladder — PS Dashboard screen-size adaptivity

**Date:** 2026-08-18 (2026.W34)
**File touched:** `ps-dashboard/PS Dashboard.html` only
**Reference implementation:** `delivery-health-dashboard/Dashboard.html` (fluid `--scale` token, lines 77–85)

## Problem

PS Dashboard handles small screens well (768/640/480 breakpoints, scrollable tab nav,
stacking grids) but stops growing at 1440px: `main` is capped at `max-width:1600px` and
the only upward notch is a single `@media(min-width:1440px)` block (body 16px + two grid
widenings). On 1920–3440px screens the dashboard renders as a fixed-size column floating
in empty margin — small text, wasted space.

## Decision (user-approved 2026-08-18)

Port the Delivery Health dashboard's **`--scale` token ladder**, including Chart.js text
scaling. Explicitly rejected:

- `body{zoom}` — broke Chart.js hover in GDash (`fixCanvasHoverUnderZoom_` saga); PS has
  7+ Chart.js canvases plus html2canvas PNG export. Too much blast radius.
- Full rem refactor — hundreds of declarations plus inline styles inside JS template
  strings; high regression risk for the same visual outcome.

## Design

### 1. Scale ladder (CSS, immediately after the `:root` token block)

```css
:root { --scale: 1; }
@media(max-width:420px){:root{--scale:.94}}
@media(min-width:1024px){:root{--scale:1.08}}
@media(min-width:1440px){:root{--scale:1.16}}
@media(min-width:1920px){:root{--scale:1.28}}
@media(min-width:2560px){:root{--scale:1.4}}
@media(min-width:3440px){:root{--scale:1.5}}
```

Same steps as DH — proven values, no invention.

### 2. Multiplier application — Typography Lift section only

The existing "TYPOGRAPHY LIFT" section (late in the cascade, by design) already
centralizes the visible type tiers. Every tier there becomes `calc(Npx * var(--scale))`:

- `body` 15px; tiers 11/12/13/14/15px; header h1 18px; `.header-btn` 13px;
  `.tab-btn` 13px; `.perf-header-bar h2`, `.team-brief-head h3`, `.perf-week-pill`,
  `.week-badge` equivalents already in the lift.
- Chrome dimensions join the lift section as new late-cascade overrides (the file's own
  convention — "rules placed last in the cascade so they win"): `.kpi-value` (28px),
  `.kpi-card` padding (20px), filter control heights (36px), `.emp-table` cell padding,
  `.tab-btn` padding, `.nav-menu-btn` size, header padding.
- Original declarations earlier in the file are **not edited** — the lift overrides them,
  exactly as it does today.

### 3. Width growth

- `main { max-width: calc(1600px * var(--scale)); }` — identical at laptop (scale 1);
  ~2048px at 1920, ~2240px at 2560, ~2400px at 3440.
- `.kpi-grid` → `repeat(auto-fit, minmax(220px, 1fr))` — min deliberately
  **unscaled** and `auto-fit`, not `auto-fill`. **Amendment 2026-08-18** (QA
  screenshot): scaling the min grew it as fast as the container, so the track
  count never increased and the last KPI card orphaned onto a second row. An
  unscaled min converts gained width into more columns; `auto-fit` collapses the
  spare empty columns so a full KPI set stretches into ONE row on wide screens.
  Multi-row layouts on narrower screens are unchanged (auto-fit collapses only
  fully empty columns).
- `.perf-grid` minmax → `calc(280px * var(--scale))` (its base), widened by the ladder
  instead of the old hand-tuned 310px notch.
- The existing `@media (min-width: 1440px)` typography block (body 16px + `.perf-grid` /
  `.kpi-grid` widening) is **deleted** — the ladder supersedes it; keeping both would
  double-scale.

### 4. Chart.js text scaling

- New helper next to the chart-theme code (NOT inside the Performance Record
  sentinel-pure engine region — the helper touches `document`, which that region
  forbids):

```js
function csz_(n) {
  var s = parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue("--scale")) || 1;
  return Math.round(n * s);
}
```

- Every hardcoded `font: { size: N }` in chart configs (~30 sites: ticks, axis titles,
  legends, datalabels, radar pointLabels) becomes `font: { size: csz_(N) }`.
- Sizes are computed at chart build time. Charts rebuild on tab switch / renderAll, so
  crossing a breakpoint mid-session updates on the next render. No resize listener —
  deliberate: zero new event plumbing, zero hover risk.

### 5. Deliberately unchanged

- **Downward breakpoints (768/640/480)** stay as-is. They sit after the lift tiers in
  the cascade, so their fixed-px phone overrides keep winning on small screens. The
  ≤420 `--scale:.94` only shrinks rules with no explicit phone override.
- **Chart canvases**: no zoom, no transform — hover and html2canvas PNG export
  unaffected. Chart *area* grows because cards grow.
- **JS-generated inline-px content** (drill tables, Data Reference tables): already in
  `overflow-x:auto` wraps; they gain width from the wider `main`. Tables scroll, never
  compress (standing rule).
- **Dark mode**: colour-only overrides — orthogonal to sizing.

## Error handling

`csz_` falls back to scale 1 if the CSS variable is missing/unparsable (`|| 1`), so a
stripped-CSS context (PNG export clone, tests) degrades to today's exact sizes.

## Testing

1. `node ps-dashboard/tests/perf-record-checks.js` and
   `node ps-dashboard/tests/fiscal-window-checks.js` stay green (sentinel-pure engine
   must not gain `document`/`window` tokens).
2. Manual QA in DevTools responsive mode at 420 / 768 / 1024 / 1440 / 1920 / 2560 /
   3440: text and grids grow, `main` fills, tab bar scrolls on phone, tables scroll
   horizontally rather than compress.
3. Chart hover tooltips work at every width; ⬇ PNG export renders correctly; dark mode
   at 1920+.
4. Tests are blind to layout — render and screenshot before calling it done
   (standing feedback).

## Deploy

Frontend-only: redeploy the web app with the new `PS Dashboard.html`. **No
`PS_CACHE_VER` bump needed** — the report cache stores data JSON, not HTML. (Bump only
if this ships bundled with pending data-shape changes.)
