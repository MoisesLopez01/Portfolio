# Planned-Time Project Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a display-only, week-over-week record of how many distinct projects each rocketeer is *planned* across (from the Tempo "Key" column), shown in the rocketeer expandable panel and a new Trends card.

**Architecture:** The backend captures planned hours split by project key into one new payload field per employee-week (`emp.weeks[label].projects = [{key, hrs}]`), excluding non-project keys (`NETSUITE`). Everything else — the distinct count, the "new this week" highlight, and the team-level Trends rollup — is derived client-side from that single field, so the Trends view stays filter-aware like every other Trends card. No new sheet reads; no scoring integration.

**Tech Stack:** Google Apps Script (server, `PS Contribution Report.js`), vanilla JS + HTML served via `HtmlService` (`PS Dashboard.html`). No build step. Backend logic is unit-testable in the GAS editor or Node (per the existing `_test_weightsResolver()` convention).

**Spec:** `ps-dashboard/docs/specs/2026-06-22-planned-time-project-context-design.md`

---

## File Structure

- **`PS Contribution Report.js`** (modify)
  - `CONFIG_PS` — add `PLANNED_NONPROJECT_KEYS`.
  - New pure helper `buildPlannedResult_(vals, psNames, weeks, nonProjectKeys)` — all current row-parsing logic of `readPlannedTimeByWeek_`, plus a per-key map. Pure (no `SpreadsheetApp`) → unit-testable.
  - `readPlannedTimeByWeek_` — thin wrapper: fetch sheet values, delegate to `buildPlannedResult_`.
  - `subtractPTOFromPlanned_` — pass `byEmployeeProjects` through unchanged.
  - `buildEmployeeRows_` — add `projects` to each `empWeeks[label]`.
  - New test `_test_projectContext_()`.
- **`PS Dashboard.html`** (modify)
  - CSS: `.proj-pill`, `.proj-pill-new`, `.proj-hrs-line`, `.projctx-*` (+ dark-mode).
  - `buildDetailHTML` — new `PROJECTS` row in the per-week detail table.
  - Trends pane — new `#projCtxCard` container.
  - New `renderProjectContext(filtered)` + `toggleProjCtxHrs(linkEl, bodyId)`; call `renderProjectContext(_tf)` from `renderTrendsTab`.

---

## Task 1: Add the non-project-key config constant

**Files:**
- Modify: `PS Contribution Report.js` (the `CONFIG_PS` object, near `SHEET_PLANNED` at line 27)

- [ ] **Step 1: Add the constant**

In `CONFIG_PS`, immediately after the `SHEET_PLANNED: "Planned Time Tempo",` line, add:

```js
  // Project keys in the Planned Time Tempo "Key" column that are NOT real projects
  // and must be excluded from project-context counts. "NETSUITE" = time-off synced
  // from NetSuite (already represented elsewhere in the report). Matched case-insensitively.
  PLANNED_NONPROJECT_KEYS: ["NETSUITE"],
```

- [ ] **Step 2: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "Add PLANNED_NONPROJECT_KEYS config for project-context exclusions"
```

---

## Task 2: Capture planned hours split by project key (backend, TDD)

Extract the row-parsing core of `readPlannedTimeByWeek_` into a pure function that also builds a per-employee, per-week project→hours map, excluding non-project keys. Write the test first.

**Files:**
- Modify: `PS Contribution Report.js:1631-1701` (`readPlannedTimeByWeek_`)
- Test: `PS Contribution Report.js` (new `_test_projectContext_()` near the file's other `_test_*` functions)

- [ ] **Step 1: Write the failing test**

Add this function (place it near the end of the file, alongside other `_test_*` helpers):

```js
// Unit test for project-context capture. Run in the GAS editor, or in Node
// (per the _test_weightsResolver convention — stub Logger if running standalone).
function _test_projectContext_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_projectContext_: " + msg); }

  // Fake Planned Time Tempo matrix: two-row stacked header + 3 project rows + TOTAL footer.
  // Ana is planned ACME(10/10), BETA(10/10), and NETSUITE time-off(8/8) across W14 + W15.
  const vals = [
    ["", "", "", "", "2026.W14", "2026.W15", ""],
    ["User", "Space", "Key", "Planned (hrs)", "Mar 30 - Apr 05 2026", "Apr 06 - Apr 12 2026", "Total (hrs)"],
    ["Ana Smith", "Acme Project", "ACME", 20, 10, 10, 20],
    ["Ana Smith", "Beta Project", "BETA", 20, 10, 10, 20],
    ["Ana Smith", "Time off", "NETSUITE", 16, 8, 8, 16],
    ["TOTAL", "", "", 56, 28, 28, 56],
  ];
  const psNames = new Map([[normPS_("Ana Smith"), { name: "Ana Smith" }]]);
  const weeks = [{ label: "2026.W14" }, { label: "2026.W15" }];

  const res = buildPlannedResult_(vals, psNames, weeks, ["NETSUITE"]);
  const norm = normPS_("Ana Smith");

  // Total planned hours are UNCHANGED — they still include the NETSUITE time-off rows.
  assert_(res["2026.W14"].byEmployee[norm] === 28, "W14 total should be 28, got " + res["2026.W14"].byEmployee[norm]);

  // Project map EXCLUDES NETSUITE → exactly ACME + BETA.
  const projs = res["2026.W14"].byEmployeeProjects[norm] || {};
  const keys = Object.keys(projs).sort();
  assert_(keys.length === 2, "expected 2 project keys, got " + keys.join(","));
  assert_(keys[0] === "ACME" && keys[1] === "BETA", "expected ACME+BETA, got " + keys.join(","));
  assert_(projs.ACME === 10 && projs.BETA === 10, "expected 10h each, got ACME=" + projs.ACME + " BETA=" + projs.BETA);
  assert_(!("NETSUITE" in projs), "NETSUITE must be excluded from project map");

  Logger.log("✅ _test_projectContext_ passed");
}
```

- [ ] **Step 2: Run the test to verify it fails**

In the GAS editor, select `_test_projectContext_` and Run.
Expected: FAIL — `ReferenceError: buildPlannedResult_ is not defined` (the function doesn't exist yet).

- [ ] **Step 3: Implement `buildPlannedResult_` and slim down `readPlannedTimeByWeek_`**

Replace the entire current `readPlannedTimeByWeek_` (lines 1631-1701) with the wrapper **plus** the new pure helper:

```js
function readPlannedTimeByWeek_(psNames, weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG_PS.SHEET_PLANNED);
  if (!sh) Logger.log(`⚠️ Planned Time sheet not found.`);
  const vals = sh ? sh.getDataRange().getValues() : [];
  return buildPlannedResult_(vals, psNames, weeks, CONFIG_PS.PLANNED_NONPROJECT_KEYS);
}

// Pure parser for the Planned Time Tempo matrix. Separated from the sheet fetch so it
// can be unit-tested (see _test_projectContext_). Returns, per week label:
//   { totalHrs, headcount, byEmployee:{norm:hrs}, byEmployeeProjects:{norm:{KEY:hrs}} }
// The total/headcount/byEmployee math is identical to the previous inline version
// (it still sums every week-column hour, time-off rows included). byEmployeeProjects
// is a parallel accumulation that additionally drops blank and non-project keys.
function buildPlannedResult_(vals, psNames, weeks, nonProjectKeys) {
  const result = {};
  weeks.forEach(w => { result[w.label] = { totalHrs: 0, headcount: 0, byEmployee: {}, byEmployeeProjects: {} }; });
  if (!vals || vals.length < 2) return result;

  // The Tempo export writes a TWO-ROW stacked header (ISO labels over week columns in
  // row 1; field names in row 2). Locate the field-header row by its employee column,
  // then take week labels from the ISO-label row above it (new format) or that same row.
  const isEmpHdr_ = h => /user|resource|rocketeer|name|employee/i.test(h) && !/type|role|skill|program|team/i.test(h);
  let hr = -1, iEmp = -1;
  for (let r = 0; r < Math.min(vals.length, 5); r++) {
    const idx = vals[r].findIndex(c => isEmpHdr_(String(c).trim()));
    if (idx !== -1) { hr = r; iEmp = idx; break; }
  }
  if (hr === -1) { Logger.log(`⚠️ Planned Time: employee column not found.`); return result; }

  // Project key column ("Key"). Absent in legacy single-row exports → no project context.
  const iKey = vals[hr].findIndex(c => String(c).trim().toLowerCase() === "key");
  const excludeKeys = new Set((nonProjectKeys || []).map(k => String(k).trim().toUpperCase()));

  const isoRe   = /^\s*\d{4}\.?W\d+\s*$/i;
  const labelRow = (hr > 0 && vals[hr - 1].some(c => isoRe.test(String(c)))) ? vals[hr - 1] : vals[hr];
  const defYear = isoWeekYear_PS_(new Date());

  const wCols = [];
  labelRow.forEach((cell, idx) => {
    const key = weekToKey_PS_(cell, defYear);
    if (!key) return;
    const match = weeks.find(w => w.label === key);
    if (match) wCols.push({ key: match.label, idx });
  });

  const plannedAliases = new Map();
  for (const rosterNorm of psNames.keys()) {
    const parts = rosterNorm.split(' ');
    if (parts.length >= 2) {
      const last  = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(' ');
      plannedAliases.set(normPS_(`${last} ${first}`),   rosterNorm);
      plannedAliases.set(normPS_(`${last}, ${first}`),  rosterNorm);
    }
  }
  const lookupPlanned_ = raw => {
    const n = normPS_(String(raw || '').trim());
    return psNames.has(n) ? n : (plannedAliases.has(n) ? plannedAliases.get(n) : null);
  };

  // Data rows start after the field-header row; the export's "TOTAL" footer row is
  // skipped naturally since "TOTAL" resolves to no roster member.
  vals.slice(hr + 1).forEach(row => {
    const norm = lookupPlanned_(row[iEmp]);
    if (!norm) return;
    const rawKey    = iKey !== -1 ? String(row[iKey] || '').trim() : '';
    const isProject = !!rawKey && !excludeKeys.has(rawKey.toUpperCase());
    wCols.forEach(({ key, idx }) => {
      const hrs = parseFloat(row[idx]) || 0;
      if (hrs <= 0) return;
      const b = result[key];
      if (!b.byEmployee[norm]) { b.headcount++; b.byEmployee[norm] = 0; }
      b.byEmployee[norm] += hrs;
      b.totalHrs += hrs;
      if (isProject) {
        if (!b.byEmployeeProjects[norm]) b.byEmployeeProjects[norm] = {};
        b.byEmployeeProjects[norm][rawKey] = (b.byEmployeeProjects[norm][rawKey] || 0) + hrs;
      }
    });
  });

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

In the GAS editor, Run `_test_projectContext_`.
Expected: log shows `✅ _test_projectContext_ passed` and no exception.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "Capture planned hours by project key (pure buildPlannedResult_ + test)"
```

---

## Task 3: Thread project data through PTO subtraction and into the employee payload

`buildEmployeeRows_` receives the PTO-adjusted planned object (`plannedAdjAll`), so `byEmployeeProjects` must survive `subtractPTOFromPlanned_`, then be emitted as `emp.weeks[label].projects`.

**Files:**
- Modify: `PS Contribution Report.js:2354-2359` (`subtractPTOFromPlanned_` `out[wLabel]` object)
- Modify: `PS Contribution Report.js:2022-2029` (`buildEmployeeRows_` `empWeeks[l]` object)

- [ ] **Step 1: Pass `byEmployeeProjects` through `subtractPTOFromPlanned_`**

In `subtractPTOFromPlanned_`, change the `out[wLabel]` assignment (currently lines 2354-2359) to carry the project map unchanged (PTO subtraction does not touch project context — the time-off key is already excluded):

```js
    out[wLabel] = {
      totalHrs:      totalNet,
      headcount:     hcNet,
      byEmployee:    netByEmp,
      ptoByEmployee: ptoByEmp,
      byEmployeeProjects: src.byEmployeeProjects || {},
    };
```

- [ ] **Step 2: Emit `projects` on each employee-week in `buildEmployeeRows_`**

In `buildEmployeeRows_`, inside the `weeks.forEach`, add a `projects` field to the `empWeeks[l]` object (after the `goalsDetail` line at 2028). It converts the `{KEY: hrs}` map to a sorted array; empty array when there are no planned project hours that week:

```js
        goalsDetail: w.isFuture  ? null : (goals[l]  && goals[l].byEmployee[norm]    != null ? goals[l].byEmployee[norm]    : null),
        projects: (function() {
          var m = planned[l] && planned[l].byEmployeeProjects && planned[l].byEmployeeProjects[norm];
          if (!m) return [];
          return Object.keys(m)
            .map(function(k) { return { key: k, hrs: m[k] }; })
            .sort(function(a, b) { return b.hrs - a.hrs; });
        })(),
```

Note: `projects` is populated for future weeks too (planned data fills the future) — it is intentionally **not** gated on `w.isFuture`, unlike `trackedHrs`/`kudos`/`goalsDetail`.

- [ ] **Step 3: Verify the payload field appears**

In the GAS editor, Run `getPSReportData` (or your existing smoke-test entry). In the execution log / returned object, confirm at least one `employees[i].weeks["<label>"].projects` is a non-empty array of `{key, hrs}` for someone with planned project time. If you cannot easily inspect the return value, add a temporary `Logger.log(JSON.stringify(employees[0].weeks))` before the function returns, run, read the log, then remove the temporary line.

- [ ] **Step 4: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "Emit per-employee-week projects[] in report payload"
```

---

## Task 4: Rocketeer panel — PROJECTS row

Add a `PROJECTS` summary + expandable detail row to the per-week table in `buildDetailHTML`. Collapsed = distinct count; expanded = key pills (sorted by hrs desc, new-this-week amber) + a compact hours line. Shown for FTE and crew alike, so it goes first in the table body.

**Files:**
- Modify: `PS Dashboard.html` — CSS block near line 350 (`.det-expand-pad` area)
- Modify: `PS Dashboard.html` — dark-mode block near line 1078
- Modify: `PS Dashboard.html:4729` (`buildDetailHTML`, right after `html += '</tr></thead><tbody>';`)

- [ ] **Step 1: Add the pill / hours-line CSS**

After the `.det-expand-pad { ... }` rule (line 350), add:

```css
/* ── Project-context pills (rocketeer panel + Trends) ── */
.proj-pill { display:inline-block; background:#EEF4FF; color:#3730A3; border-radius:4px; padding:1px 5px; margin:1px; font-size:9.5px; font-weight:600; }
.proj-pill-new { background:#FEF3C7; color:#92400E; }
.proj-hrs-line { font-size:9px; color:var(--slate); margin-top:3px; font-weight:700; letter-spacing:.02em; }
```

- [ ] **Step 2: Add dark-mode overrides**

After the `body.dark-mode .det-row-open .det-expand-lbl-cell { ... }` rule (line 1079), add:

```css
body.dark-mode .proj-pill     { background:#1E295A; color:#A9C2FF; }
body.dark-mode .proj-pill-new { background:#3A2E10; color:#FCD34D; }
```

- [ ] **Step 3: Insert the PROJECTS row as the first body row**

In `buildDetailHTML`, immediately after the line `html += '</tr></thead><tbody>';` (line 4729), insert:

```js
  // ── PROJECTS (context) row — distinct planned-project count per week ──────
  // Pure context: how many projects this person is planned across each week.
  // Count on top; expand for key pills (sorted by hrs desc) + a compact hours line.
  // A key absent the prior in-window week is amber (a context switch). Past + future.
  var anyProj = weeks.some(function(w) {
    var ps = (emp.weeks[w.label] || {}).projects;
    return ps && ps.length;
  });
  if (anyProj) {
    // Summary row (count) with chevron
    html += '<tr class="det-expand-hdr" onclick="toggleDetSubRow(this,\'' + uid + '_proj\')">';
    html += '<td class="det-expand-lbl-cell"><span class="det-ts-row-lbl">PROJECTS</span><span class="det-chevron">›</span></td>';
    weeks.forEach(function(w) {
      var ps = (emp.weeks[w.label] || {}).projects || [];
      var wColor = w.isCurrentWeek ? 'color:var(--orbe);' : w.isFuture ? 'color:var(--muted);opacity:.7;' : 'color:var(--slate);';
      html += '<td><span style="font-size:15px;font-weight:800;' + wColor + '">' + (ps.length ? ps.length : '—') + '</span></td>';
    });
    html += '</tr>';
    // Detail row — key pills + compact hours line; amber = new vs. prior week
    html += '<tr class="det-expand-body" id="' + uid + '_proj">';
    html += '<td class="det-expand-lbl-cell"><div class="det-expand-inner"></div></td>';
    var projPrevKeys = null; // prior in-window week's key set (null for the first week → baseline)
    weeks.forEach(function(w) {
      var ps = (emp.weeks[w.label] || {}).projects || [];
      html += '<td><div class="det-expand-inner"><div class="det-expand-pad">';
      if (!ps.length) {
        html += '<span style="color:var(--muted)">—</span>';
      } else {
        var pills = ps.map(function(p) {
          var isNew = projPrevKeys && projPrevKeys.indexOf(p.key) === -1;
          return '<span class="proj-pill' + (isNew ? ' proj-pill-new' : '') + '">' + esc(p.key) + '</span>';
        }).join('');
        var hrsLine = ps.map(function(p) { return Math.round(p.hrs || 0); }).join(' · ') + 'h';
        html += '<div>' + pills + '</div>';
        html += '<div class="proj-hrs-line">' + hrsLine + '</div>';
      }
      html += '</div></div></td>';
      projPrevKeys = ps.map(function(p) { return p.key; }); // advance to this week's set
    });
    html += '</tr>';
  }
```

- [ ] **Step 4: Manual UI check**

Deploy/sync the updated `PS Dashboard.html` to the Apps Script project and open the web app (or test the HTML against a saved payload if you have one). On the Overview tab, expand a rocketeer who has planned time. Verify:
- A `PROJECTS` row appears (first row of the detail table) showing a count per week; current week orange, future weeks muted.
- Clicking the row expands it to show project-key pills sorted by hours descending, with a `16 · 10 · …h` line beneath.
- A project that appears in a week but not the immediately prior week renders amber.
- The earliest week shows no amber (baseline).

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "Rocketeer panel: add PROJECTS context row (count + keys + hours)"
```

---

## Task 5: Trends tab — Project context card

Add a light, chart-free per-week card to the Trends tab: project keys active each week (new-this-week amber), expandable to planned hours per project with people counts. Aggregated over the filtered team.

**Files:**
- Modify: `PS Dashboard.html` — CSS near line 350 (after the rules added in Task 4)
- Modify: `PS Dashboard.html` — dark-mode block near line 1080 (after Task 4's overrides)
- Modify: `PS Dashboard.html:1767-1769` (Trends pane, after the `ptoTrendCard` `</div>`, before the pane-closing `</div>`)
- Modify: `PS Dashboard.html:7633` (`renderTrendsTab`, after `renderPTOTrend(_tf);`)
- Modify: `PS Dashboard.html` — add `renderProjectContext` + `toggleProjCtxHrs` (place near `renderPTOTrend`, ~line 7235, or after `toggleFullTrends` ~line 7943)

- [ ] **Step 1: Add the Trends-card CSS**

After the `.proj-hrs-line { ... }` rule added in Task 4, add:

```css
/* ── Trends: project-context week blocks ── */
.projctx-wk { border:1px solid var(--border); border-radius:8px; padding:8px 12px; margin-bottom:9px; }
.projctx-wk-cur { border-color:#FDBA74; background:#FFFBF5; }
.projctx-wklbl { font-size:9px; font-weight:800; text-transform:uppercase; color:var(--muted); letter-spacing:.06em; }
.projctx-wk-cur .projctx-wklbl { color:var(--orbe); }
.projctx-cap { font-size:9px; color:var(--muted); font-weight:600; margin-left:6px; }
.projctx-tags { margin-top:4px; }
.projctx-toggle { font-size:10px; font-weight:700; color:var(--orbe); cursor:pointer; user-select:none; margin-top:6px; display:inline-block; }
.projctx-hrs { margin-top:7px; border-top:1px dashed var(--border); padding-top:7px; font-size:10.5px; color:var(--slate); line-height:1.9; }
.projctx-h { font-weight:800; color:var(--slate); }
.projctx-pp { color:var(--muted); font-size:9.5px; }
```

- [ ] **Step 2: Add dark-mode override for the current-week block**

After the `body.dark-mode .proj-pill-new { ... }` rule added in Task 4, add:

```css
body.dark-mode .projctx-wk-cur { background:#2A2410; border-color:#7C5A1F; }
```

- [ ] **Step 3: Add the card container to the Trends pane**

In the Trends pane, after the `ptoTrendCard` block closes (the `</div>` at line 1767) and before the pane-closing `</div>` (line 1769), insert:

```html
    <!-- Project context — planned-project demand by week (no charts) -->
    <div class="section-card" id="projCtxCard" style="display:none">
      <div class="section-head">
        <div>
          <h2>Project context — planned demand by week</h2>
          <p class="section-sub" id="projCtxSub">Projects each rocketeer is planned across · amber = new vs. prior week</p>
        </div>
      </div>
      <div id="projCtxBody" style="padding:4px 16px 16px"></div>
    </div>
```

- [ ] **Step 4: Add the render + toggle functions**

Add these two functions (e.g. immediately after `toggleFullTrends` at line 7943):

```js
function toggleProjCtxHrs(linkEl, bodyId) {
  var body = document.getElementById(bodyId);
  if (!body) return;
  var opening = body.style.display === 'none';
  body.style.display = opening ? 'block' : 'none';
  linkEl.innerHTML = opening ? '− planned hours' : '+ planned hours';
}

// Trends card: per-week project demand across the FILTERED team. Pure context.
function renderProjectContext(filtered) {
  var card = document.getElementById("projCtxCard");
  var body = document.getElementById("projCtxBody");
  if (!DATA || !card || !body) return;
  var weeks = DATA.weeks || [];
  if (!weeks.length || !filtered || !filtered.length) { card.style.display = "none"; return; }

  // Aggregate per week: key -> { key, hrs, people } across the filtered team.
  var perWeek = weeks.map(function(w) {
    var byKey = {};
    filtered.forEach(function(e) {
      var ps = (e.weeks && e.weeks[w.label] && e.weeks[w.label].projects) || [];
      ps.forEach(function(p) {
        if (!byKey[p.key]) byKey[p.key] = { key: p.key, hrs: 0, people: 0 };
        byKey[p.key].hrs    += (p.hrs || 0);
        byKey[p.key].people += 1;
      });
    });
    var keys = Object.keys(byKey).map(function(k) { return byKey[k]; })
                     .sort(function(a, b) { return b.hrs - a.hrs; });
    return { w: w, keys: keys, keySet: keys.map(function(k) { return k.key; }) };
  });

  if (!perWeek.some(function(d) { return d.keys.length; })) { card.style.display = "none"; return; }
  card.style.display = "";

  var note = filtered.length < (DATA.employees || []).length ? " · filtered: " + filtered.length : "";
  var sub = document.getElementById("projCtxSub");
  if (sub) sub.textContent = "Projects each rocketeer is planned across · amber = new vs. prior week" + note;

  var html = "";
  perWeek.forEach(function(d, i) {
    var prev = i > 0 ? perWeek[i - 1].keySet : null; // prior in-window week (null → baseline)
    var newCount = prev ? d.keySet.filter(function(k) { return prev.indexOf(k) === -1; }).length : 0;
    var wkCls = d.w.isCurrentWeek ? "projctx-wk projctx-wk-cur" : "projctx-wk";
    var wkLbl = esc(d.w.label) + (d.w.isCurrentWeek ? " — current" : d.w.isFuture ? " — planned" : "");
    var cap = d.keys.length + " project" + (d.keys.length !== 1 ? "s" : "") + " active" + (newCount ? " · " + newCount + " new" : "");
    var bodyId = "projctx_" + i;

    html += '<div class="' + wkCls + '">';
    html += '<span class="projctx-wklbl">' + wkLbl + '</span><span class="projctx-cap">' + cap + '</span>';
    html += '<div class="projctx-tags">';
    d.keys.forEach(function(k) {
      var isNew = prev && prev.indexOf(k.key) === -1;
      html += '<span class="proj-pill' + (isNew ? ' proj-pill-new' : '') + '">' + esc(k.key) + '</span>';
    });
    html += '</div>';
    html += '<span class="projctx-toggle" onclick="toggleProjCtxHrs(this,\'' + bodyId + '\')">+ planned hours</span>';
    html += '<div id="' + bodyId + '" class="projctx-hrs" style="display:none">';
    d.keys.forEach(function(k) {
      var isNew = prev && prev.indexOf(k.key) === -1;
      html += '<div><span class="proj-pill' + (isNew ? ' proj-pill-new' : '') + '">' + esc(k.key) + '</span> ' +
              '<span class="projctx-h">' + Math.round(k.hrs) + 'h</span> ' +
              '<span class="projctx-pp">· ' + k.people + ' ' + (k.people === 1 ? 'person' : 'people') + '</span></div>';
    });
    html += '</div>';
    html += '</div>';
  });
  body.innerHTML = html;
}
```

- [ ] **Step 5: Call the renderer from `renderTrendsTab`**

In `renderTrendsTab`, immediately after the `renderPTOTrend(_tf);` line (line 7633), add:

```js
  renderProjectContext(_tf);
```

- [ ] **Step 6: Manual UI check**

Sync `PS Dashboard.html` and open the web app. Go to the Trends tab. Verify:
- A "Project context — planned demand by week" card appears with one block per week.
- Each block lists active project keys; new-vs-prior-week keys are amber; the caption reads e.g. `6 projects active · 2 new`; the current week's block has the orange tint.
- Clicking "+ planned hours" reveals `KEY  Nh  · M people` lines sorted by hours desc; the label toggles to "− planned hours".
- Applying a filter (e.g. a supervisor or search term) updates the card's keys, hours, and people counts — confirming it is filter-aware.

- [ ] **Step 7: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "Trends: add project-context card (per-week keys + planned hours/people)"
```

---

## Task 6: End-to-end verification & cleanup

**Files:** none (verification only)

- [ ] **Step 1: Re-run the backend unit test**

In the GAS editor, Run `_test_projectContext_` once more after all edits. Expected: `✅ _test_projectContext_ passed`.

- [ ] **Step 2: Cache-bust and full smoke test**

Open the deployed web app and click **Refresh** (forces `loadData(true)`, bypassing the 5-minute cache). Confirm:
- The dashboard loads without console/script errors.
- A rocketeer's PROJECTS row and the Trends project-context card both populate.
- `NETSUITE` never appears as a project key in either view.
- Planned-hours totals elsewhere in the dashboard (Overview "Time planned" row, Trends time momentum) are unchanged from before this feature — confirming the project map did not alter the planned totals.

- [ ] **Step 3: Confirm no stray temporary logging**

Search `PS Contribution Report.js` for any temporary `Logger.log(JSON.stringify(...))` added during Task 3 Step 3 and remove it if present.

```bash
git grep -n "JSON.stringify(employees" -- "PS Contribution Report.js"
```

Expected: no output. If there is output, remove that line and commit.

- [ ] **Step 4: Final commit (if anything changed in Step 3)**

```bash
git add -A
git commit -m "Clean up temporary logging after project-context verification"
```

---

## Notes for the implementer

- **No JS test harness for the frontend.** The dashboard has no client-side test runner, and adding one is out of scope. Frontend tasks are verified manually with the explicit expected outcomes listed in each task. The backend logic is the part covered by an automated test (`_test_projectContext_`), following the project's existing `_test_weightsResolver()` convention.
- **Deploying/syncing GAS files** is however you normally push to the Apps Script project (e.g. `clasp push`, or copy-paste into the editor). The plan does not assume a specific sync tool.
- **`Math.round` on hours** is intentional for the compact display lines — context, not accounting. The raw `hrs` stays unrounded in the payload.
- **Filter-awareness** for Trends comes for free because `renderProjectContext` aggregates from `getFilteredEmployees()` (`_tf`), exactly like the sibling Trends renderers.
