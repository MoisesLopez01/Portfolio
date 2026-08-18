# Performance Record v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KPI focus cards replace the brief ribbon (flagged-only dies, Score-desc default sort), goals respect the grace window, the drill becomes a 2-column severity grid with a per-week PTO heatmap, SVG charts switch to line mode past 15 buckets, and snapshots capture in a compact print mode.

**Architecture:** All frontend, one file (`ps-dashboard/PS Dashboard.html`) plus its check script. Pure logic (`perfFlagTip_`, `perfTickStep_`, `perfBucketAgg_` grace param) goes inside the ⟦PERF-ENGINE⟧ sentinels (no DATA/STATE/document/window tokens — the checks eval that region). DOM/render logic stays outside.

**Tech Stack:** GAS HtmlService SPA, inline SVG charts, html2canvas, plain-node check scripts.

**Spec:** `ps-dashboard/docs/specs/2026-08-18-perf-record-v3-enhancements-design.md`

---

## Landmarks in `PS Dashboard.html` (line numbers drift as tasks land — anchor by content)

- Perf CSS block: lines ~720–773 (`/* ── 📈 Performance Record tab ── */`)
- Tab header HTML with `#prFlaggedChip`: ~1959–1975
- `STATE` init (`prGranularity`/`prFlaggedOnly`/`prSort`/`prExpanded`): ~2167–2170
- `perfRowModels_` / `perfSortRows_`: ~3007–3083
- `perfBriefHtml_`: ~3156; `renderPerfRecordTab_`: ~3198; `savePerfSnapshot_`: ~3336
- `perfHrsChartSvg_` ~3287; `perfGoalsChartSvg_` ~3312; `perfDrillHtml_` ~3362
- `exportPerfCsv_`: ~3455
- Engine sentinels: `⟦PERF-ENGINE-START⟧` ~3806 → `⟦PERF-ENGINE-END⟧` ~4014
  (`perfBucketAgg_` ~3865, `perfThresholdTip_` ~3980 are INSIDE)
- `_perfModelMemo` + `perfBucketsFor_` + `perfModel_`: ~4020–4056

### Task 1: Red checks

**Files:**
- Modify: `ps-dashboard/tests/perf-record-checks.js` (append before the final summary/exit lines)

- [ ] **Step 1: Append engine checks** (use `typeof` guards so missing functions count as failures instead of crashing the script). Find the file's final block (it prints pass/fail and exits) and insert BEFORE it:

```js
// ── v3: perfFlagTip_ ─────────────────────────────────────────────────────────
function mkCell(label, sig, notEval) { return { col: { id: label.toLowerCase(), label: label }, sig: sig, notEval: !!notEval }; }
ck('flagTip red+yellow mix', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Tracked','r'), mkCell('Goals','r'), mkCell('PTO','y')]) ===
   'Red: Tracked, Goals · Yellow: PTO — hover each signal for its value vs target');
ck('flagTip reds only', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Tracked','r'), mkCell('Goals','g')]) ===
   'Red: Tracked — hover each signal for its value vs target');
ck('flagTip empty when clean', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Goals','g'), mkCell('PTO','m')]) === '');
ck('flagTip skips notEval', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Tracked','r', true), mkCell('PTO','y')]) ===
   'Yellow: PTO — hover each signal for its value vs target');

// ── v3: perfTickStep_ ────────────────────────────────────────────────────────
ck('tickStep n<=max → 1', typeof perfTickStep_ === 'function' && perfTickStep_(8, 10) === 1);
ck('tickStep 26 → 3',     typeof perfTickStep_ === 'function' && perfTickStep_(26, 10) === 3);
ck('tickStep 34 → 4',     typeof perfTickStep_ === 'function' && perfTickStep_(34, 10) === 4);
ck('tickStep 0 → 1',      typeof perfTickStep_ === 'function' && perfTickStep_(0, 10) === 1);

// ── v3: perfBucketAgg_ goals grace ───────────────────────────────────────────
function mkGoalsRk(ok) {
  return { score: 50, trackedHrs: null, plannedHrs: null, ptoNorm: null,
           goalsHasData: true, goalsOk: ok, goalsNorm: ok ? 1 : 0,
           kudosCount: 0, kudosGivenCount: 0, trackedNorm: 0, plannedNorm: 0,
           rcrVal: null, siVal: null };
}
var graceRows = [ { label: '2026.W1', rk: mkGoalsRk(false) },
                  { label: '2026.W2', rk: mkGoalsRk(true)  },
                  { label: '2026.W5', rk: mkGoalsRk(false) } ];
var gAgg = perfBucketAgg_(graceRows, { '2026.W1': true, '2026.W2': true });
ck('grace non-compliant week excluded', gAgg.goalsWeeks === 2);
ck('grace compliant week counted',      gAgg.goalsCompliant === 1);
ck('post-grace red still counts',       gAgg.goals === 0.5);
var gAggNone = perfBucketAgg_(graceRows);
ck('no graceLabels → unchanged',        gAggNone.goalsWeeks === 3 && gAggNone.goalsCompliant === 1);

// ── v3: perfRcrMonthKey_ ─────────────────────────────────────────────────────
ck('rcrMonthKey Jul 25 → 2025-07', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('Jul 25') === '2025-07');
ck('rcrMonthKey Dec 26 → 2026-12', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('Dec 26') === '2026-12');
ck('rcrMonthKey case/space tolerant', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('  jan 27 ') === '2027-01');
ck('rcrMonthKey junk → null', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('Total FY26') === null);

// ── v3: goals grace tooltip ──────────────────────────────────────────────────
ck('goals tip mentions grace', /grace weeks count only when compliant/.test(perfThresholdTip_('goals', 'ic', 0.5)));

// ── v3: static markup/state assertions (whole file, not the engine eval) ─────
ck('prFlaggedOnly fully removed', !/prFlaggedOnly/.test(html));
ck('prFlaggedChip fully removed', !/prFlaggedChip/.test(html));
ck('default sort = score desc',   /prSort:\s*\{ key: "score", dir: "desc" \}/.test(html));
ck('KPI card row present',        html.indexOf('class="pr-kpis"') >= 0);
ck('drill grid CSS present',      html.indexOf('.pr-drill-grid { display: grid; grid-template-columns: repeat(2, 1fr)') >= 0);
ck('drill grid collapses ≤900',   /@media \(max-width: 900px\) \{ \.pr-drill-grid \{ grid-template-columns: 1fr; \} \}/.test(html));
ck('PTO heat squares present',    html.indexOf('class="pr-heat ') >= 0);
ck('print mode added',            html.indexOf("classList.add('pr-print')") >= 0);
ck('print mode removed',          (html.match(/classList\.remove\('pr-print'\)/g) || []).length >= 2);
ck('print mode CSS clamps width', /\.pr-drill\.pr-print \{ max-width: 820px/.test(html));
ck('RCR monthly join wired',      html.indexOf('perfRcrMonthKey_(') >= 0 && /agg\.rcr = /.test(html));
```

- [ ] **Step 2: Run to verify the new checks fail** — `node "ps-dashboard/tests/perf-record-checks.js"`. Expected: the original 84 still pass, the ~23 new ones fail, exit 1.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/tests/perf-record-checks.js"
git commit -m "test(ps): perf-record v3 checks (red)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: KPI focus cards + flagged-only removal + Score-desc default

**Files:** Modify `ps-dashboard/PS Dashboard.html` (header HTML, STATE, CSS, `perfBriefHtml_`, `renderPerfRecordTab_`, `exportPerfCsv_`)

- [ ] **Step 1: Delete the header chip.** Remove these two lines from the tab header (~1966):

```html
          <span class="pr-chip" id="prFlaggedChip"
                onclick="STATE.prFlaggedOnly=!STATE.prFlaggedOnly;renderPerfRecordTab_()">⚑ Flagged only</span>
```

- [ ] **Step 2: STATE init** (~2167). Old:

```js
  prGranularity: "quarter",   // Performance Record: 'week' | 'month' | 'quarter'
  prFlaggedOnly: false,       // Performance Record: show only rows with ≥1 red/yellow dot
  prSort:        { key: "flags", dir: "desc" },  // 'flags' | 'name' | a metric col id
```

New:

```js
  prGranularity: "quarter",   // Performance Record: 'week' | 'month' | 'quarter'
  prFocus:       null,        // Performance Record: KPI-card focus — 'critical'|'watch'|'burnout'|'exceptions'|null
  prSort:        { key: "score", dir: "desc" },  // top performers first; any header click re-sorts
```

- [ ] **Step 3: CSS — replace the brief/chips with KPI cards.** Replace (~722–728):

```css
.pr-brief { font-size: 12px; color: var(--text); background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; }
.pr-bchip { display: inline-block; border-radius: 10px; padding: 1px 8px; font-weight: 700; cursor: pointer; }
.pr-bchip.r { background: #FFEBE6; color: #BF2600; }
.pr-bchip.y { background: #FFFAE6; color: #B65C00; }
.pr-bchip.b { background: #EEF4FF; color: #0D3B8C; cursor: help; }
.pr-bchip.n { background: #F1F5F9; color: #64748b; cursor: help; }
```

with:

```css
/* KPI focus cards (spec v3 §A) — the row IS the filter UI: click to focus, click
   again (or Total) to clear. Red accent is reserved for Critical. */
.pr-kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.pr-kpi { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  min-width: 92px; padding: 8px 12px; background: var(--card-bg); border: 1px solid var(--border);
  border-left-width: 3px; border-radius: 8px; cursor: pointer; font-family: inherit; text-align: left; }
.pr-kpi b { font-size: 18px; font-weight: 900; color: var(--void); line-height: 1; }
.pr-kpi span { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--slate); }
.pr-kpi.on { outline: 2px solid var(--orbe); outline-offset: 1px; }
.pr-kpi.c-t { border-left-color: var(--void); }
.pr-kpi.c-r { border-left-color: #DE350B; }
.pr-kpi.c-y { border-left-color: #FF991F; }
.pr-kpi.c-b { border-left-color: #0D3B8C; }
.pr-kpi.c-n { border-left-color: #94A3B8; }
```

Then update the dark-mode line (~768). Old:

```css
body.dark-mode .pr-brief { background: #16214A; }
body.dark-mode .pr-bchip.n, body.dark-mode .pr-xchip { background: #1E2A4A; color: #94A3B8; }
```

New:

```css
body.dark-mode .pr-kpi { background: #16214A; }
body.dark-mode .pr-kpi b { color: #FFFAF5; }
body.dark-mode .pr-xchip { background: #1E2A4A; color: #94A3B8; }
```

Also remove the now-orphaned `.pr-chip` rules ONLY if nothing else uses `pr-chip` — grep first (`grep -n 'pr-chip' "ps-dashboard/PS Dashboard.html"`); if the class survives elsewhere, leave the CSS.

- [ ] **Step 4: Replace `perfBriefHtml_` with the card row + focus state.** Replace the whole function (~3153–3167, including its comment) with:

```js
// KPI focus cards (spec v3 §A): counts always come from the UNFOCUSED row set,
// so a card never shrinks to its own filter. Clicking toggles STATE.prFocus.
var PERF_FOCUS = {
  critical:   { label: 'critical',            f: function(r) { return r.reds > 0; } },
  watch:      { label: 'watch',               f: function(r) { return r.reds === 0 && r.yellows > 0; } },
  burnout:    { label: 'burnout risk',        f: function(r) { return r.burnout; } },
  exceptions: { label: 'not fully evaluated', f: function(r) { return r.hasException; } },
};
function prFocusSet(k) {
  STATE.prFocus = (!k || STATE.prFocus === k) ? null : k;
  renderPerfRecordTab_();
}
function perfKpisHtml_(rows) {
  var CARDS = [
    { k: '',           n: rows.length,                                  lbl: 'Total',               cls: 'c-t', tip: 'All rocketeers in the current filters — click to clear the focus' },
    { k: 'critical',   n: rows.filter(PERF_FOCUS.critical.f).length,    lbl: 'Critical',            cls: 'c-r', tip: 'At least one red signal — click to focus the list' },
    { k: 'watch',      n: rows.filter(PERF_FOCUS.watch.f).length,       lbl: 'Watch',               cls: 'c-y', tip: 'Yellow signals only, no reds — click to focus the list' },
    { k: 'burnout',    n: rows.filter(PERF_FOCUS.burnout.f).length,     lbl: 'Burnout risk',        cls: 'c-b', tip: 'PTO At-Risk while tracking at or above target in the last closed period — click to focus' },
    { k: 'exceptions', n: rows.filter(PERF_FOCUS.exceptions.f).length,  lbl: 'Not fully evaluated', cls: 'c-n', tip: 'Carrying an exception (no time mandate, ramp-up, crew, on leave) — some metrics shown but not evaluated — click to focus' },
  ];
  return '<div class="pr-kpis">' + CARDS.map(function(c) {
    var on = c.k && STATE.prFocus === c.k;
    return '<button class="pr-kpi ' + c.cls + (on ? ' on' : '') + '" title="' + esc(c.tip) + '"' +
      ' onclick="prFocusSet(\'' + c.k + '\')"><b>' + c.n + '</b><span>' + esc(c.lbl) + '</span></button>';
  }).join('') + '</div>';
}
```

- [ ] **Step 5: `renderPerfRecordTab_` rewires.** Four edits inside the function:

(a) Remove the chip toggle (~3212):

```js
  var chip = document.getElementById('prFlaggedChip');
  if (chip) chip.classList.toggle('on', STATE.prFlaggedOnly);
```

(delete both lines).

(b) Shown-rows filter (~3217). Old:

```js
  var shown = STATE.prFlaggedOnly ? rows.filter(function(r) { return r.flagged; }) : rows;
```

New:

```js
  var focus = STATE.prFocus && PERF_FOCUS[STATE.prFocus] ? PERF_FOCUS[STATE.prFocus] : null;
  var shown = focus ? rows.filter(focus.f) : rows;
```

(c) Subtitle (~3229). Old:

```js
    (STATE.prFlaggedOnly ? ' (flagged only)' : '') +
```

New:

```js
    (focus ? ' (' + focus.label + ' focus)' : '') +
```

(d) Brief call sites (~3238 and ~3274): replace `perfBriefHtml_(rows)` with `perfKpisHtml_(rows)` in BOTH, and update the empty-state line. Old:

```js
  if (!shown.length) html = perfBriefHtml_(rows) +
    '<p class="pr-sub" style="margin-top:8px">No rocketeers match the current filters' +
    (STATE.prFlaggedOnly ? ' and the Flagged-only chip' : '') + '.</p>';
```

New:

```js
  if (!shown.length) html = perfKpisHtml_(rows) +
    '<p class="pr-sub" style="margin-top:8px">No rocketeers match the current filters' +
    (focus ? ' and the ' + focus.label + ' focus' : '') + '.</p>';
```

- [ ] **Step 6: `exportPerfCsv_` (~3458).** Old:

```js
  var shown = STATE.prFlaggedOnly ? rows.filter(function(r) { return r.flagged; }) : rows;
```

New:

```js
  var focus = STATE.prFocus && PERF_FOCUS[STATE.prFocus] ? PERF_FOCUS[STATE.prFocus] : null;
  var shown = focus ? rows.filter(focus.f) : rows;
```

And extend the filename so a focused export says so (~3492). Old:

```js
  a.download = 'performance-record-' + STATE.prGranularity + '-' +
    ((DATA.meta && DATA.meta.currentWeekLabel) || 'export') + '.csv';
```

New:

```js
  a.download = 'performance-record-' + STATE.prGranularity + (focus ? '-' + STATE.prFocus : '') + '-' +
    ((DATA.meta && DATA.meta.currentWeekLabel) || 'export') + '.csv';
```

- [ ] **Step 7: Verify no `flagged`/`prFlaggedOnly` orphans**

```bash
grep -n 'prFlaggedOnly\|prFlaggedChip\|pr-bchip\|perfBriefHtml_' "ps-dashboard/PS Dashboard.html"   # expect no hits
grep -c 'flagged:' "ps-dashboard/PS Dashboard.html"   # r.flagged stays in perfRowModels_ (harmless) — 1 hit OK
```

- [ ] **Step 8: Run checks** — `node "ps-dashboard/tests/perf-record-checks.js"`. Expected: the 4 flagged/sort/KPI static checks now pass; engine + drill/print checks still red.

- [ ] **Step 9: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): perf-record KPI focus cards — flagged-only removed, score-desc default

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `perfFlagTip_` + ⚑ column tooltip

**Files:** Modify `ps-dashboard/PS Dashboard.html` (engine region + row render)

- [ ] **Step 1: Add the engine helper.** Inside the sentinels, directly after `perfReadingNote_`'s closing brace (~3921), insert:

```js
// ⚑-column tooltip (spec v3 §B): names the flagged metrics so the count
// explains itself. Not-evaluated cells never appear — they carry no signal.
function perfFlagTip_(cells) {
  var reds = [], yels = [];
  cells.forEach(function(c) {
    if (c.notEval) return;
    if (c.sig === 'r') reds.push(c.col.label);
    else if (c.sig === 'y') yels.push(c.col.label);
  });
  if (!reds.length && !yels.length) return '';
  var parts = [];
  if (reds.length) parts.push('Red: ' + reds.join(', '));
  if (yels.length) parts.push('Yellow: ' + yels.join(', '));
  return parts.join(' · ') + ' — hover each signal for its value vs target';
}
```

- [ ] **Step 2: Use it in the row render.** In `renderPerfRecordTab_`'s row loop, the ⚑ cell (~3262). Old:

```js
      '<td>' + (r.reds ? '<span class="pr-dot r"></span>' + r.reds : '') +
```

New:

```js
      '<td title="' + esc(perfFlagTip_(r.cells)) + '">' + (r.reds ? '<span class="pr-dot r"></span>' + r.reds : '') +
```

- [ ] **Step 3: Run checks** — the 4 `flagTip` checks pass. **Step 4: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): perf-record flag-column tooltip names the offending metrics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Goals grace period

**Files:** Modify `ps-dashboard/PS Dashboard.html` (`perfBucketAgg_`, `perfThresholdTip_` — engine; `perfModel_` — glue)

- [ ] **Step 1: `perfBucketAgg_` gains the optional grace param.** Change the signature + goals lines (~3865). Old:

```js
function perfBucketAgg_(weekRows) {
  var rows = weekRows.filter(function(r) { return r.rk && !perfWeekIsEmpty_(r.rk); });
```

New:

```js
// graceLabels (optional): { weekLabel: true } — quarter-start grace weeks (spec
// v3 §B2). A non-compliant grace week is treated as NO goals data (grace never
// penalizes); a compliant one counts normally (grace never withholds credit).
function perfBucketAgg_(weekRows, graceLabels) {
  var rows = weekRows.filter(function(r) { return r.rk && !perfWeekIsEmpty_(r.rk); });
```

Old goals lines (~3884):

```js
  var goalsRows = rows.filter(function(r) { return r.rk.goalsHasData; });
```

New:

```js
  var goalsRows = rows.filter(function(r) {
    if (!r.rk.goalsHasData) return false;
    return !(graceLabels && graceLabels[r.label] && !r.rk.goalsOk);
  });
```

- [ ] **Step 2: goals tooltip mentions grace.** In `perfThresholdTip_` (~3994), old:

```js
  var isPct = metricId === 'goals' || metricId === 'tracked' || metricId === 'planned';
```

stays; change the two RETURN lines at the end. Old:

```js
  if (b.y === -Infinity) return head + ' — ' + barName + ': green ≥' + f(b.g) + ' · below is yellow · never red';
  return head + ' — ' + barName + ': green ≥' + f(b.g) + ' · yellow ≥' + f(b.y) + ' · below is red';
```

New:

```js
  var graceNote = metricId === 'goals' ? ' · quarter-start grace weeks count only when compliant' : '';
  if (b.y === -Infinity) return head + ' — ' + barName + ': green ≥' + f(b.g) + ' · below is yellow · never red' + graceNote;
  return head + ' — ' + barName + ': green ≥' + f(b.g) + ' · yellow ≥' + f(b.y) + ' · below is red' + graceNote;
```

- [ ] **Step 3: build + thread the grace set in `perfModel_`** (~4033, OUTSIDE the engine). Old:

```js
  var buckets = perfBucketsFor_(gran);
```

New:

```js
  var buckets = perfBucketsFor_(gran);
  // Grace weeks = first N weeks of every quarter bucket (spec v3 §B2) — mirrors
  // the backend's CONFIG_PS.GOALS_GRACE_DAYS (21 days ≈ 3 ISO weeks).
  var PERF_GOALS_GRACE_WEEKS = 3;
  var graceLabels = {};
  periodBucketsForEmp_('quarter').forEach(function(qb) {
    (qb.weekLabels || []).slice(0, PERF_GOALS_GRACE_WEEKS).forEach(function(l) { graceLabels[l] = true; });
  });
```

And the agg call (~4049). Old:

```js
      return perfBucketAgg_(b.weekLabels
        .filter(function(l) { return emp.weeks && emp.weeks[l]; })
        .map(function(l) { return { label: l, rk: computeRkScore(emp, l) }; }));
```

New:

```js
      return perfBucketAgg_(b.weekLabels
        .filter(function(l) { return emp.weeks && emp.weeks[l]; })
        .map(function(l) { return { label: l, rk: computeRkScore(emp, l) }; }), graceLabels);
```

`computeRkScore` is NOT touched (it feeds Top Rocketeers scoring).

- [ ] **Step 4: Run checks** — the 5 grace + tooltip checks pass; sentinel purity still green (the helper takes graceLabels as a param).

- [ ] **Step 5: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): goals grace — quarter-start weeks count only when compliant

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Drill severity grid + per-week PTO heatmap

**Files:** Modify `ps-dashboard/PS Dashboard.html` (CSS + `perfDrillHtml_`)

- [ ] **Step 1: CSS.** Replace (~761):

```css
.pr-block { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); }
```

with:

```css
/* Severity-flow grid (spec v3 §C): blocks keep the red→info sort, flowing
   row-major — worst signal is always top-left. min-width:0 + overflow-x lets a
   wide SVG scroll inside its cell instead of blowing up the grid. */
.pr-drill-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 18px; margin-top: 10px; }
@media (max-width: 900px) { .pr-drill-grid { grid-template-columns: 1fr; } }
.pr-block { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; min-width: 0; overflow-x: auto; }
/* Per-week PTO heatmap (spec v3 §D): green Good / red At Risk / gray no data. */
.pr-heatwrap { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 4px; }
.pr-heat { display: inline-block; width: 12px; height: 12px; border-radius: 2px; }
.pr-heat.g { background: #00875A; } .pr-heat.r { background: #DE350B; } .pr-heat.m { background: #C1C7D0; }
.pr-heat.cur { opacity: .35; }
```

And add dark-mode lines next to `body.dark-mode .pr-drill` (~766):

```css
body.dark-mode .pr-block { border-color: #2B3A78; }
body.dark-mode .pr-heat.m { background: #44506E; }
```

- [ ] **Step 2: Wrap the blocks in the grid.** In `perfDrillHtml_`'s return (~3449). Old:

```js
    '<div class="pr-reading">' + esc(row.reading) + '</div>' +
    blocks.map(function(b) { return b.html; }).join('') +
    '</div>';
```

New:

```js
    '<div class="pr-reading">' + esc(row.reading) + '</div>' +
    '<div class="pr-drill-grid">' + blocks.map(function(b) { return b.html; }).join('') + '</div>' +
    '</div>';
```

- [ ] **Step 3: PTO block → summary + heatmap.** Replace the whole PTO block (~3394–3404). Old:

```js
  if (cellByCol.pto && !cellByCol.pto.notEval) {
    block('pto', 'PTO health', '<table><tr>' +
      buckets.map(function(b) { return '<th>' + esc(b.label) + (b.containsCurrent ? ' ⏳' : '') + '</th>'; }).join('') +
      '</tr><tr>' +
      per.map(function(a) {
        var v = a ? a.pto : null;
        return '<td>' + (v === null || v === undefined ? '—' : v >= 1 ? 'Good' : '<b style="color:#DE350B">At Risk</b>') +
          (a && a.ptoGoodShare !== null && a.ptoGoodShare !== undefined
            ? ' <span class="pr-sub">' + Math.round(a.ptoGoodShare * 100) + '% wks</span>' : '') + '</td>';
      }).join('') + '</tr></table>');
  }
```

New (per-WEEK strip — a red week stays visible inside a green quarter; the
bucket dot already follows the latest week via `lastNonNull`):

```js
  if (cellByCol.pto && !cellByCol.pto.notEval) {
    var ptoWeeks = [];
    (DATA.q4Weeks || []).forEach(function(w) {
      if (w.isFuture) return;
      var wd = emp.weeks && emp.weeks[w.label];
      var ph = wd && wd.ptoHealth ? wd.ptoHealth : null;
      ptoWeeks.push({ label: w.label, cur: w.label === DATA.meta.currentWeekLabel,
                      status: ph ? ph.status : null, reason: ph && ph.reason ? ph.reason : '' });
    });
    var evald = ptoWeeks.filter(function(p) { return !p.cur && p.status; });
    var good  = evald.filter(function(p) { return p.status === 'Good'; }).length;
    var strip = ptoWeeks.map(function(p) {
      var cls = p.status === 'Good' ? 'g' : p.status ? 'r' : 'm';
      var tip = p.label + ' — ' + (p.status || 'no data') + (p.reason ? ' · ' + p.reason : '');
      return '<span class="pr-heat ' + cls + (p.cur ? ' cur' : '') + '" title="' + esc(tip) + '"></span>';
    }).join('');
    block('pto', 'PTO health',
      '<p>' + (evald.length ? 'Good ' + good + ' of ' + evald.length + ' evaluated weeks (' +
               Math.round(good / evald.length * 100) + '%)' : 'No evaluated weeks.') + '</p>' +
      '<div class="pr-heatwrap">' + strip + '</div>');
  }
```

- [ ] **Step 4: Run checks** — grid/heat static checks pass. **Step 5: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): drill 2-col severity grid + per-week PTO heatmap strip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: SVG chart upgrades (line mode >15 buckets, tick skip, fluid width)

**Files:** Modify `ps-dashboard/PS Dashboard.html` (engine: `perfTickStep_`; charts: `perfHrsChartSvg_`, `perfGoalsChartSvg_`)

- [ ] **Step 1: engine helper.** Inside the sentinels, after `perfFlagTip_` (Task 3), insert:

```js
// X-axis label skip (spec v3 §E): label every k-th bucket so ~30-week views
// stay legible. n ≤ maxTicks labels everything.
function perfTickStep_(n, maxTicks) {
  return n <= maxTicks ? 1 : Math.ceil(n / maxTicks);
}
```

- [ ] **Step 2: replace `perfHrsChartSvg_` entirely** (~3287–3309) with:

```js
// Tracked-vs-planned hours chart (spec v2 §5, v3 §E) — inline SVG, no chart
// library: no canvas lifecycle to manage and html2canvas captures it cleanly.
// ≤15 buckets → grouped bars with value labels; >15 (weekly views) → two-series
// line chart with hover titles and every-kth x labels. Fluid width fills the
// drill grid column (viewBox scales, capped at 2× natural size).
function perfHrsChartSvg_(buckets, per) {
  var vals = per.map(function(a) { return { t: a ? a.trackedHrs : null, p: a ? a.plannedHrs : null }; });
  var max = 1;
  vals.forEach(function(v) { max = Math.max(max, v.t || 0, v.p || 0); });
  var n = vals.length, step = perfTickStep_(n, 10);
  var CH = 54, TOP = 10, LBL = 18, H = CH + TOP + LBL;
  function tipFor(i) {
    var v = vals[i];
    return esc(String(buckets[i].label)) + ' — tracked ' + (v.t == null ? '—' : Math.round(v.t) + 'h') +
           ' / planned ' + (v.p == null ? '—' : Math.round(v.p) + 'h');
  }
  var parts = [], W, legend;
  if (n <= 15) {
    var bw = 10, gap2 = 2, group = bw * 2 + gap2 + 10;
    W = n * group;
    vals.forEach(function(v, i) {
      var x0 = i * group, yBase = TOP + CH;
      var hp = v.p ? Math.max(2, Math.round(v.p / max * CH)) : 0;
      var ht = v.t ? Math.max(2, Math.round(v.t / max * CH)) : 0;
      var g = ['<g><title>' + tipFor(i) + '</title>'];
      if (hp) g.push('<rect x="' + x0 + '" y="' + (yBase - hp) + '" width="' + bw + '" height="' + hp + '" fill="none" stroke="#7E97B8" stroke-width="1.5"/>');
      if (ht) g.push('<rect x="' + (x0 + bw + gap2) + '" y="' + (yBase - ht) + '" width="' + bw + '" height="' + ht + '" fill="#058CDC"/>');
      var lab = (v.t !== null && v.t !== undefined ? Math.round(v.t) : '—') + '/' +
                (v.p !== null && v.p !== undefined ? Math.round(v.p) : '—');
      g.push('<text x="' + (x0 + bw + gap2 / 2) + '" y="' + (TOP - 2) + '" font-size="7" fill="#64748b" text-anchor="middle">' + lab + '</text>');
      g.push('<text x="' + (x0 + bw + gap2 / 2) + '" y="' + (H - 6) + '" font-size="7" fill="#94A3B8" text-anchor="middle">' + esc(String(buckets[i].label).replace(/^20/, '')) + '</text>');
      parts.push(g.join('') + '</g>');
    });
    legend = '▮ tracked · ▯ planned — hours per period, labels above bars (tracked/planned)';
  } else {
    var PW = 14;
    W = n * PW;
    function lineSegs(field, style) {
      var segs = [], cur = [];
      vals.forEach(function(v, i) {
        var val = v[field];
        if (val === null || val === undefined) { if (cur.length > 1) segs.push(cur); cur = []; return; }
        cur.push((i * PW + PW / 2) + ',' + (TOP + CH - Math.round(val / max * CH)));
      });
      if (cur.length > 1) segs.push(cur);
      return segs.map(function(s) { return '<polyline points="' + s.join(' ') + '" fill="none" ' + style + '/>'; }).join('');
    }
    parts.push(lineSegs('p', 'stroke="#7E97B8" stroke-width="1.5" stroke-dasharray="4,3"'));
    parts.push(lineSegs('t', 'stroke="#058CDC" stroke-width="2"'));
    vals.forEach(function(v, i) {
      parts.push('<rect x="' + (i * PW) + '" y="0" width="' + PW + '" height="' + H + '" fill="transparent"><title>' + tipFor(i) + '</title></rect>');
      if (i % step === 0) parts.push('<text x="' + (i * PW + PW / 2) + '" y="' + (H - 6) + '" font-size="7" fill="#94A3B8" text-anchor="middle">' + esc(String(buckets[i].label).replace(/^20/, '')) + '</text>');
    });
    legend = '— tracked · ┄ planned — hover a week for exact hours';
  }
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + (W * 2) + 'px;height:auto">' +
    '<line x1="0" y1="' + (TOP + CH + 1) + '" x2="' + W + '" y2="' + (TOP + CH + 1) + '" stroke="#CBD5E1"/>' +
    parts.join('') + '</svg>' +
    '<div class="pr-sub">' + legend + '</div>';
}
```

- [ ] **Step 3: replace `perfGoalsChartSvg_` entirely** (~3312–3332) with:

```js
// Goals compliance bars: x/y compliant weeks per bucket, coloured by share.
// Bars at every n (share is discrete); >maxTicks the x/value labels skip to
// every k-th bucket and each bar carries a hover title (spec v3 §E).
function perfGoalsChartSvg_(buckets, per) {
  var CH = 40, TOP = 10, LBL = 18, bw = 16, gapg = 8;
  var n = per.length, step = perfTickStep_(n, 10);
  var W = n * (bw + gapg), H = CH + TOP + LBL;
  var parts = [];
  per.forEach(function(a, i) {
    var x = i * (bw + gapg), yBase = TOP + CH;
    var tip = esc(String(buckets[i].label)) + ' — ' +
      (a && a.goalsWeeks ? a.goalsCompliant + '/' + a.goalsWeeks + ' weeks compliant' : 'no goals data');
    var g = ['<g><title>' + tip + '</title>'];
    if (a && a.goalsWeeks) {
      var frac = a.goalsCompliant / a.goalsWeeks;
      var h = Math.max(2, Math.round(frac * CH));
      var col = frac >= 0.8 ? '#00875A' : frac >= 0.4 ? '#FF991F' : '#DE350B';
      g.push('<rect x="' + x + '" y="' + (yBase - h) + '" width="' + bw + '" height="' + h + '" fill="' + col + '"/>');
      if (i % step === 0) g.push('<text x="' + (x + bw / 2) + '" y="' + (TOP - 2) + '" font-size="7" fill="#64748b" text-anchor="middle">' + a.goalsCompliant + '/' + a.goalsWeeks + '</text>');
    } else {
      g.push('<text x="' + (x + bw / 2) + '" y="' + (yBase - 4) + '" font-size="7" fill="#94A3B8" text-anchor="middle">—</text>');
    }
    if (i % step === 0) g.push('<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" font-size="7" fill="#94A3B8" text-anchor="middle">' + esc(String(buckets[i].label).replace(/^20/, '')) + '</text>');
    parts.push(g.join('') + '</g>');
  });
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + (W * 2) + 'px;height:auto">' +
    '<line x1="0" y1="' + (TOP + CH + 1) + '" x2="' + W + '" y2="' + (TOP + CH + 1) + '" stroke="#CBD5E1"/>' +
    parts.join('') + '</svg>';
}
```

- [ ] **Step 4: Run checks** — `tickStep` checks pass. **Step 5: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): drill charts — line mode past 15 buckets, tick skip, fluid width

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Snapshot print mode

**Files:** Modify `ps-dashboard/PS Dashboard.html` (`savePerfSnapshot_` + CSS)

- [ ] **Step 1: CSS** — append after the `.pr-heat` rules from Task 5:

```css
/* Print mode (spec v3 §F): applied only during html2canvas capture — clamps the
   card and pins 2 columns so the PNG is compact regardless of live viewport. */
.pr-drill.pr-print { max-width: 820px; }
.pr-drill.pr-print .pr-drill-grid { grid-template-columns: repeat(2, 1fr); }
```

- [ ] **Step 2: wrap the capture.** In `savePerfSnapshot_` (~3336), old:

```js
  setTimeout(function() {
    btns.forEach(function(b) { b.style.visibility = 'hidden'; });
    html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
      .then(function(canvas) {
        btns.forEach(function(b) { b.style.visibility = ''; });
        if (done) done();
```

new:

```js
  setTimeout(function() {
    btns.forEach(function(b) { b.style.visibility = 'hidden'; });
    el.classList.add('pr-print');
    html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false })
      .then(function(canvas) {
        el.classList.remove('pr-print');
        btns.forEach(function(b) { b.style.visibility = ''; });
        if (done) done();
```

and the catch path, old:

```js
      .catch(function() {
        btns.forEach(function(b) { b.style.visibility = ''; });
        if (done) done();
      });
```

new:

```js
      .catch(function() {
        el.classList.remove('pr-print');
        btns.forEach(function(b) { b.style.visibility = ''; });
        if (done) done();
      });
```

- [ ] **Step 3: Run the perf checks**

```bash
node "ps-dashboard/tests/perf-record-checks.js"
# expect: ~107 passed, 5 failed — only the Task 8 RCR checks (4 rcrMonthKey + 1 join) remain red
```

- [ ] **Step 4: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): snapshot print mode — 820px clamp during PNG capture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: RCR — per-month bucket values + drill chart

**Files:** Modify `ps-dashboard/PS Dashboard.html` (engine: `perfRcrMonthKey_`; glue: `perfModel_`; drill: `perfDrillHtml_` RCR block)

- [ ] **Step 1: engine helper.** Inside the sentinels, after `perfTickStep_` (Task 6), insert:

```js
// RCR sheet month header → month-bucket key (spec v3 §G): "Jul 25" → "2025-07".
// Lets monthly buckets pick THEIR month's RCR instead of today's value repeated.
function perfRcrMonthKey_(name) {
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var m = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{2})$/i.exec(String(name || '').trim());
  if (!m) return null;
  var mm = MON[m[1].toLowerCase()];
  return (2000 + parseInt(m[2], 10)) + '-' + (mm < 10 ? '0' : '') + mm;
}
```

- [ ] **Step 2: override bucket RCR in `perfModel_`.** Replace the byEmp loop body (~4047, after Task 4 it passes `graceLabels`). Old:

```js
  (DATA.employees || []).forEach(function(emp) {
    model.byEmp[emp.normName] = buckets.map(function(b) {
      return perfBucketAgg_(b.weekLabels
        .filter(function(l) { return emp.weeks && emp.weeks[l]; })
        .map(function(l) { return { label: l, rk: computeRkScore(emp, l) }; }), graceLabels);
    });
  });
```

New:

```js
  // v3 §G: per-month RCR — meta.rcrByEmployee carries the monthly history, so a
  // bucket shows ITS month's value (last month with data inside the bucket =
  // state at bucket close). No monthly history → keep the current-value fallback.
  var rcrHist = (DATA.meta && DATA.meta.rcrByEmployee) || {};
  (DATA.employees || []).forEach(function(emp) {
    var aggs = buckets.map(function(b) {
      return perfBucketAgg_(b.weekLabels
        .filter(function(l) { return emp.weeks && emp.weeks[l]; })
        .map(function(l) { return { label: l, rk: computeRkScore(emp, l) }; }), graceLabels);
    });
    var empRcr = rcrHist[emp.normName];
    if (empRcr) {
      var byKey = {};
      Object.keys(empRcr).forEach(function(nm) {
        var k = perfRcrMonthKey_(nm);
        if (k) byKey[k] = empRcr[nm];
      });
      aggs.forEach(function(agg, i) {
        var v = null;
        buckets[i].weekLabels.forEach(function(l) {
          var k = pMonthKey(l);
          if (k && byKey[k] !== undefined) v = byKey[k];   // last month wins
        });
        if (v !== null) agg.rcr = v;
      });
    }
    model.byEmp[emp.normName] = aggs;
  });
```

- [ ] **Step 3: drill RCR block → monthly chart.** In `perfDrillHtml_`, old:

```js
  if (cellByCol.rcr && (!cellByCol.rcr.notEval || cellByCol.rcr.val !== null)) {
    block('rcr', 'RCR', '<p>' + (cellByCol.rcr.val === null ? 'No rating.'
      : 'Current ' + (Math.round(cellByCol.rcr.val * 10) / 10) + ' — target 2.5.') + '</p>');
  }
```

New (reuses the Overview drill's `detChartSVG_(pts, color, fmt)`):

```js
  if (cellByCol.rcr && (!cellByCol.rcr.notEval || cellByCol.rcr.val !== null)) {
    var rcrMap    = ((DATA.meta && DATA.meta.rcrByEmployee) || {})[emp.normName] || {};
    var rcrMonths = ((DATA.meta && DATA.meta.rcrHistory) || []).map(function(h) { return h.month; });
    var rPts = rcrMonths.map(function(m) {
      return rcrMap[m] !== undefined ? { label: m, v: rcrMap[m] } : null;
    }).filter(Boolean);
    block('rcr', 'RCR — monthly', '<p>' + (cellByCol.rcr.val === null ? 'No rating.'
      : 'Latest ' + (Math.round(cellByCol.rcr.val * 10) / 10) + ' — target 2.5.') + '</p>' +
      (rPts.length > 1 ? detChartSVG_(rPts, '#058CDC', function(v) { return v.toFixed(2); }) : ''));
  }
```

- [ ] **Step 4: Run all checks** — the 4 `rcrMonthKey` checks + the static join check pass; expect the FULL suite green now:

```bash
node "ps-dashboard/tests/perf-record-checks.js"    # expect: ~112 passed, 0 failed
node "ps-dashboard/tests/responsive-checks.js"     # 27 passed
node "ps-dashboard/tests/fiscal-window-checks.js"  # 15 passed
```

- [ ] **Step 5: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): RCR shows per-month values across buckets + monthly drill chart

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Visual QA (manual — tests are blind to layout)

No commit. After deploy (both PS files + `PS_CACHE_VER` bump — rides the pending Performance Record deploy):

- [ ] KPI cards: counts match, click focuses/unfocuses, Total clears, active ring visible, subtitle names the focus, CSV honours it.
- [ ] Default sort: top performers (Score desc) on first open; header clicks re-sort.
- [ ] Weekly drill: hours chart is a line chart with hover titles and every-3rd-week labels; goals bars skip labels; charts fill their grid column.
- [ ] Goals: no red bars in the first 3 weeks of any quarter for people who became compliant.
- [ ] PTO: per-week strip shows isolated red weeks inside green quarters; square tooltips include the reason string.
- [ ] RCR: monthly view shows different values month to month (not a flat repeat); drill shows the "RCR — monthly" line; quarterly dot = quarter-close month.
- [ ] Snapshot 📸: PNG is ≤ ~820px content width, 2-column, no buttons; live layout unaffected after capture (including after a capture error).
- [ ] Dark mode + screenshot for the record.
