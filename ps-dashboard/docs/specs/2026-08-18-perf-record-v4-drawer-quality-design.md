# Performance Record v4 — drawer quality wave (external review response)

**Date:** 2026-08-18 (2026.W34)
**Input:** external expert review (user-supplied), all 10 priorities accepted.
**Builds on:** v3 spec + the side-panel wave (`ceb5445..edcbbcb`).
**Files:** `ps-dashboard/PS Dashboard.html`, `ps-dashboard/tests/perf-record-checks.js`. No backend changes.

## Reality checks against the review (verified in code)

- Header/dots already share ONE derivation (per-cell sig/trend from the last two
  CLOSED buckets). The observed "green · steady" vs "86→86→83" contradiction is
  P2's bug: `detChartSVG_` plots the in-progress QTD point as a normal solid
  point. Fix the provisional rendering and P1 resolves — no second sentence
  builder exists to unify.
- Charts are inline SVG **by design** (html2canvas-clean, no canvas lifecycle).
  The review's Chart.js snippets are translated; its chart-leak item is n/a.
- Roboto / Roboto Condensed are already loaded; only drawer headings need the
  condensed face applied.
- URL state in a GAS web app must go through `google.script.history` /
  `google.script.url` (the app runs in an iframe; the parent URL is not ours).
- `localStorage` can throw inside the GAS iframe (privacy modes) — every access
  is try/catch-wrapped with in-memory fallback.

## P1+P2 — provisional periods, one truth (correctness first)

`detChartSVG_(pts, color, fmt, opts)`:
- Each pt may carry `partial: true`. Partial points render a **hollow marker**
  (fill `var(--card-bg)`, 2px colour stroke), the segment INTO them is
  **dashed**, the period label gains `· partial`, and the value label renders
  at `var(--muted)`.
- **Area fill removed entirely** (it read as accumulated volume).
- `opts.target` (number) draws a dashed horizontal reference line with a small
  right-aligned label (`opts.targetLabel`, default `target`); the y-domain
  expands to include it.
- Side padding 10 → 26 so first/last tick labels (FY26Q3 / FY27Q1) stop
  clipping; value labels clamp inside the viewBox.
- Callers: Score quarterly trend marks `partial` from `bucket.containsCurrent`
  and passes `target: PERF_BARS.score[coh].g`; RCR monthly marks the current
  calendar month partial (`perfRcrMonthKey_(m) === pMonthKey(currentWeekLabel)`)
  and passes `target: 2.5`. Overview-drill callers are untouched (opts optional).
- `perfHrsChartSvg_` bar mode: the in-progress bucket's bars render at
  opacity .45 with `⏳` in the x label (monthly "Aug 2026" case).
- Trend arrows/dots keep reading closed buckets only — now visually consistent
  with the charts.

## P3 — signed deltas (arrows carry magnitude)

New pure engine fn `perfDeltaTxt_(colId, prev, curr)`:
- numeric metrics only; `''` when either side is null/NaN or colId is
  categorical (kudos, pto, si);
- pct metrics (goals/tracked/planned) → signed points of %: `+6%` / `−12%`;
- score → `+3` / `−3`; rcr → `+0.2`.
`perfRowModels_` stores `cell.delta = perfDeltaTxt_(...)` from the same
prev/last closed values that feed the arrow. Rendered beside the arrow in the
drawer h4s and in the P5 chips: `↗ +2.1` with
`<span class="sr-only">rising</span>` for screen readers.

## P4 — push, don't overlay

- DOM: `#prPanel` moves from body level into the tab card as a flex sibling:
  `<div class="pr-workspace"> <div id="prBody" class="pr-scroll"> <aside id="prPanel" …>`.
- CSS (≥1281px, push mode):
  `.pr-workspace { display:flex; align-items:flex-start; }`
  `.pr-workspace > .pr-scroll { flex:1 1 auto; min-width:0; }`  ← load-bearing
  `.pr-panel { flex:0 0 var(--pr-panel-w, clamp(600px, 40vw, 900px));
    width: var(--pr-panel-w, clamp(600px, 40vw, 900px)); position:sticky;
    top:70px; max-height:calc(100vh - 240px); overflow-y:auto;
    border-left:1px solid var(--border); container-type:inline-size;
    container-name:drawer; }`
- `@media (max-width:1280px)` overlay mode: `position:fixed; inset:0 0 0 auto;
  width:min(92vw,720px); height:100vh;` + body scroll-lock class
  (`body.pr-locked{overflow:hidden}`) applied only in overlay mode;
  `html{scrollbar-gutter:stable}` so locking doesn't shift layout.
- **Drag handle**: 6px strip on the panel's left edge; pointer drag sets
  `--pr-panel-w` (clamped 480–1100px); double-click resets; width persisted to
  localStorage key `ps_pr_panel_w` (try/catch, in-memory fallback).
- `@media (prefers-reduced-motion: reduce) { .pr-panel { animation:none } }`.

## P7 — two-column drawer via container query

Replace the fixed `.pr-panel .pr-drill-grid { 1fr }` override with:
`@container drawer (min-width: 760px) { .pr-drill-grid
  { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .pr-block.span2 { grid-column: 1 / -1; } }`
Exception report and the Kudos feed get `span2`. Container query (not media)
so a user-dragged width reflows correctly.

## P5 — chip row spec (quarterly KPI blocks)

The `pr-kpib` row becomes two labelled groups:
- **Compliance**: Goals, Tracked, Planned, PTO. **Contribution**: RCR, Kudos, SI.
- Group label: sentence case, 12px/14px, `var(--slate)` — no ALL-CAPS micro-labels.
- Each chip: value + dot + `↗ +2.1`-style signed delta (P3), and a reference
  line under the value from `PERF_BARS`/policy: `target ≥85%`, `target 2.5`,
  `target 4/5`, PTO `Good = has a plan`, Kudos `give & receive`.
- Grid inside each group: `repeat(auto-fit, minmax(104px, 1fr))` — no orphans.

## P6 — dialog semantics & accessibility floor

- Panel: `role="dialog" aria-labelledby="prPanelTitle" tabindex="-1"`;
  `aria-modal` set by JS: `false` in push mode, `true` in overlay mode
  (matchMedia 1280px). Person's name becomes `<h2 id="prPanelTitle">` in
  Roboto Condensed — the primary element; "Open in Overview" demoted to a text
  link.
- Focus: on open, focus the panel; the triggering row is remembered
  (`STATE.prTrigger = norm`) and its name button refocused on close. Esc
  already closes.
- Rows: name wrapped in `<button class="pr-namebtn">` (native Enter/Space);
  click handling moves to ONE delegated listener on the tbody
  (`tr[data-norm]`), replacing per-row inline onclick.
- Table: `<th scope="col">`; the sorted header gets
  `aria-sort="descending|ascending"`.
- Dots: `role="img"` + `aria-label` (green/yellow/red/no data/not evaluated)
  plus a non-colour shape cue: green = filled circle, yellow = filled square
  (2px radius), red = diamond (rotated square), gray = ring, slate = ring.
- Sparklines: `aria-hidden="true"`; the flag summary already lives in the row
  tooltip.
- 📸 gets `aria-label="Export card as image"`; a new **Copy summary** button
  yields plain text (name · reading · chip values) via clipboard for
  Confluence-searchable promotion packets.
- Job code (`07.I4.1`) wrapped in `<abbr>` with a plain-language title.
- `:focus-visible` outlines on `.pr-seg button`, `.pr-kpi`, `.pr-namebtn`.

## P8 — table honesty

- **Score banding**: when sorted by score, divider rows label the signal bands
  (`Green band · ≥75`, `Watch · 50–74`, `Support · <50`) with a subtle
  background; SCORE header tooltip: "differences under 3 points are within
  measurement noise".
- **Sparklines**: bar width 3→6px (weekly is 9 buckets now — was the 30-bucket
  barcode driver), ~60px wide, fixed baseline kept.
- **Legend**: subtitle gains `· gray = not enough closed data · slate = shown,
  not evaluated` so the gray-dot row stops reading as broken.

## P9 — performance

- `perfModel_` memo already gives normalize-once for buckets; add
  `_prSvgCache` (sparkline markup keyed `norm:colId`, cleared whenever the
  model memo key changes) — ~1,000 SVG builds per render become lookups.
- Filter selects: `renderAll` calls from the 4 filter controls debounced at
  150ms into one rAF (single wrapper util `debounceRaf_`).
- Delegated row listener (P6) removes ~180 inline handlers per render.

## P10 — adoption & brand

- **URL state** via `google.script.history.replace` (`gran`, `emp`, `focus`)
  and restore on load from `google.script.url.getLocation`; guarded
  `typeof google !== 'undefined' && google.script.history`.
- **Print sheet**: `@media print` — panel becomes static full-width, nav/
  filters/table hidden, feed scroll caps removed. Promotion-packet ready.
- **Brand tokens**: semantic status tokens documented at `:root`
  (`--st-good:#00875A; --st-warn:#FF991F; --st-bad:#DE350B` — explicit
  extension, separate from brand tokens); **Kudos accents move to June
  `#FF9B87`** (feed ★, kudos block dot when informational) per Identity
  Lockdown; drawer h2 in Roboto Condensed + Void Blue; Orbe reserved for
  underline/links/icons.

## Testing

- Engine: `perfDeltaTxt_` checks (pct/score/rcr signs, categorical → '',
  null → '').
- Static: workspace flex + `min-width: 0` present; container query present;
  `role="dialog"` + `aria-sort` + `scope="col"` present; June token used for
  kudos; `@media print` block present; `detChartSVG_` has no area fill and has
  target-line support; localStorage access is try/catch-wrapped; delegated
  listener present (no per-row inline `togglePerfDrill_` in row HTML).
- All three suites + inline-script parse stay green.

## Deploy

Frontend-only; rides the pending Performance Record deploy (both PS files +
`PS_CACHE_VER`).
