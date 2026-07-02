// ============================================================
// SCRIPT NAME: Goals Compliance Dashboard — Backend
// FILE:        goalCompliance.js
// PURPOSE:     Data aggregation, caching, and HR follow-up
//              tracker for the company-wide Goals Compliance
//              Dashboard. Pair with GDash.html.
// VERSION:     2.0.0
// ENVIRONMENT: Google Apps Script (Standalone Web App)
// DEPLOY:      Apps Script → Deploy → New deployment → Web App
//              Execute as: User accessing the web app
//              Who has access: Anyone in ServiceRocket
// ============================================================

var CONFIG_GD = {
  GOALS_SS_ID:         '1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ',
  ROSTER_SS_ID:        '1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0',
  SHEET_RD:            'RD',
  SHEET_ROSTER:        'Roster',
  SHEET_HR_TRACKER:    'HR Follow-Up Tracker',
  DEFAULT_QUARTER:     'FY26Q4',
  GOALS_ON_TARGET:     10,   // 10+ goals → On Target
  GOALS_WATCH:         8,    // 8–9 goals → Watch; <8 → At Risk
  STF_MIN_COMPLETED:   8,    // completed goals required for STF
  STF_MIN_CMT_GOALS:   6,    // completed goals needing 8+ comments for STF
  STF_MIN_COMMENTS:    8,    // minimum comments per goal for STF
  CACHE_TTL:           300,  // seconds (5 min)
  CACHE_VER:           'gd_v8_',  // bumped: manager org-tree scoping + cache key now includes role/email
  DEBUG:               false,
};

// ── Utilities ──────────────────────────────────────────────────

function log_(msg) { if (CONFIG_GD.DEBUG) Logger.log(msg); }

function normName_(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

function fmtDate_(d) {
  try {
    var dt = (d instanceof Date) ? d : new Date(d);
    return isNaN(dt) ? String(d || '') : dt.toISOString().slice(0, 10);
  } catch (e) { return String(d || ''); }
}

/**
 * Parses a quarter string like "FY26Q4" and returns ISO date strings for:
 *   start, end, gracePeriodGoalsEnd (4 wks in), gracePeriodCompletionStart (2 wks from end).
 * ServiceRocket FY runs July 1 → June 30.
 *   FY26 = July 2025 → June 2026.
 *   Q1=Jul-Sep(FY-1), Q2=Oct-Dec(FY-1), Q3=Jan-Mar(FY), Q4=Apr-Jun(FY)
 */
function parseQuarterDates_(quarter) {
  var m = String(quarter || '').match(/FY(\d{2,4})Q([1-4])/i);
  if (!m) return null;
  var fyYear = parseInt(m[1], 10);
  if (fyYear < 100) fyYear += 2000;
  var qNum = parseInt(m[2], 10);
  var S_Y = [0, fyYear-1, fyYear-1, fyYear,  fyYear ];
  var S_M = [0, 6,        9,        0,       3      ];  // Jan=0
  var E_Y = [0, fyYear-1, fyYear-1, fyYear,  fyYear ];
  var E_M = [0, 8,        11,       2,       5      ];
  var startDate = new Date(S_Y[qNum], S_M[qNum], 1);
  var endDate   = new Date(E_Y[qNum], E_M[qNum] + 1, 0);  // last day
  return {
    start:                      startDate.toISOString().slice(0,10),
    end:                        endDate.toISOString().slice(0,10),
    gracePeriodGoalsEnd:        new Date(startDate.getTime() + 28 * 86400000).toISOString().slice(0,10),
    gracePeriodCompletionStart: new Date(endDate.getTime()   - 13 * 86400000).toISOString().slice(0,10),
    graceGoalWeeks:      4,
    graceCompletionWeeks:2,
  };
}

/**
 * Returns true when a rocketeer should be excluded from compliance as an intern.
 * Checks both the Class field (I1) and job title patterns like "07.I1.1 - Intern, ...".
 */
function isIntern_(classVal, jobTitle) {
  if (String(classVal || '').trim().toUpperCase() === 'I1') return true;
  var jt = String(jobTitle || '').trim();
  if (/^\d+\.I\d+\.\d+/i.test(jt)) return true;  // code-based: 07.I1.1 …
  if (/\bintern\b/i.test(jt))       return true;  // keyword fallback
  return false;
}

/**
 * Returns an ISO week label like "2026.W14".
 * Correctly handles year boundary (e.g. late-Dec may fall in W01 of next year).
 */
function dateToISOWeek_(d) {
  try {
    var dt = (d instanceof Date) ? new Date(d.getTime()) : new Date(d);
    if (isNaN(dt)) return null;
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
    var y  = dt.getFullYear();
    var ys = new Date(y, 0, 1);
    var w  = Math.ceil((((dt - ys) / 86400000) + 1) / 7);
    return y + '.W' + (w < 10 ? '0' : '') + w;
  } catch (e) { return null; }
}

function readSheet_(ssId, sheetName) {
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) { Logger.log('⚠️ Sheet not found: ' + sheetName); return []; }
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var hdrs = vals[0].map(function(h) { return String(h).trim(); });
  return vals.slice(1).map(function(row) {
    var obj = {};
    hdrs.forEach(function(h, i) { if (h) obj[h] = row[i]; });
    return obj;
  });
}

// ── Entry point ─────────────────────────────────────────────────

function doGet() {
  var access = checkDashboardAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_GD_(access.email))
      .setTitle('Goals Compliance Dashboard — Access Restricted')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  return HtmlService.createTemplateFromFile('GDash')
    .evaluate()
    .setTitle('Goals Compliance Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Public server functions ─────────────────────────────────────

function getGoalsComplianceData(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  var qtr      = String(quarter || CONFIG_GD.DEFAULT_QUARTER).trim();
  // Cache key includes the caller's scope — admin and viewer share one entry
  // (both see the full company), managers get their own keyed by email. Without
  // this, one manager's org-tree-filtered payload could be served to a different
  // manager (or an admin) requesting the same quarter.
  var scopeKey = (access.role === 'admin' || access.role === 'viewer') ? 'admin' : access.email;
  var cacheKey = CONFIG_GD.CACHE_VER + qtr + '_' + scopeKey;
  var cache    = CacheService.getScriptCache();

  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }

  var result = buildComplianceData_(qtr, access);

  try {
    var json = JSON.stringify(result);
    if (json.length < 90000) cache.put(cacheKey, json, CONFIG_GD.CACHE_TTL);
  } catch (e) { log_('Cache put skipped: ' + e.message); }

  return result;
}

function saveHRNote(data) {
  try {
    var email = Session.getActiveUser().getEmail() || 'unknown';
    var ss    = SpreadsheetApp.openById(CONFIG_GD.GOALS_SS_ID);
    var sh    = getOrCreateTrackerSheet_(ss);

    sh.appendRow([
      new Date().toISOString(),
      String(data.rocketeer    || ''),
      String(data.normName     || normName_(data.rocketeer || '')),
      String(data.quarter      || CONFIG_GD.DEFAULT_QUARTER),
      email,
      String(data.note         || ''),
      String(data.followUpDate || ''),
      String(data.status       || 'Reviewed'),
      String(data.supervisor   || ''),
      String(data.department   || ''),
      String(data.complianceStatus || ''),
      Number(data.totalGoals   || 0),
    ]);

    return { ok: true, savedBy: email, savedAt: new Date().toISOString() };
  } catch (e) {
    Logger.log('❌ saveHRNote: ' + e.message);
    return { ok: false, error: e.message };
  }
}

function getHRNotes(quarter) {
  var access = checkDashboardAccess();
  if (!access.allowed) return [];

  try {
    var rows = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_HR_TRACKER);
    var qtr  = quarter || null;

    // Manager role: only show HR notes about people in the caller's own org tree —
    // a manager should not see follow-up notes written about people outside their team.
    var scope = null;
    if (access.role === 'manager') {
      scope = resolveGDManagerScope_(getFullRosterMap_(), normName_(access.delegateScopeName));
    }

    return rows
      .filter(function(r) { return !qtr || String(r['Quarter'] || '') === qtr; })
      .filter(function(r) {
        if (!scope) return true;
        var norm = String(r['NormName'] || normName_(r['Rocketeer'] || ''));
        return !!scope[norm];
      })
      .map(function(r) {
        return {
          timestamp:        r['Timestamp']      ? new Date(r['Timestamp']).toISOString() : '',
          rocketeer:        String(r['Rocketeer']  || ''),
          normName:         String(r['NormName']   || normName_(r['Rocketeer'] || '')),
          quarter:          String(r['Quarter']    || ''),
          reviewedBy:       String(r['ReviewedBy'] || ''),
          note:             String(r['Note']       || ''),
          followUpDate:     String(r['FollowUpDate']|| ''),
          status:           String(r['Status']     || ''),
          supervisor:       String(r['Supervisor'] || ''),
          department:       String(r['Department'] || ''),
          complianceAtNote: String(r['ComplianceStatus'] || ''),
          goalsAtNote:      Number(r['TotalGoals'] || 0),
        };
      })
      .sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
  } catch (e) {
    Logger.log('⚠️ getHRNotes: ' + e.message);
    return [];
  }
}

function bustCache(quarter) {
  var cache = CacheService.getScriptCache();
  var toRemove = [CONFIG_GD.DEFAULT_QUARTER];
  if (quarter && quarter !== CONFIG_GD.DEFAULT_QUARTER) toRemove.push(quarter);
  toRemove.forEach(function(q) { cache.remove(CONFIG_GD.CACHE_VER + q); });
  return { ok: true };
}

function getUserEmail() {
  try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; }
}

// ── Private data builder ────────────────────────────────────────

function buildComplianceData_(quarter, access) {
  log_('buildComplianceData_ | quarter: ' + quarter);

  // 1. Read full RD and filter by quarter
  var allRd  = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);
  var rdRows = allRd.filter(function(r) {
    return String(r['Fiscal Quarter'] || '').trim() === quarter;
  });
  log_('RD rows for ' + quarter + ': ' + rdRows.length);

  // 2. Read Roster once — company-wide, used both to resolve a manager's org-tree
  // scope and to derive activeSet/locMap/supTitleMap below.
  var fullRosterMap = getFullRosterMap_();

  // 2b. Manager role: narrow the roster to just the caller's org tree so every
  // downstream aggregate (employees, comment trend, engagement, summary, and the
  // zero-goal-employee injection below) only reflects the manager's own team.
  // Admins and viewers keep the full company-wide roster.
  var managerScopeName = null;
  var rosterMap = fullRosterMap;
  if (access && access.role === 'manager') {
    managerScopeName = access.delegateScopeName;
    var scope = resolveGDManagerScope_(fullRosterMap, normName_(managerScopeName));
    rosterMap = {};
    Object.keys(fullRosterMap).forEach(function(norm) {
      if (scope[norm]) rosterMap[norm] = fullRosterMap[norm];
    });
    log_('Manager scope "' + managerScopeName + '": ' + Object.keys(rosterMap).length + ' employees in scope');
  }

  var activeSet      = {};
  var locMap         = {};
  var supTitleMap    = {};
  Object.keys(rosterMap).forEach(function(norm) {
    var r = rosterMap[norm];
    activeSet[norm]   = true;
    locMap[norm]      = r.location;
    supTitleMap[norm] = r.jobTitle;
  });
  log_('Roster active: ' + Object.keys(activeSet).length + ' | locations: ' + Object.keys(locMap).length);

  // 3. Aggregate per rocketeer (interns and offboarded already excluded)
  var rockMap = aggregateByRocketeer_(rdRows, activeSet);

  // 3b. Inject every active, in-scope Roster employee not found in the RD sheet (0 goals this quarter)
  var preInjectCount = Object.keys(rockMap).length;
  Object.keys(rosterMap).forEach(function(norm) {
    if (rockMap[norm]) return; // already present from RD
    var r = rosterMap[norm];
    rockMap[norm] = {
      name:       r.name,
      normName:   norm,
      department: r.department,
      classVal:   r.classVal,
      supervisor: r.supervisor,
      jobTitle:   r.jobTitle,
      quarter:    quarter,
      // All goal and comment metrics zeroed
      totalGoals: 0, goalsCompleted: 0, goalsInProgress: 0,
      goalsPlanned: 0, goalsCanceled: 0, goalsNotCompleted: 0,
      totalSelfComments: 0, totalManagerComments: 0,
      avgSelfComments: 0, avgManagerComments: 0,
      commentWeeks: 0, commentWeekList: [],
      stfGoalsCompleted: 0, stfGoalsWithSufficientComments: 0,
      goalsStuckInPlanned: 0, hasEngagementConcern: false,
      goalsList: [],
    };
  });
  Logger.log('Roster injection: +' + (Object.keys(rockMap).length - preInjectCount) +
             ' zero-goal employees | total: ' + Object.keys(rockMap).length);

  // 4. Compute all ISO weeks present in this quarter's comment data
  var qWeekSet = {};
  rdRows.forEach(function(row) {
    var cDate = row['Comment Date'];
    var cText = String(row['Comment Text'] || '').trim();
    if (cDate && cText) {
      var wk = dateToISOWeek_(cDate);
      if (wk) qWeekSet[wk] = true;
    }
  });
  var totalQtrWeeks = Math.max(1, Object.keys(qWeekSet).length);

  // 5. Finalise employee records
  var employees = Object.values(rockMap).map(function(emp) {
    emp.location         = locMap[emp.normName] || locMap[normName_(emp.name)] || emp.location || 'Unknown';
    emp.jobFamily        = deriveJobFamily_(emp.jobTitle);
    emp.complianceStatus = computeStatus_(emp.totalGoals);

    // RPI eligibility: 10+ total goals, 8+ completed, comments in every quarter week
    emp.rpiEligible = emp.totalGoals >= CONFIG_GD.GOALS_ON_TARGET &&
                      emp.goalsCompleted >= CONFIG_GD.GOALS_WATCH &&
                      emp.commentWeeks >= totalQtrWeeks;

    // STF eligibility: 8+ completed goals, 6+ of those with 8+ total comments
    emp.stfEligible = emp.stfGoalsCompleted >= CONFIG_GD.STF_MIN_COMPLETED &&
                      emp.stfGoalsWithSufficientComments >= CONFIG_GD.STF_MIN_CMT_GOALS;

    return emp;
  });

  employees.sort(function(a, b) { return a.name.localeCompare(b.name); });

  // 6. Available quarters from full dataset
  var quartersSet = {};
  allRd.forEach(function(r) {
    var q = String(r['Fiscal Quarter'] || '').trim();
    if (q) quartersSet[q] = true;
  });
  var quarters = Object.keys(quartersSet).sort().reverse();

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
    var msPerWeek  = 7 * 24 * 60 * 60 * 1000;
    var startMs    = new Date(quarterDates.start).getTime();
    var todayMs    = new Date(today).getTime();
    var diffWeeks  = Math.floor((todayMs - startMs) / msPerWeek);
    weeksElapsedSinceStart = Math.max(1, Math.min(diffWeeks + 1, totalQtrWeeks));
  }

  // 10. Engagement data
  var engagementData = computeEngagementData_(employees, weeksElapsedSinceStart, supTitleMap);

  log_('buildComplianceData_ done | employees: ' + employees.length + ' | weeks: ' + totalQtrWeeks +
       ' | goalGrace: ' + isGoalCreationGrace + ' | completionGrace: ' + isCompletionGrace +
       ' | weeksElapsed: ' + weeksElapsedSinceStart + ' | pace: ' + engagementData.paceThreshold);

  return {
    employees:              employees,
    summary:                computeSummary_(employees),
    commentTrend:           commentTrend,
    quarter:                quarter,
    quarters:               quarters,
    totalQtrWeeks:          totalQtrWeeks,
    quarterDates:           quarterDates,
    isGoalCreationGrace:    isGoalCreationGrace,
    isCompletionGrace:      isCompletionGrace,
    weeksElapsedSinceStart: weeksElapsedSinceStart,
    engagementData:         engagementData,
    generatedAt:            new Date().toISOString(),
    userRole:               access ? access.role  : null,
    userEmail:              access ? access.email : null,
    managerScopeName:       managerScopeName,
  };
}

// ── Aggregation ─────────────────────────────────────────────────

function aggregateByRocketeer_(rows, activeSet) {
  var hasActiveFilter = Object.keys(activeSet).length > 0;
  var map = {};

  rows.forEach(function(row) {
    var name = String(row['Rocketeer'] || '').trim();
    if (!name) return;
    var norm = normName_(name);

    // Exclude interns: Class = I1 or job title pattern (e.g. "07.I1.1 - Intern, …")
    var classVal = String(row['Class']     || '').trim().toUpperCase();
    var jtVal    = String(row['Job Title'] || '').trim();
    if (isIntern_(classVal, jtVal)) return;

    // Exclude offboarded employees (if active set is available)
    if (hasActiveFilter && !activeSet[norm]) return;

    if (!map[norm]) {
      map[norm] = {
        name:       name,
        normName:   norm,
        department: String(row['Department']    || '').trim(),
        classVal:   String(row['Class']         || '').trim(),
        supervisor: String(row['Supervisor']    || '').trim(),
        jobTitle:   String(row['Job Title']     || '').trim(),
        quarter:    String(row['Fiscal Quarter']|| '').trim(),
        _goals:     {},
        _selfCmtWeeks: {},  // ISO weeks in which rocketeer self-commented
      };
    }

    // Fill in department/supervisor/jobTitle from later rows if first row had them blank
    var emp = map[norm];
    if (!emp.department && String(row['Department'] || '').trim()) emp.department = String(row['Department'] || '').trim();
    if (!emp.supervisor && String(row['Supervisor'] || '').trim()) emp.supervisor = String(row['Supervisor'] || '').trim();
    if (!emp.jobTitle   && String(row['Job Title']  || '').trim()) emp.jobTitle   = String(row['Job Title']  || '').trim();

    var goalId = String(row['Goal ID'] || '').trim();
    if (!goalId) return;

    if (!map[norm]._goals[goalId]) {
      map[norm]._goals[goalId] = {
        id:              goalId,
        name:            String(row['Goal Name']   || ''),
        status:          String(row['Goal Status'] || '').trim(),
        startDate:       row['Start Date'] ? fmtDate_(row['Start Date']) : '',
        mood:            String(row['Mood']        || '').trim(),
        selfComments:    0,
        managerComments: 0,
        totalComments:   0,
        lastCommentDate: '',
      };
    }

    var cText  = String(row['Comment Text'] || '').trim();
    var cBy    = String(row['Commentator']  || '').trim();
    var cDate  = row['Comment Date'];

    if (cText && cBy) {
      var g      = map[norm]._goals[goalId];
      var sup    = normName_(map[norm].supervisor);
      var cNorm  = normName_(cBy);

      g.totalComments++;

      if (cNorm === norm) {
        g.selfComments++;
        // Track self-comment weeks for RPI
        if (cDate) {
          var wk = dateToISOWeek_(cDate);
          if (wk) map[norm]._selfCmtWeeks[wk] = true;
        }
      } else if (sup && cNorm === sup) {
        g.managerComments++;
      }

      if (cDate) {
        var ds = fmtDate_(cDate);
        if (!g.lastCommentDate || ds > g.lastCommentDate) g.lastCommentDate = ds;
      }
    }
  });

  // Convert _goals map → aggregated employee metrics
  Object.keys(map).forEach(function(norm) {
    var emp     = map[norm];
    var goalArr = Object.values(emp._goals);

    emp.totalGoals        = goalArr.length;
    emp.goalsCompleted    = goalArr.filter(function(g) { return /complet/i.test(g.status) && !/not.?complet/i.test(g.status); }).length;
    emp.goalsInProgress   = goalArr.filter(function(g) { return /in.?progress/i.test(g.status); }).length;
    emp.goalsPlanned      = goalArr.filter(function(g) { return /planned/i.test(g.status); }).length;
    emp.goalsCanceled     = goalArr.filter(function(g) { return /cancel/i.test(g.status); }).length;
    emp.goalsNotCompleted = goalArr.filter(function(g) { return /not.?complet/i.test(g.status); }).length;

    // Comment aggregates
    var totalSelf = goalArr.reduce(function(s, g) { return s + g.selfComments; }, 0);
    var totalMgr  = goalArr.reduce(function(s, g) { return s + g.managerComments; }, 0);
    emp.totalSelfComments    = totalSelf;
    emp.totalManagerComments = totalMgr;
    emp.avgSelfComments      = emp.totalGoals > 0 ? +(totalSelf / emp.totalGoals).toFixed(1) : 0;
    emp.avgManagerComments   = emp.totalGoals > 0 ? +(totalMgr  / emp.totalGoals).toFixed(1) : 0;

    // RPI: weeks in which rocketeer self-commented
    emp.commentWeeks     = Object.keys(emp._selfCmtWeeks).length;
    emp.commentWeekList  = Object.keys(emp._selfCmtWeeks).sort();

    // STF: completed goals and how many of them have 8+ total comments
    var completedGoals = goalArr.filter(function(g) {
      return /complet/i.test(g.status) && !/not.?complet/i.test(g.status);
    });
    emp.stfGoalsCompleted             = completedGoals.length;
    emp.stfGoalsWithSufficientComments = completedGoals.filter(function(g) {
      return g.totalComments >= CONFIG_GD.STF_MIN_COMMENTS;
    }).length;

    // Engagement concerns
    // goalsStuckInPlanned: planned goals with zero comments (not started, not discussed)
    emp.goalsStuckInPlanned  = goalArr.filter(function(g) {
      return /planned/i.test(g.status) && g.totalComments === 0;
    }).length;
    // hasEngagementConcern: has goals but has never self-commented on any of them
    emp.hasEngagementConcern = emp.totalGoals > 0 && emp.totalSelfComments === 0;

    // Lean goal list for drill-down
    emp.goalsList = goalArr.map(function(g) {
      return {
        id: g.id, name: g.name, status: g.status,
        self: g.selfComments, mgr: g.managerComments,
        total: g.totalComments, lastCmt: g.lastCommentDate,
      };
    });

    delete emp._goals;
    delete emp._selfCmtWeeks;
  });

  return map;
}

// ── Supervisor job-title lookup (for Senior Leader detection) ──

function isSeniorLeader_(jobTitle) {
  return /\b(vp|vice.?president|director|chief|c[a-z]o|ceo|cto|cfo|coo)\b/i.test(jobTitle || '');
}

// ── Full Roster records (active, non-intern employees) ─────────
// Returns { normName → { name, normName, department, supervisor, jobTitle, classVal, location } }
// Used to inject zero-goal employees who never appear in the RD sheet.

function getFullRosterMap_() {
  var map = {};
  try {
    var rows = readSheet_(CONFIG_GD.ROSTER_SS_ID, CONFIG_GD.SHEET_ROSTER);
    if (!rows.length) return map;

    // Detect termination column
    var keys = Object.keys(rows[0] || {});
    var termKey = null;
    keys.forEach(function(k) {
      var lower = k.toLowerCase().replace(/[\s._-]/g, '');
      if (!termKey   && /termination|termdate|enddate|exitdate/.test(lower))                       termKey   = k;
    });

    rows.forEach(function(row) {
      var name = row['Name'] || row['Rocketeer'] || row['Employee Name'] || row['Full Name'] || '';
      if (!name) return;
      var norm = normName_(String(name));

      if (termKey && row[termKey]) {
        var termDate = (row[termKey] instanceof Date) ? row[termKey] : new Date(row[termKey]);
        if (!isNaN(termDate) && termDate <= new Date()) return; // termination date has arrived or passed — inactive
      }

      var classVal = String(row['Class'] || '').trim().toUpperCase();
      var jobTitle = String(row['Job Title'] || row['Title'] || row['Position'] || '').trim();
      if (isIntern_(classVal, jobTitle)) return;

      map[norm] = {
        name:       String(name).trim(),
        normName:   norm,
        department: String(row['Department'] || '').trim(),
        supervisor: String(row['Supervisor'] || row['Manager'] || '').trim(),
        jobTitle:   jobTitle,
        classVal:   classVal,
        location:   String(row['Key Location'] || row['Location'] || row['Country'] || row['Office'] || '').trim(),
      };
    });

    Logger.log('getFullRosterMap_: ' + Object.keys(map).length + ' active non-intern employees');
  } catch (e) { Logger.log('⚠️ getFullRosterMap_: ' + e.message); }
  return map;
}

// ── Manager org-tree scoping (used by GD Security.js's manager role) ──
// BFS over the roster's Supervisor field to build the full org tree under a
// manager. The manager's own norm name is included so their own row appears.
// fullRosterMap must be the COMPANY-WIDE map (never a pre-scoped subset) —
// scoping is applied by the caller using the returned set.
function resolveGDManagerScope_(fullRosterMap, managerNorm) {
  var scope = {};
  scope[managerNorm] = true;
  var queue = [managerNorm];
  while (queue.length > 0) {
    var supNorm = queue.shift();
    Object.keys(fullRosterMap).forEach(function(norm) {
      if (!scope[norm] && normName_(fullRosterMap[norm].supervisor) === supNorm) {
        scope[norm] = true;
        queue.push(norm);
      }
    });
  }
  return scope;
}

// ── Job Family derivation ───────────────────────────────────────

var JOB_FAMILIES_GD_ = [
  { name: 'Analytics',                     kw: ['data analysis','analytics','data science'] },
  { name: 'Marketing',                     kw: ['marketing'] },
  { name: 'Sales and Success',             kw: ['account management','sales'] },
  { name: 'Partner Success',               kw: ['partner success'] },
  { name: 'Managed Services & Support',    kw: ['managed services','support'] },
  { name: 'Training & Customer Education', kw: ['training','customer education'] },
  { name: 'Service Delivery',              kw: ['service delivery'] },
  { name: 'Finance',                       kw: ['finance','accounting','financial'] },
  { name: 'Legal & Compliance',            kw: ['legal','compliance'] },
  { name: 'Operations',                    kw: ['operations','strategy'] },
  { name: 'People',                        kw: ['people',' hr ','human resources','talent','recruiting','people ops'] },
  { name: 'Information Technology',        kw: ['information technology','it operations'] },
  { name: 'Solution Architecture',         kw: ['solution architect'] },
  { name: 'Professional Services',         kw: ['professional services','consulting'] },
];

function deriveJobFamily_(jobTitle) {
  if (!jobTitle) return 'Other';
  var lower = ' ' + jobTitle.toLowerCase() + ' ';
  for (var i = 0; i < JOB_FAMILIES_GD_.length; i++) {
    var fam = JOB_FAMILIES_GD_[i];
    for (var j = 0; j < fam.kw.length; j++) {
      if (lower.indexOf(fam.kw[j]) !== -1) return fam.name;
    }
  }
  return 'Other';
}

// ── Compliance tiers ────────────────────────────────────────────

function computeStatus_(totalGoals) {
  if (totalGoals >= CONFIG_GD.GOALS_ON_TARGET) return 'On Target';
  if (totalGoals >= CONFIG_GD.GOALS_WATCH)     return 'Watch';
  return 'At Risk';
}

// ── Comment trend (weekly, by department) ──────────────────────

function computeCommentTrend_(rdRows, employees) {
  // Index active employees by normName for fast lookup and dept resolution
  var empDeptMap = {};
  employees.forEach(function(e) { empDeptMap[e.normName] = e.department; });

  // weekData[wk] = { total, uniqueSelf:{normName:true}, byDept:{}, byDeptUnique:{dept:{normName:true}} }
  var weekData = {};

  rdRows.forEach(function(row) {
    var cDate = row['Comment Date'];
    var cText = String(row['Comment Text'] || '').trim();
    if (!cDate || !cText) return;

    var wk = dateToISOWeek_(cDate);
    if (!wk) return;

    var rNorm = normName_(String(row['Rocketeer']   || ''));
    var cNorm = normName_(String(row['Commentator'] || ''));

    // Skip rows whose Rocketeer is not an active, non-intern employee
    if (!empDeptMap.hasOwnProperty(rNorm)) return;

    var dept = empDeptMap[rNorm] || String(row['Department'] || '').trim() || '(No Dept)';

    if (!weekData[wk]) weekData[wk] = { total: 0, uniqueSelf: {}, byDept: {}, byDeptUnique: {} };

    weekData[wk].total++;
    weekData[wk].byDept[dept] = (weekData[wk].byDept[dept] || 0) + 1;

    // Track unique people who self-commented (rocketeer commenting on own goal)
    if (cNorm === rNorm) {
      weekData[wk].uniqueSelf[rNorm] = true;
      if (!weekData[wk].byDeptUnique[dept]) weekData[wk].byDeptUnique[dept] = {};
      weekData[wk].byDeptUnique[dept][rNorm] = true;
    }
  });

  var weeks = Object.keys(weekData).sort();

  var deptSet = {};
  weeks.forEach(function(w) {
    Object.keys(weekData[w].byDept).forEach(function(d) { deptSet[d] = true; });
  });

  var byDept       = {};
  var byDeptUnique = {};
  Object.keys(deptSet).forEach(function(d) {
    byDept[d]       = weeks.map(function(w) { return weekData[w].byDept[d] || 0; });
    byDeptUnique[d] = weeks.map(function(w) {
      return weekData[w].byDeptUnique[d] ? Object.keys(weekData[w].byDeptUnique[d]).length : 0;
    });
  });

  return {
    weeks:        weeks,
    orgTotal:     weeks.map(function(w) { return weekData[w].total; }),
    orgUnique:    weeks.map(function(w) { return Object.keys(weekData[w].uniqueSelf).length; }),
    byDept:       byDept,
    byDeptUnique: byDeptUnique,
  };
}

// ── Engagement data (pace, team rates, manager scorecard) ───────

function computeEngagementData_(employees, weeksElapsed, supervisorTitleMap) {
  var paceThreshold = Math.floor(weeksElapsed / 2);

  var empTitleMap = {};
  employees.forEach(function(e) { empTitleMap[e.normName] = e.jobTitle || ''; });

  var totalEmp  = employees.length || 1;
  var withGoals = employees.filter(function(e) { return e.totalGoals > 0; }).length || 1;
  var totalSelf = 0;
  var totalMgr  = 0;

  var deptMap = {};
  var mgrMap  = {};

  employees.forEach(function(e) {
    var self = e.totalSelfComments    || 0;
    var mgr  = e.totalManagerComments || 0;
    totalSelf += self;
    totalMgr  += mgr;

    if (e.totalGoals > 0) {
      var dept = e.department || '(No Dept)';
      if (!deptMap[dept]) deptMap[dept] = { total: 0, engaging: 0 };
      deptMap[dept].total++;
      if (self > 0) deptMap[dept].engaging++;
    }

    if (e.totalGoals > 0) {
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
    }
  });

  var activeCount    = employees.filter(function(e) { return e.totalGoals > 0 && e.totalSelfComments >  0; }).length;
  var silentCount    = employees.filter(function(e) { return e.totalGoals > 0 && e.totalSelfComments === 0; }).length;
  var belowPaceCount = employees.filter(function(e) {
    return e.totalGoals > 0 && e.totalSelfComments > 0 && e.totalSelfComments < paceThreshold;
  }).length;
  var engagingPct = +(activeCount / withGoals * 100).toFixed(1);

  var teamRates = Object.keys(deptMap).map(function(d) {
    var r = deptMap[d];
    return { dept: d, engaging: r.engaging, total: r.total, rate: +(r.engaging / r.total * 100).toFixed(1) };
  }).sort(function(a, b) { return b.rate - a.rate; });

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

  var tierOrder = { 'Silent': 0, 'Below Pace': 1, 'At Pace': 2 };
  var engagerList = employees
    .filter(function(e) { return e.totalGoals > 0; })
    .map(function(e) {
      var self   = e.totalSelfComments || 0;
      var status = self === 0 ? 'Silent' : self < paceThreshold ? 'Below Pace' : 'At Pace';
      return {
        name:            e.name,
        normName:        e.normName,
        department:      e.department  || '',
        supervisor:      e.supervisor  || '',
        totalGoals:      e.totalGoals,
        selfComments:    self,
        managerComments: e.totalManagerComments || 0,
        paceStatus:      status,
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
    avgSelfCmts:      +(totalSelf / withGoals).toFixed(1),  // per rocketeer with goals
    avgMgrCmts:       +(totalMgr  / withGoals).toFixed(1),  // per rocketeer with goals
    paceThreshold:    paceThreshold,
    weeksElapsed:     weeksElapsed,
    teamRates:        teamRates,
    managerScorecard: managerScorecard,
    engagerList:      engagerList,
  };
}

// ── Summary aggregation ─────────────────────────────────────────

function computeSummary_(employees) {
  var total    = employees.length;
  var onTarget = employees.filter(function(e) { return e.complianceStatus === 'On Target'; }).length;
  var watch    = employees.filter(function(e) { return e.complianceStatus === 'Watch'; }).length;
  var atRisk   = employees.filter(function(e) { return e.complianceStatus === 'At Risk'; }).length;
  var totalGoals = employees.reduce(function(s, e) { return s + e.totalGoals; }, 0);
  var rpiEligible = employees.filter(function(e) { return e.rpiEligible; }).length;
  var stfEligible = employees.filter(function(e) { return e.stfEligible; }).length;

  // Goal status breakdown
  var gsd = {
    completed:    { goals: 0, people: 0 },
    inProgress:   { goals: 0, people: 0 },
    planned:      { goals: 0, people: 0 },
    canceled:     { goals: 0, people: 0 },
    notCompleted: { goals: 0, people: 0 },
    totalGoals:   totalGoals,
  };
  employees.forEach(function(e) {
    if (e.goalsCompleted    > 0) { gsd.completed.goals    += e.goalsCompleted;    gsd.completed.people++;    }
    if (e.goalsInProgress   > 0) { gsd.inProgress.goals   += e.goalsInProgress;   gsd.inProgress.people++;   }
    if (e.goalsPlanned      > 0) { gsd.planned.goals      += e.goalsPlanned;      gsd.planned.people++;      }
    if (e.goalsCanceled     > 0) { gsd.canceled.goals     += e.goalsCanceled;     gsd.canceled.people++;     }
    if (e.goalsNotCompleted > 0) { gsd.notCompleted.goals += e.goalsNotCompleted; gsd.notCompleted.people++; }
  });

  function groupBy_(key) {
    var m = {};
    employees.forEach(function(e) {
      var k = e[key] || 'Unknown';
      if (!m[k]) m[k] = {
        name: k, total: 0, onTarget: 0, watch: 0, atRisk: 0,
        totalGoals: 0, totalSelfCmt: 0, totalMgrCmt: 0,
        rpiEligible: 0, stfEligible: 0,
      };
      m[k].total++;
      m[k].totalGoals   += e.totalGoals;
      m[k].totalSelfCmt += e.totalSelfComments;
      m[k].totalMgrCmt  += e.totalManagerComments;
      if (e.complianceStatus === 'On Target') m[k].onTarget++;
      else if (e.complianceStatus === 'Watch') m[k].watch++;
      else m[k].atRisk++;
      if (e.rpiEligible) m[k].rpiEligible++;
      if (e.stfEligible) m[k].stfEligible++;
    });
    return Object.values(m)
      .map(function(g) {
        g.complianceRate = g.total > 0 ? +(g.onTarget / g.total * 100).toFixed(1) : 0;
        g.watchRate      = g.total > 0 ? +(g.watch    / g.total * 100).toFixed(1) : 0;
        g.avgGoals       = g.total > 0 ? +(g.totalGoals / g.total).toFixed(1) : 0;
        g.avgSelfCmt     = g.total > 0 ? +(g.totalSelfCmt / g.total).toFixed(1) : 0;
        g.avgMgrCmt      = g.total > 0 ? +(g.totalMgrCmt  / g.total).toFixed(1) : 0;
        return g;
      })
      .sort(function(a, b) { return b.complianceRate - a.complianceRate; });
  }

  return {
    total:          total,
    onTarget:       onTarget,
    watch:          watch,
    atRisk:         atRisk,
    complianceRate: total > 0 ? +(onTarget / total * 100).toFixed(1) : 0,
    totalGoals:     totalGoals,
    avgGoals:       total > 0 ? +(totalGoals / total).toFixed(1) : 0,
    rpiEligible:    rpiEligible,
    stfEligible:    stfEligible,
    goalStatusBreakdown: gsd,
    byDept:         groupBy_('department'),
    byLocation:     groupBy_('location'),
    byJobFamily:    groupBy_('jobFamily'),
    bySupervisor:   groupBy_('supervisor'),
  };
}

// ── HR tracker sheet ─────────────────────────────────────────────

function getOrCreateTrackerSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG_GD.SHEET_HR_TRACKER);
  if (!sh) {
    sh = ss.insertSheet(CONFIG_GD.SHEET_HR_TRACKER);
    var hdrs = ['Timestamp','Rocketeer','NormName','Quarter','ReviewedBy',
                'Note','FollowUpDate','Status','Supervisor','Department',
                'ComplianceStatus','TotalGoals'];
    sh.appendRow(hdrs);
    sh.getRange(1, 1, 1, hdrs.length)
      .setFontWeight('bold')
      .setBackground('#0F1941')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidth(6, 280);
  }
  return sh;
}

// ── Tests ─────────────────────────────────────────────────────
// Run manually in the Apps Script editor: select _test_resolveGDManagerScope_
// from the function dropdown, click Run, check the execution log.

function _test_resolveGDManagerScope_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_resolveGDManagerScope_: " + msg); }

  // Org tree: Alice manages Bob and Cara; Bob manages Dan. Eve reports elsewhere.
  var roster = {
    'alice smith': { supervisor: '' },
    'bob jones':   { supervisor: 'Alice Smith' },
    'cara lee':    { supervisor: 'Alice Smith' },
    'dan park':    { supervisor: 'Bob Jones' },
    'eve chen':    { supervisor: 'Someone Else' },
  };

  var scope = resolveGDManagerScope_(roster, 'alice smith');
  var keys = Object.keys(scope).sort();

  assert_(keys.length === 4, "expected 4 people in scope, got " + keys.length + " (" + keys.join(",") + ")");
  assert_(scope['alice smith'] === true, "manager must see their own row");
  assert_(scope['bob jones']   === true, "direct report missing");
  assert_(scope['cara lee']    === true, "direct report missing");
  assert_(scope['dan park']    === true, "second-level report (Bob's report) missing — BFS should recurse");
  assert_(!scope['eve chen'],  "Eve does not report into Alice's tree and must be excluded");

  var leafScope = resolveGDManagerScope_(roster, 'dan park');
  assert_(Object.keys(leafScope).length === 1 && leafScope['dan park'], "leaf manager should only see themselves");

  Logger.log("✅ _test_resolveGDManagerScope_ passed");
}
