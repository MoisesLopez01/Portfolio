# Engagement Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Comments Trend" tab with a full "Engagement" tab that shows org-wide engagement KPIs, team engagement progress bars, a manager scorecard, and an individual pace-tracked engager list — all computed server-side and delivered in the existing payload.

**Architecture:** Two files only — `goalCompliance.js` (GAS backend) and `GDash.html` (frontend). New backend functions `computeEngagementData_()`, `getSupervisorTitleMap_()`, and `isSeniorLeader_()` feed a new `engagementData` key in the existing payload. The frontend renames `renderTrend()` → `renderEngagement()` and adds three new render helpers that write to three new HTML containers in `pane-trend`.

**Tech Stack:** Google Apps Script (server), Chart.js 4.4.7 + html2canvas 1.4.1 (already loaded), vanilla ES5 JavaScript.

---

## File Map

| File | Change |
|------|--------|
| `D:\Contribution\goalCompliance.js` | Add 3 functions, update `buildComplianceData_()`, bump cache to `gd_v4_` |
| `D:\Contribution\GDash.html` | Rename tab + 3 HTML containers + rename `renderTrend` + 5 new JS functions |

---

## Task 1 — Backend: `getSupervisorTitleMap_()` + `isSeniorLeader_()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js` (after `getLocationMap_()` at line ~461)

- [ ] **Step 1: Add `getSupervisorTitleMap_()` after `getLocationMap_()`**

Insert immediately after the closing `}` of `getLocationMap_()`:

```javascript
function getSupervisorTitleMap_() {
  var map = {};
  try {
    var rows = readSheet_(CONFIG_GD.ROSTER_SS_ID, CONFIG_GD.SHEET_ROSTER);
    rows.forEach(function(row) {
      var name  = row['Rocketeer'] || row['Name'] || row['Employee Name'] || row['Full Name'] || '';
      var title = row['Job Title'] || row['Title'] || row['Position'] || '';
      if (name && title) map[normName_(String(name))] = String(title).trim();
    });
  } catch (e) { Logger.log('⚠️ getSupervisorTitleMap_: ' + e.message); }
  return map;
}

function isSeniorLeader_(jobTitle) {
  return /\b(vp|vice.?president|director|chief|c[a-z]o|ceo|cto|cfo|coo)\b/i.test(jobTitle || '');
}
```

- [ ] **Step 2: Verify no syntax errors** — paste both functions into [jshint.com](https://jshint.com) or check Apps Script editor shows no red underlines.

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(backend): add getSupervisorTitleMap_ and isSeniorLeader_ helpers"
```

---

## Task 2 — Backend: `computeEngagementData_()`

**Files:**
- Modify: `D:\Contribution\goalCompliance.js` (add after `computeCommentTrend_()`)

- [ ] **Step 1: Add the function immediately after the closing `}` of `computeCommentTrend_()`**

```javascript
// ── Engagement data (pace, team rates, manager scorecard) ───────

function computeEngagementData_(employees, weeksElapsed, supervisorTitleMap) {
  var paceThreshold = Math.floor(weeksElapsed / 2);

  // Build title lookup: employee list first (supervisor may also have goals),
  // then fall back to the Roster-based supervisorTitleMap
  var empTitleMap = {};
  employees.forEach(function(e) { empTitleMap[e.normName] = e.jobTitle || ''; });

  var totalEmp   = employees.length || 1;
  var withGoals  = employees.filter(function(e) { return e.totalGoals > 0; }).length || 1;
  var totalSelf  = 0;
  var totalMgr   = 0;

  var deptMap = {};   // { dept: { total, engaging } }
  var mgrMap  = {};   // { normSup: { name, isSeniorLeader, totalMgrCmts, teamSize, covered } }

  employees.forEach(function(e) {
    var self = e.totalSelfComments    || 0;
    var mgr  = e.totalManagerComments || 0;
    totalSelf += self;
    totalMgr  += mgr;

    // Department engagement
    if (e.totalGoals > 0) {
      var dept = e.department || '(No Dept)';
      if (!deptMap[dept]) deptMap[dept] = { total: 0, engaging: 0 };
      deptMap[dept].total++;
      if (self > 0) deptMap[dept].engaging++;
    }

    // Manager scorecard
    var sup = (e.supervisor || '').trim();
    if (sup) {
      var normSup = normName_(sup);
      if (!mgrMap[normSup]) {
        var supTitle = empTitleMap[normSup] || (supervisorTitleMap && supervisorTitleMap[normSup]) || '';
        mgrMap[normSup] = {
          name:           sup,
          normName:       normSup,
          isSeniorLeader: isSeniorLeader_(supTitle),
          totalMgrCmts:   0,
          teamSize:       0,
          covered:        0,
        };
      }
      mgrMap[normSup].teamSize++;
      mgrMap[normSup].totalMgrCmts += mgr;
      if (mgr > 0) mgrMap[normSup].covered++;
    }
  });

  // Org-level counts (only employees with ≥1 goal count toward engagement)
  var activeCount    = employees.filter(function(e) { return e.totalGoals > 0 && e.totalSelfComments >  0; }).length;
  var silentCount    = employees.filter(function(e) { return e.totalGoals > 0 && e.totalSelfComments === 0; }).length;
  var belowPaceCount = employees.filter(function(e) {
    return e.totalGoals > 0 && e.totalSelfComments > 0 && e.totalSelfComments < paceThreshold;
  }).length;
  var engagingPct = +(activeCount / withGoals * 100).toFixed(1);

  // Team rates sorted descending
  var teamRates = Object.keys(deptMap).map(function(d) {
    var r = deptMap[d];
    return { dept: d, engaging: r.engaging, total: r.total, rate: +(r.engaging / r.total * 100).toFixed(1) };
  }).sort(function(a, b) { return b.rate - a.rate; });

  // Manager scorecard sorted descending by avgCmts
  var managerScorecard = Object.keys(mgrMap).map(function(k) {
    var m = mgrMap[k];
    return {
      name:           m.name,
      normName:       m.normName,
      isSeniorLeader: m.isSeniorLeader,
      avgCmts:        m.teamSize > 0 ? +(m.totalMgrCmts / m.teamSize).toFixed(1) : 0,
      covered:        m.covered,
      teamSize:       m.teamSize,
    };
  }).sort(function(a, b) { return b.avgCmts - a.avgCmts; });

  // Individual engagement list (employees with goals only), sorted Silent → Below Pace → At Pace
  var tierOrder = { 'Silent': 0, 'Below Pace': 1, 'At Pace': 2 };
  var engagerList = employees
    .filter(function(e) { return e.totalGoals > 0; })
    .map(function(e) {
      var self = e.totalSelfComments || 0;
      var status = self === 0 ? 'Silent' : self < paceThreshold ? 'Below Pace' : 'At Pace';
      return {
        name:             e.name,
        normName:         e.normName,
        department:       e.department   || '',
        supervisor:       e.supervisor   || '',
        totalGoals:       e.totalGoals,
        selfComments:     self,
        managerComments:  e.totalManagerComments || 0,
        paceStatus:       status,
        complianceStatus: e.complianceStatus || '',
      };
    })
    .sort(function(a, b) {
      var td = (tierOrder[a.paceStatus] || 0) - (tierOrder[b.paceStatus] || 0);
      return td !== 0 ? td : a.name.localeCompare(b.name);
    });

  return {
    engagingPct:      engagingPct,
    activeCount:      activeCount,
    silentCount:      silentCount,
    belowPaceCount:   belowPaceCount,
    avgSelfCmts:      +(totalSelf / totalEmp).toFixed(1),
    avgMgrCmts:       +(totalMgr  / totalEmp).toFixed(1),
    paceThreshold:    paceThreshold,
    weeksElapsed:     weeksElapsed,
    teamRates:        teamRates,
    managerScorecard: managerScorecard,
    engagerList:      engagerList,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(backend): add computeEngagementData_ function"
```

---

## Task 3 — Backend: Wire into `buildComplianceData_()` + bump cache

**Files:**
- Modify: `D:\Contribution\goalCompliance.js`

- [ ] **Step 1: Bump cache version** — find and replace:

```javascript
  CACHE_VER:           'gd_v3_',  // bumped: dept fix + orgUnique in trend
```
→
```javascript
  CACHE_VER:           'gd_v4_',  // bumped: engagement tab data
```

- [ ] **Step 2: Add `weeksElapsedSinceStart` + `supervisorTitleMap` computation** — find the comment `// 8. Quarter date windows` block (after `var commentTrend = computeCommentTrend_(rdRows, employees);`) and replace the whole block with:

```javascript
  // 7. Comment trend (weekly counts by org and department)
  var commentTrend = computeCommentTrend_(rdRows, employees);

  // 8. Quarter date windows and grace period flags
  var quarterDates          = parseQuarterDates_(quarter);
  var today                 = new Date().toISOString().slice(0, 10);
  var isGoalCreationGrace   = !!(quarterDates && today <= quarterDates.gracePeriodGoalsEnd);
  var isCompletionGrace     = !!(quarterDates && today >= quarterDates.gracePeriodCompletionStart);

  // 9. Calendar weeks elapsed since quarter start (for engagement pace threshold)
  var weeksElapsedSinceStart = totalQtrWeeks;
  if (quarterDates) {
    var startWk = dateToISOWeek_(new Date(quarterDates.start));
    var todayWk = dateToISOWeek_(today);
    var startN  = startWk ? parseInt(String(startWk).split('.W')[1], 10) : 1;
    var todayN  = todayWk ? parseInt(String(todayWk).split('.W')[1], 10) : startN;
    var diff    = todayN - startN;
    weeksElapsedSinceStart = Math.max(1, Math.min(diff + 1, totalQtrWeeks));
  }

  // 10. Engagement data
  var supervisorTitleMap = getSupervisorTitleMap_();
  var engagementData     = computeEngagementData_(employees, weeksElapsedSinceStart, supervisorTitleMap);
```

- [ ] **Step 3: Add new keys to return payload** — find the `return {` block and add two new keys:

```javascript
  return {
    employees:             employees,
    summary:               computeSummary_(employees),
    commentTrend:          commentTrend,
    quarter:               quarter,
    quarters:              quarters,
    totalQtrWeeks:         totalQtrWeeks,
    quarterDates:          quarterDates,
    isGoalCreationGrace:   isGoalCreationGrace,
    isCompletionGrace:     isCompletionGrace,
    weeksElapsedSinceStart: weeksElapsedSinceStart,
    engagementData:        engagementData,
    generatedAt:           new Date().toISOString(),
  };
```

- [ ] **Step 4: Commit**

```bash
git add "D:/Contribution/goalCompliance.js"
git commit -m "feat(backend): wire engagementData into buildComplianceData_ payload, bump cache gd_v4_"
```

---

## Task 4 — Frontend: Tab rename + new HTML containers

**Files:**
- Modify: `D:\Contribution\GDash.html`

- [ ] **Step 1: Rename tab button label** — find:

```html
    <button class="tab-btn"        onclick="switchTab('trend')"     data-tab="trend">Comments Trend</button>
```
Replace with:
```html
    <button class="tab-btn"        onclick="switchTab('trend')"     data-tab="trend">Engagement</button>
```

- [ ] **Step 2: Add HTML containers** — find the closing of `pane-trend`:

```html
      <div class="section-card">
        <div class="section-head"><h2>Weekly Comment Data</h2></div>
        <div class="section-body tbl-wrap" id="trend-table"></div>
      </div>
    </div>
```
Replace with:
```html
      <div class="section-card">
        <div class="section-head"><h2>Weekly Comment Data</h2></div>
        <div class="section-body tbl-wrap" id="trend-table"></div>
      </div>
      <!-- Team Engagement + Manager Scorecard -->
      <div class="col-row">
        <div class="section-card">
          <div class="section-head">
            <div><h2>Team Engagement Rate</h2><p class="section-sub">People with ≥1 self-comment · colour = engagement rate</p></div>
          </div>
          <div class="section-body" id="engagement-team"></div>
        </div>
        <div class="section-card">
          <div class="section-head">
            <div><h2>Manager Scorecard</h2><p class="section-sub">Avg comments left on team goals · % of team reached</p></div>
          </div>
          <div class="section-body" id="engagement-managers"></div>
        </div>
      </div>
      <!-- Individual Engagement List -->
      <div class="section-card" id="card-engagement-list">
        <div class="section-head">
          <div><h2>Individual Engagement List</h2><p class="section-sub" id="engagement-list-sub"></p></div>
          <div class="section-actions">
            <button class="btn" onclick="exportEngagementCSV_()">⬇ CSV</button>
            <button class="btn" onclick="exportPNG('card-engagement-list','engagement-list.png')">⬇ PNG</button>
          </div>
        </div>
        <div class="section-body" id="engagement-list"></div>
      </div>
    </div>
```

- [ ] **Step 3: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): rename Comments Trend tab to Engagement, add engagement HTML containers"
```

---

## Task 5 — Frontend: `renderEngagement()` replaces `renderTrend()`

**Files:**
- Modify: `D:\Contribution\GDash.html`

- [ ] **Step 1: Replace `renderTrend(emps)` function body** — find the entire `function renderTrend(emps) { … }` block (lines ~693–723) and replace with:

```javascript
function renderEngagement(emps) {
  if (!S.data || !S.data.commentTrend) return;
  var trend = S.data.commentTrend;
  var eng   = S.data.engagementData || {};
  var weeks = trend.weeks || [];

  // 6 Engagement KPI cards
  document.getElementById('kpi-trend').innerHTML =
    kpiCard('Org Engagement Rate', (eng.engagingPct || 0) + '%', '🎯', '#058CDC', '≥1 self-comment this quarter') +
    kpiCard('Active Commenters',   eng.activeCount    || 0,      '✅', '#00A86B', 'self-commented this qtr') +
    kpiCard('Silent',              eng.silentCount    || 0,      '🔇', '#EF4444', '0 self-comments · has goals') +
    kpiCard('Below Pace',          eng.belowPaceCount || 0,      '⏳', '#F59E0B', '&lt; ½ weeks elapsed · pace min: ' + (eng.paceThreshold || '—')) +
    kpiCard('Avg Self-Cmts',       eng.avgSelfCmts    || 0,      '💬', '#9B59B6', 'per rocketeer') +
    kpiCard('Avg Mgr-Cmts',        eng.avgMgrCmts     || 0,      '👔', '#2864E6', 'per team member');

  // Trend chart section (unchanged)
  buildTrendDeptChips_(trend);
  buildCommentTrendChart('chart-trend', trend, S.trendDepts);
  document.getElementById('trend-table').innerHTML = buildTrendTable_(trend);

  // New engagement sections
  renderTeamEngagement_(eng);
  renderManagerScorecard_(eng);
  renderEngagerList_(eng);
}
```

- [ ] **Step 2: Update `buildTrendDeptChips_` callback** — find inside that function:

```javascript
      renderTrend(getFiltered());
```
Replace with:
```javascript
      renderEngagement(getFiltered());
```

- [ ] **Step 3: Update `switchTab` reference** — find:

```javascript
  else if (tabId === 'trend')     renderTrend(emps);
```
Replace with:
```javascript
  else if (tabId === 'trend')     renderEngagement(emps);
```

- [ ] **Step 4: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): rename renderTrend to renderEngagement, replace KPI cards with engagement metrics"
```

---

## Task 6 — Frontend: `renderTeamEngagement_()` + `renderManagerScorecard_()`

**Files:**
- Modify: `D:\Contribution\GDash.html` (add after `renderEngagement()`)

- [ ] **Step 1: Add both functions immediately after the closing `}` of `renderEngagement()`**

```javascript
function renderTeamEngagement_(eng) {
  var el = document.getElementById('engagement-team');
  if (!el) return;
  if (!eng || !eng.teamRates || !eng.teamRates.length) {
    el.innerHTML = '<div class="empty-state">No department data available.</div>';
    return;
  }
  var html = '<div style="display:flex;flex-direction:column;gap:12px">';
  eng.teamRates.forEach(function(t) {
    var color = t.rate >= 75 ? '#00A86B' : t.rate >= 50 ? '#F59E0B' : '#EF4444';
    var pct   = Math.min(100, t.rate).toFixed(0);
    html += '<div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--text)">' + esc(t.dept) + '</span>';
    html += '<span style="font-size:11px;font-weight:700;color:' + color + '">' + t.engaging + '/' + t.total + ' &nbsp;·&nbsp; ' + pct + '%</span>';
    html += '</div>';
    html += '<div style="height:8px;background:var(--border);border-radius:4px">';
    html += '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:4px;transition:width .4s ease"></div>';
    html += '</div></div>';
  });
  html += '</div>';
  html += '<div style="font-size:9px;color:var(--muted);margin-top:12px">🟢 ≥75% engaged &nbsp;·&nbsp; 🟡 50–74% &nbsp;·&nbsp; 🔴 &lt;50%</div>';
  el.innerHTML = html;
}

function renderManagerScorecard_(eng) {
  var el = document.getElementById('engagement-managers');
  if (!el) return;
  if (!eng || !eng.managerScorecard || !eng.managerScorecard.length) {
    el.innerHTML = '<div class="empty-state">No manager data available.</div>';
    return;
  }

  function cmtStyle(v) {
    return v >= 2 ? 'background:#DCFCE7;color:#15803D' : v >= 1 ? 'background:#FEF9C3;color:#854D0E' : 'background:#FEE2E2;color:#B91C1C';
  }
  function covStyle(covered, total) {
    var r = total > 0 ? covered / total : 0;
    return r >= 0.75 ? 'background:#DCFCE7;color:#15803D' : r >= 0.5 ? 'background:#FEF9C3;color:#854D0E' : 'background:#FEE2E2;color:#B91C1C';
  }

  var html = '<div class="tbl-wrap"><table class="data-table" style="font-size:11px"><thead><tr>';
  html += '<th>Manager</th>';
  html += '<th style="text-align:center">Avg Cmts</th>';
  html += '<th style="text-align:center">Coverage</th>';
  html += '<th style="text-align:center">Team</th>';
  html += '</tr></thead><tbody>';

  eng.managerScorecard.forEach(function(m) {
    html += '<tr>';
    html += '<td style="font-weight:600;white-space:nowrap">' + esc(m.name);
    if (m.isSeniorLeader) {
      html += ' <span style="background:#EEF4FF;color:#1D4ED8;border-radius:3px;padding:1px 5px;font-size:8px;font-weight:700;vertical-align:middle">Senior Leader</span>';
    }
    html += '</td>';
    html += '<td style="text-align:center"><span style="border-radius:3px;padding:2px 8px;font-size:11px;font-weight:700;' + cmtStyle(m.avgCmts) + '">' + m.avgCmts + '</span></td>';
    html += '<td style="text-align:center"><span style="border-radius:3px;padding:2px 8px;font-size:11px;font-weight:700;' + covStyle(m.covered, m.teamSize) + '">' + m.covered + '/' + m.teamSize + '</span></td>';
    html += '<td style="text-align:center;color:var(--slate)">' + m.teamSize + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += '<div style="font-size:9px;color:var(--muted);margin-top:8px">🟢 ≥2 avg cmts &nbsp;·&nbsp; 🟡 1–2 &nbsp;·&nbsp; 🔴 &lt;1 &nbsp;·&nbsp; Coverage: % of team with ≥1 manager comment</div>';
  el.innerHTML = html;
}
```

- [ ] **Step 2: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): add renderTeamEngagement_ and renderManagerScorecard_ functions"
```

---

## Task 7 — Frontend: `renderEngagerList_()` + `exportEngagementCSV_()`

**Files:**
- Modify: `D:\Contribution\GDash.html` (add after `renderManagerScorecard_()`)

- [ ] **Step 1: Add both functions immediately after the closing `}` of `renderManagerScorecard_()`**

```javascript
function renderEngagerList_(eng) {
  var el  = document.getElementById('engagement-list');
  var sub = document.getElementById('engagement-list-sub');
  if (!el) return;
  if (!eng || !eng.engagerList || !eng.engagerList.length) {
    el.innerHTML = '<div class="empty-state">No engagement data available.</div>';
    return;
  }

  var threshold = eng.paceThreshold || 0;
  var elapsed   = eng.weeksElapsed  || 0;
  if (sub) sub.textContent = 'Week ' + elapsed + ' of quarter · pace min = ' + threshold + ' self-comments · Silent → Below Pace → At Pace';

  var noteMap = buildNoteMap_();

  var html = '<div class="tbl-wrap"><table class="data-table"><thead><tr>';
  html += '<th>Rocketeer</th><th>Supervisor</th><th>Dept</th>';
  html += '<th style="text-align:center">Goals</th>';
  html += '<th style="text-align:center;color:#9B59B6">Self-Cmts</th>';
  html += '<th style="text-align:center;color:#2864E6">Mgr-Cmts</th>';
  html += '<th style="text-align:center">Pace</th>';
  html += '<th>HR Review</th>';
  html += '</tr></thead><tbody>';

  eng.engagerList.forEach(function(e) {
    var rowBg    = e.paceStatus === 'Silent' ? 'background:#FFF5F5' : e.paceStatus === 'Below Pace' ? 'background:#FFFBEB' : '';
    var badgeCss = e.paceStatus === 'Silent' ? 'tier-nogoals' : e.paceStatus === 'Below Pace' ? 'tier-watch' : 'tier-ontarget';
    var selfColor = e.selfComments === 0 ? '#B91C1C' : e.selfComments < threshold ? '#854D0E' : '#15803D';
    var note     = noteMap[e.normName];

    var reviewCell;
    if (e.paceStatus === 'At Pace') {
      reviewCell = '<span style="color:var(--muted)">—</span>';
    } else if (note) {
      reviewCell = '<div class="review-done"><span class="review-check">✓</span>' +
        '<span class="review-meta">' + esc(note.reviewedBy.replace(/@.*/,'')) + '</span>' +
        '<button class="btn" style="padding:2px 6px;font-size:9px" onclick="openModal(\'' + esc(e.normName) + '\')">Edit</button></div>';
    } else {
      reviewCell = '<button class="btn" style="padding:2px 8px;font-size:10px" onclick="openModal(\'' + esc(e.normName) + '\')">Review</button>';
    }

    html += '<tr style="' + rowBg + '">';
    html += '<td style="font-weight:600;white-space:nowrap">' + esc(e.name) + '</td>';
    html += '<td style="color:var(--slate);font-size:11px;white-space:nowrap">' + esc(e.supervisor || '—') + '</td>';
    html += '<td style="color:var(--slate);font-size:11px">' + esc(e.department || '—') + '</td>';
    html += '<td style="text-align:center;font-weight:700">' + e.totalGoals + '</td>';
    html += '<td style="text-align:center;font-weight:700;color:' + selfColor + '">' + e.selfComments + '</td>';
    html += '<td style="text-align:center;color:var(--slate)">' + e.managerComments + '</td>';
    html += '<td style="text-align:center"><span class="' + badgeCss + '">' + esc(e.paceStatus) + '</span></td>';
    html += '<td>' + reviewCell + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function exportEngagementCSV_() {
  var eng = S.data && S.data.engagementData;
  if (!eng || !eng.engagerList) return;
  var rows = [['Rocketeer','Supervisor','Department','Goals','Self-Comments','Mgr-Comments','Pace Status','Compliance Status']];
  eng.engagerList.forEach(function(e) {
    rows.push([e.name, e.supervisor, e.department, e.totalGoals, e.selfComments, e.managerComments, e.paceStatus, e.complianceStatus]);
  });
  var csv = rows.map(function(r) {
    return r.map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csv);
  a.download = 'engagement-' + ((S.data && S.data.quarter) || 'export') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

- [ ] **Step 2: Commit**

```bash
git add "D:/Contribution/GDash.html"
git commit -m "feat(frontend): add renderEngagerList_, exportEngagementCSV_ — individual engagement table with pace tiers"
```

---

## Task 8 — Smoke Test + Final Commit

- [ ] **Step 1: Deploy** — in Apps Script editor: Deploy → Manage deployments → update the existing web app deployment. Click the web app URL to open it.

- [ ] **Step 2: Check tab label** — tab bar should read "Engagement" (not "Comments Trend").

- [ ] **Step 3: Check KPI cards** — 6 cards visible: Org Engagement Rate, Active Commenters, Silent, Below Pace, Avg Self-Cmts, Avg Mgr-Cmts. All should show non-zero values (not NaN or undefined).

- [ ] **Step 4: Check trend chart** — dual-axis line chart renders; department chips toggle correctly.

- [ ] **Step 5: Check Team Engagement Rate** — progress bars appear, coloured green/amber/red by rate, no "Unknown" department entries.

- [ ] **Step 6: Check Manager Scorecard** — table renders with Avg Cmts + Coverage columns. Senior Leader badge appears on VPs/Directors if any.

- [ ] **Step 7: Check Individual Engagement List** — Silent rows have dark-red background, Below Pace have amber. Self-Cmts column is coloured per severity. HR Review button appears for Silent/Below Pace. CSV export downloads a UTF-8 file.

- [ ] **Step 8: Check cache bust** — click the Refresh (⟳) header button; data reloads without errors. Verify no `gd_v3_` stale cache issues.

- [ ] **Step 9: Final commit**

```bash
git add "D:/Contribution/goalCompliance.js" "D:/Contribution/GDash.html"
git commit -m "feat: Engagement tab complete — team rates, manager scorecard, individual pace list"
```
