# Reduced-Metric Team Members Format (Pill Stack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For teams without tracked/planned hours (R&D, Sales & Success/JF004), render Team Members week cells as a uniform pill stack (Option C), drop future week columns, fix week-column sort, and metric-gate the drawer's hour-ish pieces.

**Architecture:** Frontend-only change in `PS Dashboard.html`. A single derived flag `isHoursTeam_()` (built on the existing `hasMetric_()` team-metric gate) branches the week-cell renderer, the week universe, and the sort comparator. Services rendering stays byte-for-byte identical; legacy payloads without `meta.team` keep pre-toggle behavior because `hasMetric_()` returns true for every key.

**Tech Stack:** Google Apps Script HtmlService SPA — vanilla JS + CSS inside `PS Dashboard.html`. No test framework for this file; verification is targeted grep/read checks plus a live-QA checklist (dashboard deploys are manual, done by the owner in the GAS editor).

**Spec:** `ps-dashboard/docs/specs/2026-07-09-reduced-metric-team-members-format-design.md`

**Line numbers below are as of commit `790b4c2`** — re-locate with the quoted context if the file has drifted.

---

## File Structure

One file modified — `D:\Contribution\PS Dashboard.html`:

| Region | Change |
|---|---|
| CSS `.week-cell` block (~line 264–313) | New `.wc-pills`, `.gpill*`, `.wc-vmid` classes + dark-mode variants |
| CSS readability tier (~line 972) | Add `.gpill` to the 11px tier |
| `hasMetric_()` (~line 2592) | New `isHoursTeam_()` helper right below |
| `sortEmployees()` (~line 5266) | `week:` branch gains reduced-metric comparator |
| Above `renderEmployeeTable()` (~line 5318) | New `buildPillStackCell_()` helper |
| `renderEmployeeTable()` (~line 5321, 5369, 5384–5446) | Week filter, `hoursTeam` flag, cell branch |
| `buildDetailHTML()` (~line 5476, 5504, 5574) | Week filter, RCR gate, PROJECTS gate |
| `buildActionPrompt_()` (~line 5888, 5914) | RCR + low-hours prompt gates |

---

### Task 1: CSS — pill-stack classes

**Files:**
- Modify: `PS Dashboard.html` (CSS block, after `.wc-delta` tier rules ~line 313; readability tier ~line 972)

- [ ] **Step 1: Add the pill-stack classes**

Find this existing block (ends ~line 313):

```css
/* Week delta label beneath W-1 cell value */
.wc-delta { font-size: 9px; font-weight: 700; margin-top: 2px; }
.delta-up      { color: var(--success); }
.delta-down    { color: var(--june); }
.delta-neutral { color: var(--muted); }
```

Insert immediately after it:

```css
/* Reduced-metric team week cells — uniform pill stack (Option C).
   Spec: ps-dashboard/docs/specs/2026-07-09-reduced-metric-team-members-format-design.md */
.emp-table td.wc-vmid { vertical-align: middle; }
.wc-pills { display: flex; gap: 3px; align-items: center; justify-content: center; flex-wrap: wrap; }
.gpill { display: inline-flex; align-items: center; gap: 2px; border-radius: 99px; padding: 1px 7px; font-size: 9px; font-weight: 800; white-space: nowrap; }
.gpill-ok   { background: #DCFCE7; color: #15803D; }
.gpill-err  { background: #FEE2E2; color: #B91C1C; }
.gpill-prog { background: #FEF3C7; color: #92400E; }
.gpill-pto  { background: #EFF6FF; color: #1D4ED8; }
body.dark-mode .gpill-ok   { background: #052e16; color: #86EFAC; }
body.dark-mode .gpill-err  { background: #450a0a; color: #FCA5A5; }
body.dark-mode .gpill-prog { background: #431407; color: #FDBA74; }
body.dark-mode .gpill-pto  { background: #0c2a3d; color: #93C5FD; }
```

- [ ] **Step 2: Add `.gpill` to the 11px readability tier**

Find (~line 972, inside the "11px tier" selector list):

```css
.wc-plan-lbl, .wc-delta, .kudos-pill, .pto-pill,
```

Replace with:

```css
.wc-plan-lbl, .wc-delta, .kudos-pill, .pto-pill, .gpill,
```

- [ ] **Step 3: Verify**

Run: `grep -c "gpill" "PS Dashboard.html"` (Grep tool, `output_mode: count`)
Expected: 10 lines (9 rules in the new block + 1 in the tier list). Task 3 adds more later.

- [ ] **Step 4: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "style(teams): pill-stack CSS for reduced-metric team week cells"
```

---

### Task 2: `isHoursTeam_()` helper

**Files:**
- Modify: `PS Dashboard.html:2592-2595` (after `hasMetric_`)

- [ ] **Step 1: Add the helper**

Find:

```js
function hasMetric_(k) {
  var m = DATA && DATA.meta && DATA.meta.team && DATA.meta.team.metrics;
  return !m || m.indexOf(k) !== -1;
}
```

Insert immediately after:

```js
// True when the active team carries any hours metric (tracked or planned).
// False for R&D / Sales & Success — they get the pill-stack Team Members
// format with past + current week columns only. Legacy payloads without
// meta.team read as hours teams (hasMetric_ returns true for every key).
function isHoursTeam_() {
  return hasMetric_('tracked') || hasMetric_('planned');
}
```

- [ ] **Step 2: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): isHoursTeam_ gate — metric-set flag for hours-less teams"
```

---

### Task 3: `renderEmployeeTable()` — week filter, flag, pill-stack cells

**Files:**
- Modify: `PS Dashboard.html:5318-5446`
- Add helper above `renderEmployeeTable()` (~line 5318)

- [ ] **Step 1: Add `buildPillStackCell_()` helper**

Insert immediately above `function renderEmployeeTable() {` (~line 5318):

```js
// Week cell for reduced-metric teams (no tracked/planned hours): a centered
// row of equal-weight pills — goals state, kudos, PTO, public holiday.
// Weeks reaching here are past + current only (future columns are filtered
// out for these teams). crewE suppresses goals pills (crew have no Goals).
function buildPillStackCell_(w, wd, phHit, crewE) {
  var pills = "";
  var gd = wd.goalsDetail;
  if (!crewE && gd) {
    if (w.isCurrentWeek) {
      pills += gd.compliant
        ? '<span class="gpill gpill-ok">Goals ✓</span>'
        : '<span class="gpill gpill-prog">in progress</span>';
    } else {
      pills += gd.compliant
        ? '<span class="gpill gpill-ok">Goals ✓</span>'
        : '<span class="gpill gpill-err">Goals ✗</span>';
    }
  }
  var kd = wd.kudos;
  if (kd && kd.count > 0) pills += '<span class="kudos-pill">♥ ' + kd.count + '</span>';
  if (wd.ptoPlannedHrs != null && wd.ptoPlannedHrs > 0)
    pills += '<span class="gpill gpill-pto">' + fmtHrs(wd.ptoPlannedHrs) + ' PTO</span>';
  if (phHit) pills += '<span class="ph-pill" title="' + esc(phHit.holiday) + '">PH</span>';
  return pills ? '<div class="wc-pills">' + pills + '</div>' : '<span class="wc-null">—</span>';
}
```

- [ ] **Step 2: Filter the week universe and compute the flag**

Find (top of `renderEmployeeTable()`, ~line 5319-5321):

```js
  if (!DATA) return;
  var list  = sortEmployees(getFilteredEmployees());
  var weeks = DATA.weeks;
```

Replace with:

```js
  if (!DATA) return;
  var list  = sortEmployees(getFilteredEmployees());
  var hoursTeam = isHoursTeam_();
  // Reduced-metric teams have no forward-looking data — drop future columns.
  var weeks = hoursTeam ? DATA.weeks : DATA.weeks.filter(function(w) { return !w.isFuture; });
```

Every colspan, header, and cell below derives from this local `weeks` array, so no other layout change is needed.

- [ ] **Step 3: Branch the cell builder**

Find (~line 5384-5393):

```js
    weeks.forEach(function(w) {
      var cls = w.isCurrentWeek ? "col-current" : w.isFuture ? "col-future" : "";
      var wd  = (emp.weeks || {})[w.label] || {};
      html += '<td class="week-cell ' + cls + '">';

      // Public holiday lookup for this employee + week
      var phWeekData = ((DATA.phByWeek || {})[w.label] || {}).entries || [];
      var phHit = phWeekData.find(function(e) { return e.affectedNames.indexOf(emp.name) !== -1; });

      if (w.isFuture) {
```

Replace with:

```js
    weeks.forEach(function(w) {
      var cls = w.isCurrentWeek ? "col-current" : w.isFuture ? "col-future" : "";
      html += '<td class="week-cell ' + cls + (hoursTeam ? '' : ' wc-vmid') + '">';
      var wd  = (emp.weeks || {})[w.label] || {};

      // Public holiday lookup for this employee + week
      var phWeekData = ((DATA.phByWeek || {})[w.label] || {}).entries || [];
      var phHit = phWeekData.find(function(e) { return e.affectedNames.indexOf(emp.name) !== -1; });

      // Reduced-metric teams: uniform pill stack — no hours slot (Option C)
      if (!hoursTeam) {
        html += buildPillStackCell_(w, wd, phHit, crewE) + '</td>';
        return;
      }

      if (w.isFuture) {
```

The hours-team path below the branch is untouched.

- [ ] **Step 4: Verify the hours path is unchanged**

Read `renderEmployeeTable()` end to end. Confirm: (a) the `w.isFuture` / `w.isCurrentWeek` / past-week branches are byte-identical to before apart from the inserted block; (b) `crewE` is defined before the `weeks.forEach` (it is — line ~5368 `var crewE = isCrewEmp(emp);`); (c) the `</td>` for the pill branch is emitted inside the early-return.

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): pill-stack week cells + past/current-only columns for reduced-metric teams"
```

---

### Task 4: `sortEmployees()` — goals/kudos comparator for reduced-metric teams

**Files:**
- Modify: `PS Dashboard.html:5266-5271`

- [ ] **Step 1: Replace the `week:` branch**

Find:

```js
    } else if (k.indexOf("week:") === 0) {
      var _wl = k.slice(5);
      var _wa = (a.weeks || {})[_wl] || {};
      var _wb = (b.weeks || {})[_wl] || {};
      va = _wa.trackedHrs != null ? _wa.trackedHrs : (_wa.plannedHrs || 0);
      vb = _wb.trackedHrs != null ? _wb.trackedHrs : (_wb.plannedHrs || 0);
    } else {
```

Replace with:

```js
    } else if (k.indexOf("week:") === 0) {
      var _wl = k.slice(5);
      var _wa = (a.weeks || {})[_wl] || {};
      var _wb = (b.weeks || {})[_wl] || {};
      if (isHoursTeam_()) {
        va = _wa.trackedHrs != null ? _wa.trackedHrs : (_wa.plannedHrs || 0);
        vb = _wb.trackedHrs != null ? _wb.trackedHrs : (_wb.plannedHrs || 0);
      } else {
        // Reduced-metric teams: goals compliance dominates, kudos breaks ties
        va = (((_wa.goalsDetail || {}).compliant) ? 1000 : 0) + ((_wa.kudos || {}).count || 0);
        vb = (((_wb.goalsDetail || {}).compliant) ? 1000 : 0) + ((_wb.kudos || {}).count || 0);
      }
    } else {
```

- [ ] **Step 2: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): week-column sort by goals compliance for reduced-metric teams"
```

---

### Task 5: `buildDetailHTML()` — week filter + RCR/PROJECTS metric gates

**Files:**
- Modify: `PS Dashboard.html:5476, 5504, 5574`

- [ ] **Step 1: Filter the drawer's week universe**

Find (~line 5476):

```js
function buildDetailHTML(emp) {
  var weeks     = DATA.weeks;
```

Replace with:

```js
function buildDetailHTML(emp) {
  var weeks     = isHoursTeam_() ? DATA.weeks
                : DATA.weeks.filter(function(w) { return !w.isFuture; });
```

All drawer rows (PROJECTS, GOALS, KUDOS, PTO, PH) and colspans iterate this local `weeks`, so future columns disappear for reduced-metric teams automatically. The future-week branches inside those rows become dead code for these teams — harmless, and still exercised by Services.

- [ ] **Step 2: Gate the RCR exec card + full chart on the metric set**

Find (~line 5504):

```js
  if (rcrPts.length) {
    _execCards.push(execTrendCard_('RCR', rcrPts, '#058CDC', _rcrFmt, {
```

Replace with:

```js
  if (hasMetric_('rcr') && rcrPts.length) {
    _execCards.push(execTrendCard_('RCR', rcrPts, '#058CDC', _rcrFmt, {
```

(The `_fullCharts.push` for "RCR — monthly" is inside this same `if` — one gate covers both.)

- [ ] **Step 3: Gate the PROJECTS row on the planned metric**

Find (~line 5574):

```js
  if (anyProj) {
    // Summary row (count) with chevron
```

Replace with:

```js
  if (hasMetric_('planned') && anyProj) {
    // Summary row (count) with chevron
```

- [ ] **Step 4: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): drawer week filter + explicit RCR/PROJECTS metric gates"
```

---

### Task 6: `buildActionPrompt_()` — coaching prompt gates

**Files:**
- Modify: `PS Dashboard.html:5888, 5914`

- [ ] **Step 1: Gate the RCR prompt (№0)**

Find (~line 5888):

```js
  if (emp.rcr && emp.rcr.value !== null && emp.rcr.value <= 1.0 &&
      teamRcr !== null && teamRcr > emp.rcr.value + 0.5) {
```

Replace with:

```js
  if (hasMetric_('rcr') && emp.rcr && emp.rcr.value !== null && emp.rcr.value <= 1.0 &&
      teamRcr !== null && teamRcr > emp.rcr.value + 0.5) {
```

- [ ] **Step 2: Gate the low-hours prompt (№2)**

Find (~line 5913-5922):

```js
  // 2 · Low hours on most recent closed week (most recent first)
  for (var i = (pastWeeks || []).length - 1; i >= 0; i--) {
    var pw = pastWeeks[i];
    var wd = emp.weeks[pw.label] || {};
    if (wd.trackedHrs !== null && wd.trackedHrs < 20) {
      var plannedStr = wd.plannedHrs !== null ? Math.round(wd.plannedHrs) + 'h planned' : '40h target';
      return '<div class="det-action det-action-warn">Follow up on ' + esc(pw.label) +
        ' hour logging — ' + Math.round(wd.trackedHrs) + 'h tracked vs ' + plannedStr + '.</div>';
    }
  }
```

Replace with:

```js
  // 2 · Low hours on most recent closed week (most recent first) — hours teams only
  if (hasMetric_('tracked')) {
    for (var i = (pastWeeks || []).length - 1; i >= 0; i--) {
      var pw = pastWeeks[i];
      var wd = emp.weeks[pw.label] || {};
      if (wd.trackedHrs !== null && wd.trackedHrs < 20) {
        var plannedStr = wd.plannedHrs !== null ? Math.round(wd.plannedHrs) + 'h planned' : '40h target';
        return '<div class="det-action det-action-warn">Follow up on ' + esc(pw.label) +
          ' hour logging — ' + Math.round(wd.trackedHrs) + 'h tracked vs ' + plannedStr + '.</div>';
      }
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(teams): metric-gate RCR and low-hours coaching prompts"
```

---

### Task 7: Static verification sweep + wrap-up

**Files:**
- Read: `PS Dashboard.html` (changed regions)

- [ ] **Step 1: Grep sweep for completeness**

Run these Grep checks against `PS Dashboard.html`:

| Pattern | Expect |
|---|---|
| `isHoursTeam_` | 4 matches: definition + renderEmployeeTable + sortEmployees + buildDetailHTML |
| `buildPillStackCell_` | 2 matches: definition + call site |
| `wc-vmid` | 2 matches: CSS + td class builder |
| `hasMetric_\('rcr'\)` | ≥2 matches: drawer card gate + prompt gate |
| `hasMetric_\('planned'\)` | ≥2 matches: header label (pre-existing) + PROJECTS gate |

- [ ] **Step 2: Syntax sanity check**

The file is a GAS HTML template — extract and parse the main script block to catch typos:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('PS Dashboard.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
blocks.forEach((b, i) => { new Function(b); });
console.log('OK — ' + blocks.length + ' script block(s) parsed');
"
```

Expected: `OK — N script block(s) parsed` (no SyntaxError). Note: `new Function` only parses — it does not execute.

- [ ] **Step 3: Live QA checklist (deferred to owner's GAS deploy)**

Record in the final report that these checks are pending the next manual GAS deploy — no `PS_CACHE_VER` bump needed (frontend-only):

1. **Services** — identical to before: hours cells, future columns, "tracked/planned" header labels, PROJECTS + RCR in drawer, hours sort, crew filter.
2. **R&D** — pill cells only (no `—` hours slots), no future columns, week-column sort groups compliant first, drawer = SI card + GOALS/KUDOS/PTO + 4-axis radar, no RCR/PROJECTS, coaching prompt never mentions hours/RCR.
3. **Sales & Success** — same assertions as R&D.
4. **Current week** — amber `in progress` pill; flips to `Goals ✓` once compliant.
5. **Dark mode** — pill colors legible on dark surfaces.
6. **Legacy payload guard** — with `meta.team` absent (simulate by nulling `DATA.meta.team` in DevTools and re-rendering), hours rendering everywhere.

- [ ] **Step 4: Final commit (if any stragglers) and report**

```bash
git status --short
```

Expected: clean (all changes committed in Tasks 1–6).
