# Exec Brief Manager Unlock + Cross-Team Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the 📋 Team Executive Brief to manager/viewer roles (Copy-only buttons for non-admins) and add a names-free cross-team rollup strip (admins + viewers) at the top of the tab, computed client-side from the prefetched per-team payloads.

**Architecture:** Single-file frontend change (`PS Dashboard.html`). The `VIEWS` registry drives all role gating, so the unlock is one entry plus button conditionals. The rollup parameterizes the existing `generateTeamBrief` signal generator to accept any team payload (global `DATA` remains the default), then renders one row per `meta.availableTeams` entry from `STATE.teamData`, reusing the pure `getWeekStats` helper for trajectory.

**Tech Stack:** GAS HtmlService frontend, vanilla JS (single `<script>` block, ~9k-line file), no backend changes, no `PS_CACHE_VER` bump.

**Spec:** `docs/superpowers/specs/2026-07-09-exec-brief-manager-unlock-and-rollup-design.md`

**⚠️ Concurrency & hygiene (binding for every task):** another session may edit this repo. Anchor all edits on **exact code snippets, never line numbers**; if an Edit fails "modified since read", re-Read the region and re-apply. `git add` ONLY `"PS Dashboard.html"` by name (the tree carries unrelated WIP). Never push.

**Verification commands** (no Node test harness exists for this UI; these are the gates):

```bash
# All script blocks parse
node -e "const s=require('fs').readFileSync('PS Dashboard.html','utf8'); const re=/<script>([\s\S]*?)<\/script>/g; let m,i=0; while((m=re.exec(s))){i++; new Function(m[1]);} console.log(i+' script block(s) parse OK')"
```

---

### Task 1: Manager/viewer unlock — `VIEWS` roles + action-button gating

**Files:**
- Modify: `PS Dashboard.html` — the `VIEWS` array entry for `execbrief`, and the header-actions block inside `buildTeamBriefHTML`

- [ ] **Step 1: Widen the `execbrief` roles**

Find this exact line in the `VIEWS` array (do NOT touch the other `roles: ["admin"]` entries for weights/access):

```js
  { id: "execbrief",  btnId: "tabBtnExecBrief",  paneId: "tabExecBrief",  label: "📋 Team Executive Brief", location: "tabbar", roles: ["admin"] },
```

Replace with:

```js
  { id: "execbrief",  btnId: "tabBtnExecBrief",  paneId: "tabExecBrief",  label: "📋 Team Executive Brief", location: "tabbar", roles: ["admin", "viewer", "manager"] },
```

Tab visibility (`applyRoleToNav_`), the ☰ menu, and the `switchTab()` role gate all derive from `VIEWS` — no other nav change is needed.

- [ ] **Step 2: Gate the Gemini and Publish buttons to admin**

In `buildTeamBriefHTML`, find the header-actions block:

```js
        '<div class="team-brief-head-actions">' +
          '<button class="team-brief-gemini-btn" id="tbGeminiBtn" onclick="triggerTeamGemini()">✨ Enhance with Gemini</button>' +
          '<button class="team-brief-copy-btn" onclick="copyTeamBrief()">📋 Copy for Confluence</button>' +
          '<button class="team-brief-publish-btn" id="tbPublishBtn" onclick="triggerConfluencePublish()">🚀 Publish to Confluence</button>' +
        '</div>' +
```

Replace with (📋 Copy stays for every role that can open the tab; ✨ Gemini spends paid API and 🚀 Publish writes the shared official Confluence page, so both are admin-only):

```js
        '<div class="team-brief-head-actions">' +
          (STATE.userRole === 'admin'
            ? '<button class="team-brief-gemini-btn" id="tbGeminiBtn" onclick="triggerTeamGemini()">✨ Enhance with Gemini</button>'
            : '') +
          '<button class="team-brief-copy-btn" onclick="copyTeamBrief()">📋 Copy for Confluence</button>' +
          (STATE.userRole === 'admin'
            ? '<button class="team-brief-publish-btn" id="tbPublishBtn" onclick="triggerConfluencePublish()">🚀 Publish to Confluence</button>'
            : '') +
        '</div>' +
```

(`STATE.userRole` is set from the payload in `onDataLoaded` and is the same source the `VIEWS` gate reads. The Gemini/publish flows look their buttons up by id and no-op when absent.)

- [ ] **Step 3: Verify parse + gating grep**

Run the parse command (header of this plan). Expected: `N script block(s) parse OK`.

```bash
grep -n "tbGeminiBtn\|tbPublishBtn" "PS Dashboard.html" | head -20
```

Expected: the two render sites now inside `STATE.userRole === 'admin'` ternaries; the other hits are the existing lookup/handler sites (`triggerTeamGemini`, publish flow) — unchanged.

- [ ] **Step 4: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(exec-brief): open tab to viewer+manager roles; Gemini/Publish stay admin-only"
```

---

### Task 2: Parameterize `generateTeamBrief` to accept any team payload

**Files:**
- Modify: `PS Dashboard.html` — the body of `function generateTeamBrief(weekLabel, prevWeekLabel)` only

The weekly brief below the rollup must be byte-identical in behavior when the new parameter is omitted. Rollup callers pass a team payload and get: that payload's data, its **unfiltered FTE** population (never `getFilteredEmployees()`, never crew mode), and its own team-metric gating.

- [ ] **Step 1: Change the signature and prologue**

Find:

```js
function generateTeamBrief(weekLabel, prevWeekLabel) {
  var facts = [], highlights = [], notes = [], concerns = [];
  if (!DATA) return { facts: ['Data loading…'], highlights: [], notes: [], concerns: [] };
  var allEmps = getFilteredEmployees();
```

Replace with:

```js
// `data` (optional) = a full team payload for cross-team rollup rows; omitted →
// the active DATA with the live filters (weekly brief path, unchanged). Rollup
// mode always uses the payload's unfiltered FTE population and its own
// meta.team.metrics gate, so a row matches what toggling to that team shows.
function generateTeamBrief(weekLabel, prevWeekLabel, data) {
  var facts = [], highlights = [], notes = [], concerns = [];
  var D = data || DATA;
  if (!D) return { facts: ['Data loading…'], highlights: [], notes: [], concerns: [] };
  var allEmps = data
    ? (D.employees || []).filter(function(e) { return !e.isCrewMember; })
    : getFilteredEmployees();
  // Team-metric gate against THIS payload (hasMetric_ reads the live DATA only).
  function hasM(k) {
    var m = D.meta && D.meta.team && D.meta.team.metrics;
    return !m || m.indexOf(k) !== -1;
  }
```

- [ ] **Step 2: Rebind every internal read from `DATA` to `D`, and the DOM/crew/metric reads**

Within the `generateTeamBrief` function body ONLY (it ends at `return { facts: facts, highlights: highlights, notes: notes, concerns: concerns, trends: trends };` followed by `}` — the next line is `// Period-mode Exec Brief`), make these exact replacements:

| Old (inside the function) | New |
|---|---|
| `(DATA.teamSummary \|\| [])` | `(D.teamSummary \|\| [])` |
| `DATA.weeks.findIndex(function(w) { return w.label === lbl; }) === -1;` (in `ensureSynthWeeks`) | `D.weeks.findIndex(function(w) { return w.label === lbl; }) === -1;` |
| `(DATA.q4Weeks \|\| []).find(function(w)` | `(D.q4Weeks \|\| []).find(function(w)` |
| `var idx = DATA.weeks.findIndex(function(w) { return w.label === lbl; });` (in `getCell`) | `var idx = D.weeks.findIndex(function(w) { return w.label === lbl; });` |
| `var hist    = DATA.trackedHistory \|\| [];` | `var hist    = D.trackedHistory \|\| [];` |
| `var selWeek = DATA.weeks.find(function(w) { return w.label === weekLabel; });` | `var selWeek = D.weeks.find(function(w) { return w.label === weekLabel; });` |
| `var headcount  = DATA.meta.activeCount \|\| DATA.headcount \|\| 1;` | `var headcount  = D.meta.activeCount \|\| D.headcount \|\| 1;` |
| `var isCrewMode = ((document.getElementById("fbMemberType") \|\| {}).value \|\| "fte") === "crew";` | `var isCrewMode = data ? false : ((document.getElementById("fbMemberType") \|\| {}).value \|\| "fte") === "crew";` |
| `var phMap    = DATA.phByWeek \|\| {};` | `var phMap    = D.phByWeek \|\| {};` |
| `var allWeeks = DATA.weeks    \|\| [];` | `var allWeeks = D.weeks    \|\| [];` |
| `if (hasMetric_('tracked')) {` | `if (hasM('tracked')) {` |
| `if (hasMetric_('planned')) {` | `if (hasM('planned')) {` |
| `(DATA.meta && DATA.meta.goalsQuarter \|\| '')` | `(D.meta && D.meta.goalsQuarter \|\| '')` |
| `var cRcrEmps = DATA.employees.filter(function(e)` | `var cRcrEmps = (D.employees \|\| []).filter(function(e)` |
| `var cRcrMon  = DATA.meta.rcrLastMonth \|\| '';` | `var cRcrMon  = D.meta.rcrLastMonth \|\| '';` |
| `} else if (DATA.meta.rcrTeamRCR != null) {` | `} else if (D.meta.rcrTeamRCR != null) {` |
| `var rcrVal = DATA.meta.rcrTeamRCR;` | `var rcrVal = D.meta.rcrTeamRCR;` |
| `var month  = DATA.meta.rcrLastMonth \|\| '';` | `var month  = D.meta.rcrLastMonth \|\| '';` |
| `if (!isCrewMode && DATA.meta.siTeamRounded != null) {` | `if (!isCrewMode && D.meta.siTeamRounded != null) {` |
| `var _siQ  = DATA.meta.siQuarter \|\| "";` | `var _siQ  = D.meta.siQuarter \|\| "";` |
| `var _siV  = DATA.meta.siTeamRounded;` | `var _siV  = D.meta.siTeamRounded;` |

(`buildFilteredSummary(allEmps, wObjs)` needs no change — it computes purely from its arguments. Its internal crew-mode DOM read only affects display strings on rows the rollup never consumes.)

- [ ] **Step 3: Verify no bare `DATA` reads remain in the function**

```bash
awk '/^function generateTeamBrief/,/^\}/' "PS Dashboard.html" | grep -n "DATA" 
```

Expected output: exactly two hits — the `var D = data || DATA;` line and the comment above the function. Any other `DATA.` hit inside the body is a missed rebind: fix it.

Then run the parse command. Expected: `N script block(s) parse OK`.

- [ ] **Step 4: Hand-verify default-path equivalence (no behavior change)**

Confirm by reading your diff (`git diff "PS Dashboard.html"`): when `data` is undefined — the only way the existing call site `generateTeamBrief(selLabel, prevWeek ? prevWeek.label : null)` invokes it — `D === DATA`, `allEmps === getFilteredEmployees()`, `isCrewMode` reads the DOM as before, and `hasM(k)` evaluates the same expression `hasMetric_(k)` did. State this check and its result in your report.

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "refactor(exec-brief): parameterize generateTeamBrief for cross-team payloads"
```

---

### Task 3: Cross-team rollup strip — CSS, trajectory helper, renderer, integration, prefetch hook

**Files:**
- Modify: `PS Dashboard.html` — CSS block near `/* ── TEAM EXECUTIVE BRIEF ── */`, new functions before `renderExecBriefTab_`, two integration edits inside `renderExecBriefTab_`, one line in the prefetch success handler

- [ ] **Step 1: Add the rollup CSS**

Find the CSS comment `/* ── TEAM EXECUTIVE BRIEF ── */` and insert immediately BEFORE it:

```css
/* ── CROSS-TEAM EXECUTIVE ROLLUP (admins + viewers) ── */
.eb-rollup { margin: 0 0 16px; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--th-bg); }
.eb-rollup-title { font-size: 12px; font-weight: 800; color: var(--void); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .04em; }
.eb-rollup-table { border-collapse: collapse; width: 100%; }
.eb-rollup-table thead th { font-size: 10px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
.eb-rollup-table tbody th { font-size: 12px; font-weight: 800; color: var(--void); text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; vertical-align: top; }
.eb-rollup-table tbody td { font-size: 12px; color: var(--slate); padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.eb-rollup-table tr:last-child th, .eb-rollup-table tr:last-child td { border-bottom: none; }
.eb-rollup-hc { font-weight: 600; color: var(--muted); font-size: 11px; }
.eb-rollup-traj { font-size: 14px; width: 28px; text-align: center; }
.eb-rollup-concern { color: #B45309; }
.eb-rollup-ok { color: var(--muted); }
.eb-rollup-pending { color: var(--muted); font-style: italic; }
.eb-rollup-note { margin: 0 0 16px; padding: 8px 12px; font-size: 11px; color: var(--muted); border: 1px dashed var(--border); border-radius: 8px; }
```

- [ ] **Step 2: Add the trajectory helper and renderer**

Insert immediately BEFORE `function renderExecBriefTab_() {` (anchor: the comment `// ── TEAM EXECUTIVE BRIEF TAB (admin only) ─────────────────` — also update that comment to `// ── TEAM EXECUTIVE BRIEF TAB (admin/viewer/manager; rollup admin+viewer) ──`):

```js
// ── CROSS-TEAM EXECUTIVE ROLLUP ──────────────────────────────────────────────
// One names-free row per available team: trajectory / top concern / top highlight.
// Spec: docs/superpowers/specs/2026-07-09-exec-brief-manager-unlock-and-rollup-design.md
// Non-active teams read the background-prefetched payloads in STATE.teamData, so
// a row always matches what toggling to that team would show. Admin+viewer only;
// managers structurally can't render it (single-scope payloads) — the role gate
// is defense in depth.

// Trajectory from WoW deltas of the metrics the team has. Goals compliance is the
// one weekly metric every team carries (flat band ±2 pts); tracked avg-hours joins
// where the team has it (flat band ±0.5 h). All up → ▲, all down → ▼, else ▶.
function rollupTrajectory_(emps, curLbl, prevLbl, metrics) {
  if (!prevLbl) return { sym: '▶', title: 'no prior week to compare' };
  var c = getWeekStats(emps, curLbl), p = getWeekStats(emps, prevLbl);
  var dirs = [];
  if (c.gt > 0 && p.gt > 0) {
    var dg = c.goalsPct - p.goalsPct;
    dirs.push(Math.abs(dg) <= 2 ? 0 : (dg > 0 ? 1 : -1));
  }
  if ((metrics || []).indexOf('tracked') !== -1) {
    var ca = c.trackedHC > 0 ? c.tracked / c.trackedHC : null;
    var pa = p.trackedHC > 0 ? p.tracked / p.trackedHC : null;
    if (ca !== null && pa !== null) {
      var dt = ca - pa;
      dirs.push(Math.abs(dt) <= 0.5 ? 0 : (dt > 0 ? 1 : -1));
    }
  }
  if (!dirs.length) return { sym: '▶', title: 'no comparable data' };
  var allUp   = dirs.every(function(d) { return d === 1; });
  var allDown = dirs.every(function(d) { return d === -1; });
  return allUp   ? { sym: '▲', title: 'improving week-over-week' }
       : allDown ? { sym: '▼', title: 'declining week-over-week' }
       :           { sym: '▶', title: 'flat / mixed week-over-week' };
}

// Returns the strip's HTML, or '' when hidden (manager role / single team).
// In Month/Quarter mode returns the one-line weekly note instead of rows.
function renderExecRollup_(selLabel, prevLabel) {
  var role  = STATE.userRole;
  var teams = (DATA && DATA.meta && DATA.meta.availableTeams) || [];
  if ((role !== 'admin' && role !== 'viewer') || teams.length < 2) return '';
  if (STATE.periodGranularity !== 'week') {
    return '<div class="eb-rollup-note">Cross-team rollup is weekly — switch to Week view to compare teams.</div>';
  }
  var rows = teams.map(function(t) {
    var payload = t.key === STATE.activeTeam ? DATA : STATE.teamData[t.key];
    if (!payload) {
      return '<tr><th>' + esc(t.label) + '</th><td colspan="3" class="eb-rollup-pending">' +
        (_prefetchFailed[t.key] ? 'not loaded — switch to this team once to load it' : 'loading…') +
        '</td></tr>';
    }
    var weekSet = payload.q4Weeks || payload.weeks || [];
    if (!weekSet.some(function(w) { return w.label === selLabel; })) {
      return '<tr><th>' + esc(t.label) + '</th><td colspan="3" class="eb-rollup-pending">no data for ' +
        esc(selLabel) + '</td></tr>';
    }
    // Rollup rows are always the payload's unfiltered FTE population (the FTE/crew
    // and job-family filters describe the active team's detail view, never the
    // comparison) — generateTeamBrief's rollup mode enforces the same population.
    var brief = generateTeamBrief(selLabel, prevLabel, payload);
    var emps  = (payload.employees || []).filter(function(e) { return !e.isCrewMember; });
    var mets  = (payload.meta && payload.meta.team && payload.meta.team.metrics) || [];
    var traj  = rollupTrajectory_(emps, selLabel, prevLabel, mets);
    var concern   = brief.concerns[0] || '';
    // Kudos per-post lines carry individual names and are marked with ★ — skip
    // them so the rollup stays names-free (counts-only summary surface).
    var highlight = brief.highlights.filter(function(h) { return h.indexOf('★') === -1; })[0] || '';
    var noConcern = concern.indexOf('No critical concerns') === 0;
    return '<tr>' +
      '<th>' + esc(t.label) + ' <span class="eb-rollup-hc">· ' + emps.length + '</span></th>' +
      '<td class="eb-rollup-traj" title="' + esc(traj.title) + '">' + traj.sym + '</td>' +
      '<td class="' + (noConcern ? 'eb-rollup-ok' : 'eb-rollup-concern') + '">' + esc(concern) + '</td>' +
      '<td>' + esc(highlight) + '</td>' +
    '</tr>';
  }).join('');
  return '<div class="eb-rollup">' +
    '<div class="eb-rollup-title">Cross-team rollup · ' + esc(selLabel) + '</div>' +
    '<table class="eb-rollup-table"><thead><tr>' +
      '<th>Team</th><th></th><th>Top concern</th><th>Top highlight</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
```

- [ ] **Step 3: Integrate into both `renderExecBriefTab_` paths**

Period path — find:

```js
    var brief = generatePeriodBrief(bucket, prevB, buckets);
    el.innerHTML = buildTeamBriefHTML(dispLabel, prevB ? prevB.label : null, brief, { dateRange: bucket.weekRangeLabel });
    return;
```

Replace with:

```js
    var brief = generatePeriodBrief(bucket, prevB, buckets);
    el.innerHTML = renderExecRollup_(null, null) +
      buildTeamBriefHTML(dispLabel, prevB ? prevB.label : null, brief, { dateRange: bucket.weekRangeLabel });
    return;
```

(In period mode `renderExecRollup_` returns the weekly note — or `''` for managers/single-team, because the role/team gate runs before the granularity check.)

Weekly path — find:

```js
  var brief = generateTeamBrief(selLabel, prevWeek ? prevWeek.label : null);
  el.innerHTML = buildTeamBriefHTML(selLabel, prevWeek ? prevWeek.label : null, brief);
```

Replace with:

```js
  var brief = generateTeamBrief(selLabel, prevWeek ? prevWeek.label : null);
  el.innerHTML = renderExecRollup_(selLabel, prevWeek ? prevWeek.label : null) +
    buildTeamBriefHTML(selLabel, prevWeek ? prevWeek.label : null, brief);
```

- [ ] **Step 4: Re-render the strip when a prefetch lands**

In `prefetchNext_`'s success handler, find:

```js
        var servedKey = p.meta.team.key;
        if (!STATE.teamData[servedKey]) STATE.teamData[servedKey] = p;
```

Replace with:

```js
        var servedKey = p.meta.team.key;
        if (!STATE.teamData[servedKey]) {
          STATE.teamData[servedKey] = p;
          // Fill the rollup's 'loading…' row if the user is looking at the brief.
          if (STATE.activeTab === 'execbrief') renderExecBriefTab_();
        }
```

- [ ] **Step 5: Verify**

Run the parse command. Expected: `N script block(s) parse OK`. Then:

```bash
grep -c "renderExecRollup_\|rollupTrajectory_" "PS Dashboard.html"
```

Expected: 6 (2 definitions + 1 internal call + 2 integration call sites + 1 comment is acceptable variance — state the actual count and account for each hit in your report).

- [ ] **Step 6: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(exec-brief): cross-team executive rollup strip — trajectory, top concern/highlight per team"
```

---

### Task 4: Sweep + QA handoff

**Files:**
- Modify: none (verification only; the QA checklist lives in this plan and the spec)

- [ ] **Step 1: Full verification sweep**

Run and paste real output for each:

1. The parse command (all script blocks).
2. `grep -n "roles: \[\"admin\", \"viewer\", \"manager\"\]" "PS Dashboard.html"` — exactly 1 hit (the execbrief VIEWS entry).
3. `awk '/^function generateTeamBrief/,/^\}/' "PS Dashboard.html" | grep -c "hasM("` — expected 3 (definition + 2 call sites).
4. `git log --oneline -4` — the three feature commits present, one per task.

- [ ] **Step 2: Record the manual QA checklist as done-by-user (do NOT deploy)**

The deploy is `PS Dashboard.html` only, no `PS_CACHE_VER` bump, ship with or after the 2026.W28 team-aligned-scoring deploy. Browser QA (from spec §4): admin sees strip + 3 buttons; viewer sees strip + Copy only; manager single-team sees scoped brief, no strip, Copy only; manager on reduced-metric team sees no hours signals; each rollup row matches the full brief after toggling to that team (same week); cold cache shows loading→filled; no individual names in the strip; `ebWeekSelect` change re-renders all rows; Month/Quarter collapses the strip to the weekly note; dark mode.

- [ ] **Step 3: Commit nothing — report the sweep results**

---

## Self-review notes (already applied)

- **Spec coverage:** §1 unlock → Task 1; §2 data path/row content/freshness/weekly-cut → Tasks 2–3; §3 error handling → Task 3 (pending/failed/no-data/note branches); §4 QA → Task 4.
- **Type consistency:** `generateTeamBrief(weekLabel, prevWeekLabel, data)` (Task 2) matches the Task 3 call `generateTeamBrief(selLabel, prevLabel, payload)`; `rollupTrajectory_(emps, curLbl, prevLbl, metrics)` consistent between definition and call; `renderExecRollup_(selLabel, prevLabel)` called with `(null, null)` in period mode where both args are unused before the granularity note returns.
- **Known simplifications:** `buildFilteredSummary`'s internal crew-mode DOM read is untouched (affects only display strings on synth rows the rollup rarely triggers); the rollup headcount chip uses the payload's FTE list length rather than `meta.activeCount` so it always matches the population the row was computed from.
