// ============================================================
// SCRIPT NAME: Goals Compliance Dashboard — Backend
// FILE:        goalCompliance.js
// PURPOSE:     Data aggregation, caching, and HR follow-up
//              tracker for the company-wide Goals Compliance
//              Dashboard. Pair with GDash.html.
//              v2.1.0: weekly series payload, Trends tab data, QoQ prevQuarter block, manager exceptions.
//              v2.2.0: multi-quarter `history` lite blocks — prior calendar weeks stay active on the Trends tab.
//              v2.3.0: drill-down speed — per-person drill index + roster map cached in CacheService
//                      (script-scoped; access checks still run per request), client-side drill memo.
//              v2.4.0: new-hire flag — hired on/after quarter start ⇒ isNewHire; excluded from the
//                      Needing Support pool client-side and flagged "New Hire" instead.
//              v2.5.0: RPI is a 0–6 score (3 criteria × 2 pts: 10 approved in-quarter goals /
//                      comment cadence on 6+ goals / 8+ completed); signal shows at a perfect 6.
//              v2.5.1: cadence flexed — requirement ramps 2 weeks slower (LAG 6: PTO/sick/delay
//                      allowance) and caps at 8 comments per goal per quarter (was 10), aligning
//                      the RPI comment bar with STF's existing 8.
//              v2.5.2: RPI C1 is status-blind — a goal approved then Canceled / Not Completed
//                      still counts toward the 10; only in-quarter dates are checked.
//              v2.6.0: Behaviors tab payload — per-goal feedback-loop dates →
//                      goalsWithMgrFeedback/goalsFeedbackClosed + goalsClosedNoNote rollups.
//              v2.7.0: CPR pace & consistency — PTO-adjusted EligibleWeeks
//                      (company-wide Accumulation Cost, no dept filter),
//                      paceMetrics per employee + paceBand percentiles.
// VERSION:     2.7.0
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
  // Second Roster-spreadsheet tab holding crewmembers/contractors (Name,
  // Department, Termination/Release Date, Class, Supervisor, Key Location).
  // Merged into getFullRosterMap_ so crew resolve location/supervisor/
  // termination like FTEs; the Data tab wins on a name collision.
  SHEET_CONTRACTORS:   'Contractors Data',
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
  // RPI score (v2.5.x) — 3 criteria × RPI_PTS points each; the RPI signal
  // (rpiEligible) shows only at a perfect score. Criterion 2's per-goal
  // self-comment requirement scales with the quarter week:
  //   required = clamp(week − RPI_CADENCE_LAG, 1, RPI_CADENCE_MAX_CMTS)
  // LAG 6 = the 4-week goal-setting window + 2 flex weeks (PTO, sick time,
  // manager follow-up delays, late commenting starts) — a rolling allowance
  // that applies at ANY point in the quarter, not just at the end. The cap of
  // 8 tops the quarter requirement at 8 comments per goal, deliberately
  // matching STF_MIN_COMMENTS so both programs share one bar.
  RPI_PTS:               2,  // points per criterion met (3 × 2 = 6)
  RPI_CMT_GOALS:         6,  // goals that must meet the cadence requirement (6/10 or 6/8)
  RPI_CADENCE_LAG:       6,  // required self-comments per goal = week-of-quarter − this (min 1)
  RPI_CADENCE_MAX_CMTS:  8,  // requirement ceiling per goal per quarter (aligned with STF)
  // CPR pace & consistency (v2.7.0) — PTO-adjusted comments-per-eligible-week.
  // Company-wide PTO ledger (same "Accumulation Cost" sheet the PS project
  // reads, deliberately WITHOUT its Services filter — this dashboard covers
  // every department; departments are a UI filter concern).
  PTO_SS_ID:           '1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo',
  SHEET_PTO:           'Accumulation Cost',
  PACE_LAG_WEEKS:        4,  // goal-setting window — weeks 1-4 are never chargeable
  PACE_HOURS_PER_WEEK:  40,  // full working week, for fractional absence (hours/40)
  PACE_BAND_LO_PCT:     10,  // CPR below this peer percentile → Behind Pace
  PACE_BAND_HI_PCT:     90,  // CPR above this peer percentile → informational "high"
  PACE_MIN_REF_N:       20,  // below this reference-population size, classify 'na'
  CACHE_TTL:           300,  // seconds (5 min)
  CACHE_VER:           'gd_v19_',  // bumped: paceMetrics/paceBand + roster employeeNumber (v18 added Contractors merge/quarterState)
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

// Employee Numbers arrive from Sheets as numbers (sometimes float-typed) or
// comma-grouped strings — normalize both sides of the PTO↔roster join the
// same way so '1,042' and 1042 always match.
function normEmpNum_(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  return String(typeof raw === 'number' ? Math.round(raw) : raw).replace(/,/g, '').trim();
}

// parseFloat with comma-grouping tolerance; NaN (never null/0) on junk so
// isFinite() checks stay honest.
function numOrNaN_(v) {
  var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : NaN;
}

function fmtDate_(d) {
  try {
    var dt = (d instanceof Date) ? d : new Date(d);
    return isNaN(dt) ? String(d || '') : dt.toISOString().slice(0, 10);
  } catch (e) { return String(d || ''); }
}

// Linear-interpolation percentile over an unsorted numeric array.
// p in [0,100]. Returns null for an empty array. 4-dp rounding keeps
// payload values stable across float noise.
function percentile_(values, p) {
  var v = (values || []).slice().sort(function(a, b) { return a - b; });
  if (!v.length) return null;
  var idx = (p / 100) * (v.length - 1);
  var lo  = Math.floor(idx), hi = Math.ceil(idx);
  return +(v[lo] + (v[hi] - v[lo]) * (idx - lo)).toFixed(4);
}

function median_(values) { return percentile_(values, 50); }

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

// Pure quarter-state / grace-flag resolver — bounded on BOTH sides so a closed
// quarter can never report an "active" grace window (the historical bug: the
// completion flag had no upper bound, so it stayed true forever once a quarter
// entered its final two weeks). quarterDates may be null (unparseable label)
// → both flags false, state null.
function computeQuarterFlags_(quarterDates, todayIso) {
  if (!quarterDates) {
    return { isGoalCreationGrace: false, isCompletionGrace: false, quarterState: null };
  }
  var state = todayIso < quarterDates.start ? 'upcoming'
            : todayIso > quarterDates.end   ? 'closed'
            : 'active';
  return {
    isGoalCreationGrace: state === 'active' && todayIso <= quarterDates.gracePeriodGoalsEnd,
    isCompletionGrace:   state === 'active' && todayIso >= quarterDates.gracePeriodCompletionStart,
    quarterState:        state,
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
/**
 * A "new hire" for a given quarter = hired ON or AFTER that quarter's first
 * day — they never had the full quarter the goal thresholds assume (goals
 * need ~3 months), so the Needing Support view flags them instead of calling
 * them out. Some ramp up mid-quarter and set goals anyway; they stay flagged
 * (and excluded from the support pool) until their first full quarter.
 * Fails safe: missing/unparseable hire date or unknown quarter window → false
 * (never silently excuses someone we can't date).
 */
function isNewHire_(hireDateIso, quarterStartIso) {
  if (!hireDateIso || !quarterStartIso) return false;  // before fmtDate_: new Date(null) is epoch, not invalid
  var iso = /^\d{4}-\d{2}-\d{2}$/;
  var h = fmtDate_(hireDateIso), q = fmtDate_(quarterStartIso);
  if (!iso.test(h) || !iso.test(q)) return false;
  return h >= q;
}

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
// IC (self) vs Manager vs Other. v2.3.0: the per-person rows come from the
// cached drill index (see buildAndCacheDrillIndex_) instead of a full RD
// sheet scan per click — the access check and manager-scope rejection below
// still run on every request, so the cache changes latency, not authority.
function getRocketeerGoalDetail(quarter, normName) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, denied: true, email: access.email };

  var targetNorm = normName_(normName);
  if (!targetNorm) return { ok: false, error: 'No rocketeer specified' };

  var fullRosterMap = getFullRosterMapCached_();

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

  // This rocketeer's own rows, from the per-person drill index cache. A miss
  // rebuilds the index (one full RD read — the same cost every click used to
  // pay) and warms every person's entry for CACHE_TTL, so subsequent drills
  // by anyone skip the sheet entirely.
  var cache    = CacheService.getScriptCache();
  var drillKey = drillCacheKey_(targetNorm);
  var ownRows  = null;
  var blob     = drillKey ? cacheGetChunked_(cache, drillKey) : null;
  if (blob) { try { ownRows = JSON.parse(blob); } catch (e) { ownRows = null; } }
  if (!ownRows) ownRows = buildAndCacheDrillIndex_(cache, fullRosterMap)[targetNorm] || [];
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

function deleteHRNote(data) {
  var access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: 'Access denied' };

  try {
    var ts   = String((data && data.timestamp) || '');
    var norm = String((data && data.normName)  || '');
    if (!ts || !norm) return { ok: false, error: 'Missing note identifier' };

    var ss = SpreadsheetApp.openById(CONFIG_GD.GOALS_SS_ID);
    var sh = ss.getSheetByName(CONFIG_GD.SHEET_HR_TRACKER);
    if (!sh) return { ok: false, error: 'Tracker sheet not found' };

    var vals = sh.getDataRange().getValues();
    if (vals.length < 2) return { ok: false, error: 'Note not found' };
    var hdrs  = vals[0].map(function(h) { return String(h).trim(); });
    var cTs   = hdrs.indexOf('Timestamp');
    var cNorm = hdrs.indexOf('NormName');
    var cRock = hdrs.indexOf('Rocketeer');
    var cBy   = hdrs.indexOf('ReviewedBy');
    if (cTs === -1 || cBy === -1) return { ok: false, error: 'Tracker sheet is missing expected columns' };

    for (var i = 1; i < vals.length; i++) {
      // Timestamps round-trip through the sheet as Date objects or strings —
      // normalise to ISO the same way getHRNotes does so the client value matches.
      var rowIso;
      try { rowIso = new Date(vals[i][cTs]).toISOString(); } catch (badDate) { continue; }
      var rowNorm = (cNorm !== -1 && vals[i][cNorm])
        ? String(vals[i][cNorm])
        : normName_(String(cRock !== -1 ? vals[i][cRock] : ''));
      if (rowIso !== ts || rowNorm !== norm) continue;

      // Admins may delete any note; everyone else only their own.
      var author = String(vals[i][cBy] || '').toLowerCase();
      if (access.role !== 'admin' && author !== String(access.email || '').toLowerCase()) {
        return { ok: false, error: 'Only the note author or an admin can delete this note' };
      }
      sh.deleteRow(i + 1);
      return { ok: true };
    }
    return { ok: false, error: 'Note not found — it may have already been deleted' };
  } catch (e) {
    Logger.log('❌ deleteHRNote: ' + e.message);
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
      scope = resolveGDManagerScope_(getFullRosterMapCached_(), normName_(access.delegateScopeName));
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

  // v2.3.0 shared (unfiltered, script-scoped) caches: the roster map and the
  // per-person drill index must go too — Refresh's contract is "re-read the
  // sheets now", and drill entries are exactly the comment data a user hits
  // Refresh to see. Per-person keys are enumerated via the manifest written by
  // buildAndCacheDrillIndex_ (CacheService can't list keys). Removing a base
  // key + its '::n' manifest makes any leftover numbered chunks unreadable —
  // they expire by TTL.
  cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + 'rostermap');
  var namesBlob = cacheGetChunked_(cache, CONFIG_GD.CACHE_VER + 'drillnames');
  if (namesBlob) {
    try {
      var drillKeys = [];
      JSON.parse(namesBlob).forEach(function(norm) {
        var k = drillCacheKey_(norm);
        if (k) drillKeys.push(k, k + '::n');
      });
      for (var i = 0; i < drillKeys.length; i += 100) cache.removeAll(drillKeys.slice(i, i + 100));
    } catch (e) { log_('drill cache bust skipped: ' + e.message); }
  }
  cacheRemoveChunked_(cache, CONFIG_GD.CACHE_VER + 'drillnames');

  // Roster-derived manager resolution memo (GD Security.js) — clear the
  // caller's own entry so a just-promoted supervisor's Refresh works.
  try { cache.remove('gdsec_sup_' + access.email); } catch (e) {}

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
  var fullRosterMap = getFullRosterMapCached_();

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
    // Crew join the dashboard through their RD goals only — goal-count policy
    // isn't asserted for contractors, so a goal-less contractor is never
    // injected as a 0-goal At Risk row (headline counts unchanged by the merge).
    if (r.isCrew) return;
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
      goalsWithMgrFeedback: 0, goalsFeedbackClosed: 0, goalsClosedNoNote: 0,
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
  // Calendar-derived quarter length (13–14 ISO weeks). The old distinct-
  // comment-week count inflated past quarter close — comments keep accruing on
  // quarter-bucketed goals, producing "0/24" Cmts/Wks denominators and an
  // over-tight RPI cadence for closed quarters. Unparseable quarter labels
  // (no calendar window) keep the data-driven count as a fallback.
  var calWeeks   = quarterWeekList_(quarter, false);
  var calWeekSet = {};
  calWeeks.forEach(function(wk) { calWeekSet[wk] = true; });
  var totalQtrWeeks = calWeeks.length || Math.max(1, Object.keys(qWeekSet).length);

  // 5. Finalise employee records — the same enrichment applies to both the
  // main array and the isolated attrition list, so attrition entries still
  // carry a compliance tier/job family/RPI/STF flags for context even though
  // they're excluded from every org-wide total (computeSummary_ only ever
  // iterates `employees`, never `attrition`).
  // Quarter calendar window — needed by the new-hire flag and RPI cadence
  // below, and the grace-period flags in step 8.
  var quarterDates = parseQuarterDates_(quarter);

  // Calendar weeks elapsed since quarter start — drives the engagement pace
  // threshold (step 10) AND RPI criterion 2's growing comment requirement.
  var weeksElapsedSinceStart = totalQtrWeeks;
  if (quarterDates) {
    var msPerWeek  = 7 * 24 * 60 * 60 * 1000;
    var startMs    = new Date(quarterDates.start).getTime();
    var todayMs    = new Date(new Date().toISOString().slice(0, 10)).getTime();
    var diffWeeks  = Math.floor((todayMs - startMs) / msPerWeek);
    weeksElapsedSinceStart = Math.max(1, Math.min(diffWeeks + 1, totalQtrWeeks));
  }

  var finalizeEmployeeRecord_ = function(emp) {
    var rosterRec        = rosterMap[emp.normName] || rosterMap[normName_(emp.name)] || null;
    emp.location         = locMap[emp.normName] || locMap[normName_(emp.name)] || emp.location || 'Unknown';
    // Crew have no roster Job Title — bucket them as their own job family so
    // the Job Family filter stays meaningful instead of dumping them in "Other".
    emp.isCrew           = !!(rosterRec && rosterRec.isCrew);
    emp.crewClass        = emp.isCrew ? (rosterRec.classVal || '') : '';
    emp.jobFamily        = emp.isCrew ? 'Crew' : deriveJobFamily_(emp.jobTitle);
    emp.complianceStatus = computeStatus_(emp.totalGoals);
    emp.terminated       = !!terminatedSet[emp.normName];

    // Cmts/Wks numerator must count the same weeks as the calendar denominator —
    // self-comments dated outside the quarter window (late updates on quarter-
    // bucketed goals) don't count toward in-quarter cadence.
    if (calWeeks.length) {
      emp.commentWeekList = (emp.commentWeekList || []).filter(function(wk) { return calWeekSet[wk]; });
      emp.commentWeeks    = emp.commentWeekList.length;
    }

    // New hire = no full quarter of tenure for THIS quarter (hired on/after
    // its first day). The client excludes them from the Needing Support pool
    // and shows a "New Hire" flag instead of concern badges.
    emp.hireDate  = (rosterRec && rosterRec.hireDate) || '';
    emp.isNewHire = isNewHire_(emp.hireDate, quarterDates && quarterDates.start);

    // RPI score (v2.5.0): 3 criteria × 2 pts — see computeRpiScore_. The
    // boolean signal (rpiEligible) shows only at a perfect 6/6.
    var rpi = computeRpiScore_(emp, quarterDates, weeksElapsedSinceStart);
    emp.rpiScore     = rpi.score;
    emp.rpiMax       = rpi.max;
    emp.rpiBreakdown = rpi.breakdown;
    emp.rpiEligible  = rpi.score === rpi.max;

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

  // 7d. Historical quarter lite blocks — one per PRIOR quarter with RD data,
  // ascending, derived from the SAME allRd array already in memory (no extra
  // sheet read). This is what keeps older calendar weeks alive on the Trends
  // tab when a new quarter starts: the client renders a continuous
  // multi-quarter axis from these blocks instead of resetting to the current
  // quarter. Terminated employees are kept (they were active then; dropping
  // them would understate history); interns are stripped exactly like the
  // main list.
  var liteEmp_ = function(emp) {
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
  };
  var history = [];
  quarters
    .filter(function(q) { return /^FY\d{2,4}Q[1-4]$/i.test(q) && q < quarter; })
    .sort()
    .forEach(function(lbl) {
      var histRows = allRd.filter(function(r) { return deriveRowQuarter_(r) === lbl; });
      if (!histRows.length) return;
      var histMap = aggregateByRocketeer_(histRows, scopeSet, lbl);
      stripInterns_(histMap, rosterMap);
      history.push({
        quarter:   lbl,
        weeks:     quarterWeekList_(lbl, false),
        employees: Object.values(histMap).map(liteEmp_),
      });
    });

  // QoQ shadow = the immediately-preceding quarter's block, matched by
  // decremented label — NOT history[last]: a data-gap quarter must not
  // silently make the shadow jump two quarters back. Null when the preceding
  // quarter has no RD rows at all.
  var prevQuarter = null;
  var prevLabel   = prevQuarterLabel_(quarter);
  history.forEach(function(h) { if (h.quarter === prevLabel) prevQuarter = h; });

  // 8. Grace period flags (quarterDates and weeksElapsedSinceStart are
  // computed above, before step 5 — RPI and the new-hire flag need them)
  var today                 = new Date().toISOString().slice(0, 10);
  var qFlags                = computeQuarterFlags_(quarterDates, today);
  var isGoalCreationGrace   = qFlags.isGoalCreationGrace;
  var isCompletionGrace     = qFlags.isCompletionGrace;

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
    history:                history,
    prevQuarter:            prevQuarter,
    managerExceptions:      managerExceptions,
    quarter:                quarter,
    quarters:               quarters,
    totalQtrWeeks:          totalQtrWeeks,
    quarterDates:           quarterDates,
    isGoalCreationGrace:    isGoalCreationGrace,
    isCompletionGrace:      isCompletionGrace,
    quarterState:           qFlags.quarterState,
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
  var fullRosterMap = getFullRosterMapCached_();

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
        firstMgrCmtDate: '',   // earliest DATED manager comment (feedback-loop anchor)
        lastSelfCmtDate: '',   // latest DATED self comment (loop closes when >= firstMgrCmtDate)
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
        if (cDate) {
          var sds = fmtDate_(cDate);
          if (sds && (!g.lastSelfCmtDate || sds > g.lastSelfCmtDate)) g.lastSelfCmtDate = sds;
        }
      } else if (sup && cNorm === sup) {
        g.managerComments++;
        if (wk) map[norm]._weeklyMgr[wk] = (map[norm]._weeklyMgr[wk] || 0) + 1;
        if (cDate) {
          var mds = fmtDate_(cDate);
          if (mds && (!g.firstMgrCmtDate || mds < g.firstMgrCmtDate)) g.firstMgrCmtDate = mds;
        }
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

    // Think Team feedback loop — goals with a dated manager comment, and whether a
    // self-comment landed on/after the FIRST one. max(self) >= min(mgr) is the
    // order-independent form: sheet rows carry no date ordering guarantee.
    var mgrFbGoals = goalArr.filter(function(g) { return !!g.firstMgrCmtDate; });
    emp.goalsWithMgrFeedback = mgrFbGoals.length;
    emp.goalsFeedbackClosed  = mgrFbGoals.filter(function(g) {
      return g.lastSelfCmtDate && g.lastSelfCmtDate >= g.firstMgrCmtDate;
    }).length;
    // Build Process — Not Completed / Canceled goals that carry no note at all
    emp.goalsClosedNoNote = goalArr.filter(function(g) {
      return (/not.?complet/i.test(g.status) || /cancel/i.test(g.status)) && g.totalComments === 0;
    }).length;

    // Lean goal list for drill-down + RPI scoring (start feeds the
    // "correct dates" check in computeRpiScore_)
    emp.goalsList = goalArr.map(function(g) {
      return {
        id: g.id, name: g.name, status: g.status, start: g.startDate,
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

// ── RPI score (v2.5.0) ─────────────────────────────────────────
// RPI = 0–6, three criteria worth RPI_PTS (2) each; the RPI signal shows only
// at a perfect score:
//   C1 — has ≥10 goals for the quarter with correct dates. Status-blind
//        (2026-07-06 clarification): a goal that was approved and later
//        Canceled or Not Completed still counts — approval already happened;
//        the outcome is criterion 3's business. "Correct dates" = the goal's
//        own Start Date falls inside the quarter window. (RD carries no
//        approval column, so with status out of the picture the date check
//        is the whole criterion.)
//   C2 — comment cadence: on ≥6 goals (of their 10, or 6 of 8), the rocketeer
//        has at least clamp(weekOfQuarter − RPI_CADENCE_LAG, 1, RPI_CADENCE_MAX_CMTS)
//        self-comments — the requirement starts at 1, grows weekly once the
//        goal-setting window (+2 flex weeks for PTO/sick/delays) is past, and
//        tops out at 8 per quarter, matching the STF comment bar. Canceled
//        goals never count toward cadence.
//   C3 — completed ≥8 goals (8/10 or 8/8).
// Pure function of already-aggregated per-employee data → unit-testable.
function computeRpiScore_(emp, quarterDates, weekOfQuarter) {
  var goals = emp.goalsList || [];
  var inQuarter_ = function(startIso) {
    if (!quarterDates) return true;  // non-FY quarter label — no window to check against
    return !!startIso && startIso >= quarterDates.start && startIso <= quarterDates.end;
  };

  var goalsInQtr = goals.filter(function(g) { return inQuarter_(g.start); }).length;
  var c1 = goalsInQtr >= CONFIG_GD.GOALS_ON_TARGET;

  var required   = Math.min(Math.max(1, (weekOfQuarter || 1) - CONFIG_GD.RPI_CADENCE_LAG),
                            CONFIG_GD.RPI_CADENCE_MAX_CMTS);
  var qualifying = goals.filter(function(g) {
    return !/cancel/i.test(g.status) && (g.self || 0) >= required;
  }).length;
  var c2 = qualifying >= CONFIG_GD.RPI_CMT_GOALS;

  var c3 = (emp.goalsCompleted || 0) >= CONFIG_GD.GOALS_WATCH;

  var pts   = CONFIG_GD.RPI_PTS;
  var score = (c1 ? pts : 0) + (c2 ? pts : 0) + (c3 ? pts : 0);
  return {
    score: score,
    max:   pts * 3,
    breakdown: {
      goals:     { met: c1, have: goalsInQtr, need: CONFIG_GD.GOALS_ON_TARGET },
      cadence:   { met: c2, have: qualifying,    need: CONFIG_GD.RPI_CMT_GOALS, requiredCmts: required },
      completed: { met: c3, have: emp.goalsCompleted || 0, need: CONFIG_GD.GOALS_WATCH },
    },
  };
}

// ── CPR pace & consistency (v2.7.0) ────────────────────────────
// Comments-per-eligible-week, PTO-adjusted, so leave never reads as
// disengagement. EligibleWeeks = weeks since the 4-week goal-setting window
// closed, minus fractional PTO absence (hours/40, capped at 1/week).
// DISTINCT FROM RPI C2: RPI keeps its flat 2-week flex (LAG 6) and stays the
// policy scorecard; this is the analytical layer with the true 4-week lag.
// Never stack the two adjustments.
//   cpr           — per non-canceled goal: self / max(1, eligibleWeeks);
//                   person = median of the top-6 goals by CPR (mirrors the
//                   "6 tracked goals" policy frame).
//   activityRatio — distinct eligible-window weeks with ≥1 self-comment ÷
//                   max(1, eligibleWeeks), capped at 1 (early-quarter
//                   commenting is never penalized).
// cls/consistency are placeholders ('na') until classifyPaceMetrics_ runs —
// classification needs the full population's percentiles.
// Pure function of aggregated per-employee data → Node-testable.
function computePaceMetrics_(emp, weekOfQuarter, ptoWeekHours, calWeeks) {
  var lag         = CONFIG_GD.PACE_LAG_WEEKS;
  var rawWeeks    = Math.max(0, (weekOfQuarter || 0) - lag);
  var windowWeeks = (calWeeks || []).slice(lag, weekOfQuarter || 0);

  var absence = 0;
  windowWeeks.forEach(function(wk) {
    var h = (ptoWeekHours && ptoWeekHours[wk]) || 0;
    absence += Math.min(h, CONFIG_GD.PACE_HOURS_PER_WEEK) / CONFIG_GD.PACE_HOURS_PER_WEEK;
  });
  absence = +absence.toFixed(2);
  var eligible = +Math.max(0, rawWeeks - absence).toFixed(2);

  var out = { rawWeeks: rawWeeks, absenceWeeks: absence, eligibleWeeks: eligible,
              cpr: null, activityRatio: null, cls: 'na', consistency: 'na' };
  if (eligible <= 0) return out;

  var active = (emp.goalsList || []).filter(function(g) { return !/cancel/i.test(g.status); });
  if (!active.length) return out;

  var divisor = Math.max(1, eligible);
  var perGoal = active
    .map(function(g) { return (g.self || 0) / divisor; })
    .sort(function(a, b) { return b - a; })
    .slice(0, CONFIG_GD.RPI_CMT_GOALS);
  out.cpr = +median_(perGoal).toFixed(2);

  var windowSet = {};
  windowWeeks.forEach(function(wk) { windowSet[wk] = true; });
  var activeWks = (emp.commentWeekList || []).filter(function(wk) { return windowSet[wk]; }).length;
  out.activityRatio = +Math.min(1, activeWks / divisor).toFixed(2);
  return out;
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

// ── PTO ingestion (v2.7.0) ──────────────────────────────────────
// The Accumulation Cost export's grain is unknown (sheet is AI-blocked): it
// may post one row per day taken (8h) or one row per request (e.g. 40h dated
// the first day). Spreading every usage transaction 8h-per-weekday from its
// date makes both grains produce identical weekly buckets.

// → [{ week: 'YYYY.WNN', hours: n }] chunks. Weekends are skipped (a Saturday-
// dated tx rolls forward to Monday). Guard caps runaway amounts at ~600h.
function spreadUsageHours_(dateIso, hours) {
  var out = [];
  var remaining = Number(hours) || 0;
  if (remaining <= 0) return out;
  // Parse as LOCAL date — new Date('YYYY-MM-DD') is UTC midnight and shifts a
  // day in negative-offset timezones, which would misplace week boundaries.
  var m = String(dateIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dateIso);
  if (isNaN(d)) return out;
  var guard = 0;
  while (remaining > 0 && guard < 120) {
    guard++;
    var day = d.getDay();
    if (day !== 0 && day !== 6) {
      var chunk = Math.min(CONFIG_GD.PACE_HOURS_PER_WEEK / 5, remaining);
      var wk = dateToISOWeek_(new Date(d.getTime()));
      if (wk) out.push({ week: wk, hours: chunk });
      remaining -= chunk;
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// { empNum: [{date, hours}] } → { empNum: { 'YYYY.WNN': totalHours } }
function buildPtoWeeklyByEmp_(usageTxByEmp) {
  var out = {};
  Object.keys(usageTxByEmp || {}).forEach(function(emp) {
    var weekly = {};
    usageTxByEmp[emp].forEach(function(tx) {
      spreadUsageHours_(tx.date, tx.hours).forEach(function(c) {
        weekly[c.week] = (weekly[c.week] || 0) + c.hours;
      });
    });
    out[emp] = weekly;
  });
  return out;
}

// One employee's date-sorted ledger entries → usage transactions with hour
// amounts. Explicit amount column wins; otherwise the negative balance delta
// from the previous entry (same derivation the PS project uses). Positive
// deltas on a usage row (corrections/refunds) are skipped.
function deriveUsageTx_(entries) {
  var txs = [];
  (entries || []).forEach(function(e, i) {
    if (!e.isUsage) return;
    var amount = null;
    if (e.explicitAmt !== null && isFinite(e.explicitAmt) && e.explicitAmt > 0) {
      amount = e.explicitAmt;
    } else if (i > 0 && isFinite(e.balance) && isFinite(entries[i - 1].balance)) {
      var delta = e.balance - entries[i - 1].balance;
      if (delta < 0) amount = -delta;
    }
    if (amount !== null && amount > 0) txs.push({ date: e.date, hours: amount });
  });
  return txs;
}

// Company-wide PTO usage by ISO week: { empNum: { 'YYYY.WNN': hours } }.
// NO department filter — deliberately different from the PS project's reader
// (this dashboard evaluates goals globally; departments are a UI filter).
// Any failure returns {} so pace metrics degrade to PTO-unadjusted weeks
// rather than breaking the payload build.
function readPTOWeeklyHours_() {
  try {
    var rows = readSheet_(CONFIG_GD.PTO_SS_ID, CONFIG_GD.SHEET_PTO);
    if (!rows.length) { Logger.log('⚠️ readPTOWeeklyHours_: 0 rows from "' + CONFIG_GD.SHEET_PTO + '"'); return {}; }

    var byEmp = {}, depts = {}, usageRows = 0;
    rows.forEach(function(row) {
      var empNum = normEmpNum_(row['Employee Number']);
      var date   = row['Date'] ? fmtDate_(row['Date']) : '';
      if (!empNum || date.length !== 10) return;
      var dept = String(row['Department: Name'] || '').trim();
      if (dept) depts[dept] = true;   // diagnostics only — never a filter
      var adjType = String(row['Adjustment Type'] || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      var isUsage = adjType.indexOf('usage') !== -1 || adjType.indexOf('timeoff') !== -1 ||
                    adjType.indexOf('sick') !== -1;
      if (isUsage) usageRows++;
      var amtRaw = null;
      ['Amount', 'Hours', 'AdjustmentAmount', 'AdjustmentHours'].some(function(col) {
        if (row[col] !== undefined && row[col] !== '') { amtRaw = row[col]; return true; }
        return false;
      });
      var amt = amtRaw === null ? NaN : numOrNaN_(amtRaw);
      if (!byEmp[empNum]) byEmp[empNum] = [];
      byEmp[empNum].push({
        date: date,
        balance: numOrNaN_(row['Balance']),
        isUsage: isUsage,
        explicitAmt: isFinite(amt) ? Math.abs(amt) : null,
      });
    });

    var usageByEmp = {}, txCount = 0, txHours = [];
    Object.keys(byEmp).forEach(function(emp) {
      var entries = byEmp[emp].sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var txs = deriveUsageTx_(entries);
      if (txs.length) {
        usageByEmp[emp] = txs;
        txCount += txs.length;
        txs.forEach(function(tx) { txHours.push(tx.hours); });
      }
    });

    // Grain diagnostic — the sheet is AI-blocked, so the first deploy's log is
    // how we learn what the export looks like: median tx ≈8h means one-row-per-
    // day grain, ≈40h means one-row-per-request. Spreading handles both.
    txHours.sort(function(a, b) { return a - b; });
    var medianTx = txHours.length ? txHours[Math.floor(txHours.length / 2)] : 0;
    Logger.log('✅ readPTOWeeklyHours_: ' + Object.keys(usageByEmp).length + ' employees with usage · ' +
               txCount + ' usage tx (median ' + medianTx + 'h) from ' + usageRows + ' usage rows · ' +
               Object.keys(depts).length + ' departments seen (no filter applied)');
    return buildPtoWeeklyByEmp_(usageByEmp);
  } catch (e) {
    Logger.log('⚠️ readPTOWeeklyHours_: ' + e.message + ' — pace metrics fall back to unadjusted weeks');
    return {};
  }
}

// ── Full Roster records (every employee, active AND terminated) ────
// Returns { normName → { name, normName, department, supervisor, jobTitle,
//           classVal, location, active } }
// Nobody is excluded here — interns and terminated employees are both included
// (flagged active:false when terminated) so callers can tag them — the roster is
// otherwise pure enrichment (supervisor / location / job family), never a gate
// on RD-sourced data.

// Normalizes one "Contractors Data" row to the record shape getFullRosterMap_
// returns. Crew rows carry no Job Title or hire date — consumers branch on
// isCrew (job family "Crew", never intern-stripped by roster title, never
// new-hire flagged). Unlike the Data tab (any non-blank Termination = inactive),
// crew release dates can be future-dated planned releases — only a date
// on/before todayIso deactivates. Returns null for rows without a name.
function contractorRecord_(row, todayIso) {
  var name = row['Name'] || row['Rocketeer'] || row['Employee Name'] || row['Full Name'] || '';
  if (!name) return null;
  var termRaw = row['Termination/Release Date'];
  var termIso = (termRaw !== undefined && termRaw !== null && String(termRaw).trim() !== '')
              ? fmtDate_(termRaw) : '';
  return {
    name:       String(name).trim(),
    normName:   normName_(String(name)),
    department: String(row['Department'] || '').trim(),
    supervisor: String(row['Supervisor'] || row['Manager'] || '').trim(),
    jobTitle:   '',
    classVal:   String(row['Class'] || '').trim().toUpperCase(),
    location:   String(row['Key Location'] || '').trim(),
    active:     !(termIso && termIso <= todayIso),
    hireDate:   '',
    isCrew:     true,
  };
}

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

      // HRIS exports vary in the hire-date header — same defensive fallback
      // chain as name/title above. Absent/unparseable stays '' and the
      // new-hire flag fails safe to false (isNewHire_).
      var hireRaw = row['Hire Date'] || row['Hire/Rehire Date'] || row['Original Hire Date'] ||
                    row['Most Recent Hire Date'] || row['Start Date'] || '';

      map[norm] = {
        name:       String(name).trim(),
        // PTO↔roster bridge (v2.7.0): the Accumulation Cost ledger is keyed by
        // Employee Number, not name. Defensive header chain, same pattern as
        // the hire-date read above.
        employeeNumber: normEmpNum_(row['Employee Number'] !== undefined ? row['Employee Number']
                          : (row['Employee ID'] !== undefined ? row['Employee ID'] : row['Employee #'])),
        normName:   norm,
        department: String(row['Department'] || '').trim(),
        supervisor: String(row['Supervisor'] || row['Manager'] || '').trim(),
        jobTitle:   jobTitle,
        classVal:   classVal,
        location:   String(row['Key Location'] || '').trim(),
        active:     !isInactiveByDate,
        hireDate:   hireRaw ? fmtDate_(hireRaw) : '',
        isCrew:     false,
      };
    });

    // Crew/contractors live on a second tab — merge them in so location,
    // supervisor, termination, and org-tree scoping work for crew exactly as
    // for FTEs. The Data tab wins on a normalized-name collision.
    var todayIso = new Date().toISOString().slice(0, 10);
    var crewAdded = 0, crewSkipped = 0;
    try {
      var crewRows = readSheet_(CONFIG_GD.ROSTER_SS_ID, CONFIG_GD.SHEET_CONTRACTORS);
      crewRows.forEach(function(row) {
        var rec = contractorRecord_(row, todayIso);
        if (!rec) return;
        if (map[rec.normName]) { crewSkipped++; return; }
        map[rec.normName] = rec;
        crewAdded++;
      });
    } catch (e) { Logger.log('⚠️ getFullRosterMap_ contractors: ' + e.message); }
    Logger.log('getFullRosterMap_: +' + crewAdded + ' crew from "' + CONFIG_GD.SHEET_CONTRACTORS +
               '" (' + crewSkipped + ' name collisions kept the Data-tab record)');

    var activeCount = Object.keys(map).filter(function(n) { return map[n].active; }).length;
    var hireCount   = Object.keys(map).filter(function(n) { return map[n].hireDate; }).length;
    var empNumCount = Object.keys(map).filter(function(n) { return map[n].employeeNumber; }).length;
    Logger.log('getFullRosterMap_: ' + Object.keys(map).length + ' roster rows (' +
               activeCount + ' active, ' + (Object.keys(map).length - activeCount) +
               ' inactive, ' + hireCount + ' with hire date, ' + empNumCount + ' with employee number) from ' + rows.length +
               ' "' + CONFIG_GD.SHEET_ROSTER + '" rows');
    if (Object.keys(map).length && !hireCount) {
      Logger.log('⚠️ getFullRosterMap_: no hire dates matched — check the hire-date column header on "' +
                 CONFIG_GD.SHEET_ROSTER + '" (new-hire flag stays false for everyone until fixed)');
    }
    if (Object.keys(map).length && !empNumCount) {
      Logger.log('⚠️ getFullRosterMap_: no employee numbers matched — check the Employee Number column header on "' +
                 CONFIG_GD.SHEET_ROSTER + '" (pace metrics stay PTO-unadjusted until fixed)');
    }
  } catch (e) { Logger.log('⚠️ getFullRosterMap_: ' + e.message); }
  return map;
}

// Chunked-cache wrapper around getFullRosterMap_ — the company-wide roster
// "Data" tab is re-read at most once per CACHE_TTL instead of on every
// drill/HR-notes/bulk-build call. Security model: the cached map is the raw
// UNFILTERED roster held in the script-scoped CacheService (never sent to a
// client as-is); every endpoint still applies its own access check and
// manager scoping on top of it per request, exactly as with a fresh read.
// An empty read (sheet missing/misconfigured) is never cached, so a transient
// failure can't pin "no roster" for 5 minutes.
function getFullRosterMapCached_() {
  var cache = CacheService.getScriptCache();
  var key   = CONFIG_GD.CACHE_VER + 'rostermap';
  var blob  = cacheGetChunked_(cache, key);
  if (blob) { try { return JSON.parse(blob); } catch (e) { /* fall through to fresh read */ } }

  var map = getFullRosterMap_();
  if (Object.keys(map).length) {
    try { cachePutChunked_(cache, key, JSON.stringify(map), CONFIG_GD.CACHE_TTL); }
    catch (e) { log_('roster map cache put skipped: ' + e.message); }
  }
  return map;
}

// ── Drill-down index cache (v2.3.0) ────────────────────────────
// getRocketeerGoalDetail used to re-read the entire RD sheet (one row per
// comment, company-wide, all quarters) on every row click. Instead, one RD
// read builds a per-person index of lean rows — only the 13 columns the drill
// consumes, with Date cells normalised to ISO strings — cached under one
// CacheService key per person for CACHE_TTL. Entries are UNFILTERED raw data
// in the script-scoped cache: access control stays in getRocketeerGoalDetail,
// which checks the caller's role/scope before any entry is read or returned.
// Roster people with no RD rows get an explicit [] entry so drilling into a
// zero-goal person is also a cache hit, not a full rebuild.

// Cache key for one person's drill rows. Returns null for a key that would
// exceed CacheService's 250-char limit (a >200-char name never happens in
// practice — the caller then just skips caching for that person).
function drillCacheKey_(norm) {
  var key = CONFIG_GD.CACHE_VER + 'drill_' + norm;
  return key.length <= 240 ? key : null;
}

function buildAndCacheDrillIndex_(cache, fullRosterMap) {
  var allRd = readSheet_(CONFIG_GD.GOALS_SS_ID, CONFIG_GD.SHEET_RD);
  var isoOrBlank_ = function(d) {
    if (!d) return '';
    if (d instanceof Date) return isNaN(d) ? '' : d.toISOString();
    return String(d);
  };

  var index = {};
  allRd.forEach(function(r) {
    var norm = normName_(r['Rocketeer']);
    if (!norm) return;
    if (!index[norm]) index[norm] = [];
    // Same column names as the raw sheet rows, so getRocketeerGoalDetail's
    // row-processing logic is identical on the fresh-build and cached paths.
    index[norm].push({
      'Rocketeer':      String(r['Rocketeer']      || ''),
      'Supervisor':     String(r['Supervisor']     || ''),
      'Department':     String(r['Department']     || ''),
      'Job Title':      String(r['Job Title']      || ''),
      'Goal ID':        String(r['Goal ID']        || ''),
      'Goal Name':      String(r['Goal Name']      || ''),
      'Goal Status':    String(r['Goal Status']    || ''),
      'Start Date':     isoOrBlank_(r['Start Date']),
      'Mood':           String(r['Mood']           || ''),
      'Fiscal Quarter': String(r['Fiscal Quarter'] || ''),
      'Comment Text':   String(r['Comment Text']   || ''),
      'Commentator':    String(r['Commentator']    || ''),
      'Comment Date':   isoOrBlank_(r['Comment Date']),
    });
  });
  Object.keys(fullRosterMap || {}).forEach(function(norm) {
    if (!index[norm]) index[norm] = [];
  });

  try {
    // Small entries batch into putAll calls (flushed by count/size so no call
    // gets unreasonably large); a rare oversized person chunks individually.
    var batch = {}, batchKeys = 0, batchBytes = 0;
    var flush = function() {
      if (batchKeys) cache.putAll(batch, CONFIG_GD.CACHE_TTL);
      batch = {}; batchKeys = 0; batchBytes = 0;
    };
    Object.keys(index).forEach(function(norm) {
      var key = drillCacheKey_(norm);
      if (!key) return;
      var blob = JSON.stringify(index[norm]);
      if (blob.length > CONFIG_GD.CACHE_CHUNK_SIZE) {
        cachePutChunked_(cache, key, blob, CONFIG_GD.CACHE_TTL);
        return;
      }
      batch[key] = blob; batchKeys++; batchBytes += blob.length;
      if (batchKeys >= 100 || batchBytes >= 800000) flush();
    });
    flush();
    // Manifest of every norm written, so bustCache can enumerate and remove
    // the per-person keys (CacheService itself can't list keys).
    cachePutChunked_(cache, CONFIG_GD.CACHE_VER + 'drillnames',
                     JSON.stringify(Object.keys(index)), CONFIG_GD.CACHE_TTL);
    log_('buildAndCacheDrillIndex_: cached drill rows for ' + Object.keys(index).length + ' people');
  } catch (e) { log_('drill index cache put skipped: ' + e.message); }

  return index;
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

function _test_computeRpiScore_() {
  var t = function(cond, msg) { if (!cond) throw new Error('rpiScore: ' + msg); };
  var qd = { start: '2026-04-01', end: '2026-06-30' };
  var goal = function(status, self, start) {
    return { id: 'g', name: 'g', status: status, start: start || '2026-05-01', self: self, mgr: 0, total: self };
  };
  var mk = function(goals, completed) { return { goalsList: goals, goalsCompleted: completed }; };

  // Perfect 6: 10 approved in-quarter goals, 6 with enough self-comments, 8 completed
  var goals10 = [];
  for (var i = 0; i < 10; i++) goals10.push(goal(i < 8 ? 'Completed' : 'In Progress', i < 6 ? 5 : 0));
  var r = computeRpiScore_(mk(goals10, 8), qd, 9);  // week 9 → required = max(1, 9−6) = 3
  t(r.score === 6 && r.max === 6, 'perfect case should score 6/6, got ' + r.score);

  // C1 is status-blind: goals approved then Canceled / Not Completed / still
  // Planned all count toward the 10 — only the dates gate the criterion
  var mixed = goals10.slice(0, 7).concat([goal('Canceled', 5), goal('Not Completed', 5), goal('Planned', 5)]);
  r = computeRpiScore_(mk(mixed, 8), qd, 9);
  t(r.breakdown.goals.met, 'canceled/not-completed/planned goals must still count toward the 10');

  // C1 fails on wrong dates: goal dated outside the quarter
  var badDate = goals10.slice(0, 9).concat([goal('Completed', 0, '2026-07-15')]);
  r = computeRpiScore_(mk(badDate, 8), qd, 9);
  t(!r.breakdown.goals.met, 'out-of-quarter start date must not count');

  // C2 requirement floors at 1 early in the quarter (weeks ≤ 5)
  var oneCmt = [];
  for (var j = 0; j < 10; j++) oneCmt.push(goal('In Progress', j < 6 ? 1 : 0));
  r = computeRpiScore_(mk(oneCmt, 0), qd, 3);   // week 3 → required = max(1, -3) = 1
  t(r.breakdown.cadence.met && r.breakdown.cadence.requiredCmts === 1, 'early-quarter cadence floor should be 1');
  r = computeRpiScore_(mk(oneCmt, 0), qd, 9);   // week 9 → required = 3; only 1 comment each
  t(!r.breakdown.cadence.met && r.breakdown.cadence.requiredCmts === 3, 'week-9 cadence should require 3 comments');

  // C2 requirement caps at 8 per quarter (flex for PTO/sick/delays; aligns with STF)
  var eightCmts = [];
  for (var m = 0; m < 10; m++) eightCmts.push(goal('In Progress', m < 6 ? 8 : 0));
  r = computeRpiScore_(mk(eightCmts, 0), qd, 14);  // week 14 → min(14−6, 8) = 8
  t(r.breakdown.cadence.met && r.breakdown.cadence.requiredCmts === 8, 'week-14 requirement should cap at 8');
  r = computeRpiScore_(mk(eightCmts, 0), qd, 20);  // pathological long quarter — cap must hold
  t(r.breakdown.cadence.requiredCmts === 8, 'requirement must never exceed 8');

  // C2: canceled goals never satisfy cadence
  var canceled6 = [];
  for (var k = 0; k < 6; k++) canceled6.push(goal('Canceled', 9));
  r = computeRpiScore_(mk(canceled6, 0), qd, 9);
  t(!r.breakdown.cadence.met, 'canceled goals must not satisfy cadence');

  // C3 boundary: 8 completed met, 7 not
  r = computeRpiScore_(mk(goals10, 7), qd, 9);
  t(!r.breakdown.completed.met, '7 completed must fail C3');

  // Zero-goal employee: score 0, nothing throws
  r = computeRpiScore_(mk([], 0), qd, 9);
  t(r.score === 0, 'zero goals should score 0');

  Logger.log('✅ _test_computeRpiScore_ passed');
}

function _test_isNewHire_() {
  var t = function(cond, msg) { if (!cond) throw new Error('isNewHire: ' + msg); };
  t(isNewHire_('2026-05-15', '2026-04-01') === true,  'mid-quarter hire should be new');
  t(isNewHire_('2026-04-01', '2026-04-01') === true,  'quarter-day-one hire should be new');
  t(isNewHire_('2026-03-31', '2026-04-01') === false, 'pre-quarter hire should not be new');
  t(isNewHire_('',           '2026-04-01') === false, 'missing hire date must fail safe');
  t(isNewHire_('N/A',        '2026-04-01') === false, 'garbage hire date must fail safe');
  t(isNewHire_('2026-05-15', null)         === false, 'missing quarter window must fail safe');
  t(isNewHire_(new Date(2026, 4, 15), '2026-04-01') === true, 'Date-object hire cell should parse');
  Logger.log('✅ _test_isNewHire_ passed');
}

function _test_feedbackLoop_() {
  var t = function(cond, msg) { if (!cond) throw new Error('❌ _test_feedbackLoop_: ' + msg); };
  // Rows deliberately OUT of date order — the sheet gives no ordering guarantee.
  var row_ = function(goalId, status, commentator, date) {
    return {
      'Rocketeer': 'Ana Reyes', 'Supervisor': 'Max Boss', 'Department': 'Services',
      'Class': 'FTE', 'Job Title': 'Consultant', 'Fiscal Quarter': 'FY27Q1',
      'Goal ID': goalId, 'Goal Name': 'G' + goalId, 'Goal Status': status,
      'Start Date': '2026-07-02', 'Mood': '',
      'Comment Text': commentator ? 'note' : '', 'Commentator': commentator || '',
      'Comment Date': date || '',
    };
  };
  var rows = [
    // g1: reply row appears BEFORE the manager row → still closed
    row_('g1', 'In Progress', 'Ana Reyes', '2026-07-10'),
    row_('g1', 'In Progress', 'Max Boss',  '2026-07-08'),
    // g2: same-day reply counts as closed
    row_('g2', 'In Progress', 'Max Boss',  '2026-07-09'),
    row_('g2', 'In Progress', 'Ana Reyes', '2026-07-09'),
    // g3: self-comment only BEFORE the manager comment → open loop
    row_('g3', 'In Progress', 'Ana Reyes', '2026-07-05'),
    row_('g3', 'In Progress', 'Max Boss',  '2026-07-07'),
    // g4: UNDATED manager comment → excluded from the feedback denominator
    row_('g4', 'In Progress', 'Max Boss',  ''),
    // g5: no manager comments at all → not in denominator
    row_('g5', 'In Progress', 'Ana Reyes', '2026-07-06'),
    // g6: Canceled with zero comments → closed-no-note
    row_('g6', 'Canceled', ''),
    // g7: Not Completed WITH a note → NOT closed-no-note
    row_('g7', 'Not Completed', 'Ana Reyes', '2026-07-11'),
  ];
  var emp = aggregateByRocketeer_(rows, null, 'FY27Q1')[normName_('Ana Reyes')];
  t(emp.goalsWithMgrFeedback === 3, 'g1,g2,g3 have dated mgr feedback, got ' + emp.goalsWithMgrFeedback);
  t(emp.goalsFeedbackClosed === 2,  'g1 (out-of-order) + g2 (same-day) closed, got ' + emp.goalsFeedbackClosed);
  t(emp.goalsClosedNoNote === 1,    'only g6 is closed-no-note, got ' + emp.goalsClosedNoNote);
  Logger.log('✅ _test_feedbackLoop_ passed');
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

function _test_computeQuarterFlags_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_computeQuarterFlags_: " + msg); }
  var qd = parseQuarterDates_('FY26Q4');  // ~2026-04-01 → 2026-06-30

  var f = computeQuarterFlags_(qd, '2026-07-08');
  assert_(f.quarterState === 'closed', "after end → closed, got " + f.quarterState);
  assert_(!f.isCompletionGrace, "closed quarter must not report completion grace (the historical bug)");
  assert_(!f.isGoalCreationGrace, "closed quarter must not report goal grace");

  f = computeQuarterFlags_(qd, '2026-06-25');
  assert_(f.quarterState === 'active' && f.isCompletionGrace, "final 2 weeks → active + completion grace");

  f = computeQuarterFlags_(qd, '2026-04-10');
  assert_(f.quarterState === 'active' && f.isGoalCreationGrace, "first 4 weeks → active + goal grace");
  assert_(!f.isCompletionGrace, "early quarter is not completion grace");

  f = computeQuarterFlags_(qd, '2026-05-20');
  assert_(f.quarterState === 'active' && !f.isGoalCreationGrace && !f.isCompletionGrace,
          "mid-quarter → active, no grace");

  f = computeQuarterFlags_(qd, '2026-03-15');
  assert_(f.quarterState === 'upcoming' && !f.isGoalCreationGrace && !f.isCompletionGrace,
          "before start → upcoming, no flags");

  f = computeQuarterFlags_(null, '2026-07-08');
  assert_(f.quarterState === null && !f.isGoalCreationGrace && !f.isCompletionGrace,
          "unparseable quarter → null state, no flags");

  Logger.log("✅ _test_computeQuarterFlags_ passed");
}

function _test_quarterCalendarWeeks_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_quarterCalendarWeeks_: " + msg); }

  // Every fiscal quarter must span 13–14 ISO weeks — never the 20+ the old
  // distinct-comment-week count produced for closed quarters.
  ['FY26Q1', 'FY26Q2', 'FY26Q3', 'FY26Q4'].forEach(function(q) {
    var n = quarterWeekList_(q, false).length;
    assert_(n >= 13 && n <= 14, q + " spans 13–14 calendar weeks, got " + n);
  });

  // Unparseable labels have no calendar window — callers fall back to the
  // data-driven count (asserted here as the empty-list contract).
  assert_(quarterWeekList_('garbage', false).length === 0, "unparseable quarter → empty list");

  Logger.log("✅ _test_quarterCalendarWeeks_ passed");
}

function _test_contractorRecord_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_contractorRecord_: " + msg); }
  var today = '2026-07-08';

  var r = contractorRecord_({ 'Name': 'Sofia Mardones Bustamante', 'Department': 'Services',
    'Class': 'tc', 'Supervisor': 'Jane Doe', 'Key Location': 'Chile',
    'Termination/Release Date': '' }, today);
  assert_(r.isCrew === true, "crew flag set");
  assert_(r.normName === 'sofia mardones bustamante', "normName derived");
  assert_(r.location === 'Chile', "Key Location mapped, got " + r.location);
  assert_(r.classVal === 'TC', "class uppercased");
  assert_(r.active === true, "blank release date → active");
  assert_(r.jobTitle === '' && r.hireDate === '', "crew rows carry no title/hire date");

  r = contractorRecord_({ 'Name': 'Past Release', 'Termination/Release Date': '2026-06-30' }, today);
  assert_(r.active === false, "past release date → inactive");

  r = contractorRecord_({ 'Name': 'Future Release', 'Termination/Release Date': '2026-12-31' }, today);
  assert_(r.active === true, "future-dated planned release stays active until the date");

  assert_(contractorRecord_({ 'Department': 'X' }, today) === null, "nameless row → null");

  Logger.log("✅ _test_contractorRecord_ passed");
}

// ── CPR pace tests (v2.7.0) ────────────────────────────────────
function _test_percentile_() {
  var t = function(cond, msg) { if (!cond) throw new Error('percentile: ' + msg); };
  t(percentile_([], 50) === null, 'empty → null');
  t(percentile_([7], 10) === 7, 'single value');
  t(percentile_([1, 2, 3, 4, 5], 50) === 3, 'odd-count median');
  t(median_([1, 2, 3, 4]) === 2.5, 'even-count median interpolates');
  t(percentile_([10, 20], 25) === 12.5, 'linear interpolation');
  t(percentile_([5, 1, 3], 100) === 5, 'unsorted input handled, P100 = max');
  t(percentile_([5, 1, 3], 0) === 1, 'P0 = min');
  Logger.log('✅ _test_percentile_: all assertions passed');
}

function _test_normEmpNum_() {
  var t = function(cond, msg) { if (!cond) throw new Error('normEmpNum: ' + msg); };
  t(normEmpNum_(1042) === '1042', 'number → string');
  t(normEmpNum_(1042.0) === '1042', 'float-typed sheet number');
  t(normEmpNum_(' 1,042 ') === '1042', 'comma + whitespace stripped');
  t(normEmpNum_('') === '' && normEmpNum_(null) === '' && normEmpNum_(undefined) === '', 'empty-ish → ""');
  Logger.log('✅ _test_normEmpNum_: all assertions passed');
}

function _test_ptoSpread_() {
  var t = function(cond, msg) { if (!cond) throw new Error('ptoSpread: ' + msg); };
  var monday = '2026-04-06';  // a Monday
  // 40h lump dated Monday spreads 8h × Mon–Fri, all in ONE ISO week —
  // this is what makes the reader grain-agnostic (per-request exports).
  var s = spreadUsageHours_(monday, 40);
  t(s.length === 5, '40h Monday → 5 chunks, got ' + s.length);
  t(s.every(function(c) { return c.hours === 8; }), 'all chunks 8h');
  var wkMon = dateToISOWeek_(new Date(2026, 3, 6));  // local-safe Date (string parse is UTC and can shift a day)
  t(s.every(function(c) { return c.week === wkMon; }), 'all chunks in ' + wkMon);
  // 16h dated Friday crosses the ISO week boundary: 8h Fri + 8h next Monday
  var s2 = spreadUsageHours_('2026-04-10', 16);
  t(s2.length === 2, '16h Friday → 2 chunks, got ' + s2.length);
  t(s2[0].week === dateToISOWeek_(new Date(2026, 3, 10)), 'first chunk stays on Friday week');
  t(s2[1].week === dateToISOWeek_(new Date(2026, 3, 13)), 'second chunk lands the following Monday week');
  // 8h single day = per-day-grain export → no-op spreading
  var s3 = spreadUsageHours_('2026-04-07', 8);
  t(s3.length === 1 && s3[0].hours === 8, '8h single-day chunk');
  // weekend-dated tx rolls forward to Monday
  var s4 = spreadUsageHours_('2026-04-11', 8);  // Saturday
  t(s4.length === 1 && s4[0].week === dateToISOWeek_(new Date(2026, 3, 13)), 'weekend date rolls to Monday');
  t(spreadUsageHours_(monday, 0).length === 0 && spreadUsageHours_(monday, -4).length === 0, 'non-positive hours → []');
  var s5 = spreadUsageHours_(monday, 12);
  t(s5.length === 2 && s5[1].hours === 4, '12h → 8h + 4h');

  // bucketing merges chunks per employee per ISO week
  var weekly = buildPtoWeeklyByEmp_({ '1042': [{ date: monday, hours: 12 }, { date: '2026-04-07', hours: 8 }] });
  t(weekly['1042'][wkMon] === 20, 'merged weekly hours = 20, got ' + JSON.stringify(weekly));

  // usage derivation: explicit amount wins; else negative balance delta; accruals/positive deltas skipped
  var tx = deriveUsageTx_([
    { date: '2026-04-01', balance: 100, isUsage: false, explicitAmt: null },
    { date: '2026-04-06', balance: 92,  isUsage: true,  explicitAmt: 8 },
    { date: '2026-04-07', balance: 76,  isUsage: true,  explicitAmt: null },
    { date: '2026-04-08', balance: 80,  isUsage: true,  explicitAmt: null },
  ]);
  t(tx.length === 2 && tx[0].hours === 8 && tx[1].hours === 16, 'usage derivation, got ' + JSON.stringify(tx));
  Logger.log('✅ _test_ptoSpread_: all assertions passed');
}

function _test_computePaceMetrics_() {
  var t = function(cond, msg) { if (!cond) throw new Error('paceMetrics: ' + msg); };
  var calWeeks = ['2026.W15','2026.W16','2026.W17','2026.W18','2026.W19','2026.W20','2026.W21',
                  '2026.W22','2026.W23','2026.W24','2026.W25','2026.W26','2026.W27','2026.W28'];
  var mk = function(selfCounts, cmtWeeks) {
    return {
      goalsList: selfCounts.map(function(s, i) { return { id: 'g' + i, status: 'In Progress', self: s }; }),
      commentWeekList: cmtWeeks,
    };
  };
  // A — steady on-pace: eligible 5, CPR 0.9, AR 1.0
  var a = computePaceMetrics_(mk([5,4,5,3,5,4], ['2026.W19','2026.W20','2026.W21','2026.W22','2026.W23']), 9, null, calWeeks);
  t(a.eligibleWeeks === 5, 'A eligible 5, got ' + a.eligibleWeeks);
  t(a.cpr === 0.9, 'A CPR 0.9, got ' + a.cpr);
  t(a.activityRatio === 1, 'A AR 1.0, got ' + a.activityRatio);
  // B — one comment per goal, all posted the same week: CPR 0.2, AR 0.2
  var b = computePaceMetrics_(mk([1,1,1,1,1,1], ['2026.W20']), 9, null, calWeeks);
  t(b.cpr === 0.2, 'B CPR 0.2, got ' + b.cpr);
  t(b.activityRatio === 0.2, 'B AR 0.2, got ' + b.activityRatio);
  // C — two full PTO weeks inside the window: eligible 3, CPR 1.0, AR 1.0
  var pto = {}; pto['2026.W19'] = 40; pto['2026.W20'] = 40;
  var c = computePaceMetrics_(mk([3,3,3,2,3,3], ['2026.W21','2026.W22','2026.W23']), 9, pto, calWeeks);
  t(c.absenceWeeks === 2, 'C absence 2, got ' + c.absenceWeeks);
  t(c.eligibleWeeks === 3, 'C eligible 3, got ' + c.eligibleWeeks);
  t(c.cpr === 1, 'C CPR 1.0, got ' + c.cpr);
  t(c.activityRatio === 1, 'C AR 1.0, got ' + c.activityRatio);
  // top-6 selection: zero-comment stragglers beyond the best 6 must not drag the median
  var d = computePaceMetrics_(mk([5,5,5,5,5,5,0,0,0,0], ['2026.W19','2026.W20','2026.W21','2026.W22','2026.W23']), 9, null, calWeeks);
  t(d.cpr === 1, 'top-6 by CPR ignores stragglers, got ' + d.cpr);
  // PTO hours cap at 40/week (bad data can't make absence exceed the week)
  var over = {}; over['2026.W19'] = 90;
  var o = computePaceMetrics_(mk([1,1,1,1,1,1], []), 9, over, calWeeks);
  t(o.absenceWeeks === 1, 'weekly absence caps at 1.0, got ' + o.absenceWeeks);
  // early quarter (week ≤ lag) → null metrics, cls stays na
  var e = computePaceMetrics_(mk([1,1,1,1,1,1], []), 3, null, calWeeks);
  t(e.eligibleWeeks === 0 && e.cpr === null && e.activityRatio === null && e.cls === 'na', 'week 3 → no eligible weeks');
  // canceled-only goal set → null CPR
  var f = computePaceMetrics_({ goalsList: [{ id: 'g0', status: 'Canceled', self: 9 }], commentWeekList: [] }, 9, null, calWeeks);
  t(f.cpr === null, 'canceled-only → null CPR');
  // fully absent the whole window → null
  var allPto = {}; calWeeks.forEach(function(w) { allPto[w] = 40; });
  var g = computePaceMetrics_(mk([2,2,2,2,2,2], []), 9, allPto, calWeeks);
  t(g.cpr === null, 'fully absent → null CPR');
  // fractional eligible < 1 uses divisor 1 (matches CPR spec: max(1, EligibleWeeks))
  var frac = {}; frac['2026.W19'] = 40; frac['2026.W20'] = 40; frac['2026.W21'] = 40; frac['2026.W22'] = 20;
  var h = computePaceMetrics_(mk([2,2,2,2,2,2], ['2026.W23']), 9, frac, calWeeks);
  t(h.eligibleWeeks === 1.5 && h.cpr === 1.33, 'fractional eligible: 2/1.5 → 1.33, got ' + JSON.stringify(h));
  Logger.log('✅ _test_computePaceMetrics_: all assertions passed');
}

// TEMPORARY (remove after the week-cap verification) — snapshot per-person RPI
// so the calendar-week correction's score shifts can be eyeballed against the
// pre-change snapshot. Run once BEFORE deploying Task 2, once after.
function _audit_rpiSnapshot_() {
  var d = getGoalsComplianceData(CONFIG_GD.DEFAULT_QUARTER);
  var lines = (d.employees || []).map(function(e) {
    return e.name + ' | RPI ' + e.rpiScore + '/' + e.rpiMax + ' | cmtsWks ' + e.commentWeeks + '/' + d.totalQtrWeeks;
  }).sort();
  Logger.log('RPI snapshot (' + d.quarter + ', weeks=' + d.totalQtrWeeks + '):\n' + lines.join('\n'));
}
