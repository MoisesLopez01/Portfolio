# Performance Record v3 — density, layout and export enhancements

**Date:** 2026-08-18 (2026.W34)
**Builds on:** v1 (`2026-08-18-performance-record-tab-design.md`) and the v2 wave
(commits `6a3f6a0`, `643d786`, `c2e80d4`).
**Files touched:** `ps-dashboard/PS Dashboard.html`, `ps-dashboard/tests/perf-record-checks.js`.
No backend changes.

## Scope decisions (user-approved 2026-08-18)

- **Full 2-quarter record is kept in every granularity** — the point of the tab is
  trend reading across 2 closed quarters + QTD. The originally proposed 8–12-week
  sliding window is REJECTED. Legibility at ~30 weekly buckets is solved by chart
  mechanics (§F), not by dropping data.
- Weekly is a secondary lens; monthly/quarterly are primary. The default
  granularity is already `'quarter'` (`STATE.prGranularity`, PS Dashboard.html
  ~line 2167) — verified, no change.
- Drill layout keeps v2's severity ordering, flowing into a 2-column grid
  (user chose "severity flow" over fixed placement).
- Charts stay **inline SVG** — v2's deliberate decision (html2canvas captures them
  cleanly, no canvas lifecycle). "Switch chart type" is implemented in the SVG
  builders, not by introducing Chart.js here.

## Already shipped in v2 — verified, NOT re-built

- Legend lives in the header ⓘ tooltip (`.pr-info`, ~line 1961).
- Every signal cell carries a value-vs-target tooltip (`perfThresholdTip_`).
- Informational severity palette: kudos renders neutral (`n` slate), never red;
  missing = gray `m`; exceptions = slate "shown, not evaluated".
- Export buttons are icon-sized with a busy state (`c2e80d4`).

## A. Manager's Brief → KPI focus cards

`perfBriefHtml_` renders a flex row (`.pr-kpis`, wraps on narrow screens) of five
clickable cards instead of the text ribbon:

| Card | Count predicate (over unfocused rows) | Accent |
|---|---|---|
| Total | all rows | void/neutral |
| Critical | `r.reds > 0` | red (the ONLY red card) |
| Watch | `r.reds === 0 && r.yellows > 0` | amber |
| Burnout risk | `r.burnout` | blue |
| Not fully evaluated | `r.hasException` | slate |

Card anatomy: big count over a small uppercase label, left accent border,
`title` tooltip carrying the category definition (reuse the v2 chip tips).

Focus state machine: new `STATE.prFocus` ∈
`null | 'critical' | 'watch' | 'burnout' | 'exceptions'`.
- Clicking a card sets the focus; clicking the active card or **Total** clears it.
- Active card gets a `.on` ring; the subtitle appends the focus name.
- Card counts are computed from `rows` (pre-focus), so cards never shrink to
  their own filter.
- The old chips' `onclick` focus hack (both chips forcing flagged-only) is
  superseded and removed.
- `exportPerfCsv_` applies the same prFocus filter so the CSV matches the
  visible table; the CSV notes mention the focus when set.

### ⚑ Flagged-only is REMOVED (user amendment 2026-08-18)

Managers decide from the colour signals; a binary flagged filter adds nothing.
- Delete the header chip (`#prFlaggedChip`), `STATE.prFlaggedOnly`, and every
  reference (chip toggle, shown-rows filter, subtitle suffix, empty-state note,
  CSV note). KPI cards are the only focus mechanism.
- **Default sort becomes top performers**: `STATE.prSort` initialises to
  `{ key: 'score', dir: 'desc' }`. Any column header click re-sorts as today.
- The ⚑ flag-count COLUMN stays — it feeds the KPI-card counts, remains a sort
  target, and gains the §B tooltip.

## B. Flag-column tooltips

The ⚑ cell in each row gains a `title` naming the offending metrics, built by a
new **pure engine function** `perfFlagTip_(cells)`:

- Input: the row's cells array (`[{col:{id,label}, sig, notEval}]`).
- Output: `"Red: Tracked, Goals · Yellow: PTO — hover each signal for its value
  vs target"`; empty string when no reds/yellows. Not-evaluated cells never
  appear (they carry no signal).
- Lives inside the ⟦PERF-ENGINE⟧ sentinels (it touches no DATA/STATE/DOM) and is
  unit-checked in `perf-record-checks.js`.

## B2. Goals grace period (user amendment 2026-08-18)

Weekly `goalsDetail.compliant` snapshots don't know about the goals grace
window (`CONFIG_PS.GOALS_GRACE_DAYS = 21`), so the first ~3 weeks of every
quarter can show unfair red goals bars while people are still (re)writing goals.

Rule: **a grace week counts only when compliant** — grace never penalizes,
never withholds credit:
- Grace weeks = the first 3 `weekLabels` of every quarter bucket
  (data-driven from `periodBucketsForEmp_('quarter')`, mirroring the 21-day
  backend constant; frontend constant `PERF_GOALS_GRACE_WEEKS = 3` with a
  comment pointing at `CONFIG_PS.GOALS_GRACE_DAYS`).
- `perfBucketAgg_(weekRows, graceLabels)` gains an optional Set/map param
  (stays sentinel-pure — the caller passes it in): a week in `graceLabels`
  with `goalsHasData && !goalsOk` is treated as **no goals data** for the
  bucket's `goals` / `goalsWeeks` / `goalsCompliant`. Compliant grace weeks
  count normally.
- `perfModel_` builds the grace-label set once per model and threads it through.
- Effects cascade for free: weekly grid bars render gray (no data) instead of
  red during grace; monthly/quarterly ratios exclude non-compliant grace
  weeks; the drill goals chart inherits the same numbers.
- `perfThresholdTip_`'s goals text gains "· quarter-start grace weeks count
  only when compliant".
- **`computeRkScore` is NOT touched** — it feeds Top Rocketeers scoring;
  grace handling here is a Performance Record display rule only.

## C. Expanded profile → severity-flow grid

- `perfDrillHtml_` wraps the metric blocks in `<div class="pr-drill-grid">`.
- CSS: `.pr-drill-grid { display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 12px 18px; margin-top: 10px; }` and
  `@media (max-width: 900px) { .pr-drill-grid { grid-template-columns: 1fr; } }`.
- Blocks keep the v2 severity sort (red → yellow → green → info) and flow
  row-major — worst signal is always top-left.
- `.pr-block` becomes a mini-card: `border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 12px; margin-top: 0;` replacing the dashed
  top border. `min-width: 0` + `overflow-x: auto` so a wide SVG scrolls inside
  its cell rather than blowing up the grid (tables scroll, never compress).
- Identity line, exception chips, and the reading note stay full-width above
  the grid. Dark-mode: block background follows the existing `.pr-drill` dark
  override; border uses the dark border token.

## D. PTO block → compliance line + per-WEEK heatmap strip

User amendment 2026-08-18 clarified the PTO model — two parts are VERIFIED,
already correct, and must not be re-built:
- **100h threshold**: the backend flags At Risk only above
  `CONFIG_PS.PTO_BALANCE_THRESHOLD = 100` hours (below → automatically Good).
  No change.
- **Latest week wins**: `perfBucketAgg_` already sets the bucket signal from
  the last known week (`pto: lastNonNull('ptoNorm')` — "state at bucket close,
  not the share"), so a compliant latest week turns the whole quarter's dot
  green. No change.

What changes — the drill block replaces the per-bucket Good/At-Risk `<table>`:

- Summary line: `Good X of Y evaluated weeks (Z%)` over the record — counts
  weeks with a PTO snapshot (`emp.weeks[label].ptoHealth`), X those with
  `status === "Good"`. The current week is excluded (never judge an open week).
- Heatmap strip: one `<span class="pr-heat ...">` square **per WEEK across the
  full record** — NOT per bucket — so a spotted out-of-compliance week stays
  visible even when the quarter-level signal is green (~12×12px, 2px gap,
  inline-flex row that wraps):
  - `.g` green = Good, `.r` red = At Risk, `.m` gray = no snapshot,
  - the current week gets `opacity:.35` (faded in-progress convention),
  - each square carries `title="<week label> — Good/At Risk/no data"`, plus the
    backend's `ptoHealth.reason` string when present (e.g. "12mo 85%
    taken/planned · past 6mo 60%").

## E. SVG chart upgrades

New pure engine helper `perfTickStep_(n, maxTicks)`:
`return n <= maxTicks ? 1 : Math.ceil(n / maxTicks);` — unit-checked.

`perfHrsChartSvg_(buckets, per)`:
- **Bar mode (n ≤ 15)** — unchanged grouped bars, plus each group gains an SVG
  `<title>` ("2026.W20 — tracked 32h / planned 40h").
- **Line mode (n > 15)** — two polylines on the shared 0–max scale: tracked
  solid `#058CDC` (2px), planned `#7E97B8` dashed (1.5px). Points get invisible
  hover targets (`<circle r="6" fill="transparent">` with `<title>`). No
  per-point value text. X-labels only every `perfTickStep_(n, 10)`-th bucket.
  Legend line below adapts: "— tracked · ┄ planned".
- Missing buckets (null) break the polyline (segments split), never plotted as 0.

`perfGoalsChartSvg_(buckets, per)`:
- Keeps bars at every n (compliance share is inherently discrete) but applies
  `perfTickStep_(n, 10)` to x-labels and to the per-bar `x/y` value text; every
  bar gains a `<title>` with label + `compliant/weeks`.

Both charts: the `<svg>` element gets
`style="width:100%;max-width:{2·W}px;height:auto"` so it fills its grid column
(viewBox already present, aspect preserved).

## F. Snapshot print mode

`savePerfSnapshot_` wraps the capture:
- Before `html2canvas`: `el.classList.add('pr-print')`.
- CSS: `.pr-drill.pr-print { max-width: 820px; }` and
  `.pr-drill.pr-print .pr-drill-grid { grid-template-columns: repeat(2, 1fr); }`
  (pins 2 columns even if the live viewport was narrow).
- After capture — in BOTH the `.then` and `.catch` paths — the class is removed
  alongside the existing button-visibility restore.
- The whole-grid PNG (`exportPerfGridPNG_`) is unchanged.

## G. RCR — per-month values (user amendment 2026-08-18)

Today every RCR bucket repeats the payload's single current value
(`computeRkScore` reads `emp.rcr.value`), so the monthly view shows a flat
line even though `meta.rcrByEmployee[norm][monthName]` carries the full
monthly history (already used by the Trends drill's "RCR — monthly" chart).

- New pure engine helper `perfRcrMonthKey_(name)`: RCR sheet header
  `"Jul 25"` → month-bucket key `"2025-07"`; unparseable → `null`. Unit-checked.
- `perfModel_` (glue, outside the engine): after aggregating each employee's
  buckets, override `agg.rcr` per bucket from the monthly history — collect the
  bucket's distinct `pMonthKey(weekLabel)`s, take the LAST month with data
  (state at bucket close, matching `lastNonNull`); employees with no monthly
  history keep the existing current-value fallback.
- Effect: monthly buckets show their own RCR; quarterly shows quarter-close
  RCR; the dot/trend arrows become real month-over-month movement.
- Drill RCR block: "RCR — monthly" with the current value line plus the
  existing `detChartSVG_` line chart over the employee's monthly points
  (same reuse as the Overview drill) when ≥2 points exist.
- `computeRkScore` and the score weighting are NOT touched — RCR in the score
  keeps the current-value semantics.

## Error handling

- `perfFlagTip_` / `perfTickStep_` are total functions over their inputs (empty
  arrays, n=0 → safe outputs; checked).
- Focus filter with a stale `prFocus` value (e.g. from a future rename) falls
  through to "no filter" — predicate lookup defaults to `null`.
- Line mode with < 2 plottable points in a series draws just the hover targets
  (no polyline) rather than erroring.

## Testing

1. `perf-record-checks.js`: new checks for `perfFlagTip_` (red+yellow mix, only
   reds, empty, notEval exclusion), `perfTickStep_` (n≤max → 1, 26→3, 34→4,
   0→1), and `perfBucketAgg_` grace behaviour (non-compliant grace week
   excluded from goalsWeeks; compliant grace week counted; no graceLabels param
   → behaviour unchanged); sentinel purity re-verified automatically (helpers
   use no DATA/STATE/document/window).
2. Static assertions (same file, outside the eval'd engine block): `.pr-kpis`
   markup present, `pr-print` class added AND removed in `savePerfSnapshot_`,
   `.pr-drill-grid` CSS present with a ≤900px collapse, `prFlaggedOnly` and
   `prFlaggedChip` fully absent, `prSort` initialises to score/desc.
3. `responsive-checks.js` + `fiscal-window-checks.js` stay green.
4. Manual QA: weekly view at ~30 buckets shows a legible line chart in the
   drill; KPI cards filter and un-filter; PTO strip hover titles; snapshot PNG
   ≤ 820px wide with 2-column grid; dark mode; CSV matches the focused view.

## Deploy

Rides the already-pending Performance Record deploy: push **both PS files** and
bump `PS_CACHE_VER` (v1/v2 shipped payload-shape changes; v3 itself is
frontend-only).
