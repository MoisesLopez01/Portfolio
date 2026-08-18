# Performance Record v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 10 priorities of the external drawer review — provisional-period truth, push-not-overlay drawer with container-query 2-col layout, spec'd chip row, dialog a11y, score banding, render caches, URL state, print sheet, brand tokens.

**Architecture:** One file (`PS Dashboard.html`) + checks. Pure additions (`perfDeltaTxt_`) go inside the ⟦PERF-ENGINE⟧ sentinels; `detChartSVG_`, panel DOM/CSS, and render wiring stay outside. Charts remain inline SVG.

**Spec:** `ps-dashboard/docs/specs/2026-08-18-perf-record-v4-drawer-quality-design.md`

**Verified-already-done (no task):** filter debounce (`applyFilters` has a 150ms timer); Roboto faces loaded; header/dot single derivation (fixed by the partial-period rendering).

---

### Task 1: Red checks

Append to `ps-dashboard/tests/perf-record-checks.js` before the summary lines — engine checks for `perfDeltaTxt_` (guarded with `typeof`), plus static assertions:

```js
// ── v4: perfDeltaTxt_ ────────────────────────────────────────────────────────
ck('delta pct +6%',   typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('goals', 0.80, 0.86) === '+6%');
ck('delta pct −12%',  typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('tracked', 0.92, 0.80) === '-12%');
ck('delta score −3',  typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('score', 86, 83) === '-3');
ck('delta rcr +0.2',  typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('rcr', 2.0, 2.2) === '+0.2');
ck('delta zero → ""', typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('score', 80, 80) === '');
ck('delta categorical → ""', typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('kudos', 1, 2) === '');
ck('delta null → ""', typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('score', null, 80) === '');

// ── v4: static assertions ────────────────────────────────────────────────────
ck('workspace flex + min-width 0', /\.pr-workspace > \.pr-scroll \{ flex: 1 1 auto; min-width: 0; \}/.test(html));
ck('panel width clamp',            html.indexOf('clamp(600px, 40vw, 900px)') >= 0);
ck('container query drawer',       html.indexOf('@container drawer (min-width: 760px)') >= 0);
ck('chart area fill removed',      !/path d="' \+ area/.test(html));
ck('chart target line support',    /opts\.target != null/.test(html));
ck('panel is a dialog',            /role="dialog"/.test(html));
ck('aria-sort present',            /aria-sort="/.test(html));
ck('th scope col',                 html.indexOf('<th scope="col"') >= 0);
ck('row delegation (no inline row onclick)', !/tr class="pr-row[^>]*onclick/.test(html));
ck('kudos wears June',             /pr-star\s*\{\s*color:\s*var\(--june\)/.test(html));
ck('print sheet present',          html.indexOf('@media print') >= 0);
ck('localStorage guarded',         /try \{ localStorage/.test(html) || /try \{\s*\n?\s*.*localStorage/.test(html));
ck('reduced motion respected',     /prefers-reduced-motion: reduce\) \{ \.pr-panel/.test(html));
ck('scroll gutter stable',         html.indexOf('scrollbar-gutter: stable') >= 0);
```

Run (expect red), commit `test(ps): perf-record v4 checks (red)`.

### Task 2: Charts tell the truth (P1–P3)

1. **`perfDeltaTxt_`** — engine, after `perfRcrMonthKey_`:

```js
// Signed delta for trend arrows (spec v4 P3) — same closed prev/last pair that
// feeds the arrow, so glyph and magnitude can never disagree. Categorical
// metrics and zero-change return '' (the arrow alone says "flat").
function perfDeltaTxt_(colId, prev, curr) {
  if (colId === 'kudos' || colId === 'pto' || colId === 'si') return '';
  if (prev === null || prev === undefined || curr === null || curr === undefined) return '';
  if (typeof prev !== 'number' || typeof curr !== 'number' || isNaN(prev) || isNaN(curr)) return '';
  var isPct = colId === 'goals' || colId === 'tracked' || colId === 'planned';
  var d = isPct ? Math.round((curr - prev) * 100)
        : colId === 'rcr' ? Math.round((curr - prev) * 10) / 10
        : Math.round(curr - prev);
  if (!d) return '';
  return (d > 0 ? '+' : '-') + Math.abs(d) + (isPct ? '%' : '');
}
```

2. `perfRowModels_`: after `trend`, add `delta: (ne || c.id === 'si') ? '' : perfDeltaTxt_(c.id, prevVal, lastVal),` and render it in the drill block h4 (`+ (c.delta ? ' <span class="pr-delta">' + c.delta + '</span>' : '')`) with CSS `.pr-delta { font-size: 10px; color: var(--slate); font-weight: 700; }`.

3. **`detChartSVG_`** — full replacement: pts accept `partial: true` (hollow marker `fill:var(--card-bg)` + 2px stroke, dashed lead-in segment, `· partial` label suffix, muted value label); area fill deleted; `padL/padR` 10→26; new `opts = { target, targetLabel }` drawing a dashed slate reference line with an end-anchored caption, domain expanded to include it. Per-segment `<line>` elements replace the single path (so one segment can dash).

4. Callers: score quarterly trend pts gain `partial: buckets[i].containsCurrent` and `opts { target: PERF_BARS.score[row.coh === 'mgr' ? 'mgr' : 'ic'].g, targetLabel: 'green' }`; RCR monthly pts gain `partial: perfRcrMonthKey_(m) === pMonthKey(DATA.meta.currentWeekLabel)` and `opts { target: PERF_BARS.rcr.ic.g, targetLabel: 'green' }`; RCR block text "target 2.5" → "green ≥2 · scale caps at 2.5" (aligns text with the signal source).

5. `perfHrsChartSvg_` bar mode: in-progress bucket's group renders `opacity=".45"` and its x label gains `⏳`.

Run checks, commit `feat(ps): provisional periods, target lines, signed deltas — charts match the dots`.

### Task 3: Push-not-overlay drawer + container-query 2-col (P4, P7)

1. HTML: wrap `#prBody` and move `#prPanel` (from ~line 2035) inside the tab card:

```html
<div class="pr-workspace">
  <div id="prBody" class="pr-scroll"></div>
  <aside id="prPanel" class="pr-panel" role="dialog" aria-modal="false"
         aria-labelledby="prPanelTitle" tabindex="-1" style="display:none"></aside>
</div>
```

2. CSS: replace the fixed `.pr-panel` block with push-mode flex + sticky, overlay `@media (max-width:1280px)`, `container-type: inline-size; container-name: drawer;`, drag handle strip, `@container drawer (min-width: 760px)` 2-col grid with `.pr-block.span2` full-width (replaces `.pr-panel .pr-drill-grid { 1fr }`), `html { scrollbar-gutter: stable; }`, `body.pr-locked { overflow: hidden; }`, `@media (prefers-reduced-motion: reduce) { .pr-panel { animation: none; } }`.

```css
.pr-workspace { display: flex; align-items: flex-start; }
.pr-workspace > .pr-scroll { flex: 1 1 auto; min-width: 0; }
.pr-panel { flex: 0 0 var(--pr-panel-w, clamp(600px, 40vw, 900px));
  width: var(--pr-panel-w, clamp(600px, 40vw, 900px));
  position: sticky; top: 70px; max-height: calc(100vh - 240px); overflow-y: auto;
  background: var(--card-bg); border-left: 1px solid var(--border);
  padding: 14px 16px; animation: prPanelIn .18s ease-out;
  container-type: inline-size; container-name: drawer; position: relative; }
```
   (sticky + relative conflict: use `position: sticky` on the panel and put the
   drag handle inside with `position:absolute; left:0; top:0; bottom:0; width:6px;
   cursor: col-resize;` — the panel itself gets `position: sticky`.)

3. Drag: `.pr-drag` div prepended in `renderPerfPanel_`; one delegated pointerdown listener (installed once) resizes via `--pr-panel-w` clamped 480–1100px; dblclick resets; width persisted through `prStore_(k, v)` (try/catch localStorage, in-memory fallback object `_prMem`).

4. `renderPerfPanel_` sets `aria-modal` from `matchMedia('(max-width:1280px)')`, toggles `body.pr-locked` only in overlay mode while open, focuses the panel on open (`p.focus()` after render when newly opened), and `closePerfPanel_` refocuses the opener row's name button.

Run checks, commit `feat(ps): push-not-overlay drawer — resizable, container-query 2-col`.

### Task 4: Chip row spec (P5)

Quarterly `kpib` block → two labelled groups:

```js
var CHIP_REF = {
  goals:   function(b) { return 'target ≥' + Math.round(b.g * 100) + '%'; },
  tracked: function(b) { return 'target ≥' + Math.round(b.g * 100) + '%'; },
  planned: function(b) { return 'target ≥' + Math.round(b.g * 100) + '%'; },
  rcr:     function(b) { return 'green ≥' + b.g; },
  si:      function(b) { return 'target ' + b.g + '/5'; },
  kudos:   function()  { return 'give & receive'; },
  pto:     function()  { return 'Good = has a plan'; },
};
```

Each chip: value + dot + `↗ +2.1` (cell.delta with `<span class="sr-only">`), reference line under the value in 11px slate. Group wrapper: sentence-case 12px label + `display:grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px;`. Compliance = goals/tracked/planned/pto; Contribution = rcr/kudos/si.

Run checks, commit `feat(ps): quarterly chips — labelled groups, targets, signed deltas`.

### Task 5: A11y floor (P6)

- Rows: `<tr class="pr-row" data-norm="...">` (no inline onclick); name becomes `<button class="pr-namebtn">`; one delegated click listener on `#prBody` (installed once, guard flag). CSS `.pr-namebtn { background:none;border:none;padding:0;font:inherit;cursor:pointer } .pr-namebtn:focus-visible { outline:2px solid var(--orbe); outline-offset:2px }`.
- `th()` gains `scope="col"`, `aria-sort` on the active key, and a noise-band `title` on the score header.
- `prDot_(sig, extraTitle)` helper returns the dot span with `role="img"` + `aria-label`; shape cues in CSS: `.pr-dot.y { border-radius:3px }`, `.pr-dot.r { border-radius:2px; transform:rotate(45deg) }`, `.pr-dot.m`, `.pr-dot.n` become rings (transparent bg, 2px border, box-sizing border-box). Used in `perfCellHtml_`, drill h4s, chips.
- Panel header: name → `<h2 id="prPanelTitle" class="pr-title">`; "Open in Overview →" becomes a text link (`.pr-link`); 📸 gets `aria-label="Export card as image"`; new **Copy summary** button → plain text (name, title, reading, per-metric `label value (signal, delta)`) via `navigator.clipboard.writeText` with textarea fallback.
- Job code token wrapped in `<abbr title="Job code — family FF, level LL">`.
- Focus rings on `.pr-seg button:focus-visible`, `.pr-kpi:focus-visible`.
- Sparklines already `aria-hidden` (`.pr-svg` has `aria-hidden="true"` — verify, add if missing).

Run checks, commit `feat(ps): drawer dialog semantics, keyboard rows, dot shapes + labels`.

### Task 6: Table honesty (P8)

- Banding when `STATE.prSort.key === 'score'`: divider rows (`<tr class="pr-band"><td colspan="cols.length+1">`) at band changes — `Green band · score ≥75` / `Watch band · 50–74` / `Support band · <50` / `No score yet`; CSS subtle background + 10px caps label.
- Sparklines: `perfBarsSvg_` bar width `dense ? 3 : 6` → `6` (param kept for signature stability).
- Subtitle legend appends ` · gray = not enough closed data · slate = shown, not evaluated`.

Run checks, commit `feat(ps): score bands, legible sparklines, gray-dot legend`.

### Task 7: Render cache (P9)

`_prCellsCache = { key: null, map: {} }` — per-row `<td>` cells markup keyed by `normName`, invalidated when `_perfModelMemo.key` changes (sort/filter/focus reuse it; granularity/team/payload changes rebuild). Wire into the row loop.

Run checks, commit `perf(ps): per-row cell markup cache — sparklines build once per model`.

### Task 8: URL state, print, brand (P10)

- `prSyncUrl_()` → `google.script.history.replace(null, {gran, emp, focus}, '')` guarded by `typeof google !== 'undefined' && google.script && google.script.history`; called from `prSetGran_`, `togglePerfDrill_`, `closePerfPanel_`, `prFocusSet`. `prRestoreUrl_()` runs once at boot via `google.script.url.getLocation` and seeds STATE.
- `@media print` block: hide header/filter-bar/tab-nav/table-pane/actions; panel static full-width, `max-height:none`, feeds unclamped, grid pinned 2-col.
- Brand: `:root` gains documented status tokens `--st-good/--st-warn/--st-bad`; `.pr-dot`/`.pr-heat` colours move onto them; kudos ★ wrapped in `<span class="pr-star">★</span>` with `.pr-star { color: var(--june); }`; `.pr-title` in Roboto Condensed + Void Blue.

Run ALL suites + inline-script parse, commit `feat(ps): URL state, print sheet, status tokens + June kudos`.

### Task 9: Wrap-up

Update memory (v4 section), verify tree clean, report. Manual QA stays with the user: drag-resize, push vs overlay at 1280px, keyboard walk, print preview, screenshots.
