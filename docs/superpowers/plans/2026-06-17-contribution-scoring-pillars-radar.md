# Contribution Scoring Engine — Four Pillars & Radar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the portfolio's Contribution Scoring Engine demo (`ContribScoreDemo`) into a manager-facing team-performance tool: drop the `RCR` jargon, rename the evaluated metrics to four market-standard pillars (Company Alignment, Performance, Employee Health, Recognition), score Employee Health on a sustainable sweet-spot band, and replace the me-vs-team bar panel with a per-person SVG radar overlaying the team average.

**Architecture:** One demo module (`ContribScoreDemo`, registry id `Performance-Dashboard`) lives in `JavaScript.html` as a container-scoped IIFE; its DOM template lives in `index.html` (`#contrib-demo-tpl`) with CSS in the same file's `<style>`. The change is the rename (atomic across both files), then additive UI: SVG radar, team-summary strip, AI-prompt wording. No server changes — the only backend call remains the existing `proxyGroqChat`. Radar is hand-drawn inline SVG (no chart library), consistent with the all-vanilla page and GAS HtmlService iframe constraint.

**Tech Stack:** Vanilla ES5-style JS, HTML `<template>`, inline SVG, CSS custom properties (`--amber`, `--mono`, `--dark-text`, `--dark-muted`). Served by Google Apps Script `HtmlService`.

---

## Spec

Design: `docs/superpowers/specs/2026-06-17-contribution-scoring-pillars-radar-design.md`

## File Structure

- **Modify** `docs/superpowers/gas-portfolio/JavaScript.html` — the `ContribScoreDemo` IIFE (currently lines ~1157–1440): data (`TEAM`, `METRICS`), math (`normsFor`, `scoreFor`, `rawLabel`), per-instance `refs`/`render`/`renderDetail`/`generateBrief`, and a new module-level `_test_contribMath()` dev function + a new `buildRadarSvg()` helper.
- **Modify** `docs/superpowers/gas-portfolio/index.html` — the `#contrib-demo-tpl` template (currently lines ~2146–2208): four pillar sliders, team-summary strip, radar-host detail panel; and the demo's CSS in the `<style>` block (currently ~lines 1437–1533) for radar + team strip + value list.

## Conventions for every commit

The repo root has unrelated dirty files. **Each task commits only the two portfolio files**, explicitly:

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"
```

Tests are the dev function `_test_contribMath()` run in the **browser console** of the loaded portfolio page (the module is a page-global `var`, so the function is callable directly). It uses `console.assert`; "fail" = an assertion message or a `ReferenceError`; "pass" = the final `✓ contrib math tests passed` log with no assertion errors above it.

---

### Task 1: Rename to four pillars + new scoring math (atomic across both files)

This task keeps the demo fully working: after it, the leaderboard re-ranks on four renamed sliders and the (still bar-based) detail panel shows four pillars. The radar replaces the bars in Task 2.

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (the `ContribScoreDemo` IIFE, ~1157–1440)
- Modify: `docs/superpowers/gas-portfolio/index.html` (the `#contrib-demo-tpl` sliders, ~2150–2177)

- [ ] **Step 1: Write the failing test**

Add this module-level function in `JavaScript.html` immediately AFTER the `ContribScoreDemo` IIFE closing `}());` (currently line ~1440) and BEFORE the `var DEMOS = {` block:

```js
// Dev test — run _test_contribMath() in the browser console.
function _test_contribMath() {
  var N = ContribScoreDemo._normsFor;
  var S = ContribScoreDemo._scoreFor;

  // Sweet-spot Employee Health band: peak at 40h, zero at 20h/60h, 0.5 at 30h
  console.assert(N({ goalsPct: 0, tracked: 0, planned: 40, kudos: 0 }).health === 1,
    'health: 40h should be 1.0');
  console.assert(N({ goalsPct: 0, tracked: 0, planned: 20, kudos: 0 }).health === 0,
    'health: 20h should be 0');
  console.assert(N({ goalsPct: 0, tracked: 0, planned: 60, kudos: 0 }).health === 0,
    'health: 60h should be 0');
  console.assert(Math.abs(N({ goalsPct: 0, tracked: 0, planned: 30, kudos: 0 }).health - 0.5) < 1e-9,
    'health: 30h should be 0.5');

  // Performance (utilization) guards division by zero
  console.assert(N({ goalsPct: 0, tracked: 10, planned: 0, kudos: 0 }).performance === 0,
    'performance: planned 0 should be 0');

  // Composite with default weights for a known row (Elena: 90% goals, 37/40, 40h, 3 kudos)
  // norms: alignment .9, performance 1, health 1, recognition 1
  // score = 100*(30*.9 + 35*1 + 20*1 + 15*1)/100 = 97
  var elena = N({ goalsPct: 90, tracked: 37, planned: 40, kudos: 3 });
  var w = { alignment: 30, performance: 35, health: 20, recognition: 15 };
  console.assert(Math.round(S(elena, w)) === 97, 'score: Elena should round to 97');

  console.log('✓ contrib math tests passed');
}
```

- [ ] **Step 2: Run test to verify it fails**

Load the portfolio page, open the browser console, run:

```js
_test_contribMath()
```

Expected: FAIL — `Uncaught TypeError: ContribScoreDemo._normsFor is not a function` (the IIFE does not yet expose `_normsFor`/`_scoreFor`, and `normsFor` still uses the old `rcr` keys).

- [ ] **Step 3: Replace the `METRICS` array**

In `JavaScript.html`, replace the current `METRICS` block (lines ~1175–1181):

```js
  var METRICS = [
    { key: 'goals',   label: 'Goals' },
    { key: 'tracked', label: 'Tracked Time' },
    { key: 'planned', label: 'Planned Time' },
    { key: 'rcr',     label: 'RCR' },
    { key: 'kudos',   label: 'Kudos' }
  ];
```

with:

```js
  // Four manager-facing pillars (radar axes). `pillar` = full market name,
  // `axis` = short radar label, `metric` = the underlying measure.
  var METRICS = [
    { key: 'alignment',   pillar: 'Company Alignment', axis: 'Alignment',   metric: 'Goal Attainment' },
    { key: 'performance', pillar: 'Performance',       axis: 'Performance', metric: 'Utilization' },
    { key: 'health',      pillar: 'Employee Health',   axis: 'Health',      metric: 'Workload Health' },
    { key: 'recognition', pillar: 'Recognition',       axis: 'Recognition', metric: 'Peer Recognition' }
  ];
```

- [ ] **Step 4: Replace the `TEAM` data**

In `JavaScript.html`, replace the current `TEAM` block (lines ~1159–1173, the comment + array) with re-tuned profiles that drop `rcr` and include one over-loaded (Marcus, 54h) and one under-loaded (Jonas, 24h) member so the sweet-spot health axis moves:

```js
  // 8 synthetic team members — profiles vary so weight changes visibly re-rank.
  // Includes one over-loaded member (Marcus, 54h → burnout) and one
  // under-loaded (Jonas, 24h → under-utilized) so Workload Health spreads.
  var TEAM = [
    { name: 'Priya Sharma',    goalsPct: 100, tracked: 26, planned: 28, kudos: 2 },
    { name: 'Marcus Webb',     goalsPct:  45, tracked: 50, planned: 54, kudos: 1 },
    { name: 'Elena Rodríguez', goalsPct:  90, tracked: 37, planned: 40, kudos: 3 },
    { name: 'Aisha Khan',      goalsPct:  70, tracked: 30, planned: 38, kudos: 5 },
    { name: 'Daniel Osei',     goalsPct:  65, tracked: 35, planned: 38, kudos: 1 },
    { name: 'Sofia Almeida',   goalsPct:  78, tracked: 33, planned: 40, kudos: 2 },
    { name: 'Jonas Berg',      goalsPct:  55, tracked: 20, planned: 24, kudos: 1 },
    { name: 'Tom Fletcher',    goalsPct:  25, tracked: 16, planned: 30, kudos: 0 }
  ];
```

- [ ] **Step 5: Replace `normsFor` with the four pillar norms**

In `JavaScript.html`, replace the current `normsFor` block (lines ~1187–1196):

```js
  // Normalization mirrors the production scoring spec
  function normsFor(m) {
    return {
      goals:   m.goalsPct / 100,
      tracked: m.planned > 0 ? Math.min((m.tracked / m.planned) / 0.9, 1) : 0,
      planned: Math.min(m.planned / 40, 1),
      rcr:     Math.min(m.rcr / 2.5, 1),
      kudos:   Math.min(m.kudos / 3, 1)
    };
  }
```

with:

```js
  // Four pillar normalizations, each 0–1.
  function normsFor(m) {
    return {
      alignment:   m.goalsPct / 100,
      performance: m.planned > 0 ? Math.min((m.tracked / m.planned) / 0.9, 1) : 0,
      health:      Math.max(0, 1 - Math.abs(m.planned - 40) / 20),
      recognition: Math.min(m.kudos / 3, 1)
    };
  }
```

- [ ] **Step 6: Replace `rawLabel` with pillar raw values**

In `JavaScript.html`, replace the current `rawLabel` block (lines ~1225–1232):

```js
  // Raw value shown next to each metric in the detail panel
  function rawLabel(m, key) {
    if (key === 'goals')   return m.goalsPct + '%';
    if (key === 'tracked') return m.tracked + 'h / ' + m.planned + 'h planned';
    if (key === 'planned') return m.planned + 'h';
    if (key === 'rcr')     return m.rcr.toFixed(1);
    return m.kudos + ' kudos';
  }
```

with:

```js
  // Raw value shown beside each pillar in the radar value list
  function rawLabel(m, key) {
    if (key === 'alignment')   return m.goalsPct + '% of goals';
    if (key === 'performance') return m.tracked + 'h / ' + m.planned + 'h utilized';
    if (key === 'health')      return m.planned + 'h planned';
    return m.kudos + ' kudos';
  }
```

- [ ] **Step 7: Update slider/value `refs` to the new keys**

In `JavaScript.html` `createInstance`, replace the `sliders` and `vals` ref maps (lines ~1238–1251):

```js
      sliders: {
        goals:   mount.querySelector('.cs-w-goals'),
        tracked: mount.querySelector('.cs-w-tracked'),
        planned: mount.querySelector('.cs-w-planned'),
        rcr:     mount.querySelector('.cs-w-rcr'),
        kudos:   mount.querySelector('.cs-w-kudos')
      },
      vals: {
        goals:   mount.querySelector('.cs-w-goals-val'),
        tracked: mount.querySelector('.cs-w-tracked-val'),
        planned: mount.querySelector('.cs-w-planned-val'),
        rcr:     mount.querySelector('.cs-w-rcr-val'),
        kudos:   mount.querySelector('.cs-w-kudos-val')
      },
```

with:

```js
      sliders: {
        alignment:   mount.querySelector('.cs-w-alignment'),
        performance: mount.querySelector('.cs-w-performance'),
        health:      mount.querySelector('.cs-w-health'),
        recognition: mount.querySelector('.cs-w-recognition')
      },
      vals: {
        alignment:   mount.querySelector('.cs-w-alignment-val'),
        performance: mount.querySelector('.cs-w-performance-val'),
        health:      mount.querySelector('.cs-w-health-val'),
        recognition: mount.querySelector('.cs-w-recognition-val')
      },
```

- [ ] **Step 8: Expose pure helpers on the module return**

In `JavaScript.html`, replace the IIFE return (line ~1439):

```js
  return { inject: inject };
```

with:

```js
  return { inject: inject, _normsFor: normsFor, _scoreFor: scoreFor };
```

> Note: `render()`, `scoreFor()`, the `AVG` reducer, and `renderDetail()`'s loop already iterate `METRICS` generically by `key`/`label`. `renderDetail` references `METRICS[i].label`; update that single reference to `METRICS[i].pillar` now so the (still bar-based) panel renders: in `renderDetail` change `escHtml(METRICS[i].label)` to `escHtml(METRICS[i].pillar)` (line ~1354).

- [ ] **Step 9: Rewrite the four sliders in the template**

In `index.html`, replace the five `.demo-slider-group` blocks inside `.cs-sliders` (lines ~2152–2176) with four pillar sliders:

```html
      <div class="demo-slider-group">
        <label>Company Alignment — Goal Attainment <span class="cs-w-alignment-val">30</span>
          <input class="demo-range cs-w-alignment" type="range" min="0" max="50" step="1" value="30">
        </label>
      </div>
      <div class="demo-slider-group">
        <label>Performance — Utilization <span class="cs-w-performance-val">35</span>
          <input class="demo-range cs-w-performance" type="range" min="0" max="50" step="1" value="35">
        </label>
      </div>
      <div class="demo-slider-group">
        <label>Employee Health — Workload Health <span class="cs-w-health-val">20</span>
          <input class="demo-range cs-w-health" type="range" min="0" max="50" step="1" value="20">
        </label>
      </div>
      <div class="demo-slider-group">
        <label>Recognition — Peer Recognition <span class="cs-w-recognition-val">15</span>
          <input class="demo-range cs-w-recognition" type="range" min="0" max="50" step="1" value="15">
        </label>
      </div>
```

- [ ] **Step 10: Run test to verify it passes**

Reload the page, open the console, run:

```js
_test_contribMath()
```

Expected: PASS — logs `✓ contrib math tests passed`, no assertion warnings. Also visually confirm the demo now shows four sliders (Company Alignment 30 / Performance 35 / Employee Health 20 / Recognition 15), the leaderboard re-ranks as you drag a slider, and clicking a row still opens the (bar-based) detail panel with four pillar rows.

- [ ] **Step 11: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"
git commit -m "Rename Contribution demo to four pillars; drop RCR; sweet-spot health"
```

---

### Task 2: Replace the bar detail panel with an SVG radar overlay

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (add `buildRadarSvg`, rewrite `renderDetail`, repoint `detailRows` ref)
- Modify: `docs/superpowers/gas-portfolio/index.html` (radar CSS in `<style>`; detail-panel hint text)

- [ ] **Step 1: Add a radar geometry test**

Extend `_test_contribMath()` in `JavaScript.html` by inserting these assertions just before the final `console.log('✓ contrib math tests passed');` line:

```js
  // Radar geometry: full-value point on each of the 4 axes (cx=cy=100, R=64)
  var pts = ContribScoreDemo._radarPoints(
    { alignment: 1, performance: 1, health: 1, recognition: 1 });
  // axis 0 top (100,36), 1 right (164,100), 2 bottom (100,164), 3 left (36,100)
  console.assert(pts[0] === '100.0,36.0',  'radar: alignment apex at top');
  console.assert(pts[1] === '164.0,100.0', 'radar: performance apex at right');
  console.assert(pts[2] === '100.0,164.0', 'radar: health apex at bottom');
  console.assert(pts[3] === '36.0,100.0',  'radar: recognition apex at left');
```

- [ ] **Step 2: Run test to verify it fails**

Reload, console, run `_test_contribMath()`. Expected: FAIL — `ContribScoreDemo._radarPoints is not a function`.

- [ ] **Step 3: Add `buildRadarSvg` + `radarPoints` helpers**

In `JavaScript.html`, add these two module-level helpers inside the IIFE, immediately after `rawLabel` (after line ~1232) and before `// ── per-instance factory`:

```js
  // ── radar geometry ──────────────────────────────────────────────────────────
  var RADAR_CX = 100, RADAR_CY = 100, RADAR_R = 64;

  // Point on axis i (0=top,1=right,2=bottom,3=left) at value v (0–1)
  function radarPt(v, i) {
    var ang = (-90 + i * 90) * Math.PI / 180;
    return [RADAR_CX + RADAR_R * v * Math.cos(ang),
            RADAR_CY + RADAR_R * v * Math.sin(ang)];
  }

  // "x,y" strings for each pillar's value (used by the test + polygon builder)
  function radarPoints(norms) {
    var out = [];
    for (var i = 0; i < METRICS.length; i++) {
      var p = radarPt(norms[METRICS[i].key], i);
      out.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
    }
    return out;
  }

  // Build the inline SVG: grid rings, axes, team-avg + member polygons, labels
  function buildRadarSvg(me, avg) {
    var anchors = ['middle', 'start', 'middle', 'end'];   // per axis index
    var dy      = [-7, 4, 15, 4];                         // label vertical nudge
    var rings = '';
    [0.25, 0.5, 0.75, 1].forEach(function(r) {
      var rp = [];
      for (var i = 0; i < METRICS.length; i++) {
        var p = radarPt(r, i);
        rp.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
      }
      rings += '<polygon class="cs-radar-ring" points="' + rp.join(' ') + '"></polygon>';
    });
    var axes = '', labels = '';
    for (var i = 0; i < METRICS.length; i++) {
      var edge = radarPt(1, i);
      axes += '<line class="cs-radar-axis" x1="' + RADAR_CX + '" y1="' + RADAR_CY +
              '" x2="' + edge[0].toFixed(1) + '" y2="' + edge[1].toFixed(1) + '"></line>';
      var lp = radarPt(1.22, i);
      labels += '<text class="cs-radar-lbl" x="' + lp[0].toFixed(1) + '" y="' +
                (lp[1] + dy[i]).toFixed(1) + '" text-anchor="' + anchors[i] + '">' +
                escHtml(METRICS[i].axis) + '</text>';
    }
    return '<svg viewBox="0 0 200 200" role="img" aria-label="Pillar radar chart">' +
             rings + axes +
             '<polygon class="cs-radar-avg" points="' + radarPoints(avg).join(' ') + '"></polygon>' +
             '<polygon class="cs-radar-me" points="' + radarPoints(me).join(' ') + '"></polygon>' +
             labels +
           '</svg>';
  }
```

- [ ] **Step 4: Expose `radarPoints` on the module return**

In `JavaScript.html`, change the IIFE return (edited in Task 1) to also expose the geometry:

```js
  return { inject: inject, _normsFor: normsFor, _scoreFor: scoreFor, _radarPoints: radarPoints };
```

- [ ] **Step 5: Repoint the detail-body ref**

In `createInstance`'s `refs`, the panel container is queried as `detailRows: mount.querySelector('.cs-detail-rows')` (line ~1256). Leave the selector but rename the property for clarity — change that line to:

```js
      detailBody:  mount.querySelector('.cs-detail-rows'),
```

(Keep the `detailName` ref above it unchanged.)

- [ ] **Step 6: Rewrite `renderDetail` to draw the radar**

In `JavaScript.html`, replace the whole `renderDetail` function (lines ~1342–1368) with:

```js
    function renderDetail() {
      if (selectedIdx < 0) return;
      var m = TEAM[selectedIdx];
      var n = NORMS[selectedIdx];
      refs.detailName.textContent = m.name;

      var vals = '';
      for (var i = 0; i < METRICS.length; i++) {
        var key = METRICS[i].key;
        vals +=
          '<div class="cs-rv">' +
            '<span class="cs-rv-lbl">' + escHtml(METRICS[i].pillar) + '</span>' +
            '<span class="cs-rv-raw">' + escHtml(rawLabel(m, key)) + '</span>' +
            '<span class="cs-rv-pct">' + Math.round(n[key] * 100) + '%</span>' +
          '</div>';
      }

      refs.detailBody.innerHTML =
        '<div class="cs-radar">' + buildRadarSvg(n, AVG) + '</div>' +
        '<div class="cs-radar-vals">' + vals + '</div>';
      refs.detail.classList.add('cs-open');
    }
```

- [ ] **Step 7: Update the board hint text**

In `index.html`, change the hint (line ~2185):

```html
    <div class="cs-board-hint">Click a row for a per-metric breakdown vs team average</div>
```

to:

```html
    <div class="cs-board-hint">Click a row for a per-pillar radar vs the team average</div>
```

- [ ] **Step 8: Add radar CSS**

In `index.html`, in the `<style>` block, replace the `.cs-detail-rows`-adjacent metric-bar rules. Specifically, locate the line `.cs-d-metric { margin-bottom: 10px; }` (line ~1500) and insert the following BEFORE it (the old `.cs-d-*` rules stay — `.cs-d-me`/`.cs-d-avg` are still used by the legend swatches):

```css
.cs-detail-rows { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.cs-radar { flex: 0 0 auto; padding: 8px 26px; }
.cs-radar svg { width: 200px; height: 200px; display: block; overflow: visible; }
.cs-radar-ring { fill: none; stroke: rgba(255,255,255,0.07); }
.cs-radar-axis { stroke: rgba(255,255,255,0.12); }
.cs-radar-lbl {
  fill: var(--dark-muted); font-family: var(--mono); font-size: 8px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.cs-radar-avg { fill: none; stroke: rgba(255,255,255,0.45); stroke-width: 1.2; stroke-dasharray: 3 3; }
.cs-radar-me  { fill: rgba(245,158,11,0.22); stroke: var(--amber); stroke-width: 1.5; }
.cs-radar-vals { flex: 1; min-width: 190px; }
.cs-rv {
  display: flex; align-items: center; gap: 8px; padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-family: var(--mono); font-size: 10.5px;
}
.cs-rv:last-child { border-bottom: none; }
.cs-rv-lbl { color: var(--dark-text); width: 130px; flex-shrink: 0; }
.cs-rv-raw { color: var(--dark-muted); flex: 1; white-space: nowrap; }
.cs-rv-pct { color: var(--amber); font-weight: 600; width: 34px; text-align: right; flex-shrink: 0; }
```

- [ ] **Step 9: Run test to verify it passes**

Reload, console, run `_test_contribMath()`. Expected: PASS — `✓ contrib math tests passed`, no warnings. Visually: click any leaderboard row → a radar with two polygons (solid amber = member, dashed = team avg) renders on the left and a four-row value list (Company Alignment / Performance / Employee Health / Recognition with raw values + %) on the right. Click **Jonas Berg** → Health vertex collapses toward center (under-loaded); click **Marcus Webb** → Health also low but Performance high.

- [ ] **Step 10: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"
git commit -m "Replace Contribution detail bars with per-pillar SVG radar vs team avg"
```

---

### Task 3: Add the team-summary strip

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (template markup + CSS)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (`createInstance`: ref + one-time render)

- [ ] **Step 1: Add the strip markup to the template**

In `index.html`, insert this block immediately AFTER the `.cs-total-row` closing `</div>` (line ~2181) and BEFORE the `<!-- Leaderboard -->` comment:

```html
    <!-- Team summary: average per pillar (the team level the manager tunes) -->
    <div class="cs-team-lbl-row">Team average by pillar</div>
    <div class="cs-team"></div>
```

- [ ] **Step 2: Add team-strip CSS**

In `index.html` `<style>`, insert AFTER the `.cs-total.cs-total-zero { color: #f87171; }` rule (line ~1436):

```css
.cs-team-lbl-row {
  font-family: var(--mono); font-size: 9px; color: var(--dark-muted);
  text-transform: uppercase; letter-spacing: 0.07em; margin: 4px 0 6px;
}
.cs-team { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.cs-team-cell {
  flex: 1; min-width: 92px; padding: 8px 10px; border-radius: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(245,158,11,0.12);
}
.cs-team-cell-lbl {
  font-family: var(--mono); font-size: 8.5px; color: var(--dark-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.cs-team-cell-val {
  font-family: var(--mono); font-size: 15px; font-weight: 600;
  color: var(--amber); margin-top: 3px;
}
```

- [ ] **Step 3: Add the `team` ref**

In `JavaScript.html` `createInstance` `refs`, add after the `board:` ref (line ~1253):

```js
      team:       mount.querySelector('.cs-team'),
```

- [ ] **Step 4: Render the strip once (team avg per pillar)**

In `JavaScript.html` `createInstance`, add this call and helper. Insert the helper just before `// initial render` / `render();` (line ~1424), and it renders from the constant `AVG`:

```js
    // Team-average score per pillar (constant — norms are weight-independent)
    (function renderTeamSummary() {
      var html = '';
      for (var i = 0; i < METRICS.length; i++) {
        var key = METRICS[i].key;
        html +=
          '<div class="cs-team-cell">' +
            '<div class="cs-team-cell-lbl">' + escHtml(METRICS[i].axis) + '</div>' +
            '<div class="cs-team-cell-val">' + Math.round(AVG[key] * 100) + '%</div>' +
          '</div>';
      }
      refs.team.innerHTML = html;
    }());
```

- [ ] **Step 5: Verify visually**

Reload the page. Expected: a "Team average by pillar" label above a four-cell strip showing each pillar's team-average percentage (Alignment ~66%, Performance ~91%, Health ~65%, Recognition ~54% — derived from the synthetic data), sitting between the sliders total and the leaderboard. Re-run `_test_contribMath()` → still `✓ contrib math tests passed`.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"
git commit -m "Add team-average-by-pillar summary strip to Contribution demo"
```

---

### Task 4: Update the AI executive-brief prompt to pillar language

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (`generateBrief`, ~1381–1391)

- [ ] **Step 1: Replace the prompt construction**

In `JavaScript.html` `generateBrief`, replace the `var w = weights();` ... `prompt = ...;` block (lines ~1381–1391):

```js
      var w = weights();
      var ranked = lastOrder.map(function(idx, r) {
        return (r + 1) + '. ' + TEAM[idx].name + ' — ' + Math.round(lastScores[idx]);
      });
      var prompt =
        'You are an operations analyst. Write a concise executive brief (under 120 words, ' +
        'plain text, no markdown) on this synthetic team\'s weekly contribution scores (0-100). ' +
        'Scoring weights: Goals ' + w.goals + ', Tracked Time ' + w.tracked +
        ', Planned Time ' + w.planned + ', RCR ' + w.rcr + ', Kudos ' + w.kudos + '. ' +
        'Ranked scores: ' + ranked.join('; ') + '. ' +
        'Highlight the top performer, who is at risk, and one coaching recommendation.';
```

with:

```js
      var w = weights();
      var ranked = lastOrder.map(function(idx, r) {
        return (r + 1) + '. ' + TEAM[idx].name + ' — ' + Math.round(lastScores[idx]);
      });
      var prompt =
        'You are an operations manager. Write a concise executive brief (under 120 words, ' +
        'plain text, no markdown) on this synthetic team\'s weekly contribution scores (0-100). ' +
        'The score blends four pillars with these weights: Company Alignment (goal attainment) ' +
        w.alignment + ', Performance (utilization) ' + w.performance +
        ', Employee Health (sustainable workload) ' + w.health +
        ', Recognition (peer kudos) ' + w.recognition + '. ' +
        'Ranked scores: ' + ranked.join('; ') + '. ' +
        'Highlight the top performer, anyone at risk (especially on Employee Health or ' +
        'Company Alignment), and one coaching recommendation.';
```

- [ ] **Step 2: Verify**

Reload. If a Groq key is configured, click ✨ "Generate executive brief" → a narrative referencing the pillars renders. If no key is configured, expect the unchanged graceful notice `⚠ Groq API key not set — admin must configure it.` Either outcome is a pass (the demo math is unaffected). Re-run `_test_contribMath()` → still passes.

- [ ] **Step 3: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"
git commit -m "Speak pillar language in Contribution demo AI executive brief"
```

---

### Task 5: Final verification (dual-mount + cleanup)

**Files:** none changed unless an issue is found.

- [ ] **Step 1: Dual-mount check**

The demo can render in the `#demos` tab AND inside the project modal at the same time. Load the page, open the **Live Demos** section on the Ops/Performance tab, then ALSO open the PS Contribution Dashboard project modal (registry id `Performance-Dashboard`). Confirm BOTH instances:
- show four sliders and re-rank independently when you drag each one,
- open independent radars when you click rows (no shared-id collisions — dragging one instance's slider must not move the other's).

- [ ] **Step 2: Header label check**

Confirm the demo header still reads sensibly. In `index.html` line ~2148 the header is `🏆 Contributor Intelligence — Weighted Team Scoring`. If desired for the manager framing, change it to:

```html
    <div class="demo-hd">🏆 Team Performance Control — Weighted Pillar Scoring</div>
```

(Optional polish — apply only if it reads better in context.)

- [ ] **Step 3: Full test run**

Console: `_test_contribMath()` → `✓ contrib math tests passed`, no warnings.

- [ ] **Step 4: Commit any final changes**

If Step 2 changed the header:

```bash
git add "docs/superpowers/gas-portfolio/index.html"
git commit -m "Reframe Contribution demo header as Team Performance Control"
```

Otherwise no commit needed — the feature is complete.

---

## Self-Review (completed by plan author)

- **Spec coverage:** rename/drop-RCR (Task 1), sweet-spot health math (Task 1, Step 5 + tests), four sliders (Task 1, Step 9), radar overlay replacing bars (Task 2), team-summary strip (Task 3), AI prompt pillar language (Task 4), container-scoping preserved & dual-mount verified (Task 5, Step 1), `_test_demoMath` equivalent created as `_test_contribMath` with health boundaries + composite + radar geometry (Tasks 1–2). All spec sections mapped.
- **Placeholders:** none — every code step shows full before/after.
- **Type/name consistency:** keys `alignment`/`performance`/`health`/`recognition` used identically across `METRICS`, `normsFor`, `rawLabel`, refs, template classes (`cs-w-<key>`), default weights, AI prompt (`w.alignment` etc.), and tests. Module exposes `_normsFor`/`_scoreFor`/`_radarPoints`; tests call exactly those. `refs.detailBody` (renamed from `detailRows`) is set in Task 2 Step 5 and used only in the Task 2 Step 6 `renderDetail`.
