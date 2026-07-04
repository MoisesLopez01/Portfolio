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
  // Company-wide raw HRIS export — NOT the PS-team-filtered "Roster" tab that
  // PS Contribution Report.js reads. Goals Compliance covers every department,
  // so it must read the unfiltered "Data" tab (Employee Number, Name, Employee
  // Status, Supervisor, Class, Job Title, Department, Key Location, etc.).
  SHEET_ROSTER:        'Data',
  SHEET_HR_TRACKER:    'HR Follow-Up Tracker',
  DEFAULT_QUARTER:     'FY26Q4',
  // Managers fully excluded from manager-engagement metrics (QoQ manager panel,
  // engagement aggregates). Shown in the Manager Scorecard with an "Excepted"
  // tag, never hidden. Full names as they appear in RD's Supervisor column —
  // matched via normName_. Deliberately a code constant (git-versioned), not a
  // Script Property: see 2026-07-04 design spec.
  MANAGER_ENGAGEMENT_EXCEPTIONS: [],
  GOALS_ON_TARGET:     10,   // 10+ goals → On Target
  GOALS_WATCH:         8,    // 8–9 goals → Watch; <8 → At Risk
  STF_MIN_COMPLETED:   8,    // completed goals required for STF
  STF_MIN_CMT_GOALS:   6,    // completed goals needing 8+ comments for STF
  STF_MIN_COMMENTS:    8,    // minimum comments per goal for STF
  CACHE_TTL:           300,  // seconds (5 min)
  CACHE_VER:           'gd_v14_',  // bumped: payload adds per-employee weeklySelf/weeklyMgr series, trendWeeks, prevQuarter block, managerExceptions
  CACHE_CHUNK_SIZE:    90000,  // CacheService caps a single value at 100KB — split larger payloads across N chunk keys instead of skipping the cache entirely
  LOCK_WAIT_MS:        30000,  // max time a concurrent request waits for another user's in-flight recompute before falling back to computing its own copy
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
 * Inverse of parseQuarterDates_ — given a goal's Start Date, returns the fiscal
 * quarter label it falls in (e.g. "FY26Q4"). This is the source of truth for
 * grouping RD rows into a quarter: the per-row 'Fiscal Quarter' text column can
 * be blank or inconsistent across a single goal's own comment rows, but Start
 * Date groups the whole goal (and therefore the rocketeer) into one quarter.
 * Same FY calendar as parseQuarterDates_: Jul 1 → Jun 30.
 */
function dateToFiscalQuarter_(d) {
  if (!d) return null;
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt)) return null;
  var y = dt.getFullYear();
  var m = dt.getMonth();  // 0-based
  var fyYear, qNum;
  if      (m >= 6 && m <= 8)  { qNum = 1; fyYear = y + 1; }  // Jul–Sep
  else if (m >= 9 && m <= 11) { qNum = 2; fyYear = y + 1; }  // Oct–Dec
  else if (m <= 2)            { qNum = 3; fyYear = y;     }  // Jan–Mar
  else                        { qNum = 4; fyYear = y;     }  // Apr–Jun
  return 'FY' + String(fyYear).slice(-2) + 'Q' + qNum;
}

/**
 * Quarter label immediately before the given one — "FY26Q3" → "FY26Q2",
 * "FY26Q1" → "FY25Q4". Computed by decrementing the parsed label, NOT by
 * scanning the quarters-with-data list: a data-gap quarter must not silently
 * make the QoQ shadow jump two quarters back.
 */
function prevQuarterLabel_(quarter) {
  var m = String(quarter || '').match(/FY(\d{2,4})Q([1-4])/i);
  if (!m) return null;
  var fy = parseInt(m[1], 10);
  if (fy < 100) fy += 2000;
  var q = parseInt(m[2], 10);
  if (q === 1) { fy -= 1; q = 4; } else { q -= 1; }
  return 'FY' + String(fy).slice(-2) + 'Q' + q;
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

/**
 * Full ISO-week label list for a quarter, start → end, optionally clamped to
 * today (for the in-progress quarter, so charts stop at the current week).
 * Unlike deriving the axis from comment data, this includes fully silent
 * weeks — a zero on the chart is the signal HR needs, not a gap to hide.
 */
function quarterWeekList_(quarter, clampToToday) {
  var qd = parseQuarterDates_(quarter);
  if (!qd) return [];
  var parse_ = function(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };

  var endStr = qd.end;
  if (clampToToday) {
    var todayStr = new Date().toISOString().slice(0, 10);
    if (todayStr < endStr) endStr = todayStr;
  }

  var weeks = [], seen = {};
  var cursor = parse_(qd.start);
  var endD   = parse_(endStr);
  while (cursor <= endD) {  // 7-day steps visit consecutive ISO weeks, never skipping one
    var wk = dateToISOWeek_(cursor);
    if (wk && !seen[wk]) { seen[wk] = true; weeks.push(wk); }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
  }
  var lastWk = dateToISOWeek_(endD);  // a final partial week can sit past the last 7-day step
  if (lastWk && !seen[lastWk]) weeks.push(lastWk);
  return weeks;
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

// ── Chunked cache (CacheService caps a single value at 100KB) ──────
// A full company-wide payload (200+ employees × up to 10 goals each) can exceed
// that cap; rather than skip caching outright for large quarters, split it across
// N keys (`key::0`, `key::1`, … `key::n`) with a small manifest at `key::n`. Small
// payloads still take the fast path of a single direct write/read.

function cachePutChunked_(cache, key, value, ttlSeconds) {
  var size = CONFIG_GD.CACHE_CHUNK_SIZE;
  if (value.length <= size) { cache.put(key, value, ttlSeconds); return; }

  var n     = Math.ceil(value.length / size);
  var batch = {};
  for (var i = 0; i < n; i++) batch[key + '::' + i] = value.substr(i * size, size);
  batch[key + '::n'] = String(n);
  cache.putAll(batch, ttlSeconds);
}

function cacheGetChunked_(cache, key) {
  var direct = cache.get(key);
  if (direct) return direct;

  var nRaw = cache.get(key + '::n');
  var n    = nRaw ? parseInt(nRaw, 10) : 0;
  if (!n) return null;

  var chunkKeys = [];
  for (var i = 0; i < n; i++) chunkKeys.push(key + '::' + i);
  var found = cache.getAll(chunkKeys);

  var parts = [];
  for (var j = 0; j < n; j++) {
    var part = found[key + '::' + j];
    if (part == null) return null;  // a chunk expired independently — treat as a full miss
    parts.push(part);
  }
  return parts.join('');
}

function cacheRemoveChunked_(cache, key) {
  var nRaw = cache.get(key + '::n');
  var keys = [key, key + '::n'];
  if (nRaw) {
    var n = parseInt(nRaw, 10) || 0;
    for (var i = 0; i < n; i++) keys.push(key + '::' + i);
  }
  cache.removeAll(keys);
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

  // The admin/viewer scope key is shared, but userRole/userEmail/managerScopeName
  // are caller-specific — never trust those fields from a cached payload (they
  // reflect whoever warmed the entry, not the current caller). Always overlay
  // the live access values before returning, whether from cache or freshly built.
  var withLiveAccess_ = function (obj) {
    obj.userRole         = access.role;
    obj.userEmail        = access.email;
    obj.managerScopeName = (access.role === 'manager') ? access.delegateScopeName : null;
    return obj;
  };

  var tryReadCache_ = function () {
    var cached = cacheGetChunked_(cache, cacheKey);
    if (!cached) return null;
    try { return withLiveAccess_(JSON.parse(cached)); } catch (e) { return null; }
  };

  var hit = tryReadCache_();
  if (hit) return hit;

  // Cache miss. With 200+ people using the dashboard, a cold/expired entry can
  // otherwise trigger the same expensive RD+roster read and aggregation dozens of
  // times concurrently. A script lock serializes the rebuild: the first caller
  // computes and caches; everyone else waiting on the lock re-checks the now-warm
  // cache instead of redoing the same work.
  var lock    = LockService.getScriptLock();
  var gotLock = false;
  try { gotLock = lock.tryLock(CONFIG_GD.LOCK_WAIT_MS); }
  catch (e) { log_('Lock acquisition failed, proceeding unlocked: ' + e.message); }

  try {
    if (gotLock) {
      hit = tryReadCache_();
      if (hit) return hit;
    }

    var result = buildComplianceData_(qtr, access);

    try { cachePutChunked_(cache, cacheKey, JSON.stringify(result), CONFIG_GD.CACHE_TTL); }
    catch (e) { log_('Cache put skipped: ' + e.message); }

    return withLiveAccess_(result);
  } finally {
    if (gotLock) lock.releaseLock();
  }
}

function getAllRocketeersData() {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  // Quarter-independent — one cache entry per scope (admin/viewer share one,
  // managers get their own), same scoping rationale as getGoalsComplianceData.
  var scopeKey = (access.role === 'admin' || access.role === 'viewer') ? 'admin' : access.email;
  var cacheKey = CONFIG_GD.CACHE_VER + 'allrock_' + scopeKey;
  var cache    = CacheService.getScriptCache();

  var withLiveAccess_ = function (obj) {
    obj.userRole         = access.role;
    obj.userEmail        = access.email;
    obj.managerScopeName = (access.role === 'manager') ? access.delegateScopeName : null;
    return obj;
  };

  var tryReadCache_ = function () {
    var cached = cacheGetChunked_(cache, cacheKey);
    if (!cached) return null;
    try { return withLiveAccess_(JSON.parse(cached)); } catch (e) { return null; }
  };

  var hit = tryReadCache_();
  if (hit) return hit;

  var lock    = LockService.getScriptLock();
  var gotLock = false;
  try { gotLock = lock.tryLock(CONFIG_GD.LOCK_WAIT_MS); }
  catch (e) { log_('Lock acquisition failed, proceeding unlocked: ' + e.message); }

  try {
    if (gotLock) {
      hit = tryReadCache_();
      if (hit) return hit;
    }

    var result = buildAllRocketeersData_(access);

    try { cachePutChunked_(cache, cacheKey, JSON.stringify(result), CONFIG_GD.CACHE_TTL); }
    catch (e) { log_('Cache put skipped: ' + e.message); }

    return withLiveAccess_(result);
  } finally {
    if (gotLock) lock.releaseLock();
  }
}

// Auditor drill-down for the Individual Engagement List tab: every goal for
// ONE rocketeer this quarter, with the full comment thread per goal tagged
// IC (self) vs Manager vs Other. Not cached — a small, on-demand, per-person
// read, unlike the bulk company-wide endpoints above.
function getRocketeerGoalDetail(quarter, normName) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  var targetNorm = normName_(normName);
  if (!targetNorm) return { ok: false, error: 'No rocketeer specified' };

  var fullRosterMap = getFullRosterMap_();

  // Manager access-control boundary — reject outright rather than silently
  // returning empty, so a scoped manager can't probe for people outside
  // their org tree by trying names.
  if (access.role === 'manager') {
    var scopeSet = resolveGDManagerScope_(fullRosterMap, normName_(access.delegateScopeName));
    if (!scopeSet[targetNorm]) return { ok: false, denied: true, email: access.email };
  }

  // quarter === 'ALL' is the All-Time roster's drill-down mode: return every goal
  // across every quarter for this rocketeer instead of filtering to one quarter —
  // the This-Quarter roster/Manager Scorecard/Needs Support callers always pass an
  // explicit quarter string, never this sentinel.
  var allQuarters = quarter === 'ALL';
  var qtr    = allQuarters ? 'ALL' : String(quarter || CONFIG_GD.DEFAULT_QUARTER).trim();
  var allRd  = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);

  // Filter to this one rocketeer's own rows first — a small subset — before
  // doing any quarter derivation, rather than scanning/deriving quarters for
  // the whole company-wide sheet to answer a single-person question.
  var ownRows = allRd.filter(function(r) { return normName_(r['Rocketeer']) === targetNorm; });
  if (!ownRows.length) return { ok: true, rocketeer: null, quarter: qtr, goals: [] };

  var rocketeerName = String(ownRows[0]['Rocketeer'] || '').trim();
  var supervisor = '', department = '', jobTitle = '';
  ownRows.forEach(function(r) {
    if (!supervisor && String(r['Supervisor'] || '').trim()) supervisor = String(r['Supervisor'] || '').trim();
    if (!department && String(r['Department'] || '').trim()) department = String(r['Department'] || '').trim();
    if (!jobTitle   && String(r['Job Title']  || '').trim()) jobTitle   = String(r['Job Title']  || '').trim();
  });

  // Interns are excluded everywhere in this dashboard — same OR-logic rule
  // as stripInterns_ (Roster title independently checked from RD's own).
  var rosterJobTitle = fullRosterMap[targetNorm] ? fullRosterMap[targetNorm].jobTitle : '';
  if (isIntern_(rosterJobTitle) || isIntern_(jobTitle)) {
    return { ok: true, rocketeer: null, quarter: qtr, goals: [] };
  }

  // Derive each of this rocketeer's own goals' quarter locally — same
  // Start-Date rule buildComplianceData_ uses for the whole sheet, scoped to
  // just their own (already small) row set.
  var goalQuarterMap = {};
  ownRows.forEach(function(r) {
    var goalId = String(r['Goal ID'] || '').trim();
    if (!goalId || goalQuarterMap[goalId]) return;
    var q = dateToFiscalQuarter_(r['Start Date']);
    if (q) goalQuarterMap[goalId] = q;
  });

  var normSup  = normName_(supervisor);
  var goalsMap = {};
  ownRows.forEach(function(row) {
    var goalId = String(row['Goal ID'] || '').trim();
    if (!goalId) return;
    var rowQuarter = goalQuarterMap[goalId] || String(row['Fiscal Quarter'] || '').trim();
    if (!allQuarters && rowQuarter !== qtr) return;

    if (!goalsMap[goalId]) {
      goalsMap[goalId] = {
        id:        goalId,
        name:      String(row['Goal Name']   || ''),
        status:    String(row['Goal Status'] || '').trim(),
        startDate: row['Start Date'] ? fmtDate_(row['Start Date']) : '',
        mood:      String(row['Mood'] || '').trim(),
        quarter:   rowQuarter,
        comments:  [],
      };
    }

    var cText = String(row['Comment Text'] || '').trim();
    var cBy   = String(row['Commentator']  || '').trim();
    var cDate = row['Comment Date'];
    if (cText && cBy) {
      var cNorm = normName_(cBy);
      var type  = cNorm === targetNorm ? 'self' : (normSup && cNorm === normSup ? 'manager' : 'other');
      goalsMap[goalId].comments.push({
        date:        cDate ? fmtDate_(cDate) : '',
        commentator: cBy,
        text:        cText,
        type:        type,
      });
    }
  });

  var goals = Object.keys(goalsMap).map(function(id) {
    var g = goalsMap[id];
    g.comments.sort(function(a, b) { return a.date.localeCompare(b.date); });
    return g;
  }).sort(function(a, b) { return (a.startDate || '').localeCompare(b.startDate || ''); });

  return {
    ok: true,
    rocketeer: {
      name: rocketeerName, normName: targetNorm,
      department: department, jobTitle: jobTitle, supervisor: supervisor,
    },
    quarter: qtr,
    goals: goals,
  };
}

function saveHRNote(data) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  try {
    var email = access.email || 'unknown';
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
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  var cache = CacheService.getScriptCache();
  var toRemove = [CONFIG_GD.DEFAULT_QUARTER];
  if (quarter && quarter !== CONFIG_GD.DEFAULT_QUARTER) toRemove.push(quarter);

  // Cache keys are scoped by role/email (see getGoalsComplianceData) and may be
  // chunked (see cachePutChunked_) — remove both the shared admin/viewer entry and
  // the calling user's own scoped entry, chunks included, so Refresh works for
  // whichever role clicked it.
  var scopeKeys = ['admin', access.email];
  toRemove.forEach(function(q) {
    scopeKeys.forEach(function(sk) { cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + q + '_' + sk); });
  });

  // All Rocketeers tab is quarter-independent — one cache entry per scope,
  // not per quarter (see getAllRocketeersData) — clear it here too so Refresh
  // covers both views in one call.
  scopeKeys.forEach(function(sk) { cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + 'allrock_' + sk); });

  return { ok: true };
}

function getUserEmail() {
  try { return Session.getActiveUser().getEmail(); } catch (e) { return ''; }
}

// ── Private data builder ────────────────────────────────────────

function buildComplianceData_(quarter, access) {
  log_('buildComplianceData_ | quarter: ' + quarter);

  // 1. Read full RD and filter by quarter. Grouping is keyed off each goal's own
  // Start Date (dateToFiscalQuarter_), NOT the per-row 'Fiscal Quarter' text —
  // that column can be blank or inconsistent across a single goal's own comment
  // rows, which was silently dropping goals (and sometimes an entire rocketeer)
  // whenever the text didn't match. Start Date groups the whole goal consistently.
  var allRd = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);

  var goalQuarterMap = {};  // Goal ID → derived quarter, resolved once from the first row with a parseable Start Date
  allRd.forEach(function(r) {
    var goalId = String(r['Goal ID'] || '').trim();
    if (!goalId || goalQuarterMap[goalId]) return;
    var q = dateToFiscalQuarter_(r['Start Date']);
    if (q) goalQuarterMap[goalId] = q;
  });
  var deriveRowQuarter_ = function(r) {
    var goalId = String(r['Goal ID'] || '').trim();
    var q = goalId ? goalQuarterMap[goalId] : null;
    // Fallback to the raw text only when Start Date is missing/unparseable on every
    // row for this goal — keeps a row from being lost outright in that edge case.
    return q || String(r['Fiscal Quarter'] || '').trim();
  };

  var rdRows = allRd.filter(function(r) { return deriveRowQuarter_(r) === quarter; });
  log_('RD rows for ' + quarter + ': ' + rdRows.length);

  // 2. Read Roster once (both active and terminated) — company-wide. Used to
  // resolve a manager's org-tree scope and to derive rosterMap/terminatedSet/
  // locMap/supTitleMap below. Never used to require an RD rocketeer to have a
  // matching roster row — see aggregateByRocketeer_.
  var fullRosterMap = getFullRosterMap_();

  // 2b. Manager role: build a scope set of normNames in the caller's org tree —
  // a hard access-control boundary enforced in aggregateByRocketeer_. Admins and
  // viewers get scopeSet = null, i.e. no restriction at all.
  var managerScopeName = null;
  var scopeSet = null;
  if (access && access.role === 'manager') {
    managerScopeName = access.delegateScopeName;
    scopeSet = resolveGDManagerScope_(fullRosterMap, normName_(managerScopeName));
    log_('Manager scope "' + managerScopeName + '": ' + Object.keys(scopeSet).length + ' people in scope');
  }

  // rosterMap: every in-scope roster person, active AND terminated (narrowed to
  // the manager's scope when applicable). Used purely for enrichment (location,
  // job title, department, terminated tag) — never a gate on whether RD-sourced
  // goal data is kept. Zero-goal injection below still only injects the active
  // subset.
  var rosterMap = {};
  Object.keys(fullRosterMap).forEach(function(norm) {
    if (scopeSet && !scopeSet[norm]) return;
    rosterMap[norm] = fullRosterMap[norm];
  });

  // terminatedSet: roster-confirmed terminated people (in scope) — surfaced to
  // the UI as a "Terminated" tag, never as an exclusion. A name absent from the
  // roster entirely is NOT terminated as far as this dashboard is concerned.
  var terminatedSet = {};
  Object.keys(rosterMap).forEach(function(norm) {
    if (!rosterMap[norm].active) terminatedSet[norm] = true;
  });

  var locMap         = {};
  var supTitleMap    = {};
  Object.keys(rosterMap).forEach(function(norm) {
    var r = rosterMap[norm];
    locMap[norm]      = r.location;
    supTitleMap[norm] = r.jobTitle;
  });
  log_('Roster: ' + Object.keys(rosterMap).length + ' in scope (' +
       Object.keys(terminatedSet).length + ' terminated) | locations: ' + Object.keys(locMap).length);

  // 3. Aggregate per rocketeer — aggregateByRocketeer_ itself keeps every
  // Rocketeer found in the RD sheet (the only gate inside it is the manager's
  // org-tree scope boundary). Interns are stripped out immediately below,
  // and terminated ("attrition") rocketeers are split into a separate list —
  // both are excluded from compliance rate/RPI/STF/engagement math, but
  // attrition stays visible (isolated) for HR reference; see step 3c.
  var rockMap = aggregateByRocketeer_(rdRows, scopeSet, quarter);
  stripInterns_(rockMap, rosterMap);

  // 3c. Split terminated ("attrition") rocketeers out of rockMap into their
  // own list — a departure mid-quarter shouldn't drag down the org's
  // compliance rate/RPI/STF/engagement math, but HR still needs to see them.
  // Both lists get the same per-employee finalize treatment in step 5, so
  // attrition entries still carry a compliance tier/job family for context —
  // they're just never summed into computeSummary_'s org-wide totals.
  var attritionList = [];
  Object.keys(rockMap).forEach(function(norm) {
    if (terminatedSet[norm]) { attritionList.push(rockMap[norm]); delete rockMap[norm]; }
  });

  // 3b. Inject every ACTIVE, in-scope, non-intern Roster employee not found in
  // the RD sheet (0 goals this quarter). Terminated roster people are never
  // injected this way — they only appear here if they actually have RD
  // activity, split into the isolated attrition list in step 3c below.
  var preInjectCount = Object.keys(rockMap).length;
  Object.keys(rosterMap).forEach(function(norm) {
    if (rockMap[norm]) return; // already present from RD
    var r = rosterMap[norm];
    if (!r.active) return;
    if (isIntern_(r.jobTitle)) return;
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
      weeklySelf: {}, weeklyMgr: {},
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

  // 5. Finalise employee records — the same enrichment applies to both the
  // main array and the isolated attrition list, so attrition entries still
  // carry a compliance tier/job family/RPI/STF flags for context even though
  // they're excluded from every org-wide total (computeSummary_ only ever
  // iterates `employees`, never `attrition`).
  var finalizeEmployeeRecord_ = function(emp) {
    emp.location         = locMap[emp.normName] || locMap[normName_(emp.name)] || emp.location || 'Unknown';
    emp.jobFamily        = deriveJobFamily_(emp.jobTitle);
    emp.complianceStatus = computeStatus_(emp.totalGoals);
    emp.terminated       = !!terminatedSet[emp.normName];

    // RPI eligibility: 10+ total goals, 8+ completed, comments in every quarter week
    emp.rpiEligible = emp.totalGoals >= CONFIG_GD.GOALS_ON_TARGET &&
                      emp.goalsCompleted >= CONFIG_GD.GOALS_WATCH &&
                      emp.commentWeeks >= totalQtrWeeks;

    // STF eligibility: 8+ completed goals, 6+ of those with 8+ total comments
    emp.stfEligible = emp.stfGoalsCompleted >= CONFIG_GD.STF_MIN_COMPLETED &&
                      emp.stfGoalsWithSufficientComments >= CONFIG_GD.STF_MIN_CMT_GOALS;

    return emp;
  };

  var employees = Object.values(rockMap).map(finalizeEmployeeRecord_);
  employees.sort(function(a, b) { return a.name.localeCompare(b.name); });

  var attrition = attritionList.map(finalizeEmployeeRecord_);
  attrition.sort(function(a, b) { return a.name.localeCompare(b.name); });

  // 6. Available quarters from full dataset (same Start-Date-derived quarter as step 1)
  var quartersSet = {};
  allRd.forEach(function(r) {
    var q = deriveRowQuarter_(r);
    if (q) quartersSet[q] = true;
  });
  var quarters = Object.keys(quartersSet).sort().reverse();

  // 7. Comment trend (weekly counts by org and department)
  var commentTrend = computeCommentTrend_(rdRows, employees);

  // 7b. Full quarter week axis (start → today) — silent weeks render as zeros
  // on the Trends charts instead of disappearing. commentTrend/totalQtrWeeks
  // keep their data-derived semantics (RPI depends on totalQtrWeeks).
  var trendWeeks = quarterWeekList_(quarter, true);

  // 7c. Manager engagement exceptions — normalized once, shipped to the client
  // so the Scorecard tag and the QoQ manager panel apply the same set.
  var managerExceptions = (CONFIG_GD.MANAGER_ENGAGEMENT_EXCEPTIONS || []).map(normName_);

  // 7d. Previous-quarter lite block for the QoQ shadow — derived from the SAME
  // allRd array already in memory (no extra sheet read). Terminated employees
  // are kept (they were active then; dropping them would understate the
  // shadow); interns are stripped exactly like the main list. Null when the
  // preceding quarter has no RD rows at all.
  var prevQuarter = null;
  var prevLabel   = prevQuarterLabel_(quarter);
  if (prevLabel) {
    var prevRows = allRd.filter(function(r) { return deriveRowQuarter_(r) === prevLabel; });
    if (prevRows.length) {
      var prevMap = aggregateByRocketeer_(prevRows, scopeSet, prevLabel);
      stripInterns_(prevMap, rosterMap);
      prevQuarter = {
        quarter: prevLabel,
        weeks:   quarterWeekList_(prevLabel, false),
        employees: Object.values(prevMap).map(function(emp) {
          return {
            normName:   emp.normName,
            name:       emp.name,
            department: emp.department,
            supervisor: emp.supervisor,
            location:   locMap[emp.normName] || 'Unknown',
            jobFamily:  deriveJobFamily_(emp.jobTitle),
            totalGoals: emp.totalGoals,
            weeklySelf: emp.weeklySelf,
            weeklyMgr:  emp.weeklyMgr,
          };
        }),
      };
    }
  }

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
  var engagementData = computeEngagementData_(employees, weeksElapsedSinceStart, supTitleMap, managerExceptions);

  log_('buildComplianceData_ done | employees: ' + employees.length + ' | weeks: ' + totalQtrWeeks +
       ' | goalGrace: ' + isGoalCreationGrace + ' | completionGrace: ' + isCompletionGrace +
       ' | weeksElapsed: ' + weeksElapsedSinceStart + ' | pace: ' + engagementData.paceThreshold);

  return {
    employees:              employees,
    attrition:              attrition,
    summary:                computeSummary_(employees),
    commentTrend:           commentTrend,
    trendWeeks:             trendWeeks,
    prevQuarter:            prevQuarter,
    managerExceptions:      managerExceptions,
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

function buildAllRocketeersData_(access) {
  log_('buildAllRocketeersData_ | building all-time rocketeer roster');

  var allRd         = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);
  var fullRosterMap = getFullRosterMap_();

  var managerScopeName = null;
  var scopeSet = null;
  if (access && access.role === 'manager') {
    managerScopeName = access.delegateScopeName;
    scopeSet = resolveGDManagerScope_(fullRosterMap, normName_(managerScopeName));
  }

  var agg = aggregateAllRocketeers_(allRd, fullRosterMap, scopeSet);

  log_('buildAllRocketeersData_ done | rocketeers: ' + agg.totalRocketeers +
       ' | managers: ' + agg.managers.length);

  return {
    managers:         agg.managers,
    totalRocketeers:  agg.totalRocketeers,
    generatedAt:      new Date().toISOString(),
    userRole:         access ? access.role  : null,
    userEmail:        access ? access.email : null,
    managerScopeName: managerScopeName,
  };
}

// ── Aggregation ─────────────────────────────────────────────────

function aggregateByRocketeer_(rows, scopeSet, quarter) {
  var map = {};

  rows.forEach(function(row) {
    var name = String(row['Rocketeer'] || '').trim();
    if (!name) return;
    var norm = normName_(name);

    // Manager access-control boundary — only applies when a scope set is supplied
    // (manager role, restricted to their own org tree). Admin/viewer pass null and
    // see every rocketeer with RD activity — interns and terminated employees
    // included; termination is surfaced as a tag (see buildComplianceData_),
    // never an exclusion.
    if (scopeSet && !scopeSet[norm]) return;

    if (!map[norm]) {
      map[norm] = {
        name:       name,
        normName:   norm,
        department: String(row['Department']    || '').trim(),
        classVal:   String(row['Class']         || '').trim(),
        supervisor: String(row['Supervisor']    || '').trim(),
        jobTitle:   String(row['Job Title']     || '').trim(),
        // The row is already known to belong to `quarter` (rows are pre-filtered by
        // deriveRowQuarter_ before reaching this function) — use it directly rather
        // than the row's own 'Fiscal Quarter' text, which can be blank/inconsistent.
        quarter:    quarter || String(row['Fiscal Quarter'] || '').trim(),
        _goals:     {},
        _selfCmtWeeks: {},  // ISO weeks in which rocketeer self-commented
        _weeklySelf: {},    // ISO week → self-comment count (sparse; QoQ/trend raw material)
        _weeklyMgr:  {},    // ISO week → manager-comment count (sparse)
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
      var wk     = cDate ? dateToISOWeek_(cDate) : null;

      g.totalComments++;

      if (cNorm === norm) {
        g.selfComments++;
        if (wk) {
          map[norm]._selfCmtWeeks[wk] = true;  // RPI: weeks with any self-comment
          map[norm]._weeklySelf[wk]   = (map[norm]._weeklySelf[wk] || 0) + 1;
        }
      } else if (sup && cNorm === sup) {
        g.managerComments++;
        if (wk) map[norm]._weeklyMgr[wk] = (map[norm]._weeklyMgr[wk] || 0) + 1;
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

    // Sparse weekly series — the raw material every filter-aware chart
    // (Trends combo, QoQ panels) recomputes from client-side.
    emp.weeklySelf = emp._weeklySelf;
    emp.weeklyMgr  = emp._weeklyMgr;

    delete emp._goals;
    delete emp._selfCmtWeeks;
    delete emp._weeklySelf;
    delete emp._weeklyMgr;
  });

  return map;
}

// ── Supervisor job-title lookup (for Senior Leader detection) ──

function isSeniorLeader_(jobTitle) {
  return /\b(vp|vice.?president|director|chief|c[a-z]o|ceo|cto|cfo|coo)\b/i.test(jobTitle || '');
}

// ── Intern detection ─────────────────────────────────────────
// Interns aren't required to log goals, aren't evaluated on this cadence, and
// don't qualify for STF — excluded from every view in this dashboard. Pattern
// match (not a hardcoded title list) mirrors the existing convention in
// PS Contribution Report.js (title.includes("intern")) and self-updates when
// a new "Intern, <Dept>" title is added to the company catalog.
function isIntern_(jobTitle) {
  return /intern/i.test(jobTitle || '');
}

// Removes intern entries from a normName-keyed employee map, in place.
// `jobTitleMap` resolves the Roster Job Title per normName (Roster's Job
// Title comes from the same NetSuite export as RD). A rocketeer is excluded
// if EITHER the Roster title OR their own (RD-aggregated) title matches —
// checked independently, not "prefer one, fall back to the other" — since a
// title can show as Intern in one source before the other has synced.
function stripInterns_(map, jobTitleMap) {
  Object.keys(map).forEach(function(norm) {
    var rosterJobTitle = jobTitleMap[norm] ? jobTitleMap[norm].jobTitle : '';
    var ownJobTitle     = map[norm].jobTitle;
    if (isIntern_(rosterJobTitle) || isIntern_(ownJobTitle)) delete map[norm];
  });
}

// ── All Rocketeers aggregation (quarter-independent, for the All Rocketeers
//    tab) ───────────────────────────────────────────────────────────────
// Pure function: groups every RD row by its own Supervisor field (not a
// Roster org-tree — one level, same rule a reference "process 100k+ rows"
// test script used), across ALL quarters combined. `scopeSet` narrows to a
// manager's org tree when supplied (null = no restriction, admin/viewer).
// `fullRosterMap` is used only to resolve the Roster Job Title for intern
// detection — never to enrich the returned rows (Department/Job Title/
// Supervisor come from RD alone).
function aggregateAllRocketeers_(rows, fullRosterMap, scopeSet) {
  var rockMap = {};

  rows.forEach(function(row) {
    var name = String(row['Rocketeer'] || '').trim();
    if (!name) return;
    var norm = normName_(name);
    if (scopeSet && !scopeSet[norm]) return;

    var supervisor = String(row['Supervisor'] || '').trim() || 'Unassigned';
    var department = String(row['Department'] || '').trim();
    var jobTitle   = String(row['Job Title']  || '').trim();
    var startDate  = row['Start Date'];
    var goalId     = String(row['Goal ID']    || '').trim();

    if (!rockMap[norm]) {
      rockMap[norm] = {
        name: name, normName: norm,
        department: department, jobTitle: jobTitle, supervisor: supervisor,
        _latestStart: null, _goalIds: {}, _quarters: {},
      };
    }
    var emp = rockMap[norm];

    // Department/Job Title/Supervisor reflect whichever row has the latest
    // Start Date seen so far — a rocketeer's most recent assignment.
    var sd = startDate ? new Date(startDate) : null;
    var sdValid = sd instanceof Date && !isNaN(sd);
    if (sdValid && (!emp._latestStart || sd > emp._latestStart)) {
      emp._latestStart = sd;
      if (department) emp.department = department;
      if (jobTitle)   emp.jobTitle   = jobTitle;
      if (supervisor) emp.supervisor = supervisor;
    }

    if (goalId) {
      emp._goalIds[goalId] = true;
      if (sdValid) {
        var q = dateToFiscalQuarter_(startDate);
        if (q) emp._quarters[q] = true;
      }
    }
  });

  stripInterns_(rockMap, fullRosterMap);

  var managerMap = {};
  Object.keys(rockMap).forEach(function(norm) {
    var emp = rockMap[norm];
    var quarters = Object.keys(emp._quarters).sort();
    var rec = {
      name:         emp.name,
      normName:     emp.normName,
      department:   emp.department,
      jobTitle:     emp.jobTitle,
      totalGoals:   Object.keys(emp._goalIds).length,
      firstQuarter: quarters.length ? quarters[0] : '',
      lastQuarter:  quarters.length ? quarters[quarters.length - 1] : '',
    };

    var normSup = normName_(emp.supervisor);
    if (!managerMap[normSup]) {
      managerMap[normSup] = { supervisor: emp.supervisor, normSupervisor: normSup, rocketeers: [] };
    }
    managerMap[normSup].rocketeers.push(rec);
  });

  var managers = Object.keys(managerMap).map(function(k) { return managerMap[k]; });
  managers.forEach(function(m) {
    m.rocketeers.sort(function(a, b) { return a.name.localeCompare(b.name); });
    m.teamSize = m.rocketeers.length;
  });
  managers.sort(function(a, b) { return a.supervisor.localeCompare(b.supervisor); });

  return { managers: managers, totalRocketeers: Object.keys(rockMap).length };
}

// ── Full Roster records (every employee, active AND terminated) ────
// Returns { normName → { name, normName, department, supervisor, jobTitle,
//           classVal, location, active } }
// Nobody is excluded here — interns and terminated employees are both included
// (flagged active:false when terminated) so callers can tag them — the roster is
// otherwise pure enrichment (supervisor / location / job family), never a gate
// on RD-sourced data.

function getFullRosterMap_() {
  var map = {};
  try {
    var rows = readSheet_(CONFIG_GD.ROSTER_SS_ID, CONFIG_GD.SHEET_ROSTER);
    if (!rows.length) {
      Logger.log('⚠️ getFullRosterMap_: 0 rows read from "' + CONFIG_GD.SHEET_ROSTER + '" — check sheet name/ID.');
      return map;
    }

    rows.forEach(function(row) {
      var name = row['Name'] || row['Rocketeer'] || row['Employee Name'] || row['Full Name'] || '';
      if (!name) return;
      var norm = normName_(String(name));

      var classVal = String(row['Class'] || '').trim().toUpperCase();
      var jobTitle = String(row['Job Title'] || row['Title'] || row['Position'] || '').trim();

      // Active/inactive is determined solely by whether Termination/Release Date
      // is blank — every roster row carries a populated Key Location, so no
      // fallback field is needed there either.
      var termRaw = row['Termination/Release Date'];
      var isInactiveByDate = termRaw !== undefined && termRaw !== null && String(termRaw).trim() !== '';

      map[norm] = {
        name:       String(name).trim(),
        normName:   norm,
        department: String(row['Department'] || '').trim(),
        supervisor: String(row['Supervisor'] || row['Manager'] || '').trim(),
        jobTitle:   jobTitle,
        classVal:   classVal,
        location:   String(row['Key Location'] || '').trim(),
        active:     !isInactiveByDate,
      };
    });

    var activeCount = Object.keys(map).filter(function(n) { return map[n].active; }).length;
    Logger.log('getFullRosterMap_: ' + Object.keys(map).length + ' roster rows (' +
               activeCount + ' active, ' + (Object.keys(map).length - activeCount) +
               ' inactive) from ' + rows.length + ' "' + CONFIG_GD.SHEET_ROSTER + '" rows');
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

function computeEngagementData_(employees, weeksElapsed, supervisorTitleMap, exceptionNorms) {
  var paceThreshold = Math.floor(weeksElapsed / 2);

  var exceptSet = {};
  (exceptionNorms || []).forEach(function(n) { exceptSet[n] = true; });

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
            isExcepted:     !!exceptSet[normSup],
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
      isExcepted:     m.isExcepted,
      avgCmts:        m.teamSize > 0 ? +(m.totalMgrCmts / m.teamSize).toFixed(1) : 0,
      covered:        m.covered,
      teamSize:       m.teamSize,
    };
  }).sort(function(a, b) {
    if (a.isExcepted !== b.isExcepted) return a.isExcepted ? 1 : -1;
    return b.avgCmts - a.avgCmts;
  });

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
        terminated:      !!e.terminated,
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

function _test_isIntern_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_isIntern_: " + msg); }

  assert_(isIntern_('Intern, Professional Services') === true, "exact catalog title must match");
  assert_(isIntern_('Intern Engineer, Service Delivery') === true, "non-comma intern title must match");
  assert_(isIntern_('intern, marketing') === true, "match must be case-insensitive");
  assert_(isIntern_('Consultant, Professional Services') === false, "non-intern title must not match");
  assert_(isIntern_('') === false, "blank title must not match");
  assert_(isIntern_(null) === false, "null title must not match");

  Logger.log("✅ _test_isIntern_ passed");
}

function _test_stripInterns_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_stripInterns_: " + msg); }

  // Bob's own title is clean, but the Roster says Intern — OR-logic means he
  // must still be excluded (a title can show as Intern in one source before
  // the other has synced).
  var map = {
    'alice smith': { jobTitle: 'Consultant, Professional Services' },
    'bob jones':   { jobTitle: 'Consultant, Professional Services' },
    'cara lee':    { jobTitle: 'Intern, Marketing' },
  };
  var rosterMap = {
    'alice smith': { jobTitle: 'Consultant, Professional Services' },
    'bob jones':   { jobTitle: 'Intern, Managed Services' },
    // cara lee has no roster entry — falls back to her own map jobTitle
  };

  stripInterns_(map, rosterMap);

  var keys = Object.keys(map).sort();
  assert_(keys.length === 1 && keys[0] === 'alice smith',
    "expected only alice to survive, got " + keys.length + " (" + keys.join(",") + ")");

  Logger.log("✅ _test_stripInterns_ passed");
}

function _test_aggregateAllRocketeers_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_aggregateAllRocketeers_: " + msg); }

  var rows = [
    // Alice: 2 goals across two quarters, reports to Jane
    { 'Rocketeer':'Alice Smith', 'Supervisor':'Jane Doe', 'Department':'Services', 'Job Title':'Consultant, Professional Services', 'Goal ID':'G1', 'Start Date': new Date('2025-08-01') },
    { 'Rocketeer':'Alice Smith', 'Supervisor':'Jane Doe', 'Department':'Services', 'Job Title':'Consultant, Professional Services', 'Goal ID':'G2', 'Start Date': new Date('2026-05-01') },
    // Bob: intern, must be excluded entirely even though he has RD goals
    { 'Rocketeer':'Bob Jones', 'Supervisor':'Jane Doe', 'Department':'Services', 'Job Title':'Intern, Professional Services', 'Goal ID':'G3', 'Start Date': new Date('2025-08-01') },
    // Cara: blank Supervisor -> Unassigned bucket
    { 'Rocketeer':'Cara Lee', 'Supervisor':'', 'Department':'Ops', 'Job Title':'Analyst, Operations', 'Goal ID':'G4', 'Start Date': new Date('2025-09-01') },
  ];
  var fullRosterMap = {}; // no roster matches for anyone — falls back to each row's own Job Title

  var result = aggregateAllRocketeers_(rows, fullRosterMap, null);

  assert_(result.totalRocketeers === 2, "expected 2 rocketeers after intern exclusion, got " + result.totalRocketeers);

  var jane = result.managers.filter(function(m) { return m.supervisor === 'Jane Doe'; })[0];
  assert_(!!jane, "Jane Doe group missing");
  assert_(jane.teamSize === 1, "Bob (intern) must not count toward Jane's team size, got " + jane.teamSize);
  var alice = jane.rocketeers[0];
  assert_(alice.name === 'Alice Smith', "expected Alice in Jane's group, got " + (alice && alice.name));
  assert_(alice.totalGoals === 2, "expected 2 unique goals for Alice, got " + alice.totalGoals);
  assert_(alice.firstQuarter === 'FY26Q1', "expected firstQuarter FY26Q1, got " + alice.firstQuarter);
  assert_(alice.lastQuarter === 'FY26Q4', "expected lastQuarter FY26Q4, got " + alice.lastQuarter);

  var unassigned = result.managers.filter(function(m) { return m.supervisor === 'Unassigned'; })[0];
  assert_(!!unassigned && unassigned.rocketeers[0].name === 'Cara Lee', "blank Supervisor must group under Unassigned");

  // Manager scope: restricting to Cara's own scope must exclude Jane's whole team
  var scoped = aggregateAllRocketeers_(rows, fullRosterMap, { 'cara lee': true });
  assert_(scoped.totalRocketeers === 1 && scoped.managers.length === 1 && scoped.managers[0].supervisor === 'Unassigned',
    "manager scope must exclude out-of-scope rocketeers, got " + JSON.stringify(scoped));

  Logger.log("✅ _test_aggregateAllRocketeers_ passed");
}

function _test_prevQuarterLabel_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_prevQuarterLabel_: " + msg); }

  assert_(prevQuarterLabel_('FY26Q4') === 'FY26Q3', "FY26Q4 → FY26Q3, got " + prevQuarterLabel_('FY26Q4'));
  assert_(prevQuarterLabel_('FY26Q2') === 'FY26Q1', "FY26Q2 → FY26Q1");
  assert_(prevQuarterLabel_('FY26Q1') === 'FY25Q4', "FY boundary: FY26Q1 → FY25Q4, got " + prevQuarterLabel_('FY26Q1'));
  assert_(prevQuarterLabel_('garbage') === null,     "unparseable → null");
  assert_(prevQuarterLabel_('') === null,            "blank → null");

  Logger.log("✅ _test_prevQuarterLabel_ passed");
}

function _test_quarterWeekList_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_quarterWeekList_: " + msg); }

  // FY26Q3 = Jan–Mar 2026, fully in the past — no today-clamping variance.
  var w = quarterWeekList_('FY26Q3', false);
  assert_(w.length >= 12 && w.length <= 14, "a quarter spans ~13 ISO weeks, got " + w.length);
  assert_(w[0] === '2026.W01', "Q3 2026 starts in 2026.W01, got " + w[0]);
  assert_(w.indexOf('2026.W09') !== -1, "mid-quarter week must be present even with no comment data");

  var seen = {};
  w.forEach(function(x) { assert_(!seen[x], "duplicate week " + x); seen[x] = true; });
  for (var i = 1; i < w.length; i++) {
    assert_(w[i] > w[i - 1], "weeks must ascend: " + w[i - 1] + " → " + w[i]);
  }

  assert_(quarterWeekList_('garbage', false).length === 0, "unparseable quarter → empty list");

  // Clamped mode never returns MORE weeks than unclamped.
  var clamped = quarterWeekList_('FY26Q3', true);
  assert_(clamped.length <= w.length, "clamping must not add weeks");

  Logger.log("✅ _test_quarterWeekList_ passed");
}

function _test_weeklySeries_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_weeklySeries_: " + msg); }

  // 2026-04-06 is the Monday of 2026.W15; 2026-04-20 is the Monday of 2026.W17.
  var base = { 'Rocketeer':'Alice Smith', 'Supervisor':'Jane Doe', 'Department':'Ops',
               'Job Title':'Analyst', 'Goal ID':'G1', 'Goal Name':'Playbook',
               'Goal Status':'In Progress', 'Start Date': new Date(2026, 3, 6) };
  function row(commentator, date, text) {
    var r = {}; Object.keys(base).forEach(function(k) { r[k] = base[k]; });
    r['Commentator'] = commentator; r['Comment Date'] = date; r['Comment Text'] = text;
    return r;
  }
  var rows = [
    row('Alice Smith', new Date(2026, 3, 6),  'kickoff'),    // W15 self
    row('Alice Smith', new Date(2026, 3, 8),  'progress'),   // W15 self
    row('Jane Doe',    new Date(2026, 3, 9),  'nice'),       // W15 manager
    row('Alice Smith', new Date(2026, 3, 20), 'later'),      // W17 self
    row('Sam Peer',    new Date(2026, 3, 7),  'peer note'),  // W15 other — must NOT hit weekly maps
  ];

  var map = aggregateByRocketeer_(rows, null, 'FY26Q4');
  var a = map['alice smith'];
  assert_(!!a, "alice must aggregate");
  assert_(a.weeklySelf['2026.W15'] === 2, "two self comments in W15, got " + JSON.stringify(a.weeklySelf));
  assert_(a.weeklySelf['2026.W17'] === 1, "one self comment in W17");
  assert_(Object.keys(a.weeklySelf).length === 2, "weeklySelf must be sparse (2 weeks)");
  assert_(a.weeklyMgr['2026.W15'] === 1, "one manager comment in W15, got " + JSON.stringify(a.weeklyMgr));
  assert_(Object.keys(a.weeklyMgr).length === 1, "peer comments must not appear in weeklyMgr");
  assert_(a.totalSelfComments === 3 && a.totalManagerComments === 1, "existing totals must be unchanged");
  assert_(a._weeklySelf === undefined && a._weeklySelfWeeks === undefined, "no leftover private accumulators");

  Logger.log("✅ _test_weeklySeries_ passed");
}

function _test_managerExceptions_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_managerExceptions_: " + msg); }

  var employees = [
    { normName:'a1', name:'A One', department:'Ops', supervisor:'Jane Doe', jobTitle:'Analyst',
      totalGoals:5, totalSelfComments:3, totalManagerComments:2, complianceStatus:'At Risk' },
    { normName:'b1', name:'B One', department:'Ops', supervisor:'Sam Lead', jobTitle:'Analyst',
      totalGoals:4, totalSelfComments:1, totalManagerComments:0, complianceStatus:'At Risk' },
  ];

  var eng  = computeEngagementData_(employees, 4, {}, ['jane doe']);
  var jane = eng.managerScorecard.filter(function(m) { return m.normName === 'jane doe'; })[0];
  var sam  = eng.managerScorecard.filter(function(m) { return m.normName === 'sam lead'; })[0];

  assert_(jane && jane.isExcepted === true,  "Jane must carry isExcepted:true");
  assert_(sam  && sam.isExcepted  === false, "Sam must carry isExcepted:false");
  assert_(eng.managerScorecard[eng.managerScorecard.length - 1].normName === 'jane doe',
    "excepted managers must sort to the bottom");

  // Omitting the param must behave like no exceptions (back-compat).
  var eng2 = computeEngagementData_(employees, 4, {});
  assert_(eng2.managerScorecard.every(function(m) { return m.isExcepted === false; }),
    "no exceptions passed → nobody excepted");

  Logger.log("✅ _test_managerExceptions_ passed");
}
