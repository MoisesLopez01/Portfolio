// ============================================================
// SCRIPT NAME: Project Demand — Week over Week (C-Suite Dashboard)
// PURPOSE:     Standalone Google Apps Script web app. Reads LIVE
//              planned-time data from the "Planned Time Tempo" tab
//              (by spreadsheet ID), cross-reads the Roster for an
//              available-capacity denominator, and serves Dashboard.html.
// ENVIRONMENT: Google Apps Script (separate project from PS report)
// DATA SOURCE: Planned Time Tempo tab + Roster sheet, both by ID.
// ACCESS:      Email allowlist — see Security.js (checkDemandAccess()).
// ============================================================

var CONFIG = {
  SOURCE_SS_ID:        "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw",
  SHEET_NAME:          "Planned Time Tempo",
  NONPROJECT_KEYS:     ["NETSUITE"],   // excluded (time-off synced from NetSuite); case-insensitive
  EXCLUDED_NAMES:      [],             // display names excluded from grid/charts (still populate filter dropdowns)
  WEEKS_PAST:          4,
  WEEKS_FUTURE:        3,               // window = 4 past + current + 3 future = 8 weeks
  WEEKLY_CAPACITY_HRS: 40,              // available hours per active person per week (default region)
  ANZ_LOCATION:        "Australia & New Zealand", // Roster "Key Location" value → 38 hr week
  ANZ_CAPACITY_HRS:    38,              // weekly base capacity for ANZ people
  PLAN_TARGET:         0.90,            // 90% planning-target reference line on the chart
  TITLE:               "Project Demand — Week over Week",

  // ── Capacity denominator: active Services base hours (38 ANZ / 40 else), minus PTO/holidays ──
  ROSTER_SS_ID:        "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  ROSTER_SHEET:        "Roster",
  ROSTER_CLASS:        "Professional Services",
  ROSTER_DEPT:         "Services",

  // ── Signal thresholds (CONFIG-tunable; planned hours read conservatively) ──
  UTIL_TIGHT:          0.85,   // demand/capacity ≥ TIGHT and < OVER → "Tight"
  UTIL_OVER:           1.00,   // demand/capacity ≥ OVER            → "Over" (< TIGHT → "Headroom")

  // ── Drill-down / proxy tuning ──
  FRAG_MIN:            4,       // people on ≥ FRAG_MIN distinct projects are "fragmented"
  TOPN_STRATEGIC:      10,      // top-N projects by in-window hours treated as "strategic" (proxy)
  TRACKED_SHEET_NAME:   "Tempo Tracked Time",
  DELIVERY_GAP_MIN_HRS: 4,    // min planned hrs before person is flagged for gap
  SWARM_THRESHOLD:      0.20, // tracked/planned < 20% → "planned but not tracked"
  Q4_BASE_WEEK: 14,   // ISO week number of Q4 start (update each quarter)
  Q4_BASE_YEAR: 2026, // Calendar year of Q4 start
};

// ── ENTRY POINT ──────────────────────────────────────────────

/**
 * Serves the dashboard HTML, gated by the email allowlist (Security.js).
 * Denied users get a minimal "access restricted" page instead.
 */
function doGet() {
  var access = checkDemandAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle(CONFIG.TITLE + " — Access Restricted");
  }
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle(CONFIG.TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ── ISO WEEK HELPERS (Monday-start, ISO-8601) ────────────────

function isoWeekNum_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

function isoWeekYear_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function weeksInYear_(year) {
  return isoWeekNum_(new Date(Date.UTC(year, 11, 28)));
}

/**
 * Builds the rolling window anchored on the current ISO week.
 * @returns {Array<{iso:string, wk:number, year:number, status:string}>}
 *          status ∈ {"done"(past), "now"(current), "plan"(future)}
 */
function buildWindow_() {
  var today = new Date();
  var curW = isoWeekNum_(today), curY = isoWeekYear_(today);
  var weeks = [];
  for (var off = -CONFIG.WEEKS_PAST; off <= CONFIG.WEEKS_FUTURE; off++) {
    var w = curW + off, y = curY;
    if (w <= 0)                      { y--; w = weeksInYear_(y) + w; }
    else if (w > weeksInYear_(y))    { w -= weeksInYear_(y); y++; }
    var status = off < 0 ? "done" : (off === 0 ? "now" : "plan");
    weeks.push({ iso: y + ".W" + w, wk: w, year: y, status: status });
  }
  return weeks;
}

/**
 * ISO label of the week immediately before the given week — used as a hidden
 * baseline so the first DISPLAYED week still has a prior week for week-over-week
 * comparisons (heatmap Change/Risk).
 * @param {{wk:number, year:number}} week
 * @returns {string} e.g. "2026.W21"
 */
function priorWeekIso_(week) {
  var w = week.wk - 1, y = week.year;
  if (w <= 0) { y--; w = weeksInYear_(y) + w; }
  return y + ".W" + w;
}

/** Canonicalizes a week label cell ("2026.W14" or legacy "W14") → "2026.W14". */
function weekToKey_(label, defYear) {
  var s = String(label == null ? "" : label).trim();
  var full = s.match(/^(\d{4})\.?W(\d+)$/i);
  if (full)  return full[1] + ".W" + parseInt(full[2], 10);
  var short = s.match(/^W(\d+)$/i);
  if (short) return defYear + ".W" + parseInt(short[1], 10);
  return null;
}

// ── MAIN DATA ENDPOINT (called from the client via google.script.run) ──

/**
 * Reads the Planned Time Tempo sheet and the Roster, returning the aggregated
 * demand model for the current 8-week window. All demand figures are PLANNED HOURS.
 * Access is re-checked server-side (defense in depth — the page is already gated).
 * @returns {Object} model (see aggregate_); model.error is set on failure.
 */
function getDemandData() {
  var access = checkDemandAccess();
  if (!access.allowed) {
    var denied = emptyModel_(buildWindow_());
    denied.error = "Access restricted to authorized users.";
    return denied;
  }

  var weeks = buildWindow_();
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sh) {
      var m = emptyModel_(weeks);
      m.error = "Sheet '" + CONFIG.SHEET_NAME + "' not found in source spreadsheet.";
      return m;
    }
    var vals = sh.getDataRange().getValues();
    var parsed = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
    var baselineIso = priorWeekIso_(weeks[0]);    // hidden lookback week → first week gets a WoW prior
    var model = aggregate_(parsed.recs, weeks, baselineIso);
    model.timeOffByWeek = parsed.timeOffByWeek;   // PTO + public holidays (NETSUITE rows), per week

    // ── Single roster read — shared by capacity + people signals ─────────────
    var roster = readRosterFull_();
    attachCapacity_(model, roster);   // net capacity (roster base − time-off, planned fallback)

    // ── Tracked time + delivery signals ──────────────────────
    var trackedResult = readTrackedAllocations_();
    if (!trackedResult.error) {
      var tm = aggregate_(trackedResult.recs, weeks, baselineIso);
      model.weekTracked = tm.weekTotal;
      model.tracked     = tm.cap;
      model.fidelity    = {};
      model.isoList.forEach(function(iso) {
        var pl = model.weekTotal[iso] || 0;
        model.fidelity[iso] = pl > 0 ? (tm.weekTotal[iso] || 0) / pl : null;
      });
      model.rosterDimensions   = roster.dimensions;
      model.displayNames       = buildDisplayNames_(parsed.recs, trackedResult.recs);
      model.trackedLastExport  = trackedResult.lastExport || null;
    } else {
      model.trackedError = trackedResult.error;
    }
    if (!trackedResult.error && (!trackedResult.recs || trackedResult.recs.length === 0)) {
      model.trackedWarning = "Tracked sheet found but 0 records parsed — verify the sheet has a 'Key' column and ISO week headers (e.g. 2026.W26).";
    }
    var normLocal = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
    model.excludedNames = (CONFIG.EXCLUDED_NAMES || []).map(normLocal);

    // ── Person availability (planned + tracked per person per week) ──
    var plannedPtoRecs = parsed.ptoRecs || [];
    var trackedPtoRecs = (!trackedResult.error && trackedResult.ptoRecs) ? trackedResult.ptoRecs : [];
    var allPtoRecs = (plannedPtoRecs || []).concat(trackedPtoRecs || []);
    var availResult = buildPersonAvailability_(
      parsed.recs,
      (!trackedResult.error && trackedResult.recs) ? trackedResult.recs : [],
      allPtoRecs,
      roster.profiles
    );
    model.personWeekPlan    = availResult.personWeekPlan;
    model.personWeekTracked = availResult.personWeekTracked;
    model.personProjectPlan = availResult.personProjectPlan;
    model.personMeta        = availResult.personMeta;
    model.personWeekPTO     = availResult.personWeekPTO;
    model.behaviorSignals = buildPersonBehaviorSignals_(
      model.personWeekPlan,
      model.personWeekTracked,
      model.personProjectPlan,
      model.personMeta,
      weeks
    );
    model.anzLocation = CONFIG.ANZ_LOCATION || '';

    return model;
  } catch (e) {
    var err = emptyModel_(weeks);
    err.error = "Failed to read source data: " + e.message;
    return err;
  }
}

// ── CAPACITY (roster base hours 38 ANZ / 40 else, minus PTO/holidays; planned fallback) ──

/**
 * Reads active PS / Services people from the Roster sheet and sums their weekly
 * BASE capacity — the same active filter family as the PS report's readPSRoster_(),
 * but ramp-up and crew are INCLUDED (they appear in the Tempo plan and consume
 * capacity). People whose "Key Location" is CONFIG.ANZ_LOCATION are credited
 * CONFIG.ANZ_CAPACITY_HRS (38); everyone else CONFIG.WEEKLY_CAPACITY_HRS (40).
 * @returns {{ ok:boolean, headcount:number, baseCapacity:number, anzCount:number, error?:string }}
 */
/**
 * Reads the Roster sheet once and returns both capacity data (for the capacity
 * denominator) and people profiles (for signal filters).  Replaces the two
 * separate readActiveCapacity_() + readRosterProfiles_() calls so the sheet is
 * only fetched once per getDemandData() execution.
 *
 * Capacity counts: active Services FTE/crew with a valid Name, Class = Professional
 * Services, Dept = Services, no inactive/termination markers.
 * Profile data: every named row (no class/dept filter) so Roster can match tracked
 * time from non-Services people as well.
 */
function readRosterFull_() {
  var EMPTY_CAP = { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0, capError: null };
  var EMPTY_PROF = { profiles: {}, dimensions: { locations: [], jobFamilies: [], managers: [] } };
  try {
    var ss = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
    var sh = ss.getSheetByName(CONFIG.ROSTER_SHEET);
    if (!sh) return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: "Roster sheet not found." });
    var last = sh.getLastRow();
    if (last < 2) return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: "Roster is empty." });

    var raw  = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
    var hdrs = raw[0].map(function (h) { return String(h).trim(); });
    var col  = function (name) { return hdrs.findIndex(function (h) { return h.toLowerCase() === name.toLowerCase(); }); };

    var iName   = col("Name"),      iClass  = col("Class"),     iDept   = col("Department");
    var iStatus = col("Employee Status"), iTerm = col("Termination/Release Date");
    var iLoc    = col("Key Location"), iFam = col("Job Family"), iTitle = col("Job Title");
    var iMgr    = (col("Supervisor") !== -1) ? col("Supervisor") : col("Manager");
    if (iName === -1) return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: "Roster 'Name' column not found." });

    var norm       = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
    var anzLoc     = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();
    var INACTIVE   = /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i;
    var profiles   = {}, locs = {}, families = {}, managers = {};
    var count = 0, base = 0, anz = 0;

    for (var r = 1; r < raw.length; r++) {
      var row  = raw[r];
      var name = String(row[iName] || "").trim();
      if (!name) continue;

      var loc   = iLoc   !== -1 ? String(row[iLoc]   || "").trim() : "";
      var fam   = iFam   !== -1 ? String(row[iFam]   || "").trim() : "";
      var mgr   = iMgr   !== -1 ? String(row[iMgr]   || "").trim() : "";
      var title = iTitle !== -1 ? String(row[iTitle] || "").trim() : "";
      var isCrew = /crew member|contractor/i.test(title);
      var lvlM   = title.match(/^\d{2,3}\.([A-Z]\d+)\./);
      profiles[norm(name)] = { location: loc, jobFamily: fam, manager: mgr, isManager: !!(lvlM && lvlM[1].charAt(0) === 'M'), isCrew: isCrew };
      if (loc) locs[loc] = true;
      if (fam) families[fam] = true;
      if (mgr) managers[mgr] = true;

      // Capacity: only active Services members
      if (iClass !== -1 && String(row[iClass] || "").trim() !== CONFIG.ROSTER_CLASS) continue;
      if (iDept  !== -1) { var dept = String(row[iDept] || "").trim(); if (dept && dept !== CONFIG.ROSTER_DEPT) continue; }
      var status = iStatus !== -1 ? String(row[iStatus] || "").trim() : "";
      var term   = iTerm   !== -1 ? String(row[iTerm]   || "").trim() : "";
      if (INACTIVE.test(status) || term) continue;

      var isANZ = loc.toLowerCase() === anzLoc;
      base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
      if (isANZ) anz++;
      count++;
    }

    return {
      ok: true, headcount: count, baseCapacity: base, anzCount: anz, capError: null,
      profiles: profiles,
      dimensions: { locations: Object.keys(locs).sort(), jobFamilies: Object.keys(families).sort(), managers: Object.keys(managers).sort() }
    };
  } catch (e) {
    return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: e.message });
  }
}

/**
 * Attaches capacity fields to the model in place. Capacity is NET of PTO and
 * public holidays (the NETSUITE time-off rows, summed per week in model.timeOffByWeek).
 *  - roster mode:  gross = baseCapacity (38 ANZ / 40 else, constant across the window);
 *                  capByWeek[iso] = max(0, gross − timeOff[iso]).
 *  - planned mode: fallback when the roster can't be read — gross =
 *                  activePeople[iso] × WEEKLY_CAPACITY_HRS; capByWeek[iso] = max(0, gross − timeOff[iso]).
 * @param {Object} model
 */
function attachCapacity_(model, rosterFull) {
  var cap = CONFIG.WEEKLY_CAPACITY_HRS;
  var hc  = rosterFull || { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0 };
  var timeOff = model.timeOffByWeek || {};
  model.capByWeek = {};
  model.grossCapByWeek = {};
  if (hc.ok && hc.headcount > 0) {
    model.capacityMode = "roster";
    model.headcount    = hc.headcount;
    model.anzCount     = hc.anzCount;
    model.baseCapacity = hc.baseCapacity;
    model.isoList.forEach(function (iso) {
      model.grossCapByWeek[iso] = hc.baseCapacity;
      model.capByWeek[iso] = Math.max(0, hc.baseCapacity - (timeOff[iso] || 0));
    });
  } else {
    model.capacityMode = "planned";
    model.headcount    = null;
    model.anzCount     = 0;
    model.capacityNote = hc.capError || "Roster unavailable.";
    model.isoList.forEach(function (iso) {
      var gross = (model.activePeople[iso] || 0) * cap;
      model.grossCapByWeek[iso] = gross;
      model.capByWeek[iso] = Math.max(0, gross - (timeOff[iso] || 0));
    });
  }
}

// ── TRACKED TIME + DELIVERY SIGNALS ──────────────────────

function readTrackedAllocations_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.TRACKED_SHEET_NAME);
    if (!sh) return { recs: [], ptoRecs: [], error: "Sheet '" + CONFIG.TRACKED_SHEET_NAME + "' not found." };
    var vals = sh.getDataRange().getValues();
    var parsed = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
    var lastExport = null;
    for (var r = vals.length - 1; r >= 0; r--) {
      if (String(vals[r][0]).trim() === "Last Export:") {
        lastExport = String(vals[r][1] || "").trim() || null;
        break;
      }
    }
    return { recs: parsed.recs, ptoRecs: parsed.ptoRecs, lastExport: lastExport };
  } catch (e) {
    return { recs: [], ptoRecs: [], error: e.message };
  }
}


function buildDisplayNames_(recs1, recs2) {
  var names = {};
  var norm = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  (recs1 || []).concat(recs2 || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!names[np]) names[np] = rec.person;
  });
  return names;
}

/**
 * Derives the 4-state behavior label for a single person × week.
 * Returns null when neither planned nor tracked meets the threshold.
 */
function computePersonState_(planned, tracked) {
  var MIN = CONFIG.DELIVERY_GAP_MIN_HRS, THOLD = CONFIG.SWARM_THRESHOLD;
  if (planned >= MIN && tracked === 0)                             return 'escalation';
  if (planned >= MIN && tracked > 0 && tracked < THOLD * planned) return 'silent';
  if (tracked > MIN && planned < MIN)                             return 'unplanned';
  if (planned >= MIN && tracked >= THOLD * planned)               return 'aligned';
  return null;
}

/**
 * Returns an array of ISO week strings from the Q4 base week up to and
 * including currentIso. Falls back to the last 13 weeks for Q1–Q3.
 * @param {string} currentIso  e.g. "2026.W27"
 * @returns {string[]} ordered array of ISO strings, earliest first
 */
function buildQtdWindow_(currentIso) {
  var parts = currentIso.match(/^(\d{4})\.W(\d+)$/);
  if (!parts) return [];
  var curY = parseInt(parts[1], 10), curW = parseInt(parts[2], 10);
  var startY, startW;
  if (CONFIG.Q4_BASE_YEAR && CONFIG.Q4_BASE_WEEK) {
    startY = CONFIG.Q4_BASE_YEAR;
    startW = CONFIG.Q4_BASE_WEEK;
  } else {
    startW = curW - 12;
    startY = curY;
    if (startW <= 0) { startY--; startW = weeksInYear_(startY) + startW; }
  }
  var result = [], w = startW, y = startY, guard = 0;
  while ((y < curY || (y === curY && w <= curW)) && guard < 52) {
    result.push(y + '.W' + w);
    w++;
    guard++;
    if (w > weeksInYear_(y)) { w = 1; y++; }
  }
  return result;
}

/**
 * Computes all 4-state behavior signals for the current quarter-to-date window.
 * Called once per getDemandData() after buildPersonAvailability_ has run.
 */
function buildPersonBehaviorSignals_(personWeekPlan, personWeekTracked, personProjectPlan, personMeta, weeks) {
  var currentWeek = null;
  for (var wi = 0; wi < weeks.length; wi++) {
    if (weeks[wi].status === 'now') { currentWeek = weeks[wi]; break; }
  }
  if (!currentWeek) return {};
  var currentIso = currentWeek.iso;
  var qtdIsos = buildQtdWindow_(currentIso);

  var allNps = {};
  Object.keys(personWeekPlan || {}).forEach(function(np) { allNps[np] = true; });
  Object.keys(personWeekTracked || {}).forEach(function(np) { allNps[np] = true; });

  // 1. personWeekState (current week excluded — tracked time accumulates through the week)
  var personWeekState = {};
  Object.keys(allNps).forEach(function(np) {
    personWeekState[np] = {};
    qtdIsos.forEach(function(iso) {
      if (iso === currentIso) return; // in-progress, never flag current week
      var pl = ((personWeekPlan || {})[np] || {})[iso] || 0;
      var tr = ((personWeekTracked || {})[np] || {})[iso] || 0;
      var state = computePersonState_(pl, tr);
      if (state) personWeekState[np][iso] = state;
    });
  });

  // 2. QTD project counts per person per week (for sparkline)
  var personQtdProjectCounts = {};
  Object.keys(allNps).forEach(function(np) {
    personQtdProjectCounts[np] = {};
    var projPlan = (personProjectPlan || {})[np] || {};
    qtdIsos.forEach(function(iso) {
      var count = 0;
      Object.keys(projPlan).forEach(function(key) {
        if ((projPlan[key][iso] || 0) > 0) count++;
      });
      personQtdProjectCounts[np][iso] = count;
    });
  });

  // 3. QTD reliability score and streak
  var personQtdScore = {}, personStreakLen = {};
  Object.keys(allNps).forEach(function(np) {
    var states = personWeekState[np] || {};
    var total = 0, aligned = 0;
    qtdIsos.forEach(function(iso) {
      if (iso > currentIso) return;
      if (states[iso]) { total++; if (states[iso] === 'aligned') aligned++; }
    });
    personQtdScore[np] = total > 0 ? aligned / total : 0;
    var streak = 0;
    for (var i = qtdIsos.length - 1; i >= 0; i--) {
      var iso = qtdIsos[i];
      if (iso > currentIso) continue;
      if (states[iso] === 'aligned') streak++;
      else break;
    }
    personStreakLen[np] = streak;
  });

  // 4. Escalation consecutive count
  var personEscLen = {};
  Object.keys(allNps).forEach(function(np) {
    var states = personWeekState[np] || {};
    var escLen = 0;
    for (var i = qtdIsos.length - 1; i >= 0; i--) {
      var iso = qtdIsos[i];
      if (iso > currentIso) continue;
      if (states[iso] === 'escalation') escLen++;
      else break;
    }
    personEscLen[np] = escLen;
  });

  // 5. Swarm flag
  var escalatingThisWeek = {};
  Object.keys(allNps).forEach(function(np) {
    if ((personWeekState[np] || {})[currentIso] === 'escalation') escalatingThisWeek[np] = true;
  });
  var hasAnyEscalation = Object.keys(escalatingThisWeek).length > 0;
  var personIsSwarm = {};
  Object.keys(allNps).forEach(function(np) {
    personIsSwarm[np] = (personWeekState[np] || {})[currentIso] === 'unplanned' && hasAnyEscalation;
  });

  // 6. Stabilizer
  var personIsStabilizer = {};
  Object.keys(allNps).forEach(function(np) {
    var state = (personWeekState[np] || {})[currentIso];
    var projCount = (personQtdProjectCounts[np] || {})[currentIso] || 0;
    personIsStabilizer[np] = state === 'aligned' && projCount >= CONFIG.FRAG_MIN;
  });

  // 7. Concentration risk per project
  var projectAlignedCount = {};
  Object.keys(allNps).forEach(function(np) {
    var state = (personWeekState[np] || {})[currentIso];
    var projPlan = (personProjectPlan || {})[np] || {};
    Object.keys(projPlan).forEach(function(key) {
      if ((projPlan[key][currentIso] || 0) > 0) {
        projectAlignedCount[key] = projectAlignedCount[key] || 0;
        if (state === 'aligned') projectAlignedCount[key]++;
      }
    });
  });
  var projectConcentrationRisk = {};
  Object.keys(projectAlignedCount).forEach(function(key) {
    projectConcentrationRisk[key] = projectAlignedCount[key] < 2;
  });

  return {
    currentIso:              currentIso,
    qtdIsos:                 qtdIsos,
    personWeekState:         personWeekState,
    personQtdScore:          personQtdScore,
    personStreakLen:          personStreakLen,
    personEscLen:            personEscLen,
    personQtdProjectCounts:  personQtdProjectCounts,
    personIsSwarm:           personIsSwarm,
    personIsStabilizer:      personIsStabilizer,
    projectConcentrationRisk: projectConcentrationRisk
  };
}

function buildPersonAvailability_(plannedRecs, trackedRecs, ptoRecs, rosterProfiles) {
  var norm = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var personWeekPlan = {}, personWeekTracked = {}, personProjectPlan = {}, personWeekPTO = {}, displayNames = {};

  // Build display names: first occurrence of a normalised name wins.
  (plannedRecs || []).concat(trackedRecs || []).concat(ptoRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!displayNames[np]) displayNames[np] = rec.person;
  });

  (plannedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!((rosterProfiles || {})[np])) return;
    personWeekPlan[np] = personWeekPlan[np] || {};
    personWeekPlan[np][rec.iso] = (personWeekPlan[np][rec.iso] || 0) + rec.hours;
    personProjectPlan[np] = personProjectPlan[np] || {};
    personProjectPlan[np][rec.key] = personProjectPlan[np][rec.key] || {};
    personProjectPlan[np][rec.key][rec.iso] = (personProjectPlan[np][rec.key][rec.iso] || 0) + rec.hours;
  });

  (trackedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!((rosterProfiles || {})[np])) return;
    personWeekTracked[np] = personWeekTracked[np] || {};
    personWeekTracked[np][rec.iso] = (personWeekTracked[np][rec.iso] || 0) + rec.hours;
  });

  (ptoRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!((rosterProfiles || {})[np])) return;
    personWeekPTO[np] = personWeekPTO[np] || {};
    personWeekPTO[np][rec.iso] = (personWeekPTO[np][rec.iso] || 0) + rec.hours;
  });

  var personMeta = {};
  var allNorms = {};
  Object.keys(personWeekPlan).forEach(function(np) { allNorms[np] = true; });
  Object.keys(personWeekTracked).forEach(function(np) { allNorms[np] = true; });
  Object.keys(personWeekPTO).forEach(function(np) { allNorms[np] = true; });
  var excludedSet = {};
  (CONFIG.EXCLUDED_NAMES || []).forEach(function(n) { excludedSet[norm(n)] = true; });
  Object.keys(allNorms).forEach(function(np) {
    var prof = (rosterProfiles || {})[np] || {};
    personMeta[np] = {
      displayName: displayNames[np] || np,
      jobFamily:   prof.jobFamily  || '',
      manager:     prof.manager    || '',
      location:    prof.location   || '',
      isManager:   prof.isManager  || false,
      isCrew:      prof.isCrew     || false,
      excluded:    excludedSet[np] || false
    };
  });

  return { personWeekPlan: personWeekPlan, personWeekTracked: personWeekTracked,
           personProjectPlan: personProjectPlan, personMeta: personMeta,
           personWeekPTO: personWeekPTO };
}

// ── SHEET PARSING ────────────────────────────────────────────

/**
 * Parses the two-row stacked-header matrix into allocation records, and separately
 * sums the excluded non-project keys (NETSUITE = PTO + public holidays) per ISO week
 * so capacity can be reduced by time-off downstream.
 * @param {Array<Array>} vals - sheet getValues()
 * @param {string[]} nonProjectKeys
 * @returns {{ recs:Array<{person:string, iso:string, key:string, name:string, hours:number}>,
 *             ptoRecs:Array<{person:string, iso:string, key:string, name:string, hours:number}>,
 *             timeOffByWeek:Object<string,number> }}
 */
function parseAllocations_(vals, nonProjectKeys) {
  var out = [];
  var ptoOut = [];
  var timeOffByWeek = {};
  if (!vals || vals.length < 2) return { recs: out, ptoRecs: ptoOut, timeOffByWeek: timeOffByWeek };

  // Locate the field-header row by its employee column.
  var isEmpHdr = function (h) {
    return /user|resource|rocketeer|name|employee/i.test(h) && !/type|role|skill|program|team/i.test(h);
  };
  var hr = -1, iEmp = -1;
  for (var r = 0; r < Math.min(vals.length, 5) && hr === -1; r++) {
    for (var c = 0; c < vals[r].length; c++) {
      if (isEmpHdr(String(vals[r][c]).trim())) { hr = r; iEmp = c; break; }
    }
  }
  if (hr === -1) return { recs: out, ptoRecs: ptoOut, timeOffByWeek: timeOffByWeek };

  // "Key" (project) and "Space" (project name) columns.
  var iKey = -1, iSpace = -1;
  for (var c2 = 0; c2 < vals[hr].length; c2++) {
    var hdr = String(vals[hr][c2]).trim().toLowerCase();
    if (hdr === "key")   iKey = c2;
    if (hdr === "space") iSpace = c2;
  }

  var exclude = {};
  (nonProjectKeys || []).forEach(function (k) { exclude[String(k).trim().toUpperCase()] = true; });

  // Week columns: ISO label row sits above the field-header row when present (new format),
  // else the field-header row itself (legacy single-row export).
  var isoRe = /^\s*\d{4}\.?W\d+\s*$/i;
  var labelRow = (hr > 0 && vals[hr - 1].some(function (cell) { return isoRe.test(String(cell)); }))
    ? vals[hr - 1] : vals[hr];
  var defYear = isoWeekYear_(new Date());
  var wCols = [];
  labelRow.forEach(function (cell, idx) {
    var key = weekToKey_(cell, defYear);
    if (key) wCols.push({ iso: key, idx: idx });
  });

  for (var i = hr + 1; i < vals.length; i++) {
    var row = vals[i];
    var person = String(row[iEmp] || "").trim();
    if (!person || person.toUpperCase() === "TOTAL") continue;     // skip footer / blanks
    var rawKey = iKey !== -1 ? String(row[iKey] || "").trim() : "";
    if (!rawKey) continue;                                          // skip blank keys
    var isTimeOff = !!exclude[rawKey.toUpperCase()];                // NETSUITE = PTO + public holidays
    var name = iSpace !== -1 ? String(row[iSpace] || "").trim() : "";
    for (var wi = 0; wi < wCols.length; wi++) {
      var hours = parseFloat(row[wCols[wi].idx]);
      if (!hours || hours <= 0) continue;
      if (isTimeOff) {                                              // reduces capacity, not project demand
        timeOffByWeek[wCols[wi].iso] = (timeOffByWeek[wCols[wi].iso] || 0) + hours;
        ptoOut.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours });
      } else {
        out.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours });
      }
    }
  }
  return { recs: out, ptoRecs: ptoOut, timeOffByWeek: timeOffByWeek };
}

// ── AGGREGATION ──────────────────────────────────────────────

/** Returns an empty model skeleton for the given weeks. */
function emptyModel_(weeks) {
  var isoList = weeks.map(function (w) { return w.iso; });
  var capByWeek = {}; isoList.forEach(function (iso) { capByWeek[iso] = 0; });
  return {
    weeks: weeks,
    isoList: isoList,
    cap: {}, head: {}, winners: {}, activeProj: {}, weekTotal: {},
    blendByWeek: {}, avgBlend: {}, stretched: {}, activePeople: {}, fragByWeek: {},
    order: [], keyName: {}, maxCell: 0.001, baselineIso: null,
    capByWeek: capByWeek, grossCapByWeek: {}, timeOffByWeek: {},
    capacityMode: "planned", headcount: null, anzCount: 0, baseCapacity: 0,
    capacity: CONFIG.WEEKLY_CAPACITY_HRS, anzCapacity: CONFIG.ANZ_CAPACITY_HRS,
    planTarget: CONFIG.PLAN_TARGET,
    weekTracked: {}, tracked: {}, fidelity: {},
    behaviorSignals: {},
    displayNames: {},
    rosterDimensions: { locations: [], jobFamilies: [], managers: [] },
    trackedWarning: null, excludedNames: [],
    trackedError: null,
    personWeekPlan: {}, personWeekTracked: {}, personProjectPlan: {}, personMeta: {}, personWeekPTO: {},
    fragMin: CONFIG.FRAG_MIN, topnStrategic: CONFIG.TOPN_STRATEGIC,
    utilTight: CONFIG.UTIL_TIGHT, utilOver: CONFIG.UTIL_OVER,
    error: null,
  };
}

/**
 * Aggregates allocation records into the demand model (hours-based).
 * Only records whose iso is in the window are counted.
 * @param {Array} recs
 * @param {Array} weeks
 * @returns {Object} model
 */
function aggregate_(recs, weeks, baselineIso) {
  var model = emptyModel_(weeks);
  model.baselineIso = baselineIso || null;
  var isoList = model.isoList;
  var inWindow = {}; isoList.forEach(function (iso) { inWindow[iso] = true; });
  // The baseline week is counted (for the first week's WoW delta) but NOT displayed,
  // so it never appears in isoList, blend, winners, ordering, or the heatmap.
  if (baselineIso) inWindow[baselineIso] = true;

  var cap = {};                 // key -> iso -> summed hours
  var headSets = {};            // key -> iso -> {person:true}
  var personKeys = {};          // iso -> person -> {key:true}  (distinct projects per person/week)
  var keyName = {};
  isoList.forEach(function (iso) { personKeys[iso] = {}; });

  recs.forEach(function (rec) {
    if (!inWindow[rec.iso]) return;
    if (!keyName[rec.key] && rec.name) keyName[rec.key] = rec.name;

    cap[rec.key] = cap[rec.key] || {};
    cap[rec.key][rec.iso] = (cap[rec.key][rec.iso] || 0) + rec.hours;

    headSets[rec.key] = headSets[rec.key] || {};
    headSets[rec.key][rec.iso] = headSets[rec.key][rec.iso] || {};
    headSets[rec.key][rec.iso][rec.person] = true;

    // personKeys (blend) is only kept for displayed weeks; the baseline week feeds
    // WoW deltas via cap[], not the blend distribution.
    if (personKeys[rec.iso]) {
      personKeys[rec.iso][rec.person] = personKeys[rec.iso][rec.person] || {};
      personKeys[rec.iso][rec.person][rec.key] = true;
    }
  });

  // Distinct people per project/week.
  var head = {};
  Object.keys(headSets).forEach(function (k) {
    head[k] = {};
    Object.keys(headSets[k]).forEach(function (iso) {
      head[k][iso] = Object.keys(headSets[k][iso]).length;
    });
  });

  // Blend distribution + avg blend + stretched (≥ FRAG_MIN) + active people + fragmentation list.
  var blendByWeek = {}, avgBlend = {}, stretched = {}, activePeople = {}, fragByWeek = {};
  isoList.forEach(function (iso) {
    var people = personKeys[iso];
    var names = Object.keys(people);
    blendByWeek[iso] = { 1: 0, 2: 0, 3: 0, 4: 0 };
    fragByWeek[iso] = [];
    var sum = 0, st = 0;
    names.forEach(function (p) {
      var keys = Object.keys(people[p]);
      var n = keys.length;
      sum += n;
      blendByWeek[iso][Math.min(n, 4)]++;
      if (n >= CONFIG.FRAG_MIN) {
        st++;
        fragByWeek[iso].push({ person: p, keys: keys, n: n });
      }
    });
    fragByWeek[iso].sort(function (a, b) { return b.n - a.n || (a.person < b.person ? -1 : 1); });
    activePeople[iso] = names.length;
    avgBlend[iso] = names.length ? sum / names.length : 0;
    stretched[iso] = st;
  });

  // Per-week winner (max hours), active project count, total hours.
  var winners = {}, activeProj = {}, weekTotal = {};
  isoList.forEach(function (iso) {
    var best = null, bestv = -1, cnt = 0, tot = 0;
    Object.keys(cap).forEach(function (k) {
      var v = cap[k][iso] || 0;
      if (v > 0.001) { cnt++; tot += v; }
      if (v > bestv) { bestv = v; best = k; }
    });
    winners[iso] = { key: best, hours: bestv > 0 ? bestv : 0 };
    activeProj[iso] = cnt;
    weekTotal[iso] = tot;
  });

  // Project order by total in-window hours.
  var totals = Object.keys(cap).map(function (k) {
    var t = 0; isoList.forEach(function (iso) { t += (cap[k][iso] || 0); });
    return { key: k, total: t };
  });
  totals.sort(function (a, b) { return b.total - a.total; });

  // Heatmap scaling max.
  var maxCell = 0.001;
  Object.keys(cap).forEach(function (k) {
    isoList.forEach(function (iso) { if ((cap[k][iso] || 0) > maxCell) maxCell = cap[k][iso]; });
  });

  // keyName fallback: any project with no Space name shows its key.
  Object.keys(cap).forEach(function (k) { if (!keyName[k]) keyName[k] = k; });

  model.cap = cap;
  model.head = head;
  model.blendByWeek = blendByWeek;
  model.avgBlend = avgBlend;
  model.stretched = stretched;
  model.activePeople = activePeople;
  model.fragByWeek = fragByWeek;
  model.winners = winners;
  model.activeProj = activeProj;
  model.weekTotal = weekTotal;
  model.order = totals.map(function (t) { return t.key; });
  model.keyName = keyName;
  model.maxCell = maxCell;
  return model;
}

// ── UNIT TESTS (run in the GAS editor, or in Node with a stubbed Logger) ──

/**
 * Verifies the parser + aggregator: hours summed, NETSUITE excluded,
 * winner + blend + fragmentation correct. Run _test_demandParse_ and read the log.
 */
function _test_demandParse_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_demandParse_: " + msg); }

  // Fake stacked-header matrix for weeks W14 + W15.
  var vals = [
    ["", "", "", "", "2026.W14", "2026.W15", ""],
    ["User", "Space", "Key", "Planned (hrs)", "Mar 30 - Apr 05 2026", "Apr 06 - Apr 12 2026", "Total (hrs)"],
    ["Ana Smith", "Acme Project", "ACME", 30, 20, 10, 30],     // W14: 20h
    ["Ana Smith", "Beta Project", "BETA", 16, 8, 8, 16],       // W14: 8h  → Ana on 2 projects in W14
    ["Ben Lee",   "Acme Project", "ACME", 10, 10, 0, 10],      // W14: 10h → ACME W14 total 30h
    ["Ben Lee",   "Time off",     "NETSUITE", 8, 8, 0, 8],     // excluded
    ["TOTAL", "", "", 64, 46, 18, 64],
  ];
  var weeks = [
    { iso: "2026.W14", wk: 14, year: 2026, status: "done" },
    { iso: "2026.W15", wk: 15, year: 2026, status: "now" },
  ];

  var parsed = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
  var recs = parsed.recs;
  assert_(recs.every(function (r) { return r.key !== "NETSUITE"; }), "NETSUITE must be excluded from project recs");

  // NETSUITE time-off (Ben, 8h in W14) is captured separately to reduce capacity.
  assert_(parsed.timeOffByWeek["2026.W14"] === 8,
    "W14 time-off should be 8, got " + parsed.timeOffByWeek["2026.W14"]);
  assert_(!parsed.timeOffByWeek["2026.W15"], "W15 should have no time-off");

  var m = aggregate_(recs, weeks);

  // ACME W14 = 20 (Ana) + 10 (Ben) = 30; BETA W14 = 8.
  assert_(m.cap.ACME["2026.W14"] === 30, "ACME W14 should be 30, got " + m.cap.ACME["2026.W14"]);
  assert_(m.cap.BETA["2026.W14"] === 8, "BETA W14 should be 8, got " + m.cap.BETA["2026.W14"]);

  // Winner of W14 = ACME (30 > 8).
  assert_(m.winners["2026.W14"].key === "ACME", "W14 winner should be ACME, got " + m.winners["2026.W14"].key);

  // Distinct people on ACME in W14 = 2 (Ana + Ben).
  assert_(m.head.ACME["2026.W14"] === 2, "ACME W14 headcount should be 2, got " + m.head.ACME["2026.W14"]);

  // Blend W14: Ana on 2 projects, Ben on 1 (NETSUITE excluded) → blend {1:1, 2:1}.
  assert_(m.blendByWeek["2026.W14"][2] === 1, "W14 should have 1 person on 2 projects");
  assert_(m.blendByWeek["2026.W14"][1] === 1, "W14 should have 1 person on 1 project (Ben, NETSUITE excluded)");

  // Fragmentation drill-down keys are retained per person: Ana's 2 projects are ACME + BETA.
  // (model.fragByWeek lists only people with n ≥ CONFIG.FRAG_MIN; here we assert the blend that feeds it.)
  assert_(m.blendByWeek["2026.W14"][2] === 1, "exactly one person on 2 projects (Ana)");

  // No project key reads NETSUITE.
  assert_(!m.cap.NETSUITE, "NETSUITE must not appear as a project");

  // Hidden baseline week: with W14 as the baseline and only W15 displayed, W14 is
  // counted in cap (so the first displayed week has a WoW prior) but never appears
  // in the displayed isoList/winners.
  var mb = aggregate_(recs, [weeks[1]], "2026.W14");
  assert_(mb.baselineIso === "2026.W14", "baselineIso should be set");
  assert_(mb.isoList.length === 1 && mb.isoList[0] === "2026.W15", "only W15 should be displayed");
  assert_(mb.cap.ACME["2026.W14"] === 30, "baseline W14 cap should remain available for WoW, got " + mb.cap.ACME["2026.W14"]);
  assert_(!mb.winners["2026.W14"], "baseline week must not be computed as a displayed winner");

  Logger.log("✅ _test_demandParse_ passed");
}

/**
 * Verifies the active-capacity filter on a fake roster matrix:
 * excludes wrong class / wrong dept / terminated / inactive; includes ramp-up + crew;
 * credits ANZ people 38 hrs and everyone else 40. Mirrors readActiveCapacity_'s logic
 * so it runs without a live sheet.
 */
function _test_headcount_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_headcount_: " + msg); }

  var raw = [
    ["Name", "Class", "Department", "Employee Status", "Termination/Release Date", "Key Location"],
    ["Alice FTE",   "Professional Services", "Services", "Active",     "",           "United States"],            // ✓ 40
    ["Bob RampUp",  "Professional Services", "Services", "Active",     "",           "Malaysia"],                 // ✓ 40
    ["Cara Crew",   "Professional Services", "Services", "Active",     "",           "Australia & New Zealand"],  // ✓ 38 (ANZ)
    ["Dan Term",    "Professional Services", "Services", "Active",     "2026-05-01", "United States"],            // ✗ termination date
    ["Eve Resign",  "Professional Services", "Services", "Resigned",   "",           "United States"],            // ✗ inactive status
    ["Fay Sales",   "Sales",                 "Sales",    "Active",     "",           "United States"],            // ✗ wrong class
    ["Gus Ops",     "Professional Services", "Finance",  "Active",     "",           "United States"],            // ✗ wrong dept
    ["",            "Professional Services", "Services", "Active",     "",           "United States"],            // ✗ blank name
  ];

  // Re-implement the filter inline (same predicate as readActiveCapacity_).
  var hdrs = raw[0].map(function (h) { return String(h).trim(); });
  var idx = function (n) { return hdrs.findIndex(function (h) { return h.toLowerCase() === n.toLowerCase(); }); };
  var iName = idx("Name"), iClass = idx("Class"), iDept = idx("Department"),
      iStatus = idx("Employee Status"), iTerm = idx("Termination/Release Date"), iLoc = idx("Key Location");
  var anzLoc = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();
  var INACTIVE_RE = /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i;
  var count = 0, base = 0, anz = 0;
  for (var r = 1; r < raw.length; r++) {
    var row = raw[r];
    if (!String(row[iName] || "").trim()) continue;
    if (String(row[iClass] || "").trim() !== CONFIG.ROSTER_CLASS) continue;
    var dept = String(row[iDept] || "").trim();
    if (dept && dept !== CONFIG.ROSTER_DEPT) continue;
    if (INACTIVE_RE.test(String(row[iStatus] || "").trim()) || String(row[iTerm] || "").trim()) continue;
    var isANZ = (String(row[iLoc] || "").trim().toLowerCase() === anzLoc);
    base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
    if (isANZ) anz++;
    count++;
  }
  assert_(count === 3, "active headcount should be 3 (Alice, Bob, Cara), got " + count);
  assert_(anz === 1, "ANZ count should be 1 (Cara), got " + anz);
  // Alice 40 + Bob 40 + Cara 38 (ANZ) = 118.
  assert_(base === 118, "base capacity should be 118 (40+40+38), got " + base);

  Logger.log("✅ _test_headcount_ passed");
}

function _test_buildPersonAvailability_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_buildPersonAvailability_: " + msg); }

  var plannedRecs = [
    { person: "Ana Smith", iso: "2026.W24", key: "ACME", name: "Acme", hours: 20 },
    { person: "Ana Smith", iso: "2026.W24", key: "BETA", name: "Beta", hours: 10 },
    { person: "Ben Lee",   iso: "2026.W24", key: "ACME", name: "Acme", hours: 16 },
    { person: "External",  iso: "2026.W24", key: "ACME", name: "Acme", hours: 8 },  // not in roster → excluded
  ];
  var trackedRecs = [
    { person: "Ana Smith", iso: "2026.W24", key: "ACME", name: "Acme", hours: 16 },
    { person: "Ana Smith", iso: "2026.W24", key: "BETA", name: "Beta", hours: 6 },
  ];
  var roster = {
    "ana smith": { jobFamily: "Consulting", manager: "Mgr A", location: "US" },
    "ben lee":   { jobFamily: "Delivery",   manager: "Mgr B", location: "ANZ" }
    // "external" deliberately absent
  };

  var result = buildPersonAvailability_(plannedRecs, trackedRecs, [], roster);

  // personWeekPlan
  assert_(result.personWeekPlan["ana smith"]["2026.W24"] === 30, "Ana planned should be 30h");
  assert_(result.personWeekPlan["ben lee"]["2026.W24"]   === 16, "Ben planned should be 16h");
  assert_(!result.personWeekPlan["external"], "External (not in roster) must be excluded");

  // personWeekTracked
  assert_(result.personWeekTracked["ana smith"]["2026.W24"] === 22, "Ana tracked should be 22h");
  assert_(!result.personWeekTracked["ben lee"], "Ben has no tracked — key must be absent");

  // personProjectPlan
  assert_(result.personProjectPlan["ana smith"]["ACME"]["2026.W24"] === 20, "Ana ACME plan should be 20h");
  assert_(result.personProjectPlan["ana smith"]["BETA"]["2026.W24"] === 10, "Ana BETA plan should be 10h");

  // personMeta
  assert_(result.personMeta["ana smith"].displayName === "Ana Smith", "displayName should be title-case from rec");
  assert_(result.personMeta["ana smith"].jobFamily   === "Consulting", "jobFamily from roster");
  assert_(result.personMeta["ben lee"].location      === "ANZ", "location from roster");
  assert_(!result.personMeta["external"], "External must not appear in personMeta");

  Logger.log("✅ _test_buildPersonAvailability_ passed");
}

function _test_personWeekPTO_() {
  function assert_(cond, msg) { if (!cond) throw new Error('❌ _test_personWeekPTO_: ' + msg); }

  var NETSUITE_KEY = CONFIG.NONPROJECT_KEYS[0]; // e.g. 'NETSUITE'
  var plannedRecs = [
    { person: 'Ana Smith', iso: '2026.W27', key: 'ACME',        hours: 20 },
  ];
  var trackedRecs = [];
  var ptoRecs = [
    { person: 'Ana Smith', iso: '2026.W27', key: NETSUITE_KEY,  hours: 16 },
    { person: 'Ben Lee',   iso: '2026.W27', key: NETSUITE_KEY,  hours: 40 },
    { person: 'Ana Smith', iso: '2026.W26', key: NETSUITE_KEY,  hours: 8 },
  ];
  var roster = {
    'ana smith': { jobFamily: 'Consulting', manager: 'M', location: 'US' },
    'ben lee':   { jobFamily: 'Delivery',   manager: 'M', location: 'ANZ' }
  };

  var result = buildPersonAvailability_(plannedRecs, trackedRecs, ptoRecs, roster);

  assert_(result.personWeekPlan['ana smith']['2026.W27'] === 20,  'Ana project plan 20h');
  assert_(result.personWeekPTO['ana smith']['2026.W27']  === 16,  'Ana PTO planned 16h');
  assert_(result.personWeekPTO['ben lee']['2026.W27']    === 40,  'Ben full-PTO 40h');
  assert_(result.personWeekPTO['ana smith']['2026.W26']  === 8,   'Ana PTO tracked 8h');
  assert_(!result.personWeekPlan['ben lee'],                       'Ben has no project plan');

  Logger.log("✅ _test_personWeekPTO_ passed");
}

function _test_isCrew_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_isCrew_: " + msg); }

  var cases = [
    { title: "60.IC3. Software Engineer",  expect: false },
    { title: "60.M4. Engineering Manager", expect: false },
    { title: "Crew Member",                expect: true  },
    { title: "Senior Crew Member",         expect: true  },
    { title: "Contractor",                 expect: true  },
    { title: "Senior Contractor",          expect: true  },
    { title: "",                           expect: false },
  ];
  cases.forEach(function(c) {
    var result = /crew member|contractor/i.test(c.title);
    assert_(result === c.expect, "title '" + c.title + "' → expected " + c.expect + " got " + result);
  });
  Logger.log("✅ _test_isCrew_ passed");
}

function _test_behaviorSignals() {
  var personWeekPlan = {
    'alex smith': { '2026.W14': 8, '2026.W15': 0, '2026.W27': 8 },
    'jane doe':   { '2026.W14': 8, '2026.W15': 8, '2026.W27': 8 }
  };
  var personWeekTracked = {
    'alex smith': { '2026.W14': 8, '2026.W27': 0 },
    'jane doe':   { '2026.W14': 8, '2026.W15': 8, '2026.W27': 8 }
  };
  var personProjectPlan = {
    'alex smith': { 'PPT': { '2026.W14': 8, '2026.W27': 8 } },
    'jane doe':   { 'PPT': { '2026.W14': 8, '2026.W27': 4 }, 'ICARE': { '2026.W15': 8, '2026.W27': 4 } }
  };
  var personMeta = {
    'alex smith': { displayName: 'Alex Smith' },
    'jane doe':   { displayName: 'Jane Doe' }
  };
  var weeks = [
    { iso: '2026.W25', status: 'done' },
    { iso: '2026.W26', status: 'done' },
    { iso: '2026.W27', status: 'now' },
    { iso: '2026.W28', status: 'plan' }
  ];
  Logger.log('computePersonState_(8, 0) = ' + computePersonState_(8, 0));
  Logger.log('computePersonState_(8, 1) = ' + computePersonState_(8, 1));
  Logger.log('computePersonState_(8, 2) = ' + computePersonState_(8, 2));
  Logger.log('computePersonState_(0, 6) = ' + computePersonState_(0, 6));
  Logger.log('computePersonState_(2, 0) = ' + computePersonState_(2, 0));
  var qtd = buildQtdWindow_('2026.W27');
  Logger.log('buildQtdWindow_ length: ' + qtd.length + ' first: ' + qtd[0] + ' last: ' + qtd[qtd.length-1]);
  var bs = buildPersonBehaviorSignals_(personWeekPlan, personWeekTracked, personProjectPlan, personMeta, weeks);
  Logger.log('Alex state W27: ' + bs.personWeekState['alex smith']['2026.W27']);
  Logger.log('Jane state W27: ' + bs.personWeekState['jane doe']['2026.W27']);
  Logger.log('Jane qtd score: ' + bs.personQtdScore['jane doe']);
  Logger.log('Alex qtd score: ' + bs.personQtdScore['alex smith']);
  Logger.log('Jane streak len: ' + bs.personStreakLen['jane doe']);
  Logger.log('PPT concentration risk: ' + bs.projectConcentrationRisk['PPT']);
  Logger.log('Jane proj count W27: ' + bs.personQtdProjectCounts['jane doe']['2026.W27']);
  Logger.log('Done.');
}
